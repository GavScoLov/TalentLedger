// Server-side PSA data fetcher + report CSV generators
// Mirrors the logic in reports.html but runs in Node.js / Vercel serverless.
// Used by api/cron/send-reports.js and api/send-report-now.js

const PSA_BASE = 'https://api.psastaffing.com';

async function psaFetch(endpoint, params = {}) {
  const url = new URL(`${PSA_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const token = process.env.PSA_API_TOKEN;
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`PSA API ${endpoint} → HTTP ${res.status}`);
  return res.json();
}

// ── Field normalisers ─────────────────────────────────────────────────────────

function normInvoice(r) {
  return {
    branchname:    r.branch      || r.branchname    || '',
    customername:  r.customer    || r.customername  || '',
    weekendbill:   r.weekend_bill || r.weekendbill  || '',
    invoiceamount: r.amount      ?? r.invoiceamount ?? 0,
  };
}
function normHours(r) {
  return {
    branchname:   r.branch       || r.branchname   || '',
    customername: r.company_name || r.customername || '',
    weekendbill:  r.weekend_bill || r.weekendbill  || '',
    hours:        r.total_hours  ?? r.hours        ?? 0,
  };
}
function normHead(r) {
  return {
    branchname:       r.branch       || r.branchname   || '',
    customername:     r.company_name || r.customername || '',
    weekendbill:      r.weekend_bill || r.weekendbill  || '',
    unique_row_count: r.unique_row_count ?? 0,
  };
}

// ── PSA fetch helpers ─────────────────────────────────────────────────────────

export async function fetchInvoiceRegister(start, end) {
  const data = await psaFetch('/api/invoice_register/query', { start_date: start, end_date: end });
  return data.map(normInvoice);
}
export async function fetchEmployeeHours(start, end) {
  const data = await psaFetch('/api/employee_hours/total_hours_by_company', { start_date: start, end_date: end });
  return data.map(normHours);
}
export async function fetchUniqueCountByCompany(start, end) {
  const data = await psaFetch('/api/employee_hours/unique_count_by_company', { start_date: start, end_date: end });
  return data.map(normHead);
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

// ── Week date-range label helpers ─────────────────────────────────────────────

/** "2026-04-05" → "3/30-4/5"  (6 days back through the weekend-end date) */
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

// ── Report CSV generators ─────────────────────────────────────────────────────

export async function genDhpHoursCSV(start, end) {
  const data    = await fetchEmployeeHours(start, end);
  const entries = {};   // company → { branch, weeks: { weekEnd: hrs } }
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
  const numCols    = 2 + weeks.length + 1;       // Company, Branch, ...weeks, Total
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP HOURS`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Hours'],
    emptyRow,
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([
      company, branch,
      ...vals.map(v => v > 0 ? v.toFixed(2) : ''),
      total > 0 ? total.toFixed(2) : '',
    ]);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push([
    '', 'TOTALS',
    ...weekTotals.map(v => v > 0 ? v.toFixed(2) : '-'),
    grandTotal > 0 ? grandTotal.toFixed(2) : '-',
  ]);

  return { csv: toCSV(allRows[0], allRows.slice(1)), filename: 'monthly-dhp-hours.csv' };
}

export async function genDhpHeadcountCSV(start, end) {
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
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP HEADCOUNT`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Headcount'],
    emptyRow,
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([
      company, branch,
      ...vals.map(v => v > 0 ? v : ''),
      total > 0 ? total : '',
    ]);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push([
    '', 'TOTALS',
    ...weekTotals.map(v => v > 0 ? v : 0),
    grandTotal,
  ]);

  return { csv: toCSV(allRows[0], allRows.slice(1)), filename: 'monthly-dhp-headcount.csv' };
}

export async function genDhpBillingCSV(start, end) {
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
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearUpper(start);

  const allRows = [
    [`${titleLabel} DHP BILLING`, ...Array(numCols - 1).fill('')],
    ['Company', 'Branch', ...weekLabels, 'Total DHP Billing'],
    emptyRow,
  ];

  const weekTotals = weeks.map(() => 0);
  for (const company of Object.keys(entries).sort()) {
    const { branch, weeks: wData } = entries[company];
    const vals  = weeks.map(w => wData[w] || 0);
    const total = vals.reduce((s, v) => s + v, 0);
    vals.forEach((v, i) => { weekTotals[i] += v; });
    allRows.push([
      company, branch,
      ...vals.map(v => v > 0 ? `$${v.toFixed(2)}` : ''),
      total > 0 ? `$${total.toFixed(2)}` : '',
    ]);
  }

  const grandTotal = weekTotals.reduce((s, v) => s + v, 0);
  allRows.push([
    `${titleLabel} BILLING GRAND TOTAL`, 'TOTALS',
    ...weekTotals.map(v => `$${v.toFixed(2)}`),
    `$${grandTotal.toFixed(2)}`,
  ]);

  return { csv: toCSV(allRows[0], allRows.slice(1)), filename: 'monthly-dhp-billing.csv' };
}

export async function genPsaBillingMonthlyCSV(start, end) {
  const data = await fetchInvoiceRegister(start, end);

  // Branches in the order they should appear in the report
  const BRANCH_ORDER  = ['NIL', 'SCF', 'BRI 1.2', 'FVH', 'AUS 1&2', 'AUS 3', 'CAR', 'KEN 1', 'ROM', 'NOTS'];
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

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 1 + weeks.length + 1;       // Company, ...weeks, TOTALS
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearTitle(start);      // "April 2026"

  const headers = [titleLabel, ...weekLabels, 'TOTALS'];
  const rows    = [];

  // Branches in defined order, then any extras not in the list
  const allBranches = [
    ...BRANCH_ORDER.filter(b => branchData[b]),
    ...Object.keys(branchData).filter(b => !branchOrderSet.has(b)).sort(),
  ];

  for (const branch of allBranches) {
    const companies    = branchData[branch];
    const branchTotals = weeks.map(() => 0);

    for (const company of Object.keys(companies).sort()) {
      const vals  = weeks.map(w => companies[company][w] || 0);
      const total = vals.reduce((s, v) => s + v, 0);
      vals.forEach((v, i) => { branchTotals[i] += v; });
      rows.push([company, ...vals.map(v => `$${v.toFixed(2)}`), `$${total.toFixed(2)}`]);
    }

    const branchTotal = branchTotals.reduce((s, v) => s + v, 0);
    rows.push([`Total ${branch}`, ...branchTotals.map(v => `$${v.toFixed(2)}`), `$${branchTotal.toFixed(2)}`]);
    rows.push(emptyRow);
  }

  return { csv: toCSV(headers, rows), filename: 'psa-billing-monthly.csv' };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const REPORT_GENERATORS = {
  'monthly-dhp-hours':     { title: 'Monthly DHP Hours',     gen: genDhpHoursCSV },
  'monthly-dhp-headcount': { title: 'Monthly DHP Headcount', gen: genDhpHeadcountCSV },
  'monthly-dhp-billing':   { title: 'Monthly DHP Billing',   gen: genDhpBillingCSV },
  'psa-billing-monthly':   { title: 'PSA Billing Monthly',   gen: genPsaBillingMonthlyCSV },
};

// ── Email HTML builder ────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildEmailHtml(automationName, monthLabel, reportItems, appUrl) {
  const itemsHtml = reportItems.map(item => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;">
        <strong style="color:#1a1a2e;">${escHtml(item.title)}</strong>
        ${item.error
          ? `<span style="color:#dc2626;font-size:13px;margin-left:8px;">⚠ ${escHtml(item.error)}</span>`
          : `<span style="color:#16a34a;font-size:13px;margin-left:8px;">✓ ${escHtml(item.filename)} attached</span>`}
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#EA8938;padding:28px 32px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:rgba(255,255,255,0.75);text-transform:uppercase;margin-bottom:6px;">TalentLedger Reports</div>
            <div style="font-size:22px;font-weight:700;color:#fff;">${escHtml(automationName)}</div>
            <div style="font-size:14px;color:rgba(255,255,255,0.85);margin-top:4px;">${escHtml(monthLabel)}</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#444;">Your scheduled reports are ready. CSV files are attached to this email.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f8f9fa;">
                <td style="padding:8px 16px;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Reports included</td>
              </tr>
              ${itemsHtml}
            </table>
            <p style="margin:0 0 16px;font-size:13px;color:#666;">To view interactive reports, export PDFs, or change date ranges, open TalentLedger:</p>
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
