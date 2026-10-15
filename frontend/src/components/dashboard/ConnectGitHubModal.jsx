import React, { useState } from 'react';
import { 
  Github, 
  GitBranch, 
  GitFork, 
  Star, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  ExternalLink, 
  RefreshCw,
  FolderGit2,
  Unlink,
  ChevronDown
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';

export default function ConnectGitHubModal({
  isOpen,
  onClose,
  connectedRepo,
  onConnectRepo,
  onDisconnectRepo
}) {
  const [repoUrl, setRepoUrl] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [customBranch, setCustomBranch] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [localConnectedRepo, setLocalConnectedRepo] = useState(connectedRepo || null);

  // Suggested popular repositories
  const SUGGESTED_REPOS = [
    { name: 'shadcn/ui', url: 'https://github.com/shadcn-ui/ui', desc: 'Accessible and customizable components' },
    { name: 'tailwindlabs/tailwindcss', url: 'https://github.com/tailwindlabs/tailwindcss', desc: 'Utility-first CSS framework' },
    { name: 'vercel/next.js', url: 'https://github.com/vercel/next.js', desc: 'The React Framework for the Web' }
  ];

  const availableBranches = [
    'main',
    'master',
    'dev',
    'staging',
    'feature/ui-refresh'
  ];

  const validateUrl = (url) => {
    return /^https:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(url.trim());
  };

  const handleConnect = async (e) => {
    if (e) e.preventDefault();
    setError('');

    const targetUrl = repoUrl.trim();
    if (!targetUrl) {
      setError('Please enter a GitHub repository URL.');
      return;
    }

    if (!validateUrl(targetUrl)) {
      setError('Invalid GitHub URL. Format: https://github.com/owner/repository');
      return;
    }

    setIsConnecting(true);

    try {
      // Simulate real repository handshake & metadata retrieval
      await new Promise((resolve) => setTimeout(resolve, 800));

      const parts = targetUrl.replace('https://github.com/', '').split('/');
      const owner = parts[0];
      const name = parts[1]?.replace(/\.git$/, '');

      const newConnection = {
        fullName: `${owner}/${name}`,
        owner,
        name,
        url: targetUrl,
        defaultBranch: 'main',
        selectedBranch: selectedBranch || 'main',
        stars: Math.floor(Math.random() * 4500) + 120,
        forks: Math.floor(Math.random() * 800) + 30,
        status: 'connected',
        connectedAt: new Date().toISOString()
      };

      setLocalConnectedRepo(newConnection);
      onConnectRepo?.(newConnection);
      setRepoUrl('');
    } catch (err) {
      setError(err.message || 'Failed to connect to GitHub repository.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBranchChange = (newBranch) => {
    setSelectedBranch(newBranch);
    if (localConnectedRepo) {
      const updated = { ...localConnectedRepo, selectedBranch: newBranch };
      setLocalConnectedRepo(updated);
      onConnectRepo?.(updated);
    }
  };

  const handleAddCustomBranch = (e) => {
    e.preventDefault();
    if (!customBranch.trim()) return;
    handleBranchChange(customBranch.trim());
    setCustomBranch('');
  };

  const handleDisconnect = () => {
    setLocalConnectedRepo(null);
    onDisconnectRepo?.();
  };

  const activeRepo = localConnectedRepo || connectedRepo;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Connect GitHub Repository"
      description="Link a repository to reference component architecture and sync branches directly."
      className="max-w-lg"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* State A: Repository Connected */}
        {activeRepo ? (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
                    <Github className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                      <span>{activeRepo.fullName}</span>
                      <a
                        href={activeRepo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-400 hover:text-zinc-600 inline-block"
                        title="View on GitHub"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </h4>
                    <span className="text-[10px] text-emerald-700 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      Repository Connected
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  title="Disconnect repository"
                  className="px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1 transition-colors"
                >
                  <Unlink className="w-3 h-3" />
                  <span>Disconnect</span>
                </button>
              </div>

              {/* Stats strip */}
              <div className="flex items-center gap-4 pt-2 border-t border-emerald-100 text-[11px] text-zinc-600">
                <span className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  {activeRepo.stars?.toLocaleString() || '1.2k'} stars
                </span>
                <span className="flex items-center gap-1">
                  <GitFork className="w-3.5 h-3.5 text-zinc-400" />
                  {activeRepo.forks?.toLocaleString() || '240'} forks
                </span>
              </div>
            </div>

            {/* Branch Selection Section */}
            <div className="p-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-2.5">
              <label className="text-xs font-semibold text-zinc-900 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Active Working Branch</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  Selected: {activeRepo.selectedBranch || selectedBranch}
                </span>
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableBranches.map((branch) => {
                  const isCurrent = (activeRepo.selectedBranch || selectedBranch) === branch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      onClick={() => handleBranchChange(branch)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-between border transition-all ${
                        isCurrent
                          ? 'bg-zinc-900 text-white border-zinc-900 shadow-2xs font-bold'
                          : 'bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                      }`}
                    >
                      <span className="truncate">{branch}</span>
                      {isCurrent && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Custom branch input */}
              <form onSubmit={handleAddCustomBranch} className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  placeholder="Or enter custom branch (e.g. preview-v1)"
                  value={customBranch}
                  onChange={(e) => setCustomBranch(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 bg-white focus:outline-none focus:border-[#52525B]"
                />
                <button
                  type="submit"
                  disabled={!customBranch.trim()}
                  className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-semibold disabled:opacity-40 transition-colors"
                >
                  Set Branch
                </button>
              </form>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
              <span className="text-[11px] text-zinc-400">
                Attached to current AI workspace context
              </span>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* State B: Connect New Repository */
          <div className="space-y-4">
            <form onSubmit={handleConnect} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                  <Github className="w-3.5 h-3.5 text-zinc-700" />
                  <span>Repository URL</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="https://github.com/owner/repository"
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      setError('');
                    }}
                    disabled={isConnecting}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-zinc-700" />
                  <span>Initial Branch</span>
                </label>
                <input
                  type="text"
                  placeholder="main"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  disabled={isConnecting}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 disabled:opacity-60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isConnecting}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConnecting || !repoUrl.trim()}
                  className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Github className="w-3.5 h-3.5" />
                      <span>Connect Repository</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Quick Suggestions */}
            <div className="pt-2 border-t border-zinc-100">
              <span className="text-[11px] font-semibold text-zinc-400 block mb-2">
                Or quickly connect a sample repository:
              </span>
              <div className="space-y-1.5">
                {SUGGESTED_REPOS.map((sample) => (
                  <button
                    key={sample.name}
                    type="button"
                    onClick={() => {
                      setRepoUrl(sample.url);
                    }}
                    className="w-full p-2 text-left rounded-lg border border-zinc-150 hover:border-zinc-300 hover:bg-zinc-50/80 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <span className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-600 transition-colors">
                        {sample.name}
                      </span>
                      <p className="text-[10px] text-zinc-400">{sample.desc}</p>
                    </div>
                    <span className="text-[10px] text-zinc-400 group-hover:text-zinc-700 font-mono">
                      Use URL →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
