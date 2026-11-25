/**
 * Turns the owner's instruction into browser tests (the runner's plan format: click, fill, select, check, assert) so the website is
 * really operated in a headless browser before a change is called complete. The tests run inside the normal build + browser gate, so a
 * failure goes to the same repair loop as a build error. When no usable test can be written, the result says "unverified": the job is
 * never reported as verified when nothing verified it.
 */
const logger = require('../../utils/logger');

const MAX_TESTS = 4;
const MAX_SOURCE = 14000;

const SYSTEM = `You write acceptance tests for ONE change to a React website. A headless browser will run them against the built site.

Return JSON only: {"tests":[{"name":string,"path":string,"viewports":["desktop"],"steps":[...]}]}

Allowed steps (nothing else exists, no scripts):
- {"action":"click","selector":S}
- {"action":"fill","selector":S,"value":string}
- {"action":"select","selector":S,"value":string}   (value is the option's value attribute)
- {"action":"check","selector":S,"checked":boolean}
- {"action":"assert","selector":S, plus at least one of "visible":boolean, "text":string, "count":integer}
Only click, fill, select, check and assert exist, with exactly the fields shown (no other field, not even on click). To pick an element by its text put the text in the selector: [role="tab"]:has-text("Campus"), button:has-text("Explore").
S is a Playwright selector copied from the code you are given: an id (#hero-question), role/aria attributes ([role="tab"][id="tab-Campus"], [role="dialog"]), or text (button:has-text("Explore")). Use only selectors that exist in the code.

Rules:
1. One test per behaviour the owner asked for. Follow the real user journey step by step: open the page, operate the control the owner named, enter what a visitor would enter, submit, then assert the visible RESULT (a dialog is visible, the right tab is selected, a list shows the matching item, a section is gone, a colour was applied).
LITERAL: the test must do exactly what the owner described and nothing more. If the owner said "when the Campus button is clicked a popup opens", the steps are: open the page, click that button, assert the popup is visible. Never add a step the owner did not describe (another click, a typed value, a submit) to make the result appear, and never test a different trigger than the one the owner named. If the owner described several stages (click, then type, then submit), test each stage in order and assert what the owner said happens after each.
2. Assert the result the owner asked for, not just that something rendered. If the owner said nothing should happen until a question is typed, include a test that the result does NOT appear before that (assert visible:false or count:0) and does appear afterwards.
3. Also test the EMPTY case: operate the submit control (Explore, Send, Search, Submit) with nothing typed or chosen and assert that the page shows visible feedback (a message, a validation text, a popup) and does not stay silent. A control that does nothing when pressed is a bug.
4. The browser has no internet and no AI service. For an AI answer, assert that the popup opens and shows a loading line or an answer or an error line (use a selector for the dialog), not what the answer says.
5. "path" is the route of the page under test.
6. At most ${MAX_TESTS} tests, at most 12 steps each, every test ends with an assertion. Do not invent controls that are not in the code.
7. A request about a colour, size, font or spacing is tested with a computed-style assertion that uses the exact value asked for: {"action":"assert","selector":S,"style":{"property":"background-color","value":"rgb(0, 0, 0)"}} (black is rgb(0, 0, 0), white rgb(255, 255, 255), red rgb(255, 0, 0); sizes are in px, e.g. "24px"). S must match exactly one element (use the section's id, e.g. #curriculum). A test that only asserts visibility can never verify a colour or size request and is not acceptable.
8b. A selector must match exactly ONE element, or the browser refuses it. Cards, rows and buttons repeat: when several elements can match (the same fee on two cards, a label that appears in every card, a link in the menu and in the footer), take the first with " >> nth=0", for example text="Total Fees" >> nth=0 or button:has-text("Apply") >> nth=0, or assert how many there are with count. Prefer a selector for the section or heading you know is unique.
9. When REQUIRED CONTENT is listed, the owner gave those exact texts: write one test that opens the page and asserts that each of them is on it, one assert per text with "text" set to that text (use a selector for the section or "body", never one that matches several elements). Use the texts exactly as listed.
8. Always write at least one test. A visual change is tested too: assert that the changed element is visible, has the text, or has the style the owner asked for. Never return an empty list.`;

const OPERATES = /\b(click|clicks|clicked|press|open|opens|popup|pop-up|modal|dialog|button|form|submit|search|tab|tabs|link|navigate|ask|type|typing|enter|select|dropdown|menu|filter|toggle|show|hide|play|login|log in|sign|upload|chat|answer|question)\b/i;
const LOOK = /\b(colou?r|font|bigger|larger|smaller|size|bold|italic|spacing|padding|margin|rename|reword|wording|rephrase|heading|title|text|background|gradient|rounded|shadow|align|logo|image|photo|picture)\b/i;
/** A change to how something looks or reads (no behaviour named): a browser has nothing to operate, so no test is written. */
const ownWords = (instruction) => require('./templateValidationService').ownerWords(instruction);
const isStyleOnly = (instruction) => { const own = ownWords(instruction); return LOOK.test(own) && !OPERATES.test(own); };

/**
 * The exact texts the owner wants on the page: what they quoted ("call it "Explore Programmes"") and the lines of copy they pasted
 * (a heading, a paragraph, "Primary button: Explore Programmes"). At most 8, each as it must appear.
 */
