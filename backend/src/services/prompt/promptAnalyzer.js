/**
 * VEAVE Prompt Analyzer
 *
 * Deterministic preflight over the raw user input. This runs BEFORE any
 * LLM call: it normalizes, validates, and lightly classifies the request
 * so downstream stages get consistent input and metadata.
 */

const { ValidationError } = require('../../utils/errors');

const MIN_LEN = 3;
const MAX_LEN = 8000;

const PRODUCT_HINTS = [
  { type: 'dashboard',        keywords: ['dashboard', 'admin', 'analytics', 'kpi', 'metrics'] },
  { type: 'ecommerce',        keywords: ['ecommerce', 'e-commerce', 'shop', 'store', 'product', 'cart', 'checkout'] },
  { type: 'landing',          keywords: ['landing', 'marketing site', 'hero', 'waitlist'] },
  { type: 'saas',             keywords: ['saas', 'subscription', 'pricing'] },
  { type: 'portfolio',        keywords: ['portfolio', 'resume', 'personal site'] },
  { type: 'blog',             keywords: ['blog', 'articles', 'cms', 'newsletter'] },
  { type: 'social',           keywords: ['social', 'feed', 'timeline', 'posts', 'chat'] },
  { type: 'education',        keywords: ['school', 'attendance', 'course', 'lms', 'student', 'teacher', 'parent'] },
  { type: 'banking',          keywords: ['bank', 'banking', 'wallet', 'transaction', 'finance'] },
  { type: 'healthcare',       keywords: ['clinic', 'doctor', 'patient', 'appointment', 'health'] },
  { type: 'productivity',     keywords: ['todo', 'task', 'kanban', 'notes', 'project management'] }
];

const ROLE_HINTS = [
  'admin', 'user', 'customer', 'student', 'teacher', 'parent',
  'buyer', 'seller', 'guest', 'visitor', 'owner', 'manager',
  'operator', 'doctor', 'patient', 'agent'
];

function classify(text) {
  const t = text.toLowerCase();
  const matches = PRODUCT_HINTS.filter(p =>
    p.keywords.some(k => t.includes(k))
  );
  return matches[0]?.type || 'application';
}

function detectRoles(text) {
  const t = text.toLowerCase();
  return ROLE_HINTS.filter(r => new RegExp(`\\b${r}s?\\b`).test(t));
}

function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractExplicitTech(text) {
  const t = text.toLowerCase();
  const tech = {};
  if (/\bnext\.?js\b/.test(t)) tech.framework = 'nextjs';
  else if (/\bvue\b/.test(t)) tech.framework = 'vue';
  else if (/\bsvelte\b/.test(t)) tech.framework = 'svelte';
  else if (/\breact\b/.test(t)) tech.framework = 'react';

  if (/\btypescript\b|\bts\b/.test(t)) tech.language = 'typescript';
  else if (/\bjavascript\b|\bjs\b/.test(t)) tech.language = 'javascript';

  if (/tailwind/.test(t)) tech.styling = 'tailwindcss';
  else if (/chakra/.test(t)) tech.styling = 'chakra-ui';
  else if (/mui|material.?ui/.test(t)) tech.styling = 'mui';

  return tech;
}

/**
 * @param {string} userPrompt
 * @param {{ referenceImage?: object }} [opts]
 * @returns {{
 *   userPrompt: string,
 *   normalized: string,
 *   productType: string,
 *   roles: string[],
 *   explicitTech: object,
 *   hasReferenceImage: boolean
 * }}
 */
function analyze(userPrompt, opts = {}) {
  if (typeof userPrompt !== 'string') {
    throw new ValidationError('userPrompt must be a string');
  }
  const trimmed = userPrompt.trim();
  if (trimmed.length < MIN_LEN) {
    throw new ValidationError('Prompt is too short. Describe what you want to build.');
  }
  if (trimmed.length > MAX_LEN) {
    throw new ValidationError(`Prompt exceeds ${MAX_LEN} characters.`);
  }

  const normalized = normalize(trimmed);

  return {
    userPrompt: trimmed,
    normalized,
    productType: classify(normalized),
    roles: detectRoles(normalized),
    explicitTech: extractExplicitTech(normalized),
    hasReferenceImage: Boolean(opts.referenceImage?.base64)
  };
}

module.exports = { analyze };
