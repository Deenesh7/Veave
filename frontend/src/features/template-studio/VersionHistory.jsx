import React, { useEffect, useMemo, useState } from 'react';
import { History, Lock, Unlock, Eye, RotateCcw, GitBranch, GitCompare, Trash2, ShieldCheck, Save, ArrowUpRight, Check, FileText, Sparkles, ArrowLeft } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { Modal, ConfirmModal, PrimaryButton, GhostButton, IconButton, Spinner, Skeleton, inputClass, ink, muted, line } from './ui';
import Dropdown from './Dropdown';

const FILTERS = [['all', 'All'], ['website', 'Website versions'], ['page', 'Page revisions'], ['ai', 'AI-generated'], ['manual', 'Manually saved']];
const KIND = {
  create: ['Original template', 'bg-[#E8F0E8] text-[#33503A]'], generate: ['AI generated', 'bg-[#EEE9DC] text-[#2B2823]'], snapshot: ['Automatic snapshot', 'bg-[#EFEBE1] text-[#7A7366]'],
  restore: ['Restored', 'bg-[#FBF1DC] text-[#7A5A1E]'], rollback: ['Automatic rollback', 'bg-[#FBF1DC] text-[#7A5A1E]'], promote: ['Branch promoted', 'bg-[#E8F0E8] text-[#33503A]'],
  manual: ['Saved by you', 'bg-[#E8F0E8] text-[#33503A]'], branch: ['Branch start', 'bg-[#EFEBE1] text-[#7A7366]'], regenerate: ['AI generated', 'bg-[#EEE9DC] text-[#2B2823]'],
  'page-add': ['Page added', 'bg-[#EFEBE1] text-[#7A7366]'], 'replace-image': ['Photo replaced', 'bg-[#EFEBE1] text-[#7A7366]']
};
const when = (value) => { try { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
const kb = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function Badge({ kind }) { const [label, tone] = KIND[kind] || [kind, 'bg-[#EFEBE1] text-[#7A7366]']; return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>; }

function SaveVersionDialog({ open, onClose }) {
  const saveVersion = useTemplateStudioStore((s) => s.saveVersion);
  const busy = useTemplateStudioStore((s) => s.busy.saveVersion);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keep, setKeep] = useState(false);
  useEffect(() => { if (open) { setName(''); setDescription(''); setKeep(false); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Save a version">
      <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); if (name.trim() && await saveVersion({ name: name.trim(), description: description.trim(), protected: keep })) onClose(); }}>
        <p className={`text-sm leading-relaxed ${ink}`}>Saves the whole website exactly as it is now: every page, the menu, the design and the pictures. You can come back to it at any time.</p>
        <div><label htmlFor="v-name" className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Name</label><input id="v-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="e.g. Before the redesign" className={`${inputClass} mt-1`} /></div>
        <div><label htmlFor="v-desc" className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Note <span className="normal-case tracking-normal">(optional)</span></label><textarea id="v-desc" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} rows={3} className={`${inputClass} mt-1 resize-none`} /></div>
        <label className={`flex items-center gap-2 text-sm ${ink}`}><input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} className="accent-[#5E7B5F]" />Protect this version from deletion</label>
        <div className="flex justify-end gap-2"><GhostButton onClick={onClose}>Cancel</GhostButton><PrimaryButton type="submit" disabled={!name.trim() || busy}>{busy ? <Spinner /> : <Save className="h-4 w-4" />}Save version</PrimaryButton></div>
      </form>
    </Modal>
  );
}

