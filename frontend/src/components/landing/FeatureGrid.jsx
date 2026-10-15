import React from 'react';

/**
 * Responsive grid container for the SaaS Feature Showcase.
 * - Row 1: 2 large feature cards (md:grid-cols-2)
 * - Row 2: 3 smaller feature cards (md:grid-cols-3)
 * - Mobile / Tablet: Gracefully stacks to single column or 2-column with responsive spacing.
 */
export default function FeatureGrid({ topCards, bottomCards }) {
  return (
    <div className="w-full space-y-6 lg:space-y-8">
      {/* Top Row: 2 Large Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {topCards}
      </div>

      {/* Bottom Row: 3 Smaller Feature Cards (equal width) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
        {bottomCards}
      </div>
    </div>
  );
}
