@echo off
echo ==============================================
echo  Bat dau cai dat Quiz System tren Windows
echo ==============================================

echo 1. Dang cai dat cac plugin Node.js...
call npm install

echo 2. Dang phuc hoi co so du lieu MongoDB...
mongorestore --db quizzes --drop mongo_dump\quizzes

echo 3. Hoan tat cai dat! Khoi dong server tai cong 4010...
call npm start
pause
