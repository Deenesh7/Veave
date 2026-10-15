import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, Play } from 'lucide-react';
import { Logo } from '../components/common/Logo';
import HeroPreview from '../components/landing/HeroPreview';
import SocialProof from '../components/landing/SocialProof';
import FeatureShowcase from '../components/landing/FeatureShowcase';
import WorkflowSteps from '../components/landing/WorkflowSteps';
import MetricsStrip from '../components/landing/MetricsStrip';
import PricingSection from '../components/landing/PricingSection';
import FaqSection from '../components/landing/FaqSection';
import CtaBanner from '../components/landing/CtaBanner';
import Footer from '../components/landing/Footer';

export default function Landing() {
  return (
    <div className="min-h-screen canvas-grid-pattern text-zinc-900 font-sans selection:bg-zinc-800 selection:text-white overflow-x-hidden">
      {/* Soft Ambient Monochrome Gradients Background for Hero */}
      <div className="absolute top-0 left-0 right-0 h-[100vh] pointer-events-none overflow-hidden z-0 flex items-center justify-center">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-zinc-200/50 blur-[100px] animate-pulse-slow mix-blend-multiply" />
        <div className="absolute top-[20%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-zinc-100/60 blur-[100px] animate-pulse-slow mix-blend-multiply" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-[-10%] left-[10%] w-[60vw] h-[60vw] rounded-full bg-zinc-200/40 blur-[120px] animate-pulse-slow mix-blend-multiply" style={{ animationDelay: '4s' }} />
        <div className="absolute bottom-[20%] right-[10%] w-[45vw] h-[45vw] rounded-full bg-zinc-100/50 blur-[100px] animate-pulse-slow mix-blend-multiply" style={{ animationDelay: '1s' }} />
      </div>

      {/* Navigation Bar */}
      <header className="relative z-50 w-full pt-6 px-6 md:px-12">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Logo size="md" />
          
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors">
              Features
            </a>
            <a href="#workflow" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors">
              Workflow
            </a>
            <a href="#pricing" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors">
              Pricing
            </a>
            <Link to="/login" className="text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors">
              Log in
            </Link>
          </nav>
          
          <div className="flex items-center gap-4">
            <Link to="/register" className="hidden md:flex">
              <button className="bg-zinc-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-black transition-all shadow-[0_4px_14px_0_rgb(0,0,0,10%)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] active:scale-95">
                Get Started
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 w-full pt-16 sm:pt-20 pb-12 px-4 flex flex-col items-center justify-center text-center">
        <div className="max-w-5xl mx-auto flex flex-col items-center">
          
          {/* Eyebrow Badge */}
          <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '100ms' }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 backdrop-blur-md border border-zinc-200/80 text-xs font-medium text-zinc-800 shadow-xs mb-8">
              <Sparkles className="w-3.5 h-3.5 text-zinc-900" />
              <span>Next-Generation AI Prototyping Platform</span>
            </div>
          </div>

          {/* Main Headline */}
          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-[5.75rem] font-bold tracking-[-0.04em] leading-[1.05] mb-8 animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '200ms' }}>
            <span className="text-zinc-900 block">Build interfaces without</span>
            <span className="text-zinc-400 block mt-1.5">the complexity.</span>
          </h1>

          {/* Description */}
          <p className="text-lg md:text-xl text-zinc-500 max-w-2xl mx-auto mb-10 animate-slide-up opacity-0 [animation-fill-mode:forwards] leading-relaxed" style={{ animationDelay: '300ms' }}>
            Turn natural language prompts into production-ready React and Tailwind components. Edit visually or via conversation, and export clean code with zero vendor lock-in.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-4 animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '400ms' }}>
            <Link to="/register" className="w-full sm:w-auto">
              <button className="w-full sm:w-auto bg-zinc-900 hover:bg-black text-white px-8 py-4 rounded-full text-base font-semibold transition-all shadow-[0_4px_16px_rgba(0,0,0,0.18)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.25)] flex items-center justify-center gap-2 active:scale-95 group">
                Start building free
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </Link>
            <a href="#features" className="w-full sm:w-auto">
              <button className="w-full sm:w-auto bg-white text-zinc-900 px-8 py-4 rounded-full text-base font-medium hover:bg-zinc-50 transition-all border border-zinc-200 shadow-xs flex items-center justify-center gap-2 active:scale-95 group">
                <Play className="w-4 h-4 fill-zinc-900 group-hover:scale-110 transition-transform" />
                Explore features
              </button>
            </a>
          </div>
        </div>

        {/* High-Fidelity Browser/Editor Preview Mockup */}
        <HeroPreview />
      </main>

      {/* Social Proof Logo Ribbon */}
      <div className="relative z-20">
        <SocialProof />
      </div>

      {/* Feature Showcase (Bento Grid Section) */}
      <div className="relative z-20">
        <FeatureShowcase />
      </div>

      {/* Workflow: How It Works */}
      <div id="workflow" className="relative z-20">
        <WorkflowSteps />
      </div>

      {/* Key Metrics / Stats Strip */}
      <div className="relative z-20">
        <MetricsStrip />
      </div>

      {/* Transparent Pricing Section */}
      <div className="relative z-20">
        <PricingSection />
      </div>

      {/* FAQ Section */}
      <div className="relative z-20">
        <FaqSection />
      </div>

      {/* Pre-footer High Impact CTA */}
      <div className="relative z-20">
        <CtaBanner />
      </div>

      {/* Multi-Column SaaS Footer */}
      <div className="relative z-20">
        <Footer />
      </div>
    </div>
  );
}
