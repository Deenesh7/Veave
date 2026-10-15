import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Sparkles, Loader2 } from 'lucide-react';
import RecentToolbar from './RecentToolbar';
import ProjectCard from './ProjectCard';
import { useProjectStore } from '../../store/projectStore';

export default function RecentSection() {
  const navigate = useNavigate();
  const { projects, fetchProjects, isLoading, deleteProject } = useProjectStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [currentFilter, setCurrentFilter] = useState('All Categories');
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Filtering & Search over real projects
  const filteredProjects = useMemo(() => {
    if (!projects || !Array.isArray(projects)) return [];

    return projects.filter((p) => {
      // Search match
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = !q || p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q);

      // Filter match
      const filterMatch =
        currentFilter === 'All Categories' ||
        (p.settings?.framework && p.settings.framework.toLowerCase() === currentFilter.toLowerCase()) ||
        (p.category && p.category.toLowerCase() === currentFilter.toLowerCase());

      return nameMatch && filterMatch;
    });
  }, [projects, searchQuery, currentFilter]);

  // Sorting real projects
  const sortedProjects = useMemo(() => {
    const list = [...filteredProjects];
    if (sortBy === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'created') {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      // Default: recent (updatedAt or createdAt)
      list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    }
    return list;
  }, [filteredProjects, sortBy]);

  const handleDelete = async (id) => {
    try {
      await deleteProject(id);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  return (
    <section className="w-full mt-10 sm:mt-14 space-y-5">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-[#E2E5E8] dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-[#111827] dark:text-white tracking-tight">
            Recents
          </h3>
          {projects && projects.length > 0 && (
            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full border border-[#E2E5E8]">
              {projects.length}
            </span>
          )}
        </div>

        <RecentToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          currentFilter={currentFilter}
          onSelectFilter={setCurrentFilter}
          sortBy={sortBy}
          onSelectSort={setSortBy}
          viewMode={viewMode}
          onToggleView={setViewMode}
        />
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 text-[#52525B] animate-spin" />
          <p className="text-xs text-[#64748B] font-mono">Loading projects...</p>
        </div>
      ) : sortedProjects.length === 0 ? (
        /* Empty State: NO mock data! */
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 sm:p-16 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-zinc-50 text-[#52525B] flex items-center justify-center mb-1">
            <FolderOpen className="w-6 h-6 stroke-[1.75]" />
          </div>
          <h4 className="text-sm font-bold text-[#111827]">
            {searchQuery ? 'No matching projects found' : 'No projects created yet'}
          </h4>
          <p className="text-xs text-[#64748B] max-w-sm leading-relaxed">
            {searchQuery
              ? 'Try changing your search term or category filter.'
              : 'Enter a prompt in the composer above to generate your first AI prototype or web application.'}
          </p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-2.5">
          {sortedProjects.map((proj) => (
            <ProjectCard
              key={proj._id || proj.id}
              project={proj}
              viewMode="list"
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        /* Responsive Grid: Desktop: 3–4 cards, Tablet: 2 cards, Mobile: 1 card */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 sm:gap-6">
          {sortedProjects.map((proj) => (
            <ProjectCard
              key={proj._id || proj.id}
              project={proj}
              viewMode="grid"
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}
