// ============================================================
//  La Dolorosa — app.js
//  Lógica principal: estado, cálculos, renders, interacciones
// ============================================================

import { db, auth, signInAnon } from './firebase.js';
import { ref, set, onValue, off, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ── Configuración ─────────────────────────────────────────
const PIN_STORAGE_KEY = 'ldl_auth_ok';
const PIN_HASH        = 'a7f1a8a3'; // hash de "Naroa es muy guapa"
const ADMIN_HASH      = '7c53fae6';          // hash de "1525"

// Función de hash simple (djb2) — el PIN real nunca viaja en claro
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// ── Variables dinámicas ───────────────────────────────────
let ITEMS        = [];
let CATEGORIES   = {};
let DB_PATH      = '';
let MENU_PATH    = '';
let CURRENT_VENUE = '';
let isAdmin      = false;
let isInitialLoad = true;
let _saveTimer   = null;

let state = {
  names: ['Persona 1', 'Persona 2'],
  selections: [],
  common: [],
  payerIdx: 0,
  activeTab: 0,
  kali: { counts: [0, 0], wineBottles: 0, winePrice: 0, wineItemIdx: -1 }
};

let UI_STATE = { general: new Set(), paxes: {} };

// ── Toast (reemplaza alert/confirm) ───────────────────────
function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Modal (reemplaza prompt/confirm) ──────────────────────
function showModal({ title, msg, inputType, placeholder, confirmLabel, confirmClass, onConfirm, onCancel }) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent = msg || '';
  document.getElementById('modal-error').style.display = 'none';

  const input = document.getElementById('modal-input');
  if (inputType) {
    input.type = inputType;
    input.placeholder = placeholder || '';
    input.value = '';
    input.style.display = 'block';
    setTimeout(() => input.focus(), 200);
  } else {
    input.style.display = 'none';
  }

  const confirmBtn = document.getElementById('modal-confirm');
  confirmBtn.textContent = confirmLabel || 'Confirmar';
  confirmBtn.className = `modal-btn ${confirmClass || 'modal-btn-confirm'}`;

  overlay.classList.add('show');

  confirmBtn.onclick = () => {
    const val = inputType ? input.value : null;
    const err = onConfirm(val);
    if (err) {
      document.getElementById('modal-error').textContent = err;
      document.getElementById('modal-error').style.display = 'block';
    } else {
      overlay.classList.remove('show');
    }
  };

  document.getElementById('modal-cancel').onclick = () => {
    overlay.classList.remove('show');
    if (onCancel) onCancel();
  };

  input.onkeydown = (e) => { if (e.key === 'Enter') confirmBtn.click(); };
}

// ── Debounce para saveData ────────────────────────────────
function saveData() {
  if (!DB_PATH) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    set(ref(db, DB_PATH), state).catch(err => console.error('saveData:', err));
  }, 400);
}

function saveMenu() {
  if (!MENU_PATH) return;
  set(ref(db, MENU_PATH), ITEMS).catch(err => console.error('saveMenu:', err));
}

// ── PIN ───────────────────────────────────────────────────
function showVenueScreen() {
  document.getElementById('pin-screen').style.display = 'none';
  document.getElementById('venue-screen').style.display = 'block';
}

