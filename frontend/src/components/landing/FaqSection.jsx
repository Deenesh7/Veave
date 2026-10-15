import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function FaqSection() {
  const [openIdx, setOpenIdx] = useState(0);

  const faqs = [
    {
      q: 'What technology stack is used in the generated code?',
      a: 'All components are created using clean React 18, standard JavaScript (ES6+), and modern Tailwind CSS. Code is formatted for Vite/Next.js and uses popular accessible libraries like Lucide icons, ensuring zero proprietary dependencies.',
    },
    {
      q: 'Can I download the code and run it on my local machine?',
      a: 'Yes, with a single click you can download a complete ZIP archive with package.json, Tailwind config, and source files. You can run `npm install` and `npm run dev` to start developing immediately.',
    },
    {
      q: 'Can I connect my existing design system and brand tokens?',
      a: 'Absolutely. You can import custom colors, typography scales, border radii, and spacing variables. The AI agent strictly adheres to your design system constraints across all generated screens.',
    },
    {
      q: 'Do I own the rights to the created code and assets?',
      a: 'Yes. You own 100% of all generated code, components, and project structures. There are zero licensing restrictions or royalties, and you are free to use them commercially.',
    },
    {
      q: 'How does live iterative editing work?',
      a: 'You can converse directly with the AI in natural language to refine components, or jump into the built-in Monaco code editor to adjust code directly. Changes reflect in real time on the live hot-reloaded canvas.',
    },
  ];

  return (
    <section className="w-full py-20 sm:py-28 bg-[#F8F9FA] border-t border-[#DDE2E5]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-3 bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
            Got Questions?
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight mb-3">
            Frequently Asked Questions
          </h2>
          <p className="text-base text-zinc-500">
            Everything you need to know about building, exporting, and owning your software.
          </p>
        </div>

        {/* FAQ Accordion List */}
        <div className="space-y-4">
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
