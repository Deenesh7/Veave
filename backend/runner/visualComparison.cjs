'use strict';

const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const REGION_NAMES = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

function clampThreshold(value) {
  const threshold = Number(value ?? 0.82);
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.99) {
    throw new Error('Visual similarity threshold must be between 0.5 and 0.99.');
  }
  return threshold;
}

async function inspectReference(referencePath) {
  const sharp = require('sharp');
  const input = await fs.readFile(referencePath);
  if (input.length > 5 * 1024 * 1024) throw new Error('Reference screenshot exceeds 5 MiB.');
  const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('Reference screenshot must be PNG, JPEG, or WebP.');
  if (!metadata.width || !metadata.height || metadata.width < 240 || metadata.height < 240 ||
      metadata.width > 3840 || metadata.height > 4096 || metadata.width * metadata.height > 16_000_000) {
    throw new Error('Reference screenshot dimensions must be 240-3840px wide, 240-4096px high, and at most 16 megapixels.');
  }
  return { input, width: metadata.width, height: metadata.height, format: metadata.format };
}

async function normalizedPixels(input, width, height) {
  const sharp = require('sharp');
  const compareWidth = Math.min(width, 360);
  const compareHeight = Math.max(1, Math.round(height * compareWidth / width));
  const { data, info } = await sharp(input, { limitInputPixels: 16_000_000 })
    .flatten({ background: '#ffffff' })
    .resize(compareWidth, compareHeight, { fit: 'fill' })
    .blur(0.5)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function scorePixels(reference, rendered) {
  if (reference.data.length !== rendered.data.length) throw new Error('Normalized screenshot sizes do not match.');
  const regionErrors = Array(9).fill(0);
  const regionSamples = Array(9).fill(0);
  let error = 0;
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < reference.width; x++) {
      const region = Math.min(2, Math.floor(y * 3 / reference.height)) * 3 +
        Math.min(2, Math.floor(x * 3 / reference.width));
      const offset = (y * reference.width + x) * reference.channels;
      for (let channel = 0; channel < 3; channel++) {
        const delta = Math.abs(reference.data[offset + channel] - rendered.data[offset + channel]);
        error += delta;
        regionErrors[region] += delta;
        regionSamples[region]++;
      }
    }
  }
  const score = 1 - error / (reference.data.length * 255);
  const regions = regionErrors.map((value, index) => ({
    name: REGION_NAMES[index],
    score: 1 - value / (regionSamples[index] * 255)
  })).sort((a, b) => a.score - b.score);
  return { score, regions };
}

async function compareScreenshot(reference, renderedBuffer, thresholdValue) {
  const threshold = clampThreshold(thresholdValue);
  const [expected, actual] = await Promise.all([
    normalizedPixels(reference.input, reference.width, reference.height),
    normalizedPixels(renderedBuffer, reference.width, reference.height)
  ]);
  const comparison = scorePixels(expected, actual);
  const score = Number(comparison.score.toFixed(4));
  return {
    passed: score >= threshold,
    score,
    threshold,
    viewport: { width: reference.width, height: reference.height },
    referenceFormat: reference.format,
    referenceHash: createHash('sha256').update(reference.input).digest('hex'),
    renderedHash: createHash('sha256').update(renderedBuffer).digest('hex'),
    lowestScoringRegions: comparison.regions.slice(0, 3).map((region) => ({
      name: region.name,
      score: Number(region.score.toFixed(4))
    }))
  };
}

module.exports = { inspectReference, compareScreenshot, clampThreshold, scorePixels };
