/**
 * "Search online for the programmes this college offers, with their fees": an instruction that needs facts only the web has.
 * Without this the AI could only write "set by the college each year" (it must never invent a figure), and a reviewer rightly
 * refused that as not what was asked.
 *
 * One model call with the provider's web search switched on (OpenRouter's web plugin: the same key, nothing to scrape, and it works from
 * a server that search engines block). The answer is structured facts with the address each one came from. The facts go into the prompt
 * as material to use; a missing figure stays missing (the page says to ask the admissions office), it is never guessed.
 * Research never fails a job: when it cannot run the AI is told so and writes only what it can stand behind.
 */
const crypto = require('node:crypto');
const logger = require('../../utils/logger');

const enabled = (deps = {}) => (deps.webResearch !== undefined ? Boolean(deps.webResearch) : String(process.env.WEB_RESEARCH || 'on').toLowerCase() !== 'off');

const SYSTEM = `You research facts on the web for the owner of a website, then report them.

Search the web for what the owner's request needs (for example the programmes a college offers, with their duration and fees). Report ONLY what the pages you found state.
Answer JSON only:
{"topic":"what was researched","items":[{"name":"the thing (a programme, a service, a product ...)","facts":{"duration":"as stated","fee":"as stated, with the currency and the period (per year, total)","level":"...","anything else the request asks for":"..."},"source":"the address of the page that states it"}],"notes":"one short sentence: what could not be found"}

Rules:
- A fact is a value the page states. If a page does not state a figure, leave that key out. Never estimate, round or invent a figure, a year, a name or a rule.
- Prefer the organisation's own website, then official or well known reference pages. Skip social media and videos.
- Keep each value short and exactly as the page states it (keep the currency symbol and the unit).
- At most 40 items, the most relevant first. If nothing reliable was found, return {"topic":"...","items":[],"notes":"why"}.`;

const ownerPart = (instruction) => String(instruction || '').split(/\n\n(?:SECTION(?: \d+)? CONTENT|PAGE CONTEXT|\(The owner|\(A previous try|This applies to the text)/)[0].replace(/^In section \d+ \("[^"]*"\)(?:(?:, | and )section \d+ \("[^"]*"\))*: /, '').trim();

function parseJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { return null; }
}

function defaultAsk() {
  const openrouter = require('../ai/openrouterService');
  const model = process.env.WEB_RESEARCH_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const result = await openrouter.generateCompletion(messages, {
      ...(model ? { model } : {}), temperature: 0, max_tokens: 4000, response_format: false, reasoning: { effort: 'minimal', exclude: true },
      plugins: [{ id: 'web', max_results: Number.parseInt(process.env.WEB_RESEARCH_RESULTS, 10) || 6 }],
      timeout: Number.parseInt(process.env.WEB_RESEARCH_TIMEOUT_MS, 10) || 120000, signal
    });
    return { content: String(result?.content || ''), annotations: result?.annotations || [], usage: result?.usage || null };
  };
}

const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const cleanUrl = (url) => String(url || '').replace(/[?&]utm_[a-z]+=[^&#]*/gi, '').replace(/[?&]$/, '');
const text = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Turns the model's answer and the pages it used into { items, sources } (anything that is not a plain string/number fact is dropped). */
function normalise(parsed, annotations = []) {
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 40).map((item) => {
    const facts = {};
    for (const [key, value] of Object.entries(item?.facts && typeof item.facts === 'object' ? item.facts : {}).slice(0, 12)) {
      if (['string', 'number'].includes(typeof value) && text(value)) facts[text(key, 40)] = text(value, 160);
    }
    return { name: text(item?.name, 140), facts, source: cleanUrl(text(item?.source, 300)).replace(/^.*?\((https?:\/\/[^)\s]+)\).*$/, '$1') };
  }).filter((item) => item.name);
  const cited = (annotations || []).map((entry) => entry?.url_citation).filter((entry) => entry?.url).map((entry) => ({ url: cleanUrl(entry.url), title: text(entry.title, 120) }));
  const fromItems = items.map((item) => item.source).filter((url) => /^https?:\/\//.test(url)).map((url) => ({ url, title: '' }));
  const seen = new Set();
  const sources = [...cited, ...fromItems].filter((entry) => !seen.has(entry.url) && seen.add(entry.url)).slice(0, 8);
  return { items, sources };
}

function blockFor({ items, sources, notes }, instruction) {
  if (!items.length) return unavailableBlock(notes || 'the search found nothing reliable');
  const lines = items.map((item) => `- ${item.name}${Object.keys(item.facts).length ? ` | ${Object.entries(item.facts).map(([key, value]) => `${key}: ${value}`).join(' | ')}` : ''}${item.source ? ` | source: ${item.source}` : ''}`).join('\n').slice(0, 7000);
  return `WEB RESEARCH (the owner asked to search the web; this was found online just now, with the page each fact came from):\n${lines}\n${notes ? `Not found: ${text(notes, 240)}\n` : ''}USE THESE FACTS for what the owner asked (${text(ownerPart(instruction), 160)}): one entry or card per item that fits, with the facts shown exactly as written here (keep the currency and the unit). Add nothing that is not listed here: where a fact is missing for an item, write "Contact admissions for the current figure" instead of a number. Say where the figures come from in one short line on the page (the site names: ${sources.map((entry) => hostOf(entry.url)).filter(Boolean).slice(0, 3).join(', ') || 'the sources above'}) and that they should be confirmed with the organisation.`;
}

const unavailableBlock = (reason) => `WEB RESEARCH: the owner asked to search the web, but ${text(reason, 200)}. Write the page from what is certainly known and never invent a fee, a date, a duration or any other figure: where a figure is needed write "Contact admissions for the current figure". Do not claim that anything was found online.`;

/**
 * @returns {Promise<{ found: boolean, items: object[], sources: object[], block: string, usage: object|null, error?: string }>}
 */
async function research({ instruction, siteName = '', pageName = '', signal, deps = {} } = {}) {
  const request = ownerPart(instruction);
  const key = crypto.createHash('sha1').update(`${siteName}|${request}`).digest('hex');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && !deps.noCache) return { ...hit.value, usage: null, cached: true };
  const ask = deps.askWebResearch || (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key' ? defaultAsk() : null);
  if (!ask) return { found: false, items: [], sources: [], block: unavailableBlock('no search is available right now'), usage: null, error: 'No model is configured.' };
  try {
    const answer = await ask([{ role: 'system', content: SYSTEM }, { role: 'user', content: `WEBSITE: ${siteName || '(not named)'}\nPAGE: ${pageName || '(not named)'}\n\nOWNER REQUEST:\n${request.slice(0, 1500)}` }], { signal });
    const parsed = parseJson(answer.content);
    if (!parsed) throw new Error('The research answer could not be read.');
    const { items, sources } = normalise(parsed, answer.annotations);
    const value = { found: items.length > 0, items, sources, block: blockFor({ items, sources, notes: parsed.notes }, instruction), usage: answer.usage || null };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`Web research was skipped: ${error.message}`);
    return { found: false, items: [], sources: [], block: unavailableBlock('the search could not be completed'), usage: null, error: error.message };
  }
}

/** A short, storable account of what research did (for the job record). */
const summarize = (result) => result && ({ found: result.found, items: result.items.length, sources: result.sources.map((entry) => entry.url), error: result.error || null, cached: Boolean(result.cached) });

module.exports = { enabled, research, summarize, normalise, blockFor, unavailableBlock, ownerPart, SYSTEM };
