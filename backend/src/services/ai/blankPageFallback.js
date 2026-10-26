// Last-resort guard so a cloned page is never left blank. When a generated route renders far less
// text than the source page had (e.g. only a heading because its sections failed), that route's
// component is replaced with the captured page content, with assets and links localized.

function stripTags(html = '') {
  return String(html).replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function capturedTextLength(page = {}) {
  return page.data?.textLength || stripTags(page.extraction?.html || '').length;
}

function isBlankRoute(page, renderedTextLength, { ratio = 0.5, minimumCaptured = 600 } = {}) {
  const captured = capturedTextLength(page);
  if (captured < minimumCaptured) return false;
  return renderedTextLength < captured * ratio;
}

// Finds the component file that renders a route by reading the route table in App.jsx.
function findRouteComponentPath(files = [], routePath = '/') {
  const app = files.find((file) => /^src\/App\.(?:jsx?|tsx?)$/i.test(file.path || ''));
  if (!app) return null;
  const source = String(app.content || '');
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const patterns = [
    new RegExp(`['"]${escaped}['"]\\s*:\\s*(?:\\(\\s*[\\w{},\\s.]*\\)\\s*=>\\s*\\(?\\s*<\\s*)?([A-Z][\\w]*)`),
    new RegExp(`path=["']${escaped}["'][^>]*element=\\{\\s*<\\s*([A-Z][\\w]*)`),
    new RegExp(`path:\\s*['"]${escaped}['"][^}]*?(?:component|element)\\s*:\\s*(?:<\\s*)?([A-Z][\\w]*)`)
  ];
  let name = null;
  for (const pattern of patterns) { const match = source.match(pattern); if (match) { name = match[1]; break; } }
  if (!name) return null;
  const importMatch = source.match(new RegExp(`import\\s+${name}\\s+from\\s+['"]([^'"]+)['"]`));
  if (!importMatch || !importMatch[1].startsWith('.')) return null;
  const parts = ['src', ...importMatch[1].split('/')].reduce((acc, part) => {
    if (part === '.' || part === '') return acc;
    if (part === '..') acc.pop(); else acc.push(part);
    return acc;
  }, []);
  const base = parts.join('/');
  return files.map((file) => file.path).find((filePath) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(?:jsx?|tsx?)$`, 'i').test(filePath)) || null;
}

function sanitizeCapturedHtml(html = '', { keepChrome = false } = {}) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|object|embed|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(keepChrome ? /$^/ : /<(header|nav|footer)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:srcset|sizes|loading|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"')
    .replace(/<body\b[^>]*>/i, '<div>').replace(/<\/body>/i, '</div>').replace(/<\/?(?:html|head)\b[^>]*>/gi, '');
}

const FALLBACK_CSS = `
/* Captured-content fallback (used only when a generated page rendered blank) */
.veave-fallback { max-width: 1354px; margin: 0 auto; padding: 160px 24px 64px; overflow-wrap: anywhere; }
.veave-fallback img, .veave-fallback video { max-width: 100%; height: auto; }
.veave-fallback h1, .veave-fallback h2, .veave-fallback h3 { margin: 1.2em 0 .5em; line-height: 1.2; }
.veave-fallback p, .veave-fallback li { line-height: 1.6; margin: .5em 0; }
.veave-fallback table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
.veave-fallback td, .veave-fallback th { border: 1px solid currentColor; padding: 6px 10px; }
.veave-fallback a { text-decoration: underline; }
`;

function buildFallbackComponent(html) {
  return `// Auto-generated from the captured source page because the generated version rendered blank.\nconst html = ${JSON.stringify(html)};\n\nexport default function CapturedPage() {\n  return <section className="veave-fallback" dangerouslySetInnerHTML={{ __html: html }} />;\n}\n`;
}

function applyFallbackPage(files = [], page, { assets = [], localize = (value) => value } = {}) {
  const componentPath = findRouteComponentPath(files, page.path);
  if (!componentPath) return { files, applied: false, reason: 'route component not found' };
  const content = (page.extraction?.html || '') || (page.extraction?.htmlSections || []).map((section) => section.html).join('\n');
  const html = localize(sanitizeCapturedHtml(content));
  if (stripTags(html).length < 200) return { files, applied: false, reason: 'captured content too small' };
  const updated = files.map((file) => file.path === componentPath ? { ...file, content: buildFallbackComponent(html) } : file);
  const css = updated.find((file) => file.path === 'src/index.css');
  if (css && !String(css.content).includes('.veave-fallback')) css.content = `${css.content}\n${FALLBACK_CSS}`;
  else if (!css) updated.push({ path: 'src/index.css', content: FALLBACK_CSS, language: 'css', encoding: 'utf8' });
  return { files: updated, applied: true, componentPath };
}

module.exports = { buildFallbackComponent, FALLBACK_CSS, stripTags, capturedTextLength, isBlankRoute, findRouteComponentPath, sanitizeCapturedHtml, applyFallbackPage };
