import React from 'react';
import { Link } from 'react-router-dom';
import { site } from '../data/site';

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface-2">
      <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <p className="font-serif text-xl font-semibold tracking-tight">{site.name}</p>
            <p className="mt-3 max-w-sm text-sm text-muted">{site.tagline}</p>
          </div>
          {site.footerGroups.map((group) => (
            <div key={group.title}>
              <p className="text-sm font-semibold">{group.title}</p>
              <ul className="mt-4 space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="text-sm text-muted transition hover:text-fg">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} {site.name}. All rights reserved.</p>
          <a href={'mailto:' + site.email} className="transition hover:text-fg">{site.email}</a>
        </div>
      </div>
    </footer>
  );
}
