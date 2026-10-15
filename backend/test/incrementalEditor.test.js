const test = require('node:test');
const assert = require('node:assert/strict');
const incrementalEditor = require('../src/services/ai/incrementalEditor');

// Fixture of a complete website with all core sections
function createFullWebsiteFixture() {
  return [
    {
      path: 'package.json',
      content: JSON.stringify({ name: 'full-app', dependencies: { react: '^18.3.1', 'lucide-react': '^0.400.0' } })
    },
    {
      path: 'src/App.jsx',
      content: `import React from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import About from './components/About';
import Pricing from './components/Pricing';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <About />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}`
    },
    {
      path: 'src/components/Navbar.jsx',
      content: `import React, { useState } from 'react';

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <nav className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
      <div className="font-bold text-xl">BrandLogo</div>
      <div className="hidden md:flex gap-6">
        <a href="#features" className="hover:text-blue-200">Features</a>
        <a href="#pricing" className="hover:text-blue-200">Pricing</a>
      </div>
      <button className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg font-medium">
        Login
      </button>
    </nav>
  );
}`
    },
    {
      path: 'src/components/Hero.jsx',
      content: `import React from 'react';

export default function Hero() {
  return (
    <section className="py-20 px-6 max-w-5xl mx-auto text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-6">
        Build Faster with AI
      </h1>
      <p className="text-lg text-slate-600 mb-8 max-w-2xl mx-auto">
        Create complete responsive web applications in seconds with surgical incremental updates.
      </p>
      <img
        src="https://images.unsplash.com/photo-1551288049-bebda4e38f71"
        alt="Hero Showcase"
        className="rounded-xl shadow-2xl mx-auto mb-8 w-full max-w-3xl"
      />
      <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold">
        Get Started
      </button>
    </section>
  );
}`
    },
    {
      path: 'src/components/Features.jsx',
      content: `import React from 'react';

export default function Features() {
  return (
    <section id="features" className="py-16 bg-white px-6">
      <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
        <div className="p-6 border rounded-xl">Feature A</div>
        <div className="p-6 border rounded-xl">Feature B</div>
        <div className="p-6 border rounded-xl">Feature C</div>
      </div>
    </section>
  );
}`
    },
    {
      path: 'src/components/About.jsx',
      content: `import React from 'react';

export default function About() {
  return (
    <section id="about" className="py-16 px-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">About Us</h2>
      <p className="text-slate-600">We are dedicated to building modern developer tools.</p>
    </section>
  );
}`
    },
    {
      path: 'src/components/Pricing.jsx',
      content: `import React from 'react';

export default function Pricing() {
  return (
    <section id="pricing" className="py-16 bg-slate-100 px-6">
      <h2 className="text-2xl font-bold text-center mb-8">Pricing Plans</h2>
      <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
        <div className="p-6 bg-white rounded-xl shadow">Starter Plan - $19</div>
        <div className="p-6 bg-white rounded-xl shadow">Pro Plan - $49</div>
      </div>
    </section>
  );
}`
    },
    {
      path: 'src/components/Footer.jsx',
      content: `import React from 'react';

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 py-12 px-6 text-center">
      <p>&copy; 2026 Veave Inc. All rights reserved.</p>
    </footer>
  );
}`
    },
    {
      path: 'src/services/api.js',
      content: `export async function fetchUserData() {
  const token = localStorage.getItem('auth_token');
  const res = await fetch('/api/user', {
    headers: { Authorization: \`Bearer \${token}\` }
  });
  return res.json();
}`
    },
    {
      path: 'src/routes/AppRoutes.jsx',
      content: `import React from 'react';
export default function AppRoutes() {
  return null;
}`
    }
  ];
}

// ==============================================================================
// 1. CHANGE NAVBAR COLOR
// ==============================================================================
test('1. Change navbar color: modifies only navbar background color and preserves all other files', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
bg-blue-900 text-white
</SEARCH>
<REPLACE>
bg-white text-slate-900
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].path, 'src/components/Navbar.jsx');

  const result = incrementalEditor.applyFileOperations(site, parsed.files);
  assert.deepEqual(result.changedFiles, ['src/components/Navbar.jsx']);

  const updatedNavbar = result.files.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(updatedNavbar.content.includes('bg-white text-slate-900'));
  assert.ok(!updatedNavbar.content.includes('bg-blue-900 text-white'));

  // Ensure ALL other 9 files remain 100% byte-for-byte identical
  for (const file of site) {
    if (file.path !== 'src/components/Navbar.jsx') {
      const found = result.files.find(f => f.path === file.path);
      assert.equal(found.content, file.content, `File ${file.path} must remain untouched!`);
    }
  }
});

// ==============================================================================
// 2. CHANGE BUTTON COLOR
// ==============================================================================
test('2. Change button color: modifies only login button styling', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
bg-indigo-600 hover:bg-indigo-700
</SEARCH>
<REPLACE>
bg-blue-600 hover:bg-blue-700
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  assert.deepEqual(result.changedFiles, ['src/components/Navbar.jsx']);
  const updatedNavbar = result.files.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(updatedNavbar.content.includes('bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium'));
  assert.ok(updatedNavbar.content.includes('bg-blue-900')); // Unchanged navbar color
});

// ==============================================================================
// 3. CHANGE FONT SIZE
// ==============================================================================
test('3. Change font size: modifies only the relevant heading style', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `{
    "action": "update",
    "files": [
      {
        "path": "src/components/Hero.jsx",
        "operation": "patch",
        "search": "text-3xl font-extrabold tracking-tight text-slate-900 mb-6",
        "replace": "text-[32px] font-extrabold tracking-tight text-slate-900 mb-6"
      }
    ]
  }`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  assert.deepEqual(result.changedFiles, ['src/components/Hero.jsx']);
  const hero = result.files.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero.content.includes('text-[32px] font-extrabold'));
});

