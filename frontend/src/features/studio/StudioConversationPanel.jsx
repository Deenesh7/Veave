import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, 
  CheckCircle2, 
  Loader2, 
  PanelRightClose, 
  PanelRightOpen, 
  Code2, 
  Clock, 
  RotateCcw,
  RotateCw,
  History,
  MessageSquare,
  Activity,
  Layers,
  ArrowRight,
  GitBranch,
  User,
  Bot
} from 'lucide-react';
import { StudioPromptBar } from './StudioPromptBar';
import { MatrixOrb } from '../../components/rare-ui';
import { useGenerationJobStore } from '../../store/generationJobStore';
import { useAuthStore } from '../../store/authStore';

export const GENERATION_TIMELINE_STEPS = [
  { id: 1, name: 'Understanding your idea', phase: 1, statusText: 'Understanding your idea...' },
  { id: 2, name: 'Identifying the website structure', phase: 1, statusText: 'Exploring layout possibilities...' },
  { id: 3, name: 'Planning the layout', phase: 2, statusText: 'Planning the interface...' },
  { id: 4, name: 'Selecting visual style', phase: 2, statusText: 'Designing the visual hierarchy...' },
  { id: 5, name: 'Designing components', phase: 3, statusText: 'Creating the component structure...' },
  { id: 6, name: 'Creating responsive layout', phase: 4, statusText: 'Building the first version...' },
  { id: 7, name: 'Applying typography', phase: 5, statusText: 'Adding visual details...' },
  { id: 8, name: 'Adding interactions', phase: 5, statusText: 'Making everything responsive...' },
  { id: 9, name: 'Preparing preview', phase: 6, statusText: 'Your design is coming together...' },
];

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return '';
  }
}

