const express = require('express');
const router = express.Router();
const controller = require('../controllers/collaborationController');
const auth = require('../middleware/auth');

router.use(auth);
router.get('/', controller.listNotifications);
router.post('/read', controller.markNotificationsRead);

module.exports = router;
