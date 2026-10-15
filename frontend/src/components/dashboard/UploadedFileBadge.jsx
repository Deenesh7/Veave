import React from 'react';
import { FileText, Image as ImageIcon, X, FileCode, Paperclip } from 'lucide-react';

export default function UploadedFileBadge({ file, onRemove }) {
  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = file.isImage || file.type?.startsWith('image/');
  const isCode = file.name?.match(/\.(jsx?|tsx?|json|html|css|py|sql)$/i);

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 shadow-2xs group hover:border-zinc-300 transition-all select-none">
      {isImage && file.dataUrl ? (
        <img
          src={file.dataUrl}
          alt={file.name}
          className="w-5 h-5 rounded object-cover border border-zinc-200 shrink-0"
        />
      ) : isCode ? (
        <FileCode className="w-4 h-4 text-zinc-600 shrink-0" />
      ) : (
        <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
      )}

      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-semibold text-[11px] truncate max-w-[130px]" title={file.name}>
          {file.name}
        </span>
        {file.size > 0 && (
          <span className="text-[10px] font-mono text-zinc-400 shrink-0">
            ({formatSize(file.size)})
          </span>
        )}
      </div>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(file.id || file.name);
          }}
          className="text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/60 p-0.5 rounded-full transition-colors ml-0.5 cursor-pointer"
          title={`Remove ${file.name}`}
          aria-label={`Remove ${file.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
