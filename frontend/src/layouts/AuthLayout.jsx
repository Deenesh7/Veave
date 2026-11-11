import { useRef, useLayoutEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import gsap from 'gsap';
import { ArrowLeft, Check } from 'lucide-react';
import { Logo } from '../components/common/Logo';
import { AudioPlayerIllustration } from '../components/landing/FeatureIllustration';

const POINTS = [
  'Start from a prompt, screenshot, website, GitHub or Figma',
  'Edit with chat, the visual editor or the code editor',
  'Export a ZIP or publish on your own domain',
];

/** Split-screen auth layout: an animated brand panel on the left (large screens) and the form on the right. */
function BrandPanel() {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const panel = ref.current;
    const ctx = gsap.context(() => {
      // Intro: headline, demo card and points rise in one after another
      gsap.from('[data-brand="in"]', { y: 36, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.14, clearProps: 'transform,opacity' });

      // Ambient light blobs drift slowly
      gsap.utils.toArray('[data-brand="blob"]').forEach((blob, i) => {
        gsap.to(blob, { x: i % 2 ? -50 : 50, y: i % 2 ? 40 : -40, duration: 8 + i * 2, ease: 'sine.inOut', repeat: -1, yoyo: true });
      });

      // The demo card follows the pointer a little (parallax tilt)
      const card = '[data-brand="card"]';
      const moveX = gsap.quickTo(card, 'x', { duration: 0.8, ease: 'power3.out' });
      const moveY = gsap.quickTo(card, 'y', { duration: 0.8, ease: 'power3.out' });
      const rotY = gsap.quickTo(card, 'rotationY', { duration: 0.8, ease: 'power3.out' });
      const rotX = gsap.quickTo(card, 'rotationX', { duration: 0.8, ease: 'power3.out' });
      gsap.set(card, { transformPerspective: 900 });
      const onMove = (e) => {
        const r = panel.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        moveX(nx * 18); moveY(ny * 14); rotY(nx * 6); rotX(-ny * 5);
      };
      const onLeave = () => { moveX(0); moveY(0); rotY(0); rotX(0); };
      panel.addEventListener('mousemove', onMove);
      panel.addEventListener('mouseleave', onLeave);
      return () => {
        panel.removeEventListener('mousemove', onMove);
        panel.removeEventListener('mouseleave', onLeave);
      };
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <aside ref={ref} className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-zinc-950 text-white p-12 xl:p-16">
      {/* Ambient light */}
      <div data-brand="blob" className="absolute -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-zinc-700/30 blur-[110px] pointer-events-none" />
      <div data-brand="blob" className="absolute -bottom-40 -right-24 w-[32rem] h-[32rem] rounded-full bg-zinc-600/25 blur-[120px] pointer-events-none" />
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />

      {/* Brand */}
      <div data-brand="in" className="relative z-10 flex items-center gap-3">
        <span className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-lg">
          <img src="/veave-logo.png" alt="" className="w-8 h-8 object-contain" />
        </span>
        <span className="text-xl font-semibold tracking-tight">Veave</span>
      </div>

      {/* Pitch + live demo */}
      <div className="relative z-10 space-y-8 max-w-lg">
        <h1 data-brand="in" className="text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1]">
          Turn a prompt into <span className="text-zinc-400">a real website.</span>
        </h1>

        <div data-brand="in">
          <div data-brand="card" className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl h-64 will-change-transform">
            <AudioPlayerIllustration />
          </div>
        </div>

        <ul className="space-y-3">
          {POINTS.map((point) => (
            <li key={point} data-brand="in" className="flex items-start gap-3 text-sm text-zinc-300">
              <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>

      <p data-brand="in" className="relative z-10 text-xs text-zinc-500">© {new Date().getFullYear()} Veave</p>
    </aside>
  );
}

export default function AuthLayout() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#F7F4EE]">
      <BrandPanel />

      <main className="relative flex flex-col px-6 sm:px-10 py-8 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="lg:invisible">
            <Logo size="md" />
          </div>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center py-8">
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
