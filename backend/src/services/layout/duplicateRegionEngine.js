// "There are 2 footers, remove one": the claim is CHECKED against the rendered page before anything is edited. If the named page
// really shows the region more than once, the duplicate that the rest of the site does not use is removed (never the shared one,
// and never so that a page is left without it). If it does not, nothing is changed and the pages that do have duplicates are named.
const { inspectRenderedPreview } = require('../ai/targetRenderVerifier');
const { resolveSource, elementSpan } = require('./sourceLocationResolver');
const { knownRoutesFor } = require('./editRoute');

const STATES = Object.freeze({ DIAGNOSIS_PENDING: 'DIAGNOSIS_PENDING', CAUSE_IDENTIFIED: 'CAUSE_IDENTIFIED', PATCH_APPLIED: 'PATCH_APPLIED', BUILD_PASSED: 'BUILD_PASSED', RENDER_VERIFIED: 'RENDER_VERIFIED', REGRESSION_PASSED: 'REGRESSION_PASSED', VERIFICATION_FAILED: 'VERIFICATION_FAILED' });
const REGIONS = [['footer', /\bfooters?\b/i], ['header', /\bheaders?\b/i], ['nav', /\b(?:navbars?|nav\s*bars?|navigation|menus?)\b/i], ['banner', /\bbanners?\b/i], ['sidebar', /\bsidebars?\b/i]];
const REMOVE = /\b(remove|delete|get\s+rid\s+of|hide|drop|eliminate|take\s+out|clear)\b/i;
const DUPLICATE = /\b(two|2|double|doubled|twice|duplicate[ds]?|duplicates?|extra|another|second|repeated|both|again)\b/i;

/** { target } when the request says a region appears more than once and should be removed; otherwise null. */
function parseDuplicateRequest(request = '') {
  const text = String(request);
  if (!REMOVE.test(text) || !DUPLICATE.test(text)) return null;
  const found = REGIONS.find(([, re]) => re.test(text));
  return found ? { target: found[0] } : null;
}

/** In the page: every outermost visible element of the region, with a stable selector and a signature of its content. */
function listRegionsInPage({ word }) {
  const root = document.querySelector('#root') || document.body;
  const roles = { footer: 'contentinfo', header: 'banner', nav: 'navigation', banner: 'banner', sidebar: 'complementary' };
  const tags = { footer: ['FOOTER'], header: ['HEADER'], nav: ['NAV'], sidebar: ['ASIDE'], banner: [] };
  const wordRe = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
  const found = [];
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < 100 || r.height < 20 || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const semantic = (tags[word] || []).includes(el.tagName) || el.getAttribute('role') === roles[word];
    const named = wordRe.test(el.id || '') || wordRe.test(String(el.getAttribute('class') || ''));
    if (semantic || (named && !/^(HTML|BODY)$/.test(el.tagName))) found.push({ el, semantic });
  }
  // outermost only; a class-named wrapper that merely contains a semantic one is the same region
  const outer = found.filter((a) => !found.some((b) => b !== a && b.el.contains(a.el)));
  const semanticOuter = outer.filter((x) => x.semantic);
  const chosen = semanticOuter.length ? semanticOuter : outer;
  const pathOf = (n) => { const parts = []; for (; n && n !== root; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i += 1; parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`); } return `#root > ${parts.join(' > ')}`; };
  const regions = chosen.map(({ el }) => {
    const r = el.getBoundingClientRect();
    return { selector: pathOf(el), tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.getAttribute('class') || ''), top: Math.round(r.top + scrollY), height: Math.round(r.height), signature: `${String(el.getAttribute('class') || '').replace(/\s+/g, ' ').trim().slice(0, 90)}|${(el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)}`, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  }).sort((a, b) => a.top - b.top);
  // everything that is not one of the regions: its text must be unchanged by the edit
  const inRegion = (n) => chosen.some(({ el }) => el.contains(n));
  let hash = 5381; let chars = 0;
  for (const node of root.querySelectorAll('*')) {
    if (inRegion(node)) continue;
    const own = [...node.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent.trim()).join(' ');
    if (!own) continue;
    chars += own.length;
    for (let i = 0; i < own.length; i += 1) hash = ((hash << 5) + hash + own.charCodeAt(i)) | 0;
  }
  return { regions, restHash: hash, restChars: chars, docHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) };
}

async function listRegions(files, route, word, { signal, inspect = inspectRenderedPreview, viewport } = {}) {
  return inspect(files, { signal, routePath: route, viewport, inspect: listRegionsInPage, argument: { word } });
}

