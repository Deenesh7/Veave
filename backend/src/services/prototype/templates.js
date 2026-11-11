'use strict';

// Deterministic project files written by the engine itself (not by the model): routing, the animation hook, the site
// data (navigation) and stubs. Keeping these out of the model's hands means a page failure can never break routing.

const json = (value) => JSON.stringify(value, null, 2);

function siteDataFile({ siteName, navigation, routes }) {
  const content = `// Site data generated from the reference structure. Components import from here; edit labels freely.
export const site = {
  name: ${JSON.stringify(siteName)},
  nav: ${json(navigation.primary)},
  footerLinks: ${json(navigation.footer)},
  routes: ${json(routes)}
};

export default site;
`;
  return { path: 'src/data/site.js', content, language: 'javascript' };
}

function stubPageFile(page) {
  const content = `import React from 'react';

// Placeholder written by the prototype engine. It is replaced when this page is generated and validated.
export default function ${page.componentName}() {
  return (
    <section data-prototype-stub="true" className="mx-auto max-w-container px-6 py-24">
      <h1 className="text-3xl font-bold">${String(page.title || page.componentName).replace(/[`$\\{}<>]/g, '')}</h1>
      <p className="mt-4 text-muted">This page has not been generated yet.</p>
    </section>
  );
}
`;
  return { path: page.file, content, language: 'javascript' };
}

function appFile(pages) {
  const imports = pages.map((p) => `import ${p.componentName} from './pages/${p.componentName}';`).join('\n');
  const routes = pages.map((p) => `        <Route path="${p.route === '/' ? '/' : p.route.split('?')[0]}" element={<${p.componentName} />} />`).join('\n');
  const home = pages.find((p) => p.route === '/') || pages[0];
  const content = `import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
${imports}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Navbar />
      <main>
        <Routes>
${routes}
          <Route path="*" element={<${home.componentName} />} />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  );
}
`;
  return { path: 'src/App.jsx', content, language: 'javascript' };
}

const GSAP_HOOK = `import { useLayoutEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Page-level motion with GSAP: elements marked data-hero play an intro on load; elements marked data-reveal rise in as they
 * scroll into view; a parent marked data-stagger staggers its children. Content is never left hidden: tweens use
 * gsap.from() and clear their inline styles. Nothing animates for users who prefer reduced motion.
 * Call it once at the top of a page component.
 */
export default function useGsapReveal() {
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const scope = document.querySelector('main') || document.body;
    const ctx = gsap.context(() => {
      const hero = gsap.utils.toArray('[data-hero]');
      if (hero.length) gsap.from(hero, { y: 36, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12, clearProps: 'transform,opacity' });
      gsap.utils.toArray('[data-reveal]').forEach((el) => {
        gsap.from(el, { y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', clearProps: 'transform,opacity', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      });
      gsap.utils.toArray('[data-stagger]').forEach((group) => {
        const kids = Array.from(group.children);
        if (kids.length) gsap.from(kids, { y: 40, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.12, clearProps: 'transform,opacity', scrollTrigger: { trigger: group, start: 'top 85%', once: true } });
      });
    }, scope);
    return () => ctx.revert();
  }, []);
}
`;

const gsapHookFile = () => ({ path: 'src/hooks/useGsapReveal.js', content: GSAP_HOOK, language: 'javascript' });

module.exports = { siteDataFile, stubPageFile, appFile, gsapHookFile, GSAP_HOOK };

// Plain, safe Navbar/Footer used only when the model could not produce working shared components. They use the theme
// tokens and the data file, so the site stays navigable; the report marks the shared stage as degraded.
const FALLBACK_NAVBAR = `import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { site } from '../data/site';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-container items-center justify-between px-6">
        <Link to="/" className="font-heading text-lg font-bold text-fg">{site.name}</Link>
        <nav className="hidden gap-6 md:flex" aria-label="Main">
          {site.nav.map((item) => (
            <NavLink key={item.route} to={item.route} className={({ isActive }) => (isActive ? 'text-fg' : 'text-muted hover:text-fg')}>{item.label}</NavLink>
          ))}
        </nav>
        <button type="button" className="md:hidden text-fg" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">Menu</button>
      </div>
      {open && (
        <nav className="border-t border-line px-6 py-4 md:hidden" aria-label="Mobile">
          {site.nav.map((item) => (
            <Link key={item.route} to={item.route} onClick={() => setOpen(false)} className="block py-2 text-fg">{item.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
`;
const FALLBACK_FOOTER = `import React from 'react';
import { Link } from 'react-router-dom';
import { site } from '../data/site';

export default function Footer() {
  const links = site.footerLinks.length ? site.footerLinks : site.nav;
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-container flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted">
        <span>{site.name}</span>
        <nav className="flex flex-wrap gap-4" aria-label="Footer">
          {links.map((item) => (<Link key={item.route} to={item.route} className="hover:text-fg">{item.label}</Link>))}
        </nav>
      </div>
    </footer>
  );
}
`;
module.exports.fallbackNavbar = () => ({ path: 'src/components/Navbar.jsx', content: FALLBACK_NAVBAR, language: 'javascript' });
module.exports.fallbackFooter = () => ({ path: 'src/components/Footer.jsx', content: FALLBACK_FOOTER, language: 'javascript' });
