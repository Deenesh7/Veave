import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, ArrowRight, Sparkles } from 'lucide-react';

export default function TemplatesPage() {
  const navigate = useNavigate();

  const templates = [
    {
      title: 'Modern SaaS Landing Page',
      category: 'Website',
      description: 'Hero section with interactive code preview, bento grid features, and responsive pricing cards.',
      prompt: 'Build a modern SaaS landing page with dark navigation, hero CTA with mockup, and 3-tier pricing grid.',
    },
    {
      title: 'AI Chat Studio Interface',
      category: 'App',
      description: 'Conversational prompt composer with context pills, model switcher, and streaming response feed.',
      prompt: 'Create an AI chat interface with collapsible sidebar, model dropdown, and markdown formatted response bubbles.',
    },
    {
      title: 'Enterprise Analytics Dashboard',
      category: 'Dashboard',
      description: 'Quarterly KPI summary cards, trajectory charts, and filterable transaction table.',
      prompt: 'Design an enterprise admin dashboard with 4 metric cards, revenue line chart, and status paginated table.',
    },
    {
      title: 'Mobile Banking Checkout Flow',
      category: 'Mobile',
      description: 'Interactive debit card preview, quick transfer pills, and biometric confirmation modal.',
      prompt: 'Build a fintech mobile web app screen with balance card, recent payments list, and send money action.',
    },
  ];

  const handleUseTemplate = (prompt) => {
    navigate('/', { state: { templatePrompt: prompt } });
  };

  return (
    <div className="w-full py-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-[#E2E5E8]">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Templates</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Jumpstart your designs with pre-configured AI-ready layout templates.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {templates.map((tpl, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-[#E2E5E8] p-5 flex flex-col justify-between shadow-2xs hover:shadow-xs hover:border-zinc-300 transition-all group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-50 text-[#52525B] font-bold border border-zinc-200/60">
                  {tpl.category}
                </span>
                <Sparkles className="w-3.5 h-3.5 text-zinc-400 group-hover:text-[#52525B] transition-colors" />
              </div>

              <h3 className="text-sm font-bold text-[#111827] mb-2 leading-snug">
                {tpl.title}
              </h3>
              <p className="text-xs text-[#64748B] leading-relaxed">
                {tpl.description}
              </p>
            </div>

            <div className="pt-4 mt-4 border-t border-zinc-100">
              <button
                onClick={() => handleUseTemplate(tpl.prompt)}
                className="w-full py-2 px-3 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs group/btn"
              >
                <span>Use Template</span>
                <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
