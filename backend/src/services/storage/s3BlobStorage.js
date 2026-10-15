const { createHash } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

let client;

function isConfigured() {
  return Boolean(String(process.env.S3_BUCKET || '').trim());
}

function getClient() {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      ...(String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true' ? { forcePathStyle: true } : {})
    });
  }
  return client;
}

function contentTypeForPath(filePath = '') {
  const extension = String(filePath).split('.').pop()?.toLowerCase();
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', woff: 'font/woff',
    woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf',
    js: 'text/javascript', jsx: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript',
    css: 'text/css', html: 'text/html', json: 'application/json', md: 'text/markdown', txt: 'text/plain'
  })[extension] || 'application/octet-stream';
}

async function bodyToBuffer(body) {
  if (!body) throw new Error('S3 returned an empty object body.');
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function bufferForFile(file) {
  return file.encoding === 'base64'
    ? Buffer.from(String(file.content || ''), 'base64')
    : Buffer.from(String(file.content || ''), 'utf8');
}

async function uploadFile(file) {
  if (!isConfigured()) throw new Error('S3_BUCKET must be configured before project files can be persisted.');
  const body = bufferForFile(file);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const prefix = String(process.env.S3_PREFIX || 'veave/blobs').replace(/^\/+|\/+$/g, '');
  const key = `${prefix}/sha256/${sha256.slice(0, 2)}/${sha256}`;
  const contentType = contentTypeForPath(file.path);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: { sha256, path: encodeURIComponent(String(file.path || '').slice(0, 500)) },
    ...(process.env.S3_SERVER_SIDE_ENCRYPTION ? { ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION } : {})
  };
  const result = body.length > 5 * 1024 * 1024
    ? await new Upload({ client: getClient(), params, queueSize: 4, partSize: 5 * 1024 * 1024, leavePartsOnError: false }).done()
    : await getClient().send(new PutObjectCommand(params));
  return {
    provider: 's3',
    bucket: process.env.S3_BUCKET,
    key,
    etag: result.ETag || null,
    versionId: result.VersionId || null,
    sha256,
    size: body.length,
    contentType
  };
}

async function dehydrateFiles(files = []) {
  const output = [];
  for (let index = 0; index < files.length; index += 8) {
    const batch = await Promise.all(files.slice(index, index + 8).map(async (file) => {
      const raw = file?.toObject ? file.toObject() : file;
      if (!raw?.content && raw?.blob?.provider === 's3') return { ...raw };
      if (raw?.blob?.provider === 's3' && raw.blob.sha256 === createHash('sha256').update(bufferForFile(raw)).digest('hex')) {
        return { ...raw, content: '' };
      }
      const blob = await uploadFile(raw);
      return { ...raw, content: '', blob };
    }));
    output.push(...batch);
  }
  return output;
}

async function hydrateFile(file) {
  if (file?.content || file?.blob?.provider !== 's3') return { ...file };
  const result = await getClient().send(new GetObjectCommand({ Bucket: file.blob.bucket, Key: file.blob.key }));
  const body = await bodyToBuffer(result.Body);
  const sha256 = createHash('sha256').update(body).digest('hex');
  if (file.blob.sha256 && sha256 !== file.blob.sha256) throw new Error(`S3 asset integrity check failed for ${file.path}.`);
  return { ...file, content: body.toString(file.encoding === 'base64' ? 'base64' : 'utf8') };
}

async function hydrateFiles(files = []) {
  const output = [];
  for (let index = 0; index < files.length; index += 8) {
    output.push(...await Promise.all(files.slice(index, index + 8).map((file) => hydrateFile(file.toObject ? file.toObject() : file))));
  }
  return output;
}

function setClientForTests(value) {
  client = value;
}

module.exports = { isConfigured, dehydrateFiles, hydrateFile, hydrateFiles, contentTypeForPath, setClientForTests };
