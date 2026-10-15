const Project = require('../../models/Project');
const Conversation = require('../../models/Conversation');
const ProjectVersion = require('../../models/ProjectVersion');
const AIUsage = require('../../models/AIUsage');
const openRouterService = require('../ai/openrouterService');
const sessionManager = require('../ai/sessionManager');
const { buildContext } = require('../ai/contextManager');
const { validateActions } = require('../ai/actionValidator');
const incrementalEditor = require('../ai/incrementalEditor');
const jobManager = require('../ai/jobManager');
const { scaffoldReactProject } = require('../project/reactScaffolder');
const fileManager = require('../project/fileManager');
const { AppError, NotFoundError, AIError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { hydrateFiles } = require('../storage/s3BlobStorage');

class AgentService {
  async processMessage(userId, projectId, userMessage, imageBase64 = null, signal, selectedElement = null) {
    signal?.throwIfAborted();
    const projectQuery = userId
      ? { _id: projectId, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
      : { _id: projectId };
    const project = await Project.findOne(projectQuery);
    if (!project) throw new NotFoundError('Project');
    project.files = await hydrateFiles(project.files);

    const conversation = await sessionManager.getOrCreateSession({
      projectId,
      userId,
      initialProject: project
    });

    conversation.messages.push({ role: 'user', content: userMessage });

    const messages = buildContext(project, conversation, userMessage, { selectedElement });
    
    const { content, usage } = await openRouterService.generateCompletion(messages);
    
    const { parsed, actions } = this._parseResponse(content);
    
    const updatedFiles = await this.applyActions(project, actions, { signal, userMessage, selectedElement });
    project.files = updatedFiles;
    
    await sessionManager.recordCheckpoint(conversation, {
      prompt: userMessage,
      changeSummary: parsed.message || 'Agent modified project files',
      files: updatedFiles,
      activeCode: updatedFiles.find(f => f.path === 'src/App.jsx' || f.path === 'App.jsx')?.content,
      designTokens: project.settings?.theme || {},
      dependencies: project.dependencies,
      validation: project.validation
    });
    
    conversation.messages.push({
      role: 'assistant',
      content: parsed.message || 'Updated project.',
      actions
    });

    await project.save();
    await conversation.save();
    
    if (usage && userId) {
      await this._trackUsage(userId, projectId, 'anthropic/claude-sonnet-4', usage);
    }

    return { message: parsed.message, actions, files: updatedFiles };
  }

  async processStreamingMessage(userId, projectId, userMessage, imageBase64, onChunk, signal, selectedElement = null) {
    signal?.throwIfAborted();
    const projectQuery = userId
      ? { _id: projectId, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
      : { _id: projectId };
    const project = await Project.findOne(projectQuery);
    if (!project) throw new NotFoundError('Project');
    project.files = await hydrateFiles(project.files);

    const conversation = await sessionManager.getOrCreateSession({
      projectId,
      userId,
      initialProject: project
    });

    conversation.messages.push({ role: 'user', content: userMessage });

    const messages = buildContext(project, conversation, userMessage, { selectedElement });
    
    const fullContent = await openRouterService.streamCompletion(messages, {}, onChunk);
    
    const { parsed, actions } = this._parseResponse(fullContent);
    const updatedFiles = await this.applyActions(project, actions, { signal, userMessage, selectedElement });
    project.files = updatedFiles;
    
    await sessionManager.recordCheckpoint(conversation, {
      prompt: userMessage,
      changeSummary: parsed.message || 'Agent modified project files',
      files: updatedFiles,
      activeCode: updatedFiles.find(f => f.path === 'src/App.jsx' || f.path === 'App.jsx')?.content,
      designTokens: project.settings?.theme || {},
      dependencies: project.dependencies,
      validation: project.validation
    });
    
    conversation.messages.push({
      role: 'assistant',
      content: parsed.message || 'Updated project.',
      actions
    });

    await project.save();
    await conversation.save();

    return { message: parsed.message, actions, files: updatedFiles };
  }

  async applyActions(project, actions, { model = openRouterService.model, tokens, signal, onProgress, userMessage = '', selectedElement = null } = {}) {
    signal?.throwIfAborted();
    const validation = validateActions(actions);
    if (!validation.valid || !validation.actions.length) {
      throw new AIError(`AI returned no valid file actions${validation.errors?.length ? `: ${validation.errors.join(', ')}` : '.'}`);
    }
    // fileManager mutates file objects; keep candidate edits detached from the stored document.
    const originalFiles = (project.files || []).map(({ path, content, language, encoding }) => ({ path, content, language, encoding }));
    const scopeOperations = validation.actions.map((action) => ({
      path: action.path,
      operation: action.type,
      search: action.search,
      replace: action.replace,
      content: action.content,
      reason: action.reason
    }));
    if (selectedElement) {
      incrementalEditor.validateStrictScopeOperations(userMessage, scopeOperations, originalFiles, selectedElement);
    }
    let currentFiles = originalFiles.map(file => ({ ...file }));
    for (const action of validation.actions) {
      if (action.type === 'create_file') {
        currentFiles = fileManager.createFile(currentFiles, action.path, action.content);
      } else if (action.type === 'modify_file') {
        currentFiles = fileManager.modifyFile(currentFiles, action.path, action.content);
      } else if (action.type === 'patch_file') {
        const target = currentFiles.find((file) => file.path === action.path);
        if (!target) throw new AIError(`Patch target file not found: ${action.path}`);
        const occurrences = target.content.split(action.search).length - 1;
        if (occurrences !== 1) {
          throw new AIError(`Patch search must match exactly once in ${action.path}; matched ${occurrences} times.`);
        }
        target.content = target.content.replace(action.search, action.replace);
      } else if (action.type === 'delete_file') {
        currentFiles = fileManager.deleteFile(currentFiles, action.path);
      }
    }
    if (currentFiles.length === originalFiles.length && currentFiles.every(file =>
      originalFiles.some(original => original.path === file.path && original.content === file.content))) {
      throw new AIError('AI file actions made no changes. The existing project was not changed.');
    }
    const pageOperations = validation.actions.map((action) => ({
      path: action.path,
      operation: action.type === 'create_file' ? 'create' : action.type === 'delete_file' ? 'delete' : action.type === 'patch_file' ? 'patch' : 'modify',
      content: action.content,
      search: action.search,
      replace: action.replace
    }));
    const pageVerification = incrementalEditor.validatePageIsolationResult(userMessage, pageOperations, originalFiles, currentFiles);

    // Do not turn an imported framework into a different app by adding a React skeleton.
    for (const files of [originalFiles, currentFiles]) {
      const manifest = files.find(file => file.path === 'package.json');
      let pkg;
      try { pkg = manifest ? JSON.parse(manifest.content) : null; } catch { /* Rejected below. */ }
      const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
      if ((project.settings?.framework && project.settings.framework !== 'react') ||
          ['next', 'nuxt', 'vue', 'svelte', '@angular/core', 'astro', 'react-native'].some(name => dependencies[name]) ||
          files.some(file => /\.(vue|svelte|astro)$|(?:^|\/)(next|nuxt|svelte|astro)\.config\./.test(file.path)) ||
          (manifest && (!pkg || ['build', 'preview'].some(script => typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script].trim()))) ||
          (!manifest && files.length && !files.some(file => file.path === 'src/App.jsx' || file.path === 'App.jsx' || file.path === 'src/App.js'))) {
        const error = new AppError('Unsupported project for agent validation: requires React sources or an existing React project with build and preview scripts. The project was not changed or verified.', 422);
        error.report = { status: 'blocked', stage: 'framework', reason: error.message, history: [], checks: [] };
        throw error;
      }
    }
    if (!currentFiles.some(file => file.path === 'package.json')) {
      if (!currentFiles.length || originalFiles.some(file => file.path === 'package.json')) {
        throw new AIError('AI actions removed the runnable project. The existing project was not changed.');
      }
      currentFiles = scaffoldReactProject(currentFiles.map(file => file.path === 'App.jsx' ? { ...file, path: 'src/App.jsx' } : file), {
        projectName: project.name, tokens
      });
    }
    const validated = await jobManager.validateCandidate(currentFiles, { model, tokens, signal, onProgress, pageVerification });
    signal?.throwIfAborted();
    project.validation = validated.report;
    return validated.files;
  }

  async handleErrorRecovery(userId, projectId, error, retryCount = 0, signal) {
    if (retryCount >= 3) throw new AIError('Max retries reached for error recovery');
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) throw new NotFoundError('Project');
    
    const prompt = `The application crashed with the following error: ${error.message}. Please fix it.`;
    return this.processMessage(userId, projectId, prompt, null, signal);
  }

  _parseResponse(content) {
    let rawJson = content;
    
    // Strip markdown code fences if present
    const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      rawJson = match[1];
    }

    try {
      const parsed = JSON.parse(rawJson);
      const validation = validateActions(parsed.actions || []);
      if (!validation.valid || !validation.actions.length) {
        throw new AIError(`AI Actions Validation Failed: ${validation.errors?.join(', ') || 'No file actions returned'}`);
      }
      return { parsed, actions: validation.actions };
    } catch (e) {
      logger.error(`Failed to parse AI response: ${e.message}`);
      if (e instanceof AIError) throw e;
      throw new AIError('Invalid response format from AI');
    }
  }

  async _createVersion(project, userId) {
    const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });
    const newVersion = new ProjectVersion({
      projectId: project._id,
      userId: userId || null,
      version: versionCount + 1,
      label: `Auto-save v${versionCount + 1}`,
      files: project.files,
      dependencies: project.dependencies
    });
    await newVersion.save();
  }

  async _trackUsage(userId, projectId, model, usage) {
    const aiUsage = new AIUsage({
      userId,
      projectId,
      model,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    });
    await aiUsage.save();
  }
}

module.exports = new AgentService();
