/**
 * Commit worker: the only place a generated project is written to, or restored in, the database.
 *
 *   snapshotForRollback  what is needed to undo this job's write (taken BEFORE writing)
 *   writeProject         create the project, or update it only if nobody changed it since validation (optimistic concurrency)
 *   rollbackCommit       undo a write whose bookkeeping failed, without overwriting a newer user edit
 *   buildProvenance      the record of where the project came from (clone, template, prototype)
 *
 * A failed validation never reaches this worker; the orchestrator only calls it with a validated report.
 */
const Project = require('../../../models/Project');
const ProjectFile = require('../../../models/ProjectFile');
const logger = require('../../../utils/logger');
const templateService = require('../../templates/templateService');
const { dehydrateFiles } = require('../../storage/s3BlobStorage');
const AIUsage = require('../../../models/AIUsage');
const GenerationJob = require('../../../models/GenerationJob');
const sessionManager = require('../sessionManager');

async function syncProjectFilesTable(projectId, userId, files = []) {
  if (!projectId || !Array.isArray(files) || files.length === 0) return;
  try {
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
            content: String(f.content || ''),
            language: f.language || 'javascript',
            encoding: f.encoding || 'utf8',
            blob: f.blob || null,
            size: f.blob?.size ?? (f.encoding === 'base64' ? Buffer.byteLength(f.content || '', 'base64') : Buffer.byteLength(f.content || '', 'utf8')),
            isBinary: f.encoding === 'base64'
          }
        },
        upsert: true
      }
    }));
    if (ops.length) await ProjectFile.bulkWrite(ops, { ordered: false });
  } catch (err) {
    logger.warn(`Failed to sync project_files collection for ${projectId}: ${err.message}`);
  }
}

/** Undo information for the project write; used if anything after it fails so "failed" really means "unchanged". */
function snapshotForRollback({ project, validated }) {
  const appliedHash = validated?.report?.sourceHash || null;
  return project
    ? { created: false, projectId: project._id, files: project.files, validation: project.validation, provenance: project.provenance || null, appliedHash }
    : { created: true, projectId: null, appliedHash };
}

function buildProvenance({ cloneCapture, captureBlob, captureAssets, template, templateTokenInfo, templateRestored, degradedInfo, prototypeReport, prototypeUrl }) {
  if (cloneCapture) {
    return {
      type: 'website-clone',
      sourceUrl: cloneCapture.sourceUrl,
      canonicalUrl: cloneCapture.canonicalUrl,
      capturedAt: cloneCapture.capturedAt,
      routes: cloneCapture.pages.map(({ path, title, description, headings, sections }) => ({
        path,
        title,
        description,
        headings: (headings || []).slice(0, 12),
        sections: (sections || []).slice(0, 20).map(({ tag, id, text }) => ({ tag, id, text }))
      })),
      ...(captureBlob ? { captureAssetsBlob: captureBlob } : { assets: captureAssets, assetQueue: cloneCapture.assetQueue }),
      coverage: cloneCapture.coverage,
      siteMap: cloneCapture.siteMap,
      urlRegistry: cloneCapture.urlRegistry
    };
  }
  if (template) {
    return {
      type: 'template',
      templateId: template.id,
      templateVersion: template.version,
      template: { ...templateService.provenanceFor(template, templateTokenInfo || undefined), usedTemplateOnly: Boolean(degradedInfo), restored: templateRestored }
    };
  }
  if (prototypeReport) return { type: 'website-prototype', sourceUrl: prototypeUrl, mode: prototypeReport.mode, status: 'complete', report: { mode: prototypeReport.mode, headline: prototypeReport.headline, counts: prototypeReport.counts, missingEvidence: prototypeReport.missingEvidence.slice(0, 40) } };
  return null;
}

/**
 * @returns {{ project, created }}
 * @throws when an existing project changed during validation (newer edits are preserved)
 */
async function writeProject({ project, userId, projectName, prompt, template, files, validation, systemTokens, designSystem, model, tokenUsage, provenance, recrawlResult = null }) {
  if (!project) {
    const created = await Project.create({
      userId: userId || null,
      name: projectName,
      description: prompt.trim(),
      template: template ? { id: template.id, version: template.version } : null,
      files,
      validation,
      settings: {
        framework: 'react',
        styling: 'tailwindcss',
        designSystem: systemTokens.mood || designSystem,
        theme: {
          primary: systemTokens.primary,
          secondary: systemTokens.secondary,
          background: systemTokens.bg,
          foreground: systemTokens.text,
          radius: systemTokens.radius
        },
        aiModel: model,
        lastTokenUsage: tokenUsage
      },
      provenance
    });
    return { project: created, created: true };
  }
  const saved = await Project.findOneAndUpdate({ _id: project._id, updatedAt: project.updatedAt },
    { $set: { files, validation, ...(recrawlResult ? { 'provenance.routes': recrawlResult.routes, 'provenance.siteMap': recrawlResult.siteMap } : {}) } }, { new: true });
  if (!saved) throw new Error('Project changed during validation. Newer edits were preserved; submit the modification again.');
  return { project: saved, created: false };
}

