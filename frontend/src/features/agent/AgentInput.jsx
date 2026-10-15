import { useState, useRef, useEffect } from 'react';
import { Paperclip, ArrowUp, Square, X } from 'lucide-react';
import { useAgentStore } from '../../store/agentStore';
import { useProjectStore } from '../../store/projectStore';
import { useVisualEditorStore } from '../visual-editor/visualEditorStore';
import { Button } from '../../components/ui/Button';

export function AgentInput() {
  const [input, setInput] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const { sendMessage, isGenerating, stopGeneration, planBuildMode, setPlanBuildMode, pendingApproval } = useAgentStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const selectedElement = useVisualEditorStore((s) => s.selectedElement);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Only images are supported');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target.result);
      // Optional: split base64 string to just get the data part if backend requires
      setImageBase64(event.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageBase64(null);
  };

  const handleSend = () => {
    if (!input.trim() && !imageBase64) return;
    if (!currentProject?._id) return;
    
    sendMessage(currentProject._id, input, imageBase64, selectedElement);
    setInput('');
    removeImage();
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating) {
        handleSend();
      }
    }
  };

  return (
    <div className="border-t border-zinc-200 p-3 bg-zinc-50/50 shrink-0">
      {imagePreview && (
        <div className="relative inline-block mb-3">
          <div className="h-16 w-16 rounded-lg overflow-hidden border border-zinc-300">
            <img src={imagePreview} alt="Upload preview" className="w-full h-full object-cover" />
          </div>
          <button
            onClick={removeImage}
            className="absolute -top-2 -right-2 bg-red-500 text-black rounded-full p-1 hover:bg-red-600 transition-colors shadow-sm"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="relative bg-zinc-50 border border-zinc-200 rounded-xl focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all shadow-sm">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={pendingApproval ? "Approve or cancel the plan above..." : isGenerating ? "AI is thinking..." : "Ask AI to modify your design..."}
          className="w-full bg-transparent border-0 resize-none px-3 py-3 text-sm text-zinc-900 placeholder:text-zinc-500 focus:ring-0 min-h-[44px] max-h-[120px] scrollbar-thin"
          rows={1}
          disabled={isGenerating}
        />
        
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-zinc-800"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={() => setPlanBuildMode(!planBuildMode)}
              disabled={isGenerating}
              title="Planner agent drafts a plan, you approve it, then the builder agent writes the code"
              className={"text-[11px] px-2 py-1 rounded-full border transition-colors " + (planBuildMode ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "border-zinc-200 text-zinc-500 hover:text-zinc-700")}
            >
              Plan &amp; Build
            </button>
          </div>

          <div>
            {isGenerating ? (
              <Button
                variant="danger"
                size="icon"
                className="h-8 w-8 rounded-full shadow-md"
                onClick={stopGeneration}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full shadow-md transition-transform active:scale-95"
                disabled={!input.trim() && !imageBase64}
                onClick={handleSend}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

