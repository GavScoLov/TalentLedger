// Vercel Serverless Function — returns the Mapbox public token
// Keeps configuration server-side and centralised

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MAPBOX_TOKEN not configured' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  return res.status(200).json({ token });
}
