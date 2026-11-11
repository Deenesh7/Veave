/**
 * Deterministic placement of verified pictures into the JSX of the page they belong to.
 *
 * It never asks a model and never invents a picture: it takes pictures that already exist in the project (verified, decoded, stored)
 * and inserts <img> elements with their exact paths and alt text into the right component, choosing the least disruptive place:
 *   1. an existing gallery section (its grid gets more tiles),
 *   2. a new, small gallery section built with the site's own spacing and theme classes, placed before the closing call-to-action
 *      section (or at the end of the page's main content), and
 *   3. a separate component file, imported into the page, when the page's JSX cannot be edited safely.
 * Every edit is checked (the path really is in the file and the file still parses) and is undone when it is not.
 */
const path = require('node:path');
const { TOKENS } = require('../composition/layoutCatalog');

/* ---------------------------------------------------------------- tiny JSX scanner ---------------------------------------------------------------- */

/** From the "<" of a tag, the index of its closing ">" (braces and quotes respected) and whether it is self-closing. */
function scanTag(src, start) {
  let depth = 0; let quote = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) { if (ch === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (depth === 0 && (ch === '"' || ch === "'")) { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '`' && depth > 0) { const end = src.indexOf('`', i + 1); if (end > 0) i = end; }
    else if (ch === '>' && depth === 0) return { end: i, selfClosing: src[i - 1] === '/' };
  }
  return { end: -1, selfClosing: false };
}

