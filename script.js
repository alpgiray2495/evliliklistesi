/* Inline edit + Drag&Drop reorder/move (Başlık & Ara başlık) */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, setDoc, getDocs, deleteDoc, updateDoc, onSnapshot, query, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const tl = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

// UI
const $authSection = document.getElementById('authSection');
const $appShell = document.getElementById('appShell');
const $userBox = document.getElementById('userBox');
const $userEmail = document.getElementById('userEmail');
const $sectionsContainer = document.getElementById('sectionsContainer');
const $roomTemplate = document.getElementById('roomTemplate');
const $itemTemplate = document.getElementById('itemTemplate');
const $sectionFilter = document.getElementById('sectionFilter');
const $subFilter = document.getElementById('subFilter');
const $statusFilter = document.getElementById('statusFilter');
const $searchInput = document.getElementById('searchInput');

// Auth
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
const $exportXlsxBtn = document.getElementById('exportXlsxBtn');
const $exportPdfBtn = document.getElementById('exportPdfBtn');

const state = { uid:null, rooms:{}, unsubRooms:null, unsubItems:{} };
let dragInfo = null; // {roomId, itemId, sourceIndex}

function showLogin(){ $authSection.classList.remove('hidden'); $appShell.classList.add('hidden'); $userBox.classList.add('hidden'); }
function showApp(user){ $userEmail.textContent = user.email||'(Google)'; $userBox.classList.remove('hidden'); $authSection.classList.add('hidden'); $appShell.classList.remove('hidden'); }

$toRegister.addEventListener('click', ()=>{ $registerCard.classList.remove('hidden'); $resetCard.classList.add('hidden'); });
$toReset.addEventListener('click', ()=>{ $resetCard.classList.remove('hidden'); $registerCard.classList.add('hidden'); });
$backToLogin1.addEventListener('click', ()=> $registerCard.classList.add('hidden'));
$backToLogin2.addEventListener('click', ()=> $resetCard.classList.add('hidden'));

$signInBtn.addEventListener('click', async ()=>{ try{ await signInWithEmailAndPassword(auth, $authEmail.value.trim(), $authPassword.value); }catch(e){ alert('Giriş başarısız: '+(e.message||e)); } });
$googleBtn.addEventListener('click', async ()=>{ try{ await signInWithPopup(auth, new GoogleAuthProvider()); }catch(e){ alert('Google ile giriş başarısız: '+(e.message||e)); } });
$registerBtn.addEventListener('click', async ()=>{ try{ await createUserWithEmailAndPassword(auth, $regEmail.value.trim(), $regPassword.value); $registerCard.classList.add('hidden'); }catch(e){ alert('Kayıt başarısız: '+(e.message||e)); } });
document.getElementById('resetBtn')?.addEventListener('click', async ()=>{ const email=document.getElementById('resetEmail').value.trim(); if(!email) return alert('E-posta girin'); try{ await sendPasswordResetEmail(auth,email); alert('Sıfırlama e-postası gönderildi'); }catch(e){ alert('Hata: '+(e.message||e)); } });
$signOutBtn.addEventListener('click', ()=> signOut(auth));

onAuthStateChanged(auth, (user)=>{
  cleanup();
  if(!user){ state.uid=null; state.rooms={}; $sectionsContainer.innerHTML=''; showLogin(); return; }
  state.uid=user.uid; showApp(user); initRealtime(user.uid);
});

function cleanup(){ if(state.unsubRooms){ state.unsubRooms(); state.unsubRooms=null; } Object.values(state.unsubItems).forEach(fn=>fn&&fn()); state.unsubItems={}; }

