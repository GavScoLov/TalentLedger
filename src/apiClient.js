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

// ── Hours Aggregations — from Supabase tw_ tables ─────────────────────────
// tw_customer_weekly_summary has total_hours per customer per week, but no
// branch field.  We infer branch by matching customer+week against the invoice
// register (which does carry branchname).

export async function fetchTotalHoursByCompany(startDate, endDate) {
  const [{ data: hoursData }, invoices] = await Promise.all([
    supabase
      .from('tw_customer_weekly_summary')
      .select('customer_name, weekend_date, total_hours, total_regular, total_overtime, headcount')
      .gte('weekend_date', startDate)
      .lte('weekend_date', endDate),
    fetchTWInvoices(startDate, endDate),
  ]);

  // Build branch lookup: customer+week → branch (exact match)
  // and customer → branch (fallback — most-recently-seen branch)
  const branchByWeek     = {};
  const branchByCustomer = {};
  for (const r of invoices) {
    if (r.customername && r.branchname) {
      branchByWeek[`${r.customername}||${r.weekendbill}`] = r.branchname;
      if (!branchByCustomer[r.customername]) branchByCustomer[r.customername] = r.branchname;
    }
  }

  return (hoursData || []).map(r => ({
    company_name: r.customer_name,
    total_hours:  r.total_hours  || 0,
    branch:       branchByWeek[`${r.customer_name}||${r.weekend_date}`]
                  || branchByCustomer[r.customer_name]
                  || '',
    weekend_bill: r.weekend_date,
  }));
}

export async function fetchTotalHoursByBranch(startDate, endDate) {
  const { data } = await supabase
    .from('tw_branch_weekly_summary')
    .select('branch_name, weekend_date, total_hours, headcount')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  return (data || []).map(r => ({
    branch:       r.branch_name,
    total_hours:  r.total_hours || 0,
    weekend_bill: r.weekend_date,
  }));
}

export async function fetchUniqueCountByBranch(startDate, endDate) {
  const { data } = await supabase
    .from('tw_branch_weekly_summary')
    .select('branch_name, weekend_date, headcount')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  return (data || []).map(r => ({
    branch:       r.branch_name,
    unique_count: r.headcount || 0,
    weekend_bill: r.weekend_date,
  }));
}

export async function fetchUniqueCountByCompany(startDate, endDate) {
  const { data } = await supabase
    .from('tw_customer_weekly_summary')
    .select('customer_name, weekend_date, headcount')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  return (data || []).map(r => ({
    company_name: r.customer_name,
    unique_count: r.headcount || 0,
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
