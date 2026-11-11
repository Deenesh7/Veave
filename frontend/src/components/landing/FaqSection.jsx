import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function FaqSection() {
  const [openIdx, setOpenIdx] = useState(0);

  const faqs = [
    {
      q: 'What technology stack is used in the generated code?',
      a: 'Projects are generated as React with Tailwind CSS and built with Vite. Icons come from Lucide.',
    },
    {
      q: 'Can I download the code and run it on my local machine?',
      a: 'Yes. Export your project as a ZIP that includes package.json, the Vite and Tailwind configuration, and your source files. Run `npm install` and `npm run dev` to start.',
    },
    {
      q: 'Can I use my own brand colors and fonts?',
      a: 'The Design Systems page lets you create color palettes and upload custom fonts, so generated screens follow your brand.',
    },
    {
      q: 'How does editing work?',
      a: 'Chat with the AI agent to change your project, select elements in the visual editor, or edit files in the built-in Monaco code editor. The live preview shows the result.',
    },
  ];

  return (
    <section id="faq" className="w-full py-20 sm:py-28 bg-[#F8F9FA] border-t border-[#DDE2E5]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div data-stagger className="text-center mb-16">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-3 bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
            Got Questions?
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight mb-3">
            Frequently Asked Questions
          </h2>
          <p className="text-base text-zinc-500">
            Everything you need to know about building and exporting with Veave.
          </p>
        </div>

        {/* FAQ Accordion List */}
        <div data-stagger="alt" className="space-y-4">
          {faqs.map((faq, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={i}
                className="bg-white rounded-[16px] border border-[#DDE2E5] overflow-hidden transition-all shadow-xs"
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 font-semibold text-zinc-900 text-base hover:text-zinc-600 transition-colors"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-300 ${
                      isOpen ? 'rotate-180 text-zinc-900' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-sm text-zinc-500 leading-relaxed border-t border-zinc-100">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
