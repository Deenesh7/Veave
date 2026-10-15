const openrouterService = require('./openrouterService');
const { VEAVE_PROMPT_ENGINEER_SYSTEM_PROMPT } = require('./prompts/systemPrompt');
const logger = require('../../utils/logger');

/**
 * Remove any em dashes ("—") and replace with appropriate punctuation (comma, colon, or hyphen)
 * to strictly adhere to VEAVE design rules.
 */
function sanitizeEmDashes(text) {
  if (!text) return '';
  return text
    .replace(/\s*—\s*/g, ' - ')
    .replace(/—/g, '-');
}

const COMMAND_DIRECTIVES = {
  '/ask': {
    name: 'Ask',
    mode: 'chat',
    type: 'chat',
    title: 'Chat & Consultation',
    goalPrefix: 'Discuss and explain without making any changes:',
    directive: 'Discuss the product, interface patterns, and architecture without altering or mutating project code. Answer questions, provide technical guidance, and outline recommendations.'
  },
  '/plan': {
    name: 'Plan',
    mode: 'plan',
    type: 'plan',
    title: 'Implementation Roadmap & Specification',
    goalPrefix: 'Analyze requirements and construct a phased implementation plan:',
    directive: 'Brainstorm and formulate a structured, phased implementation roadmap (System Architecture, Component Breakdown, State Management, and Milestones) before generating or mutating changes.'
  },
  '/inspiration': {
    name: 'Inspiration',
    mode: 'skill',
    type: 'skill',
    title: 'Creative Layout Variants',
    goalPrefix: 'Explore multiple creative UI and design variations:',
    directive: 'Explore and synthesize multiple distinctive UI/design variations (e.g. Editorial, Modern Minimalist, High-Density Dashboard) exploring creative hero and card treatments.'
  },
  '/debug': {
    name: 'Debug',
    mode: 'skill',
    type: 'skill',
    title: 'Defect Analysis & Code Resolution',
    goalPrefix: 'Inspect project code, identify and resolve issues:',
    directive: 'Inspect existing project components and code to find and fix relevant bugs, syntax errors, layout misalignments, or missing error boundaries.'
  },
  '/polish': {
    name: 'Polish',
    mode: 'skill',
    type: 'skill',
    title: 'Visual Polish & Design Elevation',
    goalPrefix: 'Improve and elevate the existing design quality:',
    directive: 'Improve & tidy up the design: refine 8px spacing rhythm, typography contrast, alignment, visual hierarchy, card height consistency (flex flex-col justify-between), subtle 150-250ms transitions, and component styling without altering core functionality.'
  }
};

/**
 * Deterministic Semantic Prompt Synthesizer
 * Generates the full 15-section VEAVE structured prompt when external LLM is offline.
 */