window.checkPin = function () {
  const input = document.getElementById('pin-input').value;
  const error = document.getElementById('pin-error');
  if (hashStr(input) === PIN_HASH) {
    localStorage.setItem(PIN_STORAGE_KEY, '1');
    error.style.display = 'none';
    showVenueScreen();
  } else {
    error.style.display = 'block';
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
};

(function checkStoredPin() {
  if (localStorage.getItem(PIN_STORAGE_KEY) === '1') showVenueScreen();
  if (new URLSearchParams(window.location.search).get('clear') === '1') {
    localStorage.removeItem(PIN_STORAGE_KEY);
    window.location.href = window.location.pathname;
  }
})();

// ── Arranque / Volver ─────────────────────────────────────
window.startApp = function (venue) {
  CURRENT_VENUE = venue;
  DB_PATH       = `gastosPro_v4_${venue}`;
  MENU_PATH     = `menu_v4_${venue}`;
  isInitialLoad = true;

  document.getElementById('app-container').style.display = 'block';
  setTimeout(() => (document.getElementById('landing-page').style.opacity = '0'), 50);
  setTimeout(() => (document.getElementById('landing-page').style.display = 'none'), 300);

  if (auth.currentUser) {
    init();
  } else {
    signInAnon()
      .then(() => init())
      .catch(err => {
        console.error('Auth error:', err);
        document.getElementById('views').innerHTML =
          '<div style="padding:40px;text-align:center;color:#ef4444;font-weight:700;">⚠️ Error de conexión. Recarga la página.</div>';
      });
  }
};

window.goBack = function () {
  if (DB_PATH)   off(ref(db, DB_PATH));
  if (MENU_PATH) off(ref(db, MENU_PATH));
  isAdmin = false;
  document.getElementById('btnEditMode').classList.remove('active');
  document.getElementById('tab-btn-editor')?.classList.remove('visible');
  document.getElementById('landing-page').style.display = 'flex';
  setTimeout(() => (document.getElementById('landing-page').style.opacity = '1'), 50);
  document.getElementById('app-container').style.display = 'none';
};

// ── Admin (modal en lugar de prompt) ─────────────────────
window.toggleAdminMode = function () {
  if (isAdmin) {
    isAdmin = false;
    document.getElementById('btnEditMode').classList.remove('active');
    document.getElementById('tab-btn-editor')?.classList.remove('visible');
    if (state.activeTab === 99) switchTab(0);
    return;
  }
  showModal({
    title: '🔑 Modo Edición',
    msg: 'Introduce el código de administrador',
    inputType: 'password',
    placeholder: 'Código...',
    confirmLabel: 'Entrar',
    onConfirm: (val) => {
      if (hashStr(val) === ADMIN_HASH) {
        isAdmin = true;
        document.getElementById('btnEditMode').classList.add('active');
        document.getElementById('tab-btn-editor')?.classList.add('visible');
        toast('✏️ Modo Edición activado');
        return null;
      }
      return 'Código incorrecto';
    }
  });
};

// ── Kali helpers ──────────────────────────────────────────
function ensureKali() {
  if (!state.kali) state.kali = { counts: new Array(state.names.length).fill(0), wineBottles: 0, winePrice: 0, wineItemIdx: -1 };
  if (!state.kali.counts || state.kali.counts.length !== state.names.length)
    state.kali.counts = new Array(state.names.length).fill(0);
  if (state.kali.wineItemIdx === undefined) state.kali.wineItemIdx = -1;
}

function findColaIdx() {
  let idx = ITEMS.findIndex(it => /coca-cola$/i.test(it.n.trim()));
  if (idx === -1) idx = ITEMS.findIndex(it => /coca.cola/i.test(it.n) && !/zero/i.test(it.n));
  if (idx === -1) idx = ITEMS.findIndex(it => /coca.cola/i.test(it.n));
  return idx;
}

window.updateKaliCount = function (pIdx, delta) {
  ensureKali();
  const prev = state.kali.counts[pIdx] || 0;
  const next = Math.max(0, prev + delta);
  const actualDelta = next - prev;
  state.kali.counts[pIdx] = next;
  if (actualDelta !== 0) {
    const colaIdx = findColaIdx();
    if (colaIdx !== -1 && state.selections[pIdx]?.[colaIdx] !== undefined)
      state.selections[pIdx][colaIdx].solo = Math.max(0, (state.selections[pIdx][colaIdx].solo || 0) + actualDelta);
  }
  saveData();
  updateCalculations();
};

window.updateKaliWineBottles = function (delta) {
  ensureKali();
  state.kali.wineBottles = Math.max(0, (state.kali.wineBottles || 0) + delta);
  saveData();
  updateCalculations();
};

window.updateKaliWineSelection = function (itemIdx) {
  ensureKali();
  const idx = parseInt(itemIdx);
  state.kali.wineItemIdx = idx;
  state.kali.winePrice = (idx >= 0 && ITEMS[idx]) ? ITEMS[idx].p : 0;
  saveData();
  renderGeneralView();
  updateCalculations();
};

// ── Core state ────────────────────────────────────────────
function captureUiState() {
  const genView = document.getElementById('view-general');
  if (genView) {
    UI_STATE.general = new Set();
    genView.querySelectorAll('details[open] summary').forEach(el => UI_STATE.general.add(el.innerText.trim()));
  }
  state.names.forEach((_, i) => {
    const pView = document.getElementById(`view-pax-${i}`);
    if (pView) {
      UI_STATE.paxes[i] = new Set();
      pView.querySelectorAll('details[open] summary').forEach(el => UI_STATE.paxes[i].add(el.innerText.trim()));
    }
  });
}

function buildCategories() {
  CATEGORIES = {};
  ITEMS.forEach((it, i) => {
    if (!CATEGORIES[it.cat]) CATEGORIES[it.cat] = [];
    CATEGORIES[it.cat].push({ ...it, idx: i });
  });
}

function init() {
  document.body.style.minHeight = window.innerHeight + 'px';
  enableDragScroll();

  onValue(ref(db, MENU_PATH), (snapshot) => {
    const menuData = snapshot.val();
    if (menuData && menuData.length > 0) {
      ITEMS = menuData;
    } else {
      console.warn('⚠️ No hay menú en Firebase para', CURRENT_VENUE);
      document.getElementById('views').innerHTML =
        '<div style="padding:40px;text-align:center;color:#ef4444;font-weight:700;">⚠️ Menú no encontrado en Firebase.<br><small>Importa el archivo firebase_menus.json en la consola de Firebase.</small></div>';
      return;
    }
    buildCategories();
    if (state.selections) { renderNav(); renderAllViews(); }
  });

  onValue(ref(db, DB_PATH), (snapshot) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) {
      const data = snapshot.val();
      if (data) state = data;
      ensureKali();
      updateCalculations();
      return;
    }
    captureUiState();
    const data = snapshot.val();
    if (data) {
      state = data;
      if (!state.selections) state.selections = [];
      if (!state.common) state.common = new Array(ITEMS.length).fill(0);
      ensureKali();
      if (state.common.length < ITEMS.length) {
        const diff = ITEMS.length - state.common.length;
        for (let k = 0; k < diff; k++) {
          state.common.push(0);
          state.selections.forEach(sel => sel.push({ solo: 0, shared: [] }));
        }
      }
      if (!Object.keys(CATEGORIES).length) buildCategories();
      if (isInitialLoad) { state.activeTab = 0; isInitialLoad = false; }
      renderNav(); renderAllViews(); updateCalculations();
    } else {
      resetSelections(); saveData(); switchTab(0);
    }
  });
}

