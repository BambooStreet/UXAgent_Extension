const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  taskName: {
    type: String,
    required: true,
    trim: true
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'completed'],
    default: 'active'
  },
  captureCount: {
    type: Number,
    default: 0
  },
  memoryStream: [{
    step: Number,
    url: String,
    summary: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Task', taskSchema);
