// ── Firebase ──────────────────────────────────────────────
import { initializeApp }    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, get, onValue, off, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAcmywgX6l4x_dTnmA1c_CbtAh7LfSx4vg',
  authDomain:        'la-dolorosa-68870.firebaseapp.com',
  databaseURL:       'https://la-dolorosa-68870-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'la-dolorosa-68870',
  storageBucket:     'la-dolorosa-68870.firebasestorage.app',
  messagingSenderId: '387013198617',
  appId:             '1:387013198617:web:91910b92149292fe913b88'
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);
const signInAnon = () => signInAnonymously(auth);

// ============================================================
//  La Dolorosa — app.js
//  Lógica principal: estado, cálculos, renders, interacciones
// ============================================================

// ── Configuración ─────────────────────────────────────────
const PIN_STORAGE_KEY = 'ldl_auth_ok';
const PIN_HASH        = 'a7f1a8a3';
const ADMIN_HASH      = '7c53fae6';

function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// ── Variables dinámicas ───────────────────────────────────
let ITEMS         = [];
let CATEGORIES    = {};
let DB_PATH       = '';
let MENU_PATH     = '';
let HIST_PATH     = '';
let CURRENT_VENUE = '';
let isAdmin       = false;
let _saveTimer    = null;
let _nameTimer    = null;
let dragScrollBound = false;

// NOTA IMPORTANTE: la pestaña activa (localTab) es un estado puramente
// LOCAL de cada dispositivo/navegador. NUNCA se guarda en Firebase ni
// se sincroniza entre usuarios: cada persona debe poder navegar por su
// cuenta sin que el resto salte de pestaña cuando alguien hace un cambio.
let localTab = 0;

// NOTA: los índices de pestaña ahora son:
// 0 Balances, 1 Ticket, 2 General, 3 Compra, 4 Total, 99 Editor,
// y a partir de 5 cada participante (i + 5).
let state = {
  names:      ['Persona 1', 'Persona 2'],
  selections: [],
  common:     [],
  payerIdx:   0,
  kali:       { counts: [0, 0], wineBottles: 0, winePrice: 0, wineItemIdx: -1 },
  compra:     { total: 0, payerIdx: 0 }
};

let UI_STATE = { general: new Set(), paxes: {} };

// ── Toast ─────────────────────────────────────────────────
function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ── Modal ─────────────────────────────────────────────────
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

// ── Debounce saveData ─────────────────────────────────────
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

// Guarda solo el array de nombres rápido (50ms) para sincronización en tiempo real
function saveNameFast() {
  clearTimeout(_nameTimer);
  _nameTimer = setTimeout(() => {
    if (!DB_PATH) return;
    set(ref(db, DB_PATH + '/names'), state.names)
      .catch(err => console.error('saveNames:', err));
  }, 50);
}

// ── Historial ─────────────────────────────────────────────
function saveHistory() {
  if (!HIST_PATH) return;
  const settlement = calculateFinalSettlement();
  if (settlement.grandTotal < 0.5) return;

  const mapTx = (arr) => (arr || []).map(t => ({
    from:   state.names[t.from],
    to:     state.names[t.to],
    amount: parseFloat(t.amount.toFixed(2))
  }));

  const entry = {
    ts:    Date.now(),
    total: parseFloat(settlement.grandTotal.toFixed(2)),
    // Desglose cena / compra, para poder diferenciarlos en el historial.
    cenaTotal:   parseFloat(settlement.cena.grandTotal.toFixed(2)),
    compraTotal: parseFloat(settlement.compraTotal.toFixed(2)),
    cenaTransactions:   mapTx(settlement.cenaTransactions),
    compraTransactions: mapTx(settlement.compraTransactions),
    transactions: mapTx(settlement.transactions)
  };

  set(ref(db, `${HIST_PATH}/${entry.ts}`), entry)
    .catch(err => console.error('saveHistory:', err));
}

window.openHistory = function () {
  document.getElementById('history-overlay').classList.add('show');
  const drawer = document.getElementById('history-drawer');
  drawer.classList.add('show');
  const content = document.getElementById('history-content');
  content.innerHTML = `<div class="hist-loading">Cargando historial…</div>`;

  get(ref(db, HIST_PATH)).then(snapshot => {
    renderHistoryContent(snapshot.val());
  }).catch(() => {
    content.innerHTML = `<div class="hist-loading">⚠️ Error al cargar</div>`;
  });
};

