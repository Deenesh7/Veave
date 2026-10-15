const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { verifyPreviewRuntime, verifyPreviewVisual, verifyRenderedTarget, verifyPageIsolation } = require('../src/services/ai/targetRenderVerifier');
const aiProtocol = require('../src/services/ai/aiProtocol');

test('preview runtime verifier loads relative data dependencies before components', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/App.jsx',
      content: `import Footer from './components/Footer';
export default function App() { return <Footer />; }`
    },
    {
      path: 'src/components/Footer.jsx',
      content: `import { RESTAURANT_INFO } from '../data/restaurantData';
export default function Footer() { return <footer>{RESTAURANT_INFO.shortName}</footer>; }`
    },
    {
      path: 'src/data/restaurantData.js',
      content: `export const RESTAURANT_INFO = { shortName: 'Aurelia' };`
    }
  ];

  const result = await verifyPreviewRuntime(files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.checks.some((check) => check.name === 'preview-runtime' && check.status === 'passed'));
});

test('preview runtime verifier provides react-router-dom aliases locally', { timeout: 120000 }, async () => {
  const result = await verifyPreviewRuntime([{
    path: 'src/App.jsx',
    content: `import { BrowserRouter as RouterComponent, Routes, Route, Link } from 'react-router-dom';
export default function App() {
  return (
    <RouterComponent>
      <nav><Link to="/about">About</Link></nav>
      <Routes>
        <Route path="/" element={<h1>Home</h1>} />
        <Route path="/about" element={<h1>About</h1>} />
      </Routes>
    </RouterComponent>
  );
}`
  }]);

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.checks.some((check) => check.name === 'preview-runtime' && check.status === 'passed'));
});

test('preview runtime supports generated Router and legacy routing aliases', { timeout: 120000 }, async () => {
  const result = await verifyPreviewRuntime([{
    path: 'src/App.jsx',
    content: `import { Router, Switch, Route, Redirect, ScrollRestoration } from 'react-router-dom';
export default function App() {
  return <Router><ScrollRestoration /><Switch><Route path="/" element={<h1>Home page</h1>} /><Redirect to="/" /></Switch></Router>;
}`
  }], { expectedHeading: 'Home page' });

  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('preview runtime resolves local directory imports through index modules', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/components/index.jsx',
      content: 'export function Header(){ return <header>Saveetha header</header>; }'
    },
    {
      path: 'src/App.jsx',
      content: "import { Header } from './components'; export default function App(){ return <main><Header /><h1>Constituent Institutions</h1></main>; }"
    }
  ];

  const result = await verifyPreviewRuntime(files, { expectedHeading: 'Constituent Institutions' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('preview runtime validates a specific sequential clone route and heading', { timeout: 120000 }, async () => {
  const result = await verifyPreviewRuntime([{
    path: 'src/App.jsx',
    content: `import { Routes, Route } from 'react-router-dom'; export default function App(){return <Routes><Route path="/" element={<h1>Home</h1>}/><Route path="/academics/phd" element={<h1>Doctoral programmes</h1>}/></Routes>}`
  }], { routePath: '/academics/phd', expectedHeading: 'Doctoral programmes' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.checks.some((check) => check.name === 'preview-route' && check.route === '/academics/phd' && check.status === 'passed'));
});

test('preview visual verifier reports route-level screenshot mismatches', { timeout: 120000 }, async () => {
  const reference = await sharp({
    create: { width: 320, height: 240, channels: 3, background: '#000000' }
  }).jpeg().toBuffer();
  const result = await verifyPreviewVisual([{
    path: 'src/App.jsx',
    content: `export default function App(){return <main style={{width:'100vw',height:'100vh',background:'#ffffff'}}>Reference page</main>}`
  }], {
    routePath: '/',
    reference: `data:image/jpeg;base64,${reference.toString('base64')}`,
    threshold: 0.99
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].category, 'visual');
  assert.match(result.diagnostics[0].message, /below 0.99/);
});

test('local preview inlines and renders downloaded binary image assets', { timeout: 120000 }, async () => {
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const result = await verifyPreviewRuntime([
    { path: 'src/App.jsx', content: 'export default function App(){return <img src="/assets/images/pixel.png" alt="Pixel" />}' },
    { path: 'public/assets/images/pixel.png', content: pixel, encoding: 'base64', language: 'binary' }
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.checks.some((check) => check.name === 'preview-assets' && check.status === 'passed'));
});

test('sequential source edits retain localized assets for render validation', { timeout: 120000 }, async () => {
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const staged = aiProtocol.applyOperationsSafely([
    { path: 'src/App.jsx', content: 'export default function App(){return <main>Initial</main>}', language: 'javascript' },
    { path: 'public/assets/images/saveetha.png', content: pixel, encoding: 'base64', language: 'binary' }
  ], [{
    path: 'src/App.jsx',
    operation: 'modify',
    content: 'export default function App(){return <main><img src="/assets/images/saveetha.png" alt="Saveetha" /></main>}'
  }]);

  const result = await verifyPreviewRuntime(staged.files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.checks.some((check) => check.name === 'preview-assets' && check.status === 'passed'));
});

test('local preview rejects broken local image references', { timeout: 120000 }, async () => {
  const result = await verifyPreviewRuntime([{
    path: 'src/App.jsx',
    content: 'export default function App(){return <main><h1>Clone</h1><img src="/assets/images/missing.png" alt="Missing" /></main>}'
  }]);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.category === 'missing-asset'));
});

test('clone-style modular routes and carousel render in local fallback', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/App.jsx',
      content: `import { Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
export default function App() { return <Routes><Route path="/" element={<HomePage />} /></Routes>; }`
    },
    {
      path: 'src/pages/HomePage.jsx',
      content: `import useEmblaCarousel from 'embla-carousel-react'; export function HomePage() { const [ref] = useEmblaCarousel(); return <main><h1>Cloned University</h1><div ref={ref}>Rankings</div></main>; }`
    }
  ];
  const result = await verifyPreviewRuntime(files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('clone preview supports typed named-only component exports', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/App.tsx',
      content: `import { Footer } from './components/Footer';
export default function App() { return <Footer label="Campus" />; }`
    },
    {
      path: 'src/components/Footer.tsx',
      content: `type FooterProps = { label: string };
export const Footer: React.FC<FooterProps> = ({ label }) => <footer>{label} footer</footer>;`
    }
  ];

  const result = await verifyPreviewRuntime(files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('clone preview removes type-only imports and export lists from types modules', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/types.ts',
      content: `export type BadgeType = 'ranking' | 'award';
export type BadgeStyle = { color: string };
export interface RankingItem { id: string; type: BadgeType; }
export interface NavItem { label: string; path: string; }
export type GenericItem = Record<string, unknown>;

export type { BadgeType, BadgeStyle, RankingItem, NavItem, GenericItem };`
    },
    {
      path: 'src/App.tsx',
      content: `import type { BadgeType } from './types';
export default function App() { const badge: BadgeType = 'ranking'; return <main><h1>{badge}</h1></main>; }`
    }
  ];
  const result = await verifyPreviewRuntime(files);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('preview runtime verifier returns render exceptions as repairable diagnostics', { timeout: 120000 }, async () => {
  const result = await verifyPreviewRuntime([{
    path: 'src/App.jsx',
    content: `export default function App() { const value = undefined; return <h1>{value.shortName}</h1>; }`
  }]);

  assert.equal(result.ok, false);
  assert.equal(result.blocked, undefined);
  assert.equal(result.diagnostics[0].category, 'preview-runtime');
  assert.match(result.diagnostics[0].message, /shortName/);
});

test('render verifier confirms the computed color of one exact word', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/App.jsx',
      content: `export default function App() {
  return <h1><span className="text-yellow-500">Empowering</span> Minds</h1>;
}`
    },
    { path: 'src/index.css', content: 'body { color: black; }' }
  ];

  const result = await verifyRenderedTarget(files, {
    selector: 'span',
    targetText: 'Empowering',
    property: 'color',
    value: 'rgb(234, 179, 8)'
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.actual, 'rgb(234, 179, 8)');
});

