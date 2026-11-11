import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../common/Logo';

export default function Footer() {
  return (
    <footer className="w-full bg-[#F8F9FA] border-t border-[#DDE2E5] pt-16 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Top Section */}
        <div data-stagger className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand & Mission Column */}
          <div className="col-span-2 space-y-4">
            <Logo size="md" />
            <p className="text-xs sm:text-sm text-zinc-500 max-w-sm leading-relaxed">
              Veave is an AI platform that turns your prompts into React and Tailwind websites you can edit, export, and publish.
            </p>
          </div>

          {/* Column 1: Product */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Product
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-zinc-500">
              <li><a href="#features" className="hover:text-zinc-600 transition-colors">Features</a></li>
              <li><a href="#workflow" className="hover:text-zinc-600 transition-colors">How it works</a></li>
              <li><a href="#faq" className="hover:text-zinc-600 transition-colors">FAQ</a></li>
              <li><a href="#pricing" className="hover:text-zinc-600 transition-colors">Pricing</a></li>
            </ul>
          </div>

          {/* Column 2: Resources */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Resources
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-zinc-500">
              <li><Link to="/documentation" className="hover:text-zinc-600 transition-colors">Documentation</Link></li>
              <li><Link to="/login" className="hover:text-zinc-600 transition-colors">Log in</Link></li>
              <li><Link to="/register" className="hover:text-zinc-600 transition-colors">Sign up</Link></li>
            </ul>
          </div>
        </div>

        {/* Bottom divider & copyright */}
        <div className="pt-8 border-t border-[#DDE2E5] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
          <p>© {new Date().getFullYear()} Veave. All rights reserved.</p>

        </div>
      </div>
    </footer>
  );
}