const componentAt = (source, index) => {
  let name = null;
  const re = /(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|\w+)\s*=>)/g;
  for (let m = re.exec(source); m && m.index < index; m = re.exec(source)) name = m[1] || m[2];
  return name;
};

/** Source edits that make the region disappear from the page: remove the element, or the `<Component />` that renders it. */
function candidateRemovals(files, region) {
  const found = resolveSource(files, { tag: region.tag, cls: region.cls, domId: region.id, inline: '' }).markup;
  const out = [];
  for (const loc of found) {
    const file = files.find((f) => f.path === loc.file);
    const span = elementSpan(file.content, loc.tagStart, loc.tagEnd, loc.tagName);
    if (span.end < 0) continue;
    const name = componentAt(file.content, loc.tagStart);
    const before = file.content.slice(0, loc.tagStart);
    const after = file.content.slice(span.end);
    const wholeComponent = name && /return\s*\(?\s*$/.test(before.slice(-80)) && /^\s*\)?\s*;?\s*\}/.test(after);
    const removeElement = () => ({ file: loc.file, kind: 'remove-element', content: before.replace(/[ \t]*$/, '') + after.replace(/^[ \t]*\r?\n/, ''), description: `removed the <${loc.tagName}> element from ${loc.file}` });
    if (wholeComponent) {
      // the element IS the component: remove where the component is rendered
      const usage = new RegExp(`[ \\t]*<${name}\\b[^>]*?/>[ \\t]*\\r?\\n?`, 'g');
      // inside an expression (`cond && <X />`, `a ? <X /> : <Y />`) the usage is replaced by null instead of leaving a dangling operator
      const without = (text) => text.replace(new RegExp(`(^|[^\\n])([ \\t]*)<${name}\\b[^>]*?/>([ \\t]*\\r?\\n?)`, 'g'), (whole, lead, space, tail, offset) => {
        const prior = text.slice(0, offset + lead.length).replace(/\s+$/, '');
        return /(?:&&|\|\||\?\?|\?|:|=>|\()$/.test(prior) ? `${lead}${space}null${tail}` : `${lead}${tail && !/\S/.test(lead) ? tail : ''}`.replace(/^$/, '') ;
      });
      const sites = files.filter((f) => f.encoding !== 'base64' && /\.(?:jsx?|tsx?)$/.test(f.path || '') && typeof f.content === 'string' && f.content.match(usage));
      const same = sites.filter((f) => f.path === loc.file);
      const pool = same.length ? same : (sites.length === 1 ? sites : []);
      for (const site of pool) out.push({ file: site.path, kind: 'remove-usage', content: without(site.content), description: `removed <${name} /> from ${site.path}`, component: name, uses: (site.content.match(usage) || []).length });
    } else out.push(removeElement());
  }
  return out.filter((c) => c.uses === undefined || c.uses === 1);
}

