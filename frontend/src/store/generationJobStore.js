import { create } from 'zustand';
import { useBillingStore } from './billingStore';
import { aiCreationService } from '../services/aiCreationService';

const ACTIVE_JOB_KEY = 'veave_active_job_id';
const ACTIVE_JOB_META_KEY = 'veave_active_job_meta';
const CONVERSATION_KEY = 'veave_conversation_id';

let pollTimer = null;
let reconnectAttempts = 0;
let pollDelay = 2500;
const pollingJobs = new Set();
// Consecutive failures: a missing or forbidden job is permanent and stops polling quickly; anything else backs off and gives up late.
let permanentFailures = 0;
const MAX_PERMANENT_FAILURES = 2;
const MAX_TRANSIENT_FAILURES = 60;

const asText = (value, fallback) => (typeof value === 'string' && value.trim() ? value : value && typeof value === 'object' ? (value.message || JSON.stringify(value)) : fallback);

// A failed job's code -> a short title for the error banner.
export const FAILURE_TITLES = {
  JOB_TIMEOUT: 'Generation took too long',
  JOB_LEASE_LOST: 'Generation was interrupted',
  JOB_INTERRUPTED_COMMIT: 'Generation interrupted while saving',
  JOB_ABANDONED: 'Generation abandoned after restarts',
  PROVIDER_AUTH: 'AI service unavailable',
  PROVIDER_CREDITS: 'AI service out of credits',
  PLAN_LIMIT_REACHED: 'You are out of credits',
  PROVIDER_RATE_LIMIT: 'AI service is busy',
  PROVIDER_MODEL: 'AI model unavailable',
  PROVIDER_TIMEOUT: 'AI service timed out',
  AI_RESPONSE_MALFORMED: 'The AI response was incomplete',
  AI_RESPONSE_INVALID: 'The AI response could not be applied',
  IMAGE_CHECK_FAILED: 'Images could not be verified',
  PAGE_CHECK_FAILED: 'Pages were not distinct',
  REPAIR_EXHAUSTED: 'Automatic repair could not fix the site',
  // Template workspace jobs
  PAGE_VALIDATION_FAILED: 'The new version did not pass the checks',
  BUILD_VALIDATION_FAILED: 'The new version failed the build or browser test',
  FINAL_CHECK_FAILED: 'The new version failed the final checks',
  MODEL_ANSWER_UNUSABLE: 'The AI answer could not be used',
  NO_USABLE_CHANGES: 'The AI changed nothing on this page',
  SITE_CHANGED: 'The page changed while it was being regenerated'
};

