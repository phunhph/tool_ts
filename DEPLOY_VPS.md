# Huong dan CI/CD deploy len VPS (step by step)

File workflow da tao: `.github/workflows/deploy-vps.yml`

Muc tieu: moi lan push code len `main`, GitHub Actions tu dong deploy len VPS vao thu muc `/var/www/polytest`.

---

## Step 1 - Chuan bi VPS

Dang nhap vao VPS, cai cac goi can thiet:

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Tao thu muc app:

```bash
sudo mkdir -p /var/www/polytest
sudo chown -R $USER:$USER /var/www/polytest
```

---

## Step 2 - Tao SSH key de GitHub Action vao duoc VPS

Tren may cua ban (hoac tren VPS), tao key rieng cho deploy:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_vps
```

Ban se co:
- private key: `~/.ssh/github_actions_vps`
- public key: `~/.ssh/github_actions_vps.pub`

Them public key vao VPS:

```bash
mkdir -p ~/.ssh
cat ~/.ssh/github_actions_vps.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## Step 3 - Cho phep VPS pull code tu GitHub repo

Can 1 cach de VPS clone/pull duoc repo private:

- Cach A (khuyen nghi): tao deploy key trong repo GitHub.
- Cach B: dung SSH key cua 1 bot user co quyen read repo.

Sau khi setup xong, tren VPS test:

```bash
git ls-remote <VPS_GIT_REPO>
```

Neu ra commit hash la OK.

---

## Step 4 - Tao GitHub Secrets

Vao repo GitHub:
**Settings -> Secrets and variables -> Actions -> New repository secret**

Tao cac secret sau:

1. `VPS_HOST`  
   IP hoac domain cua VPS.

2. `VPS_PORT`  
   Thuong la `22`.

3. `VPS_USER`  
   User SSH, vi du `root` hoac `ubuntu`.

4. `VPS_SSH_KEY`  
   Noi dung private key `~/.ssh/github_actions_vps` (copy full, gom ca BEGIN/END).

5. `VPS_GIT_REPO`  
   URL SSH cua repo, vi du: `git@github.com:your-org/your-repo.git`

6. `APP_ENV`  
   Toan bo noi dung file `.env` production, dang multi-line.

Vi du `APP_ENV`:

```env
PORT=4010
MONGO_URI=mongodb://127.0.0.1:27017/quizzes
DEFAULT_ADMIN_USERNAME=...
DEFAULT_ADMIN_PASSWORD=...
HYBRID_AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MAX_OUTPUT_TOKENS=3072
GOOGLE_SHEETS_CLIENT_EMAIL=...
GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEETS_SPREADSHEET_ID=...
```

---

## Step 5 - Day workflow len GitHub

Dam bao file nay da co trong repo:
- `.github/workflows/deploy-vps.yml`

Sau do commit va push:

```bash
git add .github/workflows/deploy-vps.yml DEPLOY_VPS.md
git commit -m "Add VPS deployment workflow and guide"
git push origin main
```

---

## Step 6 - Chay deploy lan dau

Co 2 cach:

- Cach 1: push code len `main` (workflow tu chay)
- Cach 2: vao tab **Actions** -> `Deploy To VPS` -> **Run workflow**

Deploy lan dau tren VPS se:
1. Tao/kiem tra thu muc `/var/www/polytest`
2. Clone repo neu chua co code
3. Checkout branch `main` va dong bo dung commit moi nhat
4. Cai dependencies (`npm ci --omit=dev`)
5. Ghi file `.env` tu secret `APP_ENV`
6. Cai PM2 neu chua co
7. Start hoac restart app bang PM2

---

## Step 7 - Kiem tra sau deploy

SSH vao VPS va chay:

```bash
cd /var/www/polytest
pm2 status
pm2 logs polytest --lines 100
```

Kiem tra cong app:

```bash
curl -I http://127.0.0.1:4010
```

Neu dung Nginx reverse proxy, kiem tra domain ngoai.

---

## Step 8 - Cac loi thuong gap va cach xu ly

1. `Permission denied (publickey)`  
   - Sai `VPS_SSH_KEY` hoac chua add public key vao `authorized_keys`.

2. VPS clone repo bi `Permission denied`  
   - VPS chua co key de doc repo private.
   - Kiem tra `VPS_GIT_REPO` va deploy key.

3. App len PM2 nhung crash lien tuc  
   - Kiem tra `.env` trong secret `APP_ENV`.
   - Xem log: `pm2 logs polytest`.

4. Deploy thanh cong nhung web khong vao duoc  
   - Kiem tra firewall, port, Nginx config.

---

## Ghi chu

- Workflow hien tai deploy branch `main`.
- Thu muc deploy mac dinh: `/var/www/polytest`.
- Ten process PM2: `polytest`.
- Neu can doi branch/thu muc/ten PM2, sua trong file `.github/workflows/deploy-vps.yml`.

