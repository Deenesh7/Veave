import React, { useState } from 'react';
import { ShareLinkRow } from './ShareLinkRow';

export function ShareLinks({ projectId = 'abc123' }) {
  const [previewAccess, setPreviewAccess] = useState('Anyone with the link');
  const [editorAccess, setEditorAccess] = useState('Only invited users');

  const cleanId = projectId || 'abc123';
  const previewUrl = `https://veave.app/c/project/preview/${cleanId}`;
  const editorUrl = `https://veave.app/c/project/${cleanId}`;

  return (
    <div className="space-y-2.5 mb-5">
      <ShareLinkRow
        type="preview"
        title="Preview"
        url={previewUrl}
        accessLevel={previewAccess}
        onAccessChange={setPreviewAccess}
        options={['Anyone with the link', 'Only invited users', 'Disabled']}
      />

      <ShareLinkRow
        type="editor"
        title="Editor"
        url={editorUrl}
        accessLevel={editorAccess}
        onAccessChange={setEditorAccess}
        options={['Only invited users', 'Anyone with the link', 'Disabled']}
      />
    </div>
  );
}

export default ShareLinks;
