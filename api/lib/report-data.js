// Server-side TempWorks data fetcher + report generators (CSV + inline HTML tables)
// Used by api/cron/send-reports.js and api/send-report-now.js

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txhyfogbyzwueazhrqax.supabase.co';

// ── TempWorks Invoice Export ──────────────────────────────────────────────────
// Calls the same export endpoint used by api/tw-invoice.js.
// Returns normalised records with lowercase snake_case field names.

async function twInvoiceFetch(start, end) {
  const bearer   = process.env.TW_INVOICE_BEARER;
  const exportId = process.env.TW_INVOICE_EXPORT_ID;
  const startId  = process.env.TW_INVOICE_START_ID;
  const endId    = process.env.TW_INVOICE_END_ID;

  if (!bearer || !exportId || !startId || !endId) {
    throw new Error('TempWorks Invoice export credentials not configured');
  }

  const res = await fetch(
    `https://api.ontempworks.com/utilities/dataExport/exports/${exportId}`,
    {
      method: 'POST',
      headers: {
        'accept':       'text/plain',
        'x-tw-token':   bearer,
        'Content-Type': 'application/vnd.textus+jsonld',
      },
      body: JSON.stringify({
        parameters: [
          { exportParameterId: startId, value: start },
          { exportParameterId: endId,   value: end   },
        ],
      }),
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`TW Invoice export HTTP ${res.status}: ${msg}`);
  }
  const data = JSON.parse(await res.text());
  return data.map(r => ({
    branchname:    r.BranchName    || '',
    weekendbill:   r.WeekendBill   ? r.WeekendBill.split('T')[0] : '',
    invoicenumber: r.InvoiceNumber || '',
    customerid:    r.CustomerId    ?? null,
    customername:  r.CustomerName  || '',
    duedate:       r.DueDate       ? r.DueDate.split('T')[0] : '',
    invoiceamount: r.InvoiceAmount ?? 0,
    payamount:     r.PayAmount     ?? 0,
    balanceamount: r.BalanceAmount ?? 0,
    dso:           r.DSO           || '',
    pastdue:       r.PastDue       || '',
  }));
}

// Module-level invoice cache — avoids redundant API calls within a single report run
let _invoiceCache    = null;
let _invoiceCacheKey = null;

async function getInvoices(start, end) {
  const key = `${start}_${end}`;
  if (_invoiceCacheKey === key && _invoiceCache) return _invoiceCache;
  _invoiceCache    = await twInvoiceFetch(start, end);
  _invoiceCacheKey = key;
  return _invoiceCache;
}

// ── Supabase client factory (uses service role for server-side access) ─────────

function makeSB() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Branch lookup helper ───────────────────────────────────────────────────────
// Derive customer → branch from invoice data (invoices carry both fields).

function buildBranchLookup(invoices) {
  const byWeek     = {};
  const byCustomer = {};
  for (const r of invoices) {
    if (r.customername && r.branchname) {
      byWeek[`${r.customername}||${r.weekendbill}`] = r.branchname;
      if (!byCustomer[r.customername]) byCustomer[r.customername] = r.branchname;
    }
  }
  return { byWeek, byCustomer };
}

// ── Public fetch helpers ───────────────────────────────────────────────────────

export async function fetchInvoiceRegister(start, end) {
  return getInvoices(start, end);
}

// ── Hours helpers: TW REST primary, Supabase fallback ─────────────────────

