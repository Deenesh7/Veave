import React from 'react';
import { Sparkles, Layers, CheckCircle2 } from 'lucide-react';
import { MatrixOrb } from '../../components/rare-ui';

export function StudioProgressiveSkeleton({ phase = 1, currentStepName = 'Designing components...' }) {
  return (
    <div className="w-full h-full bg-[#FAFBFD] p-4 sm:p-8 overflow-y-auto flex flex-col items-center justify-start relative select-none">
      {/* Floating Dynamic AI Status Pill */}
      <div className="fixed top-20 right-8 z-30 px-4 py-2 rounded-full bg-zinc-900/90 text-white backdrop-blur-md shadow-xl border border-white/20 text-xs font-semibold flex items-center gap-2.5 animate-bounce-gentle">
        <MatrixOrb state="thinking" size={18} dots={7} color="#3F3F46" />
        <span>Phase {phase} of 6: {currentStepName}</span>
      </div>

      <div className="w-full max-w-5xl space-y-6 animate-pulse">
        {/* 1. Navbar Skeleton (Phase 1) */}
        <div className={`w-full h-16 rounded-2xl border p-4 flex items-center justify-between transition-all duration-500 ${
          phase >= 1 
            ? 'bg-white border-zinc-200/80 shadow-xs ring-2 ring-zinc-100/50' 
            : 'bg-zinc-100/70 border-zinc-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-zinc-600 animate-spin" />
            </div>
            <div className="space-y-1">
              <div className="h-3 w-28 bg-zinc-300 rounded-full" />
              <div className="h-2 w-16 bg-zinc-200 rounded-full" />
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <div className="h-7 w-20 bg-zinc-200 rounded-xl" />
            <div className="h-7 w-20 bg-zinc-200 rounded-xl" />
            <div className="h-7 w-20 bg-zinc-200 rounded-xl" />
          </div>

          <div className="flex items-center gap-2">
            <div className="h-8 w-24 bg-zinc-600/30 rounded-xl" />
          </div>
        </div>

        {/* 2. Hero Section Skeleton (Phase 2) */}
        <div className={`w-full rounded-3xl border p-8 sm:p-12 text-center transition-all duration-500 ${
          phase >= 2 
            ? 'bg-white border-indigo-200 shadow-sm ring-2 ring-indigo-100/40' 
            : 'bg-zinc-100/50 border-zinc-200'
        }`}>
          <div className="inline-block h-6 w-44 bg-zinc-100 rounded-full mb-6" />
          <div className="h-10 sm:h-12 w-3/4 max-w-2xl bg-zinc-300 rounded-2xl mx-auto mb-4" />
          <div className="h-4 w-1/2 max-w-lg bg-zinc-200 rounded-full mx-auto mb-8" />
          
          <div className="flex items-center justify-center gap-3">
            <div className="h-11 w-36 bg-zinc-600/40 rounded-xl" />
            <div className="h-11 w-36 bg-zinc-200 rounded-xl" />
          </div>
        </div>

        {/* 3. Cards / Metrics Skeleton (Phase 3) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((card) => (
            <div 
              key={card} 
              className={`p-6 rounded-2xl border transition-all duration-500 flex flex-col justify-between h-40 ${
                phase >= 3 
                  ? 'bg-white border-zinc-200 shadow-2xs ring-1 ring-zinc-100' 
                  : 'bg-zinc-100/60 border-zinc-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-zinc-200" />
                <div className="h-4 w-12 bg-zinc-200 rounded-full" />
              </div>
              <div className="space-y-2">
                <div className="h-5 w-2/3 bg-zinc-300 rounded-md" />
                <div className="h-3 w-full bg-zinc-200 rounded-md" />
              </div>
            </div>
          ))}
        </div>

        {/* 4. Content / Interactive Section Skeleton (Phase 4 & 5) */}
        <div className={`w-full rounded-3xl border p-6 sm:p-8 transition-all duration-500 ${
          phase >= 4 
            ? 'bg-white border-zinc-300 shadow-sm' 
            : 'bg-zinc-100/50 border-zinc-200'
        }`}>
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-100">
            <div className="h-6 w-48 bg-zinc-300 rounded-lg" />
            <div className="flex gap-2">
              <div className="h-8 w-20 bg-zinc-200 rounded-xl" />
              <div className="h-8 w-24 bg-zinc-200 rounded-xl" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="h-12 w-full bg-zinc-100 rounded-xl" />
            <div className="h-12 w-full bg-zinc-100 rounded-xl" />
            <div className="h-12 w-full bg-zinc-100 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
