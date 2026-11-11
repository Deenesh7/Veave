import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, ShieldCheck, BarChart3, Users, Star } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';
import { site } from '../data/site';

const logos = ['Northwind', 'Acme Labs', 'Globex', 'Initech', 'Umbrella'];

const features = [
  { icon: Zap, title: 'Fast by default', description: 'Create projects, assign work and see progress update in real time without refreshing.', image: '/images/card-1.svg' },
  { icon: ShieldCheck, title: 'Secure workspaces', description: 'Role based access, audit history and encrypted storage keep every workspace protected.', image: '/images/card-2.svg' },
  { icon: BarChart3, title: 'Clear reporting', description: 'Dashboards turn activity into the numbers your team needs to make the next decision.', image: '/images/card-3.svg' }
];

const stats = [
  { value: '12k+', label: 'Teams onboarded' },
  { value: '99.99%', label: 'Uptime' },
  { value: '4.9/5', label: 'Average rating' }
];

const steps = [
  { title: 'Create a workspace', text: 'Invite your team and import existing projects in a few minutes, with no training needed.' },
  { title: 'Plan the work', text: 'Break goals into tasks with owners and dates, then reshuffle the plan with a single drag.' },
  { title: 'Ship and learn', text: 'Follow progress live and review what worked at the end of every cycle to keep improving.' }
];

const testimonials = [
  { quote: 'We replaced three tools with ' + site.name + ' and our planning meetings are half as long.', name: 'Maya Torres', role: 'Head of Product, Northwind' },
  { quote: 'Onboarding took an afternoon. The reporting alone paid for the first year.', name: 'Daniel Okafor', role: 'COO, Acme Labs' },
  { quote: 'Our engineers actually enjoy keeping the board up to date.', name: 'Priya Nair', role: 'CTO, Globex' }
];

export default function Home() {
  return (
    <>
      <Section className="pb-12 sm:pb-16">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
              <Star className="h-3.5 w-3.5 text-brand" aria-hidden="true" /> Trusted by 12,000 teams
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              The workspace where great teams get things done
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">{site.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90">
                Start free trial <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/features" className="inline-flex items-center gap-2 rounded-button border border-line px-5 py-2.5 text-sm font-semibold transition hover:bg-surface">See features</Link>
            </div>
          </div>
          <img src="/images/hero.svg" alt="Product dashboard showing tasks and a growth chart" className="w-full rounded-card border border-line object-cover shadow-2xl" />
        </div>
      </Section>

      <Section tone="alt" className="py-10 sm:py-12">
        <p className="text-center text-sm text-muted">Teams that ship with {site.name}</p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-lg font-semibold text-muted">
          {logos.map((logo) => (
            <li key={logo}>{logo}</li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHeading eyebrow="Features" title="Everything your team needs, nothing it does not" description="Built for planning, collaboration and measurement from the first day." />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="How it works" title="From first task to shipped in three steps" align="center" />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-card border border-line bg-surface p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-on-brand">{index + 1}</span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <div className="grid gap-8 text-center sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-4xl font-bold text-brand">{stat.value}</p>
              <p className="mt-2 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Customers" title="Loved by teams of every size" align="center" />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {testimonials.map((item) => (
            <figure key={item.name} className="rounded-card border border-line bg-surface p-6">
              <Users className="h-5 w-5 text-brand" aria-hidden="true" />
              <blockquote className="mt-4 text-sm leading-relaxed">&ldquo;{item.quote}&rdquo;</blockquote>
              <figcaption className="mt-5 text-sm">
                <span className="font-semibold">{item.name}</span>
                <span className="block text-muted">{item.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <CTA title="Ready to move faster?" description="Start a free trial. No credit card required." label="Start free trial" to="/contact" />
    </>
  );
}
