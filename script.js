/* =============================================================
   RIZQTRACK – script.js
   Smart Daily Expense Reminder
   ============================================================= */

'use strict';

/* ===================== STATE ===================== */
let expenses = [];
let savingTargets = [];
let incomes = [];
let recurring = [];
let incomeEditingId = null;
let rcEditingId = null;
let incomeChart = null;
let settings = { saldoAwal: 0, saldoSekarang: 0, pin: '', theme: 'dark' };
let currentFilter = 'semua';
let editingId = null;
let confirmCallback = null;
let weeklyChart = null;
let categoryChart = null;
let dailyChart = null;
let pinBuffer = '';
let wlTab = 'aktif';
let wlEditingId = null;
let wlDetailId = null;


/* ===================== DRAF FORM ===================== */
// Isian form yang belum disimpan otomatis disimpan sebagai draf, jadi tidak hilang
// saat halaman di-refresh (pull-to-refresh), aplikasi ditutup, atau tidak sengaja ter-reload.
const DRAFT_KEY = 'dt_drafts';
const DRAFT_MAX_AGE = 3 * 24 * 3600 * 1000; // draf lebih dari 3 hari dibuang
const DRAFT_FORMS = {
  expense:   { label: 'Pengeluaran', fields: ['inputNama', 'inputKategori', 'inputNominal', 'inputTanggal', 'inputCatatan'], core: ['inputNama', 'inputNominal', 'inputCatatan'], editing: () => false },
  income:    { label: 'Pemasukan',   fields: ['incNama', 'incKategori', 'incNominal', 'incTanggal', 'incCatatan'],           core: ['incNama', 'incNominal', 'incCatatan'],       editing: () => !!incomeEditingId },
  wishlist:  { label: 'Wishlist',    fields: ['wlNama', 'wlHarga', 'wlSaved', 'wlPrioritas', 'wlDeadline', 'wlCatatan'],     core: ['wlNama', 'wlHarga', 'wlSaved', 'wlCatatan'], editing: () => !!wlEditingId },
  recurring: { label: 'Berulang',    fields: ['rcType', 'rcKategori', 'rcNama', 'rcNominal', 'rcFreq', 'rcStart', 'rcMode'], core: ['rcNama', 'rcNominal'],                       editing: () => !!rcEditingId }
};

function readDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch (e) { return {}; }
}
function writeDrafts(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {} }

function saveDraft(name) {
  const cfg = DRAFT_FORMS[name];
  if (!cfg || cfg.editing()) return;           // sedang edit data lama → tidak dijadikan draf
  const values = {};
  cfg.fields.forEach(id => { const el = document.getElementById(id); if (el) values[id] = el.value; });
  const drafts = readDrafts();
  if (cfg.core.some(id => (values[id] || '').trim() !== '')) drafts[name] = { values, at: Date.now() };
  else delete drafts[name];                    // form kosong → tidak ada draf
  writeDrafts(drafts);
}

function clearDraft(name) {
  const drafts = readDrafts();
  if (name in drafts) { delete drafts[name]; writeDrafts(drafts); }
}

// Mengisi kembali form dari draf. Mengembalikan daftar nama form yang dipulihkan.
function restoreDrafts(drafts) {
  const restored = [];
  Object.entries(DRAFT_FORMS).forEach(([name, cfg]) => {
    const d = drafts[name];
    if (!d || !d.values) return;
    if (Date.now() - (d.at || 0) > DRAFT_MAX_AGE) { delete drafts[name]; return; }   // draf basi dibuang
    if (name === 'recurring' && d.values.rcType) {
      document.getElementById('rcType').value = d.values.rcType;
      fillRecurringCategories();               // kategori bergantung pada jenis
    }
    cfg.fields.forEach(id => {
      const el = document.getElementById(id);
      if (el && d.values[id] !== undefined) el.value = d.values[id];
    });
    if (name === 'recurring') updateRecurringHint();
    restored.push(cfg.label);
  });
  return restored;
}

function initDrafts() {
  Object.entries(DRAFT_FORMS).forEach(([name, cfg]) => {
    cfg.fields.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => saveDraft(name));
      el.addEventListener('change', () => saveDraft(name));
    });
  });
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  applyTheme();
  initClock();
  checkLock();
  setDefaultDate();
  initNavigation();
  initFilterBtns();
  initSeeAll();
  updateDarkModeToggle();
  const draftsAtStart = readDrafts();     // diambil sebelum form di-reset
  resetIncomeForm();
  resetRecurringForm();
  const restoredForms = restoreDrafts(draftsAtStart);
  writeDrafts(draftsAtStart);             // reset di atas ikut menghapus draf → tulis ulang
  initDrafts();
  initPWA();
  refreshAll();
  processRecurring();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { processRecurring(); renderDueReminders(); renderRecurring(); }
  });
  const startPage = new URLSearchParams(location.search).get('page');
  if (startPage && document.getElementById('page-' + startPage)) navigateTo(startPage);
  updateBackupInfo();
  if (restoredForms.length) setTimeout(() => showToast(`📝 Isian ${restoredForms.join(', ')} yang belum disimpan dipulihkan`, 'success'), 700);
  setTimeout(checkBackupReminder, 4500);
});

// Baca localStorage dengan aman. Kalau isinya rusak, salinan mentahnya diselamatkan ke dt_rusak_* (tidak ditimpa diam-diam).
function safeParse(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); }
  catch (e) {
    try { localStorage.setItem('dt_rusak_' + key, raw); } catch (e2) {}
    console.warn('Data rusak di', key, '— disalin ke dt_rusak_' + key);
    return fallback;
  }
}

function loadData() {
  expenses = safeParse('dt_expenses', []);
  savingTargets = safeParse('dt_targets', []).map(normalizeWishlist);
  incomes = safeParse('dt_incomes', []).map(normalizeIncome);
  recurring = safeParse('dt_recurring', []).map(normalizeRecurring);
  const s = safeParse('dt_settings', {});
  // migrate lama: budgetHarian → saldoSekarang
  const defaultSettings = { saldoAwal: 0, saldoSekarang: 0, pin: '', theme: 'dark' };
  settings = { ...defaultSettings, ...s };
  if (s.budgetHarian && !s.saldoAwal) {
    settings.saldoAwal = s.budgetHarian;
    settings.saldoSekarang = s.budgetHarian;
    delete settings.budgetHarian;
  }
}

function saveData() {
  localStorage.setItem('dt_expenses', JSON.stringify(expenses));
  localStorage.setItem('dt_targets', JSON.stringify(savingTargets));
  localStorage.setItem('dt_incomes', JSON.stringify(incomes));
  localStorage.setItem('dt_recurring', JSON.stringify(recurring));
  localStorage.setItem('dt_settings', JSON.stringify(settings));
}

/* ===================== LOCK SCREEN ===================== */
function checkLock() {
  if (settings.pin) {
    showEl('lockScreen');
    hideEl('app');
  } else {
    hideEl('lockScreen');
    showEl('app');
  }
}

function pinInput(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();
  if (pinBuffer.length === 4) setTimeout(pinSubmit, 200);
}

function pinClear() {
  pinBuffer = pinBuffer.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  const dots = document.querySelectorAll('#pinDots span');
  dots.forEach((d, i) => d.classList.toggle('filled', i < pinBuffer.length));
}

function pinSubmit() {
  if (pinBuffer === settings.pin) {
    hideEl('lockScreen');
    showEl('app');
    pinBuffer = '';
    updatePinDots();
    hideEl('pinError');
  } else {
    showEl('pinError');
    pinBuffer = '';
    updatePinDots();
    const dots = document.querySelectorAll('#pinDots span');
    dots.forEach(d => { d.style.borderColor = 'var(--danger)'; setTimeout(() => d.style.borderColor = '', 500); });
  }
}

/* ===================== NAVIGATION ===================== */
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
      closeSidebar();
    });
  });

  document.getElementById('fabBtn').addEventListener('click', () => navigateTo('tambah'));
  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard: 'Dashboard', tambah: 'Tambah Pengeluaran', riwayat: 'Riwayat', statistik: 'Statistik', target: 'Target Keuangan', wishlist: 'Wishlist', pemasukan: 'Pemasukan', berulang: 'Transaksi Berulang', pengaturan: 'Pengaturan' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  if (page === 'statistik') setTimeout(renderCharts, 100);
  if (page === 'riwayat') renderRiwayat();
  if (page === 'target') renderTargets();
  if (page === 'wishlist') renderWishlist();
  if (page === 'pemasukan') renderIncomes();
  if (page === 'berulang') renderRecurring();
  if (page === 'pengaturan') updateBackupInfo();
  if (page === 'dashboard') renderDashboard();
}

function openSidebar() { document.getElementById('sidebar').classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); }

function initSeeAll() {
  document.querySelectorAll('[data-page="riwayat"]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigateTo('riwayat'); });
  });
}

