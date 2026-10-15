import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Slash, 
  Mic, 
  ArrowUp, 
  X,
  AlertCircle,
  Loader2,
  Github,
  Component as ComponentIcon,
  GitBranch,
  Sparkles
} from 'lucide-react';
import PromptInput from './PromptInput';
import DesignSystemSelector from './DesignSystemSelector';
import ModelSelector from './ModelSelector';
import CommandMenu, { COMMANDS } from './CommandMenu';
import GenerationLoader from './GenerationLoader';
import GeneratedDesignPreview from './GeneratedDesignPreview';
import ActionMenu from './ActionMenu';
import AddComponentModal from './AddComponentModal';
import ConnectGitHubModal from './ConnectGitHubModal';
import ConnectorsModal from './ConnectorsModal';
import SkillsModal from './SkillsModal';
import UploadedFileBadge from './UploadedFileBadge';
import aiCreationService from '../../services/aiCreationService';
import { useProjectStore } from '../../store/projectStore';
import { useGenerationJobStore } from '../../store/generationJobStore';
import { MatrixOrb } from '../rare-ui';
import { WhisperAudioRecorder } from '../../utils/whisperAudioRecorder';

const GENERATION_STEPS = [
  'Analyzing prompt specifications...',
  'Injecting design system tokens...',
  'Scaffolding React components with Tailwind...',
  'Compiling interactive prototype...',
];

