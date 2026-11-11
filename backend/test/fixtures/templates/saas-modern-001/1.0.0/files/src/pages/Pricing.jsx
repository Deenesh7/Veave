import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';

const plans = [
  { name: 'Starter', monthly: 0, annual: 0, description: 'For individuals and small projects.', features: ['Up to 3 projects', 'Basic reporting', 'Community support'], featured: false },
  { name: 'Team', monthly: 24, annual: 19, description: 'For growing teams that need control.', features: ['Unlimited projects', 'Advanced dashboards', 'Role based access', 'Priority support'], featured: true },
  { name: 'Business', monthly: 59, annual: 49, description: 'For organisations with security needs.', features: ['Everything in Team', 'Single sign-on', 'Audit log', 'Dedicated manager'], featured: false }
];

const faqs = [
  { q: 'Can I change plans later?', a: 'Yes. Upgrade or downgrade at any time and the difference is prorated.' },
  { q: 'Is there a free trial?', a: 'Every paid plan starts with a 14 day trial and no card is required.' },
  { q: 'Do you offer discounts?', a: 'Annual billing saves around 20 percent and nonprofits receive a further discount.' }
];

export default function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <>
      <Section>
        <SectionHeading eyebrow="Pricing" title="Simple pricing that scales with you" description="Start free and upgrade when you are ready." align="center" />
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          <span className={annual ? 'text-muted' : 'font-semibold'}>Monthly</span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label="Toggle annual billing"
            onClick={() => setAnnual((value) => !value)}
            className="relative h-7 w-12 rounded-full border border-line bg-surface-2 transition"
          >
            <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-brand transition-all ' + (annual ? 'left-6' : 'left-1')} />
          </button>
          <span className={annual ? 'font-semibold' : 'text-muted'}>Annual <span className="text-brand">(save 20%)</span></span>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.name} className={'rounded-card border border-line bg-surface flex flex-col p-8 ' + (plan.featured ? 'border-brand ring-1 ring-brand' : '')}>
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-2 text-sm text-muted">{plan.description}</p>
              <p className="mt-6 text-4xl font-bold">
                {'$' + (annual ? plan.annual : plan.monthly)}
                <span className="text-base font-normal text-muted"> /user /month</span>
              </p>
              <ul className="mt-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 text-brand" aria-hidden="true" /> {feature}
                  </li>
                ))}
              </ul>
              <Link to="/contact" className="inline-flex items-center gap-2 rounded-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 mt-8 justify-center">Choose {plan.name}</Link>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <dl className="mt-10 grid gap-6 md:grid-cols-3">
          {faqs.map((item) => (
            <div key={item.q} className="rounded-card border border-line bg-surface p-6">
              <dt className="font-semibold">{item.q}</dt>
              <dd className="mt-2 text-sm text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
