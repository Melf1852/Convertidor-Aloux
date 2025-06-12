const mongoose = require('mongoose');

const conversionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  convertedFileName: {
    type: String,
    required: true
  },
  sourceFormat: {
    type: String,
    required: true,
    enum: ['json', 'csv', 'xlsx', 'xml', 'yaml']
  },
  targetFormat: {
    type: String,
    required: true,
    enum: ['json', 'csv', 'xlsx', 'xml', 'yaml']
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  error: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  }
});

module.exports = mongoose.model('Conversion', conversionSchema); 