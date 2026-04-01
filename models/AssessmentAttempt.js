const mongoose = require('mongoose');

const assessmentAttemptSchema = new mongoose.Schema({
    quizId: { type: String, required: true, index: true },

    studentName: { type: String, default: '' },
    studentPhone: { type: String, default: '' },
    studentDob: { type: String, default: '' },
    studentAddress: { type: String, default: '' },
    studentSchool: { type: String, default: '' },
    studentCode: { type: String, default: '' },
    classCode: { type: String, default: '' },
    subjectCode: { type: String, default: '' },
    studentEmail: { type: String, default: '' },

    // answers are keyed by questionId (assessment config) OR originalIndex (legacy)
    answers: { type: mongoose.Schema.Types.Mixed, required: true },

    submittedAt: { type: Date, default: Date.now, index: true },
    clientMeta: { type: mongoose.Schema.Types.Mixed, default: {} }
});

assessmentAttemptSchema.index({ quizId: 1, submittedAt: -1 });

module.exports = mongoose.model('AssessmentAttempt', assessmentAttemptSchema);

