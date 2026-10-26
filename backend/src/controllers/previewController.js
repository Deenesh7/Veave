const mongoose = require('mongoose');
const Project = require('../models/Project');
const preview = require('../services/preview/previewService');
const { NotFoundError } = require('../utils/errors');

// Same visibility rule as opening a project: owner, collaborator with any access level, or a legacy ownerless project.
async function assertCanView(projectId, user) {
  await require('../services/collaboration/projectAccess').requireProjectAccess(projectId, user, 'viewer');
}

/**
 * GET /api/projects/:id/preview?hash=<client source hash>
 * Returns the stored, already compiled preview when it matches the source the browser is showing.
 * Without a matching hash it answers {match:false} (tiny) so the browser compiles its own unsaved edits.
 */
exports.getPrecompiledPreview = async (req, res, next) => {
  try {
    await assertCanView(req.params.id, req.user);
    res.set('Cache-Control', 'no-store');
    const doc = await preview.ensurePrecompiled(req.params.id);
    if (!doc) throw new NotFoundError('Project');
    const clientHash = String(req.query.hash || '');
    const base = { status: doc.status, token: doc.status === 'ready' ? doc.token : null, sourceHash: doc.sourceHash, compiledAt: doc.compiledAt, compileMs: doc.compileMs, error: doc.error || null };
    if (doc.status !== 'ready' || (clientHash && clientHash !== doc.sourceHash)) {
      return res.json({ success: true, data: { ...base, match: false } });
    }
    return res.json({ success: true, data: { ...base, match: true, token: doc.token, html: doc.html, bytes: doc.bytes } });
  } catch (error) {
    next(error);
  }
};

// GET /api/preview-assets/:token/<path under public/>   (capability URL: possession of the token is the access check)
exports.getPreviewAsset = async (req, res, next) => {
  try {
    const asset = await preview.readPreviewAsset(req.params.token, req.params[0]);
    if (!asset) return res.status(404).type('text/plain').send('Not found');
    res.set({
      'Content-Type': asset.contentType,
      // The token is stable across saves, so allow only a short cache; an ETag makes revalidation cheap.
      'Cache-Control': 'public, max-age=300',
      ETag: `"${require('node:crypto').createHash('sha1').update(asset.buffer).digest('hex')}"`,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      // If an asset (e.g. an SVG) is ever opened directly, it must not be able to run script on the app's origin.
      'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    });
    if (req.headers['if-none-match'] === res.get('ETag')) return res.status(304).end();
    return res.send(asset.buffer);
  } catch (error) {
    next(error);
  }
};