function WebsiteDetail({ summary, onClose }) {
  const { site, job, busy, restoreVersion, previewVersion, compareVersions, updateVersion, deleteVersion, verifyVersion, createBranch, versionHistory, selectSite } = useTemplateStudioStore();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [branching, setBranching] = useState(false);
  const running = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.status));
  const working = Boolean(busy[`version:${summary.id}`]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null); setError(null); setChecking(null); setName(summary.name); setBranching(false);
    templateSiteService.getVersion(site.id, summary.id).then((res) => { if (!cancelled) setDetail(res.data.version); }).catch((e) => { if (!cancelled) setError(apiMessage(e, 'The version could not be opened.')); });
    return () => { cancelled = true; };
  }, [site.id, summary.id, summary.name]);

  const others = versionHistory.versions.filter((item) => item.id !== summary.id).map((item) => ({ value: item.id, label: `v${item.number} · ${item.name}`, hint: when(item.createdAt) }));
  const [other, setOther] = useState('');
  const saveName = async () => { if (name.trim() && name.trim() !== summary.name) await updateVersion(summary.id, { name: name.trim() }); };
  const verify = async () => { setChecking('running'); const result = await verifyVersion(summary.id); setChecking(result); };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2"><Badge kind={summary.kind} />{summary.isCurrent ? <span className="rounded bg-[#5E7B5F] px-1.5 py-0.5 text-[10px] font-medium text-white">Current version</span> : null}{summary.protected ? <span className="inline-flex items-center gap-1 text-[11px] text-[#7A5A1E]"><Lock className="h-3 w-3" />Protected</span> : null}</div>
        <input value={name} onChange={(event) => setName(event.target.value)} onBlur={saveName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} maxLength={120} aria-label="Version name" className={`mt-2 w-full border-0 border-b border-transparent bg-transparent px-0 font-serif text-xl ${ink} hover:border-[#D8D2C3] focus:border-[#5E7B5F] focus:outline-none focus:ring-0`} />
        <p className={`mt-1 text-xs ${muted}`}>Version {summary.number} · {when(summary.createdAt)} · {summary.createdBy || 'Veave'}</p>
        {summary.description ? <p className={`mt-2 text-sm leading-relaxed ${ink}`}>{summary.description}</p> : null}
      </div>
      {error ? <p role="alert" className="text-xs text-[#7A3A2E]">{error}</p> : null}
      {!detail && !error ? <Skeleton className="h-24" /> : null}
      {detail ? (
        <>
          <dl className={`grid grid-cols-3 gap-2 rounded-md border ${line} bg-white p-3 text-center text-xs`}>
            <div><dt className={muted}>Pages</dt><dd className={`text-base font-semibold ${ink}`}>{detail.pages.length}</dd></div>
            <div><dt className={muted}>Files</dt><dd className={`text-base font-semibold ${ink}`}>{detail.fileCount}</dd></div>
            <div><dt className={muted}>Size</dt><dd className={`text-base font-semibold ${ink}`}>{kb(detail.bytes)}</dd></div>
          </dl>
          <div>
            <p className={`mb-1 text-[11px] font-medium uppercase tracking-wider ${muted}`}>Pages in this version</p>
            <ul className="flex flex-wrap gap-1.5">{detail.pages.map((page) => <li key={page.pageId} className={`rounded-full border ${line} bg-white px-2.5 py-0.5 text-[11px] ${ink}`}>{page.name} <span className={`font-mono ${muted}`}>{page.route}</span></li>)}</ul>
          </div>
          {detail.assets.length ? <p className={`text-xs ${muted}`}>{detail.assets.length} picture{detail.assets.length === 1 ? '' : 's'} saved with this version, so restoring it shows the right ones.</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <GhostButton onClick={() => { previewVersion(summary.id, summary.name); onClose(); }}><Eye className="h-3.5 w-3.5" />Preview</GhostButton>
        <GhostButton onClick={() => compareVersions({ siteId: site.id, id: summary.id }, { siteId: site.id, id: 'current' })} disabled={summary.isCurrent}><GitCompare className="h-3.5 w-3.5" />Compare with current</GhostButton>
        <PrimaryButton onClick={() => setConfirm('restore')} disabled={summary.isCurrent || running || working}>{working ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Restore</PrimaryButton>
      </div>
      {running ? <p className={`text-[11px] ${muted}`}>A generation is running. Restore is available when it finishes.</p> : null}

      {others.length ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1"><p className={`mb-1 text-[11px] font-medium uppercase tracking-wider ${muted}`}>Compare with another version</p><Dropdown compact label="Compare with" value={other} onChange={setOther} placeholder="Choose a version…" options={others} /></div>
          <GhostButton disabled={!other} onClick={() => compareVersions({ siteId: site.id, id: other }, { siteId: site.id, id: summary.id })}>Compare</GhostButton>
        </div>
      ) : null}

      <div className={`flex flex-wrap items-center gap-2 border-t ${line} pt-3`}>
        {!site.branchOf ? (branching ? (
          <form className="flex w-full items-center gap-2" onSubmit={async (event) => { event.preventDefault(); const made = await createBranch(summary.id, branchName.trim()); if (made) { setBranching(false); setBranchName(''); } }}>
            <input autoFocus value={branchName} onChange={(event) => setBranchName(event.target.value)} maxLength={60} placeholder="Branch name, e.g. Redesign" aria-label="Branch name" className={`${inputClass} !py-1.5`} />
            <PrimaryButton type="submit" className="!px-3 !py-1.5 text-xs" disabled={!branchName.trim() || busy.branch}>{busy.branch ? <Spinner className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}Create</PrimaryButton>
            <GhostButton onClick={() => setBranching(false)} className="!px-3 !py-1.5 text-xs">Cancel</GhostButton>
          </form>
        ) : <GhostButton onClick={() => setBranching(true)}><GitBranch className="h-3.5 w-3.5" />Start a branch from this version</GhostButton>) : null}
        <GhostButton onClick={() => updateVersion(summary.id, { protected: !summary.protected })}>{summary.protected ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}{summary.protected ? 'Remove protection' : 'Protect'}</GhostButton>
        <GhostButton onClick={verify} disabled={checking === 'running'}>{checking === 'running' ? <Spinner className="h-3 w-3" /> : <ShieldCheck className="h-3.5 w-3.5" />}Check integrity</GhostButton>
        <GhostButton onClick={() => setConfirm('delete')} disabled={summary.isCurrent || summary.protected || working} className="!text-[#A4493A]"><Trash2 className="h-3.5 w-3.5" />Delete</GhostButton>
      </div>
      {checking && checking !== 'running' ? (
        <p role="status" className={`rounded-md border p-2 text-xs ${checking.ok ? 'border-[#B8CBB9] bg-[#E8F0E8] text-[#33503A]' : 'border-[#D9B8B0] bg-[#F7E9E5] text-[#7A3A2E]'}`}>
          {checking.ok ? <><Check className="mr-1 inline h-3 w-3" />All {checking.checkedFiles} files are stored and match this version.</> : <>This version has problems: {checking.problems.slice(0, 3).join(' ')}</>}
        </p>
      ) : null}

      <ConfirmModal open={confirm === 'restore'} title={`Restore version ${summary.number}?`} confirmLabel="Restore this version" busy={working}
        message={`Your website goes back to "${summary.name}": its pages, addresses, menu, design and pictures. Nothing is deleted: your current website is saved first, all newer versions stay, and the restore is recorded as a new version.`}
        onClose={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); await restoreVersion(summary.id); }} />
      <ConfirmModal open={confirm === 'delete'} danger title={`Delete version ${summary.number}?`} confirmLabel="Delete permanently" busy={working}
        message={`"${summary.name}" will be deleted permanently and cannot be restored afterwards. Other versions are not affected, and no picture another version uses is removed.`}
        onClose={() => setConfirm(null)} onConfirm={async () => { setConfirm(null); await deleteVersion(summary.id); }} />
    </div>
  );
}

