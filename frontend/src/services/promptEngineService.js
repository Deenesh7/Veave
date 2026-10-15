import api from './api';

/**
 * VEAVE Prompt Engine — frontend service.
 *
 * Uses the same axios instance as the rest of the app so auth tokens
 * are automatically attached. Reference images are sent as multipart
 * so they can be forwarded to vision-capable providers.
 */
export const promptEngineService = {
  /** Compile & persist a prompt run. */
  generate: (payload) => {
    if (payload?.referenceImage instanceof File) {
      const fd = new FormData();
      fd.append('userPrompt',   payload.userPrompt || '');
      fd.append('framework',    payload.framework || 'react');
      fd.append('designSystem', payload.designSystem || 'veave');
      fd.append('model',        payload.model || 'auto');
      if (payload.projectId)      fd.append('projectId', payload.projectId);
      if (payload.projectContext) fd.append('projectContext',
        typeof payload.projectContext === 'string'
          ? payload.projectContext
          : JSON.stringify(payload.projectContext));
      fd.append('referenceImage', payload.referenceImage);
      return api.post('/prompt/generate', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
    }
    return api.post('/prompt/generate', payload);
  },

  /** Dry-run: compile the prompt without persisting. */
  preview: (payload) => api.post('/prompt/preview', payload),

  list:      ()   => api.get('/prompt'),
  get:       (id) => api.get(`/prompt/${id}`),
  remove:    (id) => api.delete(`/prompt/${id}`),
  providers: ()   => api.get('/prompt/config/providers'),
};

export default promptEngineService;
