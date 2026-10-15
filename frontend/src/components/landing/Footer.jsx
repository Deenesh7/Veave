import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../common/Logo';
import { Github, Twitter, Linkedin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="w-full bg-[#F8F9FA] border-t border-[#DDE2E5] pt-16 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Top Section */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand & Mission Column */}
          <div className="col-span-2 space-y-4">
            <Logo size="md" />
            <p className="text-xs sm:text-sm text-zinc-500 max-w-sm leading-relaxed">
              Veave is the AI-native prototyping platform engineered to turn product specs into high-fidelity, production-ready React interfaces in minutes.
            </p>
            {/* System Status Pill */}
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white border border-[#DDE2E5] text-[11px] font-mono text-zinc-600 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>All systems operational</span>
            </div>
          </div>

          {/* Column 1: Product */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Product
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-zinc-500">
              <li><a href="#features" className="hover:text-zinc-600 transition-colors">AI Prototyping</a></li>
              <li><a href="#features" className="hover:text-zinc-600 transition-colors">Design Systems</a></li>
              <li><a href="#features" className="hover:text-zinc-600 transition-colors">Live Editor</a></li>
              <li><a href="#pricing" className="hover:text-zinc-600 transition-colors">Pricing</a></li>
            </ul>
          </div>

          {/* Column 2: Resources */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Resources
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-zinc-500">
              <li><Link to="/register" className="hover:text-zinc-600 transition-colors">Documentation</Link></li>
              <li><Link to="/register" className="hover:text-zinc-600 transition-colors">Component Library</Link></li>
              <li><Link to="/register" className="hover:text-zinc-600 transition-colors">Templates</Link></li>
              <li><Link to="/register" className="hover:text-zinc-600 transition-colors">Changelog</Link></li>
            </ul>
          </div>

          {/* Column 3: Legal & Team */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Company
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-zinc-500">
              <li><Link to="/login" className="hover:text-zinc-600 transition-colors">About</Link></li>
              <li><Link to="/login" className="hover:text-zinc-600 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/login" className="hover:text-zinc-600 transition-colors">Terms of Service</Link></li>
              <li><Link to="/login" className="hover:text-zinc-600 transition-colors">Security</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom divider & copyright */}
        <div className="pt-8 border-t border-[#DDE2E5] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
          <p>© {new Date().getFullYear()} Veave AI, Inc. All rights reserved.</p>

          <div className="flex items-center gap-4 text-zinc-400">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-zinc-700 transition-colors" aria-label="GitHub">
              <Github className="w-4 h-4" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hover:text-zinc-700 transition-colors" aria-label="Twitter">
              <Twitter className="w-4 h-4" />
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="hover:text-zinc-700 transition-colors" aria-label="LinkedIn">
              <Linkedin className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
