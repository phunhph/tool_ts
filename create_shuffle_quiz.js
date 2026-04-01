const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { execSync } = require('child_process');

const API_URL = 'http://localhost:3000/api';

async function createTestExcel() {
    const wb = xlsx.utils.book_new();
    const headers = ["Câu hỏi", "Đáp án 1", "Đáp án 2", "Đáp án 3", "Đáp án 4", "Phương án đúng"];
    const data = [
        headers,
        ["Q1: 1+1?", "1", "2", "3", "4", "2"],
        ["Q2: 2+2?", "3", "4", "5", "6", "4"],
        ["Q3: 3+3?", "5", "6", "7", "8", "6"],
        ["Q4: Sky is?", "Blue", "Green", "Red", "Yellow", "Blue"]
    ];
    const ws = xlsx.utils.aoa_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync('shuffle_test.xlsx', buffer);
}

async function uploadQuiz() {
    // No specific time limit, just active
    const start = new Date(Date.now() - 60000).toISOString();
    const end = new Date(Date.now() + 3600000).toISOString();

    let cmd = `curl -s -X POST -F "file=@shuffle_test.xlsx" -F "teacherName=ShuffleTester" -F "startTime=${start}" -F "endTime=${end}" ${API_URL}/upload`;

    console.log(`Creating shuffle test quiz...`);
    try {
        const result = execSync(cmd).toString();
        const json = JSON.parse(result);
        console.log(`QuizID: ${json.quizId}`);
        fs.writeFileSync('shuffle_quiz_id.txt', json.quizId);
    } catch (e) {
        console.error("Upload failed:", e.message);
    }
}

createTestExcel().then(uploadQuiz);
