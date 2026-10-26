import React from 'react';
import { 
  Home, 
  Share2, 
  Folder, 
  Users, 
  LayoutTemplate, 
  Palette,
  CreditCard,
  UsersRound,
  Mail,
  FolderOpen
} from 'lucide-react';
import CreateButton from './CreateButton';
import SearchBar from './SearchBar';
import DocumentationLink from './DocumentationLink';
import { BounceSidebar } from '../rare-ui';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import { useCollabStore } from '../../store/collabStore';

export default function Sidebar({ collapsed, mobileMenuOpen, onCloseMobileMenu }) {
  const { user } = useAuthStore();
  const projects = useProjectStore((s) => s.projects);
  const pendingInvitations = useCollabStore((s) => s.invitations.length);

  const projectCount = projects?.length > 0 ? String(projects.length) : undefined;

  const navItems = [
    { label: 'Home', href: '/', icon: Home, onClick: onCloseMobileMenu },
    { label: 'Shared with Me', href: '/shared', icon: Share2, onClick: onCloseMobileMenu },
    { label: 'COLLABORATION', heading: true },
    { label: 'Groups', href: '/groups', icon: UsersRound, onClick: onCloseMobileMenu },
    { label: 'Group Projects', href: '/collab/projects', icon: FolderOpen, onClick: onCloseMobileMenu },
    { label: 'Invitations', href: '/invitations', icon: Mail, badge: pendingInvitations > 0 ? String(pendingInvitations) : undefined, onClick: onCloseMobileMenu },
    { label: 'WORKSPACE', heading: true },
    { label: 'Files', href: '/files', icon: Folder, badge: projectCount, onClick: onCloseMobileMenu },
    { label: 'Shared with Workspace', href: '/workspace', icon: Users, onClick: onCloseMobileMenu },
    { label: 'Templates', href: '/templates', icon: LayoutTemplate, onClick: onCloseMobileMenu },
    { label: 'Design Systems', href: '/design-systems', icon: Palette, onClick: onCloseMobileMenu },
    { label: 'Billing', href: '/billing', icon: CreditCard, onClick: onCloseMobileMenu },
  ];

  const content = (
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

      {/* Bottom Sidebar: PDF Upload & Documentation */}
      <div className="mt-auto pt-2">
        <DocumentationLink onNavigate={onCloseMobileMenu} />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar (~260px wide) */}
      <aside
        className={`hidden md:block fixed top-14 left-0 bottom-0 z-30 bg-transparent border-r border-zinc-200/50 transition-all duration-300 ease-in-out ${
          collapsed ? 'w-0 -translate-x-full overflow-hidden' : 'w-[260px]'
        }`}
      >
        <div className="w-[260px] h-full overflow-y-auto">
          {content}
        </div>
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
          <div className="relative w-[280px] h-full bg-transparent border-r border-zinc-200/50 shadow-2xl z-10 pt-14 animate-in slide-in-from-left duration-200">
            {content}
          </div>
        </div>
      )}
    </>
  );
}
