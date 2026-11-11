import React from 'react';
import { LineChart, ShieldCheck, Briefcase, Users, FileText, Globe } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';

const services = [
  { icon: LineChart, title: 'Growth strategy', description: 'Market entry, pricing and positioning built on evidence.' },
  { icon: ShieldCheck, title: 'Risk and compliance', description: 'Policies, controls and audits that stand up to scrutiny.' },
  { icon: Briefcase, title: 'Operations', description: 'Workflows, tooling and governance that scale with you.' },
  { icon: Users, title: 'People and culture', description: 'Leadership coaching, hiring plans and team design.' },
  { icon: FileText, title: 'Financial planning', description: 'Budgeting, forecasting and funding readiness.' },
  { icon: Globe, title: 'International expansion', description: 'Local partners, regulations and launch planning.' }
];

const steps = [
  { title: 'Discover', text: 'We listen, review your data and agree what success looks like.' },
  { title: 'Plan', text: 'We design a roadmap with owners, milestones and measures.' },
  { title: 'Deliver', text: 'We work alongside your team to put the plan into practice.' },
  { title: 'Sustain', text: 'We track results and hand over with confidence.' }
];

export default function Services() {
  return (
    <>
      <Section>
        <SectionHeading eyebrow="Services" title="Expertise across the whole business" description="Choose a single service or a complete programme." />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <FeatureCard key={service.title} {...service} />
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <img src="/images/card-1.svg" alt="Four stage delivery process" loading="lazy" className="w-full rounded-card border border-line object-cover" />
          <div>
            <SectionHeading eyebrow="Our process" title="A clear path from idea to result" />
            <ol className="mt-8 space-y-6">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand">{index + 1}</span>
                  <div>
                    <p className="font-semibold">{step.title}</p>
                    <p className="text-sm text-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      <CTA title="Not sure where to start?" description="A first conversation is always free." label="Talk to an advisor" to="/contact" />
    </>
  );
}
