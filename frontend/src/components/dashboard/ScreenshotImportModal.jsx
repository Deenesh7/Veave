import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Image as ImageIcon, Loader2, Sparkles, CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import aiCreationService from '../../services/aiCreationService';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export default function ScreenshotImportModal({ isOpen, onClose, onGenerated }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleFileChange = (e) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(`Unsupported file type (${file.type || 'unknown'}). Please upload a PNG, JPG, JPEG, or WEBP image.`);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size exceeds 10MB. Please choose a smaller image.');
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setImageFile(null);
    setImagePreview('');
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleGenerate = async () => {
    if (!imagePreview) {
      setError('Please upload a screenshot first.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await aiCreationService.recreateScreenshot({
        image: imagePreview,
        prompt: prompt.trim() || 'Recreate screenshot layout with clean React and Tailwind',
        designSystem: 'Modern',
        model: 'Auto'
      });

      const data = res.data?.data || res.data;
      setResult(data);
      if (onGenerated && data.project) {
        onGenerated(data.project);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to analyze screenshot. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    handleClearImage();
    setPrompt('');
    setResult(null);
    setError('');
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      title="Recreate a Screenshot"
      description="Upload any UI mockup or screenshot to convert it into interactive React components."
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Upload State or Result State */}
        {!result ? (
          <>
            {/* Upload Area */}
            {!imagePreview ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-zinc-200 hover:border-[#52525B] rounded-2xl p-8 text-center cursor-pointer transition-colors bg-zinc-50/50 hover:bg-zinc-50/30 flex flex-col items-center justify-center space-y-2 group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 rounded-2xl bg-white border border-zinc-200 group-hover:border-[#52525B] text-zinc-400 group-hover:text-[#52525B] flex items-center justify-center shadow-2xs transition-colors">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-900">Click to upload screenshot</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Supports PNG, JPG, JPEG, or WEBP up to 10MB</p>
                </div>
              </div>
            ) : (
              <div className="relative rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-900 group">
                <img
                  src={imagePreview}
                  alt="Screenshot preview"
                  className="w-full max-h-56 object-contain mx-auto"
                />
                <button
                  type="button"
                  onClick={handleClearImage}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-black text-white transition-colors"
                  title="Remove image"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-xs text-[10px] text-white font-mono">
                  {imageFile?.name} ({(imageFile?.size / 1024).toFixed(1)} KB)
                </div>
              </div>
            )}

            {/* Optional Instruction Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-900 block">
                Additional Instructions (Optional)
              </label>
              <textarea
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Use dark navy background, make the navigation sticky, add a revenue bar chart..."
                className="w-full p-2.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 resize-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading || !imagePreview}
                className="px-5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing screenshot...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate UI</span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          /* Generated Result State */
          <div className="space-y-4 animate-in fade-in">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Screenshot synthesized into React components successfully!</span>
            </div>

            {Array.isArray(result.detectedComponents) && result.detectedComponents.length > 0 && (
              <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 space-y-2">
                <span className="text-xs font-bold text-zinc-900 block">Detected Structural Components:</span>
                <div className="flex flex-wrap gap-1.5">
                  {result.detectedComponents.map((comp) => (
                    <span key={comp} className="px-2 py-0.5 rounded-md bg-white border border-zinc-200 text-[11px] font-mono text-zinc-700">
                      {comp}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-zinc-700 transition-colors"
              >
                Re-upload
              </button>
              {result.project?._id && (
                <button
                  type="button"
                  onClick={() => navigate(`/editor/${result.project._id}`)}
                  className="px-5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-1.5 transition-colors"
                >
                  <span>Open in Code Editor</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
