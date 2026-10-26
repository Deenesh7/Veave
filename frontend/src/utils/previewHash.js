// Fingerprint of a project's source, identical to previewSourceHash() on the server
// (backend/src/services/preview/previewService.js). When it equals the hash stored with a precompiled preview,
// the stored document is exactly what these files would compile to, so it can be shown without compiling.
// Text files hash their content; binary files hash path + byte size.
const base64ByteLength = (content = '') => {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
};

export async function computePreviewHash(files = []) {
  const sorted = files.filter((file) => file && typeof file.path === 'string')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const parts = [];
  for (const file of sorted) {
    parts.push(`${file.path}\0`);
    if (file.encoding === 'base64') parts.push(`b\0${file.size ?? file.blob?.size ?? base64ByteLength(file.content || '')}\0`);
    else parts.push(`t\0${file.content || ''}\0`);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