export function StudioConversationPanel({
  prompt,
  isGenerating,
  currentStep,
  statusMessage,
  onSelectClarification,
  components = [],
  files = [],
  tokens = null,
  isOpen,
  setIsOpen,
  onSubmitPrompt,
  onStopGeneration,
  onUndo,
  onRedo,
  onRollback,
  onOpenFile
}) {
  const [selectedStyle, setSelectedStyle] = useState('Modern');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'lineage' | 'timeline'
  const chatBottomRef = useRef(null);

  const {
    conversationMessages,
    generationHistory,
    activeGenerationId,
    conversationId,
    canUndo,
    canRedo
  } = useGenerationJobStore();

  const { user: authUser } = useAuthStore();

  const styleOptions = [
    { label: 'Modern', desc: 'Clean gradients & rounded cards' },
    { label: 'Minimal', desc: 'Monochrome & crisp typography' },
    { label: 'Professional', desc: 'Corporate & structured' },
    { label: 'Creative', desc: 'Vibrant palettes & expressive' }
  ];

  // Auto-scroll chat to latest message on updates
  useEffect(() => {
    if (activeTab === 'chat' && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationMessages, isGenerating, activeTab]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="absolute top-16 right-4 z-20 p-2.5 rounded-2xl bg-white border border-[#E2E5E8] shadow-md hover:bg-zinc-50 text-zinc-700 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer"
        title="Open Veave"
      >
        <Sparkles className="w-4 h-4 text-zinc-600" />
        <span className="hidden sm:inline">Veave</span>
        <PanelRightOpen className="w-3.5 h-3.5 text-zinc-400" />
      </button>
    );
  }

  // Display initial prompt as fallback if no messages loaded yet
  const displayedMessages = conversationMessages && conversationMessages.length > 0
    ? conversationMessages
    : (prompt ? [{ role: 'user', content: prompt, timestamp: new Date() }] : []);

  const hasGenerations = generationHistory && generationHistory.length > 0;
  const canDoUndo = canUndo !== undefined ? canUndo : (generationHistory && generationHistory.length > 1);
  const canDoRedo = !!canRedo;

  return (
    <aside className="w-84 sm:w-96 lg:w-[420px] h-full bg-white border-l border-[#E2E5E8] flex flex-col justify-between shrink-0 select-none relative z-20 shadow-xs">
      {/* Panel Header */}
      <div className="h-12 px-4 border-b border-[#E2E5E8] flex items-center justify-between bg-zinc-50/80">
        <div className="flex items-center gap-2.5">
          <MatrixOrb 
            state={isGenerating ? 'thinking' : 'idle'} 
            size={22} 
            dots={7} 
            color="#18181B" 
            className="shrink-0"
          />
          <div>
            <span className="font-bold text-xs text-[#111827] tracking-tight block">Veave</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {canDoUndo && (
            <button
              onClick={() => {
                try {
                  const res = onUndo && onUndo();
                  if (res && typeof res.catch === 'function') {
                    res.catch((err) => console.warn('Undo failed:', err));
                  }
                } catch (e) {
                  console.warn('Undo failed:', e);
                }
              }}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 transition-colors flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              title="Undo previous change (restore immediate previous state)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-zinc-600" />
              <span className="hidden sm:inline">Undo</span>
            </button>
          )}

          {canDoRedo && (
            <button
              onClick={() => {
                try {
                  const res = onRedo && onRedo();
                  if (res && typeof res.catch === 'function') {
                    res.catch((err) => console.warn('Redo failed:', err));
                  }
                } catch (e) {
                  console.warn('Redo failed:', e);
                }
              }}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 transition-colors flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              title="Redo forward change"
            >
              <RotateCw className="w-3.5 h-3.5 text-zinc-600" />
              <span className="hidden sm:inline">Redo</span>
            </button>
          )}

          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 transition-colors cursor-pointer"
            title="Collapse Panel"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs: Chat, Lineage, Timeline */}
      <div className="flex items-center border-b border-zinc-200 bg-white px-2 py-1 gap-1 text-xs">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-zinc-900 text-white shadow-2xs'
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Chat</span>
        </button>

        <button
          onClick={() => setActiveTab('lineage')}
          className={`flex-1 py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'lineage'
              ? 'bg-zinc-900 text-white shadow-2xs'
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Lineage</span>
          {hasGenerations && (
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
              activeTab === 'lineage' ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-600'
            }`}>
              {generationHistory.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('timeline')}
          className={`flex-1 py-1.5 px-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'timeline'
              ? 'bg-zinc-900 text-white shadow-2xs'
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Activity</span>
        </button>
      </div>

      {/* Main Tab Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
        
        {/* ==================================================== */}
        {/* TAB 1: CHAT FEED (Stateful Message History) */}
        {/* ==================================================== */}
        {activeTab === 'chat' && (
          <div className="space-y-3">
            {displayedMessages.length > 0 && (
              <div className="flex items-center justify-center my-2">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] text-zinc-500 font-medium shadow-2xs">
                  <Sparkles className="w-3 h-3 text-zinc-700" />
                  <span>Start of Conversation · Full History</span>
                </div>
              </div>
            )}

            {displayedMessages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div 
                  key={idx} 
                  className={`flex flex-col gap-1 text-xs animate-in fade-in duration-200 ${
                    isUser ? 'items-end pl-8' : 'items-start pr-6'
                  }`}
                >
                  {isUser ? (
                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-zinc-400 font-mono">
                      {(msg.isInitial || idx === 0) && (
                        <span className="px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-700 font-bold text-[9px] uppercase tracking-wider border border-zinc-200">
                          Initial Prompt
                        </span>
                      )}
                      <span>{formatMessageTime(msg.timestamp)}</span>
                      <span className="font-semibold text-zinc-600">You</span>
                      <User className="w-3 h-3 text-zinc-500" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-zinc-400 font-mono">
                      <Bot className="w-3 h-3 text-zinc-500" />
                      <span className="font-semibold text-zinc-600">Veave</span>
                      <span>{formatMessageTime(msg.timestamp)}</span>
                    </div>
                  )}

                  <div className={`p-3 rounded-2xl text-xs leading-relaxed max-w-full shadow-2xs ${
                    isUser 
                      ? 'bg-zinc-900 text-white rounded-tr-xs font-medium'
                      : 'bg-zinc-50 text-zinc-800 border border-zinc-200/90 rounded-tl-xs'
                  }`}>
                    {(!msg.changeSummary || isUser || (!msg.content.startsWith('Applied changes:') && !msg.content.startsWith('Restored') && !msg.content.startsWith('Reverted'))) && (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}

                    {msg.changeSummary && !isUser && (
                      <div className={`${(!msg.changeSummary || isUser || (!msg.content.startsWith('Applied changes:') && !msg.content.startsWith('Restored') && !msg.content.startsWith('Reverted'))) ? 'mt-2 pt-2 border-t border-zinc-200/60' : ''} flex items-center gap-1.5 text-xs font-semibold text-emerald-700`}>
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        <span className="break-words">{msg.changeSummary}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* In-Flight Thinking Indicator */}
            {isGenerating && (
              <div className="flex flex-col items-start pr-6 gap-1 animate-in fade-in">
                <div className="flex items-center gap-1.5 px-1 text-[10px] text-zinc-400 font-mono">
                  <Bot className="w-3 h-3 text-zinc-500" />
                  <span className="font-semibold text-zinc-600">Veave</span>
                </div>
                <div className="p-3 rounded-2xl bg-zinc-50/80 border border-zinc-200 text-zinc-900 text-xs flex items-center gap-2.5 shadow-2xs">
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-600 shrink-0" />
                  <span className="font-medium">{statusMessage || 'Applying incremental modification...'}</span>
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: SESSION LINEAGE (Checkpoints & Restore) */}
        {/* ==================================================== */}
        {activeTab === 'lineage' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
              <div>
                <span className="text-xs font-bold text-zinc-800">Session Checkpoints</span>
                <span className="text-[10px] text-zinc-400 block">1-Day History · Step-by-Step Restore</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                {generationHistory.length} Checkpoints
              </span>
            </div>

            {hasGenerations ? (
              <div className="space-y-2 relative pl-2">
                <div className="absolute left-4 top-3 bottom-3 w-0.5 bg-zinc-200" />

                {generationHistory.map((gen, idx) => {
                  const isActive = gen.isActive !== undefined
                    ? gen.isActive
                    : (gen.generationId === activeGenerationId || idx === generationHistory.length - 1);
                  return (
                    <div 
                      key={gen.generationId || idx}
                      className={`relative flex flex-col p-3 rounded-2xl border transition-all ${
                        isActive
                          ? 'bg-zinc-50/60 border-zinc-200 ring-2 ring-zinc-100 shadow-2xs'
                          : 'bg-white border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-zinc-600 ring-4 ring-zinc-100' : 'bg-zinc-300'}`} />
                          <span className="font-bold text-xs text-zinc-900">
                            Checkpoint {gen.versionNumber || (idx + 1)}
                          </span>
                          {isActive && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-zinc-100 text-zinc-700">
                              Active
                            </span>
                          )}
                        </div>

                        {!isActive && onRollback && (
                          <button
                            onClick={() => {
                              try {
                                const res = onRollback(gen.generationId);
                                if (res && typeof res.catch === 'function') {
                                  res.catch((err) => console.warn('Rollback failed:', err));
                                }
                              } catch (err) {
                                console.warn('Rollback failed:', err);
                              }
                            }}
                            className="text-[11px] font-semibold text-zinc-600 hover:text-zinc-800 hover:underline flex items-center gap-0.5 cursor-pointer"
                          >
                            <span>Restore</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-zinc-700 font-medium line-clamp-2">
                        "{gen.userPrompt}"
                      </p>

                      {gen.changeSummary && (
                        <span className="text-[10px] text-zinc-500 font-mono mt-1 block">
                          Change: {gen.changeSummary}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-400">
                <History className="w-6 h-6 mx-auto mb-2 text-zinc-300" />
                <span>No prior session checkpoints recorded yet.</span>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: ACTIVITY TIMELINE & SOURCE FILES */}
        {/* ==================================================== */}
        {activeTab === 'timeline' && (
          <div className="space-y-4">
            {/* Live AI Status Badge */}
            <div className={`p-3 rounded-2xl border transition-all ${
              isGenerating 
                ? 'bg-zinc-50/80 border-zinc-200 shadow-xs' 
                : 'bg-emerald-50/80 border-emerald-200'
            }`}>
              <div className="flex items-center gap-2.5">
                <MatrixOrb 
                  state={isGenerating ? 'thinking' : 'idle'} 
                  size={24} 
                  dots={7} 
                  color={isGenerating ? '#18181B' : '#059669'} 
                  className="shrink-0"
                />
                <div className="min-w-0">
                  <span className={`text-[11px] font-bold block truncate ${
                    isGenerating ? 'text-zinc-900' : 'text-emerald-900'
                  }`}>
                    {statusMessage || (isGenerating ? 'Synthesizing layout...' : 'Your interface is ready.')}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {isGenerating ? `Step ${currentStep + 1} of ${GENERATION_TIMELINE_STEPS.length}` : 'Completed successfully'}
                  </span>
                </div>
              </div>
            </div>

            {/* Style Clarification Options */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-700">Visual Style Setting</span>
                <span className="text-[10px] font-mono text-zinc-400">{selectedStyle}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {styleOptions.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => {
                      setSelectedStyle(opt.label);
                      if (onSelectClarification) onSelectClarification(opt.label);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border text-left transition-all cursor-pointer ${
                      selectedStyle === opt.label 
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-2xs' 
                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Animated AI Activity Timeline */}
            <div className="bg-white rounded-2xl border border-zinc-200 p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <span className="text-xs font-bold text-zinc-900">Activity Timeline</span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {Math.min(100, Math.round(((currentStep + 1) / GENERATION_TIMELINE_STEPS.length) * 100))}%
                </span>
              </div>

              <div className="space-y-2 relative pl-2">
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-zinc-100" />

                {GENERATION_TIMELINE_STEPS.map((step, idx) => {
                  const isPast = currentStep > idx;
                  const isCurrent = currentStep === idx;
                  return (
                    <div 
                      key={step.id} 
                      className={`relative flex items-center gap-2.5 py-1 text-xs transition-all duration-300 ${
                        isCurrent ? 'font-bold text-zinc-600 scale-101 pl-1' :
                        isPast ? 'text-zinc-700 font-medium' :
                        'text-zinc-400'
                      }`}
                    >
                      <div className="relative z-10 shrink-0">
                        {isPast ? (
                          <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        ) : isCurrent ? (
                          <div className="w-4 h-4 rounded-full bg-zinc-600 text-white flex items-center justify-center ring-4 ring-zinc-100 animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-zinc-200 border border-zinc-300" />
                        )}
                      </div>

                      <span className="truncate">{step.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Generated Source Files */}
            {((files && files.length > 0) || (components && components.length > 0)) && (
              <div className="bg-white rounded-2xl border border-zinc-200 p-3 space-y-2">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-1.5">
                  <span className="text-xs font-bold text-zinc-900">Generated Source Files</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-bold">
                    {(files && files.length > 0 ? files : components).length} files
                  </span>
                </div>

                <div className="space-y-1.5 pt-1 max-h-56 overflow-y-auto pr-0.5">
                  {(files && files.length > 0 ? files : components).map((c, i) => {
                    const ext = c.path?.split('.').pop()?.toUpperCase() || 'FILE';
                    return (
                      <button
                        key={i}
                        onClick={() => onOpenFile && onOpenFile(c.path)}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-zinc-50 text-[11px] font-mono text-zinc-700 hover:bg-indigo-50/80 hover:text-indigo-600 transition-all cursor-pointer group text-left"
                        title={`Open ${c.path} in Code Editor`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Code2 className="w-3.5 h-3.5 text-zinc-400 group-hover:text-indigo-500 shrink-0" />
                          <span className="truncate">{c.path}</span>
                        </div>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-200/60 text-zinc-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 shrink-0 ml-1">
                          {ext}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>


      {/* Integrated Bottom Prompt Bar */}
      <StudioPromptBar
        onSubmit={onSubmitPrompt}
        isGenerating={isGenerating}
        onStop={onStopGeneration}
      />
    </aside>
  );
}
