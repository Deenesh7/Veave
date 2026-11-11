import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LineChart, ShieldCheck, Briefcase, Quote } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import FeatureCard from '../components/FeatureCard';
import CTA from '../components/CTA';
import { site } from '../data/site';

const stats = [
  { value: '25+', label: 'Years of experience' },
  { value: '480', label: 'Clients served' },
  { value: '96%', label: 'Client retention' },
  { value: '14', label: 'Industry awards' }
];

const services = [
  { icon: LineChart, title: 'Growth strategy', description: 'Market analysis and clear roadmaps that connect ambition to measurable results.', image: '/images/card-1.svg' },
  { icon: ShieldCheck, title: 'Risk and compliance', description: 'Practical frameworks that keep you compliant without slowing the business down.', image: '/images/card-2.svg' },
  { icon: Briefcase, title: 'Operations', description: 'Process design and change support that make good plans stick.', image: '/images/card-3.svg' }
];

const industries = [
  { name: 'Manufacturing', text: 'Lean operations, supplier resilience and plant level performance programmes.' },
  { name: 'Retail and consumer', text: 'Pricing, assortment and omnichannel growth plans grounded in customer data.' },
  { name: 'Public sector', text: 'Service redesign, procurement support and transparent reporting for public bodies.' },
  { name: 'Professional services', text: 'Partner models, utilisation and client experience for firms that sell expertise.' }
];

const testimonials = [
  { quote: 'Meridian gave us a plan we could actually execute, and stayed to help us do it.', name: 'Helen Carter', role: 'Managing Director, Brightwell' },
  { quote: 'Calm, clear and commercially sharp. Exactly what we needed during our expansion.', name: 'Omar Haddad', role: 'Founder, Crescent Foods' }
];

export default function Home() {
  return (
    <>
      <Section tone="alt">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand">Trusted advisors since 1999</p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Advice you can rely on. Results you can measure.</h1>
            <p className="mt-6 max-w-xl text-lg text-muted">{site.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90">
                Request a consultation <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/services" className="inline-flex items-center gap-2 rounded-button border border-brand px-5 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand/5">Our services</Link>
            </div>
          </div>
          <img src="/images/hero.svg" alt="Advisors reviewing a business growth plan" className="w-full rounded-card border border-line object-cover shadow-lg" />
        </div>
      </Section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl font-extrabold text-brand">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <Section>
        <SectionHeading eyebrow="What we do" title="Services built around your goals" description="From first diagnosis to lasting change." />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {services.map((service) => (
            <FeatureCard key={service.title} {...service} />
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="Industries" title="Experience where it matters to you" description="We combine sector knowledge with practical delivery experience." />
        <dl className="mt-10 grid gap-6 sm:grid-cols-2">
          {industries.map((industry) => (
            <div key={industry.name} className="rounded-card border border-line bg-surface shadow-sm p-6">
              <dt className="font-semibold">{industry.name}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted">{industry.text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section tone="strong">
        <SectionHeading eyebrow="Clients" title="What our clients say" align="center" />
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {testimonials.map((item) => (
            <figure key={item.name} className="rounded-card border border-line bg-surface shadow-sm p-8">
              <Quote className="h-6 w-6 text-accent" aria-hidden="true" />
              <blockquote className="mt-4 leading-relaxed">{item.quote}</blockquote>
              <figcaption className="mt-5 text-sm">
                <span className="font-semibold">{item.name}</span>
                <span className="block text-muted">{item.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <CTA title="Let us talk about your next step" description="Book a no-obligation consultation with a senior advisor." label="Request a consultation" to="/contact" />
    </>
  );
}
