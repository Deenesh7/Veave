import { useLayoutEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * GSAP animations for the whole landing page. Sections opt in with data attributes:
 *   data-nav       the top navigation (drops in)
 *   data-hero      hero items (intro timeline, in DOM order)
 *   data-blob      ambient background blobs (slow floating)
 *   data-reveal    a single element that fades up when scrolled into view
 *   data-stagger   a container whose children animate in one after another ("x" = from left/right, "alt" = alternating)
 * Reveals replay when the section is scrolled back into view, in either direction.
 * Nothing is animated for users who prefer reduced motion.
 */
export function useLandingAnimations(rootRef) {
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = gsap.context(() => {
      // Elements carry CSS transitions (hover lifts); turn them off while GSAP drives the element,
      // then clear everything so the CSS hover effects work again afterwards.
      const lock = (els) => els.forEach((el) => { el.style.transition = 'none'; });
      const release = { clearProps: 'transform,opacity,transition' };

      // Navigation + hero intro
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro.from('[data-nav]', { y: -30, opacity: 0, duration: 0.7, clearProps: 'all' });
      intro.from('[data-hero]', { y: 40, opacity: 0, duration: 0.9, stagger: 0.14, clearProps: 'all' }, '-=0.3');

      // Hero fades and drifts up slightly as the page scrolls away from it
      gsap.to('[data-hero-wrap]', {
        y: -60,
        opacity: 0.2,
        ease: 'none',
        scrollTrigger: { trigger: '[data-hero-wrap]', start: 'top top', end: 'bottom top', scrub: true },
      });

      // Ambient blobs float slowly
      gsap.utils.toArray('[data-blob]').forEach((blob, i) => {
        gsap.to(blob, {
          x: i % 2 ? -40 : 40,
          y: i % 2 ? 30 : -30,
          duration: 7 + i * 1.5,
          ease: 'sine.inOut',
          repeat: -1,
          yoyo: true,
        });
      });

      // Replay on the way back: entering from below plays, scrolling back above reverses it, and re-entering
      // from above (scrolling up) plays it again.
      const toggle = (trigger, start = 'top 85%') => ({
        trigger,
        start,
        end: 'bottom 10%',
        toggleActions: 'play reverse play reverse',
      });

      // Single elements revealing on scroll
      gsap.utils.toArray('[data-reveal]').forEach((el) => {
        gsap.from(el, {
          y: 60,
          opacity: 0,
          scale: 0.97,
          duration: 0.9,
          ease: 'power3.out',
          onStart: () => lock([el]),
          onUpdate() { if (this.progress() < 1) lock([el]); },
          ...release,
          scrollTrigger: toggle(el, 'top 90%'),
        });
      });

      // Groups: children stagger in when the group enters the viewport.
      //   data-stagger        children rise from below
      //   data-stagger="x"    children slide in from the left and right (first half left, second half right,
      //                       a centre child rises from below), so grids open outwards
      //   data-stagger="alt"  children alternate left, right, left... (single-column lists)
      gsap.utils.toArray('[data-stagger]').forEach((group) => {
        const kids = Array.from(group.children);
        if (!kids.length) return;
        const mode = group.dataset.stagger;
        const mid = (kids.length - 1) / 2;
        const xFor = (i) => {
          if (mode === 'alt') return i % 2 === 0 ? -110 : 110;
          if (mode === 'x') return i < mid ? -110 : i > mid ? 110 : 0;
          return 0;
        };
        gsap.from(kids, {
          x: xFor,
          y: (i) => (xFor(i) === 0 ? 60 : 24),
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.13,
          onStart: () => lock(kids),
          onUpdate() { if (this.progress() < 1) lock(kids); },
          ...release,
          scrollTrigger: toggle(group),
        });
      });
    });

    // Images and fonts can shift the layout, so re-measure trigger positions once everything has loaded.
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('load', refresh);
    return () => {
      window.removeEventListener('load', refresh);
      ctx.revert();
    };
  }, [rootRef]);
}
