#!/bin/bash
echo "=== BẮT ĐẦU TRIỂN KHAI HỆ THỐNG QUIZZES ==="

echo "1. Đang cài đặt các thư viện Node.js..."
npm install

echo "2. Đang khôi phục cơ sở dữ liệu (MongoDB)..."
if [ -d "mongo_dump/quizzes" ]; then
    mongorestore --db quizzes --drop mongo_dump/quizzes/
    echo "Khôi phục thành công!"
else
    echo "Bỏ qua do không tìm thấy file mongo_dump. Data sẽ trống."
fi

echo "3. Khởi chạy Server Backend..."
# Dừng app cũ nếu trùng tên
pm2 stop polytest 2>/dev/null
pm2 delete polytest 2>/dev/null

# Chạy App
pm2 start server.js --name "polytest"
pm2 save

echo "=== ĐÃ TRIỂN KHAI THÀNH CÔNG ==="
echo "Quizzes App đang chạy ngầm trên cổng mạng 4200."
