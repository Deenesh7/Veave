import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  Search, 
  Plus, 
  Check, 
  Sliders, 
  X, 
  CheckCircle2, 
  BookOpen, 
  Cpu, 
  Layers, 
  Code2, 
  Zap, 
  ShieldCheck, 
  Eye, 
  Trash2,
  Settings2
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';

const DEFAULT_SKILLS = [
  {
    id: 'skill-ui-ux',
    name: 'UI/UX System Architect',
    category: 'Design Systems',
    description: 'Enforces 8pt spatial grid, consistent color tokens, accessible contrast, and micro-typography standards.',
    enabled: true,
    strictness: 'Balanced',
    instructions: 'Follow clean modern SaaS aesthetics. Use subtle slate borders, rounded-2xl containers, and soft elevation shadows.'
  },
  {
    id: 'skill-responsive',
    name: 'Responsive Layout Engine',
    category: 'Architecture',
    description: 'Generates mobile-first fluid breakpoints with responsive flex wrapping and auto-fitting CSS grids.',
    enabled: true,
    strictness: 'Strict',
    instructions: 'Ensure all columns adapt into single-column layouts on mobile (<640px) with minimum 44px tap targets.'
  },
  {
    id: 'skill-a11y',
    name: 'Accessibility (a11y) Auditor',
    category: 'Quality',
    description: 'Injects ARIA labels, semantic landmark tags, visible focus rings, and screen-reader announcements.',
    enabled: true,
    strictness: 'Strict',
    instructions: 'Include aria-label on icon-only buttons, proper role attributes, and keyboard focus states.'
  },
  {
    id: 'skill-motion',
    name: 'Framer Motion Specialist',
    category: 'Interactions',
    description: 'Adds spring-physics entry transitions, stagger effects, and layout animations using framer-motion.',
    enabled: false,
    strictness: 'Balanced',
    instructions: 'Incorporate subtle hover scaling (scale: 1.02), fade-in on mount, and spring dampening physics.'
  },
  {
    id: 'skill-db-scaffold',
    name: 'Fullstack Database Scaffolder',
    category: 'Architecture',
    description: 'Scaffolds Mongoose/Prisma schema models with type definitions, indexes, and relationship references.',
    enabled: false,
    strictness: 'Balanced',
    instructions: 'Create robust schema definitions with timestamps, validations, and index optimization.'
  },
  {
    id: 'skill-zod-forms',
    name: 'Form Validation & Zod Engine',
    category: 'Quality',
    description: 'Generates react-hook-form schemas with client-side field validation and real-time error messages.',
    enabled: false,
    strictness: 'Strict',
    instructions: 'Wrap input fields in accessible fieldsets with clear error message states.'
  },
  {
    id: 'skill-seo',
    name: 'SEO & OpenGraph Optimizer',
    category: 'Marketing',
    description: 'Embeds meta tags, OpenGraph previews, Twitter card summaries, and JSON-LD schema breadcrumbs.',
    enabled: false,
    strictness: 'Balanced',
    instructions: 'Generate meta title, description, og:image, and semantic article/product structured schema.'
  }
];

const CATEGORIES = ['All', 'Design Systems', 'Architecture', 'Quality', 'Interactions', 'Marketing', 'Custom'];

