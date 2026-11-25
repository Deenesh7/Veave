/**
 * Pictures made by the AI for ONE page or section edit ("add a photo of the campus to the hero", "put a picture above each programme").
 * The owner's words decide whether new pictures are wanted; a small planning call decides what each one shows, where it goes and its
 * shape; the image model (IMAGE_GENERATE_MODEL) makes them. They are then given to the page writer exactly like photos the owner
 * uploaded, so the same rules place them (in the section named) and the same checks prove every one of them is really on the page.
 */
const logger = require('../../utils/logger');

const PICTURE_WORDS = /\b(images?|photos?|pictures?|photographs?|illustrations?|visuals?|imagery|banner image|hero image|thumbnails?)\b/i;
// "remove the image", "no pictures", "without photos": the owner wants fewer pictures, not new ones.
const FEWER = /\b(?:remove|delete|get rid of|take out|hide|without|no)\s+(?:the\s+|all\s+|any\s+|these\s+|this\s+)?(?:\w+\s+)?(?:images?|photos?|pictures?|photographs?)\b/i;
const maxPictures = () => { const value = Number.parseInt(process.env.PAGE_IMAGE_MAX, 10); return Number.isInteger(value) && value >= 0 ? value : 8; };
const ASPECTS = new Set(['16:9', '4:3', '1:1']);

/** Does the owner ask for pictures that do not exist yet (and attached none)? */
function wantsPictures(ownerWords, attachments = []) {
  const text = String(ownerWords || '');
  if (attachments.length || !maxPictures()) return false;
  return PICTURE_WORDS.test(text) && !FEWER.test(text);
}

const SYSTEM = `You plan the pictures an AI image model will make for ONE change to a page of a website.

Answer JSON only: {"pictures":[{"subject":string,"section":string,"record":string,"aspect":"16:9"|"4:3"|"1:1","alt":string}]}

Rules:
1. Plan a picture only for what the owner asks to ADD or REPLACE with a new picture. If the owner only wants pictures removed, moved or kept, or refers to photos already on the site, answer {"pictures":[]}.
2. One entry per picture the owner asked for ("a photo of the campus" is one; "a picture on each programme card" is one per card, at most MAX). Never more than MAX.
3. "subject" describes a real photograph for this website in plain words (what is in it, the setting), for example "medical students in a bright anatomy lab". No text, logos, signs, certificates or recognisable people in it.
4. "section" is the name of the section of the page it belongs to, copied from SECTIONS ("" when the owner named no place).
5. "aspect": 16:9 for a hero or a wide banner, 4:3 for a card or a picture beside text, 1:1 for a square tile or a portrait-style picture.
6. "alt" is the alt text for the picture on the page (one short sentence).
7. When RECORDS are listed, the section shows one card per record. A picture for "all", "every" or "each" card (or for the cards in general) is one picture PER RECORD, each showing that record's own subject ("Pharmacology" -> "pharmacy students measuring medicines in a teaching lab"), with "record" set to the record's name exactly as listed. A picture for one named card has that record's name. Otherwise "record" is "".
8. "section" is the section named under SECTION when one is given.`;

function parseJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { return null; }
}

function defaultAsk() {
  const openrouter = require('../ai/openrouterService');
  return async (messages, { signal } = {}) => {
    const result = await openrouter.generateCompletion(messages, { temperature: 0, max_tokens: 1200, response_format: false, reasoning: { effort: 'low', exclude: true }, timeout: 60000, signal });
    return { content: String(result?.content || ''), usage: result?.usage || null };
  };
}

