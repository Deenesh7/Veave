const express = require('express');
const router = express.Router();
const controller = require('../controllers/collaborationController');
const auth = require('../middleware/auth');

// Every collaboration endpoint needs a logged-in user; access to a specific group is then checked in the service layer.
router.use(auth);

router.get('/', controller.listGroups);
router.post('/', controller.createGroup);
router.get('/:groupId', controller.getGroup);
router.patch('/:groupId', controller.updateGroup);
router.delete('/:groupId', controller.deleteGroup);
router.post('/:groupId/transfer', controller.transferOwnership);
router.post('/:groupId/leave', controller.leaveGroup);

router.get('/:groupId/members', controller.listMembers);
router.patch('/:groupId/members/:userId', controller.setMemberRole);
router.delete('/:groupId/members/:userId', controller.removeMember);
router.post('/:groupId/members/:userId/approve', controller.approveMember);

router.get('/:groupId/invitations', controller.listGroupInvitations);
router.post('/:groupId/invitations', controller.inviteToGroup);
router.delete('/:groupId/invitations/:invitationId', controller.revokeInvitation);

router.get('/:groupId/projects', controller.listGroupProjects);
router.post('/:groupId/projects', controller.createGroupProject);

module.exports = router;
