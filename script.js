/* =======================
   Evlilik Listesi – Firebase Auth + Firestore
   - Email/Şifre + Google oturum
   - users/{uid}/rooms/{roomId}/items/{itemId}
   - Gerçek zamanlı dinleme, filtre/toplamlar
   - XLSX (SheetJS) + PDF (pdfmake, Unicode) dışa aktar
   - Ödeme: Peşin / Taksitli (adet + taksitli toplam)
======================= */

// ---- Firebase SDK (modüler CDN) ----
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { 
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { 
  getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc, updateDoc, 
  onSnapshot, query, orderBy, serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

// ---- Config (ayrı dosyadan) ----
import { firebaseConfig } from './firebase-config.js';

// ---- Init ----
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Para formatlayıcı
const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

// UI refs
const $authSection = document.getElementById('authSection');
const $appShell = document.getElementById('appShell');
const $userBox = document.getElementById('userBox');
const $userEmail = document.getElementById('userEmail');
const $roomsContainer = document.getElementById('roomsContainer');
const $roomTemplate = document.getElementById('roomTemplate');
const $itemTemplate = document.getElementById('itemTemplate');
const $roomFilter = document.getElementById('roomFilter');
const $categoryFilter = document.getElementById('categoryFilter');
const $statusFilter = document.getElementById('statusFilter');
const $searchInput = document.getElementById('searchInput');

// Auth form refs
const $authEmail = document.getElementById('authEmail');
const $authPassword = document.getElementById('authPassword');
const $signInBtn = document.getElementById('signInBtn');
const $googleBtn = document.getElementById('googleBtn');
const $toRegister = document.getElementById('toRegister');
const $toReset = document.getElementById('toReset');
const $registerCard = document.getElementById('registerCard');
const $resetCard = document.getElementById('resetCard');
const $regEmail = document.getElementById('regEmail');
const $regPassword = document.getElementById('regPassword');
const $registerBtn = document.getElementById('registerBtn');
const $backToLogin1 = document.getElementById('backToLogin1');
const $backToLogin2 = document.getElementById('backToLogin2');
const $signOutBtn = document.getElementById('signOutBtn');

// Signed-in controls
const $exportXlsxBtn = document.getElementById('exportXlsxBtn');
const $exportPdfBtn = document.getElementById('exportPdfBtn');

// Bellek içi durum
const state = {
  uid: null,
  rooms: {}, // {roomId: {name, items:[]}}
  unsubRooms: null,
  unsubItems: {},
};

// ---- Auth ekranı geçişleri ----
function showLogin() {
  $authSection.classList.remove('hidden');
  $appShell.classList.add('hidden');
  $userBox.classList.add('hidden');
}
function showApp(user) {
  $userEmail.textContent = user.email || '(Google hesabı)';
  $userBox.classList.remove('hidden');
  $authSection.classList.add('hidden');
  $appShell.classList.remove('hidden');
}

$toRegister.addEventListener('click', () => {
  $registerCard.classList.remove('hidden');
  $resetCard.classList.add('hidden');
});
$toReset.addEventListener('click', () => {
  $resetCard.classList.remove('hidden');
  $registerCard.classList.add('hidden');
});
$backToLogin1.addEventListener('click', () => {
  $registerCard.classList.add('hidden');
});
$backToLogin2.addEventListener('click', () => {
  $resetCard.classList.add('hidden');
});

// ---- Auth işlemleri ----
$signInBtn.addEventListener('click', async () => {
  try {
    await signInWithEmailAndPassword(auth, $authEmail.value.trim(), $authPassword.value);
  } catch (e) {
    alert('Giriş başarısız: ' + (e.message || e));
  }
});

$googleBtn.addEventListener('click', async () => {
  try {
    const prov = new GoogleAuthProvider();
    await signInWithPopup(auth, prov);
  } catch (e) {
    alert('Google ile giriş başarısız: ' + (e.message || e));
  }
});

$registerBtn.addEventListener('click', async () => {
  try {
    await createUserWithEmailAndPassword(auth, $regEmail.value.trim(), $regPassword.value);
    $registerCard.classList.add('hidden');
  } catch (e) {
    alert('Kayıt başarısız: ' + (e.message || e));
  }
});

document.getElementById('resetBtn')?.addEventListener?.('click', async () => {
  const email = document.getElementById('resetEmail').value.trim();
  if (!email) return alert('E-posta girin');
  try { await sendPasswordResetEmail(auth, email); alert('Sıfırlama e-postası gönderildi'); }
  catch (e) { alert('Sıfırlama başarısız: ' + (e.message || e)); }
});

$signOutBtn.addEventListener('click', () => signOut(auth));

// ---- Auth durumu ----
onAuthStateChanged(auth, (user) => {
  cleanupSubscriptions();
  if (!user) {
    state.uid = null; state.rooms = {}; $roomsContainer.innerHTML = '';
    showLogin();
    return;
  }
  state.uid = user.uid;
  showApp(user);
  initRealtime(user.uid);
});

function cleanupSubscriptions() {
  if (state.unsubRooms) { state.unsubRooms(); state.unsubRooms = null; }
  Object.values(state.unsubItems).forEach(fn => fn && fn());
  state.unsubItems = {};
}

// ---- Realtime Firestore ----
function initRealtime(uid) {
  // Kullanıcı doc'u yoksa oluştur (idempotent)
  setDoc(doc(db, 'users', uid), { createdAt: serverTimestamp() }, { merge: true });

  const roomsCol = collection(db, 'users', uid, 'rooms');
  const qRooms = query(roomsCol, orderBy('createdAt', 'asc'));
  state.unsubRooms = onSnapshot(qRooms, (snap) => {
    snap.docChanges().forEach((ch) => {
      const id = ch.doc.id;
      if (ch.type === 'added') {
        state.rooms[id] = { name: ch.doc.data().name, items: [] };
        mountRoom(id, ch.doc.data().name);
        subscribeItems(uid, id);
      } else if (ch.type === 'modified') {
        const el = document.getElementById(id); if (el) el.querySelector('.room-title').textContent = ch.doc.data().name;
        state.rooms[id].name = ch.doc.data().name;
      } else if (ch.type === 'removed') {
        if (state.unsubItems[id]) { state.unsubItems[id](); delete state.unsubItems[id]; }
        delete state.rooms[id];
        document.getElementById(id)?.remove();
      }
    });
    updateRoomFilter();
    updateTotals();
  });
}

function subscribeItems(uid, roomId) {
  const qItems = query(collection(db, 'users', uid, 'rooms', roomId, 'items'), orderBy('createdAt', 'asc'));
  state.unsubItems[roomId] = onSnapshot(qItems, (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    state.rooms[roomId].items = list;
    renderRoomItems(roomId);
    updateTotals();
    updateCategoryFilterOptions();
    applyFilters();
  });
}

// ---- DOM kurulum ----
function mountRoom(roomId, roomName) {
  const node = $roomTemplate.content.cloneNode(true);
  const root = node.querySelector('.room-card');
  root.id = roomId;
  root.querySelector('.room-title').textContent = roomName;

  // Ödeme tipi alanlarını göster/gizle
  root.addEventListener('change', (e) => {
    if (e.target.classList.contains('item-payment')) {
      const isInst = e.target.value === 'Taksitli';
      root.querySelector('.item-installments').classList.toggle('hidden', !isInst);
      root.querySelector('.item-installment-total').classList.toggle('hidden', !isInst);
    }
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'add-item') await addItem(roomId, root);
    if (act === 'clear-inputs') { 
      root.querySelector('.item-name').value=''; 
      root.querySelector('.item-price').value=''; 
      root.querySelector('.item-category').selectedIndex=0; 
      root.querySelector('.item-payment').value='Peşin';
      root.querySelector('.item-installments').value='';
      root.querySelector('.item-installment-total').value='';
      root.querySelector('.item-installments').classList.add('hidden');
      root.querySelector('.item-installment-total').classList.add('hidden');
    }
    if (act === 'delete-room') await deleteRoom(roomId);
  });

  root.addEventListener('change', async (e) => {
    if (e.target.classList.contains('chk-purchased')) {
      const li = e.target.closest('li');
      await togglePurchased(roomId, li.dataset.id, e.target.checked);
    }
  });
  root.addEventListener('click', async (e) => {
    const actBtn = e.target.closest('[data-act]'); if (!actBtn) return;
    const act = actBtn.getAttribute('data-act');
    if (act === 'edit-item') { const li = actBtn.closest('li'); await editItem(roomId, li.dataset.id); }
    if (act === 'delete-item') { const li = actBtn.closest('li'); await deleteItem(roomId, li.dataset.id); }
  });

  $roomsContainer.appendChild(node);
}

function effectivePrice(it) {
  if (it.paymentType === 'Taksitli') {
    const tot = Number(it.installmentTotal) || 0;
    return tot;
  }
  return Number(it.price) || 0;
}

function renderRoomItems(roomId) {
  const room = state.rooms[roomId];
  const root = document.getElementById(roomId);
  const list = root.querySelector('[data-role="item-list"]');
  list.innerHTML = '';
  room.items.forEach(item => {
    const node = $itemTemplate.content.cloneNode(true);
    const li = node.querySelector('li');
    li.dataset.id = item.id; li.classList.toggle('purchased', !!item.purchased);
    node.querySelector('.item-name-text').textContent = item.name;
    node.querySelector('.item-category-text').textContent = item.category || 'Genel';
    const eff = effectivePrice(item);
    node.querySelector('.item-price-text').textContent = tl.format(eff);

    // ödeme rozetleri ve detay
    const payBadge = node.querySelector('.payment-badge');
    const instDetail = node.querySelector('.installment-detail');
    if (item.paymentType === 'Taksitli') {
      const n = Number(item.installments)||0;
      const tot = Number(item.installmentTotal)||0;
      const per = n>0 ? (tot/n) : 0;
      payBadge.textContent = 'Taksitli';
      instDetail.textContent = `${n} x ${tl.format(per)} (Toplam: ${tl.format(tot)})`;
    } else {
      payBadge.textContent = 'Peşin';
      instDetail.textContent = '';
    }

    node.querySelector('.chk-purchased').checked = !!item.purchased;
    list.appendChild(node);
  });
  const total = room.items.reduce((s, it) => s + effectivePrice(it), 0);
  root.querySelector('.room-total').textContent = tl.format(total);
}

// ---- CRUD ----
async function addRoom(name) {
  if (!name) return alert('Oda adı girin.');
  await addDoc(collection(db, 'users', state.uid, 'rooms'), { name, createdAt: serverTimestamp() });
}

async function deleteRoom(roomId) {
  if (!confirm('Odayı silmek istediğinize emin misiniz?')) return;
  const itemsSnap = await getDocs(collection(db, 'users', state.uid, 'rooms', roomId, 'items'));
  for (const d of itemsSnap.docs) await deleteDoc(doc(db, 'users', state.uid, 'rooms', roomId, 'items', d.id));
  await deleteDoc(doc(db, 'users', state.uid, 'rooms', roomId));
}

async function addItem(roomId, root) {
  const name = root.querySelector('.item-name').value.trim();
  const price = Number(root.querySelector('.item-price').value || 0);
  const category = root.querySelector('.item-category').value || 'Genel';
  const paymentType = root.querySelector('.item-payment').value;
  const installments = Number(root.querySelector('.item-installments').value || 0);
  const installmentTotal = Number(root.querySelector('.item-installment-total').value || 0);

  if (!name) return alert('Ürün adı girin.');
  if (paymentType === 'Taksitli' && (installments < 2 || installmentTotal <= 0)) {
    return alert('Taksitli için: taksit sayısı (>=2) ve taksitli toplam (>0) girin.');
  }

  await addDoc(collection(db, 'users', state.uid, 'rooms', roomId, 'items'), { 
    name, price, category, purchased:false, createdAt: serverTimestamp(),
    paymentType, installments: paymentType==='Taksitli' ? installments : 0,
    installmentTotal: paymentType==='Taksitli' ? installmentTotal : 0
  });
  // clear
  root.querySelector('.item-name').value=''; 
  root.querySelector('.item-price').value=''; 
  root.querySelector('.item-category').selectedIndex=0; 
  root.querySelector('.item-payment').value='Peşin';
  root.querySelector('.item-installments').value=''; 
  root.querySelector('.item-installment-total').value='';
  root.querySelector('.item-installments').classList.add('hidden');
  root.querySelector('.item-installment-total').classList.add('hidden');
}

async function deleteItem(roomId, itemId) {
  await deleteDoc(doc(db, 'users', state.uid, 'rooms', roomId, 'items', itemId));
}

async function editItem(roomId, itemId) {
  const it = state.rooms[roomId].items.find(i => i.id === itemId); if (!it) return;
  const newName = prompt('Ürün adı:', it.name); if (newName === null) return;
  const newPriceStr = prompt('Peşin Fiyat (örn 1999.90):', String(it.price??0)); if (newPriceStr === null) return;
  const newCategory = prompt('Kategori:', it.category||'Genel'); if (newCategory === null) return;
  const pay = prompt('Ödeme tipi (Peşin/Taksitli):', it.paymentType||'Peşin'); if (pay === null) return;
  let inst = it.installments||0, instTot = it.installmentTotal||0;
  if (pay === 'Taksitli') {
    const iStr = prompt('Taksit sayısı:', String(inst||6)); if (iStr===null) return;
    const tStr = prompt('Taksitli toplam:', String(instTot||0)); if (tStr===null) return;
    inst = Number(iStr); instTot = Number(tStr);
  } else {
    inst = 0; instTot = 0;
  }
  const val = Number(newPriceStr);
  await updateDoc(doc(db, 'users', state.uid, 'rooms', roomId, 'items', itemId), {
    name: newName.trim() || it.name,
    price: !Number.isNaN(val) ? val : (it.price||0),
    category: newCategory.trim() || it.category,
    paymentType: (pay==='Taksitli'?'Taksitli':'Peşin'),
    installments: inst,
    installmentTotal: instTot
  });
}

async function togglePurchased(roomId, itemId, checked) {
  await updateDoc(doc(db, 'users', state.uid, 'rooms', roomId, 'items', itemId), { purchased: !!checked });
}

// ---- Toplamlar & Filtreler ----
function updateTotals() {
  const allItems = Object.values(state.rooms).flatMap(r => r.items);
  const grandTotal = allItems.reduce((s, it) => s + effectivePrice(it), 0);
  document.getElementById('grandTotal').textContent = tl.format(grandTotal);
  document.getElementById('grandCount').textContent = String(allItems.length);
  updatePurchasedStats();
  updateFilteredTotals();
}

function updatePurchasedStats() {
  const allItems = Object.values(state.rooms).flatMap(r => r.items);
  const purchased = allItems.filter(i => i.purchased).length;
  document.getElementById('purchasedStats').textContent = `${purchased} / ${allItems.length}`;
}

function updateRoomFilter() {
  const sel = $roomFilter; const current = sel.value;
  sel.innerHTML = '<option value="">Tüm Odalar</option>';
  Object.entries(state.rooms).forEach(([id, r]) => {
    const opt = document.createElement('option'); opt.value = id; opt.textContent = r.name; sel.appendChild(opt);
  });
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function updateCategoryFilterOptions() {
  const allCats = new Set();
  Object.values(state.rooms).forEach(r => r.items.forEach(i => allCats.add(i.category||'Genel')));
  const current = $categoryFilter.value;
  $categoryFilter.innerHTML = '<option value="">Tüm Kategoriler</option>';
  [...allCats].sort().forEach(cat => {
    const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; $categoryFilter.appendChild(opt);
  });
  if ([...$categoryFilter.options].some(o => o.value === current)) $categoryFilter.value = current;
}

function applyFilters() {
  const roomSel = $roomFilter.value.trim();
  const catSel = $categoryFilter.value.trim();
  const statSel = $statusFilter.value.trim();
  const q = $searchInput.value.trim().toLowerCase();

  Object.entries(state.rooms).forEach(([id, room]) => {
    const root = document.getElementById(id); if (!root) return;
    const list = root.querySelector('[data-role="item-list"]'); list.innerHTML = '';
    const showRoom = !roomSel || roomSel === id; root.style.display = showRoom ? '' : 'none'; if (!showRoom) return;

    const filtered = room.items.filter(it => {
      if (catSel && (it.category||'') !== catSel) return false;
      if (statSel === 'purchased' && !it.purchased) return false;
      if (statSel === 'not' && it.purchased) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false; return true;
    });

    filtered.forEach(item => {
      const node = $itemTemplate.content.cloneNode(true);
      const li = node.querySelector('li'); li.dataset.id = item.id; li.classList.toggle('purchased', !!item.purchased);
      node.querySelector('.item-name-text').textContent = item.name;
      node.querySelector('.item-category-text').textContent = item.category||'Genel';
      const eff = effectivePrice(item);
      node.querySelector('.item-price-text').textContent = tl.format(eff);
      const payBadge = node.querySelector('.payment-badge');
      const instDetail = node.querySelector('.installment-detail');
      if (item.paymentType === 'Taksitli') {
        const n = Number(item.installments)||0;
        const tot = Number(item.installmentTotal)||0;
        const per = n>0 ? (tot/n) : 0;
        payBadge.textContent = 'Taksitli';
        instDetail.textContent = `${n} x ${tl.format(per)} (Toplam: ${tl.format(tot)})`;
      } else {
        payBadge.textContent = 'Peşin';
        instDetail.textContent = '';
      }
      node.querySelector('.chk-purchased').checked = !!item.purchased;
      list.appendChild(node);
    });

    const total = room.items.reduce((s, it) => s + effectivePrice(it), 0);
    root.querySelector('.room-total').textContent = tl.format(total);
  });

  updateFilteredTotals();
}

function updateFilteredTotals() {
  const roomSel = $roomFilter.value.trim();
  const catSel = $categoryFilter.value.trim();
  const statSel = $statusFilter.value.trim();
  const q = $searchInput.value.trim().toLowerCase();

  let total = 0, count = 0;
  Object.entries(state.rooms).forEach(([id, room]) => {
    if (roomSel && roomSel !== id) return;
    room.items.forEach(it => {
      if (catSel && (it.category||'') !== catSel) return;
      if (statSel === 'purchased' && !it.purchased) return;
      if (statSel === 'not' && it.purchased) return;
      if (q && !it.name.toLowerCase().includes(q)) return;
      total += effectivePrice(it); count += 1;
    });
  });
  const hasFilter = !!(roomSel || catSel || statSel || q);
  const box = document.getElementById('filterSummary');
  box.classList.toggle('hidden', !hasFilter);
  document.getElementById('filteredTotalTL').textContent = tl.format(total);
  document.getElementById('filteredCount').textContent = `${count} ürün`;
}

// ---- Dışa aktar: Excel (XLSX) ve PDF (pdfmake) ----
$exportXlsxBtn.addEventListener('click', () => {
  try { exportToXLSX(); } catch (e) { alert('XLSX dışa aktarım hatası: ' + (e.message||e)); }
});
$exportPdfBtn.addEventListener('click', () => {
  try { exportToPDF(); } catch (e) { alert('PDF dışa aktarım hatası: ' + (e.message||e)); }
});

function exportToXLSX() {
  if (!window.XLSX) throw new Error('XLSX kütüphanesi yüklenemedi');
  const wb = XLSX.utils.book_new();
  // Summary sheet
  const allItems = Object.entries(state.rooms).flatMap(([rid, r]) => r.items.map(it => ({
    'Oda': state.rooms[rid].name,
    'Ürün': it.name,
    'Kategori': it.category||'Genel',
    'Ödeme': it.paymentType||'Peşin',
    'Taksit Sayısı': Number(it.installments)||0,
    'Taksitli Toplam (TRY)': Number(it.installmentTotal)||0,
    'Peşin Fiyat (TRY)': Number(it.price)||0,
    'Toplam (Efektif)': effectivePrice(it)
  })));
  const sumSheet = XLSX.utils.json_to_sheet(allItems);
  XLSX.utils.book_append_sheet(wb, sumSheet, 'Özet');
  // Per-room sheets
  Object.entries(state.rooms).forEach(([rid, r]) => {
    const rows = r.items.map(it => ({
      'Ürün': it.name,
      'Kategori': it.category||'Genel',
      'Ödeme': it.paymentType||'Peşin',
      'Taksit Sayısı': Number(it.installments)||0,
      'Taksitli Toplam (TRY)': Number(it.installmentTotal)||0,
      'Peşin Fiyat (TRY)': Number(it.price)||0,
      'Toplam (Efektif)': effectivePrice(it)
    }));
    const sh = XLSX.utils.json_to_sheet(rows.length ? rows : [{Bilgi:'Bu odada ürün yok'}]);
    XLSX.utils.book_append_sheet(wb, sh, r.name.substring(0,31));
  });
  XLSX.writeFile(wb, 'evlilik-listesi.xlsx');
}

function exportToPDF() {
  if (typeof pdfMake === 'undefined' || !pdfMake.createPdf) {
    throw new Error('pdfmake kütüphanesi yüklenemedi');
  }

  const roomsArray = Object.entries(state.rooms).map(([rid, r]) => ({ id: rid, ...r }));
  const content = [];

  // Başlık
  content.push(
    { text: 'Evlilik Listesi', style: 'title' },
    { text: new Date().toLocaleString('tr-TR'), style: 'subtitle', margin: [0, 0, 0, 8] }
  );

  // Her oda için tablo
  roomsArray.forEach((r, idx) => {
    const body = [
      [{ text: 'Ürün', style: 'th' }, { text: 'Kategori', style: 'th' }, { text: 'Ödeme', style: 'th' },
       { text: 'Taksit', style: 'th', alignment: 'right' }, { text: 'Taksitli Toplam', style: 'th', alignment: 'right' },
       { text: 'Peşin Fiyat', style: 'th', alignment: 'right' }, { text: 'Toplam (Efektif)', style: 'th', alignment: 'right' }]
    ];

    const rows = (r.items||[]).map(it => {
      const inst = Number(it.installments)||0;
      const instTot = Number(it.installmentTotal)||0;
      const price = Number(it.price)||0;
      const eff = effectivePrice(it);
      return [
        { text: it.name, noWrap: false },
        { text: it.category || 'Genel' },
        { text: it.paymentType || 'Peşin' },
        { text: inst ? String(inst) : '-', alignment: 'right' },
        { text: instTot ? (instTot).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }) : '-', alignment: 'right' },
        { text: price ? price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }) : '-', alignment: 'right' },
        { text: eff.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }), alignment: 'right' }
      ];
    });

    if (rows.length === 0) {
      rows.push([{ text: '(boş)', colSpan: 7, alignment: 'center', italics: true }, {}, {}, {}, {}, {}, {}]);
    }
    body.push(...rows);

    // Oda toplamı
    const roomTotal = (r.items||[]).reduce((s,it)=>s+effectivePrice(it),0);
    body.push([
      { text: 'Oda Toplamı', colSpan: 6, alignment: 'right', bold: true }, {}, {}, {}, {}, {},
      { text: roomTotal.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' }), alignment: 'right', bold: true }
    ]);

    content.push(
      { text: `${r.name} (${(r.items||[]).length} ürün)`, style: 'sectionTitle', margin: [0, idx===0?0:10, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 80, 60, 35, 75, 75, 90],
          body
        },
        layout: {
          fillColor: (rowIndex) => rowIndex === 0 ? '#f3f4f6' : null,
          hLineColor: '#e5e7eb',
          vLineColor: '#e5e7eb'
        }
      }
    );
  });

  const grand = roomsArray.flatMap(r=>r.items||[]).reduce((s,it)=>s+effectivePrice(it),0);
  content.push({ text: `Genel Toplam: ${grand.toLocaleString('tr-TR', { style:'currency', currency:'TRY' })}`, style: 'grandTotal', margin: [0, 10, 0, 0] });

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [30, 40, 30, 40],
    defaultStyle: { font: 'Roboto', fontSize: 10 },
    styles: {
      title: { fontSize: 18, bold: true },
      subtitle: { color: '#6b7280', margin: [0, 0, 0, 6] },
      sectionTitle: { fontSize: 12, bold: true },
      th: { bold: true },
      grandTotal: { fontSize: 12, bold: true }
    },
    footer: (currentPage, pageCount) => ({
      text: `${currentPage} / ${pageCount}`, alignment: 'right', margin: [0, 0, 30, 0], color: '#9ca3af'
    }),
    content
  };

  // pdfmake vfs_fonts içinde Roboto gömülü gelir
  pdfMake.createPdf(docDefinition).download('evlilik-listesi.pdf');
}

// ---- UI events ----
document.getElementById('addRoomBtn').addEventListener('click', () => {
  const name = document.getElementById('newRoomName').value.trim(); if (!name) return alert('Oda adı girin.');
  addRoom(name); document.getElementById('newRoomName').value = '';
});
[$roomFilter, $categoryFilter, $statusFilter].forEach(sel => sel.addEventListener('change', applyFilters));
$searchInput.addEventListener('input', applyFilters);
