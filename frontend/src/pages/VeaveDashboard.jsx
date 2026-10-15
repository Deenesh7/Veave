import React, { useState } from 'react';
import AIComposer from '../components/dashboard/AIComposer';
import QuickActions from '../components/dashboard/QuickActions';
import RecentSection from '../components/dashboard/RecentSection';
import { FluidOrb } from '../components/rare-ui';
import { useAuthStore } from '../store/authStore';

export default function VeaveDashboard() {
  const [prompt, setPrompt] = useState('');
  const { user } = useAuthStore();

  const handleSelectQuickAction = (actionPrompt) => {
    setPrompt(actionPrompt);
  };

  const greeting = user?.name ? `Got an idea, ${user.name}?` : 'Got an idea?';

  return (
    <div className="w-full flex flex-col items-center">
      {/* Centered Hero Area */}
      <div className="w-full pt-6 sm:pt-10 pb-6 text-center">
        {/* Ambient Fluid Orb Badge */}
        <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-zinc-50/80 border border-zinc-200/60 mb-4 shadow-2xs backdrop-blur-xs">
          <FluidOrb size={20} color="#18181B" />
          <span className="text-xs font-semibold text-zinc-700 tracking-wide">VEAVE AI 2.0</span>
        </div>

        {/* Large Heading */}
        <h1 className="text-3xl sm:text-[36px] font-extrabold text-[#111827] dark:text-white tracking-tight leading-tight mb-6">
          {greeting}
        </h1>

        {/* AI Prompt Composer */}
        <AIComposer
          prompt={prompt}
          setPrompt={setPrompt}
        />

        {/* Quick Actions Pills */}
        <QuickActions onSelectAction={handleSelectQuickAction} />
      </div>

      {/* Recents Section: connected to real store */}
      <div className="w-full">
        <RecentSection />
      </div>
    </div>
  );
}