/* ===================== CLOCK ===================== */
function initClock() {
  function tick() {
    const now = new Date();
    const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('realtimeClock').textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} · ${time}`;
    document.getElementById('todayDate').textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ===================== THEME ===================== */
function applyTheme() {
  const theme = settings.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
}

function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  updateDarkModeToggle();
  saveData();
  if (weeklyChart || categoryChart || dailyChart || incomeChart) setTimeout(renderCharts, 100);
}

function updateDarkModeToggle() {
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = settings.theme === 'dark';
}

/* ===================== REFRESH ALL ===================== */
function refreshAll() {
  renderDashboard();
  renderRiwayat();
  renderTargets();
  renderWishlist();
  renderIncomes();
  renderRecurring();
  renderDueReminders();
}

/* ===================== DASHBOARD ===================== */
function renderDashboard() {
  const now = new Date();
  const todayStr = toDateStr(now);
  const monday = getMonday(now);

  const todayExp = expenses.filter(e => e.date === todayStr);
  const weekExp = expenses.filter(e => new Date(e.date) >= monday && new Date(e.date) <= now);
  const monthExp = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  setText('totalHariIni', formatRp(sumExpenses(todayExp)));
  setText('txHariIni', `${todayExp.length} transaksi`);
  setText('totalMingguIni', formatRp(sumExpenses(weekExp)));
  setText('txMingguIni', `${weekExp.length} transaksi`);
  setText('totalBulanIni', formatRp(sumExpenses(monthExp)));
  setText('txBulanIni', `${monthExp.length} transaksi`);

  const incMonth = monthIncomes(now);
  setText('totalPemasukanBulan', formatRp(sumExpenses(incMonth)));
  setText('txPemasukanBulan', `${incMonth.length} pemasukan`);

  // Top category this month
  const catMap = {};
  monthExp.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
  const topCat = Object.entries(catMap).sort((a,b) => b[1]-a[1])[0];
  if (topCat) {
    setText('topKategori', `${getCatIcon(topCat[0])} ${topCat[0]}`);
    setText('topKategoriNominal', formatRp(topCat[1]));
  } else {
    setText('topKategori', '–');
    setText('topKategoriNominal', 'belum ada data');
  }

  // Saldo bar
  const saldo = settings.saldoSekarang;
  const saldoAwal = settings.saldoAwal;
  const totalPengeluaran = sumExpenses(expenses);
  if (saldoAwal > 0) {
    const terpakai = saldoAwal - saldo;
    const pct = saldoAwal > 0 ? Math.min(Math.max((terpakai / saldoAwal) * 100, 0), 100) : 0;
    setText('budgetBarLabel', formatRp(saldo));
    setText('budgetUsed', `Terpakai: ${formatRp(terpakai)}`);
    setText('budgetLeft', saldo >= 0 ? `Sisa: ${formatRp(saldo)}` : `⚠️ Minus: ${formatRp(Math.abs(saldo))}`);
    const fill = document.getElementById('budgetProgress');
    fill.style.width = pct + '%';
    fill.classList.toggle('danger', saldo < 0 || pct >= 90);
  } else {
    setText('budgetBarLabel', 'Belum ada saldo');
    setText('budgetUsed', 'Terpakai: –');
    setText('budgetLeft', 'Catat di menu Pemasukan');
    document.getElementById('budgetProgress').style.width = '0%';
  }

  // Recent 5
  const recent = [...expenses].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  renderTxList('recentList', recent, true);

  // Saldo warning notification
  if (pendingReminders().length > 0) {
    setNotifBadge(true);
  } else if (settings.saldoAwal > 0 && settings.saldoSekarang < 0) {
    setNotifBadge(true);
  } else if (settings.saldoAwal > 0 && settings.saldoSekarang < settings.saldoAwal * 0.1) {
    setNotifBadge(true);
  } else {
    setNotifBadge(false);
  }
}

function setNotifBadge(on) {
  const btn = document.getElementById('notifBtn');
  btn.textContent = on ? '🔔' : '🔔';
  btn.style.filter = on ? 'drop-shadow(0 0 6px var(--warning))' : '';
}

/* ===================== EXPENSE CRUD ===================== */
function setDefaultDate() {
  const today = toDateStr(new Date());
  document.getElementById('inputTanggal').value = today;
}

function saveExpense() {
  const nama = document.getElementById('inputNama').value.trim();
  const kategori = document.getElementById('inputKategori').value;
  const nominal = parseFloat(document.getElementById('inputNominal').value);
  const tanggal = document.getElementById('inputTanggal').value;
  const catatan = document.getElementById('inputCatatan').value.trim();

  if (!nama || !kategori || !nominal || !tanggal) {
    showToast('⚠️ Lengkapi semua field yang wajib diisi!', 'warning');
    return;
  }
  if (nominal <= 0) { showToast('Nominal harus lebih dari 0', 'error'); return; }

  const expense = {
    id: Date.now().toString(),
    name: nama,
    category: kategori,
    amount: nominal,
    date: tanggal,
    note: catatan,
    createdAt: new Date().toISOString()
  };

  expenses.unshift(expense);
  // Kurangi saldo selalu (tidak perlu cek kondisi)
  settings.saldoSekarang = (settings.saldoSekarang || 0) - nominal;
  saveData();
  resetForm();
  showToast(`✅ Disimpan! Saldo berkurang ${formatRp(nominal)}`, 'success');
  refreshAll();
  checkBudgetWarning();
}

function checkBudgetWarning() {
  if (!settings.saldoAwal) return;
  const saldo = settings.saldoSekarang;
  if (saldo < 0) {
    showToast(`🚨 Saldo minus! ${formatRp(Math.abs(saldo))} melebihi saldo`, 'warning');
  } else if (saldo < settings.saldoAwal * 0.1) {
    showToast(`⚠️ Saldo hampir habis! Tersisa ${formatRp(saldo)}`, 'warning');
  }
}

function resetForm() {
  clearDraft('expense');
  document.getElementById('inputNama').value = '';
  document.getElementById('inputKategori').value = '';
  document.getElementById('inputNominal').value = '';
  document.getElementById('inputCatatan').value = '';
  setDefaultDate();
}

function quickCategory(cat, icon) {
  document.getElementById('inputKategori').value = cat;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  event.target.classList.add('active');
  saveDraft('expense');
  document.getElementById('inputNama').focus();
}

function deleteExpense(id) {
  openConfirm('Hapus Transaksi?', 'Data ini akan dihapus permanen dan saldo dikembalikan.', () => {
    const exp = expenses.find(e => e.id === id);
    if (exp) {
      settings.saldoSekarang = (settings.saldoSekarang || 0) + exp.amount;
      // saldoAwal juga naik kalau memang pernah ada saldo
      if (settings.saldoAwal > 0) {
        settings.saldoAwal = (settings.saldoAwal || 0) + exp.amount;
      }
    }
    expenses = expenses.filter(e => e.id !== id);
    // kalau transaksi ini berasal dari wishlist, kembalikan wishlist ke status aktif
    savingTargets.forEach(w => {
      if (w.expenseId === id) { w.status = 'aktif'; w.expenseId = null; w.achievedAt = null; }
    });
    saveData();
    refreshAll();
    showToast(exp ? `🗑️ Terhapus! Saldo +${formatRp(exp.amount)} dikembalikan` : '🗑️ Transaksi dihapus', 'success');
  });
}

function openEditModal(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  document.getElementById('editNama').value = e.name;
  document.getElementById('editKategori').value = e.category;
  document.getElementById('editNominal').value = e.amount;
  document.getElementById('editTanggal').value = e.date;
  document.getElementById('editCatatan').value = e.note || '';
  showEl('editModal');
}

function updateExpense() {
  if (!editingId) return;
  const idx = expenses.findIndex(e => e.id === editingId);
  if (idx === -1) return;
  const oldAmount = expenses[idx].amount;
  const newAmount = parseFloat(document.getElementById('editNominal').value);
  const diff = newAmount - oldAmount; // positive = lebih besar
  expenses[idx] = {
    ...expenses[idx],
    name: document.getElementById('editNama').value.trim(),
    category: document.getElementById('editKategori').value,
    amount: newAmount,
    date: document.getElementById('editTanggal').value,
    note: document.getElementById('editCatatan').value.trim()
  };
  // adjust saldo selalu, tidak perlu cek kondisi
  settings.saldoSekarang = (settings.saldoSekarang || 0) - diff;
  saveData();
  closeModal();
  refreshAll();
  showToast('✅ Transaksi diperbarui!', 'success');
}

function closeModal() {
  hideEl('editModal');
  editingId = null;
}

/* ===================== RENDER TX LIST ===================== */
function renderTxList(containerId, list, hideActions = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Belum ada pengeluaran</p></div>`;
    return;
  }
  container.innerHTML = list.map(e => `
    <div class="tx-card" id="tx-${e.id}">
      <div class="tx-icon">${getCatIcon(e.category)}</div>
      <div class="tx-info">
        <div class="tx-name">${escHtml(e.name)}</div>
        <div class="tx-meta">${getCatLabel(e.category)} · ${formatDateShort(e.date)}${e.note ? ' · ' + escHtml(e.note) : ''}</div>
      </div>
      <div class="tx-amount">-${formatRp(e.amount)}</div>
      ${!hideActions ? `
      <div class="tx-actions">
        <button class="tx-btn" onclick="openEditModal('${e.id}')" title="Edit">✏️</button>
        <button class="tx-btn del" onclick="deleteExpense('${e.id}')" title="Hapus">🗑️</button>
      </div>` : ''}
    </div>
  `).join('');
}

/* ===================== RIWAYAT ===================== */
function initFilterBtns() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyFilter();
    });
  });
}

function applyFilter() {
  const now = new Date();
  const todayStr = toDateStr(now);
  const monday = getMonday(now);
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const cat = document.getElementById('filterKategori')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'terbaru';

  let filtered = [...expenses];

  // Time filter
  if (currentFilter === 'hari') filtered = filtered.filter(e => e.date === todayStr);
  else if (currentFilter === 'minggu') filtered = filtered.filter(e => new Date(e.date) >= monday && new Date(e.date) <= now);
  else if (currentFilter === 'bulan') filtered = filtered.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  // Category filter
  if (cat) filtered = filtered.filter(e => e.category === cat);

  // Search
  if (search) filtered = filtered.filter(e =>
    e.name.toLowerCase().includes(search) ||
    e.category.toLowerCase().includes(search) ||
    (e.note || '').toLowerCase().includes(search)
  );

  // Sort
  if (sort === 'terbesar') filtered.sort((a,b) => b.amount - a.amount);
  else if (sort === 'terkecil') filtered.sort((a,b) => a.amount - b.amount);
  else filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderRiwayatList(filtered);
}

function renderRiwayat() {
  applyFilter();
}

function renderRiwayatList(list) {
  renderTxList('riwayatList', list);
  const total = sumExpenses(list);
  const summary = document.getElementById('riwayatSummary');
  if (summary) {
    summary.innerHTML = `<span>${list.length} transaksi</span><span>Total: <b>${formatRp(total)}</b></span>`;
  }
}

