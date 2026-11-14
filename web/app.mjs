import { LIMITS, blankDocument, parseRupiah, calculate, saveExpense, recordPayment, removeMember, demoDocument } from './model.mjs';
import { LedgerStore, STORAGE_KEY, MAX_BACKUP_BYTES, parseBackup, serializeBackup } from './storage.mjs';

const $ = id => document.getElementById(id);
const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
const shortDate = value => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const newId = prefix => `${prefix}-${crypto.randomUUID()}`;
let state = blankDocument(), store = null, editingExpenseId = null, pendingPayment = null, pendingConfirmation = null, toastTimer;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, className, onClick, label) {
  const element = node('button', className, text);
  element.type = 'button';
  if (label) element.setAttribute('aria-label', label);
  element.addEventListener('click', onClick);
  return element;
}
function avatar(member, index) { return node('span', `avatar tone-${index % 4}`, [...member.name][0].toLocaleUpperCase('id-ID')); }
function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8000 : 4500);
}
function clearError(id) { $(id).hidden = true; $(id).textContent = ''; }
function showError(id, error) { $(id).textContent = error.message || 'Terjadi kesalahan. Coba lagi.'; $(id).hidden = false; }
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
document.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', () => control.closest('dialog').close()));

function persist(candidate, message) {
  const next = store.commit(candidate);
  state = next;
  render();
  if (message) notify(message);
}

function confirmAction(title, description, action, label = 'Lanjutkan') {
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  $('confirm-action').textContent = label;
  clearError('confirm-error'); pendingConfirmation = action;
  openDialog('confirm-dialog');
}
$('confirm-action').addEventListener('click', () => {
  try { pendingConfirmation?.(); $('confirm-dialog').close(); }
  catch (error) { showError('confirm-error', error); }
});
$('confirm-dialog').addEventListener('close', () => { pendingConfirmation = null; });

function render() {
  const result = calculate(state);
  $('group-title').textContent = state.title;
  $('total-amount').textContent = rupiah(result.total);
  $('expense-count').textContent = `${state.expenses.length} pengeluaran tercatat`;
  $('member-count').textContent = `${state.members.length} orang`;
  $('outstanding-amount').textContent = rupiah(result.outstanding);
  $('settlement-count').textContent = result.transfers.length ? `${result.transfers.length} saran transfer untuk beres` : state.expenses.length ? 'Semua saldo sudah beres' : 'Tambahkan pengeluaran pertama';
  document.querySelector('.header-note').replaceChildren(node('span', 'status-dot'), document.createTextNode(store?.raw ? ' Tersimpan di browser ini' : ' Lokal · tanpa akun'));
  const selectedPayer = $('payer-filter').value;
  $('payer-filter').replaceChildren(new Option('Semua pembayar', ''));
  for (const member of state.members) $('payer-filter').add(new Option(member.name, member.id));
  if (state.members.some(member => member.id === selectedPayer)) $('payer-filter').value = selectedPayer;
  renderExpenses(result);
  renderBalances(result);
  renderTransfers(result);
  renderPayments();
  if ($('members-dialog').open) renderMembers();
}

