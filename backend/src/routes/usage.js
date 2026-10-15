const express = require('express');
const router = express.Router();
const usageController = require('../controllers/usageController');
const { optionalAuth } = require('../middleware/auth');

router.use(optionalAuth);

router.get('/', usageController.getUsage);
router.get('/summary', usageController.getUsageSummary);
router.get('/project/:projectId', usageController.getProjectUsage);

module.exports = router;

