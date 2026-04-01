const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
    path: { type: String, required: true },
    country: { type: String, default: 'Unknown' },
    date: { type: Date, default: Date.now }
}, { timestamps: true });

visitSchema.index({ date: 1 });
visitSchema.index({ country: 1 });

module.exports = mongoose.model('Visit', visitSchema);
