import React, { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { projectService } from '../../services/projectService';

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon'
};

export const getImageMime = (path = '') => IMAGE_MIME[path.split('.').pop()?.toLowerCase()] || null;

function imageSrc(file) {
  const mime = getImageMime(file?.path);
  if (!mime) return null;
  const content = file?.content;
  if (typeof content !== 'string' || !content) return file?.url || null;
  if (content.startsWith('data:') || /^https?:\/\//.test(content)) return content;
  if (file.encoding === 'base64') return `data:${mime};base64,${content}`;
  if (mime === 'image/svg+xml') return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
  return file?.url || null;
}

// Image bytes are left out of the project list and the editor view, so they are fetched on demand.
const loadedFiles = new Map();

export function ImagePreviewModal({ file, projectId, onClose }) {
  const [loaded, setLoaded] = useState(null);
  const [loading, setLoading] = useState(false);
  const hasBytes = Boolean(file?.content) && !file?.contentOmitted;

  useEffect(() => {
    setLoaded(null);
    if (!file || hasBytes || !projectId) return undefined;
    const key = `${projectId}:${file.path}`;
    if (loadedFiles.has(key)) { setLoaded(loadedFiles.get(key)); return undefined; }
    let cancelled = false;
    setLoading(true);
    projectService.getFiles(projectId)
      .then((res) => {
        const list = res?.data?.data || [];
        const found = list.find((f) => f.path === file.path);
        if (found?.content) loadedFiles.set(key, found);
        if (!cancelled) setLoaded(found || null);
      })
      .catch(() => { if (!cancelled) setLoaded(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, hasBytes, projectId]);

  useEffect(() => {
    if (!file) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  if (!file) return null;
  const src = imageSrc(hasBytes ? file : (loaded || file));
  const name = file.path.split('/').pop();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label={name}>
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-[min(80vw,900px)] h-[75vh] bg-white rounded-2xl shadow-2xl border border-zinc-200 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-zinc-200">
          <span className="text-xs font-semibold text-zinc-700 truncate">{file.path}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 p-4 overflow-auto flex items-center justify-center bg-[repeating-conic-gradient(#f4f4f5_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400 my-10" />
          ) : src ? (
            <img src={src} alt={name} className="max-w-full max-h-full w-auto h-auto object-contain" />
          ) : (
            <p className="text-sm text-zinc-500 py-10 px-6">This image can't be previewed.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImagePreviewModal;
