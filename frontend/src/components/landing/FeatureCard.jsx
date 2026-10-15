import React from 'react';

/**
 * Reusable FeatureCard component
 * Adheres to SaaS design specifications:
 * - Rounded corners: 18px (rounded-[18px])
 * - Subtle border: #DDE2E5
 * - Clean white card background
 * - Subtle elevation and hover translate animation
 * - Top illustration slot with thin divider
 * - Category eyebrow, bold title, and description
 */
export default function FeatureCard({
  category,
  title,
  description,
  illustration,
  large = false,
  className = '',
}) {
  return (
    <div
      className={`group bg-white rounded-[18px] border border-[#DDE2E5] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.07)] transition-all duration-300 ease-out hover:-translate-y-1 flex flex-col overflow-hidden ${className}`}
    >
      {/* 1. Visual Illustration Area */}
      <div
        className={`w-full overflow-hidden ${
          large ? 'h-64 sm:h-72' : 'h-52 sm:h-56'
        }`}
      >
        {illustration}
      </div>

      {/* 2. Thin divider between illustration and text */}
      <div className="w-full border-t border-[#DDE2E5]" />

      {/* Text & Content Area with generous internal padding */}
      <div className="p-6 md:p-8 flex flex-col flex-1 justify-between">
        <div>
          {/* 3. Small category/eyebrow label */}
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-2.5">
            {category}
          </span>

          {/* 4. Bold black feature title */}
          <h3 className="text-xl md:text-2xl font-bold text-zinc-900 tracking-tight mb-2.5 leading-snug">
            {title}
          </h3>

          {/* 5. Short gray description */}
          <p className="text-sm md:text-[15px] text-zinc-500 leading-relaxed">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
