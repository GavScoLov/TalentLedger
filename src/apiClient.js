// Data client — reads from pre-aggregated Supabase tables populated by n8n.
// No live PSA API calls from the browser.

import { supabase } from './supabaseClient.js';

// ── Invoice / Billing ──────────────────────────────────────────────

export async function fetchInvoiceRegister(startDate, endDate) {
  const { data, error } = await supabase
    .from('psa_billing_weekly')
    .select('*')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    branchname:    r.branch_name,
    customername:  r.customer_name,
    weekendbill:   r.weekend_date,
    invoiceamount: r.invoice_amount,
  }));
}

// ── Employee Hours ─────────────────────────────────────────────────

export async function fetchEmployeeHours(startDate, endDate) {
  const { data, error } = await supabase
    .from('psa_hours_weekly')
    .select('*')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    branchname:   r.branch_name,
    customername: r.customer_name,
    weekendbill:  r.weekend_date,
    hours:        r.total_hours,
  }));
}

// ── Headcount ──────────────────────────────────────────────────────

export async function fetchUniqueCountByCompany(startDate, endDate) {
  const { data, error } = await supabase
    .from('psa_headcount_weekly')
    .select('*')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    branchname:       r.branch_name,
    customername:     r.customer_name,
    weekendbill:      r.weekend_date,
    unique_row_count: r.headcount,
  }));
}

export async function fetchUniqueCountByBranch(startDate, endDate) {
  const { data, error } = await supabase
    .from('psa_headcount_branch_weekly')
    .select('*')
    .gte('weekend_date', startDate)
    .lte('weekend_date', endDate);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    branchname:       r.branch_name,
    weekendbill:      r.weekend_date,
    unique_row_count: r.headcount,
  }));
}

// ── Unused legacy wrappers (kept for compatibility) ────────────────

export async function fetchTotalHoursByBranch(startDate, endDate) {
  return fetchEmployeeHours(startDate, endDate);
}
export async function fetchTotalHoursByCompany(startDate, endDate) {
  return fetchEmployeeHours(startDate, endDate);
}
export async function fetchTotalBillingByBranch(startDate, endDate) {
  return fetchInvoiceRegister(startDate, endDate);
}
export async function fetchTotalBillingByCompany(startDate, endDate) {
  return fetchInvoiceRegister(startDate, endDate);
}

// ── Helpers ────────────────────────────────────────────────────────

export function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

export function formatCurrency2(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(n, decimals = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

export function getLatestAvailableSunday() {
  const now = new Date();
  const day = now.getDay();
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - day);
  if (day !== 0 && day !== 5 && day !== 6) {
    lastSunday.setDate(lastSunday.getDate() - 7);
  }
  return lastSunday.toISOString().split('T')[0];
}

export function getDefaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

export function getDefaultEndDate() {
  return getLatestAvailableSunday();
}
