# Hasil pengujian BagiNota 1.0

Implementasi dimulai untuk proyek 13 November 2026 dan diselesaikan pada
14 November 2026 setelah sesi pengujian browser tersendat.

## Pemeriksaan otomatis

Lingkungan: Node.js 24.22.1 dan Python 3.12.14, Linux.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run check` | Pemeriksaan sintaks tiga modul JavaScript lulus |
| `npm test` | 21 tes lulus, tanpa skip; satu tes mencakup 600 skenario sintetis |
| `python -m unittest discover -s tests -p "test_*.py" -v` | 6 tes lulus, tanpa skip |

Total: **27 tes lulus**. Pengujian menggunakan HTTP nyata pada port sementara
untuk memastikan aset tersedia, tipe MIME benar, HEAD bekerja, POST tidak
tersedia, dan path di luar daftar aset ditolak.

Jaminan konservasi Rupiah diperiksa melalui alokasi tepat, jumlah saldo nol,
hasil konsisten saat urutan peserta diubah, dan penerapan seluruh saran transfer.
Alur integrasi persistensi dijalankan memakai implementasi penyimpanan uji
yang dapat mensimulasikan penolakan baca/tulis. Ini tidak mengklaim pengujian
kuota penyimpanan pada semua browser.

## Interaksi browser yang benar-benar diamati

- Memuat tiga pengeluaran sintetis: total Rp185.001, saldo Ayu +Rp38.334,
  Bima −Rp3.334, Citra −Rp35.000.
- Mencoba nominal `1.00`: ditolak pada form, catatan tidak disimpan.
- Mengubah makan menjadi Rp100.002 dengan bobot 1 : 1 : 2:
  pratinjau Rp25.001, Rp25.000, Rp50.001; total baru Rp185.002.
- Membuka ulang halaman dan melihat perubahan tetap tersimpan.
- Mencoba transfer Rp46.669 pada saldo Rp46.668: ditolak.
- Mencatat pembayaran sebagian Rp10.000 lalu dua pembayaran sisa:
  semua saldo menjadi nol dan riwayat memuat tiga transfer.
- Membatalkan catatan transfer Rp5.000: saldo Bima +Rp5.000 dan
  Citra −Rp5.000 muncul kembali.
- Mengunduh backup dari tombol aplikasi; JSON hasil unduhan terbaca dan
  berisi tiga pengeluaran serta dua catatan transfer.
- Membuka kembali versi final dan mengambil `docs/tampilan.jpg` dari
  browser desktop dengan data contoh sintetis.

## Batas verifikasi

Pengisian berkas ke pemilih impor pada lingkungan browser pengujian macet.
Uji tersebut dihentikan; **impor melalui pemilih berkas belum dinyatakan lulus
uji browser**. Parser, validasi, penyimpanan hasil impor, dan penolakan input
rusak telah lulus tes integrasi otomatis.

Tombol cetak, clipboard, peluncur klik dua kali di Windows, tampilan seluler,
dan skenario dua tab melalui UI belum diuji langsung. Peluncur HTTP diuji di
Linux; konflik baseline dua instance penyimpanan diuji secara otomatis.
