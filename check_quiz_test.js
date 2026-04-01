const mongoose = require('mongoose');
const Quiz = require('./models/Quiz');

mongoose.connect('mongodb://127.0.0.1:27017/quizzes')
    .then(async () => {
        const quiz = await Quiz.findOne({ id: 'e4cde460-601d-4eaa-bf11-46776c1d4e24' });
        if (quiz) {
            console.log(`Quiz Questions Count: ${quiz.questions.length}`);
            console.log(`Question Mode (inferred): ${quiz.questions.length < 3 ? 'Random' : 'All'}`);
        } else {
            console.log('Quiz not found');
        }
        mongoose.disconnect();
    })
    .catch(err => console.error(err));
