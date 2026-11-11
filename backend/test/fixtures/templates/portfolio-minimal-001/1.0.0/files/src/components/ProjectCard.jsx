import React from 'react';

export default function ProjectCard({ project }) {
  return (
    <article className="group">
      <div className="overflow-hidden rounded-card border border-line bg-surface-2">
        <img src={project.image} alt={project.title + ' project preview'} loading="lazy" className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105" />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-4">
        <h3 className="font-serif text-xl font-semibold">{project.title}</h3>
        <span className="text-xs uppercase tracking-widest text-muted">{project.category} / {project.year}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{project.summary}</p>
    </article>
  );
}
