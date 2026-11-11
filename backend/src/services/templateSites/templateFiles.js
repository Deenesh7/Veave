/**
 * Deterministic edits of a template site's files for page management (add, remove, rename, reorder). No AI is involved: a page is
 * a component under src/pages, a <Route> in src/App.jsx and an entry in the navigation data of src/data/site.js, and these functions
 * keep the three in step. Each function returns new file arrays and never mutates its input; when a file does not have the expected
 * shape it throws instead of guessing, so the caller can leave the project untouched.
 */
const { ValidationError, ConflictError } = require('../../utils/errors');

const APP = 'src/App.jsx';
const SITE_DATA = 'src/data/site.js';
const TEXT_FILE = /^src\/.*\.(?:jsx?|tsx?)$/;

const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceFile(files, path, content) {
  return files.map((file) => (file.path === path ? { ...file, content } : file));
}

function requireFile(files, path) {
  const file = files.find((item) => item.path === path);
  if (!file) throw new ConflictError(`${path} is missing, so the pages cannot be updated. Restore it first.`);
  return file;
}

/** "Our Story" -> "OurStory"; always a valid component identifier. */
function componentNameFor(name) {
  const words = String(name || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const pascal = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  const safe = /^[A-Za-z]/.test(pascal) ? pascal : `Page${pascal}`;
  return safe || 'Page';
}

/** "Our Story" -> "/our-story" */
function routeFor(name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `/${slug}`;
}

function validateRoute(route) {
  const value = String(route || '').trim();
  if (!/^\/[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(value) && value !== '/') throw new ValidationError('A route must be lowercase letters, numbers and dashes, for example /our-story.');
  return value;
}

/** Index of the bracket that closes the one at `open`, ignoring brackets inside strings and comments. */
function matchingBracket(source, open) {
  const pairs = { '[': ']', '{': '}', '(': ')' };
  const stack = [];
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2); if (i < 0) return -1; i += 1; continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
  }
  return -1;
}

/** The `[ ... ]` that follows `key:` (or `key =`) in the source, with the position of its brackets. */
function arrayBlock(source, key) {
  const match = new RegExp(`\\b${escapeRegExp(key)}\\s*[:=]\\s*\\[`).exec(source);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = matchingBracket(source, open);
  return close < 0 ? null : { open, close, inner: source.slice(open + 1, close) };
}

/** The top-level `{ ... }` literals of an array body. */
function topLevelObjects(inner) {
  const objects = [];
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] !== '{') continue;
    const end = matchingBracket(inner, i);
    if (end < 0) break;
    objects.push({ start: i, end, text: inner.slice(i, end + 1) });
    i = end;
  }
  return objects;
}

