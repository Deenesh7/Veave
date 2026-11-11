/**
 * Which page of a freshly planned website each photo uploaded during creation belongs to. The owner's chosen role decides
 * ("hero" is the home page's main picture, "about" belongs on the page that introduces the organisation, and so on); a photo with no
 * role goes to the home page. The match uses the pages' own names and routes as planned for THIS website, so it works for any kind of site.
 */
const WORDS = {
  about: /\b(about|story|who we are|introduc|overview|history|mission|why)\b/i,
  gallery: /\b(gallery|galleries|photos?|portfolio|campus|facilit|life|events?|showcase|media)\b/i,
  project: /\b(projects?|work|portfolio|programs?|programmes?|courses?|services?|products?|menu|departments?|rooms?|collections?)\b/i
};

const textOf = (page) => `${page.name} ${page.route}`.replace(/[-_/]/g, ' ');

/** Returns the page (of `pages`) that should get a photo with this role; the home page when nothing fits. */
function pageFor(placement, pages) {
  const home = pages.find((page) => page.route === '/') || pages[0];
  const pattern = WORDS[placement];
  if (!pattern) return home;
  return pages.find((page) => page.route !== '/' && pattern.test(textOf(page))) || home;
}

/**
 * @param {Array} photos  [{ path, placement, note }]
 * @param {Array} pages   [{ _id, name, route }]
 * @param {number} max    the most photos one page can be given
 * @returns {Array} [{ photo, page }] (photos beyond a page's limit stay in the library only)
 */
function routePhotos(photos, pages, max = 8) {
  if (!pages.length) return [];
  const count = new Map();
  const out = [];
  for (const photo of photos) {
    const page = pageFor(photo.placement, pages);
    const used = count.get(String(page._id)) || 0;
    if (used >= max) continue;
    count.set(String(page._id), used + 1);
    out.push({ photo, page });
  }
  return out;
}

module.exports = { pageFor, routePhotos };
