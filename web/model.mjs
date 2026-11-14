/** Model patungan. Seluruh perhitungan memakai bilangan bulat Rupiah. */
export const LIMITS = Object.freeze({ members: 24, expenses: 500, payments: 500, amount: 1_000_000_000, weight: 100 });

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

function requireThat(condition, message) { if (!condition) throw new InputError(message); }
function exactKeys(value, keys, label) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} harus berupa objek.`);
  const actual = Object.keys(value).sort();
  requireThat(JSON.stringify(actual) === JSON.stringify([...keys].sort()), `Struktur ${label} tidak sesuai format BagiNota v1.`);
}
function cleanText(value, max, label) {
  requireThat(typeof value === 'string', `${label} harus berupa teks.`);
  const text = value.trim().normalize('NFC');
  requireThat(text.length >= 1 && text.length <= max && !/[\u0000-\u001f\u007f]/u.test(text), `${label} harus berisi 1–${max} karakter tanpa karakter kontrol.`);
  return text;
}
function checkId(value) {
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value), 'ID data tidak valid.');
  return value;
}
function checkAmount(value) {
  requireThat(Number.isSafeInteger(value) && value >= 1 && value <= LIMITS.amount, 'Nominal harus berupa Rupiah bulat antara 1 dan 1.000.000.000.');
  return value;
}
function checkDate(value) {
  requireThat(typeof value === 'string' && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value), 'Tanggal harus berformat YYYY-MM-DD (tahun 1900–2199).');
  const parsed = new Date(`${value}T00:00:00Z`);
  requireThat(!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, 'Tanggal kalender tidak valid.');
  return value;
}
function uniqueId(id, seen) {
  checkId(id);
  requireThat(!seen.has(id), 'ID data terduplikasi.');
  seen.add(id);
  return id;
}

export function blankDocument() {
  return { schemaVersion: 1, title: 'Patungan baru', members: [], expenses: [], payments: [] };
}

/** Memvalidasi seluruh dokumen sebelum menghasilkan salinan yang dinormalisasi. */
export function validateDocument(input) {
  exactKeys(input, ['schemaVersion', 'title', 'members', 'expenses', 'payments'], 'dokumen');
  requireThat(input.schemaVersion === 1, 'Versi backup belum didukung. Gunakan format BagiNota v1.');
  const title = cleanText(input.title, 80, 'Nama patungan');
  for (const [key, max] of [['members', LIMITS.members], ['expenses', LIMITS.expenses], ['payments', LIMITS.payments]]) {
    requireThat(Array.isArray(input[key]) && input[key].length <= max, `${key} harus berupa daftar dengan maksimal ${max} entri.`);
  }
  const seen = new Set();
  const names = new Set();
  const members = input.members.map(member => {
    exactKeys(member, ['id', 'name'], 'anggota');
    const id = uniqueId(member.id, seen);
    const name = cleanText(member.name, 40, 'Nama anggota');
    const key = name.normalize('NFKC').toLocaleLowerCase('id-ID');
    requireThat(!names.has(key), 'Nama anggota harus berbeda.');
    names.add(key);
    return { id, name };
  });
  const order = new Map(members.map((member, index) => [member.id, index]));
  const hasMember = id => requireThat(order.has(id), 'Data merujuk anggota yang tidak ada.');
  const expenses = input.expenses.map(expense => {
    exactKeys(expense, ['id', 'label', 'amount', 'payerId', 'date', 'shares'], 'pengeluaran');
    const id = uniqueId(expense.id, seen);
    hasMember(expense.payerId);
    requireThat(Array.isArray(expense.shares) && expense.shares.length >= 1 && expense.shares.length <= members.length, 'Pilih minimal satu peserta pengeluaran.');
    const participants = new Set();
    const shares = expense.shares.map(share => {
      exactKeys(share, ['memberId', 'weight'], 'bagian peserta');
      hasMember(share.memberId);
      requireThat(!participants.has(share.memberId), 'Peserta pengeluaran terduplikasi.');
      participants.add(share.memberId);
      requireThat(Number.isSafeInteger(share.weight) && share.weight >= 1 && share.weight <= LIMITS.weight, 'Bobot harus bilangan bulat antara 1 dan 100.');
      return { memberId: share.memberId, weight: share.weight };
    }).sort((a, b) => order.get(a.memberId) - order.get(b.memberId));
    return { id, label: cleanText(expense.label, 100, 'Nama pengeluaran'), amount: checkAmount(expense.amount), payerId: expense.payerId, date: checkDate(expense.date), shares };
  });
  const payments = input.payments.map(payment => {
    exactKeys(payment, ['id', 'fromId', 'toId', 'amount', 'date'], 'transfer');
    const id = uniqueId(payment.id, seen);
    hasMember(payment.fromId); hasMember(payment.toId);
    requireThat(payment.fromId !== payment.toId, 'Pengirim dan penerima transfer harus berbeda.');
    return { id, fromId: payment.fromId, toId: payment.toId, amount: checkAmount(payment.amount), date: checkDate(payment.date) };
  });
  return { schemaVersion: 1, title, members, expenses, payments };
}

export function parseRupiah(value) {
  const text = String(value).trim();
  requireThat(/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(text), 'Isi nominal dengan angka bulat, misalnya 45000 atau 45.000.');
  return checkAmount(Number(text.replaceAll('.', '')));
}

/** Largest remainder: sisa Rupiah ke pecahan terbesar; seri ke urutan anggota. */
export function allocateExpense(expense, members) {
  const order = new Map(members.map((member, index) => [member.id, index]));
  const weightTotal = expense.shares.reduce((total, share) => total + share.weight, 0);
  const rows = expense.shares.map(share => {
    const product = expense.amount * share.weight;
    return { memberId: share.memberId, weight: share.weight, amount: Math.floor(product / weightTotal), remainder: product % weightTotal };
  });
  const remaining = expense.amount - rows.reduce((sum, row) => sum + row.amount, 0);
  const ranked = [...rows].sort((a, b) => b.remainder - a.remainder || order.get(a.memberId) - order.get(b.memberId));
  for (let index = 0; index < remaining; index++) ranked[index].amount++;
  return rows.sort((a, b) => order.get(a.memberId) - order.get(b.memberId)).map(({ memberId, weight, amount }) => ({ memberId, weight, amount }));
}

/** Saldo positif = berhak menerima; saldo negatif = masih perlu membayar. */
export function calculate(document) {
  const doc = validateDocument(document);
  const balances = new Map(doc.members.map(member => [member.id, 0]));
  const allocations = new Map();
  let total = 0;
  for (const expense of doc.expenses) {
    total += expense.amount;
    balances.set(expense.payerId, balances.get(expense.payerId) + expense.amount);
    const rows = allocateExpense(expense, doc.members);
    allocations.set(expense.id, rows);
    for (const row of rows) balances.set(row.memberId, balances.get(row.memberId) - row.amount);
  }
  for (const payment of doc.payments) {
    balances.set(payment.fromId, balances.get(payment.fromId) + payment.amount);
    balances.set(payment.toId, balances.get(payment.toId) - payment.amount);
  }
  const memberBalances = doc.members.map(member => ({ ...member, balance: balances.get(member.id) }));
  const debtors = memberBalances.filter(row => row.balance < 0).map(row => ({ id: row.id, remaining: -row.balance }));
  const creditors = memberBalances.filter(row => row.balance > 0).map(row => ({ id: row.id, remaining: row.balance }));
  const transfers = [];
  let debtorIndex = 0, creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex], creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    transfers.push({ fromId: debtor.id, toId: creditor.id, amount });
    debtor.remaining -= amount; creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex++;
    if (creditor.remaining === 0) creditorIndex++;
  }
  return { total, memberBalances, allocations, transfers, outstanding: memberBalances.filter(row => row.balance > 0).reduce((sum, row) => sum + row.balance, 0) };
}

export function saveExpense(document, expense) {
  const doc = validateDocument(document);
  const index = doc.expenses.findIndex(row => row.id === expense.id);
  if (index === -1) doc.expenses.push(expense); else doc.expenses[index] = expense;
  return validateDocument(doc);
}

export function recordPayment(document, payment) {
  const doc = validateDocument(document);
  const { memberBalances } = calculate(doc);
  const from = memberBalances.find(row => row.id === payment.fromId);
  const to = memberBalances.find(row => row.id === payment.toId);
  checkAmount(payment.amount);
  requireThat(from && to && from.balance < 0 && to.balance > 0 && payment.amount <= Math.min(-from.balance, to.balance), 'Transfer melebihi saldo yang perlu diselesaikan. Periksa saran terbaru.');
  doc.payments.push(payment);
  return validateDocument(doc);
}

export function removeMember(document, id) {
  const doc = validateDocument(document);
  requireThat(!doc.expenses.some(row => row.payerId === id || row.shares.some(share => share.memberId === id)) && !doc.payments.some(row => row.fromId === id || row.toId === id), 'Anggota masih dipakai dalam pengeluaran atau transfer. Hapus catatan terkait terlebih dahulu.');
  doc.members = doc.members.filter(member => member.id !== id);
  return validateDocument(doc);
}

export function demoDocument() {
  return validateDocument({
    schemaVersion: 1, title: 'Akhir pekan bersama',
    members: [{ id: 'demo-ayu', name: 'Ayu' }, { id: 'demo-bima', name: 'Bima' }, { id: 'demo-citra', name: 'Citra' }],
    expenses: [
      { id: 'demo-makan', label: 'Makan bersama', amount: 100001, payerId: 'demo-ayu', date: '2026-11-13', shares: [{ memberId: 'demo-ayu', weight: 1 }, { memberId: 'demo-bima', weight: 1 }, { memberId: 'demo-citra', weight: 1 }] },
      { id: 'demo-taksi', label: 'Transportasi pulang', amount: 45000, payerId: 'demo-bima', date: '2026-11-13', shares: [{ memberId: 'demo-ayu', weight: 1 }, { memberId: 'demo-bima', weight: 1 }, { memberId: 'demo-citra', weight: 1 }] },
      { id: 'demo-belanja', label: 'Belanja dapur · porsi 1 : 2', amount: 40000, payerId: 'demo-citra', date: '2026-11-13', shares: [{ memberId: 'demo-ayu', weight: 1 }, { memberId: 'demo-citra', weight: 2 }] }
    ], payments: []
  });
}
