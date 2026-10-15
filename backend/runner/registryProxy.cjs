'use strict';
const http = require('node:http');
const net = require('node:net');

// The install container is on an internal Docker network with no internet route.
// Its only egress is this CONNECT proxy, which permits the public npm registry.
const server = http.createServer((req, res) => { res.writeHead(403); res.end('Registry HTTPS only'); });
server.on('connect', (req, socket, head) => {
  if (req.url !== 'registry.npmjs.org:443') {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = net.connect(443, 'registry.npmjs.org');
  upstream.setTimeout(60000, () => upstream.destroy());
  socket.setTimeout(60000, () => socket.destroy());
  upstream.on('connect', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
server.listen(8080, '0.0.0.0');
