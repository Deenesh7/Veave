import React, { useState, useEffect, useRef } from 'react';
import { 
  Palette, 
  Check, 
  Sparkles, 
  Plus, 
  Trash2, 
  Copy, 
  CheckCheck, 
  RefreshCw, 
  Sliders, 
  Layers, 
  Eye, 
  Type, 
  Square, 
  Maximize2, 
  Save, 
  CheckCircle2, 
  Wand2, 
  Sun, 
  Moon, 
  Edit3, 
  ChevronDown,
  Download,
  Search,
  ExternalLink,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { Dialog } from '../components/ui/Dialog';
import useThemePaletteStore from '../store/themePaletteStore';
import customFontService from '../services/customFontService';

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary Accent', desc: 'Main brand & primary actions', default: '#52525B' },
  { key: 'secondary', label: 'Secondary / Slate', desc: 'Subtitles & secondary actions', default: '#64748B' },
  { key: 'background', label: 'Canvas / Background', desc: 'Workspace canvas background', default: '#F8F9FA' },
  { key: 'card', label: 'Card Surface', desc: 'Component containers & cards', default: '#FFFFFF' },
  { key: 'foreground', label: 'Foreground / Text', desc: 'Headings & primary labels', default: '#111827' },
  { key: 'accent', label: 'Accent Highlight', desc: 'Badges & active states', default: '#0EA5E9' },
  { key: 'border', label: 'Border / Outline', desc: 'Dividers & container borders', default: '#E2E5E8' },
];

