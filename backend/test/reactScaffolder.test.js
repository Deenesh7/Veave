const test = require('node:test');
const assert = require('node:assert/strict');
const { scaffoldReactProject } = require('../src/services/project/reactScaffolder');
const { validateFilePaths } = require('../src/services/ai/generationPipeline');

test('scaffolder collapses exact and case-insensitive duplicate generated paths', () => {
  const files = scaffoldReactProject([
    { path: 'src/App.jsx', content: 'export default function App(){return null}' },
    { path: 'src/components/NavBar.jsx', content: 'export default function Old(){return null}' },
    { path: 'src/components/NavBar.jsx', content: 'export default function Current(){return null}' },
    { path: 'src/components/Navbar.jsx', content: 'export default function Final(){return null}' }
  ]);

  const navbars = files.filter((file) => file.path.toLowerCase() === 'src/components/navbar.jsx');
  assert.equal(navbars.length, 1);
  assert.match(navbars[0].content, /function Final/);
  assert.deepEqual(validateFilePaths(files), []);
});
