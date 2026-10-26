// Compares target selection quality, prompt size and latency: keyword heuristics vs LSP vs hybrid search (without and with
// semantic embeddings), on labelled tasks over test/fixtures/searchProject.js. Prompt size is the characters of the real
// prompt that would be sent (tokens ~ chars/4); real provider tokens are NOT measured here.
process.env.INCREMENTAL_CODE_SEARCH = '1';
process.env.INCREMENTAL_LSP = '1';
const editor = require('../src/services/ai/incrementalEditor');
const { CodeSearchManager } = require('../src/services/search/projectIndex');
const embedder = require('../src/services/search/embedder');
const lsp = require('../src/services/lsp/lspManager');
const files = require('../test/fixtures/searchProject')();

const tasks = [
  ['Change the button that publishes the website', ['src/components/DeployButton.jsx']],
  ['Make the homepage hero section taller', ['src/components/HeroSection.jsx', 'src/styles/hero.css']],
  ['Find where the application handles Google login', ['src/pages/LoginPage.jsx', 'src/services/auth.js']],
  ['Change the spacing between the cards on the dashboard', ['src/pages/dashboard.css', 'src/pages/Dashboard.jsx']],
  ['Update the API request used to load research papers', ['src/services/papers.js']],
  ['make the Continue with Google button rounded', ['src/pages/LoginPage.jsx']],
  ['make the HeroSection title bold', ['src/components/HeroSection.jsx']],
  ['change the .deploy-cta background', ['src/index.css']],
  ['rename the Visitors label to Users', ['src/pages/Dashboard.jsx']],
  ['make the Get started button blue on the homepage', ['src/pages/Home.jsx']],
  ['make the Plans and pricing heading larger', ['src/pages/Pricing.jsx']],
  ['change the stat card value font', ['src/components/StatCard.jsx']]
];

const size = (targets, ctx) => editor.buildIncrementalPrompt({ prompt: 'x', targetFiles: targets, projectFiles: files, lspContext: ctx }).messages.reduce((n, m) => n + m.content.length, 0);

async function evaluate(name, select) {
  const rows = [];
  await select(tasks[0][0], 'warm'); // warm-up (index/embeddings/servers) is reported separately
  for (const [prompt, expected] of tasks) {
    const t = process.hrtime.bigint();
    const r = await select(prompt, 'run');
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    const targets = r.targets.map((f) => f.path);
    rows.push({ top1: expected.includes(targets[0]), any: targets.some((p) => expected.includes(p)), editable: targets.length, chars: size(r.targets, r.source && r.source !== 'heuristic' ? r : null), ms, source: r.source || 'heuristic', unresolved: Boolean(r.unresolved) });
  }
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  return { approach: name, 'top1 correct': `${rows.filter((r) => r.top1).length}/${rows.length}`, 'any correct': `${rows.filter((r) => r.any).length}/${rows.length}`, 'avg editable files': avg('editable').toFixed(1), 'avg prompt chars': Math.round(avg('chars')), 'avg ms': avg('ms').toFixed(0), 'used search': rows.filter((r) => r.source !== 'heuristic').length, clarifications: rows.filter((r) => r.unresolved).length };
}

(async () => {
  console.log(`project: ${files.length} files, ${files.reduce((n, f) => n + f.content.length, 0)} chars, ${tasks.length} labelled tasks`);
  const out = [];
  out.push(await evaluate('keyword heuristics (existing)', async (p) => ({ targets: editor.selectTargetFiles(p, files, null), source: 'heuristic' })));

  const lspKey = 'm-lsp';
  out.push(await evaluate('LSP-assisted', (p) => editor.selectTargetFilesLsp({ prompt: p, files, projectKey: lspKey })));

  const mgrLex = new CodeSearchManager();
  const off = new embedder.Embedder({ model: 'off' });
  process.env.CODE_SEARCH_EMBEDDINGS = 'off';
  out.push(await evaluate('hybrid: exact+lexical+structural (no embeddings)', (p) => editor.selectTargetFilesHybrid({ prompt: p, files, projectKey: 'm-lex', manager: mgrLex, embedder: off })));
  delete process.env.CODE_SEARCH_EMBEDDINGS;

  const t0 = Date.now();
  const ready = await embedder.warm();
  const loadMs = Date.now() - t0;
  const mgrFull = new CodeSearchManager();
  const t1 = Date.now();
  const synced = mgrFull.sync('m-full', files, { resolveImportPath: editor.resolveImportPath });
  const indexMs = Date.now() - t1;
  const t2 = Date.now();
  const emb = ready ? await synced.index.ensureEmbeddings(embedder, { budgetMs: 120000 }) : { enabled: false };
  const embedMs = Date.now() - t2;
  out.push(await evaluate(`hybrid: all four methods (${ready ? 'local model' : 'model unavailable'})`, (p) => editor.selectTargetFilesHybrid({ prompt: p, files, projectKey: 'm-full', manager: mgrFull, embedder })));
  console.table(out);
  console.log(`index build: ${indexMs} ms for ${synced.index.derived().size} units; model load: ${loadMs} ms; embedding ${emb.embedded} units: ${embedMs} ms (one-off per project; later edits re-embed only changed units)`);
  await lsp.disposeAll();
  process.exit(0);
})();
