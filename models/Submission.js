const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    quizId: { type: String, required: true, index: true },
    studentName: String,
    studentCode: String,
    classCode: String,
    subjectCode: String,
    studentEmail: String,
    score: Number,
    total: Number,
    submittedAt: { type: Date, default: Date.now },
    answers: { type: mongoose.Schema.Types.Mixed }, // Can be object or array
    ipAddress: { type: String, default: '' },
    macAddress: { type: String, default: '' }
});

module.exports = mongoose.model('Submission', submissionSchema);
