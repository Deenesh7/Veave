export function buildFileTree(files) {
  if (!files || files.length === 0) return [];

  const root = [];

  files.forEach((file) => {
    const parts = file.path.split('/');
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const existing = current.find((node) => node.name === part);

      if (existing) {
        if (!isFile) {
          current = existing.children;
        }
      } else {
        const newNode = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : [],
          content: isFile ? file.content : undefined,
          language: isFile ? file.language : undefined,
        };
        current.push(newNode);
        if (!isFile) {
          current = newNode.children;
        }
      }
    });
  });

  sortTree(root);
  return root;
}

function sortTree(nodes) {
  nodes.sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  nodes.forEach((node) => {
    if (node.children) sortTree(node.children);
  });
}

export function getFileExtension(path) {
  return path?.split('.').pop()?.toLowerCase() || '';
}

export function getFileName(path) {
  return path?.split('/').pop() || '';
}
