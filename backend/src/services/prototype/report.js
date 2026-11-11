'use strict';

// Stage 13: the completion report. Says exactly what was built from the reference, what was not, and why.
// Three modes, never mixed up:
//   reference-based    the site was crawled, its design measured, and (nearly) every built page passed validation
//   partial-reference  some of that evidence is missing or some pages could not be built or validated
//   prompt-only        the reference could not be read at all; nothing here follows the reference

const PAGE_DONE = new Set(['validated', 'built-with-issues']);

function counts(state) {
  const pages = Object.entries(state.pageStates || {});
  const by = (status) => pages.filter(([, p]) => p.status === status).length;
  return { total: pages.length, validated: by('validated'), withIssues: by('built-with-issues'), failed: by('failed'), regressed: by('regressed'), queued: by('queued') + by('generating') + by('validating') + by('repairing') };
}

function decideMode(state, config) {
  const data = state.data || {};
  const captured = (data.pages || []).filter((p) => p.status === 'captured');
  const home = captured.find((p) => p.route === '/') || captured[0];
  if (!home || !data.designSystem?.ok) return 'prompt-only';
  const crawl = data.crawl || {};
  const failures = (crawl.failures || []).filter((f) => !['robots-disallowed', 'not-found'].includes(f.kind));
  const reachable = captured.length + failures.length;
  const coverage = reachable ? captured.length / reachable : 1;
  const c = counts(state);
  const builtShare = c.total ? (c.validated) / c.total : 0;
  const missingEvidence = (data.designSystem?.evidence?.missingRoles || []).filter((r) => ['h1', 'p'].includes(r));
  if (coverage >= config.referenceCoverage && !crawl.truncated && c.failed === 0 && c.regressed === 0 && c.withIssues === 0 && builtShare >= 0.8 && missingEvidence.length === 0 && (data.inventory?.notBuilt || []).length === 0) return 'reference-based';
  return 'partial-reference';
}

function headline(mode, state, c) {
  const url = state.url;
  if (mode === 'prompt-only') return `The reference website ${url} could not be read, so this site was built from your description only. It does not follow ${url}.`;
  const base = `Built ${c.validated + c.withIssues} of ${c.total} page(s) following ${url}`;
  if (mode === 'reference-based') return `${base}. Every built page was rendered and checked against the reference.`;
  const parts = [];
  if (c.withIssues) parts.push(`${c.withIssues} built but still have unresolved differences`);
  if (c.failed) parts.push(`${c.failed} could not be built`);
  if (state.data?.crawl?.truncated) parts.push(`the crawl stopped at the ${state.data.crawl.truncatedReason}`);
  if ((state.data?.inventory?.notBuilt || []).length) parts.push(`${state.data.inventory.notBuilt.length} discovered page(s) were not built`);
  if ((state.data?.crawl?.failures || []).some((f) => !['robots-disallowed', 'not-found'].includes(f.kind))) parts.push('some reference pages could not be read');
  return `${base} (partial reference): ${parts.join('; ') || 'some reference evidence is missing'}.`;
}

