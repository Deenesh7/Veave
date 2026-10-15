const detectLanguage = (path) => {
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  return 'text';
};

const createFile = (files, path, content) => {
  const newFiles = [...files];
  const index = newFiles.findIndex(f => f.path === path);
  if (index === -1) {
    newFiles.push({ path, content, language: detectLanguage(path) });
  } else {
    newFiles[index].content = content;
  }
  return newFiles;
};

const modifyFile = (files, path, content) => {
  const newFiles = [...files];
  const index = newFiles.findIndex(f => f.path === path);
  if (index !== -1) {
    newFiles[index].content = content;
  } else {
    newFiles.push({ path, content, language: detectLanguage(path) });
  }
  return newFiles;
};

const deleteFile = (files, path) => {
  return files.filter(f => f.path !== path);
};

const renameFile = (files, oldPath, newPath) => {
  const newFiles = [...files];
  const index = newFiles.findIndex(f => f.path === oldPath);
  if (index !== -1) {
    newFiles[index].path = newPath;
    newFiles[index].language = detectLanguage(newPath);
  }
  return newFiles;
};

const getFileTree = (files) => {
  const root = {};
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = { type: 'file', content: file.content, language: file.language, path: file.path };
      } else {
        if (!current[part]) {
          current[part] = { type: 'directory', children: {} };
        }
        current = current[part].children;
      }
    }
  });
  return root;
};

module.exports = {
  createFile,
  modifyFile,
  deleteFile,
  renameFile,
  getFileTree,
  detectLanguage
};
