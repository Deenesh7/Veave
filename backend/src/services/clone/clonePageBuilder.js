/**
 * The cloner's page builder: the model prompts and one-stage page generation (`generateSequentialClonePage`), the stage plan,
 * the text-coverage measures, the repair and quarantine helpers, and the fill / re-clone flows built on them.
 *
 * Moved out of jobManager unchanged in behaviour.
 */
const openrouterService = require('../ai/openrouterService');
const aiProtocol = require('../ai/aiProtocol');
const generationPipeline = require('../ai/generationPipeline');
const clonePromptBudget = require('./clonePromptBudget');
const { autoFix } = require('../ai/autoFix');
const { repairStrayIdentifiers } = require('../ai/strayIdentifiers');
const assetManifestLib = require('./assetManifest');
const { resolveRouteLimit } = require('./websiteCaptureService');
const logger = require('../../utils/logger');
const { AIResponseValidationError } = require('../../utils/errors');
const { withTransientRetry } = require('../ai/jobSupport/retry');
const realPageFillWorker = require('../ai/workers/realPageFillWorker');
const { completeOpenRouterResponse } = require('../ai/jobSupport/completion');

const CLONE_STYLING_RULES = `STYLING RULES (MANDATORY - TAILWIND CSS ONLY):
- Style every element with Tailwind CSS utility classes in className. Do NOT create or modify per-page, per-component or global .css files (no AboutPage.css, no styles.css, no CSS modules, no styled-components, no <style> blocks). The only stylesheet is src/index.css, which already contains the @tailwind directives.
- Reproduce exact measured values with Tailwind arbitrary values, for example w-[1354px], h-[647.656px], text-[47.104px], leading-[61.1975px], tracking-[0.02em], bg-[#d9d9d9], text-[#000], gap-[24px], p-[12px_18px], rounded-[4px], shadow-[0_2px_8px_rgba(0,0,0,0.2)], aspect-[320.05/213.36], object-[50%_50%].
- Express captured media queries with responsive variants (sm: md: lg: xl: or arbitrary min-[768px]: and max-[767px]:), and interactions with hover:, focus:, group-hover: and transition utilities.
- Put captured fonts and brand colors in tailwind.config.js (theme.extend.fontFamily, colors, spacing) or use font-['Family',Arial,sans-serif]. Declare @font-face and @keyframes only inside src/index.css (@layer base or utilities) when Tailwind has no equivalent.
- Share repeated class strings through small components or constants, never through new CSS class names.`;

const CLONE_VISUAL_FIDELITY_RULES = `SOURCE-FIRST RECONSTRUCTION RULES:
- Navigation: when the route changes, the new page must open at its top. If the app uses react-router, render a small ScrollToTop component inside the router that calls window.scrollTo(0, 0) in an effect on location.pathname (skip it when the URL has a #hash).
- Treat the extracted HTML, DOM hierarchy, CSS rules, computed-style manifest, content, routes, and asset associations as the source of truth. They override screenshots and generic design-system preferences.
- Reproduce the exact font families and fallback stacks where available, with captured weights, sizes, line-heights, letter-spacing, casing, alignment, and text colors for each element role.
- Reuse captured CSS colors, gradients, backgrounds, borders, radii, and shadows. Do not choose merely similar values when an actual value is present.
- Treat each page's captured computed palette as mandatory. Do not substitute generic theme colors, the Tailwind default palette, or approximate brand shades: use the exact captured values as Tailwind arbitrary values (for example bg-[#d9d9d9]).
- Preserve the page hierarchy and component count. Do not add, remove, merge, split, modernize, or reorder sections, cards, containers, headings, paragraphs, rows, or columns.
- Preserve measured header, hero, section, card, image, button, and container dimensions plus alignment, padding, margins, and gaps. Never use browser zoom to hide structural mismatch.
- Preserve text wrapping by matching container width and font metrics before adjusting any typography.
- Preserve image rendered rectangles, aspect ratios, object-fit, object-position, and crop.
- Preserve click behavior. When a captured image or element has link, wrap it in a real anchor using link.resolvedHref (an asset token for a downloaded document such as a PDF, a cloned route path, or the original URL), with target="_blank" rel="noopener noreferrer" for documents and external links. Never replace such a link with href="#", preventDefault, or a dead handler. Documents in the asset catalog (isDocument) are local files under /assets/documents/ and must be linked, never rendered as images.
- Apply available assets in placement-queue order. Never reference an entry marked unavailable; remove unsupported decorative references rather than fabricating files or substituting unrelated assets.
- Reconstruct responsive behavior from extracted media queries and mobile computed styles. Never invent a generic mobile stack.
- Screenshots, when available, are optional verification evidence only and must never replace or contradict extracted source information.
- Before finishing, compare typography, colors, hierarchy, section count, dimensions, spacing, wrapping, navigation, and footer against the extracted source package.

${CLONE_STYLING_RULES}`;


function resolveCloneRouteLimit(requestedMaxRoutes) {
  const requested = Number.parseInt(requestedMaxRoutes, 10);
  return resolveRouteLimit(requested);
}

function resolveCloneVisualThresholds() {
  const configuredTarget = Number.parseFloat(process.env.CLONE_VISUAL_THRESHOLD);
  const target = Number.isFinite(configuredTarget) && configuredTarget >= 0 && configuredTarget <= 1 ? configuredTarget : 0.8;
  const configuredMinimum = Number.parseFloat(process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE);
  const minimum = Number.isFinite(configuredMinimum) && configuredMinimum >= 0 && configuredMinimum <= 1
    ? Math.min(configuredMinimum, target)
    : Math.min(0.5, target);
  return { target, minimum };
}

function isAcceptableCloneVisualFallback(comparison, thresholds = resolveCloneVisualThresholds()) {
  return Number.isFinite(comparison?.score) && comparison.score >= thresholds.minimum;
}

function getExpectedPageHeading(page) {
  const headings = Array.isArray(page?.headings) ? page.headings : [];
  return headings.find((heading) => String(heading?.level || '').toUpperCase() === 'H1' && heading.text)?.text ||
    headings.find((heading) => heading?.text)?.text || String(page?.title || '').split(/\s+-\s+/)[0].trim();
}

