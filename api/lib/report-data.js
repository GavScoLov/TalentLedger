// Server-side PSA data fetcher + report CSV + PDF generators
// Mirrors the logic in reports.html but runs in Node.js / Vercel serverless.
// Used by api/cron/send-reports.js and api/send-report-now.js

import { createRequire } from 'module';
// pdfkit is loaded lazily so a missing bundle never crashes the whole module
const _req = createRequire(import.meta.url);
let _PDFDocument = null;
function getPDFDocument() {
  if (_PDFDocument) return _PDFDocument;
  try {
    _PDFDocument = _req('pdfkit');
  } catch (e) {
    console.error('[report-data] pdfkit unavailable — PDFs will be skipped:', e.message);
  }
  return _PDFDocument;
}

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

// ── PDF helpers (pdfkit) ──────────────────────────────────────────────────────

const C_BRAND  = '#EA8938';
const C_DARK   = '#1A1A2E';
const C_YELLOW = '#FFF9C4';
const C_GREEN  = '#E8F5E9';
const C_ALT    = '#F9F9F9';
const C_BORDER = '#CCCCCC';
const ROW_H    = 17;

/** Hex colour → [r, g, b] 0-255 */
function hexRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

/**
 * Draw one table row onto a pdfkit doc.
 * Returns the new y position (y + h).
 */
function drawRow(doc, cells, x, y, colWidths, h, bg, fg, bold) {
  const totalW = colWidths.reduce((s, w) => s + w, 0);
  doc.save();
  doc.fillColor(hexRgb(bg)).rect(x, y, totalW, h).fill();
  doc.strokeColor(hexRgb(C_BORDER)).lineWidth(0.4).rect(x, y, totalW, h).stroke();
  let cx = x;
  for (let i = 0; i < cells.length; i++) {
    const w  = colWidths[i];
    const al = i === 0 ? 'left' : 'right';
    doc.fillColor(hexRgb(fg))
       .font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .fontSize(8)
       .text(String(cells[i] ?? ''), cx + 3, y + Math.round((h - 8) / 2), {
         width: w - 6, align: al, lineBreak: false,
       });
    cx += w;
  }
  doc.restore();
  return y + h;
}

/**
 * Draw a full report table (title bar + header + data + optional totals row).
 * Handles page breaks and re-draws the header row on each new page.
 */
function drawTable(doc, { title, headerRow, dataRows, totalsRow, colWidths }) {
  const left  = 30;
  let   y     = doc.y ?? 30;

  const checkBreak = () => {
    if (y + ROW_H > doc.page.height - 40) {
      doc.addPage();
      y = 30;
      y = drawRow(doc, headerRow, left, y, colWidths, ROW_H, C_DARK, '#FFFFFF', true);
    }
  };

  // Optional title bar
  if (title) {
    const totalW = colWidths.reduce((s, w) => s + w, 0);
    doc.save();
    doc.fillColor(hexRgb(C_BRAND)).rect(left, y, totalW, 24).fill();
    doc.fillColor(hexRgb('#FFFFFF')).font('Helvetica-Bold').fontSize(12)
       .text(title, left + 8, y + 5, { width: totalW - 16, lineBreak: false });
    doc.restore();
    y += 24 + 4;
  }

  // Column header row
  y = drawRow(doc, headerRow, left, y, colWidths, ROW_H, C_DARK, '#FFFFFF', true);

  // Data rows
  dataRows.forEach((row, ri) => {
    const isBlank      = row.every(c => c === '' || c == null);
    const first        = String(row[0] ?? '');
    const isBranchTot  = first.startsWith('Total ');

    if (isBlank) { y += 5; return; }
    checkBreak();

    const bg   = isBranchTot ? C_GREEN : (ri % 2 === 1 ? C_ALT : '#FFFFFF');
    y = drawRow(doc, row, left, y, colWidths, ROW_H, bg, '#000000', isBranchTot);
  });

  // Grand totals row (DHP only)
  if (totalsRow) {
    checkBreak();
    y = drawRow(doc, totalsRow, left, y, colWidths, ROW_H, C_YELLOW, '#000000', true);
  }

  doc.y = y;
}

/** Calculate column widths given total usable width and column count breakdown. */
function dhpColWidths(numCols, usableW) {
  const weekCount = numCols - 3;           // Company, Branch, ...weeks, Total
  const compW  = 180, branchW = 42, totW = 68;
  const avail  = usableW - compW - branchW - totW;
  const weekW  = Math.max(48, avail / weekCount);
  return [compW, branchW, ...Array(weekCount).fill(weekW), totW];
}

