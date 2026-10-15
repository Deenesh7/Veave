const getModificationPrompt = (request, currentFiles, selectedElement = null) => {
  const fileList = currentFiles.map(f => f.path).join(', ');
  const selectionContext = selectedElement
    ? `\nSelected element (authoritative target):\n${JSON.stringify(selectedElement, null, 2)}\nUse sourceFile and selector/text to patch only this exact instance.`
    : '';
  
  return `Modify the existing project based on this request:
"${request}"

Current project files: ${fileList}
${selectionContext}

Rules for modification:
1. One instruction equals one targeted change. Identify the exact element and exact property requested.
2. Do NOT recreate or emit files that remain unchanged.
3. For a specific element/property request, return exactly one patch_file action with the smallest exact search and replacement block.
4. Never return modify_file, create_file, or delete_file for a single-element style/content request.
5. Do not modify global CSS, shared styles, design tokens, layout, spacing, colors, sizing, positioning, typography, or behavior unless explicitly requested.
6. If a shared class affects multiple elements, add a local targeted style/class to only the requested instance.
7. Ensure changes integrate with existing code while preserving all unrelated code and behavior exactly.
8. If creating new components, follow the window.__modules pattern.`;
};

module.exports = { getModificationPrompt };
