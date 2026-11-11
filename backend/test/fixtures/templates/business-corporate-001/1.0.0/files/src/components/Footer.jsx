import React from 'react';
import { Link } from 'react-router-dom';
import { site } from '../data/site';

export default function Footer() {
  return (
    <footer className="bg-fg text-bg">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <p className="text-xl font-extrabold tracking-tight text-brand">{site.name}</p>
            <p className="mt-3 max-w-sm text-sm text-bg/70">{site.tagline}</p>
          </div>
          {site.footerGroups.map((group) => (
            <div key={group.title}>
              <p className="text-sm font-semibold">{group.title}</p>
              <ul className="mt-4 space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="text-sm text-bg/70 transition hover:text-bg">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-bg/20 pt-6 text-sm text-bg/70 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} {site.name}. All rights reserved.</p>
          <a href={'mailto:' + site.email} className="transition hover:text-bg">{site.email}</a>
        </div>
      </div>
    </footer>
  );
}
