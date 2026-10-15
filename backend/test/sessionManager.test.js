const test = require('node:test');
const assert = require('node:assert/strict');
const sessionManager = require('../src/services/ai/sessionManager');
const Conversation = require('../src/models/Conversation');
const Project = require('../src/models/Project');
const ProjectFile = require('../src/models/ProjectFile');

// Prevent Mongoose buffering timeout in disconnected test environments
Conversation.prototype.save = async function() { return this; };
Project.prototype.save = async function() { return this; };
ProjectFile.bulkWrite = async function() { return {}; };
ProjectFile.deleteMany = async function() { return {}; };

function createMockProject() {
  const proj = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Project',
    description: 'A test project for session lineage',
    dependencies: ['react', 'react-dom'],
    validation: { status: 'passed', report: { checks: [] } },
    settings: {
      theme: { primary: '#3B82F6', background: '#FFFFFF', radius: '12px' }
    },
    files: [
      { path: 'package.json', content: '{"name":"test-project"}', language: 'json' },
      { path: 'src/App.jsx', content: 'export default function App() { return <h1>Step 1</h1>; }', language: 'javascript' },
      { path: 'src/components/Header.jsx', content: 'export function Header() { return <header>Header</header>; }', language: 'javascript' }
    ],
    save: async function() { return this; }
  };
  return proj;
}

test('SessionManager: seeds Checkpoint 1 on initial session creation with 1-day TTL', async (t) => {
  const origFindOne = Conversation.findOne;
  t.after(() => { Conversation.findOne = origFindOne; });

  Conversation.findOne = () => ({
    sort: async () => null,
    then: (resolve) => resolve(null)
  });

  const project = createMockProject();
  const session = await sessionManager.getOrCreateSession({
    conversationId: 'conv_unit_test_1',
    projectId: project._id,
    userId: 'user_123',
    initialProject: project,
    prompt: 'Build landing page'
  });

  assert.equal(session.conversationId, 'conv_unit_test_1');
  assert.equal(session.checkpoints.length, 1);
  assert.equal(session.currentIndex, 0);
  assert.equal(session.checkpoints[0].stepNumber, 1);
  assert.equal(session.activeGenerationId, session.checkpoints[0].checkpointId);

  // Check 1-day TTL
  const expiresAt = new Date(session.expiresAt).getTime();
  const now = Date.now();
  const diffHours = (expiresAt - now) / (1000 * 60 * 60);
  assert.ok(diffHours >= 23.9 && diffHours <= 24.1, `ExpiresAt should be ~24 hours from now, was ${diffHours}h`);
});

test('SessionManager: records new checkpoints and avoids duplicates for unchanged files', async (t) => {
  const origFindOne = Conversation.findOne;
  t.after(() => { Conversation.findOne = origFindOne; });

  Conversation.findOne = () => ({
    sort: async () => null,
    then: (resolve) => resolve(null)
  });

  const project = createMockProject();
  let session = await sessionManager.getOrCreateSession({
    conversationId: 'conv_unit_test_2',
    projectId: project._id,
    initialProject: project
  });

  assert.equal(session.checkpoints.length, 1);

  // Try recording with identical files
  await sessionManager.recordCheckpoint(session, {
    prompt: 'No change prompt',
    changeSummary: 'No change',
    files: project.files
  });

  // Should NOT create duplicate checkpoint
  assert.equal(session.checkpoints.length, 1, 'Duplicate files should not create a new checkpoint');

  // Modify file
  const updatedFiles = [
    ...project.files.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Step 2</h1>; }', language: 'javascript' }
  ];

  await sessionManager.recordCheckpoint(session, {
    prompt: 'Add step 2 header',
    changeSummary: 'Updated App to Step 2',
    files: updatedFiles,
    designTokens: { primary: '#10B981' }
  });

  assert.equal(session.checkpoints.length, 2);
  assert.equal(session.currentIndex, 1);
  assert.equal(session.checkpoints[1].stepNumber, 2);
  assert.equal(session.checkpoints[1].changeSummary, 'Updated App to Step 2');
  assert.equal(session.checkpoints[1].designTokens.primary, '#10B981');
});

