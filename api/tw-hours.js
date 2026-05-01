// Vercel Serverless Function — TempWorks Employee Hours aggregator
//
// Uses the "Employee Hours" data export (same mechanism as tw-invoice.js).
// Requires TW_INVOICE_BEARER with report-read scope — no extra credentials needed.
//
// Export:      9d512845-b636-4803-a8d7-ed0fe3f74987  ("Employee Hours")
// StartDate:   4ed208df-7358-4112-a2f1-ef5c93a82f9d
// EndDate:     ea279903-dc79-409d-941b-8a2883de5b54
//
// Export row fields (PascalCase):
//   WeekendBill, BranchName, BranchID, CustomerId, CustomerName,
//   RHours, OHours, DHours, THours, TotalBill, AIdent (assignment ID), EmpName, ...
//
// Response: JSON array of { customer_name, branch_name, weekend_date,
//   regular_hours, overtime_hours, total_hours, headcount }
//   aggregated by customer + branch + weekend_date.
//
// Usage: GET /api/tw-hours?start_date=2026-01-01&end_date=2026-03-31

const EXPORT_ID   = '9d512845-b636-4803-a8d7-ed0fe3f74987';
const START_PARAM = '4ed208df-7358-4112-a2f1-ef5c93a82f9d';
const END_PARAM   = 'ea279903-dc79-409d-941b-8a2883de5b54';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bearer = process.env.TW_INVOICE_BEARER;
  if (!bearer) {
    return res.status(500).json({ error: 'TW_INVOICE_BEARER not configured' });
  }

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  try {
    const twRes = await fetch(
      `https://api.ontempworks.com/utilities/dataExport/exports/${EXPORT_ID}`,
      {
        method: 'POST',
        headers: {
          'accept':        'text/plain',
          'x-tw-token':    bearer,
          'Content-Type':  'application/vnd.textus+jsonld',
        },
        body: JSON.stringify({
          parameters: [
            { exportParameterId: START_PARAM, value: start_date },
            { exportParameterId: END_PARAM,   value: end_date   },
          ],
        }),
      }
    );

    if (!twRes.ok) {
      const msg = await twRes.text().catch(() => '');
      throw new Error(`TW Hours export HTTP ${twRes.status}: ${msg}`);
    }

    const rows = JSON.parse(await twRes.text());

    // Aggregate by customer + branch + weekend date.
    // Use a Set for AIdent (assignment ID) to count unique workers per group.
    const byKey = {};
    for (const r of rows) {
      const customer = r.CustomerName || '';
      const branch   = r.BranchName   || '';
      // WeekendBill comes back as "2026-03-22T00:00:00"
      const weekStr  = (r.WeekendBill || r.WeekendDate || '').split('T')[0];
      const regHrs   = Number(r.RHours || 0);
      const otHrs    = Number(r.OHours || 0);
      const dtHrs    = Number(r.DHours || 0);

      const key = `${customer}||${branch}||${weekStr}`;
      if (!byKey[key]) {
        byKey[key] = {
          customer_name:  customer,
          branch_name:    branch,
          weekend_date:   weekStr,
          regular_hours:  0,
          overtime_hours: 0,
          total_hours:    0,
          _workers:       new Set(),
        };
      }
      byKey[key].regular_hours  += regHrs;
      byKey[key].overtime_hours += otHrs;
      byKey[key].total_hours    += regHrs + otHrs + dtHrs;
      if (r.AIdent) byKey[key]._workers.add(r.AIdent);
    }

    const data = Object.values(byKey).map(({ _workers, ...rest }) => ({
      ...rest,
      headcount: _workers.size,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('TW hours proxy error:', err);
    return res.status(502).json({ error: err.message });
  }
}
