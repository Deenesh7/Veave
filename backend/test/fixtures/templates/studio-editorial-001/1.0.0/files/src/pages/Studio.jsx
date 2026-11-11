import React from 'react';
import Section, { SectionHeading } from '../components/Section';
import CTA from '../components/CTA';

const principles = ['Natural materials', 'Passive comfort', 'Timeless proportion', 'Repair over replace', 'Local craft', 'Long-term care'];

const people = [
  { year: '2024', role: 'Studio founded in the valley', detail: 'Two architects who trained as joiners opened a workshop and a drawing room under one roof.' },
  { year: '2021', role: 'First rammed-earth commission', detail: 'The Courtyard House taught us how much a wall can do when it is allowed to be thick.' },
  { year: '2018', role: 'Years of apprenticeship', detail: 'Working with masons, plasterers and furniture makers before drawing for them.' }
];

export default function Studio() {
  return (
    <>
      <Section>
        <div className="grid gap-12 md:grid-cols-[1fr_1.4fr]">
          <img src="/images/card-2.svg" alt="Plans and material samples on the studio table" className="w-full rounded-card border border-line object-cover" />
          <div>
            <SectionHeading eyebrow="Studio" title="Our point of view" />
            <p className="mt-6 text-muted">We believe a home should feel calm the day it is finished and better every year after. That means fewer materials, chosen well, and details that can be repaired.</p>
            <p className="mt-4 text-muted">We work with a small number of clients at a time, so each project is led by a partner from the first sketch to the final coat of limewash.</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {principles.map((skill) => (
                <li key={skill} className="rounded-button border border-line bg-surface px-4 py-1.5 text-sm">{skill}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="People and materials" title="How the studio grew" />
        <ol className="mt-10 space-y-8 border-l border-line pl-6">
          {people.map((item) => (
            <li key={item.year}>
              <p className="text-sm font-semibold text-brand">{item.year}</p>
              <p className="font-serif text-xl font-semibold">{item.role}</p>
              <p className="mt-1 text-sm text-muted">{item.detail}</p>
            </li>
          ))}
        </ol>
      </Section>

      <CTA title="Let us talk about your site" description="Tell us about the place and how you want to live in it." label="Get in touch" to="/contact" />
    </>
  );
}
