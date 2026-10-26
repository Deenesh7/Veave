import { create } from 'zustand';
import { collaborationService as svc, apiErrorMessage } from '../services/collaborationService';

// Everything here comes from the backend; nothing is seeded or hard-coded.
export const useCollabStore = create((set, get) => ({
  groups: [],
  groupsLoading: false,
  groupsError: null,
  invitations: [],
  invitationsLoading: false,
  notifications: [],
  unread: 0,
  sharedProjects: [],
  sharedLoading: false,

  reset: () => set({ groups: [], invitations: [], notifications: [], unread: 0, sharedProjects: [] }),

  fetchGroups: async () => {
    set({ groupsLoading: true, groupsError: null });
    try {
      const res = await svc.listGroups();
      set({ groups: res.data.data || [], groupsLoading: false });
    } catch (error) {
      set({ groupsLoading: false, groupsError: apiErrorMessage(error, 'Could not load your groups.') });
    }
  },

  createGroup: async (data) => {
    const res = await svc.createGroup(data);
    await get().fetchGroups();
    return res.data.data;
  },

  fetchInvitations: async () => {
    set({ invitationsLoading: true });
    try {
      const res = await svc.listMyInvitations('pending');
      set({ invitations: res.data.data || [], invitationsLoading: false });
    } catch {
      set({ invitationsLoading: false });
    }
  },

  respondToInvitation: async (invitationId, accept) => {
    const res = accept ? await svc.acceptInvitation(invitationId) : await svc.rejectInvitation(invitationId);
    set((state) => ({ invitations: state.invitations.filter((i) => i.invitationId !== invitationId) }));
    get().fetchGroups();
    get().fetchNotifications();
    return res.data.data;
  },

  fetchNotifications: async () => {
    try {
      const res = await svc.listNotifications();
      set({ notifications: res.data.data.items || [], unread: res.data.data.unread || 0 });
    } catch { /* the bell is best effort */ }
  },

  markAllRead: async () => {
    await svc.markNotificationsRead();
    set((state) => ({ unread: 0, notifications: state.notifications.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })) }));
  },

  fetchSharedProjects: async () => {
    set({ sharedLoading: true });
    try {
      const res = await svc.listSharedWithMe();
      set({ sharedProjects: res.data.data || [], sharedLoading: false });
    } catch {
      set({ sharedLoading: false });
    }
  },
}));
