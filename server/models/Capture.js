const mongoose = require('mongoose');

const captureSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  url: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: ''
  },
  viewport: {
    w: Number,
    h: Number,
    dpr: Number
  },
  elements: [{
    id: String,
    tag: String,
    role: String,
    label: String,
    selector: String,
    rect: {
      x: Number,
      y: Number,
      w: Number,
      h: Number
    },
    style: {
      color: String,
      backgroundColor: String,
      fontSize: String,
      fontWeight: String,
      borderRadius: String
    },
    interaction: {
      clickable: Boolean,
      focusable: Boolean,
      disabled: Boolean,
      readonly: Boolean,
      tabIndex: Number
    }
  }],
  overlayTexts: [{
    tag: String,
    role: String,
    className: String,
    text: String,
    rect: {
      x: Number,
      y: Number,
      w: Number,
      h: Number
    },
    zIndex: Number,
    position: String
  }],
  observePrompt: String,
  observeOutput: String,
  reasoningPrompt: String,
  reasoningOutput: String,
  actionPrompt: String,
  actionOutput: String,
  stepNumber: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Capture', captureSchema);
