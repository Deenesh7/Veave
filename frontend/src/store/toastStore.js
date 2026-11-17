import { create } from 'zustand';

let nextId = 1;

// App-wide toasts (rendered by <Toaster />). Errors stay a little longer than confirmations.
export const useToastStore = create((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 7000 : 4000);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message) => useToastStore.getState().push('success', message),
  error: (message) => useToastStore.getState().push('error', message),
};
