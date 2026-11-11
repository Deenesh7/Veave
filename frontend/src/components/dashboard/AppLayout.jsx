import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import TopHeader from './TopHeader';
import Sidebar from './Sidebar';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import PersistentGenerationIndicator from './PersistentGenerationIndicator';

export default function AppLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The Template Studio fills the whole workspace card edge to edge.
  const fullBleed = useLocation().pathname.startsWith('/template-studio');
  const sidebarHidden = useTemplateStudioStore((s) => s.appSidebarHidden);

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#2B2823] font-sans antialiased flex flex-col">
      {/* Fixed Top Header */}
      <TopHeader
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
      />

      {/* Main App Container (with fixed top offset 56px / h-14) */}
      <div className="flex-1 flex pt-14 relative">
        {/* Fixed Left Sidebar (~260px wide) */}
        <Sidebar
          collapsed={sidebarHidden}
          mobileMenuOpen={mobileMenuOpen}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        {/* Central Workspace Canvas */}
        <main className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-300 ${sidebarHidden ? 'md:pl-[64px]' : 'md:pl-[260px]'} ${fullBleed ? 'h-[calc(100vh-3.5rem)]' : ''}`}>
          {/* Workspace panel: white, rounded, 16px in from the sidebar, header and window edges.
              Its inner padding is reduced by the same 16px + 1px border so the content keeps its position. */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 m-4 bg-[#FBF9F4] border border-[#E2DCCF] rounded-[20px] shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${fullBleed ? 'overflow-hidden' : ''}`}>
          {/* Top spacing above the page content (keeps every page exactly where it was) */}
          {!fullBleed && <div className="h-1 md:h-[30px] shrink-0" aria-hidden="true" />}

          {/* Dynamic Route Content */}
          <div className={fullBleed ? 'flex-1 min-h-0 w-full' : 'flex-1 px-4 pb-16 max-w-7xl w-full mx-auto'}>
            <Outlet />
          </div>
          </div>
        </main>
      </div>

      {/* Global Background AI Generation Persistent Indicator */}
      <PersistentGenerationIndicator />
    </div>
  );
}
