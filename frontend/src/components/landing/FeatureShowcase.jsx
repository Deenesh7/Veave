import React from 'react';
import FeatureCard from './FeatureCard';
import FeatureGrid from './FeatureGrid';
import { 
  AudioPlayerIllustration, 
  DesignSystemIllustration, 
  RapidPrototypingIllustration, 
  CollaborationIllustration, 
  SecurityIllustration 
} from './FeatureIllustration';

/**
 * Feature Showcase Section for SaaS Landing Page
 * Background: #F8F9FA
 * Border: #DDE2E5
 * Aesthetic: Minimalist, clean product-design SaaS look
 */
export default function FeatureShowcase() {
  const topCards = [
    <FeatureCard
      key="card-1"
      large
      category="AI PROTOTYPING"
      title="Prototype new ideas with AI"
      description="Describe what you want in plain English and get a working React interface with a live preview. Refine it by chatting with the AI agent."
      illustration={<AudioPlayerIllustration />}
    />,
    <FeatureCard
      key="card-2"
      large
      category="DESIGN SYSTEMS"
      title="Set your brand colors and fonts"
      description="Create color palettes and upload custom fonts so every generated screen matches your brand."
      illustration={<DesignSystemIllustration />}
    />,
  ];

  const bottomCards = [
    <FeatureCard
      key="card-3"
      category="START ANYWHERE"
      title="Recreate what you already have"
      description="Start from a prompt, a screenshot, a website to clone, a GitHub repository, or a Figma file."
      illustration={<RapidPrototypingIllustration />}
    />,
    <FeatureCard
      key="card-4"
      category="TEAM COLLABORATION"
      title="Work on projects together"
      description="Create groups, invite teammates, and share projects with viewer, editor, or admin access."
      illustration={<CollaborationIllustration />}
    />,
    <FeatureCard
      key="card-5"
      category="PUBLISH"
      title="Publish and use your own domain"
      description="Publish your site from Veave and connect a custom domain on paid plans."
      illustration={<SecurityIllustration />}
      className="md:col-span-2 lg:col-span-1"
    />,
  ];

  return (
    <section 
      id="features" 
      className="w-full bg-[#F8F9FA] py-20 sm:py-28 px-4 sm:px-6 lg:px-8 border-t border-[#DDE2E5]"
    >
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div data-stagger className="max-w-3xl mx-auto text-center mb-14 md:mb-18">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-900 text-xs font-semibold uppercase tracking-wider font-mono mb-4">
            Capabilities
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-zinc-900 tracking-tight leading-tight mb-4">
            Everything you need to build and ship.
          </h2>
          <p className="text-base sm:text-lg text-zinc-500 leading-relaxed max-w-2xl mx-auto">
            From a first prompt to a published site, with a visual editor, a code editor, and one-click export.
          </p>
        </div>

        {/* Feature Grid */}
        <FeatureGrid topCards={topCards} bottomCards={bottomCards} />
      </div>
    </section>
  );
}
