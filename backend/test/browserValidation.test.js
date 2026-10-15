const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { validateBrowser, validatePlan } = require('../runner/browserValidation.cjs');

const document = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<div id="root">${body}</div><script>${script}</script></body></html>`;

async function fixture(t, handler) {
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

function html(response, body, script) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(document(body, script));
}

const options = { chromium, settleMs: 100, actionTimeout: 1000, navigationTimeout: 5000, timeoutMs: 20000 };

test('reference-sized screenshot comparison reports visual mismatches', { timeout: 30000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-browser-visual-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const referencePath = path.join(directory, 'reference.png');
  await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ffffff' } }).png().toFile(referencePath);
  const url = await fixture(t, (_, response) => html(response,
    '<main style="position:fixed;inset:0;background:#000;color:#fff"><h1>Different design</h1></main>'));
  const result = await validateBrowser(url, {
    ...options,
    maxInteractions: 0,
    visualReferencePath: referencePath,
    visualThreshold: 0.99
  });
  assert.equal(result.ok, false);
  assert.equal(result.visual.passed, false);
  assert.deepEqual(result.visual.viewport, { width: 320, height: 240 });
  assert.ok(result.diagnostics.some((item) => item.category === 'visual' && /similarity/.test(item.message)));
  assert.ok(result.checks.some((check) => check.name === 'visual' && check.status === 'failed'));
});

test('healthy app: desktop/mobile routes, buttons, tabs, menus, toggle, search, select and form', { timeout: 60000 }, async (t) => {
  const observed = new Set();
  const url = await fixture(t, (request, response) => {
    if (request.url.startsWith('/event/')) {
      observed.add(request.url.slice('/event/'.length));
      response.writeHead(204); response.end(); return;
    }
    if (request.url === '/about') { html(response, '<h1>About this fixture</h1>'); return; }
    html(response, `<h1>Healthy fixture</h1><a href="/about">About</a>
      <button id="increment">Increment</button><output id="count">0</output>
      <button id="tab" role="tab">Details</button><p id="details" hidden>Details loaded</p>
      <button id="menu" aria-expanded="false">Menu</button><div id="items" hidden><button role="menuitem" id="item">Choose</button></div>
      <input id="toggle" type="checkbox" aria-label="Toggle">
      <input id="search" type="search" aria-label="Search">
      <select id="select" aria-label="Choice"><option value="a">A</option><option value="b">B</option></select>
      <form id="form"><input id="name" aria-label="Name"><button type="submit">Send</button></form><p id="sent" hidden>Submitted</p>`, `
      const event = name => fetch('/event/' + name, {method:'POST'});
      document.querySelector('#increment').onclick = () => { document.querySelector('#count').textContent = '1'; event('click'); };
      document.querySelector('#tab').onclick = () => { document.querySelector('#details').hidden = false; event('tab'); };
      document.querySelector('#menu').onclick = () => { document.querySelector('#items').hidden = false; event('menu'); };
      document.querySelector('#item').onclick = () => event('menuitem');
      document.querySelector('#toggle').onchange = () => event('toggle');
      document.querySelector('#search').onkeydown = e => { if(e.key === 'Enter') event('search'); };
      document.querySelector('#select').onchange = () => event('select');
      document.querySelector('#name').oninput = () => event('fill');
      document.querySelector('#form').onsubmit = e => { e.preventDefault(); document.querySelector('#sent').hidden = false; event('submit'); };
    `);
  });
  const result = await validateBrowser(url, { ...options, timeoutMs: 60000, maxInteractions: 16, plan: {
    version: 1, tests: [{ name: 'Explicit form scenario', steps: [
      { action: 'fill', selector: '#name', value: 'Example' },
      { action: 'check', selector: '#toggle', checked: true },
      { action: 'select', selector: '#select', value: 'b' },
      { action: 'click', selector: '#form button' },
      { action: 'assert', selector: '#sent', text: 'Submitted', visible: true }
    ] }]
  } });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  for (const name of ['click', 'tab', 'menu', 'menuitem', 'toggle', 'search', 'select', 'fill', 'submit']) {
    assert.ok(observed.has(name), `Missing healthy interaction: ${name}`);
  }
  assert.deepEqual(result.coverage.viewports.map((viewport) => viewport.name), ['desktop', 'mobile']);
  assert.equal(result.coverage.routes.length, 2);
  assert.equal(result.coverage.plannedTests.length, 2);
  assert.ok(result.coverage.plannedTests.every((check) => check.status === 'passed'));
  assert.ok(result.coverage.network.completedRequests > 0);
  assert.equal(result.coverage.network.teardownAborts, 0);
  assert.equal(result.coverage.exhaustive, false);
  assert.ok(result.coverage.skips.length > 0);
});

test('startup crash includes the full JavaScript stack and source location', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response, '<h1>Shell</h1>',
    'function startupFailure() { throw new Error("startup exploded"); }\nstartupFailure();'));
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  const error = result.diagnostics.find((item) => item.category === 'pageerror');
  assert.match(error.message, /startup exploded/);
  assert.match(error.message, /at startupFailure/);
  assert.ok(error.path.startsWith(url));
  assert.ok(error.line > 0 && error.column > 0);
});

test('click-only crash fails a page that is healthy at startup', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response, '<h1>Ready</h1><button id="crash">Open details</button>',
    'document.querySelector("#crash").onclick = function clickFailure() { throw new Error("click exploded"); };'));
  const result = await validateBrowser(url, options);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'pageerror' && /click exploded[\s\S]*clickFailure/.test(item.message)));
  assert.ok(result.coverage.interactions.some((interaction) => interaction.action === 'click' && interaction.status === 'failed'));
});

test('blank and hidden root DOM fail even with visible content outside the root', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<p>Outside root</p><div id="root"><p style="display:none">Hidden</p><span style="opacity:0">Invisible</span></div>');
  });
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'blank'));
});

test('visible SVG without text is not blank', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response,
    '<svg width="100" height="100"><rect width="100" height="100" fill="red" /></svg>'));
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('HTTP 500 resources are failures even when fetch handles them', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (request, response) => {
    if (request.url === '/broken') { response.writeHead(500); response.end('fixture failure'); return; }
    html(response, '<h1>Ready</h1>', 'fetch("/broken").then(() => {});');
  });
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'http' && /HTTP 500/.test(item.message) && item.path.endsWith('/broken')));
});

test('console.error retains Error stack and aborted same-origin requests fail', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (request, response) => {
    if (request.url === '/reset') { request.socket.destroy(); return; }
    html(response, '<h1>Ready</h1>', `function loggedFailure() { console.error(new Error('logged failure')); }
      loggedFailure(); fetch('/reset').catch(() => {});`);
  });
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'console' && /logged failure[\s\S]*loggedFailure/.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.category === 'network' && item.path.endsWith('/reset')));
});

test('delayed 204 interactions complete before discovering subsequent controls and closing contexts', { timeout: 30000 }, async (t) => {
  let completed = 0;
  let confirmed = 0;
  let interrupted = 0;
  const url = await fixture(t, (request, response) => {
    if (request.url === '/save') {
      response.on('close', () => { if (!response.writableFinished) interrupted++; });
      setTimeout(() => { completed++; response.writeHead(204); response.end(); }, 400);
      return;
    }
    if (request.url === '/confirm') { confirmed++; response.end('Confirmed'); return; }
    html(response, '<h1>Ready</h1><button id="save">Save</button><button id="confirm" hidden>Confirm</button>', `
      document.querySelector('#save').onclick = () => {
        fetch('/save', {method:'POST'}).then(response => {
          if (response.status !== 204) throw new Error('Unexpected status');
          document.querySelector('#confirm').hidden = false;
        });
      };
      document.querySelector('#confirm').onclick = () => fetch('/confirm', {method:'POST'}).then(response => response.text());
    `);
  });
  const result = await validateBrowser(url, { ...options, settleMs: 50, maxInteractions: 2 });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(completed, 2);
  assert.equal(confirmed, 2, 'Each viewport must exercise the control revealed by the completed request');
  assert.equal(interrupted, 0);
  assert.equal(result.coverage.network.teardownAborts, 0);
});

test('delayed HTTP errors and socket failures remain failures rather than being lost at teardown', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (request, response) => {
    if (request.url === '/late-error') {
      setTimeout(() => { response.writeHead(500); response.end('Late failure'); }, 350);
      return;
    }
    if (request.url === '/late-reset') { setTimeout(() => request.socket.destroy(), 400); return; }
    html(response, '<h1>Ready</h1>', `
      fetch('/late-error').catch(() => {});
      fetch('/late-reset').catch(() => {});
    `);
  });
  const result = await validateBrowser(url, { ...options, settleMs: 50, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'http' && item.path.endsWith('/late-error')));
  assert.ok(result.diagnostics.some((item) => item.category === 'network' && item.path.endsWith('/late-reset')));
  assert.equal(result.coverage.network.teardownAborts, 0);
});

test('application aborts before a 204 response are still real request failures', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (request, response) => {
    if (request.url === '/cancelled') {
      setTimeout(() => { response.writeHead(204); response.end(); }, 400);
      return;
    }
    html(response, '<h1>Ready</h1>', `
      const controller = new AbortController();
      fetch('/cancelled', {signal:controller.signal}).catch(() => {});
      setTimeout(() => controller.abort(), 100);
    `);
  });
  const result = await validateBrowser(url, { ...options, settleMs: 50, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'network' &&
    item.path.endsWith('/cancelled') && item.message.includes('net::ERR_ABORTED')), JSON.stringify(result.diagnostics));
  assert.equal(result.coverage.network.noContentCompletions, 0);
});

test('unfinished requests fail the drain deadline without reporting cleanup aborts as app failures', { timeout: 30000 }, async (t) => {
  let requested = false;
  const url = await fixture(t, (request, response) => {
    if (request.url === '/never-finishes') { requested = true; return; }
    html(response, '<h1>Ready</h1>', 'fetch("/never-finishes").catch(() => {});');
  });
  const result = await validateBrowser(url, { ...options, settleMs: 50, networkTimeout: 500, maxInteractions: 0 });
  assert.equal(requested, true);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'network-timeout' && item.message.includes('/never-finishes')));
  assert.ok(!result.diagnostics.some((item) => item.category === 'network'), JSON.stringify(result.diagnostics));
});

test('external reads, mutations and WebSockets are blocked before reaching another origin', { timeout: 30000 }, async (t) => {
  let externalRequests = 0;
  const external = await fixture(t, (_, response) => { externalRequests++; response.end('must not reach'); });
  const url = await fixture(t, (_, response) => html(response, '<h1>Ready</h1>', `
    fetch(${JSON.stringify(external)}, {method:'POST', mode:'no-cors', body:'do not send'}).catch(() => {});
    fetch(${JSON.stringify(external)}, {mode:'no-cors'}).catch(() => {});
    new WebSocket(${JSON.stringify(external.replace('http:', 'ws:'))});
  `));
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.equal(externalRequests, 0);
  for (const method of ['POST', 'GET', 'WebSocket']) {
    assert.ok(result.diagnostics.some((item) => item.category === 'external-blocked' && item.message.includes(method)), method);
  }
});

test('mobile-only blank rendering fails', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response,
    '<style>@media(max-width:500px){h1{display:none}}</style><h1>Desktop only</h1>'));
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'blank' && item.message.includes('mobile')));
  assert.ok(result.checks.some((item) => item.name === 'visible-root' && item.viewport === 'desktop' && item.status === 'passed'));
});

test('external mutation redirects are blocked before following Location', { timeout: 30000 }, async (t) => {
  let externalRequests = 0;
  const external = await fixture(t, (_, response) => { externalRequests++; response.end('must not reach'); });
  const url = await fixture(t, (request, response) => {
    if (request.url === '/redirect') { response.writeHead(307, { Location: external }); response.end(); return; }
    html(response, '<h1>Ready</h1>', 'fetch("/redirect", {method:"POST", body:"do not send"}).catch(() => {});');
  });
  const result = await validateBrowser(url, { ...options, maxInteractions: 0 });
  assert.equal(result.ok, false);
  assert.equal(externalRequests, 0);
  assert.ok(result.diagnostics.some((item) => item.category === 'external-blocked' && item.message.includes('redirect')));
});

test('failed explicit assertions fail validation and scenarios have fresh storage', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response,
    '<h1>Ready</h1><button>Persist</button><output>Clean</output>', `
    if (localStorage.getItem('dirty')) document.querySelector('output').textContent = 'Dirty';
    document.querySelector('button').onclick = () => localStorage.setItem('dirty', 'yes');
  `));
  const result = await validateBrowser(url, { ...options, plan: { version: 1, tests: [
    { name: 'Fresh storage', viewports: ['desktop'], steps: [{ action: 'assert', selector: 'output', text: 'Clean' }] },
    { name: 'Wrong text', viewports: ['desktop'], steps: [{ action: 'assert', selector: 'h1', text: 'Not present' }] }
  ] } });
  assert.equal(result.ok, false);
  assert.equal(result.coverage.plannedTests.find((item) => item.name === 'Fresh storage').status, 'passed');
  assert.equal(result.coverage.plannedTests.find((item) => item.name === 'Wrong text').status, 'failed');
  assert.ok(result.diagnostics.some((item) => item.category === 'plan' && item.path === 'veave.validation.json'));
});

test('target style assertions verify computed rendered CSS on exact text', { timeout: 30000 }, async (t) => {
  const url = await fixture(t, (_, response) => html(response,
    '<h1><span style="color: rgb(234, 179, 8)">Empowering</span><span>Minds</span></h1>'));
  const result = await validateBrowser(url, { ...options, plan: { version: 1, tests: [
    {
      name: 'Selected word color',
      viewports: ['desktop'],
      steps: [{
        action: 'assert',
        selector: 'span',
        targetText: 'Empowering',
        style: { property: 'color', value: 'rgb(234, 179, 8)' }
      }]
    }
  ] } });
  assert.equal(result.ok, true);
  assert.equal(result.coverage.plannedTests[0].status, 'passed');
});

test('invalid plans are rejected without launching Chromium; arbitrary evaluation is not supported', async () => {
  for (const plan of [
    {}, { version: 1, tests: [] },
    { version: 1, tests: [{ name: 'bad', path: '//external.test', steps: [{ action: 'assert', selector: 'h1', text: 'x' }] }] },
    { version: 1, tests: [{ name: 'bad', steps: [{ action: 'eval', selector: 'body', value: 'fetch("/delete")' }] }] },
    { version: 1, tests: [{ name: 'bad', steps: [{ action: 'click', selector: 'body' }] }] },
    { version: 1, tests: [{ name: 'bad', steps: [{ action: 'assert', selector: 'body', visible: 'yes' }] }] },
    { version: 1, tests: [{ name: 'bad', steps: [{ action: 'assert', selector: 'body', text: 'x', script: 'evil()' }] }] }
  ]) {
    assert.throws(() => validatePlan(plan));
    const result = await validateBrowser('http://127.0.0.1:4173/', {
      chromium: { launch() { assert.fail('Invalid plan must not launch a browser'); } }, plan
    });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length);
  }
});

test('browser deadline fails closed and attempts cleanup', { timeout: 10000 }, async () => {
  let closed = false;
  const result = await validateBrowser('http://127.0.0.1:4173/', {
    timeoutMs: 1000,
    chromium: { launch: async () => ({
      newContext: () => new Promise(() => {}),
      close: async () => { closed = true; }
    }) }
  });
  assert.equal(result.ok, false);
  assert.equal(closed, true);
  assert.ok(result.diagnostics.some((item) => item.message.includes('exceeded 1000ms')));
  assert.ok(result.coverage.skips.some((item) => item.includes('Deadline')));
});
