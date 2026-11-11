import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import CTA from '../components/CTA';

const rows = [
  { title: 'Plan with confidence', text: 'Roadmaps, milestones and dependencies stay linked, so a change in one place updates everywhere.', points: ['Timeline and board views', 'Dependency tracking', 'Automatic status updates'], image: '/images/card-1.svg' },
  { title: 'Collaborate without noise', text: 'Comments, mentions and approvals live next to the work, not in a hundred inboxes.', points: ['Threaded discussions', 'Role based approvals', 'Activity digests'], image: '/images/card-2.svg' },
  { title: 'Measure what matters', text: 'Live dashboards show throughput, cycle time and workload so you can act early.', points: ['Custom dashboards', 'Scheduled reports', 'CSV and API export'], image: '/images/card-3.svg' }
];

const integrations = ['Slack', 'GitHub', 'Google Workspace', 'Jira import', 'Zapier', 'Webhooks'];

export default function Features() {
  return (
    <>
      <Section>
        <SectionHeading eyebrow="Features" title="A complete toolkit for modern teams" description="Powerful where it counts and simple everywhere else." />
        <div className="mt-16 space-y-20">
          {rows.map((row, index) => (
            <div key={row.title} className="grid items-center gap-10 lg:grid-cols-2">
              <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <h3 className="text-2xl font-bold tracking-tight">{row.title}</h3>
                <p className="mt-4 text-muted">{row.text}</p>
                <ul className="mt-6 space-y-3">
                  {row.points.map((point) => (
                    <li key={point} className="flex items-center gap-3 text-sm">
                      <CheckCircle2 className="h-5 w-5 text-brand" aria-hidden="true" /> {point}
                    </li>
                  ))}
                </ul>
              </div>
              <img src={row.image} alt={row.title} loading="lazy" className="w-full rounded-card border border-line object-cover" />
            </div>
          ))}
        </div>
      </Section>

      <Section tone="alt">
        <SectionHeading eyebrow="Integrations" title="Works with the tools you already use" />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((name) => (
            <li key={name} className="rounded-card border border-line bg-surface px-5 py-4 text-sm font-medium">{name}</li>
          ))}
        </ul>
      </Section>

      <CTA title="See it with your own data" description="Book a walkthrough or start a trial today." label="Talk to us" to="/contact" />
    </>
  );
}
