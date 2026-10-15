import api from './api';

// Legacy synchronous endpoints also run the full build/browser gate. The main
// composer uses persistent jobs instead, so it can show progress and reconnect.
const validationTimeout = { timeout: 2400000 };
// Polling is serialized in generationJobStore. Do not turn a busy but live
// backend into a false disconnect merely because one generation stage is long.
const jobStatusRequest = { timeout: 0 };

export const aiCreationService = {
  transcribeWhisper: (formData) => api.post('/ai/whisper', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  enhancePrompt: (data) => api.post('/ai/enhance-prompt', data),
  generate: (data) => api.post('/ai/generate', data, validationTimeout),
  modify: (data) => api.post('/ai/modify', data, validationTimeout),
  streamGenerate: (data) => fetch('/api/ai/stream-generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.getItem('veave_token') ? { Authorization: `Bearer ${localStorage.getItem('veave_token')}` } : {})
    },
    body: JSON.stringify(data)
  }),
  recreateScreenshot: (data) => api.post('/ai/screenshot', data, validationTimeout),
  importGitHub: (data) => api.post('/ai/github-import', data, validationTimeout),
  importFigma: (data) => api.post('/ai/figma-import', data, validationTimeout),
  generateSlideDeck: (data) => api.post('/ai/slide-deck', data),
  // Persistent Background Generation Job APIs
  startJob: (data) => api.post('/ai/jobs/start', data),
  getJobStatus: (jobId) => api.get(`/ai/jobs/${jobId}`, jobStatusRequest),
  getActiveJob: (params) => api.get('/ai/jobs/active', { params, ...jobStatusRequest }),
  cancelJob: (jobId) => api.post(`/ai/jobs/${jobId}/cancel`),
  decidePlan: (jobId, decision) => api.post(`/ai/jobs/${jobId}/decision`, { decision }),
  // Stateful Conversation & Generation History APIs
  getConversation: (id) => api.get(`/ai/conversations/${id}`),
  rollbackGeneration: (id, generationId) => api.post(`/ai/conversations/${id}/rollback/${generationId}`, {}, validationTimeout),
  undoLastGeneration: (id) => api.post(`/ai/conversations/${id}/undo`, {}, validationTimeout),
  redoGeneration: (id) => api.post(`/ai/conversations/${id}/redo`, {}, validationTimeout),
};

export default aiCreationService;

