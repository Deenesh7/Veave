import { create } from 'zustand';

const KEY = 'veave_selected_template';

const read = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value && typeof value.templateId === 'string' ? value : null;
  } catch {
    return null;
  }
};

const write = (value) => {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
};

// The template the next website will be generated from. Only a reference ({ templateId, templateVersion }) is kept;
// the backend re-validates it on every generation request.
export const useTemplateStore = create((set) => ({
  selected: read(),
  isGalleryOpen: false,
  openGallery: () => set({ isGalleryOpen: true }),
  closeGallery: () => set({ isGalleryOpen: false }),
  select: (selection) => {
    write(selection);
    set({ selected: selection, isGalleryOpen: false });
  },
  clear: () => {
    write(null);
    set({ selected: null });
  }
}));

export default useTemplateStore;
