import React, { useState, useMemo } from 'react';
import { 
  X, 
  Search, 
  Component as ComponentIcon, 
  Layout, 
  CreditCard, 
  Table, 
  Layers, 
  Sparkles, 
  Check, 
  Grid, 
  FormInput, 
  MessageSquare,
  ArrowRight
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';

export const COMPONENT_CATALOG = [
  {
    id: 'hero-split',
    name: 'Modern Split Hero Section',
    category: 'Hero & Headers',
    description: 'Headline, subhead, dual CTA buttons with badge, and interactive product mockup preview.',
    promptSpec: 'Add a modern split Hero section with a bold headline, pill badge, two primary/ghost CTA buttons, and a live product dashboard mockup.',
    tags: ['Hero', 'CTA', 'Mockup', 'Responsive']
  },
  {
    id: 'navbar-glass',
    name: 'Frosted Glass Sticky Navbar',
    category: 'Navigation',
    description: 'Sticky top navigation with backdrop blur, brand logo, navigation links, and action buttons.',
    promptSpec: 'Add a sticky frosted-glass navigation bar with brand logo, smooth navigation anchors, search trigger, and an action button.',
    tags: ['Navbar', 'Sticky', 'Blur', 'Header']
  },
  {
    id: 'bento-grid',
    name: 'Bento Grid Feature Showcase',
    category: 'Cards & Grids',
    description: 'Asymmetric 3-column bento grid highlighting core product features with icons and metric counters.',
    promptSpec: 'Add an asymmetric Bento Grid feature section with 5 cards: 1 large spotlight card, 2 medium metric cards, and 2 mini utility cards with hover glow.',
    tags: ['Bento', 'Features', 'Grid', 'Highlights']
  },
  {
    id: 'pricing-tiers',
    name: '3-Tier SaaS Pricing Table',
    category: 'Pricing',
    description: 'Monthly and annual billing toggle, highlighted Pro tier with badge, and feature checklists.',
    promptSpec: 'Add a responsive 3-tier SaaS pricing table with Monthly/Annual toggle, a highlighted popular plan card, and clean checkmark feature rows.',
    tags: ['Pricing', 'Billing', 'Toggle', 'Conversion']
  },
  {
    id: 'stats-metrics',
    name: 'Metric & KPI Stat Strip',
    category: 'Cards & Grids',
    description: '4-column KPI counter bar showing total volume, active users, uptime, and latency with trend badges.',
    promptSpec: 'Add a 4-card metric strip showing key metrics ($4.2M Volume, 42K Users, 99.9% Uptime, 24ms Latency) with percentage gain badges.',
    tags: ['Stats', 'KPI', 'Analytics', 'Metrics']
  },
  {
    id: 'data-table',
    name: 'Interactive Data Table with Filters',
    category: 'Data & Lists',
    description: 'Sortable table headers, status pills, search query filter, and paginated navigation footer.',
    promptSpec: 'Add an interactive data table with search filtering, sortable column headers, status color pills, and pagination controls.',
    tags: ['Table', 'Pagination', 'Sorting', 'Filters']
  },
  {
    id: 'contact-form',
    name: 'Validated Contact & Lead Form',
    category: 'Forms & Inputs',
    description: 'Clean responsive form with floating labels, email validation, inquiry dropdown, and submit state.',
    promptSpec: 'Add a validated contact form with Name, Work Email, Company Size select dropdown, message textarea, and a submission loading state.',
    tags: ['Form', 'Inputs', 'Validation', 'Lead']
  },
  {
    id: 'testimonials-grid',
    name: 'Customer Testimonials & Social Proof',
    category: 'Feedback',
    description: 'Customer quote cards with avatar, name, verified customer badge, and star rating display.',
    promptSpec: 'Add a customer testimonial grid with 3 quote cards featuring user avatars, role/company tags, and 5-star ratings.',
    tags: ['Testimonials', 'Social Proof', 'Reviews', 'Quotes']
  },
  {
    id: 'faq-accordion',
    name: 'Interactive FAQ Accordion',
    category: 'Feedback',
    description: 'Expandable question items with smooth chevron transitions and categorized accordion panels.',
    promptSpec: 'Add an interactive FAQ accordion section with 5 expandable question items and smooth height transitions.',
    tags: ['FAQ', 'Accordion', 'Collapse', 'Support']
  },
  {
    id: 'footer-mega',
    name: 'Modern Multi-Column Footer',
    category: 'Navigation',
    description: '4-column site directory, newsletter input form, social links, and copyright legal bar.',
    promptSpec: 'Add a multi-column footer with company bio, product links, resources links, legal links, newsletter subscription input, and social icons.',
    tags: ['Footer', 'Sitemap', 'Newsletter', 'Links']
  }
];

const CATEGORIES = ['All', 'Navigation', 'Hero & Headers', 'Cards & Grids', 'Pricing', 'Data & Lists', 'Forms & Inputs', 'Feedback'];

export default function AddComponentModal({
  isOpen,
  onClose,
  onSelectComponent
}) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [recentlyAddedId, setRecentlyAddedId] = useState(null);

  const filteredComponents = useMemo(() => {
    return COMPONENT_CATALOG.filter((comp) => {
      const matchesCategory = selectedCategory === 'All' || comp.category === selectedCategory;
      const q = search.toLowerCase().trim();
      const matchesSearch = !q || 
        comp.name.toLowerCase().includes(q) ||
        comp.description.toLowerCase().includes(q) ||
        comp.tags.some(t => t.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [search, selectedCategory]);

  const handleSelect = (comp) => {
    setRecentlyAddedId(comp.id);
    onSelectComponent?.(comp);
    setTimeout(() => {
      setRecentlyAddedId(null);
      onClose?.();
    }, 400);
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Add Component"
      description="Choose pre-designed, responsive component primitives to insert into your prototype."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Search bar & Category filter */}
        <div className="space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search components (e.g. Hero, Navbar, Pricing, Table)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] text-zinc-900 transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none select-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-zinc-900 text-white font-semibold'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Component Grid */}
        <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
          {filteredComponents.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <ComponentIcon className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
              <p className="text-xs font-medium">No components found</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">Try searching with a different term</p>
            </div>
          ) : (
            filteredComponents.map((comp) => {
              const isSelected = recentlyAddedId === comp.id;

              return (
                <div
                  key={comp.id}
                  onClick={() => handleSelect(comp)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer group flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-200'
                      : 'border-zinc-200 bg-white hover:border-[#52525B] hover:shadow-xs'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-xs text-[#111827] group-hover:text-[#52525B] transition-colors">
                        {comp.name}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                        {comp.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#64748B] leading-relaxed line-clamp-2">
                      {comp.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {comp.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded border border-zinc-100"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Insert ${comp.name}`}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                      isSelected
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-100 group-hover:bg-zinc-900 text-zinc-700 group-hover:text-white'
                    }`}
                  >
                    {isSelected ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Added</span>
                      </>
                    ) : (
                      <>
                        <span>Insert</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Click any component to insert into prompt context</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
