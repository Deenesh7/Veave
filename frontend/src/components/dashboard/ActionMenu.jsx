import React, { useState, useRef, useEffect, useCallback } from 'react';
import { prepareImageForUpload } from '../../utils/imageUpload';
import { 
  Plus, 
  FileText, 
  Component as ComponentIcon, 
  Github, 
  Plug, 
  Sparkles 
} from 'lucide-react';

export default function ActionMenu({
  onUploadFile,
  onOpenAddComponent,
  onOpenConnectGitHub,
  onOpenConnectors,
  onOpenSkills,
  activeSkillsCount = 0,
  className = ''
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [alignRight, setAlignRight] = useState(false);
  const [openUpward, setOpenUpward] = useState(true);

  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const fileInputRef = useRef(null);
  const itemRefs = useRef([]);

  // Define action menu items in exact specified order:
  // 1. Upload File
  // 2. Add Component
  // 3. Connect GitHub
  // 4. (divider)
  // 5. Connectors
  // 6. Skills
  const menuActions = [
    {
      id: 'upload-file',
      label: 'Upload File',
      icon: FileText,
      iconColor: 'text-zinc-500 group-hover:text-zinc-600',
      action: () => {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click();
        }
      }
    },
    {
      id: 'add-component',
      label: 'Add Component',
      icon: ComponentIcon,
      iconColor: 'text-zinc-500 group-hover:text-purple-600',
      action: () => {
        onOpenAddComponent?.();
      }
    },
    {
      id: 'connect-github',
      label: 'Connect GitHub',
      icon: Github,
      iconColor: 'text-zinc-500 group-hover:text-zinc-900',
      action: () => {
        onOpenConnectGitHub?.();
      }
    },
    {
      divider: true
    },
    {
      id: 'connectors',
      label: 'Connectors',
      icon: Plug,
      iconColor: 'text-zinc-500 group-hover:text-emerald-600',
      action: () => {
        onOpenConnectors?.();
      }
    },
    {
      id: 'skills',
      label: 'Skills',
      count: activeSkillsCount,
      icon: Sparkles,
      iconColor: 'text-zinc-500 group-hover:text-amber-500',
      action: () => {
        onOpenSkills?.();
      }
    }
  ];

  // Filter out dividers for keyboard navigable items
  const navigableActions = menuActions.filter(item => !item.divider);

  // Check viewport overflow to align left or right, and top or bottom
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 208; // w-52 is 13rem = 208px
      setAlignRight(rect.left + menuWidth > window.innerWidth - 16);
      setOpenUpward(rect.bottom + 260 > window.innerHeight);
    }
  }, [isOpen]);

  // Handle outside click & escape key
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    const handleKeyDown = (e) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        buttonRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % navigableActions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + navigableActions.length) % navigableActions.length);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (activeIndex >= 0 && activeIndex < navigableActions.length) {
          e.preventDefault();
          const target = navigableActions[activeIndex];
          setIsOpen(false);
          setActiveIndex(-1);
          target.action();
        }
      } else if (e.key === 'Tab') {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, activeIndex, navigableActions]);

  // Focus active item when activeIndex changes
  useEffect(() => {
    if (isOpen && activeIndex >= 0 && itemRefs.current[activeIndex]) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [isOpen, activeIndex]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
    setActiveIndex(-1);
  };

  const handleItemClick = (item) => {
    setIsOpen(false);
    setActiveIndex(-1);
    item.action();
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      const isText = file.type.startsWith('text/') || 
        file.name.endsWith('.js') || 
        file.name.endsWith('.jsx') || 
        file.name.endsWith('.ts') || 
        file.name.endsWith('.tsx') || 
        file.name.endsWith('.json') || 
        file.name.endsWith('.css') || 
        file.name.endsWith('.html') || 
        file.name.endsWith('.md');

      const isImage = file.type.startsWith('image/');

      if (isImage) {
        prepareImageForUpload(file)
          .then(({ dataUrl, size, type }) => onUploadFile?.({
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: file.name,
            size,
            type,
            dataUrl,
            isImage: true,
            file
          }))
          .catch((error) => window.alert(error.message || 'This image could not be attached.'));
      } else if (isText) {
        reader.onload = (event) => {
          onUploadFile?.({
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: file.name,
            size: file.size,
            type: file.type,
            content: event.target.result,
            isImage: false,
            file
          });
        };
        reader.readAsText(file);
      } else {
        // Generic binary or document file
        reader.onload = (event) => {
          onUploadFile?.({
            id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: file.name,
            size: file.size,
            type: file.type,
            dataUrl: event.target.result,
            isImage: false,
            file
          });
        };
        reader.readAsDataURL(file);
      }
    });
  };

  let navigableCounter = 0;

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Hidden file input for native device file picker */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        accept="image/*,.js,.jsx,.ts,.tsx,.json,.css,.html,.md,.txt,.pdf"
      />

      {/* The + Action Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Add file, component, integration, or skill"
        title={activeSkillsCount > 0 ? `Actions · ${activeSkillsCount} active skill${activeSkillsCount > 1 ? 's' : ''}` : 'Actions (Upload File, Add Component, GitHub, Connectors, Skills)'}
        className={`relative w-8 h-8 rounded-full transition-all duration-200 cursor-pointer flex items-center justify-center outline-none select-none border focus-visible:ring-2 focus-visible:ring-zinc-900/15 ${
          isOpen
            ? 'bg-zinc-100 text-zinc-900 border-zinc-300'
            : 'bg-white text-zinc-500 border-zinc-200 hover:text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300'
        }`}
      >
        <Plus
          className={`w-4 h-4 transition-transform duration-200 stroke-[2] ${
            isOpen ? 'rotate-45 text-zinc-800' : ''
          }`}
        />
        {activeSkillsCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-zinc-900 text-white text-[10px] font-bold leading-4 text-center ring-2 ring-white" aria-hidden="true">{activeSkillsCount}</span>
        )}
      </button>

      {/* Floating Action Menu Dropdown */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          aria-label="Add actions"
          className={`absolute ${
            openUpward ? 'bottom-full mb-2 slide-in-from-bottom-2' : 'top-full mt-2 slide-in-from-top-1'
          } z-50 w-52 bg-white rounded-2xl border border-[#E2E5E8] shadow-[0_12px_36px_rgba(0,0,0,0.09)] p-1.5 animate-in fade-in duration-150 select-none outline-none ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {menuActions.map((item, index) => {
            if (item.divider) {
              return (
                <div
                  key={`divider-${index}`}
                  role="separator"
                  className="my-1 border-t border-zinc-100"
                />
              );
            }

            const currentNavIndex = navigableCounter++;
            const Icon = item.icon;
            const isFocused = activeIndex === currentNavIndex;

            return (
              <button
                key={item.id}
                ref={(el) => (itemRefs.current[currentNavIndex] = el)}
                role="menuitem"
                tabIndex={0}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setActiveIndex(currentNavIndex)}
                className={`w-full px-2.5 py-2 rounded-xl text-xs font-medium text-left flex items-center gap-2.5 transition-colors cursor-pointer group outline-none ${
                  isFocused
                    ? 'bg-zinc-100/90 text-[#111827]'
                    : 'text-zinc-700 hover:text-[#111827] hover:bg-zinc-100/70'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 transition-colors stroke-[1.8] ${item.iconColor}`}
                />
                <span className="truncate tracking-tight font-medium">{item.label}</span>
                {item.count > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-zinc-900 text-white text-[10px] font-bold leading-none">{item.count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
