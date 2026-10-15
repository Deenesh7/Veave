/**
 * PLANNER AGENT
 *
 * Agent #1 of the two-agent pipeline. It only THINKS: it reads the user's
 * request (plus optional scraped website data and the current project files)
 * and produces a structured build plan. It never writes code. The Builder
 * agent (builderAgent.js) is a separate agent with its own prompt and model
 * that executes the plan.
 */
const openRouterService = require('../ai/openrouterService');
const { AIError } = require('../../utils/errors');

const MAX_TASKS = 8;
const MAX_PAGES_IN_BRIEF = 25;

const PLANNER_SYSTEM_PROMPT = `You are the PLANNER agent of a two-agent web building system.
Your only job is to produce a precise build plan. A different agent, the BUILDER, will write the code.

STRICT RULES:
- Never output source code, file contents, or diffs. Output a plan only.
- Break the work into ordered, self-contained tasks. Each task must be small enough for one builder pass (a handful of files).
- Order tasks so later tasks can depend on earlier ones (foundation/styles/layout first, then pages, then polish).
- Each task lists the exact file paths the builder should create or modify.
- Target stack: React (JSX, no TypeScript) with Tailwind CSS. Entry is src/App.jsx, styles in src/index.css, components in src/components/.
- If scraped website data is provided, reproduce its structure, copy, routes and visual identity faithfully. Reference the real page paths, headings, colors and fonts that you were given.
- Never invent URLs, assets or copy that contradict the scraped data.

Respond with ONLY a JSON object of this exact shape:
{
  "summary": "one or two sentences describing what will be built",
  "designDirection": { "palette": ["#hex"], "fonts": ["name"], "style": "short description" },
  "pages": [{ "path": "/", "title": "Home", "sections": ["Hero", "Features"] }],
  "tasks": [
    { "id": "t1", "title": "short title", "description": "what the builder must do and why", "files": ["src/App.jsx"], "acceptance": ["observable check"] }
  ]
}`;

/** Reduce a captureWebsite() result to a compact brief the planner can read. */
function summarizeScrape(capture) {
  if (!capture) return null;
  const pages = (capture.pages || []).slice(0, MAX_PAGES_IN_BRIEF).map((page) => ({
    path: page.path || page.url,
    title: page.title || '',
    headings: (page.headings || []).slice(0, 12).map((h) => (typeof h === 'string' ? h : h.text)).filter(Boolean),
    status: page.captureStatus
  }));
  return {
    source: capture.sourceUrl || capture.url || null,
    siteMap: capture.siteMap || null,
    pages,
    colors: capture.tokens?.colors || capture.styles?.colors || undefined,
    fonts: capture.tokens?.fonts || capture.styles?.fonts || undefined,
    assetCount: (capture.assets || []).length,
    coverage: capture.coverage
      ? { captured: capture.coverage.capturedPages, discovered: capture.coverage.discoveredInternalPages }
      : undefined
  };
}

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* try slice */ }
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}

/** Validate and normalise the planner output. Throws AIError on unusable plans. */
function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new AIError('Planner returned an invalid plan');
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
    .filter((t) => t && typeof t === 'object' && (t.title || t.description))
    .slice(0, MAX_TASKS)
    .map((t, i) => ({
      id: String(t.id || `t${i + 1}`),
      title: String(t.title || `Task ${i + 1}`),
      description: String(t.description || t.title || ''),
      files: (Array.isArray(t.files) ? t.files : []).filter((f) => typeof f === 'string' && f.trim()),
      acceptance: (Array.isArray(t.acceptance) ? t.acceptance : []).map(String)
    }));
  if (!tasks.length) throw new AIError('Planner produced no tasks');
  return {
    summary: String(raw.summary || ''),
    designDirection: raw.designDirection && typeof raw.designDirection === 'object' ? raw.designDirection : {},
    pages: Array.isArray(raw.pages) ? raw.pages : [],
    tasks
  };
}

function resolvePlannerModel(override) {
  return override || process.env.PLANNER_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
}

async function createPlan({ request, scrape = null, files = [], model, complete } = {}) {
  if (!request || !String(request).trim()) throw new AIError('A request is required to create a plan');
  const call = complete || ((messages, opts) => openRouterService.generateCompletion(messages, opts));
  const brief = summarizeScrape(scrape);

  const parts = [`USER REQUEST:\n${request}`];
  if (brief) parts.push(`SCRAPED WEBSITE DATA (collected by the backend):\n${JSON.stringify(brief, null, 2)}`);
  if (files.length) parts.push(`EXISTING PROJECT FILES (paths only):\n${files.map((f) => f.path).join('\n')}`);

  const resolvedModel = resolvePlannerModel(model);
  const { content, usage } = await call(
    [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') }
    ],
    { model: resolvedModel, temperature: 0.3, max_tokens: 4000 }
  );

  const plan = normalizePlan(extractJson(content));
  return { plan, usage, model: resolvedModel };
}

module.exports = { createPlan, summarizeScrape, normalizePlan, extractJson, resolvePlannerModel, PLANNER_SYSTEM_PROMPT };