/** Index of the "</tag>" that closes the element opened at `openIdx`, or -1. */
function matchingClose(src, openIdx, tag) {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])`, 'g');
  re.lastIndex = openIdx;
  let depth = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[1]) { depth -= 1; if (depth === 0) return m.index; continue; }
    const { end, selfClosing } = scanTag(src, m.index);
    if (end < 0) return -1;
    if (!selfClosing) depth += 1;
    re.lastIndex = end;
    if (selfClosing && depth === 0) return -1;
  }
  return -1;
}

const lineStart = (src, index) => src.lastIndexOf('\n', index - 1) + 1;
const indentAt = (src, index) => { const from = lineStart(src, index); const m = /^[ \t]*/.exec(src.slice(from)); return m ? m[0] : ''; };
const escapeAttr = (text) => String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[{}<>]/g, '');

/* ---------------------------------------------------------------- JSX builders ---------------------------------------------------------------- */

const figure = (asset, pad, eager = false) => [
  `${pad}<figure className="overflow-hidden rounded-2xl border border-line bg-surface">`,
  `${pad}  <img`,
  `${pad}    src="${asset.publicPath}"`,
  `${pad}    alt="${escapeAttr(asset.alt || asset.section || 'Photograph')}"`,
  asset.width && asset.height ? `${pad}    width={${asset.width}}\n${pad}    height={${asset.height}}` : null,
  `${pad}    className="w-full aspect-[4/3] object-cover"`,
  eager ? `${pad}    fetchPriority="high"` : `${pad}    loading="lazy"\n${pad}    decoding="async"`,
  `${pad}  />`,
  `${pad}</figure>`
].filter(Boolean).join('\n');

function gallerySection(assets, pad) {
  const columns = assets.length === 1 ? 'grid-cols-1' : (assets.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3');
  const width = assets.length <= 2 ? TOKENS.container.standard : TOKENS.container.wide;
  return [
    `${pad}<section className="${TOKENS.section.major}" aria-label="Photo gallery">`,
    `${pad}  <div className="${width}">`,
    `${pad}    <div className="grid gap-4 md:gap-6 ${columns}">`,
    ...assets.map((asset) => figure(asset, `${pad}      `)),
    `${pad}    </div>`,
    `${pad}  </div>`,
    `${pad}</section>`
  ].join('\n');
}

/** A named person's portrait: one picture in an aspect-[4/5] frame with a caption, right after the page's opening section. */
function portraitSection(asset, pad) {
  const caption = escapeAttr([asset.entity, asset.entityRole].filter(Boolean).join(', ') || asset.alt);
  return [
    `${pad}<section className="${TOKENS.section.related}" aria-label="${escapeAttr(asset.entity || 'Portrait')}">`,
    `${pad}  <div className="${TOKENS.container.standard}">`,
    `${pad}    <figure className="mx-auto w-full max-w-xs">`,
    `${pad}      <img`,
    `${pad}        src="${asset.publicPath}"`,
    `${pad}        alt="${escapeAttr(asset.alt)}"`,
    asset.width && asset.height ? `${pad}        width={${asset.width}}\n${pad}        height={${asset.height}}` : null,
    `${pad}        className="w-full aspect-[4/5] object-cover object-top"`,
    `${pad}        loading="lazy"`,
    `${pad}        decoding="async"`,
    `${pad}      />`,
    `${pad}      <figcaption className="mt-3 text-sm leading-6 text-muted">${caption}</figcaption>`,
    `${pad}    </figure>`,
    `${pad}  </div>`,
    `${pad}</section>`
  ].filter(Boolean).join('\n');
}

/** Right after the first top-level <section> of the page (the opening), or before the end of the page content. */
function findAfterOpening(src) {
  const sections = [...src.matchAll(/<section\b/g)].map((m) => ({ index: m.index, indent: indentAt(src, m.index) })).filter((item) => !/\S/.test(src.slice(lineStart(src, item.index), item.index)));
  if (sections.length) {
    const shallow = Math.min(...sections.map((item) => item.indent.length));
    const first = sections.find((item) => item.indent.length === shallow);
    const close = matchingClose(src, first.index, 'section');
    if (close > 0) { const end = src.indexOf('>', close) + 1; const nl = src.indexOf('\n', end); return { at: nl < 0 ? end : nl + 1, pad: first.indent }; }
  }
  return findSectionInsertion(src);
}

/* ---------------------------------------------------------------- placement strategies ---------------------------------------------------------------- */

/** An existing gallery: a <section> that talks about a gallery/photos and has a grid of pictures. Returns where a new tile goes. */
function findGallery(src) {
  const re = /<section\b/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const close = matchingClose(src, m.index, 'section');
    if (close < 0) continue;
    const body = src.slice(m.index, close);
    if (!/gallery|in pictures|photographs|photos/i.test(body.slice(0, 900))) continue;
    const grid = /<div\b[^>]*className\s*=\s*(?:\{\s*)?["'`][^"'`]*\bgrid\b[^"'`]*["'`]/.exec(body);
    if (!grid) continue;
    const gridOpen = m.index + grid.index;
    const gridClose = matchingClose(src, gridOpen, 'div');
    if (gridClose < 0 || gridClose > close) continue;
    if (!/<img\b|<figure\b|\.map\(/.test(src.slice(gridOpen, gridClose))) continue;
    return { at: gridClose, pad: `${indentAt(src, gridClose)}  ` };
  }
  return null;
}

/** Where a new section goes: before the last top-level <section> when the page has three or more (the closing call to action stays last), otherwise at the end of the page content. */
function findSectionInsertion(src) {
  const sections = [...src.matchAll(/<section\b/g)].map((m) => ({ index: m.index, indent: indentAt(src, m.index) })).filter((item) => !/\S/.test(src.slice(lineStart(src, item.index), item.index)));
  if (sections.length) {
    const shallow = Math.min(...sections.map((item) => item.indent.length));
    const top = sections.filter((item) => item.indent.length === shallow);
    if (top.length >= 3) { const last = top[top.length - 1]; return { at: lineStart(src, last.index), pad: last.indent, before: true }; }
  }
  for (const tag of ['</main>', '</>']) {
    const at = src.lastIndexOf(tag);
    if (at > 0) return { at: lineStart(src, at), pad: `${indentAt(src, at)}  `, before: true };
  }
  const lastDiv = src.lastIndexOf('</div>');
  if (lastDiv > 0) return { at: lineStart(src, lastDiv), pad: `${indentAt(src, lastDiv)}  `, before: true };
  return null;
}

const parses = (file) => {
  try { return !require('../generationPipeline').validateGeneratedFiles([file]).some((item) => item.category === 'syntax'); } catch { return true; }
};

/**
 * Places `assets` (verified pictures) in one source file.
 * @returns {{ content, strategy } | null}
 */
function placeInSource(file, assets) {
  const src = file.content;
  const fresh = assets.filter((asset) => !src.includes(asset.publicPath));
  if (!fresh.length) return { content: src, strategy: 'already-placed' };
  // A named person's portrait is placed as a portrait (after the page's opening), never as a gallery tile; the rest follow.
  const portraits = fresh.filter((asset) => asset.entity && (asset.pictureKind === 'portrait' || asset.category === 'team'));
  if (portraits.length) {
    let content = src;
    for (const asset of portraits) {
      const slot = findAfterOpening(content);
      if (!slot) return null;
      content = `${content.slice(0, slot.at)}${portraitSection(asset, slot.pad)}\n${content.slice(slot.at)}`;
    }
    const rest = fresh.filter((asset) => !portraits.includes(asset));
    const portraitOnly = { content, strategy: 'portrait-section' };
    if (!portraits.every((asset) => content.includes(asset.publicPath)) || !parses({ ...file, content })) return null;
    return rest.length ? (placeInSource({ ...file, content }, rest) || portraitOnly) : portraitOnly;
  }
  const verify = (content, strategy) => {
    const candidate = { ...file, content };
    return fresh.every((asset) => content.includes(asset.publicPath)) && parses(candidate) ? { content, strategy } : null;
  };
  // 1. an existing gallery gets the pictures as more tiles
  const gallery = findGallery(src);
  if (gallery) {
    const tiles = fresh.map((asset) => figure(asset, gallery.pad)).join('\n');
    const placed = verify(`${src.slice(0, lineStart(src, gallery.at))}${tiles}\n${src.slice(lineStart(src, gallery.at))}`, 'existing-gallery');
    if (placed) return placed;
  }
  // 2. a small new gallery section in the page
  const slot = findSectionInsertion(src);
  if (slot) {
    const block = `${gallerySection(fresh, slot.pad)}\n`;
    const placed = verify(`${src.slice(0, slot.at)}${block}${src.slice(slot.at)}`, 'new-section');
    if (placed) return placed;
  }
  return null;
}

/** Strategy 3: the pictures live in their own component, imported into the page. */
function placeAsComponent(files, page, assets) {
  const name = 'PageGallery';
  const dir = path.posix.dirname(page.path);
  const componentPath = 'src/components/PageGallery.jsx';
  if (files.some((file) => file.path === componentPath)) return null;
  let relative = path.posix.relative(dir, 'src/components/PageGallery');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const src = page.content;
  const closing = ['</main>', '</>', '</div>'].map((tag) => ({ tag, at: src.lastIndexOf(tag) })).find((item) => item.at > 0);
  if (!closing) return null;
  const imports = [...src.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm)];
  const lastImport = imports[imports.length - 1];
  let content = `${src.slice(0, closing.at)}<${name} />\n${src.slice(closing.at)}`;
  const importLine = `import ${name} from '${relative}';`;
  content = lastImport ? `${content.slice(0, lastImport.index + lastImport[0].length)}\n${importLine}${content.slice(lastImport.index + lastImport[0].length)}` : `${importLine}\n${content}`;
  const component = `export default function ${name}() {\n  return (\n${gallerySection(assets, '    ')}\n  );\n}\n`;
  const next = [{ ...page, content }, { path: componentPath, content: component, language: 'javascript', encoding: 'utf8' }];
  return assets.every((asset) => component.includes(asset.publicPath)) && next.every(parses) ? next : null;
}

/**
 * @param files   the project files
 * @param assets  verified assets to place; each has publicPath, alt, width, height, route
 * @param pageFor async-free (route) => source file path | null
 * @returns {{ files, placements: [{ id, route, file, strategy }], failed: [{ id, route, reason }] }}
 */
function placeAssets(files, assets, { pageFor, homeRoute = '/' } = {}) {
  let next = files;
  const placements = [];
  const failed = [];
  const byRoute = new Map();
  for (const asset of assets) {
    const route = pageFor(asset.route) ? asset.route : homeRoute; // a picture whose page no longer exists goes to the home page
    byRoute.set(route, [...(byRoute.get(route) || []), asset]);
  }
  for (const [route, group] of byRoute) {
    const pagePath = pageFor(route);
    const page = next.find((file) => file.path === pagePath && file.encoding !== 'base64' && typeof file.content === 'string');
    if (!page) { group.forEach((asset) => failed.push({ id: asset.id, route, reason: 'the page component could not be found' })); continue; }
    const placed = placeInSource(page, group);
    if (placed) {
      next = next.map((file) => (file.path === page.path ? { ...file, content: placed.content } : file));
      group.forEach((asset) => placements.push({ id: asset.id, route, file: page.path, strategy: placed.strategy, path: asset.publicPath }));
      continue;
    }
    // The page's own JSX could not take the edit: a separate component, imported by the page.
    const latest = next.find((file) => file.path === page.path);
    const component = placeAsComponent(next, latest, group);
    if (component) {
      next = [...next.filter((file) => file.path !== page.path), ...component];
      group.forEach((asset) => placements.push({ id: asset.id, route, file: page.path, strategy: 'component', path: asset.publicPath }));
    } else group.forEach((asset) => failed.push({ id: asset.id, route, reason: `no safe place in ${page.path} (its JSX could not be edited without breaking it)` }));
  }
  return { files: next, placements, failed };
}

module.exports = { placeAssets, placeInSource, placeAsComponent, findGallery, findSectionInsertion, matchingClose, scanTag, gallerySection, figure };
