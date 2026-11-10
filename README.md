# e-Cuti SMIAAG

Sistem permohonan cuti tahunan guru SMI Al-Amin Gombak.

- Frontend: `public/index.html` (Tailwind CDN, vanilla JS), dihoskan di Netlify — https://ecutismiaag.netlify.app/
- Backend: `apps-script/Code.gs` (Google Apps Script + Google Sheets + Google Drive)

## Struktur

```
public/index.html      → halaman web (yang Netlify publish)
apps-script/Code.gs    → salinan kod Apps Script (TIDAK auto-deploy)
netlify.toml           → tetapan Netlify (folder publish + header keselamatan)
```

## Cara kemaskini (dengan preview dulu)

1. Buat perubahan di branch baharu, bukan terus di `main`.
2. Buka Pull Request ke `main`. Netlify akan jana **Deploy Preview** (link dalam PR, bahagian checks / komen netlify bot).
3. Test di link preview. Kalau OK, klik **Merge** — Netlify deploy ke production secara automatik.

> Deploy Preview menggunakan backend Apps Script yang SAMA dengan production (GAS_URL sama). Jadi permohonan yang dihantar semasa test akan masuk ke Sheet sebenar. Padam baris ujian selepas test, atau test guna akaun ujian.

## Bila ubah Code.gs

Netlify tidak deploy Apps Script. Selepas merge:

1. Buka Apps Script projek e-Cuti, tampal kandungan `apps-script/Code.gs`.
2. **Deploy → Manage deployments → Edit (ikon pensel) → Version: New version → Deploy.**
   Jangan buat "New deployment" — URL akan berubah dan `GAS_URL` dalam index.html perlu ditukar.

Kalau Code.gs dan index.html sama-sama berubah, deploy Apps Script DULU, baru merge PR.

## Tab Google Sheets

`Users`, `Sessions`, `PermohonanCuti`, `Log`, `DATA_GURU`, `TarikhTanpaHad`, `SabtuProgram`, `CutiSekolah` — semua dicipta automatik oleh `pastikanTab()` kecuali `DATA_GURU` (diisi manual: `NAMA_GURU`, `BIL_CUTI_TAHUNAN_BERBAKI` = kelayakan setahun, `EMEL` pilihan).

## Keselamatan

- Jangan "Publish to web" mana-mana tab Sheet.
- Repo ini public: jangan commit Sheet ID, password, atau data guru.
- Salt password disimpan dalam Script Properties (`APP_SECURITY_SALT`), bukan dalam kod.

## Kata laluan, baki, cuti dan penyelenggaraan (v2.6)

- **Kata laluan:** kata laluan baharu minimum 8 aksara. Pengguna baharu menerima kata laluan sementara rawak melalui
  emel; ia juga dipaparkan sekali kepada admin. Kod reset dijana daripada penjana rawak (bukan `Math.random`).
- **Baki cuti ikut emel:** tab `DATA_GURU` ada lajur pilihan `EMEL`. Jika diisi, baki dipadankan ikut emel; jika kosong,
  ikut nama akaun (huruf besar/kecil diabaikan). Jalankan `isiEmelDataGuru` sekali dari editor untuk mengisi lajur itu;
  nama yang tiada akaun sepadan disenaraikan dalam log.
- **Cuti umum / sekolah:** tab `CutiSekolah` (`Tarikh`, `Nama`). Kalendar Akademik 2027 Kumpulan B (pekeliling KPM)
  diisi automatik sekali. Hari cuti tidak dikira sebagai hari cuti dan tidak boleh dimohon. Cuti lain (Hari Pekerja,
  Hari Kebangsaan, cuti negeri, cuti peristiwa, cuti ganti) ditambah admin: Tetapan Tarikh Khas > Cuti Umum / Sekolah.
  Untuk tahun baharu, tambah senarai baharu dalam `Code.gs` (contoh `CUTI_KPM_2027_B`) atau masukkan melalui admin.
- **Kelajuan:** sesi sah dicache 5 minit dan dibatalkan serta-merta bila sesi dipadam.
- **Penyelenggaraan mingguan:** jalankan `pasangPencetus` SEKALI dari editor. Setiap Ahad 3 pagi `selenggaraMingguan`:
  membuang lampiran 2 tahun selepas tarikh cuti (rekod permohonan kekal), membuang log melebihi 2 tahun, dan membuat
  sandaran ke Spreadsheet "SANDARAN e-Cuti SMIAAG <tarikh>" (4 salinan terakhir, tanpa tab `Sessions`).
  Fail sandaran mengandungi data pengguna: jangan kongsi.

## Log masuk sekali dari Profil Guru (SSO)

Guru yang sudah log masuk ke Sistem Profil Guru (`WMT-Labs/smiaag-teacher-profile`) menekan menu **e-Cuti**, dan e-Cuti
dibuka dalam tab baru tanpa log masuk semula. Log masuk biasa (emel + kata laluan) kekal untuk semua, termasuk STAF.

- Profil Guru menghantar tiket dalam alamat `https://.../#sso=<tiket>`. Tiket ditandatangani HMAC-SHA256, sah 60 saat,
  sekali guna, dan dibuang dari bar alamat serta-merta.
- `SSO_LOGIN` (Code.gs) mengesahkan tiket, mencari pengguna **AKTIF mengikut emel** dalam tab `Users`, dan mencipta sesi.
  **Peranan (ADMIN/GURU/STAF) ikut tab `Users` e-Cuti**, bukan Profil Guru.
- Script Properties projek e-Cuti mesti ada `ECUTI_SSO_SECRET` dengan nilai yang SAMA seperti projek Profil Guru.
  Tanpa nilai ini, SSO ditolak dan hanya log masuk biasa berfungsi.
- Emel guru mesti sama dalam kedua-dua sistem (huruf besar/kecil tidak penting).
- Log aktiviti: tindakan `SSO_LOGIN` dengan status `SUCCESS` / `FAILED_*` dalam tab `Log`.

## Ujian

```
node --test tests/*.test.js
```

