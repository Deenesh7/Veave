const { captureWebsite } = require('../src/services/clone/websiteCaptureService');
const { materializeLocalizedAssets } = require('../src/services/clone/assetLocalizationService');
const { verifyPreviewRuntime } = require('../src/services/ai/targetRenderVerifier');

async function main() {
  const sourceUrl = process.argv[2] || 'https://www.saveetha.com';
  const maxRoutes = Math.max(1, Number.parseInt(process.argv[3], 10) || 1);
  const capture = await captureWebsite(sourceUrl, { maxRoutes });
  if (!capture.assets.length) throw new Error('No public image assets were downloaded.');

  const first = capture.assets[0];
  const files = materializeLocalizedAssets([{
    path: 'src/App.jsx',
    language: 'javascript',
    content: `export default function App(){return <main><h1>Public asset smoke test</h1><img src="${first.token}" alt="Downloaded public asset" style={{width:320,height:200,objectFit:'contain'}} /></main>}`
  }], capture.assets);
  const localized = files.find((file) => file.path === first.localPath);
  if (!localized || localized.encoding !== 'base64' || !localized.content) throw new Error('Downloaded asset was not materialized locally.');
  const source = files.find((file) => file.path === 'src/App.jsx').content;
  if (!source.includes(first.publicPath) || /https?:\/\//.test(source)) throw new Error('Generated source did not use the localized asset path.');

  const rendered = await verifyPreviewRuntime(files);
  if (!rendered.ok) throw new Error(`Localized asset did not render: ${JSON.stringify(rendered.diagnostics)}`);
  console.log(JSON.stringify({
    sourceUrl: capture.canonicalUrl,
    capturedPages: capture.coverage.capturedPages,
    downloadedAssets: capture.assets.length,
    testedOriginalUrl: first.url,
    testedLocalPath: first.localPath,
    byteLength: Buffer.byteLength(first.content, 'base64'),
    rendered: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
