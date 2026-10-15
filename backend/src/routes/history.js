const express = require('express');
const router = express.Router({ mergeParams: true });
const historyController = require('../controllers/historyController');
const auth = require('../middleware/auth');

router.use(auth.optionalAuth);

// Project Version History Endpoints
router.get('/projects/:id/history', historyController.getVersions);
router.get('/projects/:id/history/:versionId', historyController.getVersionById);
router.post('/projects/:id/history', historyController.createVersion);
router.post('/projects/:id/restore/:versionId', historyController.restoreVersion);
router.delete('/projects/:id/history/:versionId', historyController.deleteVersion);

module.exports = router;
