const getUIGenerationPrompt = (description) => {
  return `Create a COMPLETE, production-ready React application based on the following product specification:
"${description}"

VEAVE IMPLEMENTATION REQUIREMENTS:
1. Architecture:
   - src/App.jsx (main entry point, registered to window.__modules['src/App.jsx'])
   - src/index.css (with Tailwind directives)
   - Modular, reusable components in src/components/
2. VEAVE Visual Standards:
   - Professional, calm, human-designed UI (avoid generic AI templates and glowing orbs/harsh gradients).
   - Clean 8px spacing system, restrained color palette, subtle borders.
   - Lucide icons for all interface iconography (no emoji or sparkle icons).
   - Realistic product copy (no "Lorem ipsum", no generic AI buzzwords).
   - STRICTLY NO EM DASHES ("—"). Use commas, periods, colons, parentheses, or hyphens.
   - Fully responsive on desktop, tablet, and mobile (convert sidebars to drawers/toggle on mobile).
   - Clear button and card hierarchies with consistent 8px-16px corner radius.
   - Strict Image, Text & Content Consistency: For repeated components (feature, product, game, blog, course, team, portfolio, project cards), all cards in the same group MUST follow the exact same structure (choose ONE: Pattern A: Image Above Text, Pattern B: Background with Overlay, or Pattern C: Side-by-Side). Use uniform aspect ratios (16:9, 4:3, 1:1, 4:5), object-cover, equal image container heights, and uniform card heights. Enforce strict text hierarchy (Category -> Title -> Description -> Metadata). Prevent text overflow (line-clamp, word-break). Contain overlays inside image container. Meaningful descriptive alt text for all images.
3. Runtime:
   - Use window.__modules registry for inter-component imports.
   - Use standard React JSX only (no TypeScript syntax or interfaces).
   - Return valid JSON matching the action schema.`;
};

module.exports = { getUIGenerationPrompt };
