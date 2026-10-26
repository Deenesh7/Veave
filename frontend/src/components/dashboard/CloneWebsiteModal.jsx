import React, { useState } from 'react';
import { Globe2, Loader2 } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { useGenerationJobStore } from '../../store/generationJobStore';

export default function CloneWebsiteModal({ isOpen, onClose }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const { startJob, isGenerating } = useGenerationJobStore();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    let parsed;
    try {
      parsed = new URL(sourceUrl.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    } catch {
      setError('Enter a public HTTP or HTTPS website URL without credentials.');
      return;
    }

    try {
      await startJob({
        type: 'clone',
        sourceUrl: parsed.href,
        prompt: instructions.trim() || 'Recreate this website faithfully as a modular, responsive React application. Preserve its routes, visual assets, design system, and visible interactions.',
        designSystem: 'Source website',
        model: 'GPT-6 Luna'
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unable to start website cloning.');
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={isGenerating ? () => {} : onClose}
      title="Clone a Website"
      description="Recreate a public website as an editable, validated React project."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="clone-source-url" className="text-xs font-bold text-zinc-800">Website URL</label>
          <div className="relative">
            <Globe2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              id="clone-source-url"
              type="url"
              required
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com"
              className="w-full h-11 rounded-xl border border-zinc-300 bg-white pl-10 pr-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100"
            />
          </div>
          <p className="text-[11px] text-zinc-500">Public pages only. Private networks, local addresses, credentials, and authenticated sites are blocked.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="clone-instructions" className="text-xs font-bold text-zinc-800">Additional requirements <span className="font-normal text-zinc-400">(optional)</span></label>
          <textarea
            id="clone-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="For example: prioritize the product and pricing pages."
            rows={4}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none resize-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100"
          />
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
          <button type="button" onClick={onClose} disabled={isGenerating} className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={isGenerating || !sourceUrl.trim()} className="px-4 py-2 rounded-xl bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-2">
            {isGenerating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Clone Website
          </button>
        </div>
      </form>
    </Dialog>
  );
}
