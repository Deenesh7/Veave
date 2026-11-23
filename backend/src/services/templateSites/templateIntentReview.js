/**
 * Independent review of a finished change against the owner's own words. It does not depend on what the prompt was about: it is given
 * the instruction and the exact lines that changed, and answers whether the instruction was really carried out. A change that is empty,
 * different from what was named (navy instead of black), aimed at another section, or only partly done comes back as "not met" with
 * the reason, and goes to the same repair loop as any other problem. Used before the build (cheap, saves a failed build) and again on the
 * final result, because a repair of the build can undo or alter the change.
 */
const logger = require('../../utils/logger');

const MAX_DIFF = 14000;

const SYSTEM = `You are a strict reviewer of ONE change made to a React website, judging whether the owner's instruction was carried out.

You get the owner's instruction, the section it was about (if any) and the lines that changed (removed lines start with "-", added lines with "+").

Answer JSON only: {"met":boolean,"unmet":[string],"unrelated":[string]}

Judge by what the changed lines really do:
1. Every thing the owner asked for must be visible in the added lines. If nothing meaningful changed, met is false.
2. An exact value the owner named must be used exactly: "black" is black (bg-black, #000), not a dark blue or the nearest theme colour; "24px" is 24px; a named word is that word. A different value is not met.
3. "No X" / "remove X" means X is gone, not hidden or replaced by something similar.
4. A request to rewrite or redesign a section is met only if that section's visible text or structure really changed, not only a class or a comment.
5. The change must be in the section the owner named. A change aimed elsewhere is not met.
6. Behaviour (click, type, open, submit, search) is met only if the added code wires the control to the action: a handler that does the work, not an empty handler, unused data or a fixed message.
7. Do not fail a change for style choices the owner did not specify. Do not demand more than was asked.
8. "unmet" lists, in plain words, what is missing or wrong (one short sentence each). "unrelated" lists changes the owner did not ask for that look harmful (leave empty when none).
If the instruction itself is too vague to judge, answer met:true when the change is a reasonable reading of it.`;

/** Lines that differ between two texts, with a little context, as a compact unified-style listing. */
function lineDiff(before, after, context = 2) {
  const a = String(before || '').split('\n');
  const b = String(after || '').split('\n');
  const inA = new Set(a);
  const inB = new Set(b);
  const out = [];
  let skipped = 0;
  const near = new Set();
  b.forEach((line, index) => { if (!inA.has(line)) for (let k = -context; k <= context; k += 1) near.add(index + k); });
  b.forEach((line, index) => {
    if (!inA.has(line)) { if (skipped) { out.push('...'); skipped = 0; } out.push(`+ ${line.trim().slice(0, 400)}`); }
    else if (near.has(index)) { if (skipped) { out.push('...'); skipped = 0; } out.push(`  ${line.trim().slice(0, 200)}`); }
    else skipped += 1;
  });
  a.forEach((line) => { if (!inB.has(line)) out.push(`- ${line.trim().slice(0, 400)}`); });
  return out.join('\n');
}

function describeChange({ baseline, candidate, changedPaths }) {
  const parts = [];
  let size = 0;
  for (const path of changedPaths) {
    if (!/\.(jsx?|tsx?|css|json)$/.test(path)) continue;
    const before = (baseline.find((file) => file.path === path) || {}).content || '';
    const after = (candidate.find((file) => file.path === path) || {}).content;
    if (typeof after !== 'string') continue;
    const diff = lineDiff(before, after).slice(0, Math.max(0, MAX_DIFF - size));
    if (!diff.trim()) continue;
    parts.push(`--- ${path}\n${diff}`);
    size += diff.length;
  }
  return parts.join('\n\n');
}

const ownerPart = (instruction) => String(instruction || '').split(/\n\nSECTION CONTENT|\n\n\(The owner|\n\nPAGE CONTEXT|\n\nSECTION CONTENT/)[0].trim().slice(0, 1500);

function parseJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { return null; }
}

function defaultAsk() {
  const openrouter = require('../ai/openrouterService');
  return async (messages, { signal } = {}) => {
    const result = await openrouter.generateCompletion(messages, { temperature: 0, max_tokens: 2500, response_format: false, reasoning: { effort: 'low', exclude: true }, timeout: 60000, signal });
    return { content: String(result?.content || ''), usage: result?.usage || null };
  };
}

/**
 * @returns {{ met: boolean|null, unmet: string[], unrelated: string[], usage?: object, skipped?: string }}
 *   met null means "could not be judged" (no reviewer available): the change is neither blamed nor praised.
 */
async function reviewIntent({ instruction, focus = '', baseline, candidate, changedPaths, deps = {}, signal }) {
  const ask = deps.askIntentModel || (process.env.OPENROUTER_API_KEY ? defaultAsk() : null);
  if (!ask) return { met: null, unmet: [], unrelated: [], skipped: 'No reviewer is available.' };
  const change = describeChange({ baseline, candidate, changedPaths });
  if (!change) return { met: false, unmet: ['Nothing that could be seen on the page was changed.'], unrelated: [] };
  const words = ownerPart(instruction);
  if (!words) return { met: null, unmet: [], unrelated: [], skipped: 'No instruction.' };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `OWNER INSTRUCTION:\n${words}\n\nSECTION: ${focus || '(the whole page)'}\n\nCHANGED LINES:\n${change}` }
  ];
  try {
    const answer = await ask(messages, { signal });
    const parsed = parseJson(answer.content);
    if (!parsed || typeof parsed.met !== 'boolean') return { met: null, unmet: [], unrelated: [], skipped: 'The reviewer gave no usable answer.', usage: answer.usage };
    const list = (value) => (Array.isArray(value) ? value.map((item) => String(item).slice(0, 240)).filter(Boolean).slice(0, 4) : []);
    return { met: parsed.met, unmet: list(parsed.unmet), unrelated: list(parsed.unrelated), usage: answer.usage };
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`Intent review was skipped: ${error.message}`);
    return { met: null, unmet: [], unrelated: [], skipped: 'The reviewer was unavailable.' };
  }
}

module.exports = { reviewIntent, lineDiff, describeChange, SYSTEM };
