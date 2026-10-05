# 💸 RizqTrack – Smart Daily Expense Reminder

RizqTrack adalah aplikasi web **frontend-only** untuk mencatat pemasukan dan pengeluaran harian secara cepat, praktis, dan modern. Cocok untuk memantau uang masuk dan keluar setiap hari, mengelola wishlist, serta mengingatkan tagihan rutin.

Berjalan langsung di browser tanpa backend dan tanpa database. Semua data disimpan secara lokal menggunakan **LocalStorage**, bisa dipasang sebagai aplikasi (PWA), dan bisa dibungkus menjadi APK Android.

---

## ✨ Fitur

### 💰 Keuangan harian
* 📊 Dashboard: pengeluaran hari ini, minggu ini, bulan ini, pemasukan bulan ini, dan kategori teratas
* ➕ Tambah pengeluaran (nama, kategori, nominal, tanggal, catatan) dengan kategori cepat
* 🏷️ Kategori: Makan, Bensin, Kopi, Jajan, Transportasi, Tagihan, Belanja, Rokok, Skincare, Pakaian, Lainnya
* 📚 Riwayat pengeluaran dengan pencarian, filter, dan pengurutan; edit & hapus data
* 📈 Statistik: grafik mingguan, per kategori, per hari, dan pemasukan vs pengeluaran 6 bulan

### 💵 Pemasukan & saldo
* Catat pemasukan (Saldo Awal, Gaji, Uang Saku, Freelance, Usaha, Bonus, Hadiah, Lainnya)
* Saldo **hanya bertambah lewat menu Pemasukan** dan berkurang otomatis saat ada pengeluaran
* Menu Target menampilkan ringkasan saldo, total masuk, dan total terpakai
* Peringatan saat saldo hampir habis atau minus

### 🎁 Wishlist
* Banyak wishlist sekaligus (nama, harga, prioritas, target tanggal, catatan)
* Klik wishlist untuk melihat detail lengkap, progress tabungan, dan cek apakah saldo cukup
* Aksi **Hapus**, **Edit**, dan **Tercapai**. Saat Tercapai, saldo berkurang otomatis sebesar harga dan tercatat di Riwayat (kategori Wishlist)
* Bisa membatalkan status Tercapai (saldo dikembalikan)

### 🔁 Transaksi berulang
* Jadwal mingguan / bulanan / tahunan untuk pengeluaran (Wi-Fi, langganan, kos) atau pemasukan (gaji, uang saku)
* **Ingatkan saya**: muncul kartu Jatuh Tempo di Dashboard dengan tombol Bayar / Lewati
* **Catat otomatis**: transaksi dibuat sendiri dan saldo menyesuaikan
* Jadwal bisa dijeda, diedit, dan dihapus

### 💾 Backup & Restore
* **Backup File** (JSON) dan **Restore File**
* **Backup Kode**: data dijadikan satu teks yang bisa disalin lalu disimpan di WhatsApp / Catatan, dan ditempel kembali saat **Restore Kode**. Berguna di APK/WebView yang tidak bisa mengunduh file
* Ringkasan data sebelum restore, tombol **Batalkan Restore Terakhir**, dan pengingat backup mingguan
* Backup lama tetap bisa di-restore

### 🛡️ Kenyamanan & keamanan
* 📝 **Draf otomatis**: isian form yang belum disimpan tidak hilang saat halaman di-refresh atau aplikasi ditutup
* 🔐 Kunci PIN 4 digit
* 🌙 Dark mode / ☀️ Light mode
* 📱 Responsive untuk HP dan desktop
* 📤 Export CSV dan Excel
* 📲 PWA: bisa dipasang di layar utama dan jalan offline

---

## 🛠️ Dibangun Dengan

* HTML5, CSS3, JavaScript (Vanilla JS)
* LocalStorage API
* Chart.js (grafik) dan SheetJS (export Excel)
* Service Worker + Web App Manifest (PWA)

---

## 📁 Struktur Project

```text
rizqtrack/
│── index.html        halaman utama & seluruh tampilan
│── style.css         gaya tampilan
│── script.js         seluruh logika aplikasi
│── manifest.json     konfigurasi PWA
│── sw.js             service worker (offline & cache)
│── icons/            ikon aplikasi
│── README.md
```

---

## 🚀 Memulai

### 1. Clone Repository

```bash
git clone https://github.com/username/rizqtrack.git
```

### 2. Jalankan

Buka folder project lalu jalankan `index.html`, atau gunakan **Live Server** di VS Code.

> **Catatan PWA:** fitur pasang aplikasi & mode offline hanya aktif jika dibuka lewat `https://` atau `localhost`
> (mis. GitHub Pages, Netlify, Live Server). Jika `index.html` dibuka langsung dari folder (`file://`),
> aplikasi tetap berjalan normal tetapi tidak bisa dipasang.

### 3. Memperbarui versi

Setiap kali file aplikasi diubah, naikkan angka `VERSION` di `sw.js` supaya cache di perangkat pengguna ikut diperbarui. Setelah itu buka aplikasi dua kali (sekali mengambil versi baru, sekali memakainya).

---

## 📱 Dijadikan APK Android

RizqTrack dapat dibungkus menjadi APK memakai layanan seperti WebIntoApp dengan URL website (mis. GitHub Pages).

* Nama dan ikon APK diatur di dashboard layanan pembungkusnya
* Di APK, unduh file sering tidak didukung, gunakan **Backup Kode** dan **Restore Kode**
* Jika APK punya opsi *pull to refresh* bawaan, sebaiknya dimatikan agar tidak ter-refresh tanpa sengaja saat scroll

---

## 💡 Cara Kerja

1. Catat **pemasukan** (termasuk saldo awal) agar saldo terisi.
2. Catat **pengeluaran** harian, saldo berkurang otomatis.
3. Atur **transaksi berulang** untuk tagihan atau gaji rutin.
4. Simpan barang impian di **Wishlist**, tandai Tercapai saat sudah dibeli.
5. Pantau **Statistik** dan lakukan **Backup** secara berkala.

---

## 🔒 Privasi

Semua data tersimpan **lokal di perangkat pengguna** dan tidak dikirim ke server mana pun. Karena itu, lakukan backup secara rutin: jika data aplikasi atau browser dihapus, data ikut hilang.

---

## 🧠 Rencana Pengembangan

* Multi dompet
* Notifikasi pengingat
* Kategori kustom
* Template transaksi
* Perbandingan dengan bulan lalu

---

## 🤝 Berkontribusi

Pull request dan ide pengembangan sangat terbuka.

1. Fork repository
2. Buat branch baru
3. Commit perubahan
4. Buka pull request

---

## 📄 Lisensi

Project ini dilisensikan di bawah MIT License.

---

## 👨‍💻 Author

Development by **ABD. Rohman Ubaidillah, S.Kom**

---

## ⭐ Dukungan

Jika project ini bermanfaat, beri ⭐ di GitHub repository.
