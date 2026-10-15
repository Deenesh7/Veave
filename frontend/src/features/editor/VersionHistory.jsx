import { useState, useEffect, useCallback } from 'react';
import { 
  History, 
  Clock, 
  CheckCircle, 
  RotateCcw, 
  Plus, 
  FileCode, 
  GitBranch,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Save,
  Eye,
  Trash2
} from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { projectService } from '../../services/projectService';
import { useProjectStore } from '../../store/projectStore';
import { formatDate } from '../../utils/helpers';

export function VersionHistory({ open, onClose, projectId }) {
  const [versions, setVersions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(null); // tracks which versionId is restoring
  const [isCreating, setIsCreating] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [activeVersionId, setActiveVersionId] = useState(null);
  const { fetchProject, currentProject, setCurrentProject } = useProjectStore();

  const loadHistory = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await projectService.getHistory(projectId);
      const data = res.data?.data || res.data || [];
      setVersions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load history:', err);
      setError('Failed to load version history. Please try again.');
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && projectId) {
      loadHistory();
      setSuccessMsg(null);
      setExpandedVersion(null);
    }
  }, [open, projectId, loadHistory]);

  // Auto-clear success message
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  const handleRestore = async (versionId) => {
    if (isRestoring) return;
    setIsRestoring(versionId);
    setError(null);
    try {
      const res = await projectService.restoreVersion(projectId, versionId);
      const updatedProject = res.data?.data || res.data;
      
      // Update project store with restored data
      if (updatedProject) {
        setCurrentProject(updatedProject);
      } else {
        // Fallback: re-fetch the project
        await fetchProject(projectId);
      }
      
      setSuccessMsg('Version restored successfully! Preview will refresh.');
      setActiveVersionId(versionId);
      
      // Reload the version list to reflect the new state
      await loadHistory();
    } catch (err) {
      console.error('Failed to restore version:', err);
      setError('Failed to restore this version. Please try again.');
    } finally {
      setIsRestoring(null);
    }
  };

  const handleCreateSnapshot = async (e) => {
    e?.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      await projectService.createVersion(projectId, snapshotLabel.trim() || undefined);
      setSnapshotLabel('');
      setActiveVersionId(null);
      setSuccessMsg('Snapshot created successfully!');
      await loadHistory();
    } catch (err) {
      console.error('Failed to create snapshot:', err);
      setError('Failed to create snapshot. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteVersion = async (versionId) => {
    if (!window.confirm('Are you sure you want to delete this version snapshot?')) return;
    try {
      await projectService.deleteVersion(projectId, versionId);
      setSuccessMsg('Snapshot deleted successfully.');
      await loadHistory();
    } catch (err) {
      console.error('Failed to delete version:', err);
      setError('Failed to delete snapshot.');
    }
  };

  const getVersionIcon = (label = '') => {
    const lower = label.toLowerCase();
    if (lower.includes('ai') || lower.includes('generated')) return Sparkles;
    if (lower.includes('manual') || lower.includes('snapshot')) return Save;
    if (lower.includes('auto')) return GitBranch;
    return GitBranch;
  };

  const getVersionColor = (index, total) => {
    if (index === 0) return 'border-zinc-200 bg-zinc-50/60';
    if (index < 3) return 'border-zinc-200 bg-white';
    return 'border-zinc-100 bg-zinc-50/50';
  };

  const totalFiles = (version) => {
    return version.files?.length || 0;
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      title="Version History" 
      description="Browse, create, and restore project snapshots"
      className="max-w-xl"
    >
      {/* Status Messages */}
      {error && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium animate-in fade-in duration-200">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Create Manual Snapshot */}
      <form onSubmit={handleCreateSnapshot} className="mb-4 flex items-center gap-2">
        <input
          type="text"
          placeholder="Snapshot label (optional)..."
          value={snapshotLabel}
          onChange={(e) => setSnapshotLabel(e.target.value)}
          className="flex-1 px-3 py-2 text-xs border border-zinc-200 rounded-xl focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 bg-white placeholder:text-zinc-400"
        />
        <button
          type="submit"
          disabled={isCreating}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {isCreating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          <span>Snapshot</span>
        </button>
      </form>

      {/* Version List */}
      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
          <p className="text-xs text-zinc-400 font-medium">Loading version history...</p>
        </div>
      ) : versions.length === 0 ? (
        <div className="py-14 text-center flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
            <History className="w-7 h-7 text-zinc-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-700">No versions yet</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-[260px] mx-auto">
              Versions are auto-created when you save changes. You can also create a manual snapshot above.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 -mr-1">
          {/* Version count header */}
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] font-mono uppercase text-zinc-400 font-bold tracking-wider">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={loadHistory}
              className="text-[10px] text-zinc-600 hover:text-zinc-800 font-semibold cursor-pointer transition-colors"
            >
              Refresh
            </button>
          </div>

          {versions.map((version, index) => {
            const isCurrent = activeVersionId ? version._id === activeVersionId : index === 0;
            const isExpanded = expandedVersion === version._id;
            const Icon = getVersionIcon(version.label);
            const isThisRestoring = isRestoring === version._id;

            return (
              <div 
                key={version._id} 
                className={`rounded-xl border transition-all duration-150 ${getVersionColor(index, versions.length)}`}
              >
                {/* Version Header */}
                <div 
                  className="flex items-center justify-between px-3.5 py-3 cursor-pointer"
                  onClick={() => setExpandedVersion(isExpanded ? null : version._id)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isCurrent 
                        ? 'bg-zinc-100 text-zinc-600' 
                        : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${isCurrent ? 'text-zinc-700' : 'text-zinc-800'}`}>
                          v{version.version}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-zinc-100 text-zinc-700 border border-zinc-200">
                            <CheckCircle className="w-2.5 h-2.5" />
                            Current
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5 max-w-[200px]">
                        {version.label || 'Auto-save'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(version.createdAt)}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-3.5 pb-3 pt-0 border-t border-zinc-100 mt-0">
                    <div className="pt-2.5 space-y-2.5">
                      {/* File count & metadata */}
                      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1">
                          <FileCode className="w-3 h-3" />
                          {totalFiles(version)} file{totalFiles(version) !== 1 ? 's' : ''}
                        </span>
                        {version.dependencies?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {version.dependencies.length} dep{version.dependencies.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-zinc-300">•</span>
                        <span>{new Date(version.createdAt).toLocaleString()}</span>
                      </div>

                      {/* File list preview */}
                      {version.files && version.files.length > 0 && (
                        <div className="bg-white rounded-lg border border-zinc-100 p-2 max-h-24 overflow-y-auto">
                          <div className="space-y-0.5">
                            {version.files.slice(0, 8).map((f, fi) => (
                              <div key={fi} className="flex items-center gap-1.5 text-[10px] text-zinc-500 px-1 py-0.5 rounded hover:bg-zinc-50">
                                <FileCode className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
                                <span className="truncate font-mono">{f.path}</span>
                              </div>
                            ))}
                            {version.files.length > 8 && (
                              <p className="text-[10px] text-zinc-400 px-1 mt-0.5">
                                +{version.files.length - 8} more files
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      {!isCurrent && (
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            disabled={!!isRestoring}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRestore(version._id);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white text-[11px] font-bold shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isThisRestoring ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                            <span>{isThisRestoring ? 'Restoring...' : 'Restore this version'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteVersion(version._id);
                            }}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Delete snapshot"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
