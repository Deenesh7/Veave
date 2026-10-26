/**
 * A clone must carry the source site's identity, not the scaffold's placeholders: the browser-tab icon (favicon), page title,
 * and description. The crawler already downloads the favicon into public/assets/icons/ and reads the page title; this wires
 * them into index.html and the web manifest, replacing only values that are still the generic placeholders.
 */

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif' };
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SCAFFOLD_SVG = /^\/favicon\.svg$/;

/** The downloaded favicon: the asset the page's <link rel="icon"> pointed at, else any icons/favicon file. */
function findFavicon(assets = [], files = []) {
  const exists = (a) => a?.publicPath && files.some((f) => f.path === `public${a.publicPath}`);
  const linked = assets.find((a) => exists(a) && (a.associations || []).some((x) => /link\[rel=["'][^"']*icon/i.test(x.selector || '')));
  if (linked) return linked;
  return assets.find((a) => exists(a) && /\/icons\/(?:favicon|apple-touch-icon)/i.test(a.publicPath)) || null;
}

const isPlaceholderTitle = (title) => !title || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(title.trim());
const isPlaceholderDescription = (d) => !d || /- official website\.?$/i.test(d.trim());

function applySourceIdentity(files, { assets = [], title = '', description = '' } = {}) {
  const applied = [];
  const out = files.map((f) => ({ ...f }));
  const index = out.find((f) => f.path === 'index.html');
  if (index && typeof index.content === 'string') {
    let html = index.content;
    const favicon = findFavicon(assets, out);
    if (favicon) {
      const ext = favicon.publicPath.split('.').pop().toLowerCase();
      const link = `<link rel="icon" type="${MIME[ext] || favicon.mimeType || 'image/png'}" href="${favicon.publicPath}" />`;
      const current = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i);
      const currentHref = current && (current[0].match(/href=["']([^"']+)["']/i) || [])[1];
      if (!current) { html = html.replace(/<\/head>/i, `    ${link}\n  </head>`); applied.push('favicon'); }
      else if (SCAFFOLD_SVG.test(currentHref || '')) { html = html.replace(current[0], link); applied.push('favicon'); }
    }
    const currentTitle = (html.match(/<title>([^<]*)<\/title>/i) || [])[1];
    if (title && isPlaceholderTitle(currentTitle)) {
      html = currentTitle === undefined ? html.replace(/<\/head>/i, `    <title>${escapeHtml(title)}</title>\n  </head>`) : html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
      html = html.replace(/(<meta[^>]+property=["']og:title["'][^>]+content=")[^"]*(")/i, `$1${escapeHtml(title)}$2`);
      applied.push('title');
    }
    const currentDescription = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
    if (description && isPlaceholderDescription(currentDescription)) {
      html = html.replace(/(<meta[^>]+name=["']description["'][^>]+content=")[^"]*(")/i, `$1${escapeHtml(description)}$2`);
      html = html.replace(/(<meta[^>]+property=["']og:description["'][^>]+content=")[^"]*(")/i, `$1${escapeHtml(description)}$2`);
      applied.push('description');
    }
    index.content = html;
  }
  const manifest = out.find((f) => f.path === 'public/manifest.json');
  const favicon = findFavicon(assets, out);
  if (manifest && favicon && typeof manifest.content === 'string') {
    try {
      const data = JSON.parse(manifest.content);
      if ((data.icons || []).some((i) => SCAFFOLD_SVG.test(i.src || ''))) {
        data.icons = [{ src: favicon.publicPath, type: favicon.mimeType || MIME[favicon.publicPath.split('.').pop()] || 'image/png', sizes: 'any' }];
        if (title && isPlaceholderTitle(data.name)) { data.name = title; data.short_name = title.slice(0, 12); }
        manifest.content = JSON.stringify(data, null, 2);
        applied.push('manifest');
      }
    } catch { /* leave a malformed manifest alone */ }
  }
  return { files: applied.length ? out : files, applied };
}

module.exports = { applySourceIdentity, findFavicon };
