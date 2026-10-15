const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlankRoute, findRouteComponentPath, applyFallbackPage } = require('../src/services/ai/blankPageFallback');

const app = { path: 'src/App.jsx', content: "import NewsPage from './pages/NewsPage';\nconst PAGES = { '/mediacoverage': NewsPage };" };
const stub = { path: 'src/pages/NewsPage.jsx', content: 'export default function NewsPage(){return <h1>News</h1>}' };

test('a route that renders far less text than its source is treated as blank', () => {
  const page = { path: '/mediacoverage', data: { textLength: 5000 } };
  assert.equal(isBlankRoute(page, 200), true);
  assert.equal(isBlankRoute(page, 4000), false);
  assert.equal(isBlankRoute({ path: '/x', data: { textLength: 100 } }, 0), false);
});

test('route components are resolved from the App route table', () => {
  assert.equal(findRouteComponentPath([app, stub], '/mediacoverage'), 'src/pages/NewsPage.jsx');
  assert.equal(findRouteComponentPath([app, stub], '/missing'), null);
});

test('fallback replaces only the blank page component with sanitized captured content', () => {
  const page = { path: '/mediacoverage', extraction: { html: `<body><nav>menu</nav><main><h1>News</h1>${'<p>Captured paragraph of real content. </p>'.repeat(20)}<script>alert(1)</script></main></body>` } };
  const result = applyFallbackPage([app, stub, { path: 'src/index.css', content: '@tailwind base;' }], page);
  assert.equal(result.applied, true);
  const component = result.files.find((file) => file.path === 'src/pages/NewsPage.jsx').content;
  assert.match(component, /Captured paragraph of real content/);
  assert.doesNotMatch(component, /alert\(1\)|menu/);
  assert.equal(result.files.find((file) => file.path === 'src/App.jsx').content, app.content);
});