function PageDetail({ entry, onClose }) {
  const { comparePage, restorePageRevision, selectPage, previewRevision, busy, job } = useTemplateStudioStore();
  const [confirm, setConfirm] = useState(false);
  const running = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.status));
  return (
    <div className="space-y-4">
      <div><div className="flex items-center gap-2"><Badge kind={entry.kind} />{entry.current ? <span className="rounded bg-[#5E7B5F] px-1.5 py-0.5 text-[10px] font-medium text-white">Current revision</span> : null}</div>
        <h3 className={`mt-2 font-serif text-xl ${ink}`}>{entry.pageName} · revision {entry.number}</h3>
        <p className={`mt-1 text-xs ${muted}`}>{entry.route} · {when(entry.createdAt)}</p>
        {entry.description ? <p className={`mt-2 text-sm leading-relaxed ${ink}`}>{entry.description}</p> : null}</div>
      <p className={`text-xs leading-relaxed ${muted}`}>A page revision belongs to this page alone. Restoring it changes only this page; every other page, the menu and your pictures stay as they are.</p>
      <div className="flex flex-wrap gap-2">
        <GhostButton onClick={() => { selectPage(entry.pageId); onClose(); previewRevision(entry.number); }} disabled={entry.current}><Eye className="h-3.5 w-3.5" />View</GhostButton>
        <GhostButton onClick={() => comparePage(entry.pageId, entry.number)} disabled={entry.current}><GitCompare className="h-3.5 w-3.5" />Changes</GhostButton>
        <GhostButton onClick={() => { selectPage(entry.pageId); onClose(); }}><ArrowUpRight className="h-3.5 w-3.5" />Open this page</GhostButton>
        <PrimaryButton onClick={() => setConfirm(true)} disabled={entry.current || running || busy.restore}>{busy.restore ? <Spinner /> : <RotateCcw className="h-4 w-4" />}Restore this revision</PrimaryButton>
      </div>
      <ConfirmModal open={confirm} title="Restore this revision?" confirmLabel="Restore" message={`The ${entry.pageName} page goes back to revision ${entry.number}. It is saved as a new revision, so nothing is lost.`} onClose={() => setConfirm(false)} onConfirm={async () => { setConfirm(false); await restorePageRevision(entry.pageId, entry.number); }} />
    </div>
  );
}

