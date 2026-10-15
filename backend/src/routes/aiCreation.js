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

// OpenAI Whisper Voice Message Transcription
router.post('/whisper', upload.single('audio'), aiCreationController.transcribeVoice);
router.post('/transcribe', upload.single('audio'), aiCreationController.transcribeVoice);

router.post('/enhance-prompt', aiCreationController.enhancePrompt);
router.post('/generate', aiCreationController.generateDesign);
router.post('/stream-generate', aiCreationController.streamGenerateDesign);
router.post('/modify', aiCreationController.modifyDesign);
router.post('/screenshot', aiCreationController.recreateScreenshot);
router.post('/recreate-screenshot', aiCreationController.recreateScreenshot);
router.post('/github-import', aiCreationController.importGitHub);
router.post('/figma-import', aiCreationController.importFigma);
router.post('/slide-deck', aiCreationController.generateSlideDeck);

// Persistent Background Generation Job Endpoints
router.post('/jobs/start', aiLimiter, aiCreationController.startJob);
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

