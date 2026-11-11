import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Section from './Section';

export default function CTA({ title, description, label, to }) {
  return (
    <Section tone="alt">
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {description ? <p className="mx-auto mt-4 max-w-xl text-lg text-muted">{description}</p> : null}
        <Link to={to} className="inline-flex items-center gap-2 rounded-button bg-brand px-6 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 mt-8">
          {label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </Section>
  );
}
