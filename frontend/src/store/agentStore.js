import { create } from 'zustand';
import { agentService } from '../services/agentService';
import { useProjectStore } from './projectStore';

export const useAgentStore = create((set, get) => ({
  messages: [],
  isGenerating: false,
  error: null,
  streamingMessage: '',
  actions: [],
  abortController: null,
  planBuildMode: true,
  pendingPlan: null,
  pendingApproval: null, // { projectId, runId, plan, question }
  progress: [], // [{ id, text, status }]

  setPlanBuildMode: (planBuildMode) => set({ planBuildMode }),

  decidePlan: async (decision) => {
    const pending = get().pendingApproval;
    if (!pending) return;
    set({ pendingApproval: null });
    try {
      await agentService.decidePlan(pending.projectId, pending.runId, decision);
    } catch (err) {
      set({ error: err.response?.data?.error || err.message });
    }
  },

  sendPlanBuild: async (projectId, message) => {
    const abortController = new AbortController();
    set((state) => ({
      isGenerating: true,
      error: null,
      streamingMessage: '',
      abortController,
      pendingApproval: null,
      progress: [{ id: 'plan', text: 'Planner agent is creating a plan...', status: 'active' }],
      messages: [...state.messages, { role: 'user', content: message, timestamp: new Date(), actions: [] }],
    }));
    const addAssistant = (content, extra = {}) =>
      set((state) => ({ messages: [...state.messages, { role: 'assistant', content, timestamp: new Date(), actions: [], ...extra }] }));
    const setStep = (id, patch, text) =>
      set((state) => {
        const exists = state.progress.some((p) => p.id === id);
        const progress = exists
          ? state.progress.map((p) => (p.id === id ? { ...p, ...patch } : p))
          : [...state.progress, { id, text, status: 'active', ...patch }];
        return { progress };
      });

    let refetch = false;
    try {
      const response = await agentService.planBuild(projectId, message, abortController.signal);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || errorData.error || Server error: );
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(data); } catch { continue; }
          switch (ev.type) {
            case 'stage':
              if (ev.stage === 'scraping') setStep('scrape', {}, ev.message || 'Scraping website...');
              if (ev.stage === 'validating') setStep('validate', {}, 'Validating the build...');
              break;
            case 'plan':
              setStep('plan', { status: 'done', text: 'Plan created' });
              break;
            case 'approval_required':
              set({ pendingApproval: { projectId, runId: ev.runId, plan: get().pendingPlan, question: ev.question } });
              break;
            case 'plan_approved':
              setStep('plan', { status: 'done', text: 'Plan approved' });
              break;
            case 'task_start':
              setStep(	ask-, {}, Builder:  (/));
              break;
            case 'task_done':
              setStep(	ask-, { status: 'done' });
              break;
            case 'task_retry':
              setStep(	ask-, { text: Builder retrying (attempt  failed) });
              break;
            case 'cancelled':
              addAssistant(ev.message || 'Plan cancelled.');
              break;
            case 'complete':
              addAssistant(ev.result?.message || 'Done.', { actions: ev.result?.actions || [], plan: ev.result?.plan });
              if (ev.result?.files) useProjectStore.getState().updateProjectFiles(ev.result.files);
              refetch = true;
              break;
            case 'error':
              throw new Error(ev.error || 'Plan and build failed');
            default:
              break;
          }
          if (ev.type === 'plan') set({ pendingPlan: ev.plan });
        }
      }
      set({ isGenerating: false, abortController: null, pendingApproval: null, progress: [], pendingPlan: null });
      if (refetch && projectId) useProjectStore.getState().fetchProject(projectId).catch(() => {});
    } catch (err) {
      if (err.name === 'AbortError') return;
      set({ error: err.message, isGenerating: false, abortController: null, pendingApproval: null, progress: [], pendingPlan: null });
    }
  },

  sendMessage: async (projectId, message, image = null, selectedElement = null) => {
    if (get().planBuildMode && !image && !selectedElement) {
      return get().sendPlanBuild(projectId, message);
    }
    const abortController = new AbortController();
    set({
      isGenerating: true,
      error: null,
      streamingMessage: '',
      abortController,
    });

    // Add user message
    set((state) => ({
      messages: [
        ...state.messages,
        { role: 'user', content: message, timestamp: new Date(), actions: [] },
      ],
    }));

    try {
      const response = await agentService.sendMessage(projectId, message, image, selectedElement);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullMessage = '';
      let finalActions = [];
      let finalFiles = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'chunk' || parsed.type === 'text') {
              fullMessage += parsed.content || parsed.text || '';
              set({ streamingMessage: fullMessage });
            } else if (parsed.type === 'complete' || parsed.type === 'result') {
              fullMessage = parsed.message || parsed.content || fullMessage;
              finalActions = parsed.actions || [];
              finalFiles = parsed.files || null;
            } else if (parsed.type === 'error') {
              throw new Error(parsed.message || 'AI generation failed');
            } else if (parsed.content) {
              fullMessage += parsed.content;
              set({ streamingMessage: fullMessage });
            }
          } catch (parseErr) {
            if (parseErr.message !== 'AI generation failed') {
              // Try treating the line as raw text
              if (data && data !== '[DONE]') {
                fullMessage += data;
                set({ streamingMessage: fullMessage });
              }
            } else {
              throw parseErr;
            }
          }
        }
      }

      // Add assistant message
      set((state) => ({
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: fullMessage,
            timestamp: new Date(),
            actions: finalActions,
          },
        ],
        actions: finalActions,
        streamingMessage: '',
        isGenerating: false,
        abortController: null,
      }));

      // Update project files if returned
      if (finalFiles) {
        useProjectStore.getState().updateProjectFiles(finalFiles);
      }

      // Refetch project to get latest state
      if (projectId) {
        useProjectStore.getState().fetchProject(projectId).catch(() => {});
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      set({
        error: err.message,
        isGenerating: false,
        streamingMessage: '',
        abortController: null,
      });
    }
  },

  stopGeneration: () => {
    const { abortController, pendingApproval } = get();
    if (pendingApproval) {
      agentService.decidePlan(pendingApproval.projectId, pendingApproval.runId, 'cancel').catch(() => {});
    }
    if (abortController) abortController.abort();
    set({ isGenerating: false, streamingMessage: '', abortController: null, pendingApproval: null, progress: [], pendingPlan: null });
  },

  clearMessages: () => set({ messages: [], actions: [], streamingMessage: '' }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, { ...msg, timestamp: new Date() }] })),

  setStreamingMessage: (text) => set({ streamingMessage: text }),
  setActions: (actions) => set({ actions }),
  setError: (error) => set({ error }),
  loadConversation: (msgs) => set({ messages: msgs || [] }),
}));

