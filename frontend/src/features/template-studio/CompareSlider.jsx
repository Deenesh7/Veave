import React, { useRef, useState } from 'react';
import { Skeleton, muted } from './ui';

/** Before / after: the enhanced photo is revealed over the original as the handle moves (drag, click, or use the arrow keys). */
export default function CompareSlider({ before, after, beforeLabel = 'Original', afterLabel = 'Enhanced', aspect = 4 / 3 }) {
  const [position, setPosition] = useState(50);
  const box = useRef(null);
  const move = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  const onPointerDown = (event) => {
    event.preventDefault();
    move(event.clientX);
    const drag = (e) => move(e.clientX);
    const stop = () => { window.removeEventListener('pointermove', drag); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div>
      <div ref={box} onPointerDown={onPointerDown} style={{ aspectRatio: aspect }} className="relative w-full cursor-ew-resize select-none overflow-hidden rounded-md border border-[#E2DCCF] bg-[#EFEBE1] touch-none">
        {before ? <img src={before} alt={beforeLabel} draggable={false} className="absolute inset-0 h-full w-full object-contain" /> : <Skeleton className="absolute inset-0 !rounded-none" />}
        {after ? (
          <img src={after} alt={afterLabel} draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 0 0 ${position}%)` }} />
        ) : null}
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-[#2B2823]/70 px-1.5 py-0.5 text-[10px] font-medium text-white">{beforeLabel}</span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-[#5E7B5F]/90 px-1.5 py-0.5 text-[10px] font-medium text-white">{afterLabel}</span>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${position}%` }}>
          <span className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#E2DCCF] bg-white text-[10px] text-[#2B2823] shadow">↔</span>
        </div>
      </div>
      <input type="range" min="0" max="100" value={Math.round(position)} onChange={(event) => setPosition(Number(event.target.value))} aria-label="Compare the original and the enhanced photo" className="mt-2 w-full accent-[#5E7B5F]" />
      <p className={`text-center text-[11px] ${muted}`}>Drag the handle to compare</p>
    </div>
  );
}
