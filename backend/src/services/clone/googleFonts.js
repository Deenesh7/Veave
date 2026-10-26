const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Live Google Fonts catalogue (about 1,900 families with category and popularity), cached in memory and on disk.
const CATALOGUE_URL = 'https://fonts.google.com/metadata/fonts';
const CACHE_FILE = path.join(os.tmpdir(), 'veave-google-fonts.json');
const TTL_MS = 24 * 60 * 60 * 1000;
let memory = null;

async function getCatalogue({ fetchImpl = fetch } = {}) {
  if (memory && Date.now() - memory.at < TTL_MS) return memory.list;
  try {
    const stat = await fs.stat(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < TTL_MS) {
      memory = { at: Date.now(), list: JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) };
      return memory.list;
    }
  } catch { /* no cache yet */ }
  try {
    const response = await fetchImpl(CATALOGUE_URL, { signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    const parsed = JSON.parse(text.slice(text.indexOf('{')));
    const list = (parsed.familyMetadataList || []).map((f) => ({ family: f.family, category: f.category, popularity: f.popularity }));
    if (!list.length) throw new Error('empty catalogue');
    memory = { at: Date.now(), list };
    await fs.writeFile(CACHE_FILE, JSON.stringify(list)).catch(() => {});
    return list;
  } catch (error) {
    // A stale cache is better than nothing.
    try { memory = { at: Date.now() - TTL_MS + 60 * 60 * 1000, list: JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')) }; return memory.list; } catch { throw error; }
  }
}

const names = (stack) => String(stack || '').split(',').map((n) => n.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

/** Exact family from a CSS font stack when Google Fonts offers it. */
function findFamily(catalogue, stack) {
  const lower = new Map((catalogue || []).map((f) => [f.family.toLowerCase(), f]));
  for (const name of names(stack)) {
    const hit = lower.get(name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Category implied by the stack's generic keyword, or null when the stack does not say (then serif and sans compete). */
function categoryOf(stack) {
  const parts = names(stack).map((n) => n.toLowerCase());
  if (parts.some((n) => n === 'monospace' || /\bmono\b/.test(n))) return 'Monospace';
  if (parts.includes('sans-serif') || parts.includes('system-ui') || parts.includes('-apple-system')) return 'Sans Serif';
  if (parts.includes('serif')) return 'Serif';
  return null;
}

function topByCategory(catalogue, category, limit = 40) {
  const pool = (cat) => [...(catalogue || [])].filter((f) => f.category === cat).sort((a, b) => a.popularity - b.popularity).slice(0, limit);
  return category ? pool(category) : [...pool('Serif'), ...pool('Sans Serif')];
}

module.exports = { getCatalogue, findFamily, categoryOf, topByCategory };