function renderExpenses(result = calculate(state)) {
  const search = $('expense-search').value.trim().toLocaleLowerCase('id-ID');
  const payer = $('payer-filter').value;
  const members = new Map(state.members.map(member => [member.id, member]));
  const list = $('expense-list'); list.replaceChildren();
  const rows = state.expenses.map((expense, index) => ({ ...expense, index })).filter(expense => expense.label.toLocaleLowerCase('id-ID').includes(search) && (!payer || expense.payerId === payer)).sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);
  $('empty-state').hidden = state.expenses.length > 0;
  $('filter-empty').hidden = state.expenses.length === 0 || rows.length > 0;
  $('start-members').textContent = state.members.length ? 'Catat pengeluaran' : 'Tambah anggota';
  for (const expense of rows) {
    const card = node('article', 'expense-card');
    const top = node('div', 'expense-top');
    const main = node('div', 'expense-main');
    main.append(node('h3', 'expense-label', expense.label), node('p', 'expense-meta', `${shortDate(expense.date)} · Dibayar ${members.get(expense.payerId).name}`));
    const amount = node('div'); amount.append(node('div', 'expense-amount', rupiah(expense.amount)));
    const actions = node('div', 'expense-actions');
    actions.append(button('Ubah', 'link-button', () => openExpense(expense.id), `Ubah ${expense.label}`), button('Hapus', 'link-button delete-button', () => confirmAction('Hapus pengeluaran?', `“${expense.label}” akan dihapus dan saldo dihitung ulang.${state.payments.length ? ' Transfer yang sudah dicatat tetap berlaku.' : ''}`, () => { const next = structuredClone(state); next.expenses = next.expenses.filter(row => row.id !== expense.id); persist(next, 'Pengeluaran dihapus.'); }, 'Ya, hapus'), `Hapus ${expense.label}`));
    amount.append(actions); top.append(node('span', 'expense-icon', 'Rp'), main, amount);
    const allocations = node('div', 'allocations');
    for (const row of result.allocations.get(expense.id)) {
      const chip = node('span', 'allocation-chip', members.get(row.memberId).name);
      chip.append(node('b', '', rupiah(row.amount)));
      if (row.weight !== 1) chip.append(node('em', '', `×${row.weight}`));
      allocations.append(chip);
    }
    card.append(top, allocations); list.append(card);
  }
}

function renderBalances(result) {
  $('balances').replaceChildren();
  $('balance-empty').hidden = state.members.length > 0;
  result.memberBalances.forEach((member, index) => {
    const row = node('div', 'balance-row');
    const info = node('div', 'balance-info');
    info.append(node('div', 'balance-name', member.name), node('div', 'balance-state', member.balance > 0 ? 'Berhak menerima' : member.balance < 0 ? 'Masih perlu membayar' : 'Sudah seimbang'));
    const amount = node('div', `balance-amount ${member.balance > 0 ? 'positive' : member.balance < 0 ? 'negative' : ''}`, member.balance > 0 ? `+${rupiah(member.balance)}` : member.balance < 0 ? `−${rupiah(-member.balance)}` : rupiah(0));
    row.append(avatar(member, index), info, amount); $('balances').append(row);
  });
}

function renderTransfers(result) {
  $('transfers').replaceChildren(); $('transfer-count').textContent = String(result.transfers.length);
  $('transfer-empty').hidden = result.transfers.length > 0;
  $('transfer-empty').textContent = state.expenses.length ? '✓ Semua saldo sudah beres. Tidak ada transfer yang diperlukan.' : 'Saran muncul setelah pengeluaran dicatat.';
  const names = new Map(state.members.map(member => [member.id, member.name]));
  for (const transfer of result.transfers) {
    const row = node('div', 'transfer-row');
    const route = node('div', 'transfer-route');
    route.append(node('span', '', names.get(transfer.fromId)), node('span', 'transfer-arrow', '→'), node('span', '', names.get(transfer.toId)));
    const bottom = node('div', 'transfer-bottom');
    bottom.append(node('strong', '', rupiah(transfer.amount)), button('Catat transfer', 'button', () => openPayment(transfer), `Catat transfer ${names.get(transfer.fromId)} ke ${names.get(transfer.toId)}`));
    row.append(route, bottom); $('transfers').append(row);
  }
}

function renderPayments() {
  const names = new Map(state.members.map(member => [member.id, member.name]));
  $('payment-list').replaceChildren();
  $('payment-empty').hidden = state.payments.length > 0;
  $('payment-count').textContent = `${state.payments.length} transfer`;
  [...state.payments].reverse().forEach(payment => {
    const row = node('div', 'payment-row');
    const text = node('div', 'payment-copy', `${names.get(payment.fromId)} → ${names.get(payment.toId)}`);
    text.append(node('small', '', `${shortDate(payment.date)} · Dicatat sebagai sudah dibayar`));
    row.append(node('span', 'payment-check', '✓'), text, node('strong', '', rupiah(payment.amount)), button('Batalkan catatan', 'link-button', () => confirmAction('Batalkan catatan transfer?', 'Ini membatalkan pencatatan di BagiNota dan menghitung ulang saldo. Uang yang sudah ditransfer tidak dikembalikan oleh aplikasi.', () => { const next = structuredClone(state); next.payments = next.payments.filter(row => row.id !== payment.id); persist(next, 'Catatan transfer dibatalkan.'); }, 'Batalkan catatan'), `Batalkan transfer ${names.get(payment.fromId)} ke ${names.get(payment.toId)}`));
    $('payment-list').append(row);
  });
}

