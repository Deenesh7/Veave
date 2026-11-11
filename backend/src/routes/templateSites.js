const express = require('express');
const auth = require('../middleware/auth');
const { aiLimiter, uploadLimiter } = require('../middleware/rateLimiter');
const multer = require('multer');
const controller = require('../controllers/templateSiteController');

// One picture per request, held in memory only long enough to validate and store it (the size is checked again by the service).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number.parseInt(process.env.TEMPLATE_UPLOAD_MAX_BYTES, 10) || 8 * 1024 * 1024, files: 1 } });
const singlePhoto = (req, res, next) => upload.single('photo')(req, res, (error) => {
  if (!error) return next();
  const tooBig = error.code === 'LIMIT_FILE_SIZE';
  return res.status(tooBig ? 413 : 400).json({ success: false, error: { message: tooBig ? 'The picture is too large (the limit is 8 MB).' : 'The upload could not be read.', statusCode: tooBig ? 413 : 400 } });
});

const sites = express.Router();
const jobs = express.Router();

// The template workspace belongs to an account: every site, page and job is owned by the signed-in user.
const requireAccount = (req, res, next) => (req.user
  ? next()
  : res.status(401).json({ success: false, error: { message: 'Log in to use the template workspace.', statusCode: 401, code: 'LOGIN_REQUIRED' } }));

sites.use(auth.optionalAuth, requireAccount);
jobs.use(auth.optionalAuth, requireAccount);

sites.post('/', controller.createSite);
sites.get('/', controller.listSites);
sites.get('/:siteId', controller.getSite);
sites.patch('/:siteId', controller.updateSite);
sites.delete('/:siteId', controller.deleteSite);

sites.get('/:siteId/pages', controller.listPages);
sites.post('/:siteId/pages', controller.createPage);
sites.patch('/:siteId/pages/reorder', controller.reorderPages); // before /:pageId so "reorder" is not read as an id
sites.get('/:siteId/pages/:pageId', controller.getPage);
sites.patch('/:siteId/pages/:pageId', controller.updatePage);
sites.delete('/:siteId/pages/:pageId', controller.deletePage);

// Website versions, history, comparison, branches. (Fixed words come before the :versionId routes.)
sites.get('/:siteId/versions', controller.listVersions);
sites.post('/:siteId/versions', controller.saveVersion);
sites.get('/:siteId/versions/compare', controller.compareVersions);
sites.get('/:siteId/versions/:versionId', controller.getVersion);
sites.patch('/:siteId/versions/:versionId', controller.updateVersion);
sites.delete('/:siteId/versions/:versionId', controller.deleteVersion);
sites.post('/:siteId/versions/:versionId/restore', controller.restoreVersion);
sites.get('/:siteId/versions/:versionId/preview', controller.previewVersion);
sites.post('/:siteId/versions/:versionId/verify', controller.verifyVersion);
sites.post('/:siteId/versions/:versionId/branch', controller.createBranch);
sites.get('/:siteId/history', controller.history);
sites.get('/:siteId/branches', controller.listBranches);
sites.post('/:siteId/promote', controller.promoteBranch);
sites.get('/:siteId/pages/:pageId/revisions/:number/compare', controller.comparePage);
sites.get('/:siteId/images/:imageId/versions', controller.assetVersions);

sites.get('/:siteId/pages/:pageId/revisions', controller.listRevisions);
sites.get('/:siteId/pages/:pageId/revisions/:number', controller.getRevision);
sites.post('/:siteId/pages/:pageId/revisions/:number/restore', controller.restoreRevision);

sites.get('/:siteId/pages/:pageId/revisions/:number/preview', controller.previewRevision);

sites.post('/:siteId/uploads', uploadLimiter, singlePhoto, controller.uploadPhoto);
sites.get('/:siteId/images', controller.listImages);
sites.post('/:siteId/images/:imageId/enhance', aiLimiter, controller.enhanceImage);
sites.post('/:siteId/images/:imageId/enhancement', controller.chooseEnhancement);
sites.get('/:siteId/images/:imageId/file', controller.imageFile);
sites.patch('/:siteId/images/:imageId', controller.updateImage);
sites.delete('/:siteId/images/:imageId', controller.deleteImage);
sites.post('/:siteId/images/:imageId/replace', uploadLimiter, singlePhoto, controller.replaceImage);
sites.post('/:siteId/generate', aiLimiter, controller.generateSite);
sites.post('/:siteId/pages/:pageId/regenerate', aiLimiter, controller.regeneratePage);
sites.post('/:siteId/pages/:pageId/retry', aiLimiter, controller.retryPage);

sites.get('/:siteId/preview', controller.getSitePreview);
sites.get('/:siteId/pages/:pageId/preview', controller.getPagePreview);

jobs.get('/:jobId', controller.getJob);
jobs.post('/:jobId/cancel', controller.cancelJob);

module.exports = { sites, jobs };
