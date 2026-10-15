const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAndRepair, sourceHash, PipelineError } = require('../src/services/ai/validationGate');
const { dependencyPolicy } = require('../src/services/ai/executionRunner');

const app = (content = 'export default function App(){return <h1>Ready</h1>}') => [
  { path: 'package.json', content: JSON.stringify({ scripts: { build: 'vite build', preview: 'vite preview' }, dependencies: { react: '^18.3.1' } }) },
  { path: 'src/App.jsx', content }
];
const passed = () => ({ ok: true, diagnostics: [], checks: ['dependencies', 'syntax', 'build', 'preview', 'browser', 'artifacts']
  .map((name) => ({ name, status: 'passed' })), coverage: { exhaustive: false },
  artifacts: [{ path: 'dist/index.html', content: Buffer.from('<h1>Ready</h1>').toString('base64') }],
  lockfile: '{"lockfileVersion":3}' });

test('success requires execution and returns tested lockfile, coverage and source hash', async () => {
  let ran = false;
  const result = await validateAndRepair(app(), { run: async () => { ran = true; return passed(); } });
  assert.ok(ran);
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.sourceHash, sourceHash(result.files));
  assert.equal(result.report.coverage.exhaustive, false);
  assert.ok(result.files.some((file) => file.path === 'package-lock.json'));
});

test('successful visual execution metadata is retained in the final validation report', async () => {
  const visual = { passed: true, score: 0.91, threshold: 0.82, viewport: { width: 1440, height: 900 } };
  const result = await validateAndRepair(app(), { run: async () => ({ ...passed(), visual }) });
  assert.deepEqual(result.report.visual, visual);
});

test('syntax repair is validated before execution and does not mutate original files', async () => {
  const original = app('export default function App( {');
  const before = JSON.stringify(original);
  let attempts = 0;
  const result = await validateAndRepair(original, {
    repair: async (files, errors, history) => {
      assert.equal(history.length, 1);
      assert.equal(errors[0].category, 'syntax');
      attempts++;
      return [app()[1]];
    }, run: async () => passed()
  });
  assert.equal(attempts, 1);
  assert.equal(result.report.history.length, 2);
  assert.deepEqual(result.report.history[0].changedFiles, ['src/App.jsx']);
  assert.equal(JSON.stringify(original), before);
});

test('runtime click failure repairs and repeats the full execution gate', async () => {
  let runs = 0;
  const result = await validateAndRepair(app(), {
    run: async () => ++runs === 1 ? { ok: false, diagnostics: [{ category: 'pageerror', path: '/assets/index.js', line: 3,
      message: 'ReferenceError: openMenu is not defined\n at click (/assets/index.js:3:5)' }] } : passed(),
    repair: async (files, errors, history) => {
      assert.match(errors[0].message, /openMenu/);
      assert.equal(history[0].attempt, 1);
      return [app('export default function App(){return <button onClick={()=>{}}>Menu</button>}')[1]];
    }
  });
  assert.equal(runs, 2);
  assert.equal(result.report.status, 'passed');
});

test('runtime-only fallback repairs automatically without requiring build artifacts', async () => {
  let runs = 0;
  let repairs = 0;
  const result = await validateAndRepair(app(), {
    requireArtifacts: false,
    run: async () => ++runs === 1
      ? { ok: false, diagnostics: [{ category: 'preview-runtime', path: 'src/App.jsx', message: 'value.shortName is undefined' }] }
      : { ok: true, diagnostics: [], checks: [{ name: 'preview-runtime', status: 'passed' }], coverage: { exhaustive: false }, artifacts: [] },
    repair: async (files, diagnostics) => {
      repairs++;
      assert.equal(diagnostics[0].category, 'preview-runtime');
      return [app('export default function App(){return <h1>Aurelia</h1>}')[1]];
    }
  });

  assert.equal(runs, 2);
  assert.equal(repairs, 1);
  assert.equal(result.report.status, 'passed');
  assert.ok(result.report.checks.some((check) => check.name === 'preview-runtime' && check.status === 'passed'));
  assert.equal(result.artifacts.length, 0);
});

