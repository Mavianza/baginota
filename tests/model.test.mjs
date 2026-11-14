import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument, validateDocument, parseRupiah, calculate, saveExpense, recordPayment, removeMember, demoDocument } from '../web/model.mjs';

function simple(amount = 100001, weights = [1, 1, 1]) {
  const doc = blankDocument();
  doc.members = ['Ayu', 'Bima', 'Citra'].map((name, index) => ({ id: `m${index}`, name }));
  doc.expenses = [{ id: 'e1', label: 'Makan', amount, payerId: 'm0', date: '2026-11-13', shares: weights.map((weight, index) => ({ memberId: `m${index}`, weight })) }];
  return doc;
}

test('skenario contoh: pembagian, saldo, dua pelunasan, lalu seluruh saldo nol', () => {
  let doc = demoDocument();
  const result = calculate(doc);
  assert.equal(result.total, 185001);
  assert.deepEqual(result.memberBalances.map(row => row.balance), [38334, -3334, -35000]);
  assert.deepEqual(result.allocations.get('demo-makan').map(row => row.amount), [33334, 33334, 33333]);
  result.transfers.forEach((transfer, index) => { doc = recordPayment(doc, { ...transfer, id: `p${index}`, date: '2026-11-13' }); });
  assert.deepEqual(calculate(doc).memberBalances.map(row => row.balance), [0, 0, 0]);
  assert.deepEqual(calculate(doc).transfers, []);
});

test('Rp1 untuk tiga peserta tidak membuat selisih atau nominal negatif', () => {
  const result = calculate(simple(1));
  assert.deepEqual(result.allocations.get('e1').map(row => row.amount), [1, 0, 0]);
  assert.equal(result.outstanding, 0);
});

test('sisa diberikan menurut pecahan terbesar, seri mengikuti urutan anggota', () => {
  assert.deepEqual(calculate(simple(7, [1, 2, 3])).allocations.get('e1').map(row => row.amount), [1, 2, 4]);
  const doc = simple(); doc.expenses[0].shares.reverse();
  assert.deepEqual(calculate(doc).allocations.get('e1').map(row => row.amount), [33334, 33334, 33333]);
});

test('invarian 600 skenario deterministik: konservasi Rupiah dan semua saran melunasi saldo', () => {
  let seed = 20261113;
  const next = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let trial = 0; trial < 600; trial++) {
    const count = 2 + next(23), doc = blankDocument();
    doc.members = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, name: `Anggota ${i}` }));
    doc.expenses = Array.from({ length: 1 + next(12) }, (_, i) => ({ id: `e${i}`, label: 'Pengeluaran sintetis', amount: 1 + next(1_000_000_000), payerId: `m${next(count)}`, date: '2026-11-13', shares: doc.members.filter(() => next(3) > 0).map(member => ({ memberId: member.id, weight: 1 + next(100) })) }));
    for (const expense of doc.expenses) if (!expense.shares.length) expense.shares.push({ memberId: doc.members[0].id, weight: 1 });
    const result = calculate(doc);
    for (const expense of doc.expenses) {
      const amounts = result.allocations.get(expense.id).map(row => row.amount);
      assert.equal(amounts.reduce((a, b) => a + b, 0), expense.amount);
      assert.ok(amounts.every(value => Number.isSafeInteger(value) && value >= 0));
    }
    assert.equal(result.memberBalances.reduce((sum, row) => sum + row.balance, 0), 0);
    const balance = new Map(result.memberBalances.map(row => [row.id, row.balance]));
    for (const transfer of result.transfers) {
      assert.ok(transfer.amount > 0);
      balance.set(transfer.fromId, balance.get(transfer.fromId) + transfer.amount);
      balance.set(transfer.toId, balance.get(transfer.toId) - transfer.amount);
    }
    assert.ok([...balance.values()].every(value => value === 0));
    assert.ok(result.transfers.length <= count - 1);
    const reversed = structuredClone(doc); reversed.expenses.forEach(expense => expense.shares.reverse());
    assert.deepEqual(calculate(reversed), result);
  }
});

test('pembayar boleh membayar untuk orang lain tanpa ikut pembagian', () => {
  const doc = simple(60000); doc.expenses[0].shares = [{ memberId: 'm1', weight: 1 }];
  assert.deepEqual(calculate(doc).memberBalances.map(row => row.balance), [60000, -60000, 0]);
});

