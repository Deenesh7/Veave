import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useGenerationJobStore } from '../../store/generationJobStore';

export default function PersistentGenerationIndicator() {
  const {
    isGenerating,
    jobStatus,
    error,
    cancelJob,
    notificationToast,
    dismissToast,
    resetJob
  } = useGenerationJobStore();

  // If nothing is generating and no notification toast, don't show
  if (!isGenerating && !notificationToast && jobStatus !== 'completed' && jobStatus !== 'failed') {
    return null;
  }

  // Active generating state is handled by the agent panel now
  // Error toast
  if (error || (notificationToast && notificationToast.type === 'error')) {
    return (
      <div 
        role="status"
        aria-live="polite"
        className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 pointer-events-auto"
      >
        <div className="bg-zinc-950/95 text-white backdrop-blur-xl border border-red-500/30 rounded-2xl shadow-2xl p-4 w-[340px] sm:w-[380px] flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-100">Generation Failed</h4>
              <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">
                {error || notificationToast?.message || 'An error occurred during generation.'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              dismissToast();
              resetJob();
            }}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
