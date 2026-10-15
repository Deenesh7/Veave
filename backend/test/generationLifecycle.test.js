const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const axios = require('axios');
const GenerationJob = require('../src/models/GenerationJob');
const Project = require('../src/models/Project');
const jobManager = require('../src/services/ai/jobManager');
const openrouterService = require('../src/services/ai/openrouterService');

test('new generate, screenshot, and clone jobs do not inherit old project conversations', () => {
  assert.equal(jobManager.startsNewProject('generate', null), true);
  assert.equal(jobManager.startsNewProject('screenshot', null), true);
  assert.equal(jobManager.startsNewProject('clone', null), true);
  assert.equal(jobManager.startsNewProject('modify', null), false);
  assert.equal(jobManager.startsNewProject('generate', 'project-1'), false);
});

test('only explicit modify jobs with project files use incremental patch mode', () => {
  const project = { files: [{ path: 'src/App.jsx', content: 'export default null' }] };
  assert.equal(jobManager.shouldUseIncrementalMode('modify', project), true);
  assert.equal(jobManager.shouldUseIncrementalMode('generate', project), false);
  assert.equal(jobManager.shouldUseIncrementalMode('screenshot', project), false);
  assert.equal(jobManager.shouldUseIncrementalMode('modify', { files: [] }), false);
});

test('project schema persists incremental clone settings', () => {
  const project = new Project({
    name: 'Clone fixture',
    settings: {
      designSystem: 'Source website',
      aiModel: 'Auto',
      lastTokenUsage: { totalTokens: 42 }
    }
  });

  assert.equal(project.settings.designSystem, 'Source website');
  assert.equal(project.settings.aiModel, 'Auto');
  assert.equal(project.settings.lastTokenUsage.totalTokens, 42);
});

test('OpenRouter completion helper is defined and returns completed responses unchanged', async () => {
  assert.equal(typeof jobManager.completeOpenRouterResponse, 'function');
  const completion = { finishReason: 'stop', content: 'complete output' };
  assert.equal(await jobManager.completeOpenRouterResponse([], completion), completion);
});

test('OpenRouter forwards context-compression plugins to the API', async (t) => {
  const originalPost = axios.post;
  let payload;
  t.after(() => { axios.post = originalPost; });
  axios.post = async (url, body) => {
    payload = body;
    return {
      data: {
        choices: [{ message: { content: 'complete output' }, finish_reason: 'stop' }],
        usage: { total_tokens: 10 }
      }
    };
  };

  await openrouterService.generateCompletion([{ role: 'user', content: 'Generate a page.' }], {
    model: 'fixture-model',
    plugins: [{ id: 'context-compression' }]
  });

  assert.deepEqual(payload.plugins, [{ id: 'context-compression' }]);
});

test('OpenRouter retries generic provider 400 errors with compatible parameters', async (t) => {
  const originalPost = axios.post;
  const payloads = [];
  t.after(() => { axios.post = originalPost; });
  axios.post = async (url, body) => {
    payloads.push(body);
    if (payloads.length === 1) {
      const error = new Error('Request failed with status code 400');
      error.response = {
        status: 400,
        data: { error: { message: 'Provider returned error', metadata: { raw: 'Unsupported reasoning configuration' } } }
      };
      throw error;
    }
    return { data: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 2 } } };
  };

  const completion = await openrouterService.generateCompletion([{ role: 'user', content: 'Generate.' }], {
    model: 'anthropic/claude-sonnet-5.5',
    tools: [{ type: 'function', function: { name: 'apply', parameters: { type: 'object' } } }],
    tool_choice: { type: 'function', function: { name: 'apply' } },
    reasoning: { effort: 'medium', exclude: true }
  });

  assert.equal(completion.content, 'ok');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].tool_choice, undefined);
  assert.equal(payloads[1].reasoning, undefined);
  assert.ok(Array.isArray(payloads[1].tools));
});

