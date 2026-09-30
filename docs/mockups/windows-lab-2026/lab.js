/* =========================================================================
   مختبر النوافذ — محاكاة حية كاملة (بيانات حقيقية قابلة للتعديل والحفظ)
   يطبّق المقترحات المنتقاة: MDI افتراضي · تركيز بإضاءة حواف · حفظ أوضاع
   النوافذ · Enter للحقل التالي · مفاتيح F · سلات متعددة · لوحة أوامر ·
   أدراج جانبية · إشعارات iOS · عدّاد حي · شاشة عميل · طباعة صامتة ·
   تخزين محلي أولاً مع مزامنة خلفية وهمية.
   ========================================================================= */

/* ============================ ① البيانات ============================ */
const KEY_DB = 'shopsys-lab-db-v1'
const KEY_WIN = 'shopsys-lab-windows-v1'
const money = (n) => (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const uid = (p) => `${p}${Math.random().toString(36).slice(2, 7)}`

const SEED = () => ({
  meta: { taxPercent: 14, invoiceSeq: 1042, currency: 'ج.م', shop: 'سوبر ماركت محمد عبده', phone: '01000000000' },
  items: [
    { id: 1, name: 'أرز مصري 5 كجم', sku: 'RICE-5', barcode: '6221031', price: 155, cost: 120, stock: 41, unit: 'كيس' },
    { id: 2, name: 'زيت عباد الشمس 1 لتر', sku: 'OIL-1L', barcode: '6221032', price: 65, cost: 52, stock: 40, unit: 'زجاجة' },
    { id: 3, name: 'سكر ناعم 1 كجم', sku: 'SUG-1', barcode: '6221033', price: 28, cost: 24, stock: 120, unit: 'كيس' },
    { id: 4, name: 'شاي العروسة 250 جم', sku: 'TEA-250', barcode: '6221034', price: 47, cost: 39, stock: 66, unit: 'علبة' },
    { id: 5, name: 'مكرونة 400 جم', sku: 'PST-400', barcode: '6221035', price: 14.5, cost: 11, stock: 210, unit: 'كيس' },
    { id: 6, name: 'لبن جهينة 1 لتر', sku: 'MLK-1L', barcode: '6221036', price: 36, cost: 30, stock: 8, unit: 'عبوة' },
  ],
  customers: [
    { id: 1, name: 'عميل نقدي', phone: '—', balance: 0, limit: 0 },
    { id: 2, name: 'شركة الأمل للتجارة', phone: '01000000001', balance: 1240, limit: 5000 },
    { id: 3, name: 'محل النور', phone: '01000000002', balance: 380, limit: 2000 },
  ],
  invoices: [],
})

let DB = load()
function load() {
  try {
    const raw = localStorage.getItem(KEY_DB)
    if (!raw) return SEED()
    const parsed = JSON.parse(raw)
    return parsed && parsed.items ? parsed : SEED()
  } catch { return SEED() }
}
function save() {
  localStorage.setItem(KEY_DB, JSON.stringify(DB))
  pulseSync()
}
function resetDB() { DB = SEED(); save(); carts = [newCart()]; activeCart = 0; refreshAll(); toast('أُعيدت البيانات التجريبية', 'ok') }

/* ======================= ② السلات (فواتير متعددة) ======================= */
const newCart = () => ({ id: uid('c'), no: `INV-${++DB.meta.invoiceSeq}`, customerId: 1, date: new Date().toISOString().slice(0, 10),
  pay: 'نقدي', lines: [], discount: 0, paid: 0, status: 'مسودة', sel: 0 })
let carts = [newCart()]
let activeCart = 0
const cart = () => carts[activeCart]

const lineTotal = (l) => {
  const it = DB.items.find((i) => i.id === l.itemId)
  const price = l.price ?? it?.price ?? 0
  return Math.max(0, price * (l.qty || 0) * (1 - (l.disc || 0) / 100))
}
function totals(c = cart()) {
  const sub = c.lines.reduce((s, l) => s + lineTotal(l), 0)
  const disc = sub * (c.discount || 0) / 100
  const net = sub - disc
  const tax = net * (DB.meta.taxPercent / 100)
  const grand = net + tax
  const cost = c.lines.reduce((s, l) => { const it = DB.items.find((i) => i.id === l.itemId); return s + (it?.cost ?? 0) * (l.qty || 0) }, 0)
  return { sub, disc, net, tax, grand, profit: net - cost, remain: Math.max(0, grand - (c.paid || 0)) }
}

/* ========================= ③ إدارة النوافذ (MDI) ========================= */
const stage = document.getElementById('stage')
const taskbar = document.getElementById('taskbar')
const hint = document.getElementById('hint')
const countChip = document.getElementById('count')
let z = 10, seq = 0
const wins = new Map()
const winRects = JSON.parse(localStorage.getItem(KEY_WIN) || '{}')
const rememberRect = (kind, el) => {
  winRects[kind] = { s: el.style.insetInlineStart, t: el.style.top, w: el.style.width, h: el.style.height }
  localStorage.setItem(KEY_WIN, JSON.stringify(winRects))
}

function openWindow(kind, opts = {}) {
  const def = VIEWS[kind]
  if (!def) return null
  if (def.single) {
    const found = [...wins.entries()].find(([, m]) => m.kind === kind)
    if (found) { focusWin(found[0]); if (def.render) rerender(found[0]); return found[0] }
  }
  const t = def.build(opts)
  const id = `w${++seq}`
  const el = document.createElement('div')
  el.className = `win ${t.cls ?? ''}`
  el.dataset.id = id; el.dataset.kind = kind
  const n = wins.size
  const saved = winRects[kind]
  const w = t.w ?? 520, h = t.h ?? 340
  if (!t.sheet) {
    el.style.width = (saved?.w) || w + 'px'
    el.style.height = (saved?.h) || h + 'px'
    el.style.insetInlineStart = (saved?.s) || Math.max(14, (stage.clientWidth - w) / 2 - 50 + n * 24) + 'px'
    el.style.top = (saved?.t) || Math.max(10, 24 + n * 24) + 'px'
  }
  el.style.zIndex = ++z
  el.innerHTML = `
    <header class="win-bar">
      <div class="win-dots">
        <button class="dot red" title="إغلاق (Ctrl+Alt+Q)" data-win="close"></button>
        <button class="dot amber" title="تصغير (Ctrl+Alt+M)" data-win="min"></button>
        <button class="dot green" title="تكبير (Ctrl+Alt+↑)" data-win="max"></button>
      </div>
      <div class="win-title">${t.title}<small>${t.sub ?? ''}</small></div>
      ${t.crumb ? `<span class="win-crumb">${t.crumb}</span>` : ''}
    </header>
    <div class="win-body">${t.body ?? ''}</div>
    ${t.foot ? `<footer class="win-foot">${t.foot}</footer>` : ''}
    ${t.sheet || t.popover ? '' : '<span class="grip n"></span><span class="grip s"></span><span class="grip e"></span><span class="grip w"></span><span class="grip se"></span><span class="grip sw"></span>'}`
  stage.appendChild(el)
  wins.set(id, { el, kind, title: t.title, min: false, max: false, prev: null, opts })
  wireWindow(el, id)
  def.mount?.(el, id, opts)
  focusWin(id); renderTaskbar()
  return id
}
function rerender(id) {
  const m = wins.get(id); if (!m) return
  const def = VIEWS[m.kind]; if (!def?.render) return
  def.render(m.el, id, m.opts)
}
function refreshAll() { [...wins.keys()].forEach(rerender); renderTaskbar() }

function wireWindow(el, id) {
  const meta = wins.get(id)
  el.addEventListener('pointerdown', () => focusWin(id), true)
  el.querySelector('[data-win="close"]').onclick = () => closeWin(id)
  el.querySelector('[data-win="min"]').onclick = () => minWin(id)
  el.querySelector('[data-win="max"]').onclick = () => maxWin(id)
  const bar = el.querySelector('.win-bar')
  bar.addEventListener('dblclick', () => maxWin(id))
  bar.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.dot') || meta.max || el.classList.contains('sheet')) return
    const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect()
    const offX = ev.clientX - r.left, offY = ev.clientY - r.top
    el.classList.add('dragging')
    let snap = null
    const move = (e) => {
      const maxX = Math.max(0, sr.width - r.width), maxY = Math.max(0, sr.height - 52 - r.height)
      const x = Math.min(Math.max(0, e.clientX - sr.left - offX), maxX)
      const y = Math.min(Math.max(0, e.clientY - sr.top - offY), maxY)
      el.style.insetInlineStart = (sr.width - x - r.width) + 'px'
      el.style.top = y + 'px'
      snap = snapZone(e.clientX - sr.left, e.clientY - sr.top, sr); drawSnap(snap, sr)
    }
    const up = () => {
      el.classList.remove('dragging'); clearSnap()
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (snap) applySnap(id, snap, sr)
      rememberRect(meta.kind, el)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  })
  el.querySelectorAll('.grip').forEach((g) => g.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation(); if (meta.max) return
    const dir = [...g.classList].find((c) => c !== 'grip')
    const r = el.getBoundingClientRect()
    const x0 = ev.clientX, y0 = ev.clientY, w0 = r.width, h0 = r.height
    const start = parseFloat(el.style.insetInlineStart || '0'), top0 = parseFloat(el.style.top || '0')
    el.classList.add('resizing')
    const move = (e) => {
      const dx = e.clientX - x0, dy = e.clientY - y0
      if (dir.includes('e')) { el.style.width = Math.max(300, w0 + dx) + 'px'; el.style.insetInlineStart = (start - dx) + 'px' }
      if (dir.includes('w')) el.style.width = Math.max(300, w0 - dx) + 'px'
      if (dir.includes('s')) el.style.height = Math.max(170, h0 + dy) + 'px'
      if (dir.includes('n')) { el.style.height = Math.max(170, h0 - dy) + 'px'; el.style.top = (top0 + dy) + 'px' }
    }
    const up = () => { el.classList.remove('resizing'); rememberRect(meta.kind, el); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }))
}
function focusWin(id) {
  const m = wins.get(id); if (!m) return
  if (m.min) { m.min = false; m.el.style.display = ''; m.el.style.animation = `winIn var(--dur-base) var(--spring)` }
  m.el.style.zIndex = ++z
  wins.forEach((x, k) => x.el.classList.toggle('is-active', k === id))
  renderTaskbar()
}
function closeWin(id) {
  const m = wins.get(id); if (!m) return
  rememberRect(m.kind, m.el)
  m.el.classList.add('closing')
  setTimeout(() => { m.el.remove(); wins.delete(id); const last = [...wins.keys()].pop(); if (last) focusWin(last); renderTaskbar() }, 150)
}
function minWin(id) {
  const m = wins.get(id); if (!m) return
  m.min = true; m.el.classList.add('minimizing')
  setTimeout(() => { m.el.style.display = 'none'; m.el.classList.remove('minimizing'); renderTaskbar() }, 200)
  const next = [...wins.entries()].filter(([k, x]) => !x.min && k !== id).pop(); if (next) focusWin(next[0])
}
function maxWin(id) {
  const m = wins.get(id); if (!m) return
  const el = m.el, sr = stage.getBoundingClientRect()
  if (m.max) { Object.assign(el.style, m.prev); m.max = false }
  else {
    m.prev = { insetInlineStart: el.style.insetInlineStart, top: el.style.top, width: el.style.width, height: el.style.height }
    Object.assign(el.style, { insetInlineStart: '0px', top: '0px', width: sr.width + 'px', height: (sr.height - 52) + 'px' })
    m.max = true
  }
  focusWin(id)
}
function arrange(mode) {
  const list = [...wins.entries()].filter(([, m]) => !m.min)
  const sr = stage.getBoundingClientRect(), H = sr.height - 52
  list.forEach(([, m], i) => {
    m.max = false
    if (mode === 'cascade') Object.assign(m.el.style, { insetInlineStart: (36 + i * 32) + 'px', top: (18 + i * 32) + 'px', width: '540px', height: '340px' })
    if (mode === 'tileH') { const h = H / list.length; Object.assign(m.el.style, { insetInlineStart: '0px', top: (i * h) + 'px', width: sr.width + 'px', height: h + 'px' }) }
    if (mode === 'tileV') { const w = sr.width / list.length; Object.assign(m.el.style, { insetInlineStart: (i * w) + 'px', top: '0px', width: w + 'px', height: H + 'px' }) }
  })
  toast(mode === 'cascade' ? 'ترتيب: تتالي' : mode === 'tileH' ? 'ترتيب: تجانب أفقي' : 'ترتيب: تجانب رأسي')
}
/* الالتقاط بالحواف */
function snapZone(x, y, sr) {
  const edge = 40
  if (y < edge) return 'max'
  if (x < edge) return y < sr.height / 2 ? 'tl' : 'bl'
  if (x > sr.width - edge) return y < sr.height / 2 ? 'tr' : 'br'
  return null
}
const snapRect = (zone, sr) => {
  const W = sr.width, H = sr.height - 52
  return { max: { x: 0, y: 0, w: W, h: H }, tl: { x: 0, y: 0, w: W / 2, h: H }, bl: { x: 0, y: H / 2, w: W / 2, h: H / 2 },
    tr: { x: W / 2, y: 0, w: W / 2, h: H }, br: { x: W / 2, y: H / 2, w: W / 2, h: H / 2 } }[zone]
}
let snapEl = null
function drawSnap(zone, sr) {
  if (!zone) return clearSnap()
  const r = snapRect(zone, sr)
  if (!snapEl) { snapEl = document.createElement('div'); snapEl.className = 'snap-preview'; stage.appendChild(snapEl) }
  Object.assign(snapEl.style, { insetInlineStart: (sr.width - r.x - r.w) + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
}
const clearSnap = () => { snapEl?.remove(); snapEl = null }
function applySnap(id, zone, sr) {
  const { el } = wins.get(id), r = snapRect(zone, sr)
  Object.assign(el.style, { insetInlineStart: (sr.width - r.x - r.w) + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
  toast(zone === 'max' ? 'التُقطت: ملء المساحة' : 'التُقطت النافذة إلى الحافة')
}
function renderTaskbar() {
  const list = [...wins.entries()]
  taskbar.innerHTML = `<span class="tb-label">النوافذ المفتوحة (${list.length})</span>` + list.map(([id, m], i) =>
    `<button class="task ${m.el.classList.contains('is-active') && !m.min ? 'is-active' : ''} ${m.min ? 'is-min' : ''}" data-task="${id}">${m.title}<kbd>${i + 1}</kbd></button>`).join('')
  taskbar.querySelectorAll('[data-task]').forEach((b) => b.onclick = () => focusWin(b.dataset.task))
  countChip.textContent = `${list.length} نوافذ`
  hint.style.opacity = list.length ? 0 : 1
}

/* ====================== ④ إشعارات / تراجع / مزامنة ====================== */
const toastBox = document.getElementById('toasts')
function toast(msg, kind = '') {
  const t = document.createElement('div')
  t.className = `toast ${kind}`; t.textContent = msg
  toastBox.appendChild(t)
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 180) }, 2200)
}
let undoTimer = null
function undoBar(msg, onUndo) {
  document.querySelector('.undobar')?.remove(); clearTimeout(undoTimer)
  const bar = document.createElement('div')
  bar.className = 'undobar'
  bar.innerHTML = `<span>${msg}</span><span class="u-prog"><i></i></span><button class="btn sm" style="background:#fff;color:#0f172a">تراجع</button>`
  stage.appendChild(bar)
  bar.querySelector('button').onclick = () => { bar.remove(); onUndo(); toast('تم التراجع', 'ok') }
  undoTimer = setTimeout(() => bar.remove(), 6000)
}
const syncDot = document.getElementById('syncDot')
function pulseSync() {
  if (!syncDot) return
  syncDot.textContent = 'جارٍ المزامنة…'
  clearTimeout(pulseSync.t)
  pulseSync.t = setTimeout(() => { syncDot.textContent = 'محفوظ محلياً · متزامن' }, 700)
}

/* ====================== ⑤ عدّاد حي للأرقام (Live Counter) ====================== */
function animateNumber(el, to) {
  const from = Number(el.dataset.v || 0)
  if (Math.abs(from - to) < 0.005) { el.textContent = money(to); el.dataset.v = to; return }
  el.dataset.v = to
  el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 160)
  const t0 = performance.now(), dur = 260
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - k, 3)
    el.textContent = money(from + (to - from) * e)
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/* =========================== ⑥ منتقي مرتبط =========================== */
let anchorPop = null
function closeAnchor() { anchorPop?.remove(); anchorPop = null }
function openAnchorPicker(input, list, onPick, render, original = null) {
  closeAnchor()
  let picked = false
  const r = input.getBoundingClientRect(), sr = stage.getBoundingClientRect()
  anchorPop = document.createElement('div')
  anchorPop.className = 'anchor-pop'
  anchorPop.style.top = (r.bottom - sr.top + 4) + 'px'
  anchorPop.style.insetInlineStart = (sr.right - r.right) + 'px'
  stage.appendChild(anchorPop)
  let idx = 0, data = list
  const paint = () => {
    anchorPop.innerHTML = data.length ? data.map((o, i) => `<div class="opt ${i === idx ? 'is-on' : ''}" data-i="${i}">${render(o)}</div>`).join('')
      : '<div class="opt">لا نتائج — <b>اضغط Enter لإضافة جديد</b></div>'
    anchorPop.querySelectorAll('.opt[data-i]').forEach((o) => o.onmousedown = (e) => { e.preventDefault(); picked = true; onPick(data[Number(o.dataset.i)]) })
  }
  paint()
  const filter = () => {
    const q = input.value.trim()
    data = q ? list.filter((o) => (o._search ?? '').includes(q)) : list
    idx = 0; paint()
  }
  input.oninput = filter
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(data.length - 1, idx + 1); paint() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint() }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); picked = !!data[idx]; onPick(data[idx] ?? null) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAnchor(); input.blur() }
  }
  input.onblur = () => setTimeout(() => {
    closeAnchor()
    if (!picked && original != null) input.value = original
  }, 120)
  return anchorPop
}

