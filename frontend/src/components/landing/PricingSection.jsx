import React from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Sparkles } from 'lucide-react';

export default function PricingSection() {
  const plans = [
    {
      name: 'Free Tier',
      price: '₹0',
      period: 'Free forever',
      description: 'Essential tools to get started.',
      features: [
        { text: '50 Included Credits', ok: true },
        { text: '1,000,000 Monthly Tokens', ok: true },
        { text: '5 GB File Storage', ok: true },
        { text: '5 Projects total limit', ok: true },
        { text: 'Unlimited Static Pages', ok: true },
        { text: 'Standard Components', ok: true },
        { text: 'Custom Domains', ok: false },
        { text: 'Veave watermark included', ok: false },
      ],
      cta: 'Start Building Free',
      href: '/register',
    },
    {
      name: 'Plus Plan',
      price: '₹2999',
      period: 'per month',
      description: 'For creators & scaling websites.',
      features: [
        { text: '250 Included Credits', ok: true },
        { text: '5,000,000 Monthly Tokens', ok: true },
        { text: '50 GB File Storage', ok: true },
        { text: '15 Projects total limit', ok: true },
        { text: 'Buy Extra Credits @ ₹12 / credit', ok: true },
        { text: 'Connect Custom Domains', ok: true },
        { text: '1 Active Custom Domain', ok: true },
        { text: 'No watermark', ok: true },
      ],
      cta: 'Get Started with Plus',
      href: '/register',
    },
    {
      name: 'Pro Plan',
      badge: 'MOST POPULAR',
      popular: true,
      price: '₹5999',
      period: 'per month',
      description: 'For businesses & professionals.',
      features: [
        { text: '750 Included Credits', ok: true },
        { text: '15,000,000 Monthly Tokens', ok: true },
        { text: '100 GB File Storage', ok: true },
        { text: '100 Projects total limit', ok: true },
        { text: 'Buy Extra Credits @ ₹12 / credit', ok: true },
        { text: '3 Active Custom Domains', ok: true },
        { text: 'Unlimited Team Members', ok: true },
        { text: 'Connect Custom Domains', ok: true },
        { text: 'No watermark', ok: true },
      ],
      cta: 'Get Started with Pro',
      href: '/register',
    },
    {
      name: 'Enterprise',
      badge: 'ENTERPRISE',
      price: 'Custom',
      period: 'Billed after usage • Invoiced',
      description: 'Enterprise plan with post-paid billing.',
      features: [
        { text: 'Post-paid billing & custom limits', ok: true },
        { text: 'Pay after usage with monthly invoice', ok: true },
        { text: 'Consolidated team management', ok: true },
        { text: 'Unlimited Custom Domains', ok: true },
        { text: 'Dedicated account manager & SLA', ok: true },
        { text: 'No watermark & priority queues', ok: true },
      ],
      cta: 'Contact Sales',
      href: 'mailto:sales@veave.ai?subject=Enterprise%20Plan%20Inquiry',
      external: true,
    },
  ];

  return (
    <section id="pricing" className="w-full py-20 sm:py-28 bg-white border-t border-[#DDE2E5]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div data-stagger className="max-w-3xl mx-auto text-center mb-12">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-3 bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
            Simple Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight mb-4">
            Transparent plans for creators of all scales
          </h2>
          <p className="text-base sm:text-lg text-zinc-500 max-w-xl mx-auto mb-2">
            No hidden fees. Export production-grade code on any plan and own your software completely.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div data-stagger="x" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-[18px] bg-white p-6 relative flex flex-col justify-between transition-all duration-300 ${
                plan.popular
                  ? 'border-2 border-zinc-900 shadow-[0_16px_36px_rgba(0,0,0,0.08)]'
                  : 'border border-[#DDE2E5] shadow-xs hover:shadow-md'
              }`}
            >
              {/* Popular Badge */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[11px] font-bold uppercase tracking-wider font-mono px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                  {plan.popular && <Sparkles className="w-3 h-3 text-zinc-300" />}
                  {plan.badge}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-bold text-zinc-900">{plan.name}</h3>
                </div>
                <p className="text-xs text-zinc-500 mb-6 leading-relaxed min-h-[36px]">
                  {plan.description}
                </p>

                {/* Price Display */}
                <div className="flex flex-col mb-6 pb-6 border-b border-zinc-100">
                  <span className="text-3xl font-extrabold text-zinc-900 tracking-tight font-mono">
                    {plan.price}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-medium mt-1">{plan.period}</span>
                </div>

                {/* Features list */}
                <div className="space-y-3 mb-8">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 font-mono block mb-2">
                    Included features
                  </span>
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-zinc-600">
                      {feature.ok ? <Check className="w-4 h-4 text-zinc-900 shrink-0 mt-0.5" /> : <X className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />}
                      <span>{feature.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA Button */}
              {React.createElement(plan.external ? 'a' : Link, plan.external ? { href: plan.href, className: 'w-full' } : { to: plan.href, className: 'w-full' },
                <button
                  className={`w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs active:scale-[0.98] ${
                    plan.popular
                      ? 'bg-zinc-900 hover:bg-black text-white shadow-zinc-900/20'
                      : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
                  }`}
                >
                  {plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
