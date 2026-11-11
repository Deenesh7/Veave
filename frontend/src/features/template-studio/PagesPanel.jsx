import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, ArrowUp, ArrowDown, GripVertical, ChevronsLeft, ChevronsRight, RotateCcw } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import WebsiteGeneration, { GenerationBadge, stateOfPage } from './WebsiteGeneration';
import { PanelHeader, EmptyState, IconButton, Spinner, ConfirmModal, GhostButton, PrimaryButton, inputClass, ink, muted, line } from './ui';

export default function PagesPanel({ className = '' }) {
  const retryPage = useTemplateStudioStore((state) => state.retryPage);
  const { site, pages, activePageId, siteLoading, selectPage, addPage, renamePage, deletePage, reorderPages, busy, job } = useTemplateStudioStore();
  const collapsed = useTemplateStudioStore((state) => state.pagesCollapsed);
  const setCollapsed = useTemplateStudioStore((state) => state.setPagesCollapsed);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);   // { id, name, route, isHome }
  const [removing, setRemoving] = useState(null); // page
  const [deleting, setDeleting] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const running = job && !['completed', 'failed', 'cancelled'].includes(job.status);
  const lockedPage = (page) => running && (!job.pageId || job.pageId === page.id);

  const submitAdd = async (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    if (await addPage({ name: draft.name.trim(), description: draft.description.trim() })) { setDraft({ name: '', description: '' }); setAdding(false); }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    const original = pages.find((page) => page.id === editing.id);
    const route = !editing.isHome && editing.route !== original.route ? editing.route.trim() : undefined;
    if (await renamePage(editing.id, { name: editing.name.trim(), route })) setEditing(null);
  };

  const move = (index, delta) => {
    const ids = pages.map((page) => page.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderPages(ids);
  };

  const drop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = pages.map((page) => page.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null); setOverId(null);
    reorderPages(ids);
  };

  return (
    <>
    {collapsed ? (
      <aside aria-label="Pages (collapsed)" className="hidden w-12 shrink-0 flex-col items-center gap-3 border-r border-[#E2DCCF] bg-[#FBF9F4] py-3 lg:flex">
        <IconButton label="Show Pages" onClick={() => setCollapsed(false)}><ChevronsRight className="h-4 w-4" /></IconButton>
      </aside>
    ) : null}
    <section aria-label="Pages" className={`${className} ${collapsed ? 'lg:!hidden' : ''} w-full shrink-0 flex-col border-r ${line} bg-[#FBF9F4] lg:w-64`}>
      <PanelHeader title="Pages" count={site ? pages.length : undefined} action={<div className="flex items-center">{site ? <IconButton label="Add a page" onClick={() => setAdding((value) => !value)}><Plus className="h-4 w-4" /></IconButton> : null}<IconButton label="Hide Pages" className="hidden lg:block" onClick={() => setCollapsed(true)}><ChevronsLeft className="h-4 w-4" /></IconButton></div>} />
      <WebsiteGeneration />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {adding ? (
          <form onSubmit={submitAdd} className={`space-y-2 border-b ${line} bg-[#F3EFE5] p-3`}>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={60} required aria-label="Page name" placeholder="Page name, e.g. Journal" className={inputClass} />
            <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={300} aria-label="Short description" placeholder="Short description (optional)" className={inputClass} />
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
              <PrimaryButton type="submit" className="!px-3 !py-1.5 text-xs" disabled={!draft.name.trim() || busy.addPage}>{busy.addPage ? <Spinner className="h-3 w-3" /> : null}Add page</PrimaryButton>
            </div>
          </form>
        ) : null}
        {siteLoading ? <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div> : null}
        {!site && !siteLoading ? <EmptyState title="No site selected">Pick a site on the left to see its pages.</EmptyState> : null}
        <ul>
          {pages.map((page, index) => {
            const active = page.id === activePageId;
            const locked = lockedPage(page);
            return (
              <li key={page.id} draggable={!editing && !locked} onDragStart={(event) => { setDragId(page.id); event.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(event) => { if (dragId) { event.preventDefault(); setOverId(page.id); } }} onDragLeave={() => setOverId((value) => (value === page.id ? null : value))}
                onDrop={(event) => { event.preventDefault(); drop(page.id); }} onDragEnd={() => { setDragId(null); setOverId(null); }}
                className={`group relative border-b ${line} ${active ? 'bg-[#EEE9DC]' : 'hover:bg-[#F5F1E8]'} ${dragId === page.id ? 'opacity-40' : ''} ${overId === page.id && dragId !== page.id ? 'border-t-2 border-t-[#5E7B5F]' : ''}`}>
                {active ? <span className="absolute inset-y-0 left-0 w-0.5 bg-[#5E7B5F]" aria-hidden="true" /> : null}
                {editing?.id === page.id ? (
                  <div className="space-y-2 p-3">
                    <input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={60} aria-label="Page name" className={inputClass}
                      onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(); if (event.key === 'Escape') setEditing(null); }} />
                    {editing.isHome ? <p className={`text-[11px] ${muted}`}>The home page keeps the “/” address.</p> : (
                      <input value={editing.route} onChange={(event) => setEditing({ ...editing, route: event.target.value })} aria-label="Page address" placeholder="/address" className={`${inputClass} font-mono text-xs`}
                        onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(); if (event.key === 'Escape') setEditing(null); }} />
                    )}
                    <div className="flex justify-end gap-1">
                      <IconButton label="Save page" onClick={saveEdit}><Check className="h-4 w-4" /></IconButton>
                      <IconButton label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></IconButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start">
                    <span className={`mt-4 ml-1 hidden cursor-grab lg:block ${muted} opacity-0 group-hover:opacity-100`} aria-hidden="true"><GripVertical className="h-3.5 w-3.5" /></span>
                    <button type="button" onClick={() => selectPage(page.id)} aria-current={active ? 'page' : undefined} className="min-w-0 flex-1 px-3 py-3 text-left">
                      <span className="flex items-center gap-2">
                        <span className={`truncate font-serif text-sm ${ink}`}>{page.name}</span>
                      </span>
                      <span className="mt-1 block"><GenerationBadge page={page} /></span>
                      {page.description ? <span className={`mt-0.5 line-clamp-2 text-[11px] leading-snug ${muted}`}>{page.description}</span> : null}
                      <span className={`mt-1 block font-mono text-[10px] ${muted}`}>{page.route}</span>
                    </button>
                    {['failed', 'needs-review'].includes(stateOfPage(page)) ? (
                      <button type="button" disabled={running || busy[`retry:${page.id}`]} onClick={() => retryPage(page.id)} title={page.generation?.error || 'Write this page again'}
                        className="mr-1 mt-3 inline-flex shrink-0 items-center gap-1 rounded border border-[#CFC8B6] bg-white px-1.5 py-0.5 text-[10px] font-medium hover:bg-[#EFEBE1] disabled:opacity-50">
                        {busy[`retry:${page.id}`] ? <Spinner className="h-2.5 w-2.5" /> : <RotateCcw className="h-2.5 w-2.5" />}Retry
                      </button>
                    ) : null}
                    <span className="flex shrink-0 flex-col opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                      <span className="flex">
                        <IconButton label={`Rename ${page.name}`} disabled={locked} onClick={() => setEditing({ id: page.id, name: page.name, route: page.route, isHome: page.route === '/' })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                        {page.route !== '/' && pages.length > 1 ? <IconButton label={`Delete ${page.name}`} disabled={locked} onClick={() => setRemoving(page)}><Trash2 className="h-3.5 w-3.5" /></IconButton> : null}
                      </span>
                      <span className="flex">
                        <IconButton label={`Move ${page.name} up`} disabled={index === 0 || running} onClick={() => move(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
                        <IconButton label={`Move ${page.name} down`} disabled={index === pages.length - 1 || running} onClick={() => move(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
                      </span>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <ConfirmModal
        open={Boolean(removing)} danger busy={deleting} title="Delete this page?" confirmLabel="Delete page"
        message={removing ? `“${removing.name}” (${removing.route}) will be removed from the site, together with its navigation links. Links elsewhere that pointed to it will go to the home page.` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { setDeleting(true); const ok = await deletePage(removing.id); setDeleting(false); if (ok) setRemoving(null); }}
      />
    </section>
    </>
  );
}
