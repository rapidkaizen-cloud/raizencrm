# Catatan Perbaikan Kode — Deploy Produksi Pertama

Bug kode yang ditemukan saat deploy ke VPS dan perbaikannya. 7 Agustus 2026.
Commit terkait: `5df26f9`, `c69ab96`.

---

## 1. Tabrakan nama driver SQLite → QR WhatsApp gagal total

**Gejala**

Dashboard jalan normal, login sukses, tapi begitu klik Agents → Scan QR muncul:

```
gagal buat store: failed to upgrade database: failed to check if foreign keys
are enabled: Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo
to work. This is a stub
```

**Akar masalah**

Ada dua driver SQLite di binary yang sama, berebut satu nama:

| Paket | Didaftarkan sebagai | Butuh CGO? |
|-------|--------------------|-----------|
| `github.com/mattn/go-sqlite3` — ikut terbawa `gorm.io/driver/sqlite` | `"sqlite3"` | Ya |
| `modernc.org/sqlite` | `"sqlite"` (oleh init-nya sendiri) | Tidak (pure Go) |

Alurnya begini:

1. [database.go](backend/database/database.go) mengimpor `gorm.io/driver/sqlite`, yang secara transitif menarik `mattn/go-sqlite3`.
2. `init()` milik mattn berjalan lebih dulu dan mengklaim nama `"sqlite3"`. Saat `CGO_ENABLED=0`, yang terdaftar adalah **stub** dari `static_mock.go` — driver palsu yang tugasnya cuma melempar pesan error di atas.
3. `wa.go` lalu mencoba mendaftarkan modernc di nama `"sqlite3"` juga. Nama sudah dipakai, jadi `sql.Register` panic dengan `Register called twice`.
4. Panic itu ditelan `defer func() { recover() }()` — **tanpa log, tanpa jejak**. Program lanjut seolah tidak terjadi apa-apa.
5. Akibatnya `sqlstore.New(ctx, "sqlite3", ...)` selalu mendapat stub mattn, dan setiap operasi sesi WhatsApp gagal.

**Kenapa lolos di localhost**

Laptop punya C compiler, jadi Go menyalakan `CGO_ENABLED=1` secara default. Di kondisi itu mattn adalah driver asli yang berfungsi, sehingga gejalanya tidak pernah muncul. VPS Ubuntu bersih tidak punya gcc → `CGO_ENABLED=0` → mattn berubah jadi stub.

Bug ini **selalu ada** sejak awal; lingkungan lokal saja yang kebetulan menutupinya.

**Perbaikan** — [backend/services/wa.go](backend/services/wa.go)

```diff
- // Pure-Go SQLite driver (no CGO needed) — terdaftar sebagai "sqlite3"
- "database/sql"
- sqlite "modernc.org/sqlite"
+ // Driver SQLite pure-Go; init-nya mendaftarkan diri sebagai "sqlite".
+ // Jangan pakai nama "sqlite3" — itu sudah dipegang mattn/go-sqlite3 (via
+ // gorm.io/driver/sqlite) yang jadi stub tanpa CGO.
+ _ "modernc.org/sqlite"

- func init() {
-     defer func() { recover() }()
-     sql.Register("sqlite3", &sqlite.Driver{})
- }
```

Lalu ketiga pemanggilan `sqlstore.New` diubah dari `"sqlite3"` → `"sqlite"`
(baris ~227 `FirstDeviceJID`, ~253 `Connect`, ~302 `ConnectPairing`).

**Kenapa `"sqlite"` aman dipakai whatsmeow**

Argumen kedua `sqlstore.New` dipakai untuk dua hal, dan keduanya cocok:

- Sebagai nama driver di `sql.Open` → modernc memang mendaftarkan diri sebagai `"sqlite"`.
- Sebagai *dialect* untuk `dbutil.ParseDialect`, yang mencocokkan dengan `strings.HasPrefix(engine, "sqlite")` — jadi `"sqlite"` tetap dikenali sebagai SQLite, bukan Postgres.

Bonus: DSN di `sessionDSN()` memakai sintaks `?_pragma=foreign_keys(1)` yang **khusus modernc** — mattn tidak mengerti format itu. Jadi kode ini memang sejak awal dirancang untuk modernc; nama `"sqlite3"` yang salah.

**Kenapa bukan sekadar install gcc**

Menambah `apt install gcc` lalu build dengan CGO memang menghilangkan gejala, tapi meninggalkan tiga masalah: binary tidak lagi portabel, DSN `_pragma=` tetap salah alamat, dan bug akan meledak lagi di mesin build berikutnya yang tanpa compiler. Perbaikan di atas menghapus penyebabnya, bukan menutupinya.

**Verifikasi**

```bash
CGO_ENABLED=0 go build -ldflags "-X wa-assistant/backend/license.DevMode=true" -o raizencrm ./backend
```

Lolos — kondisi identik dengan VPS.

---

## 2. Variabel mati menggagalkan build frontend

**Gejala**

```
src/components/InboxPanel.tsx:693:9 - error TS6133: 'oldestId' is declared but its value is never read.
```

**Akar masalah**

