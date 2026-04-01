# Hướng dẫn cài đặt hệ thống Quiz

Bản backup này chứa toàn bộ mã nguồn và dữ liệu (database cũ). 
Lưu ý: Bạn cần cài đặt các phần mềm tiên quyết trước khi tiến hành cài đặt mã nguồn.

## Yêu cầu hệ thống:
1. **Node.js**: Phiên bản 18 trở lên (Tải về từ https://nodejs.org)
2. **MongoDB Server**: (Tải về MongoDB Community Server và MongoDB Database Tools từ https://www.mongodb.com/try/download/community)
   - *Lưu ý*: MongoDB Database Tools cung cấp lệnh `mongorestore` để phục hồi database.

---

## 💻 Môi trường Windows:

1. Giải nén tệp `backup_polytest_20260324_1.zip` vào một thư mục trên máy (ví dụ: `C:\polytest`).
2. Mở Command Prompt hoặc nháy đúp chuột vào file `install_windows.bat` nằm trong thư mục vừa giải nén.
3. Script sẽ tự động:
   - Cài đặt các thư viện Node.js cần thiết (`npm install`).
   - Phục hồi lại toàn bộ cơ sở dữ liệu (`mongorestore`).
   - Khởi động server (`npm start` hoặc `node server.js`).
4. Truy cập trình duyệt tại địa chỉ: **http://localhost:4010** để sử dụng phần mềm.

---

## 🐧 Môi trường Linux:

1. Giải nén tệp `backup_polytest_20260324_1.zip`:
   ```bash
   unzip backup_polytest_20260324_1.zip -d polytest
   cd polytest
   ```
2. Đảm bảo bạn đã cài đặt sẵn `nodejs`, `npm`, `mongodb` và `mongodb-database-tools` trên máy Linux.
3. Cấp quyền thực thi cho file script:
   ```bash
   chmod +x install_linux.sh
   ```
4. Chạy lệnh cài đặt:
   ```bash
   ./install_linux.sh
   ```
5. Truy cập trình duyệt tại địa chỉ: **http://localhost:4010** để sử dụng ứng dụng.
