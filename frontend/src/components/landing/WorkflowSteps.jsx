import React from 'react';
import { MessageSquare, Sliders, Download, ArrowRight } from 'lucide-react';

export default function WorkflowSteps() {
  const steps = [
    {
      step: '01',
      icon: MessageSquare,
      title: 'Prompt your requirement',
      description: 'Describe any screen or site in plain English, or start from a screenshot, website, GitHub repository, or Figma file.',
      tag: 'Prompt, import, or clone',
    },
    {
      step: '02',
      icon: Sliders,
      title: 'Refine visually or via chat',
      description: 'Ask the AI agent for changes, edit elements in the visual editor, or open the code editor, and see results in the live preview.',
      tag: 'Live preview',
    },
    {
      step: '03',
      icon: Download,
      title: 'Ship clean React & Tailwind',
      description: 'Download your project as a ZIP, a complete Vite + React + Tailwind app you can run locally, or publish it from Veave.',
      tag: 'Export or publish',
    },
  ];

  return (
    <section className="w-full py-20 sm:py-28 bg-white border-t border-[#DDE2E5]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div data-stagger className="max-w-3xl mx-auto text-center mb-16">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-3 bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
            Workflow
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight mb-4">
            From prompt to production in three effortless steps
          </h2>
          <p className="text-base sm:text-lg text-zinc-500 max-w-2xl mx-auto">
            Go from an idea to a working React project.
          </p>
        </div>

        {/* 3 Step Cards */}
        <div data-stagger="x" className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {steps.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="group relative bg-[#F8F9FA] rounded-[18px] border border-[#DDE2E5] p-7 flex flex-col justify-between hover:bg-white hover:shadow-[0_12px_28px_rgba(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-300"
              >
                <div>
                  {/* Step Header */}
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-2xl font-bold font-mono text-zinc-900">
                      {item.step}
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-[#DDE2E5] shadow-xs flex items-center justify-center text-zinc-700 group-hover:text-black group-hover:border-zinc-400 transition-colors">
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>

                  {/* Title & Description */}
                  <h3 className="text-lg font-bold text-zinc-900 mb-2.5">
                    {item.title}
                  </h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {/* Tag pill at bottom */}
                <div className="pt-6 mt-6 border-t border-zinc-200/70 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-zinc-400 font-semibold uppercase">
                    {item.tag}
                  </span>
                  <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-900 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
