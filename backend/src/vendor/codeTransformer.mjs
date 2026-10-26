export function repairAndSanitizeReactCode(code) {
  if (!code) return '';
  let str = String(code);

  // 1. Strip TypeScript interfaces: interface Foo { ... }
  // Only real declarations: at the start of a line, with the body brace right after the name (or `extends ...`).
  // An unanchored match deleted everything from the word "interface" inside JSX text (e.g. "a modern interface
  // carefully designed...") up to the next closing brace, truncating the component.
  str = str.replace(/^[ \t]*(?:export\s+)?(?:declare\s+)?interface\s+\w+(?:<[^>\n{]*>)?(?:\s+extends\s+[^{\n]+)?\s*\{[\s\S]*?\n[ \t]*\}[ \t]*/gm, '');

  // 2. Strip TypeScript types: type Foo = ...;  (same rule: a declaration starts a line and `=` follows the name)
  str = str.replace(/^[ \t]*(?:export\s+)?(?:declare\s+)?type\s+\w+(?:<[^>\n=]*>)?\s*=\s*[^;]+;/gm, '');

  // 3. Strip const NAME: Type[] =
  str = str.replace(/:\s*[A-Z]\w*(?:\[\])?\s*=/g, ' =');

  // 4. Strip generic arguments in hooks: useState<...>
  str = str.replace(/useState<[^>]+>\(/g, 'useState(');
  str = str.replace(/useRef<[^>]+>\(/g, 'useRef(');
  str = str.replace(/useCallback<[^>]+>\(/g, 'useCallback(');
  str = str.replace(/useMemo<[^>]+>\(/g, 'useMemo(');

  // (Removed Rule 5 as it breaks JS objects. Babel typescript preset handles types natively.)

  // 6. Fix className={px-4 py-2 ... ${...}} without backticks
  str = str.replace(/className=\{([a-zA-Z0-9_\-\[\]\/\#\:\.]+(?:\s+[a-zA-Z0-9_\-\[\]\/\#\:\.]+)*\s*\$\{[\s\S]*?\})\}/g, 'className={`$1`}');

  // 7. Fix function calls with unquoted template literal: triggerToast(Viewing ${...})
  str = str.replace(/([a-zA-Z0-9_]+)\(\s*([A-Za-z][^'"`\(\)]*\$\{[^}]+\}[^'"`\(\)]*)\)/g, '$1(`$2`)');

  // 8. Fix empty ternary expressions {isAudioMuted ? : } or {cond ? : }
  str = str.replace(/\{\s*isAudioMuted\s*\?\s*:\s*\}/g, '{isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}');
  // Only an empty ternary consequent (`cond ? : alt`); never touch regex groups like (?:...) or optional TS props.
  str = str.replace(/(?<=\s)\?\s+:(?=\s)/g, '? null :');

  // 9. Fix stray "avatar" line in JSX
  str = str.replace(/^[ \t]*"avatar"[ \t]*$/gm, '{/* avatar */}');

  // 10. Strictly sanitize and eliminate any purple / violet / fuchsia / lavender classes and hex codes
  str = str.replace(/\b(text|bg|border|ring|fill|stroke|from|to|via)-purple-(\d+)\b/g, '$1-blue-$2');
  str = str.replace(/\b(text|bg|border|ring|fill|stroke|from|to|via)-violet-(\d+)\b/g, '$1-indigo-$2');
  str = str.replace(/\b(text|bg|border|ring|fill|stroke|from|to|via)-fuchsia-(\d+)\b/g, '$1-sky-$2');
  str = str.replace(/#(?:7C3AED|8B5CF6|A855F7|C084FC|E9D5FF|A78BFA)\b/gi, '#18181B');

  return str;
}

function extractCodeFromJsonOrTruncated(str) {
  if (!str) return '';
  const match = str.match(/"(?:src\/)?App\.jsx"\s*:\s*"/);
  if (!match) return null;
  const startIndex = match.index + match[0].length;
  let inner = str.slice(startIndex);

  const closingMatch = inner.match(/(?<!\\)"\s*(?:,|\})/);
  if (closingMatch) {
    inner = inner.slice(0, closingMatch.index);
  } else {
    if (inner.endsWith('\\')) inner = inner.slice(0, -1);
    if (inner.endsWith('"')) inner = inner.slice(0, -1);
  }

  for (let i = 0; i <= 20; i++) {
    try {
      const candidate = '"' + inner.slice(0, inner.length - i) + '"';
      return JSON.parse(candidate);
    } catch (e) {}
  }

  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function cleanSourceCode(content) {
  if (!content) return '';
  let str = String(content).trim();
  if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('```json') && str.endsWith('```'))) {
    try {
      const cleanJson = str.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed['src/App.jsx'] && typeof parsed['src/App.jsx'] === 'string') return repairAndSanitizeReactCode(parsed['src/App.jsx'].trim());
      if (parsed['App.jsx'] && typeof parsed['App.jsx'] === 'string') return repairAndSanitizeReactCode(parsed['App.jsx'].trim());
      if (parsed.code && typeof parsed.code === 'string') return repairAndSanitizeReactCode(parsed.code.trim());
      if (parsed.react && typeof parsed.react === 'string') return repairAndSanitizeReactCode(parsed.react.trim());
      if (parsed.component && typeof parsed.component === 'string') return repairAndSanitizeReactCode(parsed.component.trim());
      if (parsed.app && typeof parsed.app === 'string') return repairAndSanitizeReactCode(parsed.app.trim());
    } catch (e) {}
  }
  str = str.replace(/^```(?:jsx|tsx|javascript|typescript|react)?\s*\n?/i, '')
           .replace(/\n?```\s*$/i, '')
           .trim();
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (parsed['src/App.jsx'] && typeof parsed['src/App.jsx'] === 'string') return repairAndSanitizeReactCode(parsed['src/App.jsx'].trim());
      if (parsed['App.jsx'] && typeof parsed['App.jsx'] === 'string') return repairAndSanitizeReactCode(parsed['App.jsx'].trim());
      if (parsed.code && typeof parsed.code === 'string') return repairAndSanitizeReactCode(parsed.code.trim());
      if (parsed.react && typeof parsed.react === 'string') return repairAndSanitizeReactCode(parsed.react.trim());
      if (parsed.component && typeof parsed.component === 'string') return repairAndSanitizeReactCode(parsed.component.trim());
      if (parsed.app && typeof parsed.app === 'string') return repairAndSanitizeReactCode(parsed.app.trim());
    } catch (e) {}
  }
  if (str.startsWith('{') && (str.includes('"src/App.jsx"') || str.includes('"App.jsx"'))) {
    try {
      const parsed = JSON.parse(str);
      if (parsed['src/App.jsx']) return repairAndSanitizeReactCode(parsed['src/App.jsx'].trim());
      if (parsed['App.jsx']) return repairAndSanitizeReactCode(parsed['App.jsx'].trim());
    } catch (e) {}
    const extracted = extractCodeFromJsonOrTruncated(str);
    if (extracted) return repairAndSanitizeReactCode(extracted.trim());
  }
  return repairAndSanitizeReactCode(str);
}

const PREVIEW_ASSET_MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon'
};

export function inlinePreviewAssets(files = []) {
  const replacements = [];
  for (const file of files) {
    if (file?.encoding !== 'base64' || !file.path?.startsWith('public/')) continue;
    const extension = file.path.split('.').pop()?.toLowerCase();
    const mimeType = PREVIEW_ASSET_MIME_TYPES[extension];
    if (!mimeType || !file.content) continue;
    const publicPath = `/${file.path.slice('public/'.length)}`;
    const dataUrl = `data:${mimeType};base64,${file.content}`;
    replacements.push([publicPath, dataUrl], [file.path, dataUrl]);
  }
  if (!replacements.length) return files;
  replacements.sort((a, b) => b[0].length - a[0].length);
  return files.map((file) => {
    if (file?.encoding === 'base64') return file;
    let content = String(file?.content || '');
    for (const [assetPath, dataUrl] of replacements) content = content.split(assetPath).join(dataUrl);
    return { ...file, content };
  });
}

function collectReferencedPreviewAssets(files = [], { allowEmptyContent = false } = {}) {
  const assets = [];
  const textFiles = files.filter((file) => file && file.encoding !== 'base64' && /\.(?:jsx?|tsx?|css|html)$/i.test(file.path || ''));
  const corpus = textFiles.map((file) => String(file.content || '')).join('\n');
  for (const file of files) {
    if (file?.encoding !== 'base64' || !file.path?.startsWith('public/')) continue;
    if (!file.content && !allowEmptyContent) continue;
    const mimeType = PREVIEW_ASSET_MIME_TYPES[file.path.split('.').pop()?.toLowerCase()];
    if (!mimeType) continue;
    const publicPath = `/${file.path.slice('public/'.length)}`;
    if (!corpus.includes(publicPath)) continue;
    assets.push({ publicPath, mimeType, base64: file.content });
  }
  return assets;
}

function replacePreviewAssetPaths(content, assets, assetBase = '') {
  let result = content;
  for (const asset of assets) {
    if (!result.includes(asset.publicPath)) continue;
    // External mode points at the asset server; inline mode embeds the bytes as a data URL.
    const replacement = assetBase ? `${assetBase}${asset.publicPath}` : `data:${asset.mimeType};base64,${asset.base64}`;
    result = result.split(asset.publicPath).join(replacement);
  }
  return result;
}

// External mode: asset bytes are NOT embedded. The shim only knows which public paths exist and rewrites
// references to `${assetBase}${path}`, so the document stays small and the browser caches the files.
function buildExternalAssetShim(assets, assetBase) {
  if (!assets.length) return '';
  const paths = JSON.stringify(Object.fromEntries(assets.map((asset) => [asset.publicPath, 1]))).replace(/</g, '\\u003c');
  const base = JSON.stringify(assetBase).replace(/</g, '\\u003c');
  return `<script>
    (function() {
      var known = ${paths};
      var base = ${base};
      function resolve(value) {
        if (typeof value !== 'string' || !value) return value;
        var key = value.split('?')[0].split('#')[0];
        if (key.charAt(0) !== '/') key = '/' + key;
        return known[key] ? base + key : value;
      }
      function fixSrcset(value) {
        return String(value).split(',').map(function(part) {
          var bits = part.trim().split(/\\s+/); bits[0] = resolve(bits[0]); return bits.join(' ');
        }).join(', ');
      }
      function fixStyle(value) {
        return String(value).replace(/url\\((['"]?)([^)'"]+)\\1\\)/g, function(_, q, u) { return 'url(' + q + resolve(u) + q + ')'; });
      }
      var nativeSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        var lower = String(name).toLowerCase();
        if (lower === 'src' || lower === 'poster') value = resolve(value);
        else if (lower === 'srcset') value = fixSrcset(value);
        else if (lower === 'style') value = fixStyle(value);
        return nativeSetAttribute.call(this, name, value);
      };
      function fixElement(el) {
        if (!el || el.nodeType !== 1) return;
        ['src', 'poster'].forEach(function(attr) {
          var v = el.getAttribute(attr); var r = resolve(v);
          if (v && r !== v) nativeSetAttribute.call(el, attr, r);
        });
        var srcset = el.getAttribute('srcset');
        if (srcset) nativeSetAttribute.call(el, 'srcset', fixSrcset(srcset));
        var style = el.getAttribute('style');
        if (style && style.indexOf('url(') !== -1) nativeSetAttribute.call(el, 'style', fixStyle(style));
      }
      function scan(root) {
        fixElement(root);
        if (root.querySelectorAll) root.querySelectorAll('[src],[srcset],[poster],[style]').forEach(fixElement);
      }
      new MutationObserver(function(records) {
        records.forEach(function(r) {
          if (r.type === 'attributes') fixElement(r.target);
          else r.addedNodes.forEach(scan);
        });
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'style'] });
    })();
  <\/script>`;
}

function buildPreviewAssetShim(assets) {
  if (!assets.length) return '';
  const map = {};
  for (const asset of assets) map[asset.publicPath] = [asset.mimeType, asset.base64];
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  return `<script>
    (function() {
      var assets = ${json};
      var urls = {};
      function resolve(value) {
        if (typeof value !== 'string' || value.indexOf('assets/') === -1) return value;
        var key = value.split('?')[0].split('#')[0];
        if (key.charAt(0) !== '/') key = '/' + key;
        var entry = assets[key];
        if (!entry) return value;
        if (!urls[key]) {
          var bin = atob(entry[1]); var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          urls[key] = URL.createObjectURL(new Blob([bytes], { type: entry[0] }));
        }
        return urls[key];
      }
      function fixSrcset(value) {
        return String(value).split(',').map(function(part) {
          var bits = part.trim().split(/\\s+/); bits[0] = resolve(bits[0]); return bits.join(' ');
        }).join(', ');
      }
      function fixStyle(value) {
        return String(value).replace(/url\\((['"]?)([^)'"]+)\\1\\)/g, function(_, q, u) { return 'url(' + q + resolve(u) + q + ')'; });
      }
      var nativeSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        var lower = String(name).toLowerCase();
        if (lower === 'src' || lower === 'poster') value = resolve(value);
        else if (lower === 'srcset') value = fixSrcset(value);
        else if (lower === 'style') value = fixStyle(value);
        return nativeSetAttribute.call(this, name, value);
      };
      function fixElement(el) {
        if (!el || el.nodeType !== 1) return;
        ['src', 'poster'].forEach(function(attr) {
          var v = el.getAttribute(attr); var r = resolve(v);
          if (v && r !== v) nativeSetAttribute.call(el, attr, r);
        });
        var srcset = el.getAttribute('srcset');
        if (srcset && srcset.indexOf('assets/') !== -1) nativeSetAttribute.call(el, 'srcset', fixSrcset(srcset));
        var style = el.getAttribute('style');
        if (style && style.indexOf('assets/') !== -1) nativeSetAttribute.call(el, 'style', fixStyle(style));
      }
      function scan(root) {
        fixElement(root);
        if (root.querySelectorAll) root.querySelectorAll('[src],[srcset],[poster],[style]').forEach(fixElement);
      }
      new MutationObserver(function(records) {
        records.forEach(function(r) {
          if (r.type === 'attributes') fixElement(r.target);
          else r.addedNodes.forEach(scan);
        });
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'style'] });
    })();
  <\/script>`;
}

/**
 * @param {object} [options]
 * @param {string} [options.assetBase] When set (e.g. a URL or a placeholder token), images/fonts under public/ are referenced
 *   as `${assetBase}/path` instead of being embedded as base64. Used for stored, precompiled previews.
 */
export function buildPreviewHTML(files, dependencies = [], options = {}) {
  const assetBase = options.assetBase || '';
  if (!files || files.length === 0) {
    return '<html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#09090b;color:#71717a;font-family:Inter,system-ui,sans-serif"><p>No files to preview</p></body></html>';
  }

  // Assets are NOT inlined into source files: pasting base64 images into every
  // JSX/JS module made the modules megabytes large and Babel standalone choked
  // (blank preview). CSS gets data URLs for referenced assets only; JS/JSX keeps
  // short paths and a runtime shim resolves them to blob URLs.
  const previewAssets = collectReferencedPreviewAssets(files, { allowEmptyContent: Boolean(assetBase) });
  const previewFiles = files.map((file) => (
    file?.path?.endsWith('.css') && file.encoding !== 'base64'
      ? { ...file, content: replacePreviewAssetPaths(String(file.content || ''), previewAssets, assetBase) }
      : file
  ));
  const cssFiles = previewFiles.filter((f) => f.path.endsWith('.css'));
  const cssContent = cssFiles.map((f) => f.content || '').join('\n');

  const jsFiles = previewFiles.filter((f) => {
    if (!f?.path) return false;
    // Skip config files
    if (f.path.endsWith('.config.js') || f.path.endsWith('.config.ts')) return false;
    // Skip the project entry point — the preview harness below has its own
    // ReactDOM.createRoot bootstrap. Executing the exported main.jsx would
    // double-render (or render before App is registered → blank iframe).
    if (/(^|\/)main\.(jsx|js|tsx|ts)$/.test(f.path)) return false;
    return f.path.endsWith('.jsx') || f.path.endsWith('.js') || f.path.endsWith('.tsx') || f.path.endsWith('.ts');
  });

  const sortedFiles = sortFilesByDependency(jsFiles);

  const fileScripts = sortedFiles
    .map((file) => {
      const transformed = transformFileContent(file);
      return `
    <script type="text/babel" data-presets="react,typescript" data-filename="${file.path}">
    // Module: ${file.path}
    (function() {
      try {
        ${transformed}
      } catch(e) {
        console.error('Error in ${file.path}:', e);
        window.parent.postMessage({type:'preview-error', error:{message: 'Error in ${file.path}: ' + e.message}}, '*');
      }
    })();
    </script>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <base target="_self" />
  <link rel="preconnect" href="https://unpkg.com" crossorigin />
  <link rel="preconnect" href="https://cdn.tailwindcss.com" crossorigin />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  ${assetBase ? buildExternalAssetShim(previewAssets, assetBase) : buildPreviewAssetShim(previewAssets)}
  <script>
    // srcdoc/sandboxed previews cannot change location.pathname (it stays "srcdoc"
    // and history.pushState throws), so every route rendered Home. Keep a virtual
    // path instead and route history/location reads through it.
    (function() {
      var virtualPath = '/';
      window.__veavePathname = function() { return virtualPath; };
      // A page opened by navigation starts at its top, also when the scrolling happens in a container instead of the window.
      function scrollPageToTop() {
        try {
          window.scrollTo(0, 0);
          if (document.documentElement) document.documentElement.scrollTop = 0;
          if (document.body) document.body.scrollTop = 0;
          var all = document.querySelectorAll('body *');
          for (var i = 0; i < all.length && i < 3000; i++) {
            var el = all[i];
            if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTop = 0;
          }
        } catch (e) {}
      }
      function setPath(url) {
        if (typeof url !== 'string' || !url) return;
        var before = virtualPath;
        try { virtualPath = new URL(url, 'http://preview.local' + virtualPath).pathname || '/'; } catch (e) {}
        if (virtualPath !== before && !/#./.test(url)) {
          scrollPageToTop();
          // The new page renders after this call, and may be shorter or taller: scroll again once it is in the DOM.
          setTimeout(scrollPageToTop, 0);
          setTimeout(scrollPageToTop, 60);
          setTimeout(scrollPageToTop, 250);
        }
      }
      history.pushState = function(state, title, url) { setPath(url); };
      history.replaceState = function(state, title, url) { setPath(url); };
    })();
  <\/script>
  <script>
    // The preview iframe is sandboxed without allow-same-origin, so touching localStorage/sessionStorage throws
    // "The document is sandboxed" and crashes apps that read a saved theme/cart/token while rendering. Fall back
    // to in-memory storage so such sites render exactly as they would on a real page.
    (function() {
      function memoryStorage() {
        var data = {};
        return {
          getItem: function(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
          setItem: function(k, v) { data[String(k)] = String(v); },
          removeItem: function(k) { delete data[k]; },
          clear: function() { data = {}; },
          key: function(i) { return Object.keys(data)[i] || null; },
          get length() { return Object.keys(data).length; }
        };
      }
      ['localStorage', 'sessionStorage'].forEach(function(name) {
        var usable = true;
        try { var s = window[name]; s.getItem('__veave'); } catch (e) { usable = false; }
        if (!usable) {
          try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (e) {}
        }
      });
    })();
  <\/script>
  <title>Preview</title>
  <script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    body[data-veave-inspect="true"] * {
      cursor: pointer !important;
    }
    body[data-veave-inspect="true"] input,
    body[data-veave-inspect="true"] textarea,
    body[data-veave-inspect="true"] [contenteditable="true"] {
      cursor: text !important;
    }
    body[data-veave-inspect="true"] div[class*="bg-gradient-"][class*="inset-0"]:empty,
    body[data-veave-inspect="true"] div[class*="backdrop-"][class*="inset-0"]:empty,
    body[data-veave-inspect="true"] div.absolute.inset-0:empty,
    body[data-veave-inspect="true"] [class*="pointer-events-none"] {
      pointer-events: none !important;
    }
    .veave-inspect-highlight {
      outline: 2px dashed #2563EB !important;
      outline-offset: 2px !important;
      transition: outline 0.05s ease-out;
    }
    .veave-inspect-selected {
      outline: 2.5px solid #2563EB !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(37,99,235,0.2) !important;
    }
    @keyframes veave_spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    ${cssContent.replace(/@tailwind\s+(base|components|utilities);?/g, '').replace(/@import\s+[^;]+;/g, '').replace(/@apply\s+([^;]+);/g, (_, classes) => `/* @apply ${classes} */`)}
  </style>
</head>
<body data-veave-inspect="true">
  <div id="root">
    <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#FAFBFD;color:#71717a;font-family:Inter,system-ui,sans-serif;">
      <div style="width:36px;height:36px;border:3px solid #E2E8F0;border-top-color:#27272A;border-radius:50%;animation:veave_spin 0.8s linear infinite;margin-bottom:12px;"></div>
      <div style="font-size:12px;font-weight:600;color:#64748B;letter-spacing:0.02em;">Loading canvas...</div>
    </div>
  </div>

  <script>
    (function() {
      function currentPath() { var value = window.__veavePathname() || '/'; return value.charAt(0) === '/' ? value : '/'; }
      var RouterContext = React.createContext({ path: currentPath(), navigate: function() {} });
      function matches(pattern, pathname) {
        if (!pattern || pattern === '*') return true;
        var cleanPattern = String(pattern).replace(/\\\/$/, '') || '/';
        var cleanPath = String(pathname).replace(/\\\/$/, '') || '/';
        if (cleanPattern === cleanPath) return true;
        var patternParts = cleanPattern.split('/').filter(Boolean);
        var pathParts = cleanPath.split('/').filter(Boolean);
        if (patternParts[patternParts.length - 1] === '*') {
          var base = patternParts.slice(0, -1);
          return pathParts.length >= base.length && base.every(function(part, index) { return part.charAt(0) === ':' || part === pathParts[index]; });
        }
        if (patternParts.length !== pathParts.length) return false;
        return patternParts.every(function(part, index) { return part.charAt(0) === ':' || part === pathParts[index]; });
      }
      function BrowserRouter(props) {
        var state = React.useState(currentPath());
        var path = state[0], setPath = state[1];
        React.useEffect(function() {
          var update = function() { setPath(currentPath()); };
          window.addEventListener('popstate', update);
          return function() { window.removeEventListener('popstate', update); };
        }, []);
        var navigate = function(to, options) {
          if (typeof to === 'number') { window.history.go(to); return; }
          var next = typeof to === 'string' ? to : (to && to.pathname) || '/';
          window.history[options && options.replace ? 'replaceState' : 'pushState']({}, '', next);
          setPath(currentPath());
          window.dispatchEvent(new PopStateEvent('popstate'));
        };
        return React.createElement(RouterContext.Provider, { value: { path: path, navigate: navigate } }, props.children);
      }
      function HashRouter(props) { return React.createElement(BrowserRouter, props); }
      function MemoryRouter(props) { return React.createElement(BrowserRouter, props); }
      function Route() { return null; }
      function Routes(props) {
        var path = React.useContext(RouterContext).path;
        var routes = React.Children.toArray(props.children);
        var selected = routes.find(function(route) { return route && route.props && route.props.path && route.props.path !== '*' && matches(route.props.path, path); }) ||
          routes.find(function(route) { return route && route.props && route.props.index && path === '/'; }) ||
          routes.find(function(route) { return route && route.props && (route.props.path === '*' || !route.props.path); });
        return selected ? selected.props.element || null : null;
      }
      function Link(props) {
        var router = React.useContext(RouterContext);
        var next = Object.assign({}, props);
        var to = next.to || '/';
        delete next.to;
        var original = next.onClick;
        next.href = typeof to === 'string' ? to : to.pathname;
        next.onClick = function(event) {
          if (original) original(event);
          if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey) { event.preventDefault(); router.navigate(to); }
        };
        return React.createElement('a', next, props.children);
      }
      function NavLink(props) {
        var path = React.useContext(RouterContext).path;
        var active = matches(props.to, path);
        var next = Object.assign({}, props, {
          className: typeof props.className === 'function' ? props.className({ isActive: active, isPending: false }) : props.className,
          children: typeof props.children === 'function' ? props.children({ isActive: active, isPending: false }) : props.children
        });
        return React.createElement(Link, next);
      }
      function useNavigate() { return React.useContext(RouterContext).navigate; }
      function useLocation() { var path = React.useContext(RouterContext).path; return { pathname: path, search: window.location.search, hash: window.location.hash, state: null }; }
      function useParams() { return {}; }
      function useSearchParams() {
        var navigate = useNavigate();
        var params = new URLSearchParams(window.location.search);
        return [params, function(next) { var value = next instanceof URLSearchParams ? next.toString() : new URLSearchParams(next).toString(); navigate(window.location.pathname + (value ? '?' + value : '')); }];
      }
      function Navigate(props) { var navigate = useNavigate(); React.useEffect(function() { navigate(props.to, { replace: props.replace !== false }); }, [props.to]); return null; }
      function Redirect(props) { return React.createElement(Navigate, props); }
      function Outlet() { return null; }
      function ScrollRestoration() { return null; }
      function useHistory() { var navigate = useNavigate(); return { push: navigate, replace: function(to) { navigate(to, { replace: true }); }, go: navigate, goBack: function() { navigate(-1); } }; }
      function createBrowserRouter(routes) { return { routes: routes || [] }; }
      function RouterProvider(props) {
        var route = (props.router && props.router.routes || []).find(function(item) { return matches(item.path, window.__veavePathname()); });
        return route ? route.element || null : null;
      }
      window.ReactRouterDOM = { BrowserRouter: BrowserRouter, Router: BrowserRouter, StaticRouter: BrowserRouter,
        HashRouter: HashRouter, MemoryRouter: MemoryRouter, Routes: Routes, Switch: Routes, Route: Route,
        Link: Link, NavLink: NavLink, Navigate: Navigate, Redirect: Redirect, Outlet: Outlet,
        ScrollRestoration: ScrollRestoration, useNavigate: useNavigate, useHistory: useHistory,
        useLocation: useLocation, useParams: useParams, useSearchParams: useSearchParams,
        createBrowserRouter: createBrowserRouter, RouterProvider: RouterProvider };
    })();
  <\/script>

  <script>
    window.__modules = {};
    window.__require = function(path) {
      if (!path) return null;
      var p = path.replace(/^\\.\\//,'').replace(/\\.jsx$/,'').replace(/\\.js$/,'');
      return window.__modules[p]
        || window.__modules['src/' + p]
        || window.__modules[p + '/index']
        || window.__modules['src/' + p + '/index']
        || window.__modules[p + '.jsx']
        || window.__modules['src/' + p + '.jsx']
        || window.__modules[p.replace('src/','')]
        || null;
    };

    // Universal automated navigation history tracker
    (function() {
      if (!window.React || !window.React.useState) return;
      var origUseState = window.React.useState;
      var hookMetaMap = new WeakMap();
      var lastInteractionTime = 0;

      function recordInteraction() {
        lastInteractionTime = Date.now();
      }
      window.addEventListener('click', recordInteraction, true);
      window.addEventListener('pointerup', recordInteraction, true);
      window.addEventListener('touchend', recordInteraction, true);
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
          recordInteraction();
        }
      }, true);

      var history = window.__veaveHistory = {
        stack: [],
        isRestoring: false,
        pendingBatch: null,
        batchTimer: null,
        pushStep: function(restoreFn) {
          if (this.isRestoring) return;
          
          // Only record if triggered by user interaction (or recent navigation event within 600ms)
          if (Date.now() - lastInteractionTime > 600) {
            return;
          }

          var activeEl = document.activeElement;
          var activeTag = activeEl && activeEl.tagName ? activeEl.tagName.toLowerCase() : '';
          if (activeTag === 'textarea' || (activeTag === 'input' && activeEl.type !== 'radio' && activeEl.type !== 'checkbox' && activeEl.type !== 'button' && activeEl.type !== 'submit')) {
            return;
          }

          var now = Date.now();
          if (!this.pendingBatch) {
            this.pendingBatch = {
              restorations: [],
              scroll: { x: window.scrollX, y: window.scrollY },
              timestamp: now
            };
            this.stack.push(this.pendingBatch);
            
            var self = this;
            clearTimeout(this.batchTimer);
            this.batchTimer = setTimeout(function() {
              self.pendingBatch = null;
            }, 80);
          }
          
          this.pendingBatch.restorations.push(restoreFn);

          try {
            window.parent.postMessage({
              type: 'preview-history-changed',
              canGoBack: this.stack.length > 0,
              depth: this.stack.length
            }, '*');
          } catch(e) {}
        },
        back: function() {
          if (this.stack.length === 0) {
            try {
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            } catch(e) {}
            return false;
          }

          var step = this.stack.pop();
          if (step && step.restorations && step.restorations.length > 0) {
            this.isRestoring = true;
            try {
              for (var i = step.restorations.length - 1; i >= 0; i--) {
                try {
                  step.restorations[i]();
                } catch(err) {}
              }
              if (step.scroll) {
                window.scrollTo({ left: step.scroll.x, top: step.scroll.y, behavior: 'smooth' });
              }
            } finally {
              var self = this;
              setTimeout(function() {
                self.isRestoring = false;
              }, 40);
            }

            try {
              window.parent.postMessage({
                type: 'preview-history-changed',
                canGoBack: this.stack.length > 0,
                depth: this.stack.length
              }, '*');
            } catch(e) {}
            return true;
          }
          return false;
        }
      };

      window.React.useState = function(initialState) {
        var result = origUseState.apply(this, arguments);
        var val = result[0];
        var setVal = result[1];

        var meta = hookMetaMap.get(setVal);
        if (!meta) {
          meta = {
            val: val,
            setVal: setVal,
            wrappedSetVal: function(nextVal) {
              if (history.isRestoring) {
                return meta.setVal(nextVal);
              }
              var prev = meta.val;
              var computedNext = (typeof nextVal === 'function') ? nextVal(prev) : nextVal;
              if (prev !== computedNext) {
                history.pushStep(function() {
                  meta.val = prev;
                  try {
                    meta.setVal(prev);
                  } catch(e) {}
                });
              }
              return meta.setVal(nextVal);
            }
          };
          hookMetaMap.set(setVal, meta);
        } else {
          meta.val = val;
        }

        return [val, meta.wrappedSetVal];
      };
    })();

    // Lucide icon SVG factory with common icon shapes
    window.__lucideIcon = function(name, defaultPath) {
      return function LucideIcon(props) {
        var size = (props && props.size) || 20;
        var color = (props && props.color) || 'currentColor';
        var className = (props && props.className) || '';
        var strokeWidth = (props && props.strokeWidth) || 2;
        var fill = (props && props.fill) || 'none';

        // Predefined common SVGs for key icons
        var inner = defaultPath;
        if (!inner) {
          if (name === 'Play') inner = React.createElement('polygon', {points:'5 3 19 12 5 21 5 3'});
          else if (name === 'Star') inner = React.createElement('polygon', {points:'12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'});
          else if (name === 'Heart') inner = React.createElement('path', {d:'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'});
          else if (name === 'Search') inner = React.createElement('g', null, React.createElement('circle', {cx:11,cy:11,r:8}), React.createElement('path', {d:'m21 21-4.3-4.3'}));
          else if (name === 'Flame' || name === 'Sparkles' || name === 'Zap') inner = React.createElement('polygon', {points:'13 2 3 14 12 14 11 22 21 10 12 10 13 2'});
          else if (name === 'Trophy') inner = React.createElement('path', {d:'M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.45 1-1 1H8c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-1c-.55 0-1-.45-1-1v-2.34M18 4H6v6a6 6 0 0 0 12 0V4Z'});
          else if (name === 'Gamepad2') inner = React.createElement('path', {d:'M6 11h4m-2-2v4m7-2h.01m2.99-2h.01M18 13h.01M14 6h-4a2 2 0 0 0-2 2l-4 7a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-4-7a2 2 0 0 0-2-2Z'});
          else if (name === 'X') inner = React.createElement('path', {d:'M18 6 6 18M6 6l12 12'});
          else if (name === 'CheckCircle2' || name === 'Check') inner = React.createElement('path', {d:'M20 6 9 17l-5-5'});
          else inner = React.createElement('circle', {cx:12,cy:12,r:9});
        }

        return React.createElement('svg', {
          width: size, height: size, viewBox: '0 0 24 24',
          fill: fill, stroke: color, strokeWidth: strokeWidth,
          strokeLinecap: 'round', strokeLinejoin: 'round',
          className: className, 'aria-label': name
        }, inner);
      };
    };

    window.onerror = function(msg, url, line, col, error) {
      var detail = error && (error.stack || error.message);
      window.parent.postMessage({type:'preview-error', error:{message: detail || String(msg), source: url || '', line: line, column: col}}, '*');
      return true;
    };

    window.addEventListener('unhandledrejection', function(e) {
      var reason = e.reason && (e.reason.stack || e.reason.message) || String(e.reason);
      window.parent.postMessage({type:'preview-error', error:{message: 'Unhandled promise: ' + reason}}, '*');
    });

    // Comprehensive Visual Inspector & Live Design Editor Engine
    var selectedVisualElement = null;
    var hoveredVisualElement = null;
    var veaveElementIdCounter = 1;

    function ensureVeaveId(el) {
      if (!el) return '';
      if (!el.dataset.veaveId) {
        el.dataset.veaveId = 'vel-' + (veaveElementIdCounter++);
      }
      return el.dataset.veaveId;
    }

    function getElementPath(el) {
      var path = [];
      var curr = el;
      while (curr && curr !== document.body && curr.id !== 'root') {
        var name = curr.tagName.toLowerCase();
        if (curr.id) name += '#' + curr.id;
        path.unshift(name);
        curr = curr.parentElement;
      }
      return path;
    }

    function resolveElementSource(el) {
      var componentName = '<' + el.tagName.toLowerCase() + ' />';
      var sourceFile = 'src/App.jsx';
      var lineNumber = null;

      try {
        var fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
        if (fiberKey) {
          var curr = el[fiberKey];
          while (curr) {
            if (curr.type && typeof curr.type === 'function') {
              var fnName = curr.type.displayName || curr.type.name;
              if (fnName && fnName !== 'ErrorBoundary') {
                componentName = '<' + fnName + ' />';
                if (fnName === 'Navbar') sourceFile = 'src/components/Navbar.jsx';
                else if (fnName === 'Hero') sourceFile = 'src/components/Hero.jsx';
                else if (fnName === 'InteractiveSection') sourceFile = 'src/components/InteractiveSection.jsx';
                else if (fnName === 'FeatureSection') sourceFile = 'src/components/FeatureSection.jsx';
                else if (fnName === 'Footer') sourceFile = 'src/components/Footer.jsx';
                else if (fnName === 'Card') sourceFile = 'src/components/Card.jsx';
                else if (fnName === 'Modal') sourceFile = 'src/components/Modal.jsx';
                else sourceFile = 'src/App.jsx';
                break;
              }
            }
            if (curr._debugSource) {
              sourceFile = curr._debugSource.fileName || sourceFile;
              lineNumber = curr._debugSource.lineNumber;
            }
            curr = curr.return;
          }
        }
      } catch (e) {}

      if (componentName === '<' + el.tagName.toLowerCase() + ' />') {
        if (el.closest('header') || el.closest('nav')) {
          componentName = '<Navbar />';
          sourceFile = 'src/components/Navbar.jsx';
        } else if (el.closest('footer')) {
          componentName = '<Footer />';
          sourceFile = 'src/components/Footer.jsx';
        } else if (el.closest('#hero') || el.closest('[data-section="hero"]')) {
          componentName = '<Hero />';
          sourceFile = 'src/components/Hero.jsx';
        } else if (el.closest('#interactive-core')) {
          componentName = '<InteractiveSection />';
          sourceFile = 'src/components/InteractiveSection.jsx';
        } else {
          componentName = '<App />';
          sourceFile = 'src/App.jsx';
        }
      }

      return {
        componentName: componentName,
        sourceFile: sourceFile,
        lineNumber: lineNumber
      };
    }

    function getEffectiveBgColor(el) {
      var curr = el;
      while (curr && curr !== document && curr.nodeType === 1) {
        var bg = window.getComputedStyle(curr).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          return bg;
        }
        curr = curr.parentElement;
      }
      return '#000000';
    }

    function extractComputedStyleMap(el) {
      if (!el) return {};
      var cs = window.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var effBg = getEffectiveBgColor(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textDecorationLine: cs.textDecorationLine || cs.textDecoration,
        textAlign: cs.textAlign,
        color: cs.color,
        backgroundColor: cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : effBg,
        opacity: cs.opacity,
        borderWidth: cs.borderWidth,
        borderStyle: cs.borderStyle,
        borderColor: cs.borderColor,
        borderRadius: cs.borderRadius,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
        borderBottomLeftRadius: cs.borderBottomLeftRadius,
        width: cs.width && cs.width !== 'auto' ? cs.width : Math.round(r.width) + 'px',
        height: cs.height && cs.height !== 'auto' ? cs.height : Math.round(r.height) + 'px',
        boxWidth: Math.round(r.width),
        boxHeight: Math.round(r.height),
        sizingW: 'fixed',
        sizingH: 'fixed',
        display: cs.display,
        position: cs.position,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        flexWrap: cs.flexWrap,
        gap: cs.gap,
        paddingTop: cs.paddingTop || '0px',
        paddingRight: cs.paddingRight || '0px',
        paddingBottom: cs.paddingBottom || '0px',
        paddingLeft: cs.paddingLeft || '0px',
        marginTop: cs.marginTop || '0px',
        marginRight: cs.marginRight || '0px',
        marginBottom: cs.marginBottom || '0px',
        marginLeft: cs.marginLeft || '0px',
        objectFit: cs.objectFit || 'cover'
      };
    }

    function buildDOMTree(node, depth) {
      if (!node || node.nodeType !== 1) return null;
      if (node.id === 'root' && depth === 0) {
        var children = [];
        for (var i = 0; i < node.children.length; i++) {
          var c = buildDOMTree(node.children[i], depth + 1);
          if (c) children.push(c);
        }
        return {
          tagName: 'Page',
          elementId: 'root',
          children: children
        };
      }
      if (depth > 6) return null;
      var elId = ensureVeaveId(node);
      var tag = node.tagName.toLowerCase();
      var txt = (node.innerText || '').trim().slice(0, 30);
      var kids = [];
      for (var j = 0; j < node.children.length; j++) {
        var ch = buildDOMTree(node.children[j], depth + 1);
        if (ch) kids.push(ch);
      }
      return {
        tagName: tag,
        elementId: elId,
        text: kids.length === 0 ? txt : '',
        children: kids
      };
    }

    var inspectModeActive = true;
    try {
      window.parent.postMessage({ type: 'preview-inspect-ready', enabled: true }, '*');
    } catch(e) {}

    // Helper: Determine if an element or its ancestor is a real interactive element
    function findInteractiveTarget(el) {
      if (!el || el.nodeType !== 1) return null;
      var interactive = el.closest('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [data-route], [data-navigate]');
      if (interactive) return interactive;
      try {
        var reactPropsKey = Object.keys(el).find(function(k) { return k.startsWith('__reactProps$'); });
        if (reactPropsKey && el[reactPropsKey]) {
          var props = el[reactPropsKey];
          if (props && (props.onClick || props.onChange || props.onSubmit || props.onKeyDown)) {
            return el;
          }
        }
      } catch (e) {}
      return null;
    }

    // Helper: Determine if an element is a generic structural container (div, span, section, article, etc.)
    function isStructuralLayoutElement(el) {
      if (!el || el.nodeType !== 1) return true;
      var tag = el.tagName.toLowerCase();
      var structuralTags = ['div', 'span', 'p', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside'];
      if (structuralTags.includes(tag)) {
        if (findInteractiveTarget(el)) return false;
        return true;
      }
      return false;
    }

    function handleLinkNavigation(anchor, e) {
      if (!anchor) return;
      var href = anchor.getAttribute('href');
      if (!href || href === '#') return;

      if (href.startsWith('#')) {
        e.preventDefault();
        var targetId = href.slice(1);
        var targetEl = document.getElementById(targetId);
        if (targetEl) {
          if (window.__veaveHistory) {
            var prevScroll = { x: window.scrollX, y: window.scrollY };
            window.__veaveHistory.pushStep(function() {
              window.scrollTo({ left: prevScroll.x, top: prevScroll.y, behavior: 'smooth' });
            });
          }
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      // A link to another website must never replace the preview itself (it would leave the app and look broken or blank):
      // it opens in a new tab, exactly like the published site's link would take the visitor away from the page.
      if (/^https?:/i.test(href) || href.indexOf('//') === 0) {
        try {
          var external = new URL(href, window.location.href);
          if (external.origin !== window.location.origin && !e.defaultPrevented && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            window.open(external.href, '_blank', 'noopener');
          }
        } catch (err) {}
        return;
      }

      if (href.startsWith('/')) {
        e.preventDefault();
        try {
          history.pushState({ path: href }, '', href);
          window.dispatchEvent(new PopStateEvent('popstate', { state: { path: href } }));
        } catch(err) {}
        try {
          window.parent.postMessage({ type: 'preview-route-changed', route: href }, '*');
        } catch(err) {}
      }
    }

    try {
      var origPushState = history.pushState;
      history.pushState = function(state, title, url) {
        var ret = origPushState.apply(this, arguments);
        try {
          var targetRoute = (typeof url === 'string' && url) ? url : window.__veavePathname();
          window.parent.postMessage({ type: 'preview-route-changed', route: targetRoute }, '*');
        } catch(e) {}
        return ret;
      };

      var origReplaceState = history.replaceState;
      history.replaceState = function(state, title, url) {
        var ret = origReplaceState.apply(this, arguments);
        try {
          var targetRoute = (typeof url === 'string' && url) ? url : window.__veavePathname();
          window.parent.postMessage({ type: 'preview-route-changed', route: targetRoute }, '*');
        } catch(e) {}
        return ret;
      };

      window.addEventListener('popstate', function(e) {
        try {
          var r = (e.state && e.state.path) || window.__veavePathname() || '/';
          if (!window.__veaveRouteBack && window.__veaveHistory && typeof window.__veaveHistory.back === 'function') {
            window.__veaveHistory.back();
          }
          window.parent.postMessage({ type: 'preview-route-changed', route: r }, '*');
        } catch(e) {}
      });

      window.addEventListener('hashchange', function() {
        try {
          var h = window.location.hash || '/';
          window.parent.postMessage({ type: 'preview-route-changed', route: h }, '*');
        } catch(e) {}
      });
    } catch(err) {}

    function notifySelected(el) {
      if (!el || el === document.body || el.id === 'root') return;
      if (selectedVisualElement) {
        selectedVisualElement.classList.remove('veave-inspect-selected');
      }
      selectedVisualElement = el;
      el.classList.add('veave-inspect-selected');

      var tag = el.tagName.toLowerCase();
      var text = (el.innerText || el.textContent || '').trim();
      var cls = String(el.className || '').replace('veave-inspect-selected','').replace('veave-inspect-highlight','').trim();
      var elId = ensureVeaveId(el);
      var r = el.getBoundingClientRect();
      var path = getElementPath(el);
      var computedMap = extractComputedStyleMap(el);
      var sourceInfo = resolveElementSource(el);

      var subImg = tag === 'img' ? el : el.querySelector('img');
      var imgSrc = (el.getAttribute && el.getAttribute('src')) || (subImg && subImg.getAttribute('src')) || (el.src || (subImg && subImg.src)) || '';
      var imgAlt = (el.getAttribute && el.getAttribute('alt')) || (subImg && subImg.getAttribute('alt')) || '';
      var subAnchor = tag === 'a' ? el : (el.closest('a') || el.querySelector('a'));
      var linkHref = (el.getAttribute && el.getAttribute('href')) || (subAnchor && subAnchor.getAttribute('href')) || '';

      window.parent.postMessage({
        type: 'visual-element-selected',
        element: {
          tagName: tag,
          text: text,
          className: cls,
          id: el.id || '',
          elementId: elId,
          selector: tag + (el.id ? '#' + el.id : (cls ? '.' + cls.split(' ')[0] : '')),
          elementPath: path,
          sourceComponent: sourceInfo.componentName,
          sourceFile: sourceInfo.sourceFile,
          sourceLine: sourceInfo.lineNumber,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
          isImage: tag === 'img' || Boolean(imgSrc) || Boolean(subImg),
          attributes: {
            src: imgSrc,
            alt: imgAlt,
            href: linkHref,
            placeholder: (el.getAttribute && el.getAttribute('placeholder')) || ''
          },
          computedStyles: computedMap
        }
      }, '*');
    }

    var isScrollingPreview = false;
    var scrollPreviewTimer = null;

    // Hover highlighting: only active in Edit Mode and not while actively scrolling
    window.addEventListener('mouseover', function(e) {
      if (!inspectModeActive || document.body.dataset.veaveInspect === 'false' || isScrollingPreview) return;
      var el = e.target;
      if (!el || el === document.body || el.id === 'root') return;
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') {
        el = el.closest('svg') || el;
      }

      if (hoveredVisualElement && hoveredVisualElement !== el) {
        hoveredVisualElement.classList.remove('veave-inspect-highlight');
      }
      hoveredVisualElement = el;
      el.classList.add('veave-inspect-highlight');

      var r = el.getBoundingClientRect();
      var elId = ensureVeaveId(el);
      window.parent.postMessage({
        type: 'visual-element-hovered',
        element: {
          tagName: el.tagName.toLowerCase(),
          text: (el.innerText || el.textContent || '').trim().slice(0, 40),
          elementId: elId,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height }
        }
      }, '*');
    }, false);

    window.addEventListener('mouseout', function(e) {
      if (e.target && e.target.classList) {
        e.target.classList.remove('veave-inspect-highlight');
      }
    }, false);

    // Main Click Handler: Mode-aware
    // NORMAL/PREVIEW MODE: 100% native website interaction (links navigate, buttons click, dropdowns toggle)
    // EDIT MODE: Every element is clickable and selectable for visual inspection and editing!
    window.addEventListener('click', function(e) {
      var el = e.target;
      if (!el) return;

      // When clicking empty background outside elements, deselect in Edit Mode
      if (el === document.body || el.id === 'root') {
        if (inspectModeActive && document.body.dataset.veaveInspect !== 'false') {
          if (selectedVisualElement) {
            selectedVisualElement.classList.remove('veave-inspect-selected');
            selectedVisualElement = null;
          }
          window.parent.postMessage({ type: 'clear-inspect-selection' }, '*');
        }
        return;
      }

      // 1. NORMAL/PREVIEW MODE:
      // Return immediately with zero click interception.
      // Anchor links navigate (/about, #section, external), buttons trigger onClick, dropdowns toggle, forms submit.
      if (!inspectModeActive || document.body.dataset.veaveInspect === 'false') {
        var anchor = el.closest ? el.closest('a') : null;
        if (anchor) {
          handleLinkNavigation(anchor, e);
        }

        var navTarget = el.closest ? el.closest('[data-route], [data-page], [data-nav], [data-tab], [data-view]') : null;
        if (navTarget) {
          var btnRoute = navTarget.getAttribute('data-route') || 
                         navTarget.getAttribute('data-page') || 
                         navTarget.getAttribute('data-nav') || 
                         navTarget.getAttribute('data-tab') ||
                         navTarget.getAttribute('data-view');
          if (btnRoute && btnRoute !== '/' && btnRoute !== 'home' && btnRoute !== 'Main Portal') {
            try {
              var formattedRoute = (btnRoute.startsWith('/') || btnRoute.startsWith('#')) ? btnRoute : ('/' + btnRoute);
              window.parent.postMessage({ type: 'preview-route-changed', route: formattedRoute }, '*');
            } catch(e) {}
          }
        }
        return;
      }

      // 2. EDIT MODE:
      // If Ctrl or Cmd key is pressed, bypass selection to interact directly with the website
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      // In Edit Mode, prevent default navigation/submission so user can inspect and edit the element safely
      e.preventDefault();
      e.stopPropagation();

      // Resolve SVG child element (like <path>) to the parent <svg>
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') {
        el = el.closest('svg') || el;
      }

      // If clicked element is an inner span/icon inside a button or link,
      // select the button/link so user gets button styles, href, and controls
      var interactiveParent = el.closest('button, a[href], [role="button"]');
      if (interactiveParent && interactiveParent !== el && selectedVisualElement !== el) {
        el = interactiveParent;
      }

      // If clicked element is an overlay (e.g. gradient or backdrop) over an image, or an image wrapper without text,
      // resolve directly to the <img> so images are always 100% clickable and changeable!
      if (el.tagName.toLowerCase() !== 'img') {
        var directImg = el.querySelector('img');
        var textContent = (el.innerText || el.textContent || '').trim();
        if (directImg && (!textContent || textContent.length === 0)) {
          el = directImg;
        } else if (el.parentElement) {
          var siblingImg = el.parentElement.querySelector('img');
          var cs = window.getComputedStyle(el);
          if (siblingImg && (cs.position === 'absolute' || (el.className && typeof el.className === 'string' && el.className.includes('absolute'))) && (!textContent || textContent.length === 0)) {
            el = siblingImg;
          }
        }
      }

      // In Edit Mode, EVERY element clicked is selectable and editable:
      // headings, paragraphs, spans, badges, buttons, links, images, cards, divs, sections, lists, etc.
      notifySelected(el);
    }, true);

    // When scrolling down, dismiss the clicked box and hover highlights so they NEVER follow or come down!
    // It cleanly waits until the next element is clicked.
    window.addEventListener('scroll', function() {
      isScrollingPreview = true;
      clearTimeout(scrollPreviewTimer);
      scrollPreviewTimer = setTimeout(function() {
        isScrollingPreview = false;
      }, 150);

      if (selectedVisualElement) {
        selectedVisualElement.classList.remove('veave-inspect-selected');
        selectedVisualElement = null;
        try {
          window.parent.postMessage({ type: 'clear-inspect-selection' }, '*');
        } catch(e) {}
      }

      if (hoveredVisualElement) {
        hoveredVisualElement.classList.remove('veave-inspect-highlight');
        hoveredVisualElement = null;
      }
    }, { passive: true });

    window.addEventListener('resize', function() {
      if (selectedVisualElement) {
        var r = selectedVisualElement.getBoundingClientRect();
        window.parent.postMessage({
          type: 'visual-element-rect-updated',
          rect: { top: r.top, left: r.left, width: r.width, height: r.height }
        }, '*');
      }
    }, { passive: true });

    // Double-click inline text editing: ONLY active in Edit Mode on textual elements
    window.addEventListener('dblclick', function(e) {
      if (!inspectModeActive || document.body.dataset.veaveInspect === 'false') return;
      var el = e.target;
      if (!el || el === document.body || el.id === 'root') return;
      if (el instanceof SVGElement) return;

      var tag = el.tagName.toLowerCase();
      var allowedTextTags = [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
        'p', 'span', 'label', 'button', 'a', 
        'li', 'td', 'th', 'blockquote', 'div', 
        'strong', 'b', 'em', 'i', 'small', 'caption', 'summary'
      ];
      if (!allowedTextTags.includes(tag)) return;
      if ((tag === 'div' || tag === 'section') && el.children && el.children.length > 2) return;

      e.preventDefault();
      e.stopPropagation();

      var prevOutline = el.style.outline;
      el.contentEditable = "true";
      el.style.outline = "2px solid #52525B";
      el.focus();
      var originalText = (el.innerText || el.textContent || '').trim();

      function onFinish() {
        el.contentEditable = "false";
        el.style.outline = prevOutline;
        el.removeEventListener('blur', onFinish);
        el.removeEventListener('keydown', onKeyDown);
        var newText = (el.innerText || el.textContent || '').trim();
        if (newText !== originalText) {
          window.parent.postMessage({
            type: 'visual-text-edited',
            oldText: originalText,
            newText: newText,
            elementId: el.getAttribute('data-veave-id')
          }, '*');
        }
      }

      function onKeyDown(evt) {
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          el.blur();
        } else if (evt.key === 'Escape') {
          el.innerText = originalText;
          el.blur();
        }
      }

      el.addEventListener('blur', onFinish);
      el.addEventListener('keydown', onKeyDown);
    }, true);

    function applyLiveStyle(el, prop, value) {
      if (!el || !prop) return;
      try {
        el.style[prop] = value;
        var kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        el.style.setProperty(kebab, value, 'important');

        var cl = Array.from(el.classList || []);

        // Strip conflicting Tailwind classes to guarantee 100% instant live visual reflection
        if (prop === 'color') {
          cl.forEach(function(c) {
            if (/^text-(zinc|gray|neutral|slate|red|blue|indigo|purple|amber|emerald|rose|green|yellow|orange|cyan|white|black)(-\d+)?$/.test(c)) {
              el.classList.remove(c);
            }
          });
        } else if (prop === 'backgroundColor') {
          cl.forEach(function(c) {
            if (/^bg-(zinc|gray|neutral|slate|red|blue|indigo|purple|amber|emerald|rose|green|yellow|orange|cyan|white|black)(-\d+)?$/.test(c)) {
              el.classList.remove(c);
            }
          });
        } else if (prop === 'fontSize') {
          cl.forEach(function(c) {
            if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(c)) {
              el.classList.remove(c);
            }
          });
        } else if (prop === 'fontWeight') {
          cl.forEach(function(c) {
            if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c)) {
              el.classList.remove(c);
            }
          });
        } else if (prop === 'fontStyle') {
          cl.forEach(function(c) {
            if (/^(italic|not-italic)$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'textDecorationLine' || prop === 'textDecoration') {
          cl.forEach(function(c) {
            if (/^(underline|overline|line-through|no-underline)$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'textTransform') {
          cl.forEach(function(c) {
            if (/^(uppercase|lowercase|capitalize|normal-case)$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'textAlign') {
          cl.forEach(function(c) {
            if (/^text-(left|center|right|justify)$/.test(c)) {
              el.classList.remove(c);
            }
          });
        } else if (prop === 'width') {
          cl.forEach(function(c) {
            if (/^w-/.test(c) || /^max-w-/.test(c)) el.classList.remove(c);
          });
          if (value === 'fit-content' || value === 'auto') {
            el.style.setProperty('max-width', 'none', 'important');
            el.style.setProperty('min-width', '0', 'important');
          }
        } else if (prop === 'height') {
          cl.forEach(function(c) {
            if (/^h-/.test(c) || /^max-h-/.test(c)) el.classList.remove(c);
          });
          if (value === 'fit-content' || value === 'auto') {
            el.style.setProperty('max-height', 'none', 'important');
            el.style.setProperty('min-height', '0', 'important');
          }
        } else if (prop.startsWith('padding')) {
          cl.forEach(function(c) {
            if (/^p[trblxy]?-/.test(c) || /^p-/.test(c)) el.classList.remove(c);
          });
        } else if (prop.startsWith('margin')) {
          cl.forEach(function(c) {
            if (/^m[trblxy]?-/.test(c) || /^m-/.test(c)) el.classList.remove(c);
          });
        } else if (prop.startsWith('border') && prop.includes('Radius')) {
          cl.forEach(function(c) {
            if (/^rounded(-[a-z0-9]+)?$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'borderWidth' || prop === 'borderStyle' || prop === 'borderColor') {
          cl.forEach(function(c) {
            if (/^border(-[a-z0-9]+)?$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'display') {
          cl.forEach(function(c) {
            if (/^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden)$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'flexDirection') {
          cl.forEach(function(c) {
            if (/^flex-(row|col|row-reverse|col-reverse)$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'gap') {
          cl.forEach(function(c) {
            if (/^gap(-[a-z0-9]+)?$/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'alignItems') {
          cl.forEach(function(c) {
            if (/^items-/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'justifyContent') {
          cl.forEach(function(c) {
            if (/^justify-/.test(c)) el.classList.remove(c);
          });
        } else if (prop === 'opacity') {
          cl.forEach(function(c) {
            if (/^opacity-/.test(c)) el.classList.remove(c);
          });
        }
      } catch (e) {
        try { el.style[prop] = value; } catch (e2) {}
      }
    }

    // Inbound message listeners for Real-time Visual Editing
    window.addEventListener('message', function(event) {
      if (!event.data) return;

      if (event.data.type === 'toggle-inspect-mode') {
        inspectModeActive = Boolean(event.data.enabled);
        document.body.dataset.veaveInspect = inspectModeActive ? 'true' : 'false';
        if (!inspectModeActive && selectedVisualElement) {
          selectedVisualElement.classList.remove('veave-inspect-selected');
          selectedVisualElement = null;
        }
        if (!inspectModeActive && hoveredVisualElement) {
          hoveredVisualElement.classList.remove('veave-inspect-highlight');
          hoveredVisualElement = null;
        }
      } else if (event.data.type === 'clear-inspect-selection') {
        if (selectedVisualElement) {
          selectedVisualElement.classList.remove('veave-inspect-selected');
          selectedVisualElement = null;
        }
        if (hoveredVisualElement) {
          hoveredVisualElement.classList.remove('veave-inspect-highlight');
          hoveredVisualElement = null;
        }
      } else if (event.data.type === 'preview-restore-route') {
        // The preview was rebuilt (e.g. while the site is still being created); keep the page the user was on.
        try {
          var restoreRoute = event.data.route || '/';
          if (restoreRoute !== window.__veavePathname()) {
            window.history.replaceState({}, '', restoreRoute);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        } catch (e) {}
      } else if (event.data.type === 'preview-navigate-back') {
        var targetRoute = event.data.route || '/';
        // The studio owns the list of visited pages, so going back means: show the page it names.
        // (Never history.back(): the iframe shares the tab's history, so that could leave the studio.)
        if (targetRoute !== window.__veavePathname()) {
          try {
            window.__veaveRouteBack = true;
            window.history.replaceState({ path: targetRoute }, '', targetRoute);
            window.dispatchEvent(new PopStateEvent('popstate', { state: { path: targetRoute } }));
            window.scrollTo(0, 0);
          } catch (e) {}
          window.__veaveRouteBack = false;
        } else {
          var restored = false;
          if (window.__veaveHistory && typeof window.__veaveHistory.back === 'function') {
            restored = window.__veaveHistory.back();
          }
          if (!restored) {
            try { window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); } catch (e) {}
          }
        }

        try {
          window.dispatchEvent(new CustomEvent('veave-navigate', { detail: { route: targetRoute } }));
        } catch (e3) {}
        try {
          window.parent.postMessage({ type: 'preview-route-changed', route: targetRoute }, '*');
        } catch (postErr) {}
      } else if (event.data.type === 'apply-visual-style') {
        var target = selectedVisualElement;
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) target = found;
        }
        if (target) {
          if (event.data.property) {
            if (event.data.value === undefined || event.data.value === null || event.data.value === '') {
              target.style.removeProperty(event.data.property);
              var kebab = event.data.property.replace(/([A-Z])/g, '-$1').toLowerCase();
              target.style.removeProperty(kebab);
            } else {
              applyLiveStyle(target, event.data.property, event.data.value);
            }
          }
          if (event.data.styles) {
            for (var k in event.data.styles) {
              if (event.data.styles[k] === undefined || event.data.styles[k] === null || event.data.styles[k] === '') {
                target.style.removeProperty(k);
                var kebabK = k.replace(/([A-Z])/g, '-$1').toLowerCase();
                target.style.removeProperty(kebabK);
              } else {
                applyLiveStyle(target, k, event.data.styles[k]);
              }
            }
          }
          // Refresh selection rect
          var r = target.getBoundingClientRect();
          window.parent.postMessage({
            type: 'visual-element-rect-updated',
            rect: { top: r.top, left: r.left, width: r.width, height: r.height }
          }, '*');
        }
      } else if (event.data.type === 'apply-visual-text') {
        var target = selectedVisualElement;
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) target = found;
        }
        if (target) {
          var textSpan = target.querySelector('span:not(.veave-badge), p, strong, em, b');
          if (textSpan && textSpan.childNodes.length <= 1) {
            textSpan.textContent = event.data.text;
          } else {
            var textNodeFound = false;
            for (var tn = 0; tn < target.childNodes.length; tn++) {
              if (target.childNodes[tn].nodeType === 3 && target.childNodes[tn].nodeValue.trim().length > 0) {
                target.childNodes[tn].nodeValue = event.data.text;
                textNodeFound = true;
                break;
              }
            }
            if (!textNodeFound) {
              var allKids = target.querySelectorAll('*');
              for (var dk = 0; dk < allKids.length; dk++) {
                var kidTag = allKids[dk].tagName.toLowerCase();
                if (kidTag !== 'svg' && kidTag !== 'path' && allKids[dk].childNodes.length === 1 && allKids[dk].childNodes[0].nodeType === 3) {
                  allKids[dk].textContent = event.data.text;
                  textNodeFound = true;
                  break;
                }
              }
            }
            if (!textNodeFound) {
              target.textContent = event.data.text;
            }
          }
          var r = target.getBoundingClientRect();
          window.parent.postMessage({
            type: 'visual-element-rect-updated',
            rect: { top: r.top, left: r.left, width: r.width, height: r.height }
          }, '*');
        }
      } else if (event.data.type === 'apply-visual-attribute') {
        var target = selectedVisualElement;
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) target = found;
        }
        if (target) {
          target.setAttribute(event.data.attr, event.data.value);
          if (event.data.attr === 'src') {
            if (target.tagName.toLowerCase() === 'img') {
              target.src = event.data.value;
            } else {
              var subImg = target.querySelector('img');
              if (subImg) {
                subImg.src = event.data.value;
                subImg.setAttribute('src', event.data.value);
              }
            }
          }
          if (event.data.attr === 'href') {
            target.href = event.data.value;
            if (target.tagName.toLowerCase() !== 'a') {
              var subA = target.querySelector('a') || target.closest('a');
              if (subA) {
                subA.href = event.data.value;
                subA.setAttribute('href', event.data.value);
              }
            }
          }
          if (event.data.attr === 'alt') {
            target.alt = event.data.value;
            if (target.tagName.toLowerCase() !== 'img') {
              var subImg = target.querySelector('img');
              if (subImg) subImg.alt = event.data.value;
            }
          }
          var r = target.getBoundingClientRect();
          window.parent.postMessage({
            type: 'visual-element-rect-updated',
            rect: { top: r.top, left: r.left, width: r.width, height: r.height }
          }, '*');
        }
      } else if (event.data.type === 'delete-visual-element') {
        var target = selectedVisualElement;
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) target = found;
        }
        if (target) {
          target.style.display = 'none';
          target.dataset.veaveDeleted = 'true';
          if (selectedVisualElement === target) {
            selectedVisualElement.classList.remove('veave-inspect-selected');
            selectedVisualElement = null;
          }
        }
      } else if (event.data.type === 'restore-visual-element') {
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) {
            found.style.display = '';
            delete found.dataset.veaveDeleted;
            found.click();
          }
        }
      } else if (event.data.type === 'duplicate-visual-element') {
        var target = selectedVisualElement;
        if (event.data.elementId) {
          var found = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
          if (found) target = found;
        }
        if (target && target.parentElement) {
          var clone = target.cloneNode(true);
          delete clone.dataset.veaveId;
          ensureVeaveId(clone);
          target.parentElement.insertBefore(clone, target.nextSibling);
        }
      } else if (event.data.type === 'select-parent-element') {
        if (selectedVisualElement && selectedVisualElement.parentElement && selectedVisualElement.parentElement !== document.body && selectedVisualElement.parentElement.id !== 'root') {
          notifySelected(selectedVisualElement.parentElement);
        }
      } else if (event.data.type === 'select-ancestor-tag') {
        if (selectedVisualElement && event.data.tag) {
          var targetTag = String(event.data.tag).toLowerCase().split('#')[0].split('.')[0].trim();
          var curr = selectedVisualElement.parentElement;
          while (curr && curr !== document.body && curr.id !== 'root') {
            if (curr.tagName && curr.tagName.toLowerCase() === targetTag) {
              notifySelected(curr);
              break;
            }
            curr = curr.parentElement;
          }
        }
      } else if (event.data.type === 'select-visual-element-by-id') {
        var node = document.querySelector('[data-veave-id="' + event.data.elementId + '"]');
        if (node) {
          notifySelected(node);
        }
      } else if (event.data.type === 'insert-visual-badge') {
        var target = selectedVisualElement;
        var badgeText = event.data.text || 'NEW';
        var badgeColor = event.data.color || 'indigo';
        var colorClasses = {
          indigo: 'bg-[#6366F1]/20 text-[#818cf8] border border-[#6366F1]/40',
          emerald: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
          amber: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
          rose: 'bg-rose-500/20 text-rose-400 border border-rose-500/40',
          zinc: 'bg-zinc-800 text-zinc-300 border border-zinc-700'
        };
        var cls = colorClasses[badgeColor] || colorClasses.indigo;

        var badge = document.createElement('span');
        badge.className = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide select-none cursor-pointer relative z-20 shadow-xs transition-all ' + cls;
        badge.style.display = 'inline-flex';
        badge.style.margin = '4px 6px';
        badge.style.verticalAlign = 'middle';
        badge.innerText = badgeText;
        if (event.data.badgeId) {
          badge.dataset.veaveId = event.data.badgeId;
        } else {
          ensureVeaveId(badge);
        }

        if (target && target.parentElement) {
          var tag = target.tagName.toLowerCase();
          if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'a'].includes(tag)) {
            // Insert adjacent to text element with spacing
            target.parentElement.insertBefore(badge, target.nextSibling);
          } else if (tag === 'button') {
            target.appendChild(badge);
          } else {
            // Container element: find heading or insert with margin so it never overlaps absolute overlays
            var heading = target.querySelector('h1, h2, h3, h4, h5, h6, p');
            if (heading && heading.parentElement) {
              heading.parentElement.insertBefore(badge, heading);
            } else {
              target.appendChild(badge);
            }
          }
        } else {
          // No selection: safely insert into hero / main content area without touching fixed navbar
          var rootEl = document.getElementById('root');
          var mainArea = (rootEl && (rootEl.querySelector('[data-section="hero"]') || rootEl.querySelector('#hero') || rootEl.querySelector('main') || rootEl.querySelector('#root > div > div') || rootEl.querySelector('#root > div'))) || document.body;
          var heroHeading = mainArea.querySelector('h1, h2, p');
          if (heroHeading && heroHeading.parentElement) {
            heroHeading.parentElement.insertBefore(badge, heroHeading);
          } else {
            mainArea.appendChild(badge);
          }
        }

        setTimeout(function() {
          badge.click();
        }, 50);
      } else if (event.data.type === 'insert-visual-element') {
        var target = selectedVisualElement;
        var elType = event.data.elementType || 'badge';
        var newEl = document.createElement(elType === 'button' ? 'button' : 'div');
        if (elType === 'button') {
          newEl.className = 'px-4 py-2 bg-zinc-600 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer';
          newEl.innerText = event.data.text || 'Action Button';
        } else {
          newEl.className = 'p-4 rounded-xl border border-zinc-200 bg-white shadow-2xs';
          newEl.innerText = event.data.text || 'Container Box';
        }
        ensureVeaveId(newEl);
        if (target && target.parentElement) {
          target.parentElement.insertBefore(newEl, target.nextSibling);
        } else {
          var rootEl = document.getElementById('root');
          (rootEl || document.body).appendChild(newEl);
        }
        setTimeout(function() { newEl.click(); }, 50);
      } else if (event.data.type === 'request-dom-tree') {
        var rootEl = document.getElementById('root');
        if (rootEl) {
          var tree = buildDOMTree(rootEl, 0);
          window.parent.postMessage({
            type: 'dom-tree-ready',
            tree: tree ? [tree] : []
          }, '*');
        }
      }
    });
  <\/script>

  ${fileScripts}

  <script type="text/babel" data-presets="react,typescript">
    try {
      var App = window.__require('src/App') || window.__require('App') || window.__require('src/App.jsx');
      var AppComponent = App && (App.default || App);
      if (AppComponent) {
        var root = ReactDOM.createRoot(document.getElementById('root'));

        class ErrorBoundary extends React.Component {
          constructor(props) { super(props); this.state = { hasError: false, error: null }; }
          static getDerivedStateFromError(error) { return { hasError: true, error }; }
          componentDidCatch(error) {
            window.parent.postMessage({type:'preview-error', error:{message: error.message}}, '*');
          }
          render() {
            if (this.state.hasError) {
              return React.createElement('div', {
                style:{padding:'24px',color:'#ef4444',fontFamily:'monospace',fontSize:'14px',background:'#18181b',minHeight:'100vh'}
              }, React.createElement('h2', {style:{marginBottom:'8px'}}, 'Render Error'),
                 React.createElement('pre', {style:{whiteSpace:'pre-wrap',color:'#a1a1aa'}}, this.state.error?.message));
            }
            return this.props.children;
          }
        }

        var applicationElement = React.createElement(AppComponent);
        if (window.__usesReactRouter && window.ReactRouterDOM && window.ReactRouterDOM.BrowserRouter) {
          applicationElement = React.createElement(window.ReactRouterDOM.BrowserRouter, null, applicationElement);
        }
        root.render(
          React.createElement(ErrorBoundary, null,
            applicationElement
          )
        );
        (function waitForCommittedRender(attempt) {
          requestAnimationFrame(function() {
            var rootElement = document.getElementById('root');
            if (rootElement && rootElement.innerHTML.trim()) {
              window.parent.postMessage({ type: 'preview-rendered', status: 'success' }, '*');
              return;
            }
            if (attempt < 40) {
              setTimeout(function() { waitForCommittedRender(attempt + 1); }, 50);
              return;
            }
            window.parent.postMessage({type:'preview-error', error:{message:'Blank screen detected: the application rendered no visible content.'}}, '*');
            window.parent.postMessage({ type: 'preview-rendered', status: 'blank' }, '*');
          });
        })(0);
      } else {
        document.getElementById('root').innerHTML = '<div style="padding:40px;text-align:center;color:#71717a;font-family:Inter,sans-serif;"><p style="font-size:18px;margin-bottom:8px;">No App Component Found</p><p style="font-size:14px;">Make sure src/App.jsx exports a default component.</p></div>';
        setTimeout(function() {
          window.parent.postMessage({ type: 'preview-rendered', status: 'no-app' }, '*');
        }, 50);
      }
    } catch(e) {
      window.parent.postMessage({type:'preview-error', error:{message: e.message}}, '*');
      window.parent.postMessage({type:'preview-rendered', status: 'error'}, '*');
      document.getElementById('root').innerHTML = '<div style="padding:24px;color:#ef4444;font-family:monospace;font-size:14px;background:#18181b;min-height:100vh"><h2 style="margin-bottom:8px">Boot Error</h2><pre style="white-space:pre-wrap;color:#a1a1aa">' + e.message + '</pre></div>';
    }
  <\/script>
</body>
</html>`;
}

function transformFileContent(file) {
  let content = cleanSourceCode(file.content || '');
  const namedExports = [];

  // Type-only module syntax has no browser runtime representation and cannot
  // remain inside the preview module wrapper.
  content = content
    .replace(/import\s+type\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*/g, '')
    .replace(/export\s+type\s*\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?;?\s*/g, '')
    .replace(/(?:export\s+)?type\s+\w+(?:\s*<[^;=]+>)?\s*=\s*[\s\S]*?;\s*/g, '')
    .replace(/(?:export\s+)?interface\s+\w+(?:\s+extends\s+[^\{]+)?\s*\{[\s\S]*?\}\s*/g, '');

  // Remove CSS imports
  content = content.replace(/import\s+['"][^'"]*\.css['"];?\s*/g, '');

  // Preview documents cannot change location.pathname; read the virtual path.
  content = content.replace(/\b(?:window\.)?location\.pathname\b/g, 'window.__veavePathname()');

  // Handle: import { motion, AnimatePresence } from 'framer-motion'
  content = content.replace(
    /import\s+.*?\s+from\s+['"]framer-motion['"];?/g,
    'var motion = new Proxy({}, { get: function(_, tag) { return function(props) { var p = Object.assign({}, props); delete p.initial; delete p.animate; delete p.exit; delete p.transition; delete p.whileHover; delete p.whileTap; return React.createElement(tag, p); }; } }); var AnimatePresence = function(props) { return props.children; };'
  );

  // Handle: import confetti from 'canvas-confetti'
  content = content.replace(
    /import\s+.*?\s+from\s+['"]canvas-confetti['"];?/g,
    'var confetti = function() {};'
  );

  // Handle: import React from 'react'
  content = content.replace(
    /import\s+React\s*,?\s*(?:\{([^}]*)\})?\s+from\s+['"]react['"];?/g,
    (_, named) => {
      let result = 'var React = window.React;\n';
      if (named) {
        const names = named.split(',').map((n) => n.trim()).filter(Boolean);
        names.forEach((entry) => {
          const parts = entry.split(/\s+as\s+/i);
          result += `var ${parts[1] || parts[0]} = React.${parts[0]};\n`;
        });
      }
      return result;
    }
  );

  // Handle: import { useState, useEffect } from 'react'
  content = content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g,
    (_, imports) => {
      const names = imports.split(',').map((n) => n.trim()).filter(Boolean);
      return names.map((entry) => {
        const parts = entry.split(/\s+as\s+/i);
        return `var ${parts[1] || parts[0]} = React.${parts[0]};`;
      }).join('\n');
    }
  );

  // Handle: import ReactDOM from 'react-dom/client' or 'react-dom'
  content = content.replace(
    /import\s+\w+\s+from\s+['"]react-dom(?:\/client)?['"];?/g,
    'var ReactDOMClient = window.ReactDOM;'
  );

  // Handle: import { ... } from 'lucide-react'
  content = content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"];?/g,
    (_, imports) => {
      const icons = imports.split(',').map((n) => n.trim()).filter(Boolean);
      return icons
        .map(
          (entry) => {
            const parts = entry.split(/\s+as\s+/i);
            return `var ${parts[1] || parts[0]} = window.__lucideIcon('${parts[0]}');`;
          }
        )
        .join('\n');
    }
  );

  // Handle wildcard or default import from lucide-react: import * as Lucide from 'lucide-react'
  content = content.replace(
    /import\s+(?:\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]lucide-react['"];?/g,
    (_, m1, m2) => `var ${m1 || m2} = new Proxy({}, { get: function(_, prop) { return window.__lucideIcon(prop); } });`
  );

  // Handle react-router-dom from the local preview runtime.
  content = content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]react-router-dom['"];?/g,
    (_, imports) => `window.__usesReactRouter = true;\n` + imports.split(',').map((entry) => {
      const parts = entry.trim().split(/\s+as\s+/i);
      return `var ${parts[1] || parts[0]} = window.ReactRouterDOM['${parts[0]}'];`;
    }).join('\n')
  );
  content = content.replace(
    /import\s+(\w+)\s+from\s+['"]react-router-dom['"];?/g,
    (_, name) => `window.__usesReactRouter = true;\nvar ${name} = window.ReactRouterDOM;`
  );

  // Provide the carousel hook used by generated clones without loading remote packages.
  content = content.replace(
    /import\s+(\w+)\s+from\s+['"]embla-carousel-react['"];?/g,
    (_, name) => `var ${name} = function() { return [function() {}, { scrollPrev: function() {}, scrollNext: function() {}, canScrollPrev: function() { return true; }, canScrollNext: function() { return true; }, on: function() {}, off: function() {} }]; };`
  );

  // Handle: import * as NS from './relative/path'
  content = content.replace(
    /import\s+\*\s+as\s+([\w$]+)\s+from\s+['"](\.[^'"]+)['"];?/g,
    (_, name, path) => `var ${name} = window.__require('${resolveModulePath(file.path, path)}') || {};`
  );

  // Handle: import Default, { A, B as C } from './relative/path'  and  import Default, * as NS from './relative/path'
  content = content.replace(
    /import\s+([\w$]+)\s*,\s*(?:\*\s+as\s+([\w$]+)|\{([^}]*)\})\s+from\s+['"](\.[^'"]+)['"];?/g,
    (_, def, ns, imports, path) => {
      const resolved = resolveModulePath(file.path, path);
      const mod = `__imp_${def}`;
      let result = `var ${mod} = window.__require('${resolved}') || {};\nvar ${def} = ${mod}.default || ${mod};\n`;
      if (ns) result += `var ${ns} = ${mod};\n`;
      else {
        (imports || '').split(',').map((e) => e.trim()).filter((e) => e && !/^type\s+/i.test(e)).forEach((entry) => {
          const parts = entry.split(/\s+as\s+/i).map((p) => p.trim());
          result += `var ${parts[1] || parts[0]} = ${mod}['${parts[0]}'] || ${mod}.default;\n`;
        });
      }
      return result;
    }
  );

  // Handle: import DefaultExport from './relative/path'
  content = content.replace(
    /import\s+([\w$]+)\s+from\s+['"](\.[^'"]+)['"];?/g,
    (_, name, path) => {
      return `var __mod_${name} = window.__require('${resolveModulePath(file.path, path)}');\nvar ${name} = __mod_${name} && (__mod_${name}.default || __mod_${name});`;
    }
  );

  // Handle: import { A, B } from './relative/path'
  content = content.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"];?/g,
    (_, imports, path) => {
      const resolved = resolveModulePath(file.path, path);
      const names = imports.split(',').map((entry) => entry.trim()).filter((entry) => entry && !/^type\s+/i.test(entry)).map((entry) => {
        const parts = entry.split(/\s+as\s+/i);
        return { imported: parts[0], local: parts[1] || parts[0] };
      });
      if (!names.length) return '';
      let result = `var __imp_${names[0].local} = window.__require('${resolved}') || {};\n`;
      names.forEach(({ imported, local }) => {
        result += `var ${local} = __imp_${names[0].local}['${imported}'] || __imp_${names[0].local}.default;\n`;
      });
      return result;
    }
  );

  // Handle any remaining imports (npm packages - just stub them)
  content = content.replace(
    /import\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s+from\s+['"][^'"]+['"];?/g,
    '// [import removed - not available in preview]'
  );

  // Handle: export default function Name
  const modulePath = file.path.replace(/\.(?:jsx?|tsx?)$/, '');
  let exportedName = null;

  // Handle re-exports: export { default } from './x', export { A as B } from './x', export * from './x'.
  // These must run before the plain `export { ... }` handler, which would strip the braces and leave a dangling `from`.
  let reExportIndex = 0;
  content = content.replace(
    /export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (_, entries, source) => {
      if (!source.startsWith('.')) return '';
      const id = reExportIndex++;
      const mod = `__reexp_${id}`;
      let result = `var ${mod} = window.__require('${resolveModulePath(file.path, source)}') || {};\n`;
      entries.split(',').map((entry) => entry.trim()).filter((entry) => entry && !/^type\s+/i.test(entry)).forEach((entry, index) => {
        const parts = entry.split(/\s+as\s+/i).map((part) => part.trim());
        const imported = parts[0];
        const exported = parts[1] || parts[0];
        const local = `${mod}_${index}`;
        result += `var ${local} = ${mod}['${imported}']${imported === 'default' ? '' : ` || ${mod}.default`};\n`;
        if (exported === 'default') exportedName = local;
        else namedExports.push({ local, exported });
      });
      return result;
    }
  );
  content = content.replace(
    /export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (_, source) => {
      if (!source.startsWith('.')) return '';
      const id = reExportIndex++;
      const mod = `__reexp_${id}`;
      return `var ${mod} = window.__require('${resolveModulePath(file.path, source)}') || {};\nObject.keys(${mod}).forEach(function (key) { if (key !== 'default') { (window.__reexports = window.__reexports || {})[key] = ${mod}[key]; } });\n`;
    }
  );

  content = content.replace(
    /export\s+default\s+function\s+([\w$]+)/g,
    (_, name) => {
      exportedName = name;
      return `function ${name}`;
    }
  );

  // Handle: export default class Name
  content = content.replace(
    /export\s+default\s+class\s+([\w$]+)/g,
    (_, name) => {
      exportedName = name;
      return `class ${name}`;
    }
  );

  // Handle: const Name = ... ; export default Name;
  content = content.replace(/export\s+default\s+([\w$]+)\s*;/g, (_, name) => {
    exportedName = name;
    return `// default export: ${name}`;
  });

  // Handle: export default (arrow function or expression)
  if (!exportedName) {
    content = content.replace(/export\s+default\s+/, () => {
      exportedName = '__default_' + modulePath.replace(/[^a-zA-Z0-9]/g, '_');
      return `var ${exportedName} = `;
    });
  }

  // Handle: export const/function (named exports)
  content = content.replace(
    /export\s+(const|let|var|function)\s+([\w$]+)/g,
    (_, keyword, name) => {
      namedExports.push({ local: name, exported: name });
      return `${keyword} ${name}`;
    }
  );

  // Handle runtime export lists after declarations: export { Foo, Bar as Baz }.
  content = content.replace(/export\s*\{([^}]+)\}\s*;?/g, (_, entries) => {
    entries.split(',').map((entry) => entry.trim()).filter(Boolean).forEach((entry) => {
      if (/^type\s+/i.test(entry)) return;
      const parts = entry.split(/\s+as\s+/i);
      namedExports.push({ local: parts[0].trim(), exported: (parts[1] || parts[0]).trim() });
    });
    return '';
  });

  // Auto-detect component name if no export found
  if (!exportedName) {
    const fnMatch = content.match(/(?:function|const)\s+([\w$]+)\s*[\(=]/);
    if (fnMatch) exportedName = fnMatch[1];
  }

  // Register module
  const registeredExports = [];
  if (exportedName) {
    registeredExports.push(`default: typeof ${exportedName} !== 'undefined' ? ${exportedName} : null`);
  }
  namedExports.forEach(({ local, exported }) => {
    registeredExports.push(`'${exported}': typeof ${local} !== 'undefined' ? ${local} : null`);
  });
  const registration = `\nwindow.__modules['${modulePath}'] = { ${registeredExports.join(', ')} };`;

  content += registration;
  return content;
}

function resolveModulePath(currentFile, importPath) {
  const currentDir = currentFile.split('/').slice(0, -1).join('/');
  const parts = importPath.replace(/\.(?:jsx?|tsx?)$/, '').split('/');
  const currentParts = currentDir.split('/').filter(Boolean);

  const resolved = [...currentParts];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function sortFilesByDependency(files) {
  const byModulePath = new Map(files.map((file) => [file.path.replace(/\.(?:jsx?|tsx?)$/, ''), file]));
  const roots = [...files].sort((a, b) => {
    const aIsApp = /(^|\/)app\.(?:jsx?|tsx?)$/i.test(a.path);
    const bIsApp = /(^|\/)app\.(?:jsx?|tsx?)$/i.test(b.path);
    if (aIsApp !== bIsApp) return aIsApp ? 1 : -1;
    return a.path.localeCompare(b.path);
  });
  const state = new Map();
  const ordered = [];

  const visit = (file) => {
    const status = state.get(file.path);
    if (status === 'visited' || status === 'visiting') return;
    state.set(file.path, 'visiting');

    const dependencies = [];
    const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?["'](\.[^"']+)["']/g;
    let match;
    while ((match = importRegex.exec(file.content || '')) !== null) {
      const dependency = byModulePath.get(resolveModulePath(file.path, match[1]));
      if (dependency && dependency.path !== file.path) dependencies.push(dependency);
    }
    dependencies.sort((a, b) => a.path.localeCompare(b.path)).forEach(visit);

    state.set(file.path, 'visited');
    ordered.push(file);
  };

  roots.forEach(visit);
  return ordered;
}