/**
 * Undo a project write whose bookkeeping failed. New projects are removed. Existing projects are restored only if
 * they still hold the revision this job wrote, so a newer user edit is never overwritten.
 * Blobs in S3 are content-addressed (sha256 keys), so uploaded blobs need no per-job cleanup: they are shared,
 * immutable and harmless if unreferenced.
 */
async function rollbackCommit(rollback) {
  if (!rollback?.projectId) return false;
  if (rollback.created) {
    await Project.deleteOne({ _id: rollback.projectId });
    await ProjectFile.deleteMany({ projectId: rollback.projectId });
    return true;
  }
  const previousFiles = await dehydrateFiles(rollback.files);
  const restored = await Project.findOneAndUpdate(
    { _id: rollback.projectId, 'validation.sourceHash': rollback.appliedHash },
    { $set: { files: previousFiles, validation: rollback.validation, provenance: rollback.provenance } },
    { new: true }
  );
  if (!restored) return false; // somebody edited since; their newer revision wins
  await syncProjectFilesTable(restored._id, restored.userId, previousFiles);
  return true;
}

/**
 * Records the session checkpoint and the conversation turn for a saved revision.
 * @returns {{ generationId, parentGenId, versionNumber }}
 */
async function recordConversationTurn({ conversation, prompt, changeSummary, files, activeCode, designTokens, project, validation, appliedOperations = [], changedPaths = [], targetVerification = null }) {
  await sessionManager.recordCheckpoint(conversation, { prompt, changeSummary, files, activeCode, designTokens, dependencies: project.dependencies, validation });
  const generationId = conversation.activeGenerationId;
  const parentGenId = conversation.checkpoints.length > 1 ? conversation.checkpoints[conversation.checkpoints.length - 2]?.checkpointId : null;
  const versionNumber = conversation.checkpoints.length;
  conversation.messages.push({ role: 'user', content: prompt, generationId, timestamp: new Date() });
  conversation.messages.push({
    role: 'assistant',
    content: `Applied changes: ${changeSummary}`,
    generationId,
    changeSummary,
    actions: appliedOperations.map((operation) => ({ type: `${operation.operation || 'modify'}_file`, path: operation.path, reason: operation.reason || '' })),
    meta: { changedPaths, targetVerification },
    timestamp: new Date()
  });
  if (conversation.checkpoints.length > 3) {
    const genSummaries = conversation.checkpoints.map((g) => `Step ${g.stepNumber}: ${g.changeSummary || g.userPrompt}`).slice(-6);
    conversation.contextSummary = genSummaries.join('; ');
  }
  await conversation.save();
  return { generationId, parentGenId, versionNumber };
}

/** The AI usage record of a job. Never fails the job. */
async function recordUsage({ jobId, userId, projectId, tokenUsage, durationMs }) {
  if (!tokenUsage) return;
  try {
    await AIUsage.create({
      userId: userId || undefined,
      projectId,
      model: tokenUsage.modelUsed,
      provider: tokenUsage.provider,
      inputTokens: tokenUsage.promptTokens,
      outputTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens,
      usageSource: tokenUsage.usageSource || 'reported',
      cost: tokenUsage.costReported ? tokenUsage.cost : 0,
      requestDuration: durationMs
    });
  } catch (error) {
    logger.warn(`Failed to record AIUsage for job ${jobId}: ${error.message}`);
  }
}

/**
 * Charges the user once per job, never for a degraded fallback site (it used no AI work). The claim makes a retried or recovered
 * job idempotent; a failed charge releases the claim.
 * @returns {Promise<number|null>} the user's credits after the charge, or null when nothing was charged
 */
async function chargeOnce({ jobId, userId, tokenUsage, projectId, degraded = false }) {
  if (!userId || degraded) return null;
  const claimed = await GenerationJob.findOneAndUpdate({ jobId, creditChargedAt: null }, { $set: { creditChargedAt: new Date() } });
  if (!claimed) return null;
  try {
    const updatedUser = await require('../../billing/usageService').chargeCredits(userId, tokenUsage?.totalTokens, { projectId });
    return updatedUser ? updatedUser.credits : null;
  } catch (billingError) {
    await GenerationJob.updateOne({ jobId }, { $set: { creditChargedAt: null } }).catch(() => {});
    logger.error(`Job ${jobId} credit deduction failed: ${billingError.message}`);
    return null;
  }
}

module.exports = { recordConversationTurn, recordUsage, chargeOnce, snapshotForRollback, buildProvenance, writeProject, rollbackCommit, syncProjectFilesTable };
