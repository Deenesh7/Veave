import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import TopHeader from './TopHeader';
import Sidebar from './Sidebar';
import PersistentGenerationIndicator from './PersistentGenerationIndicator';

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen text-[#111827] font-sans antialiased flex flex-col">
      {/* Fixed Top Header */}
      <TopHeader
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
      />

      {/* Main App Container (with fixed top offset 56px / h-14) */}
      <div className="flex-1 flex pt-14 relative">
        {/* Fixed Left Sidebar (~260px wide) */}
        <Sidebar
          collapsed={sidebarCollapsed}
          mobileMenuOpen={mobileMenuOpen}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        {/* Central Workspace Canvas */}
        <main
          className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
            sidebarCollapsed ? 'md:pl-0' : 'md:pl-[260px]'
          }`}
        >
          {/* Workspace Top Toolbar: Sidebar Collapse Button */}
          <div className="px-4 sm:px-8 pt-4 pb-1 flex items-center justify-between">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-zinc-500 hover:text-[#111827] hover:bg-zinc-200/60 border border-transparent hover:border-[#E2E5E8] transition-colors"
            >
              {sidebarCollapsed ? (
                <>
                  <PanelLeftOpen className="w-4 h-4 text-[#52525B]" />
                  <span className="font-medium text-[11px]">Show sidebar</span>
                </>
              ) : (
                <>
                  <PanelLeftClose className="w-4 h-4" />
                  <span className="font-medium text-[11px]">Collapse</span>
                </>
              )}
            </button>
          </div>

          {/* Dynamic Route Content */}
          <div className="flex-1 px-4 sm:px-8 pb-16 max-w-7xl w-full mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Background AI Generation Persistent Indicator */}
      <PersistentGenerationIndicator />
    </div>
  );
}
