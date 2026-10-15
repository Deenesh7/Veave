const mongoose = require('mongoose');

/**
 * VEAVE Prompt Engine — PromptRun schema
 *
 * Stores every prompt compilation:
 *   userInput  →  structured UISpec  →  finalPrompt (implementation-ready)
 *
 * Relations
 *   userId    → User      (optional, guests allowed, indexed)
 *   projectId → Project   (optional, back-reference when a Project is
 *                          created from the compiled prompt, indexed)
 */

/* ----------------------------- Sub-schemas ----------------------------- */

const pageSchema = new mongoose.Schema({
  name: { type: String, required: true },
  route: { type: String, default: '' },
  purpose: { type: String, default: '' },
  layout: { type: String, default: '' },
  sections: { type: [String], default: [] },
  components: { type: [String], default: [] },
  interactions: { type: [String], default: [] }
}, { _id: false });

const componentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  props: { type: [String], default: [] },
  variants: { type: [String], default: [] },
  states: { type: [String], default: [] }
}, { _id: false });

const formSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  fields: { type: [String], default: [] },
  validation: { type: [String], default: [] },
  submitAction: { type: String, default: '' }
}, { _id: false });

const dataRequirementSchema = new mongoose.Schema({
  entity: { type: String, default: '' },
  fields: { type: [String], default: [] },
  relationships: { type: [String], default: [] }
}, { _id: false });

const designSystemSchema = new mongoose.Schema({
  name: { type: String, default: 'veave' },
  mood: { type: [String], default: [] },
  typography: {
    primary: { type: String, default: 'Inter' },
    secondary: { type: String, default: 'Geist' },
    display: { type: String, default: 'Space Grotesk' },
    scale: { type: [String], default: [] }
  },
  colors: {
    background: { type: String, default: '#FFFFFF' },
    surface: { type: String, default: '#FAFAFA' },
    border: { type: String, default: '#E5E7EB' },
    text: { type: String, default: '#111827' },
    muted: { type: String, default: '#6B7280' },
    accent: { type: String, default: '#3B82F6' },
    accentSoft: { type: String, default: '#DBEAFE' },
    palette: { type: [String], default: [] }
  },
  radius: { type: String, default: '12px' },
  spacing: { type: String, default: '4/8/12/16/24/32' },
  shadows: { type: String, default: 'subtle' },
  icons: { type: String, default: 'lucide-react' },
  visualConstraints: { type: [String], default: [] }
}, { _id: false });

const responsiveSchema = new mongoose.Schema({
  breakpoints: { type: [String], default: ['sm', 'md', 'lg', 'xl'] },
  mobile: { type: String, default: '' },
  tablet: { type: String, default: '' },
  desktop: { type: String, default: '' }
}, { _id: false });

const accessibilitySchema = new mongoose.Schema({
  contrastAA: { type: Boolean, default: true },
  semanticHtml: { type: Boolean, default: true },
  ariaLabels: { type: Boolean, default: true },
  keyboardNav: { type: Boolean, default: true },
  focusVisible: { type: Boolean, default: true },
  notes: { type: [String], default: [] }
}, { _id: false });

const uiSpecSchema = new mongoose.Schema({
  project: { type: String, default: '' },
  objective: { type: String, default: '' },
  targetUsers: { type: [String], default: [] },
  productType: { type: String, default: '' },
  technology: {
    framework: { type: String, default: 'react' },
    language: { type: String, default: 'javascript' },
    styling: { type: String, default: 'tailwindcss' },
    bundler: { type: String, default: 'vite' },
    icons: { type: String, default: 'lucide-react' },
    extras: { type: [String], default: [] }
  },
  pages: { type: [pageSchema], default: [] },
  routes: { type: [String], default: [] },
  navigation: { type: String, default: '' },
  components: { type: [componentSchema], default: [] },
  features: { type: [String], default: [] },
  interactions: { type: [String], default: [] },
  states: { type: [String], default: [] },
  forms: { type: [formSchema], default: [] },
  authentication: { type: String, default: '' },
  integrations: { type: [String], default: [] },
  dataRequirements: { type: [dataRequirementSchema], default: [] },
  designSystem: { type: designSystemSchema, default: () => ({}) },
  responsive: { type: responsiveSchema, default: () => ({}) },
  accessibility: { type: accessibilitySchema, default: () => ({}) },
  animations: { type: [String], default: [] },
  implementationRequirements: { type: [String], default: [] },
  visualConstraints: { type: [String], default: [] },
  finalRequirements: { type: [String], default: [] },
  assumptions: { type: [String], default: [] }
}, { _id: false });

const referenceImageSchema = new mongoose.Schema({
  provided: { type: Boolean, default: false },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  analysisNotes: { type: [String], default: [] }
}, { _id: false });

const tokenUsageSchema = new mongoose.Schema({
  prompt: { type: Number, default: 0 },
  completion: { type: Number, default: 0 },
  total: { type: Number, default: 0 }
}, { _id: false });

/* ------------------------------ Main schema ------------------------------ */

const promptRunSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
    index: true
  },

  // Original request
  userPrompt: { type: String, required: true, trim: true, minlength: 1, maxlength: 8000 },
  framework: { type: String, default: 'react' },
  designSystemName: { type: String, default: 'veave' },
  requestedModel: { type: String, default: 'auto' },        // Auto | GPT | Claude | Gemini
  provider: { type: String, default: '' },                  // resolved provider (openrouter, openai, anthropic, gemini)
  resolvedModel: { type: String, default: '' },             // exact model id used
  referenceImage: { type: referenceImageSchema, default: () => ({}) },

  // Compiled artifacts
  spec: { type: uiSpecSchema, default: () => ({}) },
  finalPrompt: { type: String, default: '' },

  // Diagnostics
  status: {
    type: String,
    enum: ['pending', 'analyzing', 'extracting', 'composing', 'validating', 'success', 'failed'],
    default: 'pending',
    index: true
  },
  error: { type: String, default: '' },
  tokens: { type: tokenUsageSchema, default: () => ({}) },
  durationMs: { type: Number, default: 0 },

  metadata: {
    extractedProductType: { type: String, default: '' },
    pageCount: { type: Number, default: 0 },
    componentCount: { type: Number, default: 0 },
    featureCount: { type: Number, default: 0 },
    validated: { type: Boolean, default: false },
    warnings: { type: [String], default: [] }
  }
}, { timestamps: true });

/* --------------------------- Indexes & helpers --------------------------- */

promptRunSchema.index({ userId: 1, createdAt: -1 });
promptRunSchema.index({ status: 1, createdAt: -1 });

promptRunSchema.methods.toSummary = function () {
  return {
    id: this._id,
    userPrompt: this.userPrompt,
    project: this.spec?.project,
    productType: this.metadata?.extractedProductType,
    pageCount: this.metadata?.pageCount,
    componentCount: this.metadata?.componentCount,
    status: this.status,
    provider: this.provider,
    model: this.resolvedModel,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('PromptRun', promptRunSchema);
