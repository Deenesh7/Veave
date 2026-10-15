/**
 * VEAVE Prompt Engine — HTTP controller.
 *
 * Endpoints:
 *   POST   /api/prompt/generate            compile a user prompt into a UI spec + final prompt
 *   POST   /api/prompt/preview             (dry-run — do not persist)
 *   GET    /api/prompt                     list current user's prompt runs
 *   GET    /api/prompt/:id                 fetch one prompt run (owner-only)
 *   DELETE /api/prompt/:id                 delete a prompt run
 *   GET    /api/prompt/config/providers    list configured LLM providers
 */

const PromptRun    = require('../models/PromptRun');
const promptEngine = require('../services/prompt/promptEngine');
const llmService   = require('../services/llm');
const logger       = require('../utils/logger');
const {
  ValidationError, AIError, NotFoundError
} = require('../utils/errors');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;      // 5 MB
const ALLOWED_MIME    = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function readReferenceImage(req) {
  // multer.memoryStorage() puts the file on req.file
  if (req.file && req.file.buffer) {
    if (!ALLOWED_MIME.includes(req.file.mimetype)) {
      throw new ValidationError('Unsupported reference image type. Use PNG, JPEG, WEBP or GIF.');
    }
    if (req.file.size > MAX_IMAGE_BYTES) {
      throw new ValidationError('Reference image is too large (max 5 MB).');
    }
    return {
      base64: req.file.buffer.toString('base64'),
      mimeType: req.file.mimetype,
      size: req.file.size
    };
  }

  // JSON body path: { referenceImage: { base64, mimeType } }
  const ri = req.body?.referenceImage;
  if (ri && typeof ri === 'object' && ri.base64) {
    if (ri.mimeType && !ALLOWED_MIME.includes(ri.mimeType)) {
      throw new ValidationError('Unsupported reference image type.');
    }
    const approxBytes = Math.floor((ri.base64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      throw new ValidationError('Reference image is too large (max 5 MB).');
    }
    return {
      base64: ri.base64,
      mimeType: ri.mimeType || 'image/png',
      size: approxBytes
    };
  }

  return null;
}

function parseJsonMaybe(v) {
  if (!v || typeof v !== 'string') return v;
  const t = v.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    try { return JSON.parse(t); } catch { /* ignore */ }
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* POST /api/prompt/generate                                          */
/* ------------------------------------------------------------------ */

exports.generate = async (req, res, next) => {
  const startedAt = Date.now();
  let run = null;

  try {
    const body = req.body || {};
    const userPrompt = String(body.userPrompt || body.prompt || '').trim();
    const framework    = String(body.framework    || 'react');
    const designSystem = String(body.designSystem || 'veave');
    const model        = String(body.model        || 'auto');
    const projectContext = parseJsonMaybe(body.projectContext);
    const projectId    = body.projectId || null;

    if (!userPrompt) {
      throw new ValidationError('userPrompt is required.');
    }

    const referenceImage = readReferenceImage(req);

    // Persist pending run first so failures are auditable
    run = await PromptRun.create({
      userId: req.user?._id || null,
      projectId: projectId || null,
      userPrompt,
      framework,
      designSystemName: designSystem,
      requestedModel: model,
      referenceImage: {
        provided: Boolean(referenceImage),
        mimeType: referenceImage?.mimeType || '',
        size: referenceImage?.size || 0
      },
      status: 'analyzing'
    });

    const result = await promptEngine.run({
      userPrompt,
      framework,
      designSystem,
      model,
      referenceImage,
      projectContext
    });

    run.status              = 'success';
    run.provider            = result.provider;
    run.resolvedModel       = result.model;
    run.spec                = result.spec;
    run.finalPrompt         = result.finalPrompt;
    run.tokens              = result.usage || {};
    run.durationMs          = result.durationMs;
    run.metadata = {
      extractedProductType: result.spec.productType,
      pageCount:      result.spec.pages?.length      || 0,
      componentCount: result.spec.components?.length || 0,
      featureCount:   result.spec.features?.length   || 0,
      validated: result.validation.ok,
      warnings:  result.validation.warnings || []
    };
    await run.save();

    return res.status(201).json({
      success: true,
      prompt: run.finalPrompt,
      metadata: {
        id: run._id,
        provider: run.provider,
        model: run.resolvedModel,
        durationMs: run.durationMs,
        pages:      run.spec.pages?.map(p => p.name) || [],
        components: run.spec.components?.map(c => c.name) || [],
        features:   run.spec.features || [],
        productType: run.spec.productType,
        validated: run.metadata.validated,
        warnings:  run.metadata.warnings
      },
      spec: run.spec
    });
  } catch (err) {
    if (run) {
      try {
        run.status = 'failed';
        run.error = err.message?.slice(0, 500) || 'Unknown error';
        run.durationMs = Date.now() - startedAt;
        await run.save();
      } catch (persistErr) {
        logger.error(`Failed to persist failed PromptRun: ${persistErr.message}`);
      }
    }
    if (err instanceof ValidationError || err instanceof AIError) return next(err);
    logger.error(`PromptEngine.generate error: ${err.message}`);
    return next(new AIError('Prompt generation failed'));
  }
};

/* ------------------------------------------------------------------ */
/* POST /api/prompt/preview     (no persistence)                       */
/* ------------------------------------------------------------------ */

exports.preview = async (req, res, next) => {
  try {
    const body = req.body || {};
    const userPrompt = String(body.userPrompt || body.prompt || '').trim();
    if (!userPrompt) throw new ValidationError('userPrompt is required.');

    const referenceImage = readReferenceImage(req);

    const result = await promptEngine.run({
      userPrompt,
      framework:    String(body.framework    || 'react'),
      designSystem: String(body.designSystem || 'veave'),
      model:        String(body.model        || 'auto'),
      referenceImage,
      projectContext: parseJsonMaybe(body.projectContext)
    });

    return res.json({
      success: true,
      prompt: result.finalPrompt,
      spec: result.spec,
      validation: result.validation,
      metadata: {
        provider: result.provider,
        model: result.model,
        durationMs: result.durationMs,
        tokens: result.usage
      }
    });
  } catch (err) {
    if (err instanceof ValidationError || err instanceof AIError) return next(err);
    logger.error(`PromptEngine.preview error: ${err.message}`);
    return next(new AIError('Prompt preview failed'));
  }
};

/* ------------------------------------------------------------------ */
/* GET /api/prompt                                                    */
/* ------------------------------------------------------------------ */

exports.list = async (req, res, next) => {
  try {
    if (!req.user) return res.json({ success: true, data: [] });
    const runs = await PromptRun.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json({ success: true, data: runs.map(r => r.toSummary()) });
  } catch (err) { return next(err); }
};

/* ------------------------------------------------------------------ */
/* GET /api/prompt/:id                                                */
/* ------------------------------------------------------------------ */

exports.getOne = async (req, res, next) => {
  try {
    const run = await PromptRun.findById(req.params.id);
    if (!run) throw new NotFoundError('PromptRun');

    // Owner-only if the run is owned; guest runs (userId=null) are readable by anyone with the id
    if (run.userId && (!req.user || String(run.userId) !== String(req.user._id))) {
      throw new NotFoundError('PromptRun');
    }
    return res.json({ success: true, data: run });
  } catch (err) { return next(err); }
};

/* ------------------------------------------------------------------ */
/* DELETE /api/prompt/:id                                             */
/* ------------------------------------------------------------------ */

exports.remove = async (req, res, next) => {
  try {
    const run = await PromptRun.findById(req.params.id);
    if (!run) throw new NotFoundError('PromptRun');
    if (run.userId && (!req.user || String(run.userId) !== String(req.user._id))) {
      throw new NotFoundError('PromptRun');
    }
    await run.deleteOne();
    return res.json({ success: true });
  } catch (err) { return next(err); }
};

/* ------------------------------------------------------------------ */
/* GET /api/prompt/config/providers                                    */
/* ------------------------------------------------------------------ */

exports.providers = async (_req, res) => {
  return res.json({
    success: true,
    default: llmService.default,
    configured: llmService.listConfigured()
  });
};
