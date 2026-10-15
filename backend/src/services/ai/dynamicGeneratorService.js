const openrouterService = require('./openrouterService');
const logger = require('../../utils/logger');

// Design system generator based on inferred mood & prompt
function generateDesignSystem(prompt, userPreference = 'Modern') {
  const p = prompt.toLowerCase();
  
  // Strict Color Usage Rule: Default to neutral choices. Use blue or purple ONLY when explicitly requested.
  let primary = '#18181B';
  let secondary = '#71717A';
  let bg = '#F8F9FA';
  let cardBg = '#FFFFFF';
  let text = '#111827';
  let border = '#E2E5E8';
  let accent = '#27272A';
  let radius = '16px';
  let font = 'Inter, system-ui, sans-serif';
  let mood = 'Clean Neutral';

  const wantsBlue = /\b(?:blue|azure|cyan|sky|navy|cobalt)\b/.test(p);
  const wantsPurple = /\b(?:purple|violet|indigo|lavender|magenta)\b/.test(p);

  if (wantsBlue && wantsPurple) {
    primary = '#4F46E5';
    secondary = '#7C3AED';
    accent = '#2563EB';
    mood = 'Blue & Purple';
  } else if (wantsBlue) {
    primary = '#2563EB';
    secondary = '#64748B';
    accent = '#0EA5E9';
    mood = 'Blue Palette';
  } else if (wantsPurple) {
    primary = '#7C3AED';
    secondary = '#6D28D9';
    accent = '#A855F7';
    mood = 'Purple Palette';
  } else if (p.includes('dark') || p.includes('cyber') || p.includes('space') || p.includes('night') || p.includes('gaming')) {
    primary = '#F8FAFC';
    secondary = '#94A3B8';
    bg = '#09090B';
    cardBg = '#18181B';
    text = '#F8FAFC';
    border = '#27272A';
    accent = '#52525B';
    radius = '14px';
    font = 'Geist, Inter, sans-serif';
    mood = 'Deep Dark';
  } else if (p.includes('sneaker') || p.includes('fashion') || p.includes('street') || p.includes('sport') || p.includes('fitness')) {
    primary = '#F97316';
    secondary = '#71717A';
    bg = '#FAFAFA';
    cardBg = '#FFFFFF';
    text = '#18181B';
    border = '#E4E4E7';
    accent = '#EF4444';
    radius = '18px';
    font = 'Plus Jakarta Sans, sans-serif';
    mood = 'Bold & Dynamic';
  } else if (p.includes('finance') || p.includes('bank') || p.includes('crypto') || p.includes('money') || p.includes('invest') || p.includes('wealth')) {
    primary = '#10B981';
    secondary = '#64748B';
    bg = '#F0FDF4';
    cardBg = '#FFFFFF';
    text = '#064E3B';
    border = '#D1FAE5';
    accent = '#059669';
    radius = '12px';
    font = 'Inter, system-ui, sans-serif';
    mood = 'Trust & Prosperity';
  } else if (p.includes('restaurant') || p.includes('food') || p.includes('cafe') || p.includes('dining') || p.includes('bakery') || p.includes('chef')) {
    primary = '#E11D48';
    secondary = '#78716C';
    bg = '#FFFBEB';
    cardBg = '#FFFFFF';
    text = '#451A03';
    border = '#FDE68A';
    accent = '#D97706';
    radius = '20px';
    font = 'Playfair Display, Georgia, serif';
    mood = 'Warm & Artisanal';
  } else if (p.includes('student') || p.includes('attendance') || p.includes('school') || p.includes('education') || p.includes('learn') || p.includes('class')) {
    primary = '#0D9488';
    secondary = '#6B7280';
    bg = '#F0FDFA';
    cardBg = '#FFFFFF';
    text = '#134E4A';
    border = '#CCFBF1';
    accent = '#0F766E';
    radius = '14px';
    font = 'Plus Jakarta Sans, Inter, sans-serif';
    mood = 'Academic Focus';
  } else if (p.includes('ai') || p.includes('startup') || p.includes('tech') || p.includes('cloud') || p.includes('saas') || p.includes('software')) {
    primary = '#0F172A';
    secondary = '#475569';
    bg = '#F8FAFC';
    cardBg = '#FFFFFF';
    text = '#0F172A';
    border = '#E2E8F0';
    accent = '#334155';
    radius = '16px';
    font = 'Inter, system-ui, sans-serif';
    mood = 'Modern Tech';
  } else if (p.includes('portfolio') || p.includes('creative') || p.includes('design') || p.includes('studio') || p.includes('photograph')) {
    primary = '#18181B';
    secondary = '#71717A';
    bg = '#FFFFFF';
    cardBg = '#F4F4F5';
    text = '#09090B';
    border = '#E4E4E7';
    accent = '#E11D48';
    radius = '8px';
    font = 'Plus Jakarta Sans, sans-serif';
    mood = 'Minimalist Editorial';
  }

  // Adjust if user explicitly chose a preference
  if (userPreference === 'Minimal') {
    radius = '6px';
    bg = '#FFFFFF';
    cardBg = '#FAFAFA';
    border = '#E5E5E5';
  } else if (userPreference === 'Professional') {
    radius = '10px';
    primary = '#0F172A';
  } else if (userPreference === 'Creative') {
    radius = '24px';
    accent = '#F43F5E';
  }

  return {
    mood,
    primary,
    secondary,
    bg,
    cardBg,
    text,
    border,
    accent,
    radius,
    font,
    shadow: '0 10px 30px -10px rgba(0,0,0,0.06)'
  };
}