export default function AIComposer({ prompt, setPrompt, onGenerated }) {
  const navigate = useNavigate();
  const { fetchProjects } = useProjectStore();

  const [designSystem, setDesignSystem] = useState('Modern');
  const [selectedPalette, setSelectedPalette] = useState(null);
  const [model, setModel] = useState('Gemini Flash 3.8');
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [commandSearchQuery, setCommandSearchQuery] = useState('');
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [activeCommand, setActiveCommand] = useState(null);
  const [activeCommandType, setActiveCommandType] = useState(null);

  const composerCardRef = useRef(null);
  const promptInputRef = useRef(null);
  const inputContainerRef = useRef(null);

  const [isListening, setIsListening] = useState(false);
  const [localError, setLocalError] = useState(null);

  // Persistent Generation Job Store hooks
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
    resetJob
  } = useGenerationJobStore();

  const isGenerating = jobIsGenerating;
  const generationStep = jobStep;
  const error = jobError || localError;

  // Result preview modal
  const [generatedData, setGeneratedData] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Automatically navigate or show preview when background job completes
  useEffect(() => {
    if (jobStatus === 'completed' && jobResult) {
      const targetProject = jobResult.project;
      if (targetProject?._id) {
        sessionStorage.setItem('veave_pending_prompt', prompt.trim());
        navigate(`/editor/${targetProject._id}`);
      } else {
        setGeneratedData(jobResult);
        setIsPreviewOpen(true);
      }

      if (fetchProjects) {
        fetchProjects();
      }
      if (onGenerated && targetProject) {
        onGenerated(targetProject);
      }
    }
  }, [jobStatus, jobResult]);

  // Action Menu Modals & Context States
  const [isAddComponentOpen, setIsAddComponentOpen] = useState(false);
  const [isConnectGitHubOpen, setIsConnectGitHubOpen] = useState(false);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [connectedGitHub, setConnectedGitHub] = useState(null);
  const [activeSkills, setActiveSkills] = useState([]);

  const handleUploadFile = (fileData) => {
    setUploadedFiles((prev) => [...prev, fileData]);
    // Also persist into workspace uploaded files for FilesPage
    try {
      const existing = JSON.parse(localStorage.getItem('veave_uploaded_files') || '[]');
      const updated = [
        {
          name: fileData.name,
          size: fileData.size,
          type: fileData.type,
          uploadedAt: new Date().toISOString()
        },
        ...existing.filter((f) => f.name !== fileData.name)
      ];
      localStorage.setItem('veave_uploaded_files', JSON.stringify(updated.slice(0, 50)));
    } catch (e) {
      console.warn('Could not cache uploaded file:', e);
    }
  };

  const handleRemoveFile = (fileId) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId && f.name !== fileId));
  };

  const handleSelectComponent = (comp) => {
    setSelectedComponent(comp);
    if (comp?.promptSpec) {
      setPrompt((prev) => {
        if (!prev.trim()) return comp.promptSpec;
        if (prev.includes(comp.name)) return prev;
        return `${prev.trim()} [Include: ${comp.name}]`;
      });
    }
  };

  // Filter commands by search query
  const filteredCommands = useMemo(() => {
    const q = (commandSearchQuery || '').trim().toLowerCase().replace(/^\//, '');
    if (!q) return COMMANDS;
    return COMMANDS.filter(cmd => 
      cmd.name.toLowerCase().includes(q) ||
      cmd.command.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );
  }, [commandSearchQuery]);

  const handlePromptChange = (val) => {
    setPrompt(val);

    // Detect if user is typing a slash command (e.g. "/" or "/d" or "create a /d")
    const match = val.match(/(?:\s|^)\/([a-zA-Z]*)$/);
    if (match) {
      setIsCommandMenuOpen(true);
      setCommandSearchQuery(match[1]);
      setCommandSelectedIndex(0);
    } else if (isCommandMenuOpen && !val.includes('/')) {
      setIsCommandMenuOpen(false);
      setCommandSearchQuery('');
    }
  };

  const handleInputKeyDown = (e) => {
    if (!isCommandMenuOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        setCommandSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        setCommandSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filteredCommands.length > 0) {
        e.preventDefault();
        const selected = filteredCommands[commandSelectedIndex] || filteredCommands[0];
        handleSelectCommand(selected);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsCommandMenuOpen(false);
    }
  };

  const handleSelectCommand = (cmd) => {
    const cmdStr = typeof cmd === 'object' ? cmd.command : cmd;
    const cmdType = typeof cmd === 'object' ? cmd.type : null;

    let newPrompt = prompt;
    if (/(?:\s|^)\/([a-zA-Z]*)$/.test(prompt)) {
      newPrompt = prompt.replace(/(?:\s|^)\/([a-zA-Z]*)$/, (match) => {
        const prefix = match.startsWith(' ') ? ' ' : '';
        return `${prefix}${cmdStr} `;
      });
    } else if (!prompt.trim()) {
      newPrompt = `${cmdStr} `;
    } else {
      newPrompt = `${prompt.trim()} ${cmdStr} `;
    }

    setPrompt(newPrompt);
    setActiveCommand(cmdStr);
    setActiveCommandType(cmdType);
    setIsCommandMenuOpen(false);
    setCommandSearchQuery('');

    // Keep cursor active in textarea right after inserted command
    setTimeout(() => {
      if (promptInputRef.current) {
        promptInputRef.current.focus();
        const len = newPrompt.length;
        promptInputRef.current.setSelectionRange(len, len);
      }
    }, 10);
  };

  // Open-Source Whisper Voice Message State (Zero API Key)
  const [isTranscribing, setIsTranscribing] = useState(false);
  const whisperRecorderRef = useRef(null);
  const speechRecRef = useRef(null);

  const startWhisperRecording = async () => {
    try {
      const recorder = new WhisperAudioRecorder();
      whisperRecorderRef.current = recorder;
      await recorder.start();
      setIsListening(true);

      // Live spoken preview via browser Web Speech API
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (evt) => {
            let current = '';
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              current += evt.results[i][0].transcript;
            }
          };
          rec.start();
          speechRecRef.current = rec;
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      // Client-side speech recognition fallback
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.lang = 'en-US';
          recognition.onstart = () => setIsListening(true);
          recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
            setIsListening(false);
          };
          recognition.onerror = () => setIsListening(false);
          recognition.onend = () => setIsListening(false);
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(true);
        setTimeout(() => {
          setPrompt((p) => p || 'Build an analytics dashboard with real-time stats and user activity table.');
          setIsListening(false);
        }, 800);
      }
    }
  };

  const stopWhisperRecording = async () => {
    setIsListening(false);
    if (speechRecRef.current) {
      try { speechRecRef.current.stop(); } catch (e) {}
      speechRecRef.current = null;
    }

    if (whisperRecorderRef.current) {
      setIsTranscribing(true);
      try {
        const wavBlob = await whisperRecorderRef.current.stop();
        whisperRecorderRef.current = null;

        if (wavBlob && wavBlob.size > 0) {
          const formData = new FormData();
          formData.append('audio', wavBlob, 'voice_prompt.wav');
          const res = await aiCreationService.transcribeWhisper(formData);
          if (res.data?.success && res.data.text) {
            const transcribed = res.data.text.trim();
            setPrompt((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
          }
        }
      } catch (err) {
        console.warn('Open Whisper transcription failed:', err);
      } finally {
        setIsTranscribing(false);
      }
    }
  };

  const handleMicToggle = () => {
    if (isListening) {
      stopWhisperRecording();
    } else {
      startWhisperRecording();
    }
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isGenerating) return;

    setLocalError(null);

    try {
      const detectedCommand = activeCommand || prompt.match(/(?:^|\s)\/(ask|plan|inspiration|debug|polish)\b/i)?.[0]?.trim().toLowerCase() || null;

      // Build contextual prompt with attached files, component, and github repo
      let enrichedPrompt = prompt.trim();
      if (selectedComponent && !enrichedPrompt.includes(selectedComponent.name)) {
        enrichedPrompt += ` [Include Component: ${selectedComponent.name}]`;
      }
      if (connectedGitHub) {
        enrichedPrompt += ` [Reference GitHub: ${connectedGitHub.fullName} (${connectedGitHub.selectedBranch || 'main'})]`;
      }
      if (uploadedFiles.length > 0) {
        const fileNames = uploadedFiles.map(f => f.name).join(', ');
        enrichedPrompt += ` [Context Files Attached: ${fileNames}]`;
      }

      const screenshotFile = uploadedFiles.find(f => f.isImage || f.type?.startsWith('image/'));
      const isScreenshot = !!screenshotFile;

      await startJob({
        type: isScreenshot ? 'screenshot' : 'generate',
        prompt: enrichedPrompt,
        command: detectedCommand,
        designSystem,
        paletteId: selectedPalette?._id || null,
        customTokens: selectedPalette || null,
        model,
        image: screenshotFile?.dataUrl || null,
        uploadedFiles: uploadedFiles.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
          isImage: f.isImage,
          dataUrl: f.dataUrl,
          content: f.content
        })),
        activeSkills: activeSkills.map(s => s.name),
        githubRepo: connectedGitHub ? { repo: connectedGitHub.fullName, branch: connectedGitHub.selectedBranch } : null
      });
    } catch (err) {
      setLocalError(
        err.response?.data?.error ||
        err.message ||
        'Failed to start generation. Please try again.'
      );
    }
  };

  return (
    <>
      <div 
        ref={composerCardRef}
        className={`w-full max-w-[620px] mx-auto bg-white rounded-xl sm:rounded-2xl border border-[#E2E5E8] shadow-[0_4px_20px_rgba(0,0,0,0.03)] focus-within:border-[#52525B] focus-within:ring-2 focus-within:ring-zinc-100 transition-all p-3 sm:p-4 flex flex-col justify-between relative ${isGenerating ? 'min-h-[280px]' : 'min-h-[116px]'}`}
      >
        {/* Animated Generation Loader Overlay */}
        <GenerationLoader
          isGenerating={isGenerating}
          steps={GENERATION_STEPS}
          currentStep={generationStep}
          statusMessage={jobStepName}
          progress={jobProgress}
          onCancel={() => cancelJob()}
        />

        {/* Floating CommandMenu anchored to composer card so it never hides toolbar buttons */}
        <CommandMenu
          isOpen={isCommandMenuOpen}
          onClose={() => setIsCommandMenuOpen(false)}
          onSelectCommand={handleSelectCommand}
          searchQuery={commandSearchQuery}
          selectedIndex={commandSelectedIndex}
          onHighlightIndex={setCommandSelectedIndex}
          anchorRef={composerCardRef}
        />

        {/* Textarea Input */}
        <div className="relative flex-1 mb-2" ref={inputContainerRef}>
          <PromptInput
            ref={promptInputRef}
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleInputKeyDown}
            onSubmit={handleSubmit}
            placeholder="Ask Veave to build anything, or type / for commands..."
          />
        </div>


        {/* Voice Transcribing with OpenAI Whisper Banner */}
        {isTranscribing && (
          <div className="mb-2.5 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-center gap-2.5 animate-in fade-in">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
            <span className="font-semibold">Transcribing voice message with OpenAI Whisper...</span>
          </div>
        )}

        {/* Voice Listening Matrix Orb Banner */}
        {isListening && (
          <div className="mb-2.5 px-3 py-2 rounded-xl bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs flex items-center gap-2.5 animate-in fade-in">
            <MatrixOrb state="listening" size={20} dots={7} color="#18181B" />
            <span className="font-semibold">Recording voice message for Whisper... Click mic when done</span>
          </div>
        )}

        {/* Error message banner */}
        {error && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-700 ml-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attached Context Strip: Uploaded Files, Component, GitHub Repo, Active Skills */}
        {(uploadedFiles.length > 0 || selectedComponent || connectedGitHub || activeSkills.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2 px-1 select-none animate-in fade-in">
            {/* Uploaded Files */}
            {uploadedFiles.map((file) => (
              <UploadedFileBadge
                key={file.id}
                file={file}
                onRemove={handleRemoveFile}
              />
            ))}

            {/* Selected Component Context */}
            {selectedComponent && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 shadow-2xs">
                <ComponentIcon className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                <span className="font-semibold text-[11px] truncate max-w-[150px]">
                  {selectedComponent.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedComponent(null)}
                  className="text-purple-400 hover:text-purple-700 p-0.5 rounded-full cursor-pointer"
                  title="Remove component context"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Connected GitHub Context */}
            {connectedGitHub && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900 text-white text-xs shadow-2xs">
                <Github className="w-3.5 h-3.5 shrink-0 text-white" />
                <span className="font-semibold text-[11px] font-mono truncate max-w-[140px]">
                  {connectedGitHub.name}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-0.5">
                  <GitBranch className="w-2.5 h-2.5" />
                  {connectedGitHub.selectedBranch || 'main'}
                </span>
                <button
                  type="button"
                  onClick={() => setConnectedGitHub(null)}
                  className="text-zinc-400 hover:text-white p-0.5 rounded-full cursor-pointer"
                  title="Detach repository"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Active Skills Indicator */}
            {activeSkills.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSkillsOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-50 border border-zinc-200/80 text-zinc-700 text-[10px] font-semibold hover:bg-zinc-100/70 transition-colors cursor-pointer"
                title="Manage active skills"
              >
                <Sparkles className="w-2.5 h-2.5 text-zinc-600" />
                <span>{activeSkills.length} skill{activeSkills.length > 1 ? 's' : ''} active</span>
              </button>
            )}
          </div>
        )}

        {/* Bottom Control Bar: All in 1 sleek line */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 select-none flex-nowrap">
          {/* Left Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Compact Action Menu (+ button with clean floating dropdown) */}
            <ActionMenu
              onUploadFile={handleUploadFile}
              onOpenAddComponent={() => setIsAddComponentOpen(true)}
              onOpenConnectGitHub={() => setIsConnectGitHubOpen(true)}
              onOpenConnectors={() => setIsConnectorsOpen(true)}
              onOpenSkills={() => setIsSkillsOpen(true)}
            />

            {/* Slash command toggle button */}
            <button
              type="button"
              data-command-toggle="true"
              title="Slash Commands (/)"
              onClick={() => {
                setIsCommandMenuOpen((prev) => !prev);
                if (!isCommandMenuOpen) {
                  promptInputRef.current?.focus();
                }
              }}
              className={`p-1.5 rounded-lg transition-colors font-mono text-xs font-bold cursor-pointer ${
                isCommandMenuOpen
                  ? 'bg-zinc-50 text-[#52525B]'
                  : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              <Slash className="w-3.5 h-3.5" />
            </button>

            {/* Functional Design System Selector Dropdown */}
            <DesignSystemSelector
              selected={designSystem}
              onSelect={(dsId, paletteObj) => {
                setDesignSystem(dsId);
                setSelectedPalette(paletteObj);
              }}
            />
          </div>

          {/* Right Controls: Model, Mic, Up Arrow - all in 1 line */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Functional AI Model Selector Dropdown */}
            <ModelSelector
              selectedModel={model}
              onSelectModel={setModel}
            />

            {/* Voice Input Microphone (OpenAI Whisper) */}
            <button
              type="button"
              disabled={isTranscribing}
              onClick={handleMicToggle}
              title={
                isTranscribing
                  ? 'Transcribing with OpenAI Whisper...'
                  : isListening
                  ? 'Click to stop and transcribe voice message'
                  : 'Record voice message (OpenAI Whisper)'
              }
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isTranscribing
                  ? 'text-indigo-600 bg-indigo-50 animate-pulse'
                  : isListening
                  ? 'text-red-500 bg-red-50 animate-pulse'
                  : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            {/* Circular Submit Button */}
            <button
              type="button"
              disabled={!prompt.trim() || isGenerating}
              onClick={handleSubmit}
              aria-label="Generate prototype"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-xs active:scale-90 ${
                prompt.trim() && !isGenerating
                  ? 'bg-zinc-900 hover:bg-black text-white cursor-pointer'
                  : 'bg-zinc-100 text-zinc-300 cursor-not-allowed'
              }`}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Generated Design Live Result Modal */}
      <GeneratedDesignPreview
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        generatedData={generatedData}
      />

      {/* Action Modals */}
      <AddComponentModal
        isOpen={isAddComponentOpen}
        onClose={() => setIsAddComponentOpen(false)}
        onSelectComponent={handleSelectComponent}
      />

      <ConnectGitHubModal
        isOpen={isConnectGitHubOpen}
        onClose={() => setIsConnectGitHubOpen(false)}
        connectedRepo={connectedGitHub}
        onConnectRepo={(repo) => setConnectedGitHub(repo)}
        onDisconnectRepo={() => setConnectedGitHub(null)}
      />

      <ConnectorsModal
        isOpen={isConnectorsOpen}
        onClose={() => setIsConnectorsOpen(false)}
      />

      <SkillsModal
        isOpen={isSkillsOpen}
        onClose={() => setIsSkillsOpen(false)}
        onSkillsChange={setActiveSkills}
      />
    </>
  );
}
