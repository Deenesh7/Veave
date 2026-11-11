import React from 'react';
import { Plus, Minus, Pencil, ArrowRight, AlertTriangle } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { Modal, Skeleton, ink, muted, line } from './ui';

const STATUS = {
  added: { label: 'Added', tone: 'bg-[#E8F0E8] text-[#33503A]', icon: Plus },
  removed: { label: 'Removed', tone: 'bg-[#F7E9E5] text-[#7A3A2E]', icon: Minus },
  modified: { label: 'Changed', tone: 'bg-[#FBF1DC] text-[#7A5A1E]', icon: Pencil },
  unchanged: { label: 'Same', tone: 'bg-[#EFEBE1] text-[#7A7366]', icon: null }
};
const KIND = { page: 'Page', component: 'Component', data: 'Content data', design: 'Design', asset: 'Picture', config: 'Configuration' };

function Chip({ status }) {
  const { label, tone, icon: Icon } = STATUS[status] || STATUS.unchanged;
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{Icon ? <Icon className="h-2.5 w-2.5" /> : null}{label}</span>;
}

function Section({ title, count, children }) {
  return (
    <section className={`rounded-md border ${line} bg-white`}>
      <h4 className={`flex items-center justify-between border-b ${line} px-3 py-2 text-[11px] font-semibold uppercase tracking-wider ${muted}`}>{title}{count !== undefined ? <span className="font-normal normal-case tracking-normal">{count}</span> : null}</h4>
      <div className="p-3">{children}</div>
    </section>
  );
}

const Delta = ({ added, removed }) => (added || removed ? <span className={`font-mono text-[10px] ${muted}`}><span className="text-[#33503A]">+{added || 0}</span> <span className="text-[#A4493A]">-{removed || 0}</span></span> : null);

