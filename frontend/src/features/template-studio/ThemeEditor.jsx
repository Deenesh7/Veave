import React, { useState } from 'react';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import TypographyEditor, { DEFAULT_TYPOGRAPHY, isDefaultTypography } from './TypographyEditor';
import { GhostButton, ink, muted, line } from './ui';

export const DEFAULT_APPEARANCE = { buttonStyle: 'default', radius: 'default', sectionSpacing: 'default', containerWidth: 'default' };
export const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary', hint: 'Buttons, links' }, { key: 'secondary', label: 'Secondary', hint: 'Alternate bands, footer' }, { key: 'accent', label: 'Accent', hint: 'Focus, selection' },
  { key: 'background', label: 'Background', hint: 'Page' }, { key: 'surface', label: 'Surface', hint: 'Cards' }, { key: 'text', label: 'Text', hint: 'Primary text' },
  { key: 'textSecondary', label: 'Text 2', hint: 'Secondary text' }, { key: 'border', label: 'Border', hint: 'Lines, dividers' }
];

/** The theme as the API takes it: only what differs from the template's own values. */
export const themePayload = ({ typography, colors, appearance }) => {
  const out = {};
  if (!isDefaultTypography(typography)) out.typography = typography;
  if (colors && Object.keys(colors).length) out.colors = colors;
  const chosen = Object.fromEntries(Object.entries(appearance || {}).filter(([, value]) => value && value !== 'default'));
  if (Object.keys(chosen).length) out.appearance = chosen;
  return Object.keys(out).length ? out : null;
};

