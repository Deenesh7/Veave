const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, 'src');

const replacements = {
  'bg-zinc-950': 'bg-white',
  'bg-zinc-900': 'bg-zinc-50',
  'bg-zinc-800': 'bg-zinc-200',
  'bg-zinc-700': 'bg-zinc-300',
  'border-zinc-900': 'border-zinc-100',
  'border-zinc-800': 'border-zinc-200',
  'border-zinc-700': 'border-zinc-300',
  'text-zinc-100': 'text-zinc-900',
  'text-zinc-200': 'text-zinc-800',
  'text-zinc-300': 'text-zinc-700',
  'text-zinc-400': 'text-zinc-600',
  'text-zinc-500': 'text-zinc-500',
  'text-zinc-600': 'text-zinc-400',
  'hover:bg-zinc-800': 'hover:bg-zinc-200',
  'hover:bg-zinc-700': 'hover:bg-zinc-300',
  'hover:text-zinc-100': 'hover:text-zinc-900',
  'hover:text-zinc-300': 'hover:text-zinc-700',
  'text-white': 'text-black',
};

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (filePath.endsWith('.jsx') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      let content = fs.readFileSync(filePath, 'utf8');
      let modified = false;
      
      for (const [dark, light] of Object.entries(replacements)) {
        const regex = new RegExp(`\\b${dark}\\b`, 'g');
        if (regex.test(content)) {
          content = content.replace(regex, light);
          modified = true;
        }
      }
      
      // Special cases for index.css grid
      if (filePath.endsWith('index.css')) {
        content = content.replace(/rgba\(0 0 0 \/ 0\.05\)/g, 'rgba(0, 0, 0, 0.05)');
        content = content.replace(/rgba\(255 255 255 \/ 0\.03\)/g, 'rgba(0, 0, 0, 0.05)');
        modified = true;
      }
      
      if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
      }
    }
  }
}

processDirectory(directoryPath);