test('nominal berformat Indonesia valid; pecahan, eksponen dan nilai di luar batas ditolak', () => {
  assert.equal(parseRupiah(' 100.001 '), 100001);
  assert.equal(parseRupiah('1000000000'), 1_000_000_000);
  for (const value of ['0', '-1', '1.00', '1,5', '1e3', 'Infinity', '12.345.67', '1 000', '1000000001', '']) assert.throws(() => parseRupiah(value));
});

test('validasi menolak nominal/bobot pecahan, peserta kosong dan referensi hilang', () => {
  for (const mutate of [
    doc => { doc.expenses[0].amount = 1.5; }, doc => { doc.expenses[0].amount = -1; },
    doc => { doc.expenses[0].shares[0].weight = 0; }, doc => { doc.expenses[0].shares[0].weight = 101; },
    doc => { doc.expenses[0].shares[0].weight = 0.5; }, doc => { doc.expenses[0].shares = []; },
    doc => { doc.expenses[0].payerId = 'missing'; }, doc => { doc.expenses[0].shares[0].memberId = 'missing'; },
    doc => { doc.expenses[0].shares.push(doc.expenses[0].shares[0]); },
  ]) { const doc = simple(); mutate(doc); assert.throws(() => validateDocument(doc)); }
});

test('struktur, ID, nama dan tanggal kalender diperiksa tanpa mengubah masukan', () => {
  for (const mutate of [
    doc => { doc.schemaVersion = 2; }, doc => { doc.extra = true; },
    doc => { doc.members[1].name = 'ayu'; }, doc => { doc.members[1].id = 'm0'; },
    doc => { doc.expenses[0].id = 'm0'; }, doc => { doc.members[0].name = '\n'; },
    doc => { doc.expenses[0].date = '2026-02-30'; }, doc => { doc.expenses[0].date = '2026-13-01'; },
  ]) { const doc = simple(); mutate(doc); const before = structuredClone(doc); assert.throws(() => validateDocument(doc)); assert.deepEqual(doc, before); }
  const leap = simple(); leap.expenses[0].date = '2024-02-29'; assert.equal(validateDocument(leap).expenses[0].date, '2024-02-29');
});

test('ubah pengeluaran mengganti catatan, menghitung ulang saldo dan menjaga transfer historis', () => {
  let doc = simple(90000);
  doc = recordPayment(doc, { id: 'p1', fromId: 'm1', toId: 'm0', amount: 30000, date: '2026-11-13' });
  const next = saveExpense(doc, { ...doc.expenses[0], amount: 60000 });
  assert.equal(next.expenses.length, 1); assert.equal(next.payments.length, 1);
  assert.deepEqual(calculate(next).memberBalances.map(row => row.balance), [10000, 10000, -20000]);
  assert.equal(doc.expenses[0].amount, 90000);
});

test('transfer sebagian diperbolehkan model; overpayment, pengirim salah dan pencatatan ulang ditolak', () => {
  const doc = simple(90000), payment = { id: 'p1', fromId: 'm1', toId: 'm0', amount: 10000, date: '2026-11-13' };
  const next = recordPayment(doc, payment);
  assert.deepEqual(calculate(next).memberBalances.map(row => row.balance), [50000, -20000, -30000]);
  assert.throws(() => recordPayment(next, payment), /ID data terduplikasi/);
  assert.throws(() => recordPayment(next, { ...payment, id: 'p2', amount: 20001 }), /melebihi/);
  assert.throws(() => recordPayment(next, { ...payment, id: 'p2', fromId: 'm0', toId: 'm1' }), /melebihi/);
});

test('anggota yang direferensikan tidak dapat dihapus; anggota bebas boleh dihapus', () => {
  const doc = simple(); assert.throws(() => removeMember(doc, 'm0'), /masih dipakai/);
  doc.members.push({ id: 'm3', name: 'Danu' });
  assert.equal(removeMember(doc, 'm3').members.length, 3);
  assert.equal(doc.members.length, 4);
});

test('saldo gabungan di atas Rp1 miliar dapat diselesaikan dengan transfer sebagian', () => {
  let doc = simple(1_000_000_000);
  doc.expenses[0].shares = [{ memberId: 'm1', weight: 1 }];
  doc.expenses.push({ ...structuredClone(doc.expenses[0]), id: 'e2' });
  assert.equal(calculate(doc).transfers[0].amount, 2_000_000_000);
  for (let i = 0; i < 2; i++) doc = recordPayment(doc, { id: `p${i}`, fromId: 'm1', toId: 'm0', amount: 1_000_000_000, date: '2026-11-13' });
  assert.equal(calculate(doc).outstanding, 0);
  assert.deepEqual(calculate(doc).memberBalances.map(row => row.balance), [0, 0, 0]);
});
