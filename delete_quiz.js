const fs = require('fs');
const path = require('path');

const QUIZZES_FILE = path.join(__dirname, 'data', 'quizzes.json');
const SUBMISSIONS_FILE = path.join(__dirname, 'data', 'submissions.json');
const ID_TO_DELETE = '4476e6f7-a735-49b2-8da2-f8c0af521d24';

function deleteQuiz() {
    try {
        if (fs.existsSync(QUIZZES_FILE)) {
            const quizzes = JSON.parse(fs.readFileSync(QUIZZES_FILE, 'utf8'));
            if (quizzes[ID_TO_DELETE]) {
                delete quizzes[ID_TO_DELETE];
                fs.writeFileSync(QUIZZES_FILE, JSON.stringify(quizzes, null, 2));
                console.log(`Deleted quiz ${ID_TO_DELETE} from quizzes.json`);
            } else {
                console.log(`Quiz ${ID_TO_DELETE} not found in quizzes.json`);
            }
        }

        if (fs.existsSync(SUBMISSIONS_FILE)) {
            const submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8'));
            if (submissions[ID_TO_DELETE]) {
                delete submissions[ID_TO_DELETE];
                fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
                console.log(`Deleted submissions for ${ID_TO_DELETE} from submissions.json`);
            } else {
                console.log(`Submissions for ${ID_TO_DELETE} not found in submissions.json`);
            }
        }
    } catch (err) {
        console.error('Error deleting quiz:', err);
    }
}

deleteQuiz();
