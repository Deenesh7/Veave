import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Dialog 
} from '../ui/Dialog';
import { 
  Sparkles, 
  Code2, 
  Eye, 
  Palette, 
  Copy, 
  Check, 
  ArrowRight, 
  ExternalLink,
  Laptop,
  CheckCircle2
} from 'lucide-react';

export default function GeneratedDesignPreview({
  isOpen,
  onClose,
  generatedData,
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' | 'code' | 'tokens'
  const [copied, setCopied] = useState(false);

  if (!generatedData) return null;

  const project = generatedData.project;
  const code = generatedData.code || project?.files?.[0]?.content || '';
  const metadata = generatedData.metadata || {};
  const tokens = generatedData.tokens || {};

  const handleCopyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleOpenEditor = () => {
    if (project?._id) {
      onClose();
      navigate(`/editor/${project._id}`);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Generated Prototype"
      description={`Generated with ${metadata.model || 'AI'} • Design System: ${metadata.designSystem || 'Base'}`}
    >
      <div className="space-y-4">
        {/* Header Tabs */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'preview'
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('code')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'code'
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>React Code</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tokens')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'tokens'
                  ? 'bg-zinc-900 text-white shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Tokens</span>
            </button>
          </div>

          {activeTab === 'code' && (
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Tab Content */}
        <div className="min-h-[300px] max-h-[460px] overflow-y-auto">
          {activeTab === 'preview' && (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-200">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">{project?.name || 'AI Prototype'}</h3>
                  <p className="text-xs text-zinc-500 truncate max-w-sm">
                    {metadata.prompt || 'Synthesized component tree'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" />
                    Compiled
                  </span>
                </div>
              </div>

              {/* Rendered mockup preview box */}
              <div 
                className="p-6 rounded-xl border border-zinc-200 shadow-xs"
                style={{
                  backgroundColor: tokens.bg || '#ffffff',
                  fontFamily: tokens.font || 'inherit',
                  borderRadius: tokens.radius || '12px'
                }}
              >
                <div className="max-w-md mx-auto space-y-4">
                  <div className="flex items-center justify-between">
                    <span 
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ 
                        backgroundColor: (tokens.primary || '#111827') + '15',
                        color: tokens.primary || '#111827'
                      }}
                    >
                      {metadata.designSystem || 'Modern'} System
                    </span>
                    <span className="text-[11px] text-zinc-400 font-mono">v1.0.0</span>
                  </div>

                  <h2 className="text-xl font-bold tracking-tight" style={{ color: tokens.primary || '#111827' }}>
                    {project?.name || 'Interactive AI Component'}
                  </h2>
                  <p className="text-xs leading-relaxed" style={{ color: tokens.secondary || '#64748B' }}>
                    {metadata.prompt || 'Your synthesized React and Tailwind layout with tokenized styles.'}
                  </p>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-lg border border-zinc-200/80 bg-white/70">
                      <div className="text-xs text-zinc-500">Design System</div>
                      <div className="text-sm font-bold text-zinc-800">{metadata.designSystem || 'Modern'}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-zinc-200/80 bg-white/70">
                      <div className="text-xs text-zinc-500">AI Model</div>
                      <div className="text-sm font-bold text-zinc-800">{metadata.model || 'Auto'}</div>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center gap-2">
                    <button
                      type="button"
                      style={{
                        backgroundColor: tokens.primary || '#111827',
                        borderRadius: tokens.radius || '8px'
                      }}
                      className="px-4 py-2 text-xs font-semibold text-white shadow-xs cursor-default"
                    >
                      Primary Action
                    </button>
                    <button
                      type="button"
                      style={{
                        borderRadius: tokens.radius || '8px',
                        color: tokens.primary || '#111827',
                        borderColor: tokens.border || '#e2e8f0'
                      }}
                      className="px-4 py-2 text-xs font-semibold border bg-white cursor-default"
                    >
                      Secondary
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'code' && (
            <div className="relative rounded-xl border border-zinc-800 bg-[#0d1117] text-zinc-200 p-4 font-mono text-xs overflow-x-auto">
              <pre className="whitespace-pre">{code || '// No code generated'}</pre>
            </div>
          )}

          {activeTab === 'tokens' && (
            <div className="space-y-3">
              <div className="text-xs text-zinc-500 mb-2">
                Applied styling tokens for the selected design system ({metadata.designSystem || 'Base'}).
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(tokens).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between p-3 rounded-xl border border-zinc-200 bg-zinc-50/60">
                    <span className="text-xs font-medium text-zinc-600 capitalize">{key}</span>
                    <div className="flex items-center gap-2">
                      {key.toLowerCase().includes('color') || key === 'primary' || key === 'secondary' || key === 'bg' || key === 'border' ? (
                        <div 
                          className="w-4 h-4 rounded border border-zinc-300 shrink-0" 
                          style={{ backgroundColor: String(val) }} 
                        />
                      ) : null}
                      <span className="text-xs font-mono font-semibold text-zinc-800">{String(val)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
          >
            Close
          </button>

          {project?._id && (
            <button
              type="button"
              onClick={handleOpenEditor}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-black rounded-xl transition-all shadow-xs cursor-pointer"
            >
              <span>Open in Code Editor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
