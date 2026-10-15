import React, { useMemo } from 'react';
import { buildPreviewHTML } from '../../utils/codeTransformer';

export default function ProjectPreview({ project }) {
  const previewUrl = project?.validation?.previewUrl || '';
  const previewHtml = useMemo(() => {
    if (previewUrl || !Array.isArray(project?.files) || project.files.length === 0) return '';
    try {
      return buildPreviewHTML(project.files, project.dependencies || []);
    } catch (error) {
      return '';
    }
  }, [previewUrl, project?.files, project?.dependencies]);

  if (!previewUrl && !previewHtml) {
    return <div className="w-full h-full bg-zinc-100" aria-label="Preview unavailable" />;
  }

  return (
    <div className="w-full h-full overflow-hidden bg-white pointer-events-none" aria-label={`${project?.name || 'Project'} website preview`}>
      <iframe
        src={previewUrl || undefined}
        srcDoc={previewUrl ? undefined : previewHtml}
        title={`${project?.name || 'Project'} preview`}
        sandbox={`allow-scripts allow-forms${previewUrl ? ' allow-same-origin' : ''}`}
        tabIndex={-1}
        className="border-0 origin-top-left pointer-events-none"
        style={{ width: '400%', height: '400%', transform: 'scale(0.25)' }}
      />
    </div>
  );
}
