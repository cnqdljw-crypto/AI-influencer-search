import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

function youtubeProxyPlugin(): PluginOption {
  return {
    name: 'youtube-proxy',
    configureServer(server) {
      // 前端请求: /api/yt-proxy/v3/search?... → Google: https://www.googleapis.com/youtube/v3/search?...
      server.middlewares.use('/api/yt-proxy', (req, res) => {
        const originalUrl = req.url || '';
        const targetUrl = 'https://www.googleapis.com/youtube' + originalUrl;

        console.log(`[YT Proxy] ${originalUrl} -> ${targetUrl}`);

        const https = require('https');
        const url = new URL(targetUrl);

        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'User-Agent': 'AIInfluSearch/1.0',
            'Accept': 'application/json',
          },
        };

        const proxyReq = https.request(options, (proxyRes: any) => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err: any) => {
          console.error('[YT Proxy] Error:', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
        });

        proxyReq.end();
      });
    },
  }
}

export default defineConfig({
  plugins: [youtubeProxyPlugin(), react()],
  server: {
    port: 5173,
  },
})
