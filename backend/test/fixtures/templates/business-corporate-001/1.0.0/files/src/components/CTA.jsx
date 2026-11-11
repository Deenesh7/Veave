import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Section from './Section';

export default function CTA({ title, description, label, to }) {
  return (
    <Section tone="alt">
      <div className="mx-auto max-w-4xl rounded-card bg-brand px-6 py-14 text-center text-on-brand">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {description ? <p className="mx-auto mt-4 max-w-xl text-lg text-on-brand/80">{description}</p> : null}
        <Link to={to} className="mt-8 inline-flex items-center gap-2 rounded-button bg-surface px-5 py-2.5 text-sm font-semibold text-brand transition hover:opacity-90">
          {label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </Section>
  );
}
