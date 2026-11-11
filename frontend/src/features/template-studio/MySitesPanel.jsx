import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { PanelHeader, EmptyState, ErrorNote, IconButton, Spinner, ConfirmModal, inputClass, ink, muted, line } from './ui';
import NewSiteModal from './NewSiteModal';

export default function MySitesPanel({ className = '', embedded = false, onSelect }) {
  const { sites, sitesLoaded, sitesError, activeSiteId, selectSite, renameSite, deleteSite, loadSites, sitesCollapsed, setSitesCollapsed } = useTemplateStudioStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);   // { id, name }
  const [removing, setRemoving] = useState(null); // site
  const [deleting, setDeleting] = useState(false);

  const saveName = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (await renameSite(editing.id, name)) setEditing(null);
  };

  // On wide screens the list can fold into a slim rail so the website preview gets the room.
  if (sitesCollapsed && !embedded) {
    return (
      <aside aria-label="My sites" className={`${className} hidden w-12 shrink-0 flex-col items-center gap-3 border-r ${line} bg-[#F7F4EE] py-3 lg:flex`}>
        <IconButton label="Show My Sites" onClick={() => setSitesCollapsed(false)}><ChevronsRight className="h-4 w-4" /></IconButton>
        <IconButton label="Add New Site" onClick={() => { setSitesCollapsed(false); setCreating(true); }}><Plus className="h-4 w-4" /></IconButton>
        <NewSiteModal open={creating} onClose={() => setCreating(false)} />
      </aside>
    );
  }

  return (
    <aside aria-label="My sites" className={`${className} w-full shrink-0 flex-col border-r ${line} bg-[#F7F4EE] lg:w-52`}>
      <PanelHeader title="My Sites" count={sitesLoaded ? sites.length : undefined} action={<IconButton label="Hide My Sites" className={embedded ? 'hidden' : 'hidden lg:block'} onClick={() => setSitesCollapsed(true)}><ChevronsLeft className="h-4 w-4" /></IconButton>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!sitesLoaded ? <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div> : null}
        {sitesError ? <ErrorNote onRetry={loadSites}>{sitesError}</ErrorNote> : null}
        {sitesLoaded && !sitesError && sites.length === 0 ? (
          <EmptyState title="No sites yet">Choose a template to create your first website.</EmptyState>
        ) : null}
        <ul>
          {sites.map((site) => {
            const active = site.id === activeSiteId;
            return (
              <li key={site.id} className={`group relative border-b ${line} ${active ? 'bg-[#EEE9DC]' : 'hover:bg-[#F1EDE3]'}`}>
                {active ? <span className="absolute inset-y-0 left-0 w-0.5 bg-[#5E7B5F]" aria-hidden="true" /> : null}
                {editing?.id === site.id ? (
                  <div className="flex items-center gap-1 p-3">
                    <input autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={80} aria-label="Site name"
                      onKeyDown={(event) => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') setEditing(null); }} className={`${inputClass} py-1`} />
                    <IconButton label="Save name" onClick={saveName}><Check className="h-4 w-4" /></IconButton>
                    <IconButton label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></IconButton>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <button type="button" onClick={() => { selectSite(site.id); if (onSelect) onSelect(site); }} aria-current={active ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left">
                      <span className={`h-10 w-12 shrink-0 overflow-hidden rounded border ${line} bg-[#E9E4D7]`}>
                        {site.thumbnailUrl ? <img src={site.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate font-serif text-sm ${ink}`}>{site.name}</span>
                        <span className={`block truncate text-[11px] ${muted}`}>{site.branchOf ? `Branch of ${site.branchOf.mainName}` : (site.category || 'Website')} · {site.pageCount ?? 0} pages</span>
                      </span>
                    </button>
                    <span className="mr-2 flex shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                      <IconButton label={`Rename ${site.name}`} onClick={() => setEditing({ id: site.id, name: site.name })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                      <IconButton label={`Delete ${site.name}`} onClick={() => setRemoving(site)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className={`border-t ${line} p-3`}>
        <button type="button" onClick={() => setCreating(true)} className={`flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[#B9B2A2] px-3 py-2 text-sm ${ink} transition hover:border-[#5E7B5F] hover:bg-[#EEE9DC]`}>
          <Plus className="h-4 w-4" /> Add New Site
        </button>
      </div>
      <NewSiteModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmModal
        open={Boolean(removing)} danger busy={deleting} title="Delete this site?" confirmLabel="Delete site"
        message={removing ? `"${removing.name}" and all of its pages and revisions will be deleted. This cannot be undone.` : ''}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { setDeleting(true); const ok = await deleteSite(removing.id); setDeleting(false); if (ok) setRemoving(null); }}
      />
    </aside>
  );
}
