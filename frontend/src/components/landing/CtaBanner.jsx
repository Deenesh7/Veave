import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, ShieldCheck, Zap } from 'lucide-react';

export default function CtaBanner() {
  return (
    <section className="w-full py-20 sm:py-24 bg-white border-t border-[#DDE2E5]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-[24px] bg-zinc-950 text-white p-8 sm:p-14 md:p-18 overflow-hidden shadow-2xl border border-zinc-800/80 text-center">
          {/* Ambient monochrome background glows */}
          <div className="absolute -top-24 -left-24 w-80 h-80 bg-zinc-700/20 rounded-full blur-[90px] pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-zinc-600/20 rounded-full blur-[90px] pointer-events-none" />

          {/* Badge */}
          <div className="relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-mono font-semibold text-zinc-300 mb-6">
            <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
            Get Started in Seconds
          </div>

          {/* Heading */}
          <h2 className="relative z-10 text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-5 leading-tight">
            Ready to transform how you <br className="hidden sm:inline" />
            design & ship web applications?
          </h2>

          {/* Subtitle */}
          <p className="relative z-10 text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Join forward-thinking product teams turning requirements into production-ready React components with unprecedented speed.
          </p>

          {/* Buttons */}
          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register" className="w-full sm:w-auto">
              <button className="w-full sm:w-auto bg-white hover:bg-zinc-100 text-zinc-950 font-semibold px-8 py-3.5 rounded-full text-sm sm:text-base shadow-lg shadow-white/10 flex items-center justify-center gap-2 transition-all active:scale-95 group">
                <span>Start Building for Free</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </Link>
            <a href="#features" className="w-full sm:w-auto">
              <button className="w-full sm:w-auto bg-white/10 hover:bg-white/15 text-white font-semibold px-8 py-3.5 rounded-full text-sm sm:text-base border border-white/15 transition-all active:scale-95">
                Explore Features
              </button>
            </a>
          </div>

          {/* Value props strip */}
          <div className="relative z-10 mt-12 pt-8 border-t border-zinc-800/80 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-zinc-400" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-zinc-400" />
              <span>Full commercial code ownership</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-zinc-400" />
              <span>Instant React & Tailwind export</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
