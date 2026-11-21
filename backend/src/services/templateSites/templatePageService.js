/**
 * Page management for a template site: add, rename, delete and reorder pages. Each operation changes the three things a page
 * consists of in step (its component file, the <Route> and the navigation data), records a revision, and either completes or leaves
 * the site exactly as it was.
 *
 * Order of work for every change: read the files -> compute the new files -> refuse anything that would break the build ->
 * write the files (only if nobody else changed the project) -> update the page records -> record the revision. If a step after the
 * file write fails, the files are put back.
 */
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateSite = require('../../models/TemplateSite');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const edit = require('./templateFiles');
const store = require('./siteFileStore');
const { getSite, getPage, cleanName, idOf } = require('./templateSiteService');
const { ConflictError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const MAX_PAGES = Number.parseInt(process.env.TEMPLATE_SITE_MAX_PAGES, 10) || 30;

async function assertNoRunningJob(siteId, pageId = null, exceptJobId = null) {
  const filter = { siteId, status: { $in: TemplateGenerationJob.ACTIVE_STATUSES }, ...(pageId ? { pageId } : {}), ...(exceptJobId ? { jobId: { $ne: exceptJobId } } : {}) };
  if (await TemplateGenerationJob.exists(filter)) throw new ConflictError(pageId ? 'This page is being regenerated. Wait for it to finish or cancel it first.' : 'A generation is running for this site. Wait for it to finish or cancel it first.');
}

/** Computes the new files, validates them, writes them. Returns what the caller needs to finish or undo the change. */
async function changeFiles(site, compute) {
  const { files: before, projectRevision } = await store.readSite(site);
  const result = compute(before);
  const { changed, previous } = store.diffFiles(before, result.files);
  if (!changed.length) return { before, after: before, changed, previous, written: null, extra: result };
  store.assertNoNewProblems(before, result.files);
  const written = await store.writeSite(site, result.files, projectRevision);
  return { before, after: result.files, changed, previous, written, extra: result };
}

async function undoFiles(site, change) {
  if (change?.written == null) return;
  try { await store.rollbackSite(site, change.before, change.written); }
  catch (error) { logger.error(`Could not put the site files back after a failed change (site ${site._id}): ${error.message}`); }
}

async function bumpSite(siteId, set = {}) {
  return TemplateSite.findOneAndUpdate({ _id: siteId }, { $inc: { revision: 1 }, ...(Object.keys(set).length ? { $set: set } : {}) }, { new: true });
}

async function siteRevision(site, user, kind, change, instruction, number) {
  return TemplateRevision.create({ siteId: site._id, pageId: null, userId: idOf(user), number, kind, instruction, files: change.changed, before: change.previous, siteRevision: number });
}

async function reindex(siteId) {
  const pages = await TemplatePage.find({ siteId }).sort({ order: 1, createdAt: 1 });
  const operations = pages.map((page, index) => ({ updateOne: { filter: { _id: page._id, order: { $ne: index } }, update: { $set: { order: index } } } }));
  if (operations.length) await TemplatePage.bulkWrite(operations);
}

function uniqueComponentName(base, pages) {
  const taken = new Set(pages.map((page) => page.componentPath.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(`src/pages/${name}.jsx`.toLowerCase()); n += 1) name = `${base}${n}`;
  return name;
}

function uniqueRoute(base, pages) {
  const taken = new Set(pages.map((page) => page.route));
  let route = base;
  for (let n = 2; taken.has(route) || route === '/'; n += 1) route = `${base === '/' ? '/page' : base}-${n}`;
  return route;
}

async function addPage({ user, siteId, name, description = '', route = null, exceptJobId = null }) {
  const site = await getSite(user, siteId);
  const pageName = cleanName(name, 'Page name', 60);
  const pages = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
  if (pages.length >= MAX_PAGES) throw new ConflictError(`A site can have at most ${MAX_PAGES} pages.`);
  await assertNoRunningJob(site._id, null, exceptJobId);

  let pageRoute;
  if (route) {
    pageRoute = edit.validateRoute(route);
    if (pageRoute === '/' || pages.some((page) => page.route === pageRoute)) throw new ConflictError(`The address ${pageRoute} is already used by another page.`);
  } else {
    const derived = edit.routeFor(pageName);
    if (derived === '/') throw new ValidationError('The page name needs at least one letter or number to make an address from.');
    pageRoute = uniqueRoute(derived, pages);
  }
  const componentName = uniqueComponentName(edit.componentNameFor(pageName), pages);
  const pageDescription = String(description || '').slice(0, 300);

  const change = await changeFiles(site, (files) => edit.addPage(files, { name: pageName, route: pageRoute, componentName, description: pageDescription }));
  let page = null;
  try {
    page = await TemplatePage.create({
      siteId: site._id, userId: site.userId, name: pageName, description: pageDescription, route: pageRoute,
      componentPath: change.extra.componentPath, order: pages.length, currentRevision: 1, revisionCount: 1
    });
    const updatedSite = await bumpSite(site._id);
    await TemplateRevision.create({
      siteId: site._id, pageId: page._id, userId: site.userId, number: 1, kind: 'page-add', instruction: `Added the ${pageName} page`,
      files: change.changed, before: change.previous, siteRevision: updatedSite.revision
    });
    return { page, warnings: change.extra.warnings || [] };
  } catch (error) {
    if (page) await TemplatePage.deleteOne({ _id: page._id }).catch(() => {});
    await undoFiles(site, change);
    if (error?.code === 11000) throw new ConflictError('A page with this address or component already exists.');
    throw error;
  }
}

async function renamePage({ user, siteId, pageId, name, description, route, exceptJobId = null }) {
  const { site, page } = await getPage(user, siteId, pageId);
  await assertNoRunningJob(site._id, page._id, exceptJobId);
  const nextName = name === undefined ? page.name : cleanName(name, 'Page name', 60);
  const nextRoute = route === undefined || route === null || route === page.route ? page.route : edit.validateRoute(route);
  if (nextRoute !== page.route) {
    if (page.route === '/') throw new ConflictError('The home page keeps the "/" address.');
    if (nextRoute === '/' || await TemplatePage.exists({ siteId: site._id, route: nextRoute, _id: { $ne: page._id } })) throw new ConflictError(`The address ${nextRoute} is already used by another page.`);
  }
  const previous = { name: page.name, route: page.route, description: page.description };
  if (!exceptJobId && nextRoute !== page.route) await require('./templateVersionService').snapshotBefore(site, user, `Before changing the address of ${page.name}`, { operation: 'change-route' });
  const change = await changeFiles(site, (files) => edit.renamePage(files, { route: page.route, name: nextName, newRoute: nextRoute !== page.route ? nextRoute : null }));
  try {
    page.name = nextName;
    page.route = nextRoute;
    if (description !== undefined) page.description = String(description || '').slice(0, 300);
    await page.save();
    if (change.changed.length) {
      const updatedSite = await bumpSite(site._id);
      await siteRevision(site, user, 'page-rename', change, `Renamed ${previous.name} to ${nextName}${nextRoute !== previous.route ? ` (${previous.route} -> ${nextRoute})` : ''}`, updatedSite.revision);
    }
    return { page };
  } catch (error) {
    await TemplatePage.updateOne({ _id: page._id }, { $set: previous }).catch(() => {});
    await undoFiles(site, change);
    if (error?.code === 11000) throw new ConflictError('Another page already uses this address.');
    throw error;
  }
}

async function deletePage({ user, siteId, pageId, exceptJobId = null }) {
  const { site, page } = await getPage(user, siteId, pageId);
  if (page.route === '/') throw new ConflictError('The home page cannot be deleted.');
  const count = await TemplatePage.countDocuments({ siteId: site._id });
  if (count <= 1) throw new ConflictError('A site needs at least one page.');
  await assertNoRunningJob(site._id, page._id, exceptJobId);
  if (!exceptJobId) await require('./templateVersionService').snapshotBefore(site, user, `Before deleting the ${page.name} page`, { operation: 'delete-page' });

  const change = await changeFiles(site, (files) => edit.removePage(files, { route: page.route, componentPath: page.componentPath }));
  try {
    await TemplatePage.deleteOne({ _id: page._id });
    await reindex(site._id);
    const home = await TemplatePage.findOne({ siteId: site._id, route: '/' }) || await TemplatePage.findOne({ siteId: site._id }).sort({ order: 1 });
    const updatedSite = await bumpSite(site._id, String(site.lastPageId) === String(page._id) ? { lastPageId: home?._id || null } : {});
    await siteRevision(site, user, 'page-delete', change, `Deleted the ${page.name} page`, updatedSite.revision);
    return { deleted: true, retargeted: change.extra.retargeted || [] };
  } catch (error) {
    await TemplatePage.updateOne({ _id: page._id }, { $setOnInsert: page.toObject() }, { upsert: true }).catch(() => {});
    await undoFiles(site, change);
    throw error;
  }
}

async function reorderPages({ user, siteId, pageIds, exceptJobId = null }) {
  const site = await getSite(user, siteId);
  const pages = await TemplatePage.find({ siteId: site._id });
  const wanted = (Array.isArray(pageIds) ? pageIds : []).map(String);
  const existing = pages.map((page) => String(page._id)).sort();
  if (wanted.length !== existing.length || [...new Set(wanted)].sort().join() !== existing.join()) {
    throw new ValidationError('The new order must list every page of the site exactly once.');
  }
  await assertNoRunningJob(site._id, null, exceptJobId);
  const byId = new Map(pages.map((page) => [String(page._id), page]));
  const routes = wanted.map((id) => byId.get(id).route);
  const change = await changeFiles(site, (files) => edit.reorderNav(files, routes));
  const previousOrder = pages.map((page) => [page._id, page.order]);
  try {
    await TemplatePage.bulkWrite(wanted.map((id, index) => ({ updateOne: { filter: { _id: id, siteId: site._id }, update: { $set: { order: index } } } })));
    if (change.changed.length) {
      const updatedSite = await bumpSite(site._id);
      await siteRevision(site, user, 'page-reorder', change, 'Reordered the pages', updatedSite.revision);
    }
    return { pages: await TemplatePage.find({ siteId: site._id }).sort({ order: 1 }) };
  } catch (error) {
    await TemplatePage.bulkWrite(previousOrder.map(([id, order]) => ({ updateOne: { filter: { _id: id }, update: { $set: { order } } } }))).catch(() => {});
    await undoFiles(site, change);
    throw error;
  }
}

async function listPagesFor(site) {
  return TemplatePage.find({ siteId: site._id }).sort({ order: 1, createdAt: 1 });
}

/** The section headings of a page's source, in document appearance order. */
function extractHeadings(source) {
  const matches = [];

  // 1. Match SectionHeading, Heading, CTA, Hero, Banner titles/headings
  for (const m of source.matchAll(/<(?:SectionHeading|Heading|CTA|Hero|Banner|SectionHeader|PageHeader)[^>]*?\b(?:title|heading)=(?:"([^"]+)"|\{?['"`]([^'"`]+)['"`]\}?)/gi)) {
    matches.push({ index: m.index, text: m[1] || m[2] });
  }

  // 2. Match h1, h2, h3, h4 (including multi-line and inner elements like <span>, <strong>, etc.)
  for (const m of source.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const raw = m[2].replace(/<[^>]+>/g, ' ').replace(/\{[^}]+\}/g, ' ').replace(/\s+/g, ' ').trim();
    if (raw && raw.length <= 120 && !raw.startsWith('http')) {
      matches.push({ index: m.index, text: raw });
    }
  }

  // 3. Match section / Section with aria-label or title
  for (const m of source.matchAll(/<(?:section|Section)[^>]*?\b(?:aria-label|title)=(?:"([^"]+)"|\{?['"`]([^'"`]+)['"`]\}?)/gi)) {
    matches.push({ index: m.index, text: m[1] || m[2] });
  }

  // 4. Match section / Section / div with id or name
  for (const m of source.matchAll(/<(?:section|Section|div)[^>]*?\b(?:id|name)=(?:"([^"]+)"|\{?['"`]([^'"`]+)['"`]\}?)/gi)) {
    const raw = m[1] || m[2];
    if (raw && !['root', 'app', 'main', 'container', 'wrapper', 'page', 'content'].includes(raw.toLowerCase())) {
      const text = raw.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
      matches.push({ index: m.index, text });
    }
  }

  // 5. Match JSX section comments e.g. {/* Hero Section */} or {/* Testimonials */}
  for (const m of source.matchAll(/\{\/\*\s*([A-Za-z0-9\s&,/-]{2,50}?)(?:\s+(?:Section|Block|Area))?\s*\*\/\}/gi)) {
    const text = m[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    if (text && !['End', 'Start', 'Comment', 'Todo', 'Note'].includes(text)) {
      matches.push({ index: m.index, text });
    }
  }

  // 6. Match common Section components e.g. <Features />, <Testimonials />, <Pricing />
  const COMPONENT_REGEX = /<((?:Hero|About|Services|Process|Features|Testimonials|Team|Stats|Pricing|FAQ|Faq|Contact|CTA|Portfolio|Gallery|Blog|Newsletter|Values|Timeline|History|Partners|Clients|Work|CaseStudies|Showcase|Reviews|ContactForm|CallToAction|Benefits|Comparison|HowItWorks)[A-Za-z0-9]*)\b[^>]*\/?>/g;
  for (const m of source.matchAll(COMPONENT_REGEX)) {
    const hasExistingMatch = matches.some((item) => item.index >= m.index && item.index < m.index + m[0].length);
    if (!hasExistingMatch) {
      const compName = m[1];
      const text = compName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      matches.push({ index: m.index, text });
    }
  }

  // 7. Look for section / Section blocks without explicit headings (e.g. stats, logos, partners, faq, form)
  for (const m of source.matchAll(/<(?:section|Section)(?:[^>]*?)>([\s\S]*?)<\/(?:section|Section)>/gi)) {
    const content = m[1];
    const hasExistingMatch = matches.some((item) => item.index >= m.index && item.index < m.index + m[0].length);
    if (!hasExistingMatch) {
      if (/\b(stat|stats|metrics)\b/i.test(content)) {
        matches.push({ index: m.index, text: 'Key Statistics' });
      } else if (/\b(logo|logos|partners|clients)\b/i.test(content)) {
        matches.push({ index: m.index, text: 'Partners & Logos' });
      } else if (/\b(faq|questions)\b/i.test(content)) {
        matches.push({ index: m.index, text: 'Frequently Asked Questions' });
      } else if (/<form\b/i.test(content)) {
        matches.push({ index: m.index, text: 'Contact Form' });
      }
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const found = [];
  for (const item of matches) {
    const text = String(item.text || '').replace(/\s+/g, ' ').trim();
    if (text && text.length <= 120 && !found.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
      found.push(text);
    }
  }

  return found.slice(0, 50);
}

const SECTION_ATTRS = '((?:"[^"]*"|\'[^\']*\'|\\{(?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*\\}|[^>"\'{}])*)';
const NOT_A_SECTION_IMPORT = /\/(?:data|utils?|hooks?|lib|context|store|assets|constants|config|services?)(?:\/|$)|\.(?:css|scss|json|png|jpe?g|svg|webp|gif|avif|js)$/i;
const SHARED_CHROME = /^(?:Layout|Navbar|Navigation|Nav|NavBar|Header|SiteHeader|Footer|SiteFooter|Outlet|Link|NavLink|Helmet|Seo|SEO|Meta|ScrollToTop|Reveal|Motion|Container|Wrapper)$/;

const wordsOf = (value) => String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
const plainText = (markup) => String(markup || '').replace(/<[^>]+>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const attrOf = (attrs, name) => {
  const m = new RegExp(`\\b${name}=(?:"([^"]+)"|'([^']+)'|\\{\\s*['"\`]([^'"\`]+)['"\`]\\s*\\})`, 'i').exec(attrs || '');
  return m ? (m[1] || m[2] || m[3]) : null;
};

/**
 * The sections of one page, in the order they appear, read from whatever the page's source really contains. Nothing is assumed about
 * names or templates: a section is an inline <section> block, or a component the page imports from its own project and renders.
 * Returns [{ id, name, kind, domId, order }] with ids that stay the same while the section stays in the same place
 * (the element's own id when it has one, otherwise a slug of its name plus a counter for duplicates). Returns [] when the source has
 * neither, so the caller can say so honestly instead of inventing sections.
 */
function extractSections(source, { withRanges = false } = {}) {
  const text = String(source || '');
  const found = [];

  // 1. Inline <section> blocks. An outer section ends where its first nested section starts, so nested ones are listed too.
  const opens = [...text.matchAll(new RegExp(`<(?:section|Section)\\b${SECTION_ATTRS}>`, 'g'))];
  const ranges = [];
  opens.forEach((open, i) => {
    const start = open.index;
    const nextOpen = i + 1 < opens.length ? opens[i + 1].index : text.length;
    const closeSection = text.slice(start).search(/<\/(?:section|Section)>/);
    const end = Math.min(nextOpen, closeSection >= 0 ? start + closeSection + 10 : text.length);
    const attrs = open[1];
    const body = text.slice(start, end);
    let name = attrOf(attrs, 'aria-label') || attrOf(attrs, 'title');
    if (!name) { const h = /<h([12])[^>]*>([\s\S]*?)<\/h\1>/i.exec(body) || /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(body); const t = h && plainText(h[2] || h[1]); if (t && t.length <= 120) name = t; }
    if (!name) { const m = /<(?:SectionHeading|Heading|SectionHeader|PageHeader)[^>]*?\b(?:title|heading)=(?:"([^"]+)"|\{?['"`]([^'"`]+)['"`]\}?)/i.exec(body); if (m) name = m[1] || m[2]; }
    const domId = attrOf(attrs, 'id');
    if (!name && domId) name = wordsOf(domId);
    if (!name) {
      if (/\b(stat|stats|metrics)\b/i.test(body)) name = 'Key Statistics';
      else if (/\b(logo|logos|partners|clients)\b/i.test(body)) name = 'Partners & Logos';
      else if (/\b(faq|questions)\b/i.test(body)) name = 'Frequently Asked Questions';
      else if (/<form\b/i.test(body)) name = 'Contact Form';
    }
    ranges.push([start, end]);
    found.push({ index: start, end, name: name || null, kind: 'section', domId: domId || null });
  });

  // 2. Components this page imports from its own project and renders (a page built from section components keeps the sections in
  // other files). Anything inside an inline section already belongs to that section.
  const local = new Map(); // local name -> the name it was exported under
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) if (!NOT_A_SECTION_IMPORT.test(m[2])) local.set(m[1], m[1]);
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) if (!NOT_A_SECTION_IMPORT.test(m[2])) for (const part of m[1].split(',')) { const [original, alias] = part.split(/\s+as\s+/i).map((x) => x.trim()); const name = alias || original; if (/^[A-Z]/.test(name)) local.set(name, original); }
  for (const m of text.matchAll(/<([A-Z][A-Za-z0-9]*)\b(?:[^>]*?\b(?:title|heading|label)=(?:"([^"]+)"|\{?['"`]([^'"`]+)['"`]\}?))?/g)) {
    if (!local.has(m[1]) || SHARED_CHROME.test(m[1])) continue;
    if (ranges.some(([a, b]) => m.index > a && m.index < b)) continue;
    found.push({ index: m.index, end: null, name: m[2] || m[3] || wordsOf(local.get(m[1])), kind: 'component', domId: null });
  }

  found.sort((a, b) => a.index - b.index);
  const seen = new Map();
  return found.slice(0, 60).map((item, order) => {
    const name = String(item.name || `Section ${order + 1}`).replace(/\s+/g, ' ').trim().slice(0, 120);
    const base = (item.domId || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { id: count === 1 ? base : `${base}-${count}`, name, kind: item.kind, domId: item.domId, order, ...(withRanges ? { index: item.index, end: item.end } : {}) };
  });
}

/**
 * The source of every section of a page, as the panel numbers them (the same order as extractSections): [{ number, name, source }].
 * A section's source runs from where it starts to where the next one starts (the last one to the end of its own block / tag).
 */
function sectionBlocks(source) {
  const text = String(source || '');
  const list = extractSections(text, { withRanges: true });
  // Items that start at the same place are the same block of source (the panel numbers each of them).
  const starts = [...new Set(list.map((item) => item.index))].sort((x, y) => x - y);
  return starts.map((start, i) => {
    const items = list.map((item, k) => ({ item, number: k + 1 })).filter((entry) => entry.item.index === start);
    const inline = items.find((entry) => entry.item.kind === 'section')?.item;
    const next = starts[i + 1];
    let end = next ?? inline?.end ?? text.length;
    if (next === undefined && !inline) { const close = text.indexOf('/>', start); end = close >= 0 ? close + 2 : text.length; }
    return { numbers: items.map((entry) => entry.number), number: items[0].number, name: (inline || items[0].item).name, source: text.slice(start, end) };
  });
}

/**
 * What a page currently shows, as [{ id, name, kind, domId, order }]. Read from the page's own component file first; when that has no
 * recognisable structure the plan's description and then the template's own list are used (both are real data, never invented).
 */
async function describeSectionItems(site, page) {
  let items = [];
  try {
    const clean = (p) => String(p || '').replace(/^\/+/, '');
    const targetPath = clean(page.componentPath);
    const project = await require('../../models/Project').findOne({ _id: site.projectId }, { files: 1 }).lean();
    const stored = (project?.files || []).find((f) => clean(f.path) === targetPath || f.path === page.componentPath);
    if (stored) {
      const file = await require('../storage/s3BlobStorage').hydrateFile(stored);
      const source = String(file.content || '');
      items = extractSections(source);
      if (!items.length) items = namesToItems(extractHeadings(source));
    }
  } catch (error) { logger.warn(`Sections of page ${page?._id} could not be read: ${error.message}`); }

  if (!items.length && page?.description) items = namesToItems(page.description.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean));

  if (!items.length && site?.templateId) {
    try {
      const template = require('../templates/templateService').resolveTemplate(site.templateId, { user: { _id: site.userId } });
      const tPage = template?.pages?.find((p) => p.path === page.route || p.file === page.componentPath);
      if (Array.isArray(tPage?.sections) && tPage.sections.length) items = namesToItems(tPage.sections.filter(Boolean));
    } catch (error) { logger.warn(`Template sections for page ${page?._id} could not be read: ${error.message}`); }
  }
  return items;
}

function namesToItems(names) {
  const seen = new Map();
  return names.map((raw, order) => {
    const name = String(raw).replace(/\s+/g, ' ').trim().slice(0, 120);
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { id: count === 1 ? base : `${base}-${count}`, name, kind: 'heading', domId: null, order };
  });
}

/** The same sections, names only (the older shape). */
async function describeSections(site, page) {
  return (await describeSectionItems(site, page)).map((item) => item.name);
}

module.exports = { extractHeadings, extractSections, sectionBlocks, describeSectionItems, describeSections, listPagesFor, addPage, renamePage, deletePage, reorderPages, MAX_PAGES, assertNoRunningJob, changeFiles, undoFiles, bumpSite, reindex };
