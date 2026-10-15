import React from 'react';
import { Loader2, Check, X } from 'lucide-react';
import { FluidOrb } from '../rare-ui';
import { useGenerationJobStore } from '../../store/generationJobStore';

export default function GenerationLoader({
  isGenerating,
  steps = [
    'Analyzing prompt specifications...',
    'Injecting design system tokens...',
    'Scaffolding React components with Tailwind...',
    'Compiling interactive prototype...',
  ],
  currentStep = 0,
  statusMessage = '',
  progress = null,
  onCancel,
}) {
  const approval = useGenerationJobStore((s) => s.approval);
  const decidePlan = useGenerationJobStore((s) => s.decidePlan);

  if (!isGenerating) return null;

  if (approval?.plan) {
    const plan = approval.plan;
    return (
      <div className="absolute inset-0 bg-white rounded-2xl z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
        <h4 className="text-base font-bold text-[#111827] mb-4">Ready to build</h4>
        <div className="flex items-stretch justify-center gap-3 mb-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-3">
            <div className="text-2xl font-bold text-[#111827] leading-none">{plan.pageCount}</div>
            <div className="text-[11px] text-zinc-500 mt-1">Pages</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-3">
            <div className="text-2xl font-bold text-[#111827] leading-none">{plan.stageCount}</div>
            <div className="text-[11px] text-zinc-500 mt-1">Steps</div>
          </div>
        </div>
        {plan.estimatedMinutes ? (
          <p className="text-xs text-zinc-500 mb-4">Estimated time: about {plan.estimatedMinutes} min</p>
        ) : null}
        <div className="flex items-center justify-center gap-2 w-full max-w-xs">
          <button
            type="button"
            onClick={() => decidePlan('approve')}
            className="flex-1 rounded-lg bg-zinc-900 text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => decidePlan('cancel')}
            className="rounded-lg border border-zinc-300 text-zinc-600 text-sm font-medium px-4 py-2.5 hover:bg-zinc-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  const progressPercentage = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, Math.round(progress)))
    : Math.min(100, Math.round(((currentStep + 1) / steps.length) * 100));

  return (
    <div className="absolute inset-0 bg-white/95 backdrop-blur-xs rounded-2xl z-20 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
      {/* Top Close/Cancel button if provided */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
          title="Cancel generation"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Ambient Fluid Orb Animation */}
      <div className="flex items-center justify-center mb-3">
        <FluidOrb size={64} color="#18181B" className="drop-shadow-md" />
      </div>

      <h4 className="text-sm sm:text-base font-bold text-[#111827] mb-1">
        Generating your prototype
      </h4>
      <p className="max-w-sm text-xs text-[#64748B] mb-4">
        {statusMessage || 'Veave AI is assembling production-ready React components'}
      </p>

      {/* Progress Bar */}
      <div className="w-full max-w-xs h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-[#52525B] transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Step Indicators */}
      <div className="w-full max-w-xs space-y-1.5 text-left">
        {statusMessage ? (
          <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />
            <span className="line-clamp-2">{statusMessage}</span>
          </div>
        ) : steps.map((step, idx) => {
          const isDone = idx < currentStep;
          const isCurrent = idx === currentStep;

          return (
            <div
              key={idx}
              className={`flex items-center gap-2 text-xs transition-colors duration-200 ${
                isDone
                  ? 'text-emerald-600 font-medium'
                  : isCurrent
                  ? 'text-[#111827] font-semibold'
                  : 'text-zinc-400'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] ${
                  isDone
                    ? 'bg-emerald-100 text-emerald-700'
                    : isCurrent
                    ? 'bg-zinc-100 text-[#52525B]'
                    : 'bg-zinc-100 text-zinc-400'
                }`}
              >
                {isDone ? (
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                ) : isCurrent ? (
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span className="truncate">{step}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}