function renderMembers() {
  $('title-input').value = state.title;
  $('member-limit').textContent = `${state.members.length} / ${LIMITS.members}`;
  $('member-editor').replaceChildren();
  state.members.forEach((member, index) => {
    const row = node('form', 'member-edit-row');
    const input = node('input'); input.value = member.name; input.required = true; input.maxLength = 40; input.setAttribute('aria-label', `Nama anggota ${member.name}`);
    const rename = node('button', 'button', 'Ubah'); rename.type = 'submit'; rename.setAttribute('aria-label', `Ubah nama ${member.name}`);
    row.addEventListener('submit', event => {
      event.preventDefault(); clearError('members-error');
      try { const next = structuredClone(state); next.members.find(item => item.id === member.id).name = input.value; persist(next, 'Nama anggota disimpan.'); }
      catch (error) { showError('members-error', error); }
    });
    const remove = button('×', 'icon-button', () => {
      clearError('members-error');
      try { const candidate = removeMember(state, member.id); confirmAction('Hapus anggota?', `${member.name} akan dihapus dari patungan.`, () => persist(candidate, 'Anggota dihapus.'), 'Ya, hapus'); }
      catch (error) { showError('members-error', error); }
    }, `Hapus anggota ${member.name}`);
    row.append(avatar(member, index), input, rename, remove); $('member-editor').append(row);
  });
}
function openMembers() { clearError('members-error'); renderMembers(); openDialog('members-dialog'); }
['group-button', 'members-button'].forEach(id => $(id).addEventListener('click', openMembers));
$('start-members').addEventListener('click', () => state.members.length ? openExpense() : openMembers());
$('member-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('members-error');
  try { const next = structuredClone(state); next.members.push({ id: newId('m'), name: $('member-name').value }); persist(next, 'Anggota ditambahkan.'); $('member-name').value = ''; $('member-name').focus(); }
  catch (error) { showError('members-error', error); }
});
$('title-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('members-error');
  try { const next = structuredClone(state); next.title = $('title-input').value; persist(next, 'Nama patungan disimpan.'); }
  catch (error) { showError('members-error', error); }
});