function requiredTexts(instruction) {
  const own = ownWords(instruction).replace(/^In (?:(?:and |, )?section \d+ \("[^"]*"\)(?:,? ?(?:and )?)?)+:\s*/i, '');
  const found = [];
  for (const match of own.matchAll(/["“]([^"”\n]{3,120})["”]/g)) found.push(match[1].trim());
  const lines = own.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  // Pasted copy: several lines. A label before a colon ("Primary button: Explore") is not part of the text.
  if (lines.length >= 3) for (const line of lines.slice(1)) {
    const text = line.replace(/^[A-Za-z ]{3,30}:\s+(?=\S)/, '').split('\t')[0].trim();
    if (text.length >= 3 && text.length <= 140 && text.split(/\s+/).length <= 20) found.push(text);
  }
  return [...new Set(found)].slice(0, 8);
}

function parseJson(text) {
  const raw = String(text || '').trim();
  const body = raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/) || [''])[0];
  try { return JSON.parse(body); } catch { return null; }
}

function defaultAsk() {
  const openrouter = require('../ai/openrouterService');
  const model = process.env.TEMPLATE_TEST_MODEL || process.env.TEMPLATE_EDIT_MODEL || process.env.TEMPLATE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const result = await openrouter.generateCompletion(messages, { model, temperature: 0, max_tokens: 2500, response_format: false, reasoning: { effort: 'low', exclude: true }, timeout: 60000, signal });
    return { content: String(result?.content || ''), usage: result?.usage || null };
  };
}

/**
 * @returns {{ tests: Array, status: 'planned'|'unavailable', reason?: string, usage?: object }}
 *   unavailable: tests could not be written (the change stays unverified and is reported as such).
 */
async function planBehaviorTests({ instruction, page, files, changedPaths, deps = {}, signal, route = null }) {
  const ask = deps.askBehaviorModel || (process.env.OPENROUTER_API_KEY ? defaultAsk() : null);
  // Writing tests is a small job: it may run on a faster model (TEMPLATE_TEST_MODEL) than the page writer.
  const inScope = (fn) => (process.env.TEMPLATE_TEST_MODEL ? require('../../utils/modelScope').run(process.env.TEMPLATE_TEST_MODEL, fn) : fn());
  if (!ask) return { tests: [], status: 'unavailable', reason: 'No AI service is configured to write the behaviour tests.' };
  const shown = [];
  let size = 0;
  const wanted = [page.componentPath, ...changedPaths.filter((path) => path !== page.componentPath)];
  for (const path of [...new Set(wanted)]) {
    const file = files.find((item) => item.path === path);
    if (!file || typeof file.content !== 'string' || file.encoding === 'base64') continue;
    const chunk = `--- ${path}\n${file.content}`.slice(0, Math.max(0, MAX_SOURCE - size));
    if (!chunk) break;
    shown.push(chunk);
    size += chunk.length;
  }
  const required = requiredTexts(instruction);
  const messages = [
    { role: 'system', content: SYSTEM },
    // The owner's own words (not the page outline the studio adds), the exact texts they asked for, and the route the page really opens at.
    { role: 'user', content: `PAGE: ${page.name} (route ${route || page.route})\n\nOWNER INSTRUCTION:\n${String(ownWords(instruction)).slice(0, 3000)}\n\n${required.length ? `REQUIRED CONTENT (must be visible on the page after the change):\n${required.map((text) => `- ${JSON.stringify(text)}`).join('\n')}\n\n` : ''}CODE AFTER THE CHANGE:\n${shown.join('\n\n')}` }
  ];
  try {
    const answer = await inScope(() => ask(messages, { signal }));
    const parsed = parseJson(answer.content);
    if (!parsed || !Array.isArray(parsed.tests)) return { tests: [], status: 'unavailable', reason: 'The test writer returned an unusable answer.', usage: answer.usage };
    if (!parsed.tests.length) return { tests: [], status: 'unavailable', reason: 'No browser test could be written for this instruction.', usage: answer.usage };
    const { validatePlan } = require('../../../runner/browserValidation.cjs');
    const tests = [];
    const names = new Set();
    for (const raw of parsed.tests.slice(0, MAX_TESTS)) {
      const test = { name: `Behaviour: ${String(raw?.name || 'requested change').slice(0, 80)}`, path: route || String(raw?.path || page.route || '/'), viewports: ['desktop'], steps: Array.isArray(raw?.steps) ? raw.steps.slice(0, 12) : [] };
      if (names.has(test.name)) test.name = `${test.name} (${names.size + 1})`;
      try { validatePlan({ version: 1, tests: [test] }); } catch (error) { logger.warn(`Behaviour test "${test.name}" was dropped: ${error.message}`); continue; }
      names.add(test.name);
      tests.push(test);
    }
    if (!tests.length) return { tests: [], status: 'unavailable', reason: 'None of the written tests were valid.', usage: answer.usage };
    return { tests, status: 'planned', usage: answer.usage };
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`Behaviour tests could not be written: ${error.message}`);
    return { tests: [], status: 'unavailable', reason: 'The test writer was unavailable.' };
  }
}

module.exports = { planBehaviorTests, isStyleOnly, requiredTexts, SYSTEM };
