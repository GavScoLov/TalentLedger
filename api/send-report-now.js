// Vercel Serverless — immediately send a report automation (used by "Send Now" button).
// POST /api/send-report-now   { automationId: string }
// Requires a valid Supabase session cookie (authenticated users only).

import { createClient } from '@supabase/supabase-js';
import { Resend }        from 'resend';
import {
  getAutoMonthRange,
  REPORT_GENERATORS,
  buildEmailHtml,
} from './lib/report-data.js';

const SUPABASE_URL = 'https://txhyfogbyzwueazhrqax.supabase.co';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey  = process.env.RESEND_API_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });
  if (!resendKey)  return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const { automationId } = req.body || {};
  if (!automationId) return res.status(400).json({ error: 'automationId required' });

  const admin  = createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const resend = new Resend(resendKey);
  const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}` || 'https://talentledger.app';
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'reports@talentledger.app';

  const { data: auto, error: fetchErr } = await admin
    .from('report_email_automations')
    .select('*')
    .eq('id', automationId)
    .single();

  if (fetchErr || !auto) return res.status(404).json({ error: 'Automation not found' });

  const now = new Date();
  const { start, end, label } = getAutoMonthRange(now);

  const reportItems = [];
  const attachments = [];

  for (const key of (auto.report_keys || [])) {
    const def = REPORT_GENERATORS[key];
    if (!def) continue;
    try {
      const { csv, filename } = await def.gen(start, end);
      attachments.push({ filename, content: Buffer.from(csv).toString('base64') });
      reportItems.push({ title: def.title, filename });
    } catch (e) {
      reportItems.push({ title: def.title, filename: null, error: e.message });
    }
  }

  const toEmails = (auto.recipients || []).map(r => r.email).filter(Boolean);
  if (!toEmails.length) return res.status(400).json({ error: 'No recipients configured' });

  try {
    await resend.emails.send({
      from:        fromEmail,
      to:          toEmails,
      subject:     `${auto.name} — ${label} (sent manually)`,
      html:        buildEmailHtml(auto.name, label, reportItems, appUrl),
      attachments,
    });

    await admin
      .from('report_email_automations')
      .update({ last_sent_at: now.toISOString() })
      .eq('id', automationId);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, sentTo: toEmails, month: label });
  } catch (err) {
    console.error('send-report-now error:', err);
    return res.status(502).json({ error: err.message });
  }
}