test('OpenRouter usage aggregation retains tokens and reported cost', () => {
  let usage = jobManager.mergeOpenRouterUsage(null, {
    prompt_tokens: 1200,
    completion_tokens: 300,
    total_tokens: 1500,
    cost: 0.0125
  }, 'anthropic/claude-sonnet-5.5');
  usage = jobManager.mergeOpenRouterUsage(usage, {
    prompt_tokens: 400,
    completion_tokens: 100,
    total_tokens: 500,
    cost: 0.004
  }, 'anthropic/claude-sonnet-5.5');

  assert.deepEqual(usage, {
    promptTokens: 1600,
    completionTokens: 400,
    totalTokens: 2000,
    modelUsed: 'anthropic/claude-sonnet-5.5',
    provider: 'OpenRouter',
    cost: 0.0165,
    costReported: true
  });
});

test('OpenRouter completion helper continues truncated tool-call arguments', async (t) => {
  const originalGenerateCompletion = openrouterService.generateCompletion;
  t.after(() => { openrouterService.generateCompletion = originalGenerateCompletion; });
  openrouterService.generateCompletion = async () => ({
    finishReason: 'stop',
    content: 'null;"}]}',
    usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50, cost: 0.002 }
  });

  const completion = await jobManager.completeOpenRouterResponse([], {
    finishReason: 'length',
    content: '',
    tool_calls: [{
      id: 'fixture-call',
      type: 'function',
      function: {
        name: 'apply_file_operations',
        arguments: '{"files":[{"path":"src/App.jsx","operation":"modify","content":"export default '
      }
    }],
    usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, cost: 0.005 }
  }, {
    model: 'fixture-model',
    structured: true,
    continuationInstruction: 'Continue the JSON.'
  });

  assert.equal(completion.finishReason, 'stop');
  const args = JSON.parse(completion.tool_calls[0].function.arguments);
  assert.equal(args.files[0].path, 'src/App.jsx');
  assert.equal(args.files[0].content, 'export default null;');
  assert.deepEqual(completion.usage, {
    prompt_tokens: 140,
    completion_tokens: 35,
    total_tokens: 175,
    cost: 0.007
  });
});

test('clone visual references may use local validation while screenshot jobs still require Docker', () => {
  assert.equal(jobManager.requiresDockerForVisualReference('reference', false), true);
  assert.equal(jobManager.requiresDockerForVisualReference('reference', true), false);
  assert.equal(jobManager.requiresDockerForVisualReference(null, false), false);
});

test('generated route-content and runtime failures may proceed to sequential repair', () => {
  assert.equal(jobManager.isRepairableSequentialPreviewFailure({
    ok: false,
    diagnostics: [{ category: 'route-content', message: 'Expected heading was not rendered.' }]
  }), true);
  assert.equal(jobManager.isRepairableSequentialPreviewFailure({
    ok: false,
    diagnostics: [{ category: 'preview-runtime', message: 'Component import is undefined.' }]
  }), true);
  assert.equal(jobManager.isRepairableSequentialPreviewFailure({
    ok: false,
    diagnostics: [{ category: 'architecture', path: 'src/components/HeroBanner.jsx', message: 'Source module exceeds 400 KiB.' }]
  }), true);
  assert.equal(jobManager.isRepairableSequentialPreviewFailure({
    ok: false,
    diagnostics: [{ category: 'missing-asset', message: 'Broken image.' }]
  }), false);
  assert.equal(jobManager.isRepairableSequentialPreviewFailure({ ok: true, diagnostics: [] }), false);
});

test('clone route capture has a hard maximum of six routes', () => {
  assert.equal(jobManager.resolveCloneRouteLimit(undefined), 100);
  assert.equal(jobManager.resolveCloneRouteLimit(2), 2);
  assert.equal(jobManager.resolveCloneRouteLimit(6), 6);
  assert.equal(jobManager.resolveCloneRouteLimit(200), 200);
});

