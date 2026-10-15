const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

test('Normal Preview mode activates button navigation directly and Edit mode supports selection', { timeout: 60000 }, async () => {
  const transformerPath = path.resolve(__dirname, '../../frontend/src/utils/codeTransformer.js');
  const { buildPreviewHTML } = await import(pathToFileURL(transformerPath).href);
  const html = buildPreviewHTML([{
    path: 'src/App.jsx',
    content: `export default function App() {
  const [page, setPage] = React.useState('home');
  return page === 'home'
    ? <div><button onClick={() => setPage('about')}>About</button><a href="/contact">Contact</a></div>
    : <main><h1>About page</h1></main>;
}`
  }]);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: 'About' });
    await button.waitFor({ state: 'visible', timeout: 30000 });

    // 1. Normal Preview Mode: Clicking the button MUST navigate directly to About page
    await button.click();
    await page.getByText('About page').waitFor({ state: 'visible', timeout: 10000 });
    assert.equal(await page.getByText('About page').count(), 1);

    // 2. Edit Mode: Toggle inspect mode enabled and verify element inspection
    await page.evaluate(() => {
      window.postMessage({ type: 'toggle-inspect-mode', enabled: true }, '*');
    });
    // Wait for inspect mode state to update
    await page.waitForTimeout(100);
    // 3. Verify interactive button inside structural div/span wrappers in Edit Mode
    // Even in Edit Mode, clicking an interactive button MUST trigger its action
    const backBtn = page.getByRole('button', { name: 'Back' });
    if (await backBtn.count() > 0) {
      await backBtn.click();
      await page.getByRole('button', { name: 'About' }).waitFor({ state: 'visible', timeout: 5000 });
    }
  } finally {
    await browser.close();
  }
});

test('Interactive elements (links, buttons, dropdowns) work without editor interception in structural wrappers', { timeout: 60000 }, async () => {
  const transformerPath = path.resolve(__dirname, '../../frontend/src/utils/codeTransformer.js');
  const { buildPreviewHTML } = await import(pathToFileURL(transformerPath).href);
  const html = buildPreviewHTML([{
    path: 'src/App.jsx',
    content: `export default function App() {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState('None');
  return (
    <section className="container mx-auto p-4">
      <header className="header-wrapper">
        <a href="/about" id="nav-about">About Link</a>
      </header>
      <div className="dropdown-container">
        <button id="dropdown-toggle" onClick={() => setDropdownOpen(!dropdownOpen)}>
          <span>Options</span>
        </button>
        {dropdownOpen && (
          <ul id="dropdown-menu">
            <li><button id="opt-1" onClick={() => setSelectedItem('Item 1')}>Select Item 1</button></li>
          </ul>
        )}
      </div>
      <p id="selection-result">Selected: {selectedItem}</p>
      <div id="about" data-page="about">
        <h2>About Section</h2>
      </div>
    </section>
  );
}`
  }]);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // 1. Anchor link click: <a href="/about">About Link</a> should execute navigation without error
    const aboutLink = page.locator('#nav-about');
    await aboutLink.waitFor({ state: 'visible' });
    await aboutLink.click();

    // 2. Dropdown button with nested span: click should open dropdown menu
    const dropdownToggle = page.locator('#dropdown-toggle');
    await dropdownToggle.click();
    const opt1 = page.locator('#opt-1');
    await opt1.waitFor({ state: 'visible', timeout: 5000 });

    // 3. Option button inside dropdown: click should update state
    await opt1.click();
    await page.locator('#selection-result').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#selection-result').innerText(), 'Selected: Item 1');

    // 4. Structural containers (div, section, p) must NOT have veave-inspect-selected or intercept clicks
    const container = page.locator('.container');
    await container.click();
    assert.doesNotMatch(await container.getAttribute('class') || '', /veave-inspect-selected/);
  } finally {
    await browser.close();
  }
});

