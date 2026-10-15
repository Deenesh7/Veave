import { useEffect, useRef } from 'react';
import { Sparkles, Trash2, PanelRightClose } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useUIStore } from '../../store/uiStore';
import { Button } from '../../components/ui/Button';
import { AgentMessage } from './AgentMessage';
import { AgentInput } from './AgentInput';
import { AgentProgress, PlanApprovalCard } from './PlanApproval';

export function AgentPanel() {
  const { messages, isGenerating, streamingMessage, clearMessages, pendingApproval, progress } = useAgentStore();
  const { agentPanelOpen, toggleAgentPanel, panelSizes } = useUIStore();
  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, pendingApproval, progress]);

  if (!agentPanelOpen) return null;

  return (
    <div 
      className="bg-white border-l border-zinc-200 flex flex-col h-full shrink-0"
      style={{ width: `${panelSizes.agent * 10}px`, minWidth: '320px', maxWidth: '600px' }} // Approx 400px default
    >
      <div className="h-11 px-3 flex items-center gap-2 border-b border-zinc-200 shrink-0 bg-zinc-50/50">
        <Sparkles className="text-indigo-400 w-4 h-4" />
        <span className="text-sm font-semibold text-zinc-800">Veave AI</span>
        
        <div className="flex-1" />
        
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7 text-zinc-500 hover:text-zinc-700" 
          onClick={clearMessages}
          title="Clear Conversation"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7 text-zinc-500 hover:text-zinc-700" 
          onClick={toggleAgentPanel}
          title="Close Panel"
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {messages.length === 0 && !isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 mt-[-20px]">
            <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6 border border-indigo-500/20">
              <Sparkles className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-base font-semibold text-zinc-800 mb-1">How can I help?</h3>
            <p className="text-xs text-zinc-500 max-w-[240px] mb-6">
              Describe what you want to build or modify, and I'll generate the code for you.
            </p>

            <div className="w-full space-y-2">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider text-left px-1">Suggested Actions</p>
              {[
                { label: 'ðŸŽ¨ Add modern dark theme', prompt: 'Convert the interface to a modern dark theme with sleek zinc colors.' },
                { label: 'ðŸ“± Make fully mobile responsive', prompt: 'Ensure all grids, cards, buttons, and navigation adapt smoothly to mobile screens.' },
                { label: 'âš¡ Add interactive component states', prompt: 'Add realistic interactive states, modal dialogs, and button toggles.' },
                { label: 'ðŸ“Š Add KPI metric cards', prompt: 'Add a row of key metric cards displaying growth badges and revenue charts.' }
              ].map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    const currentProject = useProjectStore.getState().currentProject;
                    if (currentProject?._id) {
                      useAgentStore.getState().sendMessage(currentProject._id, chip.prompt);
                    }
                  }}
                  className="w-full text-left p-2.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-indigo-50/50 hover:border-indigo-200 hover:text-indigo-900 transition-all text-xs font-medium text-zinc-700 shadow-2xs"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, i) => (
              <AgentMessage key={i} message={msg} />
            ))}
            
            <AgentProgress />
            <PlanApprovalCard />

            {isGenerating && streamingMessage && (
              <AgentMessage 
                message={{ role: 'assistant', content: streamingMessage, timestamp: new Date() }} 
                isStreaming 
              />
            )}
          </div>
        )}
      </div>

      <AgentInput />
    </div>
  );
}

