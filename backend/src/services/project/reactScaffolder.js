/**
 * VEAVE React Project Scaffolder
 *
 * Ensures every generated project follows a complete, industry-standard React project structure:
 *
 *   public/
 *     favicon.svg
 *     manifest.json
 *   package.json
 *   vite.config.js
 *   tailwind.config.js
 *   postcss.config.js
 *   index.html
 *   .gitignore
 *   README.md
 *   src/
 *     main.jsx
 *     App.jsx
 *     index.css
 *     tokens.json
 *     components/
 *       Navbar.jsx
 *       Footer.jsx
 *       Card.jsx
 *       Modal.jsx
 *     hooks/
 *       useToast.js
 *       useTheme.js
 *     lib/
 *       utils.js
 *     utils/
 *       helpers.js
 *     services/
 *       dataService.js
 *
 * The scaffolder is idempotent: if a file already exists, it is preserved.
 * Missing skeleton files are filled in automatically so the project is
 * fully runnable, well-architected, and adheres to standard React structure.
 */

const DEFAULT_DEPENDENCIES = {
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  'lucide-react': '^0.400.0'
};

const DEFAULT_DEV_DEPENDENCIES = {
  '@vitejs/plugin-react': '^4.3.0',
  'autoprefixer': '^10.4.20',
  'postcss': '^8.4.47',
  'tailwindcss': '^3.4.13',
  'vite': '^5.4.8'
};

class CanonicalPathMap extends Map {
  key(filePath) {
    return normalizePath(filePath).toLowerCase();
  }

  has(filePath) {
    return super.has(this.key(filePath));
  }

  get(filePath) {
    return super.get(this.key(filePath));
  }

  set(filePath, value) {
    return super.set(this.key(filePath), value);
  }
}

/**
 * @param {{path:string,content:string,language?:string}[]} sourceFiles
 * @param {object} [options]
 * @param {string} [options.projectName]
 * @param {object} [options.tokens]
 * @returns {{path:string,content:string,language:string}[]}
 */
