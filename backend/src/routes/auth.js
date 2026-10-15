const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Standard Auth
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/logout', auth, authController.logout);
router.get('/profile', auth.optionalAuth, authController.getProfile);
router.post('/refresh', authController.refreshToken);

// Google OAuth
router.get('/google', authController.googleAuthInit);
router.get('/google/callback', authController.googleAuthCallback);
router.post('/google', authLimiter, authController.googleAuthVerify);

// Apple OAuth
router.get('/apple', authController.appleAuthInit);
router.post('/apple/callback', authController.appleAuthCallback);
router.post('/apple', authLimiter, authController.appleAuthVerify);

module.exports = router;
