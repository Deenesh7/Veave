import api from './api';

// The server compiles each project's preview once, when it is created or saved, and stores it.
export const previewService = {
  // Resolves to the stored document only when `hash` matches the source the browser is showing.
  getPrecompiled: async (projectId, hash) => {
    const res = await api.get(`/projects/${projectId}/preview`, { params: { hash }, timeout: 30000 });
    return res.data?.data || null;
  },
};

export const ASSET_BASE_PLACEHOLDER = '__VEAVE_ASSET_BASE__';
