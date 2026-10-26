const { UI_GENERATION_SYSTEM_PROMPT } = require('./prompts/systemPrompt');
const logger = require('../../utils/logger');

class ContextBuilder {
  /**
   * Check if user request is an undo/rollback request
   */
  detectUndoIntent(prompt = '') {
    if (!prompt) return false;
    const p = prompt.trim().toLowerCase();
    return /^(undo|undo last|undo the last change|revert|revert last|revert the last change|go back|restore previous)\b/i.test(p);
  }

  /**
   * Builds the authoritative system prompt with continuous stateful generation directives
   */
  buildSystemPrompt(options = {}) {
    const { isModification = false } = options;

    if (!isModification) {
      return `${UI_GENERATION_SYSTEM_PROMPT}

CONTINUOUS STATEFUL GENERATION:
You are initiating a new project prototype. You establish the visual architecture, component hierarchy, design tokens, and functional foundation that will be iterated on in subsequent stateful turns.
STRICT COLOR USAGE: Do NOT automatically use blue, purple, indigo, violet, or blue-purple gradients in generated UI designs. The AI must use blue or purple ONLY when the user explicitly requests those colors or when the user's existing design system/brand configuration specifically defines them (Priority 1: User intent, Priority 2: Configured design system such as Primary Theme Palette in shades of blue and purple, Priority 3: Existing component styling, Priority 4: Default neutral design choices).
INTERACTIVE UI & RUNTIME SAFETY: Every interactive element (navbar links, dropdowns, buttons, tabs, sidebars, modals, forms, search controls, cards, tooltips, toggles, breadcrumbs, pagination) must be functional. All event handlers, functions, and state must exist, have defensive null/undefined checks, and never crash the application.`;
    }

    return `${UI_GENERATION_SYSTEM_PROMPT}

CONTINUOUS STATEFUL GENERATION & INCREMENTAL MODIFICATION RULES:
You are modifying an existing project in an active conversation.
1. DO NOT recreate or rewrite the application from scratch unless explicitly requested.
2. PRESERVE all existing layout, components, styling, functionality, imports, and design tokens unless the user specifically asks to alter them.
3. SURGICAL PRECISION: Answer: "What has already been created, what has the user changed in previous turns, and what EXACTLY is the user asking to modify now?"
4. When the user says "the header", "the button", "the sidebar", refer directly to the existing elements in the provided source code.
5. Keep existing Lucide icons, Tailwind styling, and React state logic intact while seamlessly integrating the new modification.
6. MINIMAL TARGETED UPDATES: For incremental edits, change only the smallest possible set of files and lines. Prefer outputting a SEARCH/REPLACE patch for the affected lines, or targeted file modifications. Preserve all unrelated files, components, and code.
7. STRICT COLOR USAGE: Do NOT introduce blue, purple, indigo, violet, or blue-purple gradients unless the user's prompt specifically requests them or the existing design system configuration defines them. Preserve existing user-defined colors.
8. INTERACTIVE UI & RUNTIME SAFETY: Verify that all modified or connected interactive elements have valid event handlers, safe state transitions, defensive null/undefined guards, and do not throw runtime exceptions.
9. THEME & COLOR CHANGES PRESERVE EXISTING APPLICATION: When the user asks to change colors, themes, accents, or background:
   - NEVER replace the website with a generic boilerplate, starter template, or different website.
   - If the current project is a Gaming website, it MUST remain the exact same Gaming website with all games, cards, hero, navigation, modals, and state intact.
   - Surgically change ONLY the color tokens and Tailwind color classes across existing components as requested by the user.
10. ADD CONTENT & SURGICAL MODIFICATION WITHOUT LOSING ANYTHING:
   - If the user prompt asks to ADD content, sections, or features (e.g., 'add research details', 'add courses', 'add achievements'): seamlessly integrate the requested additions into the existing application structure without removing or truncating existing sections.
   - If the user prompt asks to MODIFY or CHANGE something: change ONLY what was mentioned in the user prompt.
   - All other existing components, domain data, and interactive behaviors must remain untouched.`;
  }

