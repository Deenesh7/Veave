import React from 'react';
import { Heart, Target, Handshake } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';

const values = [
  { icon: Handshake, title: 'Partnership', description: 'We succeed when you do, and we plan our work that way.' },
  { icon: Target, title: 'Clarity', description: 'Plain language, honest numbers and no surprises.' },
  { icon: Heart, title: 'Care', description: 'We treat your business as if it were our own.' }
];

const team = [
  { name: 'Helen Marsh', role: 'Managing Partner', image: '/images/card-2.svg' },
  { name: 'Rahul Verma', role: 'Head of Strategy', image: '/images/card-3.svg' },
  { name: 'Sofia Lindqvist', role: 'Head of Operations', image: '/images/card-1.svg' }
];

export default function About() {
  return (
    <>
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="About us" title="Twenty five years of steady, independent advice" />
            <p className="mt-6 text-muted">Meridian Group started as a two person practice and has grown into a team of forty advisors. We remain independent, which means our advice is always in your interest.</p>
            <p className="mt-4 text-muted">We work with family businesses, scale-ups and public bodies across the United Kingdom and Europe.</p>
          </div>
          <img src="/images/hero.svg" alt="The Meridian Group team in a planning workshop" loading="lazy" className="w-full rounded-card border border-line object-cover" />
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="Values" title="What guides our work" align="center" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {values.map((value) => (
            <FeatureCard key={value.title} {...value} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Leadership" title="Meet the team" />
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {team.map((member) => (
            <FeatureCard key={member.name} title={member.name} description={member.role} image={member.image} imageAlt={member.name + ', ' + member.role} />
          ))}
        </div>
      </Section>

      <CTA title="Work with people who care" description="We would be glad to hear about your plans." label="Get in touch" to="/contact" />
    </>
  );
}
