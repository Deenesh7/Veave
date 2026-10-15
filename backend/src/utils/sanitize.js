const sanitizeInput = (str) => {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, '');
};

const sanitizePath = (path) => {
  if (typeof path !== 'string') return '';
  const cleanPath = path.replace(/\.\.\//g, '').replace(/^\/+/, '');
  if (
    cleanPath.startsWith('src/') ||
    cleanPath === 'package.json' ||
    cleanPath === 'index.html' ||
    cleanPath === 'vite.config.js' ||
    cleanPath === 'tailwind.config.js' ||
    cleanPath === 'postcss.config.js'
  ) {
    return cleanPath;
  }
  return `src/${cleanPath}`;
};

module.exports = {
  sanitizeInput,
  sanitizePath
};