// ── Editor ────────────────────────────────────────────────
window.updateItemProp = function (idx, key, val) {
  if (key === 'p') val = parseFloat(val);
  ITEMS[idx][key] = val;
  saveMenu();
};

window.deleteItem = function (idx) {
  showModal({
    title: '¿Borrar producto?',
    msg: `Se eliminará "${ITEMS[idx].n}" del menú.`,
    confirmLabel: 'Borrar',
    confirmClass: 'modal-btn-danger',
    onConfirm: () => {
      ITEMS.splice(idx, 1);
      state.common.splice(idx, 1);
      state.selections.forEach(sel => sel.splice(idx, 1));
      saveMenu(); saveData();
      toast('🗑️ Producto eliminado');
      return null;
    }
  });
};

window.addNewItem = function () {
  const name  = document.getElementById('new-name').value;
  const price = parseFloat(document.getElementById('new-price').value);
  const cat   = document.getElementById('new-cat').value;
  const vis   = document.getElementById('new-vis').value;
  if (name && price && cat) {
    ITEMS.push({ n: name, p: price, cat, v: vis });
    state.common.push(0);
    state.selections.forEach(sel => sel.push({ solo: 0, shared: [] }));
    saveMenu(); saveData();
    document.getElementById('new-name').value  = '';
    document.getElementById('new-price').value = '';
    toast('✅ Producto añadido');
  } else {
    toast('⚠️ Rellena todos los campos');
  }
};

// ── Resets ────────────────────────────────────────────────
function resetSelections() {
  state.selections = state.names.map(() => ITEMS.map(() => ({ solo: 0, shared: [] })));
  state.common     = new Array(ITEMS.length).fill(0);
  state.activeTab  = 0;
  state.kali       = { counts: new Array(state.names.length).fill(0), wineBottles: 0, winePrice: 0, wineItemIdx: -1 };
}

window.softReset = function () {
  showModal({
    title: '🔄 Resetear contadores',
    msg: '¿Poner todos los contadores a cero?',
    confirmLabel: 'Resetear',
    onConfirm: () => { resetSelections(); state.payerIdx = 0; saveData(); switchTab(0); toast('🔄 Contadores a cero'); return null; }
  });
};

window.factoryReset = function () {
  showModal({
    title: '🧨 Borrar todo',
    msg: `¿Eliminar TODAS las cuentas de ${CURRENT_VENUE.toUpperCase()}? Quedará solo 1 participante.`,
    confirmLabel: 'Borrar todo',
    confirmClass: 'modal-btn-danger',
    onConfirm: () => {
      remove(ref(db, DB_PATH));
      state.names = ['Persona 1']; state.payerIdx = 0; resetSelections();
      saveData(); renderNav(); renderAllViews(); switchTab(0);
      toast('🧨 Todo eliminado');
      return null;
    }
  });
};

// ── Participantes ─────────────────────────────────────────
window.updateVal = function (paxIdx, itemIdx, delta) {
  const current = state.selections[paxIdx][itemIdx].solo || 0;
  state.selections[paxIdx][itemIdx].solo = Math.max(0, current + delta);
  saveData();
};

window.updateCommon = function (itemIdx, delta) {
  state.common[itemIdx] = Math.max(0, (state.common[itemIdx] || 0) + delta);
  saveData();
};

window.addShared = function (paxIdx, itemIdx) {
  if (!state.selections[paxIdx][itemIdx].shared) state.selections[paxIdx][itemIdx].shared = [];
  state.selections[paxIdx][itemIdx].shared.push({ q: 1, d: state.names.length });
  saveData();
};

window.updateShared = function (paxIdx, itemIdx, shareIdx, key, val) {
  const item = state.selections[paxIdx][itemIdx].shared[shareIdx];
  if (key === 'q') item.q = Math.max(0, item.q + val);
  if (key === 'd') item.d = parseInt(val);
  if (item.q === 0 && key === 'q') state.selections[paxIdx][itemIdx].shared.splice(shareIdx, 1);
  saveData();
};

window.updateName = function (idx, newName) { state.names[idx] = newName; saveData(); };
window.syncNameTab = function (idx, newName) {
  const btn = document.getElementById(`tab-btn-${idx + 3}`);
  if (btn) btn.innerText = newName || `Persona ${idx + 1}`;
};

window.setPayer = function (idx) { state.payerIdx = parseInt(idx); saveData(); renderSummaryView(); };

