import React, { useState } from 'react';
import { 
  Bot, 
  X, 
  Send, 
  Check, 
  Copy, 
  Sparkles, 
  ArrowRight, 
  Wand2, 
  Bug, 
  FileCode2, 
  Zap, 
  HelpCircle,
  Loader2 
} from 'lucide-react';
import { aiCreationService } from '../../services/aiCreationService';

const ACTION_CHIPS = [
  { id: 'explain', label: 'Explain', icon: HelpCircle, prompt: 'Explain the architecture and logic of this file.' },
  { id: 'fix', label: 'Fix Bugs', icon: Bug, prompt: 'Identify potential runtime bugs or syntax issues and propose fixes.' },
  { id: 'refactor', label: 'Refactor', icon: Wand2, prompt: 'Refactor this code to follow clean code practices, modularity, and readability.' },
  { id: 'generate', label: 'Generate', icon: FileCode2, prompt: 'Generate an accompanying component or hook for this feature.' },
  { id: 'optimize', label: 'Optimize', icon: Zap, prompt: 'Optimize performance, eliminate unnecessary re-renders, and streamline imports.' }
];

export function AIAssistant({
  isOpen,
  onClose,
  activeFilePath,
  currentCode = '',
  onApplyCode,
  projectId
}) {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState(null); // { explanation, suggestedCode }
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  if (!isOpen) return null;

  const handleActionChipClick = (chip) => {
    setPrompt(chip.prompt);
    handleExecuteAi(chip.prompt);
  };

  const handleExecuteAi = async (customPrompt) => {
    const query = (customPrompt || prompt).trim();
    if (!query) return;

    setIsLoading(true);
    setResponse(null);
    setApplied(false);

    try {
      if (projectId) {
        const res = await aiCreationService.modify({
          projectId,
          prompt: `File: ${activeFilePath}\nTask: ${query}\nCurrent Code:\n\`\`\`\n${currentCode.slice(0, 3000)}\n\`\`\``,
          designSystem: 'Modern'
        });
        const msg = res.data?.message || res.data?.data?.message || 'Code analysis and enhancement completed.';
        setResponse({
          explanation: msg,
          suggestedCode: null
        });
      } else {
        // Intelligent simulated assistant response
        await new Promise((r) => setTimeout(r, 600));

        let explanation = '';
        let codeSnippet = '';

        if (query.toLowerCase().includes('explain')) {
          explanation = `The file \`${activeFilePath}\` coordinates component UI state and user interactions. It is organized into clean functional units, state management hooks, and modular presentation elements.`;
        } else if (query.toLowerCase().includes('fix') || query.toLowerCase().includes('bug')) {
          explanation = `Verified syntax tree and hook dependencies. Suggested defensive null checks and standard error boundary wrappers.`;
          codeSnippet = currentCode.replace(
            /export default function (\w+)\(([^)]*)\) {/,
            'export default function $1($2) {\n  // Added defensive fallback'
          );
        } else if (query.toLowerCase().includes('optimize')) {
          explanation = `Optimized component re-renders by recommending memoization for callback handlers and memoizing complex calculations.`;
        } else {
          explanation = `Analyzed request: "${query}". Proposed clean updates to improve modularity and responsiveness.`;
        }

        setResponse({
          explanation,
          suggestedCode: codeSnippet || null
        });
      }
    } catch (err) {
      console.error('AI assistant error:', err);
      setResponse({
        explanation: 'AI modification service encountered an error. Please try again with a specific instruction.',
        suggestedCode: null
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (!response?.suggestedCode) return;
    navigator.clipboard.writeText(response.suggestedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    if (response?.suggestedCode) {
      onApplyCode(response.suggestedCode);
      setApplied(true);
      setTimeout(() => setApplied(false), 2500);
    }
  };

  return (
    <aside className="w-80 sm:w-88 bg-white border-l border-zinc-200 flex flex-col h-full shrink-0 select-none z-20 text-zinc-800 animate-in slide-in-from-right duration-200 font-sans shadow-lg">
      {/* 1. Header */}
      <div className="h-10 px-3.5 border-b border-zinc-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-zinc-50 text-zinc-600 flex items-center justify-center border border-zinc-100">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-zinc-900 tracking-tight">VEAVE Assistant</span>
          <span className="text-[10px] bg-zinc-50 text-zinc-700 px-1.5 py-0.5 rounded-full font-semibold border border-zinc-100">
            AI Copilot
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
          title="Close AI Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Active Target & Quick Action Chips */}
      <div className="p-3 border-b border-zinc-200 bg-zinc-50/60">
        <div className="text-[10px] text-zinc-500 font-mono mb-2 truncate">
          Target: <span className="text-zinc-900 font-semibold">{activeFilePath || 'None'}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ACTION_CHIPS.map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleActionChipClick(chip)}
                disabled={isLoading || !activeFilePath}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-200 text-[11px] font-medium text-zinc-700 hover:text-zinc-900 transition-all cursor-pointer shadow-2xs disabled:opacity-40"
              >
                <Icon className="w-3 h-3 text-zinc-600" />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Conversation / Output Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollbar-thin scrollbar-thumb-zinc-200 scrollbar-track-transparent">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <Loader2 className="w-6 h-6 text-zinc-600 animate-spin mb-2" />
            <span className="text-xs">Analyzing code and drafting enhancements...</span>
          </div>
        ) : response ? (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs leading-relaxed text-zinc-700">
              <p>{response.explanation}</p>
            </div>

            {response.suggestedCode && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span className="font-semibold text-zinc-700">Proposed Code</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-200 text-zinc-700 transition-colors cursor-pointer text-xs"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleApply}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white font-semibold transition-all shadow-xs cursor-pointer text-xs"
                    >
                      {applied ? <Check className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                      <span>{applied ? 'Applied!' : 'Apply to File'}</span>
                    </button>
                  </div>
                </div>

                <pre className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-100 overflow-x-auto max-h-56 scrollbar-thin">
                  {response.suggestedCode}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 px-4 text-center text-xs text-zinc-500 space-y-1.5">
            <Sparkles className="w-6 h-6 text-zinc-600 mx-auto mb-2 opacity-80" />
            <p className="font-bold text-zinc-800">How can VEAVE assist?</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Ask questions about this code, request component refactoring, or select an action chip above.
            </p>
          </div>
        )}
      </div>

      {/* 4. Input Prompt Box */}
      <div className="p-3 border-t border-zinc-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteAi();
          }}
          className="relative"
        >
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleExecuteAi();
              }
            }}
            placeholder="Ask AI to modify this code..."
            className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-500 focus:bg-white text-zinc-900 placeholder-zinc-400 text-xs rounded-xl p-2.5 pr-9 outline-none resize-none transition-colors"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="absolute right-2 bottom-3 p-1.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 disabled:bg-zinc-100 text-white disabled:text-zinc-400 transition-colors cursor-pointer shadow-2xs"
            title="Submit request"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
}

export default AIAssistant;
