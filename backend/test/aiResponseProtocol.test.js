const test = require('node:test');
const assert = require('node:assert/strict');
const aiProtocol = require('../src/services/ai/aiProtocol');
const {
  AIResponseMalformedError,
  AIResponseValidationError,
  FileApplicationError,
  RepairExhaustedError
} = require('../src/utils/errors');
const generationPipeline = require('../src/services/ai/generationPipeline');

function createSampleProject() {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'test-app',
        version: '1.0.0',
        dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }
      }, null, 2),
      language: 'json'
    },
    {
      path: 'src/index.css',
      content: 'body { margin: 0; background: #000; color: #fff; }',
      language: 'css'
    },
    {
      path: 'src/App.jsx',
      content: `import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Footer from './components/Footer';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Navbar />
      <Hero count={count} onIncrement={() => setCount(c => c + 1)} />
      <Footer />
    </div>
  );
}`,
      language: 'javascript'
    },
    {
      path: 'src/components/Navbar.jsx',
      content: `import React from 'react';

export default function Navbar() {
  return (
    <nav className="bg-blue-900 p-4 text-white flex justify-between">
      <span className="font-bold">Veave</span>
      <button className="bg-blue-600 px-4 py-2 rounded">Login</button>
    </nav>
  );
}`,
      language: 'javascript'
    },
    {
      path: 'src/components/Hero.jsx',
      content: `import React from 'react';

export default function Hero({ count, onIncrement }) {
  return (
    <header className="p-12 text-center">
      <h1 className="text-4xl font-extrabold">Welcome</h1>
      <button onClick={onIncrement} className="mt-4 px-6 py-3 bg-indigo-600 rounded">
        Clicked {count} times
      </button>
    </header>
  );
}`,
      language: 'javascript'
    },
    {
      path: 'src/components/Footer.jsx',
      content: `import React from 'react';

export default function Footer() {
  return (
    <footer className="p-6 bg-slate-950 text-center text-sm text-gray-400">
      © 2026 Veave AI Inc.
    </footer>
  );
}`,
      language: 'javascript'
    },
    {
      path: 'src/utils/helpers.js',
      content: `export function formatCurrency(amount) {
  return '$' + Number(amount).toFixed(2);
}`,
      language: 'javascript'
    }
  ];
}

// ==============================================================================
// 1. NORMAL JSX
// ==============================================================================
test('1. Normal JSX: parses and applies valid React JSX components cleanly', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/components/Navbar.jsx" operation="modify">
import React from 'react';

export default function Navbar() {
  return (
    <nav className="bg-emerald-600 p-4 text-white flex justify-between">
      <span className="font-bold text-xl">Veave Modern</span>
      <button className="bg-emerald-800 px-4 py-2 rounded">Sign In</button>
    </nav>
  );
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const validated = aiProtocol.validateFileOperations(parsed, project);
  const applied = aiProtocol.applyOperationsSafely(project, validated.files);

  const updatedNav = applied.files.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(updatedNav);
  assert.ok(updatedNav.content.includes('bg-emerald-600'));
  assert.ok(updatedNav.content.includes('Veave Modern'));
  // Unrelated files preserved
  assert.strictEqual(applied.files.find(f => f.path === 'src/components/Hero.jsx').content, project.find(f => f.path === 'src/components/Hero.jsx').content);
});

// ==============================================================================
// 2. JAVASCRIPT
// ==============================================================================
test('2. JavaScript: parses pure JS logic functions and array utilities', () => {
  const project = createSampleProject();
  const rawAI = {
    action: 'update',
    files: [
      {
        path: 'src/utils/helpers.js',
        operation: 'modify',
        content: `export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function filterActive(items) {
  return (items || []).filter(item => item && item.active);
}`
      }
    ]
  };

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const updatedHelpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(updatedHelpers.content.includes('Intl.NumberFormat'));
  assert.ok(updatedHelpers.content.includes('filterActive'));
});

// ==============================================================================
// 3. CSS
// ==============================================================================
test('3. CSS: parses and updates stylesheets without string escape mangling', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/index.css" operation="modify">
:root {
  --primary-color: #10b981;
  --bg-gradient: linear-gradient(135deg, #0f172a 0%, #020617 100%);
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.05); }
}

