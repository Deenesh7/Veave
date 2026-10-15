import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { projectService } from '../../services/projectService';

import { CodeToolbar } from './CodeToolbar';
import { FileExplorer } from './FileExplorer';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './CodeEditor';
import { AIAssistant } from './AIAssistant';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { ShareModal } from '../share/ShareModal';

export function CodeWorkspace({
  projectId: projectIdProp,
  project = null,
  onBack,
  onSwitchMode,
  initialFiles = null,
  projectName = null,
  showToolbar = true,
  embedded = false,
  onFilesChange = null
}) {
  const navigate = useNavigate();
  const routeParams = useParams();
  const { currentProject, updateProjectFiles, updateProject } = useProjectStore();
  const { setActiveFile: syncGlobalActiveFile } = useEditorStore();

  // Resolve project name and project id
  const effectiveProjectName = projectName || project?.name || currentProject?.name || 'Workspace Project';
  const effectiveProjectId = projectIdProp || project?._id || currentProject?._id || routeParams?.id;

  // Initialize files state: priority: passed initialFiles > currentProject.files > empty array
  const [files, setFiles] = useState(() => {
    if (initialFiles && initialFiles.length > 0) return initialFiles;
    if (currentProject?.files && currentProject.files.length > 0) return currentProject.files;
    return [];
  });

  const globalActiveFile = useEditorStore((s) => s.activeFile);

  // Keep files in sync if currentProject or initialFiles updates from external source
  useEffect(() => {
    const nextFiles = (initialFiles && initialFiles.length > 0)
      ? initialFiles
      : (currentProject?.files && currentProject.files.length > 0)
        ? currentProject.files
        : [];

    setFiles(nextFiles);

    if (nextFiles && nextFiles.length > 0) {
      // Select active file based on globalActiveFile or App.jsx or first file
      setActiveFilePath((currentActive) => {
        if (globalActiveFile && nextFiles.some((f) => f.path === globalActiveFile)) {
          return globalActiveFile;
        }
        if (currentActive && nextFiles.some((f) => f.path === currentActive)) {
          return currentActive;
        }
        const appFile = nextFiles.find((f) => f.path.endsWith('App.jsx'));
        return appFile ? appFile.path : nextFiles[0]?.path || '';
      });

      // Synchronize open tabs with the files that belong to this project
      setOpenFilePaths((prevTabs) => {
        const validExisting = prevTabs.filter((p) => nextFiles.some((f) => f.path === p));
        if (validExisting.length > 0) {
          if (globalActiveFile && nextFiles.some((f) => f.path === globalActiveFile) && !validExisting.includes(globalActiveFile)) {
            return [...validExisting, globalActiveFile];
          }
          return validExisting;
        }
        const initialTabs = [];
        const appFile = nextFiles.find((f) => f.path.endsWith('App.jsx'));
        if (appFile) initialTabs.push(appFile.path);
        if (globalActiveFile && nextFiles.some((f) => f.path === globalActiveFile) && !initialTabs.includes(globalActiveFile)) {
          initialTabs.push(globalActiveFile);
        }
        nextFiles.slice(0, 3).forEach((f) => {
          if (!initialTabs.includes(f.path) && initialTabs.length < 3) {
            initialTabs.push(f.path);
          }
        });
        return initialTabs.length > 0 ? initialTabs : [nextFiles[0]?.path || ''];
      });
    } else {
      setActiveFilePath('');
      setOpenFilePaths([]);
    }
  }, [initialFiles, currentProject?.files, globalActiveFile]);

  // Open tabs list and currently active file
  const [openFilePaths, setOpenFilePaths] = useState(() => {
    if (!files || files.length === 0) return [];
    const existing = files.map((f) => f.path);
    if (globalActiveFile && existing.includes(globalActiveFile)) {
      return [globalActiveFile];
    }
    const appFile = files.find((f) => f.path.endsWith('App.jsx'));
    if (appFile) {
      return [appFile.path];
    }
    return existing.slice(0, 3);
  });

  const [activeFilePath, setActiveFilePath] = useState(() => {
    if (!files || files.length === 0) return '';
    if (globalActiveFile && files.some((f) => f.path === globalActiveFile)) return globalActiveFile;
    const appFile = files.find((f) => f.path.endsWith('App.jsx'));
    if (appFile) return appFile.path;
    return files[0]?.path || '';
  });

  // Unsaved changes map: { [filePath]: modifiedContentString }
  const [unsavedMap, setUnsavedMap] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Folder expanded states
  const [expandedFolders, setExpandedFolders] = useState({
    src: true,
    'src/components': true,
    'src/pages': true,
    'src/layouts': true,
    'src/hooks': true
  });

  // Editor cursor and selection tracking for StatusBar
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, selectionLength: 0 });

  // Modals and panels visibility
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Derive current file content (checking unsaved changes first)
  const currentFileContent = useMemo(() => {
    if (!activeFilePath) return '';
    if (unsavedMap[activeFilePath] !== undefined) {
      return unsavedMap[activeFilePath];
    }
    const target = files.find((f) => f.path === activeFilePath);
    return target?.content || '';
  }, [activeFilePath, unsavedMap, files]);

  const filesRef = useRef(files);
  const unsavedMapRef = useRef(unsavedMap);
  const autoSaveTimeoutRef = useRef(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    unsavedMapRef.current = unsavedMap;
  }, [unsavedMap]);

  // Direct persistence to backend database (Project & ProjectFile collections in MongoDB)
  const persistFilesToDatabase = useCallback(async (filesToSave, versionLabel = 'Code Workspace Auto-save') => {
    if (!effectiveProjectId || !filesToSave || filesToSave.length === 0) return;
    try {
      if (updateProject) {
        await updateProject(effectiveProjectId, { 
          files: filesToSave,
          versionLabel
        });
      } else {
        await projectService.updateProject(effectiveProjectId, { 
          files: filesToSave,
          versionLabel
        });
      }
    } catch (err) {
      console.warn('Primary updateProject failed, trying direct projectService.updateProject:', err);
      try {
        await projectService.updateProject(effectiveProjectId, { files: filesToSave });
      } catch (e2) {
        console.error('Failed to persist code to database:', e2);
      }
    }
  }, [effectiveProjectId, updateProject]);

  // Code editor text change
  const handleCodeChange = useCallback((newContent) => {
    if (!activeFilePath) return;
    setUnsavedMap((prev) => ({
      ...prev,
      [activeFilePath]: newContent
    }));
  }, [activeFilePath]);

  // Save changes for current active file or all files directly to database
  const handleSave = useCallback(async (targetFiles = null) => {
    const currentUnsaved = unsavedMapRef.current;
    const baseFiles = targetFiles || filesRef.current;
    const hasUnsaved = Object.keys(currentUnsaved).length > 0;

    if (!hasUnsaved && !targetFiles) return baseFiles;

    setIsSaving(true);
    let updatedFiles = baseFiles;
    if (hasUnsaved) {
      updatedFiles = baseFiles.map((file) => {
        if (currentUnsaved[file.path] !== undefined) {
          return { ...file, content: currentUnsaved[file.path] };
        }
        return file;
      });
    }

    setFiles(updatedFiles);
    setUnsavedMap({});
    updateProjectFiles(updatedFiles);

    if (onFilesChange) {
      onFilesChange(updatedFiles);
    }

    await persistFilesToDatabase(updatedFiles, 'Code Workspace Save');

    setTimeout(() => setIsSaving(false), 300);
    return updatedFiles;
  }, [persistFilesToDatabase, onFilesChange, updateProjectFiles]);

  // Handle active file selection
  const handleSelectFile = useCallback((path) => {
    setActiveFilePath(path);
    syncGlobalActiveFile?.(path);
    setOpenFilePaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, [syncGlobalActiveFile]);

  // Close tab (saves if dirty)
  const handleCloseTab = useCallback((path) => {
    if (unsavedMapRef.current && unsavedMapRef.current[path] !== undefined) {
      handleSave();
    }
    setOpenFilePaths((prev) => {
      const remaining = prev.filter((p) => p !== path);
      if (activeFilePath === path) {
        setActiveFilePath(remaining[remaining.length - 1] || '');
      }
      return remaining;
    });
  }, [activeFilePath, handleSave]);

  // Debounced auto-save: automatically persists changes to the database 1 second after user stops typing
  useEffect(() => {
    const hasUnsaved = Object.keys(unsavedMap).length > 0;
    if (!hasUnsaved) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [unsavedMap, handleSave]);

  // Unmount flush: immediately write any pending unsaved changes to the database when leaving
  useEffect(() => {
    return () => {
      const currentUnsaved = unsavedMapRef.current;
      const baseFiles = filesRef.current;
      if (Object.keys(currentUnsaved).length > 0 && effectiveProjectId) {
        const updatedFiles = baseFiles.map((file) => {
          if (currentUnsaved[file.path] !== undefined) {
            return { ...file, content: currentUnsaved[file.path] };
          }
          return file;
        });
        projectService.updateProject(effectiveProjectId, { 
          files: updatedFiles, 
          versionLabel: 'Code Workspace Auto-save' 
        }).catch(() => {});
      }
    };
  }, [effectiveProjectId]);

  // Export project as ZIP
  const handleExportZip = async () => {
    if (!effectiveProjectId) return;
    try {
      const res = await projectService.exportProject(effectiveProjectId);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${effectiveProjectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // Folder toggling
  const handleToggleFolder = useCallback((folderPath) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderPath]: !prev[folderPath]
    }));
  }, []);

  const handleCollapseAllFolders = useCallback(() => {
    setExpandedFolders({});
  }, []);

  // File CRUD operations
  const handleCreateFile = useCallback((filePath) => {
    if (!filePath) return;
    const cleanPath = filePath.replace(/^\/+/, '');
    if (files.some((f) => f.path === cleanPath)) {
      handleSelectFile(cleanPath);
      return;
    }

    const newFile = {
      path: cleanPath,
      content: `// ${cleanPath}\nimport React from 'react';\n\nexport default function ${
        cleanPath.split('/').pop().replace(/\.[^/.]+$/, '')
      }() {\n  return <div>New Component</div>;\n}\n`
    };

    const nextFiles = [...files, newFile];
    setFiles(nextFiles);
    updateProjectFiles(nextFiles);

    // Ensure parent folders are expanded
    const parts = cleanPath.split('/');
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join('/');
      setExpandedFolders((prev) => ({ ...prev, [parent]: true }));
    }

    handleSelectFile(cleanPath);
    if (onFilesChange) onFilesChange(nextFiles);
    persistFilesToDatabase(nextFiles, `Created ${cleanPath}`);
  }, [files, handleSelectFile, updateProjectFiles, onFilesChange, persistFilesToDatabase]);

  const handleCreateFolder = useCallback((folderPath) => {
    if (!folderPath) return;
    const cleanPath = folderPath.replace(/^\/+/, '');
    setExpandedFolders((prev) => ({
      ...prev,
      [cleanPath]: true
    }));
  }, []);

  const handleRenameNode = useCallback((node, newName) => {
    if (!node || !newName) return;
    const oldPath = node.path;
    const isFolder = node.type === 'folder';

    if (!isFolder) {
      const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newPath = dir ? `${dir}/${newName}` : newName;

      const nextFiles = files.map((f) => (f.path === oldPath ? { ...f, path: newPath } : f));
      setFiles(nextFiles);
      updateProjectFiles(nextFiles);

      // Update open tabs and active file
      setOpenFilePaths((prev) => prev.map((p) => (p === oldPath ? newPath : p)));
      if (activeFilePath === oldPath) setActiveFilePath(newPath);

      // Migrate unsaved map
      if (unsavedMap[oldPath] !== undefined) {
        setUnsavedMap((prev) => {
          const copy = { ...prev };
          copy[newPath] = copy[oldPath];
          delete copy[oldPath];
          return copy;
        });
      }

      if (onFilesChange) onFilesChange(nextFiles);
      persistFilesToDatabase(nextFiles, `Renamed ${oldPath} to ${newName}`);
    } else {
      const prefix = oldPath + '/';
      const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newFolderPrefix = (dir ? `${dir}/${newName}` : newName) + '/';

      const nextFiles = files.map((f) => {
        if (f.path.startsWith(prefix)) {
          return { ...f, path: f.path.replace(prefix, newFolderPrefix) };
        }
        return f;
      });
      setFiles(nextFiles);
      updateProjectFiles(nextFiles);
      if (onFilesChange) onFilesChange(nextFiles);
      persistFilesToDatabase(nextFiles, `Renamed folder ${oldPath} to ${newName}`);
    }
  }, [files, activeFilePath, unsavedMap, updateProjectFiles, onFilesChange, persistFilesToDatabase]);

  const handleDuplicateFile = useCallback((filePath) => {
    const original = files.find((f) => f.path === filePath);
    if (!original) return;

    const parts = filePath.split('.');
    const ext = parts.pop();
    const basePath = parts.join('.');
    const newPath = `${basePath}-copy.${ext}`;

    const newFile = {
      path: newPath,
      content: unsavedMap[filePath] !== undefined ? unsavedMap[filePath] : original.content
    };

    const nextFiles = [...files, newFile];
    setFiles(nextFiles);
    updateProjectFiles(nextFiles);
    handleSelectFile(newPath);
    if (onFilesChange) onFilesChange(nextFiles);
    persistFilesToDatabase(nextFiles, `Duplicated ${filePath}`);
  }, [files, unsavedMap, handleSelectFile, updateProjectFiles, onFilesChange, persistFilesToDatabase]);

  const handleDeleteNode = useCallback((node) => {
    if (!node) return;
    const isFolder = node.type === 'folder';
    let nextFiles = [];

    if (!isFolder) {
      nextFiles = files.filter((f) => f.path !== node.path);
      handleCloseTab(node.path);
    } else {
      const prefix = node.path + '/';
      nextFiles = files.filter((f) => f.path !== node.path && !f.path.startsWith(prefix));
      setOpenFilePaths((prev) => prev.filter((p) => !p.startsWith(prefix)));
      if (activeFilePath.startsWith(prefix)) {
        setActiveFilePath(nextFiles[0]?.path || '');
      }
    }

    setFiles(nextFiles);
    updateProjectFiles(nextFiles);
    if (onFilesChange) onFilesChange(nextFiles);
    persistFilesToDatabase(nextFiles, `Deleted ${node.path}`);
  }, [files, activeFilePath, handleCloseTab, updateProjectFiles, onFilesChange, persistFilesToDatabase]);

  const handleCopyPath = useCallback((filePath) => {
    navigator.clipboard.writeText(filePath);
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      // Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
      // Ctrl+P / Cmd+P
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  const isDirty = Object.keys(unsavedMap).length > 0;

  return (
    <div className={`flex flex-col ${embedded ? 'h-full w-full' : 'h-screen w-screen'} bg-[#FAFBFD] text-zinc-900 overflow-hidden select-none font-sans`}>
      {/* 1. TOP EDITOR TOOLBAR (Rendered only when standalone) */}
      {showToolbar && (
        <CodeToolbar
          projectName={effectiveProjectName}
          isDirty={isDirty}
          isSaving={isSaving}
          onBack={onBack || (() => navigate('/dashboard'))}
          onSwitchMode={onSwitchMode}
          onToggleAi={() => setIsAiOpen(!isAiOpen)}
          isAiOpen={isAiOpen}
          onShare={() => setIsShareModalOpen(true)}
          onSave={handleSave}
          onExport={handleExportZip}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />
      )}

      {/* 2. MIDDLE IDE WORKSPACE: FILE EXPLORER + CODE EDITOR AREA + OPTIONAL AI DRAWER */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative bg-[#FAFBFD]">
        {/* Left File Explorer */}
        <FileExplorer
          projectName={effectiveProjectName}
          files={files}
          activeFilePath={activeFilePath}
          unsavedMap={unsavedMap}
          expandedFolders={expandedFolders}
          onToggleFolder={handleToggleFolder}
          onCollapseAll={handleCollapseAllFolders}
          onSelectFile={handleSelectFile}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onRenameNode={handleRenameNode}
          onDuplicateFile={handleDuplicateFile}
          onDeleteNode={handleDeleteNode}
          onCopyPath={handleCopyPath}
        />

        {/* Center Code Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden relative">
          {/* File Tabs Strip */}
          <EditorTabs
            openFilePaths={openFilePaths}
            activeFilePath={activeFilePath}
            unsavedMap={unsavedMap}
            onSelectTab={handleSelectFile}
            onCloseTab={handleCloseTab}
            onToggleAi={() => setIsAiOpen(!isAiOpen)}
            isAiOpen={isAiOpen}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          />

          {/* Monaco Code Editor Canvas */}
          <div className="flex-1 min-h-0 relative bg-white">
            <CodeEditor
              activeFile={activeFilePath}
              content={currentFileContent}
              onChange={handleCodeChange}
              onSave={handleSave}
              onCursorChange={setCursorPos}
              onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            />
          </div>
        </div>

        {/* Right AI Coding Assistant Drawer */}
        <AIAssistant
          isOpen={isAiOpen}
          onClose={() => setIsAiOpen(false)}
          activeFilePath={activeFilePath}
          currentCode={currentFileContent}
          onApplyCode={(newCode) => {
            handleCodeChange(newCode);
            setTimeout(() => handleSave(), 50);
          }}
          projectId={effectiveProjectId}
        />
      </div>

      {/* 3. BOTTOM STATUS BAR */}
      <StatusBar
        activeFilePath={activeFilePath}
        isDirty={isDirty}
        isSaving={isSaving}
        cursorPos={cursorPos}
        onSave={handleSave}
      />

      {/* 4. QUICK FILE SEARCH COMMAND PALETTE (Ctrl+P) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        files={files}
        onSelectFile={handleSelectFile}
      />

      {/* 6. SHARE PROJECT MODAL */}
      {currentProject && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          project={currentProject}
        />
      )}
    </div>
  );
}

export default CodeWorkspace;
