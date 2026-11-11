import React from 'react';
import Section, { SectionHeading } from '../components/Section';
import CTA from '../components/CTA';

const skills = ['Brand strategy', 'Interface design', 'Design systems', 'React and Tailwind', 'Accessibility', 'Copywriting'];

const timeline = [
  { year: '2024', role: 'Independent studio', detail: 'Working directly with founders and small teams.' },
  { year: '2020', role: 'Senior designer, Fable Agency', detail: 'Led web and brand projects for cultural clients.' },
  { year: '2016', role: 'Developer, Pixelworks', detail: 'Built production websites and learned to ship.' }
];

export default function About() {
  return (
    <>
      <Section>
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
          <img src="/images/card-2.svg" alt="Portrait illustration of the designer at work" className="w-full rounded-card border border-line object-cover" />
          <div>
            <SectionHeading eyebrow="About" title="Hello, I am Lena" />
            <p className="mt-6 text-muted">I have spent ten years between design and code. I like projects where the idea is clear and the details are given real care.</p>
            <p className="mt-4 text-muted">I work with a small number of clients at a time so that each project gets my full attention, from the first sketch to the final deploy.</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {skills.map((skill) => (
                <li key={skill} className="rounded-button border border-line bg-surface px-4 py-1.5 text-sm">{skill}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="Experience" title="A short timeline" />
        <ol className="mt-10 space-y-8 border-l border-line pl-6">
          {timeline.map((item) => (
            <li key={item.year}>
              <p className="text-sm font-semibold text-brand">{item.year}</p>
              <p className="font-serif text-xl font-semibold">{item.role}</p>
              <p className="mt-1 text-sm text-muted">{item.detail}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CTA title="Let us make something good" description="Tell me about your project." label="Get in touch" to="/contact" />
    </>
  );
}
