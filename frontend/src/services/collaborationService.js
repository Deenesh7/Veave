import api from './api';

export const collaborationService = {
  // Groups
  listGroups: () => api.get('/groups'),
  createGroup: (data) => api.post('/groups', data),
  getGroup: (id) => api.get(`/groups/${id}`),
  updateGroup: (id, data) => api.patch(`/groups/${id}`, data),
  deleteGroup: (id, confirmName) => api.delete(`/groups/${id}`, { data: { confirmName } }),
  transferOwnership: (id, newOwnerId, confirmName) => api.post(`/groups/${id}/transfer`, { newOwnerId, confirmName }),
  leaveGroup: (id, unshareOwnedProjects = false) => api.post(`/groups/${id}/leave`, { unshareOwnedProjects }),
  // Members
  listMembers: (id) => api.get(`/groups/${id}/members`),
  setMemberRole: (id, userId, role) => api.patch(`/groups/${id}/members/${userId}`, { role }),
  removeMember: (id, userId) => api.delete(`/groups/${id}/members/${userId}`),
  approveMember: (id, userId) => api.post(`/groups/${id}/members/${userId}/approve`),
  // Invitations
  inviteToGroup: (id, data) => api.post(`/groups/${id}/invitations`, data),
  listGroupInvitations: (id) => api.get(`/groups/${id}/invitations`),
  revokeInvitation: (id, invitationId) => api.delete(`/groups/${id}/invitations/${invitationId}`),
  listMyInvitations: (status = 'pending') => api.get('/invitations', { params: { status } }),
  acceptInvitation: (invitationId) => api.post(`/invitations/${invitationId}/accept`),
  rejectInvitation: (invitationId) => api.post(`/invitations/${invitationId}/reject`),
  // Projects
  listGroupProjects: (id) => api.get(`/groups/${id}/projects`),
  createGroupProject: (id, data) => api.post(`/groups/${id}/projects`, data),
  listSharedWithMe: () => api.get('/projects/shared-with-me'),
  getProjectRevision: (projectId) => api.get(`/projects/${projectId}/revision`),
  // Project sharing
  listShares: (projectId) => api.get(`/projects/${projectId}/shares`),
  shareProject: (projectId, data) => api.post(`/projects/${projectId}/shares`, data),
  updateShare: (projectId, shareId, permission) => api.patch(`/projects/${projectId}/shares/${shareId}`, { permission }),
  unshare: (projectId, shareId) => api.delete(`/projects/${projectId}/shares/${shareId}`),
  // Notifications
  listNotifications: () => api.get('/notifications'),
  markNotificationsRead: (ids) => api.post('/notifications/read', ids ? { ids } : {}),
};

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const failure = error?.response?.data?.error;
  if (typeof failure === 'string') return failure;
  return failure?.message || error?.message || fallback;
}

export default collaborationService;