body {
  margin: 0;
  background: var(--bg-gradient);
  font-family: system-ui, -apple-system, sans-serif;
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const css = applied.files.find(f => f.path === 'src/index.css');
  assert.ok(css.content.includes('@keyframes pulse-glow'));
  assert.ok(css.content.includes('linear-gradient(135deg'));
});

// ==============================================================================
// 4. JSON
// ==============================================================================
test('4. JSON: parses and creates/updates JSON configuration files', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/tokens.json" operation="create">
{
  "colors": {
    "primary": "#3b82f6",
    "accent": "#06b6d4"
  },
  "typography": {
    "fontFamily": "Inter, sans-serif",
    "baseSize": "16px"
  }
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const tokens = applied.files.find(f => f.path === 'src/tokens.json');
  assert.ok(tokens);
  const parsedData = JSON.parse(tokens.content);
  assert.strictEqual(parsedData.colors.primary, '#3b82f6');
});

test('4a. JSON: recovers valid JSON after a damaged markdown language marker', () => {
  const response = `<FILE path="package.json" operation="create">
on
{
  "name": "recovered-app",
  "dependencies": { "react": "^18.3.1" }
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(response);
  const validated = aiProtocol.validateFileOperations(parsed, []);
  const applied = aiProtocol.applyOperationsSafely([], validated.files);
  const manifest = JSON.parse(applied.files.find((file) => file.path === 'package.json').content);

  assert.equal(manifest.name, 'recovered-app');
});

test('4b. JSON: still rejects malformed enclosed JSON', () => {
  const response = `<FILE path="package.json" operation="create">
on
{ "name": "broken", }
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(response);
  const validated = aiProtocol.validateFileOperations(parsed, []);
  assert.throws(
    () => aiProtocol.applyOperationsSafely([], validated.files),
    /Invalid JSON in "package\.json"/
  );
});

// ==============================================================================
// 5. REGEX CONTAINING \s
// ==============================================================================
test('5. Regex containing \\s: preserves whitespace regex backslashes verbatim without corruption', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export function normalizeSpacing(text) {
  const re = /\\s+/g;
  return String(text || '').replace(re, ' ').trim();
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes('/\\s+/g'), 'Regex with \\s was preserved');
});

// ==============================================================================
// 6. REGEX CONTAINING \d
// ==============================================================================
test('6. Regex containing \\d: preserves digit regex backslashes accurately', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export function formatPhoneNumber(phone) {
  const cleaned = ('' + phone).replace(/\\D/g, '');
  const match = cleaned.match(/^(\\d{3})(\\d{3})(\\d{4})$/);
  if (match) return '(' + match[1] + ') ' + match[2] + '-' + match[3];
  return null;
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes('/\\D/g'));
  assert.ok(helpers.content.includes('\\d{3}'));
});