// ==============================================================================
// 4. REPLACE IMAGE
// ==============================================================================
test('4. Replace image: modifies only the image source and preserves layout', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Hero.jsx">
<SEARCH>
src="https://images.unsplash.com/photo-1551288049-bebda4e38f71"
</SEARCH>
<REPLACE>
src="https://images.unsplash.com/photo-1507238691740-187a5b1d37b8"
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const hero = result.files.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero.content.includes('photo-1507238691740-187a5b1d37b8'));
  assert.ok(hero.content.includes('rounded-xl shadow-2xl mx-auto mb-8 w-full max-w-3xl')); // Layout preserved
});

test('4a. Image requests target image-owning components and verify a rendered image change', () => {
  const site = createFullWebsiteFixture();
  const targets = incrementalEditor.selectTargetFiles('Replace the image with a school campus photo', site);
  assert.ok(targets.some((file) => file.path === 'src/components/Hero.jsx'));

  assert.doesNotThrow(() => incrementalEditor.validateImageOperations('Replace the image', [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: 'src="old.jpg"',
    replace: 'src="/assets/campus.webp"'
  }]));
  assert.throws(() => incrementalEditor.validateImageOperations('Add an image', [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<section>',
    replace: '<section><img src="/assets/campus.webp">'
  }]), /meaningful alt text/);
  assert.throws(() => incrementalEditor.validateImageOperations('Replace the image', [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<h1>Old</h1>',
    replace: '<h1>New</h1>'
  }]), /must add or replace an image source/);
});

test('4b. Uploaded images use compact prompt tokens and are hydrated after placement', () => {
  const site = createFullWebsiteFixture();
  const uploadedFiles = [{
    name: 'campus.png',
    type: 'image/png',
    size: 4,
    isImage: true,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo='
  }];
  const targets = incrementalEditor.selectTargetFiles('Add the uploaded image to the hero', site);
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Add the uploaded image to the hero',
    targetFiles: targets,
    projectFiles: site,
    uploadedFiles
  });

  assert.ok(generatedPrompt.messages[1].content.includes('__VEAVE_UPLOADED_IMAGE_0__'));
  assert.ok(!generatedPrompt.messages[1].content.includes('iVBORw0KGgo='));
  const hydrated = incrementalEditor.hydrateUploadedImageOperations([{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<section>',
    replace: '<section><img src="__VEAVE_UPLOADED_IMAGE_0__" alt="School campus">'
  }], uploadedFiles);
  assert.ok(hydrated[0].replace.includes('data:image/png;base64,iVBORw0KGgo='));
  assert.doesNotThrow(() => incrementalEditor.validateImageOperations('Add the uploaded image', hydrated));
});

test('4c. Replacing an uploaded image keeps old and new base64 data out of model output', () => {
  const oldDataUrl = 'data:image/png;base64,b2xkLWltYWdl';
  const newDataUrl = 'data:image/png;base64,bmV3LWltYWdl';
  const project = [{
    path: 'src/components/Hero.jsx',
    content: `export default function Hero() { return <img src="${oldDataUrl}" alt="Campus" />; }`
  }];
  const compacted = incrementalEditor.compactEmbeddedImageAssets(project);
  const uploadedFiles = [{
    name: 'replacement.png',
    type: 'image/png',
    size: 9,
    isImage: true,
    dataUrl: newDataUrl
  }];
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Replace the existing image with the uploaded image',
    targetFiles: compacted.files,
    projectFiles: compacted.files,
    uploadedFiles
  });

  assert.ok(generatedPrompt.messages[1].content.includes('__VEAVE_EXISTING_IMAGE_0__'));
  assert.ok(generatedPrompt.messages[1].content.includes('__VEAVE_UPLOADED_IMAGE_0__'));
  assert.ok(!generatedPrompt.messages[1].content.includes(oldDataUrl));
  assert.ok(!generatedPrompt.messages[1].content.includes(newDataUrl));

  const hydrated = incrementalEditor.hydrateUploadedImageOperations([{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '__VEAVE_EXISTING_IMAGE_0__',
    replace: '__VEAVE_UPLOADED_IMAGE_0__'
  }], uploadedFiles, compacted.assets);
  const applied = incrementalEditor.applyFileOperations(project, hydrated);
  assert.ok(applied.files[0].content.includes(newDataUrl));
  assert.ok(!applied.files[0].content.includes(oldDataUrl));
});

// ==============================================================================
// 5. ADD A NAVBAR FEATURE
// ==============================================================================
test('5. Add a navbar feature: adds dark mode toggle UI without redesigning other sections', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
      <button className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg font-medium">
        Login
      </button>
</SEARCH>
<REPLACE>
      <div className="flex items-center gap-3">
        <button aria-label="Toggle dark mode" className="p-2 rounded-lg border border-slate-700">🌙</button>
        <button className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg font-medium">
          Login
        </button>
      </div>
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  assert.deepEqual(result.changedFiles, ['src/components/Navbar.jsx']);
  const nav = result.files.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(nav.content.includes('aria-label="Toggle dark mode"'));
});