test('SessionManager: multiple Undo actions move backward step-by-step through session history', async (t) => {
  const origFindById = Project.findById;
  const origFindOne = Conversation.findOne;
  t.after(() => {
    Project.findById = origFindById;
    Conversation.findOne = origFindOne;
  });

  const project = createMockProject();
  Project.findById = async () => project;

  Conversation.findOne = () => ({
    sort: async () => null,
    then: (resolve) => resolve(null)
  });

  let session = await sessionManager.getOrCreateSession({
    conversationId: 'conv_unit_test_undo',
    projectId: project._id,
    initialProject: project
  });

  // Step 2
  const files2 = [
    ...project.files.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Step 2</h1>; }', language: 'javascript' }
  ];
  await sessionManager.recordCheckpoint(session, {
    prompt: 'Change to Step 2',
    changeSummary: 'Step 2 modification',
    files: files2
  });

  // Step 3
  const files3 = [
    ...project.files.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Step 3</h1>; }', language: 'javascript' }
  ];
  await sessionManager.recordCheckpoint(session, {
    prompt: 'Change to Step 3',
    changeSummary: 'Step 3 modification',
    files: files3
  });

  assert.equal(session.checkpoints.length, 3);
  assert.equal(session.currentIndex, 2);

  Conversation.findOne = () => ({
    sort: async () => session,
    then: (resolve) => resolve(session)
  });

  // 1st Undo: should restore Step 2
  const undoResult1 = await sessionManager.undo('conv_unit_test_undo');
  assert.equal(undoResult1.currentIndex, 1);
  assert.equal(undoResult1.canUndo, true);
  assert.equal(undoResult1.canRedo, true);
  assert.equal(project.files.find(f => f.path === 'src/App.jsx').content.includes('Step 2'), true);

  // 2nd Undo: should restore Step 1 (initial state)
  const undoResult2 = await sessionManager.undo('conv_unit_test_undo');
  assert.equal(undoResult2.currentIndex, 0);
  assert.equal(undoResult2.canUndo, false, 'Cannot undo past initial state');
  assert.equal(undoResult2.canRedo, true, 'Can redo forward');
  assert.equal(project.files.find(f => f.path === 'src/App.jsx').content.includes('Step 1'), true);

  // 3rd Undo: should throw error
  await assert.rejects(
    async () => await sessionManager.undo('conv_unit_test_undo'),
    /No previous session checkpoint to undo/
  );
});

test('SessionManager: Redo moves forward through session history and branching truncates forward stack', async (t) => {
  const origFindById = Project.findById;
  const origFindOne = Conversation.findOne;
  t.after(() => {
    Project.findById = origFindById;
    Conversation.findOne = origFindOne;
  });

  const project = createMockProject();
  Project.findById = async () => project;

  Conversation.findOne = () => ({
    sort: async () => null,
    then: (resolve) => resolve(null)
  });

  let session = await sessionManager.getOrCreateSession({
    conversationId: 'conv_unit_test_redo',
    projectId: project._id,
    initialProject: project
  });

  // Checkpoint 2
  const files2 = [
    ...project.files.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Version B</h1>; }', language: 'javascript' }
  ];
  await sessionManager.recordCheckpoint(session, {
    prompt: 'Version B',
    changeSummary: 'Version B modification',
    files: files2
  });

  Conversation.findOne = () => ({
    sort: async () => session,
    then: (resolve) => resolve(session)
  });

  // Undo back to Step 1
  await sessionManager.undo('conv_unit_test_redo');
  assert.equal(session.currentIndex, 0);

  // Redo forward to Version B
  const redoResult = await sessionManager.redo('conv_unit_test_redo');
  assert.equal(redoResult.currentIndex, 1);
  assert.equal(project.files.find(f => f.path === 'src/App.jsx').content.includes('Version B'), true);

  // Undo again to Step 1
  await sessionManager.undo('conv_unit_test_redo');
  assert.equal(session.currentIndex, 0);

  // User makes a NEW change from Step 1 (branching)
  const filesBranch = [
    ...project.files.filter(f => f.path !== 'src/App.jsx'),
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Branched C</h1>; }', language: 'javascript' }
  ];
  await sessionManager.recordCheckpoint(session, {
    prompt: 'Version C',
    changeSummary: 'Version C modification',
    files: filesBranch
  });

  // Version B should have been replaced by Version C in linear history
  assert.equal(session.checkpoints.length, 2);
  assert.equal(session.currentIndex, 1);
  assert.equal(session.checkpoints[1].changeSummary, 'Version C modification');
});

