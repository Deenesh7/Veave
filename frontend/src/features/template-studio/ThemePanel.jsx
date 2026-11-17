import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { IconButton, PrimaryButton, GhostButton, Spinner, ink, muted, line } from './ui';
import ThemeEditor, { DEFAULT_THEME, DEFAULT_APPEARANCE, themePayload } from './ThemeEditor';
import { DEFAULT_TYPOGRAPHY, useFontLibrary } from './TypographyEditor';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { templateSiteService } from '../../services/templateSiteService';

const fromSite = (saved) => ({
  typography: { ...DEFAULT_TYPOGRAPHY, ...(saved?.typography || {}) },
  colors: { ...(saved?.colors || {}) },
  appearance: { ...DEFAULT_APPEARANCE, ...(saved?.appearance || {}) }
});

/**
 * Docked over the current preview: every change shows on the site you are looking at straight away (`onCss` receives the theme CSS
 * to inject into the preview). Apply saves it to the site as a new version; Close drops the unsaved changes.
 */
export default function ThemePanel({ onCss, onClose }) {
  const site = useTemplateStudioStore((state) => state.site);
  const applyTheme = useTemplateStudioStore((state) => state.applyTheme);
  const busy = useTemplateStudioStore((state) => state.themeBusy);
  const { library, failed: libraryFailed } = useFontLibrary();
  const [theme, setTheme] = useState(() => fromSite(site?.theme));
  const [adjusted, setAdjusted] = useState([]);
  const [detail, setDetail] = useState(null);
  const touched = useRef(false);
  const payload = themePayload(theme);

  useEffect(() => {
    let alive = true;
    templateSiteService.getTemplate(site.templateId, site.templateVersion).then((res) => alive && setDetail(res.data.template)).catch(() => {});
    return () => { alive = false; };
  }, [site.templateId, site.templateVersion]);

  // Only after the first edit is anything sent to the preview, so opening the panel leaves the site exactly as saved.
  const change = (next) => { touched.current = true; setTheme(next); };
  const themeKey = JSON.stringify(payload);
  useEffect(() => {
    if (!touched.current) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      templateSiteService.templateThemeCss(site.templateId, payload, site.templateVersion)
        .then((res) => { if (!alive) return; onCss(res.data.css || ''); setAdjusted(res.data.adjusted || []); })
        .catch(() => {});
    }, 140);
    return () => { alive = false; clearTimeout(timer); };
  }, [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => { if (await applyTheme(payload)) onClose(true); };

  return (
    <aside aria-label="Change theme" className={`absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-full flex-col border-l ${line} bg-[#FBF9F4] shadow-xl`}>
      <div className={`flex shrink-0 items-center justify-between border-b ${line} px-4 py-2.5`}>
        <h3 className={`font-serif text-base ${ink}`}>Change theme</h3>
        <IconButton label="Close theme panel" onClick={() => onClose(false)}><X className="h-4 w-4" /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThemeEditor theme={theme} onChange={change} detail={detail} library={library} libraryFailed={libraryFailed} adjusted={adjusted} onReset={() => { change(DEFAULT_THEME()); setAdjusted([]); }} />
      </div>
      <div className={`shrink-0 border-t ${line} bg-[#F7F3EA] p-3`}>
        <p className={`mb-2 text-[11px] leading-snug ${muted}`}>Changes show on the preview now. Apply saves them as a version; pages, text and photos stay as they are.</p>
        <div className="flex justify-end gap-2">
          <GhostButton onClick={() => onClose(false)} disabled={busy}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? <Spinner /> : null}Apply theme</PrimaryButton>
        </div>
      </div>
    </aside>
  );
}
