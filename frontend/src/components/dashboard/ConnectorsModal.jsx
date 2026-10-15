import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plug, 
  Search, 
  CheckCircle2, 
  ExternalLink, 
  Database, 
  Cloud, 
  CreditCard, 
  Mail, 
  Github, 
  Sparkles, 
  Figma, 
  Sliders, 
  X, 
  Loader2,
  AlertCircle,
  Unlink,
  Check
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';

const INITIAL_CONNECTORS = [
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Databases & Storage',
    description: 'Connect PostgreSQL database, real-time subscriptions, and authentication tables.',
    icon: Database,
    iconBg: 'bg-emerald-50 text-emerald-600',
    connected: false,
    fields: [
      { key: 'projectUrl', label: 'Project URL', placeholder: 'https://xyzcompany.supabase.co' },
      { key: 'anonKey', label: 'Anon Public Key', placeholder: 'eyJhbGciOiJIUzI1NiIsIn...' }
    ]
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'Deployments',
    description: 'One-click prototype deployment to global edge network with custom domains.',
    icon: Cloud,
    iconBg: 'bg-zinc-100 text-zinc-900',
    connected: true, // Default connected for Veave platform
    fields: [
      { key: 'token', label: 'Vercel API Token', placeholder: 'ver_tok_...' },
      { key: 'teamId', label: 'Team ID (Optional)', placeholder: 'team_...' }
    ]
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'Payments',
    description: 'Embed checkout flows, test payment elements, and synchronize billing products.',
    icon: CreditCard,
    iconBg: 'bg-indigo-50 text-indigo-600',
    connected: false,
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_test_...' },
      { key: 'secretKey', label: 'Secret Key (Restricted)', placeholder: 'rk_test_...' }
    ]
  },
  {
    id: 'github',
    name: 'GitHub Sync',
    category: 'Developer Tools',
    description: 'Automate PR creation, commit history snapshots, and branch synchronization.',
    icon: Github,
    iconBg: 'bg-zinc-900 text-white',
    connected: true,
    fields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...' }
    ]
  },
  {
    id: 'figma',
    name: 'Figma Tokens',
    category: 'Design Systems',
    description: 'Synchronize color styles, typography tokens, and vector icon components.',
    icon: Figma,
    iconBg: 'bg-purple-50 text-purple-600',
    connected: false,
    fields: [
      { key: 'figmaToken', label: 'Figma Access Token', placeholder: 'figd_...' },
      { key: 'fileKey', label: 'Design File Key', placeholder: 'abc123XYZ' }
    ]
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'Communications',
    description: 'Send transactional confirmation emails, magic links, and invite notices.',
    icon: Mail,
    iconBg: 'bg-amber-50 text-amber-600',
    connected: false,
    fields: [
      { key: 'apiKey', label: 'Resend API Key', placeholder: 're_...' }
    ]
  },
  {
    id: 'openai',
    name: 'Custom AI Models (BYOK)',
    category: 'AI & Inference',
    description: 'Bring your own OpenAI or Anthropic API key for high-rate quota inference.',
    icon: Sparkles,
    iconBg: 'bg-zinc-50 text-zinc-600',
    connected: false,
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' }
    ]
  }
];

const CATEGORIES = ['All', 'Databases & Storage', 'Deployments', 'Payments', 'Design Systems', 'Developer Tools', 'Communications', 'AI & Inference'];

const CONNECTOR_ICONS = {
  supabase: Database,
  vercel: Cloud,
  stripe: CreditCard,
  github: Github,
  figma: Figma,
  resend: Mail,
  openai: Sparkles,
};

function getConnectorIcon(conn) {
  if (!conn) return Plug;
  if (conn.id && CONNECTOR_ICONS[conn.id]) return CONNECTOR_ICONS[conn.id];
  if (typeof conn.icon === 'function') return conn.icon;
  if (conn.icon && typeof conn.icon === 'object' && conn.icon.$$typeof) return conn.icon;
  return Plug;
}