/* ===================== STATISTIK ===================== */
function renderCharts() {
  if (typeof Chart === 'undefined') {
    showToast('📡 Grafik butuh internet sekali untuk dimuat. Sambungkan internet lalu buka ulang.', 'warning');
    return;
  }
  const now = new Date();
  const isDark = settings.theme === 'dark';
  const textColor = isDark ? '#8b91a8' : '#5a6080';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

  // Stats cards
  if (expenses.length > 0) {
    const maxExp = expenses.reduce((a,b) => a.amount > b.amount ? a : b);
    setText('statTerbesar', formatRp(maxExp.amount));
    setText('statTerbesar2', `${maxExp.name} (${maxExp.date})`);

    const catMap = {};
    expenses.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
    const topCat = Object.entries(catMap).sort((a,b) => b[1]-a[1])[0];
    setText('statBorosKat', `${getCatIcon(topCat[0])} ${topCat[0]}`);
    setText('statBorosNom', formatRp(topCat[1]));

    // Avg per day (last 30 days)
    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const last30 = expenses.filter(e => new Date(e.date) >= thirtyAgo);
    const uniqueDays = new Set(last30.map(e => e.date)).size || 1;
    setText('statRataHari', formatRp(sumExpenses(last30) / uniqueDays));
  } else {
    ['statTerbesar','statTerbesar2','statBorosKat','statBorosNom','statRataHari'].forEach(id => setText(id, '–'));
  }
  setText('statTotalTx', expenses.length);

  // Weekly Chart (last 7 days)
  const days7 = [];
  const labels7 = [];
  const daysName = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = toDateStr(d);
    days7.push(sumExpenses(expenses.filter(e => e.date === ds)));
    labels7.push(daysName[d.getDay()]);
  }

  const weekCtx = document.getElementById('weeklyChart').getContext('2d');
  if (weeklyChart) weeklyChart.destroy();
  weeklyChart = new Chart(weekCtx, {
    type: 'bar',
    data: {
      labels: labels7,
      datasets: [{
        label: 'Pengeluaran',
        data: days7,
        backgroundColor: 'rgba(0,212,170,0.7)',
        borderColor: '#00d4aa',
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => formatRpShort(v) }, grid: { color: gridColor } }
      }
    }
  });

  // Category Pie
  const catMap2 = {};
  expenses.forEach(e => { catMap2[e.category] = (catMap2[e.category] || 0) + e.amount; });
  const catLabels = Object.keys(catMap2);
  const catData = Object.values(catMap2);
  const catColors = ['#00d4aa','#4f9ef8','#a78bfa','#fb923c','#f87171','#fbbf24','#34d399','#94a3b8','#f472b6','#22d3ee','#a3e635','#e879f9'];

  const catCtx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChart) categoryChart.destroy();
  if (catLabels.length > 0) {
    categoryChart = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: catColors.slice(0, catLabels.length),
          borderColor: isDark ? '#13161e' : '#ffffff',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: textColor, padding: 12, font: { size: 12 } } }
        }
      }
    });
  }

  // Pemasukan vs Pengeluaran (6 bulan terakhir)
  const mLabels = [], mIn = [], mOut = [];
  for (let i = 5; i >= 0; i--) {
    const md = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, '0')}`;
    mLabels.push(MONTH_NAMES[md.getMonth()]);
    mIn.push(sumExpenses(incomes.filter(x => x.date.startsWith(key))));
    mOut.push(sumExpenses(expenses.filter(x => x.date.startsWith(key))));
  }
  const incCtx = document.getElementById('incomeChart').getContext('2d');
  if (incomeChart) incomeChart.destroy();
  incomeChart = new Chart(incCtx, {
    type: 'bar',
    data: {
      labels: mLabels,
      datasets: [
        { label: 'Pemasukan', data: mIn, backgroundColor: 'rgba(0,212,170,0.75)', borderRadius: 6 },
        { label: 'Pengeluaran', data: mOut, backgroundColor: 'rgba(248,113,113,0.75)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => formatRpShort(v) }, grid: { color: gridColor } }
      }
    }
  });

  // Daily (this month)
  const mo = now.getMonth(), yr = now.getFullYear();
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const dailyLabels = [], dailyData = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    dailyLabels.push(d);
    dailyData.push(expenses.filter(e => e.date === ds).length);
  }
  const dailyCtx = document.getElementById('dailyChart').getContext('2d');
  if (dailyChart) dailyChart.destroy();
  dailyChart = new Chart(dailyCtx, {
    type: 'line',
    data: {
      labels: dailyLabels,
      datasets: [{
        label: 'Transaksi',
        data: dailyData,
        borderColor: '#4f9ef8',
        backgroundColor: 'rgba(79,158,248,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#4f9ef8'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, stepSize: 1 }, grid: { color: gridColor }, min: 0 }
      }
    }
  });
}

/* ===================== TARGET ===================== */
/* ===================== WISHLIST ===================== */
const PRIORITY_META = {
  tinggi: { icon: '🔴', label: 'Tinggi', order: 0 },
  sedang: { icon: '🟡', label: 'Sedang', order: 1 },
  rendah: { icon: '🟢', label: 'Rendah', order: 2 }
};

// Data lama (dt_targets versi 1.0) tidak punya status/prioritas, jadi dilengkapi di sini
function normalizeWishlist(w) {
  return {
    id: String(w.id || Date.now() + Math.random().toString(36).slice(2, 6)),
    name: w.name || 'Tanpa nama',
    target: Number(w.target) || 0,
    saved: Number(w.saved) || 0,
    priority: PRIORITY_META[w.priority] ? w.priority : 'sedang',
    deadline: w.deadline || '',
    note: w.note || '',
    status: w.status === 'tercapai' ? 'tercapai' : 'aktif',
    createdAt: w.createdAt || new Date().toISOString(),
    achievedAt: w.achievedAt || null,
    expenseId: w.expenseId || null
  };
}

function saveWishlist() {
  const nama = document.getElementById('wlNama').value.trim();
  const harga = parseFloat(document.getElementById('wlHarga').value);
  const saved = parseFloat(document.getElementById('wlSaved').value) || 0;
  const priority = document.getElementById('wlPrioritas').value;
  const deadline = document.getElementById('wlDeadline').value;
  const note = document.getElementById('wlCatatan').value.trim();

  if (!nama || !harga || harga <= 0) { showToast('⚠️ Isi nama dan harga wishlist', 'warning'); return; }
  if (saved < 0) { showToast('Nominal tabungan tidak boleh minus', 'error'); return; }

  if (wlEditingId) {
    const w = savingTargets.find(x => x.id === wlEditingId);
    if (w) Object.assign(w, { name: nama, target: harga, saved, priority, deadline, note });
    showToast('✅ Wishlist diperbarui!', 'success');
  } else {
    savingTargets.push(normalizeWishlist({
      id: Date.now().toString(), name: nama, target: harga, saved, priority, deadline, note
    }));
    showToast('🎁 Wishlist ditambahkan!', 'success');
  }
  saveData();
  resetWishlistForm();
  wlTab = 'aktif';
  renderWishlist();
}

function resetWishlistForm() {
  clearDraft('wishlist');
  ['wlNama', 'wlHarga', 'wlSaved', 'wlDeadline', 'wlCatatan'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('wlPrioritas').value = 'sedang';
  wlEditingId = null;
  setText('wlFormTitle', '➕ Tambah Wishlist');
  setText('wlSaveBtn', '💾 Tambah Wishlist');
  hideEl('wlCancelEdit');
}

function cancelWishlistEdit() { resetWishlistForm(); }

function editWishlist(id) {
  const w = savingTargets.find(x => x.id === id);
  if (!w) return;
  wlEditingId = id;
  document.getElementById('wlNama').value = w.name;
  document.getElementById('wlHarga').value = w.target;
  document.getElementById('wlSaved').value = w.saved || '';
  document.getElementById('wlPrioritas').value = w.priority;
  document.getElementById('wlDeadline').value = w.deadline || '';
  document.getElementById('wlCatatan').value = w.note || '';
  setText('wlFormTitle', '✏️ Edit Wishlist');
  setText('wlSaveBtn', '💾 Simpan Perubahan');
  showEl('wlCancelEdit');
  closeWishlistDetail();
  document.getElementById('wlFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('wlNama').focus();
}

function setWishlistTab(tab) {
  wlTab = tab;
  renderWishlist();
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function deadlineLabel(w) {
  if (!w.deadline || w.status === 'tercapai') return '';
  const d = daysUntil(w.deadline);
  if (d === null) return '';
  if (d < 0) return `⏰ Lewat ${Math.abs(d)} hari`;
  if (d === 0) return '⏰ Hari ini';
  return `⏰ ${d} hari lagi`;
}

function renderWishlist() {
  const container = document.getElementById('wishlistList');
  if (!container) return;

  const aktif = savingTargets.filter(w => w.status !== 'tercapai');
  const done = savingTargets.filter(w => w.status === 'tercapai');
  const totalAktif = aktif.reduce((a, w) => a + w.target, 0);
  const totalSaved = aktif.reduce((a, w) => a + Math.min(w.saved, w.target), 0);
  setText('wlCountAktif', aktif.length);
  setText('wlTotalHarga', formatRp(totalAktif));
  setText('wlTotalKurang', totalAktif > 0 ? `Kurang ${formatRp(totalAktif - totalSaved)}` : 'belum ada wishlist');
  setText('wlCountDone', done.length);
  setText('wlTotalDone', done.length ? `Total ${formatRp(done.reduce((a, w) => a + w.target, 0))}` : 'belum ada');

  document.querySelectorAll('.wl-tab').forEach(t => t.classList.toggle('active', t.dataset.wltab === wlTab));

  let list = wlTab === 'aktif' ? aktif : wlTab === 'tercapai' ? done : [...savingTargets];
  const sort = document.getElementById('wlSort')?.value || 'prioritas';
  list.sort((a, b) => {
    if (sort === 'termurah') return a.target - b.target;
    if (sort === 'termahal') return b.target - a.target;
    if (sort === 'terbaru') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'deadline') return (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1;
    return PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order
      || new Date(a.createdAt) - new Date(b.createdAt);
  });

  if (list.length === 0) {
    const msg = wlTab === 'tercapai' ? 'Belum ada wishlist yang tercapai' : 'Belum ada wishlist. Tambahkan di atas!';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎁</div><p>${msg}</p></div>`;
    return;
  }

  container.innerHTML = list.map(w => {
    const isDone = w.status === 'tercapai';
    const pct = isDone ? 100 : Math.min((w.saved / w.target) * 100, 100);
    const dl = deadlineLabel(w);
    const p = PRIORITY_META[w.priority];
    return `
      <div class="wl-item ${isDone ? 'done' : ''}" onclick="openWishlistDetail('${w.id}')">
        <div class="wl-item-top">
          <span class="wl-item-name">${isDone ? '✅' : p.icon} ${escHtml(w.name)}</span>
          <span class="wl-item-price">${formatRp(w.target)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="target-item-sub">
          <span>${isDone ? 'Tercapai' : `Ditabung ${formatRp(w.saved)} · ${Math.round(pct)}%`}</span>
          <span>${dl || (isDone ? formatDateShort((w.achievedAt || '').slice(0, 10)) : '')}</span>
        </div>
      </div>`;
  }).join('');
}

