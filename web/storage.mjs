import { blankDocument, validateDocument, InputError } from './model.mjs';

export const STORAGE_KEY = 'baginota.document.v1';
export const MAX_BACKUP_BYTES = 1_000_000;

export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new InputError('Ukuran backup maksimal 1 MB.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new InputError('Berkas bukan JSON yang valid.'); }
  return validateDocument(parsed);
}

export function serializeBackup(document) {
  const text = JSON.stringify(validateDocument(document), null, 2) + '\n';
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new InputError('Data melampaui kapasitas backup 1 MB. Pisahkan menjadi patungan baru setelah mengunduh backup lama.');
  return text;
}

/** Publikasikan keadaan baru hanya setelah setItem berhasil. */
export class LedgerStore {
  constructor(storage, key = STORAGE_KEY) {
    this.storage = storage; this.key = key;
    this.document = null; this.raw = undefined;
  }
  readRaw() {
    try { return this.storage.getItem(this.key); }
    catch { throw new InputError('Penyimpanan browser tidak dapat dibaca. Periksa izin penyimpanan lalu coba lagi.'); }
  }
  load() {
    const raw = this.readRaw();
    const document = raw === null ? blankDocument() : parseBackup(raw);
    this.document = document; this.raw = raw;
    return structuredClone(document);
  }
  commit(candidate) {
    if (this.document === null) throw new InputError('Data belum berhasil dimuat.');
    const document = validateDocument(candidate);
    const raw = serializeBackup(document);
    if (this.readRaw() !== this.raw) throw new InputError('Data berubah di tab lain. Muat ulang data sebelum menyimpan; isian belum disimpan.');
    try { this.storage.setItem(this.key, raw); }
    catch { throw new InputError('Gagal menyimpan ke browser. Data aktif tidak berubah. Unduh backup dan periksa ruang penyimpanan.'); }
    this.document = document; this.raw = raw;
    return structuredClone(document);
  }
  import(text) { return this.commit(parseBackup(text)); }
  reset() {
    // Hanya dipanggil setelah pengguna mengonfirmasi penggantian data lokal.
    const document = blankDocument(), raw = serializeBackup(document);
    try { this.storage.setItem(this.key, raw); }
    catch { throw new InputError('Gagal mereset penyimpanan. Data sebelumnya tidak dihapus.'); }
    this.document = document; this.raw = raw;
    return structuredClone(document);
  }
}
