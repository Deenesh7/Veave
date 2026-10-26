import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Share2,
  Folder,
  FolderKanban,
  Loader2,
  Search,
  FileCode2,
  FileJson,
  FileText,
  Clock,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Code2,
  Image as ImageIcon,
  Upload
} from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { formatDate } from '../utils/helpers';
import {
  isImageFile,
  PROJECT_FOLDER_DEFINITIONS,
  getFileCategory
} from '../utils/fileUtils';

function getFileDetails(path, content = '') {
  const ext = (path || '').split('.').pop()?.toLowerCase();
  const name = (path || '').split('/').pop() || path;
  const sizeKb = content ? `${Math.max(0.4, Math.round((content.length / 1024) * 10) / 10)} KB` : '1.0 KB';
  const category = getFileCategory(path);

  if (isImageFile(path)) {
    return { name, ext, type: 'Image Asset', icon: ImageIcon, color: 'text-purple-600', bg: 'bg-purple-50', sizeKb, isImage: true, category };
  }

  switch (ext) {
    case 'jsx':
    case 'tsx':
      return { name, ext, type: 'React Component', icon: FileCode2, color: 'text-zinc-600', bg: 'bg-zinc-50', sizeKb, isImage: false, category };
    case 'js':
    case 'ts':
      return { name, ext, type: 'JavaScript', icon: FileCode2, color: 'text-amber-600', bg: 'bg-amber-50', sizeKb, isImage: false, category };
    case 'json':
      return { name, ext, type: 'JSON Config', icon: FileJson, color: 'text-emerald-600', bg: 'bg-emerald-50', sizeKb, isImage: false, category };
    case 'css':
    case 'scss':
      return { name, ext, type: 'Stylesheet', icon: FileCode2, color: 'text-sky-600', bg: 'bg-sky-50', sizeKb, isImage: false, category };
    case 'html':
      return { name, ext, type: 'HTML Document', icon: FileCode2, color: 'text-orange-600', bg: 'bg-orange-50', sizeKb, isImage: false, category };
    case 'md':
      return { name, ext, type: 'Markdown', icon: FileText, color: 'text-zinc-600', bg: 'bg-zinc-100', sizeKb, isImage: false, category };
    default:
      return { name, ext: ext || 'file', type: 'Source File', icon: FileText, color: 'text-zinc-600', bg: 'bg-zinc-100', sizeKb, isImage: false, category };
  }
}

