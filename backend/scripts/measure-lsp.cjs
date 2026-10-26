// Measures prompt size and target-selection latency: existing heuristics vs LSP-assisted selection.
// Real model tokens are NOT measured here (that needs live provider calls); sizes are characters of the actual prompt
// that would be sent, with tokens approximated as chars/4.
process.env.INCREMENTAL_LSP = '1';
const incrementalEditor = require('../src/services/ai/incrementalEditor');
const lsp = require('../src/services/lsp/lspManager');

function buildProject(pageCount = 12) {
  const filler = (n) => Array.from({ length: n }, (_, i) => `      <p className="row-${i}">Paragraph ${i} with some realistic marketing copy about the product and why it matters.</p>`).join('\n');
  const files = [
    { path: 'src/components/Button.jsx', content: 'export default function Button({ children }) {\n  return <button className="btn">{children}</button>;\n}\n' },
    { path: 'src/index.css', content: '.btn { color: red; padding: 8px; }\n' }
  ];
  const imports = [];
  const uses = [];
  for (let i = 0; i < pageCount; i += 1) {
    const name = i === 0 ? 'Home' : `Page${i}`;
    imports.push(`import ${name} from './pages/${name}';`);
    uses.push(`<${name} />`);
    files.push({ path: `src/pages/${name}.jsx`, content: `import Button from '../components/Button';\nexport default function ${name}() {\n  return (\n    <main>\n      <h1>${name}</h1>\n${filler(60)}\n      <Button>${i === 0 ? 'Publish' : `Action ${i}`}</Button>\n    </main>\n  );\n}\n` });
  }
  files.push({ path: 'src/App.jsx', content: `${imports.join('\n')}\nexport default function App() {\n  return <div>${uses.join('')}</div>;\n}\n` });
  return files;
}

const prompts = [
  'Change the Publish button color to blue on the homepage.',
  'make the Page7 heading bold',
  'make the Button text uppercase'
];

(async () => {
  const files = buildProject();
  const total = files.reduce((n, f) => n + f.content.length, 0);
  console.log(`project: ${files.length} files, ${total} chars`);
  const rows = [];
  for (const prompt of prompts) {
    let t = process.hrtime.bigint();
    const heuristic = incrementalEditor.selectTargetFiles(prompt, files, null);
    const heuristicMs = Number(process.hrtime.bigint() - t) / 1e6;
    const chars = (targets, ctx) => incrementalEditor.buildIncrementalPrompt({ prompt, targetFiles: targets, projectFiles: files, conversation: null, lspContext: ctx }).messages.reduce((n, m) => n + m.content.length, 0);
    const base = chars(heuristic, null);
    t = process.hrtime.bigint();
    const cold = await incrementalEditor.selectTargetFilesLsp({ prompt, files, projectKey: `measure-${prompts.indexOf(prompt)}` });
    const coldMs = Number(process.hrtime.bigint() - t) / 1e6;
    t = process.hrtime.bigint();
    await incrementalEditor.selectTargetFilesLsp({ prompt, files, projectKey: `measure-${prompts.indexOf(prompt)}` });
    const warmMs = Number(process.hrtime.bigint() - t) / 1e6;
    const withLsp = chars(cold.targets, cold.source === 'lsp' ? cold : null);
    rows.push({ prompt, source: cold.source, heuristicTargets: heuristic.length, lspTargets: cold.targets.length, heuristicPromptChars: base, lspPromptChars: withLsp, change: `${(((withLsp - base) / base) * 100).toFixed(1)}%`, heuristicMs: heuristicMs.toFixed(1), lspColdMs: coldMs.toFixed(0), lspWarmMs: warmMs.toFixed(0) });
  }
  console.table(rows);
  await lsp.disposeAll();
})();