function openExpense(id = null) {
  if (!state.members.length) { notify('Tambahkan minimal satu anggota terlebih dahulu.'); openMembers(); return; }
  const expense = state.expenses.find(row => row.id === id);
  editingExpenseId = expense?.id || newId('e');
  $('expense-form').reset(); clearError('expense-error');
  $('expense-title').textContent = expense ? 'Ubah pengeluaran' : 'Pengeluaran baru';
  $('expense-label').value = expense?.label || '';
  $('expense-amount').value = expense ? new Intl.NumberFormat('id-ID').format(expense.amount) : '';
  $('expense-date').value = expense?.date || today();
  $('expense-payer').replaceChildren();
  state.members.forEach(member => $('expense-payer').add(new Option(member.name, member.id)));
  $('expense-payer').value = expense?.payerId || state.members[0].id;
  $('payment-edit-warning').hidden = !(expense && state.payments.length);
  $('participants').replaceChildren();
  state.members.forEach(member => {
    const row = node('div', 'participant'); row.dataset.memberId = member.id;
    const label = node('label');
    const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = expense ? expense.shares.some(share => share.memberId === member.id) : true;
    label.append(checkbox, document.createTextNode(member.name));
    const weight = node('input', 'weight-input'); weight.type = 'number'; weight.min = '1'; weight.max = String(LIMITS.weight); weight.step = '1'; weight.value = String(expense?.shares.find(share => share.memberId === member.id)?.weight || 1); weight.setAttribute('aria-label', `Bobot ${member.name}`);
    const share = node('span', 'participant-share', '—');
    checkbox.addEventListener('change', updateSplit); weight.addEventListener('input', updateSplit);
    row.append(label, weight, share); $('participants').append(row);
  });
  updateSplit(); openDialog('expense-dialog');
}
function expenseFromForm() {
  const shares = [...$('participants').children].filter(row => row.querySelector('input[type=checkbox]').checked).map(row => ({ memberId: row.dataset.memberId, weight: Number(row.querySelector('.weight-input').value) }));
  return { id: editingExpenseId, label: $('expense-label').value || 'Pratinjau', amount: parseRupiah($('expense-amount').value), payerId: $('expense-payer').value, date: $('expense-date').value, shares };
}
function updateSplit() {
  clearError('expense-error');
  const rows = [...$('participants').children];
  for (const row of rows) { const enabled = row.querySelector('input[type=checkbox]').checked; row.querySelector('.weight-input').disabled = !enabled; row.classList.toggle('disabled', !enabled); row.querySelector('.participant-share').textContent = '—'; }
  try {
    const expense = expenseFromForm(), candidate = saveExpense(state, expense);
    const allocations = calculate(candidate).allocations.get(expense.id);
    for (const row of rows) {
      const share = allocations.find(item => item.memberId === row.dataset.memberId);
      row.querySelector('.participant-share').textContent = share ? rupiah(share.amount) : 'Tidak ikut';
    }
    $('split-check').textContent = `✓ Total bagian ${rupiah(allocations.reduce((sum, row) => sum + row.amount, 0))} · tepat tanpa selisih`;
    $('split-check').classList.remove('invalid');
  } catch (error) {
    $('split-check').textContent = $('expense-amount').value ? error.message : 'Isi nominal untuk melihat pembagian.';
    $('split-check').classList.toggle('invalid', Boolean($('expense-amount').value));
  }
}
['expense-amount', 'expense-label', 'expense-date', 'expense-payer'].forEach(id => $(id).addEventListener('input', updateSplit));
$('equal-weights').addEventListener('click', () => { $('participants').querySelectorAll('.weight-input').forEach(input => { input.value = '1'; }); updateSplit(); });
$('expense-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('expense-error');
  try { const expense = expenseFromForm(); expense.label = $('expense-label').value; persist(saveExpense(state, expense), 'Pengeluaran disimpan. Saldo diperbarui.'); $('expense-dialog').close(); }
  catch (error) { showError('expense-error', error); }
});
$('add-expense').addEventListener('click', () => openExpense());
$('expense-search').addEventListener('input', () => renderExpenses());
$('payer-filter').addEventListener('change', () => renderExpenses());

function openPayment(transfer) {
  pendingPayment = { ...transfer };
  const names = new Map(state.members.map(member => [member.id, member.name]));
  $('payment-description').textContent = `${names.get(transfer.fromId)} → ${names.get(transfer.toId)}`;
  $('payment-amount').textContent = rupiah(transfer.amount); $('payment-date').value = today(); clearError('payment-error');
  $('payment-actual').value = new Intl.NumberFormat('id-ID').format(Math.min(transfer.amount, LIMITS.amount));
  $('payment-hint').textContent = transfer.amount > LIMITS.amount ? 'Catat bertahap: maksimal Rp1 miliar per catatan transfer.' : 'Boleh sebagian. Sisa saldo tetap muncul dalam saran.';
  openDialog('payment-dialog');
}
$('payment-form').addEventListener('submit', event => {
  event.preventDefault(); clearError('payment-error');
  try { persist(recordPayment(state, { id: newId('p'), ...pendingPayment, amount: parseRupiah($('payment-actual').value), date: $('payment-date').value }), 'Transfer dicatat. Saldo diperbarui.'); $('payment-dialog').close(); }
  catch (error) { showError('payment-error', error); }
});