// ==============================================================================
// 7. TEMPLATE LITERALS
// ==============================================================================
test('7. Template literals: preserves multiline template literals with intact line breaks', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export const emailTemplate = \`
  <div style="font-family: Arial, sans-serif; padding: 20px;">
    <h2>Order Confirmation</h2>
    <p>Thank you for your purchase.</p>
  </div>
\`;
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes('<h2>Order Confirmation</h2>'));
});

// ==============================================================================
// 8. ${variable} INTERPOLATION
// ==============================================================================
test('8. ${variable}: preserves dollar-brace expressions without premature expansion', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export function buildWelcomeMessage(user, balance) {
  return \`Welcome, \${user.name}! Your current balance is \${balance}.\`;
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes('${user.name}'));
  assert.ok(helpers.content.includes('${balance}'));
});

// ==============================================================================
// 9. BACKTICKS
// ==============================================================================
test('9. Backticks: handles nested backticks and code snippets correctly', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export function getMarkdownQuote(author, text) {
  return \`> "\` + text + \`" - \${author}\`;
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes('> "'));
});

// ==============================================================================
// 10. ESCAPED QUOTES
// ==============================================================================
test('10. Escaped quotes: preserves single and double quotes without escaping errors', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/utils/helpers.js" operation="modify">
export const QUOTES = {
  single: 'It\\'s a wonderful day',
  double: "She said \\"Hello World\\" loudly"
};
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const helpers = applied.files.find(f => f.path === 'src/utils/helpers.js');
  assert.ok(helpers.content.includes("It\\'s a wonderful day") || helpers.content.includes("It's a wonderful day"));
});

// ==============================================================================
// 11. UNICODE
// ==============================================================================
test('11. Unicode: supports UTF-8 emojis, accented letters, and special symbols', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/components/Footer.jsx" operation="modify">
import React from 'react';

export default function Footer() {
  return (
    <footer className="p-6 bg-slate-950 text-center text-sm text-gray-400">
      <span>🚀 Powered by Veave AI ✨</span>
      <p>Café & Crème Studio © 2026. All rights reserved.</p>
    </footer>
  );
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const footer = applied.files.find(f => f.path === 'src/components/Footer.jsx');
  assert.ok(footer.content.includes('🚀 Powered by Veave AI ✨'));
  assert.ok(footer.content.includes('Café & Crème'));
});

// ==============================================================================
// 12. LARGE GENERATED FILES
// ==============================================================================
test('12. Large generated files: parses and validates large files (>50KB) efficiently', () => {
  const project = createSampleProject();
  let largeCode = `import React from 'react';\n\n`;
  for (let i = 0; i < 600; i++) {
    largeCode += `export function ComponentBlock${i}() {\n  return <div className="p-4 border">Section ${i} with active data</div>;\n}\n\n`;
  }
  largeCode += `export default function BigDashboard() {\n  return <div>Loaded All Blocks</div>;\n}\n`;

  assert.ok(largeCode.length > 50000);

  const rawAI = `<FILE path="src/components/BigDashboard.jsx" operation="create">
${largeCode}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);
  const bigDash = applied.files.find(f => f.path === 'src/components/BigDashboard.jsx');
  assert.ok(bigDash);
  assert.strictEqual(bigDash.content.trim(), largeCode.trim());
});