export function Section({ title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`min-w-0 border-b ${line}`}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left font-serif text-sm ${ink} transition-colors hover:bg-[#F3EFE5]`}>
        <span className="flex items-center gap-2">{title}{badge ? <span className="rounded bg-[#E8F0E8] px-1.5 py-0.5 font-sans text-[10px] text-[#33503A]">{badge}</span> : null}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="min-w-0 px-4 pb-4">{children}</div> : null}
    </section>
  );
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div>
      <p className={`mb-1 text-[11px] ${muted}`}>{label}</p>
      <div className="flex gap-1" role="group" aria-label={label}>
        {options.map(([id, text]) => (
          <button key={id} type="button" onClick={() => onChange(id)} aria-pressed={value === id}
            className={`flex-1 rounded border px-1.5 py-1 text-[11px] transition ${value === id ? 'border-[#5E7B5F] bg-[#E8F0E8] text-[#33503A]' : `${line} bg-white ${ink} hover:border-[#B9B2A2]`}`}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function ColorsEditor({ colors, defaults, palettes, onChange, adjusted }) {
  const valueOf = (key) => colors[key] || defaults?.[key] || '#000000';
  const set = (key, value) => {
    const next = { ...colors, [key]: value.toUpperCase() };
    if (defaults && next[key] === defaults[key]) delete next[key];
    onChange(next);
  };
  const activePalette = palettes.find((palette) => COLOR_FIELDS.every(({ key }) => palette.colors[key] === valueOf(key)))?.id;
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className={`mb-1 text-[11px] ${muted}`}>Palettes</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Palettes">
          {palettes.map((palette) => (
            <button key={palette.id} type="button" onClick={() => onChange({ ...palette.colors })} aria-pressed={activePalette === palette.id} title={palette.name}
              className={`relative flex min-w-0 flex-col items-start justify-between gap-2 rounded-md border p-2 text-left transition-colors ${activePalette === palette.id ? 'border-[#5E7B5F] bg-[#E8F0E8] ring-1 ring-[#5E7B5F]' : `${line} bg-white hover:border-[#B9B2A2] hover:bg-[#FBF9F4]`}`}>
              <span className="flex items-center">{['background', 'primary', 'secondary', 'accent', 'text'].map((key, index) => <span key={key} className={`h-5 w-5 shrink-0 rounded-full border-2 border-white shadow-[0_0_0_1px_#D8D2C3] ${index ? '-ml-1.5' : ''}`} style={{ background: palette.colors[key] }} />)}</span>
              <span className={`text-[11px] font-medium leading-tight ${ink}`}>{palette.name}</span>
              {activePalette === palette.id ? <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#5E7B5F] text-white"><Check className="h-2.5 w-2.5" aria-label="Selected" /></span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {COLOR_FIELDS.map(({ key, label, hint }) => (
          <label key={key} className="grid min-w-0 grid-cols-[36px_68px_minmax(0,1fr)] items-center gap-2" title={hint}>
            <input type="color" aria-label={`${label} colour`} value={valueOf(key)} onChange={(event) => set(key, event.target.value)} className="h-8 w-9 cursor-pointer rounded border border-[#D8D2C3] bg-white p-0.5" />
            <span className={`whitespace-nowrap text-xs ${ink}`}>{label}</span>
            <input aria-label={`${label} hex`} value={valueOf(key).toUpperCase()} maxLength={7} onChange={(event) => { const v = event.target.value; if (/^#[0-9a-f]{6}$/i.test(v)) set(key, v); }} className="h-8 w-full min-w-0 rounded border border-[#E2DCCF] bg-white px-2 font-mono text-[11px]" />
          </label>
        ))}
      </div>
      {adjusted?.length ? <p className="rounded bg-[#FBF1DC] p-2 text-[11px] leading-snug text-[#7A5A1E]">The {adjusted.join(' and ')} colour was adjusted so the text stays readable on this background.</p> : null}
    </div>
  );
}

/** The right-hand workspace: Typography, Colors and Appearance as collapsible sections. */
export default function ThemeEditor({ theme, onChange, detail, library, libraryFailed, adjusted, onReset, before = null, children = null }) {
  const { typography, colors, appearance } = theme;
  const customised = themePayload(theme);
  const tokens = detail?.designTokens?.colors;
  const defaults = tokens ? { primary: tokens.brand, secondary: tokens.surface2, accent: tokens.accent || tokens.brand, background: tokens.bg, surface: tokens.surface, text: tokens.fg, textSecondary: tokens.muted, border: tokens.line } : null;
  const set = (patch) => onChange({ ...theme, ...patch });
  const setAppearance = (patch) => set({ appearance: { ...appearance, ...patch } });
  return (
    <div className="min-w-0">
      <div className={`sticky top-0 z-10 hidden h-12 items-center justify-between gap-3 border-b ${line} bg-[#FBF9F4] px-4 md:flex`}>
        <h3 className={`font-serif text-base ${ink}`}>Theme</h3>
        <GhostButton className="shrink-0 !px-2.5 !py-1.5" onClick={onReset} disabled={!customised}><RotateCcw className="h-3 w-3" />Reset theme</GhostButton>
      </div>
      <div className={`flex items-center justify-end border-b ${line} px-4 py-2 md:hidden`}>
        <GhostButton className="!px-2.5 !py-1.5" onClick={onReset} disabled={!customised}><RotateCcw className="h-3 w-3" />Reset theme</GhostButton>
      </div>
      {before}
      <Section title="Theme palette" badge={Object.keys(colors).length ? 'Customised' : null} defaultOpen>
        {library && defaults ? <ColorsEditor colors={colors} defaults={defaults} palettes={library.palettes} onChange={(next) => set({ colors: next })} adjusted={adjusted} /> : <p className={`text-xs ${muted}`}>Loading the template colours…</p>}
        {Object.keys(colors).length ? <GhostButton className="mt-2 !px-2 !py-1" onClick={() => set({ colors: {} })}><RotateCcw className="h-3 w-3" />Reset palette</GhostButton> : null}
      </Section>
      <Section title="Typography" badge={isDefaultTypography(typography) ? null : 'Customised'}>
        <TypographyEditor value={typography} onChange={(next) => set({ typography: next })} template={detail?.typography} library={library} failed={libraryFailed} bare />
      </Section>
      <Section title="Appearance" badge={Object.values(appearance).some((value) => value !== 'default') ? 'Customised' : null}>
        <div className="space-y-3">
          <Segmented label="Button style" value={appearance.buttonStyle} onChange={(buttonStyle) => setAppearance({ buttonStyle })} options={[['default', 'Template'], ['pill', 'Pill'], ['rounded', 'Rounded'], ['square', 'Square']]} />
          <Segmented label="Border radius" value={appearance.radius} onChange={(radius) => setAppearance({ radius })} options={[['default', 'Template'], ['none', 'None'], ['small', 'S'], ['medium', 'M'], ['large', 'L']]} />
          <Segmented label="Section spacing" value={appearance.sectionSpacing} onChange={(sectionSpacing) => setAppearance({ sectionSpacing })} options={[['compact', 'Compact'], ['default', 'Template'], ['spacious', 'Spacious']]} />
          <Segmented label="Container width" value={appearance.containerWidth} onChange={(containerWidth) => setAppearance({ containerWidth })} options={[['narrow', 'Narrow'], ['default', 'Template'], ['wide', 'Wide']]} />
        </div>
      </Section>
      {children}
    </div>
  );
}

export const DEFAULT_THEME = () => ({ typography: { ...DEFAULT_TYPOGRAPHY }, colors: {}, appearance: { ...DEFAULT_APPEARANCE } });
