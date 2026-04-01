#!/usr/bin/env node
/**
 * Tạo/cập nhật tài khoản admin trong MongoDB.
 * Chạy: node seed-admin.js
 * Mặc định: username hungnq, password HungNQ@1979
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
require('./models/Admin');

const ADMIN_USER = process.env.ADMIN_USER || 'hungnq';
const ADMIN_PASS = process.env.ADMIN_PASS || 'HungNQ@1979';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quizzes';

async function seed() {
    await mongoose.connect(MONGO_URI);
    const Admin = mongoose.model('Admin');
    const passwordHash = crypto.createHash('sha256').update(ADMIN_PASS).digest('hex');
    const existing = await Admin.findOne({ username: ADMIN_USER });
    if (existing) {
        await Admin.updateOne({ username: ADMIN_USER }, { passwordHash });
        console.log('Admin password updated:', ADMIN_USER);
    } else {
        await Admin.create({ username: ADMIN_USER, passwordHash });
        console.log('Admin created:', ADMIN_USER);
    }
    await mongoose.disconnect();
    process.exit(0);
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
