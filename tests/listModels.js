const fetch = require('node-fetch');
require('dotenv').config();

const GEMINI_API_KEY = 'AIzaSyB2iYC8arDFSdDIQLPpzpuDbUPu5sHmN1M';

async function listModels() {
    console.log('--- Listing Gemini Models with Methods ---');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

    try {
        const response = await fetch(url, { method: 'GET' });
        const data = await response.json();

        if (response.ok) {
            data.models.forEach(m => {
                console.log(` - ${m.name}`);
                console.log(`   Methods: ${m.supportedGenerationMethods.join(', ')}`);
            });
        } else {
            console.error('API Error:', response.status);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

listModels();
