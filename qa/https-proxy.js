const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

const config = readConfig();
ensureQaDirectories(config);

const pfxPath = path.join(config.certDir, 'localhost.pfx');
if (!fs.existsSync(pfxPath)) {
  console.error(`Missing local HTTPS certificate: ${pfxPath}`);
  console.error('Run: node qa/start-local-qa.js');
  process.exit(1);
}

const options = {
  pfx: fs.readFileSync(pfxPath),
  passphrase: config.pfxPassphrase
};

const server = https.createServer(options, (req, res) => {
  const headers = {
    ...req.headers,
    host: `localhost:${config.backendPort}`,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': req.headers.host || `localhost:${config.httpsPort}`
  };

  let responseStarted = false;
  const proxyReq = http.request({
    host: '127.0.0.1',
    port: config.backendPort,
    method: req.method,
    path: req.url,
    headers
  }, proxyRes => {
    responseStarted = true;
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.on('error', () => {
      if (!res.destroyed) res.destroy();
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', err => {
    if (res.headersSent || responseStarted) {
      if (!res.destroyed) res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('QA proxy error: ' + err.message);
  });

  req.on('error', () => {
    if (!proxyReq.destroyed) proxyReq.destroy();
  });
  res.on('error', () => {
    if (!proxyReq.destroyed) proxyReq.destroy();
  });
  res.on('close', () => {
    if (!res.writableEnded && !proxyReq.destroyed) proxyReq.destroy();
  });

  req.pipe(proxyReq);
});

server.on('clientError', (err, socket) => {
  if (socket && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(config.httpsPort, '127.0.0.1', () => {
  console.log(`QA HTTPS proxy listening on ${config.baseURL}`);
  console.log(`Forwarding to http://127.0.0.1:${config.backendPort}`);
});
