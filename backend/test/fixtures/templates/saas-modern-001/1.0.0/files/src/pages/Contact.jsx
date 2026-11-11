import React, { useState } from 'react';
import { Mail, MapPin, Clock, CheckCircle2 } from 'lucide-react';
import Section, { SectionHeading } from '../components/Section';
import { site } from '../data/site';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Contact() {
  const [values, setValues] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);

  const update = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (event) => {
    event.preventDefault();
    const next = {};
    if (!values.name.trim()) next.name = 'Please enter your name.';
    if (!EMAIL_PATTERN.test(values.email.trim())) next.email = 'Please enter a valid email address.';
    if (values.message.trim().length < 10) next.message = 'Please write at least a short message.';
    setErrors(next);
    if (Object.keys(next).length === 0) {
      setSent(true);
      setValues({ name: '', email: '', message: '' });
    }
  };

  const field = 'mt-2 w-full rounded-button border border-line bg-bg px-4 py-3 text-sm outline-none transition focus:border-brand';

  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHeading eyebrow="Contact" title="Talk to the team" description="Questions about plans, security or a demo? Send a message and we will reply within one business day." />
          <ul className="mt-10 space-y-5 text-sm">
            <li className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 text-brand" aria-hidden="true" />
              <span>{site.email}</span>
            </li>
            <li className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 text-brand" aria-hidden="true" />
              <span>200 Market Street, San Francisco, CA</span>
            </li>
            <li className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 text-brand" aria-hidden="true" />
              <span>Monday to Friday, 9:00 to 18:00</span>
            </li>
          </ul>
        </div>

        <form onSubmit={submit} noValidate className="rounded-card border border-line bg-surface p-6 sm:p-8">
          {sent ? (
            <div role="status" className="mb-6 flex items-start gap-3 rounded-button bg-brand/10 p-4 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand" aria-hidden="true" />
              <span>Thank you. Your message was sent and we will reply shortly.</span>
            </div>
          ) : null}
          <label className="block text-sm font-medium" htmlFor="name">
            Name
            <input id="name" className={field} value={values.name} onChange={update('name')} autoComplete="name" />
          </label>
          {errors.name ? <p className="mt-1 text-xs text-red-500">{errors.name}</p> : null}
          <label className="mt-5 block text-sm font-medium" htmlFor="email">
            Email
            <input id="email" type="email" className={field} value={values.email} onChange={update('email')} autoComplete="email" />
          </label>
          {errors.email ? <p className="mt-1 text-xs text-red-500">{errors.email}</p> : null}
          <label className="mt-5 block text-sm font-medium" htmlFor="message">
            Message
            <textarea id="message" rows={5} className={field} value={values.message} onChange={update('message')} />
          </label>
          {errors.message ? <p className="mt-1 text-xs text-red-500">{errors.message}</p> : null}
          <button type="submit" className="inline-flex items-center gap-2 rounded-button bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 mt-6">Send message</button>
        </form>
      </div>
    </Section>
  );
}
