'use strict';

const crypto = require('node:crypto');
const { classifyPage } = require('../clone/websiteCaptureService');
const { routeKey } = require('./urlNormalizer');

// Stage 6: what pages the reference has, how they are named in the new project, which parts repeat on several pages
// (shared components), and how the navigation is organised.

const sha = (text, n = 8) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, n);
const pascal = (text) => String(text).replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Page';

function componentNameFor(route, used) {
  const base = route === '/' ? 'Home' : pascal(route.split('?')[0].split('/').filter(Boolean).slice(0, 3).join(' '));
  let name = /^[A-Z]/.test(base) ? base : `Page${base}`;
  if (['Navbar', 'Footer', 'App', 'Card', 'Modal', 'SectionHeading'].includes(name)) name = `${name}Page`;
  let candidate = name; let n = 2;
  while (used.has(candidate)) { candidate = `${name}${n++}`; }
  used.add(candidate);
  return candidate;
}

function sectionOutline(metrics, limit = 24) {
  return (metrics?.sections || []).slice(0, limit).map((s) => ({
    index: s.index, kind: s.kind, heading: s.heading, headingLevel: s.headingLevel, layout: s.columns, items: s.items, images: s.images, buttons: s.buttons,
    words: s.words, background: s.background, paddingY: s.paddingY, fullBleed: s.fullBleed, height: s.rect?.h, align: s.align
  }));
}

function buildNavigation(pages, origin) {
  const home = pages.find((p) => p.route === '/') || pages[0];
  const primary = []; const footer = []; const seen = new Set();
  const routes = new Set(pages.map((p) => p.route));
  const mapItem = (item) => { const key = routeKey(item.href, origin); return key && routes.has(key) ? { label: item.label, route: key } : null; };
  (home?.desktop?.nav || []).filter((n) => n.group === 'header').forEach((item) => {
    const entry = mapItem(item);
    if (!entry) return;
    if (item.level === 0) { if (seen.has(entry.route) || entry.route === '/' && primary.some((p) => p.route === '/')) return; seen.add(entry.route); primary.push({ ...entry, children: [] }); }
    else { const parent = primary.find((p) => p.label === item.parentLabel) || primary[primary.length - 1]; if (parent && !parent.children.some((c) => c.route === entry.route)) parent.children.push(entry); }
  });
  (home?.desktop?.nav || []).filter((n) => n.group === 'footer').forEach((item) => { const entry = mapItem(item); if (entry && !footer.some((f) => f.route === entry.route)) footer.push(entry); });
  // routes that the menu does not list directly are still reachable: add the unlisted top-level ones
  pages.filter((p) => p.route !== '/' && p.route.split('/').filter(Boolean).length === 1 && !primary.some((x) => x.route === p.route) && !footer.some((x) => x.route === p.route) && primary.length < 7).forEach((p) => primary.push({ label: p.title ? String(p.title).split(/[|–—-]/)[0].trim().slice(0, 24) : pascal(p.route), route: p.route, children: [] }));
  return { primary: primary.slice(0, 9), footer: footer.slice(0, 12) };
}

