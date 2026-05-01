// TalentLedger Data Client — TempWorks Edition
//
// Invoice / billing data  → TempWorks Invoice Register export  (/api/tw-invoice)
// Hours / headcount data  → Supabase tw_* tables (synced hourly by n8n from TempWorks)
//
// All exported functions maintain the same signatures and return shapes as the
// former PSA-based implementation so that existing page code requires no changes.

import { supabase } from './supabaseClient.js';

// ── Internal: TW Invoice Cache ─────────────────────────────────────────────
// The invoice export is fetched once per (startDate, endDate) pair and shared
// across all aggregation helpers so we never hit the API twice for one render.

let _invoiceCache = null;
let _invoiceCacheKey = null;

async function fetchTWInvoices(startDate, endDate) {
  const cacheKey = `${startDate}_${endDate}`;
  if (_invoiceCacheKey === cacheKey && _invoiceCache) return _invoiceCache;

  const res = await fetch(`/api/tw-invoice?start_date=${startDate}&end_date=${endDate}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `TW Invoice API error ${res.status}`);
  }
  _invoiceCache = await res.json();
  _invoiceCacheKey = cacheKey;
  return _invoiceCache;
}

// ── Invoice Register ───────────────────────────────────────────────────────
// Returns all invoices in the date range.
// Fields: branchname, customername, weekendbill, invoiceamount,
//         payamount, balanceamount, invoicenumber, duedate, dso, pastdue

export async function fetchInvoiceRegister(startDate, endDate) {
  return fetchTWInvoices(startDate, endDate);
}

// ── Employee Hours — by company (used by commission page) ─────────────────

export async function fetchEmployeeHours(startDate, endDate) {
  const rows = await fetchTotalHoursByCompany(startDate, endDate);
  return rows.map(r => ({
    branchname:   r.branch,
    customername: r.company_name,
    weekendbill:  r.weekend_bill,
    hours:        r.total_hours,
  }));
}

// ── Billing Aggregations — derived from TW invoice data ───────────────────

export async function fetchTotalBillingByBranch(startDate, endDate) {
  const invoices = await fetchTWInvoices(startDate, endDate);
  const byKey = {};
  for (const r of invoices) {
    const key = `${r.branchname}||${r.weekendbill}`;
    if (!byKey[key]) {
      byKey[key] = { branch: r.branchname, weekend_bill: r.weekendbill, total_billing: 0 };
    }
    byKey[key].total_billing += r.invoiceamount || 0;
  }
  return Object.values(byKey);
}

export async function fetchTotalBillingByCompany(startDate, endDate) {
  const invoices = await fetchTWInvoices(startDate, endDate);
  const byKey = {};
  for (const r of invoices) {
    const key = `${r.customername}||${r.branchname}||${r.weekendbill}`;
    if (!byKey[key]) {
      byKey[key] = {
        company_name: r.customername,
        branch:       r.branchname,
        weekend_bill: r.weekendbill,
        total_billing: 0,
      };
    }
    byKey[key].total_billing += r.invoiceamount || 0;
  }
  return Object.values(byKey);
}

// ── Hours Aggregations ────────────────────────────────────────────────────
// Primary:  /api/tw-hours  (TempWorks REST — needs TW_BEARER with time-entry-read)
// Fallback: Supabase tw_customer_weekly_summary (n8n sync — may be incomplete)

let _hoursCache    = null;
let _hoursCacheKey = null;

async function fetchTWHours(startDate, endDate) {
  const cacheKey = `${startDate}_${endDate}`;
  if (_hoursCacheKey === cacheKey && _hoursCache) return _hoursCache;
  const res = await fetch(`/api/tw-hours?start_date=${startDate}&end_date=${endDate}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `TW Hours API error ${res.status}`);
  }
  _hoursCache    = await res.json();
  _hoursCacheKey = cacheKey;
  return _hoursCache;
}

async function getHoursWithBranch(startDate, endDate) {
  // Try live TW REST endpoint first
  try {
    const twData = await fetchTWHours(startDate, endDate);
    return twData.map(r => ({
      customer_name: r.customer_name,
      branch:        r.branch_name || '',
      weekend_date:  r.weekend_date,
      total_hours:   r.total_hours || 0,
      headcount:     r.headcount   || 0,
    }));
  } catch {
    // Fall back to Supabase (may be incomplete for older dates)
    const { data: sbRows } = await supabase
      .from('tw_customer_weekly_summary')
      .select('customer_name, weekend_date, total_hours, headcount')
      .gte('weekend_date', startDate)
      .lte('weekend_date', endDate);
    const invoices = await fetchTWInvoices(startDate, endDate);
    const branchByWeek = {}, branchByCustomer = {};
    for (const r of invoices) {
      if (r.customername && r.branchname) {
        branchByWeek[`${r.customername}||${r.weekendbill}`] = r.branchname;
        if (!branchByCustomer[r.customername]) branchByCustomer[r.customername] = r.branchname;
      }
    }
    return (sbRows || []).map(r => ({
      customer_name: r.customer_name,
      branch:        branchByWeek[`${r.customer_name}||${r.weekend_date}`]
                     || branchByCustomer[r.customer_name] || '',
      weekend_date:  r.weekend_date,
      total_hours:   r.total_hours || 0,
      headcount:     r.headcount   || 0,
    }));
  }
}

export async function fetchTotalHoursByCompany(startDate, endDate) {
  const rows = await getHoursWithBranch(startDate, endDate);
  return rows.map(r => ({
    company_name: r.customer_name,
    total_hours:  r.total_hours,
    branch:       r.branch,
    weekend_bill: r.weekend_date,
  }));
}

export async function fetchTotalHoursByBranch(startDate, endDate) {
  const rows = await getHoursWithBranch(startDate, endDate);
  const byKey = {};
  for (const r of rows) {
    const key = `${r.branch}||${r.weekend_date}`;
    if (!byKey[key]) byKey[key] = { branch: r.branch, weekend_bill: r.weekend_date, total_hours: 0 };
    byKey[key].total_hours += r.total_hours;
  }
  return Object.values(byKey);
}

export async function fetchUniqueCountByBranch(startDate, endDate) {
  const rows = await getHoursWithBranch(startDate, endDate);
  const byKey = {};
  for (const r of rows) {
    const key = `${r.branch}||${r.weekend_date}`;
    if (!byKey[key]) byKey[key] = { branch: r.branch, weekend_bill: r.weekend_date, unique_count: 0 };
    byKey[key].unique_count += r.headcount;
  }
  return Object.values(byKey);
}

export async function fetchUniqueCountByCompany(startDate, endDate) {
  const rows = await getHoursWithBranch(startDate, endDate);
  return rows.map(r => ({
    company_name: r.customer_name,
    unique_count: r.headcount,
    weekend_bill: r.weekend_date,
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format a number as USD currency string (no decimals) */
export function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Format a number as USD with 2 decimal places */
export function formatCurrency2(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format number with commas */
export function formatNumber(n, decimals = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Get the latest available Sunday for data (based on current day of week) */
export function getLatestAvailableSunday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - day);

  // If today is Fri/Sat/Sun (5,6,0), use last Sunday
  // Otherwise use the Sunday before last
  if (day !== 0 && day !== 5 && day !== 6) {
    lastSunday.setDate(lastSunday.getDate() - 7);
  }
  return lastSunday.toISOString().split('T')[0];
}

/** Default start date: first of last month */
export function getDefaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

/** Default end date: latest available Sunday (or today) */
export function getDefaultEndDate() {
  return getLatestAvailableSunday();
}
