import React from 'react';
import { Sparkles, Code2, Play, CheckCircle2 } from 'lucide-react';

/**
 * High-fidelity SaaS Editor Browser Preview Mockup
 * Minimalist black & grey monochrome theme.
 */
export default function HeroPreview() {
  return (
    <div className="w-full max-w-6xl mx-auto px-4 mt-8 sm:mt-12 select-none">
      <div className="relative rounded-2xl md:rounded-[22px] border border-[#DDE2E5] bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-500 hover:shadow-[0_28px_70px_-12px_rgba(0,0,0,0.12)]">
        {/* Top Window Bar */}
        <div className="h-11 bg-zinc-50 border-b border-[#DDE2E5] px-4 flex items-center justify-between">
          {/* Mac Traffic Lights */}
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/50" />
            <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/50" />
            <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/50" />
            <div className="hidden sm:flex items-center gap-1.5 ml-4 pl-4 border-l border-zinc-200 text-xs text-zinc-500 font-mono">
              <Code2 className="w-3.5 h-3.5 text-zinc-800" />
              <span>veave.ai/workspace/project-apollo</span>
            </div>
          </div>

          {/* Center Tabs */}
          <div className="hidden md:flex items-center gap-1 bg-zinc-200/60 p-0.5 rounded-lg text-xs font-medium">
            <span className="bg-white text-zinc-900 px-3 py-1 rounded-md shadow-xs flex items-center gap-1.5 font-medium">
              <Play className="w-3 h-3 text-zinc-900 fill-zinc-900" />
              Interactive Preview
            </span>
            <span className="text-zinc-500 px-3 py-1 hover:text-zinc-900 transition-colors">
              Code (React)
            </span>
            <span className="text-zinc-500 px-3 py-1 hover:text-zinc-900 transition-colors">
              Console
            </span>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-800 font-medium border border-zinc-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Hot-Reload
            </span>
          </div>
        </div>

        {/* Editor Main Canvas Body */}
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[380px] sm:min-h-[460px] bg-zinc-50/50">
          {/* Left: AI Prompt & Generation Log Panel (4 cols) */}
          <div className="lg:col-span-4 border-r border-[#DDE2E5] bg-white p-4 sm:p-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-900 flex items-center justify-center font-bold text-xs">
                    <Sparkles className="w-4 h-4 text-zinc-800" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900">AI Prompt Agent</h4>
                    <p className="text-[10px] text-zinc-400 font-mono">Model: Claude 3.5 Sonnet</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded">v2.4</span>
              </div>

              {/* Chat Message 1: User */}
              <div className="bg-zinc-50 border border-zinc-200/70 rounded-xl p-3 text-xs text-zinc-700 space-y-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase font-mono">You</span>
                <p className="leading-relaxed font-medium">
                  "Build an analytics dashboard card with revenue breakdown, active users metric, and interactive export."
                </p>
              </div>

              {/* Chat Message 2: AI Action */}
              <div className="bg-zinc-100/70 border border-zinc-200/90 rounded-xl p-3 text-xs text-zinc-900 space-y-2">
                <div className="flex items-center gap-1.5 text-zinc-900 font-semibold text-[11px]">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-800" />
                  <span>Veave AI Generating UI...</span>
                </div>
                <div className="space-y-1 text-[11px] text-zinc-600">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-900 shrink-0" />
                    <span>Scaffolded AnalyticsCard.jsx</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-900 shrink-0" />
                    <span>Injected Lucide charts & badges</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-900 shrink-0" />
                    <span>Applied responsive Tailwind tokens</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Prompt Input Mock */}
            <div className="mt-4 pt-3 border-t border-zinc-100">
              <div className="relative flex items-center bg-zinc-100 rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500">
                <span className="truncate">Add real-time currency selector...</span>
                <span className="ml-auto bg-zinc-900 hover:bg-black text-white text-[10px] font-semibold px-2 py-1 rounded-md shadow-xs">
                  Generate
                </span>
              </div>
            </div>
          </div>

          {/* Right: Live Interactive Render Preview (8 cols) */}
          <div className="lg:col-span-8 p-4 sm:p-8 bg-[#F8F9FA] flex items-center justify-center relative overflow-hidden">
            {/* Background grid pattern */}
            <div 
              className="absolute inset-0 opacity-25 pointer-events-none" 
              style={{
                backgroundImage: 'radial-gradient(#a1a1aa 1px, transparent 1px)',
                backgroundSize: '16px 16px'
              }}
            />

            {/* Rendered Component Preview Card */}
            <div className="relative w-full max-w-lg bg-white rounded-xl border border-[#DDE2E5] shadow-lg p-5 sm:p-6 space-y-5">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div>
                  <h5 className="text-sm font-bold text-zinc-900">Revenue Performance</h5>
                  <p className="text-xs text-zinc-400">Quarterly growth breakdown</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-900 border border-zinc-200">
                    +24.8% YoY
                  </span>
                </div>
              </div>

              {/* Metrics Row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-100">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase">Total ARR</span>
                  <p className="text-xl font-bold text-zinc-900 mt-1">$482,900</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-3 border border-zinc-100">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase">Active Seats</span>
                  <p className="text-xl font-bold text-zinc-900 mt-1">1,842</p>
                </div>
              </div>

              {/* Simulated Chart Bars in Monochrome */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
                  <span>Monthly Trajectory</span>
                  <span className="text-zinc-900 font-semibold">Target Exceeded</span>
                </div>
                <div className="h-16 flex items-end gap-2 pt-2">
                  <div className="flex-1 bg-zinc-200 hover:bg-zinc-300 rounded-t h-[45%] transition-all" />
                  <div className="flex-1 bg-zinc-300 hover:bg-zinc-400 rounded-t h-[60%] transition-all" />
                  <div className="flex-1 bg-zinc-400 hover:bg-zinc-500 rounded-t h-[50%] transition-all" />
                  <div className="flex-1 bg-zinc-500 hover:bg-zinc-600 rounded-t h-[75%] transition-all" />
                  <div className="flex-1 bg-zinc-700 hover:bg-zinc-800 rounded-t h-[68%] transition-all" />
                  <div className="flex-1 bg-zinc-900 hover:bg-black rounded-t h-[94%] shadow-sm relative group">
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] font-mono bg-zinc-900 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      $92k
                    </span>
                  </div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-400 pt-1 border-t border-zinc-100">
                  <span>Jan</span>
                  <span>Feb</span>
                  <span>Mar</span>
                  <span>Apr</span>
                  <span>May</span>
                  <span className="text-zinc-900 font-bold">Jun</span>
                </div>
              </div>

              {/* Action Buttons inside Mockup */}
              <div className="pt-2 flex items-center justify-between">
                <span className="text-xs text-zinc-400">Export as standalone .jsx</span>
                <button className="px-3.5 py-1.5 bg-zinc-900 hover:bg-black text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors">
                  <span>Export Code</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