// ==============================================================================
// 13. MULTIPLE FILES
// ==============================================================================
test('13. Multiple files: handles changesets touching multiple files simultaneously', () => {
  const project = createSampleProject();
  const rawAI = `<FILE path="src/components/Navbar.jsx" operation="modify">
export default function Navbar() { return <nav className="bg-white">White Nav</nav>; }
</FILE>

<FILE path="src/index.css" operation="modify">
body { background: #fafafa; }
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);

  assert.ok(applied.changedFiles.includes('src/components/Navbar.jsx'));
  assert.ok(applied.changedFiles.includes('src/index.css'));
  assert.strictEqual(applied.changedFiles.length, 2);
  // Untouched files preserved exactly
  assert.strictEqual(applied.files.find(f => f.path === 'src/App.jsx').content, project.find(f => f.path === 'src/App.jsx').content);
});

// ==============================================================================
// 14. MULTIPLE FILE OPERATIONS (create, modify, delete, rename)
// ==============================================================================
test('14. Multiple file operations: supports create, modify, delete, and rename in one changeset', () => {
  const project = createSampleProject();
  const rawAI = {
    action: 'update',
    files: [
      {
        path: 'src/components/Badge.jsx',
        operation: 'create',
        content: 'export default function Badge({ text }) { return <span>{text}</span>; }'
      },
      {
        path: 'src/components/Navbar.jsx',
        operation: 'modify',
        content: 'export default function Navbar() { return <nav>Updated Nav</nav>; }'
      },
      {
        path: 'src/utils/helpers.js',
        operation: 'rename',
        newPath: 'src/utils/formatters.js'
      }
    ]
  };

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const applied = aiProtocol.applyOperationsSafely(project, parsed.files);

  assert.ok(applied.files.some(f => f.path === 'src/components/Badge.jsx'), 'Created Badge.jsx');
  assert.ok(applied.files.some(f => f.path === 'src/utils/formatters.js'), 'Renamed helpers.js to formatters.js');
  assert.ok(!applied.files.some(f => f.path === 'src/utils/helpers.js'), 'helpers.js was removed after rename');
});

test('14a. Applying source edits preserves existing binary asset encoding', () => {
  const project = [
    { path: 'src/App.jsx', content: 'export default function App(){ return <main />; }', language: 'javascript' },
    { path: 'public/assets/images/hero.webp', content: 'UklGRg==', language: 'binary', encoding: 'base64' }
  ];
  const applied = aiProtocol.applyOperationsSafely(project, [{
    path: 'src/App.jsx',
    operation: 'modify',
    content: 'export default function App(){ return <main><img src="/assets/images/hero.webp" /></main>; }'
  }]);

  const asset = applied.files.find((file) => file.path === 'public/assets/images/hero.webp');
  assert.equal(asset.encoding, 'base64');
  assert.equal(asset.language, 'binary');
  assert.equal(asset.content, 'UklGRg==');
});

// ==============================================================================
// 15. MALFORMED STRUCTURED RESPONSE
// ==============================================================================
test('15. Malformed structured response: rejects empty or non-array files safely', () => {
  assert.throws(() => {
    aiProtocol.validateFileOperations({ action: 'update', files: [] });
  }, AIResponseValidationError);

  assert.throws(() => {
    aiProtocol.validateFileOperations({ action: 'update', files: "not an array" });
  }, AIResponseValidationError);
});

test('15a. Modify operations without complete content produce a repairable validation error', () => {
  const parsed = aiProtocol.parseAIResponse({
    action: 'update',
    files: [{ path: 'src/components/HeroBanner.jsx', operation: 'modify' }]
  });

  assert.throws(
    () => aiProtocol.validateFileOperations(parsed),
    (error) => error instanceof AIResponseValidationError && /requires a string "content" field/.test(error.message)
  );
});

test('15b. File-operation tool schema requires content to prevent empty modify calls', () => {
  const itemSchema = aiProtocol.FILE_OPERATIONS_TOOL.function.parameters.properties.files.items;
  assert.ok(itemSchema.required.includes('content'));
});

test('15c. Tool parser recovers common code aliases and mislabeled patches', () => {
  const parsed = aiProtocol.parseAIResponse({
    tool_calls: [{ function: { arguments: JSON.stringify({
      action: 'update',
      files: [
        { path: 'src/App.jsx', operation: 'modify', code: 'export default function App(){ return <main />; }' },
        { path: 'src/App.jsx', operation: 'modify', search: '<main />', replace: '<main>Clone</main>' }
      ]
    }) } }]
  });

  assert.equal(parsed.files[0].content.trim(), 'export default function App(){ return <main />; }');
  assert.equal(parsed.files[1].operation, 'patch');
  assert.equal(parsed.files[1].search, '<main />');
  assert.equal(parsed.files[1].replace, '<main>Clone</main>');
});

// ==============================================================================
// 16. MALFORMED FALLBACK RESPONSE
// ==============================================================================
test('16. Malformed fallback response: rejects truncated or unparseable input without corrupting files', () => {
  const project = createSampleProject();
  const badInput = 'I have thought about the change and think you should do it.';

  assert.throws(() => {
    aiProtocol.parseAIResponse(badInput);
  }, AIResponseMalformedError);

  // Project remains untouched
  assert.strictEqual(project.length, 7);
});

test('16a. Delimiter attributes: parses FILE attributes in any order', () => {
  const rawAI = `<FILE operation="create" newPath="src/pages/Unused.jsx" path="src/pages/About.jsx">
export default function About() { return <main>About</main>; }
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  assert.strictEqual(parsed.files.length, 1);
  assert.strictEqual(parsed.files[0].path, 'src/pages/About.jsx');
  assert.strictEqual(parsed.files[0].operation, 'create');
});

test('16b. Multipart content: parses OpenRouter text content arrays', () => {
  const response = {
    content: [
      { type: 'text', text: '<FILE operation="create" path="src/pages/Contact.jsx">' },
      { type: 'text', text: 'export default function Contact() { return <main>Contact</main>; }\n</FILE>' }
    ]
  };

  const parsed = aiProtocol.parseAIResponse(response);
  assert.strictEqual(parsed.files.length, 1);
  assert.strictEqual(parsed.files[0].path, 'src/pages/Contact.jsx');
  assert.ok(parsed.files[0].content.includes('function Contact'));
});

