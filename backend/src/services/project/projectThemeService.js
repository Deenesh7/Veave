/**
 * Theme changes for any existing project (colours, fonts, appearance), for example a site that was created from a template.
 *
 * Uses the same managed theme block as template sites (templateTheme): only src/index.css and index.html are rewritten, so pages,
 * text and images are never touched. The colour defaults are read from the project's own :root tokens, so they are right even when the
 * project's colours were customised at creation. `compute` is pure; `save` writes through the normal file save.
 */
const themes = require('../templateSites/templateTheme');
const projectService = require('./projectService');
const { ValidationError } = require('../../utils/errors');

const CSS = 'src/index.css';
const HTML = 'index.html';
const MANAGED = /\n?\/\* veave:theme:start [\s\S]*?\/\* veave:theme:end \*\//;

const hex = (r, g, b) => `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const token = (css, name) => {
  const match = css.match(new RegExp(`--${name}:\\s*(\\d{1,3})[\\s,]+(\\d{1,3})[\\s,]+(\\d{1,3})`));
  return match ? hex(match[1], match[2], match[3]) : null;
};

/** What the project looks like without any theme block: a template-shaped object (designTokens.colors, typography) for templateTheme. */
function baseOf(css) {
  const plain = css.replace(MANAGED, '');
  const colors = {
    bg: token(plain, 'bg') || '#FFFFFF', surface: token(plain, 'surface') || '#F9FAFB', surface2: token(plain, 'surface-2') || '#F3F4F6',
    line: token(plain, 'line') || '#E4E4E7', fg: token(plain, 'fg') || '#18181B', muted: token(plain, 'muted') || '#71717A',
    brand: token(plain, 'brand') || '#18181B', accent: token(plain, 'accent') || token(plain, 'brand') || '#18181B'
  };
  return { usesTokens: Boolean(token(plain, 'bg') && token(plain, 'brand')), template: { designTokens: { colors }, typography: null } };
}

const filesOf = (project) => {
  const css = (project.files || []).find((file) => file.path === CSS);
  if (!css || typeof css.content !== 'string') throw new ValidationError('This project has no src/index.css, so a theme cannot be applied.');
  return css;
};

async function describe(id, userId) {
  const project = await projectService.getById(id, userId, { minLevel: 'viewer' });
  const css = filesOf(project);
  const { template, usesTokens } = baseOf(css.content);
  return { theme: themes.readTheme(project.files), designTokens: template.designTokens, usesTokens };
}

function compute(project, themeInput) {
  const css = filesOf(project);
  const { template } = baseOf(css.content);
  const { theme, adjusted } = themes.normalize(themeInput, template);
  const wanted = project.files.filter((file) => file.path === CSS || file.path === HTML);
  const next = themes.applyTheme(wanted, theme, template);
  return { files: next.map((file) => ({ path: file.path, content: file.content })), adjusted, theme };
}

/** Preview: the changed files, nothing saved. Save: written as normal file saves (access and revision checks included). */
async function apply(id, userId, themeInput, { save = false } = {}) {
  const project = await projectService.getById(id, userId, { minLevel: save ? 'editor' : 'viewer' });
  const result = compute(project, themeInput);
  if (!save) return result;
  let revision = null;
  for (const file of result.files) {
    const original = project.files.find((item) => item.path === file.path);
    if (original && original.content === file.content) continue;
    const saved = await projectService.updateFile(id, userId, file.path, file.content, { baseRevision: revision });
    revision = saved.revision;
  }
  return { ...result, revision };
}

module.exports = { describe, compute, apply };
