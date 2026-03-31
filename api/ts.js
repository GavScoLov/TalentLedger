// Vercel Serverless Function — proxies requests to TimeStation API v1.2
// Injects Basic Auth (API key) server-side so the key is never exposed to the browser.
// Usage: /api/ts?endpoint=/shifts&start_date=2026-03-30&end_date=2026-04-05

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.TIMESTATION_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TIMESTATION_API_KEY not configured' });
  }

  const { endpoint, ...params } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // Whitelist allowed endpoints to prevent open proxy abuse
  const allowedEndpoints = ['/shifts'];
  if (!allowedEndpoints.includes(endpoint)) {
    return res.status(403).json({ error: 'Endpoint not allowed' });
  }

  try {
    const url = new URL(`https://api.mytimestation.com/v1.2${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const encoded = Buffer.from(apiKey + ':').toString('base64');

    const apiRes = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${encoded}`,
        'Accept': 'application/json',
      },
    });

    const data = await apiRes.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store'); // timesheets should always be fresh

    return res.status(apiRes.status).json(data);
  } catch (err) {
    console.error('TimeStation proxy error:', err);
    return res.status(502).json({ error: 'Failed to reach TimeStation API', detail: err.message });
  }
}
