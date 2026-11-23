/**
 * Static functional audit of the files a job changed. It finds code that only LOOKS finished: values nothing reads, handlers that do
 * nothing, a success message with no work behind it, an assistant that is named but never asked. Only problems the change introduced
 * are reported (the same problem already in the baseline is not blamed on this change).
 */
const SOURCE = /^src\/.+\.(?:jsx?|tsx?)$/;
const SUCCESS_TEXT = /\b(?:successfully|has been sent|was sent|message sent|thank you for (?:contacting|your (?:message|enquiry|inquiry|submission))|submitted)\b/i;
const WORK = /\bfetch\s*\(|\baxios\b|\.ask\s*\(|\bmailto:|\bXMLHttpRequest\b|\blocalStorage\b|\bnavigate\s*\(|\bsetItem\s*\(/;

const count = (source, name) => (source.match(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || []).length;

function auditSource(path, source) {
  const found = [];
  const add = (kind, name, message, action) => found.push({ key: `${path}:${kind}:${name}`, path, kind, message, action });

  // 1. Values and functions declared at the top level that nothing reads.
  for (const match of source.matchAll(/^(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
    const name = match[1];
    if (count(source, name) <= 1) add('unused', name, `"${name}" is declared in ${path} but nothing uses it.`, `Use "${name}" where it belongs or delete it. Do not leave data or functions that only make the code look complete.`);
  }
  // 2. State that is never read or never set.
  for (const match of source.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState/g)) {
    const [, value, setter] = match;
    if (count(source, value) <= 1) add('unused-state', value, `The state "${value}" in ${path} is set but never shown or used.`, `Show "${value}" in the interface or remove the state.`);
    else if (count(source, setter) <= 1) add('unused-setter', setter, `The state "${value}" in ${path} is never changed (${setter} is never called).`, `Change "${value}" from the event that should change it, or make it a plain constant.`);
  }
  // 3. Controls that do nothing.
  for (const match of source.matchAll(/\bon(?:Click|Submit|Change|KeyDown)\s*=\s*\{\s*\(\s*[\w,\s]*\)\s*=>\s*(?:\{\s*\}|null|undefined|void 0)\s*\}/g)) {
    add('empty-handler', match[0].replace(/\s+/g, ' '), `A control in ${path} has an empty handler (${match[0].replace(/\s+/g, ' ')}).`, 'Connect the control to the action the owner asked for.');
  }
  for (const match of source.matchAll(/<(?:a|Link)\b[^>]*\b(?:href|to)\s*=\s*["']#["'][^>]*>/g)) {
    add('dead-link', match[0].slice(0, 60), `A link in ${path} goes to "#" and does nothing.`, 'Point it to the real page or section, or make it a button with a real action.');
  }
  // 4. A form that reports success without doing anything.
  if (/<form\b/.test(source) && SUCCESS_TEXT.test(source) && !WORK.test(source)) {
    add('fake-success', 'form', `A form in ${path} shows a success message but nothing is sent, stored or processed.`, 'Process the input for real (use the project\'s existing integration), or say plainly that it is not connected. Never show a success message that did not happen.');
  }
  // 5. The assistant is named but never asked, or its answer is never shown.
  if (/\bVEAVE_AI\b/.test(source)) {
    const asked = /\.ask\s*\(/.test(source);
    const used = asked && (/\.then\s*\(/.test(source) || /\bawait\b[^;\n]*\.ask\s*\(/.test(source));
    if (!used) add('assistant-unused', 'VEAVE_AI', `${path} mentions window.VEAVE_AI but never asks it a question and uses the answer.`, 'Call window.VEAVE_AI.ask(question, { topic }) with the visitor\'s own question and show the answer it returns.');
  }
  return found;
}

/** @returns {Array<{ key, path, kind, message, action }>} problems that exist in the changed files but not in the baseline. */
function auditChange({ baseline = [], candidate = [], changedPaths = [] }) {
  const before = new Map(baseline.map((file) => [file.path, file]));
  const problems = [];
  for (const path of changedPaths) {
    if (!SOURCE.test(path)) continue;
    const file = candidate.find((item) => item.path === path);
    if (!file || typeof file.content !== 'string' || file.encoding === 'base64') continue;
    const old = before.get(path);
    const known = new Set(old && typeof old.content === 'string' ? auditSource(path, old.content).map((item) => item.key) : []);
    for (const item of auditSource(path, file.content)) if (!known.has(item.key)) problems.push(item);
  }
  return problems;
}

module.exports = { auditSource, auditChange };
