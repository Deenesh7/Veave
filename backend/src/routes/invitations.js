const express = require('express');
const router = express.Router();
const controller = require('../controllers/collaborationController');
const auth = require('../middleware/auth');

router.use(auth);
router.get('/', controller.listMyInvitations);
router.post('/:invitationId/accept', controller.acceptInvitation);
router.post('/:invitationId/reject', controller.rejectInvitation);

module.exports = router;
