'use strict';

const { collectPageMetrics } = require('./pageMetrics');
const { distance, parseColor } = require('./colorUtils');
const { validateSlots } = require('./assetSlots');

// Stages 10 and 12: compare a generated page with its reference page, measured by the same function at the same
// viewport size. The comparison is pure (it only reads two metrics objects), so each check can be tested on its own.

const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const familyOf = (stack) => String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
const ratioDiff = (a, b) => (a && b ? Math.abs(a - b) / b : 0);

const SEVERITY_RANK = { blocking: 3, major: 2, minor: 1 };
const issue = (kind, severity, message, extra = {}) => ({ kind, severity, message, ...extra });

function sectionsOf(metrics) { return (metrics?.sections || []).filter((s) => !['header', 'footer'].includes(s.kind)); }

function checkRender(ref, gen, viewport) {
  if (gen?.ok === false) return [issue('render-failed', 'blocking', `The page did not render at ${viewport}: ${gen.error}`, { fix: 'Fix the runtime error so the page renders (check imports, undefined variables and hook usage).' })];
  return [];
}

function checkSections(ref, gen, config, viewport) {
  const issues = [];
  const refSections = sectionsOf(ref); const genSections = sectionsOf(gen);
  if (!refSections.length) return issues;
  const ratio = genSections.length / refSections.length;
  if (ratio < config.minSectionRatio) {
    issues.push(issue('sections-missing', 'blocking', `The page has ${genSections.length} section(s) at ${viewport}; the reference has ${refSections.length} (${Math.round(ratio * 100)}%, minimum ${Math.round(config.minSectionRatio * 100)}%).`, {
      fix: `Add the missing sections, in this order: ${refSections.map((s) => `${s.kind}${s.heading ? ` "${s.heading}"` : ''}`).slice(0, 14).join('; ')}.`
    }));
  }
  const kinds = (list) => list.reduce((m, s) => m.set(s.kind, (m.get(s.kind) || 0) + 1), new Map());
  const refKinds = kinds(refSections); const genKinds = kinds(genSections);
  for (const [kind, count] of refKinds) {
    if (['content'].includes(kind)) continue;
    if (!genKinds.get(kind)) issues.push(issue('section-kind-missing', 'major', `The reference has a ${kind} section (${count}) that the generated page does not have.`, { fix: `Add a ${kind} section like the reference.` }));
  }
  const refHero = refSections.find((s) => s.kind === 'hero');
  if (refHero && genSections.length && genSections[0].kind !== 'hero' && !genSections.some((s) => s.kind === 'hero')) issues.push(issue('hero-missing', 'major', 'The page does not open with a hero section like the reference.', { fix: 'Start the page with a hero section (an h1 and a main call to action).' }));
  gen && (gen.defects?.emptySections || []).forEach((selector) => issues.push(issue('section-empty', 'major', 'A section renders empty.', { selector, fix: 'Fill the empty section or remove it.' })));
  return issues;
}

function checkTypography(ref, gen, ds, config, viewport) {
  const issues = [];
  const tol = config.tolerances.fontSizeRatio;
  const mobile = viewport === 'mobile';
  const roles = ['h1', 'h2', 'p', 'button'];
  for (const role of roles) {
    const expected = ref?.typography?.[role]; const got = gen?.typography?.[role];
    if (!expected) continue;
    if (!got) { if (role === 'h1' || role === 'p') issues.push(issue('typography-missing', 'major', `No ${role} text was found on the generated page at ${viewport}.`, { fix: `Use a real <${role === 'p' ? 'p' : role}> element for this text.` })); continue; }
    const e = px(expected.fontSize); const g = px(got.fontSize);
    if (e && g && ratioDiff(g, e) > tol) {
      // A page whose own text differs from the site-wide token (e.g. a plain legal page with a small h1) is a page-specific
      // difference: reported, but only a mismatch with the site-wide value is a defect that blocks the page.
      const token = px(ds?.typography?.[role]?.[mobile ? 'sizeMobile' : 'size']);
      const pageSpecific = token && ratioDiff(e, token) > tol;
      issues.push(issue('typography-size', role === 'h1' && !pageSpecific ? 'major' : 'minor', `${role} is ${g}px at ${viewport}; the reference ${pageSpecific ? `page uses ${e}px (the site-wide ${role} is ${token}px)` : `is ${e}px`}.`, { role, expected: e, actual: g, pageSpecific: Boolean(pageSpecific), fix: `Set ${role} to about ${e}px at ${viewport} width.` }));
    }
    const wantFamily = familyOf(ds?.fonts?.[role === 'h1' || role === 'h2' ? 'heading' : 'body']?.google || ds?.fonts?.[role === 'h1' || role === 'h2' ? 'heading' : 'body']?.original || expected.fontFamily);
    const gotFamily = familyOf(got.fontFamily);
    if (wantFamily && gotFamily && wantFamily !== gotFamily && !(ds?.fonts?.[role === 'h1' || role === 'h2' ? 'heading' : 'body']?.isSystem && /^(system-ui|-apple-system|ui-|segoe|helvetica|arial|georgia|times)/i.test(gotFamily))) {
      issues.push(issue('typography-family', 'major', `${role} uses "${gotFamily}"; the reference uses "${wantFamily}".`, { role, expected: wantFamily, actual: gotFamily, fix: `Use font-family var(--font-${role === 'h1' || role === 'h2' ? 'heading' : 'body'}) (do not set another font).` }));
    }
    const ew = Number(expected.fontWeight); const gw = Number(got.fontWeight);
    if (ew && gw && Math.abs(ew - gw) >= 300 && (role === 'h1' || role === 'h2')) issues.push(issue('typography-weight', 'minor', `${role} weight is ${gw}; the reference is ${ew}.`, { role, fix: `Use font-weight ${ew}.` }));
  }
  return issues;
}