test('unavailable worker blocks with diagnostics and does not ask AI to rewrite code', async () => {
  await assert.rejects(validateAndRepair(app(), {
    run: async () => ({ ok: false, blocked: true, diagnostics: [{ category: 'infrastructure', path: null, message: 'Docker unavailable' }] }),
    repair: () => assert.fail('No repair on an infrastructure failure')
  }), (error) => error instanceof PipelineError && error.report.status === 'blocked' && /Docker unavailable/.test(error.message));
});

test('missing external dependencies block rather than deleting required functionality', async () => {
  await assert.rejects(validateAndRepair(app(), {
    run: async () => ({ ok: false, diagnostics: [{ category: 'external-blocked', path: '/api', message: 'External API requires credentials or mocks' }] }),
    repair: () => assert.fail('Must not remove the API requirement')
  }), (error) => error.report.status === 'blocked');
});

test('same code is not repeatedly repaired and failures retain error memory', async () => {
  await assert.rejects(validateAndRepair(app(), {
    run: async () => ({ ok: false, diagnostics: [{ category: 'build', path: 'src/App.jsx', message: 'Build failed' }] }),
    repair: async (files) => [files[1]]
  }), (error) => /no meaningful change/.test(error.report.reason) && error.report.history.length === 1);
});

test('repair limit retains each meaningful failed attempt', async () => {
  let repairs = 0;
  await assert.rejects(validateAndRepair(app(), {
    run: async () => ({ ok: false, diagnostics: [{ category: 'build', message: 'Still failing', path: 'src/App.jsx' }] }),
    repair: async () => [app(`export default function App(){return <h1>Attempt ${++repairs}</h1>}`)[1]]
  }), (error) => error.report.status === 'failed' && error.report.history.length === 3);
  assert.equal(repairs, 2);
});

test('cancellation cannot complete a worker result', async () => {
  const controller = new AbortController();
  await assert.rejects(validateAndRepair(app(), {
    signal: controller.signal, run: async () => { controller.abort(); return passed(); }
  }), { name: 'AbortError' });
});

test('unsafe paths never reach execution', async () => {
  await assert.rejects(validateAndRepair([...app(), { path: '../escape.js', content: '' }], {
    run: () => assert.fail('Unsafe path reached worker')
  }), (error) => error.report.status === 'blocked');
});

test('repair cannot weaken acceptance tests', async () => {
  await assert.rejects(validateAndRepair([...app(), { path: 'veave.validation.json', content: '{"version":1}' }], {
    run: async () => ({ ok: false, diagnostics: [{ category: 'plan', path: 'veave.validation.json', message: 'Assertion failed' }] }),
    repair: async () => [{ path: 'veave.validation.json', content: '{}' }]
  }), (error) => /acceptance tests/.test(error.report.reason));
});

test('dependency policy excludes file/git/URL dependencies and non-registry locks', () => {
  assert.doesNotThrow(() => dependencyPolicy(app()));
  for (const spec of ['file:../../backend', 'git+https://example.com/repo', 'https://127.0.0.1/pkg.tgz', 'latest']) {
    assert.throws(() => dependencyPolicy([{ path: 'package.json', content: JSON.stringify({ dependencies: { foo: spec } }) }]));
  }
  assert.throws(() => dependencyPolicy([...app(), { path: 'package-lock.json', content: '{"packages":{"foo":{"resolved":"http://169.254.169.254/secret"}}}' }]));
  assert.throws(() => dependencyPolicy([{ path: 'package.json', content: '{"peerDependencies":{"foo":"http://127.0.0.1/probe.tgz"}}' }]));
});

test('static validation passes without docker execution when requireExecution is false', async () => {
  const result = await validateAndRepair(app(), { requireExecution: false });
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.stage, 'verified');
  assert.equal(result.report.sourceHash, sourceHash(result.files));
  assert.ok(result.report.checks.some(c => c.name === 'static' && c.status === 'passed'));
});

test('static validation triggers repair on syntax errors when requireExecution is false', async () => {
  let repairs = 0;
  const result = await validateAndRepair(app('export default function App( {'), {
    requireExecution: false,
    repair: async (files, diagnostics) => {
      repairs++;
      assert.equal(diagnostics[0].category, 'syntax');
      return [app('export default function App() { return <h1>Fixed</h1>; }')[1]];
    }
  });
  assert.equal(repairs, 1);
  assert.equal(result.report.status, 'passed');
  assert.ok(result.files.find(f => f.path === 'src/App.jsx').content.includes('Fixed'));
});
