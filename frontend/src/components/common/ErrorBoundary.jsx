import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Root ErrorBoundary
 *
 * Prevents a single component crash from blanking the whole page.
 * Shows the actual error + stack so the failure is diagnosable in dev,
 * and in production shows a minimal recovery UI.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[VEAVE ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
  };

  handleReload = () => {
    // Full reload — also invalidates Vite HMR module cache
    window.location.reload();
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const isDev = import.meta?.env?.DEV;

    return (
      <div className="min-h-screen bg-[#FAFAFA] text-[#111827] p-6 sm:p-10">
        <div className="max-w-2xl mx-auto bg-white border border-[#E5E7EB] rounded-2xl shadow-sm p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
              <p className="text-sm text-[#6B7280] mt-1">
                A component crashed while rendering. Your work is safe.
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-red-50 border border-red-200 p-3">
            <div className="text-xs font-mono font-semibold text-red-800 break-words">
              {error.name || 'Error'}: {error.message || String(error)}
            </div>
          </div>

          {isDev && info?.componentStack && (
            <details className="mt-3">
              <summary className="text-xs font-semibold text-[#374151] cursor-pointer select-none">
                Component stack
              </summary>
              <pre className="mt-2 text-[11px] leading-[1.5] font-mono text-[#374151] whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3">
                {info.componentStack}
              </pre>
            </details>
          )}

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#111827] hover:bg-black text-white text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload page</span>
            </button>
            <button
              onClick={this.handleReset}
              className="px-3.5 py-2 rounded-lg border border-[#E5E7EB] hover:bg-zinc-50 text-xs font-semibold text-[#374151] transition-colors"
            >
              Try again
            </button>
          </div>

          {isDev && (
            <p className="mt-4 text-[11px] text-[#6B7280] leading-relaxed">
              Tip: if the error mentions a variable that does not exist in your source
              (e.g. a stale HMR module), stop the dev server, delete
              <code className="mx-1 px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">node_modules/.vite</code>,
              then run <code className="mx-1 px-1 py-0.5 rounded bg-zinc-100 font-mono text-[10px]">npm run dev</code>
              and hard-refresh the browser.
            </p>
          )}
        </div>
      </div>
    );
  }
}
