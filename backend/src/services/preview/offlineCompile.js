// Silence Node's experimental WebStorage getter warning triggered by @babel/standalone (main + worker threads).
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Babel = require('@babel/standalone');

const { frontendRoot, transformerPath, resolveFrom } = require('./frontendAssets');

let transformerPromise;
let cssCompiler;

function loadTransformer() {
  if (!transformerPromise) transformerPromise = import(pathToFileURL(transformerPath).href);
  return transformerPromise;
}

async function compileTailwind(content) {
  if (!cssCompiler) {
    const postcss = require(resolveFrom('postcss'));
    const tailwindcss = require(resolveFrom('tailwindcss'));
    cssCompiler = async (raw) => {
      const result = await postcss([tailwindcss({
        content: [{ raw, extension: 'html' }],
        corePlugins: { preflight: true }
      })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
      return result.css;
    };
  }
  return cssCompiler(content);
}

// Tailwind only needs the class names that occur in the document. Scanning the embedded base64 asset shim
// (tens of MB) made it take minutes while contributing no class names, so it is removed from the scan input.
function tailwindScanInput(html) {
  return html.replace(/<script>\s*\(function\(\) \{\s*var assets = [\s\S]*?<\/script>/, '');
}

/**
 * Turn project files into a self-contained, already compiled preview document:
 * JSX/TS is compiled to plain JS (no Babel in the browser) and Tailwind CSS is generated ahead of time
 * (no Tailwind CDN script in the browser).
 *
 * @param {object[]} files project files
 * @param {object} [options]
 * @param {string} [options.headMarkup] markup injected right after <head> (runtime monitors)
 * @param {string} [options.assetBase] reference public/ assets by URL instead of embedding base64
 * @param {boolean|string} [options.sourceMaps] 'inline' keeps stack traces mappable; false is smaller and faster
 */
async function compileOffline(files, { headMarkup = '', assetBase = '', sourceMaps = 'inline' } = {}) {
  const { buildPreviewHTML } = await loadTransformer();
  let html = buildPreviewHTML(files, [], assetBase ? { assetBase } : {});
  const css = await compileTailwind(tailwindScanInput(html));
  html = html.replace(/\s*<link rel="preconnect" href="https:\/\/cdn\.tailwindcss\.com"[^>]*>/i, ''); // the CDN is unused once CSS is precompiled
  html = html.replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, () => `<style>${css}</style>`);
  html = html.replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"']+"><\/script>/i, '');
  html = html.replace(/<script\s+type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/gi, (_, attributes, source) => {
    const filename = attributes.match(/data-filename="([^"]+)"/i)?.[1] || 'preview-bootstrap.jsx';
    try {
      const compiled = Babel.transform(source, {
        filename,
        presets: ['react', 'typescript'],
        sourceType: 'script',
        sourceMaps,
        ...(sourceMaps ? {} : { compact: true, comments: false })
      }).code;
      return `<script data-source-file="${filename}">${compiled}<\/script>`;
    } catch (error) {
      error.filePath = filename;
      throw error;
    }
  });
  if (headMarkup) html = html.replace(/<head>/i, () => `<head>${headMarkup}`);
  return html;
}

module.exports = { compileOffline, tailwindScanInput, frontendRoot, transformerPath };
