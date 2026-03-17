// PSAStaffing API Client
// In production: calls /api/psa (Vercel serverless proxy — token stays server-side)
// In dev: calls /api/psa (Vite proxy forwards to PSAStaffing API with token)

const PROXY_BASE = '/api/psa';

async function psaFetch(endpoint, params = {}) {
  const url = new URL(PROXY_BASE, window.location.origin);
  url.searchParams.set('endpoint', endpoint);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

// ── Invoice Register ──────────────────────────────────────────────

export async function fetchInvoiceRegister(startDate, endDate) {
  const data = await psaFetch('/api/invoice_register/query', {
    start_date: startDate,
    end_date: endDate,
  });
  // Normalize API field names to consistent names used across pages
  return data.map(r => ({
    ...r,
    branchname: r.branch || r.branchname || '',
    customername: r.customer || r.customername || '',
    weekendbill: r.weekend_bill || r.weekendbill || '',
    invoiceamount: r.amount ?? r.invoiceamount ?? 0,
  }));
}

// ── Employee Hours — Aggregated Queries ───────────────────────────

export async function fetchTotalHoursByBranch(startDate, endDate) {
  return psaFetch('/api/employee_hours/total_hours_by_branch', {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function fetchTotalHoursByCompany(startDate, endDate) {
  return psaFetch('/api/employee_hours/total_hours_by_company', {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function fetchTotalBillingByBranch(startDate, endDate) {
  return psaFetch('/api/employee_hours/total_billing_by_branch', {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function fetchTotalBillingByCompany(startDate, endDate) {
  return psaFetch('/api/employee_hours/total_billing_by_company', {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function fetchUniqueCountByBranch(startDate, endDate) {
  return psaFetch('/api/employee_hours/unique_count_by_branch', {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function fetchUniqueCountByCompany(startDate, endDate) {
  return psaFetch('/api/employee_hours/unique_count_by_company', {
    start_date: startDate,
    end_date: endDate,
  });
}

// ── Helpers ───────────────────────────────────────────────────────

/** Format a number as USD currency string */
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
