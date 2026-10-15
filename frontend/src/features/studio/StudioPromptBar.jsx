import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowUp, 
  Mic, 
  MicOff, 
  Square, 
  Paperclip, 
  Loader2,
  X
} from 'lucide-react';
import aiCreationService from '../../services/aiCreationService';
import { WhisperAudioRecorder } from '../../utils/whisperAudioRecorder';
import ActionMenu from '../../components/dashboard/ActionMenu';
import AddComponentModal from '../../components/dashboard/AddComponentModal';
import ConnectGitHubModal from '../../components/dashboard/ConnectGitHubModal';
import ConnectorsModal from '../../components/dashboard/ConnectorsModal';
import SkillsModal from '../../components/dashboard/SkillsModal';

export function StudioPromptBar({
  onSubmit,
  isGenerating,
  onStop
}) {
  const [promptText, setPromptText] = useState('');
  const [model, setModel] = useState('Gemini Flash 3.8');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef(null);
  const whisperRecorderRef = useRef(null);
  const speechRecRef = useRef(null);

  // Action Menu Modals & Context States
  const [isAddComponentOpen, setIsAddComponentOpen] = useState(false);
  const [isConnectGitHubOpen, setIsConnectGitHubOpen] = useState(false);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [connectedGitHub, setConnectedGitHub] = useState(null);

  const handleUploadFile = (fileData) => {
    setUploadedFiles((prev) => [...prev, fileData]);
    const uploadInstruction = fileData.isImage || fileData.type?.startsWith('image/')
      ? `Replace the most relevant existing image with uploaded image ${fileData.name}, preserving the current layout and behavior.`
      : `Incorporate uploaded file ${fileData.name}`;
    setPromptText((p) => p ? `${p} [Uploaded: ${fileData.name}]` : uploadInstruction);
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
    } catch (e) {}
  };

  const handleSelectComponent = (comp) => {
    if (comp?.promptSpec) {
      setPromptText((p) => p ? `${p} [Insert: ${comp.name}]` : comp.promptSpec);
    }
  };


  const startWhisperRecording = async () => {
    try {
      const recorder = new WhisperAudioRecorder();
      whisperRecorderRef.current = recorder;
      await recorder.start();
      setIsListening(true);

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (evt) => {
            let tr = '';
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              tr += evt.results[i][0].transcript;
            }
          };
          rec.start();
          speechRecRef.current = rec;
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Mic access error, falling back:', err);
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = false;
          rec.lang = 'en-US';
          rec.onstart = () => setIsListening(true);
          rec.onresult = (evt) => {
            const tr = evt.results[0][0].transcript;
            setPromptText((p) => (p ? `${p} ${tr}` : tr));
            setIsListening(false);
          };
          rec.onerror = () => setIsListening(false);
          rec.onend = () => setIsListening(false);
          rec.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(true);
        setTimeout(() => {
          setPromptText('Make the homepage more modern with clean spacing.');
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
          formData.append('audio', wavBlob, 'studio_voice.wav');
          const res = await aiCreationService.transcribeWhisper(formData);
          if (res.data?.success && res.data.text) {
            const transcribed = res.data.text.trim();
            setPromptText((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
          }
        }
      } catch (err) {
        console.warn('Studio Whisper transcription error:', err);
      } finally {
        setIsTranscribing(false);
      }
    }
  };

  const toggleMic = () => {
    if (isListening) {
      stopWhisperRecording();
    } else {
      startWhisperRecording();
    }
  };

  // Auto-grow textarea height based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(180, Math.max(38, scrollHeight))}px`;
    }
  }, [promptText]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent?.isComposing) return;
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!promptText.trim() || isGenerating) return;
    const textToSend = promptText.trim();
    try {
      const attachments = uploadedFiles.map(({ name, size, type, dataUrl, content, isImage }) => ({
        name, size, type, dataUrl, content, isImage
      }));
      const res = onSubmit(textToSend, model, attachments);
      if (res && typeof res.catch === 'function') {
        res.catch((err) => console.warn('Submit prompt error:', err));
      }
    } catch (err) {
      console.warn('Submit prompt error:', err);
    }
    setPromptText('');
    setUploadedFiles([]);
  };

  return (
    <div className="w-full bg-white border-t border-[#E2E5E8] p-3 shrink-0 z-30 shadow-[0_-4px_16px_rgba(0,0,0,0.03)]">
      {/* Input Bar Card: Multiline card with full-width textarea and bottom toolbar */}
      <div className="relative bg-white rounded-2xl border border-zinc-300 focus-within:border-zinc-500 focus-within:ring-3 focus-within:ring-zinc-100 transition-all p-2.5 shadow-xs flex flex-col gap-2">
        {/* Uploaded Files Badges */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-0.5">
            {uploadedFiles.map((file, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 border border-zinc-200 text-zinc-700 text-[10px] font-medium shrink-0"
              >
                <Paperclip className="w-2.5 h-2.5 text-zinc-400" />
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setUploadedFiles((prev) => prev.filter((_, i) => i !== idx))}
                  className="hover:text-zinc-900 cursor-pointer ml-0.5"
                  title="Remove attachment"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Multiline Prompt Textarea */}
        <textarea
          ref={textareaRef}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what to change... (Shift + Enter for new line)"
          rows={1}
          className="w-full min-h-[38px] max-h-40 bg-transparent text-xs sm:text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none resize-none leading-relaxed px-1 overflow-y-auto scrollbar-thin"
        />

        {/* Bottom Toolbar: Left actions + Right controls */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-zinc-100">
          {/* Left: Action Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            <ActionMenu
              onUploadFile={handleUploadFile}
              onOpenAddComponent={() => setIsAddComponentOpen(true)}
              onOpenConnectGitHub={() => setIsConnectGitHubOpen(true)}
              onOpenConnectors={() => setIsConnectorsOpen(true)}
              onOpenSkills={() => setIsSkillsOpen(true)}
            />
          </div>

          {/* Right: Mic, Stop, Send */}
          <div className="flex items-center gap-1.5 shrink-0">

              {/* Voice-to-Text Microphone Button (OpenAI Whisper) */}
              <button
                type="button"
                disabled={isTranscribing}
                onClick={toggleMic}
                className={`p-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                  isTranscribing
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse'
                    : isListening 
                    ? 'bg-rose-500 text-white shadow-md animate-pulse' 
                    : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                }`}
                title={
                  isTranscribing
                    ? 'Transcribing with OpenAI Whisper...'
                    : isListening
                    ? 'Click to stop and transcribe voice message'
                    : 'Record voice message (OpenAI Whisper)'
                }
              >
                {isTranscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                ) : isListening ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>

              {/* Stop Generation Button */}
              {isGenerating && (
                <button
                  type="button"
                  onClick={onStop}
                  className="px-2.5 py-1 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Square className="w-3 h-3 fill-zinc-700" />
                  <span>Stop</span>
                </button>
              )}

              {/* Up Arrow Send Button */}
              <button
                type="button"
                onClick={handleSend}
                disabled={!promptText.trim() || isGenerating}
                className="w-8 h-8 rounded-xl bg-zinc-900 hover:bg-black text-white flex items-center justify-center transition-all disabled:opacity-40 disabled:hover:bg-zinc-900 shadow-xs active:scale-95 cursor-pointer shrink-0"
                title="Send modification request"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

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
      />
    </div>
  );
}
