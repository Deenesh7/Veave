/**
 * Compares the real stored state of two websites (two versions, a version and the live site, a branch and its main, or a page now and an
 * earlier revision of it): pages added, removed and changed, routes, menu, text, pictures and design. Nothing here looks at dates or numbers.
 */
const mongoose = require('mongoose');
const TemplateVersion = require('../../models/TemplateVersion');
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const versions = require('./templateVersionService');
const store = require('./siteFileStore');
const { extractHeadings } = require('./templatePageService');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { getSite, getPage, objectId } = require('./templateSiteService');
const { NotFoundError, ValidationError } = require('../../utils/errors');

const TEXT = (file) => file.encoding !== 'base64' && /\.(jsx?|tsx?|css|json|html|svg|md)$/.test(file.path);
const DESIGN = /^(src\/index\.css|tailwind\.config\.js|src\/tokens\.json)$/;

function classify(path, pagePaths) {
  if (pagePaths.has(path)) return 'page';
  if (DESIGN.test(path)) return 'design';
  if (path.startsWith('public/')) return 'asset';
  if (path.startsWith('src/components/')) return 'component';
  if (path.startsWith('src/data/')) return 'data';
  return 'config';
}

/** Lines present in one text and not in the other (counted, not aligned: enough to say how much changed). */
function lineDelta(before = '', after = '') {
  const count = (text) => { const map = new Map(); for (const line of String(text).split('\n').map((item) => item.trim()).filter(Boolean)) map.set(line, (map.get(line) || 0) + 1); return map; };
  const a = count(before); const b = count(after);
  let added = 0; let removed = 0;
  for (const [line, n] of b) added += Math.max(0, n - (a.get(line) || 0));
  for (const [line, n] of a) removed += Math.max(0, n - (b.get(line) || 0));
  return { added, removed };
}

function navOf(source = '') {
  const start = source.search(/\bnav\s*:\s*\[/);
  if (start < 0) return [];
  let depth = 0; let end = start;
  for (let i = source.indexOf('[', start); i < source.length; i += 1) { if (source[i] === '[') depth += 1; if (source[i] === ']') { depth -= 1; if (!depth) { end = i; break; } } }
  return [...source.slice(start, end).matchAll(/label\s*:\s*['"]([^'"]+)['"]\s*,\s*to\s*:\s*['"]([^'"]+)['"]/g)].map((match) => ({ label: match[1], route: match[2] }));
}
const cssVars = (source = '') => Object.fromEntries([...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out);
  else out[prefix] = value;
  return out;
}
const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => a[key] !== b[key]).map((key) => ({ key, from: a[key] ?? null, to: b[key] ?? null }));

/** One side of a comparison: { label, files (references), pages }. */
async function sideOf(user, ref) {
  const site = await getSite(user, ref.siteId);
  if (ref.current || ref.versionId === 'current') {
    const state = await versions.currentState(site);
    return { label: `${site.name} (now)`, site, files: state.files, pages: state.pages, id: 'current', siteId: String(site._id) };
  }
  const version = await versions.getVersionDoc(site, ref.versionId);
  if (version.status !== 'complete') throw new ValidationError('That version was never saved completely.');
  return { label: `${site.name} v${version.number} "${version.name}"`, site, files: await versions.snapshotFiles(version), pages: version.pages.map((page) => (page.toObject ? page.toObject() : page)), id: String(version._id), siteId: String(site._id), number: version.number };
}

