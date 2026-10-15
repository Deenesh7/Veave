import React from 'react';
import { BookOpen, Terminal, Sparkles, FileCode, CheckCircle2, ArrowRight } from 'lucide-react';

export default function DocumentationPage() {
  const sections = [
    {
      title: 'Quickstart Guide',
      desc: 'Learn how to prompt the Veave AI engine to generate production-ready React components.',
      badge: 'Basics',
    },
    {
      title: 'Prompt Engineering for UI',
      desc: 'Techniques for describing complex responsive grids, dark modes, and interactive state.',
      badge: 'Best Practices',
    },
    {
      title: 'PDF Spec to Prototype',
      desc: 'How the PDF upload parser extracts product requirements directly into UI screens.',
      badge: 'Feature',
    },
    {
      title: 'Exporting React & Tailwind',
      desc: 'Download standalone ZIP packages or integrate with existing Next.js and Vite repos.',
      badge: 'Export',
    },
  ];

  return (
    <div className="w-full py-6 space-y-8">
      {/* Header */}
      <div className="pb-4 border-b border-[#E2E5E8]">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Documentation</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Everything you need to master AI-driven interface design and code export with Veave.
        </p>
      </div>

      {/* Topics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {sections.map((sec, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-[#E2E5E8] p-5 space-y-3 shadow-2xs hover:shadow-xs hover:border-zinc-300 transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-50 text-[#52525B] font-bold border border-zinc-200/60">
                {sec.badge}
              </span>
              <ArrowRight className="w-4 h-4 text-zinc-300 group-hover:text-[#52525B] group-hover:translate-x-0.5 transition-all" />
            </div>

            <h3 className="text-sm font-bold text-[#111827] group-hover:text-[#52525B] transition-colors">
              {sec.title}
            </h3>

            <p className="text-xs text-[#64748B] leading-relaxed">
              {sec.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Code Snippet Example */}
      <div className="bg-zinc-900 rounded-2xl p-6 text-white space-y-4 border border-zinc-800 shadow-lg">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#52525B]" />
            <span className="text-xs font-mono text-zinc-300">Veave React Export Spec</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400">ES6 + Tailwind v3</span>
        </div>

        <pre className="text-xs font-mono text-zinc-300 overflow-x-auto leading-relaxed">
{`// Sample generated standalone component
import React, { useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function GeneratedCard({ title, subtitle }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 shadow-sm">
      <h3 className="text-base font-bold text-[#111827]">{title}</h3>
      <p className="text-xs text-[#64748B] mt-1">{subtitle}</p>
    </div>
  );
}`}
        </pre>
      </div>
    </div>
  );
}
