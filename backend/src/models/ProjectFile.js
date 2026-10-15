const mongoose = require('mongoose');

/**
 * ProjectFile — one document per generated file.
 *
 * This is the relational storage for a project's generated source code.
 * It coexists with the embedded `Project.files` array (which stays for
 * single-query editor loads and backward compatibility). Both are kept in
 * sync by the project service.
 *
 * Relations
 *   projectId → Project   (required, indexed)
 *   userId    → User      (optional — guests allowed, indexed)
 *
 * Uniqueness
 *   { projectId, path }   so the same virtual path cannot exist twice in
 *                         one project (a file update replaces content).
 */

const projectFileSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  path: {
    type: String,
    required: true,
    trim: true,
    maxlength: 512
  },
  content: {
    type: String,
    default: '',
    maxlength: 3 * 1024 * 1024
  },
  language: {
    type: String,
    default: 'plaintext'
  },
  encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' },
  blob: { type: mongoose.Schema.Types.Mixed, default: null },
  size: { type: Number, default: 0 },
  isBinary: { type: Boolean, default: false },
  isEntry: { type: Boolean, default: false },
  isConfig: { type: Boolean, default: false },

  // Metadata for auditing which stage / model produced the file
  origin: {
    generator: { type: String, default: 'unknown' },   // veave-engine | llm | scaffolder | user
    provider:  { type: String, default: '' },
    model:     { type: String, default: '' },
    promptRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PromptRun',
      default: null
    }
  }
}, { timestamps: true, collection: 'project_files' });

projectFileSchema.index({ projectId: 1, path: 1 }, { unique: true });
projectFileSchema.index({ userId: 1, updatedAt: -1 });

projectFileSchema.pre('save', function(next) {
  this.size = this.encoding === 'base64' ? Buffer.byteLength(this.content || '', 'base64') : Buffer.byteLength(this.content || '', 'utf8');
  this.isBinary = this.encoding === 'base64';
  this.isEntry = /(^|\/)(main|index)\.(jsx|tsx|js|ts)$/.test(this.path)
    || this.path === 'src/App.jsx' || this.path === 'src/App.tsx';
  this.isConfig = /\.config\.(js|ts|mjs|cjs)$/.test(this.path)
    || /^(vite|tailwind|postcss|babel|eslint)/.test(this.path.split('/').pop() || '');
  if (!this.language || this.language === 'plaintext') {
    this.language = detectLanguage(this.path);
  }
  next();
});

function detectLanguage(p) {
  if (p.endsWith('.jsx') || p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) return 'javascript';
  if (p.endsWith('.tsx') || p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.css'))  return 'css';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.md'))   return 'markdown';
  return 'plaintext';
}

module.exports = mongoose.model('ProjectFile', projectFileSchema, 'project_files');
