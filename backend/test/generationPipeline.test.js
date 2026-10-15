const test = require('node:test');
const assert = require('node:assert/strict');

test('TypeScript JSONC configuration is deferred to the installed compiler', () => {
  assert.deepEqual(validateGeneratedFiles([
    { path: 'src/App.tsx', content: 'export default function App(){return <h1>Ready</h1>}' },
    { path: 'tsconfig.app.json', content: '{ // valid TypeScript JSONC\n "compilerOptions": {"jsx":"react-jsx",},}' }
  ]), []);
});
const { validateGeneratedFiles, validateFilePaths } = require('../src/services/ai/generationPipeline');

const validProject = [
  { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^18.3.1' } }) },
  { path: 'src/App.jsx', content: "import { Header } from './Header'; export default function App() { return <Header />; }" },
  { path: 'src/Header.jsx', content: 'export function Header() { return <header>Ready</header>; }' }
];

test('accepts valid JSX, local imports, and declared dependencies', () => {
  assert.deepEqual(validateGeneratedFiles(validProject), []);
});

test('reports syntax, unresolved local import, and missing export errors', () => {
  const files = [
    { path: 'package.json', content: JSON.stringify({ dependencies: { react: '^18.3.1' } }) },
    { path: 'src/App.jsx', content: "import { Missing } from './Header'; import Chart from 'recharts'; export default function App() { return <Missing />; }" },
    { path: 'src/Header.jsx', content: 'export function Header() { return <header>Ready</header>; }' },
    { path: 'src/Other.jsx', content: "import './NotThere'; export default function Other() { return null; }" },
    { path: 'src/Broken.jsx', content: 'export default function Broken( { return null; }' },
    { path: 'src/styles.css', content: '.card { color: red;' }
  ];

  const diagnostics = validateGeneratedFiles(files);
  assert.ok(diagnostics.some((item) => item.category === 'syntax' && item.path === 'src/Broken.jsx'));
  assert.ok(diagnostics.some((item) => item.category === 'export' && item.message.includes('Missing')));
  assert.ok(diagnostics.some((item) => item.category === 'import' && item.message.includes('./NotThere')));
  assert.ok(diagnostics.some((item) => item.category === 'syntax' && item.path === 'src/styles.css'));
});

test('requires a default export from the application entry', () => {
  const diagnostics = validateGeneratedFiles([
    { path: 'src/App.jsx', content: 'export const App = () => <main />;' }
  ]);
  assert.ok(diagnostics.some((item) => item.category === 'export' && item.path === 'src/App.jsx'));
});

test('rejects a monolithic App entry over 500 lines', () => {
  const oversized = [
    'export default function App() {',
    ...Array.from({ length: 500 }, (_, index) => `  const value${index} = ${index};`),
    '  return <main>Ready</main>;',
    '}'
  ].join('\n');
  const diagnostics = validateGeneratedFiles([{ path: 'src/App.jsx', content: oversized }]);
  assert.ok(diagnostics.some((item) => item.category === 'architecture' && /src\/pages/.test(item.message)));
});

test('rejects individual generated source modules above the Babel-safe limit', () => {
  const diagnostics = validateGeneratedFiles([
    ...validProject,
    { path: 'src/pages/MediaCoveragePage.tsx', content: `export default ${JSON.stringify('x'.repeat(400 * 1024))};` }
  ]);
  assert.ok(diagnostics.some((item) => item.category === 'architecture' && item.path === 'src/pages/MediaCoveragePage.tsx' && /400 KiB/.test(item.message)));
});

test('accepts cyclic local barrels, re-exports, default aliases, and destructured exports', () => {
  const files = [
    { path: 'src/App.jsx', content: "import Component, { Header, title, second, rest, remaining, ns } from './barrel'; export { Component as default };" },
    { path: 'src/barrel.js', content: "export * from './cycle'; export { default } from './Header'; export * as ns from './Header';" },
    { path: 'src/cycle.js', content: "export * from './barrel'; export * from './values'; export { default as Header } from './Header';" },
    { path: 'src/Header.jsx', content: 'const Header = () => <header />; export { Header as default };' },
    { path: 'src/values.js', content: "export const { nested: { title = 'Ready' }, ...rest } = { nested: {} }; export const [, second, ...remaining] = [0, 1, 2];" }
  ];
  assert.deepEqual(validateGeneratedFiles(files), []);
  assert.deepEqual(validateGeneratedFiles([...files].reverse()), []);
});

test('reports missing named/default exports through local barrels and re-exports', () => {
  const diagnostics = validateGeneratedFiles([
    { path: 'src/App.jsx', content: "import Component, { Missing } from './barrel'; export default function App() { return null; }" },
    { path: 'src/barrel.js', content: "export * from './cycle'; export { Absent as Other } from './values';" },
    { path: 'src/cycle.js', content: "export * from './barrel'; export * from './values';" },
    { path: 'src/values.js', content: 'export const Present = 1; export default 2;' }
  ]);
  assert.equal(diagnostics.length, 3);
  assert.ok(diagnostics.every((item) => item.category === 'export'));
  for (const name of ['Default import', 'Missing', 'Absent']) {
    assert.ok(diagnostics.some((item) => item.message.includes(name)), name);
  }
});

test('accepts a TypeScript app, TS generics, local type exports, CSS, and JSON', () => {
  assert.deepEqual(validateGeneratedFiles([
    { path: 'package.json', content: '{}' },
    { path: 'src/App.tsx', content: "import { identity, type Props } from './types.js'; import './style.css'; import data from './data.json'; export default function App(props: Props) { return <main>{identity(props.title)}</main>; }" },
    { path: 'src/types.ts', content: "export interface Props { title: string }; export const identity = <T>(value: T): T => value;" },
    { path: 'src/style.css', content: 'main { color: red; }' },
    { path: 'src/data.json', content: '{"title":"Ready"}' }
  ]), []);
  assert.deepEqual(validateGeneratedFiles([
    { path: 'src/App.ts', content: 'export default function App(): null { return null; }' }
  ]), []);
});

test('defers aliases, package exports, and config builtins to the build without guessing', () => {
  assert.deepEqual(validateGeneratedFiles([
    { path: 'src/App.tsx', content: "import Header from '@/components/Header'; import { value } from 'custom-alias'; import x from '#internal'; import y from '/src/elsewhere'; import z from 'package/subpath'; import text from './template.txt?raw'; export default () => <Header />;" },
    { path: 'vite.config.ts', content: "import path from 'node:path'; import fs from 'fs'; import { defineConfig } from 'vite'; export default defineConfig({});" },
    { path: 'src/consumer.js', content: "import { External } from './barrel';" },
    { path: 'src/barrel.js', content: "export * from './bridge';" },
    { path: 'src/bridge.js', content: "export * from '@/external'; export * from 'some-package';" }
  ]), []);
});

test('diagnoses invalid package root shapes without crashing', () => {
  for (const content of ['null', '[]', '"package"', '42', 'true', '{']) {
    const diagnostics = validateGeneratedFiles([
      ...validProject.filter((file) => file.path !== 'package.json'),
      { path: 'package.json', content }
    ]);
    assert.equal(diagnostics.length, 1, content);
    assert.equal(diagnostics[0].category, 'dependency');
    assert.equal(diagnostics[0].path, 'package.json');
  }
});

test('diagnoses JS, JSX, TS, TSX, CSS, and JSON syntax errors', () => {
  for (const [path, content] of [
    ['src/broken.js', 'const = ;'],
    ['src/broken.jsx', 'export default () => <div>;'],
    ['src/broken.ts', 'const value: = 1;'],
    ['src/broken.tsx', 'export default () => <div>;'],
    ['src/broken.css', '.card { color: red;'],
    ['src/broken.json', '{"value":}']
  ]) {
    const diagnostics = validateGeneratedFiles([...validProject, { path, content }]);
    assert.ok(diagnostics.some((item) => item.category === 'syntax' && item.path === path), path);
  }
});

test('rejects unsafe raw paths without normalizing away traversal', () => {
  for (const path of [
    '/tmp/file.js', '//server/share/file.js', 'C:/file.js', 'C:file.js', '\\root\\file.js',
    '\\\\server\\share\\file.js', '../file.js', 'src/../file.js', 'src/./file.js', './file.js',
    'src\\..\\file.js', 'src\\file.js', 'src//file.js', 'src/', '', null, 42,
    'src/file.js:secret', '.env', '.env.local', 'src/.ENV.production', '.npmrc', 'src/.NPMRC',
    'node_modules/pkg/index.js', 'src/NODE_MODULES/pkg.js', '.git/config',
    'src/file\0.js', 'src/file\n.js', 'src/file.js.', 'src/file.js ', 'src/CON.txt', 'NUL'
  ]) {
    const files = [{ path, content: '' }];
    const snapshot = JSON.stringify(files);
    assert.ok(validateFilePaths(files).some((item) => item.category === 'path'), String(path));
    assert.deepEqual(validateGeneratedFiles([...validProject, ...files]), validateFilePaths([...validProject, ...files]));
    assert.equal(JSON.stringify(files), snapshot);
  }
});

test('rejects link representations, non-text files, duplicate paths, and file/directory conflicts', () => {
  for (const metadata of [
    { type: 'symlink' }, { kind: 'symlink' }, { symlink: '../outside' }, { isSymlink: true },
    { link: '../outside' }, { linkTarget: '../outside' }, { target: '../outside' },
    { linkname: '../outside' }, { mode: 0o120777 }, { mode: '120777' }, { content: { target: '../outside' } }
  ]) {
    assert.ok(validateFilePaths([{ path: 'src/link.js', content: '', ...metadata }]).length, JSON.stringify(metadata));
  }
  for (const files of [null, {}, [null], [{ path: 'src/a.js' }],
    [{ path: 'src/a.js', content: '' }, { path: 'src/A.js', content: '' }],
    [{ path: 'src/a.js', content: '' }, { path: 'src', content: '' }]
  ]) {
    assert.ok(validateFilePaths(files).length);
  }
});

test('allows gitignore and legitimate configuration files', () => {
  assert.deepEqual(validateFilePaths([
    '.gitignore', '.prettierrc', '.eslintrc.json', 'vite.config.ts', 'tsconfig.json',
    'package.json', 'package-lock.json', 'src/App.tsx'
  ].map((path) => ({ path, content: '' }))), []);
  assert.deepEqual(validateFilePaths([{ path: 'src/file.js', content: '', type: 'file', mode: 0o100644 }]), []);
});

test('allows projects above 300 files and enforces 6 MB of UTF-8 source before parsing', () => {
  const files = Array.from({ length: 301 }, (_, index) => ({ path: `src/file${index}.js`, content: '' }));
  assert.deepEqual(validateFilePaths(files), []);
  const content = 'a'.repeat(6 * 1024 * 1024);
  assert.deepEqual(validateFilePaths([{ path: 'large.txt', content }]), []);
  const oversized = [{ path: 'large.txt', content }, { path: 'extra.txt', content: 'x' }];
  assert.match(validateFilePaths(oversized)[0].message, /6 MB/);
  assert.deepEqual(validateGeneratedFiles(oversized), validateFilePaths(oversized));
  assert.match(validateFilePaths([{ path: 'large.txt', content: '\u00e9'.repeat(3 * 1024 * 1024 + 1) }])[0].message, /6 MB/);
});

test('accepts canonical base64 assets without parsing them as source', () => {
  const files = [...validProject,
    { path: 'public/assets/images/logo.png', content: Buffer.from('binary image bytes').toString('base64'), encoding: 'base64', language: 'binary' }
  ];
  assert.deepEqual(validateGeneratedFiles(files), []);
});
