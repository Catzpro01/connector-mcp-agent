# Buku Panduan Operasional: Connector Multi-Agent Ecosystem

## 1. Metrik Pemakaian RAM & Sumber Daya
- **Proses Server (`connector.service`)**: Hanya **35.3 MB** (peak 82 MB). Sangat hemat dan tidak membebani VPS.
- **Total Pemakaian VPS**: ~389 MB dari 1.9 GB RAM total (Tersedia **1.5 GB RAM bebas** untuk beban kerja kompilasi kontainer).
- **Resource Ceiling Per Project**: Dibatasi maksimal `--cpus 2 --memory 4g` via Podman sandbox.

---

## 2. Kemudahan Instalasi Ulang (Zero Friction Setup)

### A. Instalasi Ulang di Server VPS (Hanya 3 Langkah Cepat)
```bash
# 1. Clone repository server
git clone https://github.com/Catzpro01/connector-mcp-server.git
cd connector-mcp-server

# 2. Install dependensi & build
npm install && npm run build

# 3. Jalankan service via systemd (atau npm start)
sudo systemctl restart connector
```
*Konfigurasi server*: Cukup satu file systemd di `/etc/systemd/system/connector.service` (sudah menyertakan Port `3210`, Podman image `ubuntu:24.04`, Token GitHub, dan Token Telegram Bot).

### B. Instalasi Ulang di Laptop / Agent Side (1 Perintah)
```bash
# Opsi 1: Dari npm lokal / direktori clone
cd connector-cli-pkg
npm install && npm run build
npm link

# Opsi 2: Langsung dari GitHub
npm install -g git+https://github.com/Catzpro01/connector-mcp-agent.git
```
*Konfigurasi agent*: **Zero Configuration**. CLI otomatis tersambung ke `http://your-vps-ip:3210`. Menu setting telah dihilangkan dari CLI client sehingga agen tidak bisa salah konfigurasi.

---

## 3. Pengawasan Server via Telegram Bot Admin (`@adm_connector_cli_1_bot`)

Bot Telegram telah aktif terhubung langsung ke daemon server VPS via long polling:
- **Nama Bot**: `admin_connector_cli`
- **Username Bot**: `@adm_connector_cli_1_bot`

### Cara Mengaktifkan:
1. Buka Telegram dan cari `@adm_connector_cli_1_bot` (atau klik tautan bot).
2. Kirim perintah `/start`.
3. Bot otomatis mencatat `chat_id` Anda sebagai **Admin Utama Server** (*Security Gate* mengunci bot agar hanya merespon akun Anda).

### Perintah Admin di Telegram:
| Perintah | Fungsi |
| :--- | :--- |
| `/status` | Cek penggunaan RAM real-time, uptime server, dan jumlah agen online. |
| `/agents` | Tampilkan daftar whitelist agen dan status live (`🟢 ONLINE`, `⚪ offline`, `🔴 disabled`). |
| `/kick <nama>` | Putuskan sesi agen tertentu secara paksa jika stuck atau loop. |
| `/broadcast <pesan>` | Kirim pesan broadcast admin yang langsung muncul di terminal agen aktif. |
| `/lapor` | Baca 3 laporan progress terbaru dari channel GitHub Issue #2 (`[smoke-app] #progress`). |
| `/podman` | Lihat daftar kontainer sandbox yang sedang running di VPS. |
| `/memory` | Lihat ringkasan entitas & observasi di Knowledge Graph project. |
| `/help` | Tampilkan bantuan menu perintah. |

---

## 4. Alur & Eksplorasi Menu dari Sisi Server

Di server VPS (melalui terminal SSH `ssh fern-vps`):

### A. Dashboard Live Pemantauan (`connector-cli pantau`)
Buka terminal interaktif full-screen:
```bash
connector-cli pantau
```
- Menampilkan tabel agen live: Nama, Sesi, Status (`IDLE`, `BUSY`, `CHATTING`), Proyek, Durasi Aktif.
- Tombol Pintasan Interaktif:
  - `[K]` : Kick agen aktif.
  - `[D]` : Disable agen (mencegah login).
  - `[E]` : Enable agen kembali.
  - `[B]` : Kirim broadcast pesan ke semua agen.
  - `[Q]` : Keluar dari pemantauan.

### B. Perintah Administrasi Server (CLI Subcommands)
```bash
connector-cli agent list                 # Lihat daftar whitelist agen
connector-cli agent add <nama>           # Daftarkan agen baru ke whitelist
connector-cli agent disable <nama>       # Nonaktifkan agen sementara
connector-cli agent enable <nama>        # Aktifkan kembali agen
connector-cli agent remove <nama>        # Hapus agen dari whitelist
connector-cli broadcast "Pesan Anda"     # Kirim pengumuman admin
```

---

## 5. Alur & Eksplorasi Menu dari Sisi Agent Client (`connector-cli`)

Jalankan perintah utama:
```bash
connector-cli
```

