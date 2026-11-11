import React, { useEffect, useState } from 'react';
import { X, History } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import PagesPanel from './PagesPanel';
import ContentEditorPanel from './ContentEditorPanel';
import SitePreviewPanel from './SitePreviewPanel';
import VersionHistory from './VersionHistory';
import VersionCompare from './VersionCompare';
import { ink, muted, line } from './ui';

const TABS = [['pages', 'Pages'], ['content', 'Content'], ['preview', 'Preview']];

/** Template workspace inside the app shell: My Sites live in the sidebar's Template Studio view; this page holds Pages | Content | live Preview. */
export default function TemplateStudio() {
  const { init, toast, dismissToast, site, stopPolling } = useTemplateStudioStore();
  const openVersions = useTemplateStudioStore((state) => state.openVersions);
  const [tab, setTab] = useState('preview');

  useEffect(() => {
    if (!useTemplateStudioStore.getState().sitesLoaded) init();
    return () => stopPolling();
  }, [init, stopPolling]);

  const show = (name) => (tab === name ? 'flex' : 'hidden lg:flex');

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${ink}`}>
      <header className={`flex shrink-0 items-center justify-between border-b ${line} px-4 py-2.5`}>
        <div className="flex items-center gap-2">
          <h1 className="truncate font-serif text-lg">{site ? site.name : 'Template Studio'}</h1>
        </div>
        <div className="flex items-center gap-3">
          {site?.branchOf ? <span className={`hidden items-center gap-1 rounded-full border ${line} bg-[#F3EFE5] px-2.5 py-0.5 text-[11px] sm:flex`}>Branch · {site.branchOf.name}</span> : null}
          {site ? <button type="button" onClick={openVersions} className={`inline-flex items-center gap-1.5 rounded-md border ${line} bg-white px-2.5 py-1 text-xs ${ink} transition hover:bg-[#EFEBE1]`}><History className="h-3.5 w-3.5" />Version history</button> : null}
          {!site ? <span className={`hidden shrink-0 text-xs sm:block ${muted}`}>Pick a site from the sidebar</span> : null}
        </div>
      </header>

      <nav aria-label="Panels" className={`flex shrink-0 border-b ${line} lg:hidden`}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`flex-1 py-2 text-xs font-medium ${tab === id ? 'border-b-2 border-[#5E7B5F] text-[#2B2823]' : muted}`}>{label}</button>
        ))}
      </nav>

      <main className="flex min-h-0 flex-1">
        <PagesPanel className={show('pages')} />
        <ContentEditorPanel className={show('content')} />
        <SitePreviewPanel className={show('preview')} />
      </main>

      <VersionHistory />
      <VersionCompare />

      {toast ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
          <div className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg ${toast.type === 'error' ? 'border-[#D9B8B0] bg-[#F7E9E5] text-[#7A3A2E]' : toast.type === 'success' ? 'border-[#B8CBB9] bg-[#E8F0E8] text-[#33503A]' : `${line} bg-[#FBF9F4] ${ink}`}`}>
            <span className="min-w-0 break-words">{toast.message}</span>
            <button type="button" onClick={dismissToast} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
