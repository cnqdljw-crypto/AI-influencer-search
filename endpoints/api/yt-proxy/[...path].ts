// Vercel Serverless Function: YouTube API 代理
// 捕获所有 /api/yt-proxy/* 请求并转发到 Google YouTube Data API
// 使用 Web Standard API (Request/Response) 供 vite-plugin-vercel

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // 只允许 GET 请求
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 提取路径部分: /api/yt-proxy/v3/search?... → /v3/search
  const pathname = url.pathname;
  const prefix = '/api/yt-proxy';
  const apiPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

  if (!apiPath) {
    return new Response(JSON.stringify({ error: { message: 'Missing API path' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 构造目标 URL
  const targetUrl = `https://www.googleapis.com/youtube${apiPath}${url.search}`;
  console.log(`[YT Proxy] ${url.pathname}${url.search} -> ${targetUrl}`);

  try {
    const proxyRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'AIInfluSearch/1.0',
        'Accept': 'application/json',
      },
    });

    const body = await proxyRes.text();

    return new Response(body, {
      status: proxyRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err: any) {
    console.error('[YT Proxy] Error:', err.message);
    return new Response(
      JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
