/**
 * BUILDER AGENT
 *
 * Agent #2 of the two-agent pipeline. It never plans: it receives a task from
 * the Planner's plan and turns it into file actions (create/modify/patch/delete).
 * It is called once per task; each call sees the files produced by the previous
 * builder passes, so the work continues from where the last pass stopped.
 */
const openRouterService = require('../ai/openrouterService');
const { SYSTEM_PROMPT } = require('../ai/prompts/systemPrompt');
const { validateActions } = require('../ai/actionValidator');
const { AIError } = require('../../utils/errors');
const { extractJson } = require('./plannerAgent');

const MAX_CONTEXT_CHARS = 120000;
const ALWAYS_INCLUDE = ['src/App.jsx', 'src/index.css', 'package.json'];

const BUILDER_SYSTEM_PROMPT = `You are the BUILDER agent of a two-agent web building system.
A separate PLANNER agent already decided what to build. You implement exactly ONE task of its plan.

STRICT RULES:
- Do not re-plan, do not change the scope, do not work on other tasks.
- Write complete, working React (JSX only, no TypeScript) + Tailwind code. No placeholders, no TODOs, no "rest of file".
- Follow the design direction from the plan. Keep components consistent with files from earlier tasks.
- Use window.__modules for inter-component imports exactly as the existing project does.
- Prefer patch_file with a unique search string for small edits to existing files; use create_file/modify_file with FULL file content otherwise.
- Only touch files needed by this task.

Respond with ONLY a JSON object:
{
  "message": "short summary of what you built",
  "actions": [
    { "type": "create_file|modify_file|patch_file|delete_file", "path": "src/...", "content": "full file content", "search": "(patch only)", "replace": "(patch only)", "reason": "why" }
  ]
}`;

function resolveBuilderModel(override) {
  return override || process.env.BUILDER_MODEL || process.env.CLAUDE_GENERATION_MODEL || 'anthropic/claude-sonnet-5.5';
}

function buildFileContext(files, task) {
  const wanted = new Set([...(task.files || []), ...ALWAYS_INCLUDE]);
  let used = 0;
  const blocks = [];
  for (const file of files) {
    if (!wanted.has(file.path) || typeof file.content !== 'string') continue;
    if (used + file.content.length > MAX_CONTEXT_CHARS) break;
    used += file.content.length;
    blocks.push(`--- ${file.path} ---\n${file.content}`);
  }
  return {
    tree: files.map((f) => f.path).join('\n') || '(empty project)',
    contents: blocks.join('\n\n') || '(no relevant file contents yet)'
  };
}

async function buildTask({ request, plan, task, files = [], completed = [], model, complete } = {}) {
  if (!plan || !task) throw new AIError('Builder requires a plan and a task');
  const call = complete || ((messages, opts) => openRouterService.generateCompletion(messages, opts));
  const ctx = buildFileContext(files, task);

  const user = [
    `ORIGINAL USER REQUEST:\n${request || ''}`,
    `PLAN SUMMARY: ${plan.summary}`,
    `DESIGN DIRECTION:\n${JSON.stringify(plan.designDirection || {}, null, 2)}`,
    `PAGES:\n${JSON.stringify(plan.pages || [], null, 2)}`,
    completed.length
      ? `ALREADY BUILT BY PREVIOUS BUILDER PASSES:\n${completed.map((c) => `- [${c.id}] ${c.title}: ${c.message}`).join('\n')}`
      : 'This is the first task. Nothing has been built yet.',
    `YOUR TASK [${task.id}] ${task.title}:\n${task.description}`,
    `FILES TO CREATE/MODIFY: ${(task.files || []).join(', ') || '(your choice, keep minimal)'}`,
    task.acceptance?.length ? `ACCEPTANCE CHECKS:\n${task.acceptance.map((a) => `- ${a}`).join('\n')}` : '',
    `CURRENT PROJECT FILE LIST:\n${ctx.tree}`,
    `CURRENT RELEVANT FILE CONTENTS:\n${ctx.contents}`
  ].filter(Boolean).join('\n\n');

  const resolvedModel = resolveBuilderModel(model);
  const { content, usage } = await call(
    [
      { role: 'system', content: BUILDER_SYSTEM_PROMPT },
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user }
    ],
    { model: resolvedModel, temperature: 0.4, max_tokens: 16000 }
  );

  const parsed = extractJson(content);
  if (!parsed) throw new AIError(`Builder returned invalid JSON for task ${task.id}`);
  const validation = validateActions(parsed.actions || []);
  if (!validation.valid || !validation.actions.length) {
    throw new AIError(`Builder produced invalid actions for task ${task.id}: ${(validation.errors || ['no actions']).join(', ')}`);
  }
  return { message: String(parsed.message || task.title), actions: validation.actions, usage, model: resolvedModel };
}

module.exports = { buildTask, buildFileContext, resolveBuilderModel, BUILDER_SYSTEM_PROMPT };