function buildReport(state, config) {
  const data = state.data || {};
  const mode = decideMode(state, config);
  const c = counts(state);
  const crawl = data.crawl || {};
  const pages = Object.entries(state.pageStates || {}).map(([route, p]) => ({
    route, status: p.status, attempts: p.attempts || 0, repairAttempts: p.repairAttempts || 0, file: p.file,
    issues: (p.lastValidation?.issues || []).filter((i) => i.severity !== 'minor').slice(0, 12).map((i) => ({ kind: i.kind, severity: i.severity, viewport: i.viewport, message: i.message })),
    minorIssues: (p.lastValidation?.counts?.minor) || 0, error: p.error || null
  }));
  const slots = data.manifest?.slots || [];
  const unresolvedAssets = [
    ...(data.manifest?.unavailable || []).map((u) => ({ assetId: u.assetId, reason: u.reason })),
    ...pages.flatMap((p) => p.issues.filter((i) => /^(slot-|asset-|image-)/.test(i.kind)).map((i) => ({ route: p.route, kind: i.kind, message: i.message })))
  ].slice(0, 60);
  const missingEvidence = [];
  if (!data.pages?.some((p) => p.mobile)) missingEvidence.push('no mobile measurements were captured');
  (data.designSystem?.evidence?.missingRoles || []).forEach((r) => missingEvidence.push(`no ${r} text found to measure`));
  (crawl.failures || []).forEach((f) => missingEvidence.push(`${f.route}: ${f.kind} (${f.message})`));
  if (crawl.truncated) missingEvidence.push(`crawl stopped at the ${crawl.truncatedReason}; ${(crawl.queued || []).length} discovered route(s) were not visited`);
  (data.inventory?.notBuilt || []).forEach((n) => missingEvidence.push(`${n.route}: not built (${n.reason})`));
  const filledBy = slots.reduce((m, s) => { if (s.fill) m[s.fill] = (m[s.fill] || 0) + 1; return m; }, {});
  return {
    mode, label: mode === 'reference-based' ? 'Reference-based' : mode === 'partial-reference' ? 'Partial reference' : 'Prompt only',
    headline: headline(mode, state, c),
    source: { url: state.url, normalizedUrl: state.normalizedUrl || state.url },
    crawl: { captured: (data.pages || []).filter((p) => p.status === 'captured').length, failed: (crawl.failures || []).length, failures: (crawl.failures || []).slice(0, 40), discovered: crawl.discovered || 0, truncated: Boolean(crawl.truncated), truncatedReason: crawl.truncatedReason || null, robots: crawl.robots || null, sitemapRoutes: crawl.sitemapRoutes || 0 },
    design: data.designSystem?.ok ? { measuredPages: data.designSystem.source?.pagesMeasured, fonts: { heading: data.designSystem.fonts?.heading?.google || data.designSystem.fonts?.heading?.original, body: data.designSystem.fonts?.body?.google || data.designSystem.fonts?.body?.original }, primary: data.designSystem.colors?.primary, background: data.designSystem.colors?.background, missingRoles: data.designSystem.evidence?.missingRoles || [] } : null,
    assets: { slots: slots.length, filledBy, referenceAssets: data.manifest?.stats?.assets || 0, downloaded: data.manifest?.stats?.downloaded || 0, unavailable: (data.manifest?.unavailable || []).length, unresolved: unresolvedAssets },
    pages, counts: c,
    regression: data.regression || null,
    unresolved: pages.filter((p) => !PAGE_DONE.has(p.status) || p.issues.length).map((p) => ({ route: p.route, status: p.status, issues: p.issues.map((i) => i.kind) })),
    missingEvidence
  };
}

/** The queue shown in the UI: real stage and per-page state, nothing assumed. */
function toQueue(state) {
  const order = ['normalize', 'crawl', 'dom', 'styles', 'assets', 'inventory', 'design', 'shared', 'pages', 'validate', 'repair', 'regression', 'save'];
  const labels = { normalize: 'Check the website address', crawl: 'Crawl the website', dom: 'Read page structure', styles: 'Measure fonts and colours', assets: 'Map images', inventory: 'List pages and shared parts', design: 'Build the design system', shared: 'Build navigation and footer', pages: 'Build the pages', validate: 'Check each page in a browser', repair: 'Fix differences', regression: 'Check the whole site', save: 'Save the project' };
  const stages = order.map((id) => {
    const st = state.stages?.[id];
    const status = !st ? 'pending' : st.status === 'done' ? 'done' : st.status === 'running' ? 'active' : st.status === 'failed' ? 'failed' : st.status === 'skipped' ? 'skipped' : 'pending';
    return { id, label: labels[id], status, attempts: st?.attempts || 0, detail: st?.detail || null };
  });
  const pageStatus = { queued: 'queued', generating: 'building', validating: 'checking', repairing: 'fixing', validated: 'done', 'built-with-issues': 'needs-review', failed: 'failed', regressed: 'needs-review', skipped: 'skipped' };
  const pages = Object.entries(state.pageStates || {}).map(([route, p]) => ({ route, path: route, label: p.label || route, status: pageStatus[p.status] || p.status, attempts: p.attempts || 0, issues: (p.lastValidation?.counts?.blocking || 0) + (p.lastValidation?.counts?.major || 0) }));
  // Six groups for the small progress panel; the 13 detailed stages are kept for reports and support.
  const groupDefs = [['crawl', 'Crawl the website', ['normalize', 'crawl', 'dom', 'styles']], ['design', 'Map images and design', ['assets', 'inventory', 'design']], ['shared', 'Navigation and footer', ['shared']], ['pages', 'Build and check pages', ['pages', 'validate', 'repair']], ['regression', 'Check the whole site', ['regression']], ['save', 'Save the project', ['save']]];
  const groups = groupDefs.map(([id, label, members]) => {
    const parts = members.map((m) => stages.find((s) => s.id === m));
    const status = parts.some((p) => p.status === 'failed') ? 'failed' : parts.every((p) => p.status === 'done' || p.status === 'skipped') ? 'done' : parts.some((p) => p.status === 'active' || p.status === 'done') ? 'active' : 'pending';
    return { id, label, status };
  });
  const done = stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return { url: state.url, mode: state.mode || null, stages: groups, detail: stages, pages, runId: state.runId, progress: Math.round((done / stages.length) * 100) };
}

module.exports = { buildReport, decideMode, toQueue, counts, PAGE_DONE };