// Extract semantic entities & features from ANY prompt
function extractPromptSemantics(prompt) {
  const p = prompt.toLowerCase();
  
  // Extract clean title
  let title = prompt.split(/[.,?!;]/)[0]
    .replace(/^(build|create|design|generate|make|develop)\s+(an?|the)?\s*/i, '')
    .trim();
  if (!title) title = 'Custom Experience';
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Identify domain verbs & features
  const hasAuth = p.includes('login') || p.includes('auth') || p.includes('account') || p.includes('sign in');
  const hasSearch = p.includes('search') || p.includes('filter') || p.includes('find') || p.includes('lookup') || !p.includes('simple');
  const hasBooking = p.includes('book') || p.includes('reserve') || p.includes('table') || p.includes('schedule') || p.includes('slot');
  const hasAttendance = p.includes('attendance') || p.includes('roll') || p.includes('student') || p.includes('present') || p.includes('absent');
  const hasCart = p.includes('sneaker') || p.includes('ecommerce') || p.includes('shop') || p.includes('store') || p.includes('buy') || p.includes('price');
  const hasStats = p.includes('dashboard') || p.includes('analytics') || p.includes('stats') || p.includes('finance') || p.includes('metric');
  const hasPricing = p.includes('pricing') || p.includes('plan') || p.includes('tier') || p.includes('subscription');

  return {
    title,
    hasAuth,
    hasSearch,
    hasBooking,
    hasAttendance,
    hasCart,
    hasStats,
    hasPricing
  };
}

