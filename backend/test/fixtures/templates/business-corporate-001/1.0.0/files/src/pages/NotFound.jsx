import React from 'react';
import { Link } from 'react-router-dom';
import Section from '../components/Section';

export default function NotFound() {
  return (
    <Section>
      <div className="mx-auto max-w-xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">404</p>
        <h1 className="mt-3 text-4xl font-bold">This page does not exist</h1>
        <p className="mt-4 text-muted">The link may be broken or the page may have moved.</p>
        <Link to="/" className="inline-flex items-center gap-2 rounded-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 mt-8">Back to home</Link>
      </div>
    </Section>
  );
}
