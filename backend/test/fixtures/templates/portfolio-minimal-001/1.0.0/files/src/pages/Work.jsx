import React, { useState } from 'react';
import Section, { SectionHeading } from '../components/Section';
import ProjectCard from '../components/ProjectCard';
import { projects } from '../data/projects';

const categories = ['All', ...new Set(projects.map((project) => project.category))];

export default function Work() {
  const [active, setActive] = useState('All');
  const visible = active === 'All' ? projects : projects.filter((project) => project.category === active);

  return (
    <Section>
      <SectionHeading eyebrow="Work" title="Selected projects" description="A mix of identity, web and product work from the last few years." />
      <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Project categories">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={active === category}
            onClick={() => setActive(category)}
            className={'rounded-button border px-4 py-1.5 text-sm transition ' + (active === category ? 'border-brand bg-brand text-on-brand' : 'border-line text-muted hover:text-fg')}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </Section>
  );
}
