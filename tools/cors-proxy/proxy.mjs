// Dev-only: forwards to a SigNoz and adds CORS headers so the app's web build (browser) can talk to it.
// Native builds don't need this. Usage: node tools/cors-proxy/proxy.mjs [listenPort=8082] [target=http://localhost:8080]
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const PORT = Number(process.argv[2] ?? 8082);
const target = new URL(process.argv[3] ?? 'http://localhost:8080');
// Forward over the target's own protocol: an https target must stay on TLS, or the API key would travel in clear text.
const request = target.protocol === 'https:' ? httpsRequest : httpRequest;

createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const up = request({ host: target.hostname, port: target.port || undefined, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
    r.pipe(res);
  });
  up.on('error', (e) => res.writeHead(502, cors).end(String(e)));
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => console.log(`cors proxy 127.0.0.1:${PORT} -> ${target.origin}`));
