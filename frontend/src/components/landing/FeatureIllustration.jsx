import React, { useState, useEffect } from 'react';
import { 
  Shuffle, 
  SkipBack, 
  SkipForward, 
  Pause, 
  Play, 
  Volume2, 
  Heart, 
  Sparkles, 
  ArrowRight, 
  Lock, 
  Check, 
  ShieldCheck, 
  Search,
  Sliders
} from 'lucide-react';

/**
 * Visual illustration for Card 1 (Large):
 * Highly animated Audio-player / product UI mockup in a modern black and grey palette.
 */
export function AudioPlayerIllustration() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [seconds, setSeconds] = useState(134); // 02:14

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSeconds((prev) => (prev >= 270 ? 0 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = Math.min(100, Math.max(0, (seconds / 270) * 100));

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-zinc-100/90 via-zinc-50 to-zinc-200/60 flex items-center justify-center p-4 sm:p-6 select-none overflow-hidden">
      {/* Dynamic ambient pulsing background glow in black/grey */}
      <div className={`absolute -top-12 -right-12 w-48 h-48 bg-zinc-400/15 rounded-full blur-3xl pointer-events-none transition-opacity duration-700 ${isPlaying ? 'opacity-100 animate-pulse-slow' : 'opacity-40'}`} />
      <div className={`absolute -bottom-12 -left-12 w-48 h-48 bg-zinc-500/10 rounded-full blur-3xl pointer-events-none transition-opacity duration-700 ${isPlaying ? 'opacity-100' : 'opacity-30'}`} />

      {/* Floating Audio Player UI Card */}
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-md rounded-2xl border border-zinc-200/90 shadow-[0_10px_30px_rgba(0,0,0,0.06)] p-4 sm:p-5 flex flex-col gap-3.5 transition-all duration-300 group-hover:scale-[1.015]">
        
        {/* Top Info Bar: Media Thumbnail & Track Info */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Animated Media Thumbnail */}
            <div className="relative shrink-0">
              {/* Outer pulsing ring when playing */}
              <div className={`absolute -inset-1 rounded-2xl bg-zinc-900 opacity-20 blur-xs transition-opacity duration-500 ${isPlaying ? 'opacity-30 animate-pulse' : 'opacity-0'}`} />
              
              <div className="relative w-12 h-12 rounded-xl bg-gradient-to-tr from-zinc-950 via-zinc-800 to-zinc-600 p-0.5 shadow-md flex items-center justify-center overflow-hidden">
                {/* 5-Bar Dancing Equalizer in Thumbnail */}
                <div className="flex items-end justify-center gap-[3px] h-6 w-full px-2">
                  <span className={`w-1 bg-white rounded-full transition-all duration-200 ${isPlaying ? 'animate-wave-1' : 'h-1.5'}`} />
                  <span className={`w-1 bg-white rounded-full transition-all duration-200 ${isPlaying ? 'animate-wave-2' : 'h-3'}`} />
                  <span className={`w-1 bg-white rounded-full transition-all duration-200 ${isPlaying ? 'animate-wave-3' : 'h-2'}`} />
                  <span className={`w-1 bg-white rounded-full transition-all duration-200 ${isPlaying ? 'animate-wave-4' : 'h-4'}`} />
                  <span className={`w-1 bg-white rounded-full transition-all duration-200 ${isPlaying ? 'animate-wave-5' : 'h-1.5'}`} />
                </div>
              </div>
            </div>

            {/* Track Info */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs sm:text-sm font-bold text-zinc-900 truncate">
                  Ambient Flow v2.4
                </p>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border transition-colors ${
                  isPlaying 
                    ? 'bg-zinc-900 text-white border-zinc-900' 
                    : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                }`}>
                  {isPlaying ? 'PLAYING' : 'PAUSED'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                Synthetic Beats · Stereo 48kHz
              </p>
            </div>
          </div>

          {/* Action Heart Icon */}
          <button 
            className="text-zinc-400 hover:text-zinc-900 transition-colors p-1 active:scale-90" 
            aria-label="Like track"
          >
            <Heart className="w-4 h-4 fill-zinc-900/10 text-zinc-700 transition-transform hover:scale-110" />
          </button>
        </div>

        {/* Live Interactive Progress Bar & Timestamps */}
        <div className="space-y-1.5">
          <div className="relative w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
            {/* Progress Fill */}
            <div 
              className="absolute left-0 top-0 bottom-0 bg-zinc-900 rounded-full transition-all duration-500 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
            
            {/* Scanning Shimmer Light when playing */}
            {isPlaying && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent w-20 animate-audio-shimmer pointer-events-none" />
            )}

            {/* Thumb Dot */}
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-zinc-900 rounded-full shadow-sm transition-all duration-500 ease-linear"
              style={{ left: `calc(${progressPercent}% - 6px)` }}
            />
          </div>

          {/* Dynamic Timestamps */}
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
            <span className="text-zinc-900 font-semibold">{formatTime(seconds)}</span>
            <span>04:30</span>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between pt-1">
          <button 
            className="text-zinc-800 hover:text-black transition-colors p-1" 
            title="Shuffle active"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSeconds((s) => Math.max(0, s - 15))}
              className="text-zinc-600 hover:text-zinc-950 transition-colors p-1 active:scale-90"
              title="Back 15s"
            >
              <SkipBack className="w-4 h-4 fill-zinc-600" />
            </button>

            {/* Large Circular Interactive Play/Pause Button in Black */}
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={`relative w-9 h-9 rounded-full bg-zinc-900 hover:bg-black text-white flex items-center justify-center shadow-md shadow-zinc-900/20 transition-all active:scale-90 ${
                isPlaying ? 'ring-4 ring-zinc-900/15' : ''
              }`}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-white text-white" />
              ) : (
                <Play className="w-4 h-4 fill-white text-white translate-x-0.5" />
              )}
            </button>

            <button 
              onClick={() => setSeconds((s) => Math.min(270, s + 15))}
              className="text-zinc-600 hover:text-zinc-950 transition-colors p-1 active:scale-90"
              title="Forward 15s"
            >
              <SkipForward className="w-4 h-4 fill-zinc-600" />
            </button>
          </div>

          <button className="text-zinc-500 hover:text-zinc-900 transition-colors p-1" title="Volume">
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual illustration for Card 2 (Large):
 * Two floating UI panels: "TOKENS" and "YOUR APP",
 * with a monochrome black/grey theme.
 */
export function DesignSystemIllustration() {
  const [activeColor, setActiveColor] = useState('#09090B');

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-zinc-50 via-zinc-100/70 to-zinc-200/30 flex items-center justify-center p-3 sm:p-5 select-none overflow-hidden">
      {/* Animated Connector line (SVG) in Grey/Black */}
      <svg 
        className="absolute inset-0 w-full h-full pointer-events-none hidden sm:block" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 180 140 C 240 140, 250 120, 310 120"
          fill="none"
          stroke="#71717A"
          strokeWidth="2"
          strokeDasharray="4 4"
          className="animate-dash-flow opacity-70"
        />
        <circle cx="245" cy="130" r="4" fill="#18181B" className="animate-ping opacity-60" />
        <circle cx="245" cy="130" r="3" fill="#18181B" />
      </svg>

      <div className="flex items-center gap-3 sm:gap-5 w-full max-w-md justify-center relative z-10">
        {/* Left Panel: TOKENS */}
        <div className="w-[48%] bg-white rounded-xl border border-zinc-200 shadow-md p-3 flex flex-col gap-2.5 transition-transform duration-300 group-hover:-translate-x-1">
          {/* Header */}
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-500 flex items-center gap-1">
              <Sliders className="w-2.5 h-2.5 text-zinc-500" />
              TOKENS
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-900 animate-pulse" />
          </div>

          {/* Color Swatches (Black/Grey scale) */}
          <div>
            <span className="text-[9px] text-zinc-400 font-mono block mb-1">Color Tokens</span>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setActiveColor('#09090B')}
                className={`w-5 h-5 rounded-md bg-zinc-950 shadow-xs transition-transform ${activeColor === '#09090B' ? 'ring-2 ring-zinc-950 scale-110' : 'opacity-75'}`} 
                title="#09090B (Pitch Black)" 
              />
              <button 
                onClick={() => setActiveColor('#27272A')}
                className={`w-5 h-5 rounded-md bg-zinc-800 shadow-xs transition-transform ${activeColor === '#27272A' ? 'ring-2 ring-zinc-800 scale-110' : 'opacity-75'}`} 
                title="#27272A (Dark Zinc)" 
              />
              <button 
                onClick={() => setActiveColor('#52525B')}
                className={`w-5 h-5 rounded-md bg-zinc-600 shadow-xs transition-transform ${activeColor === '#52525B' ? 'ring-2 ring-zinc-600 scale-110' : 'opacity-75'}`} 
                title="#52525B (Mid Grey)" 
              />
              <button 
                onClick={() => setActiveColor('#71717A')}
                className={`w-5 h-5 rounded-md bg-zinc-500 shadow-xs transition-transform ${activeColor === '#71717A' ? 'ring-2 ring-zinc-500 scale-110' : 'opacity-75'}`} 
                title="#71717A (Light Grey)" 
              />
            </div>
          </div>

          {/* Typography Token */}
          <div>
            <span className="text-[9px] text-zinc-400 font-mono block mb-1">Typography</span>
            <div className="bg-zinc-50 rounded border border-zinc-100 p-1.5 flex flex-col gap-0.5">
              <div className="h-1.5 w-16 bg-zinc-900 rounded-full" />
              <div className="h-1 w-11 bg-zinc-400 rounded-full" />
            </div>
          </div>

          {/* Spacing Tokens */}
          <div>
            <span className="text-[9px] text-zinc-400 font-mono block mb-1">Spacing</span>
            <div className="flex items-center gap-1 font-mono text-[8px] text-zinc-600">
              <span className="px-1 py-0.5 bg-zinc-100 rounded">4</span>
              <span className="px-1 py-0.5 bg-zinc-100 rounded">8</span>
              <span className="px-1 py-0.5 bg-zinc-900 text-white font-semibold rounded">16</span>
              <span className="px-1 py-0.5 bg-zinc-100 rounded">24</span>
            </div>
          </div>
        </div>

        {/* Right Panel: YOUR APP */}
        <div className="w-[52%] bg-white rounded-xl border border-zinc-300 shadow-lg p-3 flex flex-col gap-2.5 transition-transform duration-300 group-hover:translate-x-1">
          {/* Header */}
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-900 flex items-center gap-1">
              YOUR APP
            </span>
            <span className="text-[9px] font-mono text-zinc-700 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-900 animate-pulse" />
              Live Synced
            </span>
          </div>

          {/* Input field mockup */}
          <div className="w-full bg-zinc-50 rounded-lg border border-zinc-200 px-2 py-1 flex items-center gap-1.5">
            <Search className="w-3 h-3 text-zinc-400 shrink-0" />
            <span className="text-[10px] text-zinc-400 truncate">Search components...</span>
          </div>

          {/* Dynamic Button matching active token color */}
          <button 
            style={{ backgroundColor: activeColor }}
            className="w-full py-1.5 px-3 text-white text-[11px] font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all duration-300 hover:brightness-125 active:scale-95"
          >
            <span>Confirm Action</span>
            <Check className="w-3 h-3" />
          </button>

          {/* Content Block Preview */}
          <div className="bg-zinc-50 rounded-lg p-1.5 border border-zinc-100 flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-zinc-200 text-zinc-800 flex items-center justify-center shrink-0">
              <Sparkles className="w-3 h-3 animate-spin" style={{ animationDuration: '6s' }} />
            </div>
            <div className="flex-1 space-y-1">
              <div className="h-1.5 w-14 bg-zinc-800 rounded-full" />
              <div className="h-1 w-20 bg-zinc-300 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual illustration for Card 3:
 * White UI card containing a bold black button that dynamically grows and shrinks in sync
 * with the AI prompt: "Make it slightly bigger".
 */
export function RapidPrototypingIllustration() {
  return (
    <div className="relative w-full h-full bg-gradient-to-b from-zinc-50 to-zinc-100/60 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-[240px] bg-white rounded-xl border border-[#DDE2E5] shadow-sm p-4 flex flex-col items-center gap-3.5 transition-all duration-300">
        {/* Dynamic growing button in black/grey */}
        <div className="w-full flex items-center justify-center py-1">
          <button className="animate-button-growth py-2.5 px-5 bg-zinc-900 hover:bg-black text-white text-xs font-semibold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all">
            <span>Get Started</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* AI Prompt Input Bar with blinking cursor */}
        <div className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1.5 flex items-center gap-2 shadow-xs">
          <Sparkles className="w-3.5 h-3.5 text-zinc-800 shrink-0 animate-pulse" />
          <div className="flex items-center text-[11px] text-zinc-800 font-medium truncate">
            <span>Make it slightly bigger</span>
            <span className="inline-block w-1 h-3 bg-zinc-900 ml-1 animate-pulse" />
          </div>
          <span className="ml-auto text-[9px] bg-zinc-200 text-zinc-600 px-1 py-0.5 rounded font-mono shrink-0">
            ↵
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Visual illustration for Card 4:
 * Collaborative design canvas in monochrome black & grey style.
 */
export function CollaborationIllustration() {
  return (
    <div className="relative w-full h-full bg-zinc-50 flex items-center justify-center p-4 select-none overflow-hidden">
      {/* Dot matrix canvas background */}
      <div 
        className="absolute inset-0 opacity-40" 
        style={{
          backgroundImage: 'radial-gradient(#a1a1aa 1px, transparent 1px)',
          backgroundSize: '12px 12px'
        }}
      />

      {/* Selected UI Card inside Canvas */}
      <div className="relative w-44 bg-white rounded-lg border-2 border-zinc-900 shadow-md p-2.5 flex flex-col gap-2 z-10 transition-transform duration-300">
        {/* Corner Selection Handles */}
        <div className="w-2 h-2 bg-white border border-zinc-900 rounded-[1px] absolute -top-1 -left-1" />
        <div className="w-2 h-2 bg-white border border-zinc-900 rounded-[1px] absolute -top-1 -right-1" />
        <div className="w-2 h-2 bg-white border border-zinc-900 rounded-[1px] absolute -bottom-1 -left-1" />
        <div className="w-2 h-2 bg-white border border-zinc-900 rounded-[1px] absolute -bottom-1 -right-1" />

        {/* UI Mock elements */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center">
            UI
          </div>
          <div className="space-y-1 flex-1">
            <div className="h-1.5 w-16 bg-zinc-900 rounded-full" />
            <div className="h-1 w-10 bg-zinc-300 rounded-full" />
          </div>
        </div>
        <div className="h-5 w-full bg-zinc-100 rounded flex items-center px-2">
          <div className="h-1 w-14 bg-zinc-700 rounded-full" />
        </div>
      </div>

      {/* Animated Collaborator Cursor 1: Alex (Pitch Black) */}
      <div className="animate-cursor-alex absolute top-5 right-8 z-20 flex flex-col items-start pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-950 drop-shadow-md">
          <path d="M0 0L6 14L8.5 8.5L14 6L0 0Z" fill="currentColor" stroke="white" strokeWidth="1" />
        </svg>
        <span className="bg-zinc-950 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-md shadow-sm -mt-0.5 ml-2">
          Alex (Design)
        </span>
      </div>

      {/* Animated Collaborator Cursor 2: Sarah (Charcoal Grey) */}
      <div className="animate-cursor-sarah absolute bottom-5 left-8 z-20 flex flex-col items-start pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-600 drop-shadow-md">
          <path d="M0 0L6 14L8.5 8.5L14 6L0 0Z" fill="currentColor" stroke="white" strokeWidth="1" />
        </svg>
        <span className="bg-zinc-700 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-md shadow-sm -mt-0.5 ml-2">
          Sarah (Dev)
        </span>
      </div>
    </div>
  );
}

/**
 * Visual illustration for Card 5:
 * Enterprise security lock in black & grey theme with radiating radar rings.
 */
export function SecurityIllustration() {
  return (
    <div className="relative w-full h-full bg-gradient-to-b from-zinc-50 to-zinc-100/60 flex items-center justify-center p-4 select-none overflow-hidden">
      {/* Animated Concentric Radar Pulse Rings in Grey */}
      <div className="animate-radar-1 w-36 h-36 border border-zinc-400/40 rounded-full absolute pointer-events-none" />
      <div className="animate-radar-2 w-48 h-48 border border-zinc-300/30 rounded-full absolute pointer-events-none" />

      {/* SVG Connection Lines in Grey */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <line x1="50%" y1="50%" x2="22%" y2="28%" stroke="#A1A1AA" strokeWidth="1.25" strokeDasharray="3 3" />
        <line x1="50%" y1="50%" x2="78%" y2="28%" stroke="#A1A1AA" strokeWidth="1.25" strokeDasharray="3 3" />
        <line x1="50%" y1="50%" x2="22%" y2="72%" stroke="#A1A1AA" strokeWidth="1.25" strokeDasharray="3 3" />
        <line x1="50%" y1="50%" x2="78%" y2="72%" stroke="#A1A1AA" strokeWidth="1.25" strokeDasharray="3 3" />
      </svg>

      {/* Surrounding Security Nodes */}
      <div className="absolute top-4 left-4 z-10">
        <span className="bg-white border border-zinc-200 text-zinc-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-xs flex items-center gap-1">
          <ShieldCheck className="w-2.5 h-2.5 text-zinc-900" />
          SOC 2
        </span>
      </div>

      <div className="absolute top-4 right-4 z-10">
        <span className="bg-white border border-zinc-200 text-zinc-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-xs">
          AES-256
        </span>
      </div>

      <div className="absolute bottom-4 left-4 z-10">
        <span className="bg-white border border-zinc-200 text-zinc-800 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-xs">
          GDPR
        </span>
      </div>

      <div className="absolute bottom-4 right-4 z-10">
        <span className="bg-zinc-900 text-white text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shadow-xs flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          99.99%
        </span>
      </div>

      {/* Centered Modern Lock Icon Container */}
      <div className="relative z-10 w-16 h-16 bg-white rounded-2xl border border-zinc-300 shadow-[0_4px_18px_rgba(0,0,0,0.06)] flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
        <Lock className="w-7 h-7 text-zinc-900 stroke-[1.8]" />
      </div>
    </div>
  );
}

/**
 * Universal FeatureIllustration dispatcher component
 */
export default function FeatureIllustration({ type }) {
  switch (type) {
    case 'audio-player':
      return <AudioPlayerIllustration />;
    case 'design-system':
      return <DesignSystemIllustration />;
    case 'rapid-prototyping':
      return <RapidPrototypingIllustration />;
    case 'collaboration':
      return <CollaborationIllustration />;
    case 'security':
      return <SecurityIllustration />;
    default:
      return null;
  }
}