// Synthesize modular React components strictly matching the prompt
function synthesizeDynamicComponents(prompt, designSystem) {
  const sem = extractPromptSemantics(prompt);
  const ds = designSystem;

  // 1. Component: Navbar.jsx
  const navbarCode = `import React, { useState } from 'react';
import { Menu, X, Sparkles, Search, User, ArrowRight } from 'lucide-react';

export default function Navbar({ onAction, activeTab = 'Overview', setActiveTab }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = ['Overview', 'Explore', 'Features', 'Activity', 'Documentation'];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b" style={{ borderColor: '${ds.border}' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-3">
          <div 
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm font-bold text-sm tracking-wide transition-transform hover:scale-105"
            style={{ backgroundColor: '${ds.primary}', borderRadius: '${ds.radius}' }}
          >
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="font-extrabold text-base sm:text-lg tracking-tight" style={{ color: '${ds.text}' }}>
              ${sem.title}
            </span>
          </div>
        </div>

        {/* Desktop Nav Items */}
        <nav className="hidden md:flex items-center gap-1.5 bg-zinc-50 p-1 rounded-xl border" style={{ borderColor: '${ds.border}' }}>
          {navItems.map((item) => {
            const isActive = activeTab === item;
            return (
              <button
                key={item}
                onClick={() => setActiveTab && setActiveTab(item)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                style={{
                  backgroundColor: isActive ? '${ds.primary}' : 'transparent',
                  color: isActive ? '#FFFFFF' : '${ds.secondary}',
                }}
              >
                {item}
              </button>
            );
          })}
        </nav>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button 
            onClick={onAction}
            className="px-4 py-2 text-xs font-bold rounded-xl text-white shadow-sm transition-all hover:opacity-90 active:scale-95 flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: '${ds.primary}', borderRadius: '${ds.radius}' }}
          >
            <span>Get Started</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-xl text-zinc-600 hover:bg-zinc-100"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden px-4 pt-2 pb-4 bg-white border-b space-y-1" style={{ borderColor: '${ds.border}' }}>
          {navItems.map((item) => (
            <button
              key={item}
              onClick={() => {
                setActiveTab && setActiveTab(item);
                setMobileMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm font-medium rounded-lg text-zinc-700 hover:bg-zinc-100"
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}`;

  // 2. Component: Hero.jsx
  const heroCode = `import React, { useState } from 'react';
import { Sparkles, ArrowRight, ShieldCheck, Zap, Star, CheckCircle2 } from 'lucide-react';

export default function Hero({ onPrimaryClick, onSecondaryClick }) {
  return (
    <section className="relative overflow-hidden pt-12 pb-14 sm:pt-16 sm:pb-20 text-center">
      {/* Decorative ambient background blur */}
      <div 
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-72 rounded-full blur-3xl opacity-20 pointer-events-none -z-10"
        style={{ background: 'radial-gradient(circle, ${ds.primary} 0%, ${ds.accent} 100%)' }}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Subtle pill tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold mb-6 border shadow-2xs animate-fade-in"
          style={{ backgroundColor: '#FFFFFF', borderColor: '${ds.border}', color: '${ds.primary}' }}>
          <Sparkles className="w-3.5 h-3.5" />
          <span>${ds.mood} · Designed for ${sem.title}</span>
        </div>

        {/* Dynamic Heading directly echoing user request */}
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight mb-5" style={{ color: '${ds.text}' }}>
          The Intelligent Platform for <span style={{ color: '${ds.primary}' }}>${sem.title}</span>
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed font-normal" style={{ color: '${ds.secondary}' }}>
          Experience a dynamic, high-performance interface carefully tailored for ${sem.title.toLowerCase()}. Built with responsive components, real-time interactivity, and fluid user workflows.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
          <button
            onClick={onPrimaryClick}
            className="w-full sm:w-auto px-6 py-3.5 text-sm font-bold rounded-xl text-white shadow-md transition-all hover:scale-102 active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
            style={{ backgroundColor: '${ds.primary}', borderRadius: '${ds.radius}' }}
          >
            <span>Explore Experience</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={onSecondaryClick}
            className="w-full sm:w-auto px-6 py-3.5 text-sm font-semibold rounded-xl bg-white border shadow-2xs hover:bg-zinc-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            style={{ borderColor: '${ds.border}', color: '${ds.text}', borderRadius: '${ds.radius}' }}
          >
            <span>View Documentation</span>
          </button>
        </div>

        {/* Trust & Highlights Row */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-medium text-zinc-500 pt-4 border-t" style={{ borderColor: '${ds.border}' }}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Instant Deployment</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-500" />
            <span>Enterprise Certified</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span>Real-time Interactive</span>
          </div>
        </div>
      </div>
    </section>
  );
}`;

  // 3. Component: InteractiveSection.jsx (Dynamic Domain Core)
  let interactiveCode = '';

  if (sem.hasAttendance) {
    interactiveCode = `import React, { useState } from 'react';
import { Users, CheckCircle, XCircle, Clock, Search, Filter, Plus, Calendar } from 'lucide-react';

export default function InteractiveSection() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [students, setStudents] = useState([
    { id: 1, name: 'Emma Watson', rollNo: 'STU-101', section: 'Grade 10-A', status: 'Present', time: '08:45 AM' },
    { id: 2, name: 'Liam Neeson', rollNo: 'STU-102', section: 'Grade 10-A', status: 'Present', time: '08:48 AM' },
    { id: 3, name: 'Sophia Turner', rollNo: 'STU-103', section: 'Grade 10-A', status: 'Late', time: '09:12 AM' },
    { id: 4, name: 'Noah Centineo', rollNo: 'STU-104', section: 'Grade 10-A', status: 'Absent', time: '-' },
    { id: 5, name: 'Olivia Rodrigo', rollNo: 'STU-105', section: 'Grade 10-A', status: 'Present', time: '08:52 AM' },
    { id: 6, name: 'Ethan Hawke', rollNo: 'STU-106', section: 'Grade 10-A', status: 'Present', time: '08:55 AM' },
  ]);

  const toggleStatus = (id, newStatus) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, status: newStatus, time: newStatus === 'Absent' ? '-' : 'Just now' } : s));
  };

  const markAll = (status) => {
    setStudents(prev => prev.map(s => ({ ...s, status, time: status === 'Absent' ? '-' : '08:50 AM' })));
  };

  const filtered = students.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.rollNo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'All' || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const presentCount = students.filter(s => s.status === 'Present').length;
  const lateCount = students.filter(s => s.status === 'Late').length;
  const absentCount = students.filter(s => s.status === 'Absent').length;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Metric Cards Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border shadow-2xs" style={{ borderColor: '${ds.border}' }}>
          <span className="text-xs font-medium text-zinc-500">Total Enrolled</span>
          <h3 className="text-2xl font-black mt-1 text-zinc-900">{students.length}</h3>
          <span className="text-[11px] text-zinc-400 font-mono">Academic Term 2026</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-2xs" style={{ borderColor: '${ds.border}' }}>
          <span className="text-xs font-medium text-emerald-600">Present Today</span>
          <h3 className="text-2xl font-black mt-1 text-emerald-600">{presentCount}</h3>
          <span className="text-[11px] text-emerald-500 font-semibold">{Math.round((presentCount/students.length)*100)}% Attendance rate</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-2xs" style={{ borderColor: '${ds.border}' }}>
          <span className="text-xs font-medium text-amber-600">Late Arrivals</span>
          <h3 className="text-2xl font-black mt-1 text-amber-600">{lateCount}</h3>
          <span className="text-[11px] text-amber-500 font-mono">Requires notice</span>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-2xs" style={{ borderColor: '${ds.border}' }}>
          <span className="text-xs font-medium text-rose-600">Absent</span>
          <h3 className="text-2xl font-black mt-1 text-rose-600">{absentCount}</h3>
          <span className="text-[11px] text-rose-500 font-mono">Automated SMS sent</span>
        </div>
      </div>

      {/* Attendance Table Panel */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: '${ds.border}' }}>
        <div className="p-4 sm:p-5 border-b flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ borderColor: '${ds.border}' }}>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-zinc-900">Student Roll Call</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold">Today's Session</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input 
                type="text"
                placeholder="Search student or ID..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-indigo-200"
                style={{ borderColor: '${ds.border}' }}
              />
            </div>
            <button onClick={() => markAll('Present')} className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer">
              Mark All Present
            </button>
          </div>
        </div>

        {/* Table Rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 border-b text-zinc-400 font-mono uppercase" style={{ borderColor: '${ds.border}' }}>
              <tr>
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Roll ID</th>
                <th className="px-5 py-3">Section</th>
                <th className="px-5 py-3">Check-in</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-zinc-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-bold text-zinc-900">{s.name}</td>
                  <td className="px-5 py-3.5 font-mono text-zinc-500">{s.rollNo}</td>
                  <td className="px-5 py-3.5 text-zinc-600">{s.section}</td>
                  <td className="px-5 py-3.5 font-mono text-zinc-500">{s.time}</td>
                  <td className="px-5 py-3.5">
                    <span className={\`px-2.5 py-1 rounded-full text-[10px] font-bold \${
                      s.status === 'Present' ? 'bg-emerald-100 text-emerald-800' :
                      s.status === 'Late' ? 'bg-amber-100 text-amber-800' :
                      'bg-rose-100 text-rose-800'
                    }\`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right space-x-1">
                    <button onClick={() => toggleStatus(s.id, 'Present')} className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold cursor-pointer">P</button>
                    <button onClick={() => toggleStatus(s.id, 'Late')} className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold cursor-pointer">L</button>
                    <button onClick={() => toggleStatus(s.id, 'Absent')} className="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold cursor-pointer">A</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}`;
  } else if (sem.hasCart) {
    interactiveCode = `import React, { useState } from 'react';
import { ShoppingBag, Star, Plus, Minus, Trash2, Heart, ArrowRight } from 'lucide-react';

export default function InteractiveSection() {
  const [cart, setCart] = useState([]);
  const [filter, setFilter] = useState('All');
  const [liked, setLiked] = useState({});

  const catalog = [
    { id: 1, name: 'AeroGlide Elite Runner', category: 'Running', price: 175, rating: 4.9, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80', badge: 'Best Seller' },
    { id: 2, name: 'Vortex Retro Court 88', category: 'Lifestyle', price: 130, rating: 4.8, image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&q=80', badge: 'Trending' },
    { id: 3, name: 'Phantom Carbon Trail', category: 'Outdoor', price: 210, rating: 5.0, image: 'https://images.unsplash.com/photo-1551107696-a4b0c5a0d9a2?w=600&q=80', badge: 'New Arrival' },
    { id: 4, name: 'Echo Minimalist Low-Top', category: 'Lifestyle', price: 115, rating: 4.7, image: 'https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=600&q=80', badge: 'Sale' }
  ];

  const addToCart = (item) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id);
      if (ex) return prev.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id));
  const toggleLike = (id) => setLiked(prev => ({ ...prev, [id]: !prev[id] }));

  const filtered = filter === 'All' ? catalog : catalog.filter(i => i.category === filter);
  const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Category Tabs & Cart Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-black tracking-tight" style={{ color: '${ds.text}' }}>Featured Collection</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Explore premium silhouettes crafted for performance.</p>
        </div>

        <div className="flex items-center gap-2">
          {['All', 'Running', 'Lifestyle', 'Outdoor'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={\`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer \${
                filter === cat ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              }\`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Products */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {filtered.map((item) => (
          <div 
            key={item.id} 
            className="bg-white rounded-2xl border overflow-hidden shadow-2xs hover:shadow-md transition-all group flex flex-col justify-between"
            style={{ borderColor: '${ds.border}' }}
          >
            <div className="relative aspect-4/3 bg-zinc-100 overflow-hidden">
              <img src={item.image} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              <span className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/90 backdrop-blur-xs text-zinc-900 shadow-2xs">
                {item.badge}
              </span>
              <button 
                onClick={() => toggleLike(item.id)} 
                className="absolute top-3 right-3 p-1.5 rounded-full bg-white/90 text-zinc-700 hover:text-rose-500 transition-colors"
              >
                <Heart className={\`w-4 h-4 \${liked[item.id] ? 'fill-rose-500 text-rose-500' : ''}\`} />
              </button>
            </div>

            <div className="p-4 flex-1 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-zinc-400 font-semibold">{item.category}</span>
                <h4 className="font-bold text-sm text-zinc-900 mt-0.5">{item.name}</h4>
                <div className="flex items-center gap-1 mt-1 text-amber-400">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span className="text-xs font-bold text-zinc-700">{item.rating}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 mt-3 border-t border-zinc-100">
                <span className="text-base font-black text-zinc-900">\${item.price}</span>
                <button
                  onClick={() => addToCart(item)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-transform active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  style={{ backgroundColor: '${ds.primary}' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Sticky Drawer Bar if items in cart */}
      {cart.length > 0 && (
        <div className="mt-8 p-4 rounded-2xl bg-zinc-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-zinc-300">Cart Total ({cart.reduce((s, i) => s + i.qty, 0)} items)</span>
              <h4 className="text-lg font-black">\${total}</h4>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setCart([])} className="px-3 py-2 text-xs text-zinc-400 hover:text-white transition-colors">Clear</button>
            <button className="px-5 py-2.5 rounded-xl bg-white text-zinc-900 text-xs font-bold hover:bg-zinc-100 transition-all cursor-pointer">Checkout Now</button>
          </div>
        </div>
      )}
    </section>
  );
}`;
  } else if (sem.hasBooking) {
    interactiveCode = `import React, { useState } from 'react';
import { Calendar, Clock, Users, Check, Sparkles, MapPin } from 'lucide-react';

export default function InteractiveSection() {
  const [partySize, setPartySize] = useState(2);
  const [selectedTime, setSelectedTime] = useState('7:30 PM');
  const [selectedDate, setSelectedDate] = useState('Tonight');
  const [confirmed, setConfirmed] = useState(false);

  const times = ['5:30 PM', '6:00 PM', '6:45 PM', '7:30 PM', '8:15 PM', '9:00 PM'];
  const dates = ['Tonight', 'Tomorrow', 'This Friday', 'This Saturday'];

  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white rounded-3xl border shadow-lg overflow-hidden p-6 sm:p-8" style={{ borderColor: '${ds.border}' }}>
        <div className="text-center max-w-lg mx-auto mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-600">Table Reservation</span>
          <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 mt-1">Book Your Culinary Experience</h2>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">Select your party size and preferred dining time.</p>
        </div>

        {confirmed ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-3">
              <Check className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-emerald-900">Reservation Confirmed!</h3>
            <p className="text-xs text-emerald-700 mt-1">Table for {partySize} on {selectedDate} at {selectedTime}. A confirmation SMS has been dispatched.</p>
            <button onClick={() => setConfirmed(false)} className="mt-4 px-4 py-2 text-xs font-bold bg-emerald-700 text-white rounded-xl">Book Another</button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Party Size */}
            <div>
              <label className="text-xs font-bold text-zinc-700 mb-2 block">Guests / Party Size</label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 6, 8].map((num) => (
                  <button
                    key={num}
                    onClick={() => setPartySize(num)}
                    className={\`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer \${
                      partySize === num ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                    }\`}
                  >
                    {num} {num === 1 ? 'Guest' : 'Guests'}
                  </button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div>
              <label className="text-xs font-bold text-zinc-700 mb-2 block">Date</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {dates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedDate(d)}
                    className={\`py-2.5 px-3 rounded-xl text-xs font-semibold border text-center transition-all cursor-pointer \${
                      selectedDate === d ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                    }\`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Times */}
            <div>
              <label className="text-xs font-bold text-zinc-700 mb-2 block">Available Seating Times</label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {times.map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTime(t)}
                    className={\`py-2 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer \${
                      selectedTime === t ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                    }\`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm */}
            <button
              onClick={() => setConfirmed(true)}
              className="w-full py-3.5 rounded-2xl text-white font-bold text-sm shadow-md transition-transform active:scale-98 cursor-pointer"
              style={{ backgroundColor: '${ds.primary}' }}
            >
              Confirm Reservation ({partySize} Guests · {selectedTime})
            </button>
          </div>
        )}
      </div>
    </section>
  );
}`;
  } else {
    // Universal dynamic domain section matching ANY prompt
    interactiveCode = `import React, { useState } from 'react';
import { Activity, Layers, ArrowUpRight, BarChart3, CheckCircle, Search, Filter } from 'lucide-react';

export default function InteractiveSection() {
  const [activeTab, setActiveTab] = useState('All');
  const [items, setItems] = useState([
    { id: 1, title: 'Primary Asset Alpha', category: 'Active', score: '98%', status: 'Optimized', date: 'Today' },
    { id: 2, title: 'Component Nexus Beta', category: 'Pending', score: '84%', status: 'In Review', date: 'Yesterday' },
    { id: 3, title: 'Core Dynamic Matrix', category: 'Active', score: '92%', status: 'Optimized', date: '2 days ago' },
    { id: 4, title: 'Interface Module Delta', category: 'Archived', score: '76%', status: 'Standby', date: 'Last week' }
  ]);

  const filtered = activeTab === 'All' ? items : items.filter(i => i.category === activeTab);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="bg-white rounded-3xl border shadow-sm p-6 sm:p-8" style={{ borderColor: '${ds.border}' }}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: '${ds.text}' }}>
              ${sem.title} Control Center
            </h2>
            <p className="text-xs text-zinc-500 mt-1">Live interactive modules and data telemetry.</p>
          </div>

          <div className="flex items-center gap-2">
            {['All', 'Active', 'Pending', 'Archived'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={\`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer \${
                  activeTab === tab ? 'bg-zinc-900 text-white border-zinc-900 shadow-2xs' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                }\`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map(item => (
            <div key={item.id} className="p-4 rounded-2xl bg-zinc-50 border hover:border-zinc-300 transition-all group flex flex-col justify-between" style={{ borderColor: '${ds.border}' }}>
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                  <span className="font-mono text-[10px]">{item.date}</span>
                  <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{item.score}</span>
                </div>
                <h4 className="font-bold text-sm text-zinc-900 group-hover:text-indigo-600 transition-colors">{item.title}</h4>
                <p className="text-xs text-zinc-500 mt-1">{item.status}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-zinc-200 flex items-center justify-between text-xs font-semibold text-zinc-700">
                <span>Configure</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-900" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}`;
  }

  // 4. Component: FeatureSection.jsx
  const featureCode = `import React from 'react';
import { Zap, Shield, Sparkles, Sliders, Cpu, Gauge } from 'lucide-react';

export default function FeatureSection() {
  const features = [
    { title: 'Dynamic Layout Engine', desc: 'Auto-adapts to user device resolution and workflows instantly.', icon: Sliders },
    { title: 'Sub-second Interactions', desc: 'Engineered for smooth 60fps micro-animations and feedback.', icon: Zap },
    { title: 'Engineered Security', desc: 'Protected by enterprise-grade validation and state governance.', icon: Shield },
    { title: 'Intelligent Workflows', desc: 'Pre-configured domain patterns ready to streamline production.', icon: Cpu }
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: '${ds.text}' }}>
          Architected for Excellence
        </h2>
        <p className="text-xs sm:text-sm text-zinc-500 mt-2">
          Every component in ${sem.title} is designed with modularity, precision typography, and intuitive accessibility.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feat, idx) => {
          const Icon = feat.icon;
          return (
            <div 
              key={idx} 
              className="bg-white p-6 rounded-2xl border shadow-2xs hover:shadow-md transition-all hover:-translate-y-1"
              style={{ borderColor: '${ds.border}', borderRadius: '${ds.radius}' }}
            >
              <div 
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white mb-4 shadow-sm"
                style={{ backgroundColor: '${ds.primary}' }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-zinc-900 mb-1.5">{feat.title}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">{feat.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}`;

  // 5. Component: Footer.jsx
  const footerCode = `import React from 'react';
import { Sparkles, Heart } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t bg-white mt-16" style={{ borderColor: '${ds.border}' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: '${ds.primary}' }}>
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-zinc-900">${sem.title}</span>
          <span>© 2026. All rights reserved.</span>
        </div>

        <div className="flex items-center gap-6 font-medium">
          <a href="#" className="hover:text-zinc-900 transition-colors">Privacy</a>
          <a href="#" className="hover:text-zinc-900 transition-colors">Terms</a>
          <a href="#" className="hover:text-zinc-900 transition-colors">Support</a>
          <a href="#" className="hover:text-zinc-900 transition-colors">API Docs</a>
        </div>
      </div>
    </footer>
  );
}`;

  // 6. Component: App.jsx (Root conductor orchestrating components)
  const appCode = `import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import InteractiveSection from './components/InteractiveSection';
import FeatureSection from './components/FeatureSection';
import Footer from './components/Footer';
import { Plus, Layers, FileText, CheckCircle2, Trash2 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [showModal, setShowModal] = useState(false);

  // Bottom Multi-Page Navigation State
  const [pages, setPages] = useState([
    { id: 'home', title: 'Main Page', desc: 'Primary landing view with hero and features.' },
    { id: 'analytics', title: 'Analytics & Insights', desc: 'Detailed performance metrics, analytics, and conversion statistics.' }
  ]);
  const [activePageId, setActivePageId] = useState('home');

  const handleAddPage = () => {
    const nextNum = pages.length + 1;
    const newPage = {
      id: \`page-\${Date.now()}\`,
      title: \`Page \${nextNum}: \${nextNum === 3 ? 'Services & Pricing' : nextNum === 4 ? 'User Community' : 'Custom View'}\`,
      desc: \`Interactive dynamic view for Page \${nextNum}. You can configure sections, cards, and workflows here.\`
    };
    setPages(prev => [...prev, newPage]);
    setActivePageId(newPage.id);
  };

  const handleRemovePage = (e, pageId) => {
    e.stopPropagation();
    if (pages.length <= 1) return;
    const remaining = pages.filter(p => p.id !== pageId);
    setPages(remaining);
    if (activePageId === pageId) {
      setActivePageId(remaining[0].id);
    }
  };

  const activePageObj = pages.find(p => p.id === activePageId) || pages[0];

  return (
    <div className="min-h-screen flex flex-col font-sans transition-colors duration-300" style={{ backgroundColor: '${ds.bg}', color: '${ds.text}' }}>
      {/* Top Navigation */}
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onAction={() => setShowModal(true)} 
      />

      {/* Main Content Areas */}
      <main className="flex-1">
        {activePageId === 'home' ? (
          <>
            <Hero 
              onPrimaryClick={() => {
                const el = document.getElementById('interactive-core');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              onSecondaryClick={() => setShowModal(true)}
            />

            <div id="interactive-core">
              <InteractiveSection />
            </div>

            <FeatureSection />
          </>
        ) : (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 animate-fade-in">
            <div className="bg-white border rounded-3xl p-8 shadow-sm" style={{ borderColor: '${ds.border}' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="p-3 rounded-2xl text-white shadow-xs" style={{ backgroundColor: '${ds.primary}' }}>
                  <Layers className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="text-2xl font-black text-zinc-900">{activePageObj.title}</h2>
                  <p className="text-xs text-zinc-500">{activePageObj.desc}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-8">
                <div className="p-6 rounded-2xl bg-zinc-50 border border-zinc-200">
                  <div className="flex items-center gap-2 text-zinc-800 font-bold text-sm mb-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Dynamic Page View</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    This page was dynamically initialized via the bottom page bar. Use the Veave Studio prompt to populate custom modules.
                  </p>
                </div>
                <div className="p-6 rounded-2xl bg-zinc-50 border border-zinc-200">
                  <div className="flex items-center gap-2 text-zinc-800 font-bold text-sm mb-2">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <span>Independent Layout</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Keep your application organized across multiple focused routes and pages without reloading the browser.
                  </p>
                </div>
                <div className="p-6 rounded-2xl bg-zinc-50 border border-zinc-200">
                  <div className="flex items-center gap-2 text-zinc-800 font-bold text-sm mb-2">
                    <Layers className="w-4 h-4 text-amber-500" />
                    <span>Full State Sync</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Seamlessly switch back to the Main Page or any other created page anytime using the navigation bar below.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setActivePageId('home')}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 transition-colors"
              >
                &larr; Back to Main Page
              </button>
            </div>
          </section>
        )}

        {/* Bottom Multi-Page Navigation Bar & Add More Page Button */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-zinc-200/80 my-8">
          <div className="bg-zinc-900 text-white rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-white/10 text-white">
                <Layers className="w-4 h-4" />
              </span>
              <div>
                <span className="text-xs font-bold tracking-wide uppercase text-zinc-400 block">Multi-Page Navigation</span>
                <span className="text-sm font-semibold text-white">Explore or Add Pages</span>
              </div>
            </div>

            {/* Page Buttons List + Add More Page */}
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-center md:justify-end">
              {pages.map((p) => {
                const isActive = p.id === activePageId;
                return (
                  <div
                    key={p.id}
                    onClick={() => setActivePageId(p.id)}
                    className={\`group flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all border \${
                      isActive 
                        ? 'bg-white text-zinc-900 border-white shadow-sm' 
                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-white'
                    }\`}
                  >
                    <span>{p.title}</span>
                    {pages.length > 1 && p.id !== 'home' && (
                      <button
                        onClick={(e) => handleRemovePage(e, p.id)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-0.5 rounded"
                        title="Remove page"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Functional Add More Page Button */}
              <button
                onClick={handleAddPage}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-sm hover:opacity-95 active:scale-95 cursor-pointer"
                style={{ backgroundColor: '${ds.primary}' }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add More Page</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Interactive Action Dialog */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border text-center animate-scale-up" style={{ borderColor: '${ds.border}' }}>
            <h3 className="text-xl font-black text-zinc-900">Welcome to ${sem.title}</h3>
            <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
              Your customized ${sem.title.toLowerCase()} is live and interactive. Modify any section, add new features, or customize styles using natural language in the prompt bar below.
            </p>
            <button
              onClick={() => setShowModal(false)}
              className="mt-6 w-full py-3 rounded-xl text-white font-bold text-xs shadow-sm transition-all"
              style={{ backgroundColor: '${ds.primary}' }}
            >
              Continue Exploring
            </button>
          </div>
        </div>
      )}

      {/* Site Footer */}
      <Footer />
    </div>
  );
}`;

  return [
    { path: 'src/App.jsx', content: appCode, language: 'javascript' },
    { path: 'src/components/Navbar.jsx', content: navbarCode, language: 'javascript' },
    { path: 'src/components/Hero.jsx', content: heroCode, language: 'javascript' },
    { path: 'src/components/InteractiveSection.jsx', content: interactiveCode, language: 'javascript' },
    { path: 'src/components/FeatureSection.jsx', content: featureCode, language: 'javascript' },
    { path: 'src/components/Footer.jsx', content: footerCode, language: 'javascript' },
    { path: 'src/tokens.json', content: JSON.stringify(ds, null, 2), language: 'json' },
  ];
}

