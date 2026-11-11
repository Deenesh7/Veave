import React from 'react';

export default function FeatureCard({ icon: Icon, title, description, image, imageAlt }) {
  return (
    <article className="rounded-card border border-line bg-surface flex h-full flex-col overflow-hidden">
      {image ? (
        <img src={image} alt={imageAlt || title} loading="lazy" className="aspect-[16/10] w-full object-cover" />
      ) : null}
      <div className="flex flex-1 flex-col p-6">
        {Icon ? (
          <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-button bg-brand/10 text-brand">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        ) : null}
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      </div>
    </article>
  );
}
