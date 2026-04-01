const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const xlsx = require('xlsx');

// Create a dummy excel file
const wb = xlsx.utils.book_new();
const data = [
    { "Câu hỏi": "Q1", "Phương án đúng": "A", "Đáp án 1": "A", "Đáp án 2": "B" },
    { "Câu hỏi": "Q2", "Phương án đúng": "B", "Đáp án 1": "A", "Đáp án 2": "B" },
    { "Câu hỏi": "Q3", "Phương án đúng": "A", "Đáp án 1": "A", "Đáp án 2": "B" },
];
const ws = xlsx.utils.json_to_sheet(data);
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
xlsx.writeFile(wb, "test_quiz.xlsx");

async function testUpload() {
    const form = new FormData();
    form.append('questionMode', 'random');
    form.append('randomCount', '2');
    form.append('file', fs.createReadStream('test_quiz.xlsx'));

    try {
        const response = await axios.post('http://localhost:3000/api/upload', form, {
            headers: {
                ...form.getHeaders()
            }
        });
        console.log('Response:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testUpload();
