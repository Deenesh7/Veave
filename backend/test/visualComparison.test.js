const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { inspectReference, compareScreenshot } = require('../runner/visualComparison.cjs');
const { decodeVisualReference } = require('../src/services/ai/executionRunner');

async function image(color, overlay = null) {
  let pipeline = sharp({
    create: { width: 320, height: 240, channels: 3, background: color }
  });
  if (overlay) pipeline = pipeline.composite(overlay);
  return pipeline.png().toBuffer();
}

async function reference(t, buffer) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-visual-test-'));
  const file = path.join(directory, 'reference');
  await fs.writeFile(file, buffer);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return inspectReference(file);
}

test('identical rendered screenshot passes with stable hashes and viewport metadata', async (t) => {
  const buffer = await image('#336699');
  const inspected = await reference(t, buffer);
  const result = await compareScreenshot(inspected, buffer, 0.99);
  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
  assert.deepEqual(result.viewport, { width: 320, height: 240 });
  assert.equal(result.referenceHash, result.renderedHash);
});

test('large visual mismatch fails and identifies the lowest-scoring area', async (t) => {
  const expected = await image('#ffffff', [{
    input: { create: { width: 150, height: 100, channels: 3, background: '#111111' } },
    left: 0,
    top: 0
  }]);
  const actual = await image('#ffffff');
  const result = await compareScreenshot(await reference(t, expected), actual, 0.98);
  assert.equal(result.passed, false);
  assert.ok(result.score < 0.98);
  assert.equal(result.lowestScoringRegions[0].name, 'top-left');
});

test('visual reference decoder rejects MIME spoofing and oversized or unsupported input', async () => {
  const png = await image('#fff');
  const valid = `data:image/png;base64,${png.toString('base64')}`;
  assert.deepEqual(decodeVisualReference(valid).buffer, png);
  assert.throws(() => decodeVisualReference(`data:image/jpeg;base64,${png.toString('base64')}`), /does not match/);
  assert.throws(() => decodeVisualReference('data:image/gif;base64,R0lGODlh'), /PNG, JPEG, or WebP/);
  assert.throws(() => decodeVisualReference('not-an-image'), /data URL/);
});
