import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Leaf, Hammer, Sun } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import ProjectCard from '../components/ProjectCard';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';
import { projects } from '../data/projects';
import { site } from '../data/site';

const approach = [
  { icon: Leaf, title: 'Honest materials', description: 'Oak, clay, lime plaster and linen, chosen for how they age and left to speak for themselves.' },
  { icon: Sun, title: 'Light first', description: 'Every plan starts with where the sun falls at nine, at noon and at the end of the day.' },
  { icon: Hammer, title: 'Made with makers', description: 'We draw alongside the joiners and masons who build, so details are solved on site, not on paper.' }
];

export default function Home() {
  return (
    <>
      <Section className="pb-8 sm:pb-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-brand">Architecture and interiors</p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Quiet houses, built slowly from honest materials.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted">{site.tagline}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/projects" className="inline-flex items-center gap-2 rounded-button bg-brand px-6 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90">
              See selected spaces <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/studio" className="inline-flex items-center gap-2 rounded-button border border-fg/30 px-6 py-2.5 text-sm font-semibold transition hover:bg-surface-2">Our point of view</Link>
          </div>
        </div>
        <img src="/images/hero.svg" alt="Studio collage of plans, samples and materials" className="mt-14 w-full rounded-card border border-line object-cover" />
      </Section>

      <Section tone="alt">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="Selected spaces" title="Recent work" />
          <Link to="/projects" className="text-sm font-semibold text-brand hover:underline">All projects</Link>
        </div>
        <div className="mt-10 grid gap-10 sm:grid-cols-2">
          {projects.slice(0, 4).map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Approach" title="How we work" description="A small studio, so the people you meet are the people who draw, specify and visit the site." />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {approach.map((item) => (
            <FeatureCard key={item.title} {...item} />
          ))}
        </div>
      </Section>

      <CTA title="Planning a house or an interior?" description="We take on a small number of commissions each year." label="Start a conversation" to="/contact" />
    </>
  );
}
