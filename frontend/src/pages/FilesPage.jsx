import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Search, 
  Plus, 
  FolderOpen, 
  Loader2, 
  ExternalLink,
  FileCode2,
  FileJson,
  FolderKanban,
  Code2,
  LayoutGrid,
  ListTree,
  Filter,
  ArrowRight,
  ChevronDown,
  Check
} from 'lucide-react';
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

export default function FilesPage() {
  const [search, setSearch] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState('ALL');
  const [groupByProject, setGroupByProject] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const navigate = useNavigate();
  const { projects, fetchProjects, isLoading } = useProjectStore();
  const { setActiveFile, setViewMode } = useEditorStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleOpenFile = (projectId, filePath) => {
    if (projectId) {
      if (filePath) {
        setActiveFile(filePath);
        setViewMode('code');
      }
      navigate(`/editor/${projectId}`);
    } else {
      navigate('/');
    }
  };

  // Aggregate real files across user's real projects + uploaded files
  const allFiles = useMemo(() => {
    const projectFiles = (!projects || !Array.isArray(projects))
      ? []
      : projects.flatMap((p) =>
          (p.files || []).map((f) => {
            const details = getFileDetails(f.path, f.content);
            return {
              name: details.name,
              fullPath: f.path,
              projectName: p.name,
              projectId: p._id,
              type: details.type,
              icon: details.icon,
              color: details.color,
              bg: details.bg,
              size: details.sizeKb,
              modified: formatDate(p.updatedAt || p.createdAt),
              isUploaded: false
            };
          })
        );

    let uploaded = [];
    try {
      const saved = localStorage.getItem('veave_uploaded_files');
      if (saved) {
        uploaded = JSON.parse(saved).map((u) => {
          const details = getFileDetails(u.name, '');
          return {
            name: u.name,
            fullPath: `/uploads/${u.name}`,
            projectName: 'Workspace Uploads',
            projectId: '',
            type: u.type || details.type,
            icon: details.icon,
            color: details.color,
            bg: details.bg,
            size: u.size ? `${(u.size / 1024).toFixed(1)} KB` : '1.2 KB',
            modified: formatDate(u.uploadedAt || new Date()),
            isUploaded: true
          };
        });
      }
    } catch {}

    return [...projectFiles, ...uploaded];
  }, [projects]);

  // Unique project list for filter dropdown
  const projectOptions = useMemo(() => {
    if (!projects || !Array.isArray(projects)) return [];
    return projects.map((p) => ({ id: p._id, name: p.name }));
  }, [projects]);

  // Filtered files
  const filtered = useMemo(() => {
    return allFiles.filter((f) => {
      const matchSearch =
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.fullPath.toLowerCase().includes(search.toLowerCase()) ||
        f.projectName.toLowerCase().includes(search.toLowerCase()) ||
        f.type.toLowerCase().includes(search.toLowerCase());

      const matchProject =
        selectedProjectFilter === 'ALL' ||
        f.projectId === selectedProjectFilter ||
        (selectedProjectFilter === 'UPLOADS' && f.isUploaded);

      return matchSearch && matchProject;
    });
  }, [allFiles, search, selectedProjectFilter]);

  // Grouped files by project
  const groupedByProjectData = useMemo(() => {
    const groups = {};
    filtered.forEach((file) => {
      const key = file.projectId || (file.isUploaded ? 'uploads' : 'other');
      if (!groups[key]) {
        groups[key] = {
          projectId: file.projectId,
          projectName: file.projectName,
          isUploaded: file.isUploaded,
          files: []
        };
      }
      groups[key].files.push(file);
    });
    return Object.values(groups);
  }, [filtered]);

  return (
    <div className="w-full py-6 space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E5E8]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Workspace Files</h1>
            {allFiles.length > 0 && (
              <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-zinc-50 text-zinc-700 border border-zinc-200/60">
                {allFiles.length} {allFiles.length === 1 ? 'file' : 'files'}
              </span>
            )}
            {projects && projects.length > 0 && (
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-[#E2E5E8]">
                across {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Browse, inspect, and open component source files belonging to each project in your workspace.
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={() => navigate('/')}
            className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate New File</span>
          </button>
        </div>
      </div>

      {/* 2. Control Bar: Search, Project Filter & Group Toggle */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E2E5E8] shadow-2xs">
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-1.5 focus-within:border-[#52525B] focus-within:ring-2 focus-within:ring-zinc-50 transition-all">
          <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            placeholder="Search file name, component, or extension..."
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

        {/* Filters and View Switcher */}
        <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end shrink-0">
          {/* Project Filter Dropdown */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-600 relative z-20">
            <Filter className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <div 
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  setIsDropdownOpen(false);
                }
              }}
            >
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-xl text-xs font-semibold text-[#111827] focus:outline-none transition-colors w-[200px] justify-between cursor-pointer"
              >
                <span className="truncate">
                  {selectedProjectFilter === 'ALL' ? `All Projects (${allFiles.length})` :
                   selectedProjectFilter === 'UPLOADS' ? 'Workspace Uploads' :
                   projectOptions.find(p => p.id === selectedProjectFilter)?.name || 'Select Project'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              </button>
              
              {isDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-[220px] bg-white border border-zinc-200 rounded-xl shadow-lg py-1.5 max-h-[300px] overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => { setSelectedProjectFilter('ALL'); setIsDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 transition-colors flex items-center justify-between cursor-pointer ${selectedProjectFilter === 'ALL' ? 'text-[#111827] font-semibold bg-zinc-50/80' : 'text-zinc-600 font-medium'}`}
                  >
                    All Projects ({allFiles.length})
                    {selectedProjectFilter === 'ALL' && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                  </button>
                  
                  {projectOptions.length > 0 && <div className="h-px bg-zinc-100 my-1 mx-3" />}
                  
                  {projectOptions.map(p => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => { setSelectedProjectFilter(p.id); setIsDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 transition-colors flex items-center justify-between cursor-pointer ${selectedProjectFilter === p.id ? 'text-[#111827] font-semibold bg-zinc-50/80' : 'text-zinc-600 font-medium'}`}
                    >
                      <span className="truncate pr-2">{p.name}</span>
                      {selectedProjectFilter === p.id && <Check className="w-3.5 h-3.5 text-zinc-800 shrink-0" />}
                    </button>
                  ))}
                  
                  <div className="h-px bg-zinc-100 my-1 mx-3" />
                  
                  <button
                    type="button"
                    onClick={() => { setSelectedProjectFilter('UPLOADS'); setIsDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 transition-colors flex items-center justify-between cursor-pointer ${selectedProjectFilter === 'UPLOADS' ? 'text-[#111827] font-semibold bg-zinc-50/80' : 'text-zinc-600 font-medium'}`}
                  >
                    Workspace Uploads
                    {selectedProjectFilter === 'UPLOADS' && <Check className="w-3.5 h-3.5 text-zinc-800" />}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Group / Flat Toggle */}
          <div className="flex items-center p-0.5 rounded-xl bg-zinc-100 border border-zinc-200">
            <button
              type="button"
              onClick={() => setGroupByProject(true)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                groupByProject
                  ? 'bg-white text-zinc-900 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              title="Group files by project"
            >
              <ListTree className="w-3.5 h-3.5" />
              <span>By Project</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupByProject(false)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                !groupByProject
                  ? 'bg-white text-zinc-900 shadow-2xs'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
              title="View all files in a single flat list"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>All Files</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Main Content */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-16 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-7 h-7 text-[#52525B] animate-spin" />
          <p className="text-xs text-[#64748B] font-mono">Loading workspace files...</p>
        </div>
      ) : allFiles.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 sm:p-20 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-zinc-50 text-[#52525B] flex items-center justify-center mb-1">
            <FolderOpen className="w-7 h-7 stroke-[1.75]" />
          </div>
          <h4 className="text-base font-bold text-[#111827]">No files generated yet</h4>
          <p className="text-xs text-[#64748B] max-w-sm leading-relaxed">
            Create your first application prototype to generate component files, styles, and tokens.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-3 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Generate your first project</span>
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 text-center flex flex-col items-center justify-center space-y-2">
          <p className="text-sm font-semibold text-zinc-700">No matching files found</p>
          <p className="text-xs text-zinc-400">Try changing your search query "{search}" or project filter</p>
          <button
            onClick={() => {
              setSearch('');
              setSelectedProjectFilter('ALL');
            }}
            className="mt-2 text-xs font-semibold text-[#52525B] hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : groupByProject ? (
        /* Grouped by Project View */
        <div className="space-y-5">
          {groupedByProjectData.map((group) => (
            <div
              key={group.projectId || group.projectName}
              className="bg-white rounded-2xl border border-[#E2E5E8] overflow-hidden shadow-2xs"
            >
              {/* Project Group Header */}
              <div className="p-4 bg-zinc-50/70 border-b border-[#E2E5E8] flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-zinc-50 text-[#52525B] flex items-center justify-center shrink-0 shadow-2xs">
                    <FolderKanban className="w-4 h-4" />
                  </div>
                  <h2 
                    onClick={() => group.projectId && navigate(`/editor/${group.projectId}`)}
                    className={`text-sm font-bold text-[#111827] truncate ${group.projectId ? 'hover:text-[#52525B] cursor-pointer' : ''}`}
                  >
                    {group.projectName}
                  </h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-200/80 text-zinc-700 font-semibold">
                    {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
                  </span>
                </div>

                {group.projectId && (
                  <button
                    onClick={() => navigate(`/editor/${group.projectId}`)}
                    className="text-xs font-semibold text-[#52525B] hover:text-zinc-700 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Open in Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Table Column Headers */}
              <div className="grid grid-cols-12 px-5 py-2.5 bg-zinc-100/50 border-b border-[#E2E5E8] text-[10px] font-mono uppercase font-bold text-zinc-400 tracking-wider">
                <div className="col-span-5 sm:col-span-4">File Name</div>
                <div className="col-span-4 sm:col-span-4">Path</div>
                <div className="hidden sm:block sm:col-span-2">Type</div>
                <div className="col-span-3 sm:col-span-2 text-right">Action / Size</div>
              </div>

              {/* Files in this Project */}
              <div className="divide-y divide-zinc-100">
                {group.files.map((file) => {
                  const Icon = file.icon;
                  return (
                    <div
                      key={file.fullPath}
                      onClick={() => handleOpenFile(file.projectId, file.fullPath)}
                      className="grid grid-cols-12 px-5 py-3 items-center text-xs hover:bg-zinc-50 transition-colors group cursor-pointer"
                    >
                      <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg ${file.bg} ${file.color} flex items-center justify-center shrink-0`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-[#111827] group-hover:text-[#52525B] transition-colors truncate">
                          {file.name}
                        </span>
                      </div>

                      <div className="col-span-4 sm:col-span-4 text-zinc-500 font-mono text-[11px] truncate">
                        {file.fullPath}
                      </div>

                      <div className="hidden sm:flex sm:col-span-2 items-center">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200/60">
                          {file.type}
                        </span>
                      </div>

                      <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-2 text-right">
                        <span className="font-mono text-[11px] text-zinc-400 shrink-0">
                          {file.size}
                        </span>
                        {file.projectId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFile(file.projectId, file.fullPath);
                            }}
                            className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-semibold transition-colors shrink-0"
                            title="Open in Code Editor"
                          >
                            <Code2 className="w-3 h-3 text-zinc-600" />
                            <span>Code</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Flat Files Table View */
        <div className="bg-white rounded-2xl border border-[#E2E5E8] shadow-xs overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 bg-zinc-50 border-b border-[#E2E5E8] text-[11px] font-mono uppercase font-semibold text-zinc-400">
            <div className="col-span-5 sm:col-span-4">File Name</div>
            <div className="col-span-3 sm:col-span-3">Project</div>
            <div className="hidden sm:block sm:col-span-2">Type</div>
            <div className="col-span-2 sm:col-span-1">Size</div>
            <div className="col-span-2 sm:col-span-2 text-right">Action / Modified</div>
          </div>

          <div className="divide-y divide-zinc-100">
            {filtered.map((file, i) => {
              const Icon = file.icon;
              return (
                <div
                  key={i}
                  onClick={() => handleOpenFile(file.projectId, file.fullPath)}
                  className="grid grid-cols-12 px-5 py-3.5 items-center text-xs hover:bg-zinc-50 transition-colors group cursor-pointer"
                >
                  <div className="col-span-5 sm:col-span-4 flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg ${file.bg} ${file.color} flex items-center justify-center shrink-0`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold text-[#111827] truncate group-hover:text-[#52525B] transition-colors block">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono truncate block">
                        {file.fullPath}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-3 sm:col-span-3 text-[#111827] font-medium truncate flex items-center gap-1.5">
                    <FolderKanban className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="truncate">{file.projectName}</span>
                  </div>

                  <div className="hidden sm:flex sm:col-span-2 items-center">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200/60">
                      {file.type}
                    </span>
                  </div>

                  <div className="col-span-2 sm:col-span-1 text-zinc-400 font-mono text-[11px]">
                    {file.size}
                  </div>

                  <div className="col-span-2 sm:col-span-2 flex items-center justify-end gap-2 text-right">
                    <span className="font-mono text-[11px] text-zinc-400 hidden sm:inline">
                      {file.modified}
                    </span>
                    {file.projectId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(file.projectId, file.fullPath);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-semibold transition-colors shrink-0"
                        title="Open in Code Editor"
                      >
                        <Code2 className="w-3 h-3 text-zinc-600" />
                        <span>Code</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
