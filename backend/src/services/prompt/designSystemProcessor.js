/**
 * VEAVE Design System Processor
 *
 * Merges the VEAVE design tokens & visual constraints into the extracted
 * UISpec. Deterministic — no LLM calls. Handles alternate design system
 * names by choosing appropriate defaults while preserving VEAVE-style
 * discipline (thin borders, restrained accents, no banned patterns).
 */

const { VEAVE_DESIGN_SYSTEM } = require('./veaveDesignSystem');

const PRESETS = {
  veave: VEAVE_DESIGN_SYSTEM,

  // Softer, higher-contrast variant (still VEAVE discipline)
  minimal: {
    ...VEAVE_DESIGN_SYSTEM,
    name: 'minimal',
    mood: ['minimal', 'quiet', 'high-contrast', 'utilitarian'],
    colors: {
      ...VEAVE_DESIGN_SYSTEM.colors,
      accent: '#111827',
      accentSoft: '#F4F4F5'
    }
  },

  // Enterprise: navy accent, slightly denser radii
  enterprise: {
    ...VEAVE_DESIGN_SYSTEM,
    name: 'enterprise',
    mood: ['professional', 'trustworthy', 'dense', 'clean'],
    colors: {
      ...VEAVE_DESIGN_SYSTEM.colors,
      accent: '#1D4ED8',
      accentSoft: '#DBEAFE'
    },
    radius: { card: '8px–12px', button: '8px', input: '8px', pill: '999px' }
  }
};

function pickPreset(name) {
  const key = String(name || 'veave').toLowerCase();
  return PRESETS[key] || PRESETS.veave;
}

/**
 * @param {object} spec     UISpec from requirementExtractor
 * @param {string} dsName   design system preset name
 * @returns {object}        spec augmented with .designSystem, .visualConstraints, .finalRequirements
 */
function apply(spec, dsName = 'veave', { preserveReferenceDesign = false } = {}) {
  if (preserveReferenceDesign) {
    return {
      ...spec,
      designSystem: {
        name: 'source-reference',
        mood: ['match the supplied reference exactly'],
        typography: {
          primary: 'Use the captured source font family and fallback stack',
          secondary: 'Use the captured source font family assigned to each element',
          display: 'Use the captured source heading font, weight, size, line-height, and letter-spacing',
          scale: ['Copy measured source typography per element; do not normalize it to a preferred scale']
        },
        colors: {
          background: 'Use captured source value',
          surface: 'Use captured source value',
          border: 'Use captured source value',
          text: 'Use captured source value',
          muted: 'Use captured source value',
          accent: 'Use captured source value',
          accentSoft: 'Use captured source value',
          palette: ['Derive all colors and gradients from the captured computed-style manifest']
        },
        radius: 'Use each captured source radius without normalization',
        spacing: 'Use measured source padding, margins, gaps, widths, and heights',
        shadows: 'Use captured source shadows exactly',
        icons: 'Reuse captured/localized assets or the closest technically compatible icon only when the reference contains one',
        visualConstraints: ['The reference website overrides all VEAVE visual preferences'],
        imageConsistency: 'Preserve each source image rectangle, aspect ratio, object-fit, object-position, and crop'
      },
      visualConstraints: [
        'REFERENCE FIRST: captured typography, colors, dimensions, spacing, radii, borders, gradients, shadows, and structure override every default design preference.',
        'Do not redesign, modernize, normalize, simplify, or embellish the source.',
        'Do not add sections, cards, wrappers, headings, paragraphs, rows, or columns absent from the reference.',
        'Match text wrapping through the captured font metrics and container width, never through arbitrary font-size changes.',
        'Preserve the number, order, hierarchy, and approximate height of visible sections and repeated items.'
      ],
      finalRequirements: [
        'Output a complete functional React implementation of every captured route.',
        'Use the computed-style and geometry manifest as authoritative values rather than generic UI defaults.',
        'Match both captured desktop and mobile compositions without browser zoom tricks.',
        'Use localized source assets and preserve their rendered proportions and crop.',
        'Do not declare visual fidelity complete until typography, colors, structure, dimensions, spacing, navigation, and footer have been checked against the references.'
      ]
    };
  }
  const ds = pickPreset(dsName);

  const designSystem = {
    name: ds.name,
    mood: ds.mood,
    typography: {
      primary: ds.typography.primary,
      secondary: ds.typography.secondary,
      display: ds.typography.display,
      scale: ds.typography.scale
    },
    colors: {
      background: ds.colors.background,
      surface: ds.colors.surface,
      border: ds.colors.border,
      text: ds.colors.text,
      muted: ds.colors.textMuted,
      accent: ds.colors.accent,
      accentSoft: ds.colors.accentSoft,
      palette: ds.colors.palette
    },
    radius: `${ds.radius.card} for cards, ${ds.radius.button} for buttons/inputs`,
    spacing: ds.spacing,
    shadows: ds.shadows,
    icons: ds.icons,
    visualConstraints: ds.visualConstraints,
    imageConsistency: ds.imageConsistency
  };

  const visualConstraints = [
    ...ds.visualConstraints,
    'DO NOT USE: ' + ds.banned.join(', '),
    `Typography: ${ds.typography.primary} for UI, ${ds.typography.secondary} for numeric/data, ${ds.typography.display} for hero display`,
    `Icons: ${ds.icons} only, 1.5px stroke, 16–20px in UI`,
    'Prefer flat surfaces with 1px borders over shadows',
    'Single accent color per screen — no multi-color explosions',
    'Image & Card Consistency: All cards in the same group must use the identical pattern (Pattern A, B, or C) and aspect ratio. No mixed card layouts.',
    'No text overflow: use line-clamp, word-break, and flex-col for aligned card heights',
    'Overlays strictly within image containers (relative container, absolute overlay)'
  ];

  const finalRequirements = [
    'Output must be a complete, functional React application with the described pages and interactions.',
    `Use ${spec.technology.framework} + ${spec.technology.styling} + ${spec.technology.icons}.`,
    'All interactive states (hover, focus, active, disabled, loading, error, empty, success) must be visually distinct.',
    'All pages must be responsive across mobile, tablet, and desktop breakpoints.',
    'All copy must be plausible and domain-appropriate — no lorem ipsum.',
    'No mock/placeholder blocks that break the visual system.',
    'No external image references except from a stable CDN (e.g. Unsplash) with fixed URLs when required.',
    'Repeated cards must follow the same structure (Pattern A: Image Above Text, Pattern B: Background Overlay, or Pattern C: Side-by-Side). No mixing patterns.',
    'Maintain consistent image aspect ratio, object-cover, equal image height, and uniform card heights across the group.',
    'Strict text hierarchy: Category -> Title -> Description -> Metadata with no text overflow and descriptive alt text.'
  ];

  return {
    ...spec,
    designSystem,
    visualConstraints,
    finalRequirements
  };
}

module.exports = { apply, pickPreset };
