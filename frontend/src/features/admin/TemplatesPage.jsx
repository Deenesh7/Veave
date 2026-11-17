import React, { useEffect, useRef, useState } from 'react';
import { Copy, Eye, Monitor, Smartphone, Trash2, Upload } from 'lucide-react';
import { adminService, adminError } from '../../services/adminService';
import { toast } from '../../store/toastStore';
import { Async, Badge, Btn, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Page, SearchInput, Select, Skeleton, StatusBadge, Textarea, TableSkeleton, useAsync, useDebounced, dateOnly, fmt } from './ui';

export default function TemplatesPage() {
  const [filters, setFilters] = useState({ q: '', status: '', category: '' });
  const q = useDebounced(filters.q);
  const state = useAsync(() => adminService.templates({ ...filters, q }), [q, filters.status, filters.category]);
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));

  const duplicate = async (template) => {
    setBusy(true);
    try { await adminService.duplicateTemplate(template.id, template.version); toast.success('Template duplicated as a draft.'); state.reload(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await adminService.deleteTemplate(removing.id, removing.id); toast.success('Template deleted.'); setRemoving(null); state.reload(); }
    catch (error) { toast.error(adminError(error)); setRemoving(null); } finally { setBusy(false); }
  };

  return (
    <Page title="Templates" subtitle="Upload and manage the website templates every Veave user can start from. Only published templates appear in Template Studio."
      actions={<Btn variant="primary" onClick={() => setUploading(true)}><Upload className="h-4 w-4" />Upload template</Btn>}>
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-[#E2DCCF] p-3">
          <SearchInput value={filters.q} onChange={(value) => setFilters((f) => ({ ...f, q: value }))} placeholder="Search templates" />
          <Select value={filters.status} onChange={set('status')} className="w-auto" aria-label="Status"><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></Select>
          <Select value={filters.category} onChange={set('category')} className="w-auto" aria-label="Category"><option value="">All categories</option>{(state.data?.categories || []).map((category) => <option key={category}>{category}</option>)}</Select>
        </div>
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
          {({ templates, problems }) => (
            <div className="space-y-3 p-3">
              {problems.length ? <div className="rounded-lg bg-[#FBF1DC] p-3 text-xs text-[#7A5A1E]"><strong>{problems.length} template version{problems.length === 1 ? '' : 's'} failed to load:</strong> {problems.map((problem) => `${problem.id}@${problem.version}`).join(', ')}. They stay hidden from users until fixed.</div> : null}
              {templates.length === 0 ? <EmptyState title="No templates found">Upload a ZIP to add the first one.</EmptyState> : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {templates.map((template) => (
                    <article key={template.id} className="flex flex-col overflow-hidden rounded-xl border border-[#E2DCCF] bg-white">
                      <div className="h-24" style={{ background: `linear-gradient(135deg, ${template.palette?.bg || '#F5F1E8'}, ${template.palette?.surface2 || '#EFEBE1'} 55%, ${template.palette?.brand || '#2F4A35'})` }} />
                      <div className="flex flex-1 flex-col gap-2 p-3">
                        <div className="flex items-start justify-between gap-2"><h3 className="font-serif text-lg leading-tight">{template.name}</h3><StatusBadge status={template.status} /></div>
                        <p className="line-clamp-2 text-xs text-[#5B554A]">{template.description}</p>
                        <div className="flex flex-wrap gap-1"><Badge tone="blue">{template.category}</Badge>{template.featured ? <Badge tone="amber">Featured</Badge> : null}{template.tags.slice(0, 3).map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
                        <p className="text-xs text-[#7A7366]">v{template.version} · {template.versionCount} version{template.versionCount === 1 ? '' : 's'} · {template.pages.length} pages · {fmt(template.usage.websites)} website{template.usage.websites === 1 ? '' : 's'} · updated {dateOnly(template.updatedAt)}</p>
                        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                          <Btn size="sm" variant="primary" onClick={() => setOpenId(template.id)}>Manage</Btn>
                          <Btn size="sm" onClick={() => duplicate(template)} disabled={busy}><Copy className="h-3.5 w-3.5" />Duplicate</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setRemoving(template)} aria-label={`Delete ${template.name}`}><Trash2 className="h-3.5 w-3.5 text-[#A4493A]" /></Btn>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </Async>
      </Card>
      <UploadDialog open={uploading} categories={state.data?.categories || []} onClose={() => setUploading(false)} onDone={(created) => { setUploading(false); state.reload(); setOpenId(created.template.id); }} />
      {openId ? <TemplateDrawer id={openId} onClose={() => { setOpenId(null); state.reload(); }} /> : null}
      <ConfirmDialog open={Boolean(removing)} title="Delete this template?" danger confirmLabel="Delete template" busy={busy} requireText={removing?.id} onClose={() => setRemoving(null)} onConfirm={remove}>
        <p>This permanently removes <strong>{removing?.name}</strong> and all of its versions. A template that any website uses cannot be deleted: archive it instead, and published templates must be unpublished first.</p>
      </ConfirmDialog>
    </Page>
  );
}

function UploadDialog({ open, categories, onClose, onDone, templateId = null, title = 'Upload a template' }) {
  const [form, setForm] = useState({ name: '', description: '', category: '', tags: '', keywords: '' });
  const [zip, setZip] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm({ name: '', description: '', category: '', tags: '', keywords: '' }); setZip(null); setThumb(null); setProgress(null); setError(''); } }, [open]);
  const submit = async () => {
    setError(''); setProgress(0);
    const data = new FormData();
    data.set('file', zip);
    if (thumb && !templateId) data.set('thumbnail', thumb);
    Object.entries(form).forEach(([key, value]) => { if (String(value).trim()) data.set(key, value); });
    try {
      const result = templateId ? await adminService.newVersion(templateId, data, setProgress) : await adminService.uploadTemplate(data, setProgress);
      toast.success(result.warning ? `Uploaded, but: ${result.warning}` : templateId ? 'New version uploaded as a draft.' : 'Template uploaded as a draft.');
      onDone(result);
    } catch (err) { setError(adminError(err, 'The upload failed.')); setProgress(null); }
  };
  const busy = progress !== null;
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} wide
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!zip} onClick={submit}>{busy ? `Uploading ${Math.round((progress || 0) * 100)}%` : 'Upload'}</Btn></>}>
      <div className="space-y-4">
        <Field label="Template ZIP" hint="Must contain template.json and a files/ folder (and the preview image named in template.json). Up to 25 MB; files must be text, SVG is the only image format inside a template."><input type="file" accept=".zip,application/zip" onChange={(event) => setZip(event.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#EFEBE1] file:px-3 file:py-2 file:text-sm file:font-medium" /></Field>
        <p className="rounded-lg bg-[#F5F1E8] px-3 py-2 text-xs text-[#5B554A]">Leave the fields below empty to use what is written in template.json. {templateId ? 'The version in template.json must be higher than the current one.' : 'The template is saved as a draft: it is not visible to users until you publish it.'}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Category"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">From the ZIP</option>{categories.map((category) => <option key={category}>{category}</option>)}</Select></Field>
        </div>
        <Field label="Description"><Textarea rows={2} maxLength={600} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field>
          <Field label="Search keywords" hint="Comma separated; used by search only"><Input value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} /></Field>
        </div>
        {!templateId ? <Field label="Thumbnail (optional)" hint="PNG, JPEG or WebP, up to 2 MB."><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setThumb(event.target.files?.[0] || null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#EFEBE1] file:px-3 file:py-2 file:text-sm file:font-medium" /></Field> : null}
        {busy ? <div className="h-1.5 overflow-hidden rounded bg-[#EFEBE1]"><div className="h-full bg-[#2F4A35] transition-all" style={{ width: `${Math.max(4, (progress || 0) * 100)}%` }} /></div> : null}
        {error ? <p role="alert" className="rounded-lg bg-[#F7E9E5] p-3 text-sm text-[#7A3A2E]">{error}</p> : null}
      </div>
    </Modal>
  );
}

const DRAWER_TABS = ['Details', 'Versions', 'Pages', 'Pictures', 'Usage', 'Preview'];

function TemplateDrawer({ id, onClose }) {
  const state = useAsync(() => adminService.template(id), [id]);
  const [tab, setTab] = useState('Details');
  const [newVersion, setNewVersion] = useState(false);
  return (
    <Modal open onClose={onClose} title={state.data ? state.data.template.name : 'Template'} wide>
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-32" /></div>}>
        {({ template, usage, categories }) => (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1 border-b border-[#E2DCCF]">{DRAWER_TABS.map((name) => <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === name ? 'border-[#2F4A35] font-medium text-[#2F4A35]' : 'border-transparent text-[#7A7366]'}`}>{name}</button>)}</div>
            {tab === 'Details' ? <Details template={template} categories={categories} onSaved={state.reload} /> : null}
            {tab === 'Versions' ? <Versions template={template} onChanged={state.reload} onNew={() => setNewVersion(true)} /> : null}
            {tab === 'Pages' ? <PagesTab template={template} onSaved={state.reload} /> : null}
            {tab === 'Pictures' ? <Pictures template={template} onChanged={state.reload} /> : null}
            {tab === 'Usage' ? <Usage template={template} usage={usage} /> : null}
            {tab === 'Preview' ? <Preview template={template} /> : null}
            <UploadDialog open={newVersion} categories={categories} templateId={id} title="Replace files with a new version" onClose={() => setNewVersion(false)} onDone={() => { setNewVersion(false); state.reload(); setTab('Versions'); }} />
          </div>
        )}
      </Async>
    </Modal>
  );
}

function Details({ template, categories, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm({ name: template.name, description: template.description, category: template.category, tags: template.tags.join(', '), styleTags: template.styleTags.join(', '), keywords: template.keywords.join(', '), featured: template.featured, hidden: template.hidden }); }, [template]);
  if (!form) return null;
  const save = async () => {
    setBusy(true);
    try { await adminService.updateTemplate(template.id, template.version, { ...form }); toast.success('Template saved.'); onSaved(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#7A7366]">Editing version {template.version}. Template id: <code>{template.id}</code></p>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} /></Field><Field label="Category"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
      <Field label="Description"><Textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={600} /></Field>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} /></Field><Field label="Style tags"><Input value={form.styleTags} onChange={(event) => setForm({ ...form, styleTags: event.target.value })} /></Field><Field label="Search keywords"><Input value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} /></Field></div>
      <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} />Featured (shown first)</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.hidden} onChange={(event) => setForm({ ...form, hidden: event.target.checked })} />Hidden from the gallery</label></div>
      <Btn variant="primary" busy={busy} onClick={save}>Save changes</Btn>
    </div>
  );
}

function Versions({ template, onChanged, onNew }) {
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const change = async (version, status) => {
    setBusy(`${version}:${status}`);
    try { await adminService.setTemplateStatus(template.id, version, status); toast.success(status === 'published' ? `Version ${version} is now published.` : `Version ${version} is now ${status}.`); setConfirm(null); onChanged(); }
    catch (error) { toast.error(adminError(error)); setConfirm(null); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><p className="text-sm text-[#5B554A]">New files always become a new version. Websites already created keep the version they started from.</p><Btn onClick={onNew}><Upload className="h-4 w-4" />New version</Btn></div>
      <ul className="divide-y divide-[#EFEBE1] rounded-xl border border-[#E2DCCF] bg-white">
        {template.versions.map((version) => (
          <li key={version.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div><p className="text-sm font-medium">Version {version.version} <StatusBadge status={version.status} /></p><p className="text-xs text-[#7A7366]">{version.fileCount} files · {fmt(version.websites)} website{version.websites === 1 ? '' : 's'} · updated {dateOnly(version.updatedAt)}</p></div>
            <div className="flex flex-wrap gap-1.5">
              {version.status !== 'published' ? <Btn size="sm" variant="primary" busy={busy === `${version.version}:published`} onClick={() => setConfirm({ version: version.version, status: 'published' })}>Publish</Btn> : <Btn size="sm" busy={busy === `${version.version}:draft`} onClick={() => setConfirm({ version: version.version, status: 'draft' })}>Unpublish</Btn>}
              {version.status !== 'archived' ? <Btn size="sm" busy={busy === `${version.version}:archived`} onClick={() => setConfirm({ version: version.version, status: 'archived' })}>Archive</Btn> : <Btn size="sm" busy={busy === `${version.version}:draft`} onClick={() => change(version.version, 'draft')}>Restore</Btn>}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(confirm)} title={confirm?.status === 'published' ? 'Publish this version?' : confirm?.status === 'archived' ? 'Archive this version?' : 'Unpublish this version?'} confirmLabel={confirm?.status === 'published' ? 'Publish' : confirm?.status === 'archived' ? 'Archive' : 'Unpublish'} danger={confirm?.status !== 'published'} busy={Boolean(busy)} onClose={() => setConfirm(null)} onConfirm={() => change(confirm.version, confirm.status)}>
        <p>{confirm?.status === 'published' ? `Version ${confirm?.version} becomes visible to every Veave user in Template Studio.` : `Version ${confirm?.version} disappears from Template Studio. Existing websites keep working.`}</p>
      </ConfirmDialog>
    </div>
  );
}

function PagesTab({ template, onSaved }) {
  const [pages, setPages] = useState(template.pages.map((page) => ({ ...page })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await adminService.updateTemplate(template.id, template.version, { pages }); toast.success('Supported pages saved.'); onSaved(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#5B554A]">The pages this template supports: a route and the source file that renders it.</p>
      <ul className="space-y-2">{pages.map((page, index) => (
        <li key={index} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
          <Input value={page.path} onChange={(event) => setPages((list) => list.map((item, i) => (i === index ? { ...item, path: event.target.value } : item)))} aria-label="Route" />
          <Select value={page.file} onChange={(event) => setPages((list) => list.map((item, i) => (i === index ? { ...item, file: event.target.value } : item)))} aria-label="Source file">{[...new Set([page.file, ...template.filePaths.filter((path) => /\.(jsx?|tsx?)$/.test(path))])].map((path) => <option key={path}>{path}</option>)}</Select>
          <Btn size="sm" variant="ghost" disabled={pages.length <= 1} onClick={() => setPages((list) => list.filter((_, i) => i !== index))} aria-label="Remove page"><Trash2 className="h-3.5 w-3.5" /></Btn>
        </li>))}</ul>
      <div className="flex gap-2"><Btn onClick={() => setPages((list) => [...list, { path: '/new-page', file: template.filePaths.find((path) => /pages\/.+\.jsx$/.test(path)) || template.filePaths[0] }])}>Add page</Btn><Btn variant="primary" busy={busy} onClick={save}>Save pages</Btn></div>
    </div>
  );
}

function GalleryImage({ template, image }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    let gone = false;
    adminService.templateImageBlob(template.id, template.version, image.key).then((blob) => { if (!gone) { url = URL.createObjectURL(blob); setSrc(url); } }).catch(() => {});
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [template.id, template.version, image.key]);
  return src ? <img src={src} alt={image.name || image.kind} className="h-full w-full object-cover" /> : <Skeleton className="h-full w-full" />;
}

function Pictures({ template, onChanged }) {
  const input = useRef(null);
  const [kind, setKind] = useState('thumbnail');
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try { await adminService.addTemplateImage(template.id, template.version, kind, file); toast.success('Picture added.'); onChanged(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const remove = async (key) => { try { await adminService.removeTemplateImage(template.id, template.version, key); onChanged(); } catch (error) { toast.error(adminError(error)); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Picture type"><Select value={kind} onChange={(event) => setKind(event.target.value)} className="w-auto"><option value="thumbnail">Thumbnail (one)</option><option value="preview">Preview image (up to 6)</option></Select></Field>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
        <Btn busy={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" />Choose picture</Btn>
        <p className="text-xs text-[#7A7366]">PNG, JPEG or WebP, up to 2 MB. Checked by content, not file name.</p>
      </div>
      {template.gallery.length ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{template.gallery.map((image) => <li key={image.key} className="overflow-hidden rounded-xl border border-[#E2DCCF] bg-white"><div className="aspect-video bg-[#EFEBE1]"><GalleryImage template={template} image={image} /></div><div className="flex items-center justify-between px-2 py-1.5 text-xs"><Badge tone={image.kind === 'thumbnail' ? 'blue' : 'grey'}>{image.kind}</Badge><button type="button" onClick={() => remove(image.key)} className="text-[#A4493A] hover:underline">Remove</button></div></li>)}</ul> : <EmptyState title="No pictures yet" />}
    </div>
  );
}

function Usage({ template, usage }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">{[['Websites', usage.websites], ['Users', usage.users], ['Last 30 days', usage.last30Days]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#E2DCCF] bg-white p-3"><p className="font-serif text-2xl">{fmt(value)}</p><p className="text-xs text-[#7A7366]">{label}</p></div>)}</div>
      <p className="text-xs text-[#7A7366]">Last used: {usage.lastUsed ? dateOnly(usage.lastUsed) : 'never'}</p>
      <ul className="divide-y divide-[#EFEBE1] rounded-xl border border-[#E2DCCF] bg-white text-sm">{template.versions.map((version) => <li key={version.version} className="flex justify-between px-3 py-2"><span>Version {version.version}</span><span className="text-[#5B554A]">{fmt(version.websites)} website{version.websites === 1 ? '' : 's'}</span></li>)}</ul>
    </div>
  );
}

function Preview({ template }) {
  const [version, setVersion] = useState(template.version);
  const [device, setDevice] = useState('desktop');
  const state = useAsync(() => adminService.templatePreview(template.id, version), [template.id, version]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={version} onChange={(event) => setVersion(event.target.value)} className="w-auto" aria-label="Version">{template.versions.map((item) => <option key={item.version} value={item.version}>Version {item.version} ({item.status})</option>)}</Select>
        <div className="flex rounded-lg border border-[#D9D2C2] bg-white p-0.5"><button type="button" onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${device === 'desktop' ? 'bg-[#2F4A35] text-white' : ''}`}><Monitor className="h-3.5 w-3.5" />Desktop</button><button type="button" onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'} className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ${device === 'mobile' ? 'bg-[#2F4A35] text-white' : ''}`}><Smartphone className="h-3.5 w-3.5" />Mobile</button></div>
      </div>
      <div className="flex justify-center overflow-auto rounded-xl border border-[#E2DCCF] bg-[#EFEBE1] p-3">
        {state.error && !state.data ? <ErrorState message={adminError(state.error, 'The preview could not be built.')} onRetry={state.reload} />
          : !state.data ? <div className="flex h-96 items-center justify-center text-sm text-[#7A7366]"><Eye className="mr-2 h-4 w-4" />Building the preview…</div>
            : <iframe title="Template preview" srcDoc={state.data.html} sandbox="allow-scripts" className="h-[28rem] rounded-lg border border-[#D9D2C2] bg-white transition-all" style={{ width: device === 'mobile' ? 390 : '100%' }} />}
      </div>
    </div>
  );
}
