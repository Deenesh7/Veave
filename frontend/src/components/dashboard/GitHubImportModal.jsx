import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, GitBranch, Loader2, CheckCircle2, ArrowRight, AlertCircle, FolderTree } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import aiCreationService from '../../services/aiCreationService';

export default function GitHubImportModal({ isOpen, onClose, onImported }) {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const validateUrl = (url) => {
    const trimmed = url.trim();
    return /^https:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/.test(trimmed);
  };

  const handleImport = async (e) => {
    if (e) e.preventDefault();
    setError('');

    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repository URL.');
      return;
    }

    if (!validateUrl(repoUrl)) {
      setError('Invalid GitHub repository URL. Example: https://github.com/facebook/react');
      return;
    }

    setIsLoading(true);
    try {
      const res = await aiCreationService.importGitHub({
        repoUrl: repoUrl.trim(),
        branch: branch.trim() || 'main'
      });

      const data = res.data?.data || res.data;
      setResult(data);
      if (onImported && data.project) {
        onImported(data.project);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to import repository. Please check permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setRepoUrl('');
    setBranch('main');
    setError('');
    setResult(null);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      title="Import from GitHub"
      description="Connect any public or authorized repository to scaffold an interactive live workspace."
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!result ? (
          <form onSubmit={handleImport} className="space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                <Github className="w-3.5 h-3.5 text-zinc-700" />
                <span>Repository URL</span>
              </label>
              <input
                type="text"
                placeholder="https://github.com/username/project"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setError('');
                }}
                disabled={isLoading}
                className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5 text-zinc-700" />
                <span>Branch</span>
              </label>
              <input
                type="text"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 disabled:opacity-60"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !repoUrl.trim()}
                className="px-5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Importing Repository...</span>
                  </>
                ) : (
                  <>
                    <Github className="w-3.5 h-3.5" />
                    <span>Import Repository</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 animate-in fade-in">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Repository imported and indexed into your Veave workspace!</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-center">
                <span className="text-[10px] text-zinc-400 font-mono">Stars</span>
                <p className="text-base font-bold text-amber-600 mt-0.5">{result.stats?.stars?.toLocaleString() ?? 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-center">
                <span className="text-[10px] text-zinc-400 font-mono">Files Parsed</span>
                <p className="text-base font-bold text-zinc-900 mt-0.5">{result.stats?.files ?? 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-center">
                <span className="text-[10px] text-zinc-400 font-mono">Components</span>
                <p className="text-base font-bold text-zinc-900 mt-0.5">{result.stats?.components ?? 0}</p>
              </div>
              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-center">
                <span className="text-[10px] text-zinc-400 font-mono">Branch</span>
                <p className="text-xs font-bold text-zinc-900 font-mono mt-1 truncate">{result.branch}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors"
              >
                Import Another
              </button>
              {result.project?._id && (
                <button
                  type="button"
                  onClick={() => navigate(`/editor/${result.project._id}`)}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-1.5 transition-colors"
                >
                  <span>Open in Code Editor</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