function openWishlistDetail(id) {
  const w = savingTargets.find(x => x.id === id);
  if (!w) return;
  wlDetailId = id;
  const isDone = w.status === 'tercapai';
  const pct = isDone ? 100 : Math.min((w.saved / w.target) * 100, 100);
  const kurang = Math.max(w.target - w.saved, 0);
  const saldo = settings.saldoSekarang || 0;
  const p = PRIORITY_META[w.priority];
  const dl = deadlineLabel(w);

  let saldoInfo = '';
  if (!isDone) {
    saldoInfo = saldo >= w.target
      ? `<div class="wl-note ok">💳 Saldo kamu (${formatRp(saldo)}) cukup untuk membeli ini.</div>`
      : `<div class="wl-note warn">💳 Saldo kamu ${formatRp(saldo)}, kurang ${formatRp(w.target - saldo)} untuk membeli ini.</div>`;
  }

  const actions = isDone ? `
    <button class="btn-danger" onclick="deleteWishlist('${w.id}')">🗑️ Hapus</button>
    <button class="btn-secondary" onclick="undoWishlistDone('${w.id}')">↩️ Batalkan Tercapai</button>`
  : `
    <button class="btn-danger" onclick="deleteWishlist('${w.id}')">🗑️ Hapus</button>
    <button class="btn-secondary" onclick="editWishlist('${w.id}')">✏️ Edit</button>
    <button class="btn-primary" onclick="markWishlistDone('${w.id}')">✅ Tercapai</button>`;

  document.getElementById('wlDetailBody').innerHTML = `
    <div class="wl-detail-title">${isDone ? '✅' : '🎁'} ${escHtml(w.name)}</div>
    <div class="wl-detail-price">${formatRp(w.target)}</div>
    <div class="wl-badges">
      <span class="wl-badge">${p.icon} Prioritas ${p.label}</span>
      <span class="wl-badge ${isDone ? 'done' : ''}">${isDone ? '✅ Tercapai' : '⏳ Belum tercapai'}</span>
      ${dl ? `<span class="wl-badge">${dl}</span>` : ''}
    </div>
    <div class="progress-track" style="margin-top:1rem"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="target-item-sub">
      <span>Ditabung: ${formatRp(isDone ? w.target : w.saved)} / ${formatRp(w.target)}</span>
      <span>${isDone ? '100%' : `Kurang: ${formatRp(kurang)}`}</span>
    </div>
    <div class="wl-detail-rows">
      ${w.deadline ? `<div><span>Target tanggal</span><b>${formatDateShort(w.deadline)} ${w.deadline.slice(0, 4)}</b></div>` : ''}
      <div><span>Dibuat</span><b>${formatDateShort(w.createdAt.slice(0, 10))} ${w.createdAt.slice(0, 4)}</b></div>
      ${isDone && w.achievedAt ? `<div><span>Tercapai pada</span><b>${formatDateShort(w.achievedAt.slice(0, 10))} ${w.achievedAt.slice(0, 4)}</b></div>` : ''}
    </div>
    ${w.note ? `<div class="wl-note">📝 ${escHtml(w.note)}</div>` : ''}
    ${saldoInfo}
    ${!isDone ? `
    <div class="wl-addsaved">
      <input type="number" id="wlAddSaved" placeholder="Tambah tabungan (Rp)" min="0" />
      <button class="btn-outline" onclick="addWishlistSaved('${w.id}')">➕ Tabung</button>
    </div>
    <p class="setting-desc" style="margin-top:0.4rem">Tabungan hanya penanda progress. Saldo baru berkurang saat kamu tekan <b>Tercapai</b>.</p>` : ''}
    <div class="form-actions wl-actions">${actions}</div>
  `;
  showEl('wlModal');
}

function closeWishlistDetail() {
  hideEl('wlModal');
  wlDetailId = null;
}

function addWishlistSaved(id) {
  const w = savingTargets.find(x => x.id === id);
  const v = parseFloat(document.getElementById('wlAddSaved').value);
  if (!w || isNaN(v) || v <= 0) { showToast('Masukkan nominal tabungan yang valid', 'error'); return; }
  w.saved += v;
  saveData();
  renderWishlist();
  openWishlistDetail(id);
  showToast(`➕ Tabungan +${formatRp(v)}`, 'success');
}

// Tercapai: saldo otomatis berkurang sebesar harga, dan tercatat di Riwayat (kategori Wishlist)
function markWishlistDone(id) {
  const w = savingTargets.find(x => x.id === id);
  if (!w || w.status === 'tercapai') return;
  const before = settings.saldoSekarang || 0;
  const after = before - w.target;
  const warn = after < 0 ? ' ⚠️ Saldo akan menjadi minus!' : '';

  openConfirm(
    'Wishlist Tercapai? 🎉',
    `"${w.name}" seharga ${formatRp(w.target)}. Saldo akan berkurang dari ${formatRp(before)} menjadi ${formatRp(after)}.${warn}`,
    () => {
      const expense = {
        id: 'wl-' + Date.now(),
        name: w.name,
        category: 'Wishlist',
        amount: w.target,
        date: toDateStr(new Date()),
        note: 'Wishlist tercapai',
        createdAt: new Date().toISOString(),
        wishlistId: w.id
      };
      expenses.unshift(expense);
      settings.saldoSekarang = before - w.target;
      w.status = 'tercapai';
      w.saved = w.target;
      w.achievedAt = new Date().toISOString();
      w.expenseId = expense.id;
      saveData();
      closeWishlistDetail();
      refreshAll();
      showToast(`🎉 Tercapai! Saldo berkurang ${formatRp(w.target)}`, 'success');
      checkBudgetWarning();
    }
  );
}

// Batalkan tercapai: saldo dikembalikan dan transaksi wishlist dihapus dari riwayat
function undoWishlistDone(id) {
  const w = savingTargets.find(x => x.id === id);
  if (!w || w.status !== 'tercapai') return;
  openConfirm('Batalkan Tercapai?', `Saldo dikembalikan ${formatRp(w.target)} dan transaksinya dihapus dari riwayat.`, () => {
    const exp = expenses.find(e => e.id === w.expenseId);
    if (exp) {
      settings.saldoSekarang = (settings.saldoSekarang || 0) + exp.amount;
      expenses = expenses.filter(e => e.id !== exp.id);
    }
    w.status = 'aktif';
    w.expenseId = null;
    w.achievedAt = null;
    saveData();
    closeWishlistDetail();
    refreshAll();
    showToast('↩️ Wishlist kembali aktif, saldo dikembalikan', 'success');
  });
}

function deleteWishlist(id) {
  const w = savingTargets.find(x => x.id === id);
  if (!w) return;
  const msg = w.status === 'tercapai'
    ? `"${w.name}" dihapus dari daftar wishlist. Transaksinya di Riwayat tetap ada.`
    : `"${w.name}" akan dihapus dari wishlist. Saldo tidak berubah.`;
  openConfirm('Hapus Wishlist?', msg, () => {
    savingTargets = savingTargets.filter(x => x.id !== id);
    if (wlEditingId === id) resetWishlistForm();
    saveData();
    closeWishlistDetail();
    renderWishlist();
    showToast('🗑️ Wishlist dihapus', 'success');
  });
}

function renderTargets() {
  // Saldo display
  const saldoAwal = settings.saldoAwal || 0;
  const saldo = settings.saldoSekarang || 0;
  const totalPakai = saldoAwal - saldo;

  // big saldo nominal
  const bigEl = document.getElementById('saldoNominalBig');
  if (bigEl) {
    bigEl.textContent = formatRp(saldo);
    bigEl.style.color = saldo < 0 ? 'var(--danger)' : saldo < saldoAwal * 0.1 ? 'var(--warning)' : 'var(--accent)';
  }

  if (saldoAwal > 0) {
    const pct = Math.min(Math.max(((saldoAwal - saldo) / saldoAwal) * 100, 0), 100);
    setText('tsBudget', formatRp(saldoAwal));
    setText('tsTerpakai', formatRp(Math.max(totalPakai, 0)));
    const sisaEl = document.getElementById('tsSisa');
    if (sisaEl) {
      sisaEl.textContent = saldo >= 0 ? formatRp(saldo) : `⚠️ Minus ${formatRp(Math.abs(saldo))}`;
      sisaEl.style.color = saldo < 0 ? 'var(--danger)' : saldo < saldoAwal * 0.1 ? 'var(--warning)' : '';
    }
    document.getElementById('targetProgress').style.width = pct + '%';
    document.getElementById('targetProgress').classList.toggle('danger', saldo < 0 || pct >= 90);

    const warn = document.getElementById('targetWarning');
    if (saldo < 0) {
      warn.textContent = `🚨 Saldo minus! Pengeluaran melebihi saldo ${formatRp(Math.abs(saldo))}`;
      showEl(warn);
    } else if (pct >= 80) {
      warn.textContent = `⚠️ Saldo tinggal ${formatRp(saldo)} (${Math.round(100-pct)}% tersisa)!`;
      showEl(warn);
    } else {
      hideEl(warn);
    }
  } else {
    setText('tsBudget', 'Belum ada saldo');
    setText('tsTerpakai', '–');
    setText('tsSisa', '–');
    hideEl(document.getElementById('targetWarning'));
    document.getElementById('targetProgress').style.width = '0%';
  }
}

/* ===================== PEMASUKAN ===================== */
const INCOME_CATS = {
  'Saldo Awal': '🏦', Gaji: '💼', 'Uang Saku': '🎒', Freelance: '💻', Bonus: '🎉', Hadiah: '🎁', Usaha: '🏪', Lainnya: '💵'
};

function getIncomeIcon(cat) { return INCOME_CATS[cat] || '💵'; }

function normalizeIncome(x) {
  return {
    id: String(x.id || Date.now() + Math.random().toString(36).slice(2, 6)),
    name: x.name || 'Pemasukan',
    category: INCOME_CATS[x.category] ? x.category : 'Lainnya',
    amount: Number(x.amount) || 0,
    date: x.date || toDateStr(new Date()),
    note: x.note || '',
    createdAt: x.createdAt || new Date().toISOString(),
    recurringId: x.recurringId || null
  };
}

// Pemasukan = satu-satunya cara menambah saldo: saldo bertambah dan transaksinya tercatat
function applyIncomeToSaldo(amount) {
  settings.saldoAwal = (settings.saldoAwal || 0) + amount;
  settings.saldoSekarang = (settings.saldoSekarang || 0) + amount;
}

function setIncomeDefaultDate() {
  const el = document.getElementById('incTanggal');
  if (el && !el.value) el.value = toDateStr(new Date());
}

function saveIncome() {
  const nama = document.getElementById('incNama').value.trim();
  const kategori = document.getElementById('incKategori').value;
  const nominal = parseFloat(document.getElementById('incNominal').value);
  const tanggal = document.getElementById('incTanggal').value;
  const catatan = document.getElementById('incCatatan').value.trim();

  if (!nama || !kategori || !nominal || !tanggal) { showToast('⚠️ Lengkapi semua field yang wajib diisi!', 'warning'); return; }
  if (nominal <= 0) { showToast('Nominal harus lebih dari 0', 'error'); return; }

  if (incomeEditingId) {
    const inc = incomes.find(x => x.id === incomeEditingId);
    if (inc) {
      const diff = nominal - inc.amount;
      Object.assign(inc, { name: nama, category: kategori, amount: nominal, date: tanggal, note: catatan });
      if (diff !== 0) applyIncomeToSaldo(diff);
    }
    showToast('✅ Pemasukan diperbarui!', 'success');
  } else {
    incomes.unshift(normalizeIncome({
      id: Date.now().toString(), name: nama, category: kategori, amount: nominal, date: tanggal, note: catatan
    }));
    applyIncomeToSaldo(nominal);
    showToast(`✅ Pemasukan dicatat! Saldo +${formatRp(nominal)}`, 'success');
  }
  saveData();
  resetIncomeForm();
  refreshAll();
}

