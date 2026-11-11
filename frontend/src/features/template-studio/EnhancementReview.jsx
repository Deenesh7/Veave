import React from 'react';
import { Check, ImageIcon, Sparkles } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { Modal, PrimaryButton, GhostButton, Spinner, ink, muted, line } from './ui';
import CompareSlider from './CompareSlider';
import { useImageSrc, formatBytes } from './imageUtils';

/** Before / after of one photo. The owner decides: use the enhanced photo, or keep the original. Nothing is replaced on its own. */
export default function EnhancementReview({ image, onClose }) {
  const { site, images, busy, chooseEnhancement } = useTemplateStudioStore();
  const live = images.find((item) => item.id === image.id) || image;
  const e = live.enhancement || {};
  const before = useImageSrc(site?.id, live, { full: true });
  const after = useImageSrc(site?.id, live, { full: true, version: 'enhanced' });
  const working = Boolean(busy[`choose:${live.id}`]);
  const aspect = live.width && live.height ? live.width / live.height : 4 / 3;

  const decide = async (choice) => { if (await chooseEnhancement(live.id, choice)) onClose(); };

  return (
    <Modal open onClose={onClose} title="Compare your photo" wide>
      {e.status !== 'completed' ? <p className={`text-sm ${muted}`}>The enhanced version is not ready yet.</p> : (
        <div className="space-y-4">
          <CompareSlider before={before.src} after={after.src} aspect={aspect} />
          <div className={`grid grid-cols-2 gap-3 text-xs ${muted}`}>
            <p>Original · {live.width} × {live.height}px · {formatBytes(live.size)}</p>
            <p className="text-right">AI-enhanced · {e.enhancedWidth} × {e.enhancedHeight}px · {formatBytes(e.enhancedSize)}</p>
          </div>
          <p className={`rounded-md border ${line} bg-[#F3EFE5] p-3 text-xs leading-relaxed ${ink}`}>
            <Sparkles className="mr-1 inline h-3 w-3 text-[#5E7B5F]" />Your original is always kept. Using the enhanced photo switches every page that shows this photo to the enhanced version, saved as a revision you can undo. No page is regenerated.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <GhostButton onClick={() => decide('original')} disabled={working} aria-pressed={e.applied === 'original'}>
              <ImageIcon className="h-4 w-4" />{e.applied === 'original' ? 'Keeping original' : 'Keep Original Image'}
            </GhostButton>
            <PrimaryButton onClick={() => decide('enhanced')} disabled={working || e.applied === 'enhanced'}>
              {working ? <Spinner /> : <Check className="h-4 w-4" />}{e.applied === 'enhanced' ? 'Enhanced image in use' : 'Apply Enhanced Image'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  );
}
