import React from 'react';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

export function VisualEditorLoadingScreen({
  isVisible = true,
  onComplete,
  isReady = false,
  title = 'Loading canvas...',
  subtitle = 'Connecting design canvas & real-time DOM inspector',
  size = 'lg',
  className = '',
}) {
  return (
    <CanvasLoadingOverlay
      isVisible={isVisible}
      onComplete={onComplete}
      isReady={isReady}
      title={title}
      subtitle={subtitle}
      size={size}
      className={className}
    />
  );
}

export default VisualEditorLoadingScreen;
