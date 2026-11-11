import React from 'react';

export function Container({ className = '', children }) {
  return <div className={'mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8 ' + className}>{children}</div>;
}

const TONES = {
  base: 'bg-bg',
  alt: 'bg-surface',
  strong: 'bg-surface-2'
};

export function SectionHeading({ eyebrow, title, description, align = 'left' }) {
  const alignment = align === 'center' ? 'mx-auto text-center' : '';
  return (
    <div className={'max-w-2xl ' + alignment}>
      {eyebrow ? <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-brand">{eyebrow}</p> : null}
      <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {description ? <p className="mt-4 text-lg text-muted">{description}</p> : null}
    </div>
  );
}

export default function Section({ id, tone = 'base', className = '', children }) {
  return (
    <section id={id} className={(TONES[tone] || TONES.base) + ' py-16 sm:py-24 ' + className}>
      <Container>{children}</Container>
    </section>
  );
}