function initRealtime(uid){
  setDoc(doc(db,'users',uid), {createdAt: serverTimestamp()}, {merge:true});
  const roomsCol = collection(db,'users',uid,'rooms');
  state.unsubRooms = onSnapshot(roomsCol, (snap)=>{
    const seen = new Set();
    snap.forEach(d=>{
      const id=d.id, data=d.data();
      seen.add(id);
      if(!state.rooms[id]){ state.rooms[id]={name:data.name, items:[]}; mountRoom(id, data.name); subscribeItems(uid,id); }
      else { state.rooms[id].name=data.name; const el=document.getElementById(id); if(el) el.querySelector('.room-title').textContent=data.name; }
    });
    // removed rooms
    Object.keys(state.rooms).forEach(id=>{ if(!seen.has(id)){ if(state.unsubItems[id]){state.unsubItems[id](); delete state.unsubItems[id];} delete state.rooms[id]; document.getElementById(id)?.remove(); }});
    updateSectionFilter(); updateTotals();
  });
}

function subscribeItems(uid, roomId){
  const itemsCol = collection(db,'users',uid,'rooms',roomId,'items');
  state.unsubItems[roomId] = onSnapshot(itemsCol,(snap)=>{
    const list=[]; snap.forEach(d=>list.push({id:d.id, ...d.data()}));
    // sort by order if present, else by createdAt seconds
    list.sort((a,b)=>{
      const ao = (typeof a.order==='number')?a.order:(a.createdAt?.seconds||0);
      const bo = (typeof b.order==='number')?b.order:(b.createdAt?.seconds||0);
      return ao - bo;
    });
    state.rooms[roomId].items=list; renderRoomItems(roomId); updateTotals(); updateSubFilterOptions(); applyFilters();
  });
}

function mountRoom(roomId, roomName){
  const node=$roomTemplate.content.cloneNode(true);
  const root=node.querySelector('.room-card'); root.id=roomId; 
  const titleEl = root.querySelector('.room-title');
  titleEl.textContent=roomName;
  titleEl.contentEditable = "true";
  titleEl.spellcheck = false;
  titleEl.addEventListener('blur', async ()=>{
    const newName = titleEl.textContent.trim() || 'Başlık';
    await setDoc(doc(db,'users',state.uid,'rooms',roomId), {name:newName}, {merge:true});
  });

  // Add DnD handlers to list
  const list=root.querySelector('[data-role="item-list"]');
  list.addEventListener('dragover', (e)=>{ e.preventDefault(); list.classList.add('dnd-hover'); });
  list.addEventListener('dragleave', ()=> list.classList.remove('dnd-hover'));
  list.addEventListener('drop', async (e)=>{
    e.preventDefault(); list.classList.remove('dnd-hover');
    if(!dragInfo) return;
    const targetRoomId = roomId;
    const afterId = e.target.closest('li')?.dataset.id || null;
    await handleDrop(dragInfo.roomId, targetRoomId, dragInfo.itemId, afterId);
    dragInfo = null;
  });

  // Form logic
  root.addEventListener('change',(e)=>{
    if(e.target.classList.contains('item-payment')){
      const isInst = e.target.value==='Taksitli';
      root.querySelector('.item-installments').classList.toggle('hidden', !isInst);
      root.querySelector('.item-installment-total').classList.toggle('hidden', !isInst);
    }
  });

  root.addEventListener('click', async (e)=>{
    const btn=e.target.closest('[data-act]'); if(!btn) return;
    const act=btn.getAttribute('data-act');
    if(act==='add-item') await addItem(roomId, root);
    if(act==='clear-inputs'){ 
      root.querySelector('.item-name').value=''; 
      root.querySelector('.item-price').value=''; 
      root.querySelector('.item-sub').value=''; 
      root.querySelector('.item-payment').value='Peşin'; 
      root.querySelector('.item-installments').value=''; 
      root.querySelector('.item-installment-total').value=''; 
      root.querySelector('.item-installments').classList.add('hidden'); 
      root.querySelector('.item-installment-total').classList.add('hidden'); 
    }
    if(act==='delete-room') await deleteRoom(roomId);
  });

  $sectionsContainer.appendChild(node);
}

function effectivePrice(it){ return it.paymentType==='Taksitli' ? (Number(it.installmentTotal)||0) : (Number(it.price)||0); }

