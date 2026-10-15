const fs = require('fs');
const path = require('path');

const dir = 'e:\\vaina pro\\Veave\\frontend\\src';

const hexMap = {
  '#2563EB': '#18181B',
  '#2563eb': '#18181B',
  '#3B82F6': '#27272A',
  '#3b82f6': '#27272A',
  '#1D4ED8': '#09090B',
  '#1d4ed8': '#09090B',
  '#60A5FA': '#3F3F46',
  '#60a5fa': '#3F3F46',
  '#93C5FD': '#52525B',
  '#93c5fd': '#52525B',
  '#BFDBFE': '#A1A1AA',
  '#bfdbfe': '#A1A1AA',
  '#DBEAFE': '#E4E4E7',
  '#dbeafe': '#E4E4E7',
  '#EFF6FF': '#F4F4F5',
  '#eff6ff': '#F4F4F5',
  '#3B9FE8': '#52525B',
  '#3b9fe8': '#52525B'
};

function walkDir(currentPath) {
  const files = fs.readdirSync(currentPath);
  for (const file of files) {
    const fullPath = path.join(currentPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath);
    } else if (fullPath.endsWith('.jsx') || fullPath.endsWith('.js') || fullPath.endsWith('.css')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;

      // Replace tailwind blue classes
      content = content.replace(/\bblue-(\d{2,3})\b/g, 'zinc-$1');

      // Replace hex codes
      for (const [blueHex, zincHex] of Object.entries(hexMap)) {
        content = content.split(blueHex).join(zincHex);
      }

      // Also replace text-blue, bg-blue just in case there are specific hardcoded ones? No, \bblue-\d+ covers it.

      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

walkDir(dir);
console.log('Replacement complete.');
