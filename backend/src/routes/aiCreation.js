const express = require('express');
const router = express.Router();
const aiCreationController = require('../controllers/aiCreationController');
const auth = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');

const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Allow optionalAuth so guest/unauthenticated users can test creation
router.use(auth.optionalAuth);

// Anything that creates a project needs an account: ownerless projects bypass plan limits and cannot be published.
const requireAccount = (req, res, next) => {
  if (req.user) return next();
  return res.status(401).json({ success: false, error: 'Log in to create a project.', code: 'LOGIN_REQUIRED' });
};

// OpenAI Whisper Voice Message Transcription
router.post('/whisper', upload.single('audio'), aiCreationController.transcribeVoice);
router.post('/transcribe', upload.single('audio'), aiCreationController.transcribeVoice);

router.post('/enhance-prompt', aiCreationController.enhancePrompt);
router.post('/generate', requireAccount, aiCreationController.generateDesign);
router.post('/stream-generate', requireAccount, aiCreationController.streamGenerateDesign);
router.post('/modify', aiCreationController.modifyDesign);
router.post('/screenshot', requireAccount, aiCreationController.recreateScreenshot);
router.post('/recreate-screenshot', requireAccount, aiCreationController.recreateScreenshot);
router.post('/github-import', requireAccount, aiCreationController.importGitHub);
router.post('/figma-import', requireAccount, aiCreationController.importFigma);
router.post('/slide-deck', requireAccount, aiCreationController.generateSlideDeck);

// Persistent Background Generation Job Endpoints
router.post('/jobs/start', aiLimiter, requireAccount, aiCreationController.startJob);
router.get('/jobs/active', aiCreationController.getActiveJob);
router.get('/jobs/:jobId', aiCreationController.getJobStatus);
router.post('/jobs/:jobId/decision', aiCreationController.decidePlan);
router.post('/jobs/:jobId/cancel', aiCreationController.cancelJob);

// Stateful Conversation & Generation History Endpoints
router.get('/conversations/:id', aiCreationController.getConversation);
router.post('/conversations/:id/rollback/:generationId', aiCreationController.rollbackGeneration);
router.post('/conversations/:id/undo', aiCreationController.undoLastGeneration);
router.post('/conversations/:id/redo', aiCreationController.redoGeneration);

module.exports = router;

