import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, demoDocument, calculate, recordPayment, saveExpense } from '../web/model.mjs';
import { LedgerStore, STORAGE_KEY, MAX_BACKUP_BYTES, parseBackup, serializeBackup } from '../web/storage.mjs';

class MemoryStorage {
  constructor() { this.values = new Map(); this.failWrite = false; this.failRead = false; this.writes = 0; }
  getItem(key) { if (this.failRead) throw new Error('read denied'); return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.failWrite) throw new Error('quota exceeded'); this.values.set(key, value); this.writes++; }
}

test('integrasi: simpan patungan, buka ulang, lunasi, backup, impor ke penyimpanan baru', () => {
  const storage = new MemoryStorage(), first = new LedgerStore(storage);
  assert.deepEqual(first.load(), blankDocument()); assert.equal(storage.writes, 0);
  first.commit(demoDocument());
  const reopened = new LedgerStore(storage); let doc = reopened.load();
  assert.equal(calculate(doc).total, 185001);
  for (const [index, transfer] of calculate(doc).transfers.entries()) {
    doc = reopened.commit(recordPayment(doc, { ...transfer, id: `settlement-${index}`, date: '2026-11-13' }));
  }
  assert.equal(calculate(doc).outstanding, 0);
  const otherStorage = new MemoryStorage(), imported = new LedgerStore(otherStorage); imported.load();
  imported.import(serializeBackup(doc));
  assert.deepEqual(new LedgerStore(otherStorage).load(), doc);
  assert.equal(doc.payments.length, 2);
});

test('kegagalan tulis mempertahankan dokumen aktif dan byte sebelumnya, lalu bisa dicoba ulang', () => {
  const storage = new MemoryStorage(), store = new LedgerStore(storage); store.load(); store.commit(demoDocument());
  const before = structuredClone(store.document), raw = storage.getItem(STORAGE_KEY);
  const next = saveExpense(before, { ...before.expenses[0], amount: 99999 });
  storage.failWrite = true;
  assert.throws(() => store.commit(next), /Data aktif tidak berubah/);
  assert.deepEqual(store.document, before); assert.equal(storage.getItem(STORAGE_KEY), raw);
  storage.failWrite = false; store.commit(next);
  assert.equal(new LedgerStore(storage).load().expenses[0].amount, 99999);
});

test('impor JSON rusak, skema keliru, referensi hilang dan versi asing tidak menulis apa pun', () => {
  const storage = new MemoryStorage(), store = new LedgerStore(storage); store.load(); store.commit(demoDocument());
  const raw = storage.getItem(STORAGE_KEY), writes = storage.writes;
  const missing = demoDocument(); missing.expenses[0].payerId = 'tidak-ada';
  for (const text of ['{', 'null', '{}', JSON.stringify({ ...demoDocument(), schemaVersion: 99 }), JSON.stringify(missing)]) {
    assert.throws(() => store.import(text));
    assert.equal(storage.getItem(STORAGE_KEY), raw); assert.deepEqual(store.document, demoDocument()); assert.equal(storage.writes, writes);
  }
});

test('tab dengan baseline lama menolak overwrite; muat ulang membuka keadaan terbaru', () => {
  const storage = new MemoryStorage(), first = new LedgerStore(storage), stale = new LedgerStore(storage);
  first.load(); stale.load(); first.commit(demoDocument());
  assert.throws(() => stale.commit({ ...blankDocument(), title: 'Tab lama' }), /tab lain/);
  assert.equal(new LedgerStore(storage).load().title, 'Akhir pekan bersama');
  const current = stale.load(); current.title = 'Nama baru'; stale.commit(current);
  assert.equal(new LedgerStore(storage).load().title, 'Nama baru');
});

test('data lokal rusak tidak dihapus saat load gagal; reset eksplisit memperbaikinya', () => {
  const storage = new MemoryStorage(); storage.values.set(STORAGE_KEY, '{rusak');
  const store = new LedgerStore(storage);
  assert.throws(() => store.load(), /JSON/); assert.equal(store.readRaw(), '{rusak'); assert.equal(storage.writes, 0);
  assert.throws(() => store.commit(blankDocument()), /belum berhasil dimuat/);
  store.reset(); assert.deepEqual(new LedgerStore(storage).load(), blankDocument());
});

test('kegagalan baca, reset gagal dan backup terlalu besar tidak menghapus data', () => {
  const storage = new MemoryStorage(), store = new LedgerStore(storage); store.load(); store.commit(demoDocument());
  const before = storage.getItem(STORAGE_KEY);
  storage.failRead = true; assert.throws(() => store.load(), /dibaca/); storage.failRead = false;
  storage.failWrite = true; assert.throws(() => store.reset(), /tidak dihapus/); storage.failWrite = false;
  assert.throws(() => store.import(' '.repeat(MAX_BACKUP_BYTES + 1)), /maksimal/);
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test('kapasitas dihitung sebagai byte UTF-8, bukan banyaknya karakter', () => {
  assert.throws(() => parseBackup('🎒'.repeat(300000)), /maksimal/);
});

test('commit yang melampaui kapasitas backup ditolak agar tidak menghasilkan data yang gagal dibuka ulang', () => {
  const storage = new MemoryStorage(), store = new LedgerStore(storage); store.load(); store.commit(demoDocument());
  const raw = storage.getItem(STORAGE_KEY), large = blankDocument();
  large.members = Array.from({ length: 24 }, (_, i) => ({ id: `member-${i}-` + 'x'.repeat(50), name: `Orang ${i}` }));
  large.expenses = Array.from({ length: 500 }, (_, i) => ({ id: `e-${i}`, label: 'Catatan kapasitas', amount: 100, payerId: large.members[0].id, date: '2026-11-13', shares: large.members.map(member => ({ memberId: member.id, weight: 1 })) }));
  assert.throws(() => store.commit(large), /kapasitas/);
  assert.equal(storage.getItem(STORAGE_KEY), raw); assert.deepEqual(new LedgerStore(storage).load(), demoDocument());
});

test('salinan yang dikembalikan load/commit tidak bisa mengubah dokumen tersimpan dari luar', () => {
  const storage = new MemoryStorage(), store = new LedgerStore(storage); store.load();
  const returned = store.commit(demoDocument()); returned.title = 'Tidak disimpan';
  assert.equal(store.document.title, 'Akhir pekan bersama');
  assert.equal(new LedgerStore(storage).load().title, 'Akhir pekan bersama');
});
