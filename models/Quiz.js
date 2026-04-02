const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, default: 'Untitled Quiz' },
    type: { type: String, default: 'quiz' }, // 'quiz' | 'assessment'
    filename: String,
    teacherName: String,
    teacherEmail: String, // Keeping this for legacy data
    email: String,        // Newer field
    startTime: Date,
    endTime: Date,
    timeLimit: Number,
    password: { type: String, default: null },
    filePath: String,
    createdAt: { type: Date, default: Date.now },
    questions: [
        {
            id: Number,
            question: String,
            options: [String],
            correctAnswer: String,
            originalIndex: Number,
            segmentName: String,
            skillType: String
        }
    ],
    questionMode: { type: String, default: 'all' },
    randomCount: { type: Number, default: null },
    allowedIPs: { type: [String], default: [] },
    collectMAC: { type: Boolean, default: false },
    assessmentEnabled: { type: Boolean, default: false },
    assessmentConfigVersion: { type: Number, default: null },
    /** Ordered school names for assessment quizzes (student select + export filter) */
    assessmentSchools: [{
        order: { type: Number, default: 1 },
        name: { type: String, required: true }
    }]
});

module.exports = mongoose.model('Quiz', quizSchema);