window.closeHistory = function () {
  document.getElementById('history-overlay').classList.remove('show');
  document.getElementById('history-drawer').classList.remove('show');
};

function updateHistToolbarCount() {
  const remaining = document.querySelectorAll('.hist-entry').length;
  const toolbarSpan = document.querySelector('.hist-toolbar span');
  if (toolbarSpan) toolbarSpan.textContent = `${remaining} registro${remaining !== 1 ? 's' : ''}`;
  return remaining;
}

// Construye las filas de transacciones de un registro del historial.
// Si el registro tiene desglose cena/compra (formato nuevo) y hubo
// compra, se muestran dos bloques separados con su propia etiqueta y
// subtotal. Si no hubo compra, o el registro es de un formato antiguo
// sin desglose, se muestra una única lista (comportamiento anterior).
function renderTxRows(txs) {
  if (!txs || !txs.length) {
    return '<div style="padding:10px;text-align:center;color:var(--muted)">Nadie debía nada</div>';
  }
  return txs.map(t => `
    <div class="hist-pax-row">
      <span class="hist-pax-name">${t.from} → ${t.to}</span>
      <span class="hist-pax-amount color-danger">${t.amount.toFixed(2)}€</span>
    </div>`).join('');
}

function buildHistRows(entry) {
  const hasBreakdown = Array.isArray(entry.cenaTransactions) || Array.isArray(entry.compraTransactions);
  if (!hasBreakdown) {
    // Registro antiguo: sin desglose, comportamiento anterior.
    return renderTxRows(entry.transactions);
  }
  const hasCompra = (entry.compraTotal || 0) > 0.005;
  if (!hasCompra) {
    // No hubo compra: mostramos solo la lista de la cena (sin etiquetas).
    return renderTxRows(entry.cenaTransactions && entry.cenaTransactions.length ? entry.cenaTransactions : entry.transactions);
  }
  return `
    <div class="hist-section-label">🍽️ Cena · ${(entry.cenaTotal || 0).toFixed(2)}€</div>
    ${renderTxRows(entry.cenaTransactions)}
    <div class="hist-section-label">🛒 Compra · ${(entry.compraTotal || 0).toFixed(2)}€</div>
    ${renderTxRows(entry.compraTransactions)}
  `;
}