/** What pictures to make: [{ subject, section, aspect, alt }] (empty when none are wanted or the plan cannot be made). */
async function planPictures({ ownerWords, page, sections = [], website = '', records = [], recordsPath = '', focus = '', deps = {}, signal }) {
  const ask = deps.askPicturePlan || (process.env.OPENROUTER_API_KEY ? defaultAsk() : null);
  if (!ask) return { pictures: [], usage: null };
  const max = maxPictures();
  const messages = [
    { role: 'system', content: SYSTEM.replace(/MAX/g, String(max)) },
    { role: 'user', content: `WEBSITE: ${website || 'this website'}\nPAGE: ${page.name} (${page.route})\nSECTIONS: ${sections.join('; ') || '(none listed)'}${focus ? `\nSECTION: ${focus}` : ''}${records.length ? `\nRECORDS (one card each, from ${recordsPath || 'the data file'}): ${records.join('; ')}` : ''}\n\nOWNER INSTRUCTION:\n${String(ownerWords).slice(0, 2500)}` }
  ];
  try {
    const answer = await ask(messages, { signal });
    const parsed = parseJson(answer.content);
    const list = Array.isArray(parsed?.pictures) ? parsed.pictures : [];
    const pictures = list.slice(0, max).map((item) => ({
      subject: String(item?.subject || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      section: sections.includes(String(item?.section || '').trim()) ? String(item.section).trim() : (focus || ''),
      record: records.includes(String(item?.record || '').trim()) ? String(item.record).trim() : '',
      recordsPath: records.includes(String(item?.record || '').trim()) ? recordsPath : '',
      aspect: ASPECTS.has(item?.aspect) ? item.aspect : '4:3',
      alt: String(item?.alt || item?.subject || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    })).filter((item) => item.subject.length >= 8);
    return { pictures, usage: answer.usage };
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`The pictures for the ${page.name} page could not be planned: ${error.message}`);
    return { pictures: [], usage: null };
  }
}

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'picture';

/**
 * The planned pictures as entries for generateSiteImages (one file each, named after the page, the subject and the job), and, once made,
 * as attachments for the page writer (placed in their section, with their alt text).
 */
const entriesFor = (pictures, page, jobId) => pictures.map((item, index) => ({ key: `${slug(page.name)}-${slug(item.record || item.subject)}-${String(jobId).slice(-6)}-${index + 1}`, page: page.route, subject: item.subject, aspect: item.aspect, alt: item.alt, section: item.section, record: item.record || '', recordsPath: item.recordsPath || '', status: 'pending' }));
const escapeXml = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SIZES = { '16:9': [1600, 900], '4:3': [1200, 900], '1:1': [1000, 1000] };

/**
 * A neutral picture slot for a picture that could not be made (provider error, no credits, picture generation switched off): a soft
 * gradient with a landscape icon and the subject written on it, in the shape that was asked for. The page uses it exactly where the
 * picture was wanted, so the layout is right and the owner can swap in a real photo later with the image button.
 */
function placeholderFile(entry) {
  const [width, height] = SIZES[entry.aspect] || SIZES['4:3'];
  const subject = escapeXml(String(entry.subject || entry.alt || 'Picture').slice(0, 70));
  const cx = width / 2;
  const cy = height / 2;
  const unit = Math.min(width, height) / 10;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${subject}"><title>${subject}</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E7E2D6"/><stop offset="1" stop-color="#CFC8B6"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><g fill="none" stroke="#8F8878" stroke-width="${Math.max(4, unit / 8)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${cx - unit * 1.5} ${cy - unit * 1.6})"><rect x="0" y="0" width="${unit * 3}" height="${unit * 2.2}" rx="${unit / 5}"/><circle cx="${unit * 0.9}" cy="${unit * 0.8}" r="${unit * 0.28}"/><path d="M0 ${unit * 1.9} L${unit * 1.0} ${unit * 1.2} L${unit * 1.8} ${unit * 1.7} L${unit * 2.3} ${unit * 1.3} L${unit * 3} ${unit * 1.9}"/></g><text x="${cx}" y="${cy + unit * 1.6}" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="${Math.round(unit * 0.42)}" fill="#6B6557">${subject}</text></svg>`;
  return { path: `public/images/placeholder-${entry.key}.svg`, content: svg, language: 'svg', encoding: 'utf8' };
}

const asAttachments = (entries) => entries.filter((entry) => entry.status === 'ready' && entry.path).map((entry) => ({
  path: entry.path, name: entry.alt || entry.subject, kind: 'image', mime: entry.placeholder ? 'image/svg+xml' : 'image/jpeg', width: entry.width || 0, height: entry.height || 0, alt: entry.alt, caption: entry.subject, tags: [],
  placement: entry.section ? `section:${entry.section}` : '', record: entry.record || '', recordsPath: entry.recordsPath || '',
  note: entry.placeholder
    ? `PLACEHOLDER: the real picture (${entry.subject}) could not be made, so this neutral placeholder stands in for it. Use it exactly where that picture was asked for${entry.record ? `, as the picture field (image) of the record "${entry.record}" of ${entry.recordsPath || 'its data file'}` : (entry.section ? `, in the "${entry.section}" section` : '')}, with alt="${String(entry.alt || '').replace(/"/g, "'")}". Keep the layout exactly as it would be with the real picture.`
    : entry.record
    ? `Made for the record "${entry.record}" of ${entry.recordsPath || 'its data file'} (${entry.subject}). Set THAT record's picture field (image) to this path, so its card shows it; alt="${String(entry.alt || '').replace(/"/g, "'")}".`
    : `Made for this change: ${entry.subject}. Use alt="${String(entry.alt || '').replace(/"/g, "'")}"${entry.section ? `, in the "${entry.section}" section` : ', where the instruction asks for it'}.`
}));

module.exports = { wantsPictures, planPictures, entriesFor, asAttachments, placeholderFile, maxPictures, SYSTEM };
