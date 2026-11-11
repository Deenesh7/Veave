import React, { useEffect, useState } from 'react';
import AIComposer from '../components/dashboard/AIComposer';
import QuickActions from '../components/dashboard/QuickActions';

const HEADLINES = [
  'What would you like to build?',
  'Ready to design something new?',
  'What idea should we bring to life?',
  "Let's create your next website.",
  'What will you launch today?',
  "What's your next big idea?",
  "Got a vision? Let's make it real.",
  'Where should we start today?',
  'What are we creating today?',
  'Start with an idea, end with a website.',
];
const HOLD_MS = 2000;      // how long a sentence stays fully visible
const LETTER_STEP_MS = 22; // delay between one letter and the next
const LETTER_ANIM_MS = 380;

// Renders a sentence as words > letters so each letter can roll with its own delay (words wrap only between words).
function Letters({ text, mode }) {
  let n = 0;
  return text.split(' ').map((word, w, words) => (
    <React.Fragment key={w}>
      <span className="inline-block whitespace-nowrap">
        {[...word].map((ch, i) => (
          <span
            key={i}
            className={mode ? `roll-letter roll-letter-${mode}` : undefined}
            style={mode ? { animationDelay: `${n++ * LETTER_STEP_MS}ms` } : undefined}
          >
            {ch}
          </span>
        ))}
      </span>
      {w < words.length - 1 && ' '}
    </React.Fragment>
  ));
}

// Letters roll away one by one, then the next sentence rolls in letter by letter. All sentences are stacked invisibly
// in one grid cell so the heading always reserves the largest width/height and nothing shifts.
function RollingHeadline() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'out' | 'in'

  useEffect(() => {
    const total = (text) => text.length * LETTER_STEP_MS + LETTER_ANIM_MS;
    let timer;
    if (phase === 'idle') {
      timer = setTimeout(() => setPhase('out'), HOLD_MS);
    } else if (phase === 'out') {
      timer = setTimeout(() => { setIndex((i) => (i + 1) % HEADLINES.length); setPhase('in'); }, total(HEADLINES[index]));
    } else {
      timer = setTimeout(() => setPhase('idle'), total(HEADLINES[index]));
    }
    return () => clearTimeout(timer);
  }, [phase, index]);

  return (
    <span className="grid place-items-center text-center" style={{ perspective: '700px' }}>
      {HEADLINES.map((text) => (
        <span key={text} aria-hidden="true" className="invisible [grid-area:1/1]">{text}</span>
      ))}
      <span className="sr-only">{HEADLINES[index]}</span>
      <span aria-hidden="true" className="[grid-area:1/1]">
        <Letters key={`${index}-${phase}`} text={HEADLINES[index]} mode={phase === 'idle' ? null : phase} />
      </span>
    </span>
  );
}

export default function VeaveDashboard() {
  const [prompt, setPrompt] = useState('');

  const handleSelectQuickAction = (actionPrompt) => {
    setPrompt(actionPrompt);
  };

  return (
    <>
      {/* Soft white veil over the geometric background so the content stays the focus */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-white/65 backdrop-blur-[3px] pointer-events-none"
        style={{ zIndex: -1 }}
      />

      {/* Centered in the white panel: the panel is 100vh minus header (56), panel margins (32), border (2), top spacer
          (30) and page bottom padding (64); the top padding balances the unequal top/bottom spacing, and the bottom padding lifts the content a little above the exact centre. */}
      <div className="w-full min-h-[calc(100vh-184px)] pt-[34px] sm:pb-[8vh] flex flex-col items-center justify-center">
        <div className="w-full max-w-[760px] mx-auto py-6 text-center">
          <h1 className="text-[26px] sm:text-[34px] font-bold text-[#171717] tracking-tight leading-tight">
            <RollingHeadline />
          </h1>
          <p className="text-sm sm:text-[15px] text-[#737373] mt-3 mb-8">
            Describe your idea, and Veave will turn it into a working website.
          </p>

          <AIComposer prompt={prompt} setPrompt={setPrompt} />

          <div className="mt-5">
            <QuickActions onSelectAction={handleSelectQuickAction} />
          </div>
        </div>
      </div>
    </>
  );
}
