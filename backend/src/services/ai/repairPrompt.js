const imageDiagnostics = require('./imageDiagnostics');

/**
 * The request sent to the correction model after the rendered page failed validation.
 *
 * It carries (1) the structured diagnostics measured in the browser, (2) what earlier attempts changed and why they failed, so
 * the model does not repeat them, and (3) after a failed attempt, more source: the stylesheets and parent components that really
 * contain the culprit's classes (as verbatim snippets). Only those files become editable besides the files the edit changed.
 */

const slimDiagnostic = (diagnostic) => ({
  category: diagnostic.category, route: diagnostic.route, viewport: diagnostic.viewport, asset: diagnostic.asset,
  expected: diagnostic.expected, observed: diagnostic.observed, changedFromBaseline: diagnostic.changedFromBaseline,
  cause: diagnostic.cause, culprit: diagnostic.culprit, reason: diagnostic.reason, rule: diagnostic.rule,
  evidence: diagnostic.evidence, candidateFiles: diagnostic.candidateFiles, requiredAction: diagnostic.requiredAction
});

function layoutHint(issues = []) {
  const kinds = new Set((issues || []).map((issue) => issue?.kind));
  const lines = [];
  if (kinds.has('collapsed-image')) {
    lines.push('Images that now render with 0 width usually mean the container was turned into a grid/flex row while its children kept the placement or size from the OLD layout (grid-area / grid-column / grid-row, fixed width or percentage width, position:absolute, a width variable such as --image-component-container-width, aspect-ratio boxes with height 0).',
      'Fix the cause on the CHILDREN of the changed container: grid-area:auto; grid-column:auto; grid-row:auto; position:relative; width:auto; min-width:0; flex:1 1 0 (or one grid track each), and let the img fill its box (width:100%; height:auto; display:block). Use selectors scoped to the changed container, not global ones.');
  }
  if (kinds.has('horizontal-scroll')) lines.push('The page now scrolls sideways: allow the row to shrink (min-width:0 on children, flex-wrap:wrap or smaller tracks) instead of fixed widths.');
  return lines.length ? `\n\nROOT-CAUSE HINT:\n- ${lines.join('\n- ')}` : '';
}

/**
 * @returns {{ messages: Array, editablePaths: Set<string>, related: Array<{path:string, snippets:number}> }}
 */
function buildRepairMessages({ prompt, attempt, issues = [], files = [], changedPaths = [], diagnostics = [], history = [], widen = false, previousError = '', delimiterInstructions = '', viewOf = (text) => text, sourceContext = '' }) {
  const changed = files.filter((file) => changedPaths.includes(file.path) && file.encoding !== 'base64' && typeof file.content === 'string');
  const editablePaths = new Set(changed.map((file) => file.path));

  // After a failed attempt the cause is not in the files the edit touched: bring in the files that define the culprit.
  const related = [];
  let relatedText = '';
  if (widen && diagnostics.length) {
    const wanted = new Map();
    for (const diagnostic of diagnostics) for (const candidate of diagnostic.candidateFiles || []) if (!editablePaths.has(candidate.path) && !wanted.has(candidate.path)) wanted.set(candidate.path, diagnostic);
    for (const [filePath, diagnostic] of [...wanted].slice(0, 4)) {
      const file = files.find((item) => item.path === filePath);
      if (!file || file.encoding === 'base64' || typeof file.content !== 'string') continue;
      const image = { src: diagnostic.asset, chain: [{ label: 'img' }, { label: diagnostic.culprit || '' }, ...(diagnostic.evidence?.ancestors || []).map((node) => ({ label: node.label }))] };
      const tokens = imageDiagnostics.tokensOf(image, diagnostic.culprit);
      const snippets = file.content.length <= 24000 ? [file.content] : imageDiagnostics.snippetsAround(file.content, tokens);
      if (!snippets.length) continue;
      editablePaths.add(filePath);
      related.push({ path: filePath, snippets: snippets.length });
      relatedText += `--- RELATED FILE: ${filePath} (${file.content.length <= 24000 ? 'complete' : 'only the parts that mention the culprit; copy SEARCH text verbatim from them'}) ---\n${snippets.join('\n/* ... */\n')}\n\n`;
    }
  }

  const system = `${delimiterInstructions}\n\nYou are correcting visual defects found by rendering a page AFTER an edit. Change the SMALLEST amount of code that fixes the listed issues. Output ONLY <PATCH path="..."><SEARCH>..</SEARCH><REPLACE>..</REPLACE></PATCH> blocks (a <FILE> only for a genuinely new file). Patch ONLY the files shown. Never touch anything unrelated, never add global resets or !important hacks to hide a symptom (exception: when the issue says the requested arrangement is missing, rules scoped to the changed container may use !important because the captured stylesheet is very specific), never remove existing functionality. Copy SEARCH text verbatim.\nWhen DIAGNOSTICS are given they were MEASURED in the browser: fix the stated cause (the culprit element and the rule or layout that removes its width). Do not simply enlarge the image, do not hide the problem, and keep the image's aspect ratio, source and the requested arrangement. When PREVIOUS ATTEMPTS are listed, your patch must differ from them in substance: they did not change the measurements.`;

  const plainIssues = issues.slice(0, 12).map(({ diagnostic, ...rest }) => rest);
  const parts = [
    `ORIGINAL REQUEST:\n"${prompt}"`,
    `VALIDATION ATTEMPT ${attempt}. Issues found by rendering the page (each has the element and what is wrong):\n${JSON.stringify(plainIssues, null, 2)}`
  ];
  if (diagnostics.length) parts.push(`DIAGNOSTICS (structured, measured in the browser; one per failing image):\n${JSON.stringify(diagnostics.slice(0, 6).map(slimDiagnostic), null, 1).slice(0, 14000)}`);
  if (history.length) {
    parts.push(`PREVIOUS ATTEMPTS (do NOT repeat these; each shows what it changed and what was still wrong afterwards):\n${history.map((entry) => `- attempt ${entry.attempt}: ${entry.result}${entry.patchedFiles?.length ? ` | changed ${entry.patchedFiles.join(', ')}` : ''}${entry.patchPreview ? ` | patch: ${String(entry.patchPreview).slice(0, 420)}` : ''}${entry.remaining?.length ? ` | still failing: ${entry.remaining.join('; ')}` : ''}${entry.ineffective ? ' | INEFFECTIVE: the measurements did not change, so the cause was not touched' : ''}`).join('\n')}${widen ? '\nBecause earlier attempts did not help, more source is supplied below (stylesheets and parent components that mention the culprit). The cause may be there, not in the file you kept editing.' : ''}`);
  }
  parts.push(`FILES THIS EDIT CHANGED (current content; patch these first):\n${changed.map((file) => `--- FILE: ${file.path} ---\n${viewOf(file.content)}`).join('\n\n').slice(0, 260000)}`);
  if (relatedText) parts.push(`FILES THAT DEFINE THE CULPRIT (you may patch these too):\n${relatedText}`);
  if (sourceContext) parts.push(sourceContext);
  const tail = `${previousError ? `\n\nYOUR PREVIOUS ANSWER COULD NOT BE APPLIED: ${previousError}\nCopy each SEARCH block character for character from the file content above (no <REPLACE>/<SEARCH> tags inside code); choose a short, unique line.` : ''}${layoutHint(issues)}\nFind the root cause in these files and return the minimal PATCH blocks.`;
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: `${parts.join('\n\n')}${tail}` }], editablePaths, related };
}

module.exports = { buildRepairMessages, layoutHint };