test('clone visual thresholds retain a strict target with a lower completion floor', () => {
  const previousTarget = process.env.CLONE_VISUAL_THRESHOLD;
  const previousMinimum = process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE;
  delete process.env.CLONE_VISUAL_THRESHOLD;
  delete process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE;
  assert.deepEqual(jobManager.resolveCloneVisualThresholds(), { target: 0.8, minimum: 0.5 });
  process.env.CLONE_VISUAL_THRESHOLD = '0.9';
  process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE = '0.7';
  assert.deepEqual(jobManager.resolveCloneVisualThresholds(), { target: 0.9, minimum: 0.7 });
  process.env.CLONE_VISUAL_THRESHOLD = '0.6';
  process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE = '0.75';
  assert.deepEqual(jobManager.resolveCloneVisualThresholds(), { target: 0.6, minimum: 0.6 });
  assert.equal(jobManager.isAcceptableCloneVisualFallback({ score: 0.6796 }, { target: 0.8, minimum: 0.65 }), true);
  assert.equal(jobManager.isAcceptableCloneVisualFallback({ score: 0.6499 }, { target: 0.8, minimum: 0.65 }), false);
  assert.equal(jobManager.isAcceptableCloneVisualFallback({ score: 0.5205 }, { target: 0.8, minimum: 0.5 }), true);
  if (previousTarget === undefined) delete process.env.CLONE_VISUAL_THRESHOLD;
  else process.env.CLONE_VISUAL_THRESHOLD = previousTarget;
  if (previousMinimum === undefined) delete process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE;
  else process.env.CLONE_VISUAL_MINIMUM_ACCEPTANCE = previousMinimum;
});

test('route verification prefers the semantic H1 over earlier brand headings', () => {
  assert.equal(jobManager.getExpectedPageHeading({ headings: [
    { level: 'H2', text: 'SIMATS DEEMED UNIVERSITY' },
    { level: 'H1', text: 'Constituent Institutions' }
  ] }), 'Constituent Institutions');
  assert.equal(jobManager.getExpectedPageHeading({ headings: [
    { level: 'H2', text: 'News and Events' }
  ] }), 'News and Events');
  assert.equal(jobManager.getExpectedPageHeading({ title: 'Careers - Saveetha Engineering College', headings: [] }), 'Careers');
});

test('clone generation processes section stages in route queue order', () => {
  const pages = [{ path: '/' }, { path: '/about/' }, { path: '/research/' }];
  const stages = jobManager.buildCloneImplementationStages(pages);
  assert.deepEqual(stages.map(({ page, phase }) => `${phase}:${page.path}`), [
    'top:/', 'content:/', 'footer:/',
    'top:/about/', 'content:/about/', 'footer:/about/',
    'top:/research/', 'content:/research/', 'footer:/research/'
  ]);
});

test('small clone routes are built in a single stage and large content is split into parts', () => {
  const small = { path: '/small', extraction: { html: '<main><h1>Small page</h1></main>' } };
  const large = {
    path: '/large',
    extraction: {
      html: '<main>' + '<p>text</p>'.repeat(30000) + '</main>',
      htmlSections: [{ selector: 'main > section', tag: 'section', html: '<section>' + '<p>text</p>'.repeat(30000) + '</section>' }]
    }
  };
  const stages = jobManager.buildCloneImplementationStages([small, large]);
  assert.deepEqual(stages.filter(({ page }) => page === small).map(({ phase }) => phase), ['page']);
  const largePhases = stages.filter(({ page }) => page === large).map(({ phase }) => phase);
  assert.equal(largePhases[0], 'top');
  assert.equal(largePhases.at(-1), 'footer');
  assert.ok(largePhases.filter((phase) => phase === 'content').length > 1);
});

test('clone section stages receive only assets captured for that section', () => {
  const page = {
    viewport: { height: 900 },
    assetQueue: [
      { publicPath: '/assets/logo.png', section: { tag: 'header' }, selector: 'header img', rect: { documentY: 20 } },
      { publicPath: '/assets/hero.jpg', section: { heading: 'Welcome' }, selector: '.hero img', rect: { documentY: 180 } },
      { publicPath: '/assets/card.jpg', section: { heading: 'Programs' }, selector: '.programs img', rect: { documentY: 1400 } },
      { publicPath: '/assets/footer.png', section: { tag: 'footer' }, selector: 'footer img', rect: { documentY: 4000 } }
    ]
  };
  const assets = page.assetQueue.map(({ publicPath }) => ({ publicPath }));
  assert.deepEqual(jobManager.selectCloneSectionAssets(page, assets, 'header').map((asset) => asset.publicPath), ['/assets/logo.png']);
  assert.deepEqual(jobManager.selectCloneSectionAssets(page, assets, 'hero').map((asset) => asset.publicPath), ['/assets/hero.jpg']);
  assert.deepEqual(jobManager.selectCloneSectionAssets(page, assets, 'content').map((asset) => asset.publicPath), ['/assets/card.jpg']);
  assert.deepEqual(jobManager.selectCloneSectionAssets(page, assets, 'footer').map((asset) => asset.publicPath), ['/assets/footer.png']);
});

