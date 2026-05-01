// Vercel Serverless Function — General TempWorks REST API proxy
// Keeps the bearer token server-side; never exposed to the browser.
//
// Usage:  GET /api/tw?endpoint=/Customers/12345/invoices&HideBalancedInvoices=true
//         GET /api/tw?endpoint=/Customers/12345/contacts
//         GET /api/tw?endpoint=/Branches
//
// The `endpoint` query param is required and must start with /.
// All other query params are forwarded to TempWorks verbatim.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Prefer a dedicated TW_BEARER env var; fall back to the invoice bearer
  const bearer = process.env.TW_BEARER || process.env.TW_INVOICE_BEARER;
  if (!bearer) {
    return res.status(500).json({ error: 'TempWorks credentials not configured (TW_BEARER)' });
  }

  const { endpoint, ...params } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // Whitelist allowed endpoint prefixes (add more as needed)
  const allowedPrefixes = [
    '/Customers',
    '/Contacts',
    '/Branches',
    '/TimeEntry',
    '/Employees',
    '/Assignments',
    '/DataLists',
    '/Search',
  ];

  const allowed = allowedPrefixes.some(prefix =>
    endpoint.startsWith(prefix) || endpoint.startsWith(prefix.toLowerCase())
  );
  if (!allowed) {
    return res.status(403).json({ error: `Endpoint not allowed: ${endpoint}` });
  }

  try {
    const url = new URL(`https://api.ontempworks.com${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });

    const twRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-tw-token': bearer,
        'Accept': 'application/json',
      },
    });

    const text = await twRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Return raw text if it's not JSON (shouldn't happen for REST endpoints)
      return res.status(twRes.status).send(text);
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(twRes.status).json(data);
  } catch (err) {
    console.error('TempWorks REST proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach TempWorks API' });
  }
}
