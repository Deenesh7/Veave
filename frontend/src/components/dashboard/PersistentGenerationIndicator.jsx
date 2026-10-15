import React from 'react';
import { AlertTriangle, CheckCircle2, Coins, X, Zap } from 'lucide-react';
import { useGenerationJobStore } from '../../store/generationJobStore';

export default function PersistentGenerationIndicator() {
  const {
    isGenerating,
    jobStatus,
    progress,
    stepName,
    error,
    jobResult,
    usage: liveUsage,
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

  const usage = liveUsage || jobResult?.tokenUsage;
  if ((isGenerating || jobStatus === 'completed') && usage) {
    const completed = jobStatus === 'completed';
    const cost = usage.costReported ? `$${Number(usage.cost || 0).toFixed(Number(usage.cost || 0) < 0.01 ? 4 : 2)}` : 'Not reported';
    return (
      <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300 pointer-events-auto">
        <div className="w-[300px] rounded-xl border border-emerald-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                {completed ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-900">{completed ? 'Generation usage' : 'Live usage'}</p>
                <p className="max-w-[190px] truncate text-[10px] text-zinc-500">{usage.modelUsed || 'AI model'}</p>
              </div>
            </div>
            {completed && (
              <button
                type="button"
                onClick={resetJob}
                className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Dismiss generation usage"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-zinc-50 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                <Zap className="h-3 w-3" /> Tokens
              </div>
              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-900">{Number(usage.totalTokens || 0).toLocaleString()}</p>
              <p className="text-[9px] text-zinc-400">{Number(usage.promptTokens || 0).toLocaleString()} in · {Number(usage.completionTokens || 0).toLocaleString()} out</p>
            </div>
            <div className="rounded-lg bg-zinc-50 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                <Coins className="h-3 w-3" /> Cost
              </div>
              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-900">{cost}</p>
              <p className="text-[9px] text-zinc-400">{completed ? 'OpenRouter reported' : Number(usage.totalTokens || 0) ? 'Updates after each response' : 'Waiting for first response'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
