
const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const auth = require('../middleware/auth');
const previewController = require('../controllers/previewController');

// Allow optionalAuth on project routes so workspace, editor, and guest creations can be opened & edited seamlessly
router.use(auth.optionalAuth);

router.get('/', projectController.getProjects);
router.post('/', projectController.createProject);
router.get('/shared-with-me', projectController.getSharedProjects);
router.get('/:id', projectController.getProject);
router.get('/:id/revision', projectController.getProjectRevision);
router.patch('/:id', projectController.updateProject);
router.delete('/:id', projectController.deleteProject);

router.get('/:id/preview', previewController.getPrecompiledPreview);
router.get('/:id/files', projectController.getProjectFiles);
router.patch('/:id/files', projectController.updateProjectFile);
router.get('/:id/source', projectController.getProjectSource);
router.get('/:id/export', projectController.exportProject);

// Project sharing (project admins only; enforced in the service layer). Accounts only: guests cannot share.
const collaboration = require('../controllers/collaborationController');
const requireAccount = (req, res, next) => (req.user
  ? next()
  : res.status(401).json({ success: false, error: { message: 'Log in to manage project sharing.', statusCode: 401 } }));
router.get('/:id/shares', requireAccount, collaboration.listShares);
router.post('/:id/shares', requireAccount, collaboration.shareProject);
router.patch('/:id/shares/:shareId', requireAccount, collaboration.updateShare);
router.delete('/:id/shares/:shareId', requireAccount, collaboration.unshareProject);

module.exports = router;
