import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { buildPreviewHTML } from '../utils/codeTransformer';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { computePreviewHash } from '../utils/previewHash';
import { previewService, ASSET_BASE_PLACEHOLDER } from '../services/previewService';

// Cheap change detector: FNV-1a over text sources; binary assets use path + length + edges only,
// so megabytes of base64 are never stringified on every render.
export function quickFingerprint(files) {
  if (!files) return undefined;
  let hash = 2166136261;
  const mix = (text) => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  const sorted = [...files].sort((a, b) => String(a.path).localeCompare(String(b.path)));
  for (const file of sorted) {
    const content = String(file.content || '');
    mix(`${file.path}\0${content.length}\0`);
    if (file.encoding === 'base64') mix(content.slice(0, 64) + content.slice(-64));
    else mix(content);
  }
  return `${sorted.length}:${(hash >>> 0).toString(36)}`;
}

export function usePreview({ validation, files: currentFiles, previewKey = 0, projectId = null, skipBuiltPreview = false, onPreviewError, onPreviewRendered } = {}) {
  const iframeRef = useRef(null);
  const onPreviewErrorRef = useRef(onPreviewError);
  const onPreviewRenderedRef = useRef(onPreviewRendered);
  const buildIdRef = useRef(0);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const addConsoleOutput = useEditorStore((state) => state.addConsoleOutput);
  const validationKey = JSON.stringify([validation?.status, validation?.sourceHash, validation?.previewUrl, previewKey]);
  const filesFingerprint = useMemo(() => quickFingerprint(currentFiles), [currentFiles]);

  useEffect(() => {
    onPreviewErrorRef.current = onPreviewError;
    onPreviewRenderedRef.current = onPreviewRendered;
  }, [onPreviewError, onPreviewRendered]);

  useEffect(() => {
    // Invalidate pending digests on edits, validation changes, and unmount.
    return () => { buildIdRef.current += 1; };
  }, [filesFingerprint, validationKey]);

  const buildPreview = useCallback(async (files) => {
    const buildId = ++buildIdRef.current;
    setPreview(null);
    setPreviewError('');
    if (!files || files.length === 0) {
      return '';
    }
    const fingerprint = quickFingerprint(files);
    const [status, sourceHash, url] = JSON.parse(validationKey);
    // A built bundle has no inspect script, so nothing in it can be selected; inspection needs the compiled preview.
    if (!skipBuiltPreview && status === 'passed' && sourceHash && url) {
      try {
        // The server hash covers the full source, so the exact JSON form is only built when a validated build exists.
        const fullFingerprint = JSON.stringify(files.map(({ path, content }) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path)));
        const previewUrl = new URL(url);
        // Built modules need their own origin; never grant same-origin access to the studio.
        if (!['http:', 'https:'].includes(previewUrl.protocol) || previewUrl.origin === window.location.origin) {
          throw new Error('Built preview must use a separate HTTP(S) origin');
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullFingerprint));
        if (buildId !== buildIdRef.current) return '';
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash === sourceHash) {
          setPreview({ html: '', url: previewUrl.href, fingerprint, validationKey, buildId });
          return '';
        }
      } catch (err) {
        // Missing Web Crypto or unusable validation stays explicitly unverified.
        console.warn('Built preview verification unavailable:', err);
      }
    }
    if (buildId !== buildIdRef.current) return '';

    // Preferred path: the server already compiled this exact source when it was created/saved, so just show it.
    // Unsaved local edits do not match the stored hash and fall through to compiling in the browser below.
    if (projectId) {
      try {
        const hash = await computePreviewHash(files);
        if (buildId !== buildIdRef.current) return '';
        const stored = await previewService.getPrecompiled(projectId, hash);
        if (buildId !== buildIdRef.current) return '';
        if (stored?.match && stored.html) {
          const base = `${window.location.origin}/api/preview-assets/${stored.token}`;
          const html = stored.html.split(ASSET_BASE_PLACEHOLDER).join(base);
          setPreview({ html, url: '', precompiled: true, fingerprint, validationKey, buildId });
          return html;
        }
      } catch (err) {
        console.warn('Stored preview unavailable, compiling in the browser:', err?.message || err);
      }
      if (buildId !== buildIdRef.current) return '';
    }

    try {
      // Binary assets are not held in the editor (contentOmitted); point the local compile at the asset server instead.
      const token = files.some((file) => file?.contentOmitted) ? useProjectStore.getState().currentProject?.previewAssetToken : null;
      const html = buildPreviewHTML(files, [], token ? { assetBase: `${window.location.origin}/api/preview-assets/${token}` } : {});
      setPreview({ html, url: '', fingerprint, validationKey, buildId });
      return html;
    } catch (err) {
      const message = 'Preview build failed: ' + err.message;
      setPreviewError(message);
      console.error('Preview build failed:', err);
      addConsoleOutput({
        type: 'error',
        message,
        timestamp: new Date(),
      });
      onPreviewErrorRef.current?.({ message });
      return '';
    }
  }, [addConsoleOutput, validationKey, projectId, skipBuiltPreview]);

  const refreshPreview = useCallback((files) => {
    return buildPreview(files);
  }, [buildPreview]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;
      if (data?.type === 'preview-error' || (data?.type === 'preview-rendered' && (data.error || ['no-app', 'blank', 'error', 'failed', 'blocked'].includes(data.status)))) {
        const error = typeof data.error === 'string' ? { message: data.error } : (data.error || {});
        const message = error.message || ({
          'no-app': 'Application entry could not be rendered: the default React component export is missing.',
          blank: 'Blank screen detected: the application rendered no visible content.',
        }[data.status]) || 'Application preview failed to render.';
        const line = error.line ? ` (Line ${error.line})` : '';
        setPreviewError(`${message}${line}`);
        addConsoleOutput({
          type: 'error',
          message: `${message}${line}`,
          timestamp: new Date(),
        });
        onPreviewErrorRef.current?.({ ...error, message });
      } else if (data?.type === 'preview-rendered' && data.status === 'success') {
        onPreviewRenderedRef.current?.();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [addConsoleOutput]);

  const isCurrent = preview && preview.validationKey === validationKey && (filesFingerprint === undefined || preview.fingerprint === filesFingerprint);
  const previewUrl = isCurrent ? preview.url : '';
  const previewHtml = isCurrent ? preview.html : '';
  const statusLabel = previewError ? 'Preview runtime error' : previewUrl ? 'Built preview - validated' : preview?.precompiled && isCurrent ? 'Precompiled preview' : 'Legacy preview - unverified';

  return { iframeRef, previewHtml, previewUrl, previewBuildId: isCurrent ? preview.buildId : 0, previewError, statusLabel, buildPreview, refreshPreview };
}