test('clone color verification uses exact captured computed colors', () => {
  assert.deepEqual(jobManager.getExpectedPageColors({ design: {
    color: 'rgb(20, 20, 20)',
    background: 'rgb(255, 255, 255)',
    palette: ['rgb(20, 20, 20)', 'rgb(200, 30, 40)', 'rgba(0, 0, 0, 0)']
  } }), ['rgb(20, 20, 20)', 'rgb(255, 255, 255)', 'rgb(200, 30, 40)']);
});

test('clone auto-routing uses the long-context generation model', () => {
  const previous = process.env.CLONE_OPENROUTER_MODEL;
  delete process.env.CLONE_OPENROUTER_MODEL;
  assert.throws(() => jobManager.resolveGenerationModel('clone', 'Auto'), /CLONE_OPENROUTER_MODEL/);
  process.env.CLONE_OPENROUTER_MODEL = 'google/gemini-2.5-pro';
  assert.equal(jobManager.resolveGenerationModel('clone', 'GPT-6 Luna'), 'google/gemini-2.5-pro');
  assert.equal(jobManager.resolveGenerationModel('generate', 'Gemini Flash 3.8'), 'Gemini Flash 3.8');
  if (previous === undefined) delete process.env.CLONE_OPENROUTER_MODEL;
  else process.env.CLONE_OPENROUTER_MODEL = previous;
});

test('sequential clone context stays bounded and prioritizes routing source', () => {
  const files = [
    { path: 'src/App.jsx', content: 'A'.repeat(300000) },
    { path: 'src/routes.js', content: 'R'.repeat(300000) },
    ...Array.from({ length: 12 }, (_, index) => ({ path: `src/pages/Page${index}.jsx`, content: String(index).repeat(500000) })),
    { path: 'public/assets/hero.webp', content: 'x'.repeat(3000000), encoding: 'base64' }
  ];
  const compacted = jobManager.compactClonePageSource(files, '/page-8', 1024 * 1024);
  assert.ok(compacted.some((file) => file.path === 'src/App.jsx'));
  assert.ok(compacted.some((file) => file.path === 'src/routes.js'));
  assert.ok(!compacted.some((file) => file.encoding === 'base64'));
  assert.ok(Buffer.byteLength(JSON.stringify(compacted), 'utf8') < 1100 * 1024);
});

test('sequential page analysis excludes unmatched remote image noise', () => {
  const compacted = jobManager.compactClonePageAnalysis({
    path: '/about',
    title: 'About',
    images: [
      { src: 'https://tracking.example/pixel.gif' },
      { src: '__VEAVE_CLONE_ASSET_1__', localPath: '/assets/about.webp' }
    ]
  });
  assert.deepEqual(compacted.images, [{ src: '__VEAVE_CLONE_ASSET_1__', localPath: '/assets/about.webp' }]);
});

test('clone source tokens are derived from captured styles instead of a selected preset', () => {
  const tokens = jobManager.buildCloneSourceTokens({
    pages: [{
      path: '/',
      captureStatus: 'captured',
      design: {
        fontFamily: '"Source Serif", Georgia, serif',
        color: 'rgb(31, 25, 22)',
        background: 'rgb(250, 246, 239)',
        palette: ['rgb(31, 25, 22)', 'rgb(250, 246, 239)', 'rgb(154, 52, 28)']
      },
      visualElements: [{ style: { backgroundColor: 'rgb(255, 255, 255)', borderColor: 'rgb(210, 202, 190)', borderRadius: '3px' } }]
    }]
  }, { font: 'Inter, sans-serif', radius: '14px' });

  assert.equal(tokens.font, '"Source Serif", Georgia, serif');
  assert.equal(tokens.bg, 'rgb(250, 246, 239)');
  assert.equal(tokens.accent, 'rgb(154, 52, 28)');
  assert.equal(tokens.radius, '3px');
  assert.equal(tokens.sourceControlled, true);
});

