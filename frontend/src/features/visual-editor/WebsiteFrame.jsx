import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useVisualEditorStore } from './visualEditorStore';
import { ElementOverlay } from './ElementOverlay';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

export function WebsiteFrame({
  previewHtml,
  isBuilding = false,
  onIframeReady,
  onTextEdited
}) {
  const iframeRef = useRef(null);
  const containerRef = useRef(null);

  const { 
    activeMode, 
    setSelectedElement, 
    setHoveredElement, 
    setLayersTree,
    updateElementText
  } = useVisualEditorStore();

  const isVisualEdit = activeMode === 'editor';
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);

  useEffect(() => {
    setIsIframeLoaded(false);
    // Safety auto-unlock: If browser does not emit standard iframe onLoad for srcDoc, unlock after brief paint
    const t = setTimeout(() => {
      setIsIframeLoaded(true);
    }, 120);
    return () => clearTimeout(t);
  }, [previewHtml]);

  // Toggle inspect mode inside iframe
  const notifyIframe = useCallback(() => {
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'toggle-inspect-mode',
          enabled: isVisualEdit
        }, '*');

        // Request the DOM tree for Layers Panel
        iframeRef.current.contentWindow.postMessage({
          type: 'request-dom-tree'
        }, '*');
      }
    } catch (e) {}
  }, [isVisualEdit]);

  useEffect(() => {
    notifyIframe();
    const t = setTimeout(notifyIframe, 200);
    const t2 = setTimeout(notifyIframe, 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [notifyIframe, previewHtml]);

  // Message handler for messages posted from inside the iframe
  useEffect(() => {
    const handleMessage = (e) => {
      if (!e.data) return;

      if (e.data.type === 'preview-inspect-ready') {
        setIsIframeLoaded(true);
        notifyIframe();
      } else if (e.data.type === 'preview-rendered') {
        setIsIframeLoaded(true);
      } else if (e.data.type === 'visual-element-hovered') {
        if (isVisualEdit) {
          setHoveredElement(e.data.element);
        }
      } else if (e.data.type === 'visual-element-selected') {
        setIsIframeLoaded(true);
        setSelectedElement(e.data.element);
      } else if (e.data.type === 'visual-element-rect-updated') {
        if (useVisualEditorStore.getState().updateSelectedElementRect) {
          useVisualEditorStore.getState().updateSelectedElementRect(e.data.rect);
        }
      } else if (e.data.type === 'visual-text-edited') {
        if (e.data.newText) {
          updateElementText(e.data.newText);
          if (onTextEdited) {
            onTextEdited(e.data.newText, e.data.oldText);
          }
        }
      } else if (e.data.type === 'dom-tree-ready') {
        setIsIframeLoaded(true);
        if (e.data.tree) {
          setLayersTree(e.data.tree);
        }
      } else if (e.data.type === 'preview-route-changed') {
        if (e.data.route) {
          useVisualEditorStore.getState().setActiveRoute(e.data.route);
        }
      } else if (e.data.type === 'clear-inspect-selection') {
        setSelectedElement(null);
        setHoveredElement(null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isVisualEdit, setSelectedElement, setHoveredElement, setLayersTree, updateElementText, notifyIframe, onTextEdited]);

  // Expose iframeRef to parent via onIframeReady
  useEffect(() => {
    if (onIframeReady) {
      onIframeReady(iframeRef.current);
    }
  }, [onIframeReady]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-0 bg-white overflow-hidden">
      {/* The isolated website iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={previewHtml}
        onLoad={() => {
          setIsIframeLoaded(true);
          notifyIframe();
          setTimeout(notifyIframe, 150);
          setTimeout(notifyIframe, 500);
        }}
        title="Visual Editor Live Preview"
        sandbox="allow-scripts allow-modals allow-popups allow-forms"
        className="w-full h-full bg-white border-0 absolute inset-0 z-10"
      />

      {/* Visual Selection & Hover Canvas Overlay */}
      {isVisualEdit && <ElementOverlay />}

      {/* Canvas Refreshing Animated Overlay only shown during initial blank compilation */}
      <CanvasLoadingOverlay
        isVisible={isBuilding && !previewHtml}
        title="Loading canvas..."
        subtitle="Rendering visual components"
        size="md"
      />
    </div>
  );
}

export default WebsiteFrame;
