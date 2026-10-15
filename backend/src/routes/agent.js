const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const auth = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');

router.use(auth.optionalAuth);

router.post('/:projectId/plan-build', aiLimiter, agentController.planAndBuild);
router.post('/:projectId/plan-build/:runId/decision', agentController.decidePlan);
router.post('/:projectId', aiLimiter, agentController.sendMessage);
router.post('/:projectId/stop', agentController.stopGeneration);

module.exports = router;


