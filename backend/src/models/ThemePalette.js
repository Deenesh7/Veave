const mongoose = require('mongoose');

const themePaletteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Palette name is required'],
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    default: '',
    trim: true,
    maxlength: 300
  },
  colors: {
    primary: { type: String, required: true, default: '#18181B' },
    secondary: { type: String, default: '#71717A' },
    background: { type: String, default: '#F8F9FA' },
    foreground: { type: String, default: '#111827' },
    accent: { type: String, default: '#27272A' },
    border: { type: String, default: '#E2E5E8' },
    card: { type: String, default: '#FFFFFF' },
    muted: { type: String, default: '#F1F5F9' }
  },
  typography: {
    headingFont: { type: String, default: 'Inter' },
    bodyFont: { type: String, default: 'Inter' },
    monoFont: { type: String, default: 'JetBrains Mono' },
    scale: { type: String, default: 'modern' },
    headingWeight: { type: String, default: '700' }
  },
  radius: {
    button: { type: String, default: '8px' },
    card: { type: String, default: '14px' },
    container: { type: String, default: '18px' },
    preset: { type: String, default: 'modern' }
  },
  geometry: {
    density: { type: String, default: 'standard' },
    borderWidth: { type: String, default: '1px' },
    shadow: { type: String, default: 'subtle' }
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('ThemePalette', themePaletteSchema);