function scaffoldReactProject(sourceFiles = [], options = {}) {
  const projectName = sanitizePkgName(options.projectName || 'veave-app');
  const tokens = options.tokens || null;

  // Normalize + dedupe input files
  const seen = new CanonicalPathMap();
  for (const f of sourceFiles) {
    if (!f || !f.path) continue;
    seen.set(normalizePath(f.path), {
      path: normalizePath(f.path),
      content: String(f.content || ''),
      language: f.language || inferLanguage(f.path),
      encoding: f.encoding || 'utf8'
    });
  }

  // 1) Ensure src/App.jsx exists
  if (!seen.has('src/App.jsx') && !seen.has('src/App.js')) {
    seen.set('src/App.jsx', {
      path: 'src/App.jsx',
      content: FALLBACK_APP,
      language: 'javascript'
    });
  }

  // 2) src/main.jsx — react entry
  if (!seen.has('src/main.jsx') && !seen.has('src/main.js')) {
    seen.set('src/main.jsx', {
      path: 'src/main.jsx',
      content: MAIN_JSX,
      language: 'javascript'
    });
  }

  // 3) src/index.css — Tailwind entry
  if (!seen.has('src/index.css')) {
    seen.set('src/index.css', {
      path: 'src/index.css',
      content: INDEX_CSS,
      language: 'css'
    });
  }

  // 4) index.html — Vite entry
  if (!seen.has('index.html')) {
    seen.set('index.html', {
      path: 'index.html',
      content: buildIndexHtml(projectName),
      language: 'html'
    });
  }
  // Crawlability: a model-written index.html must still carry the basics search engines look for.
  if (seen.has('index.html')) {
    const indexFile = seen.get('index.html');
    let html = indexFile.content;
    const before = html;
    if (!/<html[^>]*\blang=/i.test(html)) html = html.replace(/<html/i, '<html lang="en"');
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />`);
    if (!/<meta[^>]+name=["']description["']/i.test(html)) html = html.replace(/<\/head>/i, `  <meta name="description" content="${escapeHtml(projectName)} - official website." />\n  </head>`);
    if (!/<title>[^<]+<\/title>/i.test(html)) html = html.replace(/<\/head>/i, `  <title>${escapeHtml(projectName)}</title>\n  </head>`);
    if (html !== before) seen.set('index.html', { ...indexFile, content: html });
  }

  // robots.txt (the sitemap line is added with the real address when the site is published)
  if (!seen.has('public/robots.txt')) {
    seen.set('public/robots.txt', { path: 'public/robots.txt', content: 'User-agent: *\nAllow: /\n', language: 'plaintext' });
  }

  // Per-page <title>, description, canonical and social tags (read by crawlers after prerendering at publish time).
  if (!seen.has('src/hooks/useSeo.js') && !seen.has('src/hooks/useSeo.ts')) {
    seen.set('src/hooks/useSeo.js', { path: 'src/hooks/useSeo.js', content: USE_SEO_JS, language: 'javascript' });
  }

  // 5) package.json
  if (!seen.has('package.json')) {
    seen.set('package.json', {
      path: 'package.json',
      content: JSON.stringify(buildPackageJson(projectName), null, 2),
      language: 'json'
    });
  }

  // 6) vite.config.js
  if (!seen.has('vite.config.js') && !seen.has('vite.config.ts')) {
    seen.set('vite.config.js', {
      path: 'vite.config.js',
      content: VITE_CONFIG,
      language: 'javascript'
    });
  }

  // 7) tailwind.config.js
  if (!seen.has('tailwind.config.js')) {
    seen.set('tailwind.config.js', {
      path: 'tailwind.config.js',
      content: TAILWIND_CONFIG,
      language: 'javascript'
    });
  }

  // 8) postcss.config.js
  if (!seen.has('postcss.config.js')) {
    seen.set('postcss.config.js', {
      path: 'postcss.config.js',
      content: POSTCSS_CONFIG,
      language: 'javascript'
    });
  }

  // 9) public/favicon.svg
  if (!seen.has('public/favicon.svg')) {
    seen.set('public/favicon.svg', {
      path: 'public/favicon.svg',
      content: FAVICON_SVG,
      language: 'html'
    });
  }

  // 10) public/manifest.json
  if (!seen.has('public/manifest.json')) {
    seen.set('public/manifest.json', {
      path: 'public/manifest.json',
      content: JSON.stringify(buildManifestJson(projectName), null, 2),
      language: 'json'
    });
  }

  // 11) .gitignore
  if (!seen.has('.gitignore')) {
    seen.set('.gitignore', {
      path: '.gitignore',
      content: GITIGNORE_CONTENT,
      language: 'plaintext'
    });
  }

  // 12) README.md
  if (!seen.has('README.md')) {
    seen.set('README.md', {
      path: 'README.md',
      content: buildReadme(projectName),
      language: 'markdown'
    });
  }

  // 13) src/lib/utils.js
  if (!seen.has('src/lib/utils.js') && !seen.has('src/lib/utils.ts')) {
    seen.set('src/lib/utils.js', {
      path: 'src/lib/utils.js',
      content: LIB_UTILS_JS,
      language: 'javascript'
    });
  }

  // 14) src/utils/helpers.js
  if (!seen.has('src/utils/helpers.js') && !seen.has('src/utils/helpers.ts')) {
    seen.set('src/utils/helpers.js', {
      path: 'src/utils/helpers.js',
      content: UTILS_HELPERS_JS,
      language: 'javascript'
    });
  }

  // 15) src/hooks/useToast.js
  if (!seen.has('src/hooks/useToast.js') && !seen.has('src/hooks/useToast.ts')) {
    seen.set('src/hooks/useToast.js', {
      path: 'src/hooks/useToast.js',
      content: USE_TOAST_JS,
      language: 'javascript'
    });
  }

  // 16) src/hooks/useTheme.js
  if (!seen.has('src/hooks/useTheme.js') && !seen.has('src/hooks/useTheme.ts')) {
    seen.set('src/hooks/useTheme.js', {
      path: 'src/hooks/useTheme.js',
      content: USE_THEME_JS,
      language: 'javascript'
    });
  }

  // 17) src/services/dataService.js
  if (!seen.has('src/services/dataService.js') && !seen.has('src/services/dataService.ts')) {
    seen.set('src/services/dataService.js', {
      path: 'src/services/dataService.js',
      content: DATA_SERVICE_JS,
      language: 'javascript'
    });
  }

  // 18) src/components/Navbar.jsx
  if (!seen.has('src/components/Navbar.jsx')) {
    seen.set('src/components/Navbar.jsx', {
      path: 'src/components/Navbar.jsx',
      content: NAVBAR_JSX,
      language: 'javascript'
    });
  }

  // 19) src/components/Footer.jsx
  if (!seen.has('src/components/Footer.jsx')) {
    seen.set('src/components/Footer.jsx', {
      path: 'src/components/Footer.jsx',
      content: FOOTER_JSX,
      language: 'javascript'
    });
  }

  // 20) src/components/Card.jsx
  if (!seen.has('src/components/Card.jsx')) {
    seen.set('src/components/Card.jsx', {
      path: 'src/components/Card.jsx',
      content: CARD_JSX,
      language: 'javascript'
    });
  }

  // 21) src/components/Modal.jsx
  if (!seen.has('src/components/Modal.jsx')) {
    seen.set('src/components/Modal.jsx', {
      path: 'src/components/Modal.jsx',
      content: MODAL_JSX,
      language: 'javascript'
    });
  }

  // 22) tokens.json when provided
  if (tokens && !seen.has('src/tokens.json')) {
    seen.set('src/tokens.json', {
      path: 'src/tokens.json',
      content: JSON.stringify(tokens, null, 2),
      language: 'json'
    });
  }

  // Return in a stable, structured hierarchy
  return Array.from(seen.values()).sort((a, b) => {
    const rank = (p) => {
      if (p === 'package.json') return 0;
      if (p === 'vite.config.js' || p === 'tailwind.config.js' || p === 'postcss.config.js') return 1;
      if (p === '.gitignore' || p === 'README.md') return 2;
      if (p === 'index.html' || p.startsWith('public/')) return 3;
      if (p === 'src/index.css') return 4;
      if (p === 'src/main.jsx' || p === 'src/main.js') return 5;
      if (p === 'src/App.jsx' || p === 'src/App.js') return 6;
      if (p.startsWith('src/lib/')) return 7;
      if (p.startsWith('src/utils/')) return 8;
      if (p.startsWith('src/hooks/')) return 9;
      if (p.startsWith('src/services/')) return 10;
      if (p.startsWith('src/components/')) return 11;
      if (p.startsWith('src/pages/')) return 12;
      return 13;
    };
    const d = rank(a.path) - rank(b.path);
    return d !== 0 ? d : a.path.localeCompare(b.path);
  });
}

/* ------------------------------ helpers ------------------------------ */

function normalizePath(p) {
  return String(p).replace(/^\.?\/+/, '').replace(/\\/g, '/');
}

function inferLanguage(p) {
  if (p.endsWith('.jsx') || p.endsWith('.js')) return 'javascript';
  if (p.endsWith('.tsx') || p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.html') || p.endsWith('.svg')) return 'html';
  if (p.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

function sanitizePkgName(name) {
  return String(name || 'veave-app')
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60) || 'veave-app';
}

function buildPackageJson(name) {
  return {
    name,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    dependencies: DEFAULT_DEPENDENCIES,
    devDependencies: DEFAULT_DEV_DEPENDENCIES
  };
}

function buildManifestJson(name) {
  return {
    short_name: name,
    name: name,
    icons: [
      {
        src: "/favicon.svg",
        type: "image/svg+xml",
        sizes: "any"
      }
    ],
    start_url: "/",
    background_color: "#09090b",
    theme_color: "#6366f1",
    display: "standalone"
  };
}

const USE_SEO_JS = `import { useEffect } from 'react';

// Call once per page: useSeo({ title: 'Pricing | Acme', description: 'Plans and pricing for Acme.' })
// Sets the document title and the description / canonical / Open Graph tags that search engines and link previews read.
export default function useSeo({ title, description, image, path } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    const setMeta = (attr, key, value) => {
      if (!value) return;
      let tag = document.head.querySelector(\`meta[\${attr}="\${key}"]\`);
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute(attr, key); document.head.appendChild(tag); }
      tag.setAttribute('content', value);
    };
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:image', image);
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link); }
    link.setAttribute('href', window.location.origin + (path || window.location.pathname));
  }, [title, description, image, path]);
}
`;

function buildIndexHtml(name) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>${escapeHtml(name)}</title>
    <meta name="description" content="${escapeHtml(name)} - official website." />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(name)}" />
    <meta property="og:description" content="${escapeHtml(name)} - official website." />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body class="bg-[#09090b] text-[#f8fafc] antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function buildReadme(name) {
  return `# ${name}

A structured, modern React application generated by **Veave AI Studio**.

## Project Architecture

\`\`\`
├── public/                 # Static assets (favicons, manifests, images)
│   ├── favicon.svg
│   └── manifest.json
├── src/
│   ├── components/         # Modular reusable UI components
│   │   ├── Navbar.jsx
│   │   ├── Footer.jsx
│   │   ├── Card.jsx
│   │   └── Modal.jsx
│   ├── hooks/              # Custom reusable React hooks
│   │   ├── useToast.js
│   │   └── useTheme.js
│   ├── lib/                # Shared utilities & configurations
│   │   └── utils.js
│   ├── services/           # Data & API abstraction layer
│   │   └── dataService.js
│   ├── utils/              # Helper utilities & formatters
│   │   └── helpers.js
│   ├── App.jsx             # Main Application Root
│   ├── main.jsx            # React Entry Point (Vite bootstrap)
│   ├── index.css           # Global Tailwind CSS Styles
│   └── tokens.json         # Design tokens & color system
├── index.html              # Vite HTML entry
├── vite.config.js          # Vite configuration
├── tailwind.config.js      # Tailwind CSS configuration
├── postcss.config.js       # PostCSS configuration
└── package.json            # Project manifest & dependencies
\`\`\`

## Getting Started

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Run local development server
npm run dev

# 3. Build for production (outputs to dist/)
npm run build
\`\`\`
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ------------------------------ file templates ------------------------------ */

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
</svg>`;

const GITIGNORE_CONTENT = `# Dependencies
node_modules/
.pnp
.pnp.js

# Production build
dist/
build/

# Local Environment Variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor directories
.vscode/
.idea/
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;

const MAIN_JSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: #09090b;
  color: #f8fafc;
}
`;

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
});
`;

const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          500: '#6366f1',
          600: '#4f46e5'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
`;

const POSTCSS_CONFIG = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
`;

const LIB_UTILS_JS = `/**
 * Concatenates class names conditionally
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
`;

const UTILS_HELPERS_JS = `/**
 * Utility helper functions for formatting and string transformations
 */
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount);
}

