import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  ArrowLeft, 
  Sparkles, 
  ChevronDown, 
  Eye, 
  LayoutGrid, 
  Code2, 
  Sliders, 
  Share2, 
  Rocket, 
  Check, 
  Globe, 
  Tag, 
  Plus, 
  X, 
  History 
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { ResponsiveSelector } from './ResponsiveSelector';
import { UndoRedoControls } from './UndoRedoControls';
import { SaveButton } from './SaveButton';

export function EditorToolbar({
  projectName = 'My Website',
  onBack,
  onSave,
  onShare,
  onPublish,
  onInsertBadge,
  onUndo,
  onRedo,
  onOpenHistory,
  isSaving = false
}) {
  const { 
    activeMode, 
    setActiveMode, 
    activeRoute, 
    setActiveRoute, 
    routes, 
    addRoute, 
    removeRoute 
  } = useVisualEditorStore();

  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false);
  const [badgeDropdownOpen, setBadgeDropdownOpen] = useState(false);
  const [routeDropdownCoords, setRouteDropdownCoords] = useState({ top: 0, left: 0 });
  const [badgeDropdownCoords, setBadgeDropdownCoords] = useState({ top: 0, left: 0 });
  const [newPageTitle, setNewPageTitle] = useState('');
  const [customBadgeText, setCustomBadgeText] = useState('');

  const routeDropdownRef = useRef(null);
  const routeButtonRef = useRef(null);
  const badgeDropdownRef = useRef(null);
  const badgeButtonRef = useRef(null);

  const updateRouteDropdownPos = () => {
    if (routeButtonRef.current) {
      const rect = routeButtonRef.current.getBoundingClientRect();
      setRouteDropdownCoords({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 272))
      });
    }
  };

  const updateBadgeDropdownPos = () => {
    if (badgeButtonRef.current) {
      const rect = badgeButtonRef.current.getBoundingClientRect();
      setBadgeDropdownCoords({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 272))
      });
    }
  };

  const handleToggleRouteDropdown = () => {
    if (!routeDropdownOpen) {
      updateRouteDropdownPos();
      setRouteDropdownOpen(true);
      setBadgeDropdownOpen(false);
    } else {
      setRouteDropdownOpen(false);
    }
  };

  const handleToggleBadgeDropdown = () => {
    if (!badgeDropdownOpen) {
      updateBadgeDropdownPos();
      setBadgeDropdownOpen(true);
      setRouteDropdownOpen(false);
    } else {
      setBadgeDropdownOpen(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        routeDropdownRef.current &&
        !routeDropdownRef.current.contains(e.target) &&
        routeButtonRef.current &&
        !routeButtonRef.current.contains(e.target)
      ) {
        setRouteDropdownOpen(false);
      }
      if (
        badgeDropdownRef.current &&
        !badgeDropdownRef.current.contains(e.target) &&
        badgeButtonRef.current &&
        !badgeButtonRef.current.contains(e.target)
      ) {
        setBadgeDropdownOpen(false);
      }
    }
    const handleScrollOrResize = () => {
      if (routeDropdownOpen) updateRouteDropdownPos();
      if (badgeDropdownOpen) updateBadgeDropdownPos();
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [routeDropdownOpen, badgeDropdownOpen]);

  const handleCreatePage = (e) => {
    e?.preventDefault();
    if (newPageTitle.trim()) {
      addRoute(newPageTitle.trim());
      setNewPageTitle('');
    }
  };

  return (
    <header className="h-14 bg-white border-b border-[#E2E5E8] px-3 sm:px-4 flex items-center justify-between gap-3 shrink-0 select-none relative z-40 shadow-2xs">
      {/* LEFT SIDE: Back Button, VEAVE Brand, Project Name, Page Selector */}
      <div className="flex items-center gap-2.5 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-zinc-900 flex items-center justify-center text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-extrabold text-xs tracking-tight text-[#111827] hidden md:inline">
            VEAVE
          </span>
        </div>

        <span className="text-zinc-300 hidden md:inline">/</span>

        {/* Project Name */}
        <span className="text-xs font-semibold text-zinc-800 truncate max-w-[130px] sm:max-w-[170px]">
          {projectName}
        </span>

        <span className="text-zinc-300 hidden sm:inline">/</span>

        {/* Page / Portal Selector Dropdown */}
        <div className="relative">
          <button
            ref={routeButtonRef}
            type="button"
            onClick={handleToggleRouteDropdown}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold text-zinc-700 hover:text-zinc-950 bg-zinc-100/90 hover:bg-zinc-200/80 border border-zinc-200/60 transition-all cursor-pointer shadow-2xs"
          >
            <Globe className="w-3.5 h-3.5 text-zinc-600" />
            <span className="truncate max-w-[120px] font-medium">{activeRoute || 'Home'}</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>
        </div>

        {/* Add Badge Dropdown (In Left Toolbar Context) */}
        <div className="relative">
          <button
            ref={badgeButtonRef}
            type="button"
            onClick={handleToggleBadgeDropdown}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white hover:bg-zinc-50 text-[#111827] border border-[#E2E5E8] text-xs font-bold transition-all shadow-2xs cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
            title="Add a customizable badge to the canvas"
          >
            <Tag className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden md:inline">+ Add Badge</span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Portal Dropdown: Route / Page / Portal Selector */}
      {routeDropdownOpen && createPortal(
        <div 
          ref={routeDropdownRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${routeDropdownCoords.top}px`,
            left: `${routeDropdownCoords.left}px`,
            zIndex: 99999
          }}
          className="w-64 bg-white rounded-2xl border border-zinc-200 shadow-[0_16px_40px_rgba(0,0,0,0.15)] ring-1 ring-black/10 p-2 animate-in fade-in zoom-in-95 duration-150 select-none"
        >
          <div className="px-2 py-1 text-[10px] font-mono uppercase text-zinc-400 font-bold flex items-center justify-between tracking-wider">
            <span>Pages & Portals</span>
            <span className="px-1.5 py-0.2 rounded-full bg-zinc-100 text-zinc-600 font-mono text-[9px]">{routes.length}</span>
          </div>
          <div className="space-y-0.5 max-h-52 overflow-y-auto mt-1">
            {routes.map((route) => (
              <div
                key={route}
                onClick={() => {
                  setActiveRoute(route);
                  setRouteDropdownOpen(false);
                }}
                className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                  activeRoute === route ? 'bg-zinc-50 text-zinc-700 font-bold border border-zinc-100' : 'hover:bg-zinc-50 text-zinc-700'
                }`}
              >
                <span className="truncate">{route}</span>
                <div className="flex items-center gap-1">
                  {activeRoute === route && <Check className="w-3.5 h-3.5 text-zinc-600" />}
                  {routes.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRoute(route);
                      }}
                      className="text-zinc-300 hover:text-red-500 p-0.5 transition-colors cursor-pointer"
                      title="Remove page"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add New Page Form */}
          <form onSubmit={handleCreatePage} className="mt-2 pt-2 border-t border-zinc-100 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="+ New page name..."
              value={newPageTitle}
              onChange={(e) => setNewPageTitle(e.target.value)}
              className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 bg-white"
            />
            <button
              type="submit"
              className="p-1.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white cursor-pointer transition-all shadow-2xs"
              title="Create Page"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>,
        document.body
      )}

      {/* Portal Dropdown: Add Badge Preset */}
      {badgeDropdownOpen && createPortal(
        <div
          ref={badgeDropdownRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${badgeDropdownCoords.top}px`,
            left: `${badgeDropdownCoords.left}px`,
            zIndex: 99999
          }}
          className="w-64 bg-white rounded-2xl border border-zinc-200 shadow-[0_16px_40px_rgba(0,0,0,0.15)] ring-1 ring-black/10 p-2.5 animate-in fade-in zoom-in-95 duration-150 select-none"
        >
          <div className="px-1.5 py-1 text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Insert Badge Preset</span>
            <span className="text-[9px] text-zinc-600 font-semibold bg-zinc-100 px-1.5 py-0.2 rounded-full border border-zinc-200">Live</span>
          </div>

          {/* Custom Badge Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customBadgeText.trim()) {
                if (onInsertBadge) onInsertBadge('indigo', customBadgeText.trim().toUpperCase());
                setCustomBadgeText('');
                setBadgeDropdownOpen(false);
              }
            }}
            className="my-1.5 flex items-center gap-1"
          >
            <input
              type="text"
              placeholder="Custom badge text..."
              value={customBadgeText}
              onChange={(e) => setCustomBadgeText(e.target.value)}
              className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-500 bg-white"
            />
            <button
              type="submit"
              className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-900 text-white cursor-pointer transition-all shadow-2xs text-xs font-bold px-2 shrink-0"
              title="Add custom badge"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="space-y-0.5 mt-1 border-t border-zinc-100 pt-1">
            {[
              { text: 'NEW', color: 'emerald', bg: 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30', label: 'New' },
              { text: 'FEATURED', color: 'indigo', bg: 'bg-indigo-500/15 text-indigo-600 border border-indigo-500/30', label: 'Featured' },
              { text: 'HOT', color: 'amber', bg: 'bg-amber-500/15 text-amber-600 border border-amber-500/30', label: 'Hot' },
              { text: 'PRO', color: 'rose', bg: 'bg-rose-500/15 text-rose-600 border border-rose-500/30', label: 'Pro Tier' },
              { text: 'LEADERBOARD', color: 'zinc', bg: 'bg-zinc-800 text-zinc-100 border border-zinc-700', label: 'Global Rank' },
              { text: 'MAIN PORTAL', color: 'indigo', bg: 'bg-zinc-600 text-white border border-zinc-500', label: 'Portal Link' }
            ].map((item) => (
              <button
                key={item.text}
                type="button"
                onClick={() => {
                  if (onInsertBadge) onInsertBadge(item.color, item.text);
                  setBadgeDropdownOpen(false);
                }}
                className="w-full px-2 py-1.5 rounded-xl hover:bg-zinc-50 flex items-center justify-between text-xs text-zinc-700 font-medium transition-colors cursor-pointer"
              >
                <span>{item.label}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.bg}`}>
                  {item.text}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* CENTER: Mode Switcher (Visual Edit | Preview | Screens | Code) */}
      <div className="flex items-center shrink-0">
        <div className="flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 shadow-2xs">
          {/* Visual Edit Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('editor')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'editor'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Visual Design Editor Mode"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden lg:inline text-[11px]">Visual Edit</span>
          </button>

          {/* Preview Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'preview'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Clean Website Preview Mode"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Preview</span>
          </button>

          {/* Screens Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('screens')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'screens'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Responsive Multi-Screen Comparison"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Screens</span>
          </button>

          {/* Code Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'code'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Inspect Generated Code"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Code</span>
          </button>
        </div>
      </div>

      {/* RIGHT SIDE: Undo/Redo, Responsive Viewport, Layers, Save, Share, Publish */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Undo / Redo */}
        <UndoRedoControls onUndo={onUndo} onRedo={onRedo} />

        {/* Viewport Device Selector */}
        <ResponsiveSelector compact={true} />

        {/* Version History Button */}
        <button
          type="button"
          onClick={onOpenHistory}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="Version History & Snapshots"
        >
          <History className="w-3.5 h-3.5 text-zinc-500" />
          <span className="hidden lg:inline text-[11px]">History</span>
        </button>

        {/* Save Button */}
        <SaveButton onSave={onSave} isSaving={isSaving} />

        {/* Share Button */}
        <button
          type="button"
          onClick={onShare}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="Share Website Prototype"
        >
          <Share2 className="w-3.5 h-3.5 text-zinc-500" />
          <span className="hidden md:inline">Share</span>
        </button>

        {/* Publish Button */}
        <button
          type="button"
          onClick={onPublish}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
          title="Publish Live Deployment"
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>Publish</span>
        </button>
      </div>
    </header>
  );
}

export default EditorToolbar;