function synthesizeVeavePrompt(rawPrompt, designSystem = 'Modern', commandInfo = null) {
  const p = rawPrompt.toLowerCase();
  
  // Extract clean project title
  let title = rawPrompt
    .split(/[.,?!;]/)[0]
    .replace(/^(build|create|design|generate|make|develop)\s+(an?|the)?\s*/i, '')
    .trim();
  if (!title) title = 'Interactive Product Experience';
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Inferred domain & features
  let domain = 'Productivity & SaaS';
  let primaryColor = '#2563EB'; // Muted soft blue
  let accentColor = '#3B82F6';
  let bg = '#F8FAFC';
  let cardBg = '#FFFFFF';
  let typography = 'Inter (Display 28px-32px, Headings 18px-22px, Body 14px, Labels 11px-12px semibold)';
  let layoutType = 'Modern dashboard with structured top navigation, contextual metric summary, and primary interactive workspace';

  if (p.includes('student') || p.includes('attendance') || p.includes('school') || p.includes('education') || p.includes('class')) {
    domain = 'Student Attendance & Academic Management';
    primaryColor = '#3B82F6';
    accentColor = '#1D4ED8';
    layoutType = 'Sidebar + Content layout with daily attendance roll, student roster table, status filters (Present, Absent, Late), and weekly summary cards';
  } else if (p.includes('ecommerce') || p.includes('shop') || p.includes('store') || p.includes('product') || p.includes('cart') || p.includes('sneaker')) {
    domain = 'E-Commerce & Digital Storefront';
    primaryColor = '#18181B';
    accentColor = '#2563EB';
    layoutType = 'Editorial catalog with category filters, exactly 3 product feature cards per row on desktop, quick add drawer, and cart summary';
  } else if (p.includes('finance') || p.includes('bank') || p.includes('invest') || p.includes('money') || p.includes('wealth')) {
    domain = 'Financial Analytics & Portfolio Management';
    primaryColor = '#059669';
    accentColor = '#10B981';
    layoutType = 'Structured financial dashboard with asset distribution table, performance indicators, time-period filters, and transaction history';
  } else if (p.includes('restaurant') || p.includes('food') || p.includes('dining') || p.includes('cafe')) {
    domain = 'Restaurant & Culinary Experience';
    primaryColor = '#B45309';
    accentColor = '#D97706';
    layoutType = 'Editorial menu catalog with dietary category tabs, reservation booking panel, and curated dish spotlight cards';
  }

  const goalText = commandInfo?.goalPrefix
    ? `${commandInfo.goalPrefix} Deliver a high-fidelity, highly usable interface for ${domain} (${rawPrompt}).`
    : `Deliver a high-fidelity, highly usable interface for ${domain} that allows users to seamlessly view, interact with, and manage their core workflows without visual clutter.`;

  const structuredPrompt = `PROJECT:
${title}

GOAL:
${goalText}
${commandInfo ? `\nCOMMAND DIRECTIVE (${commandInfo.name.toUpperCase()} MODE):\n${commandInfo.directive}\n` : ''}
TECH STACK:
React 18, Tailwind CSS, Lucide React icons

DESIGN DIRECTION:
VEAVE Calm Editorial. Minimal, product-focused, human-designed with purposeful whitespace. Avoid generic AI landing-page patterns and marketing bloat. Every element serves an authentic user workflow.

COLOR SYSTEM:
- Background: ${bg} (light, clean canvas)
- Surface Cards: ${cardBg} with subtle 1px border (#E2E8F0)
- Primary Accent: ${primaryColor} (for primary actions and active indicator states)
- Text Hierarchy: Primary #0F172A (high contrast), Secondary #64748B (readable metadata)
- Zero neon colors, zero harsh gradients.

TYPOGRAPHY:
${typography}. Clear hierarchical scale with comfortable line height. No oversized decorative display text.

LAYOUT:
${layoutType}. Desktop utilizes a 12-column responsive grid with an 8px spacing baseline. Tablet adapts to a two-column rhythm, and mobile stacks into a single-column drawer-friendly interface.

COMPONENTS:
1. Navigation Bar: Clean brand identity, compact navigation tabs with subtle active indicator, and user account control.
2. Context Header: Purposeful page title, timestamp/status pill, and contextual primary action button.
3. Metric Summary Cards: Exactly 3 cards in a row on desktop with equal visual weight, displaying key indicators and trend percentages.
4. Main Interactive Section: Comprehensive data table or card catalog with search input, category filter dropdown, and active state highlights.
5. Action Modal / Detail Drawer: Soft 14px radius, clear heading, input form with visible focus states, and primary action button.

IMAGE & CARD CONSISTENCY:
- Repeated Card Pattern: Pattern A (Image Above Text: Image -> Category -> Title -> Description -> Metadata). All cards in the same group follow the exact same visual structure. No mixing patterns.
- Image Dimensions: Consistent aspect ratio (16:9, 4:3, or 1:1) with object-cover and equal container heights across equivalent cards.
- Visual Alignment: Consistent card heights using flex-col justify-between with aligned titles, ratings, and bottom actions.
- Text Hierarchy & Overflow: Strict Category -> Title -> Description -> Metadata hierarchy. Enforce line-clamp and word-break to prevent any text overflowing cards or overlapping elements.
- Overlay Rules: All badges/overlays stay strictly inside the relative image container with absolute positioning.
- Accessibility: Descriptive alt text for all meaningful images.

CONTENT:
Realistic product-specific labels, names, dates, and metrics based directly on "${rawPrompt}". Zero "Lorem ipsum" or meaningless buzzwords.

INTERACTIONS:
- Smooth 150ms-200ms ease-out transitions on hover and active states.
- Filter toggle updates the primary list immediately with contextual feedback.
- Interactive rows highlight softly on hover.
- Modal opens with clean fade and scale transition (Escape key closes).

RESPONSIVE BEHAVIOR:
- Desktop (>= 1024px): Full multi-column grid with 3 cards in a row.
- Tablet (768px - 1023px): Two-column layout with preserved hierarchy.
- Mobile (< 768px): Single-column view with touch-friendly 44px tap targets, horizontally scrollable filter pills, and bottom action sheet.

ACCESSIBILITY:
- WCAG AA contrast ratio across all text and icon controls.
- Visible focus rings (ring-2 ring-blue-400) for keyboard navigation.
- Semantic HTML tags (header, nav, main, section, table, button).

VISUAL CONSTRAINTS:
NO harsh gradients, NO neon colors, NO glowing effects, NO radial orbs, NO decorative sparkle icons, NO floating blobs, NO excessive glassmorphism, NO generic bento grids, and STRICTLY NO em dashes ("-").

IMPLEMENTATION REQUIREMENTS:
- Functional React components with useState and useEffect.
- Fully styled with Tailwind CSS utility classes.
- Lucide React icons used consistently.
- Valid JSON component module structure compatible with browser preview.

FINAL DESIGN REQUIREMENT:
The result must feel like a carefully designed real-world product interface created by an experienced product designer. It must not look like a generic AI-generated template.`;

  return sanitizeEmDashes(structuredPrompt);
}