const INITIAL_HEADING_FONTS = [
  { name: 'Inter', family: "'Inter', sans-serif", category: 'Clean Sans' },
  { name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', sans-serif", category: 'Geometric' },
  { name: 'Outfit', family: "'Outfit', sans-serif", category: 'Modern' },
  { name: 'Space Grotesk', family: "'Space Grotesk', sans-serif", category: 'Tech' },
  { name: 'Poppins', family: "'Poppins', sans-serif", category: 'Friendly' },
  { name: 'Playfair Display', family: "'Playfair Display', serif", category: 'Editorial' },
];

const INITIAL_BODY_FONTS = [
  { name: 'Inter', family: "'Inter', sans-serif", category: 'Universal' },
  { name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', sans-serif", category: 'Clean' },
  { name: 'Roboto', family: "'Roboto', sans-serif", category: 'Neutral' },
  { name: 'System Sans', family: "system-ui, -apple-system, sans-serif", category: 'Native' },
];

const FONT_MONO_OPTIONS = [
  { name: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
  { name: 'Fira Code', family: "'Fira Code', monospace" },
  { name: 'Source Code Pro', family: "'Source Code Pro', monospace" },
];

const RADIUS_PRESETS = [
  { id: 'sharp', label: 'Sharp (0px)', button: '0px', card: '0px', container: '0px', desc: 'Brutalist & high-precision' },
  { id: 'subtle', label: 'Subtle (6px)', button: '6px', card: '10px', container: '12px', desc: 'Technical & refined' },
  { id: 'modern', label: 'Modern (10px)', button: '10px', card: '16px', container: '20px', desc: 'Balanced SaaS default' },
  { id: 'playful', label: 'Playful (Pill)', button: '9999px', card: '22px', container: '28px', desc: 'Soft pills & curved cards' },
];

const BUTTON_RADIUS_OPTIONS = [
  { label: '0px (Sharp)', value: '0px' },
  { label: '4px (Small)', value: '4px' },
  { label: '6px (Subtle)', value: '6px' },
  { label: '8px (Balanced)', value: '8px' },
  { label: '10px (Modern)', value: '10px' },
  { label: '14px (Rounded)', value: '14px' },
  { label: '9999px (Pill)', value: '9999px' },
];

const CARD_RADIUS_OPTIONS = [
  { label: '0px (Sharp)', value: '0px' },
  { label: '6px (Subtle)', value: '6px' },
  { label: '10px (Compact)', value: '10px' },
  { label: '14px (Medium)', value: '14px' },
  { label: '18px (Modern)', value: '18px' },
  { label: '24px (Soft)', value: '24px' },
];

const CONTAINER_RADIUS_OPTIONS = [
  { label: '0px (Sharp)', value: '0px' },
  { label: '8px (Small)', value: '8px' },
  { label: '14px (Subtle)', value: '14px' },
  { label: '18px (Modern)', value: '18px' },
  { label: '24px (Spacious)', value: '24px' },
  { label: '32px (Pill Surface)', value: '32px' },
];

const DENSITY_OPTIONS = [
  { id: 'compact', label: 'Compact', desc: 'High data density' },
  { id: 'standard', label: 'Standard', desc: 'Balanced modern SaaS' },
  { id: 'spacious', label: 'Spacious', desc: 'Airy & generous breathing room' },
];

const SHADOW_OPTIONS = [
  { id: 'none', label: 'Flat', css: 'none' },
  { id: 'subtle', label: 'Subtle', css: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)' },
  { id: 'elevated', label: 'Elevated', css: '0 10px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.04)' },
];

const BORDER_WIDTH_OPTIONS = ['0px', '1px', '1.5px', '2px'];

// 10 Rich, Diverse Suggested Palettes with ZERO purple in primary/clean themes
const SUGGESTED_PALETTES = [
  {
    name: 'Veave Modern Blue',
    description: 'Crisp electric blue with vibrant sky cyan accent and slate borders.',
    category: 'Minimal',
    colors: {
      primary: '#52525B',
      secondary: '#64748B',
      background: '#F8F9FA',
      card: '#FFFFFF',
      foreground: '#111827',
      accent: '#0EA5E9',
      border: '#E2E5E8',
    },
    typography: { headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'modern', button: '10px', card: '16px', container: '20px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Clean Slate Minimalist',
    description: 'High-contrast monochrome inspired by modern hardware design and Linear.',
    category: 'Minimal',
    colors: {
      primary: '#18181B',
      secondary: '#71717A',
      background: '#FAFAFA',
      card: '#FFFFFF',
      foreground: '#09090B',
      accent: '#18181B',
      border: '#E4E4E7',
    },
    typography: { headingFont: 'Inter', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'subtle', button: '6px', card: '10px', container: '12px' },
    geometry: { density: 'compact', borderWidth: '1px', shadow: 'none' }
  },
  {
    name: 'Carbon Obsidian',
    description: 'Deep midnight charcoal with titanium borders and brilliant Arctic cyan.',
    category: 'Dark',
    colors: {
      primary: '#00F0FF',
      secondary: '#94A3B8',
      background: '#0B0F17',
      card: '#131A26',
      foreground: '#F8FAFC',
      accent: '#38BDF8',
      border: '#222E42',
    },
    typography: { headingFont: 'Space Grotesk', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'subtle', button: '6px', card: '12px', container: '16px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Emerald Minimalist',
    description: 'Calm, organic mint and forest tones for clean productivity tools.',
    category: 'Vibrant',
    colors: {
      primary: '#10B981',
      secondary: '#6B7280',
      background: '#F9FAFB',
      card: '#FFFFFF',
      foreground: '#111827',
      accent: '#059669',
      border: '#E5E7EB',
    },
    typography: { headingFont: 'Outfit', bodyFont: 'Plus Jakarta Sans', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'modern', button: '10px', card: '16px', container: '20px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Cobalt Enterprise',
    description: 'Authoritative deep royal blue with crisp slate outlines for enterprise apps.',
    category: 'Minimal',
    colors: {
      primary: '#09090B',
      secondary: '#475569',
      background: '#F8FAFC',
      card: '#FFFFFF',
      foreground: '#0F172A',
      accent: '#38BDF8',
      border: '#CBD5E1',
    },
    typography: { headingFont: 'Plus Jakarta Sans', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'subtle', button: '6px', card: '10px', container: '14px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Sunset Terracotta',
    description: 'Warm golden amber and earthy terracotta for lifestyle and creative SaaS.',
    category: 'Vibrant',
    colors: {
      primary: '#EA580C',
      secondary: '#78716C',
      background: '#FAFAF9',
      card: '#FFFFFF',
      foreground: '#1C1917',
      accent: '#F59E0B',
      border: '#E7E5E4',
    },
    typography: { headingFont: 'Plus Jakarta Sans', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'editorial', headingWeight: '800' },
    radius: { preset: 'playful', button: '9999px', card: '22px', container: '28px' },
    geometry: { density: 'spacious', borderWidth: '1px', shadow: 'elevated' }
  },
  {
    name: 'Nordic Mist',
    description: 'Scandinavian cool gray canvas with frosty cyan highlights.',
    category: 'Minimal',
    colors: {
      primary: '#0284C7',
      secondary: '#64748B',
      background: '#F1F5F9',
      card: '#FFFFFF',
      foreground: '#0F172A',
      accent: '#38BDF8',
      border: '#CBD5E1',
    },
    typography: { headingFont: 'Outfit', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '600' },
    radius: { preset: 'modern', button: '8px', card: '14px', container: '18px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Matcha Botanical',
    description: 'Earthy matcha green and warm linen tones for calm, focused environments.',
    category: 'Vibrant',
    colors: {
      primary: '#65A30D',
      secondary: '#78716C',
      background: '#FDFBF7',
      card: '#FFFFFF',
      foreground: '#1C1917',
      accent: '#84CC16',
      border: '#E7E5E4',
    },
    typography: { headingFont: 'Plus Jakarta Sans', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'modern', button: '10px', card: '16px', container: '22px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
  {
    name: 'Tokyo Neon Cyber',
    description: 'Electric neon green and ultra-cyan highlights over pitch black canvas.',
    category: 'Dark',
    colors: {
      primary: '#10B981',
      secondary: '#94A3B8',
      background: '#090D14',
      card: '#111827',
      foreground: '#F9FAFB',
      accent: '#06B6D4',
      border: '#1F2937',
    },
    typography: { headingFont: 'Space Grotesk', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '700' },
    radius: { preset: 'subtle', button: '4px', card: '8px', container: '12px' },
    geometry: { density: 'compact', borderWidth: '1.5px', shadow: 'subtle' }
  },
  {
    name: 'Solar Flare',
    description: 'Warm solar yellow and deep graphite slate for high energy and focus.',
    category: 'Vibrant',
    colors: {
      primary: '#EAB308',
      secondary: '#71717A',
      background: '#FAFAFA',
      card: '#FFFFFF',
      foreground: '#18181B',
      accent: '#F97316',
      border: '#E4E4E7',
    },
    typography: { headingFont: 'Outfit', bodyFont: 'Inter', monoFont: 'JetBrains Mono', scale: 'modern', headingWeight: '800' },
    radius: { preset: 'playful', button: '9999px', card: '20px', container: '26px' },
    geometry: { density: 'standard', borderWidth: '1px', shadow: 'subtle' }
  },
];

// Reusable custom dropdown component for polished SaaS UX
function NiceDropdown({ label, value, options, onChange, placeholder, previewType = 'text' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => (typeof o === 'string' ? o === value : o.value === value || o.name === value));
  const displayLabel = typeof selectedOption === 'string' ? selectedOption : selectedOption?.label || selectedOption?.name || value || placeholder;

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {label && (
        <label className="text-xs font-semibold text-[#111827] block mb-1">
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 text-xs rounded-xl border bg-white flex items-center justify-between gap-2 transition-all shadow-2xs hover:border-[#52525B] focus:outline-none ${
          isOpen ? 'border-[#52525B] ring-2 ring-[#52525B]/15' : 'border-[#E2E5E8]'
        }`}
      >
        <span 
          className="truncate font-medium text-[#111827]"
          style={previewType === 'font' ? { fontFamily: value } : {}}
        >
          {displayLabel}
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180 text-[#52525B]' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full bg-white rounded-xl border border-[#E2E5E8] shadow-lg py-1 max-h-56 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => {
            const optVal = typeof opt === 'string' ? opt : opt.value || opt.name;
            const optLabel = typeof opt === 'string' ? opt : opt.label || opt.name;
            const optCategory = typeof opt === 'object' ? opt.category : null;
            const isSelected = optVal === value;

            return (
              <button
                key={optVal}
                type="button"
                onClick={() => {
                  onChange(optVal);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                  isSelected ? 'bg-zinc-50 text-[#52525B] font-semibold' : 'text-[#111827] hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <span 
                    className="truncate" 
                    style={previewType === 'font' ? { fontFamily: optVal } : {}}
                  >
                    {optLabel}
                  </span>
                  {optCategory && (
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-medium shrink-0 ${
                      optCategory === 'Imported' 
                        ? 'bg-zinc-100 text-zinc-700 font-semibold' 
                        : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      {optCategory}
                    </span>
                  )}
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#52525B] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DesignSystemsPage() {
  const { 
    palettes, 
    activePalette, 
    isLoading, 
    isSaving, 
    error, 
    fetchPalettes, 
    createPalette, 
    updatePalette, 
    deletePalette, 
    setActivePalette 
  } = useThemePaletteStore();

  const builderRef = useRef(null);
  const [copiedHex, setCopiedHex] = useState(null);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [creatorFeedback, setCreatorFeedback] = useState('');
  const [suggestedFilter, setSuggestedFilter] = useState('All');

  // Font list state with dynamic import capability
  const [availableHeadingFonts, setAvailableHeadingFonts] = useState(INITIAL_HEADING_FONTS);
  const [availableBodyFonts, setAvailableBodyFonts] = useState(INITIAL_BODY_FONTS);
  const [savedCustomFonts, setSavedCustomFonts] = useState([]);
  const [fontImportInput, setFontImportInput] = useState('');
  const [fontImportFeedback, setFontImportFeedback] = useState('');
  const [isImportingFont, setIsImportingFont] = useState(false);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);

  // Modern In-App Confirmation Dialog States (Zero browser alert prompts)
  const [paletteToDelete, setPaletteToDelete] = useState(null);
  const [isDeletingPalette, setIsDeletingPalette] = useState(false);
  const [fontToDelete, setFontToDelete] = useState(null);
  const [isDeletingFont, setIsDeletingFont] = useState(false);

  // Active Global Design System Tokens
  const [typography, setTypography] = useState({
    headingFont: 'Inter',
    bodyFont: 'Inter',
    monoFont: 'JetBrains Mono',
    scale: 'modern',
    headingWeight: '700'
  });

  const [radius, setRadius] = useState({
    preset: 'modern',
    button: '10px',
    card: '16px',
    container: '20px'
  });

  const [geometry, setGeometry] = useState({
    density: 'standard',
    borderWidth: '1px',
    shadow: 'subtle'
  });

  // Dedicated Inline Theme Creator Workbench State
  const [builderData, setBuilderData] = useState({
    name: 'My Custom Brand Theme',
    description: 'Custom tailored palette with clean brand colors and rounded geometry.',
    tags: 'Custom, Clean',
    isDefault: true,
    colors: {
      primary: '#52525B',
      secondary: '#64748B',
      background: '#F8F9FA',
      card: '#FFFFFF',
      foreground: '#111827',
      accent: '#0EA5E9', // No purple! Sky cyan
      border: '#E2E5E8',
    },
    typography: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      scale: 'modern',
      headingWeight: '700'
    },
    radius: {
      preset: 'modern',
      button: '10px',
      card: '16px',
      container: '20px'
    },
    geometry: {
      density: 'standard',
      borderWidth: '1px',
      shadow: 'subtle'
    }
  });

  // Helper to dynamically inject Google font stylesheet
  const injectFontStylesheet = (fontName, customUrl) => {
    if (!fontName) return;
    const linkId = `google-font-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = customUrl || `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700;800&display=swap`;
      document.head.appendChild(link);
    }
  };

  // Load custom fonts from library on mount
  const loadCustomFonts = async () => {
    try {
      setIsLoadingFonts(true);
      const res = await customFontService.getFonts();
      const fonts = res.data?.data || res.data || [];
      if (Array.isArray(fonts)) {
        setSavedCustomFonts(fonts);

        fonts.forEach((f) => {
          injectFontStylesheet(f.name, f.url);
        });

        const customFontObjects = fonts.map((f) => ({
          _id: f._id,
          name: f.name,
          family: f.family || `'${f.name}', sans-serif`,
          category: f.category || 'Imported'
        }));

        setAvailableHeadingFonts((prev) => {
          const existingNames = new Set(prev.map((item) => item.name.toLowerCase()));
          const newItems = customFontObjects.filter((item) => !existingNames.has(item.name.toLowerCase()));
          return [...newItems, ...prev];
        });

        setAvailableBodyFonts((prev) => {
          const existingNames = new Set(prev.map((item) => item.name.toLowerCase()));
          const newItems = customFontObjects.filter((item) => !existingNames.has(item.name.toLowerCase()));
          return [...newItems, ...prev];
        });
      }
    } catch (err) {
      console.warn('Could not load custom fonts:', err);
    } finally {
      setIsLoadingFonts(false);
    }
  };

  // Fetch themes and custom fonts on mount
  useEffect(() => {
    fetchPalettes();
    loadCustomFonts();
  }, [fetchPalettes]);

  // Sync active palette tokens with customizer controls
  useEffect(() => {
    if (activePalette) {
      if (activePalette.typography) {
        setTypography({
          headingFont: activePalette.typography.headingFont || 'Inter',
          bodyFont: activePalette.typography.bodyFont || 'Inter',
          monoFont: activePalette.typography.monoFont || 'JetBrains Mono',
          scale: activePalette.typography.scale || 'modern',
          headingWeight: activePalette.typography.headingWeight || '700'
        });
      }
      if (activePalette.radius) {
        setRadius({
          preset: activePalette.radius.preset || 'modern',
          button: activePalette.radius.button || '10px',
          card: activePalette.radius.card || '16px',
          container: activePalette.radius.container || '20px'
        });
      }
      if (activePalette.geometry) {
        setGeometry({
          density: activePalette.geometry.density || 'standard',
          borderWidth: activePalette.geometry.borderWidth || '1px',
          shadow: activePalette.geometry.shadow || 'subtle'
        });
      }
    }
  }, [activePalette]);

  // Synchronize CSS variables on document.documentElement so the whole app dynamically updates
  useEffect(() => {
    const root = document.documentElement;
    const btnRad = radius.button || '10px';
    const cardRad = radius.card || '16px';
    const containerRad = radius.container || '20px';

    root.style.setProperty('--theme-radius-btn', btnRad);
    root.style.setProperty('--theme-radius-card', cardRad);
    root.style.setProperty('--theme-radius-container', containerRad);
    root.style.setProperty('--radius', btnRad);
    root.style.setProperty('--theme-font-heading', typography.headingFont || 'Inter');
    root.style.setProperty('--theme-font-body', typography.bodyFont || 'Inter');
    root.style.setProperty('--theme-font-mono', typography.monoFont || 'JetBrains Mono');
  }, [radius, typography]);

  const handleCopyHex = (hex) => {
    if (!hex) return;
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1800);
  };

  const handleBuilderColorChange = (key, val) => {
    setBuilderData((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        [key]: val
      }
    }));
  };

  // Smart Harmonizer with zero purple: uses cyan, sky, emerald, or neutral slate
  const handleAutoHarmonize = (mode = 'light') => {
    const clean = builderData.colors.primary.startsWith('#') ? builderData.colors.primary : `#${builderData.colors.primary}`;
    if (mode === 'dark') {
      setBuilderData((prev) => ({
        ...prev,
        colors: {
          primary: clean,
          secondary: '#94A3B8',
          background: '#090D16',
          card: '#131B2A',
          foreground: '#F8FAFC',
          accent: '#38BDF8', // Sky cyan instead of purple!
          border: '#243044',
        }
      }));
    } else {
      setBuilderData((prev) => ({
        ...prev,
        colors: {
          primary: clean,
          secondary: '#64748B',
          background: '#F8FAFC',
          card: '#FFFFFF',
          foreground: '#0F172A',
          accent: '#0EA5E9', // Sky blue cyan instead of purple!
          border: '#E2E8F0',
        }
      }));
    }
  };

  // Typography Importer (Persists to custom font collection)
  const handleImportTypography = async (e, directFontName = null) => {
    if (e) e.preventDefault();
    const raw = (directFontName || fontImportInput).trim();
    if (!raw) return;

    let fontName = raw;
    let customUrl = '';
    if (raw.includes('family=')) {
      const match = raw.match(/family=([^&:'"\)]+)/);
      if (match) fontName = decodeURIComponent(match[1].replace(/\+/g, ' '));
      if (raw.startsWith('http')) customUrl = raw;
    } else if (raw.startsWith('@import') || raw.startsWith('http')) {
      const match = raw.match(/family=([^&:'"\)]+)/);
      if (match) fontName = decodeURIComponent(match[1].replace(/\+/g, ' '));
      if (raw.startsWith('http')) customUrl = raw;
    }

    // Clean font name
    fontName = fontName.replace(/['"]/g, '').trim();
    if (!fontName) return;

    setIsImportingFont(true);
    try {
      // Dynamically inject stylesheet immediately for live rendering
      injectFontStylesheet(fontName, customUrl);

      const cleanFamily = `'${fontName}', sans-serif`;

      // Persist to custom font collection
      const res = await customFontService.createFont({
        name: fontName,
        family: cleanFamily,
        category: 'Imported',
        url: customUrl || `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700;800&display=swap`,
        source: 'google'
      });

      const savedFont = res.data?.data || { name: fontName, family: cleanFamily, category: 'Imported' };

      setSavedCustomFonts((prev) => {
        const filtered = prev.filter((f) => f.name.toLowerCase() !== fontName.toLowerCase());
        return [savedFont, ...filtered];
      });

      const newFontObj = { 
        _id: savedFont._id, 
        name: fontName, 
        family: cleanFamily, 
        category: 'Imported' 
      };

      setAvailableHeadingFonts((prev) => {
        const filtered = prev.filter((f) => f.name.toLowerCase() !== fontName.toLowerCase());
        return [newFontObj, ...filtered];
      });
      setAvailableBodyFonts((prev) => {
        const filtered = prev.filter((f) => f.name.toLowerCase() !== fontName.toLowerCase());
        return [newFontObj, ...filtered];
      });

      // Auto apply to active typography and builder
      setTypography((prev) => ({ ...prev, headingFont: fontName }));
      setBuilderData((prev) => ({
        ...prev,
        typography: { ...prev.typography, headingFont: fontName }
      }));

      setFontImportFeedback(`"${fontName}" successfully imported, saved to library, and activated as Heading Font!`);
      setFontImportInput('');
      setTimeout(() => setFontImportFeedback(''), 4500);
    } catch (err) {
      setFontImportFeedback(`Failed to import font: ${err.response?.data?.error || err.message}`);
      setTimeout(() => setFontImportFeedback(''), 4500);
    } finally {
      setIsImportingFont(false);
    }
  };

  // Remove imported font from library (triggered by in-app modal confirmation)
  const handleConfirmDeleteFont = async () => {
    if (!fontToDelete) return;
    setIsDeletingFont(true);
    try {
      if (fontToDelete.id) {
        await customFontService.deleteFont(fontToDelete.id);
      }
      setSavedCustomFonts((prev) => prev.filter((f) => f._id !== fontToDelete.id && f.name.toLowerCase() !== fontToDelete.name.toLowerCase()));
      setAvailableHeadingFonts((prev) => prev.filter((f) => f._id !== fontToDelete.id && f.name.toLowerCase() !== fontToDelete.name.toLowerCase()));
      setAvailableBodyFonts((prev) => prev.filter((f) => f._id !== fontToDelete.id && f.name.toLowerCase() !== fontToDelete.name.toLowerCase()));

      if (typography.headingFont === fontToDelete.name) {
        setTypography((prev) => ({ ...prev, headingFont: 'Inter' }));
      }
      if (typography.bodyFont === fontToDelete.name) {
        setTypography((prev) => ({ ...prev, bodyFont: 'Inter' }));
      }
      if (builderData.typography.headingFont === fontToDelete.name) {
        setBuilderData((prev) => ({
          ...prev,
          typography: { ...prev.typography, headingFont: 'Inter' }
        }));
      }
      setFontToDelete(null);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to remove font');
    } finally {
      setIsDeletingFont(false);
    }
  };

  const handleSetAsHeading = (fontName) => {
    setTypography((prev) => ({ ...prev, headingFont: fontName }));
    setBuilderData((prev) => ({
      ...prev,
      typography: { ...prev.typography, headingFont: fontName }
    }));
  };

  const handleSetAsBody = (fontName) => {
    setTypography((prev) => ({ ...prev, bodyFont: fontName }));
    setBuilderData((prev) => ({
      ...prev,
      typography: { ...prev.typography, bodyFont: fontName }
    }));
  };

  const handleApplyPresetRadius = (pr) => {
    setRadius({
      preset: pr.id,
      button: pr.button,
      card: pr.card,
      container: pr.container
    });
  };

  const handleLoadPaletteIntoBuilder = (palette) => {
    const palRad = palette.radius || {};
    setBuilderData({
      name: `${palette.name} (Custom)`,
      description: palette.description || '',
      tags: (palette.tags || []).join(', '),
      isDefault: false,
      colors: { ...(palette.colors || {}) },
      typography: { ...(palette.typography || typography) },
      radius: {
        preset: palRad.preset || 'modern',
        button: palRad.button || '10px',
        card: palRad.card || '16px',
        container: palRad.container || '20px'
      },
      geometry: { ...(palette.geometry || geometry) }
    });
    builderRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleApplySuggestedPalette = async (palette) => {
    try {
      const created = await createPalette({
        name: palette.name,
        description: palette.description,
        tags: [palette.category, 'Suggested'],
        isDefault: true,
        colors: palette.colors,
        typography: palette.typography,
        radius: palette.radius,
        geometry: palette.geometry
      });
      setCreatorFeedback(`"${created.name}" applied and saved as active theme!`);
      setTimeout(() => setCreatorFeedback(''), 4000);
    } catch (err) {
      alert(err.message || 'Failed to apply suggested palette');
    }
  };

  const handleCreateThemeFromBuilder = async (e) => {
    e.preventDefault();
    if (!builderData.name.trim()) {
      alert('Please enter a name for your theme palette.');
      return;
    }

    try {
      const tagArray = builderData.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await createPalette({
        name: builderData.name.trim(),
        description: builderData.description.trim(),
        tags: tagArray,
        isDefault: builderData.isDefault,
        colors: builderData.colors,
        typography: builderData.typography,
        radius: builderData.radius,
        geometry: builderData.geometry
      });

      setCreatorFeedback(`"${created.name}" created and set as active theme!`);
      setTimeout(() => setCreatorFeedback(''), 4000);
    } catch (err) {
      alert(err.message || 'Failed to create theme palette');
    }
  };

  const handleSaveActiveSystemTokens = async () => {
    if (!activePalette?._id) return;
    try {
      await updatePalette(activePalette._id, {
        typography,
        radius,
        geometry
      });
      setShowSavedFeedback(true);
      setTimeout(() => setShowSavedFeedback(false), 2500);
    } catch (err) {
      alert(err.message || 'Failed to save system tokens');
    }
  };

  // Confirm and delete theme palette via in-app modal
  const handleConfirmDeletePalette = async () => {
    if (!paletteToDelete) return;
    setIsDeletingPalette(true);
    try {
      await deletePalette(paletteToDelete._id);
      setPaletteToDelete(null);
    } catch (err) {
      alert(err.message || 'Failed to delete theme palette');
    } finally {
      setIsDeletingPalette(false);
    }
  };

  // Safe active colors
  const currentColors = activePalette?.colors || {
    primary: '#52525B',
    secondary: '#64748B',
    background: '#F8F9FA',
    card: '#FFFFFF',
    foreground: '#111827',
    accent: '#0EA5E9',
    border: '#E2E5E8',
  };

  const activeShadow = SHADOW_OPTIONS.find((s) => s.id === geometry.shadow)?.css || 'none';

  const filteredSuggested = suggestedFilter === 'All' 
    ? SUGGESTED_PALETTES 
    : SUGGESTED_PALETTES.filter((p) => p.category.toLowerCase() === suggestedFilter.toLowerCase());

  return (
    <div className="w-full py-6 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E5E8]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Design Systems & Theme Studio</h1>
            <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              Tokens Synced
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Create custom theme palettes from scratch, import typography, customize radius geometry, and explore suggested styles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPalettes()}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-[#111827] text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Refresh design tokens"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#52525B]' : 'text-zinc-500'}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => builderRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Theme Palette</span>
          </button>
        </div>
      </div>

      {/* Error Notice (if any) */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchPalettes()} className="underline font-semibold hover:text-red-900 ml-2">
            Retry
          </button>
        </div>
      )}

      {/* SECTION 1: INLINE THEME PALETTE CREATOR STUDIO */}
      <div 
        ref={builderRef}
        className="bg-white rounded-2xl border-2 border-[#52525B]/30 p-6 sm:p-8 space-y-6 shadow-sm relative overflow-hidden"
      >
        {/* Subtle clean blue/cyan ribbon (no purple) */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#52525B] via-zinc-500 to-cyan-500" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-zinc-50 text-[#52525B] flex items-center justify-center font-bold">
                <Palette className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#111827]">Theme Palette Creator Studio</h2>
                <p className="text-xs text-[#64748B]">Create your own unique brand palette, test real-time component styling, and apply it as the active theme.</p>
              </div>
            </div>
          </div>

          {/* Preset Quick Loader */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">Quick Base:</span>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {SUGGESTED_PALETTES.slice(0, 4).map((bp) => (
                <button
                  key={bp.name}
                  type="button"
                  onClick={() => handleLoadPaletteIntoBuilder(bp)}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-zinc-200 hover:border-[#52525B] bg-zinc-50 hover:bg-zinc-50 text-zinc-700 hover:text-[#52525B] font-medium transition-all"
                >
                  {bp.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Studio Feedback Alert */}
        {creatorFeedback && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{creatorFeedback}</span>
          </div>
        )}

        {/* 2-Column Builder Layout */}
        <form onSubmit={handleCreateThemeFromBuilder} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Theme Details & Color Inputs */}
          <div className="lg:col-span-7 space-y-6">
            {/* Metadata Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#111827]">Theme Palette Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cobalt Pulse, Horizon Mint"
                  value={builderData.name}
                  onChange={(e) => setBuilderData({ ...builderData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#E2E5E8] bg-[#F8F9FA] focus:bg-white focus:outline-none focus:border-[#52525B] text-[#111827]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#111827]">Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Dark, SaaS, Enterprise"
                  value={builderData.tags}
                  onChange={(e) => setBuilderData({ ...builderData, tags: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#E2E5E8] bg-[#F8F9FA] focus:bg-white focus:outline-none focus:border-[#52525B] text-[#111827]"
                />
              </div>
            </div>

            {/* Smart Harmonizer Toolbar (No purple) */}
            <div className="p-3 rounded-xl border border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-[#52525B]" />
                <span className="text-xs font-semibold text-[#111827]">Smart Harmonize:</span>
                <span className="text-[11px] text-zinc-500">Auto-balance from Primary Accent</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAutoHarmonize('light')}
                  className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200 hover:border-zinc-300 text-zinc-700 text-xs font-medium shadow-2xs flex items-center gap-1 transition-all"
                >
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span>Light Harmony</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAutoHarmonize('dark')}
                  className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 hover:bg-zinc-800 text-xs font-medium shadow-2xs flex items-center gap-1 transition-all"
                >
                  <Moon className="w-3.5 h-3.5 text-sky-400" />
                  <span>Dark Harmony</span>
                </button>
              </div>
            </div>

            {/* 7 Color Swatch Controls */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-[#111827] block">
                Define Color Swatches (Click square for visual picker or edit hex directly)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {COLOR_FIELDS.map((f) => {
                  const val = builderData.colors[f.key] || f.default;
                  return (
                    <div
                      key={f.key}
                      className="p-2.5 rounded-xl border border-[#E2E5E8] bg-white hover:border-zinc-300 transition-all flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#111827] truncate">{f.label}</p>
                        <p className="text-[10px] text-[#64748B] truncate">{f.desc}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => handleBuilderColorChange(f.key, e.target.value)}
                          className="w-20 px-2 py-1 text-[11px] font-mono rounded-lg border border-[#E2E5E8] bg-zinc-50 text-center uppercase"
                        />
                        <input
                          type="color"
                          value={val.startsWith('#') ? val : `#${val}`}
                          onChange={(e) => handleBuilderColorChange(f.key, e.target.value)}
                          className="w-8 h-8 rounded-lg border border-black/10 cursor-pointer p-0 overflow-hidden shadow-2xs"
                          title="Open visual color picker"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Typography & Radius Custom Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <NiceDropdown
                label="Heading Typography"
                value={builderData.typography.headingFont}
                options={availableHeadingFonts}
                onChange={(val) => setBuilderData({
                  ...builderData,
                  typography: { ...builderData.typography, headingFont: val }
                })}
                previewType="font"
              />

              <NiceDropdown
                label="Corner Radius Preset"
                value={builderData.radius.preset}
                options={RADIUS_PRESETS.map((p) => ({ label: `${p.label} (${p.button} / ${p.card})`, value: p.id }))}
                onChange={(val) => {
                  const found = RADIUS_PRESETS.find((p) => p.id === val);
                  if (found) {
                    setBuilderData({
                      ...builderData,
                      radius: {
                        preset: found.id,
                        button: found.button,
                        card: found.card,
                        container: found.container
                      }
                    });
                  }
                }}
              />
            </div>

            {/* Set as Active Checkbox & Action Button */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-zinc-100">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#111827]">
                <input
                  type="checkbox"
                  checked={builderData.isDefault}
                  onChange={(e) => setBuilderData({ ...builderData, isDefault: e.target.checked })}
                  className="rounded border-zinc-300 text-[#52525B] focus:ring-[#52525B]"
                />
                <span>Set as active system default palette</span>
              </label>

              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold shadow-md hover:shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Creating Theme...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Create & Apply Theme Palette</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Live Instant Visualizer Canvas */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827] uppercase tracking-wider">
                Live Studio Canvas
              </span>
              <span className="text-[11px] text-zinc-400">Updates live at 60 FPS</span>
            </div>

            {/* Interactive Live Card Simulated in Builder Colors & Radius */}
            <div
              className="p-5 border transition-all space-y-4 shadow-sm"
              style={{
                backgroundColor: builderData.colors.background,
                borderColor: builderData.colors.border,
                borderRadius: builderData.radius.container || '20px',
                color: builderData.colors.foreground,
              }}
            >
              {/* Color Ribbon Preview */}
              <div className="h-6 rounded-lg overflow-hidden flex border border-black/10 shadow-2xs">
                <div style={{ backgroundColor: builderData.colors.primary }} className="flex-1" title="Primary" />
                <div style={{ backgroundColor: builderData.colors.secondary }} className="flex-1" title="Secondary" />
                <div style={{ backgroundColor: builderData.colors.accent }} className="flex-1" title="Accent" />
                <div style={{ backgroundColor: builderData.colors.card }} className="flex-1" title="Card" />
                <div style={{ backgroundColor: builderData.colors.border }} className="flex-1" title="Border" />
                <div style={{ backgroundColor: builderData.colors.foreground }} className="flex-1" title="Foreground" />
              </div>

              {/* Simulated UI Component with strict radius enforcement */}
              <div
                className="p-4 border shadow-sm space-y-3 transition-all"
                style={{
                  backgroundColor: builderData.colors.card,
                  borderColor: builderData.colors.border,
                  borderRadius: builderData.radius.card || '16px',
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-bold"
                    style={{
                      color: builderData.colors.foreground,
                      fontFamily: builderData.typography.headingFont,
                      fontWeight: builderData.typography.headingWeight,
                    }}
                  >
                    {builderData.name || 'Component Title'}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 font-semibold"
                    style={{
                      backgroundColor: `${builderData.colors.primary}20`,
                      color: builderData.colors.primary,
                      borderRadius: builderData.radius.button || '8px',
                    }}
                  >
                    Theme Token
                  </span>
                </div>

                <p 
                  className="text-xs opacity-75 leading-relaxed" 
                  style={{ color: builderData.colors.secondary, fontFamily: builderData.typography.bodyFont }}
                >
                  Surfaces, typography, and controls react dynamically to your custom color values and corner geometry.
                </p>

                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value="Dynamic Form Input"
                    className="w-full px-3 py-1.5 text-xs border focus:outline-none"
                    style={{
                      borderColor: builderData.colors.border,
                      borderRadius: builderData.radius.button || '8px',
                      backgroundColor: builderData.colors.background,
                      color: builderData.colors.foreground,
                      fontFamily: builderData.typography.bodyFont,
                    }}
                  />

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      className="px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-90"
                      style={{
                        backgroundColor: builderData.colors.primary,
                        borderRadius: builderData.radius.button || '8px',
                        fontFamily: builderData.typography.headingFont,
                      }}
                    >
                      Primary Action
                    </button>
                    <button
                      type="button"
                      className="px-3.5 py-1.5 text-xs font-medium border"
                      style={{
                        borderColor: builderData.colors.border,
                        borderRadius: builderData.radius.button || '8px',
                        color: builderData.colors.foreground,
                        backgroundColor: 'transparent',
                        fontFamily: builderData.typography.bodyFont,
                      }}
                    >
                      Ghost Action
                    </button>
                  </div>
                </div>
              </div>

              {/* Code Snippet Token Export */}
              <div
                className="p-3 border font-mono text-[10px] space-y-1 text-zinc-500 overflow-x-auto"
                style={{
                  backgroundColor: builderData.colors.card,
                  borderColor: builderData.colors.border,
                  borderRadius: builderData.radius.card || '16px',
                  fontFamily: builderData.typography.monoFont,
                }}
              >
                <p className="font-bold text-zinc-700">Token Map:</p>
                <p>primary: <span style={{ color: builderData.colors.primary }}>"{builderData.colors.primary}"</span></p>
                <p>accent: <span style={{ color: builderData.colors.accent }}>"{builderData.colors.accent}"</span></p>
                <p>buttonRadius: <span>"{builderData.radius.button}"</span></p>
                <p>cardRadius: <span>"{builderData.radius.card}"</span></p>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* SECTION 2: IMPORT CUSTOM TYPOGRAPHY & FONT LIBRARY */}
      <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 space-y-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-zinc-50 text-[#52525B] flex items-center justify-center font-bold shadow-2xs">
              <Type className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#111827]">Import Custom Typography & Google Fonts</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-50 text-[#52525B] border border-zinc-200/60 font-semibold">
                  {savedCustomFonts.length} Saved in Library
                </span>
              </div>
              <p className="text-xs text-[#64748B]">Type any Google Font family name or paste a font stylesheet URL to import and sync with design tokens.</p>
            </div>
          </div>
        </div>

        {fontImportFeedback && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{fontImportFeedback}</span>
          </div>
        )}

        <form onSubmit={handleImportTypography} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="e.g. Sora, Manrope, DM Sans, Clash Display, Montserrat, Lora, Rubik..."
              value={fontImportInput}
              onChange={(e) => setFontImportInput(e.target.value)}
              disabled={isImportingFont}
              className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-[#E2E5E8] bg-[#F8F9FA] focus:bg-white focus:outline-none focus:border-[#52525B] text-[#111827] disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={isImportingFont || !fontImportInput.trim()}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-2xs flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImportingFont ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Import Font</span>
              </>
            )}
          </button>
        </form>

        {/* Popular Google Fonts Quick Badges */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-zinc-400 font-medium mr-1">One-Click Presets:</span>
          {['Manrope', 'Sora', 'DM Sans', 'Montserrat', 'Outfit', 'Space Grotesk', 'Rubik', 'Cinzel', 'Lora'].map((fName) => {
            const isAlreadyImported = savedCustomFonts.some((f) => f.name.toLowerCase() === fName.toLowerCase());
            return (
              <button
                key={fName}
                type="button"
                onClick={() => handleImportTypography(null, fName)}
                disabled={isImportingFont}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all flex items-center gap-1 ${
                  isAlreadyImported
                    ? 'border-zinc-200 bg-zinc-50 text-[#52525B]'
                    : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-50 hover:border-[#52525B] hover:text-[#52525B] text-zinc-600'
                }`}
              >
                {isAlreadyImported ? (
                  <>
                    <Check className="w-3 h-3 text-[#52525B]" />
                    <span>{fName}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3 h-3 text-zinc-400" />
                    <span>{fName}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Saved Custom Typography Library */}
        <div className="pt-3 border-t border-zinc-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#111827] flex items-center gap-1.5">
              <span>Imported Typography Library</span>
              <span className="text-[10px] text-zinc-400 font-normal">({savedCustomFonts.length} custom fonts synced)</span>
            </span>
          </div>

          {isLoadingFonts ? (
            <div className="py-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-[#52525B]" />
              <span>Loading imported typography...</span>
            </div>
          ) : savedCustomFonts.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 text-center space-y-1">
              <p className="text-xs font-medium text-zinc-600">No custom typography imported yet.</p>
              <p className="text-[11px] text-zinc-400">
                Type any font name above or click any One-Click Preset to sync it with your design tokens.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedCustomFonts.map((font) => {
                const isHeadingActive = typography.headingFont === font.name;
                const isBodyActive = typography.bodyFont === font.name;

                return (
                  <div
                    key={font._id || font.name}
                    className="p-3.5 rounded-xl border border-[#E2E5E8] hover:border-[#52525B] bg-white shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate">
                        <h4 
                          className="text-sm font-bold text-[#111827] truncate"
                          style={{ fontFamily: `'${font.name}', sans-serif` }}
                        >
                          {font.name}
                        </h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-50 text-[#52525B] font-semibold border border-zinc-200/50">
                            Imported
                          </span>
                          {isHeadingActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                              Heading Active
                            </span>
                          )}
                          {isBodyActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                              Body Active
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFontToDelete({ id: font._id, name: font.name });
                        }}
                        className="p-1 text-zinc-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                        title={`Remove ${font.name} from library`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Specimen Render in Actual Font */}
                    <div 
                      className="p-2.5 rounded-lg bg-[#F8F9FA] border border-zinc-100 text-xs text-zinc-700 space-y-1"
                      style={{ fontFamily: `'${font.name}', sans-serif` }}
                    >
                      <p className="font-bold text-sm text-[#111827] truncate">
                        Aa Bb Gg 123 &amp; ?
                      </p>
                      <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">
                        The quick brown fox jumps over the lazy dog. Modern interface typography.
                      </p>
                    </div>

                    {/* Quick Apply Actions */}
                    <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-100">
                      <button
                        type="button"
                        onClick={() => handleSetAsHeading(font.name)}
                        className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 ${
                          isHeadingActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-zinc-100 hover:bg-zinc-50 text-zinc-700 hover:text-[#52525B]'
                        }`}
                      >
                        {isHeadingActive && <Check className="w-3 h-3 text-emerald-600" />}
                        <span>{isHeadingActive ? 'Active Heading' : 'Set as Heading'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSetAsBody(font.name)}
                        className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 ${
                          isBodyActive
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : 'bg-zinc-100 hover:bg-zinc-50 text-zinc-700 hover:text-[#52525B]'
                        }`}
                      >
                        {isBodyActive && <Check className="w-3 h-3 text-indigo-600" />}
                        <span>{isBodyActive ? 'Active Body' : 'Set as Body'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 3: COMPACT SUGGESTED PALETTES (NO FULL PALETTE OVERLOAD, NO EXCESSIVE SCROLLING) */}
      <div className="bg-white rounded-2xl border border-[#E2E5E8] p-5 space-y-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-50 text-[#52525B] flex items-center justify-center font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#111827]">Suggested Theme Presets</h3>
              <p className="text-xs text-[#64748B]">Compact presets ready to apply directly or tune in the studio.</p>
            </div>
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-100 rounded-xl border border-zinc-200/60">
            {['All', 'Minimal', 'Dark', 'Vibrant'].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSuggestedFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  suggestedFilter === cat
                    ? 'bg-white text-[#111827] shadow-xs font-semibold'
                    : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Compact Grid: 2 small color dots + Name + Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {filteredSuggested.map((sp) => (
            <div
              key={sp.name}
              className="p-3 rounded-xl border border-[#E2E5E8] hover:border-[#52525B] bg-[#F8F9FA]/60 hover:bg-white transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between space-y-2.5 group"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-bold text-[#111827] group-hover:text-[#52525B] truncate transition-colors">
                  {sp.name}
                </span>
                {/* 2 Signature Color Dots (Primary + Accent) - Compact, no full palette ribbon */}
                <div className="flex items-center -space-x-1 shrink-0">
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-2xs"
                    style={{ backgroundColor: sp.colors.primary }}
                    title={`Primary: ${sp.colors.primary}`}
                  />
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-2xs"
                    style={{ backgroundColor: sp.colors.accent }}
                    title={`Accent: ${sp.colors.accent}`}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-200/60">
                <button
                  type="button"
                  onClick={() => handleApplySuggestedPalette(sp)}
                  className="flex-1 py-1 rounded-lg bg-zinc-900 hover:bg-black text-white text-[11px] font-semibold transition-colors shadow-2xs"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadPaletteIntoBuilder(sp)}
                  className="py-1 px-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[11px] font-medium transition-colors"
                  title="Customize in Studio"
                >
                  Tune
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 4: ACTIVE PALETTE LIVE INSPECTOR & SIMULATION */}
      <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 space-y-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div 
              className="w-4 h-4 rounded-full border border-black/10 shadow-2xs" 
              style={{ backgroundColor: currentColors.primary }}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#111827]">
                  {activePalette?.name || 'Veave Modern Blue'}
                </h2>
                {activePalette?.isDefault && (
                  <span className="text-[10px] font-semibold bg-zinc-50 text-zinc-600 border border-zinc-200 px-2 py-0.5 rounded-full">
                    Default
                  </span>
                )}
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Active
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
                {activePalette?.description || 'Active design system tokens currently enforced across the interface.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showSavedFeedback && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Tokens Saved</span>
              </span>
            )}
            <button
              onClick={() => handleLoadPaletteIntoBuilder(activePalette || { colors: currentColors, name: 'Active Theme' })}
              className="px-3 py-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 bg-zinc-50 hover:bg-zinc-100 text-xs font-semibold text-[#111827] flex items-center gap-1.5 transition-all shadow-2xs"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#52525B]" />
              <span>Edit in Studio</span>
            </button>
            <button
              onClick={handleSaveActiveSystemTokens}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs"
              title="Save current typography, radius, and geometry modifications"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </div>

        {/* Color Tokens Swatches Grid */}
        <div>
          <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider mb-3">Active Color Swatches</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {COLOR_FIELDS.map((f) => {
              const hexValue = currentColors[f.key] || f.default;
              const isCopied = copiedHex === hexValue;

              return (
                <div
                  key={f.key}
                  onClick={() => handleCopyHex(hexValue)}
                  className="group relative p-3 rounded-xl border border-[#E2E5E8] hover:border-zinc-300 bg-white space-y-2 cursor-pointer transition-all hover:shadow-2xs"
                  title="Click to copy hex code"
                >
                  <div
                    className="w-full h-12 rounded-lg shadow-2xs border border-black/10 flex items-center justify-center transition-transform group-hover:scale-[1.02]"
                    style={{ backgroundColor: hexValue }}
                  >
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 text-white rounded p-1">
                      {isCopied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-[#111827] truncate">{f.label}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] font-mono text-zinc-500 uppercase">{hexValue}</span>
                      {isCopied && <span className="text-[9px] font-bold text-emerald-600">Copied!</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live UI Component Simulation with Strict Radius Binding */}
        <div className="pt-2 border-t border-zinc-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">
              Enforced UI Simulation
            </h3>
            <span className="text-[11px] text-zinc-400">
              Font: {typography.headingFont} • Radius: Button {radius.button} / Card {radius.card} / Container {radius.container}
            </span>
          </div>

          <div
            className="p-5 border transition-all"
            style={{
              backgroundColor: currentColors.background,
              borderColor: currentColors.border,
              borderWidth: geometry.borderWidth,
              borderRadius: radius.container || '20px',
              color: currentColors.foreground,
              fontFamily: typography.bodyFont,
            }}
          >
            <div className={`grid grid-cols-1 md:grid-cols-3 ${geometry.density === 'compact' ? 'gap-3' : geometry.density === 'spacious' ? 'gap-6' : 'gap-4'}`}>
              {/* Card Sample */}
              <div
                className={`transition-all ${geometry.density === 'compact' ? 'p-3' : geometry.density === 'spacious' ? 'p-5' : 'p-4'} space-y-3`}
                style={{
                  backgroundColor: currentColors.card,
                  borderColor: currentColors.border,
                  borderWidth: geometry.borderWidth,
                  borderRadius: radius.card || '16px',
                  boxShadow: activeShadow,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-bold"
                    style={{ 
                      color: currentColors.foreground,
                      fontFamily: typography.headingFont,
                      fontWeight: typography.headingWeight
                    }}
                  >
                    Active Card
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 font-medium"
                    style={{
                      backgroundColor: `${currentColors.primary}20`,
                      color: currentColors.primary,
                      borderRadius: radius.button || '8px',
                    }}
                  >
                    Active Token
                  </span>
                </div>
                <p className="text-xs opacity-80" style={{ color: currentColors.secondary, fontFamily: typography.bodyFont }}>
                  Tokens automatically sync across panels, controls, and generated layouts.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    className="px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                    style={{ 
                      backgroundColor: currentColors.primary,
                      borderRadius: radius.button || '8px',
                      fontFamily: typography.headingFont,
                    }}
                  >
                    Primary Action
                  </button>
                  <button
                    className="px-3.5 py-1.5 text-xs font-medium transition-all hover:opacity-80 active:scale-95"
                    style={{
                      borderColor: currentColors.border,
                      borderWidth: geometry.borderWidth,
                      borderRadius: radius.button || '8px',
                      color: currentColors.foreground,
                      backgroundColor: 'transparent',
                      fontFamily: typography.bodyFont,
                    }}
                  >
                    Secondary
                  </button>
                </div>
              </div>

              {/* Form & Input Sample */}
              <div
                className={`transition-all ${geometry.density === 'compact' ? 'p-3' : geometry.density === 'spacious' ? 'p-5' : 'p-4'} space-y-3`}
                style={{
                  backgroundColor: currentColors.card,
                  borderColor: currentColors.border,
                  borderWidth: geometry.borderWidth,
                  borderRadius: radius.card || '16px',
                  boxShadow: activeShadow,
                }}
              >
                <span
                  className="text-xs font-bold block"
                  style={{ 
                    color: currentColors.foreground,
                    fontFamily: typography.headingFont,
                    fontWeight: typography.headingWeight
                  }}
                >
                  Form Inputs
                </span>
                <input
                  type="text"
                  readOnly
                  value="Active Token Enforced"
                  className="w-full px-3 py-1.5 text-xs focus:outline-none transition-all"
                  style={{
                    borderColor: currentColors.border,
                    borderWidth: geometry.borderWidth,
                    borderRadius: radius.button || '8px',
                    backgroundColor: currentColors.background,
                    color: currentColors.foreground,
                    fontFamily: typography.bodyFont,
                  }}
                />
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] px-2 py-0.5 font-medium"
                    style={{
                      backgroundColor: `${currentColors.accent}20`,
                      color: currentColors.accent,
                      borderRadius: radius.button || '8px',
                    }}
                  >
                    Accent Variable
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 font-medium"
                    style={{
                      backgroundColor: `${currentColors.secondary}20`,
                      color: currentColors.secondary,
                      borderRadius: radius.button || '8px',
                    }}
                  >
                    Muted Variable
                  </span>
                </div>
              </div>

              {/* CSS Variables Snippet */}
              <div
                className={`font-mono text-[11px] space-y-1.5 overflow-x-auto ${geometry.density === 'compact' ? 'p-3' : geometry.density === 'spacious' ? 'p-5' : 'p-4'}`}
                style={{
                  backgroundColor: currentColors.card,
                  borderColor: currentColors.border,
                  borderWidth: geometry.borderWidth,
                  borderRadius: radius.card || '16px',
                  boxShadow: activeShadow,
                  color: currentColors.foreground,
                  fontFamily: typography.monoFont,
                }}
              >
                <div className="flex items-center justify-between pb-1 border-b border-black/5">
                  <span className="font-sans font-bold text-xs" style={{ fontFamily: typography.headingFont }}>
                    CSS Variables
                  </span>
                  <span className="text-[10px] text-zinc-400">:root</span>
                </div>
                <div className="space-y-0.5 text-zinc-600">
                  <p>--primary: <span style={{ color: currentColors.primary }}>{currentColors.primary}</span>;</p>
                  <p>--accent: <span style={{ color: currentColors.accent }}>{currentColors.accent}</span>;</p>
                  <p>--radius-btn: <span className="text-zinc-500">{radius.button}</span>;</p>
                  <p>--radius-card: <span className="text-zinc-500">{radius.card}</span>;</p>
                  <p>--radius-container: <span className="text-zinc-500">{radius.container}</span>;</p>
                  <p>--font-heading: <span className="text-zinc-500">{typography.headingFont}</span>;</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5: SAVED THEME PALETTES GALLERY */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#111827]">Your Saved Theme Palettes</h2>
            <p className="text-xs text-[#64748B]">Saved palettes can be set as active or reloaded into the Studio to customize</p>
          </div>
          <span className="text-xs text-zinc-500 font-medium">
            {palettes.length} {palettes.length === 1 ? 'palette' : 'palettes'}
          </span>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="p-12 text-center bg-white rounded-2xl border border-[#E2E5E8] space-y-3">
            <RefreshCw className="w-6 h-6 text-[#52525B] animate-spin mx-auto" />
            <p className="text-xs text-[#64748B]">Loading design tokens...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && palettes.length === 0 && (
          <div className="p-12 text-center bg-white rounded-2xl border border-[#E2E5E8] space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center mx-auto text-zinc-500">
              <Palette className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[#111827]">No Custom Theme Palettes Yet</h3>
            <p className="text-xs text-[#64748B] max-w-sm mx-auto">
              Use the Theme Palette Studio above or select a Suggested Theme Palette to save your first brand set.
            </p>
            <button
              onClick={() => builderRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-2xs inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Open Theme Studio</span>
            </button>
          </div>
        )}

        {/* Grid of Saved Palettes */}
        {!isLoading && palettes.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {palettes.map((p) => {
              const isActive = activePalette?._id === p._id;
              const pColors = p.colors || {};

              return (
                <div
                  key={p._id}
                  onClick={() => setActivePalette(p)}
                  className={`group bg-white rounded-2xl border transition-all cursor-pointer flex flex-col justify-between overflow-hidden shadow-2xs hover:shadow-xs ${
                    isActive ? 'border-[#52525B] ring-2 ring-[#52525B]/15' : 'border-[#E2E5E8] hover:border-zinc-300'
                  }`}
                >
                  {/* Top Info */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-[#111827] group-hover:text-[#52525B] transition-colors">
                            {p.name}
                          </h3>
                          {p.isDefault && (
                            <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#64748B] line-clamp-2 mt-1">
                          {p.description || 'Custom theme palette'}
                        </p>
                      </div>

                      {isActive && (
                        <span className="shrink-0 w-6 h-6 rounded-full bg-zinc-50 border border-zinc-200 text-[#52525B] flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    {p.tags && p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Color Ribbon */}
                    <div className="space-y-1.5 pt-1">
                      <div className="h-7 w-full rounded-lg overflow-hidden flex border border-black/10 shadow-2xs">
                        <div style={{ backgroundColor: pColors.primary || '#52525B' }} className="flex-1" title={`Primary: ${pColors.primary}`} />
                        <div style={{ backgroundColor: pColors.secondary || '#64748B' }} className="flex-1" title={`Secondary: ${pColors.secondary}`} />
                        <div style={{ backgroundColor: pColors.accent || '#0EA5E9' }} className="flex-1" title={`Accent: ${pColors.accent}`} />
                        <div style={{ backgroundColor: pColors.background || '#F8F9FA' }} className="flex-1" title={`Background: ${pColors.background}`} />
                        <div style={{ backgroundColor: pColors.card || '#FFFFFF' }} className="flex-1" title={`Card: ${pColors.card}`} />
                        <div style={{ backgroundColor: pColors.border || '#E2E5E8' }} className="flex-1" title={`Border: ${pColors.border}`} />
                        <div style={{ backgroundColor: pColors.foreground || '#111827' }} className="flex-1" title={`Foreground: ${pColors.foreground}`} />
                      </div>

                      <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                        <span>{pColors.primary}</span>
                        <span>{pColors.accent}</span>
                        <span>{pColors.background}</span>
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="px-5 py-3 bg-zinc-50/70 border-t border-[#E2E5E8] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActivePalette(p, true);
                        }}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                          isActive
                            ? 'text-[#52525B] bg-zinc-50'
                            : 'text-[#64748B] hover:text-[#111827] hover:bg-zinc-200/60'
                        }`}
                      >
                        {isActive ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>Active Theme</span>
                          </>
                        ) : (
                          <span>Set as Active</span>
                        )}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadPaletteIntoBuilder(p);
                        }}
                        className="text-xs font-medium text-zinc-600 hover:text-[#52525B] hover:bg-zinc-200/60 px-2.5 py-1 rounded-lg transition-colors"
                        title="Load into Theme Studio to customize"
                      >
                        Customize
                      </button>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPaletteToDelete(p);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete palette"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 6: GRANULAR TYPOGRAPHY, RADIUS & GEOMETRY TUNING */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 6A: Typography Customizer */}
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 space-y-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-2">
              <Type className="w-4 h-4 text-[#52525B]" />
              <h3 className="text-sm font-bold text-[#111827]">Typography System</h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600">
              {typography.headingFont}
            </span>
          </div>

          <NiceDropdown
            label="Heading Font"
            value={typography.headingFont}
            options={availableHeadingFonts}
            onChange={(val) => setTypography({ ...typography, headingFont: val })}
            previewType="font"
          />

          <NiceDropdown
            label="Body Font"
            value={typography.bodyFont}
            options={availableBodyFonts}
            onChange={(val) => setTypography({ ...typography, bodyFont: val })}
            previewType="font"
          />

          <NiceDropdown
            label="Code / Monospace Font"
            value={typography.monoFont}
            options={FONT_MONO_OPTIONS}
            onChange={(val) => setTypography({ ...typography, monoFont: val })}
            previewType="font"
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111827] block">Heading Weight</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'SemiBold', val: '600' },
                { label: 'Bold', val: '700' },
                { label: 'ExtraBold', val: '800' },
              ].map((w) => (
                <button
                  key={w.val}
                  type="button"
                  onClick={() => setTypography({ ...typography, headingWeight: w.val })}
                  className={`py-1.5 text-xs rounded-lg border font-medium transition-all ${
                    typography.headingWeight === w.val
                      ? 'border-[#52525B] bg-zinc-50 text-[#52525B]'
                      : 'border-[#E2E5E8] bg-[#F8F9FA] text-[#64748B] hover:text-[#111827]'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 6B: Theme Radius Customizer (Fixed bug + full control) */}
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 space-y-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-2">
              <Square className="w-4 h-4 text-[#52525B]" />
              <h3 className="text-sm font-bold text-[#111827]">Theme Radius System</h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 uppercase">
              {radius.preset}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111827] block">Radius Presets</label>
            <div className="grid grid-cols-2 gap-2">
              {RADIUS_PRESETS.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => handleApplyPresetRadius(pr)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    radius.preset === pr.id
                      ? 'border-[#52525B] bg-zinc-50/50 text-[#52525B]'
                      : 'border-[#E2E5E8] bg-[#F8F9FA] text-[#64748B] hover:text-[#111827]'
                  }`}
                >
                  <span className="text-xs font-bold block">{pr.label}</span>
                  <span className="text-[10px] opacity-75">{pr.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Buttons Radius Dropdown */}
          <NiceDropdown
            label="Buttons & Badges Radius"
            value={radius.button}
            options={BUTTON_RADIUS_OPTIONS}
            onChange={(val) => setRadius({ ...radius, button: val, preset: 'custom' })}
          />

          {/* Cards & Surfaces Radius Dropdown */}
          <NiceDropdown
            label="Cards & Surface Panels Radius"
            value={radius.card}
            options={CARD_RADIUS_OPTIONS}
            onChange={(val) => setRadius({ ...radius, card: val, preset: 'custom' })}
          />

          {/* Containers Radius Dropdown */}
          <NiceDropdown
            label="Workspace Containers Radius"
            value={radius.container}
            options={CONTAINER_RADIUS_OPTIONS}
            onChange={(val) => setRadius({ ...radius, container: val, preset: 'custom' })}
          />
        </div>

        {/* 6C: Geometry & Layout Density Customizer */}
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-6 space-y-5 shadow-2xs">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-2">
              <Maximize2 className="w-4 h-4 text-[#52525B]" />
              <h3 className="text-sm font-bold text-[#111827]">Geometry & Density</h3>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 uppercase">
              {geometry.density}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111827] block">Spacing & Padding Scale</label>
            <div className="space-y-1.5">
              {DENSITY_OPTIONS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setGeometry({ ...geometry, density: d.id })}
                  className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                    geometry.density === d.id
                      ? 'border-[#52525B] bg-zinc-50/50 text-[#52525B]'
                      : 'border-[#E2E5E8] bg-[#F8F9FA] text-[#64748B] hover:text-[#111827]'
                  }`}
                >
                  <div>
                    <span className="text-xs font-bold block">{d.label}</span>
                    <span className="text-[10px] opacity-75">{d.desc}</span>
                  </div>
                  {geometry.density === d.id && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111827] flex items-center justify-between">
              <span>Border Stroke Width</span>
              <span className="text-[10px] font-mono text-zinc-400">{geometry.borderWidth}</span>
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {BORDER_WIDTH_OPTIONS.map((bw) => (
                <button
                  key={bw}
                  type="button"
                  onClick={() => setGeometry({ ...geometry, borderWidth: bw })}
                  className={`py-1 text-xs rounded-lg border text-center transition-all ${
                    geometry.borderWidth === bw
                      ? 'border-zinc-900 bg-zinc-900 text-white font-semibold'
                      : 'border-[#E2E5E8] bg-[#F8F9FA] text-[#64748B] hover:text-[#111827]'
                  }`}
                >
                  {bw}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#111827] block">Surface Shadow & Elevation</label>
            <div className="grid grid-cols-3 gap-1.5">
              {SHADOW_OPTIONS.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  onClick={() => setGeometry({ ...geometry, shadow: sh.id })}
                  className={`py-1.5 text-xs rounded-lg border font-medium text-center transition-all ${
                    geometry.shadow === sh.id
                      ? 'border-[#52525B] bg-zinc-50 text-[#52525B]'
                      : 'border-[#E2E5E8] bg-[#F8F9FA] text-[#64748B] hover:text-[#111827]'
                  }`}
                >
                  {sh.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Theme Palette Delete Confirmation Dialog */}
      <Dialog
        open={!!paletteToDelete}
        onClose={() => !isDeletingPalette && setPaletteToDelete(null)}
        title="Delete Theme Palette"
        description="Permanently remove this custom theme palette from your design studio."
      >
        {paletteToDelete && (
          <div className="space-y-4 pt-1">
            {/* Palette Preview Card */}
            <div className="p-4 rounded-xl border border-zinc-200 bg-white shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-900">{paletteToDelete.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-medium">
                  {(paletteToDelete.tags || []).join(', ') || 'Custom Theme'}
                </span>
              </div>

              {paletteToDelete.description && (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {paletteToDelete.description}
                </p>
              )}

              {/* Color Swatches Ribbon */}
              <div className="flex items-center gap-1.5 pt-1">
                {Object.entries(paletteToDelete.colors || {})
                  .slice(0, 6)
                  .map(([k, hex]) => (
                    <div
                      key={k}
                      className="flex-1 h-6 rounded-md border border-black/10 shadow-2xs relative group"
                      style={{ backgroundColor: hex }}
                      title={`${k}: ${hex}`}
                    />
                  ))}
              </div>
            </div>

            {/* Reassuring warning notice */}
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                This action cannot be undone. Active workspace views utilizing this palette will automatically fall back to the default theme.
              </p>
            </div>

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPaletteToDelete(null)}
                disabled={isDeletingPalette}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePalette}
                disabled={isDeletingPalette}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-2xs flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                {isDeletingPalette ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting Palette...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Palette</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Custom Font Delete Confirmation Dialog */}
      <Dialog
        open={!!fontToDelete}
        onClose={() => !isDeletingFont && setFontToDelete(null)}
        title="Remove Custom Typography"
        description="Remove this font family from your design studio typography library."
      >
        {fontToDelete && (
          <div className="space-y-4 pt-1">
            <div className="p-4 rounded-xl border border-zinc-200 bg-white shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span 
                  className="text-base font-bold text-zinc-900"
                  style={{ fontFamily: `'${fontToDelete.name}', sans-serif` }}
                >
                  {fontToDelete.name}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-50 text-[#52525B] border border-zinc-200/50">
                  Imported
                </span>
              </div>
              <p 
                className="text-xs text-zinc-600 italic"
                style={{ fontFamily: `'${fontToDelete.name}', sans-serif` }}
              >
                The quick brown fox jumps over the lazy dog. 1234567890
              </p>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                Removing this font will reset active typography selections currently configured with "{fontToDelete.name}" back to Inter.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setFontToDelete(null)}
                disabled={isDeletingFont}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteFont}
                disabled={isDeletingFont}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-2xs flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                {isDeletingFont ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing Font...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove Font</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