/** The comparison of two saved states of the website (or of one page against an earlier revision). It looks at what is stored, not at dates. */
export default function VersionCompare() {
  const state = useTemplateStudioStore((s) => s.compareState);
  const close = useTemplateStudioStore((s) => s.closeCompare);
  const previewVersion = useTemplateStudioStore((s) => s.previewVersion);
  const closeVersions = useTemplateStudioStore((s) => s.closeVersions);
  if (!state) return null;
  const c = state.comparison;

  return (
    <Modal open onClose={close} title={state.mode === 'page' ? 'Changes to this page' : 'Compare versions'} size="xl">
      {state.status === 'loading' ? <div className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : null}
      {state.status === 'error' ? <p role="alert" className="rounded-md border border-[#D9B8B0] bg-[#F7E9E5] p-3 text-sm text-[#7A3A2E]">{state.error}</p> : null}

      {state.status === 'ready' && state.mode === 'page' ? (
        <div className="space-y-3">
          <p className={`text-sm ${ink}`}><span className="font-medium">{c.page.name}</span> now, compared with revision {c.revision.number}{c.revision.instruction ? ` ("${c.revision.instruction.slice(0, 80)}")` : ''}.</p>
          {c.identical ? <p className={`rounded-md border ${line} bg-[#E8F0E8] p-3 text-sm text-[#33503A]`}>The page is exactly as it was in that revision.</p> : (
            <>
              <p className={`text-xs ${muted}`}>Lines changed since that revision: <Delta added={c.linesAdded} removed={c.linesRemoved} /></p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Section title="Headings that are new now" count={c.headingsAdded.length}>{c.headingsAdded.length ? <ul className="space-y-1 text-sm">{c.headingsAdded.map((item) => <li key={item} className="text-[#33503A]">+ {item}</li>)}</ul> : <p className={`text-xs ${muted}`}>None</p>}</Section>
                <Section title="Headings that were there" count={c.headingsRemoved.length}>{c.headingsRemoved.length ? <ul className="space-y-1 text-sm">{c.headingsRemoved.map((item) => <li key={item} className="text-[#A4493A]">- {item}</li>)}</ul> : <p className={`text-xs ${muted}`}>None</p>}</Section>
              </div>
            </>
          )}
        </div>
      ) : null}

      {state.status === 'ready' && state.mode === 'site' ? (
        <div className="space-y-4">
          <div className={`flex flex-wrap items-center gap-2 text-sm ${ink}`}>
            <span className="font-medium">{c.a.label}</span><ArrowRight className={`h-4 w-4 ${muted}`} /><span className="font-medium">{c.b.label}</span>
          </div>
          {c.identical ? <p className="rounded-md border border-[#B8CBB9] bg-[#E8F0E8] p-3 text-sm text-[#33503A]">These are exactly the same website: every file and page matches.</p> : (
            <>
              <ul className="flex flex-wrap gap-2 text-xs" aria-label="Summary">
                {[['pagesAdded', 'pages added'], ['pagesRemoved', 'pages removed'], ['pagesModified', 'pages changed'], ['routeChanges', 'address changes'], ['filesChanged', 'files changed'], ['assetsChanged', 'pictures changed'], ['designChanged', 'design files changed']].filter(([key]) => c.summary[key]).map(([key, label]) => (
                  <li key={key} className={`rounded-full border ${line} bg-white px-2.5 py-1 ${ink}`}><span className="font-semibold">{c.summary[key]}</span> {label}</li>
                ))}
                {c.summary.navigationChanged ? <li className={`rounded-full border ${line} bg-white px-2.5 py-1 ${ink}`}>menu changed</li> : null}
              </ul>

              <Section title="Pages" count={c.pages.filter((page) => page.status !== 'unchanged').length}>
                <ul className="space-y-2">
                  {c.pages.filter((page) => page.status !== 'unchanged').map((page) => (
                    <li key={page.componentPath} className={`rounded border ${line} p-2`}>
                      <div className="flex flex-wrap items-center gap-2"><Chip status={page.status} /><span className={`text-sm font-medium ${ink}`}>{page.name}</span><span className={`font-mono text-[11px] ${muted}`}>{page.routeFrom ? `${page.routeFrom} → ${page.routeTo}` : page.route}</span><Delta added={page.linesAdded} removed={page.linesRemoved} /></div>
                      {page.nameFrom ? <p className={`mt-1 text-[11px] ${muted}`}>Renamed from "{page.nameFrom}"</p> : null}
                      {page.headingsAdded.length || page.headingsRemoved.length ? (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {page.headingsAdded.map((item) => <li key={`a-${item}`} className="text-[#33503A]">+ {item}</li>)}
                          {page.headingsRemoved.map((item) => <li key={`r-${item}`} className="text-[#A4493A]">- {item}</li>)}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                  {c.pages.every((page) => page.status === 'unchanged') ? <li className={`text-xs ${muted}`}>No page changed.</li> : null}
                </ul>
              </Section>

              {c.navigation.changed ? (
                <Section title="Menu">
                  <div className="grid gap-3 sm:grid-cols-2 text-xs">
                    {[['Before', c.navigation.before], ['After', c.navigation.after]].map(([title, items]) => (
                      <div key={title}><p className={`mb-1 font-medium ${muted}`}>{title}</p><ul className="space-y-0.5">{items.map((item) => <li key={`${item.label}-${item.route}`} className={ink}>{item.label} <span className={`font-mono ${muted}`}>{item.route}</span></li>)}</ul></div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {c.design.length ? (
                <Section title="Design" count={c.design.length}>
                  <ul className="space-y-2">
                    {c.design.map((item) => (
                      <li key={item.path}><p className={`font-mono text-xs ${ink}`}>{item.path} <Delta added={item.added} removed={item.removed} /></p>
                        {item.tokens.length ? <ul className="mt-1 space-y-0.5 text-xs">{item.tokens.slice(0, 12).map((token) => <li key={token.key} className={muted}><span className={ink}>{token.key}</span>: {String(token.from ?? '—')} → {String(token.to ?? '—')}</li>)}</ul> : null}</li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {c.assets.length ? (
                <Section title="Pictures" count={c.assets.length}>
                  <ul className="space-y-1 text-xs">{c.assets.map((asset) => <li key={asset.path} className="flex items-center gap-2"><Chip status={asset.status} /><span className={`font-mono ${ink}`}>{asset.path}</span></li>)}</ul>
                </Section>
              ) : null}

              <Section title="Files" count={c.files.length}>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                  {c.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2"><Chip status={file.status} /><span className={`min-w-0 flex-1 truncate font-mono ${ink}`} title={file.path}>{file.path}</span><span className={muted}>{KIND[file.kind]}</span><Delta added={file.linesAdded} removed={file.linesRemoved} /></li>
                  ))}
                </ul>
              </Section>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {[c.a, c.b].filter((side) => side.id !== 'current').map((side) => (
              <button key={side.id} type="button" onClick={() => { previewVersion(side.id, side.label); close(); closeVersions(); }} className={`rounded-md border ${line} bg-white px-3 py-1.5 text-xs hover:bg-[#EFEBE1]`}>Preview {side.label}</button>
            ))}
          </div>
          {c.a.siteId !== c.b.siteId ? <p className={`flex items-center gap-1.5 text-[11px] ${muted}`}><AlertTriangle className="h-3 w-3" />These are two different working copies (a branch and its main). Previews open the copy you are currently editing.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