function BranchPanel() {
  const { site, branches, busy, selectSite, compareVersions, promoteBranch, closeVersions } = useTemplateStudioStore();
  const [promoting, setPromoting] = useState(null);
  if (site.branchOf) {
    return (
      <div className="rounded-md border border-[#CFC8B6] bg-[#F3EFE5] p-3">
        <p className={`flex items-center gap-1.5 text-sm font-medium ${ink}`}><GitBranch className="h-4 w-4 text-[#5E7B5F]" />Branch "{site.branchOf.name}"</p>
        <p className={`mt-0.5 text-xs ${muted}`}>Started from {site.branchOf.mainName}, version {site.branchOf.versionNumber}. Editing it never changes the main website.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <GhostButton className="!px-2.5 !py-1 text-xs" onClick={() => compareVersions({ siteId: site.branchOf.siteId, id: 'current' }, { siteId: site.id, id: 'current' })}><GitCompare className="h-3 w-3" />Compare with main</GhostButton>
          <PrimaryButton className="!px-2.5 !py-1 text-xs" onClick={() => setPromoting(site.id)} disabled={busy.promote}>{busy.promote ? <Spinner className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}Promote to main</PrimaryButton>
          <GhostButton className="!px-2.5 !py-1 text-xs" onClick={() => { closeVersions(); selectSite(site.branchOf.siteId); }}><ArrowLeft className="h-3 w-3" />Open main</GhostButton>
        </div>
        <ConfirmModal open={Boolean(promoting)} title="Promote this branch to main?" confirmLabel="Promote" message={`The main website becomes a copy of this branch as it is now. It is saved as a new version of ${site.branchOf.mainName}; main's earlier versions, and a safety copy of main as it is today, are kept.`} onClose={() => setPromoting(null)} onConfirm={async () => { setPromoting(null); const mainId = await promoteBranch(site.id); if (mainId) { closeVersions(); selectSite(mainId); } }} />
      </div>
    );
  }
  if (!branches.length) return null;
  return (
    <div>
      <p className={`mb-1.5 text-[11px] font-medium uppercase tracking-wider ${muted}`}>Branches</p>
      <ul className="space-y-1.5">
        {branches.map((branch) => (
          <li key={branch.id} className={`flex items-center gap-2 rounded-md border ${line} bg-white px-2.5 py-1.5`}>
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#5E7B5F]" />
            <span className="min-w-0 flex-1"><span className={`block truncate text-xs font-medium ${ink}`}>{branch.branchName}</span><span className={`block text-[10px] ${muted}`}>from v{branch.fromVersion}{branch.promotedAt ? ' · promoted' : ''}</span></span>
            <IconButton label="Compare with main" onClick={() => compareVersions({ siteId: site.id, id: 'current' }, { siteId: branch.id, id: 'current' })}><GitCompare className="h-3.5 w-3.5" /></IconButton>
            <GhostButton className="!px-2 !py-1 text-xs" onClick={() => { useTemplateStudioStore.getState().closeVersions(); selectSite(branch.id); }}>Open</GhostButton>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The version history of the open website: every saved website version and page revision, to look at, compare, restore, branch and protect. */
export default function VersionHistory() {
  const { versionsOpen, closeVersions, versionHistory, loadVersionHistory, site, compareState } = useTemplateStudioStore();
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const { entries, loading, loaded, error, filter, dirty } = versionHistory;

  useEffect(() => { if (versionsOpen) setSelectedId(null); }, [versionsOpen, site?.id]);
  const selected = useMemo(() => entries.find((entry) => entry.id === selectedId) || null, [entries, selectedId]);
  useEffect(() => { if (versionsOpen && !selectedId && entries.length) setSelectedId(entries.find((entry) => entry.type === 'website' && entry.isCurrent)?.id || entries[0].id); }, [versionsOpen, entries, selectedId]);
  if (!versionsOpen || !site) return null;

  return (
    <>
      <Modal open onClose={compareState ? () => {} : closeVersions} title={`Version history · ${site.name}`} size="xl">
        <div className="space-y-3">
          {dirty ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#E7D6A9] bg-[#FBF1DC] px-3 py-2 text-xs text-[#7A5A1E]">
              <span>The website has changes that are not saved as a version yet. Page changes are always kept as page revisions; save a version to be able to come back to the whole website as it is now.</span>
              <GhostButton className="!px-2.5 !py-1 text-xs" onClick={() => setSaving(true)}><Save className="h-3 w-3" />Save a version</GhostButton>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Filter" className="flex flex-wrap gap-1.5">
              {FILTERS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => loadVersionHistory(id)} className={`rounded-full border px-3 py-1 text-xs transition ${filter === id ? 'border-[#5E7B5F] bg-[#E8F0E8] text-[#33503A]' : `${line} bg-white ${muted} hover:text-[#2B2823]`}`}>{label}</button>)}
            </div>
            <PrimaryButton className="!px-3 !py-1.5 text-xs" onClick={() => setSaving(true)}><Save className="h-3.5 w-3.5" />Save current version</PrimaryButton>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 space-y-3">
              <BranchPanel />
              <div className={`max-h-[52vh] overflow-y-auto rounded-md border ${line} bg-white`}>
                {loading && !loaded ? <div className="space-y-2 p-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : null}
                {error ? <p role="alert" className="p-3 text-xs text-[#7A3A2E]">{error}</p> : null}
                {loaded && !entries.length ? <p className={`p-6 text-center text-sm ${muted}`}>Nothing here yet. Saved versions and page revisions appear in this list.</p> : null}
                <ul>
                  {entries.map((entry) => (
                    <li key={`${entry.type}:${entry.id}`}>
                      <button type="button" onClick={() => setSelectedId(entry.id)} aria-current={selectedId === entry.id ? 'true' : undefined} className={`flex w-full gap-3 border-b ${line} px-3 py-2.5 text-left transition ${selectedId === entry.id ? 'bg-[#EEE9DC]' : 'hover:bg-[#F5F1E8]'}`}>
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${entry.type === 'website' ? 'bg-[#E8F0E8] text-[#33503A]' : 'bg-[#EFEBE1] text-[#7A7366]'}`}>{entry.type === 'website' ? <History className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5"><span className={`truncate text-sm font-medium ${ink}`}>{entry.type === 'website' ? `v${entry.number} · ${entry.name}` : entry.name}</span>{entry.isCurrent || entry.current ? <span className="rounded bg-[#5E7B5F] px-1.5 py-0.5 text-[9px] font-medium text-white">Current</span> : null}{entry.protected ? <Lock className="h-3 w-3 text-[#7A5A1E]" aria-label="Protected" /> : null}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5"><Badge kind={entry.kind} />{entry.origin === 'ai' ? <Sparkles className="h-3 w-3 text-[#5E7B5F]" aria-label="AI generated" /> : null}<span className={`text-[11px] ${muted}`}>{when(entry.at)}</span></span>
                          {entry.description ? <span className={`mt-0.5 line-clamp-2 block text-[11px] leading-snug ${muted}`}>{entry.description}</span> : null}
                          <span className={`mt-0.5 block text-[10px] ${muted}`}>{entry.type === 'website' ? `${entry.pageCount} pages${entry.affectedPages ? ` · ${entry.affectedPages} affected` : ''} · ${entry.createdBy || 'Veave'}` : `${entry.route}`}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className={`min-w-0 rounded-md border ${line} bg-[#FBF9F4] p-4`}>
              {!selected ? <p className={`text-sm ${muted}`}>Choose a version on the left to open it.</p> : selected.type === 'website' ? <WebsiteDetail key={selected.id} summary={selected} onClose={closeVersions} /> : <PageDetail entry={selected} onClose={closeVersions} />}
            </div>
          </div>
        </div>
      </Modal>
      <SaveVersionDialog open={saving} onClose={() => setSaving(false)} />
    </>
  );
}
