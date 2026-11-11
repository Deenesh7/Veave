import { useEffect, useState } from 'react';
import { templateSiteService } from '../../services/templateSiteService';

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export const dimensionsOf = (image) => (image.width && image.height ? `${image.width} × ${image.height}px` : 'Unknown size');

/**
 * The address of a library picture for an <img>. The small preview is used when there is one; the original (needed for the large
 * view, and for pictures uploaded before previews existed) is fetched with the user's login and shown from memory.
 */
export function useImageSrc(siteId, image, { full = false, version = 'original' } = {}) {
  const thumbFor = version === 'enhanced' ? image?.enhancement?.enhancedThumbnail : image?.thumbnail;
  const [src, setSrc] = useState(!full && thumbFor ? thumbFor : '');
  const [failed, setFailed] = useState(false);
  const id = image?.id;
  const thumbnail = thumbFor;
  useEffect(() => {
    if (!id || !siteId) return undefined;
    if (!full && thumbnail) { setSrc(thumbnail); setFailed(false); return undefined; }
    let url = '';
    let cancelled = false;
    setSrc(''); setFailed(false);
    templateSiteService.getImageFile(siteId, id, { version })
      .then((res) => { if (cancelled) return; url = URL.createObjectURL(res.data); setSrc(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [siteId, id, thumbnail, full, version]);
  return { src, failed };
}
