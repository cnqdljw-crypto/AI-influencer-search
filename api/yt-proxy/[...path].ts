import type { VercelRequest, VercelResponse } from '@vercel/node';

// Vercel Serverless Function: YouTube API 代理
// 捕获所有 /api/yt-proxy/* 请求并转发到 Google YouTube Data API

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只允许 GET 请求
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const path = req.query.path as string[];
  const searchParams = req.url?.split('?')[1] || '';

  if (!path || path.length === 0) {
    res.status(400).json({ error: { message: 'Missing API path' } });
    return;
  }

  // 构造目标 URL: /v3/search?key=xxx&... → https://www.googleapis.com/youtube/v3/search?key=xxx&...
  const apiPath = '/' + path.join('/');
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
  } catch (err: any) {
    console.error('[YT Proxy] Error:', err.message);
    res.status(502).json({ error: { message: 'Proxy error: ' + err.message } });
  }
}
