import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { 
  Home, 
  Share2, 
  Folder, 
  Palette,
  CreditCard,
  UsersRound,
  Mail,
  FolderOpen,
  Clock,
  LayoutTemplate,
  Menu,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import CreateButton from './CreateButton';
import SearchBar from './SearchBar';
import DocumentationLink from './DocumentationLink';
import { BounceSidebar } from '../rare-ui';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import { useCollabStore } from '../../store/collabStore';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import MySitesPanel from '../../features/template-studio/MySitesPanel';

export default function Sidebar({ collapsed, mobileMenuOpen, onCloseMobileMenu }) {
  const { user } = useAuthStore();
  const projects = useProjectStore((s) => s.projects);
  const pendingInvitations = useCollabStore((s) => s.invitations.length);

  const [view, setView] = useState('menu'); // 'menu' | 'studio'
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setSidebarHidden = useTemplateStudioStore((s) => s.setAppSidebarHidden);
  const initStudio = useTemplateStudioStore((s) => s.init);

  // Opening the Template Studio page shows its sites and pages in the sidebar.
  useEffect(() => {
    if (pathname.startsWith('/template-studio')) setView('studio');
  }, [pathname]);

  useEffect(() => {
    if (view === 'studio' && !useTemplateStudioStore.getState().sitesLoaded) initStudio();
  }, [view, initStudio]);

  const projectCount = projects?.length > 0 ? String(projects.length) : undefined;

  const navItems = [
    { label: 'Home', href: '/', icon: Home, onClick: onCloseMobileMenu },
    { label: 'Recent', href: '/recent', icon: Clock, onClick: onCloseMobileMenu },
    { label: 'Shared with Others', href: '/shared', icon: Share2, onClick: onCloseMobileMenu },
    { label: 'COLLABORATION', heading: true },
    { label: 'Groups', href: '/groups', icon: UsersRound, onClick: onCloseMobileMenu },
    { label: 'Group Projects', href: '/collab/projects', icon: FolderOpen, onClick: onCloseMobileMenu },
    { label: 'Invitations', href: '/invitations', icon: Mail, badge: pendingInvitations > 0 ? String(pendingInvitations) : undefined, onClick: onCloseMobileMenu },
    { label: 'WORKSPACE', heading: true },
    { label: 'Files', href: '/files', icon: Folder, badge: projectCount, onClick: onCloseMobileMenu },
    { label: 'Design Systems', href: '/design-systems', icon: Palette, onClick: onCloseMobileMenu },
    { label: 'Billing', href: '/billing', icon: CreditCard, onClick: onCloseMobileMenu },
  ];

  const menuPane = (
    <div className="flex flex-col h-full justify-between p-3.5 select-none bg-transparent">
      {/* Top Section */}
      <div className="space-y-4">
        {/* Create Button */}
        <CreateButton />

        {/* Search Bar with Ctrl+K */}
        <SearchBar />

        {/* Animated Bounce Sidebar Navigation */}
        <BounceSidebar items={navItems} dotColor="#18181B" />
      </div>

      {/* Bottom Sidebar: Documentation */}
      <div className="mt-auto pt-2">
        <DocumentationLink onNavigate={onCloseMobileMenu} />
      </div>
    </div>
  );

  const studioPane = (
    <div className="flex flex-col h-full select-none text-[#2B2823]">
      <div className="flex items-center justify-between border-b border-[#E2DCCF] px-4 py-3">
        <h2 className="font-serif text-lg">Template Studio</h2>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <MySitesPanel
          embedded
          className="flex !w-full min-h-0 flex-1 !border-r-0"
          onSelect={() => { navigate('/template-studio'); if (onCloseMobileMenu) onCloseMobileMenu(); }}
        />
      </div>
    </div>
  );

  const content = (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 pb-0 flex items-center gap-2">
        <div className="relative grid flex-1 grid-cols-2 rounded-lg bg-[#EFEBE1] p-0.5 text-xs font-medium">
          <span
            aria-hidden="true"
            className={`absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-[#FBF9F4] shadow-sm transition-transform duration-300 ease-in-out ${view === 'studio' ? 'translate-x-full' : ''}`}
          />
          <button type="button" onClick={() => { setView('menu'); if (pathname.startsWith('/template-studio')) navigate('/dashboard'); }} aria-pressed={view === 'menu'} className="relative z-10 flex items-center justify-center gap-1.5 min-w-0 py-1.5 text-[#2B2823]"><Menu className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Menu</span></button>
          <button type="button" onClick={() => { setView('studio'); if (!pathname.startsWith('/template-studio')) navigate('/template-studio'); }} aria-pressed={view === 'studio'} title="Template Studio" className="relative z-10 flex items-center justify-center gap-1.5 min-w-0 py-1.5 text-[#2B2823]"><LayoutTemplate className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Studio</span></button>
        </div>
        <button
          type="button"
          onClick={() => setSidebarHidden(true)}
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="hidden md:flex shrink-0 h-8 w-8 items-center justify-center rounded-lg text-[#7A7366] hover:bg-[#EAE5D9] hover:text-[#2B2823]"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          className="flex h-full w-[200%] transition-transform duration-300 ease-in-out"
          style={{ transform: view === 'studio' ? 'translateX(-50%)' : 'translateX(0)' }}
        >
          <div className="w-1/2 h-full overflow-y-auto" aria-hidden={view !== 'menu'}>{menuPane}</div>
          <div className="w-1/2 h-full overflow-hidden" aria-hidden={view !== 'studio'}>{studioPane}</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar: full (260px) or a slim icon rail (64px) when collapsed */}
      <aside
        className={`hidden md:block fixed top-14 left-0 bottom-0 z-30 bg-transparent border-r border-[#E2DCCF] overflow-hidden transition-[width] duration-300 ease-in-out ${
          collapsed ? 'w-[64px]' : 'w-[260px]'
        }`}
      >
        {collapsed ? (
          <div className="flex h-full w-[64px] flex-col items-center gap-1 py-3">
            <button
              type="button"
              onClick={() => setSidebarHidden(false)}
              aria-label="Show sidebar"
              title="Show sidebar"
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-[#7A7366] hover:bg-[#EAE5D9] hover:text-[#2B2823]"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            </button>
            {navItems.filter((item) => !item.heading).map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.href === '/'}
                  title={item.label}
                  aria-label={item.label}
                  className={({ isActive }) => `relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-[#EEE9DC] text-[#2B2823]' : 'text-[#7A7366] hover:bg-[#EAE5D9] hover:text-[#2B2823]'}`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {item.badge ? <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-[#5E7B5F] px-1 text-[9px] leading-[14px] text-center text-white">{item.badge}</span> : null}
                </NavLink>
              );
            })}
          </div>
        ) : (
          <div className="w-[260px] h-full">
            {content}
          </div>
        )}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            onClick={onCloseMobileMenu}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          />
          {/* Drawer body */}
          <div className="relative w-[280px] h-full bg-transparent border-r border-[#E2DCCF] shadow-2xl z-10 pt-14 animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
