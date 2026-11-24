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
9. When a DETECTED INTENT is given it is what the owner meant, spelling mistakes aside. For a rewrite (rewrite_required) the change is met only if most of the visible headings, paragraphs and labels of the page were replaced, not a few strings. For a redesign it is met only if the structure or composition really changed. When the intent says ALREADY REWRITTEN, the page was rewritten by an earlier change: do not demand that most of the wording changes again, and judge only the specific things the instruction still asks for (a new subject or name, something removed, something that still speaks about the old subject).
10. When VISIBLE WORDING NOW ON THE PAGE is given and the intent is a rewrite, check it against the WEBSITE named there: any wording that belongs to a different kind of website (for example property listings, prices, FOR SALE badges, bedrooms, bathrooms or square feet on a college website) means met is false; name the file and the leftover wording in unmet.\n11. When WEB RESEARCH is given: if it found facts, the page must use them where the instruction asks for them (the figures as stated, with their source named) and must not contradict them; a figure the research did not find may be shown as a request to contact the organisation, which is correct, not a failure. If the research found nothing, the owner's request for researched figures cannot be met: judge only the rest of the instruction, and do not fail the change for placeholders or for missing figures.
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
async function reviewIntent({ instruction, focus = '', baseline, candidate, changedPaths, deps = {}, signal, intent = null, keptShare = null, refinement = false, wording = '', site = '', research = null }) {
  const ask = deps.askIntentModel || (process.env.OPENROUTER_API_KEY ? defaultAsk() : null);
  if (!ask) return { met: null, unmet: [], unrelated: [], skipped: 'No reviewer is available.' };
  const change = describeChange({ baseline, candidate, changedPaths });
  if (!change) return { met: false, unmet: ['Nothing that could be seen on the page was changed.'], unrelated: [] };
  const words = ownerPart(instruction);
  if (!words) return { met: null, unmet: [], unrelated: [], skipped: 'No instruction.' };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `OWNER INSTRUCTION:\n${words}\n\n${intent ? `DETECTED INTENT: ${intent.intent} (${intent.scope}); rewrite_required=${intent.rewrite_required}${refinement ? '; ALREADY REWRITTEN' : ''}; operations: ${intent.operations.map((op) => `${op.type} -> ${op.target}`).join('; ')}${keptShare === null ? '' : `; ${Math.round(keptShare * 100)}% of the page's old wording is still there`}\n\n` : ''}${site ? `WEBSITE: ${site}\n\n` : ''}SECTION: ${focus || '(the whole page)'}\n\n${wording ? `VISIBLE WORDING NOW ON THE PAGE:\n${wording}\n\n` : ''}${research ? `WEB RESEARCH: ${research.found ? `found ${research.items} item(s) from ${research.sources.slice(0, 3).join(', ')}` : 'nothing reliable was found online (the owner asked for a web search)'}\n\n` : ''}CHANGED LINES:\n${change}` }
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