Sisa refactor. Komponen presentasional itu menghitung `oldestId` tapi tidak pernah memakainya — pagination sebenarnya dikerjakan di parent ([InboxPanel.tsx:1120-1121](frontend/src/components/InboxPanel.tsx#L1120-L1121)), yang menghitung ulang `oldestId` lalu memanggil `loadOlderMsgs.mutate()`. Komponen anak hanya menerima callback `onLoadOlder` sebagai prop.

**Kenapa baru ketahuan saat deploy**

`npm run dev` memakai esbuild yang cuma membuang anotasi tipe tanpa type-check. Build produksi menjalankan `tsc -b` penuh, sehingga aturan `noUnusedLocals` baru menggigit di sana.

**Perbaikan** — hapus baris 693. Tidak ada perubahan perilaku, murni buang kode mati.

---

## 3. Dropdown "Model percakapan" diabaikan saat provider DeepSeek Direct

**Gejala**

Provider Chat AI diset ke DeepSeek Direct dan API key DeepSeek sudah diisi, tapi kartu "Model percakapan" tetap menampilkan 400 model dari katalog OpenRouter. Model yang dipilih di situ tidak berpengaruh sama sekali — DeepSeek sendiri cuma punya segelintir model.

**Akar masalah**

`activePreset()` melakukan early return begitu `chat_provider` cocok dengan salah satu preset, sehingga setting `api_model` di bawahnya tidak pernah terbaca ([ai.go:201-223](backend/services/ai.go#L201-L223)). Preset `deepseek-direct` sendiri mengunci `Model: "deepseek-chat"` secara hardcode.

Di sisi lain, `ListChatModels` selalu memukul `openRouterBase + "/models"` dengan key OpenRouter, apa pun providernya. Jadi dashboard menyimpan pilihan ke `api_model`, backend membacanya hanya kalau provider = OpenRouter, dan tidak ada satu pun indikasi di UI bahwa pilihan itu dibuang.

**Perbaikan**

| Berkas | Perubahan |
|--------|-----------|
| [ai.go](backend/services/ai.go) | Preset `deepseek-direct` baca `apiConfigFromDB("deepseek_model", "DEEPSEEK_MODEL", "deepseek-chat")` — tidak lagi hardcode |
| [ai.go](backend/services/ai.go) | `listChatModels(ctx, base, key, label)` diekstrak dari `ListOpenRouterChatModels`; `ListChatModelsForProvider` mengarahkan ke katalog DeepSeek atau OpenRouter |
| [api_config.go](backend/handlers/api_config.go) | `deepseek_model` masuk `apiConfigKeys`; handler meneruskan query `?provider=` |
| [Dashboard.tsx](frontend/src/pages/Dashboard.tsx) | State `deepseekModel` terpisah; label, helper text, dan katalog ikut provider; ganti provider langsung memuat ulang daftar |

Model DeepSeek diambil dari endpoint `/models` milik DeepSeek (OpenAI-compatible), bukan daftar hardcode — kalau DeepSeek merilis model baru, dropdown ikut terisi tanpa ubah kode.

**Kenapa `deepseek_model` dipisah dari `api_model`**

Format ID-nya beda dan tidak saling kompatibel: `deepseek-chat` vs `deepseek/deepseek-chat`. Kalau dipakai bersama, tiap kali ganti provider model tersimpan jadi ID yang tidak dikenali provider baru.

**Catatan**

Key OpenRouter tetap wajib walau chat pakai DeepSeek — vision ([ai.go:99](backend/services/ai.go#L99)) dan embedding ([embedding.go:96](backend/services/embedding.go#L96)) tidak punya padanan di DeepSeek.

**Verifikasi**

```bash
go build ./... && go test ./backend/services/ -run TestFilterChatModels -count=1
cd frontend && npx tsc --noEmit
```

Katalog DeepSeek tidak mengirim field `name`, jadi `filterChatModels` diurutkan dengan ID sebagai cadangan — itu yang dijaga `TestFilterChatModelsTanpaName`.

---

## 4. Yang Perlu Diwaspadai

Ketiga hal di bawah ini adalah selisih lingkungan yang membuat bug lolos dari dev ke produksi:

| Aspek | Lokal (Windows) | VPS (Ubuntu bersih) | Dampak |
|-------|-----------------|---------------------|--------|
| C compiler | Ada → `CGO_ENABLED=1` | Tidak ada → `CGO_ENABLED=0` | Menyembunyikan bug #1 sepenuhnya |
| Type check | esbuild, tanpa `tsc` | `tsc -b` penuh | Menyembunyikan bug #2 |
| Lisensi | `dev.mjs` & `.air.toml` menyuntik `DevMode=true` diam-diam | Harus ditulis manual di perintah build | Tanpa flag, server `os.Exit(1)` saat startup — dengan `Restart=always`, systemd loop crash dan nginx cuma menampilkan 502 |

**Cara paling murah menangkapnya sebelum push** — jalankan di laptop:

```bash
CGO_ENABLED=0 go build -ldflags "-X wa-assistant/backend/license.DevMode=true" -o /tmp/cek ./backend
cd frontend && npm run build
```

Kalau dua perintah itu lolos, sisa kejutannya tinggal urusan DNS dan nginx.

**Utang teknis yang sengaja ditinggal:**

- `github.com/mattn/go-sqlite3` masih ikut terbawa `gorm.io/driver/sqlite` walau tidak dipakai — menambah ukuran binary dan tetap memegang nama `"sqlite3"`. Bisa dibuang dengan mengganti GORM driver ke `glebarez/sqlite` (pure Go). Tidak mendesak selama nama `"sqlite3"` tidak dipakai siapa pun.
- Tidak ada CI. Dua build check di atas masih manual.
