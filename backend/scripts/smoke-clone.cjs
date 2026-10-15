require('dotenv').config();
const { captureWebsite } = require('../src/services/clone/websiteCaptureService');
const { materializeLocalizedAssets, validateLocalizedAssetReferences } = require('../src/services/clone/assetLocalizationService');
const jobManager = require('../src/services/ai/jobManager');

async function main() {
  const sourceUrl = process.argv[2] || 'https://example.com';
  const maxRoutes = Math.max(1, Number(process.argv[3]) || 1);
  process.env.ENABLE_DOCKER_VALIDATION = 'false';
  const capture = await captureWebsite(sourceUrl, { maxRoutes });
  const firstAsset = capture.assets.find((asset) => asset.mimeType.startsWith('image/'));
  let files = [
    {
      path: 'src/App.jsx',
      content: `import { Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
export default function App() { return <Routes><Route path="/" element={<Home />} /></Routes>; }`
    },
    {
      path: 'src/pages/Home.jsx',
      content: `import useEmblaCarousel from 'embla-carousel-react';
export function Home() { const [ref] = useEmblaCarousel(); return <main ref={ref}><h1>Source-driven clone</h1>${firstAsset ? `<img src="${firstAsset.token}" alt="${String(firstAsset.alt || 'Scraped source asset').replace(/"/g, '&quot;')}" />` : ''}<p>Extracted and validated.</p></main>; }`
    }
  ];
  files = materializeLocalizedAssets(files, capture.assets);
  const assetValidation = validateLocalizedAssetReferences(files);
  if (assetValidation.missing.length || assetValidation.remote.length) {
    throw new Error(`Asset validation failed: ${JSON.stringify(assetValidation)}`);
  }
  const validated = await jobManager.validateCandidate(files, {
    model: 'smoke-test',
    tokens: {},
    visualReference: null,
    allowLocalVisualFallback: true
  });
  console.log(JSON.stringify({
    captured: capture.canonicalUrl,
    routes: capture.pages.length,
    routePaths: capture.pages.map(({ path, captureStatus }) => ({ path, captureStatus })),
    extraction: capture.pages.map(({ path, extraction, styles }) => ({
      path,
      htmlBytes: Buffer.byteLength(extraction?.html || '', 'utf8'),
      domNodes: extraction?.domHierarchy?.length || 0,
      htmlSections: extraction?.htmlSections?.length || 0,
      stylesheets: styles?.styleSheets?.length || 0,
      responsiveRules: styles?.responsiveRules?.length || 0
    })),
    assets: capture.assets.map(({ token, mimeType, alt, width, height }) => ({ token, mimeType, alt, width, height })),
    assetValidation,
    status: validated.report.status,
    mode: validated.report.validationMode,
    checks: validated.report.checks
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