  /**
   * Extracts and formats existing project files and components for model context
   */
  formatExistingProjectCode(project, { allowPartial = false, maxChars = 300000 } = {}) {
    if (!project || !Array.isArray(project.files) || project.files.length === 0) {
      return { rootCode: '', componentCode: '', summary: 'No existing code (initial generation).' };
    }

    // Images, fonts and other binary assets are base64 blobs, never model context; they are listed by name only.
    const isSource = (f) => f && typeof f.content === 'string' && f.content && f.encoding !== 'base64'
      && f.path !== 'package-lock.json' && f.path !== 'src/assets/asset-map.json';
    const rootFile = project.files.find(f => f.path === 'src/App.jsx' || f.path.endsWith('App.jsx'));
    const rootApp = isSource(rootFile) ? rootFile.content : '';
    const componentFiles = project.files.filter(f => f.path !== 'package-lock.json' && f.path !== 'src/App.jsx');
    const sourceComponents = componentFiles.filter(isSource);

    let included = sourceComponents;
    let omitted = [];
    const total = rootApp.length + sourceComponents.reduce((sum, f) => sum + f.content.length, 0);
    if (total > maxChars) {
      if (!allowPartial) throw new Error('Project exceeds the generation context limit. Source was not truncated or rewritten.');
      // Incremental edits patch only the files they target, so the context keeps the most useful files within budget
      // (small, structural files first) and lists the rest by name. Nothing in the project itself is shortened.
      const rank = (f) => (/(?:^|\/)(?:router|routes|navigation|siteData|data)\b|\.json$/i.test(f.path) ? 0 : /(?:Header|Navbar|Footer|Layout)/i.test(f.path) ? 1 : 2);
      const ordered = [...sourceComponents].sort((a, b) => rank(a) - rank(b) || a.content.length - b.content.length);
      let used = rootApp.length;
      included = [];
      for (const f of ordered) {
        if (used + f.content.length > maxChars) { omitted.push(f.path); continue; }
        included.push(f);
        used += f.content.length;
      }
    }

    let componentCode = '';
    for (const comp of included) componentCode += `\n// File: ${comp.path}\n${comp.content}\n`;
    if (omitted.length) componentCode += `\n// FILES NOT SHOWN (too large for the context; unchanged unless the request needs them): ${omitted.join(', ')}\n`;

    return {
      rootCode: rootApp,
      componentCode,
      summary: `Existing project contains ${project.files.length} files (Root: src/App.jsx, Components: ${componentFiles.filter((c) => c.encoding !== 'base64').map(c => c.path).join(', ') || 'None'})`
    };
  }

  /**
   * Formats generation history lineage to help model understand past changes
   */
  formatGenerationHistory(conversation) {
    if (!conversation || !Array.isArray(conversation.generations) || conversation.generations.length === 0) {
      return 'No prior generations.';
    }

    const recentGenerations = conversation.generations.slice(-5);
    return recentGenerations.map((gen, idx) => {
      const vNum = gen.versionNumber || (idx + 1);
      const summary = gen.changeSummary || gen.userPrompt || 'Generation';
      return `[Generation ${vNum} (${gen.generationId})]: "${gen.userPrompt}" -> ${summary}`;
    }).join('\n');
  }

  /**
   * Formats recent conversation turns (pruned to optimize token window)
   */
  formatRecentConversationTurns(conversation, maxTurns = 5) {
    if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) {
      return [];
    }

    const nonSystem = conversation.messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const recent = nonSystem.slice(-maxTurns);