function loadDemo() {
  confirmAction('Coba data contoh?', 'Tiga anggota dan tiga pengeluaran sintetis akan menggantikan data aktif. Unduh backup terlebih dahulu jika ada catatan yang ingin disimpan.', () => { persist(demoDocument(), 'Contoh sintetis dimuat. Coba ubah bobot atau catat transfer.'); $('expense-search').value = ''; $('payer-filter').value = ''; render(); }, 'Muat data contoh');
}
['demo-button', 'demo-footer'].forEach(id => $(id).addEventListener('click', loadDemo));

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = node('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('export-button').addEventListener('click', () => {
  try { download(serializeBackup(state), `baginota-${today()}.json`); notify('Backup JSON disiapkan untuk diunduh.'); }
  catch (error) { notify(error.message, true); }
});
$('import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0]; if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('Ukuran backup maksimal 1 MB.');
    const candidate = parseBackup(await file.text());
    confirmAction('Ganti dengan data backup?', `“${candidate.title}”: ${candidate.members.length} anggota, ${candidate.expenses.length} pengeluaran, ${candidate.payments.length} transfer. Seluruh data aktif akan diganti. Unduh backup data aktif jika masih diperlukan.`, () => { persist(candidate, 'Backup valid berhasil dimuat.'); $('expense-search').value = ''; $('payer-filter').value = ''; render(); }, 'Ya, ganti data');
  } catch (error) { notify(`Impor ditolak: ${error.message}`, true); }
  finally { $('import-file').value = ''; }
});

function summary() {
  const result = calculate(state), names = new Map(state.members.map(member => [member.id, member.name]));
  return [`BagiNota — ${state.title}`, `Total ${rupiah(result.total)} · ${state.expenses.length} pengeluaran`, '', 'Saldo anggota:', ...result.memberBalances.map(member => `${member.name}: ${member.balance > 0 ? 'menerima ' + rupiah(member.balance) : member.balance < 0 ? 'membayar ' + rupiah(-member.balance) : 'seimbang'}`), '', 'Saran transfer:', ...(result.transfers.length ? result.transfers.map(transfer => `${names.get(transfer.fromId)} → ${names.get(transfer.toId)}: ${rupiah(transfer.amount)}`) : ['Tidak ada saldo yang perlu diselesaikan.']), '', 'Catatan BagiNota; bukan bukti transfer bank.'].join('\n');
}
$('copy-button').addEventListener('click', async () => {
  const text = summary();
  try { await navigator.clipboard.writeText(text); notify('Ringkasan disalin. Siap dibagikan ke teman patungan.'); }
  catch { $('copy-text').value = text; openDialog('copy-dialog'); $('copy-text').select(); }
});
$('help-button').addEventListener('click', () => openDialog('help-dialog'));
$('print-button').addEventListener('click', () => window.print());

const mutationButtons = ['group-button', 'members-button', 'start-members', 'demo-button', 'demo-footer', 'add-expense', 'export-button', 'import-button', 'print-button', 'copy-button'];
function loadStored() {
  try {
    if (!store) store = new LedgerStore(window.localStorage);
    const next = store.load(); state = next; closeDialogs(); render();
    $('storage-error').hidden = true; $('external-change').hidden = true;
    mutationButtons.forEach(id => { $(id).disabled = false; });
  } catch (error) {
    $('storage-error-text').textContent = `${error.message} Data tidak dihapus otomatis. Unduh salinan data sebelum memilih reset.`;
    $('storage-error').hidden = false;
    mutationButtons.forEach(id => { $(id).disabled = true; });
    document.querySelectorAll('.expense-card button, .transfer-row button, .payment-row button').forEach(control => { control.disabled = true; });
    document.querySelector('.header-note').textContent = 'Penyimpanan perlu diperiksa';
  }
}
$('retry-storage').addEventListener('click', loadStored);
$('reload-data').addEventListener('click', () => { loadStored(); if ($('storage-error').hidden) notify('Data terbaru dimuat.'); });
$('download-raw').addEventListener('click', () => {
  try { if (!store) throw new Error('Penyimpanan browser tidak tersedia.'); const raw = store.readRaw(); if (raw === null) throw new Error('Belum ada data tersimpan.'); download(raw, `baginota-pemulihan-${today()}.json`); }
  catch (error) { notify(error.message, true); }
});
$('reset-storage').addEventListener('click', () => confirmAction('Reset data lokal?', 'Seluruh catatan BagiNota di browser ini akan diganti dengan patungan kosong. Pastikan salinan data sudah diunduh jika diperlukan.', () => { if (!store) store = new LedgerStore(window.localStorage); state = store.reset(); loadStored(); notify('Data lokal direset.'); }, 'Ya, reset data'));
window.addEventListener('storage', event => { if ((event.key === STORAGE_KEY || event.key === null) && event.storageArea === window.localStorage) $('external-change').hidden = false; });

render();
loadStored();
