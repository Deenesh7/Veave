const { randomBytes } = require('node:crypto');
const { extname } = require('node:path');
const PreviewArtifact = require('../../models/PreviewArtifact');
const { dehydrateFiles, hydrateFile } = require('../storage/s3BlobStorage');

function previewOrigin(token) {
  const template = process.env.VEAVE_PREVIEW_ORIGIN || `http://{token}.localhost:${process.env.PORT || 5000}`;
  if (!template.includes('{token}')) throw new Error('VEAVE_PREVIEW_ORIGIN must contain {token} in a dedicated hostname.');
  const url = new URL(template.replace('{token}', token));
  if (!url.hostname.startsWith(`${token}.`) || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid dedicated preview origin configuration.');
  }
  return url.origin;
}

async function publishPreview(artifacts, sourceHash) {
  if (!Array.isArray(artifacts) || artifacts.length === 0 || !artifacts.some((file) => file?.path === 'dist/index.html')) {
    return null;
  }
  if (artifacts.length > 2000) throw new Error('Invalid build artifacts');
  for (const file of artifacts) {
    if (!/^dist\//.test(file.path) || file.path.split('/').some((part) => !part || part === '.' || part === '..') || /[\\:\x00-\x1f]/.test(file.path)) {
      throw new Error('Unsafe build artifact path');
    }
  }
  const storedArtifacts = await dehydrateFiles(artifacts.map((file) => ({ ...file, encoding: 'base64' })));
  const token = randomBytes(24).toString('hex');
  const previewUrl = `${previewOrigin(token)}/`;
  await PreviewArtifact.create({ token, sourceHash, files: storedArtifacts,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return previewUrl;
}

// Mounted before API middleware. A preview host can serve artifacts only, never
// authenticated application APIs. The iframe also omits allow-same-origin.
async function servePreview(req, res, next) {
  const token = req.hostname.split('.')[0];
  if (!/^[a-f0-9]{48}$/.test(token)) return next();
  try {
    if (req.hostname !== new URL(previewOrigin(token)).hostname) return res.sendStatus(404);
    if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
    const preview = await PreviewArtifact.findOne({ token, expiresAt: { $gt: new Date() } }).lean();
    if (!preview) return res.status(410).send('Validated preview expired. Generate a new verified revision.');
    const requested = decodeURIComponent(req.path);
    let file = preview.files.find((item) => item.path === `dist${requested === '/' ? '/index.html' : requested}`);
    if (!file && req.accepts('html') && !requested.split('/').pop().includes('.')) {
      file = preview.files.find((item) => item.path === 'dist/index.html');
    }
    if (!file) return res.sendStatus(404);
    file = await hydrateFile(file);
    res.set({ 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "frame-ancestors *; worker-src 'none'; connect-src 'self'" });
    let content = Buffer.from(file.content, 'base64');
    if (file.path === 'dist/index.html') {
      const monitor = `<script>window.addEventListener('error',function(e){var t=e.target;if(t&&t!==window&&!e.message){var u=t.currentSrc||t.src||t.href||'';console.warn('Preview asset failed to load: '+u);parent.postMessage({type:'preview-asset-warning',url:u},'*');return}parent.postMessage({type:'preview-error',error:{message:e.message||'Script error',line:e.lineno}},'*')},true);window.addEventListener('unhandledrejection',function(e){parent.postMessage({type:'preview-error',error:{message:String(e.reason)}},'*')});var veaveRoute=function(){try{parent.postMessage({type:'preview-route-changed',route:location.pathname+location.search},'*')}catch(e){}};['pushState','replaceState'].forEach(function(n){var o=history[n];history[n]=function(){var r=o.apply(this,arguments);veaveRoute();return r}});window.addEventListener('popstate',veaveRoute);window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='preview-navigate-back'){var t=typeof d.route==='string'&&d.route.charAt(0)==='/'&&d.route.charAt(1)!=='/'?d.route:'/';if(t!==location.pathname+location.search)location.replace(t);else window.scrollTo(0,0);return}if(d&&d.type==='preview-restore-route'&&typeof d.route==='string'&&d.route.charAt(0)==='/'&&d.route.charAt(1)!=='/'&&d.route!==location.pathname+location.search)location.replace(d.route)});document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a||e.defaultPrevented||e.ctrlKey||e.metaKey)return;try{var u=new URL(a.getAttribute('href')||'',location.href);if(/^https?:$/.test(u.protocol)&&u.origin!==location.origin){e.preventDefault();window.open(u.href,'_blank','noopener')}}catch(x){}},false);window.addEventListener('load',function(){veaveRoute();setTimeout(function(){var r=document.getElementById('root')||document.body;if(!r.innerText.trim()&&!r.querySelector('img,svg,canvas,input,video'))parent.postMessage({type:'preview-error',error:{message:'Blank screen in built preview'}},'*');else parent.postMessage({type:'preview-rendered',status:'success'},'*')},500)});</script>`;
      content = Buffer.from(content.toString().replace(/<head[^>]*>/i, (head) => head + monitor));
    }
    return res.type(extname(file.path)).send(content);
  } catch (error) {
    return res.status(503).send('Validated preview is unavailable.');
  }
}

module.exports = { publishPreview, servePreview, previewOrigin };
