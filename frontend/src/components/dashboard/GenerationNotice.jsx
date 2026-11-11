import React from 'react';
import { AlertTriangle, ImageOff, X } from 'lucide-react';
import { useGenerationJobStore } from '../../store/generationJobStore';

/**
 * What the user must know about a finished generation that is not a plain success:
 *  - a starter site replaced an AI result that could not be used (degraded),
 *  - a name in the request had no verifiable picture, so a placeholder was used instead of someone else's photo.
 */
export default function GenerationNotice() {
  const { jobStatus, jobDegraded, jobEntityImages, dismissToast } = useGenerationJobStore();
  const [hidden, setHidden] = React.useState(false);
  const missing = jobEntityImages?.missing || [];
  if (jobStatus !== 'completed' || hidden || (!jobDegraded && !missing.length)) return null;

  return (
    <section aria-label="Generation notice" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 select-text">
      <div className="relative flex flex-col gap-1 pr-8">
        {jobDegraded && (
          <p className="flex items-start gap-2" role="status">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>A starter site was created.</strong> The AI result could not be used{jobDegraded.reason ? ` (${String(jobDegraded.reason).slice(0, 160)})` : ''}, so no credit was charged. Describe the site again to get a full version.
            </span>
          </p>
        )}
        {missing.length > 0 && (
          <p className="flex items-start gap-2" role="status">
            <ImageOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              No verified picture was found for <strong>{missing.join(', ')}</strong>, so a placeholder is shown instead of another person&apos;s or brand&apos;s image. Attach the image you want with the + button.
            </span>
          </p>
        )}
        <button type="button" onClick={() => { setHidden(true); dismissToast(); }} aria-label="Dismiss notice" className="absolute top-0 right-0 p-1 rounded-md text-amber-500 hover:text-amber-800 hover:bg-amber-100 cursor-pointer">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
  );
}