function renderRoomItems(roomId){
  const room=state.rooms[roomId]; const root=document.getElementById(roomId);
  const list=root.querySelector('[data-role="item-list"]'); list.innerHTML='';
  room.items.forEach((item, idx)=>{
    const node=$itemTemplate.content.cloneNode(true); const li=node.querySelector('li'); 
    li.dataset.id=item.id; 
    li.classList.toggle('purchased', !!item.purchased);
    li.draggable = true;
    li.addEventListener('dragstart', ()=>{ dragInfo = {roomId, itemId:item.id, sourceIndex: idx}; });
    li.addEventListener('dragend', ()=>{ dragInfo = null; });

    // Inline editable fields
    const nameEl = node.querySelector('.item-name-text');
    nameEl.textContent=item.name;
    nameEl.contentEditable = "true";
    nameEl.spellcheck = false;
    nameEl.addEventListener('blur', async ()=>{
      const newName = nameEl.textContent.trim() || item.name;
      if(newName !== item.name){
        await updateDoc(doc(db,'users',state.uid,'rooms',roomId,'items',item.id), { name:newName });
      }
    });

    const subEl = node.querySelector('.item-sub-text');
    subEl.textContent=item.sub||'';
    subEl.contentEditable = "true";
    subEl.spellcheck = false;
    subEl.addEventListener('blur', async ()=>{
      const newSub = subEl.textContent.trim();
      if(newSub !== (item.sub||'')){
        await updateDoc(doc(db,'users',state.uid,'rooms',roomId,'items',item.id), { sub:newSub });
      }
    });

    node.querySelector('.item-price-text').textContent=tl.format(effectivePrice(item));

    const payBadge=node.querySelector('.payment-badge'); 
    const inst=node.querySelector('.installment-detail');
    if(item.paymentType==='Taksitli'){ 
      const n=Number(item.installments)||0; 
      const tot=Number(item.installmentTotal)||0; 
      const per=n>0?(tot/n):0; 
      payBadge.textContent='Taksitli'; 
      inst.textContent=`${n} x ${tl.format(per)} (Toplam: ${tl.format(tot)})`; 
    } else { 
      payBadge.textContent='Peşin'; inst.textContent=''; 
    }

    // Quick toggles: checkbox & badge click
    node.querySelector('.chk-purchased').checked=!!item.purchased;
    node.querySelector('.chk-purchased').addEventListener('change', async (e)=>{
      await updateDoc(doc(db,'users',state.uid,'rooms',roomId,'items',item.id), {purchased:!!e.target.checked});
    });
    payBadge.title = 'Tıkla: Peşin/Taksitli değiştir';
    payBadge.addEventListener('click', async ()=>{
      if(item.paymentType==='Peşin'){
        const n = Number(prompt('Taksit sayısı (>=2):', String(item.installments||6))||0);
        const tot = Number(prompt('Taksitli toplam (TRY):', String(item.installmentTotal||0))||0);
        if(n>=2 && tot>0){
          await updateDoc(doc(db,'users',state.uid,'rooms',roomId,'items',item.id), { paymentType:'Taksitli', installments:n, installmentTotal:tot });
        }
      } else {
        await updateDoc(doc(db,'users',state.uid,'rooms',roomId,'items',item.id), { paymentType:'Peşin', installments:0, installmentTotal:0 });
      }
    });

    // Legacy edit/delete buttons still work
    node.querySelector('[data-act="edit-item"]').addEventListener('click', ()=> inlineFocus(nameEl));
    node.querySelector('[data-act="delete-item"]').addEventListener('click', async ()=>{ await deleteItem(roomId, item.id); });

    list.appendChild(node);
  });
  const total=room.items.reduce((s,it)=>s+effectivePrice(it),0); root.querySelector('.room-total').textContent=tl.format(total);
}

function inlineFocus(el){ el.scrollIntoView({block:'center'}); el.focus(); document.getSelection()?.selectAllChildren(el); }

async function addRoom(name){ if(!name) return alert('Başlık (Tanım) girin.'); await addDoc(collection(db,'users',state.uid,'rooms'), {name, createdAt: serverTimestamp()}); }
async function deleteRoom(roomId){
  if(!confirm('Bu başlığı silmek istediğinize emin misiniz?')) return;
  const itemsSnap=await getDocs(collection(db,'users',state.uid,'rooms',roomId,'items')); for(const d of itemsSnap.docs) await deleteDoc(doc(db,'users',state.uid,'rooms',roomId,'items',d.id));
  await deleteDoc(doc(db,'users',state.uid,'rooms',roomId));
}