export const useGenerationJobStore = create((set, get) => ({
  activeJobId: localStorage.getItem(ACTIVE_JOB_KEY) || null,
  conversationId: localStorage.getItem(CONVERSATION_KEY) || null,
  activeGenerationId: null,
  parentGenerationId: null,
  generationHistory: [], // Array of { generationId, parentGenerationId, versionNumber, userPrompt, changeSummary, timestamp }
  conversationMessages: [], // Array of { role, content, generationId, changeSummary, timestamp }
  jobType: 'generate',
  jobStatus: 'idle', // 'idle' | 'queued' | 'processing' | 'completed' | 'failed' | 'blocked' | 'cancelled'
  progress: 0,
  step: 0,
  stepName: '',
  jobResult: null,
  usage: null,
  validation: null,
  error: null,
  errorCode: null, // machine-readable failure reason from the backend (JOB_TIMEOUT, PROVIDER_CREDITS, ...)
  jobDegraded: null, // { kind, reason, message } when a starter site replaced an AI result that could not be used
  jobEntityImages: null, // { found: [names], missing: [names] } from the named-entity image search
  isGenerating: false,
  promptText: '',
  hasUnreadCompletion: false,
  canUndo: false,
  canRedo: false,
  currentIndex: 0,
  approval: null, // pending plan approval: { state, plan }
  prototypeQueue: null, // "build it like this website": stages + the pages found on the site
  notificationToast: null, // { type: 'success' | 'error', message: string, projectId?: string }

  /**
   * Set active conversation ID and persist to localStorage
   */
  setConversationId: (convId) => {
    if (convId) {
      localStorage.setItem(CONVERSATION_KEY, convId);
      set({ conversationId: convId });
    } else {
      localStorage.removeItem(CONVERSATION_KEY);
      set({ conversationId: null });
    }
  },

  /**
   * Fetch conversation history and generation lineage from backend
   */
  fetchConversation: async (id) => {
    const targetId = id || get().conversationId;
    if (!targetId) return null;

    try {
      const res = await aiCreationService.getConversation(targetId);
      if (res.data?.success && res.data.conversation) {
        const conv = res.data.conversation;
        if (conv.conversationId) {
          localStorage.setItem(CONVERSATION_KEY, conv.conversationId);
        }

        const checkpoints = conv.generations || [];
        const currentIndex = conv.currentIndex !== undefined ? conv.currentIndex : (checkpoints.length - 1);
        const canUndo = conv.canUndo !== undefined ? conv.canUndo : (currentIndex > 0);
        const canRedo = conv.canRedo !== undefined ? conv.canRedo : (currentIndex < checkpoints.length - 1);

        set({
          conversationId: conv.conversationId,
          activeGenerationId: conv.activeGenerationId || null,
          generationHistory: checkpoints,
          conversationMessages: conv.messages || [],
          canUndo,
          canRedo,
          currentIndex
        });

        return conv;
      }
    } catch (err) {
      console.warn('Could not load conversation context:', err.message);
    }
    return null;
  },

  /**
   * Start a persistent stateful background generation job
   */
  startJob: async ({
    type = 'generate',
    prompt = '',
    designSystem = 'Modern',
    model = 'Veave AI',
    command = null,
    paletteId = null,
    customTokens = null,
    image = null,
    sourceUrl = null,
    // Not called `prototype`: axios silently drops a request property with that name (prototype-pollution guard).
    prototypeSite = undefined,
    activeSkills = [],
    githubRepo = null,
    uploadedFiles = [],
    refreshFromSource,
    sourceRoute,
    viewingRoute,
    selectedElement = null,
    projectId = null,
    conversationId = null,
    parentGenerationId = null,
    templateId = null,
    templateVersion = null
  }) => {
    const current = get();
    if (current.isGenerating && current.activeJobId) {
      console.warn('A generation job is already active:', current.activeJobId);
      return current.activeJobId;
    }

    const clientJobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const targetConvId = conversationId || current.conversationId || null;
    const targetParentGenId = parentGenerationId || current.activeGenerationId || null;

    localStorage.setItem(ACTIVE_JOB_KEY, clientJobId);
    try {
      localStorage.setItem(
        ACTIVE_JOB_META_KEY,
        JSON.stringify({
          jobId: clientJobId,
          type,
          prompt,
          designSystem,
          model,
          projectId,
          selectedElement,
          sourceUrl,
          conversationId: targetConvId,
          startedAt: Date.now()
        })
      );
    } catch (e) {}

    // Optimistically append user message to local conversation feed
    if (prompt) {
      set((state) => ({
        conversationMessages: [
          ...state.conversationMessages,
          {
            role: 'user',
            content: prompt,
            timestamp: new Date().toISOString()
          }
        ]
      }));
    }

    set({
      activeJobId: clientJobId,
      jobType: type,
      jobStatus: 'queued',
      prototypeQueue: null,
      progress: 5,
      step: 0,
      stepName: 'Queueing stateful generation job on server...',
      jobResult: null,
      usage: null,
      validation: null,
      error: null,
      isGenerating: true,
      promptText: prompt,
      hasUnreadCompletion: false,
      notificationToast: null
    });

    try {
      const res = await aiCreationService.startJob({
        jobId: clientJobId,
        type,
        prompt,
        designSystem,
        model,
        command,
        paletteId,
        customTokens,
        image,
        sourceUrl,
        prototypeSite,
        activeSkills,
        githubRepo,
        uploadedFiles,
        refreshFromSource,
        sourceRoute,
        viewingRoute,
        selectedElement,
        projectId,
        conversationId: targetConvId,
        parentGenerationId: targetParentGenId,
        ...(templateId ? { templateId, templateVersion } : {})
      });

      if (res.data?.success) {
        if (res.data.conversationId) {
          get().setConversationId(res.data.conversationId);
        }
        const jobId = res.data.jobId;
        if (!jobId) throw new Error('Server did not return a generation job ID.');
        localStorage.setItem(ACTIVE_JOB_KEY, jobId);
        try {
          const meta = JSON.parse(localStorage.getItem(ACTIVE_JOB_META_KEY) || '{}');
          localStorage.setItem(ACTIVE_JOB_META_KEY, JSON.stringify({ ...meta, jobId }));
        } catch (_) {}
        set({ activeJobId: jobId });
        get().startPolling(jobId);
        return jobId;
      }
      throw new Error(res.data?.error || 'Server could not start generation.');
    } catch (err) {
      console.error('Failed to initiate persistent job:', err);
      get().stopPolling();
      localStorage.removeItem(ACTIVE_JOB_KEY);
      localStorage.removeItem(ACTIVE_JOB_META_KEY);
      const error = err.response?.data?.error || err.message || 'Failed to start generation.';
      set({
        activeJobId: null,
        jobStatus: 'failed',
        error,
        stepName: 'Generation failed to start',
        isGenerating: false,
        notificationToast: { type: 'error', message: typeof error === 'string' ? error : JSON.stringify(error) }
      });
      throw err;
    }
  },

  /**
   * Start interval polling for the current active job
   */
  startPolling: (jobId) => {
    if (pollTimer) clearTimeout(pollTimer);

    const targetJobId = jobId || get().activeJobId;
    if (!targetJobId) return;

    reconnectAttempts = 0;
    permanentFailures = 0;
    pollDelay = 2500;

    pollTimer = setTimeout(() => {
      pollTimer = null;
      get().pollStatus(targetJobId);
    }, 0);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  },

  /**
   * Poll status of a job with resilient error & network recovery
   */
  pollStatus: async (jobId) => {
    const targetJobId = jobId || get().activeJobId;
    if (!targetJobId) {
      get().stopPolling();
      return;
    }
    if (pollingJobs.has(targetJobId)) return;
    pollingJobs.add(targetJobId);

    try {
      const res = await aiCreationService.getJobStatus(targetJobId);
      if (get().activeJobId !== targetJobId) return;

      // A reply without a job is a failed poll, not a quiet success.
      if (!(res.data?.success && res.data.job)) throw Object.assign(new Error('The server answered without a job.'), { emptyReply: true });
      reconnectAttempts = 0;
      permanentFailures = 0;
      pollDelay = 2500;

      if (res.data?.success && res.data.job) {
        const job = res.data.job;
        set({
          validation: job.validation ?? get().validation,
          usage: job.usage ?? job.result?.tokenUsage ?? get().usage,
          approval: job.status === 'processing' && job.approval?.state === 'pending' ? job.approval : null,
          prototypeQueue: job.prototypeQueue ?? null
        });

        if (job.status === 'completed') {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);

          const projectId = job.projectId?._id || job.projectId || job.result?.project?._id;
          const convId = job.conversationId || job.result?.conversationId;

          if (convId) {
            get().setConversationId(convId);
            get().fetchConversation(convId);
          } else if (projectId) {
            get().fetchConversation(projectId);
          }

          set({
            jobStatus: 'completed',
            activeJobId: null,
            progress: 100,
            step: job.step || 4,
            stepName: job.stepName || 'Your interface is ready.',
            jobResult: job.result,
            jobDegraded: job.degraded || null,
            jobEntityImages: job.entityImages || null,
            errorCode: null,
            activeGenerationId: job.generationId || job.result?.generationId || null,
            parentGenerationId: job.parentGenerationId || job.result?.parentGenerationId || null,
            isGenerating: false,
            hasUnreadCompletion: false,
            notificationToast: job.degraded ? { type: 'warning', message: job.degraded.message || 'A starter site was created because the AI result could not be used.' } : null
          });
        } else if (['failed', 'blocked'].includes(job.status)) {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);

          const error = asText(job.error, job.status === 'blocked' ? 'Generation blocked by validation. See the checks that failed in the project validation report.' : 'Generation failed. Please try again.');
          set({
            activeJobId: null,
            jobStatus: job.status,
            error,
            errorCode: job.errorCode || null,
            stepName: FAILURE_TITLES[job.errorCode] || (job.status === 'blocked' ? 'Generation blocked' : 'Generation failed'),
            isGenerating: false,
            hasUnreadCompletion: true,
            notificationToast: {
              type: 'error',
              message: typeof error === 'string' ? error : JSON.stringify(error)
            }
          });
        } else if (job.status === 'cancelled') {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);

          set({
            jobStatus: 'cancelled',
            activeJobId: null,
            stepName: 'Cancelled by user',
            isGenerating: false
          });
        } else {
          set({
            jobStatus: job.status,
            progress: job.progress ?? 10,
            step: job.step ?? 1,
            stepName: job.stepName || 'AI Generation in progress...',
            isGenerating: true,
            error: null
          });
        }
      }
    } catch (err) {
      if (get().activeJobId !== targetJobId) return;
      reconnectAttempts++;
      const status = err.response?.status;
      const isRateLimited = status === 429;
      // 401/403/404: the job is gone or this user cannot see it. Retrying forever only shows "Reconnecting" for nothing.
      if ([401, 403, 404].includes(status)) permanentFailures++;
      console.warn(`[GenerationJobStore] Polling problem ${reconnectAttempts}${status ? ` (HTTP ${status})` : ''}: ${err.message}`);

      if (permanentFailures >= MAX_PERMANENT_FAILURES) {
        get().stopPolling();
        localStorage.removeItem(ACTIVE_JOB_KEY);
        localStorage.removeItem(ACTIVE_JOB_META_KEY);
        const message = status === 404 ? 'This generation job no longer exists. Start a new generation.' : 'You no longer have access to this generation job. Sign in again or start a new generation.';
        set({ activeJobId: null, jobStatus: 'failed', error: message, errorCode: 'JOB_NOT_FOUND', stepName: 'Generation job unavailable', isGenerating: false });
        return;
      }
      if (isRateLimited) pollDelay = 5000;
      else pollDelay = Math.min(15000, 2500 * 2 ** Math.min(reconnectAttempts - 1, 3));

      if (reconnectAttempts >= MAX_TRANSIENT_FAILURES) {
        // Long outage: stop hammering the server. The job id stays saved, so a refresh or the tab regaining focus resumes it.
        get().stopPolling();
        set({ isGenerating: false, error: 'Lost connection to the server. Your generation may still be running; refresh the page to check on it.', errorCode: 'CONNECTION_LOST', stepName: 'Connection lost' });
        return;
      }
      if (reconnectAttempts === 3) {
        set({
          isGenerating: true,
          stepName: 'Connection interrupted. Reconnecting to the running job...',
          error: null
        });
      }
    } finally {
      pollingJobs.delete(targetJobId);
      if (get().activeJobId === targetJobId && !pollTimer && get().isGenerating !== false) {
        pollTimer = setTimeout(() => {
          pollTimer = null;
          get().pollStatus(targetJobId);
        }, pollDelay);
      }
    }
  },

  /**
   * Undo the last generation change (reverts to parent generation)
   */
  undoLastChange: async (id) => {
    const targetId = id || get().conversationId;
    if (!targetId) return null;

    // Stop any active polling and clear stale completion state up-front so
    // the previous generation's "completed" job result cannot re-hydrate
    // the project after we revert (fixes the stuck-loading / re-apply bug).
    try { get().stopPolling(); } catch (_) {}
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      localStorage.removeItem(ACTIVE_JOB_META_KEY);
    } catch (_) {}
    set({
      activeJobId: null,
      jobStatus: 'idle',
      progress: 0,
      step: 0,
      stepName: '',
      jobResult: null,
      usage: null,
      validation: null,
      error: null,
      isGenerating: false,
      hasUnreadCompletion: false,
      notificationToast: null
    });

    try {
      const res = await aiCreationService.undoLastGeneration(targetId);
      if (res.data?.success) {
        await get().fetchConversation(targetId);
        return res.data;
      }
      return res?.data || { success: false, error: 'Undo was not successful' };
    } catch (e) {
      console.warn('Failed to undo last change:', e);
      return { success: false, error: e.response?.data?.error || e.message || 'Undo failed' };
    }
  },

  /**
   * Redo the next generation change in this session
   */
  redoLastChange: async (id) => {
    const targetId = id || get().conversationId;
    if (!targetId) return null;

    try { get().stopPolling(); } catch (_) {}
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      localStorage.removeItem(ACTIVE_JOB_META_KEY);
    } catch (_) {}
    set({
      activeJobId: null,
      jobStatus: 'idle',
      progress: 0,
      step: 0,
      stepName: '',
      jobResult: null,
      usage: null,
      validation: null,
      error: null,
      isGenerating: false,
      hasUnreadCompletion: false,
      notificationToast: null
    });

    try {
      const res = await aiCreationService.redoGeneration(targetId);
      if (res.data?.success) {
        await get().fetchConversation(targetId);
        return res.data;
      }
      return res?.data || { success: false, error: 'Redo was not successful' };
    } catch (e) {
      console.warn('Failed to redo last change:', e);
      return { success: false, error: e.response?.data?.error || e.message || 'Redo failed' };
    }
  },

  /**
   * Rollback to a specific generation in history
   */
  rollbackToGeneration: async (id, generationId) => {
    const targetId = id || get().conversationId;
    if (!targetId || !generationId) return null;

    // Same reset as undoLastChange: prevent stale completion state from
    // re-applying a project we just rolled away from.
    try { get().stopPolling(); } catch (_) {}
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      localStorage.removeItem(ACTIVE_JOB_META_KEY);
    } catch (_) {}
    set({
      activeJobId: null,
      jobStatus: 'idle',
      progress: 0,
      step: 0,
      stepName: '',
      jobResult: null,
      usage: null,
      validation: null,
      error: null,
      isGenerating: false,
      hasUnreadCompletion: false,
      notificationToast: null
    });

    try {
      const res = await aiCreationService.rollbackGeneration(targetId, generationId);
      if (res.data?.success) {
        await get().fetchConversation(targetId);
        return res.data;
      }
      return res?.data || { success: false, error: 'Rollback was not successful' };
    } catch (e) {
      console.warn('Failed to rollback to generation:', e);
      return { success: false, error: e.response?.data?.error || e.message || 'Rollback failed' };
    }
  },

  /**
   * Sync active job from localStorage or server
   */
  syncActiveJob: async () => {
    const savedJobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!savedJobId) return;
    if (get().activeJobId === savedJobId && (pollTimer || pollingJobs.has(savedJobId))) return;

    try {
      const res = await aiCreationService.getActiveJob({ jobId: savedJobId });
      if (localStorage.getItem(ACTIVE_JOB_KEY) !== savedJobId) return;
      if (res.data?.success && res.data.job) {
        const job = res.data.job;
        set({
          validation: job.validation ?? get().validation,
          approval: job.status === 'processing' && job.approval?.state === 'pending' ? job.approval : null,
          prototypeQueue: job.prototypeQueue ?? null
        });

        if (job.status === 'completed') {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);
          const projectId = job.projectId?._id || job.projectId || job.result?.project?._id;
          const convId = job.conversationId || job.result?.conversationId;

          if (convId) {
            get().setConversationId(convId);
            get().fetchConversation(convId);
          } else if (projectId) {
            get().fetchConversation(projectId);
          }

          set({
            activeJobId: null,
            jobStatus: 'completed',
            progress: 100,
            step: job.step || 4,
            stepName: job.stepName || 'Your interface is ready.',
            jobResult: job.result,
            jobDegraded: job.degraded || null,
            jobEntityImages: job.entityImages || null,
            activeGenerationId: job.generationId || job.result?.generationId || null,
            parentGenerationId: job.parentGenerationId || job.result?.parentGenerationId || null,
            usage: job.usage ?? job.result?.tokenUsage ?? get().usage,
            isGenerating: false,
            hasUnreadCompletion: false,
            notificationToast: job.degraded ? { type: 'warning', message: job.degraded.message || 'A starter site was created because the AI result could not be used.' } : null
          });
        } else if (['queued', 'processing', 'committing'].includes(job.status)) {
          set({
            activeJobId: job.jobId,
            jobStatus: job.status,
            progress: job.progress ?? 15,
            step: job.step ?? 1,
            stepName: job.stepName || 'AI Generation in progress...',
            isGenerating: true,
            error: null
          });
          get().startPolling(job.jobId);
        } else if (['failed', 'blocked'].includes(job.status)) {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);
          const error = asText(job.error, job.status === 'blocked' ? 'Generation blocked by validation. See the checks that failed in the project validation report.' : 'Generation failed. Please try again.');
          set({
            activeJobId: null,
            jobStatus: job.status,
            error,
            errorCode: job.errorCode || null,
            stepName: FAILURE_TITLES[job.errorCode] || (job.status === 'blocked' ? 'Generation blocked' : 'Generation failed'),
            isGenerating: false,
            hasUnreadCompletion: true,
            notificationToast: {
              type: 'error',
              message: typeof error === 'string' ? error : JSON.stringify(error)
            }
          });
        } else if (job.status === 'cancelled') {
          get().stopPolling();
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.removeItem(ACTIVE_JOB_META_KEY);
          set({ activeJobId: null, jobStatus: 'cancelled', stepName: 'Cancelled by user', isGenerating: false });
        }
      }
    } catch (e) {
      console.warn('Could not sync active job on wakeup:', e.message);
    }
  },

  decidePlan: async (decision) => {
    const { activeJobId } = get();
    if (!activeJobId) return;
    set({ approval: null, stepName: decision === 'approve' ? 'Plan approved. Starting the build...' : 'Cancelling...' });
    try {
      await aiCreationService.decidePlan(activeJobId, decision);
      if (decision !== 'approve') await get().pollStatus(activeJobId);
    } catch (e) {
      console.warn('Failed to send plan decision:', e);
      await get().pollStatus(activeJobId);
    }
  },

  cancelJob: async () => {
    const { activeJobId } = get();
    if (!activeJobId) return;

    try {
      await aiCreationService.cancelJob(activeJobId);
    } catch (e) {
      console.warn('Failed to cancel job on server:', e);
      await get().pollStatus(activeJobId);
      return false;
    }

    get().stopPolling();
    localStorage.removeItem(ACTIVE_JOB_KEY);
    localStorage.removeItem(ACTIVE_JOB_META_KEY);

    set({
      jobStatus: 'cancelled',
      activeJobId: null,
      isGenerating: false,
      stepName: 'Cancelled by user',
      notificationToast: null
    });
    return true;
  },

  dismissToast: () => {
    set({ notificationToast: null, hasUnreadCompletion: false });
  },

  resetJob: () => {
    get().stopPolling();
    localStorage.removeItem(ACTIVE_JOB_KEY);
    localStorage.removeItem(ACTIVE_JOB_META_KEY);

    set({
      activeJobId: null,
      jobStatus: 'idle',
      progress: 0,
      step: 0,
      stepName: '',
      jobResult: null,
      validation: null,
      error: null,
      errorCode: null,
      jobDegraded: null,
      jobEntityImages: null,
      isGenerating: false,
      hasUnreadCompletion: false,
      notificationToast: null
    });
  }
}));

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      useGenerationJobStore.getState().syncActiveJob();
    }
  });

  window.addEventListener('focus', () => {
    useGenerationJobStore.getState().syncActiveJob();
  });

  window.addEventListener('online', () => {
    useGenerationJobStore.getState().syncActiveJob();
  });

  setTimeout(() => {
    useGenerationJobStore.getState().syncActiveJob();
  }, 100);
}


// A finished generation adds a project, files and token usage: re-read live billing usage right away.
useGenerationJobStore.subscribe((state, previous) => {
  if (state.jobStatus === 'completed' && previous.jobStatus !== 'completed') {
    try { useBillingStore.getState().refreshOverview(); } catch { /* best effort */ }
  }
});