function renderHistoryContent(data) {
  const content = document.getElementById('history-content');

  if (!data || Object.keys(data).length === 0) {
    content.innerHTML = `
      <div class="hist-empty">
        <div style="font-size:40px;margin-bottom:8px">📭</div>
        <p>Sin registros todavía.<br><small>Se guardan al compartir o copiar.</small></p>
      </div>`;
    return;
  }

  const sorted = Object.entries(data).sort((a, b) => b[0] - a[0]).slice(0, 50);
  const count  = sorted.length;

  let html = `
    <div class="hist-toolbar">
      <span>${count} registro${count !== 1 ? 's' : ''}</span>
      ${isAdmin ? `<button class="hist-btn-danger" onclick="clearHistory()">🗑 Borrar todo</button>` : ''}
    </div>`;

  sorted.forEach(([key, entry]) => {
    const date    = new Date(entry.ts);
    const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Nota: mostramos SIEMPRE todas las transacciones del registro (sin
    // recortar), porque el detalle se despliega con una altura calculada
    // dinámicamente (ver toggleHistEntry), así que aunque haya muchos
    // participantes se ven todas las filas.
    const rowsHtml = buildHistRows(entry);

    html += `
      <div class="hist-entry" id="he-${key}">
        <div class="hist-entry-header" onclick="toggleHistEntry('${key}')">
          <div class="hist-entry-left">
            <span class="hist-date">${dateStr} · ${timeStr}</span>
          </div>
          <div class="hist-entry-right">
            <span class="hist-total">${entry.total.toFixed(2)}€</span>
            ${isAdmin ? `<button class="hist-btn-x" onclick="event.stopPropagation();deleteHistEntry('${key}')">✕</button>` : ''}
            <svg class="hist-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="hist-entry-detail" id="hd-${key}">${rowsHtml}</div>
      </div>`;
  });

  content.innerHTML = html;
}

window.toggleHistEntry = function (key) {
  const detail  = document.getElementById(`hd-${key}`);
  const entry   = document.getElementById(`he-${key}`);
  const chevron = entry.querySelector('.hist-chevron');
  const isOpen  = detail.classList.contains('open');

  if (isOpen) {
    // Cerrar: primero fijamos la altura actual y luego la llevamos a 0
    // para que la transición funcione partiendo de un valor real.
    detail.style.maxHeight = detail.scrollHeight + 'px';
    requestAnimationFrame(() => { detail.style.maxHeight = '0px'; });
    detail.classList.remove('open');
  } else {
    // Abrir: calculamos la altura real del contenido (puede tener muchas
    // filas si hay muchos participantes) para que se vea todo, en vez de
    // usar un max-height fijo que recortaría la lista.
    detail.classList.add('open');
    detail.style.maxHeight = detail.scrollHeight + 'px';
  }
  chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.deleteHistEntry = function (key) {
  showModal({
    title: '¿Borrar registro?',
    msg: 'Se eliminará esta entrada del historial.',
    confirmLabel: 'Borrar',
    confirmClass: 'modal-btn-danger',
    onConfirm: () => {
      remove(ref(db, `${HIST_PATH}/${key}`));
      document.getElementById(`he-${key}`)?.remove();
      const remaining = updateHistToolbarCount();
      if (remaining === 0) closeHistory();
      toast('🗑️ Registro eliminado');
      return null;
    }
  });
};

window.clearHistory = function () {
  showModal({
    title: '🗑️ Borrar historial',
    msg: '¿Eliminar todo el historial de este local? Esta acción no se puede deshacer.',
    confirmLabel: 'Borrar todo',
    confirmClass: 'modal-btn-danger',
    onConfirm: () => {
      remove(ref(db, HIST_PATH));
      closeHistory();
      toast('🗑️ Historial eliminado');
      return null;
    }
  });
};

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
  HIST_PATH     = `historial_v1_${venue}`;

  // La pestaña activa se recuerda solo en ESTE dispositivo (localStorage),
  // nunca a través de Firebase, para que no afecte a otros usuarios.
  const storedTab = parseInt(localStorage.getItem(`ldl_tab_${venue}`), 10);
  localTab = Number.isFinite(storedTab) ? storedTab : 4;

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

// ── Admin ─────────────────────────────────────────────────
window.toggleAdminMode = function () {
  if (isAdmin) {
    isAdmin = false;
    document.getElementById('btnEditMode').classList.remove('active');
    document.getElementById('tab-btn-editor')?.classList.remove('visible');
    if (localTab === 99) switchTab(4);
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

// ── Normalización de Estado ───────────────────────────────
function normalizeState() {
  if (!state.names)      state.names      = ['Persona 1'];
  if (!state.selections) state.selections = [];
  if (!state.common)     state.common     = [];

  const totalItems = ITEMS ? ITEMS.length : 0;

  while (state.selections.length < state.names.length) state.selections.push([]);
  while (state.common.length < totalItems) state.common.push(0);

  state.selections.forEach((sel, idx) => {
    if (!sel) { sel = []; state.selections[idx] = sel; }
    while (sel.length < totalItems) sel.push({ solo: 0, shared: [] });
  });

  ensureKali();
  ensureCompra();
}

function ensureKali() {
  if (!state.kali) state.kali = { counts: [], wineBottles: 0, winePrice: 0, wineItemIdx: -1 };
  if (!state.kali.counts) state.kali.counts = [];
  while (state.kali.counts.length < state.names.length) state.kali.counts.push(0);
  if (state.kali.wineItemIdx === undefined) state.kali.wineItemIdx = -1;
}

// La "Compra" es un gasto (p.ej. súper) que se reparte entre TODOS los
// participantes, igual que los gastos comunes de la pestaña General,
// pero puede tener un pagador distinto al que pagó la cena.
function ensureCompra() {
  if (!state.compra) state.compra = { total: 0, payerIdx: 0 };
  if (typeof state.compra.total !== 'number' || isNaN(state.compra.total)) state.compra.total = 0;
  if (state.compra.payerIdx === undefined || state.compra.payerIdx === null) state.compra.payerIdx = 0;
  if (state.compra.payerIdx >= state.names.length) state.compra.payerIdx = 0;
}

// Si la pestaña local ya no tiene sentido (p.ej. alguien borró al
// participante que estabas viendo, o perdiste el modo admin) volvemos
// a la pestaña de Balances en vez de mostrar datos incorrectos.
function clampLocalTab() {
  if (localTab === 99 && !isAdmin) { localTab = 0; return; }
  if (localTab >= 5) {
    const pIdx = localTab - 5;
    if (pIdx < 0 || pIdx >= state.names.length) localTab = 0;
  }
}

function findColaIdx() {
  let idx = ITEMS.findIndex(it => /coca-cola$/i.test(it.n.trim()));
  if (idx === -1) idx = ITEMS.findIndex(it => /coca.cola/i.test(it.n) && !/zero/i.test(it.n));
  if (idx === -1) idx = ITEMS.findIndex(it => /coca.cola/i.test(it.n));
  return idx;
}

// ── Kali ──────────────────────────────────────────────────
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

// ── Compra (súper) ────────────────────────────────────────
window.updateCompraTotal = function (val) {
  ensureCompra();
  const num = parseFloat(val);
  state.compra.total = (isNaN(num) || num < 0) ? 0 : num;
  saveData();
  updateCalculations();
};

window.setCompraPayer = function (idx) {
  ensureCompra();
  state.compra.payerIdx = parseInt(idx, 10);
  saveData();
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
    if (state && state.names) {
      normalizeState();
      if (state.selections.length > 0) { renderNav(); renderAllViews(); updateCalculations(); }
    }
  }, (error) => {
    console.error('Error de sincronización (menú):', error);
    toast('⚠️ Error de sincronización con el menú');
  });

  onValue(ref(db, DB_PATH), (snapshot) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT')) {
      const data = snapshot.val();
      if (data) state = data;
      normalizeState();
      updateCalculations();
      return;
    }
    captureUiState();
    const data = snapshot.val();
    if (data) {
      state = data;
      normalizeState();
      if (!Object.keys(CATEGORIES).length) buildCategories();
      renderNav(); renderAllViews(); updateCalculations();
    } else {
      resetSelections(); saveData(); switchTab(4);
    }
  }, (error) => {
    console.error('Error de sincronización (cuenta):', error);
    toast('⚠️ Error de sincronización con el servidor');
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
  state.kali       = { counts: new Array(state.names.length).fill(0), wineBottles: 0, winePrice: 0, wineItemIdx: -1 };
  state.compra     = { total: 0, payerIdx: 0 };
}

window.softReset = function () {
  showModal({
    title: '🔄 Resetear contadores',
    msg: '¿Poner todos los contadores a cero?',
    confirmLabel: 'Resetear',
    onConfirm: () => { resetSelections(); state.payerIdx = 0; saveData(); switchTab(4); toast('🔄 Contadores a cero'); return null; }
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
      saveData(); renderNav(); renderAllViews(); switchTab(4);
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

// Nombres: syncNameTab actualiza estado + Firebase en tiempo real letra a letra
window.updateName  = function (idx, newName) { saveData(); };
window.syncNameTab = function (idx, newName) {
  state.names[idx] = newName || `Persona ${idx + 1}`;
  const btn = document.getElementById(`tab-btn-${idx + 5}`);
  if (btn) btn.innerText = state.names[idx];
  saveNameFast();
};

window.setPayer = function (idx) { state.payerIdx = parseInt(idx); saveData(); renderSummaryView(); };

window.addParticipant = function () {
  state.names.push(`Persona ${state.names.length + 1}`);
  normalizeState();
  saveData();
  switchTab(state.names.length + 4);
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
      ensureCompra();
      if (state.compra.payerIdx >= state.names.length) state.compra.payerIdx = 0;
      saveData(); switchTab(4); toast('👤 Persona eliminada');
      return null;
    }
  });
};

// ── Render Nav ────────────────────────────────────────────
function renderNav() {
  const nav = document.getElementById('navContainer');
  nav.innerHTML = '';
  // "Total" va primero: es la pestaña que combina cena + compra y la que
  // la gente suele querer ver nada más entrar.
  const tabs = [
    { id: 'tab-total',   label: '💰 Total',    idx: 4 },
    { id: 'tab-summary', label: '📊 Balances', idx: 0 },
    { id: 'tab-ticket',  label: '🧾 Ticket',   idx: 1 },
    { id: 'tab-general', label: '🌍 General',  idx: 2 },
    { id: 'tab-compra',  label: '🛒 Compra',   idx: 3 },
  ];
  tabs.forEach(t => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${localTab === t.idx ? 'active' : ''}`;
    btn.id = t.id; btn.innerText = t.label;
    btn.setAttribute('aria-label', t.label);
    btn.onclick = () => switchTab(t.idx);
    nav.appendChild(btn);
  });

  const btnEdit = document.createElement('button');
  btnEdit.id = 'tab-btn-editor';
  btnEdit.className = `tab-btn tab-btn-editor ${isAdmin ? 'visible' : ''} ${localTab === 99 ? 'active' : ''}`;
  btnEdit.innerText = '✏️ Editor';
  btnEdit.setAttribute('aria-label', 'Editor de menú');
  btnEdit.onclick = () => switchTab(99);
  nav.appendChild(btnEdit);

  state.names.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${localTab === i + 5 ? 'active' : ''}`;
    btn.id = `tab-btn-${i + 5}`; btn.innerText = name;
    btn.setAttribute('aria-label', `Ver consumo de ${name}`);
    btn.onclick = () => switchTab(i + 5);
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
  localTab = tabIdx;
  if (CURRENT_VENUE) {
    try { localStorage.setItem(`ldl_tab_${CURRENT_VENUE}`, tabIdx); } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const map = { 0: 'tab-summary', 1: 'tab-ticket', 2: 'tab-general', 3: 'tab-compra', 4: 'tab-total', 99: 'tab-btn-editor' };
  const targetId = map[tabIdx] || `tab-btn-${tabIdx}`;
  document.getElementById(targetId)?.classList.add('active');

  document.querySelectorAll('#views > div').forEach(v => v.classList.add('hidden'));
  const viewMap = { 0: 'view-summary', 1: 'view-global', 2: 'view-general', 3: 'view-compra', 4: 'view-total', 99: 'view-editor' };
  const viewId = viewMap[tabIdx] || `view-pax-${tabIdx - 5}`;
  document.getElementById(viewId)?.classList.remove('hidden');

  if (tabIdx === 0)  renderSummaryView();
  if (tabIdx === 1)  renderGlobalView();
  if (tabIdx === 2)  renderGeneralView();
  if (tabIdx === 3)  renderCompraView();
  if (tabIdx === 4)  renderTotalView();
  if (tabIdx === 99) renderEditorView();

  // Los botones de Copiar / Compartir viven ahora en la pestaña Total,
  // porque es la vista que combina cena + compra y es la que se comparte.
  document.getElementById('actionButtons').classList.toggle('hidden', tabIdx !== 4);
};

function renderAllViews() {
  clampLocalTab();
  const container = document.getElementById('views');
  container.innerHTML = '';
  ['view-summary', 'view-global', 'view-general', 'view-compra', 'view-total', 'view-editor'].forEach((id, i) => {
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
  switchTab(localTab);
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
      const visColor = item.v === 'pax' ? '#e5e5e5' : item.v === 'common' ? '#d4d4d4' : '#f2f2f2';
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

// ── Render Compra ─────────────────────────────────────────
function renderCompraView() {
  const container = document.getElementById('view-compra');
  ensureCompra();

  const numPax = state.names.length;
  const total  = state.compra.total || 0;
  const share  = total > 0 ? total / numPax : 0;

  const payerOpts = state.names.map((n, i) =>
    `<option value="${i}" ${i === state.compra.payerIdx ? 'selected' : ''}>${n}</option>`).join('');

  let balanceHtml = '';
  if (total > 0) {
    balanceHtml = `
    <div class="card"><div class="card-header"><span class="card-title">Balance de la Compra</span></div>
      <div class="balance-container" style="padding:15px">`;
    state.names.forEach((name, i) => {
      const isPayer = i === state.compra.payerIdx;
      const amount  = isPayer ? (total - share) : share;
      const label   = isPayer ? 'RECIBE' : 'DEBE';
      const symbol  = isPayer ? '+' : '-';
      balanceHtml += `
        <details>
          <summary>
            <div style="text-align:left"><b style="font-size:15px">${name}</b></div>
            <div class="amt-block"><small>${label}</small><span class="amt-big">${symbol}${amount.toFixed(2)}€</span></div>
          </summary>
          <div class="balance-detail-list">
            <div class="balance-detail-item"><span>Parte proporcional (${numPax} personas)</span><span>${share.toFixed(2)}€</span></div>
            ${isPayer ? `<div class="balance-detail-item"><span>Total pagado en la compra</span><span>${total.toFixed(2)}€</span></div>` : ''}
          </div>
        </details>`;
    });
    balanceHtml += `</div></div>`;
  }

  container.innerHTML = `
    <div class="general-banner">
      <div style="font-size:20px">🛒</div>
      <div><b>Compra del súper</b><br>Se reparte entre <b>todos</b> (${state.names.length} personas).
      Si quien pagó la compra es distinto de quien pagó la cena, se calculará por separado; si es la misma persona, se suma todo.</div>
    </div>
    <div class="card" style="padding:15px;">
      <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">Importe de la compra</span>
      <input type="number" step="0.01" min="0" class="editor-input" style="margin-top:8px;font-size:18px;padding:12px;"
        value="${state.compra.total || ''}" placeholder="0.00" oninput="updateCompraTotal(this.value)">
    </div>
    <div class="card" style="padding:15px;">
      <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">¿Quién pagó la compra?</span>
      <select onchange="setCompraPayer(this.value)" class="select-fancy" style="width:100%;margin-top:8px;padding:10px;font-size:16px;">${payerOpts}</select>
    </div>
    ${balanceHtml}
    <div style="height:30px"></div>`;
}

// ── Render Summary (solo Cena) ────────────────────────────
function renderSummaryView() {
  const container = document.getElementById('view-summary');
  const calc = calculateMath();
  const payerOpts = state.names.map((n, i) =>
    `<option value="${i}" ${i === state.payerIdx ? 'selected' : ''}>${n}</option>`).join('');

  let html = `
    <div class="card" style="padding:15px;border-left:5px solid var(--primary)">
      <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">¿Quién pagó la cena?</span>
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
            <div style="text-align:left"><b style="font-size:15px">${state.names[i]}</b>${isPayer ? `<br><small style="opacity:.8">Consumido: ${b.consumed.toFixed(2)}€</small>` : ''}</div>
            <div class="amt-block"><small>${label}</small><span class="amt-big">${symbol}${amount.toFixed(2)}€</span></div>
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

// ── Render Total (Cena + Compra combinados) ───────────────
// Muestra, con el mismo estilo de desplegables que Balances, quién debe
// pagar qué a quién teniendo en cuenta tanto la cena como la compra.
//
// Si la cena y la compra las pagó la MISMA persona, se muestra un único
// importe neto por persona (como antes).
//
// Si las pagó gente DISTINTA ("dualPayers"), entonces:
//  - una persona que deba a los dos pagadores ve DOS números grandes,
//    uno por cada pagador ("Debe a Fulano" / "Debe a Mengano").
//  - un pagador que además tenga que pagar su parte al otro pagador ve
//    a la vez el número que RECIBE y el número que DEBE, en vez de un
//    único neto que escondería una de las dos cifras.
function renderTotalView() {
  const container = document.getElementById('view-total');
  const settlement = calculateFinalSettlement();
  const dualPayers = settlement.compraTotal > 0.005 && settlement.compraPayerIdx !== settlement.cenaPayerIdx;

  let html = `
    <div class="card" style="padding:15px;border-left:5px solid var(--primary)">
      <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;">Total (cena + compra)</span>
      <div style="margin-top:6px;font-size:22px;font-weight:800;">${settlement.grandTotal.toFixed(2)}€</div>
      ${settlement.compraTotal > 0.005 ? `<div style="margin-top:4px;font-size:12px;color:var(--muted);font-weight:600;">Cena ${settlement.cena.grandTotal.toFixed(2)}€ · Compra ${settlement.compraTotal.toFixed(2)}€</div>` : ''}
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Quién debe a quién</span></div>
    <div class="balance-container" style="padding:15px">`;

  let any = false;
  state.names.forEach((name, i) => {
    const owes     = settlement.transactions.filter(t => t.from === i);
    const receives = settlement.transactions.filter(t => t.to === i);
    if (!owes.length && !receives.length) return;
    any = true;

    const totalReceive = receives.reduce((a, t) => a + t.amount, 0);
    const totalOwe     = owes.reduce((a, t) => a + t.amount, 0);

    const detailsList = [
      ...owes.map(t => `<div class="balance-detail-item"><span>Debe a ${state.names[t.to]}</span><span>${t.amount.toFixed(2)}€</span></div>`),
      ...receives.map(t => `<div class="balance-detail-item"><span>Recibe de ${state.names[t.from]}</span><span>${t.amount.toFixed(2)}€</span></div>`)
    ].join('');

    let chips, summaryClass;

    const showSeparate = dualPayers && (owes.length > 1 || (owes.length === 1 && totalReceive > 0.005));

    if (showSeparate) {
      // Dos pagadores distintos: no neteamos, mostramos cada cifra por su lado.
      chips = '';
      if (totalReceive > 0.005) {
        chips += `<div class="amt-block"><small>RECIBE</small><span class="amt-big">+${totalReceive.toFixed(2)}€</span></div>`;
      }
      owes.forEach(t => {
        chips += `<div class="amt-block"><small>DEBE A ${state.names[t.to].toUpperCase()}</small><span class="amt-big">-${t.amount.toFixed(2)}€</span></div>`;
      });
      summaryClass = totalReceive > 0.005 ? 'is-payer' : 'is-debtor';
    } else {
      const netAmount  = totalReceive - totalOwe;
      const isPositive = netAmount >= 0;
      summaryClass = isPositive ? 'is-payer' : 'is-debtor';
      chips = `<div class="amt-block"><small>${isPositive ? 'RECIBE' : 'DEBE'}</small><span class="amt-big">${isPositive ? '+' : '-'}${Math.abs(netAmount).toFixed(2)}€</span></div>`;
    }

    html += `
      <details>
        <summary class="${summaryClass}">
          <div style="text-align:left"><b style="font-size:15px">${name}</b></div>
          <div style="display:flex;gap:14px;align-items:center">${chips}</div>
        </summary>
        <div class="balance-detail-list">${detailsList}</div>
      </details>`;
  });

  if (!any) {
    html += `<div style="padding:20px;text-align:center;color:var(--muted)">Nadie debe nada todavía</div>`;
  }

  html += `</div></div><div style="height:30px"></div>`;
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
  const bottles        = state.kali.wineBottles || 0;
  const winePrice      = state.kali.winePrice   || 0;
  const totalKalis     = (state.kali.counts || []).reduce((a, b) => (a || 0) + (b || 0), 0);
  const totalWineCost  = bottles * winePrice;
  const costPerKali    = (totalKalis > 0 && totalWineCost > 0) ? totalWineCost / totalKalis : 0;

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
// calculateMath(): calcula el total y consumo de la CENA (selecciones,
// gastos comunes de "General" y kalimotxos). No incluye la Compra.
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

// calculateFinalSettlement(): combina la CENA (con su pagador state.payerIdx)
// y la COMPRA (con su propio pagador state.compra.payerIdx), y calcula
// quién debe qué a quién. Si ambos gastos los pagó la misma persona, las
// deudas hacia ella se suman en un único número. Si los pagó gente distinta,
// se calculan por separado (cada pareja deudor→pagador es una transacción
// independiente) para que la vista Total pueda mostrarlas sin mezclarlas.
//
// Además, se devuelven cenaTransactions y compraTransactions por separado
// (sin netear entre sí) para que el historial pueda diferenciar cuánto se
// debía por la cena y cuánto por la compra.
function calculateFinalSettlement() {
  const cena = calculateMath();
  ensureCompra();

  const numPax         = state.names.length;
  const compraTotal    = state.compra.total || 0;
  const compraPayerIdx = state.compra.payerIdx;
  const cenaPayerIdx   = state.payerIdx || 0;
  const compraShare    = compraTotal > 0 ? compraTotal / numPax : 0;
  const grandTotal      = cena.grandTotal + compraTotal;

  // debts[i][j] = cuánto debe la persona i a la persona j
  const debts = state.names.map(() => ({}));
  const cenaTransactions   = [];
  const compraTransactions = [];

  state.names.forEach((_, i) => {
    if (i !== cenaPayerIdx && cena.balances[i].consumed > 0.005) {
      debts[i][cenaPayerIdx] = (debts[i][cenaPayerIdx] || 0) + cena.balances[i].consumed;
      cenaTransactions.push({ from: i, to: cenaPayerIdx, amount: cena.balances[i].consumed });
    }
    if (i !== compraPayerIdx && compraShare > 0.005) {
      debts[i][compraPayerIdx] = (debts[i][compraPayerIdx] || 0) + compraShare;
      compraTransactions.push({ from: i, to: compraPayerIdx, amount: compraShare });
    }
  });

  // Neteamos deudas cruzadas entre la misma pareja de personas (esto cubre
  // el caso en que el pagador de la cena también deba su parte de la compra
  // al pagador de la compra, y viceversa).
  const transactions = [];
  const visited = new Set();
  state.names.forEach((_, i) => {
    Object.keys(debts[i]).forEach(jStr => {
      const j = parseInt(jStr, 10);
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (visited.has(key)) return;
      visited.add(key);
      const amtIJ = debts[i][j] || 0;
      const amtJI = (debts[j] && debts[j][i]) || 0;
      const net = amtIJ - amtJI;
      if (net > 0.005)       transactions.push({ from: i, to: j, amount: net });
      else if (net < -0.005) transactions.push({ from: j, to: i, amount: -net });
    });
  });

  return { grandTotal, cena, compraTotal, compraPayerIdx, cenaPayerIdx, compraShare, transactions, cenaTransactions, compraTransactions };
}

function updateCalculations() {
  const settlement = calculateFinalSettlement();
  document.getElementById('headerTotal').innerText = settlement.grandTotal.toFixed(2) + '€';

  // Desglosamos cena / compra bajo el total del header, solo cuando hay
  // compra registrada (si no, no aporta información nueva).
  const breakdownEl = document.getElementById('headerBreakdown');
  if (breakdownEl) {
    breakdownEl.innerText = settlement.compraTotal > 0.005
      ? `Cena ${settlement.cena.grandTotal.toFixed(2)}€ · Compra ${settlement.compraTotal.toFixed(2)}€`
      : '';
  }
}

// ── Mensaje para compartir ────────────────────────────────
// Mensaje ordenado y alineado (tabla en monoespaciado, formato que
// WhatsApp respeta con ``` ```), pero sin emoticonos.
function getBillText() {
  const settlement = calculateFinalSettlement();
  const now    = new Date();
  const date   = now.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const time   = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const venues = { aiur: 'Club Ciclista Irunés', ekhi: 'La Salle', galarza: 'Atsegiña' };
  const venue  = venues[CURRENT_VENUE] || 'La Dolorosa';

  const SEP    = '```';
  const AMT_W  = 9; // ancho columna importe, p.ej. "123.45 €"

  let t = `*${venue}*\n${date} · ${time}\n\n`;
  t += `*Total: ${settlement.grandTotal.toFixed(2)} €*\n`;
  if (settlement.compraTotal > 0.005) {
    t += `Cena: ${settlement.cena.grandTotal.toFixed(2)} € · Compra: ${settlement.compraTotal.toFixed(2)} €\n`;
  }

  if (settlement.transactions.length) {
    const nameW = Math.max(...state.names.map(n => n.length), 'De'.length, 'A'.length);
    let table  = `${'De'.padEnd(nameW)}  ${'A'.padEnd(nameW)}  ${'Importe'.padStart(AMT_W)}\n`;
    table     += `${'-'.repeat(nameW)}  ${'-'.repeat(nameW)}  ${'-'.repeat(AMT_W)}\n`;
    settlement.transactions.forEach(tr => {
      const from = state.names[tr.from].padEnd(nameW);
      const to   = state.names[tr.to].padEnd(nameW);
      const amt  = `${tr.amount.toFixed(2)} €`.padStart(AMT_W);
      table += `${from}  ${to}  ${amt}\n`;
    });
    t += `\n${SEP}\n${table}${SEP}`;
  } else {
    t += '\nNadie debe nada';
  }

  return t;
}

// ── Compartir / Copiar ────────────────────────────────────
window.shareNative = async function () {
  const text = getBillText();
  saveHistory();
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
  saveHistory();
  const btn  = document.getElementById('btnCopy');
  const orig = btn.innerHTML;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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
  // Guard: si ya se han enganchado los listeners una vez (p.ej. porque el
  // usuario volvió atrás y entró a otro local), no los volvemos a añadir.
  // Antes esto se repetía en cada init() y acumulaba listeners duplicados,
  // haciendo el arrastre cada vez más "loco" con cada cambio de local.
  if (dragScrollBound) return;
  dragScrollBound = true;

  const slider = document.getElementById('navContainer');
  let isDown = false, startX, scrollLeft;
  slider.addEventListener('mousedown', e => { isDown = true; slider.style.cursor = 'grabbing'; startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; });
  slider.addEventListener('mouseleave', () => { isDown = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mouseup',    () => { isDown = false; slider.style.cursor = 'grab'; });
  slider.addEventListener('mousemove',  e => { if (!isDown) return; e.preventDefault(); slider.scrollLeft = scrollLeft - (e.pageX - slider.offsetLeft - startX) * 2; });
}