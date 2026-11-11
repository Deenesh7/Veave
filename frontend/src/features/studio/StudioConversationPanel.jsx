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
  Layers,
  ArrowRight,
  GitBranch,
  User,
  Bot,
  MousePointerClick
} from 'lucide-react';
import { StudioPromptBar } from './StudioPromptBar';
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
  onOpenFile,
  sidePane = 'studio',
  onSidePaneChange,
  selectedElement = null,
  mentionRequest = null,
  onOpenFullEditor
}) {
  const [selectedStyle, setSelectedStyle] = useState('Modern');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'lineage' | 'history'
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
        title="Open panel"
      >
        <Sparkles className="w-4 h-4 text-zinc-600" />
        <PanelRightOpen className="w-3.5 h-3.5 text-zinc-400" />
      </button>
    );
  }

  // Display initial prompt as fallback if no messages loaded yet
  const displayedMessages = conversationMessages && conversationMessages.length > 0
    ? conversationMessages
    : (prompt ? [{ role: 'user', content: prompt, timestamp: new Date() }] : []);

  // Requests stay in Refine and Lineage for 24 hours. After that they leave Lineage and are kept in History.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const timeOf = (value) => { const t = new Date(value).getTime(); return Number.isFinite(t) ? t : null; };
  const isOlderThanDay = (value) => { const t = timeOf(value); return t !== null && Date.now() - t > DAY_MS; };
  const allRequests = (conversationMessages || []).filter((m) => m.role === 'user').slice().reverse();
  const archivedRequests = allRequests.filter((msg) => isOlderThanDay(msg.timestamp));
  const formatHistoryTime = (msg) => {
    const t = timeOf(msg.timestamp);
    if (t === null) return '';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + formatMessageTime(msg.timestamp);
  };
  // Lineage lists only the last 24 hours (plus whichever checkpoint is active, so the current state is always shown).
  const lineageItems = (generationHistory || [])
    .map((gen, idx, all) => ({
      gen,
      isActive: gen.isActive !== undefined ? gen.isActive : (gen.generationId === activeGenerationId || idx === all.length - 1)
    }))
    .filter(({ gen, isActive }) => isActive || !isOlderThanDay(gen.timestamp));
  const hasGenerations = lineageItems.length > 0;
  const canDoUndo = canUndo !== undefined ? canUndo : (generationHistory && generationHistory.length > 1);
  const canDoRedo = !!canRedo;

  return (
    <aside className="w-84 sm:w-96 lg:w-[420px] h-full bg-white border-l border-[#E2E5E8] flex flex-col justify-between shrink-0 select-none relative z-20 shadow-xs">
      {/* Row 1: Studio | Visual Edit, with undo / redo / collapse on the right */}
      <div className="h-11 px-2 border-b border-[#E2E5E8] bg-white flex items-stretch justify-between shrink-0" role="tablist">
        <div className="flex items-stretch gap-1">
          {[
            { id: 'studio', label: 'Studio', icon: Sparkles },
            { id: 'visual', label: 'Visual Edit', icon: MousePointerClick },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sidePane === id}
              onClick={() => onSidePaneChange?.(id)}
              className={`px-3 flex items-center gap-1.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                sidePane === id ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          {canDoUndo && (
            <button
              onClick={() => {
                try {
                  const res = onUndo && onUndo();
                  if (res && typeof res.catch === 'function') res.catch((err) => console.warn('Undo failed:', err));
                } catch (e) { console.warn('Undo failed:', e); }
              }}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="Undo previous change"
              aria-label="Undo"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          {canDoRedo && (
            <button
              onClick={() => {
                try {
                  const res = onRedo && onRedo();
                  if (res && typeof res.catch === 'function') res.catch((err) => console.warn('Redo failed:', err));
                } catch (e) { console.warn('Redo failed:', e); }
              }}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="Redo forward change"
              aria-label="Redo"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Row 2 (Studio only): Refine | Lineage | History */}
      {(
        <div className="grid grid-cols-3 gap-1 border-b border-zinc-200 bg-zinc-50/70 px-2 py-1.5 text-xs shrink-0">
          {[
            { id: 'chat', label: 'Refine', icon: MessageSquare },
            { id: 'lineage', label: 'Lineage', icon: GitBranch, count: lineageItems.length },
            { id: 'history', label: 'History', icon: History },
          ].map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`h-8 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === id ? 'bg-zinc-900 text-white shadow-2xs' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
              {count > 0 && (
                <span className={`text-[10px] px-1.5 rounded-full font-mono ${activeTab === id ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-200 text-zinc-600'}`}>{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Main Tab Content Body */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin`}>
        
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
                <span className="text-[10px] text-zinc-400 block">Last 24 hours · older requests move to History</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                {lineageItems.length} Checkpoints
              </span>
            </div>

            {hasGenerations ? (
              <div className="space-y-2 relative pl-2">
                <div className="absolute left-4 top-3 bottom-3 w-0.5 bg-zinc-200" />

                {lineageItems.map(({ gen, isActive }, idx) => {
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
        {/* TAB 3: HISTORY (requests older than 24 hours) */}
        {/* ==================================================== */}
        {activeTab === 'history' && (
          <div className="space-y-2.5">
            <p className="px-1 text-[11px] text-zinc-500">Requests older than 24 hours are moved here from Lineage.</p>
            {archivedRequests.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                <History className="w-6 h-6 mx-auto mb-2 text-zinc-300" />
                <span>Nothing here yet. A request appears in History 24 hours after you send it.</span>
              </div>
            ) : archivedRequests.map((msg, idx) => (
              <div key={idx} className="p-3 rounded-2xl border border-zinc-200 bg-white">
                <p className="text-xs text-zinc-800 font-medium break-words line-clamp-3">{msg.content}</p>
                <span className="text-[10px] text-zinc-400 font-mono mt-1 block">{formatHistoryTime(msg)}</span>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* Integrated Bottom Prompt Bar */}
      <StudioPromptBar
        onSubmit={onSubmitPrompt}
        isGenerating={isGenerating}
        onStop={onStopGeneration}
        mentionRequest={mentionRequest}
        selectedElement={sidePane === 'visual' ? selectedElement : null}
      />
    </aside>
  );
}
