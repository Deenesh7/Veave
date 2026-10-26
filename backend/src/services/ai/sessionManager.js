const Conversation = require('../../models/Conversation');
const Project = require('../../models/Project');
const ProjectFile = require('../../models/ProjectFile');
const logger = require('../../utils/logger');
const mongoose = require('mongoose');
const { hydrateFiles } = require('../storage/s3BlobStorage');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // Legacy
const MAX_CHECKPOINTS = 100000;
const configuredCheckpointBytes = Number.parseInt(process.env.MAX_SESSION_CHECKPOINT_BYTES, 10);
// A MongoDB document cannot exceed 16 MB, and the whole conversation (every checkpoint's source) lives in one document.
// So history is always bounded: 0 or a larger value in the environment still cannot go above this ceiling.
const HARD_CHECKPOINT_CEILING = 12 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = configuredCheckpointBytes > 0
  ? Math.min(HARD_CHECKPOINT_CEILING, Math.max(1024 * 1024, configuredCheckpointBytes))
  : HARD_CHECKPOINT_CEILING;

function filesHash(files) {
  if (!Array.isArray(files)) return '';
  try {
    return files
      .filter(f => f && typeof f === 'object')
      .map(f => `${f.path || ''}:${f.content ? f.content.length : 0}:${f.content || ''}`)
      .sort()
      .join('|');
  } catch (err) {
    logger.warn(`[SessionManager] filesHash error: ${err.message}`);
    return '';
  }
}

function sourceSnapshot(files = []) {
  return files
    .filter((file) => file?.encoding !== 'base64')
    .map((file) => ({ path: file.path, content: file.content, language: file.language, encoding: file.encoding || 'utf8' }));
}

function restoreWithBinaryAssets(snapshot = [], currentFiles = []) {
  const binaries = currentFiles
    .filter((file) => file?.encoding === 'base64')
    .map((file) => ({ path: file.path, content: file.content, language: file.language, encoding: 'base64', blob: file.blob || null }));
  const sourcePaths = new Set(snapshot.map((file) => file.path));
  return [...snapshot, ...binaries.filter((file) => !sourcePaths.has(file.path))];
}

async function syncProjectFilesTable(projectId, userId, files = []) {
  if (!projectId || !Array.isArray(files) || files.length === 0) return;
  try {
    // Files belong to the project's owner, not to whichever collaborator happened to trigger this write.
    const projectOwner = await Project.findById(projectId).select('userId').lean();
    if (projectOwner) userId = projectOwner.userId || null;
    const paths = files.map(f => f.path);
    await ProjectFile.deleteMany({ projectId, path: { $nin: paths } });
    const ops = files.map(f => ({
      updateOne: {
        filter: { projectId, path: f.path },
        update: {
          $set: {
            projectId,
            userId: userId || null,
            path: f.path,
            content: f.content,
            language: f.language,
            encoding: f.encoding || 'utf8',
            blob: f.blob || null,
            size: f.blob?.size ?? (f.encoding === 'base64' ? Buffer.byteLength(f.content || '', 'base64') : Buffer.byteLength(f.content || '', 'utf8')),
            isBinary: f.encoding === 'base64'
          }
        },
        upsert: true
      }
    }));
    await ProjectFile.bulkWrite(ops);
  } catch (err) {
    logger.warn(`[SessionManager] Failed to sync project_files: ${err.message}`);
  }
}

class SessionManager {
  constructor() {
    this.TTL_MS = SESSION_TTL_MS;
    this.MAX_CHECKPOINTS = MAX_CHECKPOINTS;
  }

