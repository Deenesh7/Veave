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
      description="Turn your ideas and product requirements into high-fidelity interfaces in minutes. Explore concepts quickly before committing development resources."
      illustration={<AudioPlayerIllustration />}
    />,
    <FeatureCard
      key="card-2"
      large
      category="DESIGN SYSTEM"
      title="Match your existing designs"
      description="Bring your existing components, styles, and design-system rules into your workflow for consistent product experiences."
      illustration={<DesignSystemIllustration />}
    />,
  ];

  const bottomCards = [
    <FeatureCard
      key="card-3"
      category="RAPID PROTOTYPING"
      title="Show, don't tell"
      description="Prototype new features and test them directly with your customers."
      illustration={<RapidPrototypingIllustration />}
    />,
    <FeatureCard
      key="card-4"
      category="TEAM COLLABORATION"
      title="Design & engineering, together"
      description="Edit, share, and iterate live on designs with your team."
      illustration={<CollaborationIllustration />}
    />,
    <FeatureCard
      key="card-5"
      category="SECURE & COMPLIANT"
      title="Secure AI design for enterprise"
      description="Keep designs secure, compliant, and ready for enterprise use."
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
        <div className="max-w-3xl mx-auto text-center mb-14 md:mb-18">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-900 text-xs font-semibold uppercase tracking-wider font-mono mb-4">
            Capabilities
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-zinc-900 tracking-tight leading-tight mb-4">
            Crafted for speed, built for production.
          </h2>
          <p className="text-base sm:text-lg text-zinc-500 leading-relaxed max-w-2xl mx-auto">
            Experience an AI-accelerated workflow from initial spark to interactive prototypes and synchronized design systems.
          </p>
        </div>

        {/* Feature Grid */}
        <FeatureGrid topCards={topCards} bottomCards={bottomCards} />
      </div>
    </section>
  );
}
