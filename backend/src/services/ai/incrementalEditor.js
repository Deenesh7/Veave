const path = require('path').posix;
const { createHash } = require('crypto');
const { MIME_TYPES } = require('../clone/assetLocalizationService');
const generationPipeline = require('./generationPipeline');
const structuralContext = require('./structuralContext');

/**
 * Change Intent Categories
 */
const INTENT = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  ADD: 'ADD',
  REMOVE: 'REMOVE',
  REPLACE: 'REPLACE',
  FIX: 'FIX'
};

function normalizePrompt(prompt = '') {
  return String(prompt)
    .replace(/\bcange\b/gi, 'change')
    .replace(/\btheword\b/gi, 'the word')
    .replace(/\bmulri[ -]?page\b/gi, 'multi-page');
}

function normalizeComparableText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractTextReplacementIntent(prompt = '') {
  const request = normalizePrompt(prompt).trim();
  const match = request.match(/\b(?:change|replace|update|make)\s+(?:the\s+)?["'`]?(.+?)["'`]?\s+(?:text|wording|copy|content|label)\s+(?:to|like|with)\s+["'`]?(.+?)["'`]?\s*[.!?]*$/i) ||
    request.match(/\b(?:change|replace|update|make)\s+(?:the\s+)?(?:word|text|wording|copy|content|label)\s+["'`]?(.+?)["'`]?\s+(?:to|like|with)\s+["'`]?(.+?)(?:\s+(?:text|wording|copy|content|label))?["'`]?\s*[.!?]*$/i);
  if (!match) return null;

  const source = match[1].trim();
  const replacement = match[2].trim();
  if (!source || !replacement || /^(?:this|that|selected|the)$/i.test(source) ||
      /\b(?:text|wording|copy|content|label|please)\b/i.test(source)) return null;
  return { source, replacement };
}

function buildTextOutcomeVerification(prompt = '') {
  const intent = extractTextReplacementIntent(prompt);
  if (!intent) return null;
  return {
    selector: 'body',
    targetText: intent.replacement,
    expectedText: intent.replacement
  };
}