window.addParticipant = function () {
  state.names.push(`Persona ${state.names.length + 1}`);
  state.selections.push(ITEMS.map(() => ({ solo: 0, shared: [] })));
  ensureKali(); state.kali.counts.push(0);
  saveData(); switchTab(state.names.length + 2);
};

window.removeParticipant = function (idx) {
  if (state.names.length <= 1) { toast('⚠️ Mínimo 1 persona'); return; }
  showModal({
    title: '¿Eliminar persona?',
    msg: `Se eliminará a "${state.names[idx]}" y todos sus consumos.`,
    confirmLabel: 'Eliminar',
    confirmClass: 'modal-btn-danger',
    onConfirm: () => {
      state.names.splice(idx, 1);
      state.selections.splice(idx, 1);
      ensureKali(); state.kali.counts.splice(idx, 1);
      if (state.payerIdx >= state.names.length) state.payerIdx = 0;
      saveData(); switchTab(0); toast('👤 Persona eliminada');
      return null;
    }
  });
};

// ── Render Nav ────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById('navContainer');
  nav.innerHTML = '';
  const tabs = [
    { id: 'tab-summary', label: '📊 Balances', idx: 0 },
    { id: 'tab-ticket',  label: '🧾 Ticket',   idx: 1 },
    { id: 'tab-general', label: '🌍 General',  idx: 2 },
  ];
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${state.activeTab === t.idx ? 'active' : ''}`;
    btn.id = t.id; btn.innerText = t.label;
    btn.setAttribute('aria-label', t.label);
    btn.onclick = () => switchTab(t.idx);
    nav.appendChild(btn);
  });

  const btnEdit = document.createElement('button');
  btnEdit.id = 'tab-btn-editor';
  btnEdit.className = `tab-btn tab-btn-editor ${isAdmin ? 'visible' : ''} ${state.activeTab === 99 ? 'active' : ''}`;
  btnEdit.innerText = '✏️ Editor';
  btnEdit.setAttribute('aria-label', 'Editor de menú');
  btnEdit.onclick = () => switchTab(99);
  nav.appendChild(btnEdit);

  state.names.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${state.activeTab === i + 3 ? 'active' : ''}`;
    btn.id = `tab-btn-${i + 3}`; btn.innerText = name;
    btn.setAttribute('aria-label', `Ver consumo de ${name}`);
    btn.onclick = () => switchTab(i + 3);
    nav.appendChild(btn);
  });

  const btnAdd = document.createElement('button');
  btnAdd.className = 'tab-btn tab-btn-add';
  btnAdd.innerText = '+ Persona';
  btnAdd.setAttribute('aria-label', 'Añadir persona');
  btnAdd.onclick = addParticipant;
  nav.appendChild(btnAdd);
}

// ── Switch Tab ────────────────────────────────────────────
window.switchTab = function switchTab(tabIdx) {
  state.activeTab = tabIdx;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const map = { 0: 'tab-summary', 1: 'tab-ticket', 2: 'tab-general', 99: 'tab-btn-editor' };
  const targetId = map[tabIdx] || `tab-btn-${tabIdx}`;
  document.getElementById(targetId)?.classList.add('active');

  document.querySelectorAll('#views > div').forEach(v => v.classList.add('hidden'));
  const viewMap = { 0: 'view-summary', 1: 'view-global', 2: 'view-general', 99: 'view-editor' };
  const viewId = viewMap[tabIdx] || `view-pax-${tabIdx - 3}`;
  document.getElementById(viewId)?.classList.remove('hidden');

  if (tabIdx === 0) renderSummaryView();
  if (tabIdx === 1) renderGlobalView();
  if (tabIdx === 2) renderGeneralView();
  if (tabIdx === 99) renderEditorView();

  document.getElementById('actionButtons').classList.toggle('hidden', tabIdx !== 0);
};

function renderAllViews() {
  const container = document.getElementById('views');
  container.innerHTML = '';
  ['view-summary', 'view-global', 'view-general', 'view-editor'].forEach((id, i) => {
    const div = document.createElement('div');
    div.id = id;
    if (i > 0) div.classList.add('hidden');
    container.appendChild(div);
  });
  state.names.forEach((_, i) => {
    const div = document.createElement('div');
    div.id = `view-pax-${i}`; div.classList.add('hidden');
    container.appendChild(div);
    renderParticipantView(i);
  });
  switchTab(state.activeTab);
}