test('initial project repair preserves valid components while adding a missing App.jsx', () => {
  let preservedFiles;
  assert.throws(() => {
    jobManager.parseInitialProjectResponse({
      action: 'create',
      files: [{
        path: 'src/components/Hero.jsx',
        operation: 'create',
        content: 'export default function Hero(){ return <h1>Saveetha</h1>; }'
      }]
    });
  }, (error) => {
    preservedFiles = error.partialFiles;
    return /did not create src\/App\.jsx/.test(error.message) && preservedFiles?.length === 1;
  });

  assert.throws(() => {
    jobManager.parseInitialProjectResponse({
      action: 'create',
      files: [{
        path: 'src/pages/Home.jsx',
        operation: 'create',
        content: 'export default function Home(){ return <Hero />; }'
      }]
    }, preservedFiles);
  }, (error) => {
    preservedFiles = error.partialFiles;
    return /did not create src\/App\.jsx/.test(error.message) && preservedFiles?.length === 2;
  });

  const completed = jobManager.parseInitialProjectResponse({
    action: 'create',
    files: [{
      path: 'src/App.jsx',
      operation: 'create',
      content: "import Hero from './components/Hero'; export default function App(){ return <Hero />; }"
    }]
  }, preservedFiles);

  assert.deepEqual(completed.map((file) => file.path).sort(), ['src/App.jsx', 'src/components/Hero.jsx', 'src/pages/Home.jsx']);
  assert.match(completed.find((file) => file.path === 'src/components/Hero.jsx').content, /Saveetha/);
});

test('initial project validation preserves files while requesting missing route modules', () => {
  let preservedFiles;
  assert.throws(() => {
    jobManager.parseInitialProjectResponse({
      action: 'create',
      files: [
        { path: 'src/App.jsx', operation: 'create', content: "import Institutions from './pages/Institutions'; export default function App(){ return <Institutions />; }" },
        { path: 'src/components/Header.jsx', operation: 'create', content: 'export default function Header(){ return <header>Campus</header>; }' }
      ]
    });
  }, (error) => {
    preservedFiles = error.partialFiles;
    return /Cannot resolve local import "\.\/pages\/Institutions"/.test(error.message) && preservedFiles?.length === 2;
  });

  const completed = jobManager.parseInitialProjectResponse({
    action: 'create',
    files: [{
      path: 'src/pages/Institutions.jsx',
      operation: 'create',
      content: 'export default function Institutions(){ return <main>Institutions</main>; }'
    }]
  }, preservedFiles);

  assert.deepEqual(completed.map((file) => file.path).sort(), [
    'src/App.jsx', 'src/components/Header.jsx', 'src/pages/Institutions.jsx'
  ]);
});