### Langkah 1: Otentikasi & Whitelist Gate
```text
🤖 Masukkan Nama Agen: matt
⏳ Memverifikasi autentikasi ke server VPS...
✓ Autentikasi berhasil sebagai 'matt'. Mutex sesi aktif.
```
- Jika nama tidak ada di whitelist server $\rightarrow$ Ditolak (`HTTP 403 Forbidden`).
- Jika nama `matt` sedang aktif di laptop lain $\rightarrow$ Ditolak (`Single-login mutex aktif`).

### Langkah 2: Menu Utama (3 Pilihan Bersih)
```text
nama agent: matt
----------------------
  1. project latest
  2. new project
  3. project list
```
1. **`1. project latest`** $\rightarrow$ Langsung membuka project yang paling terakhir dikerjakan beserta pewarisan progres (*Inherited Memory*).
2. **`2. new project`** $\rightarrow$ Membuat project baru di VPS (dibuatkan direktori, git repo, kontainer podman, dan knowledge graph).
3. **`3. project list`** $\rightarrow$ Menampilkan daftar seluruh project yang ada di VPS untuk dipilih.

### Langkah 3: Lingkungan Project (Dual-Tab Environment)
Setelah memilih project (misal `smoke-app`), muncul sub-menu lingkungan kerja:
```text
Pilih lingkungan kerja untuk 'smoke-app':
  a. tab vps (interactive remote shell)
  b. tab disk session (interactive remote shell)
  c. project list (kembali)
```

---

### A. Eksplorasi Tab VPS (`[ VPS ]`)
```text
[ VPS ] matt@smoke-app:/workspace$ 
```
Ini adalah shell Linux penuh di dalam kontainer sandbox:
- **Perintah Linux Bebas**: `ls`, `pwd`, `cargo build`, `npm install`, `python script.py`, `git status`.
- **Perintah `tabs`**: Melihat status tab background.
  - Mengetik perintah panjang otomatis berjalan di background saat agen berpindah tab.
  - **Mandatory Rename Tab**: Saat berpindah atau membuka tab baru, agen diwajibkan memberi nama tab (tersedia auto-suggest nama dari perintah terakhir).
- **Floating Toast Notification**:
  Ketika kompilasi/instalasi di tab background selesai, banner mengambang muncul di layar tanpa merusak alur ketikan:
  ```text
  [NOTIFIKASI TABS] Tab #2 [cargo-build] telah selesai (exit code: 0)
  ```
- **Perintah Lapor Progres**:
  ```text
  [ VPS ] matt@smoke-app:/workspace$ lapor "Berhasil menyelesaikan modul autentikasi"
  ```
  Otomatis menghasilkan Change UID (`chg-8f2a`) dan mengirim komentar terformat ke GitHub Issue #2 (`#progress`).
- **Anti-Exit Trap**:
  Mengetik `exit` tidak langsung membunuh sesi, melainkan meminta konfirmasi agar agen tetap berada dalam mode kerja.

---

### B. Eksplorasi Tab Disk Session (`[ SESSION ]`)
```text
[ SESSION ] matt@smoke-app:/session$ 
```
Ini adalah disk lokal agen khusus untuk memori, penalaran, dan pencarian kode instan:

#### 1. Manajemen Memori MCP Knowledge Graph (Zero-Lossy):
- `graph` : Melihat seluruh struktur pohon entitas dan relasi project dari VPS.
- `search <query>` : Mencari entitas dan observasi teknis spesifik (mengembalikan sub-graph terfokus untuk kompresi context window).
- `node <name>` : Menampilkan detail lengkap sebuah entitas beserta relasi tetangganya.
- `learn <entity> <type> <observasi>` : Menyimpan fakta teknis atomik baru ke graph permanen VPS tanpa takut terpotong ringkasan.
- `relate <from> <type> <to>` : Menghubungkan relasi dependensi antar entitas.

#### 2. Pencarian Kode Instan Seperti Cursor:
- `code <query>` : Mencari baris kode dan simbol dalam hitungan milidetik (<10ms) dengan skor relevansi tanpa `grep` brute force.
- `symbol <name>` : Menemukan definisi fungsi, kelas, interface, atau konstanta di codebase.
- `outline <file>` : Melihat daftar hierarki simbol dan nomor baris dari file tertentu.
- `reindex` : Memperbarui cache indeks kode di VPS berbasis SHA-256 hash.

#### 3. Navigasi & File Lokal:
- `inbox` : Membaca pesan offline dan mention dari agen lain di `memory/INBOX.md`.
- `ls`, `cd`, `cat <file>`, `write <file>` : Operasi file lokal di disk session agen.
- `clear` : Membersihkan layar.
- `exit` : Kembali ke menu project.

---

### C. Perintah Langsung CLI (Non-Interaktif)
Agen atau skrip juga bisa memanggil perintah langsung dari terminal luar tanpa masuk ke menu:
```bash
connector-cli vps whoami                        # Eksekusi instan di VPS
connector-cli memory graph                      # Lihat Knowledge Graph
connector-cli memory search "mutex"             # Cari di Knowledge Graph
connector-cli memory learn Auth core "Catatan"  # Tambah fakta baru
connector-cli code search "mutex"               # Cari kode instan
connector-cli symbol "ApplicationService"       # Cari simbol
connector-cli outline "src/index.ts"            # Outline simbol file
connector-cli reindex                           # Reindex codebase
```
