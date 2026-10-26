// Prepares a user-picked image for upload with an edit request: large photos are scaled down and re-encoded so the
// request stays small, while SVG/GIF (which would lose vectors or animation) are sent untouched.
const MAX_SIDE = 1920;
const MAX_BYTES = 3 * 1024 * 1024;
const PASSTHROUGH = new Set(['image/svg+xml', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']);

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the image.'));
  reader.readAsDataURL(blob);
});

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('This image could not be decoded.'));
  img.src = url;
});

const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

export async function prepareImageForUpload(file) {
  const original = await readAsDataUrl(file);
  if (PASSTHROUGH.has(file.type) || (file.size <= 1.5 * 1024 * 1024 && file.type !== 'image/heic')) {
    if (file.size > MAX_BYTES) throw new Error('This image is too large. Choose one under 3 MB.');
    return { dataUrl: original, size: file.size, type: file.type };
  }
  const img = await loadImage(original);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/webp', 0.86 - attempt * 0.1);
    if (blob && blob.size <= MAX_BYTES) return { dataUrl: await readAsDataUrl(blob), size: blob.size, type: 'image/webp' };
    scale *= 0.75;
  }
  throw new Error('This image is too large even after compression. Choose a smaller one.');
}
