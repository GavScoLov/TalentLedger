// Vercel Serverless Function — TempWorks hours aggregator
// Calls GET /TimeEntry/timecards once per week in the requested date range,
// paginates until all records are fetched, then returns totals grouped by
// customer + branch + weekend_date.
//
// Auth: requires TW_BEARER to have time-entry-read scope.
//       Falls back to TW_INVOICE_BEARER if TW_BEARER is not set.
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
    // Advance to first Sunday on or after start
    if (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
    const endDate = new Date(end + 'T12:00:00Z');
    while (d <= endDate) {
      sundays.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 7);
    }
    return sundays;
  }

  // ── Fetch all timecards for one week (handles pagination) ─────────────────
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

      const page = await twRes.json();
      if (!Array.isArray(page) || page.length === 0) break;
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
        // silently skip failed weeks so one bad week doesn't kill the whole range
      }
    }
    return results;
  }

  try {
    const sundays = getSundays(start_date, end_date);
    const timecards = await fetchAll(sundays);

    // ── Aggregate by customer + branch + weekend ──────────────────────────
    const byKey = {};
    for (const tc of timecards) {
      const customer   = tc.CustomerName  || tc.customerName  || '';
      const branch     = tc.BranchName    || tc.branchName    || '';
      const weekend    = tc.WeekendBill   || tc.weekendBill   || '';
      const weekStr    = weekend ? weekend.split('T')[0] : '';
      const regHrs     = Number(tc.RegularHours    || tc.regularHours    || 0);
      const otHrs      = Number(tc.OvertimeHours   || tc.overtimeHours   || 0);
      const dtHrs      = Number(tc.DoubletimeHours || tc.doubletimeHours || 0);
      const totalHrs   = regHrs + otHrs + dtHrs;

      const key = `${customer}||${branch}||${weekStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          customer_name:   customer,
          branch_name:     branch,
          weekend_date:    weekStr,
          regular_hours:   0,
          overtime_hours:  0,
          total_hours:     0,
          headcount:       0,
        };
      }
      byKey[key].regular_hours  += regHrs;
      byKey[key].overtime_hours += otHrs;
      byKey[key].total_hours    += totalHrs;
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
