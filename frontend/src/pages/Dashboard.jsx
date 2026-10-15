import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  X, 
  FolderOpen, 
  Sparkles, 
  SlidersHorizontal,
  FolderKanban
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Dialog } from '../components/ui/Dialog';
import { ProjectGrid } from '../features/projects/ProjectGrid';
import { useProjectStore } from '../store/projectStore';

export default function Dashboard() {
  const navigate = useNavigate();
  const { projects, fetchProjects, isLoading, deleteProject } = useProjectStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'name' | 'files'
  const [deleteId, setDeleteId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      await deleteProject(deleteId);
      setDeleteId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  // Real-time Search and Filter
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    
    let list = projects.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const nameMatch = p.name?.toLowerCase().includes(q);
      const descMatch = p.description?.toLowerCase().includes(q);
      return nameMatch || descMatch;
    });

    if (sortBy === 'recent') {
      list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    } else if (sortBy === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'files') {
      list.sort((a, b) => (b.files?.length || 0) - (a.files?.length || 0));
    }

    return list;
  }, [projects, searchQuery, sortBy]);

  return (
    <div className="w-full space-y-8 animate-fade-in">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Projects</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Build, iterate, and preview your AI-generated React applications.
          </p>
        </div>
        <Button 
          onClick={() => navigate('/new-project')} 
          icon={Plus}
          className="bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl shadow-xs shrink-0 self-start md:self-auto"
        >
          New Project
        </Button>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-zinc-50 p-2 rounded-2xl border border-zinc-200">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects by name, prompt, or description..."
            className="w-full pl-10 pr-10 py-2 text-sm bg-white border border-zinc-200 rounded-xl text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-0.5 rounded-full"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2 px-1">
          <SlidersHorizontal className="w-4 h-4 text-zinc-400 shrink-0 hidden sm:block" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-xl py-2 px-3 focus:outline-none focus:border-zinc-400 shadow-xs cursor-pointer"
          >
            <option value="recent">Recently Updated</option>
            <option value="name">Alphabetical</option>
            <option value="files">Most Files</option>
          </select>
        </div>
      </div>

      {/* Main Content State */}
      {isLoading && projects.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center">
          <Spinner size="lg" className="text-indigo-600 mb-3" />
          <p className="text-xs text-zinc-500">Loading your workspace...</p>
        </div>
      ) : projects.length === 0 ? (
        /* Empty State: No projects created yet */
        <div className="bg-zinc-50/60 border border-zinc-200 border-dashed rounded-3xl py-24 flex flex-col items-center justify-center text-center px-4">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-zinc-200 shadow-xs">
            <Sparkles className="w-8 h-8 text-indigo-500" />
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 mb-2">Create your first application</h2>
          <p className="text-zinc-500 mb-6 max-w-sm text-sm">
            Describe what you want to build in natural language and our AI builder will create it in seconds.
          </p>
          <Button 
            onClick={() => navigate('/new-project')} 
            icon={Plus} 
            size="lg"
            className="bg-zinc-900 text-white rounded-xl shadow-md hover:bg-zinc-800"
          >
            Start Building
          </Button>
        </div>
      ) : filteredProjects.length === 0 ? (
        /* Search Empty State: No match found */
        <div className="bg-zinc-50/50 border border-zinc-200 rounded-2xl py-16 flex flex-col items-center justify-center text-center px-4">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mb-3 border border-zinc-200 text-zinc-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-zinc-900">No projects found</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-xs">
            No projects matched <span className="font-semibold text-zinc-800">"{searchQuery}"</span>. Try adjusting your search keywords.
          </p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setSearchQuery('')} 
            className="mt-4 text-xs"
          >
            Clear Search Filter
          </Button>
        </div>
      ) : (
        /* Project Grid */
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
            <span>
              Showing {filteredProjects.length} of {projects.length} project{projects.length === 1 ? '' : 's'}
            </span>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="text-indigo-600 hover:underline font-medium"
              >
                Reset search
              </button>
            )}
          </div>
          <ProjectGrid projects={filteredProjects} onDelete={setDeleteId} />
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog 
        open={!!deleteId} 
        onClose={() => !isDeleting && setDeleteId(null)}
        title="Delete Project"
        description="Are you sure you want to delete this project? This will permanently remove all associated code files and chat history."
      >
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setDeleteId(null)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={isDeleting}>
            Delete Project
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