test('sequential clone protocol repairs switch from tools to deterministic delimiters', async (t) => {
  const originalGenerateCompletion = openrouterService.generateCompletion;
  let receivedOptions;
  let receivedMessages;
  t.after(() => { openrouterService.generateCompletion = originalGenerateCompletion; });
  openrouterService.generateCompletion = async (messages, options) => {
    receivedMessages = messages;
    receivedOptions = options;
    return {
      finishReason: 'stop',
      content: '<FILE path="src/App.jsx" operation="modify">\nexport default function App(){ return <main>Saveetha clone</main>; }\n</FILE>'
    };
  };

  const result = await jobManager.generateSequentialClonePage({
    files: [{ path: 'src/App.jsx', content: 'export default function App(){ return <main>Old</main>; }' }],
    page: {
      path: '/',
      title: 'Saveetha',
      repairDiagnostics: 'Invalid model file operations: Operation "modify" on "src/App.jsx" requires a string "content" field.'
    },
    phase: 'complete',
    routeManifest: [{ path: '/', title: 'Saveetha', pageType: 'landing' }],
    siteMap: {},
    assets: [],
    routeScreenshot: 'data:image/jpeg;base64,cmVmZXJlbmNl',
    model: 'fixture-model'
  });

  assert.equal(receivedOptions.tools, undefined);
  assert.equal(receivedOptions.response_format, false);
  assert.deepEqual(receivedOptions.plugins, [{ id: 'context-compression' }]);
  assert.ok(Array.isArray(receivedMessages[1].content));
  assert.equal(receivedMessages[1].content[1].image_url.url, 'data:image/jpeg;base64,cmVmZXJlbmNl');
  assert.match(receivedMessages[1].content[0].text, /exact font families and fallback stacks/);
  assert.match(receivedMessages[1].content[0].text, /make each local import exactly match the target file's default or named export/);
  assert.match(receivedMessages[1].content[0].text, /Never delete or rename src\/App\.jsx/);
  assert.match(receivedMessages[0].content, /extracted HTML.*source of truth/);
  assert.match(result.files.find((file) => file.path === 'src/App.jsx').content, /Saveetha clone/);
});

test('ambiguous sequential patches are retried as complete file modifications', async (t) => {
  const originalGenerateCompletion = openrouterService.generateCompletion;
  let receivedMessages;
  let receivedOptions;
  t.after(() => { openrouterService.generateCompletion = originalGenerateCompletion; });
  openrouterService.generateCompletion = async (messages, options) => {
    receivedMessages = messages;
    receivedOptions = options;
    return {
      finishReason: 'stop',
      content: '<FILE path="src/styles/AboutPage.css" operation="modify">\n.about { color: #111; }\n</FILE>'
    };
  };

  const result = await jobManager.generateSequentialClonePage({
    files: [
      { path: 'src/App.jsx', content: 'export default function App(){ return <main>About</main>; }' },
      { path: 'src/styles/AboutPage.css', content: '.about { color: red; }\n.about { color: red; }' }
    ],
    page: {
      path: '/aboutus',
      title: 'About us',
      repairDiagnostics: 'Invalid model file operations: Patch failed: search block matched 2 locations in "src/styles/AboutPage.css". Patch search blocks must be uniquely identifiable.'
    },
    phase: 'complete',
    routeManifest: [{ path: '/aboutus', title: 'About us', pageType: 'about' }],
    siteMap: {},
    assets: [],
    model: 'fixture-model'
  });

  assert.equal(receivedOptions.response_format, false);
  assert.equal(receivedOptions.tools, undefined);
  assert.match(receivedMessages[1].content, /NEVER return a PATCH operation/);
  assert.match(receivedMessages[1].content, /exactly one complete <FILE path="src\/styles\/AboutPage\.css" operation="modify">/);
  assert.match(receivedMessages[1].content, /PATCH operations are forbidden/);
  assert.equal(result.files.find((file) => file.path === 'src/styles/AboutPage.css').content.trim(), '.about { color: #111; }');
});

test('sequential syntax failures regenerate the complete rejected file', async (t) => {
  const originalGenerateCompletion = openrouterService.generateCompletion;
  let receivedMessages;
  let receivedOptions;
  t.after(() => { openrouterService.generateCompletion = originalGenerateCompletion; });
  openrouterService.generateCompletion = async (messages, options) => {
    receivedMessages = messages;
    receivedOptions = options;
    return {
      finishReason: 'stop',
      content: '<FILE path="src/data/rankingsData.ts" operation="create">\nexport const rankings = [{ title: "World Ranking" }];\n</FILE>'
    };
  };

  const result = await jobManager.generateSequentialClonePage({
    files: [{ path: 'src/App.jsx', content: 'export default function App(){ return <main>Home</main>; }' }],
    page: {
      path: '/',
      title: 'Home',
      repairDiagnostics: 'Invalid model file operations: Syntax error in "src/data/rankingsData.ts" (348:14): Unterminated string constant.'
    },
    phase: 'complete',
    routeManifest: [{ path: '/', title: 'Home', pageType: 'landing' }],
    siteMap: {},
    assets: [],
    model: 'fixture-model'
  });

  assert.equal(receivedOptions.response_format, false);
  assert.match(receivedMessages[1].content, /rejected atomically/);
  assert.match(receivedMessages[1].content, /<FILE path="src\/data\/rankingsData\.ts" operation="create">/);
  assert.match(receivedMessages[1].content, /balanced quotes and valid TypeScript/);
  assert.match(receivedMessages[1].content, /Repeat any other complete file operations/);
  assert.match(result.files.find((file) => file.path === 'src/data/rankingsData.ts').content, /World Ranking/);
});
const { generateExport } = require('../src/services/project/exportService');
const app = require('../src/app');

test('cancellation cannot abort a revision whose commit already started', async (t) => {
  const original = GenerationJob.findOneAndUpdate;
  t.after(() => { GenerationJob.findOneAndUpdate = original; jobManager.activeValidations.delete('fixture'); });
  const controller = new AbortController();
  jobManager.activeValidations.set('fixture', controller);
  GenerationJob.findOneAndUpdate = async (query) => {
    assert.deepEqual(query.status.$in, ['queued', 'processing']);
    return null;
  };
  assert.equal(await jobManager.cancelJob('fixture'), null);
  assert.equal(controller.signal.aborted, false);
  GenerationJob.findOneAndUpdate = async () => ({ status: 'cancelled' });
  assert.equal((await jobManager.cancelJob('fixture')).status, 'cancelled');
  assert.equal(controller.signal.aborted, true);
});

test('export contains the tested manifest and lockfile once, without replacement configs', async () => {
  const files = [
    { path: 'package.json', content: '{"dependencies":{"react":"18.3.1"}}' },
    { path: 'package-lock.json', content: '{"lockfileVersion":3}' },
    { path: 'src/App.jsx', content: 'export default function App(){return null}' }
  ];
  const zip = await generateExport({ name: 'Verified fixture', files });
  const names = [];
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = zip.indexOf(signature);
  while (offset >= 0) {
    const length = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 46, offset + 46 + length).toString());
    offset = zip.indexOf(signature, offset + 46 + length);
  }
  assert.deepEqual(names.sort(), files.map((file) => file.path).sort());
});