// ── Render Editor ─────────────────────────────────────────
function renderEditorView() {
  const container = document.getElementById('view-editor');
  const uniqueCats = [...new Set(ITEMS.map(i => i.cat))];
  const catOptions = uniqueCats.map(c => `<option value="${c}">${c}</option>`).join('');

  let html = `
    <div class="new-item-container">
      <div class="new-item-title">✨ Añadir Nuevo Producto</div>
      <div class="form-grid">
        <input type="text" id="new-name" class="editor-input" placeholder="Nombre (ej: Croquetas)">
        <div style="display:flex;gap:10px;">
          <input type="number" id="new-price" class="editor-input" placeholder="Precio (€)" step="0.01">
          <select id="new-vis" class="select-fancy">
            <option value="all">Ver en: Ambos</option>
            <option value="pax">Ver en: Participantes</option>
            <option value="common">Ver en: General</option>
          </select>
        </div>
        <select id="new-cat" class="select-fancy">
          ${catOptions}
          <option value="🆕 Otros">🆕 Otros</option>
        </select>
        <button class="btn-action" style="background:var(--primary);color:white;margin-top:5px;padding:12px" onclick="addNewItem()">+ AÑADIR AHORA</button>
      </div>
    </div>`;

  for (const [cat, items] of Object.entries(CATEGORIES)) {
    html += `<div class="editor-section-title">${cat}</div><div class="card" style="margin-bottom:20px;">`;
    items.forEach(item => {
      const visColor = item.v === 'pax' ? '#dbeafe' : item.v === 'common' ? '#fef3c7' : '#f1f5f9';
      html += `
        <div class="editor-card-item">
          <div class="editor-inputs-group">
            <input type="text" class="editor-input" value="${item.n}" onchange="updateItemProp(${item.idx},'n',this.value)" style="font-weight:600">
            <div class="editor-input-row">
              <input type="number" class="editor-input" value="${item.p}" step="0.01" onchange="updateItemProp(${item.idx},'p',this.value)" style="width:70px">
              <select class="editor-input" onchange="updateItemProp(${item.idx},'v',this.value)" style="background:${visColor};border:none;">
                <option value="all" ${!item.v||item.v==='all'?'selected':''}>Todo</option>
                <option value="pax" ${item.v==='pax'?'selected':''}>Solo Pax</option>
                <option value="common" ${item.v==='common'?'selected':''}>Solo Gen</option>
              </select>
            </div>
          </div>
          <div class="editor-actions">
            <button class="btn-delete-item" aria-label="Borrar ${item.n}" onclick="deleteItem(${item.idx})">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
    });
    html += `</div>`;
  }
  html += `<div style="height:50px"></div>`;
  container.innerHTML = html;
}

// ── Render Summary ────────────────────────────────────────
function renderSummaryView() {
  const container = document.getElementById('view-summary');
  const calc = calculateMath();
  const payerOpts = state.names.map((n, i) =>
    `<option value="${i}" ${i === state.payerIdx ? 'selected' : ''}>${n}</option>`).join('');

  let html = `
    <div class="card" style="padding:15px;border-left:5px solid var(--primary)">
      <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">¿Quién pagó la cuenta?</span>
      <select onchange="setPayer(this.value)" class="select-fancy" style="width:100%;margin-top:8px;padding:10px;font-size:16px;">${payerOpts}</select>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Balance por Persona</span></div>
    <div class="balance-container" style="padding:15px">`;

  calc.balances.forEach((b, i) => {
    const isPayer = i === state.payerIdx;
    const amount  = isPayer ? (calc.grandTotal - b.consumed) : b.consumed;
    const label   = isPayer ? 'RECIBE' : 'DEBE';
    const symbol  = isPayer ? '+' : '-';
    if (amount > 0.05 || b.consumed > 0) {
      const detailsList = b.items.length
        ? b.items.map(it => `<div class="balance-detail-item"><span>${it.desc}</span><span>${it.cost.toFixed(2)}€</span></div>`).join('')
        : '<div style="padding:10px;text-align:center">Nada consumido</div>';
      html += `
        <details>
          <summary class="${isPayer ? 'is-payer' : 'is-debtor'}">
            <div style="text-align:left"><b style="font-size:15px">${state.names[i]}</b><br><small style="opacity:.8">Consumido: ${b.consumed.toFixed(2)}€</small></div>
            <div style="text-align:right"><small style="font-weight:800;font-size:10px;">${label}</small><br><span style="font-size:18px;font-weight:800;">${symbol}${amount.toFixed(2)}€</span></div>
          </summary>
          <div class="balance-detail-list">${detailsList}
            <div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:4px;text-align:right;font-weight:700">Total: ${b.consumed.toFixed(2)}€</div>
          </div>
        </details>`;
    }
  });

  html += `</div></div>
    <button class="btn-action btn-reset" aria-label="Resetear contadores" onclick="softReset()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16l5 5v-5"/></svg>
      Resetear Contadores
    </button>
    <button class="btn-action btn-factory" aria-label="Borrar todas las cuentas" onclick="factoryReset()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      Eliminar Todas las Cuentas
    </button>
    <div style="height:30px"></div>`;
  container.innerHTML = html;
}

// ── Render Ticket ─────────────────────────────────────────
function renderGlobalView() {
  const container = document.getElementById('view-global');
  const calc = calculateMath();
  const now = new Date();
  const venues = { aiur: 'CLUB CICLISTA IRUNÉS', ekhi: 'LA SALLE', galarza: 'ATSEGIÑA' };
  const venueName = venues[CURRENT_VENUE] || 'LA DOLOROSA';

  if (!calc.globalItems.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--muted)">Añade productos para generar el ticket</div>`;
    return;
  }

  const itemsHtml = calc.globalItems.map(item => `
    <div class="receipt-row">
      <span>${item.n}<br><small>${(item.q % 1 === 0 ? item.q : item.q.toFixed(2))} x ${item.p.toFixed(2)}€</small></span>
      <span>${item.t.toFixed(2)}€</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="receipt-paper">
      <div class="receipt-header">
        <h2>${venueName}</h2>
        <p>"Sarna con gusto no pica"</p>
        <p>${now.toLocaleDateString()} - ${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>
        <p>Ticket Nº ${Math.floor(Math.random() * 9000) + 1000}</p>
      </div>
      <div class="receipt-divider"></div>
      <div style="margin:15px 0">${itemsHtml}</div>
      <div class="receipt-divider"></div>
      <div class="receipt-total"><span>TOTAL</span><span>${calc.grandTotal.toFixed(2)}€</span></div>
      <div class="receipt-footer"><div class="barcode"></div><p>GRACIAS POR SU VISITA</p><p>IVA INCLUIDO</p></div>
    </div>`;
}

// ── Render General ────────────────────────────────────────
function renderGeneralView() {
  const container = document.getElementById('view-general');
  const openSet   = UI_STATE.general || new Set();
  ensureKali();
  const bottles   = state.kali.wineBottles || 0;
  const winePrice = state.kali.winePrice   || 0;
  const totalKalis = (state.kali.counts || []).reduce((a, b) => (a || 0) + (b || 0), 0);
  const totalWineCost = bottles * winePrice;
  const costPerKali   = (totalKalis > 0 && totalWineCost > 0) ? totalWineCost / totalKalis : 0;

  let html = `
    <div class="general-banner">
      <div style="font-size:20px">🌍</div>
      <div><b>Gastos Comunes</b><br>Lo que añadas aquí se divide entre <b>todos</b> (${state.names.length} personas).</div>
    </div>
    <div class="card">
      <details ${(bottles > 0 || winePrice > 0) ? 'open' : ''}>
        <summary>🍷🥤 Vino para Kali${totalWineCost > 0 ? ` · ${totalWineCost.toFixed(2)}€` : ''}</summary>
        <div>
          <div class="item-row">
            <div class="item-info"><b>Botellas de vino</b><small>Usadas para kalimotxos</small></div>
            <div class="stepper">
              <btn aria-label="Quitar botella" onclick="updateKaliWineBottles(-1)">-</btn>
              <span style="color:${bottles > 0 ? 'var(--warning)' : 'inherit'}">${bottles}</span>
              <btn aria-label="Añadir botella" onclick="updateKaliWineBottles(1)">+</btn>
            </div>
          </div>
          <div class="item-row" style="gap:12px">
            <div class="item-info" style="flex-shrink:0"><b>Vino utilizado</b><small>Para calcular el coste</small></div>
            <select class="select-fancy select-compact" style="min-width:0;flex:1" onchange="updateKaliWineSelection(this.value)">
              <option value="-1" ${(state.kali.wineItemIdx || -1) === -1 ? 'selected' : ''}>— Elige un vino —</option>
              ${ITEMS.filter(it => /vino|ardoak/i.test(it.cat)).map(it => {
                const realIdx = ITEMS.indexOf(it);
                return `<option value="${realIdx}" ${state.kali.wineItemIdx === realIdx ? 'selected' : ''}>${it.n} · ${it.p.toFixed(2)}€</option>`;
              }).join('')}
            </select>
          </div>
          ${totalKalis > 0 && totalWineCost > 0 ? `<div class="kali-info-row"><span>🧮 ${totalKalis} kali${totalKalis > 1 ? 's' : ''}</span><span><b>${costPerKali.toFixed(2)}€/kali</b></span></div>` : ''}
        </div>
      </details>
    </div>`;

  for (const [cat, items] of Object.entries(CATEGORIES)) {
    const validItems = items.filter(it => !it.v || it.v === 'all' || it.v === 'common');
    if (!validItems.length) continue;
    html += `<div class="card"><details ${openSet.has(cat) ? 'open' : ''}><summary>${cat}</summary><div>`;
    validItems.forEach(it => {
      const qty = state.common[it.idx] || 0;
      html += `
        <div class="item-row">
          <div class="item-info"><b>${it.n}</b><small>${it.p.toFixed(2)}€</small></div>
          <div class="stepper">
            <btn aria-label="Quitar ${it.n}" onclick="updateCommon(${it.idx},-1)">-</btn>
            <span style="color:${qty > 0 ? 'var(--warning)' : 'inherit'}">${qty}</span>
            <btn aria-label="Añadir ${it.n}" onclick="updateCommon(${it.idx},1)">+</btn>
          </div>
        </div>`;
    });
    html += `</div></details></div>`;
  }
  container.innerHTML = html;
}

// ── Render Participante ───────────────────────────────────
function renderParticipantView(pIdx) {
  const container = document.getElementById(`view-pax-${pIdx}`);
  if (!container) return;
  const openSet   = UI_STATE.paxes[pIdx] || new Set();
  ensureKali();
  const kaliCount = state.kali.counts[pIdx] || 0;

  let html = `
    <div class="card">
      <div class="card-header">
        <input type="text" class="pax-header-input" value="${state.names[pIdx]}"
          aria-label="Nombre de participante"
          oninput="syncNameTab(${pIdx},this.value)"
          onblur="updateName(${pIdx},this.value)"
          onkeydown="if(event.key==='Enter')this.blur()"
          placeholder="Nombre...">
        <button onclick="removeParticipant(${pIdx})" class="btn-delete-pax" aria-label="Eliminar ${state.names[pIdx]}">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
    </div>
    <div class="card">
      <details ${kaliCount > 0 ? 'open' : ''}>
        <summary>🍷🥤 Kalimotxo${kaliCount > 0 ? ` · ${kaliCount}` : ''}</summary>
        <div>
          <div class="item-row">
            <div class="item-info"><b>Kalimotxo</b><small>Incluye Coca-Cola · el vino se configura en General</small></div>
            <div class="stepper">
              <btn aria-label="Quitar kalimotxo" onclick="updateKaliCount(${pIdx},-1)">-</btn>
              <span style="color:${kaliCount > 0 ? 'var(--primary)' : 'inherit'}">${kaliCount}</span>
              <btn aria-label="Añadir kalimotxo" onclick="updateKaliCount(${pIdx},1)">+</btn>
            </div>
          </div>
        </div>
      </details>
    </div>`;

  for (const [cat, items] of Object.entries(CATEGORIES)) {
    if (cat === '🍳 Sukaldea / Cocina') continue;
    const validItems = items.filter(it => !it.v || it.v === 'all' || it.v === 'pax');
    if (!validItems.length) continue;
    html += `<div class="card"><details ${openSet.has(cat) ? 'open' : ''}><summary>${cat}</summary><div>`;
    validItems.forEach(it => {
      const sel     = state.selections[pIdx][it.idx];
      const soloQty = sel.solo || 0;
      let sharedHtml = (sel.shared || []).map((sh, shIdx) => `
        <div class="split-row">
          <span style="font-size:10px;font-weight:800;color:var(--primary)">GRP</span>
          <div class="stepper" style="transform:scale(0.8)">
            <btn aria-label="Quitar" onclick="updateShared(${pIdx},${it.idx},${shIdx},'q',-1)">-</btn>
            <span>${sh.q}</span>
            <btn aria-label="Añadir" onclick="updateShared(${pIdx},${it.idx},${shIdx},'q',1)">+</btn>
          </div>
          <span style="font-size:11px;color:#666">entre</span>
          <select class="select-fancy select-compact" aria-label="Dividir entre" onchange="updateShared(${pIdx},${it.idx},${shIdx},'d',this.value)">
            ${Array.from({length: state.names.length}, (_, k) =>
              `<option value="${k+1}" ${sh.d == k+1 ? 'selected':''}>${k+1}</option>`).join('')}
          </select>
        </div>`).join('');
      html += `
        <div class="item-row">
          <div class="item-info"><b>${it.n}</b><small>${it.p.toFixed(2)}€</small>${sharedHtml}</div>
          <div style="display:flex;flex-direction:column;align-items:end;gap:5px">
            <div class="stepper">
              <btn aria-label="Quitar ${it.n}" onclick="updateVal(${pIdx},${it.idx},-1)">-</btn>
              <span style="color:${soloQty > 0 ? 'var(--primary)' : 'inherit'}">${soloQty}</span>
              <btn aria-label="Añadir ${it.n}" onclick="updateVal(${pIdx},${it.idx},1)">+</btn>
            </div>
            <button onclick="addShared(${pIdx},${it.idx})" style="border:none;background:none;color:var(--primary);font-size:11px;font-weight:700;cursor:pointer">+ Compartir</button>
          </div>
        </div>`;
    });
    html += `</div></details></div>`;
  }
  container.innerHTML = html;
}

// ── Cálculos ──────────────────────────────────────────────
function calculateMath() {
  const numPax = state.names.length;
  let grandTotal = 0;
  const paxData = state.names.map(() => ({ consumed: 0, items: [] }));
  const globalItemsMap = {};

  const addToGlobal = (idx, qty, total, name, price) => {
    if (!globalItemsMap[idx]) globalItemsMap[idx] = { n: name, q: 0, t: 0, p: price };
    globalItemsMap[idx].q += qty;
    globalItemsMap[idx].t += total;
  };

  (state.common || []).forEach((qty, iIdx) => {
    if (qty > 0) {
      const it = ITEMS[iIdx];
      const total = qty * it.p;
      const perPax = total / numPax;
      paxData.forEach(pd => { pd.consumed += perPax; pd.items.push({ desc: `Parte Prop. ${it.n} (${qty} total)`, cost: perPax }); });
      grandTotal += total;
      addToGlobal(iIdx, qty, total, it.n, it.p);
    }
  });

  state.selections.forEach((paxSel, pIdx) => {
    paxSel.forEach((itemSel, iIdx) => {
      const it = ITEMS[iIdx]; const price = it.p;
      if (itemSel.solo > 0) {
        const cost = itemSel.solo * price;
        paxData[pIdx].consumed += cost;
        paxData[pIdx].items.push({ desc: `${itemSel.solo}x ${it.n}`, cost });
        grandTotal += cost;
        addToGlobal(iIdx, itemSel.solo, cost, it.n, price);
      }
      (itemSel.shared || []).forEach(sh => {
        if (sh.q > 0 && sh.d > 0) {
          const myShareCost = (sh.q / sh.d) * price;
          paxData[pIdx].consumed += myShareCost;
          paxData[pIdx].items.push({ desc: `${sh.q}/${sh.d} de ${it.n}`, cost: myShareCost });
          grandTotal += myShareCost;
          addToGlobal(iIdx, sh.q / sh.d, myShareCost, it.n, price);
        }
      });
    });
  });

  if (state.kali) {
    ensureKali();
    const totalKalis    = (state.kali.counts || []).reduce((a, b) => (a || 0) + (b || 0), 0);
    const totalWineCost = (state.kali.wineBottles || 0) * (state.kali.winePrice || 0);
    if (totalKalis > 0 && totalWineCost > 0) {
      const costPerKali = totalWineCost / totalKalis;
      (state.kali.counts || []).forEach((kaliCount, pIdx) => {
        if (kaliCount > 0 && pIdx < paxData.length) {
          const myCost = kaliCount * costPerKali;
          paxData[pIdx].consumed += myCost;
          paxData[pIdx].items.push({ desc: `${state.kali.wineBottles}x Vino (parte ${kaliCount}/${totalKalis})`, cost: myCost });
        }
      });
      grandTotal += totalWineCost;
      addToGlobal('kali_wine', state.kali.wineBottles, totalWineCost, 'Vino', state.kali.winePrice);
    }
  }

  return {
    grandTotal,
    balances: paxData,
    globalItems: Object.values(globalItemsMap).filter(i => i.t > 0)
  };
}

function updateCalculations() {
  const calc = calculateMath();
  document.getElementById('headerTotal').innerText = calc.grandTotal.toFixed(2) + '€';
}

// ── Mensaje WhatsApp ──────────────────────────────────────
function getBillText() {
  const calc   = calculateMath();
  const payer  = state.names[state.payerIdx];
  const now    = new Date();
  const date   = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const time   = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const venues = { aiur: 'Club Ciclista Irunés', ekhi: 'La Salle', galarza: 'Atsegiña' };
  const venue  = venues[CURRENT_VENUE] || 'La Dolorosa';

  const SEP  = '```';
  const LINE = '─────────────────────';

  // Tabla de deudas en bloque monoespaciado (se ve perfecta en WhatsApp)
  let table = '';
  calc.balances.forEach((b, i) => {
    if (i === state.payerIdx) return;
    if (b.consumed > 0.05) {
      const name  = state.names[i].padEnd(14).slice(0, 14);
      const amt   = `${b.consumed.toFixed(2)} €`.padStart(8);
      table += `${name}  ${amt}\n`;
    }
  });

  const payerBalance = calc.grandTotal - calc.balances[state.payerIdx].consumed;

  let t = '';
  t += `📍 *${venue}*  ·  ${date}  ${time}\n`;
  t += `\n`;
  t += `💰 *Total:* ${calc.grandTotal.toFixed(2)} €   |   🧾 *Pagó:* ${payer}\n`;
  t += `\n`;

  if (table) {
    t += `*Quién debe qué:*\n`;
    t += `${SEP}\n`;
    t += `${'Persona'.padEnd(14)}  ${'Debe'.padStart(8)}\n`;
    t += `${LINE}\n`;
    t += table;
    t += `${SEP}\n`;
  }

  if (payerBalance > 0.05) {
    t += `\n✅ *${payer}* recupera *${payerBalance.toFixed(2)} €*\n`;
  } else if (!table) {
    t += `✅ Nadie debe nada\n`;
  }

  return t;
}

// ── Compartir / Copiar ────────────────────────────────────
window.shareNative = async function () {
  const text = getBillText();
  if (navigator.share) {
    try { await navigator.share({ title: 'La Dolorosa', text }); }
    catch (err) { if (err.name !== 'AbortError') console.error(err); }
  } else {
    await navigator.clipboard.writeText(text);
    toast('📋 Copiado al portapapeles');
  }
};

window.copyBill = async function () {
  const text = getBillText();
  const btn  = document.getElementById('btnCopy');
  const orig = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback para navegadores sin clipboard API
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  btn.style.background = '#10b981';
  btn.innerHTML = '<span>✅ Copiado</span>';
  setTimeout(() => { btn.style.background = ''; btn.innerHTML = orig; }, 2000);
};

// ── Drag scroll ───────────────────────────────────────────
function enableDragScroll() {
  const slider = document.getElementById('navContainer');
  let isDown = false, startX, scrollLeft;
  slider.addEventListener('mousedown', e => { isDown = true; slider.style.cursor = 'grabbing'; startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; });
  slider.addEventListener('mouseleave', () => { isDown = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mouseup',    () => { isDown = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mousemove',  e => { if (!isDown) return; e.preventDefault(); slider.scrollLeft = scrollLeft - (e.pageX - slider.offsetLeft - startX) * 2; });
}
