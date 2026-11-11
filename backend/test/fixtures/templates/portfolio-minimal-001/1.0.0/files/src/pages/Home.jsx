import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PenTool, Code2, LayoutGrid } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import ProjectCard from '../components/ProjectCard';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';
import { projects } from '../data/projects';
import { site } from '../data/site';

const services = [
  { icon: PenTool, title: 'Brand identity', description: 'Logos, colour and type systems that make small teams look established.' },
  { icon: LayoutGrid, title: 'Web design', description: 'Clear layouts and honest copy that guide people to the next step.' },
  { icon: Code2, title: 'Front-end development', description: 'Fast, accessible React sites that are easy for you to maintain.' }
];

const workflow = [
  { title: 'Listen', text: 'We start with a conversation about your goals, your audience and what good looks like for you.' },
  { title: 'Design', text: 'I sketch, test and refine until the structure and the visual language feel right together.' },
  { title: 'Build', text: 'I build the site with clean, accessible code and train you to update it yourself.' }
];

export default function Home() {
  return (
    <>
      <Section className="pb-8 sm:pb-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-brand">Designer and developer</p>
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            I design thoughtful websites for people with something to say.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted">{site.tagline}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/work" className="inline-flex items-center gap-2 rounded-button bg-brand px-6 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90">
              View my work <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/about" className="inline-flex items-center gap-2 rounded-button border border-fg/30 px-6 py-2.5 text-sm font-semibold transition hover:bg-surface-2">About me</Link>
          </div>
        </div>
        <img src="/images/hero.svg" alt="Collage of selected design work" className="mt-14 w-full rounded-card border border-line object-cover" />
      </Section>

      <Section tone="alt">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="Selected work" title="Recent projects" />
          <Link to="/work" className="text-sm font-semibold text-brand hover:underline">All projects</Link>
        </div>
        <div className="mt-10 grid gap-10 sm:grid-cols-2">
          {projects.slice(0, 4).map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Services" title="How I can help" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {services.map((service) => (
            <FeatureCard key={service.title} {...service} />
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="Process" title="A calm, collaborative way of working" />
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {workflow.map((step, index) => (
            <li key={step.title}>
              <p className="font-serif text-4xl font-semibold text-brand">{'0' + (index + 1)}</p>
              <h3 className="mt-2 font-serif text-xl font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CTA title="Have a project in mind?" description="I take on a small number of projects each quarter." label="Start a conversation" to="/contact" />
    </>
  );
}
