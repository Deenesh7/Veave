import React from 'react';

export default function SocialProof() {
  const logos = [
    { name: 'LayerCraft', icon: '⌘' },
    { name: 'Linearis', icon: '◬' },
    { name: 'VortexAI', icon: '✦' },
    { name: 'Novus Labs', icon: '❖' },
    { name: 'Pulseflow', icon: '◎' },
  ];

  return (
    <div className="w-full py-12 border-y border-[#DDE2E5] bg-white/70 backdrop-blur-xs select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-8 font-mono">
          Empowering modern product teams & high-velocity builders
        </p>

        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 md:gap-20 opacity-65 grayscale hover:grayscale-0 transition-all duration-300">
          {logos.map((logo) => (
            <div 
              key={logo.name}
              className="flex items-center gap-2.5 text-zinc-800 font-semibold tracking-tight text-sm md:text-base hover:text-zinc-600 transition-colors cursor-default"
            >
              <span className="text-lg md:text-xl text-zinc-600 font-mono">{logo.icon}</span>
              <span>{logo.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
