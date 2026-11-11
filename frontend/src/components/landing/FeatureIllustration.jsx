import React, { useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { Sparkles, ArrowRight, Check, Globe, MessageSquare, Image as ImageIcon, Github, Figma, Users } from 'lucide-react';

/**
 * Animated "AI at work" illustrations for the landing page capability cards.
 * Each one loops a short GSAP timeline that plays only while the card is on screen.
 * With reduced motion the final, fully built state is shown and nothing animates.
 */

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Builds a looping timeline inside a scoped GSAP context, and pauses it while the card is off screen.
function useIllustration(build) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let observer;
    const ctx = gsap.context(() => {
      const q = gsap.utils.selector(ref);
      const tl = build(q);
      tl.pause();
      observer = new IntersectionObserver(
        ([entry]) => (entry.isIntersecting ? tl.play() : tl.pause()),
        { threshold: 0.25 }
      );
      observer.observe(ref.current);
    }, ref);
    return () => {
      if (observer) observer.disconnect();
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

// Types `text` into the first element matching `selector`.
function typeInto(tl, q, selector, text, duration, position) {
  const state = { n: 0 };
  tl.set(state, { n: 0 }, position);
  tl.to(
    state,
    {
      n: text.length,
      duration,
      ease: 'none',
      onUpdate: () => {
        const el = q(selector)[0];
        if (el) el.textContent = text.slice(0, Math.round(state.n));
      },
    },
    position
  );
}

const frame = 'relative w-full h-full flex items-center justify-center p-3 sm:p-4 select-none overflow-hidden';

/* ------------------------------------------------------------------ */
/* Card 1: a prompt is typed and the AI builds a page from it          */
/* ------------------------------------------------------------------ */
const PROMPT_TEXT = 'Build a landing page for my coffee shop';

export function AudioPlayerIllustration() {
  const ref = useIllustration((q) => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });
    tl.set(q('.ai-block'), { opacity: 0, y: 16 }, 0)
      .set(q('.ai-line'), { scaleX: 0, transformOrigin: 'left center' }, 0)
      .set(q('.ai-status'), { opacity: 0 }, 0)
      .set(q('.ai-scan'), { opacity: 0, top: '0%' }, 0)
      .set(q('.ai-caret'), { opacity: 1 }, 0)
      .call(() => { const el = q('.ai-typed')[0]; if (el) el.textContent = ''; }, null, 0);

    typeInto(tl, q, '.ai-typed', PROMPT_TEXT, 1.7, 0.3);
    tl.to(q('.ai-send'), { scale: 1.25, duration: 0.15, yoyo: true, repeat: 1 }, '>')
      .to(q('.ai-status'), { opacity: 1, duration: 0.3 }, '<0.1')
      .to(q('.ai-scan'), { opacity: 1, duration: 0.2 }, '<')
      .to(q('.ai-scan'), { top: '100%', duration: 2.6, ease: 'power1.inOut' }, '<')
      .to(q('.ai-block.ai-nav'), { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, '<0.2')
      .to(q('.ai-line'), { scaleX: 1, duration: 0.6, stagger: 0.25, ease: 'power3.out' }, '<0.45')
      .to(q('.ai-block.ai-btn'), { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(2)' }, '>-0.2')
      .to(q('.ai-block.ai-card'), { opacity: 1, y: 0, duration: 0.55, stagger: 0.18, ease: 'power3.out' }, '<0.2')
      .to(q('.ai-scan'), { opacity: 0, duration: 0.3 }, '>')
      .to(q('.ai-status'), { opacity: 0, duration: 0.3 }, '<')
      .to(q('.ai-caret'), { opacity: 0, duration: 0.2 }, '<')
      .to(q('.ai-block, .ai-line'), { opacity: 0, duration: 0.45 }, '+=2.2');
    return tl;
  });

  return (
    <div className={`${frame} bg-gradient-to-br from-zinc-100/90 via-zinc-50 to-zinc-200/60`}>
      <div ref={ref} className="relative w-full max-w-sm flex flex-col gap-2">
        {/* Prompt bar */}
        <div className="bg-white rounded-xl border border-zinc-200 shadow-xs px-3 py-2 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-zinc-900 shrink-0" />
          <span className="text-xs text-zinc-700 truncate min-h-[1rem]">
            <span className="ai-typed">{PROMPT_TEXT}</span>
            <span className="ai-caret inline-block w-px h-3 bg-zinc-900 ml-0.5 align-middle animate-pulse" />
          </span>
          <span className="ai-send ml-auto w-5 h-5 rounded-md bg-zinc-900 text-white flex items-center justify-center shrink-0">
            <ArrowRight className="w-3 h-3" />
          </span>
        </div>

        {/* Page being built */}
        <div className="relative bg-white rounded-2xl border border-zinc-200 shadow-[0_10px_30px_rgba(0,0,0,0.06)] p-3 flex flex-col gap-2 overflow-hidden">
          <div className="ai-status absolute top-2 right-2 z-20 flex items-center gap-1.5 text-[9px] font-mono text-zinc-600 bg-white/90 border border-zinc-200 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-900 animate-pulse" />
            Generating...
          </div>
          <div className="ai-scan absolute left-0 right-0 h-10 -mt-10 bg-gradient-to-b from-transparent via-zinc-300/40 to-transparent pointer-events-none z-10" />

          <div className="ai-block ai-nav flex items-center justify-between">
            <div className="h-2 w-16 bg-zinc-900 rounded-full" />
            <div className="flex gap-2">
              <div className="h-1.5 w-8 bg-zinc-300 rounded-full" />
              <div className="h-1.5 w-8 bg-zinc-300 rounded-full" />
              <div className="h-1.5 w-8 bg-zinc-300 rounded-full" />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="ai-line h-3 w-3/4 bg-zinc-900 rounded-full" />
            <div className="ai-line h-3 w-1/2 bg-zinc-400 rounded-full" />
            <div className="ai-line h-1.5 w-2/3 bg-zinc-200 rounded-full mt-1.5" />
          </div>

          <div className="ai-block ai-btn h-6 w-24 rounded-full bg-zinc-900 text-white text-[10px] font-semibold flex items-center justify-center">
            Get Started
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ai-block ai-card rounded-lg border border-zinc-200 p-1.5 space-y-1">
                <div className="h-5 rounded bg-zinc-100" />
                <div className="h-1.5 w-3/4 bg-zinc-300 rounded-full" />
                <div className="h-1 w-1/2 bg-zinc-200 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card 2: pick brand colours and fonts, the preview restyles itself   */
/* ------------------------------------------------------------------ */
const DS_COLORS = ['#18181B', '#0F766E', '#B45309'];
const DS_FONTS = [
  { label: 'Sans', family: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', family: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', family: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

export function DesignSystemIllustration() {
  const ref = useIllustration((q) => {
    const tl = gsap.timeline({ repeat: -1 });
    DS_COLORS.forEach((color, i) => {
      tl.add(`step${i}`, i === 0 ? 0 : '>')
        .to(q('.ds-sw'), { scale: (idx) => (idx === i ? 1.3 : 1), duration: 0.35, ease: 'back.out(2)' }, `step${i}`)
        .to(q('.ds-font'), {
          backgroundColor: (idx) => (idx === i ? '#18181B' : '#FFFFFF'),
          color: (idx) => (idx === i ? '#FFFFFF' : '#52525B'),
          duration: 0.3,
        }, `step${i}`)
        // The app preview restyles itself with the chosen brand colour and font
        .to(q('.ds-accent-bg'), { backgroundColor: color, duration: 0.5 }, `step${i}+=0.15`)
        .to(q('.ds-accent-text'), { color, duration: 0.5 }, `step${i}+=0.15`)
        .to(q('.ds-accent-border'), { borderColor: color, duration: 0.5 }, `step${i}+=0.15`)
        .set(q('.ds-font-target'), { fontFamily: DS_FONTS[i].family }, `step${i}+=0.2`)
        .fromTo(q('.ds-app'), { scale: 0.98 }, { scale: 1, duration: 0.45, ease: 'back.out(2.5)' }, `step${i}+=0.2`)
        .to({}, { duration: 1.4 });
    });
    return tl;
  });

  return (
    <div className={`${frame} bg-gradient-to-br from-zinc-50 via-zinc-100/70 to-zinc-200/30`}>
      <div ref={ref} className="flex items-center gap-3 sm:gap-5 w-full max-w-md justify-center">
        {/* Left: design tokens being chosen */}
        <div className="w-[44%] bg-white rounded-xl border border-zinc-200 shadow-md p-3 flex flex-col gap-3">
          <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-500">Design system</span>
          <div>
            <span className="text-[9px] text-zinc-400 font-mono block mb-1.5">Brand color</span>
            <div className="flex items-center gap-2">
              {DS_COLORS.map((c) => (
                <span key={c} className="ds-sw w-5 h-5 rounded-full border-2 border-white shadow ring-1 ring-zinc-200" style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div>
            <span className="text-[9px] text-zinc-400 font-mono block mb-1.5">Font</span>
            <div className="flex items-center gap-1">
              {DS_FONTS.map((f, i) => (
                <span
                  key={f.label}
                  className="ds-font text-[9px] font-semibold px-1.5 py-0.5 rounded border border-zinc-200"
                  style={{ backgroundColor: i === 0 ? '#18181B' : '#FFFFFF', color: i === 0 ? '#FFFFFF' : '#52525B' }}
                >
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right: the generated app follows the tokens */}
        <div className="ds-app w-[56%] bg-white rounded-xl border border-zinc-300 shadow-lg p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between pb-1 border-b border-zinc-100">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-900">Your site</span>
            <span className="text-[9px] font-mono text-zinc-600 font-semibold flex items-center gap-1">
              <span className="ds-accent-bg w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: DS_COLORS[0] }} />
              Live preview
            </span>
          </div>
          <div className="ds-font-target text-[13px] font-bold text-zinc-900 leading-tight" style={{ fontFamily: DS_FONTS[0].family }}>
            Fresh coffee, <span className="ds-accent-text" style={{ color: DS_COLORS[0] }}>roasted daily</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-100 rounded-full" />
          <div className="h-1.5 w-2/3 bg-zinc-100 rounded-full" />
          <div className="flex items-center gap-2 pt-0.5">
            <span className="ds-accent-bg ds-font-target text-[10px] font-semibold text-white px-3 py-1.5 rounded-lg" style={{ backgroundColor: DS_COLORS[0], fontFamily: DS_FONTS[0].family }}>
              Order now
            </span>
            <span className="ds-accent-border text-[10px] font-semibold text-zinc-700 px-3 py-1.5 rounded-lg border" style={{ borderColor: DS_COLORS[0] }}>
              Menu
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card 3: five ways to start, each one generates a page               */
/* ------------------------------------------------------------------ */
const SOURCES = [
  { label: 'Prompt', Icon: MessageSquare },
  { label: 'Screenshot', Icon: ImageIcon },
  { label: 'Website', Icon: Globe },
  { label: 'GitHub', Icon: Github },
  { label: 'Figma', Icon: Figma },
];

export function RapidPrototypingIllustration() {
  const ref = useIllustration((q) => {
    const tl = gsap.timeline({ repeat: -1 });
    tl.set(q('.src-block'), { opacity: 0, y: 10 }, 0).set(q('.src-bar'), { scaleX: 0, transformOrigin: 'left center' }, 0);
    SOURCES.forEach((_, i) => {
      tl.add(`src${i}`, '>')
        .to(q('.src-chip'), {
          backgroundColor: (idx) => (idx === i ? '#18181B' : '#FFFFFF'),
          color: (idx) => (idx === i ? '#FFFFFF' : '#52525B'),
          scale: (idx) => (idx === i ? 1.06 : 1),
          duration: 0.3,
        }, `src${i}`)
        .set(q('.src-bar'), { scaleX: 0 }, `src${i}`)
        .to(q('.src-label'), { opacity: 1, duration: 0.2 }, `src${i}`)
        .to(q('.src-bar'), { scaleX: 1, duration: 0.9, ease: 'power1.inOut' }, `src${i}+=0.15`)
        .to(q('.src-block'), { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, ease: 'power3.out' }, `src${i}+=0.5`)
        .to(q('.src-block'), { opacity: 0, duration: 0.3 }, `src${i}+=2.1`)
        .to(q('.src-label'), { opacity: 0, duration: 0.2 }, `src${i}+=2.1`);
    });
    return tl;
  });

  return (
    <div className={`${frame} bg-gradient-to-br from-zinc-50 to-zinc-100`}>
      <div ref={ref} className="w-full max-w-xs flex flex-col gap-2">
        <div className="flex items-center justify-between gap-1">
          {SOURCES.map(({ label, Icon }) => (
            <span
              key={label}
              className="src-chip flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg border border-zinc-200 bg-white text-zinc-600 text-[8px] font-semibold shadow-xs"
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </span>
          ))}
        </div>

        <div className="src-label flex items-center gap-1.5 text-[10px] font-mono text-zinc-500" style={{ opacity: 0 }}>
          <Sparkles className="w-3 h-3 text-zinc-900" />
          Generating from your source...
        </div>
        <div className="h-1 w-full bg-zinc-200 rounded-full overflow-hidden">
          <div className="src-bar h-full w-full bg-zinc-900 rounded-full" />
        </div>

        <div className="bg-white rounded-xl border border-zinc-200 shadow-md p-2 space-y-1.5">
          <div className="src-block flex items-center justify-between">
            <div className="h-2 w-12 bg-zinc-900 rounded-full" />
            <div className="h-1.5 w-16 bg-zinc-200 rounded-full" />
          </div>
          <div className="src-block h-7 rounded-lg bg-zinc-100" />
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="src-block h-6 rounded-md border border-zinc-200 bg-zinc-50" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card 4: a group fills up with teammates and a project is shared     */
/* ------------------------------------------------------------------ */
const MEMBERS = [
  { initial: 'O', role: 'Owner' },
  { initial: 'A', role: 'Admin' },
  { initial: 'M', role: 'Member' },
];

export function CollaborationIllustration() {
  const ref = useIllustration((q) => {
    const tl = gsap.timeline({ repeat: -1 });
    tl.set(q('.co-row'), { opacity: 0, x: -24 }, 0)
      .set(q('.co-avatar'), { scale: 0 }, 0)
      .set(q('.co-toast'), { opacity: 0, y: 12, scale: 0.9 }, 0)
      .set(q('.co-share'), { opacity: 0, y: 8 }, 0)
      .to(q('.co-row'), { opacity: 1, x: 0, duration: 0.5, stagger: 0.55, ease: 'power3.out' }, 0.3)
      .to(q('.co-avatar'), { scale: 1, duration: 0.45, stagger: 0.55, ease: 'back.out(3)' }, 0.4)
      .to(q('.co-toast'), { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(2)' }, 2.1)
      .to(q('.co-share'), { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 2.9)
      .to(q('.co-role-member'), { backgroundColor: '#18181B', color: '#FFFFFF', duration: 0.3 }, 3.3)
      .to(q('.co-role-member .co-role-text'), { opacity: 0, duration: 0.15 }, 3.3)
      .call(() => { const el = q('.co-role-text')[2]; if (el) el.textContent = 'Editor'; }, null, 3.45)
      .to(q('.co-role-member .co-role-text'), { opacity: 1, duration: 0.2 }, 3.45)
      .call(() => { const el = q('.co-role-text')[2]; if (el) el.textContent = 'Member'; }, null, 0)
      .to(q('.co-row, .co-toast, .co-share'), { opacity: 0, duration: 0.4 }, 5.4)
      .to({}, { duration: 0.2 });
    return tl;
  });

  return (
    <div className={`${frame} bg-gradient-to-br from-zinc-50 to-zinc-100`}>
      <div ref={ref} className="relative w-full max-w-[16rem] flex flex-col gap-2">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-md p-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider font-bold text-zinc-500">
            <Users className="w-3 h-3" /> Group
          </div>
          {MEMBERS.map((m) => (
            <div key={m.role} className="co-row flex items-center gap-2">
              <div className="co-avatar w-5 h-5 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center">
                {m.initial}
              </div>
              <div className="h-1.5 flex-1 bg-zinc-200 rounded-full" />
              <span className={`${m.role === 'Member' ? 'co-role-member' : ''} text-[9px] font-mono font-bold text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded`}>
                <span className="co-role-text">{m.role}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="co-toast self-start flex items-center gap-1.5 bg-white border border-zinc-200 rounded-full shadow-sm pl-2 pr-3 py-0.5 text-[10px] font-semibold text-zinc-700">
          <Check className="w-3 h-3 text-zinc-900" /> Invitation accepted
        </div>

        <div className="co-share bg-zinc-900 text-white rounded-lg px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between">
          <span>Project shared with group</span>
          <span className="font-mono text-zinc-300">Editor</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card 5: build steps tick off, then the site goes live on a domain   */
/* ------------------------------------------------------------------ */
const PUBLISH_DOMAIN = 'yourdomain.com';
const PUBLISH_STEPS = ['Building project', 'Connecting domain', 'Going live'];

export function SecurityIllustration() {
  const ref = useIllustration((q) => {
    const tl = gsap.timeline({ repeat: -1 });
    tl.set(q('.pb-step'), { opacity: 0.35 }, 0)
      .set(q('.pb-check'), { scale: 0, opacity: 0 }, 0)
      .set(q('.pb-site'), { opacity: 0, y: 12 }, 0)
      .set(q('.pb-badge'), { opacity: 0, scale: 0.6 }, 0)
      .set(q('.pb-ring'), { opacity: 0, scale: 0.6 }, 0)
      .set(q('.pb-steps'), { opacity: 1 }, 0)
      .call(() => { const el = q('.pb-url')[0]; if (el) el.textContent = ''; }, null, 0);

    typeInto(tl, q, '.pb-url', PUBLISH_DOMAIN, 1.1, 0.3);
    PUBLISH_STEPS.forEach((_, i) => {
      const at = 1.5 + i * 0.7;
      tl.to(q('.pb-step')[i], { opacity: 1, duration: 0.2 }, at)
        .to(q('.pb-check')[i], { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, at + 0.35);
    });
    tl.to(q('.pb-steps'), { opacity: 0, duration: 0.3 }, 3.8)
      .to(q('.pb-site'), { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, 4.0)
      .to(q('.pb-badge'), { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(3)' }, 4.4)
      .fromTo(q('.pb-ring'), { opacity: 0.7, scale: 0.6 }, { opacity: 0, scale: 1.6, duration: 0.9, ease: 'power2.out' }, 4.4)
      .to(q('.pb-site, .pb-badge'), { opacity: 0, duration: 0.4 }, 6.8);
    return tl;
  });

  return (
    <div className={`${frame} bg-gradient-to-b from-zinc-50 to-zinc-100/60`}>
      <div ref={ref} className="w-full max-w-[16rem] bg-white rounded-xl border border-zinc-200 shadow-md overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 bg-zinc-50">
          <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
          <span className="text-[10px] font-mono text-zinc-600 truncate min-h-[0.9rem]">
            <span className="pb-url">{PUBLISH_DOMAIN}</span>
          </span>
        </div>

        <div className="relative p-3 h-[7.5rem]">
          {/* Publish steps */}
          <div className="pb-steps absolute inset-0 p-3 flex flex-col justify-center gap-2.5">
            {PUBLISH_STEPS.map((label) => (
              <div key={label} className="pb-step flex items-center gap-2 text-[10px] font-medium text-zinc-700">
                <span className="w-4 h-4 rounded-full border border-zinc-300 flex items-center justify-center shrink-0">
                  <Check className="pb-check w-2.5 h-2.5 text-zinc-900" />
                </span>
                {label}
              </div>
            ))}
          </div>

          {/* Live site */}
          <div className="pb-site absolute inset-0 p-3 flex flex-col justify-center gap-2">
            <div className="h-2.5 w-2/3 bg-zinc-900 rounded-full" />
            <div className="h-1.5 w-full bg-zinc-200 rounded-full" />
            <div className="h-1.5 w-4/5 bg-zinc-200 rounded-full" />
            <div className="relative self-start mt-1">
              <span className="pb-ring absolute inset-0 rounded-full border border-zinc-900" />
              <span className="pb-badge relative inline-flex items-center gap-1 text-[9px] font-mono font-bold bg-zinc-900 text-white px-2 py-0.5 rounded-full">
                <Check className="w-2.5 h-2.5" /> Published
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Universal FeatureIllustration dispatcher component
 */
export default function FeatureIllustration({ type }) {
  switch (type) {
    case 'audio-player':
      return <AudioPlayerIllustration />;
    case 'design-system':
      return <DesignSystemIllustration />;
    case 'rapid-prototyping':
      return <RapidPrototypingIllustration />;
    case 'collaboration':
      return <CollaborationIllustration />;
    case 'security':
      return <SecurityIllustration />;
    default:
      return null;
  }
}