test('16c. Length-limited responses are accepted only when the structured operation is complete', () => {
  const complete = {
    finishReason: 'length',
    content: '<PATCH path="src/App.jsx">\n<SEARCH>old</SEARCH>\n<REPLACE>new</REPLACE>\n</PATCH>'
  };
  const truncated = {
    finishReason: 'length',
    content: '<PATCH path="src/App.jsx">\n<SEARCH>old</SEARCH>\n<REPLACE>new'
  };
  const completeTool = {
    finishReason: 'length',
    tool_calls: [{ function: { arguments: JSON.stringify({ action: 'update', files: [
      { path: 'src/App.jsx', operation: 'patch', search: 'old', replace: 'new' }
    ] }) } }]
  };
  assert.equal(aiProtocol.hasCompleteStructuredResponse(complete), true);
  assert.equal(aiProtocol.hasCompleteStructuredResponse(truncated), false);
  assert.equal(aiProtocol.hasCompleteStructuredResponse(completeTool), true);
});

test('16d. Response continuations merge overlap without duplicating generated code', () => {
  const first = '<PATCH path="src/App.jsx">\n<SEARCH>old</SEARCH>\n<REPLACE>new content';
  const repeatedTail = 'new content</REPLACE>\n</PATCH>';
  const merged = aiProtocol.appendResponseContinuation(first, repeatedTail);
  assert.equal(merged, '<PATCH path="src/App.jsx">\n<SEARCH>old</SEARCH>\n<REPLACE>new content</REPLACE>\n</PATCH>');
  assert.equal(aiProtocol.hasCompleteStructuredResponse({ content: merged }), true);
});

// ==============================================================================
// 17. PATH TRAVERSAL
// ==============================================================================
test('17. Path traversal: prevents ../ or ..\\ traversal attacks', () => {
  assert.throws(() => {
    aiProtocol.validatePath('../../etc/passwd');
  }, /Path traversal/);

  assert.throws(() => {
    aiProtocol.validatePath('src/components/../../../secret.env');
  }, /Path traversal/);
});

// ==============================================================================
// 18. ABSOLUTE PATH
// ==============================================================================
test('18. Absolute path: rejects absolute root or Windows drive letter paths', () => {
  assert.throws(() => {
    aiProtocol.validatePath('/etc/passwd');
  }, /Absolute path/);

  assert.throws(() => {
    aiProtocol.validatePath('C:\\Windows\\System32\\cmd.exe');
  }, /Absolute path/);
});

// ==============================================================================
// 19. DUPLICATE FILE PATHS
// ==============================================================================
test('19. Duplicate file paths: rejects conflicting duplicate modifications of the same file in one response', () => {
  const duplicateOps = {
    action: 'update',
    files: [
      { path: 'src/App.jsx', operation: 'modify', content: '// edit 1' },
      { path: 'src/App.jsx', operation: 'modify', content: '// edit 2' }
    ]
  };

  assert.throws(() => {
    aiProtocol.validateFileOperations(duplicateOps);
  }, /Duplicate file path/);
});

test('19a. Multiple patches may target different sections of the same file', () => {
  const project = createSampleProject();
  const parsed = {
    action: 'update',
    files: [
      { path: 'src/App.jsx', operation: 'patch', search: "import React, { useState } from 'react';", replace: "import React, { useState } from 'react';\nimport About from './About';" },
      { path: 'src/App.jsx', operation: 'patch', search: '      <Footer />', replace: '      <About />\n      <Footer />' }
    ]
  };

  const validated = aiProtocol.validateFileOperations(parsed, project);
  const applied = aiProtocol.applyOperationsSafely(project, validated.files);
  const app = applied.files.find((file) => file.path === 'src/App.jsx');
  assert.ok(app.content.includes("import About from './About'"));
  assert.ok(app.content.includes('<About />'));
});

