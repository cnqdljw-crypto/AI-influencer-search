// Vercel Serverless Function: YouTube API 代理
// 接收 /api/yt-proxy/* 请求并转发到 Google YouTube Data API

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200)
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', '*')
      .send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  // 从 rewrite 传入的 path query 参数获取子路径
  const rawPath = req.query.path || '';
  const pathParts = Array.isArray(rawPath) ? rawPath : [rawPath];

  if (pathParts.length === 0 || !pathParts[0]) {
    res.status(400).json({ error: { message: 'Missing API path' } });
    return;
  }

  const apiPath = '/' + pathParts.join('/');
  
  // 获取原始 URL 中的 query 参数（排除 path 参数）
  const url = new URL(req.url || '', 'http://localhost');
  const searchParams = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== 'path') {
      searchParams.append(key, value);
    }
  }
  const queryString = searchParams.toString();
  
  const targetUrl = `https://www.googleapis.com/youtube${apiPath}${queryString ? '?' + queryString : ''}`;

  console.log(`[YT Proxy] ${req.url} -> ${targetUrl}`);

  try {
    const proxyRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'AIInfluSearch/1.0',
        'Accept': 'application/json',
      },
    });

    const body = await proxyRes.text();

    res.status(proxyRes.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      .send(body);
  } catch (err) {
    console.error('[YT Proxy] Error:', err.message);
    res.status(502).json({ error: { message: 'Proxy error: ' + err.message } });
  }
}