test('render verifier dynamically normalizes arbitrary CSS color values', { timeout: 120000 }, async () => {
  const files = [{
    path: 'src/App.jsx',
    content: 'export default function App() { return <span className="text-[rebeccapurple]">Dynamic</span>; }'
  }];

  const result = await verifyRenderedTarget(files, {
    selector: 'span',
    targetText: 'Dynamic',
    property: 'color',
    cssValue: 'rebeccapurple'
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.actual, 'rgb(102, 51, 153)');
});

test('render verifier confirms exact replacement text', { timeout: 120000 }, async () => {
  const files = [{
    path: 'src/App.jsx',
    content: 'export default function App() { return <button>Playful</button>; }'
  }];
  const result = await verifyRenderedTarget(files, {
    selector: 'button',
    targetText: 'Playful',
    expectedText: 'Playful'
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.actual, 'Playful');
});

test('page isolation verifier confirms exclusive navigation in both directions', { timeout: 120000 }, async () => {
  const files = [
    {
      path: 'src/App.jsx',
      content: `function AboutPage({ onHome }) {
  return <main data-page="about" className="relative min-h-screen overflow-hidden bg-white">
    <button data-page-link="home" onClick={onHome}>Home</button>
    <div className="relative z-10"><h1>About</h1></div>
  </main>;
}
export default function App() {
  const [page, setPage] = React.useState('home');
  return <div>
    <header data-shared-header>Shared Header</header>
    {page === 'about'
      ? <AboutPage onHome={() => setPage('home')} />
      : <main data-page="home" className="min-h-screen bg-slate-50">
          <button data-page-link="about" onClick={() => setPage('about')}>About</button>
          <h1>Home</h1>
        </main>}
    <footer data-shared-footer>Shared Footer</footer>
  </div>;
}`
    }
  ];

  const result = await verifyPageIsolation(files, {
    slug: 'about',
    homeSelector: '[data-page="home"]',
    pageSelector: '[data-page="about"]',
    openSelector: '[data-page-link="about"]',
    homeLinkSelector: '[data-page-link="home"]',
    headerSelector: '[data-shared-header]',
    footerSelector: '[data-shared-footer]'
  });
  assert.deepEqual(result, { status: 'passed', slug: 'about' });
});