async function addItem(roomId, root){
  const name=root.querySelector('.item-name').value.trim();
  const price=Number(root.querySelector('.item-price').value||0);
  const sub=root.querySelector('.item-sub').value||'';
  const paymentType=root.querySelector('.item-payment').value;
  const installments=Number(root.querySelector('.item-installments').value||0);
  const installmentTotal=Number(root.querySelector('.item-installment-total').value||0);

  if(!name) return alert('Ürün adı girin.');
  if(paymentType==='Taksitli' && (installments<2 || installmentTotal<=0)) return alert('Taksitli için taksit sayısı (>=2) ve toplam (>0) girin.');

  await addDoc(collection(db,'users',state.uid,'rooms',roomId,'items'), {
    name, price, sub, purchased:false, createdAt: serverTimestamp(), order: Date.now(),
    paymentType, installments: paymentType==='Taksitli'?installments:0, installmentTotal: paymentType==='Taksitli'?installmentTotal:0
  });
  root.querySelector('.item-name').value=''; root.querySelector('.item-price').value=''; root.querySelector('.item-sub').value=''; root.querySelector('.item-payment').value='Peşin'; root.querySelector('.item-installments').value=''; root.querySelector('.item-installment-total').value=''; root.querySelector('.item-installments').classList.add('hidden'); root.querySelector('.item-installment-total').classList.add('hidden');
}

async function deleteItem(roomId,itemId){ await deleteDoc(doc(db,'users',state.uid,'rooms',roomId,'items',itemId)); }

async function handleDrop(sourceRoomId, targetRoomId, itemId, afterItemId){
  // assemble target ordering
  const targetItems = [...state.rooms[targetRoomId].items.filter(i=>i.id!==itemId)];
  const dragged = state.rooms[sourceRoomId].items.find(i=>i.id===itemId);
  if(!dragged) return;

  // compute insert index
  let insertIndex = targetItems.length;
  if(afterItemId){
    const idx = targetItems.findIndex(i=>i.id===afterItemId);
    if(idx>=0) insertIndex = idx+1;
  }
  targetItems.splice(insertIndex, 0, dragged);

  if(sourceRoomId === targetRoomId){
    // reorder in same room
    const batch = writeBatch(db);
    targetItems.forEach((it, i)=>{
      const ref = doc(db,'users',state.uid,'rooms',targetRoomId,'items',it.id);
      batch.update(ref, { order: (i+1)*10 });
    });
    await batch.commit();
  }else{
    // move across rooms: create copy then delete
    const batch = writeBatch(db);
    // place new orders for target with placeholder new id (item will get new id)
    const newOrders = targetItems.map((_, i)=> (i+1)*10 );

    // add new doc
    const newData = {...dragged}; delete newData.id;
    const targetCol = collection(db,'users',state.uid,'rooms',targetRoomId,'items');
    // We can't get the new id before commit with batch.set on new doc ref:
    const newRef = doc(targetCol);
    batch.set(newRef, {...newData, order: newOrders[insertIndex]});

    // reassign orders for existing items (excluding the newRef, we already set its order)
    targetItems.forEach((it, i)=>{
      if(i===insertIndex) return; // skip new
      const ref = doc(db,'users',state.uid,'rooms',targetRoomId,'items', it.id);
      batch.update(ref, { order: newOrders[i] });
    });

    // delete old
    const oldRef = doc(db,'users',state.uid,'rooms',sourceRoomId,'items', itemId);
    batch.delete(oldRef);

    await batch.commit();
  }
}

function updateTotals(){
  const all=Object.values(state.rooms).flatMap(r=>r.items);
  const grand=all.reduce((s,it)=>s+effectivePrice(it),0);
  document.getElementById('grandTotal').textContent=tl.format(grand);
  document.getElementById('grandCount').textContent=String(all.length);
  const purchased=all.filter(i=>i.purchased).length;
  document.getElementById('purchasedStats').textContent=`${purchased} / ${all.length}`;
  updateFilteredTotals();
}

