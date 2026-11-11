import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { templateSiteService } from '../../services/templateSiteService';
import { GhostButton, Skeleton, inputClass, ink, muted, line } from './ui';

export const DEFAULT_TYPOGRAPHY = { headingFont: '', bodyFont: '', headingWeight: 700, bodyWeight: 400, headingSize: 1, headingLetterSpacing: 0, bodySize: 16, bodyLineHeight: 1.6 };
export const isDefaultTypography = (value) => !value || Object.keys(DEFAULT_TYPOGRAPHY).every((key) => value[key] === DEFAULT_TYPOGRAPHY[key]);

let libraryPromise = null;
const loadLibrary = () => {
  if (!libraryPromise) libraryPromise = templateSiteService.themeLibrary().then((res) => res.data).catch((error) => { libraryPromise = null; throw error; });
  return libraryPromise;
};

/** Loads the curated families from Google Fonts (once) so every option can really be drawn. */
function useFontLibrary() {
  const [library, setLibrary] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadLibrary().then((data) => {
      if (!alive) return;
      if (!document.querySelector('link[data-veave-fonts]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = data.googleFontsUrl; link.setAttribute('data-veave-fonts', 'true');
        document.head.appendChild(link);
      }
      setLibrary(data);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  return { library, failed };
}

const stackOf = (library, name, templateStack) => {
  const font = library?.fonts.find((item) => item.name === name);
  return font ? `'${font.name}', ${font.fallback}` : templateStack;
};

/** The stacks the preview uses for a typography value (template stacks for roles left on "template default"). */
export const stacksFor = (library, typography, template) => ({
  heading: stackOf(library, typography.headingFont, template?.headingFont || 'ui-serif, Georgia, serif'),
  body: stackOf(library, typography.bodyFont, template?.bodyFont || 'ui-sans-serif, system-ui, sans-serif')
});

function Select({ id, label, value, onChange, children }) {
  return (
    <label htmlFor={id} className="block">
      <span className={`mb-0.5 block text-[11px] ${muted}`}>{label}</span>
      <select id={id} value={value} onChange={onChange} className={`${inputClass} !py-1.5 !text-xs`}>{children}</select>
    </label>
  );
}

function Slider({ id, label, value, min, max, step, onChange, format }) {
  return (
    <label htmlFor={id} className="block">
      <span className={`mb-0.5 flex justify-between text-[11px] ${muted}`}><span>{label}</span><span className={ink}>{format(value)}</span></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-[#5E7B5F]" />
    </label>
  );
}

const GENERIC_WEIGHTS = [300, 400, 500, 600, 700, 800];
const WEIGHT_NAMES = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

/** Interactive typography panel: presets, heading and body controls, a sample, and reset. `value` is always a complete object. */
export default function TypographyEditor({ value, onChange, template, library, failed, bare = false }) {
  const [preset, setPreset] = useState('');
  const custom = !isDefaultTypography(value);
  const set = (patch) => { setPreset(''); onChange({ ...value, ...patch }); };
  const weightsOf = (name) => library?.fonts.find((font) => font.name === name)?.weights || GENERIC_WEIGHTS;
  const pickFont = (role, name) => {
    const weights = weightsOf(name);
    const current = value[`${role}Weight`];
    const snapped = weights.reduce((best, item) => (Math.abs(item - current) < Math.abs(best - current) ? item : best), weights[0]);
    set({ [`${role}Font`]: name, [`${role}Weight`]: snapped });
  };
  const choosePreset = (item) => { setPreset(item.id); onChange({ ...DEFAULT_TYPOGRAPHY, ...item, id: undefined, name: undefined }); };
  const reset = () => { setPreset(''); onChange({ ...DEFAULT_TYPOGRAPHY }); };
  const stacks = useMemo(() => stacksFor(library, value, template), [library, value, template]);
  const fontOptions = (role) => (
    <>
      <option value="">Template default</option>
      {(library?.fonts || []).map((font) => <option key={font.name} value={font.name} style={{ fontFamily: `'${font.name}', ${font.fallback}` }}>{font.name}</option>)}
    </>
  );

  if (!library) return <div className="space-y-2" aria-busy="true">{failed ? <p className={`text-xs ${muted}`}>The font library could not be loaded. The template keeps its own typography.</p> : <><Skeleton className="h-6 w-full" /><Skeleton className="h-24 w-full" /></>}</div>;

  return (
    <div className="space-y-3 text-xs">
      <div className={`flex items-center justify-between ${bare ? 'hidden' : ''}`}>
        <p className={`font-medium uppercase tracking-wider ${muted}`}>Typography {custom ? <span className="ml-1 rounded bg-[#E8F0E8] px-1 py-0.5 text-[10px] normal-case tracking-normal text-[#33503A]">Customised</span> : null}</p>
        <GhostButton className="!px-2 !py-1" onClick={reset} disabled={!custom} aria-label="Reset to template default"><RotateCcw className="h-3 w-3" />Reset</GhostButton>
      </div>

      {bare ? <GhostButton className="!px-2 !py-1" onClick={reset} disabled={!custom} aria-label="Reset typography to template default"><RotateCcw className="h-3 w-3" />Reset typography</GhostButton> : null}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Font pairing presets">
        {library.presets.map((item) => (
          <button key={item.id} type="button" onClick={() => choosePreset(item)} aria-pressed={preset === item.id} title={`${item.headingFont} + ${item.bodyFont}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${preset === item.id ? 'border-[#5E7B5F] bg-[#E8F0E8] text-[#33503A]' : `${line} bg-white ${ink} hover:border-[#B9B2A2]`}`}>{item.name}</button>
        ))}
      </div>

      <fieldset className="space-y-2">
        <legend className={`mb-1 font-medium ${ink}`}>Heading font</legend>
        <Select id="typo-heading-font" label="Family" value={value.headingFont} onChange={(event) => pickFont('heading', event.target.value)}>{fontOptions('heading')}</Select>
        <div className="grid grid-cols-2 gap-2">
          <Select id="typo-heading-weight" label="Weight" value={value.headingWeight} onChange={(event) => set({ headingWeight: Number(event.target.value) })}>
            {weightsOf(value.headingFont).map((weight) => <option key={weight} value={weight}>{WEIGHT_NAMES[weight]} {weight}</option>)}
          </Select>
          <Slider id="typo-heading-size" label="Size" value={value.headingSize} min={0.8} max={1.3} step={0.05} onChange={(headingSize) => set({ headingSize })} format={(v) => `${Math.round(v * 100)}%`} />
        </div>
        <Slider id="typo-heading-spacing" label="Letter spacing" value={value.headingLetterSpacing} min={-0.05} max={0.1} step={0.005} onChange={(headingLetterSpacing) => set({ headingLetterSpacing })} format={(v) => `${v.toFixed(3)}em`} />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={`mb-1 font-medium ${ink}`}>Body font</legend>
        <Select id="typo-body-font" label="Family" value={value.bodyFont} onChange={(event) => pickFont('body', event.target.value)}>{fontOptions('body')}</Select>
        <div className="grid grid-cols-2 gap-2">
          <Select id="typo-body-weight" label="Weight" value={value.bodyWeight} onChange={(event) => set({ bodyWeight: Number(event.target.value) })}>
            {weightsOf(value.bodyFont).map((weight) => <option key={weight} value={weight}>{WEIGHT_NAMES[weight]} {weight}</option>)}
          </Select>
          <Slider id="typo-body-size" label="Size" value={value.bodySize} min={14} max={20} step={1} onChange={(bodySize) => set({ bodySize })} format={(v) => `${v}px`} />
        </div>
        <Slider id="typo-body-line" label="Line height" value={value.bodyLineHeight} min={1.3} max={2} step={0.05} onChange={(bodyLineHeight) => set({ bodyLineHeight })} format={(v) => v.toFixed(2)} />
      </fieldset>

      <div className={`rounded-md border ${line} bg-white p-2.5`} aria-label="Typography sample">
        <p style={{ fontFamily: stacks.heading, fontWeight: value.headingWeight, letterSpacing: `${value.headingLetterSpacing}em`, fontSize: `${24 * value.headingSize}px`, lineHeight: 1.15 }} className={`${ink} break-words`}>Main heading</p>
        <p style={{ fontFamily: stacks.heading, fontWeight: value.headingWeight, letterSpacing: `${value.headingLetterSpacing}em`, fontSize: `${17 * value.headingSize}px` }} className={`mt-1 ${ink} break-words`}>Section heading</p>
        <p style={{ fontFamily: stacks.body, fontWeight: value.bodyWeight, fontSize: `${value.bodySize - 2}px`, lineHeight: value.bodyLineHeight }} className={`mt-1 ${muted}`}>Body paragraph: every page of your website reads in this typeface and rhythm.</p>
        <span style={{ fontFamily: stacks.body, fontWeight: 600, fontSize: `${value.bodySize - 3}px` }} className="mt-2 inline-block rounded bg-[#5E7B5F] px-2.5 py-1 text-white">Button text</span>
      </div>
    </div>
  );
}

export { useFontLibrary };