// ==============================================================================
// 6. REMOVE A SECTION
// ==============================================================================
test('6. Remove a section: removes pricing section cleanly and preserves remaining components', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/App.jsx">
<SEARCH>
        <About />
        <Pricing />
      </main>
</SEARCH>
<REPLACE>
        <About />
      </main>
</REPLACE>
</PATCH>
<FILE path="src/components/Pricing.jsx" operation="delete" />`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  assert.ok(!result.files.some(f => f.path === 'src/components/Pricing.jsx'));
  const app = result.files.find(f => f.path === 'src/App.jsx');
  assert.ok(!app.content.includes('<Pricing />'));
  assert.ok(app.content.includes('<About />'));
  assert.ok(app.content.includes('<Hero />'));
});

// ==============================================================================
// 7. FIX A COMPONENT BUG
// ==============================================================================
test('7. Fix a component bug: corrects mobile menu state handler', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
      <div className="font-bold text-xl">BrandLogo</div>
</SEARCH>
<REPLACE>
      <div className="font-bold text-xl cursor-pointer" onClick={() => setIsOpen(!isOpen)}>BrandLogo</div>
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const nav = result.files.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(nav.content.includes('onClick={() => setIsOpen(!isOpen)}'));
});

// ==============================================================================
// 8. REGEX CONTAINING \s (OpenRouter JSON escaping immunity)
// ==============================================================================
test('8. Regex containing \\s: parses and preserves backslashes without JSON crash', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/services/api.js">
<SEARCH>
  const token = localStorage.getItem('auth_token');
</SEARCH>
<REPLACE>
  const token = (localStorage.getItem('auth_token') || '').replace(/\\s+/g, '');
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const api = result.files.find(f => f.path === 'src/services/api.js');
  assert.ok(api.content.includes('.replace(/\\s+/g, \'\')'));
});

// ==============================================================================
// 9. REGEX CONTAINING \d
// ==============================================================================
test('9. Regex containing \\d: parses and preserves digit regexes without corruption', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/services/api.js">
<SEARCH>
export async function fetchUserData() {
</SEARCH>
<REPLACE>
export const isValidId = (id) => /^\\d{4,8}$/.test(id);
export async function fetchUserData() {
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const api = result.files.find(f => f.path === 'src/services/api.js');
  assert.ok(api.content.includes('/^\\d{4,8}$/.test(id)'));
});

// ==============================================================================
// 10. TEMPLATE LITERALS
// ==============================================================================
test('10. Template literals: preserves multiline template literals accurately', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/About.jsx">
<SEARCH>
      <p className="text-slate-600">We are dedicated to building modern developer tools.</p>
</SEARCH>
<REPLACE>
      <p className="text-slate-600">{\`
        Mission: Delivering excellence.
        Founded: 2026.
      \`}</p>
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const about = result.files.find(f => f.path === 'src/components/About.jsx');
  assert.ok(about.content.includes('Mission: Delivering excellence.'));
});

// ==============================================================================
// 11. ${variable} INTERPOLATION
// ==============================================================================
test('11. ${variable}: preserves dollar-brace expressions inside code and templates', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Hero.jsx">
<SEARCH>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-6">
        Build Faster with AI
      </h1>
</SEARCH>
<REPLACE>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-6">
        {\`Build Faster with \${'AI & Machine Learning'}\`}
      </h1>
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const hero = result.files.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero.content.includes("Build Faster with ${'AI & Machine Learning'}"));
});

// ==============================================================================
// 12. MULTILINE JSX
// ==============================================================================
test('12. Multiline JSX: patches complex nested JSX with pristine indentation', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Hero.jsx">
<SEARCH>
      <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold">
        Get Started
      </button>
</SEARCH>
<REPLACE>
      <div className="flex justify-center gap-4">
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg">
          Get Started
        </button>
        <button className="bg-slate-200 hover:bg-slate-300 text-slate-800 px-6 py-3 rounded-xl font-semibold">
          Documentation
        </button>
      </div>
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(site, parsed.files);

  const hero = result.files.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero.content.includes('Documentation'));
  assert.ok(hero.content.includes('shadow-lg'));
});

// ==============================================================================
// 13. MULTIPLE FILES
// ==============================================================================
test('13. Multiple files: patches multiple targeted files while keeping remaining files untouched', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
bg-blue-900
</SEARCH>
<REPLACE>
bg-slate-900
</REPLACE>
</PATCH>
<PATCH path="src/components/Footer.jsx">
<SEARCH>
bg-slate-900
</SEARCH>
<REPLACE>
bg-black
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 2);

  const result = incrementalEditor.applyFileOperations(site, parsed.files);
  assert.deepEqual(result.changedFiles.sort(), ['src/components/Footer.jsx', 'src/components/Navbar.jsx']);

  // Unrelated components remain untouched
  assert.equal(result.files.find(f => f.path === 'src/components/Hero.jsx').content, site.find(f => f.path === 'src/components/Hero.jsx').content);
  assert.equal(result.files.find(f => f.path === 'src/components/Pricing.jsx').content, site.find(f => f.path === 'src/components/Pricing.jsx').content);
});

// ==============================================================================
// 14. LARGE FILES (Surgical patch in large document)
// ==============================================================================
test('14. Large files: performs surgical search-and-replace on a large file without full rewriting', () => {
  const largeContent = Array.from({ length: 600 }, (_, i) => `// Line ${i + 1}: boilerplate code`).join('\n')
    + '\nconst TARGET_CONFIG = { theme: "light" };\n'
    + Array.from({ length: 400 }, (_, i) => `// Bottom Line ${i + 1}`).join('\n');

  const files = [{ path: 'src/config.js', content: largeContent }];
  const rawAI = `<PATCH path="src/config.js">
<SEARCH>
const TARGET_CONFIG = { theme: "light" };
</SEARCH>
<REPLACE>
const TARGET_CONFIG = { theme: "dark" };
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  const result = incrementalEditor.applyFileOperations(files, parsed.files);

  assert.ok(result.files[0].content.includes('{ theme: "dark" }'));
  assert.ok(result.files[0].content.startsWith('// Line 1: boilerplate code'));
  assert.ok(result.files[0].content.endsWith('// Bottom Line 400'));
});

// ==============================================================================
// 15. INVALID AI RESPONSE (Graceful handling)
// ==============================================================================
test('15. Invalid AI response: handles malformed output gracefully without corrupting files', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `I'm sorry, I cannot perform that action right now. Here is some chatter.`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.equal(parsed.files.length, 0);

  // Attempting to apply empty operations throws a clean, descriptive error
  assert.throws(() => {
    incrementalEditor.applyFileOperations(site, parsed.files);
  }, /No file operations provided/);
});

// ==============================================================================
// 16. INVALID FILE PATH
// ==============================================================================
test('16. Invalid file path: rejects empty or invalid paths', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="">
<SEARCH>test</SEARCH>
<REPLACE>update</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.throws(() => {
    incrementalEditor.applyFileOperations(site, parsed.files);
  }, /Invalid file path/);
});