const routeOfEntry = (text) => (/\bto:\s*(['"`])((?:(?!\1).)*)\1/.exec(text) || [])[2] || null;

function indentOf(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  return /^\s*/.exec(source.slice(lineStart, index + 1))[0];
}

/* ------------------------------------------------------------------------------------------------------------------ */

function pageStub({ name, description }) {
  const title = JSON.stringify(name);
  const text = JSON.stringify(description || `Everything about ${name} will appear here. Describe what this page should contain and regenerate it.`);
  return `import React from 'react';
import Section, { SectionHeading } from '../components/Section';

export default function ${'__NAME__'}() {
  return (
    <Section>
      <SectionHeading eyebrow=${title} title=${title} description=${text} />
    </Section>
  );
}
`;
}

/** Adds the component file, its import and <Route> in App.jsx and its navigation entry. */
function addPage(files, { name, route, componentName, description = '' }) {
  validateRoute(route);
  const app = requireFile(files, APP);
  const componentPath = `src/pages/${componentName}.jsx`;
  if (files.some((file) => file.path === componentPath)) throw new ConflictError(`${componentPath} already exists.`);
  let source = textOf(app);
  if (new RegExp(`path=["']${escapeRegExp(route)}["']`).test(source)) throw new ConflictError(`The route ${route} is already registered.`);

  const importLine = `import ${componentName} from './pages/${componentName}';`;
  const imports = [...source.matchAll(/^import\s+[^\n]*from\s+['"]\.\/pages\/[^'"]+['"];?[ \t]*$/gm)];
  const lastImport = imports[imports.length - 1] || [...source.matchAll(/^import\s[^\n]*$/gm)].pop();
  if (!lastImport) throw new ConflictError('src/App.jsx has no imports to extend.');
  source = `${source.slice(0, lastImport.index + lastImport[0].length)}\n${importLine}${source.slice(lastImport.index + lastImport[0].length)}`;

  const catchAll = /^([ \t]*)<Route\b[^\n]*path=["']\*["'][^\n]*$/m.exec(source);
  const routeElement = `<Route path="${route}" element={<${componentName} />} />`;
  if (catchAll) source = `${source.slice(0, catchAll.index)}${catchAll[1]}${routeElement}\n${source.slice(catchAll.index)}`;
  else {
    const closing = /^([ \t]*)<\/Routes>/m.exec(source);
    if (!closing) throw new ConflictError('src/App.jsx has no <Routes> block to add the page to.');
    source = `${source.slice(0, closing.index)}${closing[1]}  ${routeElement}\n${source.slice(closing.index)}`;
  }

  let next = replaceFile(files, APP, source);
  const siteFile = files.find((file) => file.path === SITE_DATA);
  const warnings = [];
  if (siteFile) {
    const data = textOf(siteFile);
    const nav = arrayBlock(data, 'nav');
    if (nav) {
      const objects = topLevelObjects(nav.inner);
      const entry = `{ label: ${JSON.stringify(name)}, to: ${JSON.stringify(route)} }`;
      const last = objects[objects.length - 1];
      let updated;
      if (last) {
        const indent = indentOf(nav.inner, last.start);
        updated = `${data.slice(0, nav.open + 1)}${nav.inner.slice(0, last.end + 1)},\n${indent}${entry}${nav.inner.slice(last.end + 1)}${data.slice(nav.close)}`;
      } else updated = `${data.slice(0, nav.open + 1)}\n    ${entry}\n  ${data.slice(nav.close)}`;
      next = replaceFile(next, SITE_DATA, updated);
    } else warnings.push('src/data/site.js has no nav list; the page was added without a navigation link.');
  } else warnings.push('src/data/site.js is missing; the page was added without a navigation link.');

  next = [...next, { path: componentPath, content: pageStub({ name, description }).replace('__NAME__', componentName), language: 'javascript', encoding: 'utf8' }];
  return { files: next, componentPath, warnings };
}

/** Rewrites every link to `from` (JSX attributes and data fields) so it points at `to`. Returns the changed paths. */
function retargetLinks(files, from, to, { skipPaths = [] } = {}) {
  const changed = [];
  const attr = new RegExp(`(\\b(?:to|href)\\s*=\\s*\\{?\\s*)(['"\`])${escapeRegExp(from)}\\2`, 'g');
  const field = new RegExp(`(\\b(?:to|href|path|link|route)\\s*:\\s*)(['"\`])${escapeRegExp(from)}\\2`, 'g');
  const next = files.map((file) => {
    if (skipPaths.includes(file.path) || !TEXT_FILE.test(file.path)) return file;
    const source = textOf(file);
    if (!source.includes(from)) return file;
    const updated = source.replace(attr, (_, head, quote) => `${head}${quote}${to}${quote}`).replace(field, (_, head, quote) => `${head}${quote}${to}${quote}`);
    if (updated === source) return file;
    changed.push(file.path);
    return { ...file, content: updated };
  });
  return { files: next, changed };
}

/** Removes the page's component, import, <Route> and navigation entries; links that still pointed at it go to the home page. */
function removePage(files, { route, componentPath }) {
  if (route === '/') throw new ConflictError('The home page cannot be deleted.');
  const app = requireFile(files, APP);
  let source = textOf(app);
  const name = /\/([A-Za-z0-9_]+)\.jsx?$/.exec(componentPath)?.[1];
  const routeRe = new RegExp(`^[ \\t]*<Route\\b[^\\n]*path=["']${escapeRegExp(route)}["'][^\\n]*\\n?`, 'm');
  if (!routeRe.test(source)) throw new ConflictError(`The route ${route} is not registered in src/App.jsx, so it cannot be removed safely.`);
  source = source.replace(routeRe, '');
  if (name) source = source.replace(new RegExp(`^import\\s+${escapeRegExp(name)}\\s+from\\s+['"][^'"]*/${escapeRegExp(name)}(?:\\.jsx?)?['"];?[ \\t]*\\n?`, 'm'), '');
  let next = replaceFile(files, APP, source);

  const siteFile = next.find((file) => file.path === SITE_DATA);
  if (siteFile) {
    let data = textOf(siteFile);
    // The call-to-action button must not point at a page that no longer exists.
    data = data.replace(new RegExp(`(\\bcta\\s*:\\s*\\{[^}]*?\\bto:\\s*)(['"\`])${escapeRegExp(route)}\\2`), (_, head, quote) => `${head}${quote}/${quote}`);
    // Every navigation list (the header menu and each footer group) loses the page's entry.
    for (let guard = 0; guard < 100; guard += 1) {
      let removed = false;
      for (const match of data.matchAll(/\b(?:nav|links)\s*:\s*\[/g)) {
        const open = match.index + match[0].length - 1;
        const close = matchingBracket(data, open);
        if (close < 0) continue;
        const inner = data.slice(open + 1, close);
        const hit = topLevelObjects(inner).find((entry) => routeOfEntry(entry.text) === route);
        if (!hit) continue;
        const before = inner.slice(0, hit.start);
        const after = inner.slice(hit.end + 1);
        const trailingComma = /^\s*,/.exec(after);
        const leadingComma = /,\s*$/.exec(before);
        const rest = trailingComma ? before + after.slice(trailingComma[0].length) : leadingComma ? before.slice(0, leadingComma.index) + after : before + after;
        data = `${data.slice(0, open + 1)}${rest}${data.slice(close)}`;
        removed = true;
        break;
      }
      if (!removed) break;
    }
    next = replaceFile(next, SITE_DATA, data);
  }
  // Other places that link to the page (buttons, cards, footer data) fall back to the home page rather than to a dead URL.
  const retargeted = retargetLinks(next.filter((file) => file.path !== componentPath), route, '/');
  return { files: retargeted.files, removedPath: componentPath, retargeted: retargeted.changed.filter((path) => path !== APP && path !== SITE_DATA), deleted: [{ path: componentPath }] };
}

/** Changes the page's navigation label and, when `newRoute` is given, its URL everywhere it is used. */
function renamePage(files, { route, name, newRoute = null }) {
  let next = files;
  const siteFile = files.find((file) => file.path === SITE_DATA);
  if (siteFile && name) {
    const data = textOf(siteFile).replace(new RegExp(`(\\blabel:\\s*)(['"\`])(?:(?!\\2).)*\\2(\\s*,\\s*to:\\s*)(['"\`])${escapeRegExp(route)}\\4`, 'g'), (_, head, _q, mid, quote) => `${head}${JSON.stringify(name)}${mid}${quote}${route}${quote}`);
    next = replaceFile(next, SITE_DATA, data);
  }
  if (newRoute && newRoute !== route) {
    validateRoute(newRoute);
    if (route === '/') throw new ConflictError('The home page keeps the "/" address.');
    const app = requireFile(next, APP);
    const source = textOf(app);
    const routeRe = new RegExp(`(<Route\\b[^\\n]*path=)(["'])${escapeRegExp(route)}\\2`);
    if (!routeRe.test(source)) throw new ConflictError(`The route ${route} is not registered in src/App.jsx.`);
    next = replaceFile(next, APP, source.replace(routeRe, (_, head, quote) => `${head}${quote}${newRoute}${quote}`));
    next = retargetLinks(next, route, newRoute, { skipPaths: [APP] }).files;
  }
  return { files: next };
}

/** Puts the navigation entries in the order of `routes` (entries for routes not listed keep their place at the end). */
function reorderNav(files, routes) {
  const siteFile = files.find((file) => file.path === SITE_DATA);
  if (!siteFile) return { files };
  const data = textOf(siteFile);
  const nav = arrayBlock(data, 'nav');
  if (!nav) return { files };
  const objects = topLevelObjects(nav.inner);
  if (objects.length < 2) return { files };
  const rank = (entry) => { const index = routes.indexOf(routeOfEntry(entry.text)); return index < 0 ? routes.length : index; };
  const sorted = objects.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map((item) => item.entry);
  // Put the sorted literals into the slots the originals occupied, so the surrounding formatting stays as it was.
  let inner = '';
  let cursor = 0;
  objects.forEach((slot, index) => {
    inner += nav.inner.slice(cursor, slot.start) + sorted[index].text;
    cursor = slot.end + 1;
  });
  inner += nav.inner.slice(cursor);
  return { files: replaceFile(files, SITE_DATA, `${data.slice(0, nav.open + 1)}${inner}${data.slice(nav.close)}`) };
}

module.exports = { APP, SITE_DATA, componentNameFor, routeFor, validateRoute, addPage, removePage, renamePage, reorderNav, retargetLinks, arrayBlock, topLevelObjects, routeOfEntry };
