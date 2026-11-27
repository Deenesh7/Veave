import { create } from 'zustand';

const KEY = 'veave.adminView';
const read = () => { try { return localStorage.getItem(KEY) === 'user' ? 'user' : 'admin'; } catch { return 'admin'; } };

/** An administrator can look at the app as an administrator (the control center) or as a normal user (Home, Recent, Groups...). */
export const useAdminView = create((set) => ({
  mode: read(),
  setMode: (mode) => {
    const next = mode === 'user' ? 'user' : 'admin';
    try { localStorage.setItem(KEY, next); } catch { /* storage may be unavailable */ }
    set({ mode: next });
  }
}));

/** True when this account is an administrator who is currently looking at the admin control center. */
export const isAdminAccount = (user) => user?.role === 'ADMIN' && user?.isRootAdmin === true;
