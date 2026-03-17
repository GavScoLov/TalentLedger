// Vercel Serverless Function — proxies requests to PSAStaffing API
// Keeps the bearer token server-side (never exposed to the browser)

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.PSA_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'PSA_API_TOKEN not configured' });
  }

  const { endpoint, ...params } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // Whitelist allowed endpoints to prevent open proxy abuse
  const allowedEndpoints = [
    '/api/invoice_register/query',
    '/api/employee_hours/total_hours_by_branch',
    '/api/employee_hours/total_hours_by_company',
    '/api/employee_hours/total_billing_by_branch',
    '/api/employee_hours/total_billing_by_company',
    '/api/employee_hours/unique_count_by_branch',
    '/api/employee_hours/unique_count_by_company',
  ];

  if (!allowedEndpoints.includes(endpoint)) {
    return res.status(403).json({ error: 'Endpoint not allowed' });
  }

  try {
    const url = new URL(`https://api.psastaffing.com${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const apiRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const data = await apiRes.json();

    // Set CORS headers for the frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    return res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('PSA proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach PSAStaffing API' });
  }
}
