const test = require('node:test');
const assert = require('node:assert/strict');
const { dehydrateFiles, hydrateFiles, setClientForTests } = require('../src/services/storage/s3BlobStorage');

test('project source and binary files are dehydrated to S3 and restored byte-for-byte', async () => {
  const previousBucket = process.env.S3_BUCKET;
  const previousPrefix = process.env.S3_PREFIX;
  process.env.S3_BUCKET = 'test-project-files';
  process.env.S3_PREFIX = 'tests/blobs';
  const objects = new Map();
  setClientForTests({
    send: async (command) => {
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(command.input.Key, Buffer.from(command.input.Body));
        return { ETag: 'test-etag' };
      }
      const body = objects.get(command.input.Key);
      return { Body: { transformToByteArray: async () => body } };
    }
  });

  try {
    const original = [
      { path: 'src/App.jsx', content: 'export default function App() { return <main>Hello</main>; }', language: 'javascript', encoding: 'utf8' },
      { path: 'public/assets/logo.png', content: Buffer.from([1, 2, 3, 4]).toString('base64'), language: 'binary', encoding: 'base64' }
    ];
    const stored = await dehydrateFiles(original);

    assert.ok(stored.every((file) => file.content === ''));
    assert.ok(stored.every((file) => file.blob.provider === 's3'));
    assert.equal(objects.size, 2);

    const hydrated = await hydrateFiles(stored);
    assert.deepEqual(hydrated.map(({ path, content, encoding }) => ({ path, content, encoding })), original.map(({ path, content, encoding }) => ({ path, content, encoding })));
  } finally {
    setClientForTests(null);
    if (previousBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = previousBucket;
    if (previousPrefix === undefined) delete process.env.S3_PREFIX;
    else process.env.S3_PREFIX = previousPrefix;
  }
});
