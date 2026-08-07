# Deploy ke VPS (Contabo 4 core / 8GB)

Target: `https://example.com` → dashboard, `https://example.com/api` → backend Go.
Ganti `example.com` dengan domain asli di semua langkah.

**Tanpa Docker.** Aplikasi ini = 1 binary Go (SQLite pure-Go, tanpa CGO) + folder static hasil Vite.
Nginx serve static + proxy `/api`, systemd jaga prosesnya. Docker cuma nambah layer build & volume tanpa manfaat di satu VPS.

Asumsi OS: **Ubuntu 24.04 LTS**.

---

## 0. DNS (lakukan duluan, propagasi butuh waktu)

Di panel domain, buat A record:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `62.146.238.17_ANDA` |
| A | `www` | `62.146.238.17_ANDA` |

Cek dari laptop: `nslookup example.com` — harus keluar IP VPS.

---

## 1. Login & user non-root

```bash
ssh root@62.146.238.17

adduser deploy                 # isi password
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/   # bawa SSH key root
```

Keluar, lalu login sebagai `deploy` (semua langkah berikutnya sebagai user ini):

```bash
ssh deploy@62.146.238.17
```

---

## 2. Firewall + paket dasar

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl ufw

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Port 3030 **tidak** dibuka ke publik — hanya diakses nginx via localhost.

---

## 3. Install Go 1.25 + Node 20

Repo apt Ubuntu punya Go versi lama; project butuh Go 1.25.8+. Ambil dari go.dev:

```bash
cd /tmp
curl -LO https://go.dev/dl/go1.25.8.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.25.8.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
source /etc/profile.d/go.sh
go version        # harus go1.25.8
```

Node 20 (untuk build frontend saja):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v           # v20.x

rm -f /tmp/go1.25.8.linux-amd64.tar.gz   # bersihkan installer, sudah tidak dipakai
```

---

## 4. Ambil source code

Semua perintah di bawah pakai path absolut, jadi tidak masalah shell Anda masih di `/tmp` dari langkah sebelumnya.

```bash
sudo mkdir -p /opt/raizencrm
sudo chown deploy:deploy /opt/raizencrm
git clone https://github.com/rapidkaizen-cloud/raizencrm.git /opt/raizencrm
cd /opt/raizencrm
```

Repo private → GitHub minta login. Buat **Personal Access Token** (Settings → Developer settings → Tokens, scope `repo`), lalu pakai token itu sebagai password saat `git clone` minta credential.

Alternatif tanpa git — upload dari laptop (jalankan di PowerShell laptop):

```powershell
scp -r D:\raizencrm deploy@62.146.238.17:/opt/
```

---

## 5. Konfigurasi `.env`

`.env` tidak ikut di-commit (ada di `.gitignore`), jadi harus dibuat di server:

```bash
cd /opt/raizencrm
cp .env.example .env
nano .env
```

Isi minimal:

```ini
# Database — pakai SQLite (paling simpel, tidak perlu install MySQL)
DB_HOST=sqlite
DB_PATH=/opt/raizencrm/wa-assistant.db

# Keamanan — WAJIB ganti
JWT_SECRET=<hasil perintah di bawah>
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=<password minimal 12 karakter>

# Server
PORT=3030
CORS_ALLOWED_ORIGINS=https://example.com

# AI
DEEPSEEK_API_KEY=sk-...
OPENROUTER_API_KEY=            # opsional, fallback + vision

# Ongkir
MENGANTAR_API_KEY=
MENGANTAR_ORIGIN_AUTOFILL_ID=
```

Generate JWT_SECRET:

```bash
openssl rand -hex 32
```

Kunci file (isinya API key & password):

```bash
chmod 600 /opt/raizencrm/.env
```

> **MySQL?** Tidak perlu untuk mulai. SQLite mode WAL sanggup untuk skala satu bisnis, dan backup = copy 1 file.
> Kalau nanti butuh: `sudo apt install mysql-server`, buat user+db, lalu isi `DB_HOST=localhost` + `DB_USER`/`DB_PASS`/`DB_NAME` di `.env`. Kode otomatis pakai MySQL kalau koneksinya berhasil.

---

## 6. Lisensi (penting — kalau salah, server langsung exit)

Backend memverifikasi lisensi saat startup. `LICENSE_KEY` kosong → proses **berhenti** dengan pesan "LISENSI BELUM AKTIF".

Dua pilihan:

**a. Punya lisensi** — isi di `.env`: `LICENSE_KEY`, `LICENSE_API_SECRET`, `LICENSE_API_URL`, `LICENSE_RESPONSE_SIGNING_PUBLIC_KEY`. Build biasa (`DevMode=false`).

**b. Instalasi sendiri / belum ada lisensi** — build dengan dev mode supaya verifikasi dilewati:

```bash
go build -ldflags "-X wa-assistant/backend/license.DevMode=true" -o raizencrm ./backend
```

---

## 7. Build

```bash
cd /opt/raizencrm