// ==============================================================================
// 20. BUILD FAILURE FOLLOWED BY REPAIR
// ==============================================================================
test('20. Build failure followed by repair: formats diagnostics and repairs syntax error', () => {
  const project = createSampleProject();
  // Introduction of a syntax error
  const brokenCode = `export default function Broken() { return <div><span>Missing close</div>; }`;

  const diagnostics = generationPipeline.validateGeneratedFiles([
    ...project.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: brokenCode, language: 'javascript' }
  ]);
  assert.ok(diagnostics.length > 0, 'Syntax error detected');

  // Build repair prompt
  const repairPrompt = aiProtocol.buildRepairPrompt({
    files: project,
    diagnostics,
    targetPath: 'src/App.jsx'
  });
  assert.ok(repairPrompt.messages[1].content.includes('Unterminated JSX contents'));
  assert.ok(repairPrompt.messages[1].content.includes('src/App.jsx'));

  // Simulated AI repair output using deterministic delimiters
  const repairAIResponse = `<FILE path="src/App.jsx" operation="modify">
export default function Fixed() {
  return <div><span>Properly Closed</span></div>;
}
</FILE>`;

  const parsedRepair = aiProtocol.parseAIResponse(repairAIResponse);
  const repairedProject = aiProtocol.applyOperationsSafely(project, parsedRepair.files);

  const repairDiagnostics = generationPipeline.validateGeneratedFiles(repairedProject.files);
  assert.strictEqual(repairDiagnostics.length, 0, 'Repaired project has zero syntax diagnostics');
});

// ==============================================================================
// 21. REPAIR FAILURE
// ==============================================================================
test('21. Repair failure: preserves original project when patch target is missing', () => {
  const project = createSampleProject();
  const originalHash = project.map(f => f.content).join('');

  // Patch targeting non-existent code
  const impossiblePatch = [
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: 'NON_EXISTENT_FUNCTION_NAME_12345()',
      replace: 'replacement()'
    }
  ];

  assert.throws(() => {
    aiProtocol.applyOperationsSafely(project, impossiblePatch);
  }, FileApplicationError);

  // Verify project state intact
  const currentHash = project.map(f => f.content).join('');
  assert.strictEqual(currentHash, originalHash, 'Project untouched after failed patch');
});

// ==============================================================================
// 22. OPENROUTER HTTP 200 WITH MALFORMED CONTENT
// ==============================================================================
test('22. OpenRouter HTTP 200 with malformed content: rejects gracefully without corruption', () => {
  const project = createSampleProject();
  const openRouter200Payload = {
    content: "Here is your code: ```\n```",
    tool_calls: null
  };

  assert.throws(() => {
    aiProtocol.parseAIResponse(openRouter200Payload);
  }, AIResponseMalformedError);
});

// ==============================================================================
// 23. INCREMENTAL PROJECT MODIFICATION
// ==============================================================================
test('23. Incremental project modification: modifies only target component, validates diff, preserves unrelated files', () => {
  const project = createSampleProject();
  const prompt = "change the navbar background to white";

  // AI response modifying ONLY the Navbar
  const rawAI = `<FILE path="src/components/Navbar.jsx" operation="modify">
import React from 'react';

export default function Navbar() {
  return (
    <nav className="bg-white text-gray-900 p-4 flex justify-between shadow">
      <span className="font-bold">Veave</span>
      <button className="bg-blue-600 px-4 py-2 text-white rounded">Login</button>
    </nav>
  );
}
</FILE>`;

  const parsed = aiProtocol.parseAIResponse(rawAI);
  const validated = aiProtocol.validateFileOperations(parsed, project);
  const applied = aiProtocol.applyOperationsSafely(project, validated.files);

  const diffCheck = aiProtocol.validateMinimalDiff(
    project,
    applied.files,
    [{ path: 'src/components/Navbar.jsx' }],
    prompt
  );

  assert.strictEqual(diffCheck.valid, true);
  assert.deepStrictEqual(diffCheck.changedPaths, ['src/components/Navbar.jsx']);

  // Verify all other files are identical
  const heroBefore = project.find(f => f.path === 'src/components/Hero.jsx').content;
  const heroAfter = applied.files.find(f => f.path === 'src/components/Hero.jsx').content;
  assert.strictEqual(heroBefore, heroAfter);

  const footerBefore = project.find(f => f.path === 'src/components/Footer.jsx').content;
  const footerAfter = applied.files.find(f => f.path === 'src/components/Footer.jsx').content;
  assert.strictEqual(footerBefore, footerAfter);
});