function psaColWidths(numCols, usableW) {
  const weekCount = numCols - 2;           // Company, ...weeks, Total
  const compW = 200, totW = 70;
  const weekW = Math.max(48, (usableW - compW - totW) / weekCount);
  return [compW, ...Array(weekCount).fill(weekW), totW];
}

/** Wrap pdfkit document stream into a Buffer promise, or null if pdfkit unavailable */
function renderPdf(builderFn) {
  const PDFDocument = getPDFDocument();
  if (!PDFDocument) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    try {
      const doc    = new PDFDocument({ layout: 'landscape', size: 'LETTER', margin: 30, autoFirstPage: true });
      const chunks = [];
      doc.on('data',  c => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      builderFn(doc);
      doc.end();
    } catch (e) { reject(e); }
  });
}

/**
 * Build a PDF for DHP-style reports.
 * allRows[0] = title row, [1] = header row, [2] = blank, [3…] = data, last = totals (row[1]==='TOTALS')
 */
function buildDhpPdf(allRows) {
  const numCols   = allRows[0].length;
  const title     = String(allRows[0][0]);
  const headerRow = allRows[1];
  const totalsRow = allRows.find(r => r[1] === 'TOTALS') ?? null;
  const dataRows  = allRows.slice(2).filter(r => r[1] !== 'TOTALS');
  return renderPdf(doc => {
    const usableW  = doc.page.width - 60;
    const colWidths = dhpColWidths(numCols, usableW);
    drawTable(doc, { title, headerRow, dataRows, totalsRow, colWidths });
  });
}

/**
 * Build a PDF for PSA-style reports.
 * headerRow = ["April 2026", dates…, "TOTALS"], rows = company + Total-branch + blank rows
 */
function buildPsaPdf(headerRow, rows) {
  const numCols = headerRow.length;
  return renderPdf(doc => {
    const usableW   = doc.page.width - 60;
    const colWidths = psaColWidths(numCols, usableW);
    drawTable(doc, { title: null, headerRow, dataRows: rows, totalsRow: null, colWidths });
  });
}

// ── Report generators (each returns { csv, pdf, filename, pdfFilename }) ──────

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

  const csv = toCSV(allRows[0], allRows.slice(1));
  const pdf = await buildDhpPdf(allRows).catch(() => null);
  return { csv, pdf, filename: 'monthly-dhp-hours.csv', pdfFilename: pdf ? 'monthly-dhp-hours.pdf' : null };
}

export async function genDhpHeadcount(start, end) {
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

  const csv = toCSV(allRows[0], allRows.slice(1));
  const pdf = await buildDhpPdf(allRows).catch(() => null);
  return { csv, pdf, filename: 'monthly-dhp-headcount.csv', pdfFilename: pdf ? 'monthly-dhp-headcount.pdf' : null };
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

  const csv = toCSV(allRows[0], allRows.slice(1));
  const pdf = await buildDhpPdf(allRows).catch(() => null);
  return { csv, pdf, filename: 'monthly-dhp-billing.csv', pdfFilename: pdf ? 'monthly-dhp-billing.pdf' : null };
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

  const weeks      = sortedWeeksFrom(weekSet);
  const weekLabels = weeks.map(weekRangeLabel);
  const numCols    = 1 + weeks.length + 1;
  const emptyRow   = Array(numCols).fill('');
  const titleLabel = monthYearTitle(start);

  const headers = [titleLabel, ...weekLabels, 'TOTALS'];
  const rows    = [];

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

  const csv = toCSV(headers, rows);
  const pdf = await buildPsaPdf(headers, rows).catch(() => null);
  return { csv, pdf, filename: 'psa-billing-monthly.csv', pdfFilename: pdf ? 'psa-billing-monthly.pdf' : null };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const REPORT_GENERATORS = {
  'monthly-dhp-hours':     { title: 'Monthly DHP Hours',     gen: genDhpHours },
  'monthly-dhp-headcount': { title: 'Monthly DHP Headcount', gen: genDhpHeadcount },
  'monthly-dhp-billing':   { title: 'Monthly DHP Billing',   gen: genDhpBilling },
  'psa-billing-monthly':   { title: 'PSA Billing Monthly',   gen: genPsaBillingMonthly },
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
          : `<span style="color:#16a34a;font-size:13px;margin-left:8px;">
               ✓ ${escHtml(item.filename)}
               ${item.pdfFilename ? `&nbsp;·&nbsp;${escHtml(item.pdfFilename)}` : ''}
               attached
             </span>`}
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
            <p style="margin:0 0 16px;font-size:15px;color:#444;">Your scheduled reports are ready. CSV and PDF files are attached to this email.</p>
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