function resetIncomeForm() {
  clearDraft('income');
  ['incNama', 'incNominal', 'incCatatan'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('incKategori').value = '';
  document.getElementById('incTanggal').value = toDateStr(new Date());
  incomeEditingId = null;
  setText('incFormTitle', '➕ Catat Pemasukan');
  setText('incSaveBtn', '💾 Simpan Pemasukan');
  hideEl('incCancelEdit');
}

function editIncome(id) {
  const inc = incomes.find(x => x.id === id);
  if (!inc) return;
  incomeEditingId = id;
  document.getElementById('incNama').value = inc.name;
  document.getElementById('incKategori').value = inc.category;
  document.getElementById('incNominal').value = inc.amount;
  document.getElementById('incTanggal').value = inc.date;
  document.getElementById('incCatatan').value = inc.note || '';
  setText('incFormTitle', '✏️ Edit Pemasukan');
  setText('incSaveBtn', '💾 Simpan Perubahan');
  showEl('incCancelEdit');
  document.getElementById('incFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteIncome(id) {
  const inc = incomes.find(x => x.id === id);
  if (!inc) return;
  openConfirm('Hapus Pemasukan?', `Saldo akan dikurangi ${formatRp(inc.amount)} karena pemasukan ini dibatalkan.`, () => {
    applyIncomeToSaldo(-inc.amount);
    incomes = incomes.filter(x => x.id !== id);
    if (incomeEditingId === id) resetIncomeForm();
    saveData();
    refreshAll();
    showToast(`🗑️ Pemasukan dihapus. Saldo -${formatRp(inc.amount)}`, 'success');
  });
}

function monthIncomes(now = new Date()) {
  return incomes.filter(x => {
    const d = new Date(x.date + 'T00:00:00');
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
}

function renderIncomes() {
  const container = document.getElementById('incomeList');
  if (!container) return;
  const now = new Date();
  const bulan = monthIncomes(now);
  const totalMasuk = sumExpenses(bulan);
  const totalKeluar = sumExpenses(expenses.filter(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }));
  const net = totalMasuk - totalKeluar;

  setText('incBulanIni', formatRp(totalMasuk));
  setText('incBulanIniSub', `${bulan.length} pemasukan`);
  setText('incKeluarBulan', formatRp(totalKeluar));
  const netEl = document.getElementById('incNet');
  if (netEl) {
    netEl.textContent = (net >= 0 ? '+' : '-') + formatRp(Math.abs(net));
    netEl.style.color = net >= 0 ? 'var(--accent)' : 'var(--danger)';
  }
  setText('incNetSub', net >= 0 ? 'bulan ini surplus 👍' : 'bulan ini defisit ⚠️');

  const list = [...incomes].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">💵</div><p>Belum ada pemasukan</p></div>`;
    return;
  }
  container.innerHTML = list.map(x => `
    <div class="tx-card">
      <div class="tx-icon">${getIncomeIcon(x.category)}</div>
      <div class="tx-info">
        <div class="tx-name">${escHtml(x.name)}${x.recurringId ? ' <span class="rc-tag">🔁</span>' : ''}</div>
        <div class="tx-meta">${escHtml(x.category)} · ${formatDateShort(x.date)}${x.note ? ' · ' + escHtml(x.note) : ''}</div>
      </div>
      <div class="tx-amount income">+${formatRp(x.amount)}</div>
      <div class="tx-actions">
        <button class="tx-btn" onclick="editIncome('${x.id}')" title="Edit">✏️</button>
        <button class="tx-btn del" onclick="deleteIncome('${x.id}')" title="Hapus">🗑️</button>
      </div>
    </div>`).join('');
}

/* ===================== TRANSAKSI BERULANG ===================== */
const FREQ_LABEL = { mingguan: 'Tiap minggu', bulanan: 'Tiap bulan', tahunan: 'Tiap tahun' };
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function normalizeRecurring(r) {
  return {
    id: String(r.id || Date.now() + Math.random().toString(36).slice(2, 6)),
    type: r.type === 'income' ? 'income' : 'expense',
    name: r.name || 'Transaksi berulang',
    category: r.category || 'Lainnya',
    amount: Number(r.amount) || 0,
    frequency: FREQ_LABEL[r.frequency] ? r.frequency : 'bulanan',
    startDate: r.startDate || toDateStr(new Date()),
    mode: r.mode === 'auto' ? 'auto' : 'reminder',
    active: r.active !== false,
    lastProcessed: r.lastProcessed || '',
    doneDates: Array.isArray(r.doneDates) ? r.doneDates : [],
    note: r.note || ''
  };
}

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// Apakah tanggal d (objek Date) adalah jadwal dari aturan r? Pola diambil dari startDate.
function ruleMatches(r, d) {
  const s = new Date(r.startDate + 'T00:00:00');
  if (d < s) return false;
  if (r.frequency === 'mingguan') return d.getDay() === s.getDay();
  const dim = daysInMonth(d.getFullYear(), d.getMonth());
  const dayTarget = Math.min(s.getDate(), dim); // tgl 31 → otomatis jadi tgl terakhir bulan pendek
  if (r.frequency === 'bulanan') return d.getDate() === dayTarget;
  if (r.frequency === 'tahunan') return d.getMonth() === s.getMonth() && d.getDate() === dayTarget;
  return false;
}

// Semua tanggal jadwal setelah lastProcessed sampai hari ini (maks 36 agar tidak membanjiri)
function dueDates(r, todayDate = new Date()) {
  const today = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
  const start = new Date(r.startDate + 'T00:00:00');
  let from = start;
  if (r.lastProcessed) {
    const lp = new Date(r.lastProcessed + 'T00:00:00');
    lp.setDate(lp.getDate() + 1);
    if (lp > from) from = lp;
  }
  const out = [];
  const cur = new Date(from);
  let guard = 0;
  while (cur <= today && guard < 4000) {
    if (ruleMatches(r, cur)) {
      const ds = toDateStr(cur);
      if (!r.doneDates.includes(ds)) out.push(ds);
    }
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out.slice(-36);
}

function nextDueDate(r) {
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  const startFloor = new Date(r.startDate + 'T00:00:00');
  if (cur < startFloor) cur.setTime(startFloor.getTime() - 86400000);
  for (let i = 0; i < 800; i++) {
    cur.setDate(cur.getDate() + 1);
    if (ruleMatches(r, cur)) return toDateStr(cur);
  }
  return null;
}

function recurringPattern(r) {
  const s = new Date(r.startDate + 'T00:00:00');
  if (r.frequency === 'mingguan') return `Tiap hari ${DAY_NAMES[s.getDay()]}`;
  if (r.frequency === 'bulanan') return `Tiap bulan tgl ${s.getDate()}`;
  return `Tiap tahun ${s.getDate()} ${MONTH_NAMES[s.getMonth()]}`;
}

// Catat 1 kemunculan aturan menjadi transaksi asli (dan sesuaikan saldo)
function postRecurringOccurrence(r, dateStr) {
  if (r.type === 'income') {
    incomes.unshift(normalizeIncome({
      id: 'rc-' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: r.name, category: r.category, amount: r.amount, date: dateStr,
      note: r.note || 'Berulang', recurringId: r.id
    }));
    applyIncomeToSaldo(r.amount);
  } else {
    expenses.unshift({
      id: 'rc-' + Date.now() + Math.random().toString(36).slice(2, 5),
      name: r.name, category: r.category, amount: r.amount, date: dateStr,
      note: r.note || 'Berulang', createdAt: new Date().toISOString(), recurringId: r.id
    });
    settings.saldoSekarang = (settings.saldoSekarang || 0) - r.amount;
  }
}

// Dipanggil saat app dibuka / kembali aktif. Mode "auto" langsung dicatat; mode "reminder" hanya ditandai jatuh tempo.
function processRecurring(silent = false) {
  let count = 0;
  const todayStr = toDateStr(new Date());
  recurring.forEach(r => {
    if (!r.active || r.amount <= 0) return;
    if (r.mode !== 'auto') return;
    const dates = dueDates(r);
    dates.forEach(ds => { postRecurringOccurrence(r, ds); count++; });
    if (dates.length || r.lastProcessed !== todayStr) {
      r.lastProcessed = todayStr;
      r.doneDates = [];
    }
  });
  if (count > 0) {
    saveData();
    refreshAll();
    if (!silent) showToast(`🔁 ${count} transaksi berulang dicatat otomatis`, 'success');
  }
  return count;
}

function pendingReminders() {
  const list = [];
  recurring.forEach(r => {
    if (!r.active || r.mode !== 'reminder' || r.amount <= 0) return;
    dueDates(r).forEach(ds => list.push({ rule: r, date: ds }));
  });
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

function settleOccurrence(ruleId, dateStr, action) {
  const r = recurring.find(x => x.id === ruleId);
  if (!r) return;
  if (action === 'catat') {
    // dicatat pada tanggal hari ini (saat benar-benar dibayar / diterima)
    postRecurringOccurrence(r, toDateStr(new Date()));
    const verb = r.type === 'income' ? 'diterima' : 'dibayar';
    showToast(`✅ ${r.name} ${verb}. Saldo ${r.type === 'income' ? '+' : '-'}${formatRp(r.amount)}`, 'success');
  } else {
    showToast(`⏭️ ${r.name} dilewati`, 'success');
  }
  r.doneDates.push(dateStr);
  if (dueDates(r).length === 0) { r.lastProcessed = toDateStr(new Date()); r.doneDates = []; }
  saveData();
  refreshAll();
}

function renderDueReminders() {
  const box = document.getElementById('dueCard');
  if (!box) return;
  const list = pendingReminders();
  if (list.length === 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="due-title">🔔 Jatuh Tempo (${list.length})</div>
    ${list.map(p => `
      <div class="due-item">
        <div class="due-info">
          <div class="due-name">${p.rule.type === 'income' ? '💵' : getCatIcon(p.rule.category)} ${escHtml(p.rule.name)}</div>
          <div class="due-meta">${p.rule.type === 'income' ? '+' : '-'}${formatRp(p.rule.amount)} · jadwal ${formatDateShort(p.date)}</div>
        </div>
        <div class="due-actions">
          <button class="btn-primary due-btn" onclick="settleOccurrence('${p.rule.id}','${p.date}','catat')">${p.rule.type === 'income' ? 'Diterima' : 'Bayar'}</button>
          <button class="btn-secondary due-btn" onclick="settleOccurrence('${p.rule.id}','${p.date}','lewati')">Lewati</button>
        </div>
      </div>`).join('')}`;
}

/* --- Form & daftar aturan berulang --- */
function fillRecurringCategories() {
  const type = document.getElementById('rcType').value;
  const sel = document.getElementById('rcKategori');
  const cur = sel.value;
  const expCats = ['Makan', 'Bensin', 'Kopi', 'Jajan', 'Transportasi', 'Tagihan', 'Belanja', 'Rokok', 'Skincare', 'Pakaian', 'Lainnya'];
  const cats = type === 'income' ? Object.keys(INCOME_CATS) : expCats;
  sel.innerHTML = '<option value="">Pilih kategori</option>' +
    cats.map(c => `<option value="${c}">${type === 'income' ? getIncomeIcon(c) : getCatIcon(c)} ${c}</option>`).join('');
  if (cats.includes(cur)) sel.value = cur;
}

function saveRecurring() {
  const type = document.getElementById('rcType').value;
  const nama = document.getElementById('rcNama').value.trim();
  const kategori = document.getElementById('rcKategori').value;
  const nominal = parseFloat(document.getElementById('rcNominal').value);
  const freq = document.getElementById('rcFreq').value;
  const start = document.getElementById('rcStart').value;
  const mode = document.getElementById('rcMode').value;

  if (!nama || !kategori || !nominal || !start) { showToast('⚠️ Lengkapi semua field yang wajib diisi!', 'warning'); return; }
  if (nominal <= 0) { showToast('Nominal harus lebih dari 0', 'error'); return; }

  if (rcEditingId) {
    const r = recurring.find(x => x.id === rcEditingId);
    if (r) {
      const patternChanged = r.startDate !== start || r.frequency !== freq;
      Object.assign(r, { type, name: nama, category: kategori, amount: nominal, frequency: freq, startDate: start, mode });
      if (patternChanged) { r.lastProcessed = ''; r.doneDates = []; }
    }
    showToast('✅ Transaksi berulang diperbarui!', 'success');
  } else {
    recurring.push(normalizeRecurring({
      id: Date.now().toString(), type, name: nama, category: kategori, amount: nominal,
      frequency: freq, startDate: start, mode
    }));
    showToast('🔁 Transaksi berulang ditambahkan!', 'success');
  }
  saveData();
  resetRecurringForm();
  processRecurring();
  renderRecurring();
  renderDueReminders();
}

function resetRecurringForm() {
  clearDraft('recurring');
  ['rcNama', 'rcNominal'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('rcType').value = 'expense';
  fillRecurringCategories();
  document.getElementById('rcKategori').value = '';
  document.getElementById('rcFreq').value = 'bulanan';
  document.getElementById('rcStart').value = toDateStr(new Date());
  document.getElementById('rcMode').value = 'reminder';
  rcEditingId = null;
  setText('rcFormTitle', '➕ Tambah Transaksi Berulang');
  setText('rcSaveBtn', '💾 Simpan');
  hideEl('rcCancelEdit');
  updateRecurringHint();
}

function editRecurring(id) {
  const r = recurring.find(x => x.id === id);
  if (!r) return;
  rcEditingId = id;
  document.getElementById('rcType').value = r.type;
  fillRecurringCategories();
  document.getElementById('rcNama').value = r.name;
  document.getElementById('rcKategori').value = r.category;
  document.getElementById('rcNominal').value = r.amount;
  document.getElementById('rcFreq').value = r.frequency;
  document.getElementById('rcStart').value = r.startDate;
  document.getElementById('rcMode').value = r.mode;
  setText('rcFormTitle', '✏️ Edit Transaksi Berulang');
  setText('rcSaveBtn', '💾 Simpan Perubahan');
  showEl('rcCancelEdit');
  updateRecurringHint();
  document.getElementById('rcFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleRecurring(id) {
  const r = recurring.find(x => x.id === id);
  if (!r) return;
  r.active = !r.active;
  // saat dilanjutkan lagi, jadwal yang terlewat selama jeda tidak ditagih
  if (r.active) { r.lastProcessed = toDateStr(new Date()); r.doneDates = []; }
  saveData();
  renderRecurring();
  renderDueReminders();
  showToast(r.active ? '▶️ Dilanjutkan' : '⏸️ Dijeda', 'success');
}

function deleteRecurring(id) {
  const r = recurring.find(x => x.id === id);
  if (!r) return;
  openConfirm('Hapus Transaksi Berulang?', `Jadwal "${r.name}" dihapus. Transaksi yang sudah tercatat tetap ada.`, () => {
    recurring = recurring.filter(x => x.id !== id);
    if (rcEditingId === id) resetRecurringForm();
    saveData();
    renderRecurring();
    renderDueReminders();
    showToast('🗑️ Jadwal dihapus', 'success');
  });
}

function updateRecurringHint() {
  const start = document.getElementById('rcStart').value;
  const freq = document.getElementById('rcFreq').value;
  const el = document.getElementById('rcHint');
  if (!el || !start) return;
  el.textContent = '📅 ' + recurringPattern({ startDate: start, frequency: freq });
}

function renderRecurring() {
  const container = document.getElementById('recurringList');
  if (!container) return;
  if (recurring.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔁</div><p>Belum ada transaksi berulang</p></div>`;
    return;
  }
  container.innerHTML = recurring.map(r => {
    const next = nextDueDate(r);
    const pending = r.active && r.mode === 'reminder' ? dueDates(r).length : 0;
    const sign = r.type === 'income' ? '+' : '-';
    return `
    <div class="rc-item ${r.active ? '' : 'paused'}">
      <div class="rc-top">
        <span class="rc-name">${r.type === 'income' ? getIncomeIcon(r.category) : getCatIcon(r.category)} ${escHtml(r.name)}</span>
        <span class="rc-amount ${r.type === 'income' ? 'income' : ''}">${sign}${formatRp(r.amount)}</span>
      </div>
      <div class="wl-badges">
        <span class="wl-badge">${recurringPattern(r)}</span>
        <span class="wl-badge">${r.mode === 'auto' ? '⚡ Catat otomatis' : '🔔 Ingatkan saya'}</span>
        ${r.active ? '' : '<span class="wl-badge">⏸️ Dijeda</span>'}
        ${pending ? `<span class="wl-badge warn">⚠️ ${pending} jatuh tempo</span>` : ''}
      </div>
      <div class="rc-next">${r.active && next ? `Berikutnya: ${formatDateShort(next)} ${next.slice(0, 4)}` : ''}</div>
      <div class="rc-actions">
        <button class="tx-btn" onclick="toggleRecurring('${r.id}')" title="${r.active ? 'Jeda' : 'Lanjutkan'}">${r.active ? '⏸️' : '▶️'}</button>
        <button class="tx-btn" onclick="editRecurring('${r.id}')" title="Edit">✏️</button>
        <button class="tx-btn del" onclick="deleteRecurring('${r.id}')" title="Hapus">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

/* ===================== PWA ===================== */
let deferredInstallPrompt = null;

// Letakkan file APK di folder yang sama dengan index.html dengan nama ini.
// Kalau filenya ada & dibuka dari HP Android (browser), tombol Pasang langsung mengunduh APK-nya.
const APK_URL = 'RizqTrack.apk';
let apkState = 'unknown';   // 'yes' = file ada, 'no' = pasti tidak ada, 'unknown' = belum/tidak bisa dipastikan

function apkEligible() {
  return /^https?:$/.test(location.protocol) && !isAndroidWebView() && !/iphone|ipad|ipod/i.test(navigator.userAgent);
}
// Mode APK dipakai kecuali server SUDAH PASTI tidak punya filenya. Jadi saat pengecekan belum selesai
// atau gagal (sinyal jelek), tombol tetap langsung mengunduh.
function apkMode() { return apkEligible() && apkState !== 'no'; }

async function checkApkAvailable() {
  if (!apkEligible()) return;
  try {
    const r = await fetch(APK_URL, { method: 'HEAD', cache: 'no-cache' });
    const type = r.headers.get('content-type') || '';
    const size = parseInt(r.headers.get('content-length') || '0', 10);
    // 404, atau hosting "fallback ke index.html" yang membalas HTML → file APK tidak ada
    if (r.status === 404 || r.status === 410 || /text\/html/i.test(type)) apkState = 'no';
    else if (r.ok && (size === 0 || size > 50000)) apkState = 'yes';
    else apkState = 'unknown';
  } catch (e) { apkState = 'unknown'; }
  updateInstallUI();
}

function initPWA() {
  checkApkAvailable();
  // Minta browser/WebView agar data tidak dibersihkan otomatis saat penyimpanan hampir penuh
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW gagal:', err));
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallUI();
    showToast('📲 RizqTrack berhasil dipasang!', 'success');
  });
  updateInstallUI();
}

function isStandalone() {
  const mq = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return mq || window.navigator.standalone === true;
}

function updateInstallUI() {
  const btn = document.getElementById('installBtn');
  const status = document.getElementById('installStatus');
  const alt = document.getElementById('installAltBtn');
  if (!btn || !status) return;
  if (alt) alt.classList.add('hidden');
  btn.textContent = '📲 Pasang RizqTrack';
  if (isAndroidWebView()) {
    status.textContent = '✅ Kamu sudah memakai RizqTrack sebagai aplikasi Android.';
    btn.classList.add('hidden');
  } else if (isStandalone()) {
    status.textContent = '✅ RizqTrack sudah terpasang dan berjalan sebagai aplikasi.';
    btn.classList.add('hidden');
  } else if (!/^https?:$/.test(location.protocol)) {
    status.textContent = 'Pasang aplikasi butuh dibuka lewat https:// atau localhost (bukan file langsung). Upload ke Vercel / GitHub Pages / Netlify, atau pakai Live Server.';
    btn.classList.add('hidden');
  } else if (apkMode()) {
    const android = /Android/i.test(navigator.userAgent);
    status.textContent = android
      ? 'Ketuk tombol di bawah: RizqTrack.apk langsung terunduh. Setelah selesai, ketuk Buka lalu Instal di notifikasi unduhan.'
      : 'Ketuk tombol di bawah untuk langsung mengunduh RizqTrack.apk. Buka file itu di HP Android untuk memasangnya.';
    btn.textContent = android ? '📲 Pasang RizqTrack (APK)' : '⬇️ Unduh RizqTrack (APK)';
    btn.classList.remove('hidden');
    if (alt) { alt.textContent = '🌐 Pasang lewat browser'; alt.classList.remove('hidden'); }
  } else {
    // Tombol SELALU tampil: kalau browser memberi izin pasang langsung → satu ketukan,
    // kalau tidak → tampil petunjuk langkah sesuai browser yang dipakai.
    status.textContent = 'Pasang RizqTrack di layar utama supaya terbuka seperti aplikasi biasa dan bisa dipakai offline.';
    btn.classList.remove('hidden');
  }
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return /CriOS/.test(ua) ? 'ios-chrome' : 'ios-safari';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/EdgA|EdgiOS|Edg\//.test(ua)) return 'edge';
  if (/Android/i.test(ua)) return 'chrome-android';
  return 'desktop';
}

const INSTALL_STEPS = {
  'chrome-android': ['Ketuk menu <b>⋮</b> (titik tiga) di pojok kanan atas browser.', 'Pilih <b>“Instal aplikasi”</b> (atau <b>“Tambahkan ke layar utama”</b>).', 'Ketuk <b>Instal</b>.', 'RizqTrack muncul di layar utama / laci aplikasi HP-mu.'],
  samsung: ['Ketuk menu <b>≡</b> (garis tiga) di browser Samsung Internet.', 'Pilih <b>“Tambahkan halaman ke”</b>.', 'Pilih <b>“Layar utama”</b> lalu <b>Tambah</b>.', 'RizqTrack muncul di layar utama HP-mu.'],
  firefox: ['Ketuk menu <b>⋮</b> di Firefox.', 'Pilih <b>“Instal”</b> (atau <b>“Tambahkan ke layar utama”</b>).', 'Konfirmasi dengan <b>Tambah</b>.'],
  edge: ['Ketuk menu <b>⋯</b> di Microsoft Edge.', 'Pilih <b>“Tambahkan ke ponsel”</b> atau <b>“Instal aplikasi”</b>.', 'Konfirmasi dengan <b>Instal</b>.'],
  'ios-safari': ['Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas) di bagian bawah Safari.', 'Gulir lalu pilih <b>“Tambah ke Layar Utama”</b>.', 'Ketuk <b>Tambah</b> di pojok kanan atas.'],
  'ios-chrome': ['Ketuk tombol <b>Bagikan</b> di Chrome.', 'Pilih <b>“Tambahkan ke Layar Utama”</b>.', 'Tips: di iPhone cara paling lancar memakai <b>Safari</b>.'],
  desktop: ['Lihat ujung kanan kolom alamat browser, cari ikon <b>Instal</b> (monitor dengan panah).', 'Klik ikon itu, lalu klik <b>Instal</b>.', 'Atau buka menu <b>⋮</b> → <b>“Instal RizqTrack…”</b> / <b>“Simpan dan bagikan → Instal”</b>.']
};


function showInstallHelp() {
  const steps = INSTALL_STEPS[detectBrowser()] || INSTALL_STEPS.desktop;
  document.getElementById('installSteps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  showEl('installModal');
}
function closeInstallHelp() { hideEl('installModal'); }

function apkStartedStatus() {
  const status = document.getElementById('installStatus');
  if (status) status.textContent = /Android/i.test(navigator.userAgent)
    ? '✅ Unduhan dimulai. Setelah selesai, ketuk Buka lalu Instal pada notifikasi unduhan. (Pertama kali: izinkan “sumber tidak dikenal” jika diminta.)'
    : '✅ Unduhan dimulai. Kirim / buka file RizqTrack.apk di HP Android untuk memasangnya.';
}

// Langsung mengunduh saat diketuk (tanpa menunggu pengecekan apa pun).
function downloadApk() {
  const a = document.createElement('a');
  a.href = APK_URL;
  a.download = 'RizqTrack.apk';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('⬇️ Mengunduh RizqTrack.apk…', 'success');
  apkStartedStatus();
  // Verifikasi di belakang layar. Kalau ternyata filenya memang tidak ada di server, beri tahu.
  if (apkState !== 'yes') {
    checkApkAvailable().then(() => {
      if (apkState === 'no') {
        showToast('❌ File RizqTrack.apk tidak ditemukan di server ini', 'error');
        showInstallHelp();
      } else {
        apkStartedStatus();
      }
    });
  }
}

// Tombol utama: selalu langsung unduh APK (kecuali server pasti tidak punya filenya)
function installApp() {
  if (apkMode()) { downloadApk(); return; }
  installViaBrowser();                            // tidak ada APK → pasang lewat browser / petunjuk
}

// Tombol kedua: selalu cara browser (PWA)
function installAlt() { installViaBrowser(); }

async function installViaBrowser() {
  // Browser tidak mengirim izin pasang otomatis → tampilkan langkah manual
  if (!deferredInstallPrompt) { showInstallHelp(); return; }
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;               // event hanya boleh dipakai sekali
  try {
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice && choice.outcome === 'accepted') showToast('📲 Memasang RizqTrack…', 'success');
    else showToast('Pemasangan dibatalkan. Kamu bisa mencobanya lagi kapan saja.', 'warning');
  } catch (e) {
    showInstallHelp();
  }
  updateInstallUI();
}


/* ===================== SETTINGS ===================== */
function savePin() {
  const pin = document.getElementById('inputPin').value;
  const confirm = document.getElementById('inputPinConfirm').value;
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) { showToast('PIN harus 4 digit angka', 'error'); return; }
  if (pin !== confirm) { showToast('Konfirmasi PIN tidak cocok', 'error'); return; }
  settings.pin = pin;
  saveData();
  document.getElementById('inputPin').value = '';
  document.getElementById('inputPinConfirm').value = '';
  showToast('🔐 PIN berhasil disimpan!', 'success');
}

function removePin() {
  openConfirm('Hapus PIN?', 'Proteksi PIN akan dinonaktifkan.', () => {
    settings.pin = '';
    saveData();
    showToast('PIN dihapus', 'success');
  });
}

/* ===================== EXPORT ===================== */
function exportCSV() {
  if (expenses.length === 0) { showToast('Tidak ada data untuk diekspor', 'warning'); return; }
  const header = ['Nama','Kategori','Nominal','Tanggal','Catatan'];
  const rows = expenses.map(e => [
    `"${e.name}"`, `"${e.category}"`, e.amount, e.date, `"${e.note || ''}"`
  ]);
  const csv = [header, ...rows].map(r => r.join(',')).join('\n');
  downloadFile('RizqTrack_Export.csv', 'text/csv', csv);
  showToast('📄 CSV berhasil diunduh!', 'success');
}

function exportExcel() {
  if (isAndroidWebView()) { showToast('📱 Export Excel tidak didukung di aplikasi Android. Pakai Export CSV (disalin) atau buka lewat Chrome.', 'warning'); return; }
  if (typeof XLSX === 'undefined') { showToast('📡 Export Excel butuh internet sekali untuk dimuat. Pakai Export CSV atau sambungkan internet.', 'warning'); return; }
  if (expenses.length === 0 && incomes.length === 0) { showToast('Tidak ada data untuk diekspor', 'warning'); return; }
  const ws_data = [
    ['Nama', 'Kategori', 'Nominal', 'Tanggal', 'Catatan'],
    ...expenses.map(e => [e.name, e.category, e.amount, e.date, e.note || ''])
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, 'Pengeluaran');
  if (incomes.length) {
    const wsIn = XLSX.utils.aoa_to_sheet([
      ['Nama', 'Kategori', 'Nominal', 'Tanggal', 'Catatan'],
      ...incomes.map(x => [x.name, x.category, x.amount, x.date, x.note || ''])
    ]);
    XLSX.utils.book_append_sheet(wb, wsIn, 'Pemasukan');
  }
  XLSX.writeFile(wb, 'RizqTrack_Export.xlsx');
  showToast('📊 Excel berhasil diunduh!', 'success');
}

/* ===================== BACKUP & RESTORE ===================== */
// Deteksi aplikasi Android (WebView, mis. APK dari WebIntoApp). Di WebView, unduh file "blob:" tidak berfungsi,
// jadi backup/restore juga disediakan lewat KODE teks yang bisa disalin & ditempel.
function isAndroidWebView() {
  const ua = navigator.userAgent || '';
  return /; wv\)/.test(ua) || (/Android/.test(ua) && /Version\/\d/.test(ua) && /Chrome\//.test(ua));
}

function buildBackupData() {
  return {
    app: 'RizqTrack',
    version: 3,
    exportedAt: new Date().toISOString(),
    expenses,
    incomes,
    recurring,
    savingTargets, // wishlist
    settings
  };
}

function markBackupDone() {
  localStorage.setItem('dt_last_backup', new Date().toISOString());
  updateBackupInfo();
}

function backupJSON() {
  // Di aplikasi Android unduh file tidak didukung → langsung pakai Kode Backup
  if (isAndroidWebView()) {
    showToast('📱 Di aplikasi Android, backup dilakukan lewat kode (salin lalu simpan)', 'warning');
    openBackupCode();
    return;
  }
  const stamp = toDateStr(new Date());
  downloadFile(`RizqTrack_Backup_${stamp}.json`, 'application/json', JSON.stringify(buildBackupData(), null, 2));
  markBackupDone();
  showToast('💾 Backup berhasil diunduh!', 'success');
}

/* --- Kode backup: JSON → (gzip) → base64 --- */
function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function encodeBackupCode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = bytes, prefix = 'DT1:';
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
      out = new Uint8Array(await new Response(stream).arrayBuffer());
      prefix = 'DT2:';
    } catch (e) { out = bytes; prefix = 'DT1:'; }
  }
  return prefix + bytesToB64(out) + '.'; // titik di akhir = penanda selesai
}

// Menerima: kode DT1/DT2 (boleh ada teks lain di sekitarnya, mis. dari WhatsApp) atau isi file JSON mentah
async function decodeBackupCode(text) {
  text = (text || '').trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const m = text.match(/DT([12]):([A-Za-z0-9+\/=\s]+)/);
  if (!m) throw new Error('format');
  let bytes = b64ToBytes(m[2].replace(/\s+/g, ''));
  if (m[1] === '2') {
    if (typeof DecompressionStream === 'undefined') throw new Error('nogzip');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* --- Modal kode (dipakai backup kode, restore kode, dan salin teks) --- */
function showCodeModal({ title, desc, text = '', readOnly = false, placeholder = '', meta = '', buttons = [] }) {
  setText('codeModalTitle', title);
  document.getElementById('codeModalDesc').innerHTML = desc;
  setText('codeMeta', meta);
  const ta = document.getElementById('codeText');
  ta.value = text;
  ta.readOnly = readOnly;
  ta.placeholder = placeholder;
  const box = document.getElementById('codeActions');
  box.innerHTML = '';
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = b.cls || 'btn-secondary';
    el.textContent = b.label;
    el.addEventListener('click', b.fn);
    box.appendChild(el);
  });
  showEl('codeModal');
  if (readOnly) { ta.focus(); ta.select(); }
}

function closeCodeModal() { hideEl('codeModal'); document.getElementById('codeText').value = ''; }

async function copyCodeText(successMsg) {
  const ta = document.getElementById('codeText');
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(ta.value); ok = true; } } catch (e) {}
  if (!ok) { try { ok = document.execCommand('copy'); } catch (e) {} }
  if (ok) showToast(successMsg || '✅ Tersalin!', 'success');
  else showToast('Tekan lama di kolom → Pilih semua → Salin', 'warning');
  return ok;
}

async function openBackupCode() {
  let code;
  try { code = await encodeBackupCode(buildBackupData()); }
  catch (e) { showToast('❌ Gagal membuat kode backup', 'error'); return; }
  const buttons = [{ label: 'Tutup', cls: 'btn-secondary', fn: closeCodeModal }];
  if (navigator.share) {
    buttons.push({
      label: '📤 Bagikan', cls: 'btn-outline',
      fn: async () => {
        try { await navigator.share({ title: 'Backup RizqTrack', text: code }); markBackupDone(); }
        catch (e) { if (e && e.name !== 'AbortError') showToast('Gagal membagikan, coba Salin Kode', 'error'); }
      }
    });
  }
  buttons.push({
    label: '📋 Salin Kode', cls: 'btn-primary',
    fn: async () => { if (await copyCodeText('✅ Kode backup tersalin! Simpan di WhatsApp / Catatan.')) markBackupDone(); }
  });
  showCodeModal({
    title: '📋 Kode Backup',
    desc: 'Tekan <b>Salin Kode</b>, lalu simpan di tempat aman: <b>WhatsApp</b> (chat ke nomor sendiri), <b>Telegram Saved Messages</b>, <b>Google Keep / Catatan</b>, atau email. Untuk restore, tempel kembali kode ini lewat <b>Restore Kode</b>.',
    text: code, readOnly: true,
    meta: `${code.length.toLocaleString('id-ID')} karakter · ${expenses.length} pengeluaran, ${incomes.length} pemasukan, ${savingTargets.length} wishlist`,
    buttons
  });
}

function openRestoreCode() {
  showCodeModal({
    title: '📝 Restore dari Kode',
    desc: 'Tempel kode backup di kolom bawah (tekan lama di kolom → <b>Tempel</b>), lalu tekan <b>Restore</b>.',
    placeholder: 'DT2:....',
    buttons: [
      { label: 'Batal', cls: 'btn-secondary', fn: closeCodeModal },
      {
        label: '📋 Tempel', cls: 'btn-outline',
        fn: async () => {
          try { document.getElementById('codeText').value = await navigator.clipboard.readText(); }
          catch (e) { showToast('Tekan lama di kolom lalu pilih Tempel', 'warning'); }
        }
      },
      {
        label: '📥 Restore', cls: 'btn-primary',
        fn: async () => {
          const t = document.getElementById('codeText').value.trim();
          if (!t) { showToast('Tempel kode backup dulu', 'warning'); return; }
          await restoreFromText(t, closeCodeModal);
        }
      }
    ]
  });
}

/* --- Restore --- */
function restoreJSON(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => restoreFromText(e.target.result);
  reader.onerror = () => showToast('❌ Gagal membaca file', 'error');
  reader.readAsText(file);
}

async function restoreFromText(text, onApplied) {
  let data;
  try {
    data = await decodeBackupCode(text);
    if (!data || !Array.isArray(data.expenses)) throw new Error('format');
  } catch (e) {
    showToast(e && e.message === 'nogzip'
      ? '❌ Browser ini tidak bisa membuka kode terkompresi. Buka dengan Chrome terbaru.'
      : '❌ Kode / file backup tidak valid. Pastikan seluruh kode tersalin utuh.', 'error');
    return false;
  }

  // Bersihkan data agar aman kalau backup diedit manual / dari versi lama
  const newExpenses = data.expenses
    .filter(x => x && x.name && Number(x.amount) > 0 && x.date)
    .map(x => ({
      ...x,
      id: String(x.id || Date.now() + Math.random().toString(36).slice(2, 6)),
      amount: Number(x.amount),
      createdAt: x.createdAt || new Date(x.date).toISOString()
    }));
  const newWishlist = (Array.isArray(data.savingTargets) ? data.savingTargets : []).map(normalizeWishlist);
  const newIncomes = (Array.isArray(data.incomes) ? data.incomes : [])
    .filter(x => x && x.name && Number(x.amount) > 0 && x.date).map(normalizeIncome);
  const newRecurring = (Array.isArray(data.recurring) ? data.recurring : []).map(normalizeRecurring);
  const tgl = data.exportedAt ? new Date(data.exportedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : 'tidak diketahui';

  openConfirm(
    'Restore Data?',
    `Backup tanggal ${tgl}: ${newExpenses.length} pengeluaran, ${newIncomes.length} pemasukan, ${newWishlist.length} wishlist, ${newRecurring.length} jadwal berulang. Data saat ini akan ditimpa (kamu masih bisa membatalkan restore ini).`,
    () => {
      // simpan snapshot data sekarang supaya restore bisa dibatalkan
      localStorage.setItem('dt_pre_restore', JSON.stringify({ expenses, incomes, recurring, savingTargets, settings, at: new Date().toISOString() }));

      expenses = newExpenses;
      incomes = newIncomes;
      recurring = newRecurring;
      savingTargets = newWishlist;
      if (data.settings && typeof data.settings === 'object') {
        settings = { saldoAwal: 0, saldoSekarang: 0, pin: '', theme: 'dark', ...data.settings };
      }
      saveData();
      applyTheme();
      updateDarkModeToggle();
      refreshAll();
      updateBackupInfo();
      if (onApplied) onApplied();
      showToast('📥 Data berhasil di-restore!', 'success');
    }
  );
  return true;
}

function undoRestore() {
  const raw = localStorage.getItem('dt_pre_restore');
  if (!raw) return;
  openConfirm('Batalkan Restore?', 'Data akan dikembalikan ke kondisi sebelum restore terakhir.', () => {
    try {
      const snap = JSON.parse(raw);
      expenses = snap.expenses || [];
      incomes = (snap.incomes || []).map(normalizeIncome);
      recurring = (snap.recurring || []).map(normalizeRecurring);
      savingTargets = (snap.savingTargets || []).map(normalizeWishlist);
      settings = { saldoAwal: 0, saldoSekarang: 0, pin: '', theme: 'dark', ...(snap.settings || {}) };
      localStorage.removeItem('dt_pre_restore');
      saveData();
      applyTheme();
      updateDarkModeToggle();
      refreshAll();
      updateBackupInfo();
      showToast('↩️ Restore dibatalkan, data dikembalikan', 'success');
    } catch {
      showToast('❌ Gagal mengembalikan data', 'error');
    }
  });
}

function updateBackupInfo() {
  const hint = document.getElementById('webviewHint');
  if (hint) hint.classList.toggle('hidden', !isAndroidWebView());
  const el = document.getElementById('lastBackupInfo');
  if (el) {
    const last = localStorage.getItem('dt_last_backup');
    el.textContent = last
      ? `Backup terakhir: ${new Date(last).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'Belum pernah backup';
  }
  const undoBtn = document.getElementById('undoRestoreBtn');
  if (undoBtn) undoBtn.classList.toggle('hidden', !localStorage.getItem('dt_pre_restore'));
}

// Ingatkan backup kalau sudah lebih dari 7 hari (hanya jika ada data)
function checkBackupReminder() {
  if (!expenses.length && !savingTargets.length && !incomes.length) return;
  if (!document.getElementById('lockScreen').classList.contains('hidden')) return;
  const last = localStorage.getItem('dt_last_backup');
  const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  if (days > 7) {
    showToast(last ? '💾 Sudah lebih dari 7 hari belum backup. Yuk backup di Pengaturan!' : '💾 Data belum pernah di-backup. Yuk backup di Pengaturan!', 'warning');
  }
}

function resetMonthly() {
  const now = new Date();
  openConfirm('Reset Bulan Ini?', `Semua data ${now.toLocaleString('id-ID',{month:'long',year:'numeric'})} akan dihapus.`, () => {
    const mo = now.getMonth(), yr = now.getFullYear();
    expenses = expenses.filter(e => {
      const d = new Date(e.date);
      return !(d.getMonth() === mo && d.getFullYear() === yr);
    });
    incomes = incomes.filter(x => {
      const d = new Date(x.date);
      return !(d.getMonth() === mo && d.getFullYear() === yr);
    });
    saveData();
    refreshAll();
    showToast('🔄 Data bulan ini direset!', 'success');
  });
}

function resetAll() {
  openConfirm('Hapus Semua Data?', '⚠️ Semua pengeluaran, pemasukan, wishlist, dan jadwal berulang akan dihapus PERMANEN!', () => {
    expenses = [];
    incomes = [];
    recurring = [];
    savingTargets = [];
    settings.saldoSekarang = 0;
    settings.saldoAwal = 0;
    saveData();
    refreshAll();
    showToast('🗑️ Semua data dihapus', 'success');
  });
}

/* ===================== CONFIRM MODAL ===================== */
function openConfirm(title, msg, cb) {
  setText('confirmTitle', title);
  setText('confirmMsg', msg);
  confirmCallback = cb;
  showEl('confirmModal');
  document.getElementById('confirmOkBtn').onclick = () => {
    hideEl('confirmModal');
    const fn = confirmCallback;
    confirmCallback = null;
    if (fn) fn();
  };
}

function closeConfirm() { hideEl('confirmModal'); confirmCallback = null; }

/* ===================== TOAST ===================== */
let toastTimeout = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(12px)';
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2800);
}

/* ===================== HELPERS ===================== */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getMonday(d) {
  const day = new Date(d);
  const diff = day.getDate() - day.getDay() + (day.getDay() === 0 ? -6 : 1);
  day.setDate(diff);
  day.setHours(0,0,0,0);
  return day;
}

function sumExpenses(arr) { return arr.reduce((a,b) => a + (b.amount || 0), 0); }

function formatRp(n) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatRpShort(n) {
  if (n >= 1000000) return 'Rp ' + (n/1000000).toFixed(1) + 'jt';
  if (n >= 1000) return 'Rp ' + (n/1000).toFixed(0) + 'rb';
  return 'Rp ' + n;
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day:'numeric', month:'short' });
}

function getCatIcon(cat) {
  const icons = { Makan:'🍽️', Bensin:'⛽', Kopi:'☕', Jajan:'🍿', Transportasi:'🚗', Tagihan:'📱', Belanja:'🛒', Rokok:'🚬', Skincare:'🧴', Pakaian:'👕', Lainnya:'📦', Wishlist:'🎁' };
  return icons[cat] || '💸';
}

function getCatLabel(cat) { return cat || 'Lainnya'; }

function showEl(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (el) el.classList.remove('hidden');
}

function hideEl(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (el) el.classList.add('hidden');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function downloadFile(filename, type, content) {
  if (isAndroidWebView()) {
    // WebView tidak bisa mengunduh file blob → tampilkan isinya supaya bisa disalin
    showCodeModal({
      title: '📄 ' + filename,
      desc: 'Unduh file tidak didukung di aplikasi Android. Tekan <b>Salin</b> lalu tempel ke Catatan / WhatsApp / Google Sheets.',
      text: content, readOnly: true,
      meta: `${content.length.toLocaleString('id-ID')} karakter`,
      buttons: [
        { label: 'Tutup', cls: 'btn-secondary', fn: closeCodeModal },
        { label: '📋 Salin', cls: 'btn-primary', fn: () => copyCodeText('✅ Tersalin!') }
      ]
    });
    return;
  }
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
