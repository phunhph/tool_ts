const mongoose = require('mongoose');

const assessmentQuestionSchema = new mongoose.Schema(
    {
        questionId: { type: String, required: true }, // stable id used as answers key
        type: { type: String, required: true, enum: ['yesno', 'scale', 'single', 'multi'] },
        question: { type: String, default: '' },
        options: { type: [String], default: [] },
        min: { type: Number, default: 1 },
        max: { type: Number, default: 5 },
        weight: { type: Number, default: 1 },
        reverseScore: { type: Boolean, default: false },
        skillTags: { type: [String], default: [] }
    },
    { _id: false }
);

const assessmentConfigSchema = new mongoose.Schema({
    quizId: { type: String, required: true, index: true },
    version: { type: Number, required: true, index: true },
    questions: { type: [assessmentQuestionSchema], default: [] },
    createdAt: { type: Date, default: Date.now, index: true }
});

assessmentConfigSchema.index({ quizId: 1, version: -1 });

module.exports = mongoose.model('AssessmentConfig', assessmentConfigSchema);