async function compare(user, aRef, bRef) {
  const [a, b] = await Promise.all([sideOf(user, aRef), sideOf(user, bRef)]);
  const pagePaths = new Set([...a.pages, ...b.pages].map((page) => page.componentPath));
  const aMap = new Map(a.files.map((file) => [file.path, file]));
  const bMap = new Map(b.files.map((file) => [file.path, file]));
  const paths = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
  const changed = paths.filter((path) => !aMap.has(path) || !bMap.has(path) || versions.shaOfFile(aMap.get(path)) !== versions.shaOfFile(bMap.get(path)));
  const textPaths = changed.filter((path) => [aMap.get(path), bMap.get(path)].every((file) => !file || TEXT(file)));
  const content = new Map();
  const wanted = [...new Set(textPaths.flatMap((path) => [aMap.has(path) ? { ...aMap.get(path), _side: 'a' } : null, bMap.has(path) ? { ...bMap.get(path), _side: 'b' } : null].filter(Boolean)))];
  for (const side of ['a', 'b']) {
    const list = wanted.filter((file) => file._side === side);
    const hydrated = await hydrateFiles(list.map(({ _side, ...file }) => file));
    for (const file of hydrated) content.set(`${side}:${file.path}`, file.content);
  }
  const textOf = (side, path) => content.get(`${side}:${path}`) || '';

  const files = changed.map((path) => {
    const status = !aMap.has(path) ? 'added' : !bMap.has(path) ? 'removed' : 'modified';
    const kind = classify(path, pagePaths);
    const delta = textPaths.includes(path) ? lineDelta(textOf('a', path), textOf('b', path)) : null;
    return { path, kind, status, ...(delta ? { linesAdded: delta.added, linesRemoved: delta.removed } : {}), ...(kind === 'asset' ? { sizeFrom: aMap.has(path) ? versions.shaOfFile(aMap.get(path)).slice(0, 8) : null, sizeTo: bMap.has(path) ? versions.shaOfFile(bMap.get(path)).slice(0, 8) : null } : {}) };
  });

  const aPages = new Map(a.pages.map((page) => [page.componentPath, page]));
  const bPages = new Map(b.pages.map((page) => [page.componentPath, page]));
  const pages = [...new Set([...aPages.keys(), ...bPages.keys()])].map((componentPath) => {
    const before = aPages.get(componentPath); const after = bPages.get(componentPath);
    const fileChanged = changed.includes(componentPath);
    const headingsBefore = before ? extractHeadings(textOf('a', componentPath)) : [];
    const headingsAfter = after ? extractHeadings(textOf('b', componentPath)) : [];
    const status = !before ? 'added' : !after ? 'removed' : (fileChanged || before.name !== after.name || before.route !== after.route || (before.description || '') !== (after.description || '')) ? 'modified' : 'unchanged';
    const delta = fileChanged ? files.find((file) => file.path === componentPath) : null;
    return {
      componentPath, status, name: after?.name || before?.name, route: after?.route || before?.route, ...(before && after && before.route !== after.route ? { routeFrom: before.route, routeTo: after.route } : {}),
      ...(before && after && before.name !== after.name ? { nameFrom: before.name, nameTo: after.name } : {}),
      headingsAdded: headingsAfter.filter((item) => !headingsBefore.includes(item)).slice(0, 8), headingsRemoved: headingsBefore.filter((item) => !headingsAfter.includes(item)).slice(0, 8),
      linesAdded: delta?.linesAdded || 0, linesRemoved: delta?.linesRemoved || 0
    };
  }).sort((x, y) => (x.status === 'unchanged') - (y.status === 'unchanged'));

  const siteJsA = textOf('a', 'src/data/site.js') || ''; const siteJsB = textOf('b', 'src/data/site.js') || '';
  const navA = navOf(siteJsA); const navB = navOf(siteJsB);
  const navigation = { before: navA, after: navB, changed: JSON.stringify(navA) !== JSON.stringify(navB) };
  const design = [];
  for (const path of changed.filter((item) => DESIGN.test(item))) {
    const [from, to] = [textOf('a', path), textOf('b', path)];
    design.push({ path, tokens: path.endsWith('.json') ? changedKeys(flatten(safeJson(from)), flatten(safeJson(to))) : changedKeys(cssVars(from), cssVars(to)), ...lineDelta(from, to) });
  }
  const assets = files.filter((file) => file.kind === 'asset').map((file) => ({ path: `/${file.path.slice('public/'.length)}`, status: file.status }));
  const count = (list, status) => list.filter((item) => item.status === status).length;
  return {
    a: { id: a.id, siteId: a.siteId, label: a.label, number: a.number || null }, b: { id: b.id, siteId: b.siteId, label: b.label, number: b.number || null },
    identical: changed.length === 0 && pages.every((page) => page.status === 'unchanged'),
    summary: { pagesAdded: count(pages, 'added'), pagesRemoved: count(pages, 'removed'), pagesModified: count(pages, 'modified'), routeChanges: pages.filter((page) => page.routeFrom).length, filesChanged: files.length, assetsChanged: assets.length, designChanged: design.length, navigationChanged: navigation.changed },
    pages, files, navigation, design, assets
  };
}

function safeJson(text) { try { return JSON.parse(text); } catch { return {}; } }

/** A page as it is now against an earlier revision of it. */
async function comparePageRevision(user, siteId, pageId, number) {
  const { site, page } = await getPage(user, siteId, pageId);
  const revision = await TemplateRevision.findOne({ siteId: site._id, pageId: page._id, number: Number(number) }).lean();
  if (!revision) throw new NotFoundError('Revision');
  const { files } = await store.readSite(site);
  const now = files.find((file) => file.path === page.componentPath)?.content || '';
  const old = revision.files.find((file) => file.path === page.componentPath && !file.deleted)?.content ?? '';
  const delta = lineDelta(old, now);
  const [before, after] = [extractHeadings(old), extractHeadings(now)];
  return {
    page: { id: String(page._id), name: page.name, route: page.route }, revision: { number: revision.number, kind: revision.kind, createdAt: revision.createdAt, instruction: revision.instruction },
    identical: old === now, linesAdded: delta.added, linesRemoved: delta.removed, headingsAdded: after.filter((item) => !before.includes(item)), headingsRemoved: before.filter((item) => !after.includes(item)),
    otherFiles: revision.files.filter((file) => file.path !== page.componentPath && !file.deleted).map((file) => file.path)
  };
}

module.exports = { compare, comparePageRevision, lineDelta, navOf };
