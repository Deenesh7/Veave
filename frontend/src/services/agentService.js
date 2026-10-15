import api from './api';

export const agentService = {
  sendMessage: (projectId, message, image, selectedElement) => {
    const token = localStorage.getItem('veave_token');
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`/api/agent/${projectId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        image,
        selectedElement: selectedElement ? {
          tagName: selectedElement.tagName,
          text: selectedElement.text,
          selector: selectedElement.selector,
          sourceFile: selectedElement.sourceFile,
          sourceComponent: selectedElement.sourceComponent,
          sourceLine: selectedElement.sourceLine,
          className: selectedElement.className
        } : null
      }),
    });
  },
  planBuild: (projectId, message, signal) => {
    const token = localStorage.getItem('veave_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = Bearer ;
    return fetch(/api/agent//plan-build, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message }),
      signal,
    });
  },
  decidePlan: (projectId, runId, decision) =>
    api.post(/agent//plan-build//decision, { decision }),
  stopGeneration: (projectId) => api.post(`/agent/${projectId}/stop`),
};