function checkColors(ref, gen, ds, config) {
  const issues = [];
  const tol = config.tolerances.colorDistance;
  const wantBg = ds?.colors?.background || ref?.pageBackground;
  if (wantBg && gen?.pageBackground && distance(gen.pageBackground, wantBg) > tol) issues.push(issue('color-background', 'major', `The page background is ${gen.pageBackground}; the reference is ${wantBg}.`, { expected: wantBg, actual: gen.pageBackground, fix: 'Use bg-bg (the theme background) and do not set another page background.' }));
  const wantText = ds?.colors?.foreground || ref?.bodyColor;
  if (wantText && gen?.bodyColor && distance(gen.bodyColor, wantText) > tol) issues.push(issue('color-text', 'major', `The body text is ${gen.bodyColor}; the reference is ${wantText}.`, { expected: wantText, actual: gen.bodyColor, fix: 'Use text-fg (the theme text colour).' }));
  if (ref?.buttons?.background && gen?.buttons?.background && ds?.colors?.primary && distance(gen.buttons.background, ds.colors.primary) > tol * 1.6) issues.push(issue('color-primary', 'minor', `Buttons are ${gen.buttons.background}; the reference primary colour is ${ds.colors.primary}.`, { expected: ds.colors.primary, actual: gen.buttons.background, fix: 'Use bg-brand-600 text-on-brand for primary buttons.' }));
  return issues;
}

function checkLayout(ref, gen, config, viewport) {
  const issues = [];
  if (viewport === 'desktop' && ref?.grid?.contentWidth && gen?.grid?.contentWidth && ratioDiff(gen.grid.contentWidth, ref.grid.contentWidth) > config.tolerances.containerRatio) {
    issues.push(issue('layout-container', 'minor', `The content column is ${gen.grid.contentWidth}px wide; the reference is ${ref.grid.contentWidth}px.`, { expected: ref.grid.contentWidth, actual: gen.grid.contentWidth, fix: `Constrain content to max-w-container (${ref.grid.contentWidth}px) and centre it.` }));
  }
  const refCards = sectionsOf(ref).find((s) => s.kind === 'cards' && typeof s.columns === 'number');
  const genCards = sectionsOf(gen).find((s) => s.kind === 'cards' && typeof s.columns === 'number');
  if (refCards && genCards && refCards.columns !== genCards.columns) issues.push(issue('layout-columns', 'minor', `The card grid has ${genCards.columns} column(s) at ${viewport}; the reference has ${refCards.columns}.`, { expected: refCards.columns, actual: genCards.columns, fix: `Use ${refCards.columns} column(s) for the card grid at ${viewport} width.` }));
  return issues;
}

function checkDefects(ref, gen, viewport) {
  const issues = [];
  const d = gen?.defects || {}; const refD = ref?.defects || {};
  if (d.horizontalOverflow > 4) issues.push(issue('horizontal-overflow', viewport === 'mobile' ? 'blocking' : 'major', `The page is ${d.horizontalOverflow}px wider than the ${viewport} viewport (horizontal scrolling).`, { fix: 'Remove fixed widths larger than the viewport; use max-w-full, w-full and responsive classes.' }));
  if ((d.overlaps || []).length > (refD.overlaps || []).length) issues.push(issue('overlap', 'major', `${d.overlaps.length} section(s) overlap (${d.overlaps.slice(0, 2).map((o) => `${o.a} over ${o.b} by ${o.by}px`).join('; ')}).`, { selector: d.overlaps[0].a, fix: 'Remove negative margins / absolute positioning that makes sections overlap.' }));
  if ((d.clipped || []).length > (refD.clipped || []).length + 1) issues.push(issue('clipped-content', 'major', `${d.clipped.length} element(s) clip their content (${d.clipped[0].selector}).`, { selector: d.clipped[0].selector, fix: 'Allow the content to wrap or scroll instead of overflow-hidden with fixed width.' }));
  (d.zeroImages || []).slice(0, 4).forEach((z) => issues.push(issue('image-zero-size', 'blocking', `An image renders with no size (${(z.src || '').slice(0, 70)}).`, { selector: z.selector, fix: 'Give the image width/height or an aspect-ratio container.' })));
  (d.brokenImages || []).slice(0, 4).forEach((b) => issues.push(issue('image-broken', 'blocking', `An image failed to load (${(b.src || '').slice(0, 70)}).`, { selector: b.selector, fix: 'Use a local /prototype-assets/ image from the slot list.' })));
  return issues;
}

