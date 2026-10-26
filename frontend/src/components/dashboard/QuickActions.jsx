import React, { useState } from 'react';
import { Image, Github, Figma, Globe2 } from 'lucide-react';
import QuickActionButton from './QuickActionButton';
import ScreenshotImportModal from './ScreenshotImportModal';
import GitHubImportModal from './GitHubImportModal';
import FigmaImportModal from './FigmaImportModal';
import CloneWebsiteModal from './CloneWebsiteModal';
import { useProjectStore } from '../../store/projectStore';

export default function QuickActions({ onSelectAction }) {
  const [activeModal, setActiveModal] = useState(null); // 'screenshot' | 'github' | 'figma' | 'clone' | null
  const { fetchProjects } = useProjectStore();

  const handleGenerated = (project) => {
    // Refresh project list in store
    if (fetchProjects) {
      fetchProjects();
    }
  };

  const handleActionClick = (modalType, prompt) => {
    // Open the functional modal
    setActiveModal(modalType);
    // Also optionally populate prompt in composer if requested
    if (onSelectAction && prompt) {
      onSelectAction(prompt);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 mt-4 select-none">
        <QuickActionButton
          icon={Image}
          label="Recreate a screenshot"
          onClick={() =>
            handleActionClick(
              'screenshot',
              'Recreate the UI screenshot with modern minimalist typography, dark navigation, and interactive component cards.'
            )
          }
          active={activeModal === 'screenshot'}
        />

        <QuickActionButton
          icon={Globe2}
          label="Clone a website"
          onClick={() => handleActionClick('clone')}
          active={activeModal === 'clone'}
        />

        <QuickActionButton
          icon={Github}
          label="Import from GitHub"
          onClick={() =>
            handleActionClick(
              'github',
              'Import repository component tree and generate an interactive dashboard overview with live preview.'
            )
          }
          active={activeModal === 'github'}
        />

        <QuickActionButton
          icon={Figma}
          label="Import from Figma"
          onClick={() =>
            handleActionClick(
              'figma',
              'Synchronize Figma design tokens and generate production-ready React components with auto-layout.'
            )
          }
          active={activeModal === 'figma'}
        />

      </div>

      {/* Modals */}
      <ScreenshotImportModal
        isOpen={activeModal === 'screenshot'}
        onClose={() => setActiveModal(null)}
        onGenerated={handleGenerated}
      />

      <CloneWebsiteModal
        isOpen={activeModal === 'clone'}
        onClose={() => setActiveModal(null)}
      />

      <GitHubImportModal
        isOpen={activeModal === 'github'}
        onClose={() => setActiveModal(null)}
        onGenerated={handleGenerated}
      />

      <FigmaImportModal
        isOpen={activeModal === 'figma'}
        onClose={() => setActiveModal(null)}
        onGenerated={handleGenerated}
      />

    </>
  );
}
