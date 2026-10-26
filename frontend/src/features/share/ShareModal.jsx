import React, { useState, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import { ShareTabs } from './ShareTabs';
import { PublishPanel } from './PublishPanel';
import { DomainPanel } from './DomainPanel';
import ProjectSharingPanel from '../collaboration/ProjectSharingPanel';

export function ShareModal({ isOpen, onClose, project }) {
  const [activeTab, setActiveTab] = useState('collaborate');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const projectId = project?._id || project?.id || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* 1. Dark semi-transparent backdrop with slight blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 2. White Rounded Modal Window */}
      <div
        className="relative w-full max-w-[480px] max-h-[90vh] bg-white rounded-2xl border border-[#DDE2E5] shadow-2xl p-6 overflow-y-auto scrollbar-thin z-10 animate-in fade-in zoom-in-95 duration-200 flex flex-col select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header with Close Button */}
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#111827] tracking-tight">
              Share Project
            </h3>
            <span className="text-xs text-zinc-400 font-medium">·</span>
            <span className="text-xs text-zinc-500 font-medium truncate max-w-[160px]">
              {project?.name || 'Veave Project'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Close modal (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Tabs: Collaborate vs Publish */}
        <ShareTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* Tab Content */}
        {activeTab === 'collaborate' ? (
          <div>
            {/* Real group / people sharing, backed by the project-sharing API */}
            <ProjectSharingPanel project={project} />
          </div>
        ) : activeTab === 'domain' ? (
          <DomainPanel project={project} />
        ) : (
          /* Publish Tab Content */
          <PublishPanel
            project={project}
            onPublishUpdate={(data) => {
              console.log('Project publishing updated:', data);
            }}
          />
        )}
      </div>

    </div>
  );
}

export default ShareModal;