/**
 * Compares one page at one viewport.
 * @param {{reference: object, generated: {ok:boolean, metrics?:object, error?:string}, designSystem: object, config: object, viewport: 'desktop'|'mobile', manifest?: object, route: string, mapping?: Map}} args
 */
function comparePageViewport({ reference, generated, designSystem, config, viewport, manifest = null, route, mapping = null }) {
  const gen = generated?.ok === false ? generated : generated?.metrics || generated;
  const issues = [];
  const renderIssues = checkRender(reference, generated, viewport);
  if (renderIssues.length) return { viewport, issues: renderIssues, checks: [{ name: 'render', status: 'failed', detail: renderIssues[0].message }] };
  const groups = [
    ['sections', checkSections(reference, gen, config, viewport)],
    ['typography', checkTypography(reference, gen, designSystem, config, viewport)],
    ['colors', checkColors(reference, gen, designSystem, config)],
    ['layout', checkLayout(reference, gen, config, viewport)],
    ['defects', checkDefects(reference, gen, viewport)]
  ];
  let slotResult = null;
  if (manifest) { slotResult = validateSlots(manifest, route, gen, { viewport, tolerances: config.tolerances, mapping }); groups.push(['assets', slotResult.issues]); }
  const checks = [{ name: 'render', status: 'passed', detail: `rendered at ${viewport}` }];
  for (const [name, list] of groups) {
    issues.push(...list);
    const worst = list.reduce((w, i) => Math.max(w, SEVERITY_RANK[i.severity] || 0), 0);
    checks.push({ name, status: worst >= 2 ? 'failed' : worst === 1 ? 'warning' : 'passed', detail: list.length ? `${list.length} issue(s): ${list.slice(0, 2).map((i) => i.kind).join(', ')}` : 'ok' });
  }
  return { viewport, issues, checks, assets: slotResult ? { planned: slotResult.planned, found: slotResult.found } : null };
}

/** A page passes when no blocking or major issue remains; minor ones are reported. */
function summarizeResult(parts) {
  const issues = parts.flatMap((p) => p.issues.map((i) => ({ ...i, viewport: p.viewport })));
  const blocking = issues.filter((i) => i.severity === 'blocking'); const major = issues.filter((i) => i.severity === 'major'); const minor = issues.filter((i) => i.severity === 'minor');
  const checks = parts.flatMap((p) => p.checks.map((c) => ({ ...c, viewport: p.viewport })));
  return { passed: blocking.length === 0 && major.length === 0, counts: { blocking: blocking.length, major: major.length, minor: minor.length }, issues, checks, viewports: parts.map((p) => p.viewport), assets: parts.map((p) => ({ viewport: p.viewport, ...(p.assets || {}) })) };
}

/** Renders the generated page at each viewport through `render` and compares it. `render(files, route, viewport) -> {ok, metrics|error}`. */
async function validatePage({ files, page, referenceMetrics, designSystem, config, manifest = null, mapping = null, render, only = null }) {
  const parts = [];
  for (const viewport of ['desktop', 'mobile']) {
    if (only && !only.includes(viewport)) continue;
    const reference = referenceMetrics?.[viewport];
    if (!reference) { parts.push({ viewport, issues: [], checks: [{ name: 'reference', status: 'skipped', detail: `no ${viewport} reference measurement` }], skipped: true }); continue; }
    const generated = await render(files, page.route, viewport);
    parts.push(comparePageViewport({ reference, generated, designSystem, config, viewport, manifest, route: page.route, mapping }));
  }
  return summarizeResult(parts);
}

/** Numbered, specific instructions for the repair step. */
function repairInstructions(result, limit = 14) {
  const ranked = [...result.issues].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const seen = new Set();
  const lines = [];
  for (const i of ranked) {
    const key = `${i.kind}|${i.slotId || ''}|${i.selector || ''}|${i.role || ''}`;
    if (seen.has(key)) continue; seen.add(key);
    lines.push(`${lines.length + 1}. [${i.severity}${i.viewport ? `, ${i.viewport}` : ''}] ${i.message}${i.fix ? ` FIX: ${i.fix}` : ''}`);
    if (lines.length >= limit) break;
  }
  return lines.join('\n');
}

/** Production renderer: the existing offline preview renderer, running the shared measurement function. */
function createRenderer({ inspectRenderedPreview, config, signal }) {
  return async (files, route, viewport) => {
    try {
      const metrics = await inspectRenderedPreview(files, { signal, routePath: route, viewport: config.viewports[viewport], inspect: collectPageMetrics, argument: {} });
      return { ok: true, metrics };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      return { ok: false, error: String(error.message).slice(0, 300) };
    }
  };
}

module.exports = { comparePageViewport, summarizeResult, validatePage, repairInstructions, createRenderer, checkSections, checkTypography, checkColors, checkLayout, checkDefects, SEVERITY_RANK };