/** Header/footer and repeated section blocks that appear on several pages become shared components. */
function findSharedComponents(pages) {
  const result = [];
  const total = pages.length;
  const collect = (kind) => {
    const entries = pages.map((p) => ({ route: p.route, section: (p.desktop?.sections || []).find((s) => s.kind === kind) })).filter((e) => e.section);
    if (!entries.length) return;
    const nav = kind === 'header' ? 'header' : 'footer';
    const fingerprints = new Map();
    entries.forEach((e) => {
      const page = pages.find((p) => p.route === e.route);
      const labels = (page.desktop.nav || []).filter((n) => n.group === nav).map((n) => n.label).sort().join('|');
      const fp = sha(`${kind}|${labels}`);
      if (!fingerprints.has(fp)) fingerprints.set(fp, { routes: [], section: e.section, labels });
      fingerprints.get(fp).routes.push(e.route);
    });
    const best = [...fingerprints.values()].sort((a, b) => b.routes.length - a.routes.length)[0];
    result.push({ id: kind, kind, componentName: kind === 'header' ? 'Navbar' : 'Footer', file: `src/components/${kind === 'header' ? 'Navbar' : 'Footer'}.jsx`, pages: best.routes, coverage: Number((best.routes.length / total).toFixed(2)), variants: fingerprints.size, outline: { height: best.section.rect?.h, background: best.section.background, columns: best.section.columns, items: best.section.items, words: best.section.words } });
  };
  collect('header'); collect('footer');
  // repeated blocks (call-to-action bands, newsletter strips...) with the same heading on 2+ pages
  const blocks = new Map();
  pages.forEach((p) => (p.desktop?.sections || []).filter((s) => !['header', 'footer'].includes(s.kind) && s.heading).forEach((s) => {
    const key = sha(`${s.kind}|${s.heading.toLowerCase()}`);
    if (!blocks.has(key)) blocks.set(key, { heading: s.heading, kind: s.kind, routes: new Set(), section: s });
    blocks.get(key).routes.add(p.route);
  }));
  const used = new Set();
  [...blocks.values()].filter((b) => b.routes.size >= 2 && total >= 3).sort((a, b) => b.routes.size - a.routes.size).slice(0, 3).forEach((b) => {
    const name = `${pascal(b.heading).slice(0, 28) || 'Shared'}Section`;
    let unique = name; let n = 2; while (used.has(unique)) unique = `${name}${n++}`; used.add(unique);
    result.push({ id: `block:${sha(b.heading)}`, kind: 'block', componentName: unique, file: `src/components/${unique}.jsx`, heading: b.heading, pages: [...b.routes], coverage: Number((b.routes.size / total).toFixed(2)), outline: { kind: b.kind, items: b.section.items, images: b.section.images, buttons: b.section.buttons, words: b.section.words, background: b.section.background } });
  });
  return result;
}

/**
 * @param {Array} pages crawler pages
 * @param {{origin:string, designSystem:object, assets:object, maxBuildPages:number}} context
 */
function buildInventory(pages, { origin, assets = null, maxBuildPages = 12 } = {}) {
  const captured = (pages || []).filter((p) => p.status === 'captured' && p.desktop);
  const used = new Set();
  const slotsByRoute = new Map();
  (assets?.slots || []).forEach((s) => slotsByRoute.set(s.route, (slotsByRoute.get(s.route) || 0) + 1));
  const ordered = [...captured].sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : 0) || ((a.depth ?? 9) - (b.depth ?? 9)));
  const inventory = ordered.map((p) => {
    const componentName = componentNameFor(p.route, used);
    const headings = (p.desktop.headings || []).slice(0, 8).map((h) => ({ level: h.level, text: h.text }));
    return {
      route: p.route, url: p.url, title: p.title, description: p.desktop.description, type: classifyPage({ path: p.route, title: p.title, headings }),
      depth: p.depth, discoveredFrom: p.discoveredFrom, componentName, file: `src/pages/${componentName}.jsx`,
      sections: sectionOutline(p.desktop), mobileSections: sectionOutline(p.mobile, 24).map((s) => ({ index: s.index, kind: s.kind, layout: s.layout, height: s.height })),
      sectionCount: (p.desktop.sections || []).filter((s) => !['header', 'footer'].includes(s.kind)).length, wordCount: p.desktop.wordCount, headings, slotCount: slotsByRoute.get(p.route) || 0,
      scrollHeight: p.desktop.scrollHeight
    };
  });
  const buildList = inventory.slice(0, maxBuildPages);
  const notBuilt = inventory.slice(maxBuildPages).map((p) => ({ route: p.route, reason: `build limit (${maxBuildPages} pages)` }));
  return { pages: buildList, notBuilt, navigation: buildNavigation(captured, origin), shared: findSharedComponents(captured), counts: { captured: captured.length, toBuild: buildList.length, notBuilt: notBuilt.length } };
}

module.exports = { buildInventory, componentNameFor, findSharedComponents, buildNavigation, sectionOutline, pascal };
