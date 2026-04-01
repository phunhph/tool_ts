const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Quiz = require('./models/Quiz');
const Submission = require('./models/Submission');

const DATA_FILE = path.join(__dirname, 'data', 'quizzes.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'data', 'submissions.json');

async function migrate() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/quizzes');
        console.log('Connected to MongoDB');

        // 1. Migrate Quizzes
        if (fs.existsSync(DATA_FILE)) {
            const quizzesData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const quizList = Object.values(quizzesData);

            console.log(`Found ${quizList.length} quizzes to migrate.`);

            for (const qData of quizList) {
                // Check if exists
                const existing = await Quiz.findOne({ id: qData.id });
                if (!existing) {
                    await Quiz.create(qData);
                    console.log(`Migrated quiz: ${qData.id}`);
                } else {
                    console.log(`Skipping existing quiz: ${qData.id}`);
                }
            }
        } else {
            console.log('No quizzes.json found.');
        }

        // 2. Migrate Submissions
        if (fs.existsSync(SUBMISSIONS_FILE)) {
            const subsData = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
            // subsData is { quizId: [submission1, submission2], ... }

            let submissionCount = 0;
            for (const [quizId, submissions] of Object.entries(subsData)) {
                if (Array.isArray(submissions)) {
                    for (const sub of submissions) {
                        const existing = await Submission.findOne({ id: sub.id });
                        if (!existing) {
                            // Ensure quizId is set (it should be in the object, but if not, use key)
                            if (!sub.quizId) sub.quizId = quizId;

                            await Submission.create(sub);
                            submissionCount++;
                        }
                    }
                }
            }
            console.log(`Migrated ${submissionCount} submissions.`);
        } else {
            console.log('No submissions.json found.');
        }

        console.log('Migration completed successfully.');

    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

migrate();
