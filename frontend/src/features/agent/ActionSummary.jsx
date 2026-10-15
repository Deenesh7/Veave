import { useState } from 'react';
import { FilePlus, Pencil, Trash2 } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';

export function ActionSummary({ actions }) {
  const [expanded, setExpanded] = useState(false);
  const { openFile, setActiveFile, setViewMode } = useEditorStore();

  if (!actions || actions.length === 0) return null;

  const displayActions = expanded ? actions : actions.slice(0, 3);
  const hasMore = actions.length > 3;

  const handleActionClick = (action) => {
    if (action.type === 'delete_file') return;
    openFile({ path: action.path });
    setActiveFile(action.path);
    setViewMode('code');
  };

  const getActionIcon = (type) => {
    if (type === 'create_file') return <FilePlus className="w-3.5 h-3.5 text-emerald-400" />;
    if (type === 'modify_file') return <Pencil className="w-3.5 h-3.5 text-amber-400" />;
    if (type === 'delete_file') return <Trash2 className="w-3.5 h-3.5 text-red-400" />;
    return null;
  };

  const getActionColor = (type) => {
    if (type === 'create_file') return 'text-emerald-400';
    if (type === 'modify_file') return 'text-amber-400';
    if (type === 'delete_file') return 'text-red-400';
    return 'text-zinc-400';
  };

  return (
    <div className="mt-3 bg-zinc-50/50 rounded-lg p-2.5 border border-zinc-200/50">
      <div className="text-xs text-zinc-500 font-medium mb-2 uppercase tracking-wide">
        {actions.length} file{actions.length !== 1 ? 's' : ''} changed
      </div>
      <div className="space-y-1">
        {displayActions.map((action, i) => (
          <div
            key={i}
            onClick={() => handleActionClick(action)}
            className="flex items-center gap-2 py-1 px-1.5 text-xs rounded hover:bg-zinc-200/80 cursor-pointer transition-colors group"
          >
            <div className="shrink-0">{getActionIcon(action.type)}</div>
            <div className={`truncate ${getActionColor(action.type)} group-hover:underline`}>
              {action.path}
            </div>
          </div>
        ))}
      </div>
      {hasMore && !expanded && (
        <div
          onClick={() => setExpanded(true)}
          className="text-xs text-indigo-400 cursor-pointer hover:underline mt-2 ml-1.5 font-medium"
        >
          Show {actions.length - 3} more...
        </div>
      )}
    </div>
  );
}
