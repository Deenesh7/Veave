const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// HTML Web Dashboard for MongoDB
router.get('/', async (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Veave — Database Viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    pre, code { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex flex-col">
  <!-- Topbar -->
  <header class="h-14 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur px-6 flex items-center justify-between shrink-0">
    <div class="flex items-center gap-3">
      <div class="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-xs">
        DB
      </div>
      <div>
        <h1 class="font-bold text-sm tracking-tight text-zinc-100">Veave MongoDB Explorer</h1>
        <p class="text-[11px] text-zinc-500 font-mono">mongodb://localhost:27017/veave</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        Connected
      </span>
      <button onclick="refreshData()" class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors">
        ↻ Refresh
      </button>
    </div>
  </header>

  <!-- Main Layout -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Sidebar / Collections -->
    <aside class="w-64 border-r border-zinc-800 bg-zinc-900/30 flex flex-col shrink-0">
      <div class="p-3 border-b border-zinc-800/60 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Collections
      </div>
      <nav id="collections-list" class="p-2 space-y-1 overflow-y-auto flex-1">
        <div class="p-4 text-center text-xs text-zinc-500">Loading collections...</div>
      </nav>
    </aside>

    <!-- Main Content Panel -->
    <main class="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
      <!-- Toolbar -->
      <div class="h-12 border-b border-zinc-800 px-6 flex items-center justify-between shrink-0 bg-zinc-900/20">
        <div class="flex items-center gap-2">
          <span id="active-collection-title" class="font-semibold text-sm text-zinc-100">Select a collection</span>
          <span id="document-count-badge" class="hidden text-xs bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-400 font-mono">0 documents</span>
        </div>
        <div class="flex items-center gap-2">
          <input 
            type="text" 
            id="search-input" 
            placeholder="Filter JSON results..." 
            oninput="filterDocuments()"
            class="px-3 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 w-48"
          />
        </div>
      </div>

      <!-- Documents Viewer Area -->
      <div id="documents-container" class="flex-1 overflow-y-auto p-6 space-y-4">
        <div class="h-full flex flex-col items-center justify-center text-center text-zinc-600">
          <div class="w-12 h-12 rounded-2xl bg-zinc-900 flex items-center justify-center mb-3 border border-zinc-800 text-xl">
            📁
          </div>
          <p class="text-sm font-medium text-zinc-400">Choose a collection on the left</p>
          <p class="text-xs text-zinc-600 mt-1">Users, Projects, Conversations, Versions, and AI Usage data will appear here.</p>
        </div>
      </div>
    </main>
  </div>

  <script>
    let currentCollection = '';
    let currentDocs = [];

    async function loadCollections() {
      try {
        const res = await fetch('/db/api/collections');
        const data = await res.json();
        const container = document.getElementById('collections-list');
        
        if (!data.collections || data.collections.length === 0) {
          container.innerHTML = '<div class="p-4 text-center text-xs text-zinc-500">No collections yet. Start the app to create them!</div>';
          return;
        }

        container.innerHTML = data.collections.map(col => \`
          <button 
            onclick="selectCollection('\${col.name}')" 
            id="btn-\${col.name}"
            class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between \${col.name === currentCollection ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'}"
          >
            <span class="truncate">\${col.name}</span>
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">\${col.count}</span>
          </button>
        \`).join('');

        if (!currentCollection && data.collections.length > 0) {
          selectCollection(data.collections[0].name);
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function selectCollection(name) {
      currentCollection = name;
      document.querySelectorAll('#collections-list button').forEach(btn => {
        btn.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60';
      });
      const activeBtn = document.getElementById('btn-' + name);
      if (activeBtn) {
        activeBtn.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-between bg-indigo-600/10 text-indigo-400 border border-indigo-500/20';
      }

      document.getElementById('active-collection-title').textContent = name;
      const container = document.getElementById('documents-container');
      container.innerHTML = '<div class="p-8 text-center text-xs text-zinc-500 animate-pulse">Loading documents...</div>';

      try {
        const res = await fetch('/db/api/' + name);
        const data = await res.json();
        currentDocs = data.documents || [];
        
        const badge = document.getElementById('document-count-badge');
        badge.classList.remove('hidden');
        badge.textContent = \`\${currentDocs.length} document\${currentDocs.length === 1 ? '' : 's'}\`;

        renderDocs(currentDocs);
      } catch (err) {
        container.innerHTML = '<div class="p-4 text-xs text-red-400">Error loading documents: ' + err.message + '</div>';
      }
    }

    function renderDocs(docs) {
      const container = document.getElementById('documents-container');
      if (docs.length === 0) {
        container.innerHTML = '<div class="p-12 text-center text-xs text-zinc-500">Collection is empty.</div>';
        return;
      }

      container.innerHTML = docs.map((doc, idx) => {
        const id = doc._id || idx;
        const formatted = JSON.stringify(doc, null, 2);
        return \`
          <div class="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden shadow-sm">
            <div class="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
              <span class="font-mono text-indigo-400 text-[11px]">_id: \${id}</span>
              <span class="text-[11px] text-zinc-500">#\${idx + 1}</span>
            </div>
            <pre class="p-4 text-xs text-zinc-300 overflow-x-auto leading-relaxed scrollbar-thin">\${highlightJSON(formatted)}</pre>
          </div>
        \`;
      }).join('');
    }

    function filterDocuments() {
      const q = document.getElementById('search-input').value.toLowerCase();
      if (!q) {
        renderDocs(currentDocs);
        return;
      }
      const filtered = currentDocs.filter(d => JSON.stringify(d).toLowerCase().includes(q));
      renderDocs(filtered);
    }

    function highlightJSON(json) {
      return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
        let cls = 'text-amber-300';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-indigo-300 font-semibold';
          } else {
            cls = 'text-emerald-400';
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-cyan-400 font-semibold';
        } else if (/null/.test(match)) {
          cls = 'text-zinc-500 italic';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      });
    }

    function refreshData() {
      loadCollections();
      if (currentCollection) selectCollection(currentCollection);
    }

    loadCollections();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// JSON API: Get list of collections and document counts
router.get('/api/collections', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ error: 'Database connection not initialized' });
    }
    const collections = await db.listCollections().toArray();
    const result = [];

    for (const col of collections) {
      const count = await db.collection(col.name).countDocuments();
      result.push({ name: col.name, count });
    }

    // Sort alphabetically
    result.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ collections: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// JSON API: Get documents inside a specific collection
router.get('/api/:collection', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const colName = req.params.collection;
    const docs = await db.collection(colName).find({}).sort({ _id: -1 }).limit(100).toArray();
    res.json({ documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