/* ============================ ⑦ الشاشات ============================ */
const VIEWS = {}

/* ---------- الفاتورة: ترويسة ذكية + جدول مكثف + تذييل جريء ---------- */
VIEWS.invoice = {
  single: true,
  build: () => ({ title: 'فاتورة مبيعات', sub: 'ترويسة ذكية · جدول مكثف · إجماليات جريئة', w: 780, h: 500, cls: 'invoice-win', body: '<div data-inv-root></div>',
    foot: `<span class="hint">F2 سطر · F3 صنف · F4 خصم السطر · F8 تعليق · F9 حفظ وإصدار · F12 طباعة · Ctrl+Shift+N عميل</span>
      <div class="spacer"></div>
      <button class="btn sm" data-act="hold">تعليق <kbd>F8</kbd></button>
      <button class="btn sm" data-act="print">طباعة <kbd>F12</kbd></button>
      <button class="btn primary sm" data-act="save">حفظ وإصدار <kbd>F9</kbd></button>` }),
  mount: (el, id) => {
    VIEWS.invoice.render(el, id)
    el.querySelector('[data-act="hold"]').onclick = holdCart
    el.querySelector('[data-act="print"]').onclick = () => printReceipt()
    el.querySelector('[data-act="save"]').onclick = () => saveInvoice()
  },
  render: (el) => {
    const root = el.querySelector('[data-inv-root]'); if (!root) return
    const c = cart(), t = totals(c)
    const cust = DB.customers.find((x) => x.id === c.customerId)
    const selLine = c.lines[c.sel]
    const selItem = selLine && DB.items.find((i) => i.id === selLine.itemId)
    root.innerHTML = `
      <div class="inv-tabs" data-tabs>
        ${carts.map((k, i) => `<span class="inv-tab ${i === activeCart ? 'is-active' : ''}" data-tab="${i}">${k.no}${k.lines.length ? ` · ${k.lines.length}` : ''}<span class="x" data-close-tab="${i}">✕</span></span>`).join('')}
        <button class="btn sm" data-new-tab>+ سلة جديدة <kbd>Ctrl+T</kbd></button>
      </div>
      <div class="inv-head">
        <div class="field"><label>العميل <kbd>F3</kbd></label><input data-f="customer" value="${cust?.name ?? ''}" placeholder="اكتب للبحث…"></div>
        <div class="field"><label>التاريخ</label><input data-f="date" type="date" value="${c.date}"></div>
        <div class="field"><label>طريقة الدفع</label><select data-f="pay">${['نقدي', 'آجل', 'بطاقة', 'محفظة'].map((p) => `<option ${p === c.pay ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field"><label>الباركود / رقم الفاتورة</label><input data-f="barcode" placeholder="امسح باركود…" title="اكتب باركود واضغط Enter"></div>
      </div>
      <div class="inv-grid-wrap" style="max-height:170px">
        <table class="grid">
          <thead><tr><th style="width:34px">م</th><th>الصنف / الوصف</th><th style="width:70px">الكمية</th><th style="width:82px">السعر</th><th style="width:62px">خصم %</th><th style="width:92px">الإجمالي</th><th style="width:38px"></th></tr></thead>
          <tbody data-lines>
            ${c.lines.map((l, i) => {
              const it = DB.items.find((x) => x.id === l.itemId)
              return `<tr class="${i === c.sel ? 'is-sel' : ''}" data-row="${i}">
                <td>${i + 1}</td>
                <td><input data-cell="name" data-i="${i}" value="${it?.name ?? ''}" placeholder="اكتب اسم صنف…"></td>
                <td><input data-cell="qty" data-i="${i}" value="${l.qty}" inputmode="decimal"></td>
                <td><input data-cell="price" data-i="${i}" value="${l.price ?? it?.price ?? 0}" inputmode="decimal"></td>
                <td><input data-cell="disc" data-i="${i}" value="${l.disc || 0}" inputmode="decimal"></td>
                <td class="money">${money(lineTotal(l))}</td>
                <td><button class="btn sm danger" data-del="${i}" title="حذف (Delete)">✕</button></td>
              </tr>`
            }).join('') || `<tr><td colspan="7"><div class="empty"><div class="art">▤</div><b>لا بنود بعد</b><span class="hint">اضغط <kbd>F2</kbd> لإضافة سطر أو امسح باركود</span></div></td></tr>`}
          </tbody>
        </table>
      </div>
      ${selItem ? `<div class="inv-card">
        <b>${selItem.name}</b>
        <span class="chip ${selItem.stock <= 10 ? 'bad' : 'ok'}">المخزون ${selItem.stock} ${selItem.unit}</span>
        <span class="chip">التكلفة ${money(selItem.cost)}</span>
        <span class="chip">الهامش ${money((selLine.price ?? selItem.price) - selItem.cost)}</span>
        <span class="hint">${selItem.sku} · باركود ${selItem.barcode}</span>
        <span class="spacer" style="flex:1"></span>
        <button class="btn sm" data-open-prices="${selItem.id}">أسعار الصنف</button>
        <button class="btn sm" data-open-item="${selItem.id}">تعديل الصنف</button>
      </div>` : ''}
      <div class="inv-foot">
        <div>
          <div class="field"><label>خصم الفاتورة %</label><input data-f="discount" value="${c.discount}" inputmode="decimal"></div>
          <div class="field"><label>المدفوع</label><input data-f="paid" value="${c.paid}" inputmode="decimal"></div>
        </div>
        <div>
          <div class="sum"><span>إجمالي البنود</span><b><span class="counter" data-sum="sub">${money(t.sub)}</span></b></div>
          <div class="sum"><span>الخصم</span><b><span class="counter" data-sum="disc">${money(t.disc)}</span></b></div>
          <div class="sum"><span>الضريبة ${DB.meta.taxPercent}%</span><b><span class="counter" data-sum="tax">${money(t.tax)}</span></b></div>
          <div class="sum"><span>الربح المتوقع</span><b><span class="counter" data-sum="profit">${money(t.profit)}</span></b></div>
        </div>
        <div>
          <div class="sum grand"><span>الإجمالي</span><b><span class="counter" data-sum="grand">${money(t.grand)}</span> ${DB.meta.currency}</b></div>
          <div class="sum"><span>المتبقي على العميل</span><b><span class="counter" data-sum="remain">${money(t.remain)}</span></b></div>
          <div class="sum"><span>الحالة</span><b><span class="chip ${c.status === 'مُصدرة' ? 'ok' : c.status === 'معلَّقة' ? 'warn' : ''}">${c.status}</span></b></div>
        </div>
      </div>`
    wireInvoice(el, root)
  },
}

function wireInvoice(el, root) {
  const c = cart()
  root.querySelectorAll('[data-tab]').forEach((t) => t.onclick = (e) => {
    if (e.target.dataset.closeTab !== undefined) return
    activeCart = Number(t.dataset.tab); refreshAll()
  })
  root.querySelectorAll('[data-close-tab]').forEach((x) => x.onclick = (e) => {
    e.stopPropagation()
    const i = Number(x.dataset.closeTab)
    const removed = carts[i]
    carts.splice(i, 1); if (!carts.length) carts = [newCart()]
    activeCart = Math.max(0, Math.min(activeCart, carts.length - 1)); refreshAll()
    undoBar(`أُغلقت السلة ${removed.no}`, () => { carts.splice(i, 0, removed); activeCart = i; refreshAll() })
  })
  root.querySelector('[data-new-tab]').onclick = () => { carts.push(newCart()); activeCart = carts.length - 1; refreshAll(); toast('سلة جديدة') }

  /* الترويسة */
  const custInput = root.querySelector('[data-f="customer"]')
  custInput.onfocus = () => {
    const original = custInput.value
    custInput.select()
    openAnchorPicker(custInput,
      DB.customers.map((x) => ({ ...x, _search: `${x.name} ${x.phone}` })),
      (choice) => {
        if (!choice) { const typed = custInput.value.trim(); closeAnchor(); custInput.value = original; openDrawer('customer', { name: typed }); return }
        c.customerId = choice.id; closeAnchor(); refreshAll(); toast(`العميل: ${choice.name}`)
      },
      (o) => `<span>${o.name}</span><small>${o.phone}</small><small>${o.balance ? money(o.balance) : ''}</small>`,
      original)
  }
  root.querySelector('[data-f="date"]').onchange = (e) => { c.date = e.target.value }
  root.querySelector('[data-f="pay"]').onchange = (e) => { c.pay = e.target.value; updateCustomerDisplay() }
  const bc = root.querySelector('[data-f="barcode"]')
  bc.onkeydown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const found = DB.items.find((i) => i.barcode === bc.value.trim() || i.sku === bc.value.trim())
    if (found) { addLine(found.id); bc.value = ''; toast(`أُضيف: ${found.name}`, 'ok') }
    else { bc.classList.add('shake'); setTimeout(() => bc.classList.remove('shake'), 320); toast('باركود غير معروف', 'bad') }
  }
  /* الخصم/المدفوع */
  root.querySelector('[data-f="discount"]').oninput = (e) => { c.discount = Number(e.target.value) || 0; softTotals(el) }
  root.querySelector('[data-f="paid"]').oninput = (e) => { c.paid = Number(e.target.value) || 0; softTotals(el) }

  /* خلايا الجدول */
  root.querySelectorAll('[data-cell]').forEach((input) => {
    const i = Number(input.dataset.i), kind = input.dataset.cell
    input.onfocus = () => { c.sel = i; markSel(root, i) }
    if (kind === 'name') {
      input.onfocus = () => {
        c.sel = i; markSel(root, i)
        const original = input.value
        input.select()
        openAnchorPicker(input, DB.items.map((x) => ({ ...x, _search: `${x.name} ${x.sku} ${x.barcode}` })),
          (choice) => {
            if (!choice) { const typed = input.value.trim(); closeAnchor(); input.value = original; openDrawer('item', { name: typed }); return }
            c.lines[i].itemId = choice.id; c.lines[i].price = choice.price
            closeAnchor(); rerenderInvoice(); focusCell(i, 'qty')
          },
          (o) => `<span>${o.name}</span><small>${o.stock} ${o.unit}</small><small>${money(o.price)}</small>`,
          original)
      }
    } else {
      input.oninput = () => {
        const v = Number(input.value) || 0
        if (kind === 'qty') c.lines[i].qty = v
        if (kind === 'price') c.lines[i].price = v
        if (kind === 'disc') c.lines[i].disc = Math.min(100, Math.max(0, v))
        const row = input.closest('tr')
        row.querySelector('.money').textContent = money(lineTotal(c.lines[i]))
        softTotals(el); updateCustomerDisplay()
      }
    }
  })
  root.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => removeLine(Number(b.dataset.del)))
  root.querySelector('[data-open-prices]')?.addEventListener('click', (e) => openWindow('prices', { itemId: Number(e.currentTarget.dataset.openPrices) }))
  root.querySelector('[data-open-item]')?.addEventListener('click', (e) => openDrawer('item', { id: Number(e.currentTarget.dataset.openItem) }))
}
const rerenderInvoice = () => { [...wins.entries()].filter(([, m]) => m.kind === 'invoice').forEach(([id]) => rerender(id)); updateCustomerDisplay() }
function markSel(root, i) {
  root.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('is-sel', Number(tr.dataset.row) === i))
}
function softTotals(el) {
  const t = totals()
  const map = { sub: t.sub, disc: t.disc, tax: t.tax, profit: t.profit, grand: t.grand, remain: t.remain }
  el.querySelectorAll('[data-sum]').forEach((s) => animateNumber(s, map[s.dataset.sum]))
  updateCustomerDisplay()
}
function focusCell(i, kind) {
  setTimeout(() => {
    const el = document.querySelector(`[data-cell="${kind}"][data-i="${i}"]`)
    el?.focus(); el?.select?.()
  }, 30)
}
function addLine(itemId = null) {
  const c = cart()
  c.lines.push({ itemId, qty: 1, price: itemId ? DB.items.find((i) => i.id === itemId)?.price : 0, disc: 0 })
  c.sel = c.lines.length - 1
  rerenderInvoice()
  focusCell(c.sel, itemId ? 'qty' : 'name')
}
function removeLine(i) {
  const c = cart(); const copy = c.lines[i]
  if (!copy) return
  c.lines.splice(i, 1); c.sel = Math.max(0, Math.min(c.sel, c.lines.length - 1))
  rerenderInvoice()
  undoBar('حُذف السطر', () => { c.lines.splice(i, 0, copy); rerenderInvoice() })
}
function holdCart() {
  const c = cart(); c.status = 'معلَّقة'
  toast(`عُلِّقت ${c.no} — ابدأ سلة جديدة`, 'ok')
  carts.push(newCart()); activeCart = carts.length - 1; refreshAll()
}
function saveInvoice() {
  const c = cart(), t = totals(c)
  if (!c.lines.length || c.lines.every((l) => !l.itemId)) { toast('لا يمكن إصدار فاتورة بلا بنود', 'bad'); return }
  c.lines.forEach((l) => { const it = DB.items.find((i) => i.id === l.itemId); if (it) it.stock = Math.max(0, it.stock - (l.qty || 0)) })
  const cust = DB.customers.find((x) => x.id === c.customerId)
  if (cust && c.pay === 'آجل') cust.balance += t.remain
  DB.invoices.push({ no: c.no, date: c.date, customer: cust?.name, pay: c.pay, total: t.grand, profit: t.profit,
    lines: c.lines.map((l) => ({ ...l, name: DB.items.find((i) => i.id === l.itemId)?.name })) })
  c.status = 'مُصدرة'
  save(); refreshAll()
  toast(`صدرت ${c.no} بإجمالي ${money(t.grand)} ${DB.meta.currency}`, 'ok')
  const winId = [...wins.entries()].find(([, m]) => m.kind === 'invoice')?.[0]
  if (winId) { const el = wins.get(winId).el; el.classList.add('print-flash'); setTimeout(() => el.classList.remove('print-flash'), 400) }
  printReceipt(true)
  setTimeout(() => { carts[activeCart] = newCart(); refreshAll() }, 900)
}

/* ---------- الأصناف (قائمة قابلة للتعديل) ---------- */
VIEWS.items = {
  single: true,
  build: () => ({ title: 'الأصناف', sub: 'إضافة · تعديل · حذف — بيانات حقيقية تُحفظ', w: 620, h: 380, body: '<div data-items-root></div>',
    foot: `<button class="btn sm primary" data-add-item>+ صنف جديد</button><div class="spacer"></div><span class="hint">انقر أي خلية لتعديلها مباشرة</span>` }),
  mount: (el, id) => { VIEWS.items.render(el, id); el.querySelector('[data-add-item]').onclick = () => openDrawer('item', {}) },
  render: (el) => {
    const root = el.querySelector('[data-items-root]')
    root.innerHTML = `<table class="grid"><thead><tr><th>الصنف</th><th style="width:88px">الكود</th><th style="width:70px">السعر</th><th style="width:70px">التكلفة</th><th style="width:66px">المخزون</th><th style="width:78px"></th></tr></thead>
      <tbody>${DB.items.map((it) => `<tr data-id="${it.id}">
        <td><input data-e="name" value="${it.name}"></td>
        <td><input data-e="sku" value="${it.sku}"></td>
        <td><input data-e="price" value="${it.price}"></td>
        <td><input data-e="cost" value="${it.cost}"></td>
        <td><input data-e="stock" value="${it.stock}" class="${it.stock <= 10 ? 'low' : ''}"></td>
        <td><button class="btn sm" data-add="${it.id}">للفاتورة</button> <button class="btn sm danger" data-rm="${it.id}">✕</button></td></tr>`).join('')}</tbody></table>`
    root.querySelectorAll('input[data-e]').forEach((inp) => inp.onchange = () => {
      const id = Number(inp.closest('tr').dataset.id), f = inp.dataset.e
      const it = DB.items.find((x) => x.id === id)
      it[f] = ['price', 'cost', 'stock'].includes(f) ? Number(inp.value) || 0 : inp.value
      save(); rerenderInvoice(); toast('حُفظ التعديل', 'ok')
    })
    root.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { addLine(Number(b.dataset.add)); toast('أُضيف للفاتورة', 'ok') })
    root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      const id = Number(b.dataset.rm), at = DB.items.findIndex((x) => x.id === id), copy = DB.items[at]
      DB.items.splice(at, 1); save(); refreshAll()
      undoBar(`حُذف الصنف «${copy.name}»`, () => { DB.items.splice(at, 0, copy); save(); refreshAll() })
    })
  },
}

/* ---------- العملاء ---------- */
VIEWS.customers = {
  single: true,
  build: () => ({ title: 'العملاء', sub: 'بطاقة ٣٦٠° — رصيد وحد ائتمان قابلان للتعديل', w: 560, h: 340, body: '<div data-cust-root></div>',
    foot: `<button class="btn sm primary" data-add-cust>+ عميل جديد <kbd>Ctrl+Shift+N</kbd></button><div class="spacer"></div>` }),
  mount: (el, id) => { VIEWS.customers.render(el, id); el.querySelector('[data-add-cust]').onclick = () => openDrawer('customer', {}) },
  render: (el) => {
    const root = el.querySelector('[data-cust-root]')
    root.innerHTML = `<table class="grid"><thead><tr><th>الاسم</th><th style="width:110px">الهاتف</th><th style="width:88px">الرصيد</th><th style="width:88px">حد الائتمان</th><th style="width:96px"></th></tr></thead>
      <tbody>${DB.customers.map((c) => `<tr data-id="${c.id}">
        <td><input data-e="name" value="${c.name}"></td>
        <td><input data-e="phone" value="${c.phone}"></td>
        <td><input data-e="balance" value="${c.balance}"></td>
        <td><input data-e="limit" value="${c.limit}"></td>
        <td><button class="btn sm" data-use="${c.id}">للفاتورة</button> <button class="btn sm" data-led="${c.id}">كشف</button></td></tr>`).join('')}</tbody></table>`
    root.querySelectorAll('input[data-e]').forEach((inp) => inp.onchange = () => {
      const id = Number(inp.closest('tr').dataset.id), f = inp.dataset.e
      const c = DB.customers.find((x) => x.id === id)
      c[f] = ['balance', 'limit'].includes(f) ? Number(inp.value) || 0 : inp.value
      save(); rerenderInvoice(); toast('حُفظ التعديل', 'ok')
    })
    root.querySelectorAll('[data-use]').forEach((b) => b.onclick = () => { cart().customerId = Number(b.dataset.use); rerenderInvoice(); toast('تم اختيار العميل', 'ok') })
    root.querySelectorAll('[data-led]').forEach((b) => b.onclick = () => openWindow('ledger', { id: Number(b.dataset.led) }))
  },
}

/* ---------- كشف حساب العميل ---------- */
VIEWS.ledger = {
  build: (o) => {
    const c = DB.customers.find((x) => x.id === o.id)
    const rows = DB.invoices.filter((i) => i.customer === c?.name)
    return { title: `كشف حساب — ${c?.name ?? ''}`, sub: 'من الفواتير المُصدرة فعلاً', w: 460, h: 300, crumb: 'العملاء ← كشف حساب',
      body: `<div class="row"><div class="field"><label>الرصيد</label><input value="${money(c?.balance ?? 0)}" readonly></div>
        <div class="field"><label>حد الائتمان</label><input value="${money(c?.limit ?? 0)}" readonly></div></div>
        <table class="mini"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الدفع</th><th>القيمة</th></tr></thead><tbody>
        ${rows.length ? rows.map((r) => `<tr><td>${r.no}</td><td>${r.date}</td><td>${r.pay}</td><td>${money(r.total)}</td></tr>`).join('')
          : '<tr><td colspan="4"><div class="empty"><div class="art">▦</div><b>لا فواتير بعد</b><span class="hint">أصدر فاتورة لهذا العميل وستظهر هنا</span></div></td></tr>'}
        </tbody></table>`, foot: `<div class="spacer"></div><span class="hint">تتحدث تلقائياً بعد كل إصدار</span>` }
  },
}

/* ---------- أسعار الصنف ---------- */
VIEWS.prices = {
  build: (o) => {
    const it = DB.items.find((x) => x.id === o.itemId) ?? DB.items[0]
    const margin = it.price - it.cost
    return { title: `أسعار الصنف — ${it.name}`, sub: 'قابلة للتعديل وتنعكس على الفاتورة فوراً', w: 420, h: 290, crumb: 'فاتورة ← صنف ← الأسعار',
      body: `<div class="row"><div class="field"><label>سعر التجزئة</label><input data-p="price" value="${it.price}"></div>
        <div class="field"><label>التكلفة</label><input data-p="cost" value="${it.cost}"></div></div>
        <div class="row"><div class="field"><label>الهامش</label><input value="${money(margin)}" readonly></div>
        <div class="field"><label>نسبة الهامش</label><input value="${money(it.price ? margin / it.price * 100 : 0)}%" readonly></div></div>
        <table class="mini"><thead><tr><th>القائمة</th><th>السعر</th></tr></thead><tbody>
          <tr><td>الأساسية</td><td>${money(it.price)}</td></tr>
          <tr><td>الجملة (−7%)</td><td>${money(it.price * .93)}</td></tr>
          <tr><td>نصف الجملة (−4%)</td><td>${money(it.price * .96)}</td></tr></tbody></table>`,
      foot: `<button class="btn sm" data-close>إغلاق</button><div class="spacer"></div><button class="btn primary sm" data-save-price>حفظ السعر</button>`,
      _id: it.id }
  },
  mount: (el, id, o) => {
    const itemId = o.itemId ?? DB.items[0].id
    el.querySelector('[data-close]').onclick = () => closeWin(id)
    el.querySelector('[data-save-price]').onclick = () => {
      const it = DB.items.find((x) => x.id === itemId)
      it.price = Number(el.querySelector('[data-p="price"]').value) || it.price
      it.cost = Number(el.querySelector('[data-p="cost"]').value) || it.cost
      save(); refreshAll(); toast('حُدِّث سعر الصنف وانعكس على الفاتورة', 'ok')
    }
  },
}

/* ---------- تقرير اليوم (يثبت أن البيانات حقيقية) ---------- */
VIEWS.report = {
  single: true,
  build: () => ({ title: 'تقرير اليوم', sub: 'محسوب من الفواتير المُصدرة', w: 480, h: 320, body: '<div data-rep-root></div>',
    foot: `<div class="spacer"></div><button class="btn sm danger" data-reset>إعادة البيانات التجريبية</button>` }),
  mount: (el, id) => { VIEWS.report.render(el, id); el.querySelector('[data-reset]').onclick = resetDB },
  render: (el) => {
    const root = el.querySelector('[data-rep-root]')
    const inv = DB.invoices
    const total = inv.reduce((s, i) => s + i.total, 0), profit = inv.reduce((s, i) => s + i.profit, 0)
    const low = DB.items.filter((i) => i.stock <= 10)
    root.innerHTML = `
      <div class="row3">
        <div class="field"><label>عدد الفواتير</label><input value="${inv.length}" readonly></div>
        <div class="field"><label>إجمالي المبيعات</label><input value="${money(total)}" readonly></div>
        <div class="field"><label>الربح</label><input value="${money(profit)}" readonly></div>
      </div>
      <table class="mini"><thead><tr><th>فاتورة</th><th>العميل</th><th>الدفع</th><th>القيمة</th></tr></thead><tbody>
      ${inv.length ? inv.slice().reverse().map((i) => `<tr><td>${i.no}</td><td>${i.customer}</td><td>${i.pay}</td><td>${money(i.total)}</td></tr>`).join('')
        : '<tr><td colspan="4"><div class="empty"><div class="art">▤</div><b>لا مبيعات بعد</b><span class="hint">أصدر فاتورة بـ F9 وستظهر هنا فوراً</span></div></td></tr>'}</tbody></table>
      ${low.length ? `<p class="hint" style="margin-top:.4rem">⚠ أصناف تحت حد الطلب: ${low.map((i) => `${i.name} (${i.stock})`).join(' · ')}</p>` : ''}`
  },
}

/* ---------- إيصال حراري + طباعة صامتة ---------- */
VIEWS.receipt = {
  single: true,
  build: (o) => ({ title: 'إيصال حراري 80mm', sub: o.silent ? 'طباعة صامتة — بلا حوار طابعة' : 'معاينة قبل الطباعة', w: 320, h: 430, cls: 'glass',
    body: `<div class="receipt" data-receipt></div>`, foot: `<button class="btn sm" data-close>إغلاق</button><div class="spacer"></div><button class="btn primary sm" data-print>طباعة صامتة</button>` }),
  mount: (el, id) => {
    VIEWS.receipt.render(el, id)
    el.querySelector('[data-close]').onclick = () => closeWin(id)
    el.querySelector('[data-print]').onclick = () => {
      el.classList.add('print-flash'); setTimeout(() => el.classList.remove('print-flash'), 400)
      toast('أُرسلت للطابعة الحرارية مباشرة (بلا حوار)', 'ok')
    }
  },
  render: (el) => {
    const c = cart(), t = totals(c)
    const cust = DB.customers.find((x) => x.id === c.customerId)
    el.querySelector('[data-receipt]').innerHTML = `
      <div class="c"><b>${DB.meta.shop}</b><br>${DB.meta.phone}</div><hr>
      <div>فاتورة: ${c.no}</div><div>التاريخ: ${c.date}</div><div>العميل: ${cust?.name ?? ''}</div><hr>
      <table>${c.lines.filter((l) => l.itemId).map((l) => {
        const it = DB.items.find((i) => i.id === l.itemId)
        return `<tr><td>${it?.name ?? ''}</td><td style="text-align:left">${l.qty}×${money(l.price ?? it?.price ?? 0)}</td><td style="text-align:left">${money(lineTotal(l))}</td></tr>`
      }).join('')}</table><hr>
      <table>
        <tr><td>الإجمالي</td><td style="text-align:left">${money(t.sub)}</td></tr>
        <tr><td>الخصم</td><td style="text-align:left">${money(t.disc)}</td></tr>
        <tr><td>الضريبة</td><td style="text-align:left">${money(t.tax)}</td></tr>
        <tr><td><b>الصافي</b></td><td style="text-align:left"><b>${money(t.grand)}</b></td></tr>
        <tr><td>المدفوع</td><td style="text-align:left">${money(c.paid)}</td></tr>
        <tr><td>المتبقي</td><td style="text-align:left">${money(t.remain)}</td></tr>
      </table><hr><div class="c">شكراً لتعاملكم معنا</div>`
  },
}
function printReceipt(auto = false) {
  const id = openWindow('receipt', { silent: auto })
  if (auto) toast('طباعة صامتة: أُرسل الإيصال للطابعة الحرارية', 'ok')
  return id
}

/* ---------- شاشة العميل (الشاشة الثانوية) ---------- */
VIEWS.customerDisplay = {
  single: true,
  build: () => ({ title: 'شاشة العميل (الشاشة الثانوية)', sub: 'تعرض السلة لحظياً للعميل', w: 360, h: 300, cls: 'customer-display',
    body: '<div data-cd></div>' }),
  mount: (el, id) => VIEWS.customerDisplay.render(el, id),
  render: (el) => {
    const c = cart(), t = totals(c)
    el.querySelector('[data-cd]').innerHTML = `
      <div style="opacity:.75;font-size:.7rem">${DB.meta.shop}</div>
      <div style="margin:.4rem 0 .6rem">${c.lines.filter((l) => l.itemId).map((l) => {
        const it = DB.items.find((i) => i.id === l.itemId)
        return `<div class="cd-line"><span>${it?.name} ×${l.qty}</span><span>${money(lineTotal(l))}</span></div>`
      }).join('') || '<div style="opacity:.6">في انتظار المسح…</div>'}</div>
      <div style="opacity:.75;font-size:.72rem">الإجمالي المستحق</div>
      <div class="cd-total">${money(t.grand)} <span style="font-size:.9rem">${DB.meta.currency}</span></div>
      <div style="opacity:.7;font-size:.72rem;margin-top:.3rem">المدفوع ${money(c.paid)} · المتبقي ${money(t.remain)}</div>`
  },
}
const updateCustomerDisplay = () => [...wins.entries()].filter(([, m]) => m.kind === 'customerDisplay').forEach(([id]) => rerender(id))

/* ---------- أنماط العرض التوضيحية ---------- */
VIEWS.skeleton = { build: () => ({ title: 'تحميل هيكلي', sub: 'انطباع سرعة بدل شاشة انتظار', w: 400, h: 240,
  body: `<div class="skeleton" style="width:60%"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:45%"></div><div class="skeleton"></div>` }) }
VIEWS.emptyState = { build: () => ({ title: 'حالة فارغة مصمَّمة', sub: 'رسم + جملة + إجراء واحد', w: 400, h: 240,
  body: `<div class="empty"><div class="art">▦</div><b>لا فواتير اليوم</b><span class="hint">ابدأ أول فاتورة وسيظهر ملخّص اليوم هنا.</span></div>`,
  foot: `<div class="spacer"></div><button class="btn primary sm" data-x>+ فاتورة جديدة</button>` }),
  mount: (el) => el.querySelector('[data-x]').onclick = () => openWindow('invoice') }

/* ======================= ⑧ الأدراج الجانبية ======================= */
function openDrawer(kind, o = {}) {
  document.querySelector('.drawer')?.remove()
  const d = document.createElement('aside')
  d.className = 'drawer'
  if (kind === 'customer') {
    const c = o.id ? DB.customers.find((x) => x.id === o.id) : null
    d.innerHTML = `<header>👤 ${c ? 'تعديل عميل' : 'عميل جديد'} <span class="spacer" style="flex:1"></span><button class="btn sm" data-x>✕</button></header>
      <div class="body">
        <div class="field"><label>الاسم</label><input data-k="name" value="${c?.name ?? o.name ?? ''}" autofocus></div>
        <div class="field"><label>الهاتف</label><input data-k="phone" value="${c?.phone ?? ''}"></div>
        <div class="row"><div class="field"><label>رصيد افتتاحي</label><input data-k="balance" value="${c?.balance ?? 0}"></div>
        <div class="field"><label>حد الائتمان</label><input data-k="limit" value="${c?.limit ?? 0}"></div></div>
        <p class="hint">الدرج الجانبي يبقي الفاتورة ظاهرة خلفه — بلا تعتيم ولا عزل.</p>
      </div>
      <footer><button class="btn" data-x>إلغاء</button><div class="spacer" style="flex:1"></div><button class="btn primary" data-save>حفظ واختيار</button></footer>`
  } else {
    const it = o.id ? DB.items.find((x) => x.id === o.id) : null
    d.innerHTML = `<header>▣ ${it ? 'تعديل صنف' : 'صنف جديد'} <span class="spacer" style="flex:1"></span><button class="btn sm" data-x>✕</button></header>
      <div class="body">
        <div class="field"><label>اسم الصنف</label><input data-k="name" value="${it?.name ?? o.name ?? ''}" autofocus></div>
        <div class="row"><div class="field"><label>الكود</label><input data-k="sku" value="${it?.sku ?? ''}"></div>
        <div class="field"><label>الباركود</label><input data-k="barcode" value="${it?.barcode ?? ''}"></div></div>
        <div class="row3"><div class="field"><label>السعر</label><input data-k="price" value="${it?.price ?? 0}"></div>
        <div class="field"><label>التكلفة</label><input data-k="cost" value="${it?.cost ?? 0}"></div>
        <div class="field"><label>المخزون</label><input data-k="stock" value="${it?.stock ?? 0}"></div></div>
        <div class="field"><label>الوحدة</label><input data-k="unit" value="${it?.unit ?? 'قطعة'}"></div>
      </div>
      <footer><button class="btn" data-x>إلغاء</button><div class="spacer" style="flex:1"></div><button class="btn primary" data-save>حفظ${it ? '' : ' وإضافة للفاتورة'}</button></footer>`
  }
  stage.appendChild(d)
  d.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => d.remove())
  d.querySelector('[data-save]').onclick = () => {
    const val = (k) => d.querySelector(`[data-k="${k}"]`)?.value ?? ''
    if (kind === 'customer') {
      if (o.id) { Object.assign(DB.customers.find((x) => x.id === o.id), { name: val('name'), phone: val('phone'), balance: Number(val('balance')) || 0, limit: Number(val('limit')) || 0 }) }
      else {
        const id = Math.max(0, ...DB.customers.map((x) => x.id)) + 1
        DB.customers.push({ id, name: val('name') || 'عميل جديد', phone: val('phone'), balance: Number(val('balance')) || 0, limit: Number(val('limit')) || 0 })
        cart().customerId = id
      }
    } else {
      if (o.id) Object.assign(DB.items.find((x) => x.id === o.id), { name: val('name'), sku: val('sku'), barcode: val('barcode'), price: Number(val('price')) || 0, cost: Number(val('cost')) || 0, stock: Number(val('stock')) || 0, unit: val('unit') })
      else {
        const id = Math.max(0, ...DB.items.map((x) => x.id)) + 1
        DB.items.push({ id, name: val('name') || 'صنف جديد', sku: val('sku') || `SKU-${id}`, barcode: val('barcode') || `990000${id}`, price: Number(val('price')) || 0, cost: Number(val('cost')) || 0, stock: Number(val('stock')) || 0, unit: val('unit') || 'قطعة' })
        addLine(id)
      }
    }
    save(); d.remove(); refreshAll(); toast('حُفظ بنجاح', 'ok')
  }
  setTimeout(() => d.querySelector('input')?.focus(), 60)
}

/* ======================= ⑨ لوحة الأوامر Ctrl+K ======================= */
function openPalette() {
  document.querySelector('.palette')?.remove()
  const cmds = [
    { t: 'فتح الفاتورة', k: 'F9 للحفظ', run: () => openWindow('invoice') },
    { t: 'سلة جديدة', k: 'Ctrl+T', run: () => { carts.push(newCart()); activeCart = carts.length - 1; refreshAll() } },
    { t: 'الأصناف', k: '', run: () => openWindow('items') },
    { t: 'العملاء', k: 'Ctrl+Shift+N للإضافة', run: () => openWindow('customers') },
    { t: 'تقرير اليوم', k: '', run: () => openWindow('report') },
    { t: 'شاشة العميل (شاشة ثانوية)', k: '', run: () => openWindow('customerDisplay') },
    { t: 'إيصال حراري', k: 'F12', run: () => printReceipt() },
    { t: 'ترتيب: تجانب رأسي', k: '', run: () => arrange('tileV') },
    { t: 'ترتيب: تتالي', k: '', run: () => arrange('cascade') },
    { t: 'تبديل الوضع الداكن', k: '', run: () => toggleTheme() },
    { t: 'إعادة البيانات التجريبية', k: '', run: resetDB },
    ...DB.customers.map((c) => ({ t: `عميل: ${c.name}`, k: 'اختيار', run: () => { cart().customerId = c.id; rerenderInvoice() } })),
    ...DB.items.map((i) => ({ t: `صنف: ${i.name}`, k: 'إضافة للفاتورة', run: () => addLine(i.id) })),
  ]
  const p = document.createElement('div')
  p.className = 'palette'
  p.innerHTML = `<input placeholder="اكتب أمراً أو اسم عميل أو صنف…"><div class="list"></div>`
  stage.appendChild(p)
  const input = p.querySelector('input'), list = p.querySelector('.list')
  let data = cmds, idx = 0
  const paint = () => {
    list.innerHTML = data.slice(0, 40).map((c, i) => `<div class="opt ${i === idx ? 'is-on' : ''}" data-i="${i}">${c.t}<span class="k">${c.k}</span></div>`).join('') || '<div class="opt">لا نتائج</div>'
    list.querySelectorAll('[data-i]').forEach((o) => o.onmousedown = (e) => { e.preventDefault(); pick(Number(o.dataset.i)) })
  }
  const pick = (i) => { const c = data[i]; p.remove(); c?.run(); if (c) toast(c.t) }
  input.oninput = () => { const q = input.value.trim(); data = q ? cmds.filter((c) => c.t.includes(q)) : cmds; idx = 0; paint() }
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(data.length - 1, idx + 1); paint() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint() }
    else if (e.key === 'Enter') { e.preventDefault(); pick(idx) }
    else if (e.key === 'Escape') { e.preventDefault(); p.remove() }
  }
  paint(); setTimeout(() => input.focus(), 40)
}

