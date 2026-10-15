const assert = require('node:assert/strict');
const { scaffoldReactProject } = require('../src/services/project/reactScaffolder');
const { executeProject } = require('../src/services/ai/executionRunner');
const { validateAndRepair } = require('../src/services/ai/validationGate');

// Explicit Docker integration command, separate from the host fixture test suite.
const good = 'import React from "react"; export default function App(){const [n,setN]=React.useState(0);return <main><h1>Runner fixture</h1><button onClick={()=>setN(n+1)}>Count {n}</button></main>}';
const bad = 'import React from "react"; export default function App(){return <main><h1>Runner fixture</h1><button onClick={()=>missingHandler()}>Open menu</button></main>}';
const files = scaffoldReactProject([{ path: 'src/App.jsx', content: bad }], { projectName: 'runner-fixture' });

(async () => {
  let repairs = 0;
  const validated = await validateAndRepair(files, {
    run: executeProject,
    onProgress: async (report) => console.log(`stage=${report.stage} attempts=${report.history.length}`),
    repair: async (current, diagnostics) => {
      assert.ok(diagnostics.some((item) => /missingHandler/.test(item.message)));
      repairs++;
      return [{ path: 'src/App.jsx', content: good }];
    }
  });
  assert.equal(repairs, 1);
  assert.equal(validated.report.status, 'passed');
  assert.ok(validated.artifacts.some((file) => file.path === 'dist/index.html'));
  console.log('Container integration passed: install, build, startup, browser, click failure, repair, rebuild and retest.');
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
