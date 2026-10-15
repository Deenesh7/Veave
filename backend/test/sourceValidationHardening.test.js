const test = require('node:test');
const assert = require('node:assert/strict');
const aiProtocol = require('../src/services/ai/aiProtocol');
const { validateAndRepair } = require('../src/services/ai/validationGate');
const { FileApplicationError } = require('../src/utils/errors');

function sampleProject() {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({ name: 'test', dependencies: { react: '^18.3.1' } }),
      language: 'json'
    },
    {
      path: 'src/App.jsx',
      content: `import React from 'react';

export default function App() {
  return (
    <div className="container">
      <h1 className="text-blue-600">Header One</h1>
      <p className="text-blue-600">Paragraph with blue text</p>
      <button className="text-blue-600">Click me</button>
    </div>
  );
}`,
      language: 'javascript'
    }
  ];
}

test('Hardening 1: Patch with multiple occurrences is rejected (expectedMatches === 1)', () => {
  const project = sampleProject();
  const initialHash = project[1].content;

  // 'className="text-blue-600"' appears 3 times in src/App.jsx
  const ambiguousPatch = [
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: 'className="text-blue-600"',
      replace: 'className="text-black"'
    }
  ];

  assert.throws(
    () => aiProtocol.applyOperationsSafely(project, ambiguousPatch),
    (err) => {
      assert.ok(err instanceof FileApplicationError);
      assert.match(err.message, /matched 3 locations/);
      assert.match(err.message, /expectedMatches: 1/);
      return true;
    }
  );

  // File was preserved untouched
  assert.equal(project[1].content, initialHash);
});

test('Hardening 2: Unique patch succeeds and updates only the matched block', () => {
  const project = sampleProject();

  const uniquePatch = [
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: '<p className="text-blue-600">Paragraph with blue text</p>',
      replace: '<p className="text-black">Paragraph with black text</p>'
    }
  ];

  const result = aiProtocol.applyOperationsSafely(project, uniquePatch);
  assert.equal(result.changedFiles.length, 1);
  const updatedApp = result.files.find(f => f.path === 'src/App.jsx');
  assert.ok(updatedApp.content.includes('<p className="text-black">Paragraph with black text</p>'));
  // Other text-blue-600 occurrences remain intact
  assert.ok(updatedApp.content.includes('<h1 className="text-blue-600">Header One</h1>'));
});

test('Hardening 3: In-memory syntax validation rejects a patch that introduces syntax errors', () => {
  const project = sampleProject();

  // Patch that breaks JSX syntax by leaving an unclosed tag
  const brokenPatch = [
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: '<button className="text-blue-600">Click me</button>',
      replace: '<button className="text-black">Click me'
    }
  ];

  assert.throws(
    () => aiProtocol.applyOperationsSafely(project, brokenPatch),
    (err) => {
      assert.ok(err instanceof FileApplicationError);
      assert.match(err.message, /Syntax error/i);
      return true;
    }
  );
});

test('Hardening 4: Strips outer markdown fences inside <FILE> delimiter', () => {
  const rawAI = `<FILE path="src/App.jsx" operation="modify">
\`\`\`jsx
import React from 'react';

export default function App() {
  return <h1>Cleaned Code</h1>;
}
\`\`\`
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 1);
  assert.ok(!parsed.files[0].content.includes('```'));
  assert.ok(parsed.files[0].content.startsWith('import React'));
});

test('Hardening 5: Strips outer markdown fences inside <PATCH> <SEARCH> and <REPLACE>', () => {
  const rawAI = `<PATCH path="src/App.jsx">
<SEARCH>
\`\`\`jsx
<h1 className="text-blue-600">Header One</h1>
\`\`\`
</SEARCH>
<REPLACE>
\`\`\`jsx
<h1 className="text-black">Header One</h1>
\`\`\`
</REPLACE>
</PATCH>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].operation, 'patch');
  assert.equal(parsed.files[0].search, '<h1 className="text-blue-600">Header One</h1>');
  assert.equal(parsed.files[0].replace, '<h1 className="text-black">Header One</h1>');
});

test('Hardening 6: Strips UTF-8 BOM from start of file', () => {
  const rawWithBOM = '\uFEFF' + sampleProject()[1].content;
  const rawAI = `<FILE path="src/App.jsx" operation="modify">\n${rawWithBOM}\n</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  assert.ok(!parsed.files[0].content.startsWith('\uFEFF'));
});

test('Hardening 7: Conversational preamble before code is stripped in bare fallback', () => {
  const rawAI = `Here is the updated App.jsx file for your project:
\`\`\`jsx
import React from 'react';

export default function App() {
  return <div>Cleaned</div>;
}
\`\`\`
Hope this helps!`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 1);
  assert.ok(!parsed.files[0].content.includes('Here is'));
  assert.ok(!parsed.files[0].content.includes('Hope this helps'));
  assert.ok(parsed.files[0].content.startsWith('import React'));
});

test('Hardening 8: ValidationGate rejects a corrupted repair attempt and preserves previous files', async () => {
  const project = sampleProject();
  // Introduce a mild error in project: missing closing div
  project[1].content = `import React from 'react';
export default function App() {
  return <div><span>Broken;
}`;

  let repairCallCount = 0;

  await assert.rejects(
    validateAndRepair(project, {
      requireExecution: false,
      maxRepairs: 2,
      repair: async (currentFiles, diagnostics, history) => {
        repairCallCount++;
        if (repairCallCount === 1) {
          // Attempt 1 returns corrupted repair code with syntax error at line 1:1
          return [{ path: 'src/App.jsx', content: '} corrupted syntax at line 1', language: 'javascript' }];
        }
        // Attempt 2 returns another broken syntax
        return [{ path: 'src/App.jsx', content: '<!DOCTYPE html><html>', language: 'javascript' }];
      }
    }),
    /Validation did not pass within 2 repair attempts/
  );

  assert.equal(repairCallCount, 2);
});
