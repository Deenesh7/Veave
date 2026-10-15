import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Presentation, 
  Sparkles, 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  ArrowRight, 
  Layers, 
  TrendingUp, 
  ListCheck, 
  AlertCircle,
  RotateCcw
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import aiCreationService from '../../services/aiCreationService';

const STYLES = [
  { id: 'Modern', label: 'Modern', desc: 'Clean, bold, high-contrast' },
  { id: 'Professional', label: 'Professional', desc: 'Refined corporate navy & slate' },
  { id: 'Minimal', label: 'Minimal', desc: 'Monochrome, whitespace focused' },
  { id: 'Corporate', label: 'Corporate', desc: 'Structured & data-centric' },
  { id: 'Creative', label: 'Creative', desc: 'Vibrant accents & energetic' },
];

const SLIDE_COUNTS = [3, 5, 8, 10, 12];

export default function SlideDeckModal({ isOpen, onClose, onGenerated }) {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [slideCount, setSlideCount] = useState(5);
  const [style, setStyle] = useState('Modern');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  const handleGenerate = async (e) => {
    e?.preventDefault();
    if (!title.trim()) {
      setError('Please provide a presentation title.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await aiCreationService.generateSlideDeck({
        title: title.trim(),
        topic: topic.trim(),
        slideCount,
        style,
      });

      const data = res.data?.data || res.data;
      setResult(data);
      setActiveSlideIndex(0);
      if (onGenerated && data.project) {
        onGenerated(data.project);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to generate slide deck.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setTitle('');
    setTopic('');
    setSlideCount(5);
    setStyle('Modern');
    setResult(null);
    setActiveSlideIndex(0);
    setError('');
  };

  const handleClose = () => {
    if (isLoading) return;
    handleReset();
    onClose();
  };

  const currentSlide = result?.slides?.[activeSlideIndex];

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      title="Create an AI Slide Deck"
      description="Generate structured, high-impact multi-slide presentation decks with live interactive previews."
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!result ? (
          /* Form Config */
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1.5">
                Deck Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Veave AI Product Launch & Roadmap"
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:border-[#52525B] focus:ring-2 focus:ring-zinc-100 text-sm text-[#111827] placeholder:text-zinc-400 transition-all"
                disabled={isLoading}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1.5">
                Topic or Key Objectives (Optional)
              </label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Outline the core theme, target audience, or specific metrics you want highlighted..."
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:border-[#52525B] focus:ring-2 focus:ring-zinc-100 text-sm text-[#111827] placeholder:text-zinc-400 resize-none transition-all"
                disabled={isLoading}
              />
            </div>

            {/* Slide Count */}
            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1.5">
                Number of Slides
              </label>
              <div className="flex items-center gap-2">
                {SLIDE_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setSlideCount(count)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                      slideCount === count
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    {count} Slides
                  </button>
                ))}
              </div>
            </div>

            {/* Presentation Style */}
            <div>
              <label className="block text-xs font-semibold text-[#111827] mb-1.5">
                Visual Style
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    className={`p-2.5 text-left rounded-xl border transition-all ${
                      style === s.id
                        ? 'bg-zinc-50/60 border-[#52525B] ring-1 ring-[#52525B]'
                        : 'bg-white border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="text-xs font-bold text-[#111827]">{s.label}</div>
                    <div className="text-[10px] text-zinc-500 truncate mt-0.5">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !title.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-black rounded-xl transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Synthesizing Deck...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-zinc-400" />
                    <span>Generate Slide Deck</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Presentation Carousel Viewer */
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-zinc-50 px-3.5 py-2 rounded-xl border border-zinc-200 text-xs">
              <div className="flex items-center gap-2 text-emerald-700 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Generated {result.slides?.length || 0} slides ({result.style} style)</span>
              </div>
              <span className="font-mono text-zinc-500 font-semibold">
                Slide {activeSlideIndex + 1} / {result.slides?.length}
              </span>
            </div>

            {/* Slide Presentation Card */}
            {currentSlide && (
              <div className="relative rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 text-white p-6 sm:p-8 min-h-[260px] flex flex-col justify-between shadow-md">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#52525B] bg-zinc-950/60 px-2.5 py-0.5 rounded-full border border-zinc-800/50">
                      {currentSlide.type || 'Slide'}
                    </span>
                    <span className="text-xs text-zinc-400 font-mono">
                      #{currentSlide.id}
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white mb-1.5">
                    {currentSlide.title}
                  </h3>
                  {currentSlide.subtitle && (
                    <p className="text-xs text-zinc-400 font-medium mb-4">
                      {currentSlide.subtitle}
                    </p>
                  )}

                  <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed mb-4">
                    {currentSlide.content}
                  </p>

                  {/* Highlights if present */}
                  {currentSlide.highlights && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {currentSlide.highlights.map((h, i) => (
                        <div
                          key={i}
                          className="inline-flex items-center gap-1.5 text-xs bg-zinc-800/80 border border-zinc-700/60 text-zinc-200 px-2.5 py-1 rounded-lg"
                        >
                          <ListCheck className="w-3 h-3 text-[#52525B]" />
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Metrics if present */}
                  {currentSlide.metrics && (
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      {currentSlide.metrics.map((m, i) => (
                        <div
                          key={i}
                          className="bg-zinc-800/70 border border-zinc-700/50 p-2.5 rounded-xl text-center"
                        >
                          <div className="text-base sm:text-lg font-bold text-white flex items-center justify-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            {m.value}
                          </div>
                          <div className="text-[10px] text-zinc-400 mt-0.5">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Carousel Controls */}
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setActiveSlideIndex((i) => Math.max(0, i - 1))}
                    disabled={activeSlideIndex === 0}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  {/* Slide dots */}
                  <div className="flex items-center gap-1.5">
                    {result.slides.map((s, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveSlideIndex(idx)}
                        className={`h-2 rounded-full transition-all ${
                          activeSlideIndex === idx
                            ? 'w-6 bg-[#52525B]'
                            : 'w-2 bg-zinc-700 hover:bg-zinc-500'
                        }`}
                        title={`Go to slide ${idx + 1}`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveSlideIndex((i) => Math.min(result.slides.length - 1, i + 1))}
                    disabled={activeSlideIndex === result.slides.length - 1}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Create Another</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>
                {result.project?._id && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      navigate(`/editor/${result.project._id}`);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-black rounded-xl transition-all shadow-xs cursor-pointer"
                  >
                    <span>Open in Editor</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
