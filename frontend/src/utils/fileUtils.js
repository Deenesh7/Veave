const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif', 'ico', 'bmp']);

export function isImageFile(path = '') {
  const clean = String(path || '').toLowerCase();
  if (
    clean.startsWith('public/images/') ||
    clean.startsWith('public/assets/images/') ||
    clean.startsWith('public/assets/logos/') ||
    clean.startsWith('public/assets/icons/') ||
    clean.startsWith('images/')
  ) {
    return true;
  }
  const ext = clean.split('.').pop();
  return IMAGE_EXTENSIONS.has(ext);
}

export const PROJECT_FOLDER_DEFINITIONS = [
  {
    id: 'pages',
    name: 'Pages',
    folderPath: 'src/pages/',
    badge: 'Pages',
    description: 'Application route pages and views',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-700',
    accentBorder: 'border-blue-200/60'
  },
  {
    id: 'components',
    name: 'Components',
    folderPath: 'src/components/',
    badge: 'Components',
    description: 'Reusable UI components, sections, and layouts',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-700',
    accentBorder: 'border-emerald-200/60'
  },
  {
    id: 'lib',
    name: 'Lib & Utils',
    folderPath: 'src/lib/',
    badge: 'Library',
    description: 'Utilities, helpers, custom hooks, and services',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-700',
    accentBorder: 'border-amber-200/60'
  },
  {
    id: 'images',
    name: 'Images',
    folderPath: 'public/images/',
    badge: 'Image Store',
    description: 'Project images, logos, icons, and visual media',
    accentBg: 'bg-purple-50',
    accentText: 'text-purple-700',
    accentBorder: 'border-purple-200/60'
  },
  {
    id: 'styles',
    name: 'Styles & Assets',
    folderPath: 'src/styles/',
    badge: 'Styles',
    description: 'Stylesheets, design tokens, fonts, and static documents',
    accentBg: 'bg-sky-50',
    accentText: 'text-sky-700',
    accentBorder: 'border-sky-200/60'
  },
  {
    id: 'config',
    name: 'App Entry & Config',
    folderPath: '/',
    badge: 'Config',
    description: 'App.jsx, main.jsx, package.json, Vite & Tailwind config',
    accentBg: 'bg-zinc-100',
    accentText: 'text-zinc-700',
    accentBorder: 'border-zinc-200/60'
  }
];

export function getFileCategory(filePath = '') {
  const clean = String(filePath || '').replace(/^\/+/, '').toLowerCase();
  const ext = clean.split('.').pop() || '';

  if (isImageFile(clean)) {
    return 'images';
  }
  if (
    clean.startsWith('src/pages/') ||
    clean.startsWith('pages/') ||
    clean.startsWith('src/views/') ||
    /page\.(jsx|tsx|js|ts)$/i.test(clean)
  ) {
    return 'pages';
  }
  if (
    clean.startsWith('src/components/') ||
    clean.startsWith('components/') ||
    clean.startsWith('src/layouts/') ||
    clean.startsWith('src/sections/')
  ) {
    return 'components';
  }
  if (
    clean.startsWith('src/lib/') ||
    clean.startsWith('lib/') ||
    clean.startsWith('src/utils/') ||
    clean.startsWith('utils/') ||
    clean.startsWith('src/hooks/') ||
    clean.startsWith('hooks/') ||
    clean.startsWith('src/services/') ||
    clean.startsWith('services/') ||
    clean.startsWith('src/store/') ||
    clean.startsWith('src/context/') ||
    clean.startsWith('src/data/')
  ) {
    return 'lib';
  }
  if (
    ext === 'css' ||
    ext === 'scss' ||
    clean.endsWith('tokens.json') ||
    clean.startsWith('public/assets/fonts/') ||
    clean.startsWith('public/assets/documents/')
  ) {
    return 'styles';
  }
  return 'config';
}

export function buildFileTree(files) {
  if (!files || files.length === 0) return [];

  const root = [];

  const ensureFolder = (folderPath) => {
    const parts = folderPath.split('/').filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      let existing = current.find((node) => node.name === part && node.type === 'folder');
      if (!existing) {
        existing = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          type: isFileNode(false),
          children: []
        };
        current.push(existing);
      }
      current = existing.children;
    });
  };

  function isFileNode(isFile) {
    return isFile ? 'file' : 'folder';
  }

  // Ensure standard organized folders exist in every project tree
  ensureFolder('src/pages');
  ensureFolder('src/components');
  ensureFolder('src/lib');
  ensureFolder('public/images');

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
