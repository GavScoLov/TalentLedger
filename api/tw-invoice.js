// Vercel Serverless Function — proxies TempWorks Invoice Register data export
// Credentials stay server-side; never exposed to the browser.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bearer    = process.env.TW_INVOICE_BEARER;
  const exportId  = process.env.TW_INVOICE_EXPORT_ID;
  const startId   = process.env.TW_INVOICE_START_ID;
  const endId     = process.env.TW_INVOICE_END_ID;

  if (!bearer || !exportId || !startId || !endId) {
    return res.status(500).json({ error: 'TempWorks Invoice credentials not configured' });
  }

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  try {
    const twRes = await fetch(
      `https://api.ontempworks.com/utilities/dataExport/exports/${exportId}`,
      {
        method: 'POST',
        headers: {
          'accept': 'text/plain',
          'x-tw-token': bearer,
          'Content-Type': 'application/vnd.textus+jsonld',
        },
        body: JSON.stringify({
          parameters: [
            { exportParameterId: startId, value: start_date },
            { exportParameterId: endId,   value: end_date   },
          ],
        }),
      }
    );

    if (!twRes.ok) {
      const msg = await twRes.text().catch(() => '');
      return res.status(twRes.status).json({ error: `TempWorks API ${twRes.status}: ${msg}` });
    }

    const text = await twRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Unexpected response format from TempWorks' });
    }

    if (!Array.isArray(data)) {
      return res.status(502).json({ error: 'Expected array from TempWorks export' });
    }

    // Strip internal grouping fields and normalise
    const clean = data.map(r => ({
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

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(clean);
  } catch (err) {
    console.error('TempWorks invoice proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach TempWorks API' });
  }
}
