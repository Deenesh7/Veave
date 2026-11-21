// Pure helpers behind the Content panel (no React, no store), so they can be tested on their own.

export const PHOTO_EXTENSIONS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
export const PHOTO_MIME_TYPES = Object.values(PHOTO_EXTENSIONS).filter((value, index, all) => all.indexOf(value) === index);
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Checks one chosen file before it is sent. The browser's MIME type is only a hint (some report nothing for AVIF), so the file
 * extension is the fallback. The server always re-checks the real bytes. Returns an error a person can act on, or null.
 */
export function validatePhotoFile(file, { maxBytes = MAX_PHOTO_BYTES } = {}) {
  if (!file) return 'Choose a picture to upload.';
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const typeOk = PHOTO_MIME_TYPES.includes(file.type) || (!file.type && Boolean(PHOTO_EXTENSIONS[extension]));
  if (!typeOk) return 'Use a PNG, JPEG, WebP, GIF or AVIF picture.';
  if (file.size === 0) return 'The file is empty.';
  if (file.size > maxBytes) return `The picture is larger than ${Math.round(maxBytes / 1048576)} MB.`;
  return null;
}

/** Image files from a drop or paste, by type or (when the browser gives none) by extension. */
export function imageFilesOf(list) {
  return Array.from(list || []).filter((file) => (file.type ? file.type.startsWith('image/') : Boolean(PHOTO_EXTENSIONS[String(file.name || '').split('.').pop().toLowerCase()])));
}

/** A failed upload is worth retrying only when the file itself was fine (a network or server problem, not a wrong type or size). */
export const isRetryable = (item) => Boolean(item && item.status === 'error' && item.file && !item.invalid && !item.duplicate);

/** A network failure (no response at all), which is worth one automatic retry. */
export const isNetworkFailure = (error) => Boolean(error) && !error.response && error.code !== 'ERR_CANCELED' && error.name !== 'CanceledError';

const slugOf = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

/**
 * The sections the server reports for a page, as [{ id, name, order }]. Accepts the structured list (with stable ids) or plain names
 * (older servers). Ids are made unique, so two sections with the same name never collide as React keys or as selections.
 */
export function normalizeSections(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Map();
  return list.map((raw, order) => {
    const name = String((raw && typeof raw === 'object' ? raw.name : raw) ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    const wanted = raw && typeof raw === 'object' && raw.id ? String(raw.id) : slugOf(name);
    const count = (seen.get(wanted) || 0) + 1;
    seen.set(wanted, count);
    return { id: count === 1 ? wanted : `${wanted}-${count}`, name, domId: (raw && raw.domId) || null, kind: (raw && raw.kind) || null, order };
  }).filter(Boolean).map((item, order) => ({ ...item, order }));
}

/**
 * The photos for a page: the chosen ids that still exist in the library, in the order chosen, never counting anything removed or failed.
 * `count` is what the "n/8" counter shows.
 */
export function pagePhotos(chosen, images, max = 8) {
  const byId = new Map((images || []).map((image) => [image.id, image]));
  const ids = Object.keys(chosen || {}).filter((id) => byId.has(id));
  return { ids, count: ids.length, max, full: ids.length >= max, missing: Object.keys(chosen || {}).length - ids.length };
}

/** The text put in the instruction box when a section is clicked: it names the section so the owner only has to say what to change. */
export const sectionPrefix = (name) => `In the "${String(name).replace(/"/g, "'")}" section: `;

/**
 * Puts the section prefix at the start of the instruction. A prefix added by an earlier click is replaced (not stacked), and
 * whatever the owner already typed after it is kept.
 */
export function withSectionPrefix(text, name, previousName = null) {
  let rest = String(text || '');
  for (const old of [previousName, name]) {
    if (old && rest.startsWith(sectionPrefix(old))) { rest = rest.slice(sectionPrefix(old).length); break; }
  }
  return `${sectionPrefix(name)}${rest}`;
}

/* ---- Sections picked with check boxes: the prompt bar shows their numbers, the AI is sent their names ---- */

const NUMBER_PREFIX = /^Sections? ((?:\d{2,3})(?:, \d{2,3})*): /;
const pad = (n) => String(n).padStart(2, '0');

/** "Section 03: " or "Sections 02, 05: " for the 1-based numbers given (empty when none). */
export const numberPrefix = (numbers) => {
  const list = [...new Set(numbers)].sort((a, b) => a - b);
  if (!list.length) return '';
  return `${list.length === 1 ? 'Section' : 'Sections'} ${list.map(pad).join(', ')}: `;
};

/** Replaces the number prefix at the start of the instruction (never stacks); what the owner typed after it is kept. */
export function withSectionNumbers(text, numbers) {
  const rest = String(text || '').replace(NUMBER_PREFIX, '');
  return `${numberPrefix(numbers)}${rest}`;
}

/** The numbers in the prefix of an instruction, or []. */
export const sectionNumbersIn = (text) => {
  const match = NUMBER_PREFIX.exec(String(text || ''));
  return match ? match[1].split(', ').map(Number) : [];
};

/**
 * What is sent to the AI: the prefix "Sections 02, 05: ..." becomes 'In section 02 ("Name") and section 05 ("Name"): ...' so the model
 * knows exactly which parts are meant. Returns { instruction, focus } (focus = the names, for the job record).
 */
export function expandSectionNumbers(text, sections) {
  const numbers = sectionNumbersIn(text).filter((n) => sections[n - 1]);
  if (!numbers.length) return { instruction: String(text || ''), focus: '' };
  const rest = String(text).replace(NUMBER_PREFIX, '');
  const named = numbers.map((n) => `section ${pad(n)} ("${String(sections[n - 1].name).replace(/"/g, "'")}")`);
  const lead = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  const focus = numbers.map((n) => sections[n - 1].name).join(', ').slice(0, 118);
  return { instruction: `In ${lead}: ${rest}`, focus };
}