test('express startup and routing responds to smoke probe', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/__pipeline_smoke__`);
  assert.equal(response.status, 404);
});

test('changed backend modules pass syntax validation', () => {
  const backendRoot = path.resolve(__dirname, '..');
  const files = [
    'src/services/ai/jobManager.js',
    'src/services/ai/incrementalEditor.js',
    'src/services/ai/validationGate.js',
    'src/services/ai/executionRunner.js',
    'src/services/project/validatedPreview.js',
    'src/services/ai/geminiService.js',
    'src/services/ai/contextBuilder.js',
    'src/services/ai/sessionManager.js',
    'src/services/clone/websiteCaptureService.js',
    'src/controllers/aiCreationController.js',
    'src/services/agent/agentService.js',
    'runner/worker.cjs',
    'runner/registryProxy.cjs'
  ];

  for (const file of files) {
    const fullPath = path.join(backendRoot, file);
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
    }, `Syntax check failed for ${file}`);
  }
});

// ---- guard rails: broken sections are removed instead of failing the clone ----
test('guard rail stubs keep the exports of a removed component', () => {
  const stub = jobManager.buildQuarantineStub({ path: 'src/components/Part2.jsx', content: 'export const Extra = 1;\nexport default function Part2(){ return <div/> }\nexport { Foo as Bar, Baz };' }, 'boom */ bad');
  assert.match(stub, /export default VeaveRemovedSection/);
  assert.match(stub, /export const Extra = VeaveRemovedSection/);
  assert.match(stub, /export const Bar = VeaveRemovedSection/);
  assert.match(stub, /export const Baz = VeaveRemovedSection/);
  assert.doesNotMatch(stub, /\*\/ bad/);
  assert.match(jobManager.buildQuarantineStub({ path: 'src/a.css', content: '.a{' }, 'x'), /^\/\* VEAVE GUARD RAIL/);
});

test('guard rail never removes entry files or data modules', async () => {
  const files = [
    { path: 'src/App.jsx', content: 'export default function App(){ return <main/> }' },
    { path: 'src/data/items.js', content: 'export const items = [' }
  ];
  const generationPipeline = require('../src/services/ai/generationPipeline');
  const diagnostics = generationPipeline.validateGeneratedFiles(files);
  assert.ok(diagnostics.length > 0);
  assert.equal(await jobManager.salvageCloneCandidate({ files, diagnostics, isFinal: false }), null);
});

test('guard rail removes a component with a syntax error and keeps the rest', async () => {
  const generationPipeline = require('../src/services/ai/generationPipeline');
  const files = [
    { path: 'src/App.jsx', content: "import Good from './components/Good.jsx';\nimport Bad from './components/Bad.jsx';\nexport default function App(){ return <main><Good/><Bad/></main> }" },
    { path: 'src/components/Good.jsx', content: 'export default function Good(){ return <h1>Good section</h1> }' },
    { path: 'src/components/Bad.jsx', content: 'export default function Bad(){ return <div> }' }
  ];
  const diagnostics = generationPipeline.validateGeneratedFiles(files);
  assert.ok(diagnostics.some((item) => item.path === 'src/components/Bad.jsx'));
  const salvaged = await jobManager.salvageCloneCandidate({ files, diagnostics, isFinal: false });
  assert.deepEqual(salvaged.quarantined, ['src/components/Bad.jsx']);
  assert.equal(generationPipeline.validateGeneratedFiles(salvaged.files).length, 0);
  assert.match(salvaged.files.find((file) => file.path === 'src/components/Good.jsx').content, /Good section/);
});

test('guard rail isolates the component that crashes the rendered page', { timeout: 180000 }, async () => {
  const { verifyPreviewRuntime } = require('../src/services/ai/targetRenderVerifier');
  const files = [
    { path: 'src/App.jsx', content: "import Good from './components/Good.jsx';\nimport Crash from './components/Crash.jsx';\nexport default function App(){ return <main><Good/><Crash/></main> }" },
    { path: 'src/components/Good.jsx', content: 'export default function Good(){ return <h1>Good section stays visible on the page</h1> }' },
    { path: 'src/components/Crash.jsx', content: 'export default function Crash(){ const items = undefined; return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> }' }
  ];
  const verify = (probeFiles) => verifyPreviewRuntime(probeFiles, { routePath: '/', minimumTextLength: 10 });
  assert.equal((await verify(files)).ok, false);
  const salvaged = await jobManager.salvageCloneCandidate({
    files,
    diagnostics: [],
    isFinal: true,
    candidatePaths: ['src/components/Good.jsx', 'src/components/Crash.jsx'],
    verify
  });
  assert.ok(salvaged, 'expected the crashing component to be isolated');
  assert.deepEqual(salvaged.quarantined, ['src/components/Crash.jsx']);
  assert.equal((await verify(salvaged.files)).ok, true);
});

test('clone prompts require Tailwind CSS and flag separate stylesheets', async (t) => {
  assert.deepEqual(
    jobManager.findCloneCssViolations(['src/pages/AboutPage.jsx', 'src/pages/AboutPage.css', 'src/styles.css', 'src/index.css']),
    ['src/pages/AboutPage.css', 'src/styles.css']
  );
  const original = openrouterService.generateCompletion;
  let received;
  t.after(() => { openrouterService.generateCompletion = original; });
  openrouterService.generateCompletion = async (messages) => {
    received = messages;
    return { finishReason: 'stop', content: '<FILE path="src/App.jsx" operation="modify">\nexport default function App(){ return <main className="p-4">x</main>; }\n</FILE>' };
  };
  await jobManager.generateSequentialClonePage({
    files: [{ path: 'src/App.jsx', content: 'export default function App(){ return <main>Old</main>; }' }],
    page: { path: '/', title: 'Home', repairDiagnostics: 'Invalid model file operations: x' },
    phase: 'page',
    routeManifest: [{ path: '/', title: 'Home', pageType: 'landing' }],
    siteMap: {},
    assets: [],
    model: 'fixture-model'
  });
  assert.match(received[0].content, /TAILWIND CSS ONLY/);
  assert.match(received[0].content, /Do NOT create or modify per-page, per-component or global \.css files/);
  const userText = typeof received[1].content === 'string' ? received[1].content : received[1].content[0].text;
  assert.match(userText, /TAILWIND CSS ONLY/);
});
