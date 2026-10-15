import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';

export default function PricingSection() {
  const [annual, setAnnual] = useState(true);

  const plans = [
    {
      name: 'Starter',
      price: '$0',
      period: 'forever',
      description: 'Ideal for indie hackers, students, and early prototyping experiments.',
      features: [
        '5 active AI generation projects',
        'Standard generation speed',
        'Clean React & Tailwind CSS exports',
        'In-browser live interactive preview',
        'Community Discord support',
      ],
      cta: 'Start Building Free',
      href: '/register',
      popular: false,
    },
    {
      name: 'Pro',
      price: annual ? '$19' : '$24',
      period: 'per month',
      description: 'For active creators, design engineers, and high-velocity founders.',
      features: [
        'Unlimited AI generation projects',
        'Access to Claude 3.5 Sonnet & GPT-4o',
        'Design system token synchronization',
        '1-click ZIP & direct GitHub export',
        'High-priority generation queue',
        'Early access to new agent tools',
      ],
      cta: 'Get Started with Pro',
      href: '/register',
      popular: true,
    },
    {
      name: 'Team & Enterprise',
      price: annual ? '$79' : '$99',
      period: 'per seat / month',
      description: 'For scaling companies needing team collaboration and compliance.',
      features: [
        'Everything in Pro, unlimited seats',
        'Multiplayer collaborative canvas',
        'Custom Figma & design token ingestion',
        'SOC 2 Type II & HIPAA compliance',
        'Dedicated SLA & custom model fine-tuning',
        'SSO/SAML authentication',
      ],
      cta: 'Contact Enterprise',
      href: '/register',
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="w-full py-20 sm:py-28 bg-white border-t border-[#DDE2E5]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-12">
          <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-zinc-900 font-mono mb-3 bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
            Simple Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-900 tracking-tight mb-4">
            Transparent plans for creators of all scales
          </h2>
          <p className="text-base sm:text-lg text-zinc-500 max-w-xl mx-auto mb-8">
            No hidden fees. Export production-grade code on any plan and own your software completely.
          </p>

          {/* Billing Interval Toggle */}
          <div className="inline-flex items-center gap-3 p-1 rounded-full bg-zinc-100 border border-zinc-200 text-xs font-semibold select-none">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-full transition-all ${
                !annual 
                  ? 'bg-white text-zinc-900 shadow-xs' 
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                annual 
                  ? 'bg-white text-zinc-900 shadow-xs' 
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <span>Annual</span>
              <span className="bg-zinc-200 text-zinc-800 text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-[18px] bg-white p-8 flex flex-col justify-between transition-all duration-300 ${
                plan.popular
                  ? 'border-2 border-zinc-900 shadow-[0_16px_36px_rgba(0,0,0,0.08)] relative scale-100 lg:scale-105'
                  : 'border border-[#DDE2E5] shadow-xs hover:shadow-md'
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-zinc-900 text-white text-[11px] font-bold uppercase tracking-wider font-mono px-3 py-1 rounded-full shadow-sm flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-zinc-300" />
                  Most Popular
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
                <div className="flex items-baseline gap-1.5 mb-6 pb-6 border-b border-zinc-100">
                  <span className="text-4xl sm:text-5xl font-extrabold text-zinc-900 tracking-tight font-mono">
                    {plan.price}
                  </span>
                  <span className="text-xs text-zinc-400 font-medium">/{plan.period}</span>
                </div>

                {/* Features list */}
                <div className="space-y-3 mb-8">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 font-mono block mb-2">
                    Included features
                  </span>
                  {plan.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-zinc-600">
                      <Check className="w-4 h-4 text-zinc-900 shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA Button */}
              <Link to={plan.href} className="w-full">
                <button
                  className={`w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs active:scale-[0.98] ${
                    plan.popular
                      ? 'bg-zinc-900 hover:bg-black text-white shadow-zinc-900/20'
                      : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
                  }`}
                >
                  {plan.cta}
                </button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
