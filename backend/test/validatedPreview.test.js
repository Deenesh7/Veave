const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const PreviewArtifact = require('../src/models/PreviewArtifact');
const { servePreview, previewOrigin } = require('../src/services/project/validatedPreview');

test('compiled preview serves actual assets, SPA routes, and never exposes API handlers', async (t) => {
  const token = 'a'.repeat(48);
  const artifact = { files: [
    { path: 'dist/index.html', content: Buffer.from('<html><head></head><body><div id="root">Ready</div><script type="module" src="/assets/app.js"></script></body></html>').toString('base64') },
    { path: 'dist/assets/app.js', content: Buffer.from('window.built=true;').toString('base64') }
  ] };
  const original = PreviewArtifact.findOne;
  PreviewArtifact.findOne = () => ({ lean: async () => artifact });
  t.after(() => { PreviewArtifact.findOne = original; });
  const app = express();
  app.use(servePreview);
  app.use((req, res) => res.status(200).send('Private API handler'));
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: `${token}.localhost` };
  // Node fetch rewrites Host; raw HTTP is needed to exercise virtual-host routing.
  const request = (url, options) => new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text: async () => body,
        headers: { get: (name) => response.headers[name] } }));
    });
    req.on('error', reject);
    req.end();
  });
  const html = await request(base, { headers });
  assert.match(await html.text(), /preview-rendered/);
  const js = await request(`${base}/assets/app.js`, { headers });
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(await js.text(), 'window.built=true;');
  const route = await request(`${base}/details`, { headers: { ...headers, Accept: 'text/html' } });
  assert.match(await route.text(), /id="root"/);
  const post = await request(`${base}/api/auth/login`, { method: 'POST', headers });
  assert.equal(post.status, 405);
  const missing = await request(`${base}/assets/missing.js`, { headers });
  assert.equal(missing.status, 404);
  assert.match(previewOrigin(token), new RegExp(`${token}\\.localhost`));
});
