'use strict';

const aiProtocol = require('../ai/aiProtocol');
const generationPipeline = require('../ai/generationPipeline');
const { autoFix } = require('../ai/autoFix');
const prompts = require('./prompts');

// Stages 8, 9 and 11: model calls for the shared components, one page, or one repair. Each call gets its own bounded
// set of paths it may write; anything else the model returns is discarded, so a page task cannot damage the rest.

const isUnderPrefix = (filePath, prefixes) => prefixes.some((prefix) => filePath === prefix || (prefix.endsWith('*') && filePath.startsWith(prefix.slice(0, -1))));

/** Keeps only the operations whose path is allowed. Returns { operations, rejected }. */
function restrictOperations(parsed, allowed) {
  const rejected = [];
  const files = (parsed.files || []).filter((op) => {
    const p = String(op.path || '').replace(/^\/+/, '');
    if (isUnderPrefix(p, allowed)) return true;
    rejected.push(p);
    return false;
  });
  return { parsed: { ...parsed, files }, rejected };
}

function parseCompletion(completion) {
  return aiProtocol.parseAIResponse(completion, null);
}

/** Static checks of just the files this task touched; returns blocking problems (syntax, imports that do not resolve). */
function staticProblems(files, touchedPaths) {
  const touched = new Set(touchedPaths);
  let diagnostics = [];
  try { diagnostics = generationPipeline.validateGeneratedFiles(files); } catch { diagnostics = []; }
  return diagnostics.filter((d) => (!d.path || touched.has(d.path)) && ['syntax', 'import', 'export'].includes(d.category));
}

/**
 * Runs one model request that must return file operations and applies them to `files`.
 * @param {object} args
 * @param {Function} args.generate async (messages, options) -> completion { content, tool_calls, usage }
 * @param {Array} args.messages
 * @param {Array} args.files current project files
 * @param {string[]} args.allowed path prefixes the task may write ('src/pages/About.jsx', 'src/components/About*')
 * @param {string[]} args.required paths that must be produced
 */
async function runFileTask({ generate, messages, files, allowed, required = [], usageSink, attempts = 2, maxTokens = 16000 }) {
  let lastError = null;
  let working = messages;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let completion;
    try {
      completion = await generate(working, { max_tokens: maxTokens, tools: [aiProtocol.FILE_OPERATIONS_TOOL], tool_choice: { type: 'function', function: { name: aiProtocol.FILE_OPERATIONS_TOOL.function.name } }, structured: true });
    } catch (error) {
      lastError = error; if (error?.name === 'AbortError') throw error; continue;
    }
    if (usageSink) usageSink(completion);
    try {
      const parsed = parseCompletion(completion);
      const { parsed: allowedOps, rejected } = restrictOperations(parsed, allowed);
      if (!allowedOps.files.length) throw new Error(`The response changed no allowed file${rejected.length ? ` (it tried: ${rejected.slice(0, 4).join(', ')})` : ''}.`);
      const validated = aiProtocol.validateFileOperations(allowedOps, files);
      const applied = aiProtocol.applyOperationsSafely(files, validated.files);
      let next = applied.files;
      try { next = autoFix(next, { stubMissing: false }).files; } catch { /* keep the applied files */ }
      const missing = required.filter((p) => !next.some((f) => f.path === p && String(f.content || '').trim().length > 40));
      if (missing.length) throw new Error(`The response did not create ${missing.join(', ')}.`);
      const touched = allowedOps.files.map((op) => String(op.path).replace(/^\/+/, ''));
      const problems = staticProblems(next, touched);
      if (problems.length) {
        const error = new Error(`The generated code has errors: ${generationPipeline.formatDiagnostics(problems).slice(0, 700)}`);
        error.problems = problems; error.candidate = next; error.touched = touched;
        throw error;
      }
      return { files: next, touched, rejected, usage: completion.usage || null, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        working = [...messages, { role: 'assistant', content: String(completion?.content || '(no text)').slice(0, 1500) }, { role: 'user', content: `That response could not be used: ${String(error.message).slice(0, 900)}\nReturn the corrected file operations again (complete files only).` }];
      }
    }
  }
  const failure = new Error(lastError?.message || 'The model returned no usable files.');
  failure.cause = lastError; failure.candidate = lastError?.candidate || null; failure.touched = lastError?.touched || null;
  throw failure;
}

function toMessages(prompt, image) {
  const user = image ? [{ type: 'text', text: prompt.user }, { type: 'image_url', image_url: { url: image } }] : prompt.user;
  return [{ role: 'system', content: prompt.system }, { role: 'user', content: user }];
}

async function generateShared({ generate, files, request, siteName, ds, inventory, assetsForShared, usageSink, attempts }) {
  const header = inventory.shared.find((s) => s.kind === 'header'); const footer = inventory.shared.find((s) => s.kind === 'footer');
  const blocks = inventory.shared.filter((s) => s.kind === 'block');
  const prompt = prompts.sharedPrompt({ request, siteName, ds, inventory: { ...inventory, assets: assetsForShared }, header, footer, files });
  const allowed = ['src/components/Navbar.jsx', 'src/components/Footer.jsx', ...blocks.map((b) => b.file)];
  return runFileTask({ generate, messages: toMessages(prompt), files, allowed, required: ['src/components/Navbar.jsx', 'src/components/Footer.jsx'], usageSink, attempts });
}

async function generatePage({ generate, files, request, siteName, ds, page, slots, mapping, inventory, image, usageSink, attempts }) {
  const prompt = prompts.pagePrompt({ request, siteName, ds, page, slots, mapping, inventory, existingPaths: files.map((f) => f.path), referenceImage: Boolean(image) });
  const allowed = [page.file, `src/components/${page.componentName}*`];
  return runFileTask({ generate, messages: toMessages(prompt, image), files, allowed, required: [page.file], usageSink, attempts });
}

async function repairPage({ generate, files, request, page, result, instructions, slots, mapping, usageSink, attempts = 1 }) {
  const current = files.find((f) => f.path === page.file);
  const prompt = prompts.repairPrompt({ request, page, result, instructions, code: current?.content || '', slots, mapping });
  const allowed = [page.file, `src/components/${page.componentName}*`];
  return runFileTask({ generate, messages: toMessages(prompt), files, allowed, required: [page.file], usageSink, attempts });
}

module.exports = { runFileTask, generateShared, generatePage, repairPage, restrictOperations, staticProblems, toMessages };