async function getTWHours(start, end) {
  const bearer = process.env.TW_BEARER || process.env.TW_INVOICE_BEARER;
  function getSundays(s, e) {
    const out = [];
    const d = new Date(s + 'T12:00:00Z');
    if (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
    const ed = new Date(e + 'T12:00:00Z');
    while (d <= ed) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
    return out;
  }
  async function fetchWeek(weekendBill) {
    const records = [];
    let skip = 0;
    while (true) {
      const res = await fetch(
        `https://api.ontempworks.com/TimeEntry/timecards?weekendBill=${weekendBill}&skip=${skip}&take=1000`,
        { headers: { 'x-tw-token': bearer, 'Accept': 'application/json' } }
      );
      if (!res.ok) throw new Error(`TW timecards ${res.status}`);
      const envelope = await res.json();
      // TW REST returns {"data": [...], "totalCount": N} — not a raw array
      const page = Array.isArray(envelope) ? envelope : (envelope.data || []);
      if (page.length === 0) break;
      records.push(...page);
      if (page.length < 1000) break;
      skip += 1000;
    }
    return records;
  }
  const sundays = getSundays(start, end);
  const CONCURRENCY = 5;
  const all = [];
  for (let i = 0; i < sundays.length; i += CONCURRENCY) {
    const settled = await Promise.allSettled(sundays.slice(i, i + CONCURRENCY).map(fetchWeek));
    for (const r of settled) if (r.status === 'fulfilled') all.push(...r.value);
  }
  return all;
}

async function getHoursAggregated(start, end) {
  let records;
  try {
    records = await getTWHours(start, end);
    // Aggregate to customer+branch+week
    const byKey = {};
    for (const tc of records) {
      // TW REST returns camelCase field names per Swagger schema
      const customer = tc.customerName || '';
      const branch   = tc.branchName   || '';
      const weekend  = (tc.weekendDate || '').split('T')[0];
      const hrs = (Number(tc.regularHours || 0) + Number(tc.overtimeHours || 0) + Number(tc.doubletimeHours || 0));
      const key = `${customer}||${branch}||${weekend}`;
      if (!byKey[key]) byKey[key] = { customer, branch, weekend, hours: 0, headcount: 0 };
      byKey[key].hours += hrs;
      byKey[key].headcount += 1;
    }
    return Object.values(byKey);
  } catch {
    // Supabase fallback
    const sb = makeSB();
    const [{ data: hoursData }, invoices] = await Promise.all([
      sb.from('tw_customer_weekly_summary')
        .select('customer_name, weekend_date, total_hours, headcount')
        .gte('weekend_date', start)
        .lte('weekend_date', end),
      getInvoices(start, end),
    ]);
    const { byWeek, byCustomer } = buildBranchLookup(invoices);
    return (hoursData || []).map(r => ({
      customer: r.customer_name,
      branch:   byWeek[`${r.customer_name}||${r.weekend_date}`] || byCustomer[r.customer_name] || '',
      weekend:  r.weekend_date,
      hours:    r.total_hours || 0,
      headcount: r.headcount  || 0,
    }));
  }
}

export async function fetchEmployeeHours(start, end) {
  const rows = await getHoursAggregated(start, end);
  return rows.map(r => ({
    branchname:   r.branch,
    customername: r.customer,
    weekendbill:  r.weekend,
    hours:        r.hours,
  }));
}

export async function fetchUniqueCountByCompany(start, end) {
  const rows = await getHoursAggregated(start, end);
  return rows.map(r => ({
    branchname:       r.branch,
    customername:     r.customer,
    weekendbill:      r.weekend,
    unique_row_count: r.headcount,
  }));
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function isDHP(name)       { return (name || '').toUpperCase().includes('DHP'); }
function isCorporate(name) { const n = (name || '').toLowerCase(); return n.includes('corporate') || n.includes('_corp'); }

/** Same auto-month logic as reports.html getAutoMonthBase() */
export function getAutoMonthRange(now = new Date()) {
  const dow    = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - (dow === 0 ? 7 : dow));
  if (dow >= 1 && dow <= 4) sunday.setDate(sunday.getDate() - 7);

  const start = new Date(sunday.getFullYear(), sunday.getMonth(), 1);
  const end   = new Date(sunday.getFullYear(), sunday.getMonth() + 1, 0);
  const toStr = d => d.toISOString().split('T')[0];
  return {
    start: toStr(start),
    end:   toStr(end),
    label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** Generate a CSV string from a header row + data rows */
export function toCSV(headers, rows) {
  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function sortedWeeksFrom(weekSet) {
  return [...weekSet].filter(w => w !== '—').sort().concat(weekSet.has('—') ? ['—'] : []);
}

/** Returns all Sunday (week-end) dates within [start, end] as YYYY-MM-DD strings */
function getSundaysInRange(start, end) {
  const sundays = [];
  const d = new Date(start + 'T12:00:00Z');
  // Advance to the first Sunday on or after start
  if (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
  const endDate = new Date(end + 'T12:00:00Z');
  while (d <= endDate) {
    sundays.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return sundays;
}

// ── Week date-range label helpers ─────────────────────────────────────────────

/** "2026-04-05" → "3/30-4/5" */
function weekRangeLabel(weekEndStr) {
  if (!weekEndStr || weekEndStr === '—') return '—';
  const end = new Date(weekEndStr + 'T00:00:00Z');
  const s   = new Date(end);
  s.setUTCDate(end.getUTCDate() - 6);
  return `${s.getUTCMonth() + 1}/${s.getUTCDate()}-${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}

/** "2026-03-01" → "MARCH 2026" */
function monthYearUpper(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

/** "2026-04-01" → "April 2026" */
function monthYearTitle(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ── HTML escape ───────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── HTML table builders ───────────────────────────────────────────────────────

const TD_BASE = 'padding:5px 9px;border:1px solid #e0e0e0;font-size:11px;white-space:nowrap;font-family:Arial,sans-serif;';

/**
 * Build an inline HTML table for DHP-style reports.
 * allRows[0] = title row, [1] = column headers, [2] = blank, [3…] = data, last row[1]==='TOTALS'
 */
function buildDhpHtmlTable(allRows) {
  const numCols   = allRows[0].length;
  const title     = esc(String(allRows[0][0]));
  const headerRow = allRows[1];
  const totalsRow = allRows.find(r => r[1] === 'TOTALS');
  const dataRows  = allRows.slice(2).filter(r => r[1] !== 'TOTALS');

  let html = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`;

  // Orange title bar
  html += `<tr><td colspan="${numCols}" bgcolor="#EA8938" style="${TD_BASE}background:#EA8938;color:#fff;font-weight:700;font-size:13px;padding:8px 12px;">${title}</td></tr>`;

  // Dark header row
  html += `<tr>`;
  headerRow.forEach((h, i) => {
    const align = i >= 2 ? 'right' : 'left';
    html += `<td bgcolor="#1A1A2E" style="${TD_BASE}background:#1A1A2E;color:#fff;font-weight:700;text-align:${align};">${esc(h)}</td>`;
  });
  html += `</tr>`;

  // Data rows (skip blank separator rows)
  dataRows.forEach((row, ri) => {
    if (row.every(c => c === '' || c == null)) return;
    const bg = ri % 2 === 1 ? '#F9F9F9' : '#FFFFFF';
    html += `<tr>`;
    row.forEach((cell, ci) => {
      const align = ci >= 2 ? 'right' : 'left';
      html += `<td bgcolor="${bg}" style="${TD_BASE}background:${bg};text-align:${align};">${esc(cell)}</td>`;
    });
    html += `</tr>`;
  });

  // Yellow totals row
  if (totalsRow) {
    html += `<tr>`;
    totalsRow.forEach((cell, ci) => {
      const align = ci >= 2 ? 'right' : 'left';
      html += `<td bgcolor="#FFF9C4" style="${TD_BASE}background:#FFF9C4;font-weight:700;text-align:${align};">${esc(cell)}</td>`;
    });
    html += `</tr>`;
  }

  html += `</table>`;
  return html;
}

/**
 * Build an inline HTML table for PSA billing monthly.
 * headerRow  = ["April 2026", week ranges…, "TOTALS"]
 * rows may contain:
 *   - regular company rows
 *   - "Total [Branch]" rows  (branch total, green)
 *   - "— REGION NAME —" rows (region header, gray separator)
 *   - "REGION NAME TOTAL" rows (region total, orange tint)
 *   - "GRAND TOTAL" row (dark, white text)
 *   - blank separator rows (skipped)
 */
function buildPsaHtmlTable(headers, rows) {
  const numCols = headers.length;
  let html = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`;

  // Dark header row
  html += `<tr>`;
  headers.forEach((h, i) => {
    const align = i === 0 ? 'left' : 'right';
    html += `<td bgcolor="#1A1A2E" style="${TD_BASE}background:#1A1A2E;color:#fff;font-weight:700;text-align:${align};">${esc(h)}</td>`;
  });
  html += `</tr>`;

  let dataIdx = 0;
  rows.forEach(row => {
    if (row.every(c => c === '' || c == null)) return; // skip blank separators

    const first         = String(row[0] ?? '');
    const isRegionHdr   = /^— .+ —$/.test(first);
    const isGrandTotal  = first === 'GRAND TOTAL';
    const isRegionTotal = !isGrandTotal && first === first.toUpperCase() && first.endsWith(' TOTAL');
    const isBranchTotal = first.startsWith('Total ');

    if (isRegionHdr) {
      html += `<tr><td colspan="${numCols}" bgcolor="#E8EAF0" style="${TD_BASE}background:#E8EAF0;font-weight:700;font-size:10px;color:#444;letter-spacing:0.08em;padding:5px 9px;">${esc(first)}</td></tr>`;
      return;
    }
    if (isGrandTotal) {
      html += `<tr>`;
      row.forEach((cell, ci) => {
        html += `<td bgcolor="#1A1A2E" style="${TD_BASE}background:#1A1A2E;color:#fff;font-weight:700;text-align:${ci === 0 ? 'left' : 'right'};">${esc(cell)}</td>`;
      });
      html += `</tr>`;
      return;
    }
    if (isRegionTotal) {
      html += `<tr>`;
      row.forEach((cell, ci) => {
        html += `<td bgcolor="#FFF0E0" style="${TD_BASE}background:#FFF0E0;font-weight:700;color:#7A4010;text-align:${ci === 0 ? 'left' : 'right'};">${esc(cell)}</td>`;
      });
      html += `</tr>`;
      return;
    }
    if (isBranchTotal) {
      html += `<tr>`;
      row.forEach((cell, ci) => {
        html += `<td bgcolor="#E8F5E9" style="${TD_BASE}background:#E8F5E9;font-weight:700;text-align:${ci === 0 ? 'left' : 'right'};">${esc(cell)}</td>`;
      });
      html += `</tr>`;
      return;
    }

    // Regular data row — alternating
    const bg = dataIdx % 2 === 0 ? '#F9F9F9' : '#FFFFFF';
    dataIdx++;
    html += `<tr>`;
    row.forEach((cell, ci) => {
      html += `<td bgcolor="${bg}" style="${TD_BASE}background:${bg};text-align:${ci === 0 ? 'left' : 'right'};">${esc(cell)}</td>`;
    });
    html += `</tr>`;
  });

  html += `</table>`;
  return html;
}

// ── Report generators (each returns { csv, html, filename }) ─────────────────

export async function genDhpHours(start, end) {
  const data    = await fetchEmployeeHours(start, end);
  const entries = {};
  const weekSet = new Set();

  for (const r of data) {
    if (isCorporate(r.branchname) || !isDHP(r.customername)) continue;
    const branch  = r.branchname   || 'Unknown';
    const company = r.customername || 'Unknown';
    const week    = r.weekendbill  || '—';
    const hrs     = Number(r.hours) || 0;
    weekSet.add(week);
    if (!entries[company]) entries[company] = { branch, weeks: {} };
    entries[company].weeks[week] = (entries[company].weeks[week] || 0) + hrs;
  }

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 2 + weeks.length + 1;
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP HOURS`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Hours'],
    Array(numCols).fill(''),
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([company, branch, ...vals.map(v => v > 0 ? v.toFixed(2) : ''), total > 0 ? total.toFixed(2) : '']);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push(['', 'TOTALS', ...weekTotals.map(v => v > 0 ? v.toFixed(2) : '-'), grandTotal > 0 ? grandTotal.toFixed(2) : '-']);

  return {
    csv:      toCSV(allRows[0], allRows.slice(1)),
    html:     buildDhpHtmlTable(allRows),
    filename: 'monthly-dhp-hours.csv',
  };
}

export async function genDhpHeadcount(start, end) {
  // Single call for the full date range — tw_customer_weekly_summary has per-week rows
  const data    = await fetchUniqueCountByCompany(start, end);
  const entries = {};
  const weekSet = new Set();

  for (const r of data) {
    if (isCorporate(r.branchname) || !isDHP(r.customername)) continue;
    const branch  = r.branchname   || 'Unknown';
    const company = r.customername || 'Unknown';
    const week    = r.weekendbill  || '—';
    const cnt     = Number(r.unique_row_count) || 0;
    weekSet.add(week);
    if (!entries[company]) entries[company] = { branch, weeks: {} };
    entries[company].weeks[week] = (entries[company].weeks[week] || 0) + cnt;
  }

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 2 + weeks.length + 1;
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP HEADCOUNT`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Headcount'],
    Array(numCols).fill(''),
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([company, branch, ...vals.map(v => v > 0 ? v : ''), total > 0 ? total : '']);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push(['', 'TOTALS', ...weekTotals.map(v => v > 0 ? v : 0), grandTotal]);

  return {
    csv:      toCSV(allRows[0], allRows.slice(1)),
    html:     buildDhpHtmlTable(allRows),
    filename: 'monthly-dhp-headcount.csv',
  };
}

export async function genDhpBilling(start, end) {
  const data    = await fetchInvoiceRegister(start, end);
  const entries = {};
  const weekSet = new Set();

  for (const r of data) {
    if (isCorporate(r.branchname) || !isDHP(r.customername)) continue;
    const branch  = r.branchname   || 'Unknown';
    const company = r.customername || 'Unknown';
    const week    = r.weekendbill  || '—';
    const amt     = Number(r.invoiceamount) || 0;
    weekSet.add(week);
    if (!entries[company]) entries[company] = { branch, weeks: {} };
    entries[company].weeks[week] = (entries[company].weeks[week] || 0) + amt;
  }

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 2 + weeks.length + 1;
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP BILLING`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Billing'],
    Array(numCols).fill(''),
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([company, branch, ...vals.map(v => v > 0 ? `$${v.toFixed(2)}` : ''), total > 0 ? `$${total.toFixed(2)}` : '']);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push([`${titleLabel} BILLING GRAND TOTAL`, 'TOTALS', ...weekTotals.map(v => `$${v.toFixed(2)}`), `$${grandTotal.toFixed(2)}`]);

  return {
    csv:      toCSV(allRows[0], allRows.slice(1)),
    html:     buildDhpHtmlTable(allRows),
    filename: 'monthly-dhp-billing.csv',
  };
}

export async function genPsaBillingMonthly(start, end) {
  const data = await fetchInvoiceRegister(start, end);

  const BRANCH_ORDER   = ['NIL', 'SCF', 'BRI 1.2', 'FVH', 'AUS 1&2', 'AUS 3', 'CAR', 'KEN 1', 'ROM', 'NOTS'];
  const branchOrderSet = new Set(BRANCH_ORDER);

  const branchData = {};
  const weekSet    = new Set();

  for (const r of data) {
    if (isCorporate(r.branchname)) continue;
    const branch  = r.branchname   || 'Unknown';
    const company = r.customername || 'Unknown';
    const week    = r.weekendbill  || '—';
    const amt     = Number(r.invoiceamount) || 0;
    weekSet.add(week);
    (branchData[branch] ??= {})[company] ??= {};
    branchData[branch][company][week] = (branchData[branch][company][week] || 0) + amt;
  }

  // Fetch branch → region mapping from Supabase
  const sb = makeSB();
  const { data: branchSettings } = await sb.from('branch_settings').select('branch, region');
  const branchRegionMap = {};
  for (const row of (branchSettings || [])) {
    if (row.branch && row.region) branchRegionMap[row.branch] = row.region;
  }

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 1 + weeks.length + 1;
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearTitle(start);

  const headers = [titleLabel, ...weekLabels, 'TOTALS'];
  const rows    = [];

  // Ordered list of branches that have data (BRANCH_ORDER first, then alphabetical extras)
  const allBranches = [
    ...BRANCH_ORDER.filter(b => branchData[b]),
    ...Object.keys(branchData).filter(b => !branchOrderSet.has(b)).sort(),
  ];

  // Group branches by region, preserving BRANCH_ORDER within each region
  const regionBranchMap = {};
  for (const branch of allBranches) {
    const region = branchRegionMap[branch] || 'Other';
    (regionBranchMap[region] ??= []).push(branch);
  }

  // Sort regions alphabetically; push "Other" to the end
  const sortedRegions = Object.keys(regionBranchMap).sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

  const grandTotals = weeks.map(() => 0);

  for (const region of sortedRegions) {
    const regionBranches = regionBranchMap[region];
    const regionTotals   = weeks.map(() => 0);

    // Region header separator row
    rows.push([`— ${region} —`, ...Array(numCols - 1).fill('')]);

    for (const branch of regionBranches) {
      const companies    = branchData[branch];
      const branchTotals = weeks.map(() => 0);

      for (const company of Object.keys(companies).sort()) {
        const vals  = weeks.map(w => companies[company][w] || 0);
        const total = vals.reduce((s, v) => s + v, 0);
        vals.forEach((v, i) => { branchTotals[i] += v; });
        rows.push([company, ...vals.map(v => v > 0 ? `$${v.toFixed(2)}` : ''), total > 0 ? `$${total.toFixed(2)}` : '']);
      }

      const branchTotal = branchTotals.reduce((s, v) => s + v, 0);
      branchTotals.forEach((v, i) => { regionTotals[i] += v; });
      rows.push([`Total ${branch}`, ...branchTotals.map(v => `$${v.toFixed(2)}`), `$${branchTotal.toFixed(2)}`]);
      rows.push(emptyRow);
    }

    // Region total row
    const regionTotal = regionTotals.reduce((s, v) => s + v, 0);
    regionTotals.forEach((v, i) => { grandTotals[i] += v; });
    rows.push([`${region.toUpperCase()} TOTAL`, ...regionTotals.map(v => `$${v.toFixed(2)}`), `$${regionTotal.toFixed(2)}`]);
    rows.push(emptyRow);
  }

  // Grand total row
  const grandTotal = grandTotals.reduce((s, v) => s + v, 0);
  rows.push(['GRAND TOTAL', ...grandTotals.map(v => `$${v.toFixed(2)}`), `$${grandTotal.toFixed(2)}`]);

  return {
    csv:      toCSV(headers, rows),
    html:     buildPsaHtmlTable(headers, rows),
    filename: 'psa-billing-monthly.csv',
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const REPORT_GENERATORS = {
  'monthly-dhp-hours':     { title: 'Monthly DHP Hours',     gen: genDhpHours },
  'monthly-dhp-headcount': { title: 'Monthly DHP Headcount', gen: genDhpHeadcount },
  'monthly-dhp-billing':   { title: 'Monthly DHP Billing',   gen: genDhpBilling },
  'psa-billing-monthly':   { title: 'PSA Billing Monthly',   gen: genPsaBillingMonthly },
};

// ── Email HTML builder ────────────────────────────────────────────────────────

export function buildEmailHtml(automationName, monthLabel, reportItems, appUrl) {
  const reportsHtml = reportItems.map(item => `
    <div style="margin-bottom:32px;">
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #EA8938;display:inline-block;">
        ${esc(item.title)}
      </div>
      ${item.error
        ? `<p style="color:#dc2626;font-size:13px;margin:0;">⚠ Failed to generate: ${esc(item.error)}</p>`
        : `<div style="overflow-x:auto;">${item.html || ''}</div>`
      }
    </div>`).join('');

  const csvList = reportItems
    .filter(i => !i.error && i.filename)
    .map(i => esc(i.filename))
    .join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);width:100%;max-width:900px;">

        <!-- Header -->
        <tr>
          <td style="background:#EA8938;padding:28px 32px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:rgba(255,255,255,0.75);text-transform:uppercase;margin-bottom:6px;">TalentLedger Reports</div>
            <div style="font-size:22px;font-weight:700;color:#fff;">${esc(automationName)}</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">${esc(monthLabel)}</div>
          </td>
        </tr>

        <!-- Report tables -->
        <tr>
          <td style="padding:28px 32px;">
            ${reportsHtml}
            ${csvList ? `<p style="margin:0 0 16px;font-size:12px;color:#888;">📎 CSV attachments: ${csvList}</p>` : ''}
            <p style="margin:0 0 16px;font-size:13px;color:#666;">To view interactive reports or change date ranges, open TalentLedger:</p>
            <a href="${appUrl}/reports.html" style="display:inline-block;background:#EA8938;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Open Reports →</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background:#f8f9fa;border-top:1px solid #f0f0f0;">
            <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">
              Automated report from TalentLedger &nbsp;·&nbsp;
              <a href="${appUrl}/report-emails.html" style="color:#EA8938;text-decoration:none;">Manage subscriptions</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