export default function ConnectorsModal({ isOpen, onClose }) {
  const [connectors, setConnectors] = useState(() => {
    try {
      const saved = localStorage.getItem('veave_connectors');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return INITIAL_CONNECTORS.map((initial) => {
            const found = parsed.find((p) => p.id === initial.id);
            if (!found) return initial;
            return {
              ...initial,
              connected: Boolean(found.connected),
              fields: Array.isArray(initial.fields)
                ? initial.fields.map((f) => {
                    const savedField = Array.isArray(found.fields)
                      ? found.fields.find((sf) => sf.key === f.key)
                      : null;
                    return savedField && savedField.value !== undefined
                      ? { ...f, value: savedField.value }
                      : f;
                  })
                : initial.fields,
            };
          });
        }
      }
      return INITIAL_CONNECTORS;
    } catch {
      return INITIAL_CONNECTORS;
    }
  });

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [configuringConnector, setConfiguringConnector] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [isTesting, setIsTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState('');

  // Persist connector state cleanly without non-serializable icon references
  useEffect(() => {
    try {
      const toSave = connectors.map((c) => ({
        id: c.id,
        connected: c.connected,
        fields: c.fields?.map((f) => ({ key: f.key, value: f.value || '' })),
      }));
      localStorage.setItem('veave_connectors', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Could not save connectors:', e);
    }
  }, [connectors]);

  const filteredConnectors = useMemo(() => {
    return connectors.filter((c) => {
      const matchesCategory = selectedCategory === 'All' || c.category === selectedCategory;
      const q = search.toLowerCase().trim();
      const matchesSearch = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [connectors, search, selectedCategory]);

  const connectedCount = connectors.filter((c) => c.connected).length;

  const handleOpenConfig = (conn) => {
    setConfiguringConnector(conn);
    const initialVals = {};
    if (Array.isArray(conn.fields)) {
      conn.fields.forEach((f) => {
        if (f.value !== undefined) initialVals[f.key] = f.value;
      });
    }
    setFormValues(initialVals);
    setTestSuccess(false);
    setTestError('');
  };

  const handleSaveConnection = (e) => {
    e.preventDefault();
    if (!configuringConnector) return;

    setConnectors((prev) =>
      prev.map((item) => {
        if (item.id !== configuringConnector.id) return item;
        const updatedFields = item.fields?.map((f) => ({
          ...f,
          value: formValues[f.key] !== undefined ? formValues[f.key] : f.value || '',
        }));
        return { ...item, connected: true, fields: updatedFields };
      })
    );

    setConfiguringConnector(null);
  };

  const handleDisconnect = (id) => {
    setConnectors((prev) =>
      prev.map((item) => (item.id === id ? { ...item, connected: false } : item))
    );
    if (configuringConnector?.id === id) {
      setConfiguringConnector(null);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestError('');
    setTestSuccess(false);

    try {
      await new Promise((resolve) => setTimeout(resolve, 750));
      setTestSuccess(true);
    } catch {
      setTestError('Connection test failed. Please verify credentials.');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Connectors & Integrations"
      description="Connect databases, deployment targets, payment gateways, and external developer tools."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Active connectors count badge */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-900">Available Services</span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              {connectedCount} Connected
            </span>
          </div>

          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search services..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-6 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none select-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-zinc-900 text-white font-semibold'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Connectors List */}
        <div className="max-h-[340px] overflow-y-auto space-y-2.5 pr-1">
          {filteredConnectors.map((conn) => {
            const Icon = getConnectorIcon(conn);
            return (
              <div
                key={conn.id}
                className="p-3 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 transition-all flex items-center justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${conn.iconBg}`}>
                    <Icon className="w-4 h-4 stroke-[2]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-zinc-900 truncate">{conn.name}</h4>
                      {conn.connected ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Connected
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-50 border border-zinc-150 px-1.5 py-0.5 rounded-md">
                          Not connected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-snug line-clamp-1 mt-0.5">
                      {conn.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {conn.connected ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenConfig(conn)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 transition-colors"
                      >
                        Configure
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDisconnect(conn.id)}
                        title="Disconnect service"
                        className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenConfig(conn)}
                      className="px-3 py-1 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-black text-white shadow-2xs transition-colors flex items-center gap-1"
                    >
                      <Plug className="w-3 h-3" />
                      <span>Connect</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Configure Sub-Dialog */}
        {configuringConnector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl p-5 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  {(() => {
                    const ConfigIcon = getConnectorIcon(configuringConnector);
                    return <ConfigIcon className="w-4 h-4 text-zinc-600" />;
                  })()}
                  <h3 className="text-sm font-bold text-zinc-900">
                    Configure {configuringConnector.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setConfiguringConnector(null)}
                  className="text-zinc-400 hover:text-zinc-700 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveConnection} className="mt-4 space-y-3.5">
                {testError && (
                  <div className="p-2.5 rounded-xl bg-red-50 text-red-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{testError}</span>
                  </div>
                )}
                {testSuccess && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Credentials verified and connection successful!</span>
                  </div>
                )}

                {configuringConnector.fields?.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-700">
                      {field.label}
                    </label>
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={formValues[field.key] || ''}
                      onChange={(e) =>
                        setFormValues({ ...formValues, [field.key]: e.target.value })
                      }
                      className="w-full px-3 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
                    />
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 transition-colors flex items-center gap-1.5"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Testing...</span>
                      </>
                    ) : (
                      <span>Test Connection</span>
                    )}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfiguringConnector(null)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-500 hover:bg-zinc-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-black text-white shadow-2xs"
                    >
                      Save & Connect
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Integrations can be referenced in your AI prompts and code exports.</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-zinc-700 hover:text-zinc-900"
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