async function runDuplicateRegionEngine({ files, route = '/', request = '', intent = parseDuplicateRequest(request), provenance = null, signal, inspect = inspectRenderedPreview, onState = null, maxRoutes = 10, viewport = { width: 1440, height: 900 } } = {}) {
  const report = { status: 'unresolved', state: STATES.DIAGNOSIS_PENDING, transitions: [], route, request, intent, files, changes: [], pages: [] };
  const move = (state, detail) => { report.state = state; report.transitions.push({ state, detail: detail || null }); if (onState) { try { onState(state, detail); } catch { /* reporting only */ } } };
  if (!intent) { report.status = 'not-a-duplicate-request'; return report; }
  const word = intent.target;
  const call = (list, r) => listRegions(list, r, word, { signal, inspect, viewport });
  move(STATES.DIAGNOSIS_PENDING, `counting the ${word} elements on ${route}`);
  let here;
  try { here = await call(files, route); } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    report.status = 'verification-unavailable'; report.reason = `The page ${route} could not be rendered, so its ${word} elements could not be counted: ${error.message}`; move(STATES.VERIFICATION_FAILED, report.reason); return report;
  }
  report.pages.push({ route, count: here.regions.length });
  // The other pages: which footer is shared, and where the duplicates really are.
  const others = knownRoutesFor(files, provenance).map((r) => r.path).filter((p) => p !== route).slice(0, maxRoutes);
  const survey = new Map([[route, here]]);
  for (const other of others) {
    try { const r = await call(files, other); survey.set(other, r); report.pages.push({ route: other, count: r.regions.length }); } catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; /* a page that cannot render is simply not part of the survey */ }
  }
  if (here.regions.length < 2) {
    const dupes = report.pages.filter((p) => p.count >= 2 && p.route !== route);
    report.status = 'no-duplicate';
    report.reason = `The page ${route} shows ${here.regions.length === 1 ? 'only one' : 'no'} ${word}, so nothing was removed.${dupes.length ? ` ${dupes.map((p) => `${p.route} shows ${p.count} ${word}s`).join(', ')}. Open that page and ask again.` : ` None of the other ${report.pages.length - 1} pages checked shows more than one.`}`;
    move(STATES.VERIFICATION_FAILED, report.reason); return report;
  }
  // Keep the one the rest of the site uses; remove the others.
  const usage = (region) => [...survey.entries()].filter(([r, data]) => r !== route && data.regions.some((x) => x.signature === region.signature)).length;
  const ranked = here.regions.map((region) => ({ region, shared: usage(region) })).sort((a, b) => b.shared - a.shared || a.region.top - b.region.top);
  const keep = ranked[0].region; const remove = ranked.slice(1).map((x) => x.region);
  report.keep = keep; report.remove = remove;
  move(STATES.CAUSE_IDENTIFIED, `${here.regions.length} ${word} elements on ${route}; keeping the one used on ${ranked[0].shared} other page(s)`);
  let working = files;
  for (const target of remove) {
    const options = candidateRemovals(working, target);
    if (!options.length) { report.reason = `The duplicate ${word} ("${target.text}") could not be traced to one place in the source.`; continue; }
    let done = false;
    for (const option of options) {
      signal?.throwIfAborted();
      const patched = working.map((f) => (f.path === option.file ? { ...f, content: option.content } : f));
      move(STATES.PATCH_APPLIED, option.description);
      let after;
      try { after = await call(patched, route); } catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; move(STATES.VERIFICATION_FAILED, `the patched project did not render: ${error.message}`); continue; }
      move(STATES.BUILD_PASSED);
      const checks = [];
      const add = (name, ok, detail) => checks.push({ name, status: ok ? 'passed' : 'failed', detail });
      const current = await call(working, route);
      add('one-fewer-region', after.regions.length === current.regions.length - 1, `${current.regions.length} -> ${after.regions.length} ${word} elements`);
      add('right-one-removed', after.regions.some((r) => r.signature === keep.signature) && !after.regions.some((r) => r.signature === target.signature && r.signature !== keep.signature), `the ${word} used by the rest of the site stays, "${target.text.slice(0, 40)}" is gone`);
      add('page-content-unchanged', after.restHash === current.restHash && after.restChars === current.restChars, 'all text outside the region is identical');
      add('page-shorter', after.docHeight < current.docHeight || (after.docHeight <= current.docHeight && current.docHeight <= viewport.height + 1), `page height ${current.docHeight}px -> ${after.docHeight}px`);
      // no other page may lose its region or change
      const side = [];
      for (const [other, data] of survey) {
        if (other === route) continue;
        let now; try { now = await call(patched, other); } catch { side.push(`${other} no longer renders`); continue; }
        if (now.regions.length !== data.regions.length || now.restHash !== data.restHash) side.push(`${other}: ${data.regions.length} -> ${now.regions.length} ${word} elements`);
      }
      add('other-pages-unchanged', !side.length, side.length ? side.slice(0, 3).join('; ') : `${survey.size - 1} other page(s) unchanged`);
      add('page-keeps-one', after.regions.length >= 1, `${after.regions.length} ${word} left`);
      report.changes.push({ file: option.file, kind: option.kind, description: option.description, checks, verified: checks.every((c) => c.status === 'passed') });
      move(STATES.RENDER_VERIFIED, `${checks.filter((c) => c.status === 'passed').length}/${checks.length} checks`);
      if (checks.every((c) => c.status === 'passed')) { working = patched; done = true; survey.set(route, after); break; }
      report.changes.pop();
      move(STATES.VERIFICATION_FAILED, checks.filter((c) => c.status === 'failed').map((c) => `${c.name}: ${c.detail}`).join('; '));
    }
    if (!done) { report.status = 'unresolved'; report.reason = report.reason || `No edit that removes the duplicate ${word} passed verification; the project was not changed.`; report.files = files; report.changes = []; return report; }
  }
  report.files = working;
  report.status = report.changes.length ? 'fixed' : 'unresolved';
  if (report.status === 'fixed') move(STATES.REGRESSION_PASSED, `${route} now shows one ${word}; other pages unchanged`); else move(STATES.VERIFICATION_FAILED, report.reason);
  return report;
}

module.exports = { runDuplicateRegionEngine, parseDuplicateRequest, listRegionsInPage, candidateRemovals, STATES };
