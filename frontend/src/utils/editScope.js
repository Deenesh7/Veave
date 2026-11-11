// Mirrors the backend request classifier (incrementalEditor.classifyEditRequest) closely enough to tell the user, while
// typing, what their instruction will apply to: the clicked element, a section, the page or the whole project.
const MENTION = /^\s*\[<[a-z][a-z0-9-]*>(?:\s"[\s\S]*?")?\]\s*/i;

export function stripMention(text = '') {
  return String(text).replace(MENTION, '');
}

export function detectEditScope(prompt = '', selectedElement = null) {
  const text = stripMention(prompt);
  if (/\b(?:entire|whole|all|every|global|sitewide|site-wide|throughout|everywhere)\b[\s\S]{0,40}\b(?:site|website|project|app|pages?|theme|colou?rs?|fonts?)\b/i.test(text) ||
      /\b(?:primary|brand|theme|accent) (?:colou?r|font)\b/i.test(text)) return 'project';
  if (/\b(?:this page|the page|whole page|entire page|current page|every section)\b/i.test(text)) return 'page';
  if (/\b(?:section|hero|footer|header|navbar|navigation|banner|area|block)\b/i.test(text) ||
      (selectedElement?.role === 'Section' && /\b(?:look|attractive|modern|polish\w*|beautiful|premium|redesign|improve|spacing|layout)\b/i.test(text))) return selectedElement ? 'section' : 'page';
  return selectedElement ? 'element' : 'page';
}

export function describeEditTarget(prompt, selectedElement) {
  const scope = detectEditScope(prompt, selectedElement);
  const role = (selectedElement?.role || 'element').toLowerCase();
  if (scope === 'project') return { scope, label: 'Whole project (shared theme)' };
  if (scope === 'page') return { scope, label: 'Current page' };
  if (scope === 'section') return { scope, label: selectedElement ? `Selected ${role} and what is inside it` : 'Current page' };
  return { scope, label: `Selected ${role} only` };
}