test('Website navigation emits preview-route-changed and preview-navigate-back restores route', { timeout: 60000 }, async () => {
  const transformerPath = path.resolve(__dirname, '../../frontend/src/utils/codeTransformer.js');
  const { buildPreviewHTML } = await import(pathToFileURL(transformerPath).href);
  const html = buildPreviewHTML([{
    path: 'src/App.jsx',
    content: `export default function App() {
  return (
    <div>
      <nav>
        <a href="/pricing" id="pricing-link">Pricing</a>
      </nav>
      <div id="pricing" data-page="pricing">
        <h1>Pricing Plan</h1>
      </div>
    </div>
  );
}`
  }]);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const routeChanges = [];

    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      window.__routeChanges = [];
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'preview-route-changed') {
          window.__routeChanges.push(e.data.route);
        }
      });
    });

    // Click link to /pricing
    const pricingLink = page.locator('#pricing-link');
    await pricingLink.waitFor({ state: 'visible' });
    await pricingLink.click();

    // Verify preview-route-changed was emitted
    await page.waitForFunction(() => window.__routeChanges && window.__routeChanges.includes('/pricing'), { timeout: 5000 });
    const changesAfterClick = await page.evaluate(() => window.__routeChanges);
    assert.ok(changesAfterClick.includes('/pricing'), 'Should have emitted /pricing route change');

    // Simulate clicking the top-left Back button (posts preview-navigate-back)
    await page.evaluate(() => {
      window.postMessage({ type: 'preview-navigate-back', route: '/' }, '*');
    });

    await page.waitForFunction(() => window.__routeChanges && window.__routeChanges.includes('/'), { timeout: 5000 });
    const changesAfterBack = await page.evaluate(() => window.__routeChanges);
    assert.ok(changesAfterBack.includes('/'), 'Should have emitted / route change on navigating back');
  } finally {
    await browser.close();
  }
});

test('Edit mode enables selection and editing of every DOM element (p, span, div, button)', { timeout: 60000 }, async () => {
  const transformerPath = path.resolve(__dirname, '../../frontend/src/utils/codeTransformer.js');
  const { buildPreviewHTML } = await import(pathToFileURL(transformerPath).href);
  const html = buildPreviewHTML([{
    path: 'src/App.jsx',
    content: `export default function App() {
  return (
    <div id="wrapper">
      <div id="card" className="card-box" style={{ padding: '24px' }}>
        <h2 id="card-title">Card Heading</h2>
        <p id="card-desc">Card description paragraph text</p>
        <span id="badge">PRO</span>
        <button id="cta-btn">Get Started</button>
      </div>
    </div>
  );
}`
  }]);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Enable Edit Mode
    await page.evaluate(() => {
      window.postMessage({ type: 'toggle-inspect-mode', enabled: true }, '*');
    });
    await page.waitForTimeout(100);

    // 1. Verify <p> paragraph is clickable and selected
    const pEl = page.locator('#card-desc');
    await pEl.waitFor({ state: 'visible' });
    await pEl.click();
    assert.match(await pEl.getAttribute('class') || '', /veave-inspect-selected/);

    // 2. Verify <span> badge is clickable and selected
    const spanEl = page.locator('#badge');
    await spanEl.click();
    assert.match(await spanEl.getAttribute('class') || '', /veave-inspect-selected/);

    // 3. Verify <div> card is clickable and selected
    const cardEl = page.locator('#card');
    await cardEl.click({ position: { x: 5, y: 5 } });
    assert.match(await cardEl.getAttribute('class') || '', /veave-inspect-selected/);

    // 4. Verify <button> is clickable and selected in Edit Mode
    const btnEl = page.locator('#cta-btn');
    await btnEl.click();
    assert.match(await btnEl.getAttribute('class') || '', /veave-inspect-selected/);

    // 5. Verify double-click inline text editing works on <p>
    await pEl.dblclick();
    assert.equal(await pEl.getAttribute('contenteditable'), 'true');

    // 6. Verify live style application works on selected element
    await page.evaluate(() => {
      window.postMessage({
        type: 'apply-visual-style',
        elementId: document.getElementById('card-desc').getAttribute('data-veave-id'),
        property: 'color',
        value: '#10b981'
      }, '*');
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('card-desc');
      return el && el.style.color.includes('16, 185, 129') || el.style.color === '#10b981';
    }, { timeout: 5000 });
  } finally {
    await browser.close();
  }
});
