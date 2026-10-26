import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { StudioTopBar } from './StudioTopBar';
import { StudioConversationPanel, GENERATION_TIMELINE_STEPS } from './StudioConversationPanel';
import { StudioProgressiveSkeleton } from './StudioProgressiveSkeleton';
import { StudioLivePreview } from './StudioLivePreview';
import { CodeWorkspace } from '../code-workspace/CodeWorkspace';
import { VersionHistory } from '../editor/VersionHistory';
import { VisualEditor } from '../visual-editor/VisualEditor';
import { useVisualEditorStore } from '../visual-editor/visualEditorStore';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useGenerationJobStore } from '../../store/generationJobStore';

export function StudioWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/dashboard');

  const { fetchProject, currentProject, setCurrentProject, updateProject } = useProjectStore();
  const { viewMode, setViewMode, previewSize, setPreviewSize, resetEditor, openFile, setActiveFile } = useEditorStore();

  const {
    startJob,
    cancelJob,
    isGenerating: jobIsGenerating,
    progress: jobProgress,
    step: jobStep,
    stepName: jobStepName,
    jobStatus,
    jobResult,
    error: jobError,
    validation: jobValidation,
    fetchConversation,
    undoLastChange,
    redoLastChange,
    rollbackToGeneration,
    conversationId
  } = useGenerationJobStore();

  const [localGenerating, setLocalGenerating] = useState(false);
  const [localStep, setLocalStep] = useState(0);
  const [localStatusMessage, setLocalStatusMessage] = useState('Understanding your idea...');

  const isGenerating = jobIsGenerating || localGenerating;
  const setIsGenerating = setLocalGenerating;
  const currentStep = jobIsGenerating
    ? Math.min(GENERATION_TIMELINE_STEPS.length - 1, Math.floor(((jobProgress || 10) / 100) * GENERATION_TIMELINE_STEPS.length))
    : localStep;
  const setCurrentStep = setLocalStep;
  const setStatusMessage = setLocalStatusMessage;

  const [generationPhase, setGenerationPhase] = useState(1);
  const [userPrompt, setUserPrompt] = useState('');
  const [isFeedOpen, setIsFeedOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [runtimeError, setRuntimeError] = useState(null);
  const runtimeErrorRef = useRef(null);
  const previewIdentity = JSON.stringify([id, previewKey, currentProject?.validation?.status, currentProject?.validation?.sourceHash, currentProject?.validation?.previewUrl, (currentProject?.files || []).map(({ path, content }) => ({ path, content }))]);
  const runtimeErrorMessage = runtimeError?.identity === previewIdentity ? runtimeError.message : '';
  const terminalJobError = jobError || (['failed', 'blocked'].includes(jobStatus) ? `Generation ${jobStatus}.` : '');
  const statusMessage = runtimeErrorMessage ? 'Preview runtime error. Review the error details.'
    : terminalJobError ? `Generation ${jobStatus === 'blocked' ? 'blocked' : 'failed'}. Review the error details.`
    : jobIsGenerating ? (jobStepName || 'AI Generation in progress...') : localStatusMessage;
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlMode = searchParams.get('mode');
  const isVisualEditorUrlMode = ['visual', 'editor', 'preview', 'screens', 'code'].includes(urlMode);
  const [visualEditorOpen, setVisualEditorOpen] = useState(
    isVisualEditorUrlMode || viewMode === 'visual'
  );
  const [isOpeningVisualEditor, setIsOpeningVisualEditor] = useState(false);

  const handleOpenVisualEditor = (requestedMode = 'editor') => {
    // Used directly as an onClick handler in places, which passes the click event; only a known mode name is accepted.
    const targetMode = ['editor', 'preview', 'screens', 'code'].includes(requestedMode) ? requestedMode : 'editor';
    if (useVisualEditorStore?.getState?.()?.setActiveMode) {
      useVisualEditorStore.getState().setActiveMode(targetMode);
    }
    setIsOpeningVisualEditor(true);
    setVisualEditorOpen(true);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', targetMode === 'editor' ? 'visual' : targetMode);
      window.history.replaceState(null, '', url.toString());
    } catch (e) {}
  };

  useEffect(() => {
    const handlePopState = () => {
      const mode = new URLSearchParams(window.location.search).get('mode');
      if (['visual', 'editor', 'preview', 'screens', 'code'].includes(mode)) {
        setVisualEditorOpen(true);
      } else {
        setVisualEditorOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const abortControllerRef = useRef(null);

  useEffect(() => {
    setCelebrationVisible(false);
  }, [previewIdentity, isGenerating, terminalJobError]);

  useEffect(() => {
    if (!celebrationVisible) return;
    const timer = setTimeout(() => setCelebrationVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [celebrationVisible]);

  // Load project on mount or parameter change
  useEffect(() => {
    if (id) {
      resetEditor();
      fetchProject(id)
        .then((project) => {
          if (project?.description) {
            setUserPrompt(project.description);
          }
          // If the project was just created and has files, show completed status
          setCurrentStep(GENERATION_TIMELINE_STEPS.length);
          setStatusMessage('Project loaded. Preparing preview...');
          if (project?.files && project.files.length > 0) {
            const defaultFile = project.files.find(f => f.path.endsWith('App.jsx')) || project.files[0];
            if (defaultFile) {
              setActiveFile(defaultFile.path);
              openFile(defaultFile);
            }
          }
        })
        .catch((err) => {
          console.error('Failed to load project in studio:', err);
        });

      // Fetch stateful conversation history & generation lineage from backend
      fetchConversation(id);
    }
  }, [id, fetchProject, resetEditor, fetchConversation]);

  // Rollback to previous version (Undo)
  const handleUndoLastChange = async () => {
    if (!id) return;
    // Immediately clear any celebration overlay from the previous generation
    // and show a lightweight loading state while the undo request runs.
    setCelebrationVisible(false);
    setLocalGenerating(true);
    setStatusMessage('Reverting to previous version...');
    try {
      const res = await undoLastChange(id);
      if (res?.project) {
        setCurrentProject(res.project);
        setPreviewKey((k) => k + 1);
        setStatusMessage('Reverted to previous version.');
      } else {
        setStatusMessage('Nothing to undo.');
      }
    } catch (e) {
      console.warn('Undo failed:', e);
      setStatusMessage('Undo failed. Please try again.');
    } finally {
      setLocalGenerating(false);
    }
  };

  // Roll forward to next version (Redo)
  const handleRedoLastChange = async () => {
    if (!id) return;
    setCelebrationVisible(false);
    setLocalGenerating(true);
    setStatusMessage('Restoring next version...');
    try {
      const res = await redoLastChange(id);
      if (res?.project) {
        setCurrentProject(res.project);
        setPreviewKey((k) => k + 1);
        setStatusMessage('Restored next version.');
      } else {
        setStatusMessage('Nothing to redo.');
      }
    } catch (e) {
      console.warn('Redo failed:', e);
      setStatusMessage('Redo failed. Please try again.');
    } finally {
      setLocalGenerating(false);
    }
  };

  // Rollback to a specific generation in history
  const handleRollbackGeneration = async (genId) => {
    if (!id || !genId) return;
    setCelebrationVisible(false);
    setLocalGenerating(true);
    setStatusMessage('Rolling back...');
    try {
      const res = await rollbackToGeneration(id, genId);
      if (res?.project) {
        setCurrentProject(res.project);
        setPreviewKey((k) => k + 1);
        setStatusMessage('Rolled back generation state.');
      } else {
        setStatusMessage('Rollback returned no project.');
      }
    } catch (e) {
      console.warn('Rollback failed:', e);
      setStatusMessage('Rollback failed. Please try again.');
    } finally {
      setLocalGenerating(false);
    }
  };

  // React to background job completion when inside the editor
  useEffect(() => {
    if (jobStatus === 'completed' && jobResult?.project) {
      const p = jobResult.project;
      if (p._id === id || !id) {
        fetchProject(p._id).then(() => {
          setPreviewKey((k) => k + 1);
          setStatusMessage('Generation saved. Preparing preview...');
          setCelebrationVisible(false);
        }).catch(() => setStatusMessage('Generation saved. Refresh to load the latest project.'));
      }
    }
  }, [jobStatus, jobResult, id, fetchProject]);

  // Check if there was a pending prompt passed via session / navigation state
  useEffect(() => {
    const pendingPrompt = sessionStorage.getItem('veave_pending_prompt');
    if (pendingPrompt && currentProject) {
      sessionStorage.removeItem('veave_pending_prompt');
      setUserPrompt(pendingPrompt);
      if (!jobIsGenerating) {
        setCurrentStep(GENERATION_TIMELINE_STEPS.length);
        setStatusMessage('Project loaded. Preparing preview...');
      }
    }
  }, [currentProject, jobIsGenerating]);

  const handleStopGeneration = async () => {
    const cancelled = await cancelJob();
    if (cancelled === false) return;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setLocalGenerating(false);
    setStatusMessage('Generation stopped by user.');
  };

  // Natural language modification submission (Voice or Text) using persistent job
  const handleModificationSubmit = async (modificationText, chosenModel = 'Gemini Flash 3.8', uploadedFiles = [], options = {}) => {
    if (!currentProject?._id || !modificationText.trim()) return;

    setCelebrationVisible(false);
    setStatusMessage(`Applying modification: "${modificationText.slice(0, 35)}..."`);

    try {
      const selectedElement = useVisualEditorStore.getState().selectedElement;
      // The part of the page the user selected is where an attached image goes, so the selection is always kept.
      const contextualSelection = selectedElement;
      await startJob({
        type: 'modify',
        projectId: currentProject._id,
        conversationId,
        prompt: modificationText.trim(),
        designSystem: currentProject.settings?.designSystem || 'Modern',
        model: chosenModel,
        uploadedFiles,
        viewingRoute: options?.viewingRoute,
        selectedElement: contextualSelection,
      });
    } catch (err) {
      console.error('Modification failed to start:', err);
      setStatusMessage('Failed to apply modification. Please try again.');
    }
  };

  const handlePreviewError = useCallback((previewError) => {
    if (previewError?.previewKey !== previewKey) return;
    const message = String(previewError?.message || 'Unknown preview runtime error');
    runtimeErrorRef.current = previewIdentity;
    setRuntimeError({ identity: previewIdentity, message });
    setCelebrationVisible(false);
    setStatusMessage('Preview runtime error. Review the error details.');
  }, [previewIdentity, previewKey]);

  const handlePreviewRendered = useCallback(() => {
    if (runtimeErrorRef.current === previewIdentity || terminalJobError || isGenerating) return;
    setStatusMessage('Preview rendered.');
    if (jobStatus === 'completed') setCelebrationVisible(true);
  }, [previewIdentity, terminalJobError, isGenerating, jobStatus]);

  const handleClarificationStyle = async (styleName) => {
    handleModificationSubmit(`Adopt a ${styleName.toLowerCase()} visual style with appropriate typography and spacing.`);
  };

  const handleDirectTextUpdate = async (oldText, newText) => {
    if (!currentProject?.files || !oldText || !newText || oldText === newText) return;
    const updatedFiles = currentProject.files.map((f) => {
      if (f.path.endsWith('App.jsx') && f.content && f.content.includes(oldText)) {
        return { ...f, content: f.content.replace(oldText, newText) };
      }
      return f;
    });
    try {
      if (updateProject && currentProject._id) {
        await updateProject(currentProject._id, { files: updatedFiles });
      }
      setCurrentProject({ ...currentProject, files: updatedFiles });
      setPreviewKey((k) => k + 1);
    } catch (e) {
      console.warn('Failed to persist direct text edit:', e);
    }
  };

  const handleVisualElementAiPrompt = (promptText) => {
    setUserPrompt(promptText);
    setIsFeedOpen(true);
  };

  const handleOpenFile = (filePath) => {
    if (!filePath) return;
    const file = currentProject?.files?.find((f) => f.path === filePath) || { path: filePath };
    setActiveFile(filePath);
    openFile(file);
    if (viewMode === 'preview') {
      setViewMode('split');
    }
  };

  const files = currentProject?.files || [];
  const tokensFile = files.find((f) => f.path.endsWith('tokens.json'));
  let tokens = null;
  try {
    if (tokensFile) tokens = JSON.parse(tokensFile.content);
  } catch (e) {}

  if (visualEditorOpen) {
    return (
      <VisualEditor
        project={currentProject}
        onBack={() => {
          setIsOpeningVisualEditor(false);
          setVisualEditorOpen(false);
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('mode');
            window.history.replaceState(null, '', url.toString());
          } catch (e) {}
          goBack();
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-white flex flex-col font-sans">
      {/* 1. Main Studio Top Bar */}
      <StudioTopBar
        previewSize={previewSize}
        setPreviewSize={setPreviewSize}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onRefresh={() => setPreviewKey((k) => k + 1)}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenVisualEdit={handleOpenVisualEditor}
        isOpeningVisualEditor={isOpeningVisualEditor}
        isGenerating={isGenerating}
      />

      {(runtimeErrorMessage || terminalJobError) && (
        <section aria-label="Studio validation and errors" className="shrink-0 max-h-52 overflow-auto border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs select-text">
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            {terminalJobError && <><p className="font-semibold">Generation {jobStatus === 'blocked' ? 'blocked' : 'failed'}</p><pre className="whitespace-pre-wrap break-words font-mono mt-1">{typeof terminalJobError === 'string' ? terminalJobError : JSON.stringify(terminalJobError, null, 2)}</pre></>}
            {runtimeErrorMessage && <><p className="font-semibold mt-1">Preview runtime error</p><pre className="whitespace-pre-wrap break-words font-mono mt-1">{runtimeErrorMessage}</pre></>}
          </div>
        </section>
      )}

      {/* 2. Middle Content Area: Canvas on Left/Center + Prompt Agent Panel on Right */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Central Workspace Canvas */}
        <div className="flex-1 flex overflow-hidden min-w-0 bg-[#FAFBFD] relative">
          {/* Progressive Skeleton when actively generating new layout */}
          {isGenerating && files.length === 0 ? (
            <StudioProgressiveSkeleton
              phase={generationPhase}
              currentStepName={statusMessage}
            />
          ) : viewMode === 'split' ? (
            <div className="flex-1 flex h-full overflow-hidden">
              <div className="flex-1 h-full min-w-0">
                <StudioLivePreview
                  files={files}
                  validation={currentProject?.validation}
                  previewSize={previewSize}
                  onTextUpdate={handleDirectTextUpdate}
                  onAskAiForElement={handleVisualElementAiPrompt}
                  onOpenVisualEdit={handleOpenVisualEditor}
                  onPreviewError={handlePreviewError}
                  onPreviewRendered={handlePreviewRendered}
                  isOpeningVisualEditor={isOpeningVisualEditor}
                  isGenerating={isGenerating}
                  previewKey={previewKey}
                  projectId={currentProject?._id}
                  inspectionEnabled={true}
                />
              </div>
              <div className="w-1 bg-zinc-200 cursor-col-resize shrink-0" />
              <div className="flex-1 flex h-full min-w-0 bg-white overflow-hidden">
                <CodeWorkspace
                  showToolbar={false}
                  embedded={true}
                  projectId={currentProject?._id || id}
                  project={currentProject}
                  onBack={() => setViewMode('preview')}
                  onSwitchMode={(mode) => {
                    if (mode === 'editor') handleOpenVisualEditor();
                    else setViewMode(mode);
                  }}
                  initialFiles={files}
                  projectName={currentProject?.name}
                  onFilesChange={(newFiles) => {
                    if (setCurrentProject && currentProject) {
                      setCurrentProject({ ...currentProject, files: newFiles });
                    }
                  }}
                />
              </div>
            </div>
          ) : viewMode === 'code' ? (
            <div className="flex-1 h-full min-w-0 bg-[#FAFBFD] overflow-hidden">
              <CodeWorkspace
                showToolbar={false}
                embedded={true}
                projectId={currentProject?._id || id}
                project={currentProject}
                onBack={() => setViewMode('preview')}
                onSwitchMode={(mode) => {
                  if (mode === 'editor' || mode === 'screens') {
                    handleOpenVisualEditor(mode);
                  } else {
                    setViewMode(mode);
                  }
                }}
                initialFiles={files}
                projectName={currentProject?.name}
                onFilesChange={(newFiles) => {
                  if (setCurrentProject && currentProject) {
                    setCurrentProject({ ...currentProject, files: newFiles });
                  }
                }}
              />
            </div>
          ) : (
            <div className="flex-1 h-full min-w-0">
              <StudioLivePreview
                files={files}
                validation={currentProject?.validation}
                previewSize={previewSize}
                onTextUpdate={handleDirectTextUpdate}
                onAskAiForElement={handleVisualElementAiPrompt}
                onOpenVisualEdit={handleOpenVisualEditor}
                onPreviewError={handlePreviewError}
                onPreviewRendered={handlePreviewRendered}
                isOpeningVisualEditor={isOpeningVisualEditor}
                isGenerating={isGenerating}
                previewKey={previewKey}
                projectId={currentProject?._id}
                inspectionEnabled={false}
              />
            </div>
          )}

          {/* Celebration Toast when Generation Completes */}
          {celebrationVisible && !runtimeErrorMessage && !terminalJobError && !isGenerating && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 text-white px-5 py-2.5 rounded-full shadow-2xl border border-white/20 flex items-center gap-2.5 text-xs font-bold animate-in fade-in zoom-in-95 duration-300">
              <span className="text-base">🎉</span>
              <span>Your interface is ready. Try scrolling and clicking components!</span>
            </div>
          )}
        </div>

        {/* Right AI Designer & Prompt Agent Panel (Conversation Feed + Integrated Prompt Bar) */}
        <StudioConversationPanel
          prompt={userPrompt}
          isGenerating={isGenerating}
          currentStep={currentStep}
          statusMessage={statusMessage}
          onSelectClarification={handleClarificationStyle}
          components={files.filter((f) => f.path.endsWith('.jsx'))}
          files={files}
          tokens={tokens}
          isOpen={isFeedOpen}
          setIsOpen={setIsFeedOpen}
          onSubmitPrompt={handleModificationSubmit}
          onStopGeneration={handleStopGeneration}
          onUndo={handleUndoLastChange}
          onRedo={handleRedoLastChange}
          onRollback={handleRollbackGeneration}
          onOpenFile={handleOpenFile}
        />
      </div>

      {/* Version History Modal */}
      {currentProject?._id && (
        <VersionHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={currentProject._id}
        />
      )}
    </div>
  );
}

export default StudioWorkspace;