// Contextual modification of existing components
function applyContextualModification(existingFiles, modificationPrompt, designSystem) {
  const p = modificationPrompt.toLowerCase();
  let updatedFiles = [...existingFiles];
  let tokensFile = updatedFiles.find(f => f?.path && typeof f.path === 'string' && f.path.endsWith('tokens.json'));
  let currentTokens = tokensFile ? JSON.parse(tokensFile.content) : designSystem;

  // 1. Color / theme modifications
  if (p.includes('dark') || p.includes('black') || p.includes('night')) {
    currentTokens.bg = '#09090B';
    currentTokens.cardBg = '#18181B';
    currentTokens.text = '#F8FAFC';
    currentTokens.border = '#27272A';
  } else if (p.includes('blue') || p.includes('cyan')) {
    currentTokens.primary = '#2563EB';
    currentTokens.accent = '#38BDF8';
  } else if (p.includes('emerald') || p.includes('green')) {
    currentTokens.primary = '#059669';
    currentTokens.accent = '#10B981';
  } else if (p.includes('purple') || p.includes('violet')) {
    // Purple is strictly forbidden across all projects: redirect to clean ocean blue / sky cyan
    currentTokens.primary = '#2563EB';
    currentTokens.accent = '#38BDF8';
  } else if (p.includes('rose') || p.includes('pink') || p.includes('red')) {
    currentTokens.primary = '#E11D48';
    currentTokens.accent = '#FB7185';
  }

  // Update tokens.json and propagate color classes to App.jsx and components
  updatedFiles = updatedFiles.map(f => {
    if (f?.path && typeof f.path === 'string' && f.path.endsWith('tokens.json')) {
      return { ...f, content: JSON.stringify(currentTokens, null, 2) };
    }
    if (f?.path && typeof f.path === 'string' && (f.path.endsWith('.jsx') || f.path.endsWith('.js'))) {
      let content = f.content;
      if (p.includes('blue') || p.includes('light blue') || p.includes('cyan') || p.includes('sky')) {
        // Surgically replace purple/indigo accents with sky blue / light blue
        content = content.replace(/#6366F1/gi, '#0284C7');
        content = content.replace(/#4F46E5/gi, '#0369A1');
        content = content.replace(/#7C3AED/gi, '#0284C7');
        content = content.replace(/#8B5CF6/gi, '#38BDF8');
        content = content.replace(/#A855F7/gi, '#38BDF8');
        content = content.replace(/\bindigo-([4567]00)\b/g, 'sky-$1');
        content = content.replace(/\bpurple-([4567]00)\b/g, 'sky-$1');
      }
      if (p.includes('black') || p.includes('dark')) {
        content = content.replace(/#0F172A/gi, '#09090B');
        content = content.replace(/#1E293B/gi, '#121214');
      }
      return { ...f, content };
    }
    return f;
  });

  // 2. Component-level modifications
  // Sticky Navbar modification
  if (p.includes('sticky') && p.includes('navbar')) {
    updatedFiles = updatedFiles.map(f => {
      if (f.path.includes('Navbar.jsx')) {
        let c = f.content;
        if (!c.includes('sticky top-0')) {
          c = c.replace('<header className="', '<header className="sticky top-0 shadow-sm ');
        }
        return { ...f, content: c };
      }
      return f;
    });
  }

  // Add Pricing Section modification
  if (p.includes('pricing') || p.includes('subscription') || p.includes('plan')) {
    const pricingCode = `import React from 'react';
import { Check, Sparkles } from 'lucide-react';

export default function PricingSection() {
  const plans = [
    { name: 'Starter', price: '$19', desc: 'Essential features for individuals and small teams.', features: ['Full UI Component Library', '5 Active Projects', 'Community Support'] },
    { name: 'Professional', price: '$49', desc: 'Advanced AI customization and team collaboration.', popular: true, features: ['Unlimited AI Generations', 'Custom Design Systems', 'Real-time Team Collaboration', 'Priority 24/7 Support'] },
    { name: 'Enterprise', price: '$129', desc: 'Maximum control, dedicated support, and bespoke models.', features: ['Custom LLM Fine-tuning', 'Dedicated Infrastructure', 'SLA Guarantee', 'Custom Integrations'] }
  ];

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <div className="text-center max-w-xl mx-auto mb-10">
        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Simple & Transparent</span>
        <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 mt-1">Choose Your Plan</h2>
        <p className="text-xs sm:text-sm text-zinc-500 mt-1">Scale effortlessly with clear, predictable pricing.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((p, idx) => (
          <div key={idx} className={\`bg-white rounded-3xl p-6 sm:p-8 border relative flex flex-col justify-between \${p.popular ? 'border-indigo-600 shadow-xl ring-2 ring-indigo-600/20' : 'border-zinc-200 shadow-2xs'}\`}>
            {p.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shadow-xs">
                Most Popular
              </span>
            )}
            <div>
              <h3 className="text-lg font-bold text-zinc-900">{p.name}</h3>
              <p className="text-xs text-zinc-500 mt-1">{p.desc}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-black text-zinc-900">{p.price}</span>
                <span className="text-xs text-zinc-400">/ month</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-xs text-zinc-600">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button className={\`mt-8 w-full py-3 rounded-xl text-xs font-bold transition-all cursor-pointer \${p.popular ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'}\`}>
              Get Started with {p.name}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}`;
    
    // Add PricingSection file and import it into App.jsx
    updatedFiles.push({ path: 'src/components/PricingSection.jsx', content: pricingCode, language: 'javascript' });
    
    updatedFiles = updatedFiles.map(f => {
      if (f?.path && typeof f.path === 'string' && f.path.endsWith('App.jsx')) {
        let c = f.content;
        if (!c.includes('PricingSection')) {
          c = "import PricingSection from './components/PricingSection';\\n" + c;
          c = c.replace('<FeatureSection />', '<FeatureSection />\\n        <PricingSection />');
        }
        return { ...f, content: c };
      }
      return f;
    });
  }

  // Hero modifications (e.g. more modern, change headline)
  if (p.includes('hero') || p.includes('headline') || p.includes('modern')) {
    updatedFiles = updatedFiles.map(f => {
      if (f?.path && typeof f.path === 'string' && f.path.includes('Hero.jsx')) {
        let c = f.content;
        c = c.replace(/className="text-3xl sm:text-5xl lg:text-6xl font-black/, 'className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tighter');
        return { ...f, content: c };
      }
      return f;
    });
  }

  return updatedFiles;
}

module.exports = {
  generateDesignSystem,
  extractPromptSemantics,
  synthesizeDynamicComponents,
  applyContextualModification
};
