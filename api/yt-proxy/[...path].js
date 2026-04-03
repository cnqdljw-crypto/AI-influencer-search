// Vercel Serverless Function: YouTube API 代理
// 捕获所有 /api/yt-proxy/* 请求并转发到 Google YouTube Data API

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 只允许 GET 和 OPTIONS 请求
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

  // 获取路径参数 - 支持多种格式
  let pathParts = [];

  if (req.query.path) {
    pathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
  } else if (req.query['...path']) {
    const raw = req.query['...path'];
    pathParts = raw.split('/');
  } else {
    // 兜底: 从 URL 路径解析
    const urlPath = (req.url || '').split('?')[0] || '';
    const match = urlPath.match(/\/api\/yt-proxy\/(.+)/);
    if (match) {
      pathParts = match[1].split('/');
    }
  }

  if (pathParts.length === 0) {
    res.status(400).json({ error: { message: 'Missing API path' } });
    return;
  }

  const searchParams = (req.url || '').split('?')[1] || '';
  const apiPath = '/' + pathParts.join('/');
  const targetUrl = `https://www.googleapis.com/youtube${apiPath}${searchParams ? '?' + searchParams : ''}`;

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