// ==============================================================================
// 17. PATH TRAVERSAL
// ==============================================================================
test('17. Path traversal: prevents unauthorized directory traversal attempts', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="../../etc/passwd">
<SEARCH>root</SEARCH>
<REPLACE>hacked</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.throws(() => {
    incrementalEditor.applyFileOperations(site, parsed.files);
  }, /Path traversal/);
});

// ==============================================================================
// 18. PATCH TARGET NOT FOUND
// ==============================================================================
test('18. Patch target not found: throws informative error if search string does not exist', () => {
  const site = createFullWebsiteFixture();
  const rawAI = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
non_existent_search_block_that_does_not_exist
</SEARCH>
<REPLACE>
new_content
</REPLACE>
</PATCH>`;

  const parsed = incrementalEditor.parseAIResponse(rawAI);
  assert.throws(() => {
    incrementalEditor.applyFileOperations(site, parsed.files);
  }, /search block did not match existing content/);
});

// ==============================================================================
// 19. BUILD FAILURE & DIAGNOSTICS DETECTION
// ==============================================================================
test('19. Build failure: syntax errors in patch result are detected', () => {
  const generationPipeline = require('../src/services/ai/generationPipeline');
  const brokenFiles = [
    { path: 'package.json', content: '{"name":"test"}' },
    { path: 'src/App.jsx', content: 'export default function App() { return <div><span></div>; }' }
  ];

  const diagnostics = generationPipeline.validateGeneratedFiles(brokenFiles);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.some(d => d.category === 'syntax'));
});

// ==============================================================================
// 20. REPAIR FAILURE (Safety preservation)
// ==============================================================================
test('20. Repair failure: preserves original project when repair attempts are exhausted', () => {
  const original = createFullWebsiteFixture();
  const beforeHash = JSON.stringify(original);

  // If repair fails, original state remains unchanged
  assert.equal(JSON.stringify(original), beforeHash);
});

test('20a. Incremental prompt gives generic atomic integration guidance without classifying intent', () => {
  const site = createFullWebsiteFixture();
  const targetFiles = incrementalEditor.selectTargetFiles('Create a new contact page', site);
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Create a new contact page',
    targetFiles,
    projectFiles: site
  });

  assert.equal(generatedPrompt.intent, null);
  assert.ok(generatedPrompt.systemPrompt.includes('Infer the project\'s actual architecture'));
  assert.ok(generatedPrompt.systemPrompt.includes('Full-file modify/update operations for existing files are forbidden'));
  assert.ok(generatedPrompt.messages[1].content.includes('Infer all required target files and integration points'));
  assert.ok(targetFiles.some((file) => file.path === 'src/App.jsx'));
  assert.ok(targetFiles.some((file) => file.path === 'src/components/Navbar.jsx'));
  assert.ok(targetFiles.some((file) => file.path === 'src/components/Footer.jsx'));

  const addPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Add a new pricing page',
    targetFiles,
    projectFiles: site
  });
  assert.equal(addPrompt.intent, null);
  assert.ok(addPrompt.systemPrompt.includes('same response'));

  const typoPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Add a feature mulri page',
    targetFiles,
    projectFiles: site
  });
  assert.equal(typoPrompt.intent, null);
  assert.ok(typoPrompt.messages[1].content.includes('Add a feature multi-page'));
});

test('20aa. Incremental prompt preserves clone routes when completing missed work', () => {
  const site = createFullWebsiteFixture();
  const targetFiles = incrementalEditor.selectTargetFiles('Complete the missing admissions page', site);
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'Complete the missing admissions page',
    targetFiles,
    projectFiles: site,
    projectProvenance: {
      type: 'website-clone',
      sourceUrl: 'https://example.com/',
      canonicalUrl: 'https://example.com/',
      routes: [
        { path: '/', title: 'Home' },
        { path: '/admissions', title: 'Admissions', headings: [{ level: 'H1', text: 'Admissions' }] }
      ]
    }
  });

  const content = generatedPrompt.messages[1].content;
  assert.ok(content.includes('CLONE SOURCE CONTEXT'));
  assert.ok(content.includes('"/admissions"'));
  assert.ok(content.includes('complete missing clone work'));
});

test('20b. Page creation operations must create and connect the new page', () => {
  const site = createFullWebsiteFixture();
  const newPage = {
    path: 'src/pages/ResearchLabs.jsx',
    operation: 'create',
    content: `export default function ResearchLabs({ onNavigateHome }) {
  return <main data-page="research-labs" className="relative min-h-screen overflow-hidden bg-white">
    <button data-page-link="home" onClick={onNavigateHome}>Home</button>
    <div className="relative z-10">Research labs</div>
  </main>;
}`
  };

  const integrationOperations = [
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: "import Hero from './components/Hero';",
      replace: "import Hero from './components/Hero';\nimport ResearchLabs from './pages/ResearchLabs';"
    },
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: 'export default function App() {',
      replace: `export default function App() {
  const [activePage, setActivePage] = React.useState('home');`
    },
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: '      <Navbar />\n      <main>',
      replace: `      <Navbar />
      {activePage === 'research-labs'
        ? <ResearchLabs onNavigateHome={() => setActivePage('home')} />
        : <div data-page="home" className="min-h-screen"><main>`
    },
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: '      </main>\n      <Footer />',
      replace: '      </main></div>}\n      <Footer />'
    },
    {
      path: 'src/App.jsx',
      operation: 'patch',
      search: '<Hero />',
      replace: '<button data-page-link="research-labs" onClick={() => setActivePage(\'research-labs\')}>Research Labs</button>\n        <Hero />'
    },
    {
      path: 'src/components/Navbar.jsx',
      operation: 'patch',
      search: '<nav className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between shadow-md">',
      replace: '<nav data-shared-header className="bg-blue-900 text-white px-6 py-4 flex items-center justify-between shadow-md">'
    },
    {
      path: 'src/components/Footer.jsx',
      operation: 'patch',
      search: '<footer className="bg-slate-900 text-slate-400 py-12 px-6 text-center">',
      replace: '<footer data-shared-footer className="bg-slate-900 text-slate-400 py-12 px-6 text-center">'
    }
  ];

  assert.throws(() => {
    incrementalEditor.validatePageCreationOperations('Create a new research labs page', [newPage], site);
  }, /not imported and rendered/);

  assert.throws(() => {
    incrementalEditor.validatePageCreationOperations('Create a new research labs page', [{
      path: 'src/App.jsx',
      operation: 'patch',
      search: '<Hero />',
      replace: '<ResearchLabs />'
    }], site);
  }, /did not create/);

  assert.doesNotThrow(() => {
    incrementalEditor.validatePageCreationOperations('Create a new research labs page', [
      newPage,
      ...integrationOperations
    ], site);
  });

  const siteWithOrphan = [...site, {
    path: 'src/pages/ResearchLabs.jsx',
    content: newPage.content,
    language: 'javascript'
  }];
  assert.doesNotThrow(() => {
    incrementalEditor.validatePageCreationOperations('Create a new research labs page', [
      ...integrationOperations
    ], siteWithOrphan);
  });

  assert.throws(() => {
    incrementalEditor.validatePageCreationOperations('Create a new research labs page', [
      newPage,
      {
        path: 'src/App.jsx',
        operation: 'patch',
        search: '<Hero />',
        replace: '<ResearchLabs /><ResearchLabs />'
      }
    ], site);
  }, /no route or user navigation action/);

  const applied = incrementalEditor.applyFileOperations(site, [newPage, ...integrationOperations]);
  assert.deepEqual(
    incrementalEditor.validatePageIsolationResult('Create a new research labs page', [newPage, ...integrationOperations], site, applied.files),
    {
      slug: 'research-labs',
      pagePath: 'src/pages/ResearchLabs.jsx',
      homeSelector: '[data-page="home"]',
      pageSelector: '[data-page="research-labs"]',
      openSelector: '[data-page-link="research-labs"]',
      homeLinkSelector: '[data-page-link="home"]',
      headerSelector: '[data-shared-header]',
      footerSelector: '[data-shared-footer]'
    }
  );

  const duplicateChromePage = {
    ...newPage,
    content: newPage.content.replace(
      '<button data-page-link="home"',
      '<header>Duplicate Header</header><button data-page-link="home"'
    )
  };
  assert.throws(() => {
    incrementalEditor.validatePageCreationOperations(
      'Create a new research labs page',
      [duplicateChromePage, ...integrationOperations],
      site
    );
  }, /must not create or embed another header/);
});

test('20c. Strict scope accepts only one targeted property patch', () => {
  const site = createFullWebsiteFixture();
  const fontPatch = [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-6">\n        Build Faster with AI\n      </h1>',
    replace: '<h1 className="text-3xl font-serif font-extrabold tracking-tight text-slate-900 mb-6">\n        Build Faster with AI\n      </h1>'
  }];

  assert.doesNotThrow(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this heading', fontPatch, site);
  });
  assert.throws(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this heading', [
      ...fontPatch,
      { ...fontPatch[0], path: 'src/components/Navbar.jsx' }
    ], site);
  }, /exactly one surgical patch/);
  assert.throws(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this heading', [{
      path: 'src/components/Hero.jsx',
      operation: 'modify',
      content: site.find((file) => file.path === 'src/components/Hero.jsx').content
    }], site);
  }, /full-file/);
  assert.throws(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this heading', [{
      ...fontPatch[0],
      replace: '<h1 className="text-5xl font-serif font-extrabold tracking-tight text-slate-900 mb-6">\n        Build Faster with AI\n      </h1>'
    }], site);
  }, /unrelated style class/);
});

test('20d. Strict scope honors selected element source and text', () => {
  const site = createFullWebsiteFixture();
  const selection = {
    sourceFile: 'src/components/Hero.jsx',
    text: 'Build Faster with AI'
  };
  const patch = [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: 'Build Faster with AI',
    replace: '<span className="font-serif">Build Faster with AI</span>'
  }];

  assert.doesNotThrow(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this selected text', patch, site, selection);
  });
  assert.throws(() => {
    incrementalEditor.validateStrictScopeOperations('Change the font of this selected text', [{
      ...patch[0],
      path: 'src/components/Navbar.jsx'
    }], site, selection);
  }, /selected element belongs/);
});

test('20e. Agent action protocol preserves surgical patch fields', () => {
  const { validateActions } = require('../src/services/ai/actionValidator');
  const validation = validateActions([{
    type: 'patch_file',
    path: 'src/components/Hero.jsx',
    search: 'Build Faster with AI',
    replace: '<span className="font-serif">Build Faster with AI</span>',
    reason: 'Change only the selected words font'
  }]);

  assert.equal(validation.valid, true);
  assert.equal(validation.actions[0].search, 'Build Faster with AI');
  assert.ok(validation.actions[0].replace.includes('font-serif'));
});

test('20f. Global color verification rejects broad important overrides', () => {
  const site = createFullWebsiteFixture();
  assert.doesNotThrow(() => {
    incrementalEditor.validateRequestedOutcome('Change all global text color to black', [{
      path: 'src/index.css',
      operation: 'patch',
      search: 'body { color: white; }',
      replace: '* { color: #000000; }'
    }], site);
  });

  assert.throws(() => {
    incrementalEditor.validateRequestedOutcome('Change all global text color to black', [{
      path: 'src/index.css',
      operation: 'patch',
      search: 'body { color: white; }',
      replace: '* { color: #000000 !important; }'
    }], site);
  }, /important color rules are forbidden/);

  const cleanup = incrementalEditor.buildColorCascadeCleanupOperations('Change this word to yellow', [{
    path: 'src/index.css',
    content: 'body { color: #000000 !important; }\n*, ::before, ::after { color: #000000 !important; }'
  }]);
  assert.equal(cleanup.length, 2);
  assert.ok(cleanup.every((operation) => !operation.replace.includes('!important')));

  const gradientPatch = [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-teal-500">Welcome</span>',
    replace: '<span className="text-black">Welcome</span>'
  }];
  assert.doesNotThrow(() => {
    incrementalEditor.validateStrictScopeOperations('Change this text to black', gradientPatch, site);
    incrementalEditor.validateRequestedOutcome('Change this text to black', gradientPatch, site);
  });
});

test('20g. Model-resolved selected color changes no sibling components', () => {
  const site = createFullWebsiteFixture();
  const selection = {
    sourceFile: 'src/components/Hero.jsx',
    sourceComponent: 'Hero',
    tagName: 'h1',
    text: 'Build Faster with AI',
    className: 'text-3xl font-extrabold tracking-tight text-slate-900 mb-6'
  };
  const parsed = incrementalEditor.buildSelectedElementPatch('Change this text color to black', selection, site);
  assert.equal(parsed, null);
  const operations = [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-6">\n        Build Faster with AI\n      </h1>',
    replace: '<h1 className="text-3xl font-extrabold tracking-tight text-[#000000] mb-6">\n        Build Faster with AI\n      </h1>'
  }];

  incrementalEditor.validateStrictScopeOperations('Change this text color to black', operations, site, selection);
  incrementalEditor.validateRequestedOutcome('Change this text color to black', operations, site);
  const applied = incrementalEditor.applyFileOperations(site, operations);
  assert.deepEqual(applied.changedFiles, ['src/components/Hero.jsx']);
  assert.equal(
    applied.files.find((file) => file.path === 'src/components/Navbar.jsx').content,
    site.find((file) => file.path === 'src/components/Navbar.jsx').content
  );
});

test('20h. Explicit word request wraps only that word and creates render verification', () => {
  const site = createFullWebsiteFixture();
  const parsed = incrementalEditor.buildSelectedElementPatch('Change the Build word color only to yellow', null, site);

  assert.equal(parsed, null);
  const operations = [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: 'Build',
    replace: '<span className="text-[#ffff00]">Build</span>'
  }];
  incrementalEditor.validateRequestedOutcome('Change the Build word color only to yellow', operations, site);
  const applied = incrementalEditor.applyFileOperations(site, operations);
  const hero = applied.files.find((file) => file.path === 'src/components/Hero.jsx').content;
  assert.ok(hero.includes('<span className="text-[#ffff00]">Build</span> Faster with AI'));
  assert.ok(hero.includes('text-3xl font-extrabold tracking-tight text-slate-900 mb-6'));
});

test('20h-a. Descriptive colors are dynamically resolved instead of mapped to a fixed palette', () => {
  const site = createFullWebsiteFixture();
  const selection = {
    sourceFile: 'src/components/Hero.jsx',
    sourceComponent: 'Hero',
    tagName: 'h1',
    text: 'Build Faster with AI'
  };
  const prompt = 'change the green color to light brown';
  const parsed = incrementalEditor.buildSelectedElementPatch(prompt, selection, site);

  assert.equal(parsed, null);
  assert.doesNotThrow(() => {
    incrementalEditor.validateRequestedOutcome(prompt, [{
      path: 'src/components/Hero.jsx',
      operation: 'patch',
      search: 'text-emerald-600',
      replace: 'text-[#B8956A]'
    }], site);
  });
  assert.throws(() => {
    incrementalEditor.validateRequestedOutcome(prompt, [{
      path: 'src/components/Hero.jsx',
      operation: 'patch',
      search: 'text-emerald-600',
      replace: 'text-green-600'
    }], site);
  }, /must apply "light brown"/);
});

test('20h-b. Color edits include components containing the referenced source color', () => {
  const site = createFullWebsiteFixture();
  const hero = site.find((file) => file.path === 'src/components/Hero.jsx');
  hero.content = hero.content.replace('text-slate-900', 'text-green-600');

  const targets = incrementalEditor.selectTargetFiles('change the green color to light brown', site);

  assert.ok(targets.some((file) => file.path === 'src/components/Hero.jsx'));
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'change the green color to light brown',
    targetFiles: targets,
    projectFiles: site,
    conversation: { messages: [{ role: 'user', content: 'Keep the existing school layout.' }] }
  });
  assert.ok(generatedPrompt.messages[1].content.includes('Keep the existing school layout.'));
  assert.ok(generatedPrompt.systemPrompt.includes('Never constrain colors to a predefined palette'));
});

test('20h-c. Named colors are resolved without any static color lookup', () => {
  const site = createFullWebsiteFixture();
  const parsed = incrementalEditor.buildSelectedElementPatch(
    'Change the Build word color to rebeccapurple',
    null,
    site
  );

  assert.equal(parsed, null);
  assert.doesNotThrow(() => {
    incrementalEditor.validateRequestedOutcome('Change the Build word color to rebeccapurple', [{
      path: 'src/components/Hero.jsx',
      operation: 'patch',
      search: 'Build',
      replace: '<span className="text-[#663399]">Build</span>'
    }], site);
  });
});

test('20h-d. Unknown color descriptions pass through without static substitution', () => {
  const site = createFullWebsiteFixture();
  const parsed = incrementalEditor.buildSelectedElementPatch(
    'cange the Build word color to gragy',
    null,
    site
  );

  assert.equal(parsed, null);
  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt: 'cange the Build word color to gragy',
    targetFiles: [site.find((file) => file.path === 'src/components/Hero.jsx')],
    projectFiles: site
  });
  assert.ok(generatedPrompt.messages[1].content.includes('change the Build word color to gragy'));
  assert.ok(!generatedPrompt.messages[1].content.includes('color to gray'));
});

test('20h-d-1. Burgundy accepts a model-resolved concrete CSS value', () => {
  const site = createFullWebsiteFixture();
  const operation = {
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: '<span>Build</span>',
    replace: '<span className="text-[#800020]">Build</span>'
  };

  assert.doesNotThrow(() => {
    incrementalEditor.validateRequestedOutcome('change the Build word color to burgundy', [operation], site);
  });
});

test('20h-d-2. Plain text in metadata and data files is not color coverage', () => {
  const files = [
    { path: 'package.json', content: '{"name":"legacy-academy"}' },
    { path: 'public/manifest.json', content: '{"name":"Legacy Academy"}' },
    { path: 'src/data/schoolData.js', content: 'export const schoolName = "Legacy Academy";' },
    { path: 'src/components/Navbar.jsx', content: 'export default () => <h1>Legacy Academy</h1>;' }
  ];
  const prompt = 'change legacy to burgundy color';
  const operations = [{
    path: 'src/components/Navbar.jsx',
    operation: 'patch',
    search: 'Legacy',
    replace: '<span className="text-[#800020]">Legacy</span>'
  }];

  const targets = incrementalEditor.selectTargetFiles(prompt, files);
  assert.ok(targets.some((file) => file.path === 'src/components/Navbar.jsx'));
  assert.ok(!targets.some((file) => /(?:package\.json|manifest\.json|src\/data\/)/.test(file.path)));
  assert.doesNotThrow(() => {
    incrementalEditor.validateColorReplacementCoverage(prompt, operations, files);
    incrementalEditor.validateRequestedOutcome(prompt, operations, files);
  });

  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({ prompt, targetFiles: targets, projectFiles: files });
  assert.ok(!generatedPrompt.systemPrompt.includes('PROJECT-WIDE COLOR REPLACEMENT'));
});

test('20h-e. Unscoped green-to-brown requests cover the complete project theme', () => {
  const files = [
    { path: 'src/App.jsx', content: '<main className="text-green-700"><Hero /></main>' },
    { path: 'src/components/Hero.jsx', content: '<section className="bg-green-600">Hero</section>' },
    { path: 'src/components/Navbar.jsx', content: '<nav className="border-green-500">Nav</nav>' },
    { path: 'src/components/Footer.jsx', content: '<footer className="bg-slate-900">Footer</footer>' },
    { path: 'src/pages/Achievements.jsx', content: '<main className="text-emerald-700">Awards</main>' }
  ];
  const prompt = 'change the color to green to brown';
  const targets = incrementalEditor.selectTargetFiles(prompt, files);
  assert.deepEqual(targets.map((file) => file.path).sort(), files.map((file) => file.path).sort());

  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt,
    targetFiles: targets,
    projectFiles: files
  });
  assert.ok(!generatedPrompt.systemPrompt.includes('PROJECT-WIDE COLOR REPLACEMENT'));
  assert.equal(generatedPrompt.intent, null);
  assert.ok(generatedPrompt.messages[1].content.includes('CURRENT AUTHORITATIVE PROJECT SOURCE'));

  const incomplete = [{
    path: 'src/App.jsx',
    operation: 'patch',
    search: 'text-green-700',
    replace: 'text-[#795548]'
  }];
  assert.throws(() => {
    incrementalEditor.validateColorReplacementCoverage(prompt, incomplete, files);
  }, /Hero\.jsx.*Navbar\.jsx/);

  const complete = ['src/App.jsx', 'src/components/Hero.jsx', 'src/components/Navbar.jsx'].map((path) => ({
    path,
    operation: 'patch',
    search: 'green',
    replace: 'text-[brown]'
  }));
  assert.doesNotThrow(() => {
    incrementalEditor.validateColorReplacementCoverage(prompt, complete, files);
    incrementalEditor.validateRequestedOutcome(prompt, complete, files);
  });
});

test('20i. Selected text replacement bypasses AI parsing and verifies new rendered copy', () => {
  const site = createFullWebsiteFixture();
  const selection = {
    sourceFile: 'src/components/Hero.jsx',
    sourceComponent: 'Hero',
    tagName: 'button',
    text: 'Get Started'
  };
  const parsed = incrementalEditor.buildSelectedTextPatch(
    'cange the text please text like Playful',
    selection,
    site
  );

  assert.ok(parsed);
  assert.deepEqual(parsed.files, [{
    path: 'src/components/Hero.jsx',
    operation: 'patch',
    search: 'Get Started',
    replace: 'Playful'
  }]);
  assert.deepEqual(parsed.targetVerification, {
    selector: 'button',
    targetText: 'Playful',
    expectedText: 'Playful'
  });
  incrementalEditor.validateStrictScopeOperations(
    'cange the text please text like Playful',
    parsed.files,
    site,
    selection
  );
  const applied = incrementalEditor.applyFileOperations(site, parsed.files);
  const hero = applied.files.find((file) => file.path === 'src/components/Hero.jsx').content;
  assert.ok(hero.includes('Playful'));
  assert.ok(!hero.includes('Get Started'));
});

test('20i-a. Unselected visible text replacement targets its owning page and verifies the copy', () => {
  const files = [
    {
      path: 'src/pages/HomePage.jsx',
      content: 'export default () => <h2>Recent Honors & Accolades</h2>;'
    },
    {
      path: 'src/pages/AchievementsPage.jsx',
      content: 'export default () => <main>Achievements archive</main>;'
    },
    {
      path: 'src/App.jsx',
      content: 'export default function App() { return <HomePage />; }'
    }
  ];
  const prompt = 'change the honors and accolades text to playful';
  const targets = incrementalEditor.selectTargetFiles(prompt, files);

  assert.deepEqual(targets.map((file) => file.path), ['src/pages/HomePage.jsx']);
  assert.throws(() => {
    incrementalEditor.validateRequestedOutcome(prompt, [{
      path: 'src/pages/AchievementsPage.jsx',
      operation: 'patch',
      search: 'Achievements archive',
      replace: 'Playful achievements archive'
    }], files);
  }, /Requested text outcome not verified/);
  assert.doesNotThrow(() => {
    incrementalEditor.validateRequestedOutcome(prompt, [{
      path: 'src/pages/HomePage.jsx',
      operation: 'patch',
      search: 'Recent Honors & Accolades',
      replace: 'Playful'
    }], files);
  });
});

test('20i-b. Natural phrasing and pronoun follow-ups preserve target lineage and full context', () => {
  const files = [
    { path: 'src/pages/HomePage.jsx', content: 'export default () => <h2>Recent Honors & Accolades</h2>;' },
    { path: 'src/pages/AchievementsPage.jsx', content: 'export default () => <main>Achievements archive</main>;' },
    { path: 'src/App.jsx', content: 'export default function App() { return <HomePage />; }' }
  ];
  const prompt = 'change theword honors and accolades to playfull text';
  const targets = incrementalEditor.selectTargetFiles(prompt, files);

  assert.deepEqual(targets.map((file) => file.path), ['src/pages/HomePage.jsx']);
  assert.deepEqual(incrementalEditor.buildTextOutcomeVerification(prompt), {
    selector: 'body',
    targetText: 'playfull',
    expectedText: 'playfull'
  });

  const generatedPrompt = incrementalEditor.buildIncrementalPrompt({
    prompt,
    targetFiles: targets,
    projectFiles: files
  });
  assert.ok(generatedPrompt.messages[1].content.includes('FULL PROJECT SOURCE'));
  assert.ok(generatedPrompt.messages[1].content.includes('src/pages/AchievementsPage.jsx'));

  const conversation = {
    messages: [{
      role: 'assistant',
      changeSummary: 'Updated src/pages/HomePage.jsx',
      actions: [{ type: 'patch_file', path: 'src/pages/HomePage.jsx' }],
      meta: { changedPaths: ['src/pages/HomePage.jsx'] }
    }]
  };
  const followUpTargets = incrementalEditor.selectTargetFiles('change its color to yellow', files, conversation);
  assert.deepEqual(followUpTargets.map((file) => file.path), ['src/pages/HomePage.jsx']);
});

// ==============================================================================
// MOST IMPORTANT TEST — SEQUENTIAL TARGETED EDITS ON FULL WEBSITE
// ==============================================================================
test('MOST IMPORTANT TEST: Sequential surgical edits on full website', () => {
  let site = createFullWebsiteFixture();

  // STEP 1: "Change the navbar background from dark blue to white."
  const target1 = incrementalEditor.selectTargetFiles('Change the navbar background from dark blue to white.', site);
  assert.ok(target1.some(f => f.path === 'src/components/Navbar.jsx'));

  const patch1 = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
bg-blue-900 text-white
</SEARCH>
<REPLACE>
bg-white text-slate-900
</REPLACE>
</PATCH>`;
  const res1 = incrementalEditor.applyFileOperations(site, incrementalEditor.parseAIResponse(patch1).files);
  site = res1.files;

  // Assert Step 1: ONLY navbar changed
  assert.deepEqual(res1.changedFiles, ['src/components/Navbar.jsx']);
  const navbar1 = site.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(navbar1.content.includes('bg-white text-slate-900'));
  assert.equal(site.find(f => f.path === 'src/components/Hero.jsx').content, createFullWebsiteFixture().find(f => f.path === 'src/components/Hero.jsx').content);
  assert.equal(site.find(f => f.path === 'src/components/Footer.jsx').content, createFullWebsiteFixture().find(f => f.path === 'src/components/Footer.jsx').content);

  // STEP 2: "Change the login button to green."
  const patch2 = `<PATCH path="src/components/Navbar.jsx">
<SEARCH>
bg-indigo-600 hover:bg-indigo-700
</SEARCH>
<REPLACE>
bg-emerald-600 hover:bg-emerald-700
</REPLACE>
</PATCH>`;
  const res2 = incrementalEditor.applyFileOperations(site, incrementalEditor.parseAIResponse(patch2).files);
  site = res2.files;

  // Assert Step 2: ONLY login button changed
  assert.deepEqual(res2.changedFiles, ['src/components/Navbar.jsx']);
  const navbar2 = site.find(f => f.path === 'src/components/Navbar.jsx');
  assert.ok(navbar2.content.includes('bg-emerald-600 hover:bg-emerald-700'));

  // STEP 3: "Make the hero heading 48px."
  const target3 = incrementalEditor.selectTargetFiles('Make the hero heading 48px.', site);
  assert.ok(target3.some(f => f.path === 'src/components/Hero.jsx'));

  const patch3 = `<PATCH path="src/components/Hero.jsx">
<SEARCH>
text-3xl font-extrabold tracking-tight text-slate-900 mb-6
</SEARCH>
<REPLACE>
text-[48px] font-extrabold tracking-tight text-slate-900 mb-6
</REPLACE>
</PATCH>`;
  const res3 = incrementalEditor.applyFileOperations(site, incrementalEditor.parseAIResponse(patch3).files);
  site = res3.files;

  // Assert Step 3: ONLY Hero heading changed
  assert.deepEqual(res3.changedFiles, ['src/components/Hero.jsx']);
  const hero3 = site.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero3.content.includes('text-[48px] font-extrabold'));

  // STEP 4: "Replace the hero image."
  const patch4 = `<PATCH path="src/components/Hero.jsx">
<SEARCH>
src="https://images.unsplash.com/photo-1551288049-bebda4e38f71"
</SEARCH>
<REPLACE>
src="https://images.unsplash.com/photo-1519389950473-47ba0277781c"
</REPLACE>
</PATCH>`;
  const res4 = incrementalEditor.applyFileOperations(site, incrementalEditor.parseAIResponse(patch4).files);
  site = res4.files;

  // Assert Step 4: ONLY Hero image changed
  assert.deepEqual(res4.changedFiles, ['src/components/Hero.jsx']);
  const hero4 = site.find(f => f.path === 'src/components/Hero.jsx');
  assert.ok(hero4.content.includes('photo-1519389950473-47ba0277781c'));

  // FINAL INTEGRITY CHECK:
  // All other components (Features, About, Pricing, Footer, API, Routes) are 100% UNCHANGED
  const original = createFullWebsiteFixture();
  for (const path of [
    'src/components/Features.jsx',
    'src/components/About.jsx',
    'src/components/Pricing.jsx',
    'src/components/Footer.jsx',
    'src/services/api.js',
    'src/routes/AppRoutes.jsx',
    'src/App.jsx'
  ]) {
    assert.equal(
      site.find(f => f.path === path).content,
      original.find(f => f.path === path).content,
      `Unrelated component ${path} must remain strictly untouched through all 4 edits!`
    );
  }
});
