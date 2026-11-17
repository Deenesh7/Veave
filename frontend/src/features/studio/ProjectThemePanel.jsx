import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import ThemeEditor, { DEFAULT_THEME, DEFAULT_APPEARANCE, themePayload } from '../template-studio/ThemeEditor';
import { DEFAULT_TYPOGRAPHY, useFontLibrary } from '../template-studio/TypographyEditor';
import { useProjectStore } from '../../store/projectStore';
import { projectService } from '../../services/projectService';
import { toast } from '../../store/toastStore';

const fromSaved = (saved) => ({
  typography: { ...DEFAULT_TYPOGRAPHY, ...(saved?.typography || {}) },
  colors: { ...(saved?.colors || {}) },
  appearance: { ...DEFAULT_APPEARANCE, ...(saved?.appearance || {}) }
});

const messageOf = (error, fallback) => error?.response?.data?.error?.message || error?.message || fallback;

/** Replaces only the given files' content in the open project, so the preview rebuilds with the new theme. */
const patchFiles = (changed, extra = {}) => {
  const { currentProject, setCurrentProject } = useProjectStore.getState();
  if (!currentProject) return;
  const byPath = new Map(changed.map((file) => [file.path, file.content]));
  setCurrentProject({ ...currentProject, ...extra, files: (currentProject.files || []).map((file) => (byPath.has(file.path) ? { ...file, content: byPath.get(file.path) } : file)) });
};

/**
 * Theme changer for the project that is open in the preview. Every change is applied to the open preview straight away (nothing is
 * saved yet); Apply saves it, Cancel puts the saved look back. Only src/index.css and index.html change, never pages or content.
 */
export default function ProjectThemePanel({ projectId, onClose }) {
  const { library, failed: libraryFailed } = useFontLibrary();
  const [theme, setTheme] = useState(() => fromSaved(null));
  const [detail, setDetail] = useState(null);
  const [adjusted, setAdjusted] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const originals = useRef(null);
  const touched = useRef(false);
  const saved = useRef(false);
  const payload = themePayload(theme);

  useEffect(() => {
    const files = useProjectStore.getState().currentProject?.files || [];
    originals.current = files.filter((file) => file.path === 'src/index.css' || file.path === 'index.html').map(({ path, content }) => ({ path, content }));
    let alive = true;
    projectService.getTheme(projectId)
      .then((res) => { if (!alive) return; setDetail({ designTokens: res.data.data.designTokens, usesTokens: res.data.data.usesTokens, typography: null }); setTheme(fromSaved(res.data.data.theme)); })
      .catch((err) => alive && setError(messageOf(err, 'The theme could not be loaded for this project.')));
    // Closing without applying puts the saved look back.
    return () => { alive = false; if (!saved.current && touched.current && originals.current) patchFiles(originals.current); };
  }, [projectId]);

  const change = (next) => { touched.current = true; setTheme(next); };
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (!touched.current) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      projectService.previewTheme(projectId, payload)
        .then((res) => { if (!alive) return; setAdjusted(res.data.data.adjusted || []); patchFiles(res.data.data.files); })
        .catch((err) => alive && setError(messageOf(err, 'The theme could not be previewed.')));
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setBusy(true);
    try {
      const res = await projectService.saveTheme(projectId, payload);
      saved.current = true;
      patchFiles(res.data.data.files, res.data.data.revision != null ? { revision: res.data.data.revision } : {});
      toast.success?.('Theme applied.');
      onClose();
    } catch (err) { setError(messageOf(err, 'The theme could not be saved.')); }
    finally { setBusy(false); }
  };

  return (
    <aside aria-label="Change theme" className="relative z-20 flex h-full w-[340px] shrink-0 flex-col border-l border-[#E2DCCF] bg-[#FBF9F4] shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-[#E2DCCF] px-4 py-2.5">
        <h3 className="font-serif text-base text-[#2B2823]">Change theme</h3>
        <button type="button" onClick={onClose} aria-label="Close theme panel" className="rounded p-1 text-[#7A7366] hover:bg-[#EAE5D9]"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p role="alert" className="m-3 rounded bg-[#F7E9E5] p-2 text-xs text-[#7A3A2E]">{error}</p> : null}
        {detail && !detail.usesTokens ? <p className="m-3 rounded bg-[#FBF1DC] p-2 text-[11px] leading-snug text-[#7A5A1E]">This project does not use the shared colour variables, so palette colours may not change every part of it. Fonts and appearance still apply.</p> : null}
        <ThemeEditor theme={theme} onChange={change} detail={detail} library={library} libraryFailed={libraryFailed} adjusted={adjusted} onReset={() => { change(DEFAULT_THEME()); setAdjusted([]); }} />
      </div>
      <div className="shrink-0 border-t border-[#E2DCCF] bg-[#F7F3EA] p-3">
        <p className="mb-2 text-[11px] leading-snug text-[#7A7366]">Changes show on the preview now. Apply saves them; pages, text and images stay as they are.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-[#E2DCCF] bg-white px-3 py-1.5 text-xs text-[#2B2823] hover:bg-[#EFEBE1]">Cancel</button>
          <button type="button" onClick={apply} disabled={busy || !detail} className="inline-flex items-center gap-1.5 rounded-md bg-[#5E7B5F] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4E694F] disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Apply theme</button>
        </div>
      </div>
    </aside>
  );
}
