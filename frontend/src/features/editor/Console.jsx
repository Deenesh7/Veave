import { useEffect, useRef } from 'react';
import { Terminal, Trash2, X, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/helpers';

export function Console() {
  const { showConsole, toggleConsole, consoleOutput, clearConsole } = useEditorStore();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current && showConsole) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [consoleOutput, showConsole]);

  const errorCount = consoleOutput.filter((e) => e.type === 'error').length;

  if (!showConsole) {
    return (
      <div 
        className="h-8 bg-zinc-50 border-t border-zinc-200 px-3 flex items-center gap-2 cursor-pointer hover:bg-zinc-200/80 transition-colors shrink-0"
        onClick={toggleConsole}
      >
        <Terminal className="w-4 h-4 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-400">Console</span>
        {errorCount > 0 && (
          <div className="flex items-center gap-1 ml-2 bg-red-500/10 px-1.5 py-0.5 rounded text-xs text-red-400 font-mono">
            <AlertCircle className="w-3 h-3" />
            {errorCount}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-48 bg-white border-t border-zinc-200 flex flex-col shrink-0">
      <div className="h-8 bg-zinc-50 px-3 flex items-center justify-between border-b border-zinc-200 shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-medium text-zinc-700">Console</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-700" onClick={clearConsole} icon={Trash2} />
          <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-700" onClick={toggleConsole} icon={X} />
        </div>
      </div>
      
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs">
        {consoleOutput.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-400 italic">
            No console output
          </div>
        ) : (
          consoleOutput.map((log, i) => (
            <div key={i} className="flex items-start gap-2 py-1 border-b border-zinc-100/50 last:border-0 hover:bg-zinc-50/30 px-1">
              <span className="text-zinc-400 shrink-0 select-none">
                [{new Date(log.timestamp).toLocaleTimeString()}]
              </span>
              {log.type === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
              {log.type === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
              {log.type === 'info' && <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />}
              <span className={cn(
                'whitespace-pre-wrap break-all',
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warning' ? 'text-amber-400' : 'text-zinc-700'
              )}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
