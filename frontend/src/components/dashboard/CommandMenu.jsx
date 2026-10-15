import React, { useEffect, useRef, useMemo, useState } from 'react';
import { 
  MessageSquare, 
  FileText, 
  LayoutGrid, 
  Bug, 
  Paintbrush 
} from 'lucide-react';

/**
 * Structured command definitions for the VEAVE AI Prompt Composer
 */
export const COMMANDS = [
  {
    category: 'Chat Mode',
    name: 'Ask',
    command: '/ask',
    description: 'Discuss without making any changes.',
    icon: MessageSquare,
    type: 'chat'
  },
  {
    category: 'Chat Mode',
    name: 'Plan',
    command: '/plan',
    description: 'Brainstorm & create a plan.',
    icon: FileText,
    type: 'plan'
  },
  {
    category: 'Skills',
    name: 'Inspiration',
    command: '/inspiration',
    description: 'Explore multiple variants of an idea.',
    icon: LayoutGrid,
    badge: 'System',
    type: 'skill'
  },
  {
    category: 'Skills',
    name: 'Debug',
    command: '/debug',
    description: 'Find and fix a bug.',
    icon: Bug,
    badge: 'System',
    type: 'skill'
  },
  {
    category: 'Skills',
    name: 'Polish',
    command: '/polish',
    description: 'Improve & tidy up the design.',
    icon: Paintbrush,
    badge: 'System',
    type: 'skill'
  }
];

export default function CommandMenu({ 
  isOpen, 
  onClose, 
  onSelectCommand, 
  searchQuery = '', 
  selectedIndex = 0,
  onHighlightIndex,
  anchorRef,
  placement = 'bottom'
}) {
  const menuRef = useRef(null);

  // Filter commands by search query (e.g. matching "/d" -> "d" matches name, command, or description)
  const filteredCommands = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase().replace(/^\//, '');
    if (!q) return COMMANDS;
    return COMMANDS.filter(cmd => 
      cmd.name.toLowerCase().includes(q) ||
      cmd.command.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Group filtered commands by category preserving order
  const groupedCommands = useMemo(() => {
    const groups = {};
    filteredCommands.forEach(cmd => {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (event.target.closest && event.target.closest('[data-command-toggle]')) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        onClose?.();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Scroll active item into view when navigating via keyboard
  useEffect(() => {
    if (!menuRef.current) return;
    const activeEl = menuRef.current.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  let flatIndexCounter = 0;

  return (
    <div 
      ref={menuRef}
      role="listbox"
      aria-label="Commands"
      className={`absolute left-3 sm:left-4 z-50 w-full max-w-[330px] bg-white rounded-xl border border-[#E5E7EB] p-1.5 animate-in fade-in zoom-in-95 duration-150 ${
        placement === 'top' ? 'bottom-full mb-2.5' : 'top-full mt-2.5'
      }`}
      style={{
        boxShadow: '0 10px 28px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)'
      }}
    >
      {filteredCommands.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-400 font-medium select-none">
          No commands found
        </div>
      ) : (
        <div className="space-y-1 max-h-[250px] overflow-y-auto pr-0.5">
          {Object.entries(groupedCommands).map(([category, items]) => (
            <div key={category} className="space-y-0.5">
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider select-none">
                {category}
              </div>

              {items.map((cmd) => {
                const flatIndex = flatIndexCounter++;
                const isSelected = flatIndex === selectedIndex;
                const Icon = cmd.icon;

                return (
                  <button
                    key={cmd.command}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={isSelected}
                    onClick={() => onSelectCommand(cmd)}
                    onMouseEnter={() => onHighlightIndex?.(flatIndex)}
                    className={`w-full px-2 py-1.5 text-left rounded-lg transition-all flex items-center justify-between group cursor-pointer border ${
                      isSelected 
                        ? 'bg-zinc-100/90 border-zinc-200/80 text-zinc-900' 
                        : 'bg-transparent border-transparent hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                        isSelected 
                          ? 'bg-white text-zinc-900 shadow-2xs' 
                          : 'bg-zinc-100 text-zinc-500 group-hover:text-zinc-800'
                      }`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-zinc-900 shrink-0">
                          {cmd.name}
                        </span>
                        <span className="text-[11px] text-zinc-400 truncate">
                          {cmd.description}
                        </span>
                      </div>
                    </div>

                    {cmd.badge && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-400 bg-zinc-50 shrink-0 ml-1.5">
                        {cmd.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