function getExpectedPageColors(page) {
  const design = page?.design || {};
  return [...new Set([
    design.color,
    design.background,
    ...(Array.isArray(design.palette) ? design.palette : [])
  ].filter((value) => value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'))].slice(0, 8);
}

function cloneContentHtml(page = {}) {
  return (page.extraction?.htmlSections || [])
    .filter((section) => classifyCloneAssetSection(section, page) === 'content')
    .map((section) => section.html)
    .filter(Boolean)
    .join('\n');
}

// 'page' = whole route in one call, 'top' = header + hero together, 'footer'/'page' are the final (validated) stages.
const FINAL_CLONE_PHASES = new Set(['footer', 'page']);
function isFinalClonePhase(phase) { return FINAL_CLONE_PHASES.has(phase); }

// Render findings that describe HOW a page looks, not that it is broken. After the repair attempts are used up, a page
// that renders with these is kept (with a warning) instead of being dropped by the guard rails.
function cloneItemInPhase(item, page, phase) {
  if (phase === 'page') return true;
  const section = classifyCloneAssetSection(item, page);
  if (phase === 'top') return section === 'header' || section === 'hero';
  return section === phase;
}

function buildCloneImplementationStages(pages = [], { forceSections = false } = {}) {
  const chunkSize = Number.parseInt(process.env.CLONE_CONTENT_CHUNK_CHARS, 10) || 60000;
  const singlePassLimit = Number.parseInt(process.env.CLONE_SINGLE_PASS_CHARS, 10) || 90000;
  return pages.flatMap((page) => {
    const pageLength = simplifyCloneHtml(page.extraction?.html || '', { keepClass: true }).length;
    // A small route is built in ONE call instead of four.
    if (!forceSections && pageLength && pageLength <= singlePassLimit) return [{ page, phase: 'page' }];
    // A very large content area is built in several parts so none of it is truncated or dropped.
    const contentLength = simplifyCloneHtml(cloneContentHtml(page), { keepClass: true }).length;
    const parts = Math.min(10, Math.max(1, Math.ceil(contentLength / chunkSize)));
    return [
      { page, phase: 'top' },
      ...Array.from({ length: parts }, (_, index) => ({ page, phase: 'content', contentChunk: { index, total: parts } })),
      { page, phase: 'footer' }
    ];
  });
}

function classifyCloneAssetSection(item = {}, page = {}) {
  const context = JSON.stringify([item.section, item.element, item.selector, item.tag, item.heading, item.className]).toLowerCase();
  if (/footer|site-footer/.test(context)) return 'footer';
  if (/header|navbar|navigation|site-logo|brand-logo/.test(context)) return 'header';
  if (/hero|banner|masthead|carousel|slider|jumbotron/.test(context)) return 'hero';
  const documentY = Number(item.rect?.documentY);
  const viewportHeight = Number(page.viewport?.height) || 900;
  const itemHeight = Number(item.rect?.height);
  const isTallSection = Number.isFinite(itemHeight) && itemHeight > viewportHeight * 1.5;
  if (Number.isFinite(documentY) && documentY < viewportHeight * 1.25 && !isTallSection) return 'hero';
  return 'content';
}

function selectCloneSectionAssets(page = {}, assets = [], phase = 'content') {
  const paths = new Set((page.assetQueue || [])
    .filter((item) => item.publicPath && cloneItemInPhase(item, page, phase))
    .map((item) => item.publicPath));
  return assets.filter((asset) => paths.has(asset.publicPath));
}

function resolveClonePageDuration() {
  const configured = Number.parseInt(process.env.CLONE_PAGE_MAX_DURATION_MS, 10);
  return Number.isFinite(configured) && configured > 0 ? Math.max(60000, configured) : 8 * 60 * 1000;
}

// Veave runs one model, GPT-6 Luna, through OpenRouter for creation, cloning and edits. The requested name is ignored.
function resolveGenerationModel() {
  return 'Veave AI';
}

function compactClonePageSource(files = [], pagePath = '/', maxChars = 2 * 1024 * 1024, { focusPaths = [], phase = 'content' } = {}) {
  const slug = String(pagePath).split('?')[0].split('/').filter(Boolean).at(-1) || 'home';
  const slugPattern = new RegExp(slug.replace(/[^a-z0-9]/gi, '.*'), 'i');
  const focus = new Set(focusPaths);
  // Only what this stage can actually change is sent in full; everything else is listed by name.
  const priority = (file) => {
    const filePath = file.path;
    if (/^src\/App\.(?:jsx?|tsx?)$/i.test(filePath)) return 0;
    if (/(?:^|\/)(?:router|routes|navigation|siteData)\.(?:jsx?|tsx?|json)$/i.test(filePath)) return 1;
    if (/(?:^|\/)(?:Header|Navbar|Footer|.*Layout|.*Shell)\.(?:jsx?|tsx?)$/i.test(filePath)) return phase === 'content' ? 9 : 2;
    if (focus.has(filePath) || slugPattern.test(filePath)) return 3;
    if (/^src\/(?:styles|index)\.css$/i.test(filePath)) return 3;
    if (/^src\/pages\//i.test(filePath) && String(file.content || '').length < 4000) return 3;
    return 9;
  };
  const candidates = files
    .filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json' && priority(file) < 9)
    .sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  const compacted = [];
  let used = 0;
  for (const file of candidates) {
    let content = String(file.content || '');
    if (content.length > 400000) content = `${content.slice(0, 200000)}\n/* VEAVE CONTEXT COMPACTED */\n${content.slice(-200000)}`;
    const cost = file.path.length + content.length + 50;
    if (used + cost > maxChars) continue;
    compacted.push({ path: file.path, content });
    used += cost;
  }
  return compacted;
}

function trimCloneStyles(styles = {}) {
  let budget = Number.parseInt(process.env.CLONE_STYLE_BUDGET_CHARS, 10) || 120000;
  const take = (item) => {
    const size = JSON.stringify(item).length;
    if (size > budget) return false;
    budget -= size;
    return true;
  };
  return {
    styleSheets: (styles.styleSheets || []).map((sheet) => ({ ...sheet, rules: (sheet.rules || []).slice(0, 1000).filter(take) })),
    responsiveRules: (styles.responsiveRules || []).slice(0, 200).filter((rule) => take({ ...rule, cssText: String(rule.cssText || '').slice(0, 1500) }))
      .map((rule) => ({ ...rule, cssText: String(rule.cssText || '').slice(0, 1500) }))
  };
}

function compactClonePageAnalysis(page = {}) {
  return {
    path: page.path,
    title: page.title,
    description: page.description,
    pageType: page.pageType,
    discoveredFrom: page.discoveredFrom,
    headings: (page.headings || []).slice(0, 40),
    sections: (page.sections || []).slice(0, 60),
    controls: (page.controls || []).slice(0, 60),
    viewport: page.viewport,
    document: page.document,
    design: page.design,
    visualElements: (page.visualElements || []).slice(0, 220),
    extraction: page.extraction ? {
      mode: page.extraction.mode,
      html: String(page.extraction.html || '').slice(0, 600000),
      domHierarchy: (page.extraction.domHierarchy || []).slice(0, 250),
      htmlSections: (page.extraction.htmlSections || []).slice(0, 300)
    } : null,
    styles: page.styles ? trimCloneStyles(page.styles) : null,
    responsive: page.responsive,
    images: (page.images || []).filter((image) => image.localPath || String(image.src || '').startsWith('__VEAVE_CLONE_ASSET_')).slice(0, 150),
    assetQueue: (page.assetQueue || []).slice(0, 300),
    repairDiagnostics: page.repairDiagnostics
  };
}

function compactCloneInitialAnalysis(page = {}) {
  const analysis = compactClonePageAnalysis(page);
  const isEntryPage = page.path === '/';
  if (analysis.extraction) {
    analysis.extraction.html = analysis.extraction.html.slice(0, isEntryPage ? 40000 : 5000);
    analysis.extraction.domHierarchy = analysis.extraction.domHierarchy.slice(0, isEntryPage ? 80 : 30);
    analysis.extraction.htmlSections = analysis.extraction.htmlSections.slice(0, isEntryPage ? 30 : 12).map((section) => ({
      ...section,
      html: String(section.html || '').slice(0, isEntryPage ? 8000 : 1500)
    }));
  }
  if (analysis.styles) {
    analysis.styles.styleSheets = analysis.styles.styleSheets.map((sheet) => ({
      ...sheet,
      rules: (sheet.rules || []).slice(0, isEntryPage ? 80 : 20).map((rule) => ({ ...rule, cssText: String(rule.cssText || '').slice(0, 1500) }))
    }));
    analysis.styles.responsiveRules = analysis.styles.responsiveRules.slice(0, isEntryPage ? 40 : 10).map((rule) => ({
      ...rule,
      cssText: String(rule.cssText || '').slice(0, 2000)
    }));
  }
  return analysis;
}

function parseInitialProjectResponse(response, existingFiles = []) {
  const parsed = aiProtocol.parseAIResponse(response, 'src/App.jsx');
  const validated = aiProtocol.validateFileOperations(parsed, existingFiles);
  const applied = aiProtocol.applyOperationsSafely(existingFiles, validated.files);
  // Self-correct before judging: supply the standard files the scaffolder adds later (hooks, utils), fix case/extension
  // import slips and missing exports. Missing pages are NOT stubbed here, so the retry can still ask the model for them.
  let files = applied.files;
  try { files = autoFix(applied.files, { stubMissing: false }).files; } catch { files = applied.files; }
  const appFile = files.find((file) => file.path === 'src/App.jsx');
  const modularFiles = files.filter((file) => /^src\/(?:pages|components)\//.test(file.path));
  const moduleDiagnostics = appFile
    ? generationPipeline.validateGeneratedFiles(files).filter((item) => ['import', 'export', 'architecture'].includes(item.category))
    : [];
  let validationError = null;
  if (!appFile) validationError = new AIResponseValidationError('Initial generation did not create src/App.jsx.');
  else if (appFile.content.split('\n').length > 500) validationError = new AIResponseValidationError('Initial generation returned an oversized App.jsx instead of a modular project.');
  else if (!modularFiles.length) validationError = new AIResponseValidationError('Initial generation did not create separate page or component files.');
  else if (moduleDiagnostics.length) validationError = new AIResponseValidationError(`Initial generation has incomplete local modules:\n${generationPipeline.formatDiagnostics(moduleDiagnostics)}`);
  if (validationError) {
    validationError.partialFiles = files;
    throw validationError;
  }
  return files;
}

function decodeCloneEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;|&#0?39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10) || 32));
}

function normalizeCoverageText(text) {
  return decodeCloneEntities(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function extractCloneTextBlocks(html) {
  const stripped = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  const seen = new Set();
  const blocks = [];
  for (const line of decodeCloneEntities(stripped).split('\n')) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text.length < 20 || text.split(' ').length < 3) continue;
    const key = normalizeCoverageText(text);
    if (key.length < 15 || seen.has(key)) continue;
    seen.add(key);
    blocks.push({ text, key });
  }
  return blocks;
}

function cloneTextCorpus(files) {
  return normalizeCoverageText(files
    .filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json' && /\.(?:jsx?|tsx?|json|html|md)$/i.test(file.path || ''))
    .map((file) => String(file.content || ''))
    .join('\n'));
}

// Which text blocks of this piece of real markup are absent from the project source.
function measureHtmlCoverage(html, files, corpus = cloneTextCorpus(files)) {
  const blocks = extractCloneTextBlocks(html);
  const missing = blocks.filter((block) => !corpus.includes(block.key));
  return { total: blocks.length, missing, ratio: blocks.length ? (blocks.length - missing.length) / blocks.length : 1 };
}

function measureCloneTextCoverage(page, files) {
  const blocks = extractCloneTextBlocks(page?.extraction?.html);
  const corpus = normalizeCoverageText(files
    .filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json' && /\.(?:jsx?|tsx?|json|html|md)$/i.test(file.path || ''))
    .map((file) => String(file.content || ''))
    .join('\n'));
  const missing = blocks.filter((block) => !corpus.includes(block.key));
  return { total: blocks.length, missing, ratio: blocks.length ? (blocks.length - missing.length) / blocks.length : 1 };
}

function simplifyCloneHtml(html, { keepClass = false } = {}) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (_, tag, attrs) => {
      const kept = [...attrs.matchAll(keepClass ? /\s(href|src|alt|class)=("[^"]*"|'[^']*')/gi : /\s(href|src|alt)=("[^"]*"|'[^']*')/gi)]
        .filter((match) => !/^["']data:/i.test(match[2]))
        .map((match) => ` ${match[1].toLowerCase()}=${match[1].toLowerCase() === 'class' ? match[2].slice(0, 80) + match[2][0] : match[2]}`)
        .join('');
      return `<${tag}${kept}>`;
    })
    .replace(/\s+/g, ' ');
}

function buildCloneCoverageDiagnostics(coverage, page, previousFailure = '') {
  const pct = Math.round(coverage.ratio * 100);
  const sample = coverage.missing.slice(0, 40).map((block) => `- ${block.text.slice(0, 200)}`).join('\n');
  return `Content coverage ${pct}%: the page ${page.path} contains only ${coverage.total - coverage.missing.length} of ${coverage.total} captured text blocks (${coverage.missing.length} missing). Add EVERY missing section to this page in source order, using MISSING CONTENT HTML as the authoritative source: keep the exact text, links, headings, lists and local images. Keep all existing sections. Put repeated items (cards, news, lists, tables) into a data array in a separate module under src/data and map over it so files stay compact. Do not summarize, shorten or invent content. The first missing text blocks are:\n${sample}${previousFailure ? `\nThe previous completion attempt was rejected: ${previousFailure}` : ''}`;
}

// ---------------------------------------------------------------------------
// Guard rails: when a generated section keeps failing after every repair attempt we never ship it and
// never fail the whole clone for it. The broken module is replaced by an inert stub (or the whole
// stage is rolled back) and cloning continues with the remaining sections.
// ---------------------------------------------------------------------------
const CLONE_PROTECTED_PATHS = /^(?:src\/(?:App|main)\.(?:jsx?|tsx?)|index\.html|package\.json|src\/index\.css|vite\.config\.[jt]s)$/i;

function isStubbableCloneFile(file) {
  return Boolean(file) && file.encoding !== 'base64' && !CLONE_PROTECTED_PATHS.test(file.path || '') && /\.(?:jsx|tsx|css)$/i.test(file.path || '');
}

function buildQuarantineStub(file, reason) {
  const note = String(reason || 'failed validation').replace(/\*\//g, '').replace(/\s+/g, ' ').slice(0, 200);
  if (/\.css$/i.test(file.path)) return `/* VEAVE GUARD RAIL: removed because it failed validation: ${note} */\n`;
  const content = String(file.content || '');
  const names = new Set();
  let hasDefault = /\bexport\s+default\b/.test(content);
  for (const match of content.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of content.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/i);
      const exported = (bits[1] || bits[0] || '').trim();
      if (!exported) continue;
      if (exported === 'default') hasDefault = true;
      else names.add(exported);
    }
  }
  if (!hasDefault && !names.size) hasDefault = true;
  const lines = [`// VEAVE GUARD RAIL: this section failed validation after repeated attempts and was removed. ${note}`, 'const VeaveRemovedSection = () => null;'];
  if (hasDefault) lines.push('export default VeaveRemovedSection;');
  for (const name of names) lines.push(`export const ${name} = VeaveRemovedSection;`);
  return `${lines.join('\n')}\n`;
}

function quarantineCloneFiles(files, paths, reason) {
  const targets = new Set(paths);
  const quarantined = [];
  const next = files.map((file) => {
    if (!targets.has(file.path) || !isStubbableCloneFile(file)) return file;
    quarantined.push(file.path);
    return { ...file, content: buildQuarantineStub(file, reason) };
  });
  return { files: next, quarantined };
}

function findCloneCssViolations(changedPaths = []) {
  return [...changedPaths].filter((filePath) => /\.(?:css|scss|sass|less)$/i.test(filePath) && !/^src\/index\.css$/i.test(filePath));
}

function isFatalCloneError(error) {
  const status = Number(error?.status || error?.response?.status || error?.statusCode);
  if ([401, 402, 403].includes(status)) return true;
  return /insufficient (?:credits|funds)|quota exceeded|invalid api key|unauthori[sz]ed|payment required/i.test(String(error?.message || ''));
}

/**
 * Try to keep a candidate whose validation still fails by removing only the broken module(s).
 * Returns { files, quarantined } or null when nothing safe can be removed (caller rolls the stage back).
 */
async function salvageCloneCandidate({ files, diagnostics = [], isFinal = false, candidatePaths = [], verify, signal, maxProbes = 6 }) {
  let working = files;
  const quarantined = [];
  if (diagnostics.length) {
    const failing = [...new Set(diagnostics.map((item) => item.path).filter(Boolean))];
    const unfixable = diagnostics.some((item) => !item.path || !files.some((file) => file.path === item.path && isStubbableCloneFile(file)));
    if (!failing.length || unfixable) return null;
    const result = quarantineCloneFiles(working, failing, diagnostics.map((item) => item.message).join('; '));
    working = result.files;
    quarantined.push(...result.quarantined);
    if (generationPipeline.validateGeneratedFiles(working).length) return null;
  }
  if (!isFinal || typeof verify !== 'function') return quarantined.length ? { files: working, quarantined } : null;

  let rendered = await verify(working);
  if (rendered.ok) return quarantined.length ? { files: working, quarantined } : null;

  // The page does not render: find the one component that breaks it by stubbing candidates one at a time.
  const hinted = (rendered.diagnostics || []).map((item) => item.path).filter(Boolean);
  const probes = [...new Set([...hinted, ...[...candidatePaths].reverse()])]
    .filter((filePath) => !quarantined.includes(filePath))
    .map((filePath) => working.find((file) => file.path === filePath))
    .filter((file) => isStubbableCloneFile(file) && /\.(?:jsx|tsx)$/i.test(file.path))
    .slice(0, maxProbes);
  // Probes are independent: run them in small parallel waves and keep the first success in priority order.
  const probeConcurrency = Math.max(1, Number.parseInt(process.env.CLONE_PROBE_CONCURRENCY, 10) || 3);
  for (let index = 0; index < probes.length; index += probeConcurrency) {
    signal?.throwIfAborted();
    const wave = await Promise.all(probes.slice(index, index + probeConcurrency).map(async (file) => {
      const attempt = quarantineCloneFiles(working, [file.path], (rendered.diagnostics || []).map((item) => item.message).join('; '));
      const probeResult = await verify(attempt.files);
      return probeResult.ok ? attempt : null;
    }));
    const hit = wave.find(Boolean);
    if (hit) return { files: hit.files, quarantined: [...quarantined, ...hit.quarantined] };
  }
  return null;
}

// "Error in src/x.jsx: <message>" is posted by the preview when evaluating a module throws. Every module is evaluated
// for every route, so such a module crashes the WHOLE site, and no route-level repair can help.
function parseModuleCrash(message) {
  const match = /Error in ((?:src\/)?[^\s:'"]+\.(?:jsx?|tsx?|mjs|cjs)):\s*([^\n|]*)/i.exec(String(message || ''));
  return match ? { path: match[1], reason: match[2].trim() } : null;
}

/**
 * Makes the project evaluate again when a module crashes at load time: first the deterministic stray-text repair,
 * then (if the module still crashes) the module is replaced by an inert stub with the same exports. Pages keep
 * rendering; content of a stubbed section is restored by the captured-page route layer when the page ends up weak.
 * `render(files)` must throw the preview error (inspectRenderedPreview does). Returns { files, actions }.
 */
async function repairCrashingModules(files, { render, signal, maxRounds = 6, initialError = null } = {}) {
  let working = files;
  const actions = [];
  const stray = repairStrayIdentifiers(working);
  if (stray.repaired.length) {
    working = stray.files;
    for (const item of stray.repaired) actions.push({ repair: 'stray-text', path: item.path, detail: `removed stray text in code: ${item.names.join(', ')}` });
  }
  let pendingError = stray.repaired.length ? null : initialError;
  const quarantined = new Set();
  for (let round = 0; round < maxRounds; round += 1) {
    signal?.throwIfAborted();
    let message = pendingError;
    pendingError = null;
    if (!message) {
      try {
        await render(working);
        return { files: working, actions };
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        message = error?.message;
      }
    }
    const crash = parseModuleCrash(message);
    if (!crash) break;
    const file = working.find((item) => item.path === crash.path);
    if (!file) break;
    const name = /^(\S+) is not defined/.exec(crash.reason)?.[1];
    if (name && /[^\x00-\x7f]/.test(name) && !quarantined.has(file.path)) {
      // A stray word: remove just that word (keeps the section's content).
      const fixed = repairStrayIdentifiers(working, { paths: [file.path] });
      if (fixed.repaired.length) {
        working = fixed.files;
        actions.push({ repair: 'stray-text', path: file.path, detail: `removed stray text in code: ${fixed.repaired[0].names.join(', ')}` });
        continue;
      }
    }
    if (quarantined.has(file.path) || !isStubbableCloneFile(file)) break;
    const stubbed = quarantineCloneFiles(working, [file.path], `crashed when loaded: ${crash.reason}`);
    if (!stubbed.quarantined.length) break;
    working = stubbed.files;
    quarantined.add(file.path);
    actions.push({ repair: 'quarantine-crashing-module', path: file.path, detail: `replaced by an inert stub: ${crash.reason.slice(0, 160)}` });
  }
  return { files: working, actions };
}

// Keeps only the parts of a page analysis that concern one piece of real markup.
function leanAnalysisForFocus(pageAnalysis, focusHtml) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const focusText = normalize(String(focusHtml).replace(/<[^>]+>/g, ' '));
  const classes = new Set([...String(focusHtml).matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)).filter(Boolean));
  const textIn = (text) => { const key = normalize(text).slice(0, 30); return key.length >= 6 && focusText.includes(key); };
  const classIn = (value) => String(value || '').split(/\s+/).some((name) => name && classes.has(name));
  const urlIn = (url) => { const bare = String(url || '').split(/[?#]/)[0]; return bare.length > 8 && String(focusHtml).includes(bare); };
  const before = JSON.stringify(pageAnalysis).length;
  pageAnalysis.visualElements = (pageAnalysis.visualElements || []).filter((item) => textIn(item.text) || classIn(item.classes)).slice(0, 100);
  pageAnalysis.sections = (pageAnalysis.sections || []).filter((item) => textIn(item.text) || classIn(item.classes)).slice(0, 40).map(({ text, ...rest }) => ({ ...rest, text: String(text || '').slice(0, 160) }));
  pageAnalysis.controls = (pageAnalysis.controls || []).filter((item) => textIn(item.text) || classIn(item.classes)).slice(0, 40);
  pageAnalysis.headings = (pageAnalysis.headings || []).filter((item) => textIn(item.text || item)).slice(0, 40);
  pageAnalysis.images = (pageAnalysis.images || []).filter((image) => urlIn(image.src) || urlIn(image.originalUrl)).slice(0, 100)
    .map(({ src, originalUrl, alt, width, height, rect, localPath, link }) => ({ src, originalUrl, alt, width, height, documentY: rect?.documentY, localPath, link }));
  pageAnalysis.assetQueue = (pageAnalysis.assetQueue || []).filter((item) => (item.sourceUrls || []).some(urlIn)).slice(0, 120)
    .map(({ publicPath, alt, width, height, section, selector, rect, status }) => ({ publicPath, alt, width, height, section, selector, documentY: rect?.documentY, status }));
  delete pageAnalysis.responsive;
  if (pageAnalysis.design?.cssVariables) pageAnalysis.design = { ...pageAnalysis.design, cssVariables: Object.fromEntries(Object.entries(pageAnalysis.design.cssVariables).slice(0, 40)) };
  if (pageAnalysis.styles) {
    const used = (cssText) => [...String(cssText).matchAll(/\.([\w-]+)/g)].some((match) => classes.has(match[1]));
    pageAnalysis.styles = {
      styleSheets: (pageAnalysis.styles.styleSheets || []).map((sheet) => ({ ...sheet, rules: (sheet.rules || []).filter((rule) => used(rule.selectorText || rule.cssText)).slice(0, 300).map((rule) => ({ ...rule, cssText: String(rule.cssText || '').slice(0, 800) })) })).filter((sheet) => sheet.rules.length),
      responsiveRules: (pageAnalysis.styles.responsiveRules || []).filter((rule) => used(rule.cssText)).slice(0, 80).map((rule) => ({ ...rule, cssText: String(rule.cssText || '').slice(0, 1200) }))
    };
  }
  return { trimmed: JSON.stringify(pageAnalysis).length < before };
}

async function generateSequentialClonePage({ files, page, phase = 'content', routeManifest, siteMap, assets, routeScreenshot, mobileScreenshot, model, signal, deadlineAt }) {
  signal?.throwIfAborted();
  if (deadlineAt && Date.now() >= deadlineAt) {
    throw new AIResponseValidationError(`Page ${page.path} exceeded its generation time limit.`);
  }
  const repairDiagnostics = String(page.repairDiagnostics || '');
  const useDelimiterRepair = /invalid model file operations/i.test(repairDiagnostics);
  const ambiguousPatchRepair = /Patch failed: search block matched \d+ locations/i.test(repairDiagnostics);
  const ambiguousPatchPath = repairDiagnostics.match(/locations in "([^"]+)"/i)?.[1] || null;
  const syntaxRepairPath = repairDiagnostics.match(/Syntax error in "([^"]+)"/i)?.[1] || null;
  const syntaxRepairOperation = syntaxRepairPath && files.some((file) => file.path === syntaxRepairPath) ? 'modify' : 'create';
  const syntaxRepair = Boolean(syntaxRepairPath);
  const fullFileRepair = ambiguousPatchRepair || syntaxRepair;
  const maximumContextBytes = Number.parseInt(process.env.CLONE_SECTION_MAX_CONTEXT_BYTES, 10) || 150 * 1024;
  const sourceFiles = compactClonePageSource(files, page.path, maximumContextBytes, { focusPaths: page.focusPaths || [], phase: page.repairDiagnostics ? 'repair' : phase });
  const shownPaths = new Set(sourceFiles.map((file) => file.path));
  const otherFiles = files
    .filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json' && !shownPaths.has(file.path))
    .map((file) => `${file.path} (${String(file.content || '').length} chars)`);
  const pageAnalysis = compactClonePageAnalysis(page);
  const coverageRepair = /^Content coverage/i.test(repairDiagnostics);
  const inScope = (item) => coverageRepair || cloneItemInPhase(item, page, phase);
  const sectionQueue = (page.assetQueue || []).filter(inScope);
  const assetOrder = new Map(sectionQueue.map((item) => [item.publicPath, item.order]));
  const pageAssets = (coverageRepair ? assets.filter((asset) => sectionQueue.some((item) => item.publicPath === asset.publicPath)) : selectCloneSectionAssets(page, assets, phase))
    .map((asset) => ({ id: assetManifestLib.assetIdFor(asset), role: assetManifestLib.classifyAssetRole(asset), publicPath: asset.publicPath, mimeType: asset.mimeType, width: asset.width, height: asset.height, alt: String(asset.alt || '').slice(0, 80) }))
    .sort((a, b) => (assetOrder.get(a.publicPath) ?? Number.MAX_SAFE_INTEGER) - (assetOrder.get(b.publicPath) ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 200);
  // Only placements the model can act on (a local file exists), compacted; images that could not be shipped are a count.
  const placementSummary = clonePromptBudget.compactPlacements(sectionQueue);
  pageAnalysis.assetQueue = placementSummary.placements;
  pageAnalysis.imagesNotAvailable = placementSummary.unavailable;
  pageAnalysis.images = clonePromptBudget.compactImages((pageAnalysis.images || []).filter(inScope));
  pageAnalysis.sections = (pageAnalysis.sections || []).filter(inScope);
  pageAnalysis.headings = (pageAnalysis.headings || []).filter(inScope);
  pageAnalysis.controls = (pageAnalysis.controls || []).filter(inScope);
  pageAnalysis.visualElements = (pageAnalysis.visualElements || []).filter(inScope);
  if (pageAnalysis.extraction) {
    pageAnalysis.extraction.domHierarchy = (pageAnalysis.extraction.domHierarchy || [])
      .filter(inScope);
    pageAnalysis.extraction.htmlSections = (pageAnalysis.extraction.htmlSections || [])
      .filter(inScope);
    pageAnalysis.extraction.html = pageAnalysis.extraction.htmlSections
      .map((section) => section.html)
      .filter(Boolean)
      .join('\n')
      .slice(0, 120000);
    if (coverageRepair) {
      // Send simplified markup (no classes/styles) of the whole page, starting near the first missing text.
      const simplified = simplifyCloneHtml(page.extraction?.html);
      const firstMissing = (page.coverageMissing || [])[0]?.text?.slice(0, 40);
      const hit = firstMissing ? simplified.indexOf(firstMissing) : -1;
      const start = Math.max(0, (hit > 0 ? hit : 0) - 3000);
      pageAnalysis.extraction.html = '';
      pageAnalysis.extraction.htmlSections = [];
      pageAnalysis.extraction.domHierarchy = [];
      pageAnalysis.missingContentHtml = simplified.slice(start, start + 260000);
    } else if (phase === 'content' && page.contentChunk?.total > 1) {
      const source = simplifyCloneHtml(page.fillMode ? (page.extraction?.html || cloneContentHtml(page)) : cloneContentHtml(page), { keepClass: true });
      const { index, total } = page.contentChunk;
      const boundary = (target) => {
        const at = source.indexOf('<', target);
        return at < 0 ? source.length : at;
      };
      const size = Math.ceil(source.length / total);
      pageAnalysis.extraction.html = source.slice(index === 0 ? 0 : boundary(size * index), index === total - 1 ? source.length : boundary(size * (index + 1)));
      pageAnalysis.extraction.htmlSections = [];
      pageAnalysis.contentPart = { part: index + 1, of: total };
    } else if (phase === 'page') {
      pageAnalysis.extraction.html = simplifyCloneHtml(page.extraction?.html, { keepClass: true }).slice(0, 200000);
      pageAnalysis.extraction.htmlSections = [];
    } else {
      pageAnalysis.extraction.html = simplifyCloneHtml(pageAnalysis.extraction.html, { keepClass: true }).slice(0, 200000);
      // The section markup is already in extraction.html; do not send it twice.
      pageAnalysis.extraction.htmlSections = pageAnalysis.extraction.htmlSections.map(({ html, ...meta }) => meta);
    }
  }
  // Keep the request inside the prompt budget (least useful detail goes first).
  const fitted = clonePromptBudget.fitAnalysis(pageAnalysis);
  if (fitted.trimmed.length) logger.info(`Clone prompt for ${page.path} (${phase}) trimmed to ${Math.round(fitted.bytes / 1024)} KB; reduced: ${fitted.trimmed.join(', ')}.`);
  Object.keys(pageAnalysis).forEach((key) => delete pageAnalysis[key]);
  Object.assign(pageAnalysis, fitted.analysis);
  const compactRoutes = routeManifest.map(({ path, title, pageType }) => ({ path, title, pageType }));
  const phaseRequirement = {
    page: 'Implement this ENTIRE route in this single response: the shared header and navigation (reuse existing shared components if present), every section of the page in source order, and the shared footer. Register the route in src/App.jsx.',
    top: 'Implement or connect the shared header and navigation, and this route with its responsive hero / above-the-fold area. Do not build lower sections or the footer yet.',
    header: 'Implement or connect only the shared header and navigation. Preserve page body and footer code.',
    hero: 'Implement only this route and its responsive hero. Preserve the shared header and do not build lower sections yet.',
    content: 'Implement the main content and secondary sections only. Preserve the header, hero, and footer.',
    footer: 'Implement or connect the shared footer, finish route interactions, and make the assembled page production-ready.'
  }[phase] || 'Complete only the requested page section.';
  if (page.fillMode) {
    // Completing an existing page: send only what concerns THIS part of the real markup (its styles, measured elements,
    // images and placements), not the analysis of the whole 25,000 px page.
    const focusHtml = pageAnalysis.extraction?.html || pageAnalysis.missingContentHtml || '';
    const lean = leanAnalysisForFocus(pageAnalysis, focusHtml);
    const inFocusAssets = pageAssets.filter((asset) => (asset.sourcePaths || []).some((reference) => reference && focusHtml.includes(reference)));
    const chosenAssets = (inFocusAssets.length ? inFocusAssets : pageAssets.slice(0, 30))
      .slice(0, 150).map(({ publicPath, mimeType, width, height, alt, associations }) => ({ publicPath, mimeType, width, height, alt, section: associations?.[0]?.section || null }));
    pageAssets.length = 0;
    pageAssets.push(...chosenAssets);
    if (lean.trimmed) logger.info(`Source fill prompt trimmed to ${JSON.stringify(pageAnalysis).length} chars of analysis for ${page.path}.`);
  }
  const fillRequirement = page.fillNote ? `\nEXISTING PAGE COMPLETION (this page already exists in the project; part of this markup is already built):\n${page.fillNote}\n` : '';
  const chunkRequirement = pageAnalysis.contentPart
    ? ` This is content part ${pageAnalysis.contentPart.part} of ${pageAnalysis.contentPart.of}: implement EVERY element of the markup in CURRENT PAGE.extraction.html (exact text, links, lists, images) as new component file(s), e.g. src/components/<PageName>Part${pageAnalysis.contentPart.part}.jsx, and render them in order in the page after the earlier parts. Keep all earlier parts. Do not summarize or skip items; put repeated items into a data array module.`
    : '';
  const repairRequirement = page.repairDiagnostics
    ? `\nREPAIR OVERRIDE (complete this before page work):\n- The current project failed validation: ${page.repairDiagnostics}\n- Fix the reported failure in this response; returning unrelated visual changes is invalid.\n- You may modify src/App.jsx, routing, barrel files, or shared components when they cause the failure. Never delete or rename src/App.jsx, and keep its default App export.\n- For an invalid React element type, inspect every component rendered by App and make each local import exactly match the target file's default or named export. Remove or replace unavailable package components.\n- Preserve valid generated files and make the smallest complete repair.${ambiguousPatchRepair ? `\n- The prior PATCH was ambiguous. NEVER return a PATCH operation in this retry. Return ${ambiguousPatchPath ? `exactly one complete <FILE path="${ambiguousPatchPath}" operation="modify"> block` : 'complete FILE operation="modify" blocks'} containing the entire corrected source.` : ''}${syntaxRepair ? `\n- The previous response was rejected atomically because ${syntaxRepairPath} had invalid syntax. NEVER patch that file. Regenerate it as a complete <FILE path="${syntaxRepairPath}" operation="${syntaxRepairOperation}"> block with balanced quotes and valid TypeScript. Repeat any other complete file operations needed for this page because none of the rejected response was applied.` : ''}`
    : '';
  const operationRequirement = ambiguousPatchRepair
    ? `Return only a complete FILE operation="modify" for ${ambiguousPatchPath || 'each affected file'}. PATCH operations are forbidden for this retry.`
    : syntaxRepair
    ? `Return a complete FILE operation="${syntaxRepairOperation}" for ${syntaxRepairPath}. PATCH operations are forbidden for that file; include any other complete operations required to finish the page.`
    : 'Every create or modify operation must include the complete file source in a string content field. Use a patch operation with string search and replace fields for partial edits.';
  const delimiterInstructions = useDelimiterRepair
    ? `\n\nThe previous tool call was invalid. Do not call a tool again. Return only deterministic FILE delimiters.${fullFileRepair ? ' Do not use a PATCH delimiter for the failed file.' : `\n${aiProtocol.DELIMITER_INSTRUCTIONS}`}`
    : '';
  const strictCloneRules = `STRICT ROUTING AND ASSET RULES:
- Complete Home first, then process only captured navbar routes in queue order.
- src/App.jsx must explicitly import and register every authoritative route. A page file or data entry without an App route is invalid.
- Reconstruct the current section from its scraped HTML, DOM hierarchy, computed styles, geometry, text, controls, and responsive evidence. These source elements are authoritative.
- LOCAL ASSETS contains only assets captured for the current ${phase} section. Use only those exact publicPath values in this stage.
- Never reuse an asset from another section, invent an /assets path, or modify another section to add images. Omit an image when no current-section asset matches.`;
  const sharedShellPaths = files.filter((file) => file.encoding !== 'base64' && /(?:^|\/)(?:Header|Navbar|NavBar|Navigation|Footer|SiteHeader|SiteFooter|.*Layout|.*Shell)\.(?:jsx?|tsx?)$/i.test(file.path || '')).map((file) => file.path);
  const sharedShellRequirement = page.path === '/'
    ? '\n- SHARED SHELL: build the header/navigation and the footer as standalone shared components (for example src/components/layout/Header.jsx and Footer.jsx) wrapped by a shared layout in src/App.jsx, so every other page renders the identical header and footer. Match the real header exactly (logo, link order and labels, sizes, colours, sticky or transparent behaviour, mobile menu).'
    : `\n- SHARED SHELL: the header and footer are identical on every page of the real site. ${sharedShellPaths.length ? `Reuse the existing shared components (${sharedShellPaths.join(', ')}) exactly as the home page built them` : 'Reuse the header and footer already used by the home page in src/App.jsx'}; never create a second or page-specific header/footer and do not change them, only the page body.`;
  const prompt = `SEQUENTIAL CLONE PAGE STAGE\n\nComplete exactly one page phase before stopping.\nPHASE: ${phase}\nCURRENT PAGE:\n${JSON.stringify(pageAnalysis)}${repairRequirement}\n\nLOCAL ASSETS FOR THIS PAGE (reuse these paths; never invent placeholders):\n${JSON.stringify(pageAssets)}\n\nAUTHORITATIVE ROUTES:\n${JSON.stringify(compactRoutes)}\n\nSITE MAP ROUTE PATHS:\n${JSON.stringify(compactRoutes.map((route) => route.path))}\n\nCURRENT PROJECT SOURCE:\n${JSON.stringify(sourceFiles)}\n\nOTHER PROJECT FILES (contents omitted; do not rewrite them):\n${JSON.stringify(otherFiles)}\n\n${CLONE_VISUAL_FIDELITY_RULES}\n\nREQUIREMENTS:\n- ${phaseRequirement}${chunkRequirement}${fillRequirement}${sharedShellRequirement}\n- Work only on ${page.path}; preserve every already completed page, except files explicitly required by the repair override.\n- Use existing shared components when structurally appropriate and page-specific sections when unique.\n- Register ${page.path} as a local route and keep internal navigation local.\n- Reuse the listed local assets and preserve their measured rendering. If page assets are listed, the rendered page must reference at least one.\n- Asset identity: every listed asset has a stable id and a role (logo, hero, banner, product, profile, icon, decorative, content). Use an asset ONLY in the element where the real page placed it (see the placement queue: same alt text, section and nearby text). A logo is never a hero image, and an image of another section or page is never a stand-in. If an image is listed as not available, do not substitute any other asset: keep an empty box with the same width/height and aspect ratio instead.\n- Never add remote image URLs, stock photos, Unsplash links, or invented placeholders. Image src and CSS image values must use the listed local public paths.\n- Match the captured hierarchy, exact section count, headings, content, typography, colors, dimensions, spacing, controls, and responsive structure.\n- Keep source files compact: do not inline large raw HTML dumps, SVG blobs or base64 data; extract repeated UI into small components.\n- Return only minimal create/modify file operations. Do not rewrite unrelated files.\n- ${operationRequirement}${delimiterInstructions}`;
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const maximumPromptBytes = Number.parseInt(process.env.CLONE_PAGE_MAX_INPUT_BYTES, 10) || 5 * 1024 * 1024;
  if (promptBytes > maximumPromptBytes) {
    throw new AIResponseValidationError(`Sequential page context for ${page.path} is ${promptBytes} bytes, above the ${maximumPromptBytes}-byte safety limit.`);
  }
  // Reference screenshots are only worth their tokens on stages that lay out the page.
  const needsReferenceImage = !(phase === 'footer' || (phase === 'content' && page.contentChunk?.index > 0));
  const referenceImages = needsReferenceImage ? [routeScreenshot, mobileScreenshot].filter(Boolean) : [];
  const messages = [{
    role: 'system',
    content: `You are a source-driven website reconstruction engineer. Analyze the extracted HTML, DOM, CSS, content, routes, and asset associations before coding. Complete one route at a time without damaging completed routes. Use modular React and deterministic file operations.\n\n${strictCloneRules}\n\n${CLONE_VISUAL_FIDELITY_RULES}`
  }, {
    role: 'user',
    content: referenceImages.length
      ? [{ type: 'text', text: prompt }, ...referenceImages.map((url) => ({ type: 'image_url', image_url: { url } }))]
      : prompt
  }];
  const completionOptions = {
    model,
    temperature: 0.1,
    max_tokens: Number.parseInt(process.env.CLONE_PAGE_MAX_TOKENS, 10) || 16000,
    plugins: [{ id: 'context-compression' }],
    reasoning: { effort: phase === 'footer' ? 'low' : 'medium', exclude: true },
    timeout: Math.max(1000, Math.min(
      Number.parseInt(process.env.CLONE_PAGE_MODEL_TIMEOUT_MS, 10) || 180000,
      deadlineAt ? deadlineAt - Date.now() : Number.MAX_SAFE_INTEGER
    ))
  };
  if (useDelimiterRepair) {
    completionOptions.response_format = false;
  } else {
    completionOptions.tools = [aiProtocol.FILE_OPERATIONS_TOOL];
    completionOptions.tool_choice = { type: 'function', function: { name: aiProtocol.FILE_OPERATIONS_TOOL.function.name } };
  }
  let completion = await withTransientRetry(() => openrouterService.generateCompletion(messages, completionOptions), { signal, deadlineAt });
  completion = await completeOpenRouterResponse(messages, completion, {
    model,
    structured: true,
    maxContinuations: 3,
    timeout: completionOptions.timeout,
    continuationInstruction: `Continue the interrupted file operations for ${page.path}. Finish only this page and close the structured response.`
  });
  try {
    const parsed = aiProtocol.parseAIResponse(completion, 'src/App.jsx');
    const operations = aiProtocol.validateFileOperations(parsed, files);
    const applied = aiProtocol.applyOperationsSafely(files, operations.files);
    if (!applied.changedFiles.length) throw new AIResponseValidationError(`Sequential page stage ${page.path} returned no file changes.`);
    return { files: applied.files, changedFiles: applied.changedFiles, usage: completion.usage || null };
  } catch (error) {
    error.usage = completion?.usage || null;
    throw error;
  }
}

const { recloneRoute, fillMissingFromRealPage } = realPageFillWorker.createRealPageFill({
  generateSequentialClonePage,
  cloneHelpers: { measureCloneTextCoverage, classifyCloneAssetSection, simplifyCloneHtml, cloneContentHtml, buildCloneImplementationStages, cloneTextCorpus, measureHtmlCoverage, buildCloneCoverageDiagnostics }
});



module.exports = {
  CLONE_VISUAL_FIDELITY_RULES,
  resolveCloneRouteLimit,
  resolveCloneVisualThresholds,
  isAcceptableCloneVisualFallback,
  getExpectedPageHeading,
  getExpectedPageColors,
  isFinalClonePhase,
  buildCloneImplementationStages,
  classifyCloneAssetSection,
  selectCloneSectionAssets,
  resolveClonePageDuration,
  resolveGenerationModel,
  compactClonePageSource,
  compactClonePageAnalysis,
  compactCloneInitialAnalysis,
  parseInitialProjectResponse,
  measureCloneTextCoverage,
  simplifyCloneHtml,
  buildCloneCoverageDiagnostics,
  buildQuarantineStub,
  quarantineCloneFiles,
  findCloneCssViolations,
  isFatalCloneError,
  salvageCloneCandidate,
  parseModuleCrash,
  repairCrashingModules,
  generateSequentialClonePage,
  recloneRoute,
  fillMissingFromRealPage
};