export default function SharedPage() {
  const navigate = useNavigate();
  const { projects, fetchProjects, updateProject, isLoading } = useProjectStore();
  const { setActiveFile, setViewMode } = useEditorStore();

  const [search, setSearch] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleOpenFile = (projectId, filePath) => {
    if (filePath) {
      setActiveFile(filePath);
      setViewMode('code');
    }
    navigate(`/editor/${projectId}`);
  };

  const activeProject = useMemo(
    () => (projects || []).find((p) => p._id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const activeCategoryDef = useMemo(
    () => PROJECT_FOLDER_DEFINITIONS.find((def) => def.id === activeCategoryId) || null,
    [activeCategoryId]
  );

  const activeProjectByCategory = useMemo(() => {
    const byCategory = {};
    PROJECT_FOLDER_DEFINITIONS.forEach((def) => {
      byCategory[def.id] = [];
    });
    if (!activeProject) return byCategory;
    (activeProject.files || []).forEach((f) => {
      const cat = getFileCategory(f.path);
      (byCategory[cat] || byCategory.config).push(f);
    });
    return byCategory;
  }, [activeProject]);

  const filteredProjects = useMemo(() => {
    if (!projects || !Array.isArray(projects)) return [];
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const matchProject =
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q));
      const matchFile = (p.files || []).some(
        (f) => f.path && f.path.toLowerCase().includes(q)
      );
      return matchProject || matchFile;
    });
  }, [projects, search]);

  const displayedCategoryFiles = useMemo(() => {
    if (!activeProject) return [];
    const files = activeCategoryId
      ? activeProjectByCategory[activeCategoryId] || []
      : activeProject.files || [];
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => {
      const details = getFileDetails(f.path, f.content);
      return (
        details.name.toLowerCase().includes(q) ||
        (f.path || '').toLowerCase().includes(q) ||
        details.type.toLowerCase().includes(q)
      );
    });
  }, [activeProject, activeProjectByCategory, activeCategoryId, search]);

  const handleEnterProject = (projectId) => {
    setActiveProjectId(projectId);
    setActiveCategoryId(null);
    setSearch('');
  };

  const handleBackToProjects = () => {
    setActiveProjectId(null);
    setActiveCategoryId(null);
    setSearch('');
  };

  const handleUploadImageToProject = async (e) => {
    const selected = Array.from(e.target.files || []);
    if (!selected.length || !activeProject) return;
    setIsUploadingImage(true);
    try {
      const existingFiles = [...(activeProject.files || [])];
      for (const file of selected) {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const targetPath = `public/images/${cleanName}`;
        const idx = existingFiles.findIndex((f) => f.path === targetPath);
        const entry = {
          path: targetPath,
          content: base64,
          encoding: 'base64',
          language: file.name.split('.').pop()?.toLowerCase() || 'png'
        };
        if (idx >= 0) existingFiles[idx] = entry;
        else existingFiles.push(entry);
      }
      await updateProject(activeProject._id, { files: existingFiles });
      await fetchProjects();
    } catch (err) {
      console.error('Failed to upload image to project:', err);
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full py-6 space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleUploadImageToProject}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E5E8]">
        <div>
          {activeProject ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 flex-wrap">
                <button
                  type="button"
                  onClick={handleBackToProjects}
                  className="hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Shared with Me</span>
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                <button
                  type="button"
                  onClick={() => {
                    setActiveCategoryId(null);
                    setSearch('');
                  }}
                  className={`truncate max-w-[240px] ${
                    activeCategoryDef
                      ? 'hover:text-zinc-900 font-medium cursor-pointer'
                      : 'font-semibold text-zinc-800'
                  }`}
                >
                  {activeProject.name}
                </button>
                {activeCategoryDef && (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="font-semibold text-zinc-800">{activeCategoryDef.name}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-[#111827] tracking-tight">
                  {activeCategoryDef ? `${activeProject.name} — ${activeCategoryDef.name}` : activeProject.name}
                </h1>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-semibold border border-zinc-200/60">
                  {activeCategoryDef
                    ? `${(activeProjectByCategory[activeCategoryDef.id] || []).length} files`
                    : `${(activeProject.files || []).length} total files`}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Shared with Me</h1>
                {projects && projects.length > 0 && (
                  <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 font-semibold border border-[#E2E5E8]">
                    {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#64748B] mt-0.5">
                Select a shared project to browse its Pages, Components, Lib, Images, and Config folders.
              </p>
            </div>
          )}
        </div>

        {activeProject && (
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              type="button"
              disabled={isUploadingImage}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-50 text-zinc-800 border border-zinc-200 text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isUploadingImage ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>Upload Image</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(`/editor/${activeProject._id}`)}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <span>Open in Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Search Bar */}
      {projects && projects.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-[#E2E5E8] shadow-2xs">
          <div className="flex items-center gap-2 flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-1.5 focus-within:border-[#52525B] focus-within:ring-2 focus-within:ring-zinc-50 transition-all">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              placeholder={
                activeProject
                  ? activeCategoryDef
                    ? `Search inside ${activeCategoryDef.name}...`
                    : `Search any file inside ${activeProject.name}...`
                  : 'Search shared projects by name...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-xs text-[#111827] placeholder:text-zinc-400 focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-[10px] text-zinc-400 hover:text-zinc-600 font-mono px-1 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-16 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-7 h-7 text-[#52525B] animate-spin" />
          <p className="text-xs text-[#64748B] font-mono">Loading shared projects...</p>
        </div>
      ) : !projects || projects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 sm:p-16 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-zinc-50 text-[#52525B] flex items-center justify-center mb-1">
            <Share2 className="w-6 h-6 stroke-[1.75]" />
          </div>
          <h4 className="text-sm font-bold text-[#111827]">No shared projects yet</h4>
          <p className="text-xs text-[#64748B] max-w-sm leading-relaxed">
            When teammates share prototypes or design system tokens with your email, they will appear here in real time.
          </p>
        </div>
      ) : !activeProject ? (
        filteredProjects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 text-center flex flex-col items-center justify-center space-y-2">
            <p className="text-sm font-semibold text-zinc-700">No matching projects found</p>
            <p className="text-xs text-zinc-400">No shared project matches "{search}"</p>
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-2 text-xs font-semibold text-[#52525B] hover:underline cursor-pointer"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => {
              const projectFiles = project.files || [];
              const pageCount = projectFiles.filter((f) => getFileCategory(f.path) === 'pages').length;
              const compCount = projectFiles.filter((f) => getFileCategory(f.path) === 'components').length;
              const imgCount = projectFiles.filter((f) => getFileCategory(f.path) === 'images').length;
              return (
                <div
                  key={project._id}
                  onClick={() => handleEnterProject(project._id)}
                  className="bg-white rounded-2xl border border-[#E2E5E8] hover:border-zinc-400 p-5 shadow-2xs hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-700 group-hover:bg-zinc-900 group-hover:text-white flex items-center justify-center shrink-0 transition-colors">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#111827] truncate group-hover:text-zinc-900">
                          {project.name}
                        </h3>
                        <p className="text-[11px] text-zinc-500 font-mono">
                          {pageCount} pages · {compCount} components · {imgCount} images
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-800 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </div>

                  {project.description && (
                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                      {project.description}
                    </p>
                  )}

                  <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3" />
                      {formatDate(project.updatedAt || project.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/editor/${project._id}`);
                      }}
                      className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>Open Studio</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : !activeCategoryDef && !search.trim() ? (
        /* Level 2: Inside Project — Arranged Category Folders */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleBackToProjects}
              className="px-3 py-1.5 rounded-xl bg-white border border-zinc-200 hover:bg-zinc-50 text-xs font-semibold text-zinc-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Projects</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {PROJECT_FOLDER_DEFINITIONS.map((def) => {
              const items = activeProjectByCategory[def.id] || [];
              return (
                <div
                  key={def.id}
                  onClick={() => {
                    setActiveCategoryId(def.id);
                    setSearch('');
                  }}
                  className="bg-white rounded-2xl border border-[#E2E5E8] hover:border-zinc-400 p-5 shadow-2xs hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 rounded-xl ${def.accentBg} ${def.accentText} flex items-center justify-center shrink-0`}>
                        {def.id === 'images' ? (
                          <ImageIcon className="w-5 h-5" />
                        ) : (
                          <Folder className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#111827] truncate">
                          {def.name}
                        </h3>
                        <p className="text-[11px] text-zinc-500 font-mono">
                          {def.folderPath} · {items.length} {items.length === 1 ? 'item' : 'items'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-800 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </div>

                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {def.description}
                  </p>

                  <div className="pt-3 border-t border-zinc-100 flex items-center justify-between text-[11px]">
                    <span className={`font-mono text-[10px] font-semibold px-2 py-0.5 rounded border ${def.accentBg} ${def.accentText} ${def.accentBorder}`}>
                      {def.badge}
                    </span>
                    <span className="text-xs font-semibold text-zinc-700 group-hover:text-zinc-900 flex items-center gap-1">
                      <span>Open Folder</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Level 3: Inside a Specific Category Folder */
        <div className="bg-white rounded-2xl border border-[#E2E5E8] overflow-hidden shadow-2xs">
          <div className="p-4 bg-zinc-50/70 border-b border-[#E2E5E8] flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => {
                  if (activeCategoryDef) {
                    setActiveCategoryId(null);
                    setSearch('');
                  } else {
                    setSearch('');
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-zinc-200 hover:bg-zinc-100 text-xs font-semibold text-zinc-700 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to {activeProject.name}</span>
              </button>
              <div className="w-7 h-7 rounded-lg bg-zinc-100 text-[#52525B] flex items-center justify-center shrink-0">
                {activeCategoryDef?.id === 'images' ? (
                  <ImageIcon className="w-4 h-4 text-purple-600" />
                ) : (
                  <FolderKanban className="w-4 h-4" />
                )}
              </div>
              <h2 className="text-sm font-bold text-[#111827] truncate">
                {activeCategoryDef
                  ? `${activeProject.name} / ${activeCategoryDef.name}`
                  : `${activeProject.name} — Search Results`}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-200/80 text-zinc-700 font-semibold">
                {displayedCategoryFiles.length} {displayedCategoryFiles.length === 1 ? 'file' : 'files'}
              </span>
            </div>
          </div>

          {displayedCategoryFiles.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <p className="text-xs text-zinc-500">
                {activeCategoryDef?.id === 'images'
                  ? `No images stored in ${activeProject.name} yet.`
                  : `No files in ${activeCategoryDef?.name || activeProject.name}.`}
              </p>
              {activeCategoryDef?.id === 'images' && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Image to Project</span>
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {displayedCategoryFiles.map((file) => {
                const details = getFileDetails(file.path, file.content);
                const Icon = details.icon;
                return (
                  <div
                    key={file.path}
                    onClick={() => handleOpenFile(activeProject._id, file.path)}
                    className="grid grid-cols-12 px-5 py-3 items-center text-xs hover:bg-zinc-50 transition-colors group cursor-pointer"
                  >
                    <div className="col-span-6 sm:col-span-5 flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded-lg ${details.bg} ${details.color} flex items-center justify-center shrink-0`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-[#111827] group-hover:text-[#52525B] transition-colors truncate">
                        {details.name}
                      </span>
                    </div>

                    <div className="col-span-4 sm:col-span-4 text-zinc-500 font-mono text-[11px] truncate">
                      {file.path}
                    </div>

                    <div className="hidden sm:flex sm:col-span-2 items-center">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200/60">
                        {details.type}
                      </span>
                    </div>

                    <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(activeProject._id, file.path);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-semibold transition-colors shrink-0 cursor-pointer"
                        title="Open in Code Editor"
                      >
                        <Code2 className="w-3 h-3 text-zinc-600" />
                        <span>Open</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
