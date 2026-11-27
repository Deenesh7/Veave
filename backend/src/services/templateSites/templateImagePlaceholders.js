/**
 * Pictures a page may not show are turned into the neutral photo placeholder instead of failing the page. A picture file that was made
 * for ANOTHER page, one that does not exist, or one that could not be made is never a reason to throw a rewrite away: the placeholder is
 * shown, and the owner adds a real photo later (or asks for pictures to be generated).
 */
const GENERATED = /\/images\/gen-([a-z0-9-]+)\.jpg/g;
const SLOTS = ['/images/slot-hero.svg', '/images/slot-1.svg', '/images/slot-2.svg', '/images/slot-3.svg'];
const TEXT = /\.(?:jsx?|tsx?|html|css)$/i;
// Always available, even in a site that has no slot files: a plain grey picture with a camera-less "photo" label.
const INLINE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e5e7eb"/><text x="400" y="310" font-family="sans-serif" font-size="28" fill="#6b7280" text-anchor="middle">Photo placeholder</text></svg>')}`;

/** The placeholder path this site has (a slot file), or the inline one. */
function placeholderFor(files, index = 0) {
  const have = SLOTS.filter((slot) => files.some((file) => file.path === `public${slot}`));
  return have.length ? have[index % have.length] : INLINE;
}

/**
 * @param {object[]} files        the candidate files
 * @param {object}   plan         the website plan (plan.images lists the pictures made and the page each belongs to), may be null
 * @param {string}   route        the route of the page being written
 * @param {string[]} changedPaths the files the model changed; only those are touched
 * Returns { files, count, keys }.
 */
function neutralizePictures({ files, plan, route, changedPaths }) {
  const own = new Set((plan?.images || []).filter((entry) => entry.status === 'ready' && entry.path && (entry.page === route || entry.page === null)).map((entry) => entry.key));
  const exists = (key) => files.some((file) => file.path === `public/images/gen-${key}.jpg`);
  const changed = new Set(changedPaths || []);
  const keys = new Set();
  let n = 0;
  const next = files.map((file) => {
    if (!changed.has(file.path) || !TEXT.test(file.path) || typeof file.content !== 'string' || file.encoding === 'base64') return file;
    const content = file.content.replace(GENERATED, (whole, key) => {
      if (own.has(key) && exists(key)) return whole;
      keys.add(key);
      n += 1;
      return placeholderFor(files, n - 1);
    });
    return content === file.content ? file : { ...file, content };
  });
  return { files: n ? next : files, count: n, keys: [...keys] };
}

module.exports = { neutralizePictures, placeholderFor };