export default function SkillsModal({ isOpen, onClose, onSkillsChange }) {
  const [skills, setSkills] = useState(() => {
    try {
      const saved = localStorage.getItem('veave_skills');
      return saved ? JSON.parse(saved) : DEFAULT_SKILLS;
    } catch {
      return DEFAULT_SKILLS;
    }
  });

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [configuringSkill, setConfiguringSkill] = useState(null);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: '',
    category: 'Custom',
    description: '',
    instructions: '',
    strictness: 'Balanced'
  });

  // Save changes & notify parent
  useEffect(() => {
    try {
      localStorage.setItem('veave_skills', JSON.stringify(skills));
      onSkillsChange?.(skills.filter(s => s.enabled));
    } catch (e) {
      console.warn('Could not save skills:', e);
    }
  }, [skills, onSkillsChange]);

  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      const matchesCat = selectedCategory === 'All' || s.category === selectedCategory;
      const q = search.toLowerCase().trim();
      const matchesSearch = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    });
  }, [skills, search, selectedCategory]);

  const activeCount = skills.filter((s) => s.enabled).length;

  const toggleSkill = (id) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleSaveConfig = (updatedSkill) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === updatedSkill.id ? updatedSkill : s))
    );
    setConfiguringSkill(null);
  };

  const handleAddCustomSkill = (e) => {
    e.preventDefault();
    if (!customForm.name.trim()) return;

    const newSkill = {
      id: `custom-skill-${Date.now()}`,
      name: customForm.name.trim(),
      category: customForm.category || 'Custom',
      description: customForm.description.trim() || 'Custom user-defined skill',
      instructions: customForm.instructions.trim() || 'Follow custom guidelines',
      strictness: customForm.strictness || 'Balanced',
      enabled: true,
      isCustom: true
    };

    setSkills((prev) => [newSkill, ...prev]);
    setIsAddingCustom(false);
    setCustomForm({
      name: '',
      category: 'Custom',
      description: '',
      instructions: '',
      strictness: 'Balanced'
    });
  };

  const handleDeleteCustomSkill = (id) => {
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (configuringSkill?.id === id) {
      setConfiguringSkill(null);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Skills & Capabilities"
      description="Equip your AI generation engine with specialized design, code quality, and architectural skills."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-900">Active Skills</span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-zinc-50 text-zinc-700 border border-zinc-200">
              {activeCount} of {skills.length} Enabled
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search skills..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-6 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsAddingCustom(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-black text-white shadow-2xs flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Skill</span>
            </button>
          </div>
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

        {/* Skills List */}
        <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
          {filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className={`p-3 rounded-xl border transition-all flex items-start justify-between gap-3 shadow-2xs ${
                skill.enabled
                  ? 'border-zinc-200/80 bg-zinc-50/20'
                  : 'border-zinc-200 bg-white opacity-85'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    skill.enabled
                      ? 'bg-zinc-600 text-white shadow-2xs'
                      : 'bg-zinc-100 text-zinc-500'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-xs font-bold text-zinc-900 truncate">{skill.name}</h4>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 font-medium">
                      {skill.category}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400">
                      [{skill.strictness || 'Balanced'}]
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">
                    {skill.description}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <button
                  type="button"
                  onClick={() => setConfiguringSkill(skill)}
                  title="Configure skill settings"
                  className="p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-600 transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>

                {skill.isCustom && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCustomSkill(skill.id)}
                    title="Delete custom skill"
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={() => toggleSkill(skill.id)}
                  aria-pressed={skill.enabled}
                  className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer outline-none ${
                    skill.enabled ? 'bg-zinc-600' : 'bg-zinc-200'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow-xs transition-transform absolute top-0.5 ${
                      skill.enabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Configure Skill Dialog */}
        {configuringSkill && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl p-5 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-zinc-600" />
                  <h3 className="text-sm font-bold text-zinc-900">
                    Configure {configuringSkill.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setConfiguringSkill(null)}
                  className="text-zinc-400 hover:text-zinc-700 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">Strictness Level</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Relaxed', 'Balanced', 'Strict'].map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() =>
                          setConfiguringSkill({ ...configuringSkill, strictness: level })
                        }
                        className={`py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                          configuringSkill.strictness === level
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                        }`}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">
                    System Instructions & Guidelines
                  </label>
                  <textarea
                    rows={3}
                    value={configuringSkill.instructions || ''}
                    onChange={(e) =>
                      setConfiguringSkill({ ...configuringSkill, instructions: e.target.value })
                    }
                    className="w-full p-2.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setConfiguringSkill(null)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveConfig(configuringSkill)}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-black text-white shadow-2xs"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add Custom Skill Dialog */}
        {isAddingCustom && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-2xs p-4">
            <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl p-5 w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-zinc-600" />
                  <h3 className="text-sm font-bold text-zinc-900">Add Custom Skill</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddingCustom(false)}
                  className="text-zinc-400 hover:text-zinc-700 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddCustomSkill} className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">Skill Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Supabase Schema Wizard"
                    value={customForm.name}
                    onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">Category</label>
                  <input
                    type="text"
                    placeholder="e.g. Backend, Testing, Styling"
                    value={customForm.category}
                    onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">Description</label>
                  <input
                    type="text"
                    placeholder="Short summary of what this skill enables..."
                    value={customForm.description}
                    onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700">System Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="Guidelines the AI must obey when this skill is active..."
                    value={customForm.instructions}
                    onChange={(e) => setCustomForm({ ...customForm, instructions: e.target.value })}
                    className="w-full p-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:border-[#52525B] resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setIsAddingCustom(false)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!customForm.name.trim()}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-black text-white shadow-2xs disabled:opacity-50"
                  >
                    Add Skill
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Active skills automatically condition prototype generation.</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-zinc-700 hover:text-zinc-900"
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