/* ======================= ⑩ الكيبورد أولاً ======================= */
function focusNextField(from) {
  const scope = from.closest('.win') ?? document
  const all = [...scope.querySelectorAll('input:not([readonly]), select, textarea, button.btn')].filter((e) => e.offsetParent !== null)
  const i = all.indexOf(from)
  const next = all[i + 1]
  next?.focus(); next?.select?.()
}
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase()
  const inField = tag === 'input' || tag === 'select' || tag === 'textarea'
  /* Enter ⇒ الحقل التالي (ما لم يكن منتقٍ مفتوحاً فهو يعالجه) */
  if (e.key === 'Enter' && inField && !anchorPop && !e.shiftKey && !document.querySelector('.palette')) {
    e.preventDefault(); focusNextField(e.target); return
  }
  /* أسهم التنقل + Delete داخل جدول البنود */
  if (inField && e.target.dataset.cell) {
    const i = Number(e.target.dataset.i), kind = e.target.dataset.cell
    const order = ['name', 'qty', 'price', 'disc']
    if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(Math.min(cart().lines.length - 1, i + 1), kind) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(Math.max(0, i - 1), kind) }
    else if (e.key === 'ArrowLeft' && !anchorPop) { e.preventDefault(); focusCell(i, order[Math.min(order.length - 1, order.indexOf(kind) + 1)]) }
    else if (e.key === 'ArrowRight' && !anchorPop) { e.preventDefault(); focusCell(i, order[Math.max(0, order.indexOf(kind) - 1)]) }
    else if (e.key === 'Delete') { e.preventDefault(); removeLine(i) }
  }
  /* لوحة الأوامر */
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return }
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); carts.push(newCart()); activeCart = carts.length - 1; refreshAll(); toast('سلة جديدة'); return }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openDrawer('customer', {}); return }
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveInvoice(); return }
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printReceipt(); return }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); activeCart = (activeCart + 1) % carts.length; refreshAll(); toast(`السلة ${cart().no}`); return }
  /* مفاتيح الوظائف */
  if (e.key === 'F2') { e.preventDefault(); openWindow('invoice'); addLine(); return }
  if (e.key === 'F3') { e.preventDefault(); openWindow('invoice'); const c = cart(); if (!c.lines.length) addLine(); focusCell(c.sel, 'name'); return }
  if (e.key === 'F4') { e.preventDefault(); focusCell(cart().sel, 'disc'); toast('خصم السطر — اكتب النسبة'); return }
  if (e.key === 'F8') { e.preventDefault(); holdCart(); return }
  if (e.key === 'F9') { e.preventDefault(); saveInvoice(); return }
  if (e.key === 'F12') { e.preventDefault(); printReceipt(); return }
  /* إدارة النوافذ */
  if (e.key === 'Escape') {
    if (document.querySelector('.palette')) { document.querySelector('.palette').remove(); return }
    if (document.querySelector('.drawer')) { document.querySelector('.drawer').remove(); return }
    const act = [...wins.entries()].find(([, m]) => m.el.classList.contains('is-active'))
    if (act && !inField) closeWin(act[0])
    return
  }
  if (!e.ctrlKey || !e.altKey) return
  const list = [...wins.entries()]
  const activeId = list.find(([, m]) => m.el.classList.contains('is-active'))?.[0]
  const k = e.key.toLowerCase()
  if (k === 'w' && list.length) { e.preventDefault(); const i = list.findIndex(([id]) => id === activeId); focusWin(list[(i + (e.shiftKey ? list.length - 1 : 1)) % list.length][0]) }
  else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); const t = list[Number(e.key) - 1]; if (t) focusWin(t[0]) }
  else if (k === 'm' && activeId) { e.preventDefault(); minWin(activeId) }
  else if (e.key === 'ArrowUp' && activeId) { e.preventDefault(); maxWin(activeId) }
  else if (k === 'q' && activeId) { e.preventDefault(); closeWin(activeId) }
})

/* ======================= ⑪ التشغيل ======================= */
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark'
  document.documentElement.dataset.theme = dark ? '' : 'dark'
  localStorage.setItem('shopsys-lab-theme', dark ? '' : 'dark')
}
document.documentElement.dataset.theme = localStorage.getItem('shopsys-lab-theme') || ''
document.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
  const kind = b.dataset.open
  if (kind === 'demoStack') { ['invoice', 'items', 'customerDisplay'].forEach((k, i) => setTimeout(() => openWindow(k), i * 240)); return }
  if (kind === 'undo') { undoBar('✕ حُذف السطر «أرز مصري 5 كجم»', () => {}); return }
  openWindow(kind)
})
document.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
  const a = b.dataset.act
  if (a === 'theme') toggleTheme()
  else if (a === 'closeAll') [...wins.keys()].forEach(closeWin)
  else if (a === 'minimizeAll') [...wins.keys()].forEach(minWin)
  else if (a === 'palette') openPalette()
  else if (a === 'reset') resetDB()
  else arrange(a)
})
renderTaskbar()
openWindow('invoice')
setTimeout(() => toast('جرّب: F2 سطر · F3 صنف · Ctrl+K أوامر · F9 إصدار', 'ok'), 700)
