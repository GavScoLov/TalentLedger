// Vercel Serverless Function — TempWorks hours aggregator
// Calls GET /TimeEntry/timecards once per week in the requested date range,
// paginates until all records are fetched, then returns totals grouped by
// customer + branch + weekend_date.
//
// Auth: TW_BEARER env var (falls back to TW_INVOICE_BEARER).
//       The account must have time-entry-read scope AND be assigned to
//       the appropriate TempWorks branches in TempWorks admin.
//
// Response shape: { data: [...], totalCount: N }  (TW REST pagination envelope)
// Timecard fields (camelCase): regularHours, overtimeHours, doubletimeHours,
//   customerName, branchName, weekendDate, employeeName, payRate, billRate
//
// Usage: GET /api/tw-hours?start_date=2026-01-01&end_date=2026-03-31

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bearer = process.env.TW_BEARER || process.env.TW_INVOICE_BEARER;
  if (!bearer) {
    return res.status(500).json({ error: 'TW_BEARER not configured' });
  }

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  // ── Build list of week-end Sundays in range ──────────────────────────────
  function getSundays(start, end) {
    const sundays = [];
    const d = new Date(start + 'T12:00:00Z');
    if (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
    const endDate = new Date(end + 'T12:00:00Z');
    while (d <= endDate) {
      sundays.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return sundays;
  }

  // ── Fetch all timecards for one week (handles TW pagination envelope) ─────
  // TW returns { data: [...], totalCount: N } — not a raw array.
  async function fetchWeek(weekendBill) {
    const records = [];
    let skip = 0;
    const take = 1000;

    while (true) {
      const url = `https://api.ontempworks.com/TimeEntry/timecards?weekendBill=${weekendBill}&skip=${skip}&take=${take}`;
      const twRes = await fetch(url, {
        headers: { 'x-tw-token': bearer, 'Accept': 'application/json' },
      });

      if (!twRes.ok) {
        const msg = await twRes.text().catch(() => '');
        throw new Error(`TW timecards HTTP ${twRes.status} (week ${weekendBill}): ${msg}`);
      }

      const envelope = await twRes.json();

      // Handle both raw array (legacy) and pagination envelope
      const page = Array.isArray(envelope) ? envelope : (envelope.data || []);
      if (page.length === 0) break;

      records.push(...page);
      if (page.length < take) break;
      skip += take;
    }

    return records;
  }

  // ── Run week fetches with limited concurrency (5 at a time) ──────────────
  async function fetchAll(sundays) {
    const results = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < sundays.length; i += CONCURRENCY) {
      const batch = sundays.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map(s => fetchWeek(s)));
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(...r.value);
        // silently skip failed weeks — one bad week doesn't kill the whole range
      }
    }
    return results;
  }

  try {
    const sundays = getSundays(start_date, end_date);
    const timecards = await fetchAll(sundays);

    // ── Aggregate by customer + branch + weekend_date ─────────────────────
    // Field names from TW REST schema are camelCase.
    const byKey = {};
    for (const tc of timecards) {
      const customer = tc.customerName || '';
      const branch   = tc.branchName   || '';
      // weekendDate comes back as a datetime string e.g. "2026-01-04T00:00:00"
      const weekStr  = (tc.weekendDate || '').split('T')[0];
      const regHrs   = Number(tc.regularHours    || 0);
      const otHrs    = Number(tc.overtimeHours   || 0);
      const dtHrs    = Number(tc.doubletimeHours || 0);

      const key = `${customer}||${branch}||${weekStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          customer_name:  customer,
          branch_name:    branch,
          weekend_date:   weekStr,
          regular_hours:  0,
          overtime_hours: 0,
          total_hours:    0,
          headcount:      0,
        };
      }
      byKey[key].regular_hours  += regHrs;
      byKey[key].overtime_hours += otHrs;
      byKey[key].total_hours    += regHrs + otHrs + dtHrs;
      byKey[key].headcount      += 1;
    }

    const data = Object.values(byKey);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('TW hours proxy error:', err);
    return res.status(502).json({ error: err.message });
  }
}
