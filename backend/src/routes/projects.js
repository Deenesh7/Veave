
const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const auth = require('../middleware/auth');

// Allow optionalAuth on project routes so workspace, editor, and guest creations can be opened & edited seamlessly
router.use(auth.optionalAuth);

router.get('/', projectController.getProjects);
router.post('/', projectController.createProject);
router.get('/:id', projectController.getProject);
router.patch('/:id', projectController.updateProject);
router.delete('/:id', projectController.deleteProject);

router.get('/:id/files', projectController.getProjectFiles);
router.patch('/:id/files', projectController.updateProjectFile);
router.get('/:id/source', projectController.getProjectSource);
router.get('/:id/export', projectController.exportProject);

module.exports = router;