# Backend (pilih salah satu ldflags sesuai langkah 6)
go mod download
go build -ldflags "-X wa-assistant/backend/license.DevMode=true" -o raizencrm ./backend

# Frontend
cd frontend
npm ci
npm run build          # output ke frontend/dist/
cd ..
```

Test manual dulu sebelum dijadikan service:

```bash
cd /opt/raizencrm && ./raizencrm
```

Harus muncul banner hijau "server siap" di port 3030. `Ctrl+C` untuk stop.
Kalau muncul kotak merah lisensi → ulang langkah 6.

---

## 8. systemd service

```bash
sudo nano /etc/systemd/system/raizencrm.service
```

```ini
[Unit]
Description=Raizen CRM — WhatsApp AI Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/raizencrm
ExecStart=/opt/raizencrm/raizencrm
Restart=always
RestartSec=5
Environment=NO_COLOR=1

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` wajib `/opt/raizencrm` — aplikasi baca `.env`, tulis `wa-assistant.db` dan folder `data/` (sesi WhatsApp + media) secara relatif.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now raizencrm
sudo systemctl status raizencrm
sudo journalctl -u raizencrm -f       # lihat log realtime
```

---

## 9. Nginx

```bash
sudo nano /etc/nginx/sites-available/raizencrm
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;

    root /opt/raizencrm/frontend/dist;
    index index.html;

    # Upload media / gambar produk (backend batasi 32MB)
    client_max_body_size 32M;

    # SPA — semua route non-file dilempar ke index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Asset build punya hash di nama file → aman di-cache lama
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Scan QR & sinkronisasi WhatsApp bisa lama
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Nginx (user `www-data`) harus bisa menembus `/opt/raizencrm` untuk baca `dist/`:

```bash
sudo chmod 755 /opt/raizencrm /opt/raizencrm/frontend
sudo ln -s /etc/nginx/sites-available/raizencrm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Buka `http://example.com` — dashboard sudah harus muncul (masih HTTP).

---

## 10. HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
```

Pilih **redirect HTTP → HTTPS** saat ditanya. Certbot otomatis menyunting file nginx di atas dan memasang timer auto-renew.

Cek renewal:

```bash
sudo certbot renew --dry-run
```

---

## 11. Verifikasi akhir

```bash
curl -I https://example.com                        # 200
curl https://example.com/api/me                    # 401 (benar — belum login)
sudo systemctl status raizencrm nginx
```

Buka `https://example.com` → login dengan `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` dari `.env` → Agents → Create → scan QR WhatsApp.

---

## Operasional

**Update kode:**

```bash
cd /opt/raizencrm
git pull
go build -ldflags "-X wa-assistant/backend/license.DevMode=true" -o raizencrm ./backend
cd frontend && npm ci && npm run build && cd ..
sudo systemctl restart raizencrm
```

**Backup** (DB + sesi WhatsApp + media — semua state ada di 2 tempat ini):

```bash
sudo crontab -e
```

```cron
0 2 * * * tar czf /root/backup-raizencrm-$(date +\%F).tar.gz -C /opt/raizencrm wa-assistant.db data .env && find /root -name 'backup-raizencrm-*.tar.gz' -mtime +7 -delete
```

**Log:** `sudo journalctl -u raizencrm -n 200 --no-pager`

---

## Troubleshooting

| Gejala | Sebab / solusi |
|--------|----------------|
| Kotak merah "LISENSI BELUM AKTIF" | Build ulang dengan `DevMode=true`, atau isi `LICENSE_KEY` di `.env` |
| 502 Bad Gateway | Backend mati → `sudo systemctl status raizencrm` dan cek journalctl |
| 403 Forbidden di halaman utama | Nginx tidak bisa baca `dist/` → ulang `chmod 755` di langkah 9 |
| Refresh halaman → 404 | `try_files ... /index.html` hilang dari blok `location /` |
| Login gagal terus | `SUPERADMIN_*` di `.env` hanya dipakai saat user pertama dibuat. Ganti password lewat dashboard, atau hapus `wa-assistant.db` untuk seed ulang (semua data hilang) |
| Upload gambar gagal | `client_max_body_size` di nginx lebih kecil dari `MAX_REQUEST_MB` (default 32MB) |
| WhatsApp sering disconnect | Normal; watchdog reconnect tiap 90 detik. Cek log kalau tidak pulih |
