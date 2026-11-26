/**
 * Removes one section from a page directly, without the AI. The section is cut out of the page's source exactly as the Content panel
 * numbers it, together with the comment that labels it and any link on the same page that pointed at it (so no dead button is left
 * behind). A section that sits inside a condition, a list or a bracket where cutting it out would break the code is refused with a reason.
 */
const TemplateRevision = require('../../models/TemplateRevision');
const { getPage, idOf } = require('./templateSiteService');
const { assertNoRunningJob, changeFiles, undoFiles, bumpSite, extractSections, jsxElementEnd } = require('./templatePageService');
const { ValidationError } = require('../../utils/errors');

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function cutSection(source, sectionId) {
  const list = extractSections(source, { withRanges: true });
  const item = list.find((entry) => entry.id === sectionId);
  if (!item) throw new ValidationError('That section is no longer on the page. Refresh the list and try again.');
  const start = item.index;
  const sameStart = list.filter((entry) => entry.index === start);
  const inline = sameStart.find((entry) => entry.kind === 'section');
  const next = list.map((entry) => entry.index).filter((index) => index > start).sort((a, b) => a - b)[0];
  const own = inline ? inline.end : jsxElementEnd(source, start);
  if (own === null || own === undefined) throw new ValidationError('This section could not be told apart from the rest of the page code, so it cannot be removed here. Use the AI instruction instead.');
  let end = Math.min(own, next ?? source.length);
  // An inline <section> that was cut at its first nested section does not end at its own closing tag: refuse rather than leave half of it.
  if (inline && !/<\/(?:section|Section)>\s*$/.test(source.slice(start, end))) throw new ValidationError('This section contains other sections, so it cannot be removed here. Use the AI instruction instead.');

  const before = source.slice(0, start).replace(/\s+$/, '');
  const after = source.slice(end).replace(/^\s+/, '');
  const previous = before.slice(-1);
  const following = after.slice(0, 1);
  const standsAlone = (previous === '>' || previous === '}') && (following === '<' || following === '{');
  if (!standsAlone) throw new ValidationError('This section is part of a condition or a list in the page code, so it cannot be removed here without breaking the page. Use the AI instruction instead.');

  let cutFrom = start;
  const label = /\{\s*\/\*[^*]*\*\/\s*\}\s*$/.exec(source.slice(0, start));
  if (label && !/\S/.test(source.slice(0, label.index).split('\n').pop())) cutFrom = label.index;
  const indent = /\n([ \t]*)$/.exec(source.slice(0, cutFrom));
  if (indent) { cutFrom -= indent[1].length; while (/[ \t]/.test(source[end] || '')) end += 1; if (source[end] === '\n') end += 1; }
  let result = `${source.slice(0, cutFrom)}${source.slice(end)}`.replace(/\n[ \t]*\n([ \t]*\n)+/g, '\n\n');

  // A link on this page that jumped to the removed section.
  const anchors = [item.domId].filter(Boolean);
  let links = 0;
  for (const id of anchors) {
    const link = new RegExp(`[ \\t]*<a\\b[^>]*\\bhref=(?:"#${escapeRe(id)}"|'#${escapeRe(id)}'|\\{\\s*['"\`]#${escapeRe(id)}['"\`]\\s*\\})[^>]*>(?:(?!<\\/a>)[^<])*<\\/a>[ \\t]*\\n?`, 'g');
    result = result.replace(link, () => { links += 1; return ''; });
  }
  return { content: result, name: item.name, links };
}

async function removeSection({ user, siteId, pageId, sectionId }) {
  if (!sectionId || typeof sectionId !== 'string') throw new ValidationError('Choose the section to remove.');
  const { site, page } = await getPage(user, siteId, pageId);
  await assertNoRunningJob(site._id, page._id);
  const change = await changeFiles(site, (files) => {
    const file = files.find((entry) => entry.path === page.componentPath);
    if (!file || typeof file.content !== 'string') throw new ValidationError('The page file could not be read.');
    const cut = cutSection(file.content, sectionId);
    return { files: files.map((entry) => (entry.path === file.path ? { ...entry, content: cut.content } : entry)), name: cut.name, links: cut.links };
  });
  if (!change.changed.length) return { changed: false };
  try {
    const updated = await bumpSite(site._id);
    await TemplateRevision.create({
      siteId: site._id, pageId: null, userId: idOf(user), number: updated.revision, kind: 'section-remove',
      instruction: `Removed the section "${change.extra.name}" from ${page.name}`, files: change.changed, before: change.previous, siteRevision: updated.revision
    });
  } catch (error) {
    await undoFiles(site, change);
    throw error;
  }
  return { changed: true, name: change.extra.name, links: change.extra.links };
}

module.exports = { removeSection, cutSection };
