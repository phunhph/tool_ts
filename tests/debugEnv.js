const fetch = require('node-fetch');
require('dotenv').config();

console.log('--- Debugging .env Injection ---');
console.log('Raw GEMINI_API_KEY from process.env:', process.env.GEMINI_API_KEY);
console.log('Length:', (process.env.GEMINI_API_KEY || '').length);

if (process.env.GEMINI_API_KEY) {
    const key = process.env.GEMINI_API_KEY.trim();
    console.log('Trimmed Key:', key);
    console.log('Trimmed Length:', key.length);
}
