'use strict';

// Stage 1: turn whatever the user typed into one canonical reference URL, or say precisely why it cannot be used.
const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_[a-z]+|ref|ref_src|igshid|_ga|_gl|yclid|spm)$/i;
const FILE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp|pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|mp4|mov|webm|mp3|wav|json|csv|txt|xml|css|js|woff2?|ttf|otf)$/i;
const BARE_DOMAIN = /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:[:/?#].*)?$/i;

function normalizeReferenceUrl(input) {
  const raw = String(input ?? '').trim().replace(/[.,;:!?)\]]+$/, '');
  if (!raw) return { ok: false, reason: 'empty', message: 'No website address was given.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { ok: false, reason: 'unsupported-protocol', message: 'Only http and https website addresses can be used.' };
  }
  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) {
    if (!BARE_DOMAIN.test(candidate)) return { ok: false, reason: 'not-a-website', message: `"${raw}" is not a website address.` };
    if (FILE_EXTENSION.test(candidate.split(/[/?#]/)[0])) return { ok: false, reason: 'file-link', message: 'That looks like a file name, not a website address.' };
    candidate = `https://${candidate}`;
  }
  let url;
  try { url = new URL(candidate); } catch { return { ok: false, reason: 'invalid', message: `"${raw}" is not a valid address.` }; }
  if (url.username || url.password) return { ok: false, reason: 'credentials', message: 'Addresses with a username or password are not accepted.' };
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return { ok: false, reason: 'not-a-website', message: `"${url.hostname}" is not a public website address.` };
  if (FILE_EXTENSION.test(url.pathname)) return { ok: false, reason: 'file-link', message: 'That address points to a file, not a website page.' };

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const href = url.href.replace(/\/$/, url.search ? '/' : '');
  return { ok: true, url: href, origin: url.origin, host: url.hostname.replace(/^www\./i, ''), changed: href !== raw };
}

// Canonical key used to recognise "the same route" (no query noise, no trailing slash, no www/http differences).
function routeKey(href, origin) {
  try {
    const url = new URL(href, origin);
    const path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    const keepQuery = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key) && /^(page|p|id|tab|category|cat|slug|lang)$/i.test(key));
    return keepQuery.length ? `${path}?${keepQuery.map(([k, v]) => `${k}=${v}`).sort().join('&')}` : path;
  } catch { return null; }
}

function sameSite(href, origin) {
  try {
    const a = new URL(href, origin).hostname.replace(/^www\./i, '');
    const b = new URL(origin).hostname.replace(/^www\./i, '');
    return a === b;
  } catch { return false; }
}

module.exports = { normalizeReferenceUrl, routeKey, sameSite, FILE_EXTENSION };
