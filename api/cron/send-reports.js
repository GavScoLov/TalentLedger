// Vercel Cron Function — runs every hour, dispatches due email automations.
// Schedule defined in vercel.json: "0 * * * *"
// Vercel injects Authorization: Bearer <CRON_SECRET> on every invocation.

import { createClient } from '@supabase/supabase-js';
import { Resend }        from 'resend';
import {
  getAutoMonthRange,
  REPORT_GENERATORS,
  buildEmailHtml,
} from '../lib/report-data.js';

const SUPABASE_URL = 'https://txhyfogbyzwueazhrqax.supabase.co';

/** Reliably convert `now` into the given IANA timezone and return {hour, dow, dom, year, month, day}. */
function getLocalParts(now, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const DOW_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour:  parseInt(p.hour),
    dow:   DOW_MAP[p.weekday] ?? now.getUTCDay(),
    dom:   parseInt(p.day),
    year:  parseInt(p.year),
    month: parseInt(p.month),
    day:   parseInt(p.day),
  };
}

/** Check whether an automation is due to run right now. */
function isDue(automation, now) {
  const { frequency, schedule_days, schedule_date, schedule_time, schedule_tz, last_sent_at } = automation;

  // Prevent double-firing within 50 minutes
  if (last_sent_at) {
    const msSince = now - new Date(last_sent_at);
    if (msSince < 50 * 60 * 1000) return false;
  }

  // Convert now → automation's local time using Intl (reliable in Node.js)
  const tz    = schedule_tz || 'America/Chicago';
  const local = getLocalParts(now, tz);

  const [schedHour] = (schedule_time || '09:00').split(':').map(Number);
  if (local.hour !== schedHour) return false;

  switch (frequency) {
    case 'once': {
      if (last_sent_at) return false;
      if (!schedule_date) return false;
      const sd = new Date(schedule_date + 'T12:00:00Z');
      return sd.getUTCFullYear() === local.year
          && sd.getUTCMonth() + 1 === local.month
          && sd.getUTCDate()       === local.day;
    }
    case 'daily':   return true;
    case 'weekly':  return (schedule_days || []).includes(local.dow);
    case 'monthly': return (schedule_days || []).includes(local.dom);
    default:        return false;
  }
}

export default async function handler(req, res) {
  // Vercel automatically sets Authorization: Bearer <CRON_SECRET>
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey  = process.env.RESEND_API_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  if (!resendKey)  return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const admin  = createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const resend = new Resend(resendKey);
  const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}` || 'https://talentledger.app';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'reports@talentledger.app';

  const { data: automations, error: fetchErr } = await admin
    .from('report_email_automations')
    .select('*')
    .eq('is_active', true);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const now     = new Date();
  const results = [];

  for (const auto of automations) {
    if (!isDue(auto, now)) continue;

    try {
      const { start, end, label } = getAutoMonthRange(now);
      const reportItems = [];
      const attachments = [];

      for (const key of (auto.report_keys || [])) {
        const def = REPORT_GENERATORS[key];
        if (!def) continue;
        try {
          const { csv, html, filename } = await def.gen(start, end);
          attachments.push({ filename, content: Buffer.from(csv).toString('base64') });
          reportItems.push({ title: def.title, filename, html });
        } catch (e) {
          reportItems.push({ title: def.title, filename: null, html: null, error: e.message });
        }
      }

      const toEmails = (auto.recipients || []).map(r => r.email).filter(Boolean);
      if (!toEmails.length) {
        results.push({ id: auto.id, name: auto.name, status: 'skipped', reason: 'no recipients' });
        continue;
      }

      await resend.emails.send({
        from:        fromEmail,
        to:          toEmails,
        subject:     `${auto.name} — ${label}`,
        html:        buildEmailHtml(auto.name, label, reportItems, appUrl),
        attachments,
      });

      await admin
        .from('report_email_automations')
        .update({ last_sent_at: now.toISOString() })
        .eq('id', auto.id);

      results.push({ id: auto.id, name: auto.name, status: 'sent', to: toEmails });
    } catch (err) {
      console.error(`Automation ${auto.id} failed:`, err);
      results.push({ id: auto.id, name: auto.name, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ checked: automations.length, sent: results.filter(r => r.status === 'sent').length, results });
}
