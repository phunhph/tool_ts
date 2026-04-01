const fetch = require('node-fetch');
require('dotenv').config();

const GEMINI_API_KEY = 'AIzaSyB2iYC8arDFSdDIQLPpzpuDbUPu5sHmN1M';
// Fixed model name from the list
const GEMINI_MODEL = 'gemini-flash-latest';

async function testGemini() {
    console.log('--- Testing Gemini API (Fixed Model Name) ---');
    console.log('Model:', GEMINI_MODEL);

    // server.js uses: https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    console.log('URL:', url);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': 'AIzaSyB2iYC8arDFSdDIQLPpzpuDbUPu5sHmN1M'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: 'Trả lời: OK'
                    }]
                }]
            })
        });

        const text = await response.text();
        console.log('Status:', response.status);

        if (response.ok) {
            const data = JSON.parse(text);
            console.log('Success Content:', data.candidates[0].content.parts[0].text);
        } else {
            console.error('Error Body:', text);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testGemini()