  /**
   * Retrieves an active session or creates a new one scoped to the project.
   * Enforces 1-day retention: if an existing session is expired, it is cleared
   * and a fresh session is seeded with the project's current state.
   */
  async getOrCreateSession({ conversationId, projectId, userId, initialProject, prompt }) {
    let session = null;
    let resolvedConversationId = conversationId;

    if (conversationId) {
      session = await Conversation.findOne({ conversationId });
      if (session && projectId && session.projectId && session.projectId.toString() !== projectId.toString()) {
        session = null;
        resolvedConversationId = null;
      }
    }
    if (!session && projectId && mongoose.Types.ObjectId.isValid(projectId)) {
      const q = Conversation.findOne({ projectId });
      session = typeof q?.sort === 'function' ? await q.sort({ updatedAt: -1 }) : await q;
    }

    const now = new Date();

    // Note: 1-day retention limit was intentionally removed to keep conversation history from the start.
    if (!session) {
      const finalConvId = resolvedConversationId || `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      session = new Conversation({
        conversationId: finalConvId,
        projectId: projectId || (initialProject ? initialProject._id : null),
        userId: userId || null,
        title: prompt ? prompt.slice(0, 45).trim() : 'Project Session',
        lastActivityAt: now,
        currentIndex: 0,
        checkpoints: [],
        generations: [],
        messages: []
      });
    }

    // Seed Checkpoint 1 if session has no checkpoints and project files are available
    const proj = initialProject || (session.projectId ? await Project.findById(session.projectId) : null);
    if (proj?.files?.length && proj.files.some((file) => file.blob && !file.content)) proj.files = await hydrateFiles(proj.files);
    if (session.checkpoints.length === 0 && proj && Array.isArray(proj.files) && proj.files.length > 0) {
      const initCpId = `cp_init_${Date.now()}`;
      const initFiles = sourceSnapshot(proj.files);
      const activeCode = initFiles.find(f => f.path === 'src/App.jsx' || f.path === 'App.jsx')?.content || '';
      
      const initCp = {
        checkpointId: initCpId,
        stepNumber: 1,
        userPrompt: proj.description || prompt || 'Initial project state',
        changeSummary: 'Initial project state',
        filesSnapshot: initFiles,
        activeCode,
        designTokens: proj.settings?.theme || {},
        dependencies: proj.dependencies || ['react', 'react-dom'],
        validation: proj.validation || null,
        timestamp: now
      };

      session.checkpoints.push(initCp);
      session.generations.push({
        generationId: initCpId,
        versionNumber: 1,
        userPrompt: initCp.userPrompt,
        changeSummary: initCp.changeSummary,
        timestamp: now
      });
      session.activeGenerationId = initCpId;
      session.currentIndex = 0;
      session.latestState = {
        files: [],
        activeCode,
        designTokens: initCp.designTokens,
        dependencies: initCp.dependencies,
        validation: initCp.validation,
        updatedAt: now
      };
    }

    if (projectId && !session.projectId) {
      session.projectId = projectId;
    }

    // Refresh activity and 1-day expiration
    session.lastActivityAt = now;
    session.expiresAt = new Date(Date.now() + this.TTL_MS);

    await session.save();
    await this.ensureFullConversationHistory(session);
    return session;
  }

  /**
   * Ensures that all past conversation turns from the start of the project are present.
   * Pulls in:
   * 1. Initial creation prompt from project.description
   * 2. All completed GenerationJobs for the project
   * 3. All session checkpoints
   * Preserves chronological order and persists to session.messages.
   */
  async ensureFullConversationHistory(session) {
    if (!session || !session.projectId) return session;

    try {
      const Project = require('../../models/Project');
      const GenerationJob = require('../../models/GenerationJob');

      const project = await Project.findById(session.projectId);
      if (!project) return session;

      const jobs = await GenerationJob.find({
        projectId: session.projectId,
        status: 'completed'
      }).sort({ createdAt: 1 });

      let messages = Array.isArray(session.messages) ? [...session.messages] : [];

      // Check if we already have the initial creation turn from the very start
      const initialPrompt = project.description || session.title || 'Create prototype application';
      const hasInitialPrompt = messages.some(
        m => m.role === 'user' && (m.isInitial || m.content === initialPrompt || (project.description && m.content === project.description))
      );

      const initialDate = project.createdAt || (session.checkpoints && session.checkpoints[0]?.timestamp) || new Date();

      if (!hasInitialPrompt && initialPrompt) {
        const initGenId = (session.checkpoints && session.checkpoints[0]?.checkpointId) || 'cp_init';
        messages.unshift(
          {
            role: 'user',
            content: initialPrompt,
            isInitial: true,
            generationId: initGenId,
            timestamp: initialDate
          },
          {
            role: 'assistant',
            content: `Created the initial design for "${project.name || 'your project'}". Component architecture, responsive layout, and styles have been synthesized.`,
            isInitial: true,
            generationId: initGenId,
            changeSummary: 'Initial project creation',
            timestamp: new Date(new Date(initialDate).getTime() + 1000)
          }
        );
      }

      // Merge all completed generation jobs that are not yet in messages
      for (const job of jobs) {
        const jobPrompt = job.payload?.prompt;
        if (!jobPrompt || jobPrompt === initialPrompt) continue;

        const alreadyExists = messages.some(
          m => m.role === 'user' && (m.content === jobPrompt || (m.generationId && m.generationId === (job.generationId || job.jobId)))
        );

        if (!alreadyExists) {
          const jobTime = job.createdAt || new Date();
          const genId = job.generationId || job.jobId || `job_${job._id}`;
          const summary = job.changeSummary || (job.result?.summary) || `Updated ${project.name}`;

          messages.push({
            role: 'user',
            content: jobPrompt,
            generationId: genId,
            timestamp: jobTime
          });

          messages.push({
            role: 'assistant',
            content: `Applied changes: ${summary}`,
            generationId: genId,
            changeSummary: summary,
            timestamp: job.completedAt || new Date(new Date(jobTime).getTime() + 1000)
          });
        }
      }

      // Merge any session checkpoints that have a user prompt
      if (Array.isArray(session.checkpoints)) {
        for (const cp of session.checkpoints) {
          if (!cp.userPrompt || cp.userPrompt === 'Initial project state' || cp.userPrompt === initialPrompt) continue;

          const alreadyExists = messages.some(
            m => m.role === 'user' && (m.content === cp.userPrompt || m.generationId === cp.checkpointId)
          );

          if (!alreadyExists) {
            const cpTime = cp.timestamp || new Date();
            messages.push({
              role: 'user',
              content: cp.userPrompt,
              generationId: cp.checkpointId,
              timestamp: cpTime
            });

            messages.push({
              role: 'assistant',
              content: cp.changeSummary ? `Applied changes: ${cp.changeSummary}` : 'Updated project.',
              generationId: cp.checkpointId,
              changeSummary: cp.changeSummary || '',
              timestamp: new Date(new Date(cpTime).getTime() + 1000)
            });
          }
        }
      }

      // Sort all messages chronologically from the start to the latest
      messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

      session.messages = messages;
      await session.save();
    } catch (err) {
      logger.warn(`[SessionManager] ensureFullConversationHistory error: ${err.message}`);
    }

    return session;
  }

  /**
   * Retrieves an active session by conversationId or projectId
   */
  async getSession(id) {
    if (!id) return null;
    let session = await Conversation.findOne({ conversationId: id });
    if (!session && mongoose.Types.ObjectId.isValid(id)) {
      const q = Conversation.findOne({ projectId: id });
      session = typeof q?.sort === 'function' ? await q.sort({ updatedAt: -1 }) : await q;
    }

    if (session) {
      await this.ensureFullConversationHistory(session);
    }

    return session;
  }

  /**
   * Records a new checkpoint in the session when actual project changes occur.
   * Truncates undone future checkpoints (standard undo-stack branching),
   * applies FIFO pruning to maintain manageable size, and preserves latestState.
   */
  async recordCheckpoint(session, {
    prompt = '',
    changeSummary = '',
    files = [],
    activeCode = '',
    designTokens = {},
    dependencies = ['react', 'react-dom'],
    validation = null
  }) {
    if (!session || !Array.isArray(files) || files.length === 0) return session;

    const now = new Date();

    // Binary clone assets stay authoritative in Project/ProjectFile storage.
    // Repeating base64 in each checkpoint can exceed MongoDB's BSON limit.
    const sanitizedFiles = sourceSnapshot(files);
    const snapshotSize = (list) => list.reduce((sum, file) => sum + Buffer.byteLength(String(file.content || ''), 'utf8') + String(file.path || '').length, 0);

    // A single revision larger than the history budget cannot be stored in the conversation document. The project itself
    // is already saved; only this undo step is skipped, never a half-written checkpoint.
    if (snapshotSize(sanitizedFiles) > MAX_CHECKPOINT_BYTES) {
      logger.warn(`[SessionManager] Source is ${Math.round(snapshotSize(sanitizedFiles) / 1048576)} MB, above the ${Math.round(MAX_CHECKPOINT_BYTES / 1048576)} MB history limit: no undo checkpoint recorded for "${String(prompt).slice(0, 60)}".`);
      session.lastActivityAt = now;
      session.expiresAt = new Date(Date.now() + this.TTL_MS);
      await session.save();
      return session;
    }

    // Deduplication: if files did not change compared to current active checkpoint, skip duplicate checkpoint
    const currentCp = session.checkpoints[session.currentIndex];
    if (currentCp && filesHash(currentCp.filesSnapshot) === filesHash(sanitizedFiles)) {
      session.lastActivityAt = now;
      session.expiresAt = new Date(Date.now() + this.TTL_MS);
      await session.save();
      return session;
    }

    // Branching: If the user previously did Undo and is now making a new change,
    // discard forward redo history so we have a clean linear history.
    if (session.currentIndex >= 0 && session.currentIndex < session.checkpoints.length - 1) {
      session.checkpoints = session.checkpoints.slice(0, session.currentIndex + 1);
      session.generations = session.generations.slice(0, session.currentIndex + 1);
    }

    const previousCp = session.checkpoints[session.checkpoints.length - 1];
    const stepNumber = previousCp ? (previousCp.stepNumber + 1) : (session.checkpoints.length + 1);
    const checkpointId = `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rootCode = activeCode || sanitizedFiles.find(f => f.path === 'src/App.jsx' || f.path === 'App.jsx')?.content || '';

    const newCheckpoint = {
      checkpointId,
      stepNumber,
      userPrompt: prompt || 'Updated project',
      changeSummary: changeSummary || `Checkpoint ${stepNumber}`,
      filesSnapshot: sanitizedFiles,
      activeCode: rootCode,
      designTokens: designTokens || {},
      dependencies: dependencies || ['react', 'react-dom'],
      validation: validation || null,
      timestamp: now
    };

    session.checkpoints.push(newCheckpoint);

    // Keep generations array in sync for Lineage UI
    session.generations.push({
      generationId: checkpointId,
      parentGenerationId: previousCp ? previousCp.checkpointId : null,
      versionNumber: stepNumber,
      userPrompt: newCheckpoint.userPrompt,
      changeSummary: newCheckpoint.changeSummary,
      timestamp: now
    });

    // Bounded FIFO pruning: ensure checkpoints do not exceed MAX_CHECKPOINTS
    while (session.checkpoints.length > this.MAX_CHECKPOINTS) {
      session.checkpoints.shift();
      session.generations.shift();
    }
    const snapshotBytes = () => session.checkpoints.reduce((total, checkpoint) => total + (checkpoint.filesSnapshot || [])
      .reduce((sum, file) => sum + Buffer.byteLength(String(file.content || ''), 'utf8') + String(file.path || '').length, 0), 0);
    while (session.checkpoints.length > 1 && snapshotBytes() > MAX_CHECKPOINT_BYTES) {
      session.checkpoints.shift();
      session.generations.shift();
    }

    // Update active cursor and latest state
    session.currentIndex = session.checkpoints.length - 1;
    session.activeGenerationId = checkpointId;
    session.latestState = {
      files: [],
      activeCode: rootCode,
      designTokens: newCheckpoint.designTokens,
      dependencies: newCheckpoint.dependencies,
      validation: newCheckpoint.validation,
      updatedAt: now
    };

    session.lastActivityAt = now;
    session.expiresAt = new Date(Date.now() + this.TTL_MS);

    await session.save();
    return session;
  }

  /**
   * Undo: Reverts the project to the immediately previous checkpoint in this session.
   * Multiple undos move backward step-by-step through session history.
   * Does NOT reload or recreate the session.
   */
  async undo(id, userId = null) {
    const session = await this.getSession(id);
    if (!session) throw new Error('Session not found or expired');

    if (!Array.isArray(session.checkpoints) || session.checkpoints.length <= 1 || session.currentIndex <= 0) {
      throw new Error('No previous session checkpoint to undo');
    }

    session.currentIndex -= 1;
    const targetCp = session.checkpoints[session.currentIndex];
    session.activeGenerationId = targetCp.checkpointId;

    const project = await Project.findById(session.projectId);
    if (!project) throw new Error('Project not found');

    // Restore verified state cleanly without running slow full runner validation
    project.files = restoreWithBinaryAssets(targetCp.filesSnapshot, project.files);
    if (targetCp.validation) {
      project.validation = targetCp.validation;
    }
    if (targetCp.dependencies) {
      project.dependencies = targetCp.dependencies;
    }
    if (targetCp.designTokens && Object.keys(targetCp.designTokens).length > 0) {
      project.settings = project.settings || {};
      project.settings.theme = {
        ...(project.settings.theme || {}),
        primary: targetCp.designTokens.primary || project.settings.theme?.primary,
        background: targetCp.designTokens.bg || project.settings.theme?.background,
        radius: targetCp.designTokens.radius || project.settings.theme?.radius
      };
    }

    await project.save();
    require('../search/projectIndexHooks').invalidate(project._id); // undo/redo/restore changed the saved files
    await syncProjectFilesTable(project._id, userId, project.files);

    const rollbackSummary = `Reverted to Checkpoint ${targetCp.stepNumber}: "${targetCp.changeSummary || targetCp.userPrompt}"`;

    session.messages.push({
      role: 'assistant',
      content: `${rollbackSummary}. Interface state successfully restored.`,
      generationId: targetCp.checkpointId,
      changeSummary: rollbackSummary,
      actions: [{ type: 'rollback', path: 'src/App.jsx', reason: 'User requested session undo' }],
      timestamp: new Date()
    });

    session.lastActivityAt = new Date();
    session.expiresAt = new Date(Date.now() + this.TTL_MS);

    await session.save();

    return {
      success: true,
      project,
      conversation: this.formatSessionResponse(session),
      restoredGeneration: {
        generationId: targetCp.checkpointId,
        versionNumber: targetCp.stepNumber,
        userPrompt: targetCp.userPrompt,
        changeSummary: targetCp.changeSummary
      },
      activeGenerationId: targetCp.checkpointId,
      canUndo: session.currentIndex > 0,
      canRedo: session.currentIndex < session.checkpoints.length - 1,
      currentIndex: session.currentIndex
    };
  }

  /**
   * Redo: Moves forward to the next checkpoint in this session.
   */
  async redo(id, userId = null) {
    const session = await this.getSession(id);
    if (!session) throw new Error('Session not found or expired');

    if (!Array.isArray(session.checkpoints) || session.currentIndex >= session.checkpoints.length - 1) {
      throw new Error('No forward session checkpoint to redo');
    }

    session.currentIndex += 1;
    const targetCp = session.checkpoints[session.currentIndex];
    session.activeGenerationId = targetCp.checkpointId;

    const project = await Project.findById(session.projectId);
    if (!project) throw new Error('Project not found');

    project.files = restoreWithBinaryAssets(targetCp.filesSnapshot, project.files);
    if (targetCp.validation) {
      project.validation = targetCp.validation;
    }
    if (targetCp.dependencies) {
      project.dependencies = targetCp.dependencies;
    }
    if (targetCp.designTokens && Object.keys(targetCp.designTokens).length > 0) {
      project.settings = project.settings || {};
      project.settings.theme = {
        ...(project.settings.theme || {}),
        primary: targetCp.designTokens.primary || project.settings.theme?.primary,
        background: targetCp.designTokens.bg || project.settings.theme?.background,
        radius: targetCp.designTokens.radius || project.settings.theme?.radius
      };
    }

    await project.save();
    require('../search/projectIndexHooks').invalidate(project._id); // undo/redo/restore changed the saved files
    await syncProjectFilesTable(project._id, userId, project.files);

    const redoSummary = `Restored forward to Checkpoint ${targetCp.stepNumber}: "${targetCp.changeSummary || targetCp.userPrompt}"`;

    session.messages.push({
      role: 'assistant',
      content: `${redoSummary}. Interface state successfully restored.`,
      generationId: targetCp.checkpointId,
      changeSummary: redoSummary,
      actions: [{ type: 'redo', path: 'src/App.jsx', reason: 'User requested session redo' }],
      timestamp: new Date()
    });

    session.lastActivityAt = new Date();
    session.expiresAt = new Date(Date.now() + this.TTL_MS);

    await session.save();

    return {
      success: true,
      project,
      conversation: this.formatSessionResponse(session),
      restoredGeneration: {
        generationId: targetCp.checkpointId,
        versionNumber: targetCp.stepNumber,
        userPrompt: targetCp.userPrompt,
        changeSummary: targetCp.changeSummary
      },
      activeGenerationId: targetCp.checkpointId,
      canUndo: session.currentIndex > 0,
      canRedo: session.currentIndex < session.checkpoints.length - 1,
      currentIndex: session.currentIndex
    };
  }

  /**
   * Jump directly to a specific checkpoint in the session (Lineage UI Restore)
   */
  async restoreToCheckpoint(id, targetCheckpointId, userId = null) {
    const session = await this.getSession(id);
    if (!session) throw new Error('Session not found or expired');

    const targetIdx = session.checkpoints.findIndex(
      cp => cp.checkpointId === targetCheckpointId || (cp.stepNumber && String(cp.stepNumber) === String(targetCheckpointId))
    );
    if (targetIdx === -1) {
      throw new Error('Target checkpoint not found in session');
    }

    session.currentIndex = targetIdx;
    const targetCp = session.checkpoints[targetIdx];
    session.activeGenerationId = targetCp.checkpointId;

    const project = await Project.findById(session.projectId);
    if (!project) throw new Error('Project not found');

    project.files = restoreWithBinaryAssets(targetCp.filesSnapshot, project.files);
    if (targetCp.validation) project.validation = targetCp.validation;
    if (targetCp.dependencies) project.dependencies = targetCp.dependencies;
    await project.save();
    require('../search/projectIndexHooks').invalidate(project._id); // undo/redo/restore changed the saved files
    await syncProjectFilesTable(project._id, userId, project.files);

    const summary = `Restored to Checkpoint ${targetCp.stepNumber}: "${targetCp.changeSummary || targetCp.userPrompt}"`;
    session.messages.push({
      role: 'assistant',
      content: `${summary}. Project state restored.`,
      generationId: targetCp.checkpointId,
      changeSummary: summary,
      actions: [{ type: 'rollback', path: 'src/App.jsx', reason: 'User selected checkpoint in Lineage' }],
      timestamp: new Date()
    });

    session.lastActivityAt = new Date();
    session.expiresAt = new Date(Date.now() + this.TTL_MS);

    await session.save();

    return {
      success: true,
      project,
      conversation: this.formatSessionResponse(session),
      restoredGeneration: {
        generationId: targetCp.checkpointId,
        versionNumber: targetCp.stepNumber,
        userPrompt: targetCp.userPrompt,
        changeSummary: targetCp.changeSummary
      },
      activeGenerationId: targetCp.checkpointId,
      canUndo: session.currentIndex > 0,
      canRedo: session.currentIndex < session.checkpoints.length - 1,
      currentIndex: session.currentIndex
    };
  }

  /**
   * Returns formatted session response for the client and Lineage UI.
   * Strips bloated file snapshots from lineage tree items for fast responses.
   */
  formatSessionResponse(session) {
    if (!session) return null;

    try {
      const checkpoints = Array.isArray(session.checkpoints) ? session.checkpoints : [];
      const currentIndex = session.currentIndex !== undefined ? session.currentIndex : (checkpoints.length - 1);
      const activeGenId = session.activeGenerationId || (checkpoints[currentIndex]?.checkpointId) || null;

      const generations = checkpoints.map((cp, idx) => ({
        generationId: cp?.checkpointId || `cp_${idx}`,
        parentGenerationId: idx > 0 ? (checkpoints[idx - 1]?.checkpointId || null) : null,
        versionNumber: cp?.stepNumber || (idx + 1),
        userPrompt: cp?.userPrompt || 'Project state',
        changeSummary: cp?.changeSummary || '',
        timestamp: cp?.timestamp || new Date(),
        isActive: (cp?.checkpointId && cp.checkpointId === activeGenId) || idx === currentIndex
      }));

      return {
        _id: session._id,
        conversationId: session.conversationId,
        projectId: session.projectId,
        title: session.title,
        activeGenerationId: activeGenId,
        currentIndex,
        canUndo: currentIndex > 0,
        canRedo: currentIndex < checkpoints.length - 1,
        generations,
        messages: Array.isArray(session.messages) ? session.messages : [],
        designSystemSummary: session.designSystemSummary || {},
        contextSummary: session.contextSummary || '',
        expiresAt: session.expiresAt,
        lastActivityAt: session.lastActivityAt
      };
    } catch (err) {
      logger.warn(`[SessionManager] formatSessionResponse error: ${err.message}`);
      return null;
    }
  }
  async cleanupExpiredSessions() {
    // Preserve all conversation sessions permanently from the start
    return 0;
  }
}

module.exports = new SessionManager();
