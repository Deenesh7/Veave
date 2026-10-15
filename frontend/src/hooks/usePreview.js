import { useRef, useEffect, useState, useCallback } from 'react';
import { buildPreviewHTML } from '../utils/codeTransformer';
import { useEditorStore } from '../store/editorStore';

export function usePreview({ validation, files: currentFiles, previewKey = 0, onPreviewError, onPreviewRendered } = {}) {
  const iframeRef = useRef(null);
  const onPreviewErrorRef = useRef(onPreviewError);
  const onPreviewRenderedRef = useRef(onPreviewRendered);
  const buildIdRef = useRef(0);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const addConsoleOutput = useEditorStore((state) => state.addConsoleOutput);
  const validationKey = JSON.stringify([validation?.status, validation?.sourceHash, validation?.previewUrl, previewKey]);
  const filesFingerprint = currentFiles && JSON.stringify(currentFiles.map(({ path, content }) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path)));

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
    const fingerprint = JSON.stringify(files.map(({ path, content }) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path)));
    const [status, sourceHash, url] = JSON.parse(validationKey);
    if (status === 'passed' && sourceHash && url) {
      try {
        const previewUrl = new URL(url);
        // Built modules need their own origin; never grant same-origin access to the studio.
        if (!['http:', 'https:'].includes(previewUrl.protocol) || previewUrl.origin === window.location.origin) {
          throw new Error('Built preview must use a separate HTTP(S) origin');
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
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
    try {
      const html = buildPreviewHTML(files);
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
  }, [addConsoleOutput, validationKey]);

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
  const statusLabel = previewError ? 'Preview runtime error' : previewUrl ? 'Built preview - validated' : 'Legacy preview - unverified';

  return { iframeRef, previewHtml, previewUrl, previewBuildId: isCurrent ? preview.buildId : 0, previewError, statusLabel, buildPreview, refreshPreview };
}
