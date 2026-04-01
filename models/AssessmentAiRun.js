const mongoose = require('mongoose');

const suggestedMajorSchema = new mongoose.Schema(
    {
        majorCode: { type: String, default: null },
        majorName: { type: String, required: true },
        score: { type: Number, default: 0 },
        reasons: { type: [String], default: [] },
        matchedSkills: { type: [String], default: [] }
    },
    { _id: false }
);

const assessmentAiRunSchema = new mongoose.Schema({
    attemptId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    quizId: { type: String, required: true, index: true },

    derivedSkillScores: { type: mongoose.Schema.Types.Mixed, default: {} },
    suggestedMajors: { type: [suggestedMajorSchema], default: [] },
    explanationSummary: { type: String, default: '' },
    trendSignals: { type: mongoose.Schema.Types.Mixed, default: {} },

    provider: { type: String, default: 'rules' },
    modelName: { type: String, default: '' },
    modelParams: { type: mongoose.Schema.Types.Mixed, default: {} },
    latencyMs: { type: Number, default: 0 },
    fallbackUsed: { type: Boolean, default: false },

    promptSnapshot: { type: String, default: '' },
    aiRawResponse: { type: mongoose.Schema.Types.Mixed, default: null },

    createdAt: { type: Date, default: Date.now, index: true }
});

assessmentAiRunSchema.index({ quizId: 1, createdAt: -1 });
assessmentAiRunSchema.index({ attemptId: 1, createdAt: -1 });

module.exports = mongoose.model('AssessmentAiRun', assessmentAiRunSchema);

