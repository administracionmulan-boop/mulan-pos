/**
 * Servidor de desarrollo: sirve /frontend y expone el backend real en POST /api (simulando Apps Script).
 * Uso: node dev/server.js [puerto]   ->  http://localhost:8080
 * Los datos se guardan en dev/data.json (bórrelo para empezar de cero).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./gas-runtime');

const PORT = +process.argv[2] || +process.env.PORT || 8080;
const DATA = process.env.MULAN_DATA || path.join(__dirname, 'data.json');
const rt = createRuntime({ file: DATA });
const ROOT = path.join(__dirname, '..', 'frontend');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try { out = rt.post(body); } catch (e) { out = JSON.stringify({ ok: false, error: String(e) }); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out);
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('No encontrado'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`MULAN POS dev en http://localhost:${PORT}  (datos: ${DATA})`));