test('SessionManager: expired sessions (> 24 hours) are purged and refreshed', async (t) => {
  const origFindOne = Conversation.findOne;
  const origDeleteOne = Conversation.deleteOne;
  let deleted = false;
  t.after(() => {
    Conversation.findOne = origFindOne;
    Conversation.deleteOne = origDeleteOne;
  });

  Conversation.deleteOne = async () => { deleted = true; return { acknowledged: true }; };

  const expiredSession = new Conversation({
    conversationId: 'expired_conv_123',
    projectId: '507f1f77bcf86cd799439011',
    expiresAt: new Date(Date.now() - 3600000), // 1 hour ago (expired)
    checkpoints: [{ checkpointId: 'cp_old', stepNumber: 1, filesSnapshot: [] }]
  });

  Conversation.findOne = () => ({
    sort: async () => expiredSession,
    then: (resolve) => resolve(expiredSession)
  });

  const project = createMockProject();
  const refreshed = await sessionManager.getOrCreateSession({
    conversationId: 'expired_conv_123',
    projectId: project._id,
    initialProject: project
  });

  assert.equal(deleted, true, 'Expired session should have been deleted');
  assert.ok(new Date(refreshed.expiresAt).getTime() > Date.now(), 'New session expires in the future');
});

test('SessionManager: formats response correctly for existing Lineage UI', async (t) => {
  const origFindOne = Conversation.findOne;
  t.after(() => { Conversation.findOne = origFindOne; });

  Conversation.findOne = () => ({
    sort: async () => null,
    then: (resolve) => resolve(null)
  });

  const project = createMockProject();
  let session = await sessionManager.getOrCreateSession({
    conversationId: 'conv_unit_test_lineage',
    projectId: project._id,
    initialProject: project
  });

  const formatted = sessionManager.formatSessionResponse(session);
  assert.equal(formatted.conversationId, 'conv_unit_test_lineage');
  assert.equal(Array.isArray(formatted.generations), true);
  assert.equal(formatted.generations.length, 1);
  assert.equal(formatted.generations[0].versionNumber, 1);
  assert.equal(formatted.generations[0].isActive, true);
  assert.equal(formatted.canUndo, false);
  assert.equal(formatted.canRedo, false);
});

test('aiCreationController: catches undo/redo errors cleanly without unhandled throws', async (t) => {
  const aiCreationController = require('../src/controllers/aiCreationController');

  let statusReceived = null;
  let jsonReceived = null;
  const mockRes = {
    status: (code) => {
      statusReceived = code;
      return {
        json: (payload) => {
          jsonReceived = payload;
          return payload;
        }
      };
    }
  };

  const origGetSession = sessionManager.getSession;
  t.after(() => { sessionManager.getSession = origGetSession; });
  sessionManager.getSession = async () => null;

  await aiCreationController.undoLastGeneration({ params: { id: 'nonexistent' } }, mockRes, () => {});
  assert.equal(statusReceived, 404);
  assert.equal(jsonReceived.success, false);
  assert.ok(jsonReceived.error.includes('not found') || jsonReceived.error.includes('expired'));

  await aiCreationController.redoGeneration({ params: { id: 'nonexistent' } }, mockRes, () => {});
  assert.equal(statusReceived, 404);
  assert.equal(jsonReceived.success, false);

  await aiCreationController.rollbackGeneration({ params: { id: 'nonexistent', generationId: 'gen_1' } }, mockRes, () => {});
  assert.equal(statusReceived, 404);
  assert.equal(jsonReceived.success, false);
});
