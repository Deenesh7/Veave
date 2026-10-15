/**
 * VEAVE Design System — canonical rules injected into every compiled prompt.
 * This module contains ZERO LLM calls; it is a pure knowledge base.
 */

const VEAVE_DESIGN_SYSTEM = Object.freeze({
  name: 'veave',
  mood: [
    'premium', 'clean', 'modern', 'professional', 'calm',
    'human-designed', 'product-focused', 'minimal but not empty'
  ],
  typography: {
    primary: 'Inter',
    secondary: 'Geist',
    display: 'Space Grotesk',
    baseSize: '14px',
    scale: [
      'display-xl: 48/56 semibold',
      'display-lg: 36/44 semibold',
      'h1: 28/36 semibold',
      'h2: 22/30 semibold',
      'h3: 18/26 semibold',
      'body: 14/22 regular',
      'small: 12/18 medium',
      'caption: 11/16 medium'
    ]
  },
  icons: 'lucide-react',
  colors: {
    background: '#FFFFFF',
    surface: '#FAFAFA',
    surfaceAlt: '#F4F4F5',
    border: '#E5E7EB',
    borderStrong: '#D4D4D8',
    text: '#111827',
    textMuted: '#6B7280',
    charcoal: '#27272A',
    nearBlack: '#0A0A0A',
    accent: '#3B82F6',            // soft blue
    accentSoft: '#DBEAFE',
    mutedBlue: '#64748B',
    softGreen: '#86EFAC',
    skyBlue: '#38BDF8',
    oceanTeal: '#0D9488',
    palette: [
      '#FFFFFF (white)',
      '#FAFAFA (off-white)',
      '#E5E7EB (light gray)',
      '#27272A (charcoal)',
      '#0A0A0A (near-black)',
      '#3B82F6 (soft blue accent)',
      '#64748B (muted blue)',
      '#86EFAC (soft green)',
      '#38BDF8 (sky blue)',
      '#0D9488 (ocean teal)'
    ]
  },
  radius: {
    card: '12px–16px',
    button: '10px',
    input: '10px',
    pill: '999px'
  },
  spacing: '4 / 8 / 12 / 16 / 24 / 32 / 48',
  shadows: 'thin borders + subtle single-layer shadows (no glow, no neon)',
  motion: {
    duration: '150–250ms',
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    principles: [
      'transitions on hover / focus / press only',
      'no decorative loops',
      'no bouncing UI',
      'respect prefers-reduced-motion'
    ]
  },
  visualConstraints: [
    'ZERO PURPLE: The model must NOT use the purple color anywhere in the project (no purple, violet, lavender, fuchsia, or magenta)',
    'Restrained pastel accents only; single-accent bias',
    'Thin 1px borders with subtle contrast',
    'Card radii 12–16px',
    'Subtle single-layer shadows only',
    'Lucide React icons only',
    'Strict card consistency: identical layout pattern (Pattern A/B/C) and aspect ratio (16:9, 4:3, 1:1, 4:5) for all cards in a group',
    'Strict text hierarchy: Category -> Title -> Description -> Metadata',
    'No text overflow outside cards; use line-clamp and word-break',
    'No floating duplicate titles over images; single clear title',
    'Image overlays must be contained inside the relative image container',
    'Meaningful descriptive alt text on all images'
  ],
  imageConsistency: {
    patterns: [
      'Pattern A: IMAGE ABOVE TEXT (Image -> Category -> Title -> Description -> Metadata)',
      'Pattern B: BACKGROUND IMAGE WITH TEXT OVERLAY (Consistent aspect ratio, readable overlay, text within container)',
      'Pattern C: IMAGE + TEXT SIDE BY SIDE (Consistent horizontal split, aligned content)'
    ],
    aspectRatios: ['16:9 (landscape)', '4:3 (standard card)', '1:1 (square)', '4:5 (portrait)'],
    rules: [
      'All cards in the same repeated component group must follow the exact same structure',
      'Never mix layout patterns within the same group (e.g. all Pattern A or all Pattern B)',
      'Consistent image container height with object-cover',
      'Strict text hierarchy: Category -> Title -> Description -> Metadata',
      'Prevent text overflow with line-clamp, word-break, and flexible containers',
      'No duplicate floating titles over images; single clear title per card',
      'Overlays must stay strictly inside image container (relative container, absolute overlay)',
      'Meaningful descriptive alt text for all images; no meaningless "image" or "photo"'
    ]
  },
  interactiveSafety: {
    elements: [
      'navbar links', 'dropdown menus', 'buttons', 'tabs', 'sidebar items',
      'modals', 'forms', 'search controls', 'profile menus', 'settings controls',
      'cards with click actions', 'tooltips', 'toggle controls', 'breadcrumbs', 'pagination'
    ],
    rules: [
      'Every interactive element must have a functional, safe event handler or target route',
      'Do not call undefined functions or reference undefined variables in event handlers',
      'Defensive null and undefined checks on all dynamic data',
      'Destination routes must exist or have safe fallbacks; no inventing unregistered routes',
      'Strict component validation: valid default vs named exports, never render plain objects or undefined as React children',
      'Error isolation: component errors must not crash the entire application; use diagnostic fallbacks',
      'Visual correctness + functional interactions + valid routing + valid imports/exports + runtime safety + zero critical unhandled errors'
    ]
  },
  banned: [
    'any purple color (purple, violet, lavender, fuchsia, magenta) - PURPLE IS STRICTLY FORBIDDEN',
    'neon colors', 'rainbow gradients', 'harsh gradients',
    'radial orbs', 'dot grids', 'sparkle icons',
    'excessive glassmorphism', 'excessive liquid glass',
    'generic bento grids', 'animated arrows',
    'decorative blobs', 'excessive shadows', 'skeleton loading',
    'generic AI visual effects'
  ],
  defaultTechnology: {
    framework: 'react',
    language: 'javascript',
    styling: 'tailwindcss',
    bundler: 'vite',
    icons: 'lucide-react',
    extras: []
  }
});

module.exports = { VEAVE_DESIGN_SYSTEM };
