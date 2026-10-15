const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const promptController = require('../controllers/promptController');
const auth = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');

/**
 * VEAVE Prompt Engine routes.
 *
 * All routes use optionalAuth so guests can compile prompts, but persistence
 * & listing are user-scoped. AI-heavy endpoints are rate-limited.
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

router.use(auth.optionalAuth);

router.get('/config/providers', promptController.providers);

router.post('/generate', aiLimiter, upload.single('referenceImage'), promptController.generate);
router.post('/preview',  aiLimiter, upload.single('referenceImage'), promptController.preview);

router.get('/',          promptController.list);
router.get('/:id',       promptController.getOne);
router.delete('/:id',    promptController.remove);

module.exports = router;