    return recent.map(m => ({
      role: m.role,
      content: m.content || (m.changeSummary ? `Modified: ${m.changeSummary}` : '')
    }));
  }

  /**
   * Assemble full contextual request for Gemini or OpenRouter model
   */
  assembleContextualPrompt({
    project,
    conversation,
    userPrompt,
    designTokens = {},
    commandDirective = '',
    allowPartialContext = false
  }) {
    const isModification = !!(project && project.files && project.files.length > 0);
    const existingCode = this.formatExistingProjectCode(project, { allowPartial: allowPartialContext });
    const generationHistoryText = this.formatGenerationHistory(conversation);
    const recentTurns = this.formatRecentConversationTurns(conversation, 4);

    // Build rolling context summary if older history exists
    let olderSummaryBlock = '';
    if (conversation?.contextSummary) {
      olderSummaryBlock = `\nPRIOR DESIGN DECISIONS SUMMARY:\n${conversation.contextSummary}\n`;
    }

    const promptText = `
=== CURRENT USER REQUEST (TOP PRIORITY) ===
"${userPrompt}"
${commandDirective ? `\nCOMMAND DIRECTIVE:\n${commandDirective}\n` : ''}
=== EXISTING PROJECT STATE & GENERATED CODE ===
${existingCode.summary}

ACTIVE REACT SOURCE CODE (src/App.jsx):
\`\`\`jsx
${existingCode.rootCode || '// Empty project'}
\`\`\`
${existingCode.componentCode ? `\nADDITIONAL EXISTING COMPONENTS:\n\`\`\`jsx\n${existingCode.componentCode}\n\`\`\`` : ''}

=== RECENT GENERATION HISTORY & LINEAGE ===
${generationHistoryText}
${olderSummaryBlock}
=== DESIGN SYSTEM TOKENS ===
- Mood/Theme: ${designTokens.mood || 'Clean Neutral'}
- Primary Color: ${designTokens.primary || '#18181B'}
- Secondary Color: ${designTokens.secondary || '#71717A'}
- Background: ${designTokens.bg || '#F8F9FA'}
- Card Background: ${designTokens.cardBg || '#FFFFFF'}
- Text Color: ${designTokens.text || '#111827'}
- Border Radius: ${designTokens.radius || '14px'}
- Font Family: ${designTokens.font || 'Inter, sans-serif'}

=== INSTRUCTIONS FOR OUTPUT ===
Apply the requested changes to the ACTIVE SOURCE CODE.
Preserve existing state, structure, layout, styles, and components that are not affected by this instruction.
${isModification ? 'Return only the targeted minimal patch or modified files. Do not regenerate unaffected code.' : 'Return a modular multi-file React application. Keep src/App.jsx small and limited to providers, routing, shared layout composition, and top-level state. Put major pages in src/pages/ and logically independent UI in src/components/.'}
The generated app will be built with its real package.json, then tested in Chromium on desktop and mobile.
Use bundled/local assets and system fonts; no CDN script imports or remote font links. External APIs require explicit local mocks or integration configuration and cannot be claimed verified otherwise.
Use real working event handlers and preserve existing installed dependencies, configuration and design tokens.
`;

    const systemPrompt = this.buildSystemPrompt({ isModification });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentTurns,
      { role: 'user', content: promptText }
    ];

    return {
      systemPrompt,
      promptText,
      messages,
      isModification,
      parentGenerationId: conversation?.activeGenerationId || null
    };
  }

  /**
   * Generates a concise human-readable summary of what changed
   */
  extractChangeSummary(userPrompt = '', previousCode = '', newCode = '') {
    const p = userPrompt.trim();
    if (!previousCode) return `Initial creation: ${p.slice(0, 45)}`;

    if (/header|navbar|nav/i.test(p)) return `Updated header & navigation based on: "${p.slice(0, 35)}"`;
    if (/sidebar|drawer|aside/i.test(p)) return `Modified sidebar layout based on: "${p.slice(0, 35)}"`;
    if (/color|theme|dark|light|blue|red|green|purple/i.test(p)) return `Updated styling & color scheme: "${p.slice(0, 35)}"`;
    if (/button|cta|action/i.test(p)) return `Adjusted action buttons & triggers: "${p.slice(0, 35)}"`;
    if (/table|grid|card|list/i.test(p)) return `Refined data display components: "${p.slice(0, 35)}"`;
    if (/modal|dialog|popup/i.test(p)) return `Added/modified interactive modal: "${p.slice(0, 35)}"`;
    if (/chart|graph|analytic|stat/i.test(p)) return `Added/updated analytics visualization: "${p.slice(0, 35)}"`;

    return `Modified application: ${p.slice(0, 50)}`;
  }
}

module.exports = new ContextBuilder();
