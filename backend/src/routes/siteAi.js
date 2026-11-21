const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const siteAi = require('../services/siteAi/siteAiService');

// The assistant on generated websites. Public (visitors have no account) and called from other origins (published sites, the studio's
// preview frame), so it has its own CORS and limits and is mounted before the app's login-based middleware.
const router = express.Router();
router.use(cors({ origin: '*', methods: ['POST', 'OPTIONS'], allowedHeaders: ['Content-Type'], maxAge: 86400 }));
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number.parseInt(process.env.SITE_AI_PER_MINUTE, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many questions. Please wait a moment and try again.', statusCode: 429 } }
});

router.post('/ask', limiter, express.json({ limit: '4kb' }), async (req, res) => {
  try {
    const answer = await siteAi.ask({ projectId: req.body?.project, question: req.body?.question, topic: req.body?.topic });
    res.set('Cache-Control', 'no-store').json({ success: true, answer });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: { message: status >= 500 && status !== 502 && status !== 503 ? 'The assistant is unavailable right now.' : error.message, statusCode: status } });
  }
});

module.exports = router;