/**
 * Main Prompt Engine Service
 */
class PromptEngineService {
  /**
   * Check if a prompt is already in structured VEAVE format
   */
  isAlreadyStructured(prompt) {
    if (!prompt) return false;
    return (
      prompt.includes('PROJECT:') &&
      prompt.includes('GOAL:') &&
      prompt.includes('DESIGN DIRECTION:')
    );
  }

  /**
   * Transform natural language description into detailed VEAVE UI generation prompt
   */
  async enhancePrompt(rawPrompt, options = {}) {
    if (!rawPrompt || !rawPrompt.trim()) {
      throw new Error('Prompt is required for enhancement');
    }

    const trimmed = rawPrompt.trim();

    let commandKey = options.command || null;
    if (!commandKey) {
      const match = trimmed.match(/^\/(ask|plan|inspiration|debug|polish)\b/i);
      if (match) {
        commandKey = match[0].toLowerCase();
      }
    }
    const commandInfo = commandKey ? COMMAND_DIRECTIVES[commandKey] : null;

    // If already structured, return as-is after sanitizing em dashes
    if (this.isAlreadyStructured(trimmed)) {
      return {
        success: true,
        originalPrompt: trimmed,
        enhancedPrompt: sanitizeEmDashes(trimmed),
        isAlreadyStructured: true,
        command: commandKey,
        mode: commandInfo?.mode || null
      };
    }

    // Try OpenRouter LLM if API key is provided and valid
    if (
      process.env.OPENROUTER_API_KEY &&
      process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key'
    ) {
      try {
        logger.info(`Running Prompt Engine LLM for prompt: "${trimmed.slice(0, 50)}..."`);
        
        const userPromptContent = commandInfo
          ? `COMMAND MODE: ${commandInfo.name} (${commandKey})\nDIRECTIVE: ${commandInfo.directive}\n\nTransform this user request into a complete, implementation-ready VEAVE UI generation prompt adhering strictly to the command mode:\n\n"${trimmed}"`
          : `Transform this user request into a complete, implementation-ready VEAVE UI generation prompt:\n\n"${trimmed}"`;

        const completion = await openrouterService.generateCompletion([
          {
            role: 'system',
            content: VEAVE_PROMPT_ENGINEER_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: userPromptContent
          }
        ], {
          temperature: 0.3,
          model: options.model || 'Gemini Flash 3.8'
        });

        if (completion?.content) {
          const enhanced = sanitizeEmDashes(completion.content.trim());
          return {
            success: true,
            originalPrompt: trimmed,
            enhancedPrompt: enhanced,
            command: commandKey,
            mode: commandInfo?.mode || null,
            source: 'llm'
          };
        }
      } catch (err) {
        logger.warn(`Prompt Engine LLM failed, using deterministic synthesis: ${err.message}`);
      }
    }

    // Fallback to deterministic semantic prompt synthesis
    logger.info(`Using deterministic VEAVE prompt synthesis for: "${trimmed.slice(0, 50)}..."`);
    const synthesized = synthesizeVeavePrompt(trimmed, options.designSystem, commandInfo);

    return {
      success: true,
      originalPrompt: trimmed,
      enhancedPrompt: synthesized,
      command: commandKey,
      mode: commandInfo?.mode || null,
      source: 'synthesizer'
    };
  }
}

const serviceInstance = new PromptEngineService();
serviceInstance.COMMAND_DIRECTIVES = COMMAND_DIRECTIVES;

module.exports = serviceInstance;
module.exports.COMMAND_DIRECTIVES = COMMAND_DIRECTIVES;
