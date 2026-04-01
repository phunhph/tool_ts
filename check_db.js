const mongoose = require('mongoose');
const Quiz = require('./models/Quiz');
const Submission = require('./models/Submission');

// Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/quizzes')
    .then(async () => {
        console.log('Connected to MongoDB');

        try {
            const quizCount = await Quiz.countDocuments();
            const submissionCount = await Submission.countDocuments();

            console.log(`Quizzes in MongoDB: ${quizCount}`);
            console.log(`Submissions in MongoDB: ${submissionCount}`);

            // Also check items
            if (quizCount > 0) {
                const q = await Quiz.findOne();
                console.log('Sample Quiz:', JSON.stringify(q, null, 2));
            }

        } catch (err) {
            console.error('Error querying database:', err);
        } finally {
            mongoose.disconnect();
        }
    })
    .catch(err => {
        console.error('Failed to connect to MongoDB:', err);
    });
