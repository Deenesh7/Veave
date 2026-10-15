import { Sparkles } from 'lucide-react';
import { Tooltip } from '../../components/ui/Tooltip';
import { ActionSummary } from './ActionSummary';
import { formatDate } from '../../utils/helpers';
import { cn } from '../../utils/helpers';

export function AgentMessage({ message, isStreaming }) {
  const isUser = message.role === 'user';

  // Function to safely render content with basic markdown (code blocks)
  const renderContent = (content) => {
    if (!content) return null;
    
    // Split by markdown code blocks
    const parts = content.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        // It's a code block
        const codeContent = part.replace(/^```[a-z]*\n?/, '').replace(/```$/, '');
        return (
          <div key={index} className="my-2 bg-white border border-zinc-200 rounded-md p-3 overflow-x-auto">
            <pre className="text-xs font-mono text-zinc-700">
              <code>{codeContent}</code>
            </pre>
          </div>
        );
      }
      
      // Regular text
      return (
        <span key={index} className="whitespace-pre-wrap leading-relaxed">
          {part}
        </span>
      );
    });
  };

  return (
    <div className={cn('flex w-full mb-4', isUser ? 'justify-end' : 'justify-start')}>
      <div 
        className={cn(
          'max-w-[88%] rounded-2xl px-4 py-3 shadow-sm relative group',
          isUser 
            ? 'bg-indigo-600/20 border border-indigo-500/20 text-zinc-900 rounded-tr-sm' 
            : 'bg-zinc-50 border border-zinc-200 text-zinc-700 rounded-tl-sm'
        )}
      >
        {!isUser && (
          <div className="absolute -left-2 -top-2 w-5 h-5 bg-white rounded-full flex items-center justify-center border border-zinc-200">
            <Sparkles className="w-3 h-3 text-indigo-400" />
          </div>
        )}

        <div className="text-sm">
          {renderContent(message.content)}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle rounded-sm" />
          )}
        </div>

        {message.actions && message.actions.length > 0 && (
          <ActionSummary actions={message.actions} />
        )}

        <Tooltip content={formatDate(message.timestamp)} side={isUser ? 'left' : 'right'}>
          <div className="absolute inset-0 opacity-0" />
        </Tooltip>
      </div>
    </div>
  );
}
