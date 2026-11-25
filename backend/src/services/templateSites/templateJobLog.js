/**
 * Plain-language log lines for a template job. A failed job used to be one very long line (with the test server's bundle address in it);
 * here it is a short report: what was asked, where it stopped, why, what was tried, which page really crashed, and what to do next.
 * Pure functions (no database, no logger), so they are easy to test.
 */

// code -> [why in plain words, what to do]
const WHY = {
  BUILD_VALIDATION_FAILED: ['The changed website did not build, or a page crashed in the browser test.', 'Nothing was saved. If a page other than the edited one crashed, that page still reads something the change removed: change that page first, or tick only the section you mean.'],
  PAGE_VALIDATION_FAILED: ['The new page broke one of the page checks (content, links, pictures, sections kept).', 'Nothing was saved. Describe the change in smaller steps, or tick only the section you mean.'],
  INTENT_NOT_MET: ['The final check found that the result does not do what was asked.', 'Nothing was saved. Say it more plainly (what the website or page should be about, in one clear sentence), or split the request into one section at a time.'],
  MODEL_ANSWER_UNUSABLE: ['The AI kept returning an answer that could not be used (empty or cut off).', 'Nothing was saved. Try again; if it repeats, ask for a smaller change.'],
  NO_USABLE_CHANGES: ['None of the AI\'s changes were inside the part of the website it may change.', 'Nothing was saved. Tick the section you mean and try again.'],
  FINAL_CHECK_FAILED: ['The last whole-website check failed.', 'Nothing was saved. Try again.'],
  IDENTITY_FAILED: ['The website\'s name, menu and wording did not match the plan.', 'Nothing was saved. Try again with a clearer description of the website.'],
  JOB_TIMEOUT: ['The job took longer than its time limit and was stopped.', 'Nothing was saved. Ask for a smaller change.'],
  JOB_LEASE_LOST: ['The job was interrupted (the server restarted or another process took it over).', 'Nothing was saved. Run it again.'],
  PROVIDER_CREDITS: ['The AI provider has no credits left.', 'Add credits at the provider, then run it again.'],
  PROVIDER_AUTH: ['The AI provider refused the API key.', 'Check OPENROUTER_API_KEY on the server.'],
  PROVIDER_RATE_LIMIT: ['The AI provider is limiting requests right now.', 'Wait a few minutes and run it again.'],
  PROVIDER_MODEL: ['The configured AI model is not available.', 'Check the model names in the server settings.'],
  JOB_FAILED: ['The job stopped on an error.', 'See the detail line; if it is a network error (for example the storage or the AI provider could not be reached) run it again.']
};

