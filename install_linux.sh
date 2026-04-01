#!/bin/bash
echo "=============================================="
echo " Bat dau cai dat Quiz System tren Linux"
echo "=============================================="

echo "1. Dang cai dat cac thu vien Node.js..."
npm install

echo "2. Dang phuc hoi co so du lieu MongoDB..."
mongorestore --db quizzes --drop mongo_dump/quizzes

echo "3. Hoan tat cai dat! Khoi dong server tai cong 4010..."
npm start