// "Change X to Y" / "add the text 'Y'": the rendered page must show Y afterwards (checked by the incremental validation).
function buildTextOutcomeExpectation(prompt = '', route = null) {
  const intent = extractTextReplacementIntent(prompt);
  const added = String(prompt).match(/\b(?:add|insert|include|put|write)\b[^"'\u201c]{0,40}["'\u201c]([^"'\u201d]{3,200})["'\u201d]/i);
  const text = intent?.replacement || added?.[1] || null;
  if (!text) return null;
  return { route: route || null, texts: [text.replace(/^["'`]|["'`]$/g, '')], assetPaths: [], requireAsset: false };
}

function extractRequestedColor(prompt = '') {
  const request = normalizePrompt(prompt).trim();
  if (!request) return null;

  const exactValue = [...request.matchAll(/(?:#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\([^)]*\))/gi)].at(-1)?.[0];
  const destinationParts = request.split(/\b(?:to|into|with|as)\b/i);
  let description = (destinationParts.length > 1 ? destinationParts.at(-1) : '') ||
    request.match(/\bmake\s+(?:this|that|it|the\s+(?:selected\s+)?(?:word|text|element|background))\s+(.+?)\s*$/i)?.[1] || '';
  description = description
    .replace(/^\s*an?\s+/i, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+(?:colou?r|shade)\s*$/i, '')
    .replace(/\s+only\s*$/i, '')
    .trim();
  const value = exactValue || description;
  if (!value) return null;

  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(/i.test(value)) {
    return { description: value, css: value, className: `text-[${value.replace(/\s+/g, '_')}]`, verifiableCss: value };
  }
  if (/^[a-z][a-z0-9]*-\d{2,3}$/i.test(value)) {
    return { description: value, className: `text-${value}` };
  }
  // Names and natural descriptions are semantic input. Let the model resolve them to a
  // concrete CSS value instead of assuming every word is a valid CSS color keyword.
  return { description: value };
}

function extractSourceColor(prompt = '') {
  const request = normalizePrompt(prompt).trim();
  const replacementParts = request.split(/\b(?:to|into)\b/i);
  const source = replacementParts.length > 2
    ? replacementParts.at(-2)
    : request.match(/\bfrom\s+(.+?)\s+to\b/i)?.[1] ||
      request.match(/\b(?:change|replace|switch)\s+(?:the\s+)?(.+?)\s+to\b/i)?.[1] || '';
  const cleaned = source
    .replace(/^\s*(?:change|replace|switch)\s+(?:the\s+)?/i, '')
    .replace(/^(?:all|every|this|that|selected)\s+/i, '')
    .replace(/\s+(?:colou?r|shade|theme|palette)\s*$/i, '')
    .trim();
  if (/\b(?:word|text|heading|title|button|navbar|header|footer|card|section|hero|badge|link|icon|element|component|page|modal)\b/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function hasVisualColorUsage(file, sourceColor) {
  const normalized = normalizeFile(file);
  if (!normalized || !sourceColor || !/\.(?:jsx?|tsx?|css|scss|json)$/i.test(normalized.path)) return false;

  const escaped = sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_\\s]+');
  const utilityClass = new RegExp('(?:text|bg|border|fill|stroke|from|via|to)-[^\\s"\'`]*' + escaped, 'i');
  if (utilityClass.test(normalized.content)) return true;

  if (/\.(?:jsx?|tsx?)$/i.test(normalized.path)) {
    const styleValue = new RegExp(`(?:color|background(?:Color)?|borderColor|fill|stroke|primary|secondary|accent)\\s*[:=]\\s*[^,;\\n}]*${escaped}`, 'i');
    return styleValue.test(normalized.content);
  }
  if (/\.(?:css|scss)$/i.test(normalized.path)) {
    const declaration = new RegExp(`(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|--[\\w-]*(?:color|primary|secondary|accent|theme)[\\w-]*)\\s*:\\s*[^;\\n}]*${escaped}`, 'i');
    return declaration.test(normalized.content);
  }
  return /(?:tokens?|theme|palette|tailwind\.config)/i.test(normalized.path) && new RegExp(escaped, 'i').test(normalized.content);
}

function isProjectWideColorReplacement(prompt = '', files = []) {
  const request = normalizePrompt(prompt).toLowerCase();
  const sourceColor = extractSourceColor(request);
  if (!sourceColor || !extractRequestedColor(request)) return false;
  if (/\b(?:all|every|entire|whole|global|sitewide|throughout|theme|palette)\b/.test(request)) return true;
  if (/\b(?:this|that|selected|specific|word|heading|title|button|navbar|header|footer|card|section|hero|badge|link|icon|element|component|page|modal)\b/.test(request)) return false;
  return Array.isArray(files) && files.some((file) => hasVisualColorUsage(file, sourceColor));
}

/**
 * Classify user intent based on request phrasing
 */
function classifyIntent(prompt = '') {
  const p = normalizePrompt(prompt).trim().toLowerCase();
  if (!p) return INTENT.UPDATE;

  if (/^(create|build|generate|make a new|start|initiate|scaffold)\b/i.test(p) && /(website|app|application|page|project|prototype)\b/i.test(p)) {
    return INTENT.CREATE;
  }
  if (/^(remove|delete|drop|strip|get rid of|hide)\b/i.test(p)) {
    return INTENT.REMOVE;
  }
  if (/^(replace|swap|substitute|switch out)\b/i.test(p)) {
    return INTENT.REPLACE;
  }
  if (/^(fix|resolve|correct|repair|debug|troubleshoot|broken|not working|crash|error)\b/i.test(p)) {
    return INTENT.FIX;
  }
  if (/^(add|insert|include|introduce|attach|append|provide)\b/i.test(p)) {
    return INTENT.ADD;
  }
  return INTENT.UPDATE;
}

function isPageCreationRequest(prompt = '') {
  const request = normalizePrompt(prompt);
  return /\b(?:add|create|build|generate|make)\b[\s\S]{0,80}\b(?:new\s+)?(?:page|route|screen|view)\b/i.test(request) ||
    /\b(?:own|separate|multi-page|multipage)\s+(?:page|route|screen|view)\b/i.test(request);
}

function isElementScopedRequest(prompt = '') {
  const text = normalizePrompt(prompt).toLowerCase();
  if (/\b(?:all|every|entire|whole|global|sitewide|throughout|design system|theme|redesign|rebuild)\b/.test(text)) return false;
  const property = /\b(?:font|typeface|bold|weight|italic|colou?r|background|border|radius|rounded|size|larger|smaller|width|height|spacing|padding|margin|position|align|opacity|text|content|wording)\b/.test(text) || /#[0-9a-f]{3,8}\b/i.test(text);
  const target = /\b(?:this|that|single|specific|selected|word|text|label|heading|title|button|card|image|icon|element|component|paragraph|link|badge|input|navbar|header|footer|section)\b/.test(text);
  return property && target;
}

function buildSelectedElementPatch(prompt = '', selectedElement = null, files = []) {
  const normalizedPrompt = normalizePrompt(prompt);
  const request = normalizedPrompt.toLowerCase();
  if (!/\b(?:text|font|word|label|heading|title|colou?r)\b/.test(request)) return null;

  const requestedColor = extractRequestedColor(prompt);
  const hasExplicitColorIntent = /\bcolou?r\b/i.test(prompt) ||
    Boolean(requestedColor?.description && /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(|[a-z][a-z0-9]*-\d{2,3}$)/i.test(requestedColor.description));
  if (!hasExplicitColorIntent) return null;
  const colorClass = requestedColor?.className || null;
  if (!colorClass) return null;

  const normalizedFiles = files.map(normalizeFile).filter((file) => file && /\.(?:jsx?|tsx?)$/i.test(file.path));
  const selectedText = typeof selectedElement?.text === 'string' ? selectedElement.text.trim() : '';
  const explicitWord = normalizedPrompt.match(/(?:change|make|turn)\s*the\s+["'`]?([\p{L}\p{N}_'-]+)["'`]?\s+word\b/iu)?.[1] ||
    normalizedPrompt.match(/\bword\s+["'`]?([\p{L}\p{N}_'-]+)["'`]?/iu)?.[1] || '';
  let targetText = explicitWord || selectedText;
  if (explicitWord && selectedText) {
    const selectedIndex = selectedText.toLowerCase().indexOf(explicitWord.toLowerCase());
    if (selectedIndex >= 0) targetText = selectedText.slice(selectedIndex, selectedIndex + explicitWord.length);
  }
  if (!targetText) return null;

  const escapedTarget = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetPattern = new RegExp(`\\b${escapedTarget}\\b`, 'gi');

  let candidates = selectedElement?.sourceFile
    ? normalizedFiles.filter((file) => file.path === selectedElement.sourceFile)
    : normalizedFiles.filter((file) => {
        targetPattern.lastIndex = 0;
        return targetPattern.test(file.content);
      });
  if (!candidates.length && selectedElement?.sourceComponent) {
    const componentName = String(selectedElement.sourceComponent).replace(/[<>/]/g, '');
    candidates = normalizedFiles.filter((file) => path.basename(file.path, path.extname(file.path)) === componentName);
  }
  if (candidates.length !== 1) return null;

  const file = candidates[0];
  const textMatches = [];
  targetPattern.lastIndex = 0;
  let textMatch;
  while ((textMatch = targetPattern.exec(file.content)) !== null) textMatches.push(textMatch.index);
  if (textMatches.length !== 1) return null;

  const textIndex = textMatches[0];
  targetText = file.content.slice(textIndex, textIndex + targetText.length);
  const prefix = file.content.slice(Math.max(0, textIndex - 4000), textIndex);
  const openingMatch = prefix.match(/<([A-Za-z][\w.]*)\b[^<>]*>\s*$/);
  if (!openingMatch) return null;
  const openingWithSpacing = openingMatch[0];
  const openingTag = openingWithSpacing.replace(/\s*$/, '');
  let replacementTag;
  const classMatch = openingTag.match(/className\s*=\s*(["'])([^"']*)\1/);
  if (classMatch) {
    const isTextSize = (name) => /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[\d)/.test(name);
    const classes = classMatch[2].split(/\s+/).filter(Boolean).filter((name) => {
      if (name === 'text-transparent' || name === 'bg-clip-text' || /^bg-gradient-/.test(name)) return false;
      if (/^(?:from|via|to)-/.test(name)) return false;
      if (/^text-/.test(name) && !isTextSize(name)) return false;
      return true;
    });
    classes.push(colorClass);
    replacementTag = openingTag.replace(classMatch[0], `className=${classMatch[1]}${[...new Set(classes)].join(' ')}${classMatch[1]}`);
  } else {
    replacementTag = openingTag.replace(/>$/, ` className="${colorClass}">`);
  }

  const cssColorName = requestedColor?.css;
  const inlineColorPattern = /(style\s*=\s*\{\{[\s\S]*?\bcolor\s*:\s*)(["'])([^"']*)(\2)/i;
  const hadInlineColor = inlineColorPattern.test(replacementTag);
  if (hadInlineColor && cssColorName) {
    replacementTag = replacementTag.replace(inlineColorPattern, `$1'${cssColorName}'`);
  }

  const closesImmediately = new RegExp(`^\\s*</${openingMatch[1]}\\s*>`, 'i')
    .test(file.content.slice(textIndex + targetText.length));
  const targetSearch = closesImmediately ? openingWithSpacing + targetText : targetText;
  const targetReplace = closesImmediately
    ? openingWithSpacing.replace(openingTag, replacementTag) + targetText
    : `<span className="${colorClass}">${targetText}</span>`;
  const result = {
    action: 'update',
    reason: 'Deterministic patch for the selected element',
    targetVerification: requestedColor?.verifiableCss ? {
      selector: closesImmediately ? openingMatch[1].toLowerCase() : 'span',
      targetText,
      property: 'color',
      cssValue: requestedColor.verifiableCss
    } : null,
    files: [{
      path: file.path,
      operation: 'patch',
      search: targetSearch,
      replace: targetReplace
    }]
  };

  return result;
}

function buildSelectedTextPatch(prompt = '', selectedElement = null, files = []) {
  if (!selectedElement?.text) return null;
  const request = String(prompt).trim();
  if (!/\b(?:change|cange|replace|update|make)\b/i.test(request) ||
      !/\b(?:text|wording|copy|content|label)\b[\s\S]{0,30}\b(?:to|like|with)\b/i.test(request)) return null;
  if (/\b(?:colou?r|font|bold|italic|size)\b/i.test(request)) return null;

  const replacementText = request.match(/\b(?:to|like|with)\s+["'`]?(.+?)["'`]?\s*$/i)?.[1]?.trim();
  if (!replacementText) return null;

  const currentText = String(selectedElement.text).trim();
  if (!currentText || currentText === replacementText) return null;
  const normalizedFiles = files.map(normalizeFile).filter((file) => file && /\.(?:jsx?|tsx?)$/i.test(file.path));
  let candidates = selectedElement.sourceFile
    ? normalizedFiles.filter((file) => file.path === selectedElement.sourceFile)
    : normalizedFiles.filter((file) => file.content.includes(currentText));
  if (!candidates.length && selectedElement.sourceComponent) {
    const componentName = String(selectedElement.sourceComponent).replace(/[<>/]/g, '');
    candidates = normalizedFiles.filter((file) => path.basename(file.path, path.extname(file.path)) === componentName);
  }
  if (candidates.length !== 1) return null;

  const file = candidates[0];
  if (file.content.split(currentText).length - 1 !== 1) return null;
  return {
    action: 'update',
    reason: 'Deterministic text patch for the selected element',
    targetVerification: {
      selector: String(selectedElement.tagName || '*').toLowerCase(),
      targetText: replacementText,
      expectedText: replacementText
    },
    files: [{
      path: file.path,
      operation: 'patch',
      search: currentText,
      replace: replacementText
    }]
  };
}

function buildColorCascadeCleanupOperations(prompt = '', files = []) {
  if (!extractRequestedColor(prompt) || !/\b(?:colou?r|text|word|heading|title)\b/i.test(String(prompt))) return [];
  const operations = [];
  for (const file of files.map(normalizeFile).filter((item) => item && /\.css$/i.test(item.path))) {
    const broadRule = /((?:^|(?<=\}))\s*(?:\*|html\s*,\s*body|body)[^{]*\{[^}]*?color\s*:\s*[^;!}]+?\s*)!important([^}]*\})/gim;
    let match;
    while ((match = broadRule.exec(file.content)) !== null) {
      operations.push({
        path: file.path,
        operation: 'patch',
        search: match[0],
        replace: match[1] + match[2],
        reason: 'Remove broad color !important so the selected element can override the global default'
      });
    }
  }
  return operations;
}

function buildTargetStyleVerification(prompt = '', selectedElement = null) {
  if (!selectedElement?.text || !selectedElement?.tagName) return null;
  const request = String(prompt).toLowerCase();
  const color = extractRequestedColor(request);
  if (!color?.verifiableCss) return null;
  return {
    selector: String(selectedElement.tagName).toLowerCase(),
    targetText: String(selectedElement.text).trim(),
    property: 'color',
    cssValue: color.verifiableCss
  };
}

/**
 * A part taken from the real website (colour, font, text, image, logo) may need a small CSS rule (@font-face), a new
 * asset file and the one patch that uses it. Everything still has to stay surgical: existing files may only be patched,
 * each patch must be small, and global style files may only gain font/variable rules.
 */
function validateSourceFocusedOperations(operations = [], existingFiles = []) {
  const existing = new Map(existingFiles.map(normalizeFile).filter(Boolean).map((file) => [file.path, file]));
  if (!Array.isArray(operations) || !operations.length) throw new Error('Strict scope violation: the edit contains no operations.');
  for (const operation of operations) {
    const type = String(operation?.operation || operation?.type || '').toLowerCase();
    const isPatch = type === 'patch' || type === 'patch_file';
    if (!existing.has(operation.path)) continue; // a new file (component, asset) is allowed
    if (!isPatch) throw new Error(`Strict scope violation: existing file "${operation.path}" must be changed with a small patch, not ${type || 'rewritten'}.`);
    if (typeof operation.search !== 'string' || !operation.search.trim() || typeof operation.replace !== 'string') throw new Error('Strict scope violation: the operation must contain exact search and replacement text.');
    if (operation.search.length > 4000 || operation.replace.length > 6000) throw new Error('Strict scope violation: patch is broader than the mentioned part. Use a smaller exact search block.');
    if (/(?:^|\/)(?:index\.(?:css|scss|sass|less)|tokens?\.json|tailwind\.config\.[^/]+)$/i.test(operation.path) && !/@font-face|font-family|--[\w-]*font/i.test(operation.replace)) {
      throw new Error(`Strict scope violation: global style file "${operation.path}" may only gain the real site's font rules for this edit.`);
    }
  }
}


const IMAGE_FILE = /\.(?:png|jpe?g|webp|gif|svg|avif|ico)(?:[?#]|$)/i;

/**
 * An edit made from the real website may only use what the real page shows. Every image reference the edit ADDS must be
 * one of the real page's image tokens; an existing project image picked by its file name, an icon-library glyph or an
 * SVG that is not in the real markup is invention and is rejected, so the model must retry from the real data.
 */
function validateSourceFidelity(operations = [], facts = null) {
  if (!facts) return;
  const tokens = new Set(facts.tokens || []);
  const markup = String(facts.markup || '');
  for (const operation of operations) {
    const added = String(operation.replace ?? operation.content ?? '');
    const removed = String(operation.search ?? '');
    if (!added || /\.(?:png|jpe?g|webp|gif|avif|ico|woff2?|ttf|otf)$/i.test(operation.path || '')) continue;
    const isNew = (value) => !removed.includes(value);
    for (const match of added.matchAll(/(?:\bsrc|\bsrcSet|\bposter|\bhref)\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]|url\(\s*["']?([^"')]+)["']?\s*\)|import\s+[\w{}\s,*]+\s+from\s+["']([^"']+)["']/g)) {
      const value = (match[1] || match[2] || match[3] || '').trim();
      if (!value || !IMAGE_FILE.test(value) && !/__VEAVE_CLONE_ASSET_\d+__/.test(value)) continue;
      if (/^data:/i.test(value) || !isNew(value)) continue;
      const token = value.match(/__VEAVE_CLONE_ASSET_\d+__/)?.[0];
      if (token && tokens.has(token)) continue;
      throw new Error(`Fidelity violation: "${value.slice(0, 120)}" is not an image of the real page. Use only the image tokens listed under REAL PAGE IMAGES; never pick another project image by its file name.`);
    }
    if (facts.identity) {
      const lucide = added.match(/import\s*\{[^}]*\}\s*from\s*["']lucide-react["']/);
      if (lucide && isNew(lucide[0])) throw new Error('Fidelity violation: an icon-library glyph cannot stand in for the real logo/image. Use the real page image token or its exact inline SVG.');
    }
    for (const svg of added.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
      if (!isNew(svg[0].slice(0, 120))) continue;
      const signature = (svg[0].match(/\sd\s*=\s*["']([^"']{20,})["']/) || [])[1];
      if (!signature || !markup.includes(signature.slice(0, 40))) throw new Error('Fidelity violation: the inline SVG is not in the real page markup. Paste the exact SVG from the real page or use an image token; never draw an approximation.');
    }
  }
}

function validateStrictScopeOperations(prompt = '', operations = [], existingFiles = [], selectedElement = null, options = {}) {
  if (options.sourceFocused) { validateSourceFocusedOperations(operations, existingFiles); return validateSourceFidelity(operations, options.sourceFacts); }
  if (!isElementScopedRequest(prompt)) return;
  if (!Array.isArray(operations) || operations.length !== 1) {
    throw new Error('Strict scope violation: a single-element request must produce exactly one surgical patch.');
  }

  const operation = operations[0];
  const type = String(operation?.operation || operation?.type || '').toLowerCase();
  if (type !== 'patch' && type !== 'patch_file') {
    throw new Error('Strict scope violation: full-file create, modify, delete, or rename operations are forbidden for a single-element change.');
  }

  const existingPaths = new Set(existingFiles.map(normalizeFile).filter(Boolean).map((file) => file.path));
  if (!existingPaths.has(operation.path)) {
    throw new Error(`Strict scope violation: patch target "${operation.path}" is not an existing project file.`);
  }
  // sourceFile is a frontend guess; only enforce it when the guessed file really contains the patched text.
  const guessedFile = selectedElement?.sourceFile
    ? existingFiles.map(normalizeFile).filter(Boolean).find((file) => file.path === selectedElement.sourceFile)
    : null;
  const guessHoldsText = guessedFile && typeof operation.search === 'string' && guessedFile.content.includes(operation.search);
  if (guessHoldsText && operation.path !== selectedElement.sourceFile) {
    throw new Error(`Strict scope violation: selected element belongs to "${selectedElement.sourceFile}", not "${operation.path}".`);
  }
  if (/(?:^|\/)(?:index\.(?:css|scss|sass|less)|tokens?\.json|tailwind\.config\.[^/]+)$/i.test(operation.path)) {
    throw new Error(`Strict scope violation: global style file "${operation.path}" cannot be changed for a single-element request.`);
  }
  if (typeof operation.search !== 'string' || !operation.search.trim() || typeof operation.replace !== 'string') {
    throw new Error('Strict scope violation: the operation must contain exact search and replacement text.');
  }
  const selectedText = typeof selectedElement?.text === 'string' ? selectedElement.text.trim() : '';
  const plainSearch = operation.search.replace(/<[^>]+>/g, '').trim();
  if (selectedText && /\b(?:this|selected|specific)\b/i.test(prompt) &&
      !operation.search.includes(selectedText) && !selectedText.includes(plainSearch)) {
    throw new Error('Strict scope violation: patch search does not contain the selected element text.');
  }
  if (operation.search.length > 2500 || operation.replace.length > 2500) {
    throw new Error('Strict scope violation: patch is broader than the targeted element. Use a smaller exact search block.');
  }

  const extractClasses = (source) => {
    const classes = new Set();
    for (const match of source.matchAll(/className\s*=\s*["']([^"']*)["']/g)) {
      match[1].split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    }
    return classes;
  };
  const beforeClasses = extractClasses(operation.search);
  const afterClasses = extractClasses(operation.replace);
  const changedClasses = [...beforeClasses, ...afterClasses].filter((name) => beforeClasses.has(name) !== afterClasses.has(name));
  const requested = String(prompt).toLowerCase();
  const requestedColor = extractRequestedColor(prompt);
  const allows = {
    background: /\bbackground\b/.test(requested) || (Boolean(requestedColor) && operation.search.includes('text-transparent')),
    color: /\bcolou?r\b/.test(requested) || Boolean(requestedColor),
    typography: /\b(?:font|typeface|bold|weight|italic|typography|tracking|line height)\b/.test(requested),
    size: /\b(?:size|width|height)\b/.test(requested),
    spacing: /\b(?:spacing|padding|margin|gap)\b/.test(requested),
    border: /\b(?:border|radius|rounded)\b/.test(requested),
    position: /\b(?:position|align|layout)\b/.test(requested),
    opacity: /\bopacity\b/.test(requested)
  };
  const categoryForClass = (name) => {
    if (/^bg-/.test(name)) return 'background';
    if (/^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[(?:\d|calc\(|clamp\(|min\(|max\())/.test(name)) return 'size';
    if (/^text-/.test(name)) return 'color';
    if (/^(?:font-|italic$|not-italic$|tracking-|leading-)/.test(name)) return 'typography';
    if (/^(?:p[trblxy]?|m[trblxy]?|gap|space-[xy])-/.test(name)) return 'spacing';
    if (/^(?:w-|h-|min-w-|min-h-|max-w-|max-h-)/.test(name)) return 'size';
    if (/^(?:border|rounded)/.test(name)) return 'border';
    if (/^(?:absolute|relative|fixed|sticky|static|flex|grid|block|inline|items-|justify-|self-|place-|top-|right-|bottom-|left-|inset-)/.test(name)) return 'position';
    if (/^opacity-/.test(name)) return 'opacity';
    return null;
  };
  const unrelatedClass = changedClasses.find((name) => {
    const category = categoryForClass(name);
    return category && !allows[category];
  });
  if (unrelatedClass) {
    throw new Error(`Strict scope violation: unrelated style class "${unrelatedClass}" changes a property the user did not request.`);
  }
}

function validateRequestedOutcome(prompt = '', operations = [], existingFiles = []) {
  const request = String(prompt).toLowerCase();
  const textIntent = extractTextReplacementIntent(prompt);
  if (textIntent) {
    const searched = normalizeComparableText(operations.map((operation) => operation.search || '').join('\n'));
    const changed = normalizeComparableText(operations.map((operation) => operation.replace || operation.content || '').join('\n'));
    const sourceTokens = normalizeComparableText(textIntent.source).split(' ').filter(Boolean);
    const hasSourceTarget = sourceTokens.every((token) => searched.split(' ').includes(token));
    const hasReplacement = changed.includes(normalizeComparableText(textIntent.replacement));
    if (!hasSourceTarget || !hasReplacement) {
      throw new Error(`Requested text outcome not verified: the patch must replace "${textIntent.source}" with "${textIntent.replacement}" in the owning component.`);
    }
    return;
  }

  const requestedColor = extractRequestedColor(prompt);
  if (!requestedColor || !/\b(?:text|font|word|heading|title|color|global|all|theme|palette)\b/.test(request)) return;

  if (/\b(?:global|all|entire|whole|sitewide|throughout)\b/.test(request)) {
    if (operations.some((operation) => /color\s*:[^;}]+!important/i.test(operation.replace || operation.content || ''))) {
      throw new Error('Requested outcome not verified: broad !important color rules are forbidden because they prevent later targeted text-color edits.');
    }
    return;
  }

  const replacement = operations.map((operation) => operation.replace || operation.content || '').join('\n');
  const expectedValue = requestedColor.css || requestedColor.description;
  const exactDestination = requestedColor.className || requestedColor.css;
  const hasColorMutation = /(?:\b(?:text|bg|border|fill|stroke)-(?!(?:xs|sm|base|lg|xl|[2-9]xl)\b)[^\s"']+|(?:^|[;{\s])(?:color|background(?:-color)?|border-color|fill|stroke)\s*:|--[\w-]*(?:color|primary|secondary|accent|theme)[\w-]*\s*:)/i.test(replacement);
  let hasExpected = exactDestination
    ? replacement.toLowerCase().includes(String(requestedColor.css || requestedColor.className).toLowerCase()) ||
      replacement.toLowerCase().includes(String(requestedColor.className || '').toLowerCase())
    : hasColorMutation;
  const sourceColor = extractSourceColor(prompt);
  if (!exactDestination && sourceColor) {
    const escapedSource = sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_\\s]+');
    const reappliesSource = new RegExp(`(?:\\b${escapedSource}\\b|(?:text|bg|border|fill|stroke)-[^\\s"']*${escapedSource})`, 'i').test(replacement);
    const concreteValues = replacement.match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\([^)]*\)|(?:text|bg|border|fill|stroke)-[^\s"']+/gi) || [];
    const hasDifferentValue = concreteValues.some((value) => !new RegExp(escapedSource, 'i').test(value));
    if (reappliesSource && !hasDifferentValue) hasExpected = false;
  }
  const broadImportantExists = existingFiles.some((file) => /\.css$/i.test(file.path || '') && /(?:\*|body)[^{]*\{[^}]*color\s*:[^;}]+!important/i.test(file.content || ''));
  const removesBroadImportant = operations.some((operation) => /\.css$/i.test(operation.path || '') && /color\s*:[^;}]+!important/i.test(operation.search || '') && !/color\s*:[^;}]+!important/i.test(operation.replace || ''));
  if (!hasExpected || (broadImportantExists && !removesBroadImportant)) {
    throw new Error(`Requested outcome not verified: the targeted replacement must apply "${expectedValue}", include a concrete color declaration or class, remove conflicting target colors, and clear any broad !important color override.`);
  }
}

function validateImageOperations(prompt = '', operations = []) {
  const request = normalizePrompt(prompt);
  const isImageRequest = /\b(?:add|insert|include|replace|swap)\b[\s\S]{0,50}\b(?:image|photo|picture|logo|avatar|thumbnail)\b/i.test(request) ||
    /\b(?:image|photo|picture|logo|avatar|thumbnail)\b[\s\S]{0,50}\b(?:add|insert|include|replace|swap)\b/i.test(request) ||
    /\b(?:change|update)\b[\s\S]{0,30}\b(?:image|photo|picture|logo|avatar|thumbnail)\b[\s\S]{0,30}\b(?:src|source|url)\b/i.test(request);
  if (!isImageRequest) return;

  const changed = operations.map((operation) => operation?.replace || operation?.content || '').join('\n');
  const imageEvidence = /(?:<img\b|\bsrc(?:Set)?\s*=|background(?:Image|-image)\s*[:=]|\burl\s*\(|data:image\/|https?:\/\/[^\s"']+|\.(?:png|jpe?g|webp|gif|svg|avif)\b)/i;
  if (!imageEvidence.test(changed)) {
    throw new Error('Requested image outcome not verified: the change must add or replace an image source in the rendered project.');
  }
  for (const operation of operations) {
    const replacement = operation?.replace || operation?.content || '';
    for (const imageTag of replacement.match(/<img\b[^>]*>/gi) || []) {
      if (!/\balt\s*=/.test(imageTag)) {
        throw new Error('Requested image outcome not verified: every added image must include meaningful alt text.');
      }
    }
  }
}

function validateColorReplacementCoverage(prompt = '', operations = [], existingFiles = []) {
  if (!isProjectWideColorReplacement(prompt, existingFiles)) return;
  const sourceColor = extractSourceColor(prompt);
  const sourcePattern = new RegExp(sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_\\s]+'), 'i');
  const sourceFiles = existingFiles
    .map(normalizeFile)
    .filter((file) => file && sourcePattern.test(file.content) && hasVisualColorUsage(file, sourceColor));
  const changedPaths = new Set(operations.map((operation) => operation?.path).filter(Boolean));
  const missing = sourceFiles.filter((file) => !changedPaths.has(file.path)).map((file) => file.path);
  if (missing.length) {
    throw new Error(`Project-wide color replacement is incomplete. These files still contain ${sourceColor}: ${missing.join(', ')}.`);
  }
}

const MAX_UPLOADED_IMAGES = 4;
const MAX_UPLOADED_IMAGE_BYTES = 6 * 1024 * 1024;

function uploadedImageSlug(name = '') {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'image';
}

/**
 * Valid images the user attached to this edit. Each one becomes a real project asset
 * (public/assets/uploads/<name>-<hash>.<ext>, referenced as /assets/uploads/...), never base64 pasted into source code.
 */
function getUploadedImageAssets(uploadedFiles = []) {
  const assets = [];
  const seen = new Set();
  for (const file of Array.isArray(uploadedFiles) ? uploadedFiles : []) {
    if (assets.length >= MAX_UPLOADED_IMAGES) break;
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(file?.dataUrl || ''));
    if (!file?.isImage || !match) continue;
    const mime = match[1].toLowerCase();
    const type = MIME_TYPES[mime];
    if (!type || !String(type.extension).match(/^(?:png|jpg|webp|gif|svg|avif|ico)$/)) continue;
    const body = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!body.length || body.length > MAX_UPLOADED_IMAGE_BYTES || !type.signature(body)) continue;
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
    if (seen.has(hash)) continue;
    seen.add(hash);
    const filePath = `public/assets/uploads/${uploadedImageSlug(file.name)}-${hash}.${type.extension}`;
    assets.push({
      token: `__VEAVE_UPLOADED_IMAGE_${assets.length}__`,
      name: String(file.name || `image-${assets.length + 1}`),
      type: mime,
      bytes: body.length,
      filePath,
      publicPath: `/${filePath.slice('public/'.length)}`,
      base64: body.toString('base64')
    });
  }
  return assets;
}

function compactEmbeddedImageAssets(files = []) {
  const valueToToken = new Map();
  const assets = [];
  const capturedView = require('../clone/capturedHtmlView');
  const compactedFiles = files.map(normalizeFile).filter(Boolean).map((file) => ({
    ...file,
    // Pages rebuilt from a captured website are shown to the model as readable markup (see capturedHtmlView), not as one escaped line.
    content: capturedView.viewOf(file.content).replace(/data:image\/(?:png|jpe?g|webp|gif|svg\+xml|avif);base64,[a-z0-9+/=]+/gi, (dataUrl) => {
      let token = valueToToken.get(dataUrl);
      if (!token) {
        token = `__VEAVE_EXISTING_IMAGE_${assets.length}__`;
        valueToToken.set(dataUrl, token);
        assets.push({ token, dataUrl });
      }
      return token;
    })
  }));
  return { files: compactedFiles, assets };
}

function compactAssetReferences(value, assets = []) {
  if (value == null || !assets.length) return value;
  let serialized = JSON.stringify(value);
  for (const asset of assets) serialized = serialized.split(asset.dataUrl).join(asset.token);
  return JSON.parse(serialized);
}

function hydrateUploadedImageOperations(operations = [], uploadedFiles = [], existingAssets = []) {
  const uploaded = getUploadedImageAssets(uploadedFiles);
  if (!uploaded.length && !existingAssets.length) return operations;
  const fields = ['search', 'replace', 'content'];
  const usesUploaded = operations.some((operation) => fields.some((field) => typeof operation?.[field] === 'string' && uploaded.some((asset) => operation[field].includes(asset.token))));
  if (uploaded.length && !usesUploaded) {
    throw new Error(`The attached image was not placed in the project. Use the exact token ${uploaded.map((asset) => asset.token).join(' or ')} as the image src (or CSS url()) in the requested place.`);
  }
  return operations.map((operation) => {
    const hydrated = { ...operation };
    for (const field of fields) {
      if (typeof hydrated[field] !== 'string') continue;
      // Uploaded images become a normal public asset path; images already embedded in source keep their exact data.
      for (const asset of uploaded) hydrated[field] = hydrated[field].split(asset.token).join(asset.publicPath);
      for (const asset of existingAssets) hydrated[field] = hydrated[field].split(asset.token).join(asset.dataUrl);
    }
    return hydrated;
  });
}

/**
 * Adds the attached image files to the project for every uploaded image the edited source actually references.
 * @returns {{files: object[], added: object[]}}
 */
function attachUploadedImageFiles(files = [], uploadedFiles = []) {
  const assets = getUploadedImageAssets(uploadedFiles);
  if (!assets.length) return { files, added: [] };
  const normalized = files.map(normalizeFile).filter(Boolean);
  const sources = normalized.filter((file) => file.encoding !== 'base64' && !file.blob).map((file) => file.content).join('\n');
  const existing = new Set(normalized.map((file) => file.path));
  const added = assets
    .filter((asset) => sources.includes(asset.publicPath) && !existing.has(asset.filePath))
    .map((asset) => ({ path: asset.filePath, content: asset.base64, language: 'binary', encoding: 'base64' }));
  return { files: added.length ? [...files, ...added] : files, added };
}

function validatePageCreationOperations(prompt = '', operations = [], existingFiles = []) {
  if (!isPageCreationRequest(prompt)) return;

  const normalizedExisting = existingFiles.map(normalizeFile).filter(Boolean);
  const existingPaths = new Set(normalizedExisting.map((file) => file.path));
  const createdPages = operations.filter((operation) => {
    const op = String(operation?.operation || '').toLowerCase();
    return op === 'create' && !existingPaths.has(operation.path) && /\.(?:jsx?|tsx?)$/i.test(operation.path || '');
  });
  const changedText = operations
    .map((operation) => operation?.operation === 'patch' ? operation.replace : operation?.content)
    .filter((content) => typeof content === 'string')
    .join('\n');
  const existingPageCandidates = normalizedExisting.filter((file) => {
    if (!/(?:^|\/)pages?\//i.test(file.path) || !/\.(?:jsx?|tsx?)$/i.test(file.path)) return false;
    const name = path.basename(file.path, path.extname(file.path));
    return changedText.includes(name);
  });
  const pageCandidates = [
    ...createdPages,
    ...existingPageCandidates.map((file) => ({ path: file.path, operation: 'existing' }))
  ];

  if (!pageCandidates.length) {
    throw new Error('Page creation response did not create a new page file or connect an existing page file.');
  }

  const createdNames = pageCandidates.map((operation) => path.basename(operation.path, path.extname(operation.path)));
  let referenceCount = 0;
  const integrationOperations = operations.filter((operation) => {
    if (!existingPaths.has(operation?.path)) return false;
    if (!/\.(?:jsx?|tsx?)$/i.test(operation.path)) return false;
    const changedText = operation.operation === 'patch' ? operation.replace : operation.content;
    if (typeof changedText !== 'string') return false;
    let operationReferences = 0;
    for (const name of createdNames) {
      operationReferences += changedText.split(name).length - 1;
    }
    referenceCount += operationReferences;
    return operationReferences > 0;
  });

  if (!integrationOperations.length || referenceCount < 2) {
    throw new Error(`New page "${pageCandidates[0].path}" is not imported and rendered or registered in an existing router.`);
  }

  const existingIntegrationText = operations
    .filter((operation) => existingPaths.has(operation?.path))
    .map((operation) => operation?.operation === 'patch' ? operation.replace : operation?.content)
    .filter((content) => typeof content === 'string')
    .join('\n');
  const hasReachableEntry = /(?:<Route\b|createBrowserRouter\s*\(|\bnavigate\s*\(|\bhref\s*=|\bto\s*=|\bonClick\s*=|\bsetActivePage\s*\()/i.test(existingIntegrationText);
  if (!hasReachableEntry) {
    throw new Error(`New page "${pageCandidates[0].path}" has no route or user navigation action that can open it.`);
  }

  const applied = applyFileOperations(existingFiles, operations);
  validatePageIsolationResult(prompt, operations, existingFiles, applied.files);
}

function pageSlug(filePath = '') {
  return path.basename(filePath, path.extname(filePath))
    .replace(/Page$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function validatePageIsolationResult(prompt = '', operations = [], beforeFiles = [], afterFiles = []) {
  if (!isPageCreationRequest(prompt)) return null;
  const beforePaths = new Set(beforeFiles.map(normalizeFile).filter(Boolean).map((file) => file.path));
  const normalizedAfter = afterFiles.map(normalizeFile).filter(Boolean);
  const createdPage = operations.find((operation) =>
    String(operation?.operation).toLowerCase() === 'create' &&
    !beforePaths.has(operation.path) && /\.(?:jsx?|tsx?)$/i.test(operation.path || '')
  );
  const changedText = operations.map((operation) => operation.replace || operation.content || '').join('\n');
  const existingPage = normalizedAfter.find((file) =>
    /(?:^|\/)pages?\//i.test(file.path) && /\.(?:jsx?|tsx?)$/i.test(file.path) &&
    changedText.includes(path.basename(file.path, path.extname(file.path)))
  );
  const pageFile = normalizedAfter.find((file) => file.path === createdPage?.path) || existingPage;
  if (!pageFile) throw new Error('Page isolation validation failed: no independent page component was found.');
  const beforeSource = beforeFiles.map(normalizeFile).filter((file) => file && /\.(?:jsx?|tsx?)$/i.test(file.path))
    .map((file) => file.content).join('\n');
  const afterSource = normalizedAfter.filter((file) => /\.(?:jsx?|tsx?)$/i.test(file.path)).map((file) => file.content).join('\n');
  const beforeHasHeader = /<(?:header|nav|Navbar|Header)\b|import\s+(?:Navbar|Header)\b/i.test(beforeSource);
  const beforeHasFooter = /<(?:footer|Footer)\b|import\s+Footer\b/i.test(beforeSource);
  const explicitlyRequestsNewChrome = /\b(?:new|different|separate|replace|redesign)\s+(?:header|navbar|navigation|footer)\b/i.test(prompt);
  if (!explicitlyRequestsNewChrome && /<(?:header|nav|footer|Navbar|Header|Footer)\b|import\s+(?:Navbar|Header|Footer)\b/i.test(pageFile.content)) {
    throw new Error(`Shared shell validation failed: "${pageFile.path}" must not create or embed another header, navbar, or footer.`);
  }
  if (!explicitlyRequestsNewChrome && !beforeHasHeader && /<(?:header|nav|Navbar|Header)\b|import\s+(?:Navbar|Header)\b/i.test(afterSource)) {
    throw new Error('Shared shell validation failed: page creation cannot introduce a header/navbar when the existing site has none.');
  }
  if (!explicitlyRequestsNewChrome && !beforeHasFooter && /<(?:footer|Footer)\b|import\s+Footer\b/i.test(afterSource)) {
    throw new Error('Shared shell validation failed: page creation cannot introduce a footer when the existing site has none.');
  }

  const slug = pageSlug(pageFile.path);
  const marker = new RegExp(`data-page=["']${slug}["']`, 'i');
  if (!marker.test(pageFile.content)) {
    throw new Error(`Page isolation validation failed: "${pageFile.path}" needs an independent root with data-page="${slug}".`);
  }
  const rootMatch = pageFile.content.match(new RegExp(`<([A-Za-z][\\w.]*)\\b[^>]*data-page=["']${slug}["'][^>]*>`, 'i'));
  if (!rootMatch || !/className=["'][^"']*\bmin-h-screen\b/i.test(rootMatch[0])) {
    throw new Error(`Page isolation validation failed: data-page="${slug}" root must use min-h-screen and natural document flow.`);
  }
  if (/className=["'][^"']*(?<!min-)\bh-screen\b/i.test(pageFile.content) || /height\s*:\s*["']?100vh/i.test(pageFile.content)) {
    throw new Error(`Page isolation validation failed: "${pageFile.path}" uses fixed viewport height; use min-h-screen.`);
  }
  const hasAbsoluteLayer = /className=["'][^"']*\babsolute\b[^"']*\binset-0\b/i.test(pageFile.content);
  if (hasAbsoluteLayer && (!/\brelative\b/.test(rootMatch[0]) || !/\boverflow-hidden\b/.test(rootMatch[0]))) {
    throw new Error(`Page isolation validation failed: absolute backgrounds in "${pageFile.path}" require a relative overflow-hidden page root.`);
  }
  if (/className=["'][^"']*\bfixed\b[^"']*(?:\binset-0\b|\bbg-|background)/i.test(pageFile.content) ||
      /position\s*:\s*["']fixed["'][\s\S]{0,160}(?:background|inset)/i.test(pageFile.content)) {
    throw new Error(`Page isolation validation failed: page-specific backgrounds in "${pageFile.path}" cannot use fixed positioning.`);
  }
  if (/\bz-(?:\[?\d{4,}|\[999)/i.test(pageFile.content)) {
    throw new Error(`Page isolation validation failed: "${pageFile.path}" uses an unsafe arbitrary high z-index.`);
  }

  for (const operation of operations.filter((item) => /\.css$/i.test(item.path || ''))) {
    const css = operation.replace || operation.content || '';
    if (/(?:^|})\s*(?:body\s+)?(?:div|section|h1|h2|p)\s*\{/im.test(css)) {
      throw new Error(`Page isolation validation failed: page-specific CSS in "${operation.path}" uses an unscoped global selector.`);
    }
  }

  const appSources = normalizedAfter.filter((file) => /(?:^|\/)(?:App|router|routes)\.(?:jsx?|tsx?)$/i.test(file.path));
  const appText = appSources.map((file) => file.content).join('\n');
  const allSources = normalizedAfter.filter((file) => /\.(?:jsx?|tsx?)$/i.test(file.path)).map((file) => file.content).join('\n');
  const sharedHeaderMarkers = allSources.match(/data-shared-header(?:=|\b)/g) || [];
  const sharedFooterMarkers = allSources.match(/data-shared-footer(?:=|\b)/g) || [];
  if (beforeHasHeader && sharedHeaderMarkers.length !== 1) {
    throw new Error(`Shared shell validation failed: preserve exactly one existing header/navbar marked data-shared-header (found ${sharedHeaderMarkers.length}).`);
  }
  if (beforeHasFooter && sharedFooterMarkers.length !== 1) {
    throw new Error(`Shared shell validation failed: preserve exactly one existing footer marked data-shared-footer (found ${sharedFooterMarkers.length}).`);
  }
  const componentName = path.basename(pageFile.path, path.extname(pageFile.path));
  const escapedComponent = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exclusiveRender = new RegExp(`(?:<Route[\\s\\S]{0,300}<${escapedComponent}\\b|if\\s*\\([^)]*(?:page|route|path)[^)]*\\)[\\s\\S]{0,200}return\\s*\\(?\\s*<${escapedComponent}\\b|(?:page|route|path)[\\s\\S]{0,120}\\?\\s*<${escapedComponent}\\b)`, 'i');
  if (!exclusiveRender.test(appText)) {
    throw new Error(`Page isolation validation failed: "${componentName}" must be rendered by an exclusive route or active-page branch that unmounts Home.`);
  }
  if (!/data-page=["']home["']/i.test(appText)) {
    throw new Error('Page isolation validation failed: the existing home page root must be marked data-page="home" for exclusivity checks.');
  }
  if (!new RegExp(`data-page-link=["']${slug}["']`, 'i').test(allSources)) {
    throw new Error(`Page isolation validation failed: navigation to the new page needs data-page-link="${slug}".`);
  }
  if (!/data-page-link=["']home["']/i.test(allSources)) {
    throw new Error('Page isolation validation failed: the new page needs a data-page-link="home" return control.');
  }

  return {
    slug,
    pagePath: pageFile.path,
    homeSelector: '[data-page="home"]',
    pageSelector: `[data-page="${slug}"]`,
    openSelector: `[data-page-link="${slug}"]`,
    homeLinkSelector: '[data-page-link="home"]',
    headerSelector: beforeHasHeader ? '[data-shared-header]' : null,
    footerSelector: beforeHasFooter ? '[data-shared-footer]' : null
  };
}

/**
 * Detect ambiguous requests that should not trigger destructive full regeneration
 */
function isAmbiguous(prompt = '') {
  const p = String(prompt || '').trim().toLowerCase();
  if (!p) return true;
  const ambiguousPhrases = [
    'make it better',
    'improve it',
    'make it nice',
    'enhance it',
    'fix it',
    'clean it up',
    'do something',
    'update it',
    'redesign it'
  ];
  return ambiguousPhrases.includes(p) || (p.split(/\s+/).length <= 2 && /^(better|nice|improve|enhance|good|clean)$/i.test(p));
}

/**
 * Normalize a file object from Mongoose subdocuments or plain JS objects.
 * Prevents issues where `{ ...mongooseDoc }` loses prototype getters like `.path`.
 */
function normalizeFile(f) {
  if (!f) return null;
  const raw = typeof f.toObject === 'function' ? f.toObject() : f;
  const filePath = typeof f.path === 'string' ? f.path : (typeof raw.path === 'string' ? raw.path : '');
  const content = typeof f.content === 'string' ? f.content : (typeof raw.content === 'string' ? raw.content : '');
  const language = typeof f.language === 'string' ? f.language : (typeof raw.language === 'string' ? raw.language : 'javascript');
  return {
    path: filePath,
    content,
    language,
    encoding: raw.encoding || 'utf8',
    ...(raw.blob ? { blob: raw.blob } : {})
  };
}

/**
 * Select the smallest set of target files relevant to the user's request
 */
function selectTargetFiles(prompt = '', files = [], conversation = null) {
  const selected = selectTargetFilesRaw(prompt, files, conversation);
  return expandTargetsWithImports(selected, files, prompt);
}

/**
 * LSP-assisted selection. Same contract as selectTargetFiles plus evidence for the prompt. Never throws: when the
 * language server cannot help (disabled, crashed, unresolved) it returns the heuristic selection and says why.
 */
async function selectTargetFilesLsp({ prompt = '', files = [], conversation = null, selectedElement = null, projectKey = null, buffers = null, signal, lsp = null } = {}) {
  const heuristic = () => selectTargetFiles(prompt, files, conversation);
  const manager = lsp || require('../lsp/lspManager');
  if (!manager.isEnabled() || !projectKey) {
    return { targets: heuristic(), readOnly: [], source: 'heuristic', reasons: [], fallbackReason: manager.isEnabled() ? 'no project key' : 'LSP disabled', sharedImpact: [], constraints: [], strictScope: false, unresolved: null, metrics: { ms: 0, symbols: 0, lspCalls: 0 } };
  }
  try {
    const resolved = await require('../lsp/lspTargeting').resolveTargets({
      prompt, files, conversation, selectedElement, projectKey: String(projectKey), lsp: manager, buffers, signal,
      deps: {
        normalizeFile,
        resolveImportPath,
        selectTargetFiles,
        selectTargetFilesRaw,
        isElementScoped: isElementScopedRequest,
        isBroadRequest: (text, normalized) => PROJECT_WIDE_REQUEST.test(String(text || '')) || isPageCreationRequest(text) || isProjectWideColorReplacement(text, normalized)
      }
    });
    return resolved;
  } catch (error) {
    return { targets: heuristic(), readOnly: [], source: 'heuristic', reasons: [], fallbackReason: `LSP error: ${error.message}`, sharedImpact: [], constraints: [], strictScope: false, unresolved: null, metrics: { ms: 0, symbols: 0, lspCalls: 0 } };
  }
}

/**
 * Hybrid-search selection (exact + lexical + semantic + structural). Same result shape as selectTargetFilesLsp, plus read-only
 * source `blocks`. Never throws: any failure returns the heuristic selection with the reason.
 */
async function selectTargetFilesHybrid({ prompt = '', files = [], conversation = null, selectedElement = null, viewingRoute = null, projectKey = null, signal, manager = null, embedder = null } = {}) {
  const codeSearch = manager || require('../search/projectIndex');
  const fallback = (reason) => ({ targets: selectTargetFiles(prompt, files, conversation), readOnly: [], blocks: [], source: 'heuristic', reasons: [], fallbackReason: reason, sharedImpact: [], constraints: [], strictScope: false, unresolved: null, outline: '', metrics: { ms: 0, lspCalls: 0, symbols: 0 }, search: null });
  if (!codeSearch.isEnabled() || !projectKey) return fallback(codeSearch.isEnabled() ? 'no project key' : 'code search disabled');
  try {
    return await require('../search/codeSearchTargeting').resolveTargetsHybrid({
      prompt, files, conversation, selectedElement, viewingRoute, projectKey: String(projectKey), manager: codeSearch, signal,
      embedder: embedder || require('../search/embedder'),
      deps: {
        normalizeFile, resolveImportPath, selectTargetFiles, selectTargetFilesRaw, isElementScoped: isElementScopedRequest,
        isBroadRequest: (text, normalized) => PROJECT_WIDE_REQUEST.test(String(text || '')) || isPageCreationRequest(text) || isProjectWideColorReplacement(text, normalized)
      }
    });
  } catch (error) {
    return fallback(`code search error: ${error.message}`);
  }
}

const TEXT_SOURCE_RE = /\.(?:jsx?|tsx?|css|scss|json|html|md)$/i;

function resolveImportPath(fromPath, spec, paths) {
  if (!spec.startsWith('.')) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  const tries = [base, ...['.jsx', '.js', '.tsx', '.ts', '.css', '.json'].map((e) => base + e),
    ...['.jsx', '.js', '.tsx', '.ts'].map((e) => `${base}/index${e}`)];
  return tries.find((t) => paths.has(t)) || null;
}

// Adds the files the targets import (and files whose name matches words in the prompt) so the
// model sees the code that actually owns the element, and drops binary/base64 files from targets.
function expandTargetsWithImports(targets, files, prompt = '') {
  const all = (Array.isArray(files) ? files : []).map(normalizeFile).filter(Boolean);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const paths = new Set(byPath.keys());
  const usable = (f) => f && f.encoding !== 'base64' && TEXT_SOURCE_RE.test(f.path) && !/package-lock\.json$/.test(f.path);
  const result = [];
  const seen = new Set();
  const add = (f) => { if (usable(f) && !seen.has(f.path)) { seen.add(f.path); result.push(f); } };
  (targets || []).forEach(add);

  // Prompt words that match page/component file names (e.g. "contact form" -> Contact.jsx).
  const words = new Set(String(prompt).toLowerCase().match(/[a-z]{4,}/g) || []);
  const generic = new Set(['make', 'change', 'update', 'section', 'button', 'color', 'colour', 'text', 'page', 'that', 'this', 'with', 'from', 'into', 'have', 'should', 'background']);
  for (const f of all) {
    if (!/^src\/(?:pages|components|sections|views|features)\//i.test(f.path) || !/\.(?:jsx|tsx)$/i.test(f.path)) continue;
    const name = f.path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
    if (name.length >= 4 && [...words].some((w) => !generic.has(w) && (name === w || name === w.replace(/s$/, '') || name + 's' === w))) add(f);
    if (result.length >= 12) break;
  }

  // One-hop relative imports of the primary targets (components, data, hooks, styles).
  for (const t of [...result].slice(0, 6)) {
    const re = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(t.content || '')) !== null) {
      const resolved = resolveImportPath(t.path, m[1], paths);
      if (resolved) add(byPath.get(resolved));
      if (result.length >= 16) return result;
    }
  }
  return result.length ? result : (targets || []);
}


/**
 * Files that can actually reach the screen: everything imported (transitively) from the app's entry files.
 * A component that nothing imports (for example a leftover Navbar.jsx next to the real header inside a layout file)
 * cannot change what the user sees, so it must not be chosen as the place to edit just because of its file name.
 */
function reachableFromEntry(files = []) {
  const all = files.map(normalizeFile).filter(Boolean);
  const byPath = new Map(all.map((file) => [file.path, file]));
  const paths = new Set(byPath.keys());
  const entries = all.filter((file) => /^src\/(?:main|index)\.(?:jsx?|tsx?)$/i.test(file.path) || /^src\/App\.(?:jsx?|tsx?)$/i.test(file.path)).map((file) => file.path);
  if (!entries.length) return null;
  const seen = new Set(entries);
  const queue = [...entries];
  while (queue.length) {
    const file = byPath.get(queue.pop());
    if (!file || typeof file.content !== 'string' || file.encoding === 'base64') continue;
    const re = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = re.exec(file.content)) !== null) {
      const resolved = resolveImportPath(file.path, match[1] || match[2] || '', paths);
      if (resolved && !seen.has(resolved)) { seen.add(resolved); queue.push(resolved); }
    }
  }
  return seen;
}

/** Name-hint matches that cannot reach the screen are dropped; reachable files that really render the element are added first. */
function preferRenderedOwners(matches, candidates, prompt) {
  const reachable = reachableFromEntry(candidates);
  if (!reachable) return [...matches];
  const text = String(prompt || '').toLowerCase();
  const owners = [];
  const tagFor = [
    [/\b(?:navbar|header|nav|menu|navigation|logo|brand(?:ing)?)\b/, /<(?:header|nav)\b/],
    [/\b(?:footer|bottom bar)\b/, /<footer\b/]
  ];
  for (const [promptPattern, tagPattern] of tagFor) {
    if (!promptPattern.test(text)) continue;
    for (const file of candidates) {
      if (reachable.has(file.path) && /\.(?:jsx|tsx)$/i.test(file.path) && tagPattern.test(file.content || '')) owners.push(file);
    }
  }
  const live = [...matches].filter((file) => !/\.(?:jsx?|tsx?)$/i.test(file.path) || reachable.has(file.path));
  const merged = [...new Set([...owners, ...live])];
  return merged.length ? merged : [...matches];
}

function selectTargetFilesRaw(prompt = '', files = [], conversation = null) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const p = normalizePrompt(prompt).toLowerCase();

  const candidates = files
    .map(normalizeFile)
    .filter(f => f && typeof f.path === 'string' && f.path && !f.path.startsWith('.') && f.path !== 'package-lock.json');
  if (candidates.length <= 1) return candidates;

  if (isProjectWideColorReplacement(prompt, candidates)) {
    const sourceColor = extractSourceColor(prompt);
    const sourcePattern = new RegExp(sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_\\s]+'), 'i');
    return candidates
      .filter((file) => /\.(?:jsx?|tsx?|css|scss|json)$/i.test(file.path) &&
        (/(?:^|\/)src\//i.test(file.path) || /(?:tokens?|tailwind\.config)\b/i.test(file.path)))
      .sort((a, b) => Number(sourcePattern.test(b.content)) - Number(sourcePattern.test(a.content)))
      .slice(0, 30);
  }

  if (isPageCreationRequest(prompt)) {
    const routingFiles = candidates.filter((file) =>
      /(?:^|\/)(?:App|main|index|router|routes|.*routes?.*|Navbar|Header|Footer|.*Layout|.*Shell|Sidebar|Navigation)\.(?:jsx?|tsx?)$/i.test(file.path) ||
      /(?:<Route\b|createBrowserRouter\s*\(|<Link\b|\bnavigate\s*\(|<nav\b)/i.test(file.content)
    );
    if (routingFiles.length) return routingFiles.slice(0, 10);
  }

  const textIntent = extractTextReplacementIntent(prompt);
  if (textIntent) {
    const sourceText = normalizeComparableText(textIntent.source);
    const textOwners = candidates.filter((file) =>
      /\.(?:jsx|tsx)$/i.test(file.path) && normalizeComparableText(file.content).includes(sourceText)
    );
    if (textOwners.length) return textOwners.slice(0, 6);
  }

  if (/\b(?:it|its|that|same|previous|last)\b/i.test(p) && Array.isArray(conversation?.messages)) {
    const previousAssistant = [...conversation.messages].reverse().find((message) => message?.role === 'assistant');
    let lineagePaths = Array.isArray(previousAssistant?.meta?.changedPaths)
      ? [...previousAssistant.meta.changedPaths]
      : [];
    if (!lineagePaths.length && Array.isArray(previousAssistant?.actions)) {
      lineagePaths = previousAssistant.actions.map((action) => action?.path).filter(Boolean);
    }
    if (!lineagePaths.length && previousAssistant?.changeSummary) {
      for (const match of previousAssistant.changeSummary.matchAll(/(?:Updated|Created)\s+([^;]+)/g)) {
        lineagePaths.push(match[1].trim());
      }
    }
    const lineageFiles = lineagePaths
      .map((filePath) => candidates.find((candidate) => candidate.path === filePath))
      .filter(Boolean);
    if (lineageFiles.length) return lineageFiles.slice(0, 6);
  }

  const matches = new Set();

  const elementMap = [
    { patterns: [/navbar/i, /header/i, /nav\b/i, /menu/i, /navigation/i], fileHints: ['navbar', 'header', 'nav'] },
    { patterns: [/footer/i, /bottom bar/i], fileHints: ['footer'] },
    { patterns: [/hero/i, /banner/i, /headline/i, /intro/i], fileHints: ['hero', 'banner'] },
    { patterns: [/login/i, /auth/i, /signin/i, /sign-in/i, /signup/i, /sign-up/i], fileHints: ['login', 'auth', 'signin', 'signup'] },
    { patterns: [/button/i, /cta\b/i], fileHints: ['button', 'navbar', 'hero', 'header', 'card'] },
    { patterns: [/pricing/i, /plans/i, /tiers/i], fileHints: ['pricing', 'plans'] },
    { patterns: [/about/i, /team/i], fileHints: ['about', 'team'] },
    { patterns: [/features/i, /services/i], fileHints: ['features', 'services'] },
    { patterns: [/modal/i, /dialog/i, /popup/i], fileHints: ['modal', 'dialog'] },
    { patterns: [/sidebar/i, /aside/i, /drawer/i], fileHints: ['sidebar', 'drawer'] },
    { patterns: [/card/i], fileHints: ['card'] },
    { patterns: [/logo/i, /brand(?:ing)?\b/i, /favicon/i], fileHints: ['navbar', 'header', 'footer', 'logo', 'brand', 'layout', 'sidebar'] },
    { patterns: [/image/i, /photo/i, /picture/i, /avatar/i, /thumbnail/i], fileHints: ['hero', 'image', 'gallery', 'card', 'logo', 'avatar'] },
    { patterns: [/font\b/i, /typography/i, /text size/i, /font size/i, /heading size/i], fileHints: ['index.css', 'app', 'hero', 'header'] },
    { patterns: [/\bcolors?\b/i, /\bthemes?\b/i, /\bpalettes?\b/i, /background\b/i], fileHints: ['tokens', 'index.css', 'app'] }
  ];

  for (const { patterns, fileHints } of elementMap) {
    if (patterns.some(pattern => pattern.test(p))) {
      for (const candidate of candidates) {
        const lowerPath = candidate.path.toLowerCase();
        if (fileHints.some(hint => lowerPath.includes(hint))) {
          matches.add(candidate);
        }
      }
    }
  }

  if (/\b(?:image|photo|picture|logo|avatar|thumbnail)\b/i.test(p)) {
    for (const candidate of candidates) {
      if (/\.(?:jsx?|tsx?|css|scss)$/i.test(candidate.path) &&
          /(?:<img\b|\bsrc(?:Set)?\s*=|background(?:Image|-image)\s*[:=]|\burl\s*\()/i.test(candidate.content)) {
        matches.add(candidate);
      }
    }
  }

  if (/\b(?:colou?r|theme|palette|background)\b/i.test(p)) {
    const sourceColor = extractSourceColor(prompt);
    const sourcePattern = sourceColor
      ? new RegExp(sourceColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[-_\\s]+'), 'i')
      : null;
    for (const candidate of candidates) {
      if (/\.(?:jsx?|tsx?|css|scss|json)$/i.test(candidate.path) && sourcePattern?.test(candidate.content) &&
          (hasVisualColorUsage(candidate, sourceColor) || /\.(?:jsx|tsx)$/i.test(candidate.path))) {
        matches.add(candidate);
      }
    }

    // Theme requests often reference a rendered color whose source is a hex value.
    // Include component/style files so the model sees the actual palette owners.
    if (/\b(?:theme|palette|all|every|throughout|sitewide)\b/i.test(p) || matches.size < 2) {
      for (const candidate of candidates) {
        if (/\.(?:jsx|tsx|css|scss)$/i.test(candidate.path)) matches.add(candidate);
        if (matches.size >= 10) break;
      }
    }
  }

  // If specific component file found, return matching components
  if (matches.size > 0) {
    return preferRenderedOwners(matches, candidates, p).slice(0, 10);
  }

  // Fallback: if App.jsx exists, it is the root component
  const rootApp = candidates.find(f => f?.path && (f.path === 'src/App.jsx' || f.path.endsWith('App.jsx')));
  if (rootApp) return [rootApp];

  return candidates.slice(0, 3);
}

/**
 * Parse AI response using either tool/schema JSON or deterministic <PATCH>/<FILE> delimiters.
 * Immune to JSON backslash escaping issues in JSX (e.g. \s, \d, \', multiline strings).
 */
function parseAIResponse(responseText, defaultTarget = null) {
  const raw = String(responseText || '').trim();
  const operations = [];

  // 1. Try deterministic <PATCH> delimiters
  const patchRegex = /<PATCH\s+path=["']([^"']*)["']\s*>([\s\S]*?)<\/PATCH>/gi;
  let patchMatch;
  while ((patchMatch = patchRegex.exec(raw)) !== null) {
    const filePath = patchMatch[1].trim();
    const body = patchMatch[2];
    const searchMatch = body.match(/<SEARCH>([\s\S]*?)<\/SEARCH>/i);
    const replaceMatch = body.match(/<REPLACE>([\s\S]*?)<\/REPLACE>/i);
    if (searchMatch && replaceMatch) {
      operations.push({
        path: filePath,
        operation: 'patch',
        search: searchMatch[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
        replace: replaceMatch[1].replace(/^\r?\n/, '').replace(/\r?\n$/, '')
      });
    }
  }

  // 2. Try deterministic <FILE> delimiters (standard or self-closing)
  const fileRegex = /<FILE\s+path=["']([^"']*)["'](?:\s+operation=["']([^"']*)["'])?\s*(?:\/>|>([\s\S]*?)<\/FILE>)/gi;
  let fileMatch;
  while ((fileMatch = fileRegex.exec(raw)) !== null) {
    const filePath = fileMatch[1].trim();
    const op = (fileMatch[2] || 'modify').toLowerCase().trim();
    const content = (fileMatch[3] || '').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    operations.push({
      path: filePath,
      operation: op === 'delete' || op === 'remove' ? 'delete' : op === 'create' ? 'create' : 'modify',
      content
    });
  }
  if (operations.length > 0) return { action: 'update', files: operations };

  // 3. Try structured JSON (standard or sanitizing unescaped backslashes)
  let parsedJson = null;
  try {
    parsedJson = JSON.parse(raw);
  } catch (_) {
    // Sanitize unescaped backslashes in JSON string values without corrupting valid escapes
    const sanitized = raw.replace(/(?<!\\)\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
    try {
      parsedJson = JSON.parse(sanitized);
    } catch (_) {
      const first = sanitized.indexOf('{');
      const last = sanitized.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try {
          parsedJson = JSON.parse(sanitized.slice(first, last + 1));
        } catch (_) {}
      }
    }
  }

  if (parsedJson && typeof parsedJson === 'object') {
    const list = Array.isArray(parsedJson.files)
      ? parsedJson.files
      : Array.isArray(parsedJson.actions)
      ? parsedJson.actions
      : parsedJson.path && (parsedJson.content || parsedJson.search)
      ? [parsedJson]
      : [];

    for (const item of list) {
      if (!item || typeof item.path !== 'string') continue;
      const op = (item.operation || item.action || (item.search ? 'patch' : 'modify')).toLowerCase();
      if (op === 'patch' && typeof item.search === 'string' && typeof item.replace === 'string') {
        operations.push({
          path: item.path,
          operation: 'patch',
          search: item.search,
          replace: item.replace
        });
      } else if (op === 'delete' || op === 'remove') {
        operations.push({
          path: item.path,
          operation: 'delete'
        });
      } else if (typeof item.content === 'string') {
        operations.push({
          path: item.path,
          operation: op === 'create' ? 'create' : 'modify',
          content: item.content
        });
      }
    }

    if (operations.length > 0) {
      return {
        action: parsedJson.action || 'update',
        reason: parsedJson.reason || '',
        files: operations
      };
    }
  }

  // 4. Fallback: if raw text contains direct code or markdown code fence
  let code = raw;
  const fence = raw.match(/```(?:jsx?|tsx?|javascript|typescript)?\s*([\s\S]*?)\s*```/i);
  if (fence) code = fence[1].trim();

  if (code && (code.includes('export default') || code.includes('import ') || code.includes('return '))) {
    const targetPath = defaultTarget || 'src/App.jsx';
    return {
      action: 'update',
      files: [{ path: targetPath, operation: 'modify', content: code }]
    };
  }

  return { action: 'update', files: [] };
}

/**
 * Validate path string for security and formatting
 */
function validatePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Invalid file path: path must be a non-empty string.');
  }
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    normalized.startsWith('/') ||
    normalized.includes('../') ||
    normalized.includes('/..') ||
    normalized === '..' ||
    /[<>:"|?*\x00-\x1f]/.test(normalized) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path.basename(normalized))
  ) {
    throw new Error(`Path traversal or invalid path detected: "${filePath}".`);
  }
  return normalized;
}

/**
 * Apply a minimal file operations changeset to an array of project files.
 * Preserves all unrelated files exactly.
 */
function applyFileOperations(existingFiles = [], operations = []) {
  if (!Array.isArray(existingFiles)) throw new Error('Existing files must be an array.');
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('No file operations provided to apply.');
  }

  // Normalize existing files so Mongoose subdocuments or plain objects are handled consistently
  const normalizedExisting = existingFiles.map(normalizeFile).filter(f => f && f.path);
  const fileMap = new Map(normalizedExisting.map(f => [f.path, { ...f }]));
  const modifiedPaths = new Set();

  for (const op of operations) {
    if (!op) continue;
    const safePath = validatePath(op.path);
    const operation = (op.operation || 'modify').toLowerCase();

    if (operation === 'patch') {
      const existing = fileMap.get(safePath);
      if (!existing) {
        throw new Error(`Target file not found for patch: "${safePath}".`);
      }
      if (typeof op.search !== 'string' || typeof op.replace !== 'string') {
        throw new Error(`Patch operation on "${safePath}" requires search and replace strings.`);
      }

      const content = existing.content;
      const normContent = content.replace(/\r\n/g, '\n');
      const normSearch = op.search.replace(/\r\n/g, '\n');
      const normReplace = op.replace.replace(/\r\n/g, '\n');

      let matchCount = 0;
      let firstIndex = -1;
      let pos = 0;
      while ((pos = normContent.indexOf(normSearch, pos)) !== -1) {
        if (matchCount === 0) firstIndex = pos;
        matchCount++;
        pos += normSearch.length;
      }

      if (matchCount === 1) {
        existing.content = normContent.slice(0, firstIndex) + normReplace + normContent.slice(firstIndex + normSearch.length);
      } else if (matchCount > 1) {
        throw new Error(`Patch target in "${safePath}" matched ${matchCount} locations: search block must match exactly 1 location.`);
      } else {
        throw new Error(`Patch target not found in "${safePath}": search block did not match existing content.`);
      }
      modifiedPaths.add(safePath);
    } else if (operation === 'modify') {
      const existing = fileMap.get(safePath);
      if (!existing) {
        throw new Error(`Target file not found for modify: "${safePath}".`);
      }
      if (typeof op.content !== 'string') {
        throw new Error(`Modify operation on "${safePath}" requires content string.`);
      }
      existing.content = op.content;
      modifiedPaths.add(safePath);
    } else if (operation === 'create') {
      if (typeof op.content !== 'string') {
        throw new Error(`Create operation on "${safePath}" requires content string.`);
      }
      fileMap.set(safePath, {
        path: safePath,
        content: op.content,
        language: safePath.endsWith('.css') ? 'css' : safePath.endsWith('.json') ? 'json' : 'javascript'
      });
      modifiedPaths.add(safePath);
    } else if (operation === 'delete' || operation === 'remove') {
      if (fileMap.has(safePath)) {
        fileMap.delete(safePath);
        modifiedPaths.add(safePath);
      }
    } else {
      throw new Error(`Unsupported file operation: "${operation}".`);
    }
  }

  // Preserve exact instances for files that were not modified
  const resultFiles = [];
  for (const orig of normalizedExisting) {
    if (modifiedPaths.has(orig.path)) {
      if (fileMap.has(orig.path)) {
        resultFiles.push(fileMap.get(orig.path));
      }
    } else {
      resultFiles.push(orig); // Exact preservation
    }
  }
  // Add newly created files
  for (const [p, fileObj] of fileMap.entries()) {
    if (!normalizedExisting.some(f => f.path === p)) {
      resultFiles.push(fileObj);
    }
  }

  return {
    files: resultFiles,
    changedFiles: Array.from(modifiedPaths)
  };
}

/**
 * Validate that modifications are minimal and do not touch unrelated components
 */
function validateMinimalDiff(beforeFiles = [], afterFiles = [], targetFiles = [], prompt = '') {
  const p = String(prompt || '').toLowerCase();
  const changedPaths = [];

  const beforeNormalized = beforeFiles.map(normalizeFile).filter(f => f && f.path);
  const afterNormalized = afterFiles.map(normalizeFile).filter(f => f && f.path);
  const targetNormalized = targetFiles.map(normalizeFile).filter(f => f && f.path);

  const beforeMap = new Map(beforeNormalized.map(f => [f.path, f.content]));
  const afterMap = new Map(afterNormalized.map(f => [f.path, f.content]));

  for (const [path, afterContent] of afterMap.entries()) {
    const beforeContent = beforeMap.get(path);
    if (beforeContent === undefined || beforeContent !== afterContent) {
      changedPaths.push(path);
    }
  }
  for (const path of beforeMap.keys()) {
    if (!afterMap.has(path)) {
      changedPaths.push(path);
    }
  }

  if (changedPaths.length === 0) {
    return { valid: false, message: 'No changes were made to the project files.' };
  }

  const targetPaths = new Set(targetNormalized.map(f => f.path));

  // If user asked to change a specific component, check if unrelated components changed
  if (/navbar|header|nav\b/i.test(p) && !/footer|hero|pricing|login|about/i.test(p)) {
    const unrelatedChanged = changedPaths.filter(cp =>
      /footer|hero|pricing|login|about|card/i.test(cp) && !targetPaths.has(cp)
    );
    if (unrelatedChanged.length > 0) {
      return {
        valid: false,
        message: `Overly broad modification: user asked to change navbar, but unrelated files were modified: ${unrelatedChanged.join(', ')}.`
      };
    }
  }

  if (/login\s+button/i.test(p) && !/navbar|hero|footer/i.test(p)) {
    const unrelatedChanged = changedPaths.filter(cp =>
      /hero|footer|pricing/i.test(cp) && !targetPaths.has(cp)
    );
    if (unrelatedChanged.length > 0) {
      return {
        valid: false,
        message: `Overly broad modification: user asked to change login button, but unrelated files were modified: ${unrelatedChanged.join(', ')}.`
      };
    }
  }

  if (/hero\s+(?:heading|title|image)/i.test(p) && !/footer|navbar|pricing/i.test(p)) {
    const unrelatedChanged = changedPaths.filter(cp =>
      /footer|navbar|pricing|login/i.test(cp) && !targetPaths.has(cp)
    );
    if (unrelatedChanged.length > 0) {
      return {
        valid: false,
        message: `Overly broad modification: user asked to change hero element, but unrelated files were modified: ${unrelatedChanged.join(', ')}.`
      };
    }
  }

  return { valid: true, changedPaths };
}


// --- Edit scope guard ---------------------------------------------------------------------------------------------
// A localized request may change the requested files, the modules they import, and the modules that import them.
// Rewrites of any other EXISTING source file are reverted unless the request is explicitly project-wide, so an edit
// to one page cannot silently rewrite unrelated pages. New files and dependency/config files are always allowed.
const PROJECT_WIDE_REQUEST = /\b(all|every|each|entire|whole|site-?wide|global(?:ly)?|throughout|everywhere|redesign|rebrand|re-?theme|theme|dark mode|rename|migrate|refactor)\b/i;
const SCOPE_EXEMPT_PATH = /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[cm]?[jt]s|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?[jt]s|index\.html|src\/(?:index|App|main)\.(?:css|jsx?|tsx?)|src\/tokens\.json|src\/styles\/.*)$/;

function enforceEditScope(beforeFiles = [], changedFiles = [], targetFiles = [], prompt = '', options = {}) {
  const protocol = require('./aiProtocol');
  if (options?.strict && !PROJECT_WIDE_REQUEST.test(String(prompt || ''))) {
    // LSP found that the request is specific to one page/instance of a shared component: only the resolved files (plus
    // new files, config and non-code files) may change. Importers of a shared component are NOT pulled into scope.
    const allowed = new Set(targetFiles.map((file) => file.path));
    const beforeMap = new Map(beforeFiles.map((file) => [file.path, file]));
    const kept = [];
    const reverted = [];
    for (const file of changedFiles) {
      const existing = beforeMap.get(file.path);
      const inScope = !existing || allowed.has(file.path) || SCOPE_EXEMPT_PATH.test(file.path) || !/\.(?:jsx?|tsx?|css|scss)$/i.test(file.path);
      if (inScope || existing.content === file.content) kept.push(file); else reverted.push(file.path);
    }
    return { files: kept, reverted, wide: false, strict: true };
  }
  if (PROJECT_WIDE_REQUEST.test(String(prompt || '')) || isProjectWideColorReplacement(prompt, beforeFiles)) {
    return { files: changedFiles, reverted: [], wide: true };
  }
  const before = new Map(beforeFiles.map((file) => [file.path, file]));
  // The editor's target list pulls in every page the router imports. Such a page is only in scope when the request
  // actually names it (e.g. "pricing page"); otherwise it was merely reachable from App.
  const prose = String(prompt || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const baseName = (filePath) => filePath.split('/').pop().replace(/\.[^.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const importedBy = (filePath) => beforeFiles.filter((file) => file.path !== filePath && typeof file.content === 'string'
    && new RegExp(`['"]\\.{1,2}/(?:[\\w./-]*/)?${filePath.split('/').pop().replace(/\.[^.]+$/, '')}(?:\\.\\w+)?['"]`).test(file.content)).map((file) => file.path);
  // Targets chosen on purpose by the language server or code search (the page being viewed, a named component) are never "merely reachable from App".
  const routerOnly = (file) => !options?.trusted && /(?:^|\/)(?:pages?|routes?|views?|screens?)\//.test(file.path)
    && !prose.includes(baseName(file.path))
    && importedBy(file.path).every((importer) => /^src\/(?:App|main)\.(?:jsx?|tsx?)$/.test(importer));
  const targetPaths = new Set(targetFiles.filter((file) => !routerOnly(file)).map((file) => file.path));
  // The router/entry file imports every page, so it must not widen the scope to all of them.
  const focus = new Set([...targetPaths].filter((filePath) => !/^src\/(?:App|main)\.(?:jsx?|tsx?)$/.test(filePath)));
  const related = new Set(protocol.relatedRepairPaths(beforeFiles.filter(Boolean), focus.size ? focus : targetPaths, { maxImports: 30, maxImporters: 30 }));
  const kept = [];
  const reverted = [];
  for (const file of changedFiles) {
    const existing = before.get(file.path);
    const inScope = !existing || targetPaths.has(file.path) || related.has(file.path) || SCOPE_EXEMPT_PATH.test(file.path)
      || !/\.(?:jsx?|tsx?|css|scss)$/i.test(file.path);
    if (inScope || existing.content === file.content) kept.push(file); else reverted.push(file.path);
  }
  return { files: kept, reverted, wide: false };
}

/**
 * Build a surgical, targeted incremental edit prompt
 */
function buildIncrementalPrompt({ prompt, targetFiles: allTargetFiles, projectFiles, conversation = null, projectProvenance = null, selectedElement = null, uploadedFiles = [], sourceContext = '', compact = false, lspContext = null, viewingRoute = null, structural = null }) {
  const normalizedPrompt = normalizePrompt(prompt);
  const MAX_CONTEXT_CHARS = 300000;
  // Keep whole target files in priority order until the budget is full; never truncate a file's content.
  let targetBudget = MAX_CONTEXT_CHARS;
  const targetFiles = [];
  const deferredTargets = [];
  for (const f of allTargetFiles) {
    const size = String(f.content || '').length + 40;
    if (size <= targetBudget) { targetBudget -= size; targetFiles.push(f); } else deferredTargets.push(f.path);
  }
  if (!targetFiles.length && deferredTargets.length) {
    throw new Error('The files this edit targets exceed the incremental generation context limit. Source was not truncated.');
  }
  // Stage B: show a large target as the complete syntax units that matter (structural retrieval). Stage C is the whole file:
  // used for compact retries, project-wide / page-creation requests, source-fed edits and whenever the evidence is not clear.
  const structuralOptions = structural && structural.enabled !== false && !compact ? structural : null;
  const wholeFileRequest = Boolean(structuralOptions?.forceFull) || isPageCreationRequest(prompt) || PROJECT_WIDE_REQUEST.test(String(prompt || ''))
    || isProjectWideColorReplacement(prompt, (projectFiles || []).map(normalizeFile).filter(Boolean)) || Boolean(String(sourceContext || '').trim());
  const focusByPath = {};
  for (const entry of lspContext?.focus || []) focusByPath[entry.path] = { names: entry.names || [], classNames: entry.classNames || [] };
  if (selectedElement?.sourceFile) {
    const entry = focusByPath[selectedElement.sourceFile] || (focusByPath[selectedElement.sourceFile] = { names: [], classNames: [] });
    if (selectedElement.sourceComponent) entry.names.push(String(selectedElement.sourceComponent).replace(/[<>/]/g, ''));
  }
  const structuralResult = structuralOptions
    ? structuralContext.buildTargetContext(targetFiles, { prompt, focusByPath, projectKey: structuralOptions.projectKey || '_', forceFull: wholeFileRequest, realFiles: structuralOptions.realFiles || null })
    : null;
  const targetText = new Map((structuralResult?.files || []).map((entry) => [entry.file.path, entry]));
  const targetCodeBlocks = targetFiles.map((f) => {
    const entry = targetText.get(f.path);
    if (entry?.plan.mode === 'excerpt') {
      return `--- FILE: ${f.path} (PARTIAL VIEW: ${entry.plan.chars} chars in the file, ${entry.plan.shownChars} shown. Only the complete code units below were read; parts marked VEAVE-OMITTED were NOT shown and have not been inspected) ---\n${entry.text}`;
    }
    return `--- FILE: ${f.path} ---\n${f.content}`;
  }).join('\n\n')
    + (deferredTargets.length ? `\n\n--- FILES NOT SHOWN (too large for the context; do not patch them blindly) ---\n${deferredTargets.join('\n')}` : '');
  const normalizedProjectFiles = (projectFiles || []).map(normalizeFile).filter(Boolean);
  const projectInventory = normalizedProjectFiles.map((file) => file.path).join('\n');
  const targetPaths = new Set(targetFiles.map((file) => file.path));
  // Binary assets are base64 blobs (never model context) and the lockfile/asset map are noise: they stay in the inventory only.
  // With LSP evidence only the files the language server tied to the edit are sent as read-only source; every other file is
  // reduced to its symbol outline below (the project inventory still lists all of them).
  const lspReadOnly = lspContext?.readOnly ? new Set(lspContext.readOnly) : null;
  const readable = compact ? [] : normalizedProjectFiles.filter((file) => file.path !== 'package-lock.json' && file.path !== 'src/assets/asset-map.json'
    && !targetPaths.has(file.path) && typeof file.content === 'string' && file.encoding !== 'base64' && (!lspReadOnly || lspReadOnly.has(file.path)));
  // Supporting files are read-only context: small structural files first, filling the remaining budget. Whatever does not
  // fit is named in the prompt; the project itself is never shortened.
  const supportRank = (file) => (/^src\/App\.(?:jsx?|tsx?)$/i.test(file.path) ? 0
    : /(?:^|\/)(?:router|routes|navigation|siteData|data)\b|\.json$/i.test(file.path) ? 1
      : /(?:Header|Navbar|Footer|Layout)/i.test(file.path) ? 2 : 3);
  let budget = MAX_CONTEXT_CHARS - targetCodeBlocks.length;
  const shownSupport = [];
  const omittedSupport = [];
  for (const file of [...readable].sort((a, b) => supportRank(a) - supportRank(b) || a.content.length - b.content.length)) {
    if (file.content.length + 40 > budget) { omittedSupport.push(file.path); continue; }
    budget -= file.content.length + 40;
    shownSupport.push(file);
  }
  const supportOrder = new Map(readable.map((file, index) => [file.path, index]));
  const supportingCode = shownSupport
    .sort((a, b) => supportOrder.get(a.path) - supportOrder.get(b.path))
    .map((file) => `--- FILE: ${file.path} ---\n${file.content}`)
    .join('\n\n')
    + (omittedSupport.length ? `\n\n--- FILES NOT SHOWN (too large for the context; listed in PROJECT FILES; do not patch them blindly) ---\n${omittedSupport.join('\n')}` : '');
  const reachableSet = reachableFromEntry(normalizedProjectFiles);
  const unusedComponents = reachableSet ? normalizedProjectFiles.filter((file) => /^src\/.*\.(?:jsx|tsx)$/i.test(file.path) && !reachableSet.has(file.path)).map((file) => file.path) : [];
  const unusedNote = unusedComponents.length
    ? `\nUNUSED FILES (nothing imports them, so editing them changes nothing the user sees; never patch them, edit the file that really renders the element): ${unusedComponents.join(', ')}\n`
    : '';
  const lspNotes = lspContext
    ? `\nCODE INTELLIGENCE (from the language server; evidence for where to edit, not a guarantee):\n${[
      ...(lspContext.reasons || []).map((reason) => `- Resolved: ${reason}`),
      ...(lspContext.sharedImpact || []).map((impact) => `- ${impact.symbol} (${impact.file}) is referenced by: ${impact.usedIn.slice(0, 10).join(', ')}`),
      ...(lspContext.constraints || []).map((constraint) => `- CONSTRAINT: ${constraint}`),
      ...(lspContext.outline ? [`- Other files (read-only, not shown): ${lspContext.outline}`] : [])
    ].join('\n')}\nEdit scope: ${targetFiles.map((file) => file.path).join(', ')}. Every other file must stay byte-for-byte identical.\n`
    : '';
  const rangeBlocks = Array.isArray(lspContext?.blocks) && lspContext.blocks.length
    ? `\nRELEVANT SOURCE RANGES (READ-ONLY CONTEXT found by code search; do not patch these files unless the request requires it):\n${lspContext.blocks.map((b) => `--- ${b.path} lines ${b.start}-${b.end} (${b.why}) ---\n${b.text}`).join('\n\n')}\n`
    : '';
  const viewingNote = viewingRoute
    ? `\nCURRENT PAGE: the user is looking at the page "${viewingRoute}"${lspContext?.viewing?.file ? `, which is rendered by ${lspContext.viewing.file}` : ''}. When the request says "this page" or names no other page, it is about THIS page: change the file that renders it (and only what it needs), never a different page.\n`
    : '';
  const selectionContext = selectedElement
    ? `\nSELECTED ELEMENT (AUTHORITATIVE TARGET):\n${JSON.stringify(selectedElement, null, 2)}\nPatch only this exact instance.\n`
    : '';
  const recentConversation = Array.isArray(conversation?.messages)
    ? conversation.messages
      .filter((message) => message?.role === 'user' || message?.role === 'assistant')
      .slice(-4)
      .map((message) => {
        const changedPaths = Array.isArray(message?.meta?.changedPaths)
          ? message.meta.changedPaths
          : Array.isArray(message?.actions)
            ? message.actions.map((action) => action?.path).filter(Boolean)
            : [];
        const lineage = changedPaths.length ? `\nCHANGED FILES: ${changedPaths.join(', ')}` : '';
        return `${String(message.role).toUpperCase()}: ${message.content || message.changeSummary || ''}${lineage}`;
      })
      .join('\n')
    : '';
  const uploadedImageAssets = getUploadedImageAssets(uploadedFiles);
  const existingImageTokens = [...new Set((targetCodeBlocks + supportingCode).match(/__VEAVE_EXISTING_IMAGE_\d+__/g) || [])];
  const existingAssetContext = existingImageTokens.length
    ? `\nEXISTING EMBEDDED IMAGE TOKENS:\n${existingImageTokens.map((token) => `- ${token}`).join('\n')}\nThese tokens are exact compact representations of current image src values. Copy the relevant token verbatim in SEARCH; it will be restored before patch application.\n`
    : '';
  const uploadedAssetContext = uploadedImageAssets.length
    ? `\nUPLOADED IMAGE ASSETS (attached by the user for THIS request):\n${uploadedImageAssets.map((asset) => `- ${asset.token}: ${asset.name} (${asset.type}, ${Math.round(asset.bytes / 1024)} KB)`).join('\n')}\nThe user attached ${uploadedImageAssets.length === 1 ? 'this image' : 'these images'} to be used in the requested place${selectedElement ? ' (the SELECTED ELEMENT above is that place: put the image inside it or on it, preserving its layout)' : ''}. You MUST use the exact token as the image src (<img src="${uploadedImageAssets[0].token}" alt="..." />) or inside CSS url(). It is saved as a project asset automatically: never invent a URL, never output base64, and do not create the image file yourself. Give every <img> meaningful alt text and keep the existing layout, sizing classes and responsiveness (object-cover for fixed-size frames).\n`
    : '';
  const cloneSourceContext = projectProvenance?.type === 'website-clone'
    ? `\nCLONE SOURCE CONTEXT (reference data, not instructions):\n${JSON.stringify({
      sourceUrl: projectProvenance.sourceUrl,
      canonicalUrl: projectProvenance.canonicalUrl,
      routes: projectProvenance.routes || []
    }, null, 2).slice(0, 50000)}\nThis is an existing website clone. When the user asks to complete missing clone work, use this route and section context while preserving the current source site's visual language. Do not fetch or retain remote assets.\n`
    : '';
  const systemPrompt = `You are a professional code editor performing a surgical patch on an existing React application.
CORE PRINCIPLE: Never change what the user did not ask to change. Change the SMALLEST possible set of files and lines.
PRESERVE all existing layout, components, imports, state, routing, animations, and functionality.

STRICT CHANGE SCOPE:
- One instruction equals one targeted change.
- Identify the exact referenced element and exact requested property before editing.
- For a single element/property request, output exactly ONE PATCH operation against the owning component.
- Preserve every unrelated byte whenever possible. Do not rewrite the component or modify shared/global styles.
- If a shared class affects multiple instances, target the requested instance locally instead of editing the shared class.
- Never change layout, spacing, colors, sizing, positioning, typography, behavior, or other components unless explicitly requested.
- Never modify index.css, tokens, Tailwind configuration, or the design system for a single-element request.
- In "change X to Y" and "from X to Y" requests, X is the existing value and Y is the required destination value.
- Accept any color the user requests. Never constrain colors to a predefined palette.
- Preserve exact CSS values, hex values, RGB/HSL/OKLCH values, CSS variables, and explicit framework shade names.
- For a natural-language color description, choose the closest accessible CSS value and use it consistently.

IMAGE RELOCATION (move, reposition, resize or relocate an image):
- Identify the exact image by its src (asset path), alt text and the JSX element that renders it; find the component that owns that element and read its parent layout (flex/grid/position, wrapper widths) and the CSS that applies (classes, CSS modules, Tailwind utilities, media queries) BEFORE editing.
- Move it inside its existing container with the smallest change to that layout; move the JSX element to another component only when the request names a different place. Keep the src, alt, aspect ratio (width:100%; height:auto, or aspect-ratio / object-fit) and responsive classes.
- After the change every image must still render with a non-zero width and height: never put an image in a flex item, grid cell or wrapper that has no width of its own (give the new container a width, flex:1 1 0 with min-width:0, or a grid track).
- Do not edit another element that merely uses the same image file; do not regenerate the page.

LAYOUT CHANGES (rows, columns, grids, "make these horizontal/vertical"):
- Change ONE container rule and make it self-contained: set the display model of the container, and reset what its children inherited from the old layout (grid-area/grid-column/grid-row, fixed widths or width variables, position, float) so every child, especially images, still renders with a non-zero size.
- Scope every new CSS selector to the changed container (use its own id or class). Never edit the global rules of a shared class.
- When several elements share identical markup, a SEARCH block must include a unique neighbour (an id, a distinct attribute value or text), or the change must be made through one CSS rule on the container instead of editing each element.

REQUIRED SEARCH/REPLACE PATCHES FOR EXISTING FILES:
- Every existing file MUST be changed with a small exact PATCH operation.
- Copy every SEARCH block verbatim from the supplied current file. Do not reconstruct, reformat, abbreviate, or escape it.
- Full-file modify/update operations for existing files are forbidden because they are unsafe and can exceed the response limit.
- FILE operations are allowed only when creating a genuinely new file.
- Infer the project's actual architecture from the supplied source. When a new file requires integration to fulfill the request, include every necessary import, render, route, state, or navigation patch in the same response.

RESPONSE FORMAT (Output ONE of the following):

Option 1: Structured JSON
{
  "action": "update",
  "reason": "Brief reason",
  "files": [
    {
      "path": "path/to/file.jsx",
      "operation": "patch",
      "search": "exact string to replace",
      "replace": "new replacement string"
    }
  ]
}

Option 2: Deterministic Delimiters (IMMUNE to JSON escape issues)
<PATCH path="src/components/Navbar.jsx">
<SEARCH>
exact code to replace
</SEARCH>
<REPLACE>
new code
</REPLACE>
</PATCH>

For a genuinely new file only:
<FILE path="src/components/NewComponent.jsx" operation="create">
complete new file content
</FILE>`;

  const userMessage = `USER REQUEST:
  "${prompt}"
${normalizedPrompt !== String(prompt) ? `\nNORMALIZED INTERPRETATION (obvious typo correction only):\n"${normalizedPrompt}"\n` : ''}

CURRENT AUTHORITATIVE PROJECT SOURCE (choose the exact file or files required by the request):
${targetCodeBlocks}

PROJECT FILES:
${projectInventory}
${supportingCode ? `\nFULL PROJECT SOURCE (READ-ONLY CONTEXT; modify only TARGET FILES unless the request requires a connected multi-file change):\n${supportingCode}\n` : ''}
${selectionContext}${viewingNote}${lspNotes}${rangeBlocks}${unusedNote}
${cloneSourceContext}
${existingAssetContext}
${uploadedAssetContext}
${sourceContext}
${recentConversation ? `RECENT CONVERSATION (context only; the current request still has priority):\n${recentConversation}\n` : ''}

${/FOCUSED REQUEST:/.test(sourceContext || '') ? 'FOCUSED SOURCE EDIT: the real-website data above is for the one part the user mentioned. Edit that part only; every other line of the project must stay byte-for-byte identical.\n' : ''}INSTRUCTIONS:
1. Apply ONLY the modification requested by the user.
2. Output concise SEARCH/REPLACE patches for existing files. Never return complete existing files.
3. DO NOT touch any other files or unrelated components. A file marked PARTIAL VIEW may only be changed inside the code that is shown; never copy VEAVE-OMITTED notes into SEARCH or REPLACE.
4. Infer all required target files and integration points from the complete project source.
5. Return one complete atomic operation set that fully implements the request.`;

  return {
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    intent: null,
    plan: structuralResult?.plan || null,
    structuralMetrics: structuralResult ? { ...structuralResult.metrics, wholeFileRequest, promptChars: systemPrompt.length + userMessage.length } : null
  };
}

module.exports = {
  buildTextOutcomeExpectation,
  enforceEditScope,
  selectTargetFilesRaw,
  INTENT,
  classifyIntent,
  isPageCreationRequest,
  isElementScopedRequest,
  buildSelectedElementPatch,
  buildSelectedTextPatch,
  buildTextOutcomeVerification,
  buildColorCascadeCleanupOperations,
  buildTargetStyleVerification,
  validateStrictScopeOperations,
  validateSourceFidelity,
  reachableFromEntry,
  validateRequestedOutcome,
  validateImageOperations,
  validateColorReplacementCoverage,
  compactEmbeddedImageAssets,
  compactAssetReferences,
  hydrateUploadedImageOperations,
  attachUploadedImageFiles,
  getUploadedImageAssets,
  isAmbiguous,
  normalizeFile,
  selectTargetFiles,
  selectTargetFilesLsp,
  selectTargetFilesHybrid,
  resolveImportPath,
  parseAIResponse,
  validatePath,
  applyFileOperations,
  validateMinimalDiff,
  validatePageCreationOperations,
  validatePageIsolationResult,
  buildIncrementalPrompt
};