/** An error's own text, made readable: the test server's address and bundle file name are replaced, stack frames and blank space removed. */
function cleanDetail(text, limit = 260) {
  return String(text || '')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/assets\/[^\s)]+/g, 'the built site')
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, '')
    .replace(/\n\s*at [^\n]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/** The routes a build/browser failure names ("Route /listings/p-01", "http://127.0.0.1:4173/listings/p-01"), in order, without repeats. */
function routesIn(issues = []) {
  const found = [];
  for (const item of issues) {
    const text = `${item?.path || ''} ${item?.message || ''}`;
    for (const match of text.matchAll(/(?:Route\s+|https?:\/\/(?:127\.0\.0\.1|localhost):\d+)(\/[A-Za-z0-9._~%/-]*)/g)) {
      const route = match[1].replace(/\/+$/, '') || '/';
      if (!route.startsWith('/assets/') && !found.includes(route)) found.push(route);
    }
  }
  return found;
}

const seconds = (ms) => { const total = Math.max(0, Math.round(ms / 1000)); return total >= 90 ? `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s` : `${total} s`; };

/** What the job tried, counted from its own history: tries of the whole page, repair rounds, build + browser test runs. */
function effort(job) {
  const timeline = job?.timeline || [];
  const calls = job?.callTimings || [];
  return {
    tries: 1 + timeline.filter((entry) => /^Improving the result \(try \d+ of \d+\)/.test(entry?.step || '')).length,
    repairs: calls.filter((call) => /^repair/.test(call?.label || '')).length,
    builds: calls.filter((call) => /build \+ browser tests/.test(call?.label || '')).length,
    buildSeconds: Math.round(calls.filter((call) => /build \+ browser tests/.test(call?.label || '')).reduce((sum, call) => sum + (call.ms || 0), 0) / 1000),
    aiSeconds: Math.round(calls.filter((call) => /^(write page|repair|intent review|content review|understand intent|write browser tests|web research)/.test(call?.label || '')).reduce((sum, call) => sum + (call.ms || 0), 0) / 1000)
  };
}

/**
 * The report for a failed job, as one string with line breaks.
 * @param {object} p  { job, code, error, pageName, pageRoute, pages: [{ name, route }], elapsedMs, shown }
 */
function failureReport({ job, code, error, pageName = '', pageRoute = '', pages = [], elapsedMs = 0, timedOut = false }) {
  const [why, next] = WHY[code] || WHY.JOB_FAILED;
  const used = effort(job);
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const asked = cleanDetail(String(job?.instruction || '').split('\n')[0], 110);
  const section = String(job?.focusSection || '').trim();
  const lines = [`Template job ${job?.jobId} FAILED: ${pageName ? `${pageName} page` : (job?.type || 'job')} - ${code}`];
  lines.push(`  asked     : "${asked}${String(job?.instruction || '').split('\n')[0].length > 110 ? '...' : ''}"${section ? ` (section: ${section.slice(0, 60)})` : ''}`);
  lines.push(`  stopped at: ${job?.stepName || 'unknown step'}, after ${seconds(elapsedMs)}`);
  if (used.builds || used.repairs || used.tries > 1) lines.push(`  tried     : ${used.tries} ${used.tries === 1 ? 'try' : 'tries'}, ${used.repairs} repair${used.repairs === 1 ? '' : 's'}, ${used.builds} build + browser test run${used.builds === 1 ? '' : 's'} (${seconds(used.buildSeconds * 1000)} of the ${seconds(elapsedMs)} was spent building and testing; the AI itself took ${seconds(used.aiSeconds * 1000)})`);
  const read = understood(job);
  if (read) lines.push(`  understood: ${read}`);
  lines.push(`  why       : ${why}`);
  if (code === 'INTENT_NOT_MET' && job?.intent && !job.intent.subject && Number(job.intent.confidence) < 0.7) lines.push('  note      : the request itself was not clear to the AI (no subject found), so it kept the website\'s saved description. Say what the page or website should be about.');
  const routes = routesIn(issues);
  if (routes.length) {
    const named = routes.slice(0, 4).map((route) => { const match = pages.find((page) => page.route === route); return `${route}${match ? ` (${match.name})` : ''}${pageRoute && route === pageRoute ? ' <- the edited page' : ''}`; });
    const other = routes.filter((route) => route !== pageRoute);
    lines.push(`  broke on  : ${named.join(', ')}${other.length && pageRoute ? ` - ${other.length === routes.length ? 'not the page that was edited' : 'including pages other than the edited one'}` : ''}`);
  }
  const detail = issues.length ? [...new Set(issues.map((item) => cleanDetail(item?.message, 200)).filter(Boolean))].slice(0, 2) : [cleanDetail(error?.message || error, 300)];
  detail.filter(Boolean).forEach((text, index) => lines.push(`  ${index === 0 ? 'detail    :' : '           '} ${text}`));
  lines.push(`  next      : ${timedOut ? WHY.JOB_TIMEOUT[1] : next}`);
  return lines.join('\n');
}

/** How the AI read the request, in one line: "targeted_edit, subject none, confidence 0.55 (unsure)". */
function understood(job) {
  const intent = job?.intent;
  if (!intent || typeof intent !== 'object') return '';
  const confidence = Number(intent.confidence);
  const level = Number.isFinite(confidence) ? `${confidence.toFixed(2)} (${confidence >= 0.8 ? 'sure' : confidence >= 0.6 ? 'fairly sure' : 'UNSURE'})` : 'unknown';
  return `${intent.intent || 'unknown'}, scope ${intent.scope || 'unknown'}, subject ${intent.subject ? `"${intent.subject}"` : 'none found'}, confidence ${level}`;
}

/** One short line for a try that failed and will be tried again. */
function retryLine({ jobId, attemptNo, tries, code, error }) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const first = issues.length ? cleanDetail(issues[0]?.message, 160) : cleanDetail(error?.message || error, 160);
  return `Template job ${jobId}: try ${attemptNo} of ${tries} did not pass (${code || 'error'}): ${first} - trying again.`;
}

module.exports = { cleanDetail, routesIn, effort, understood, failureReport, retryLine, WHY };