function updateSectionFilter(){
  const sel=$sectionFilter; const current=sel.value;
  sel.innerHTML='<option value=\"\">Tüm Başlıklar</option>';
  Object.entries(state.rooms).forEach(([id,r])=>{ const opt=document.createElement('option'); opt.value=id; opt.textContent=r.name; sel.appendChild(opt); });
  if([...sel.options].some(o=>o.value===current)) sel.value=current;
}
function updateSubFilterOptions(){
  const set=new Set(); Object.values(state.rooms).forEach(r=>r.items.forEach(i=>set.add(i.sub||'')));
  const current=$subFilter.value; $subFilter.innerHTML='<option value=\"\">Tüm Ara Başlıklar</option>';
  [...set].filter(Boolean).sort().forEach(s=>{ const opt=document.createElement('option'); opt.value=s; opt.textContent=s; $subFilter.appendChild(opt); });
  if([...$subFilter.options].some(o=>o.value===current)) $subFilter.value=current;
}

function applyFilters(){
  const roomSel=$sectionFilter.value.trim();
  const subSel=$subFilter.value.trim();
  const statSel=$statusFilter.value.trim();
  const q=$searchInput.value.trim().toLowerCase();

  Object.entries(state.rooms).forEach(([id,room])=>{
    const root=document.getElementById(id); if(!root) return;
    const list=root.querySelector('[data-role=\"item-list\"]'); list.innerHTML='';
    const showRoom=!roomSel || roomSel===id; root.style.display=showRoom?'':'none'; if(!showRoom) return;

    const filtered=room.items.filter(it=>{
      if(subSel && (it.sub||'')!==subSel) return false;
      if(statSel==='purchased' && !it.purchased) return false;
      if(statSel==='not' && it.purchased) return false;
      if(q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });

    filtered.forEach((item, idx)=>{
      const node=$itemTemplate.content.cloneNode(true); const li=node.querySelector('li'); li.dataset.id=item.id; li.classList.toggle('purchased', !!item.purchased);
      li.draggable = true;
      li.addEventListener('dragstart', ()=>{ dragInfo = {roomId:id, itemId:item.id, sourceIndex: idx}; });
      li.addEventListener('dragend', ()=>{ dragInfo = null; });

      const nameEl = node.querySelector('.item-name-text'); nameEl.textContent=item.name; nameEl.contentEditable="true"; nameEl.spellcheck=false;
      nameEl.addEventListener('blur', async ()=>{ const nv=nameEl.textContent.trim()||item.name; if(nv!==item.name) await updateDoc(doc(db,'users',state.uid,'rooms',id,'items',item.id), {name:nv}); });
      const subEl = node.querySelector('.item-sub-text'); subEl.textContent=item.sub||''; subEl.contentEditable="true"; subEl.spellcheck=false;
      subEl.addEventListener('blur', async ()=>{ const nv=subEl.textContent.trim(); if(nv!==(item.sub||'')) await updateDoc(doc(db,'users',state.uid,'rooms',id,'items',item.id), {sub:nv}); });

      node.querySelector('.item-price-text').textContent=tl.format(effectivePrice(item));
      const payBadge=node.querySelector('.payment-badge'); const inst=node.querySelector('.installment-detail');
      if(item.paymentType==='Taksitli'){ const n=Number(item.installments)||0; const tot=Number(item.installmentTotal)||0; const per=n>0?(tot/n):0; payBadge.textContent='Taksitli'; inst.textContent=`${n} x ${tl.format(per)} (Toplam: ${tl.format(tot)})`; } else { payBadge.textContent='Peşin'; inst.textContent=''; }
      payBadge.addEventListener('click', async ()=>{
        if(item.paymentType==='Peşin'){
          const n = Number(prompt('Taksit sayısı (>=2):', String(item.installments||6))||0);
          const tot = Number(prompt('Taksitli toplam (TRY):', String(item.installmentTotal||0))||0);
          if(n>=2 && tot>0){ await updateDoc(doc(db,'users',state.uid,'rooms',id,'items',item.id), { paymentType:'Taksitli', installments:n, installmentTotal:tot }); }
        }else{
          await updateDoc(doc(db,'users',state.uid,'rooms',id,'items',item.id), { paymentType:'Peşin', installments:0, installmentTotal:0 });
        }
      });

      node.querySelector('.chk-purchased').checked=!!item.purchased;
      node.querySelector('.chk-purchased').addEventListener('change', async (e)=>{ await updateDoc(doc(db,'users',state.uid,'rooms',id,'items',item.id), {purchased:!!e.target.checked}); });
      node.querySelector('[data-act="edit-item"]').addEventListener('click', ()=> inlineFocus(nameEl));
      node.querySelector('[data-act="delete-item"]').addEventListener('click', async ()=>{ await deleteItem(id, item.id); });

      list.appendChild(node);
    });

    const total=room.items.reduce((s,it)=>s+effectivePrice(it),0);
    root.querySelector('.room-total').textContent=tl.format(total);
  });

  updateFilteredTotals();
}

function updateFilteredTotals(){
  const roomSel=$sectionFilter.value.trim();
  const subSel=$subFilter.value.trim();
  const statSel=$statusFilter.value.trim();
  const q=$searchInput.value.trim().toLowerCase();

  let total=0, count=0;
  Object.entries(state.rooms).forEach(([id,room])=>{
    if(roomSel && roomSel!==id) return;
    room.items.forEach(it=>{
      if(subSel && (it.sub||'')!==subSel) return;
      if(statSel==='purchased' && !it.purchased) return;
      if(statSel==='not' && it.purchased) return;
      if(q && !it.name.toLowerCase().includes(q)) return;
      total+=effectivePrice(it); count+=1;
    });
  });
  const hasFilter=!!(roomSel || subSel || statSel || q);
  const box=document.getElementById('filterSummary'); box.classList.toggle('hidden', !hasFilter);
  document.getElementById('filteredTotalTL').textContent=tl.format(total);
  document.getElementById('filteredCount').textContent=`${count} ürün`;
}

// EXPORTS
$exportXlsxBtn.addEventListener('click', ()=>{ try{ exportToXLSX(); }catch(e){ alert('XLSX hatası: '+(e.message||e)); } });
$exportPdfBtn.addEventListener('click', ()=>{ try{ exportToPDF(); }catch(e){ alert('PDF hatası: '+(e.message||e)); } });

function exportToXLSX(){
  if(!window.XLSX) throw new Error('XLSX kütüphanesi yok');
  const wb=XLSX.utils.book_new();
  const all=Object.entries(state.rooms).flatMap(([rid,r])=> r.items.map(it=>({
    'Ana Başlık': state.rooms[rid].name, 'Ürün': it.name, 'Ara Başlık': it.sub||'',
    'Ödeme': it.paymentType||'Peşin', 'Taksit Sayısı': Number(it.installments)||0,
    'Taksitli Toplam (TRY)': Number(it.installmentTotal)||0, 'Peşin Fiyat (TRY)': Number(it.price)||0,
    'Toplam (Efektif)': effectivePrice(it)
  })));
  const sh=XLSX.utils.json_to_sheet(all); XLSX.utils.book_append_sheet(wb, sh, 'Özet');
  Object.entries(state.rooms).forEach(([rid,r])=>{
    const rows=r.items.map(it=>({
      'Ürün': it.name, 'Ara Başlık': it.sub||'', 'Ödeme': it.paymentType||'Peşin',
      'Taksit Sayısı': Number(it.installments)||0, 'Taksitli Toplam (TRY)': Number(it.installmentTotal)||0,
      'Peşin Fiyat (TRY)': Number(it.price)||0, 'Toplam (Efektif)': effectivePrice(it)
    }));
    const sh2=XLSX.utils.json_to_sheet(rows.length?rows:[{Bilgi:'Bu başlıkta ürün yok'}]);
    XLSX.utils.book_append_sheet(wb, sh2, r.name.substring(0,31));
  });
  XLSX.writeFile(wb, 'evlilik-listesi.xlsx');
}

function exportToPDF(){
  if(typeof pdfMake==='undefined' || !pdfMake.createPdf) throw new Error('pdfmake yok');
  const sections=Object.entries(state.rooms).map(([rid,r])=>({id:rid, ...r}));
  const content=[
    {text:'Evlilik Listesi', style:'title'},
    {text:new Date().toLocaleString('tr-TR'), style:'subtitle', margin:[0,0,0,8]}
  ];
  sections.forEach((r,idx)=>{
    const body=[[
      {text:'Ürün',style:'th'},{text:'Ara Başlık',style:'th'},{text:'Ödeme',style:'th'},
      {text:'Taksit',style:'th',alignment:'right'},{text:'Taksitli Toplam',style:'th',alignment:'right'},
      {text:'Peşin Fiyat',style:'th',alignment:'right'},{text:'Toplam (Efektif)',style:'th',alignment:'right'}
    ]];
    const rows=(r.items||[]).map(it=>{
      const inst=Number(it.installments)||0, instTot=Number(it.installmentTotal)||0, price=Number(it.price)||0, eff=effectivePrice(it);
      return [
        {text:it.name,noWrap:false},
        {text:it.sub||''},
        {text:it.paymentType||'Peşin'},
        {text:inst?String(inst):'-',alignment:'right'},
        {text:instTot?instTot.toLocaleString('tr-TR',{style:'currency',currency:'TRY'}):'-',alignment:'right'},
        {text:price?price.toLocaleString('tr-TR',{style:'currency',currency:'TRY'}):'-',alignment:'right'},
        {text:eff.toLocaleString('tr-TR',{style:'currency',currency:'TRY'}),alignment:'right'}
      ];
    });
    body.push(...rows);
    const roomTotal=(r.items||[]).reduce((s,it)=>s+effectivePrice(it),0);
    body.push([
      {text:'Başlık Toplamı',colSpan:6,alignment:'right',bold:true},{},{},{},{},{}, 
      {text:roomTotal.toLocaleString('tr-TR',{style:'currency',currency:'TRY'}),alignment:'right',bold:true}
    ]);
    content.push(
      {text:`${r.name} (${(r.items||[]).length} ürün)`, style:'sectionTitle', margin:[0,idx===0?0:10,0,4]},
      {
        table:{headerRows:1,widths:['*',110,60,35,75,75,90],body},
        layout:{fillColor:(row)=>row===0?'#f3f4f6':null,hLineColor:'#e5e7eb',vLineColor:'#e5e7eb'}
      }
    );
  });
  const grand=sections.flatMap(r=>r.items||[]).reduce((s,it)=>s+effectivePrice(it),0);
  content.push({text:`Genel Toplam: ${grand.toLocaleString('tr-TR',{style:'currency',currency:'TRY'})}`, style:'grandTotal', margin:[0,10,0,0]});
  const docDefinition={
    pageSize:'A4',
    pageMargins:[30,40,30,40],
    defaultStyle:{font:'Roboto',fontSize:10},
    styles:{ title:{fontSize:18,bold:true}, subtitle:{color:'#6b7280',margin:[0,0,0,6]}, sectionTitle:{fontSize:12,bold:true},
             th:{bold:true}, grandTotal:{fontSize:12,bold:true}},
    footer:(p,pc)=>({text:`${p} / ${pc}`,alignment:'right',margin:[0,0,30,0],color:'#9ca3af'}),
    content
  };
  pdfMake.createPdf(docDefinition).download('evlilik-listesi.pdf');
}

// UI events
document.getElementById('addRoomBtn').addEventListener('click', ()=>{
  const name=document.getElementById('newRoomName').value.trim(); if(!name) return alert('Başlık (Tanım) girin.');
  addRoom(name); document.getElementById('newRoomName').value='';
});
[$sectionFilter,$subFilter,$statusFilter].forEach(el=>el.addEventListener('change', applyFilters));
$searchInput.addEventListener('input', applyFilters);
