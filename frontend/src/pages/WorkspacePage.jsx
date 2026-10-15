import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  FolderKanban, 
  Loader2, 
  ExternalLink, 
  Search, 
  FileCode2, 
  FileJson, 
  FileText, 
  ChevronDown, 
  ChevronUp, 
  LayoutGrid, 
  ListTree, 
  Sparkles, 
  Clock, 
  Layers, 
  ArrowRight,
  Code2,
  FolderOpen
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { formatDate } from '../utils/helpers';

function getFileDetails(path, content = '') {
  const ext = (path || '').split('.').pop()?.toLowerCase();
  const name = (path || '').split('/').pop() || path;
  const sizeKb = content ? `${Math.max(0.4, Math.round((content.length / 1024) * 10) / 10)} KB` : '1.0 KB';

  switch (ext) {
    case 'jsx':
    case 'tsx':
      return { name, ext, type: 'React Component', icon: FileCode2, color: 'text-zinc-600', bg: 'bg-zinc-50', sizeKb };
    case 'js':
    case 'ts':
      return { name, ext, type: 'JavaScript', icon: FileCode2, color: 'text-amber-600', bg: 'bg-amber-50', sizeKb };
    case 'json':
      return { name, ext, type: 'JSON Config', icon: FileJson, color: 'text-emerald-600', bg: 'bg-emerald-50', sizeKb };
    case 'css':
    case 'scss':
      return { name, ext, type: 'Stylesheet', icon: FileCode2, color: 'text-sky-600', bg: 'bg-sky-50', sizeKb };
    case 'html':
      return { name, ext, type: 'HTML Document', icon: FileCode2, color: 'text-orange-600', bg: 'bg-orange-50', sizeKb };
    case 'md':
      return { name, ext, type: 'Markdown', icon: FileText, color: 'text-zinc-600', bg: 'bg-zinc-100', sizeKb };
    default:
      return { name, ext: ext || 'file', type: 'Source File', icon: FileText, color: 'text-zinc-600', bg: 'bg-zinc-100', sizeKb };
  }
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { projects, fetchProjects, isLoading } = useProjectStore();
  const { setActiveFile, setViewMode } = useEditorStore();

  const [search, setSearch] = useState('');
  const [viewMode, setViewModeState] = useState('list'); // 'list' (grouped with files) | 'grid' (compact cards)
  const [expandedProjects, setExpandedProjects] = useState({});

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Expand all projects by default when loaded
  useEffect(() => {
    if (projects && projects.length > 0) {
      const initial = {};
      projects.forEach((p) => {
        initial[p._id] = true;
      });
      setExpandedProjects(initial);
    }
  }, [projects]);

  const toggleProject = (projectId) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId]
    }));
  };

  const handleExpandAll = () => {
    const all = {};
    projects.forEach((p) => {
      all[p._id] = true;
    });
    setExpandedProjects(all);
  };

  const handleCollapseAll = () => {
    const none = {};
    projects.forEach((p) => {
      none[p._id] = false;
    });
    setExpandedProjects(none);
  };

  const handleOpenFile = (projectId, filePath) => {
    if (filePath) {
      setActiveFile(filePath);
      setViewMode('code');
    }
    navigate(`/editor/${projectId}`);
  };

  const workspaceName = user?.name ? `${user.name}'s Workspace` : 'Workspace';

  // Total files calculation
  const totalFilesCount = useMemo(() => {
    if (!projects || !Array.isArray(projects)) return 0;
    return projects.reduce((sum, p) => sum + (p.files?.length || 0), 0);
  }, [projects]);

  // Filter projects and files by search query
  const filteredProjects = useMemo(() => {
    if (!projects || !Array.isArray(projects)) return [];
    if (!search.trim()) return projects;

    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      const matchProject = (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.settings?.designSystem && p.settings.designSystem.toLowerCase().includes(q));
      
      const matchFile = (p.files || []).some((f) => 
        (f.path && f.path.toLowerCase().includes(q)) ||
        (f.language && f.language.toLowerCase().includes(q))
      );

      return matchProject || matchFile;
    });
  }, [projects, search]);

  return (
    <div className="w-full py-6 space-y-6">
      {/* 1. Header with Title, Badges, and Primary CTA */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E5E8]">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Workspace Projects & Files</h1>
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-zinc-50 text-zinc-700 font-semibold border border-zinc-200/60">
              {workspaceName}
            </span>
            {projects && projects.length > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-[#E2E5E8]">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'} · {totalFilesCount} files
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            See exactly which files belong to each project, inspect component structures, and open code directly.
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={() => navigate('/')}
            className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* 2. Control Strip: Search Bar, View Toggle, Expand/Collapse */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E2E5E8] shadow-2xs">
        {/* Search Input */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px] bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-1.5 focus-within:border-[#52525B] focus-within:ring-2 focus-within:ring-zinc-50 transition-all">
          <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            placeholder="Search projects or files (e.g. App.jsx, tokens.json, dashboard)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-xs text-[#111827] placeholder:text-zinc-400 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-[10px] text-zinc-400 hover:text-zinc-600 font-mono px-1"
            >
              Clear
            </button>
          )}
        </div>

        {/* View Switcher & Accordion Actions */}
        <div className="flex items-center gap-2 justify-between sm:justify-end shrink-0">
          {viewMode === 'list' && (
            <div className="flex items-center gap-1 text-[11px] text-zinc-500 font-medium">
              <button
                onClick={handleExpandAll}
                className="px-2 py-1 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition-colors cursor-pointer"
              >
                Expand all
              </button>
              <span className="text-zinc-300">·</span>
              <button
                onClick={handleCollapseAll}
                className="px-2 py-1 rounded-lg hover:bg-zinc-100 hover:text-zinc-900 transition-colors cursor-pointer"
              >
                Collapse all
              </button>
            </div>
          )}

          <div className="flex items-center p-0.5 rounded-xl bg-zinc-100 border border-zinc-200">
            <button
              onClick={() => setViewModeState('list')}
              title="Detailed View with Files"
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-zinc-900 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <ListTree className="w-3.5 h-3.5" />
              <span>Project Files</span>
            </button>
            <button
              onClick={() => setViewModeState('grid')}
              title="Compact Card Grid"
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white text-zinc-900 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Cards</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Projects Content */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-16 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-7 h-7 text-[#52525B] animate-spin" />
          <p className="text-xs text-[#64748B] font-mono">Loading workspace projects & files...</p>
        </div>
      ) : !projects || projects.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 sm:p-20 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-zinc-50 text-[#52525B] flex items-center justify-center mb-1">
            <FolderOpen className="w-7 h-7 stroke-[1.75]" />
          </div>
          <h4 className="text-base font-bold text-[#111827]">No projects in workspace</h4>
          <p className="text-xs text-[#64748B] max-w-sm leading-relaxed">
            Generate your first UI design or prototype to organize components, files, and design tokens here.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create your first project</span>
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 text-center flex flex-col items-center justify-center space-y-2">
          <p className="text-sm font-semibold text-zinc-700">No matching projects or files found</p>
          <p className="text-xs text-zinc-400">Try changing your search query "{search}"</p>
          <button
            onClick={() => setSearch('')}
            className="mt-2 text-xs font-semibold text-[#52525B] hover:underline"
          >
            Clear filter
          </button>
        </div>
      ) : viewMode === 'list' ? (
        /* Detailed View: Every Project with its exact files cleanly aligned */
        <div className="space-y-4">
          {filteredProjects.map((project) => {
            const isExpanded = expandedProjects[project._id] ?? true;
            const projectFiles = project.files || [];
            const designSystemName = project.settings?.designSystem || 'Modern';
            const aiModel = project.settings?.aiModel || 'Gemini Flash 3.8';

            return (
              <div
                key={project._id}
                className="bg-white rounded-2xl border border-[#E2E5E8] overflow-hidden shadow-2xs hover:border-zinc-300 transition-all"
              >
                {/* Project Header Row */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white">
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <div 
                      onClick={() => navigate(`/editor/${project._id}`)}
                      className="w-10 h-10 rounded-xl bg-zinc-50 text-[#52525B] flex items-center justify-center shrink-0 cursor-pointer hover:bg-zinc-100 transition-colors shadow-2xs"
                    >
                      <FolderKanban className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2
                          onClick={() => navigate(`/editor/${project._id}`)}
                          className="text-base font-bold text-[#111827] hover:text-[#52525B] cursor-pointer transition-colors truncate"
                        >
                          {project.name}
                        </h2>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 font-semibold border border-zinc-200">
                          {designSystemName}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-50 text-zinc-700 font-semibold border border-zinc-200/50">
                          {aiModel}
                        </span>
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-50 border border-zinc-200 text-zinc-600">
                          {projectFiles.length} {projectFiles.length === 1 ? 'file' : 'files'}
                        </span>
                      </div>

                      <p className="text-xs text-[#64748B] mt-1 line-clamp-1">
                        {project.description || 'AI generated application interface.'}
                      </p>
                    </div>
                  </div>

                  {/* Right Actions: Open in Editor & Toggle Files */}
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100">
                    <button
                      onClick={() => navigate(`/editor/${project._id}`)}
                      className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Open project in Studio & Live Preview"
                    >
                      <span>Open Project</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => toggleProject(project._id)}
                      className="px-2.5 py-1.5 rounded-xl border border-zinc-200 hover:bg-zinc-50 text-zinc-600 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title={isExpanded ? 'Hide files list' : 'View project files'}
                    >
                      <span className="text-[11px]">{isExpanded ? 'Hide Files' : 'Show Files'}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Project Files Table Container */}
                {isExpanded && (
                  <div className="border-t border-[#E2E5E8] bg-zinc-50/40">
                    {projectFiles.length === 0 ? (
                      <div className="p-6 text-center text-xs text-zinc-400 font-mono">
                        No files generated for this project yet.
                      </div>
                    ) : (
                      <div>
                        {/* Table Column Headers */}
                        <div className="grid grid-cols-12 px-5 py-2.5 bg-zinc-100/70 border-b border-[#E2E5E8] text-[10px] font-mono uppercase font-bold text-zinc-400 tracking-wider">
                          <div className="col-span-5 sm:col-span-4">File Name</div>
                          <div className="col-span-4 sm:col-span-4">Path</div>
                          <div className="hidden sm:block sm:col-span-2">Type</div>
                          <div className="col-span-3 sm:col-span-2 text-right">Action / Size</div>
                        </div>

                        {/* File Rows */}
                        <div className="divide-y divide-zinc-100">
                          {projectFiles.map((file) => {
                            const details = getFileDetails(file.path, file.content);
                            const Icon = details.icon;

                            return (
                              <div
                                key={file.path}
                                onClick={() => handleOpenFile(project._id, file.path)}
                                className="grid grid-cols-12 px-5 py-2.5 items-center text-xs hover:bg-white transition-colors group cursor-pointer"
                              >
                                {/* File Name & Icon */}
                                <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0">
                                  <div className={`w-7 h-7 rounded-lg ${details.bg} ${details.color} flex items-center justify-center shrink-0`}>
                                    <Icon className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="font-semibold text-[#111827] group-hover:text-[#52525B] transition-colors truncate">
                                    {details.name}
                                  </span>
                                </div>

                                {/* Full Path */}
                                <div className="col-span-4 sm:col-span-4 text-zinc-500 font-mono text-[11px] truncate">
                                  {file.path}
                                </div>

                                {/* Component / File Type */}
                                <div className="hidden sm:flex sm:col-span-2 items-center">
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200/60">
                                    {details.type}
                                  </span>
                                </div>

                                {/* Size & Open in Editor Button */}
                                <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-2 text-right">
                                  <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                                    {details.sizeKb}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenFile(project._id, file.path);
                                    }}
                                    className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-semibold transition-colors shrink-0"
                                    title={`Open ${details.name} in Code Workspace`}
                                  >
                                    <Code2 className="w-3 h-3 text-zinc-600" />
                                    <span>Code</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Project Footer Meta */}
                    <div className="px-5 py-2.5 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                      <span>Last updated: {formatDate(project.updatedAt || project.createdAt)}</span>
                      <span className="text-zinc-500">ID: {project._id}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Compact Card Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map((project) => {
            const projectFiles = project.files || [];
            return (
              <div
                key={project._id}
                onClick={() => navigate(`/editor/${project._id}`)}
                className="bg-white rounded-2xl border border-[#E2E5E8] p-5 flex flex-col justify-between shadow-2xs hover:shadow-xs hover:border-zinc-300 transition-all group cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl bg-zinc-50 text-[#52525B] flex items-center justify-center">
                      <FolderKanban className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                      {project.settings?.designSystem || 'Modern'}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-[#111827] group-hover:text-[#52525B] transition-colors mb-1.5 truncate">
                    {project.name}
                  </h3>

                  <p className="text-xs text-[#64748B] leading-relaxed line-clamp-2 mb-4">
                    {project.description || 'AI generated application prototype.'}
                  </p>

                  {/* File Preview Chips */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 tracking-wider">
                      Files ({projectFiles.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {projectFiles.slice(0, 4).map((f) => (
                        <span
                          key={f.path}
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-50 border border-zinc-200 text-zinc-600 truncate max-w-[140px]"
                        >
                          {f.path.split('/').pop()}
                        </span>
                      ))}
                      {projectFiles.length > 4 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-400">
                          +{projectFiles.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-5 border-t border-zinc-100 flex items-center justify-between text-xs text-zinc-400">
                  <span className="font-mono text-[11px]">{formatDate(project.updatedAt || project.createdAt)}</span>
                  <span className="text-xs font-semibold text-[#52525B] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    <span>Open</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