export function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function truncateText(text, maxLength = 60) {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
`;

const USE_TOAST_JS = `import { useState, useCallback } from 'react';

export function useToast(timeout = 3000) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setToast(null);
    }, timeout);
  }, [timeout]);

  const hideToast = useCallback(() => {
    setToast(null);
  }, []);

  return { toast, showToast, hideToast };
}
`;

const USE_THEME_JS = `import { useState, useEffect } from 'react';

export function useTheme(defaultTheme = 'dark') {
  const [theme, setTheme] = useState(defaultTheme);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return { theme, toggleTheme, isDark: theme === 'dark' };
}
`;

const DATA_SERVICE_JS = `/**
 * Data service for fetching and querying application records
 */
export const dataService = {
  async getItems() {
    return Promise.resolve([]);
  },

  async query(keyword) {
    const items = await this.getItems();
    if (!keyword) return items;
    return items.filter(i => (i.title || i.name || '').toLowerCase().includes(keyword.toLowerCase()));
  }
};
`;

const NAVBAR_JSX = `import React from 'react';
import { Sparkles, Menu, Bell } from 'lucide-react';

export default function Navbar({ title = 'VEAVE App', onMenuClick }) {
  return (
    <header className="h-16 px-6 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
          <Sparkles className="w-4 h-4" />
        </div>
        <span className="font-bold text-sm tracking-tight text-white">{title}</span>
      </div>

      <div className="flex items-center gap-3">
        <button 
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </button>
        {onMenuClick && (
          <button 
            onClick={onMenuClick}
            className="md:hidden p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Menu"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}
`;

const FOOTER_JSX = `import React from 'react';

export default function Footer({ year = 2026 }) {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 py-6 px-6 text-center text-xs text-zinc-500">
      <p>&copy; {year} Built with Veave AI Studio. All rights reserved.</p>
    </footer>
  );
}
`;

const CARD_JSX = `import React from 'react';

export default function Card({ title, subtitle, children, className = '' }) {
  return (
    <div className={\`bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all \${className}\`}>
      {title && <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>}
      {subtitle && <p className="text-xs text-zinc-400 mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}
`;

const MODAL_JSX = `import React from 'react';
import { X } from 'lucide-react';

export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-4">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
`;

const FALLBACK_APP = `import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Card from './components/Card';
import { Sparkles, ArrowRight, Plus, Layers, FileText, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [count, setCount] = useState(0);
  const [pages, setPages] = useState([
    { id: 'home', title: 'Main View', desc: 'Core structured application landing view.' },
    { id: 'features', title: 'Component Library', desc: 'Pre-configured UI components and modules.' }
  ]);
  const [activePageId, setActivePageId] = useState('home');

  const handleAddPage = () => {
    const nextNum = pages.length + 1;
    const newPage = {
      id: \`page-\${Date.now()}\`,
      title: \`Page \${nextNum}\`,
      desc: \`Newly created dynamic page view \${nextNum}. Configure and customize as needed.\`
    };
    setPages(prev => [...prev, newPage]);
    setActivePageId(newPage.id);
  };

  const activePageObj = pages.find(p => p.id === activePageId) || pages[0];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-between">
      <Navbar title="Veave Application" />

      <main className="flex-1 max-w-5xl mx-auto px-6 py-12 flex flex-col items-center justify-center text-center w-full">
        {activePageId === 'home' ? (
          <>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Production Ready React Layout</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
              Structured React Application
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 max-w-lg mb-8">
              This project is equipped with modular components, custom hooks, utilities, and a clean architecture.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl text-left mb-8">
              <Card title="Modular Components" subtitle="src/components">
                <p className="text-xs text-zinc-400">Includes Navbar, Footer, Card, and Modal components ready for reuse.</p>
              </Card>
              <Card title="Custom Hooks & Libs" subtitle="src/hooks & src/lib">
                <p className="text-xs text-zinc-400">Comes with useToast, useTheme, and className utility helpers.</p>
              </Card>
            </div>

            <button 
              onClick={() => setCount(prev => prev + 1)}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2"
            >
              <span>Clicked {count} times</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-left animate-in fade-in duration-200">
            <div className="flex items-center gap-3 mb-4">
              <span className="p-2.5 rounded-xl bg-indigo-600 text-white">
                <FileText className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-white">{activePageObj.title}</h2>
                <p className="text-xs text-zinc-400">{activePageObj.desc}</p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-400 mb-6 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Page view dynamically mounted in React state. Switch between views using the bar below.</span>
            </div>
            <button
              onClick={() => setActivePageId('home')}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              &larr; Return to Main View
            </button>
          </div>
        )}

        {/* Bottom Multi-Page Bar */}
        <div className="w-full max-w-3xl mt-12 pt-6 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-zinc-400 text-xs">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-zinc-300">Pages:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pages.map(p => (
              <button
                key={p.id}
                onClick={() => setActivePageId(p.id)}
                className={\`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors \${
                  p.id === activePageId 
                    ? 'bg-indigo-600 border-indigo-500 text-white' 
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }\`}
              >
                {p.title}
              </button>
            ))}
            <button
              onClick={handleAddPage}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-indigo-400 border border-indigo-500/30 hover:border-indigo-500 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add More Page</span>
            </button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
`;

module.exports = { scaffoldReactProject };
