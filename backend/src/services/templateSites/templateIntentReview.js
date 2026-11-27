/**
 * Independent review of a finished change against the owner's own words. It does not depend on what the prompt was about: it is given
 * the instruction and the exact lines that changed, and answers whether the instruction was really carried out. A change that is empty,
 * different from what was named (navy instead of black), aimed at another section, or only partly done comes back as "not met" with
 * the reason, and goes to the same repair loop as any other problem. Used before the build (cheap, saves a failed build) and again on the
 * final result, because a repair of the build can undo or alter the change.
 */
const logger = require('../../utils/logger');

const MAX_DIFF = 36000;

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
10. When VISIBLE WORDING NOW ON THE PAGE is given and the intent is a rewrite, check it against the WEBSITE named there: any wording that belongs to a different kind of website (for example property listings, prices, FOR SALE badges, bedrooms, bathrooms or square feet on a college website) means met is false; name the file and the leftover wording in unmet.\n11. When WEB RESEARCH is given: if it found facts, the page must use them where the instruction asks for them (the figures as stated, with their source named) and must not contradict them; a figure the research did not find may be shown as a request to contact the organisation, which is correct, not a failure. The owner may have misspelt the name of the organisation ("Savitam" for "Saveetha"): when WEB RESEARCH names the organisation it found and that is what the WEBSITE is about, the page must use that correct name, and using it is right, never a reason to fail. If the research found nothing, the owner's request for researched figures cannot be met: judge only the rest of the instruction, and do not fail the change for placeholders or for missing figures.
12. When SECTIONS THE OWNER DID NOT TICK are listed, the owner chose to change ONLY the SECTION named above; the listed sections are locked and must stay exactly as they are. Judge the change inside the ticked section only. Never answer met:false because of what a locked section contains or still says (old wording, another subject, property listings, prices), and never ask for a locked section to be changed: that would break the owner's selection. The rule about VISIBLE WORDING (10) and a rewrite of "most of the page" (9) then apply to the ticked section only.
13. When a WORK LIST is given, it is the instruction split into the items this page needs: judge the change item by item. met is true only when every item is done; for each item that is not, put its number and what is missing in unmet ("Item 3: the Key facts section still says ..."). Do not demand anything that is neither in the list nor in the instruction. A section in the WORK LIST is named by its OLD heading: after a rewrite that heading is gone (it may only appear as a removed line, or not at all). The item is done when the section in that place now shows new wording for the subject; never fail an item because its old heading is missing from the added lines, and never because a part of the change is not shown when the listing says lines were left out.
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

/** A file's diff cut to `budget` characters on whole lines: added lines first, the removed ones in what is left. */
function fitDiff(diff, budget) {
  if (diff.length <= budget) return { text: diff, cut: 0 };
  const lines = diff.split('\n');
  const kept = [];
  let size = 0;
  let cut = 0;
  for (const pass of [(line) => !line.startsWith('- '), (line) => line.startsWith('- ')]) {
    for (const line of lines) {
      if (!pass(line)) continue;
      if (size + line.length + 1 > budget) { cut += 1; continue; }
      kept.push(line);
      size += line.length + 1;
    }
  }
  return { text: kept.join('\n'), cut };
}

/**
 * The changed lines of every file, the page's own files first. Each file gets a fair share of the budget (what a small file does not use
 * goes to the others), so a large rewrite of a shared component can never push the page itself out of the reviewer's sight.
 */
function describeChange({ baseline, candidate, changedPaths, primary = [] }) {
  const rank = (path) => { const index = primary.indexOf(path); return index === -1 ? primary.length + (/^src\/pages\//.test(path) ? 0 : 1) : index; };
  const diffs = [...changedPaths]
    .filter((path) => /\.(jsx?|tsx?|css|json)$/.test(path))
    .sort((a, b) => rank(a) - rank(b))
    .map((path) => {
      const before = (baseline.find((file) => file.path === path) || {}).content || '';
      const after = (candidate.find((file) => file.path === path) || {}).content;
      return { path, diff: typeof after === 'string' ? lineDiff(before, after) : '' };
    })
    .filter((item) => item.diff.trim());
  const parts = [];
  let left = MAX_DIFF;
  let cutLines = 0;
  // Smallest first for the sharing, so what a small file leaves is given to the larger ones; shown in the ranked order.
  const fitted = new Map();
  [...diffs].sort((a, b) => a.diff.length - b.diff.length).forEach((item, index, all) => {
    const share = Math.floor(left / (all.length - index));
    const { text, cut } = fitDiff(item.diff, share);
    fitted.set(item.path, text);
    left -= text.length;
    cutLines += cut;
  });
  for (const item of diffs) if (fitted.get(item.path)) parts.push(`--- ${item.path}\n${fitted.get(item.path)}`);
  if (cutLines) parts.push(`(${cutLines} changed line(s) are not shown because the change is large, mostly removed old lines. A section that is not shown here is NOT evidence that it was left unchanged: judge it by VISIBLE WORDING NOW ON THE PAGE.)`);
  return parts.join('\n\n');
}

const ownerPart = (instruction) => require('./templateValidationService').ownerWords(instruction).trim().slice(0, 1500);

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
async function reviewIntent({ instruction, focus = '', lockedSections = [], workList = [], baseline, candidate, changedPaths, deps = {}, signal, intent = null, keptShare = null, refinement = false, wording = '', site = '', research = null, primary = [] }) {
  const ask = deps.askIntentModel || (process.env.OPENROUTER_API_KEY ? defaultAsk() : null);
  if (!ask) return { met: null, unmet: [], unrelated: [], skipped: 'No reviewer is available.' };
  const change = describeChange({ baseline, candidate, changedPaths, primary });
  if (!change) return { met: false, unmet: ['Nothing that could be seen on the page was changed.'], unrelated: [] };
  const words = ownerPart(instruction);
  if (!words) return { met: null, unmet: [], unrelated: [], skipped: 'No instruction.' };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `OWNER INSTRUCTION:\n${words}\n\n${intent ? `DETECTED INTENT: ${intent.intent} (${intent.scope}); rewrite_required=${intent.rewrite_required}${refinement ? '; ALREADY REWRITTEN' : ''}; operations: ${intent.operations.map((op) => `${op.type} -> ${op.target}`).join('; ')}${keptShare === null ? '' : `; ${Math.round(keptShare * 100)}% of the page's old wording is still there`}\n\n` : ''}${site ? `WEBSITE: ${site}\n\n` : ''}SECTION: ${focus || '(the whole page)'}\n\n${lockedSections.length ? `SECTIONS THE OWNER DID NOT TICK (locked; never a reason for met:false): ${lockedSections.map((name) => `"${name}"`).join(', ')}\n\n` : ''}${workList.length ? `WORK LIST:\n${require('./templateWorkList').asText(workList)}\n\n` : ''}${wording ? `VISIBLE WORDING NOW ON THE PAGE:\n${wording}\n\n` : ''}${research ? `WEB RESEARCH: ${research.found ? `found ${research.items} item(s) about ${research.organisation || 'the organisation'} from ${research.sources.slice(0, 3).join(', ')}` : 'nothing reliable was found online (the owner asked for a web search)'}\n\n` : ''}CHANGED LINES:\n${change}` }
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
