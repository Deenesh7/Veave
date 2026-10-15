/**
 * Two-agent orchestrator.
 *
 *   backend scrape (optional) -> PLANNER agent -> BUILDER agent (task 1)
 *                                              -> BUILDER agent (task 2, continues from task 1's files)
 *                                              -> ...
 *                                              -> validation + save (agentService.applyActions)
 *
 * The planner and builder are separate agents (own prompt, own model). Nothing
 * is written to the project until every task is built and the combined result
 * passes the existing validation pipeline.
 */
const Project = require('../../models/Project');
const AIUsage = require('../../models/AIUsage');
const agentService = require('./agentService');
const planner = require('./plannerAgent');
const builder = require('./builderAgent');
const fileManager = require('../project/fileManager');
const sessionManager = require('../ai/sessionManager');
const { captureWebsite } = require('../clone/websiteCaptureService');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { AIError, NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { waitForDecision } = require('./planApproval');

const BUILDER_ATTEMPTS = 2;

/** Apply builder actions to an in-memory file list so the next builder pass sees them. */
function applyInMemory(files, actions) {
  let current = files.map((f) => ({ ...f }));
  for (const action of actions) {
    if (action.type === 'create_file') current = fileManager.createFile(current, action.path, action.content);
    else if (action.type === 'modify_file') current = fileManager.modifyFile(current, action.path, action.content);
    else if (action.type === 'delete_file') current = fileManager.deleteFile(current, action.path);
    else if (action.type === 'patch_file') {
      const target = current.find((f) => f.path === action.path);
      if (!target) throw new AIError(`Patch target not found: ${action.path}`);
      const occurrences = target.content.split(action.search).length - 1;
      if (occurrences !== 1) throw new AIError(`Patch search matched ${occurrences} times in ${action.path}`);
      target.content = target.content.replace(action.search, action.replace);
    }
  }
  return current;
}

/** Collapse the final in-memory state into one action list relative to the original files. */
function diffToActions(original, final) {
  const before = new Map(original.map((f) => [f.path, f.content]));
  const after = new Map(final.map((f) => [f.path, f.content]));
  const actions = [];
  for (const [path, content] of after) {
    if (!before.has(path)) actions.push({ type: 'create_file', path, content, reason: 'Created by builder agent' });
    else if (before.get(path) !== content) actions.push({ type: 'modify_file', path, content, reason: 'Modified by builder agent' });
  }
  for (const path of before.keys()) {
    if (!after.has(path)) actions.push({ type: 'delete_file', path, reason: 'Removed by builder agent' });
  }
  return actions;
}

async function trackUsage(userId, projectId, model, usage, agent) {
  if (!usage || !userId) return;
  try {
    await new AIUsage({
      userId,
      projectId,
      model: `${agent}:${model}`,
      inputTokens: usage.prompt_tokens || usage.prompt || 0,
      outputTokens: usage.completion_tokens || usage.completion || 0,
      totalTokens: usage.total_tokens || usage.total || 0
    }).save();
  } catch (err) {
    logger.warn(`Failed to record ${agent} usage: ${err.message}`);
  }
}

async function runDualAgent({ runId, requireApproval = true, userId, projectId, request, sourceUrl, maxRoutes, plannerModel, builderModel, signal, onEvent = () => {}, deps = {} }) {
  const scrapeSite = deps.captureWebsite || captureWebsite;
  const createPlan = deps.createPlan || planner.createPlan;
  const buildTask = deps.buildTask || builder.buildTask;

  signal?.throwIfAborted();
  const query = userId
    ? { _id: projectId, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
    : { _id: projectId };
  const project = await Project.findOne(query);
  if (!project) throw new NotFoundError('Project');
  project.files = await hydrateFiles(project.files);
  const originalFiles = (project.files || []).map(({ path, content, language, encoding }) => ({ path, content, language, encoding }));

  // 1. Backend scrape (the agents never browse; they only receive what the backend collected).
  let scrape = null;
  if (sourceUrl) {
    onEvent({ type: 'stage', stage: 'scraping', message: `Scraping ${sourceUrl}` });
    scrape = await scrapeSite(sourceUrl, { signal, maxRoutes });
    onEvent({ type: 'scraped', pages: (scrape.pages || []).length });
  }

  // 2. Planner agent.
  signal?.throwIfAborted();
  onEvent({ type: 'stage', stage: 'planning', agent: 'planner' });
  const planned = await createPlan({ request, scrape, files: originalFiles, model: plannerModel });
  await trackUsage(userId, projectId, planned.model, planned.usage, 'planner');
  const { plan } = planned;
  onEvent({ type: 'plan', plan, agent: 'planner', model: planned.model });

  // 2b. Ask the user to approve or cancel the plan before the builder starts.
  if (requireApproval) {
    onEvent({
      type: 'approval_required',
      runId,
      question: 'Do you want the builder agent to start building this plan?',
      options: ['approve', 'cancel']
    });
    const decision = await waitForDecision(runId, { userId, projectId, signal });
    if (decision !== 'approve') {
      onEvent({ type: 'cancelled', message: 'Plan cancelled. The project was not changed.' });
      return { cancelled: true, message: 'Plan cancelled. The project was not changed.', plan, files: originalFiles };
    }
    onEvent({ type: 'plan_approved' });
  }

  // 3. Builder agent, one pass per task, each continuing from the previous pass's files.
  let working = originalFiles.map((f) => ({ ...f }));
  const completed = [];
  for (let i = 0; i < plan.tasks.length; i++) {
    signal?.throwIfAborted();
    const task = plan.tasks[i];
    onEvent({ type: 'task_start', agent: 'builder', task: { id: task.id, title: task.title }, index: i, total: plan.tasks.length });

    let built = null;
    let applied = null;
    let lastError;
    for (let attempt = 1; attempt <= BUILDER_ATTEMPTS && !applied; attempt++) {
      try {
        built = await buildTask({ request, plan, task, files: working, completed, model: builderModel });
        applied = applyInMemory(working, built.actions);
        await trackUsage(userId, projectId, built.model, built.usage, 'builder');
      } catch (err) {
        lastError = err;
        logger.warn(`Builder task ${task.id} attempt ${attempt} failed: ${err.message}`);
        onEvent({ type: 'task_retry', task: { id: task.id }, attempt, error: err.message });
      }
    }
    if (!applied) throw new AIError(`Builder failed on task "${task.title}": ${lastError?.message}. The project was not changed.`);

    working = applied;
    completed.push({ id: task.id, title: task.title, message: built.message });
    onEvent({ type: 'task_done', agent: 'builder', task: { id: task.id, title: task.title }, message: built.message, files: built.actions.map((a) => a.path) });
  }

  // 4. Validate the combined result and save.
  const finalActions = diffToActions(originalFiles, working);
  if (!finalActions.length) throw new AIError('Builder agent made no changes. The project was not changed.');
  onEvent({ type: 'stage', stage: 'validating' });
  const updatedFiles = await agentService.applyActions(project, finalActions, {
    signal,
    userMessage: request,
    model: builderModel,
    onProgress: (progress) => onEvent({ type: 'validation_progress', progress })
  });
  project.files = updatedFiles;

  const conversation = await sessionManager.getOrCreateSession({ projectId, userId, initialProject: project });
  conversation.messages.push({ role: 'user', content: request });
  const summary = plan.summary || 'Built project with planner and builder agents';
  await sessionManager.recordCheckpoint(conversation, {
    prompt: request,
    changeSummary: summary,
    files: updatedFiles,
    activeCode: updatedFiles.find((f) => f.path === 'src/App.jsx' || f.path === 'App.jsx')?.content,
    designTokens: project.settings?.theme || {},
    dependencies: project.dependencies,
    validation: project.validation
  });
  conversation.messages.push({ role: 'assistant', content: summary, actions: finalActions });
  await project.save();
  await conversation.save();

  return { message: summary, plan, completed, actions: finalActions, files: updatedFiles };
}

module.exports = { runDualAgent, applyInMemory, diffToActions };

