const mongoose = require('mongoose');

const customFontSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  name: {
    type: String,
    required: [true, 'Font name is required'],
    trim: true,
    maxlength: 100
  },
  family: {
    type: String,
    required: [true, 'Font family CSS string is required'],
    trim: true
  },
  category: {
    type: String,
    default: 'Imported',
    trim: true
  },
  url: {
    type: String,
    default: '',
    trim: true
  },
  source: {
    type: String,
    enum: ['google', 'custom', 'url'],
    default: 'google'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CustomFont', customFontSchema);
