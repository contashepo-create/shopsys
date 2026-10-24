/* ═══ تصوّر تفاعلي: نوافذ حرة (Windows 11 MDI) + فوترة مشاريع بحارس مضاعفة ═══
   بيانات تجريبية بالكامل — الغرض اعتماد الشكل والسلوك قبل لمس كود التطبيق. */
'use strict'
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/* ─── بيانات تجريبية ─── */
const DB = {
  customers: [
    { id: 1, name: 'شركة النيل للتطوير العقاري والمقاولات العامة — فرع القاهرة الجديدة', bal: 318400, phone: '01001234567' },
    { id: 2, name: 'مكتب الاستشارات الهندسية المتكاملة (م. أحمد سامي وشركاه)', bal: 0, phone: '01119876543' },
    { id: 3, name: 'الحاج محمود عبد الرحمن — أعمال تشطيبات خاصة', bal: -12000, phone: '01223456789' },
  ],
  suppliers: [
    { id: 1, name: 'حديد عز — وكيل توزيع معتمد' },
    { id: 2, name: 'محطة وقود التعاون — كرداسة' },
    { id: 3, name: 'مقاول باطن: أعمال السباكة (أبو يوسف)' },
  ],
  projects: [
    { id: 1, code: 'PRJ-0003', name: 'برج النيل السكني — المرحلة الثانية (أساسات وهيكل خرساني)', customer: 1, contract: 1200000, extracted: 720000, invoicedDoc: 480000, invoicedExtra: 0, retention: 10, advanceBalance: 100000 },
    { id: 2, code: 'PRJ-0007', name: 'مخزن لوجستي — المنطقة الصناعية ببدر', customer: 2, contract: 450000, extracted: 0, invoicedDoc: 0, invoicedExtra: 0, retention: 5, advanceBalance: 0 },
  ],
  items: [
    { id: 1, name: 'أعمال خرسانة مسلحة — توريد وتنفيذ', unit: 'م3', price: 2850 },
    { id: 2, name: 'حديد تسليح 16 مم عالي المقاومة', unit: 'طن', price: 38500 },
    { id: 3, name: 'أعمال مباني طوب طفلي 25 سم', unit: 'م2', price: 420 },
    { id: 4, name: 'يومية نجار مسلح (صنايعي)', unit: 'يوم', price: 650 },
    { id: 5, name: 'أسمنت بورتلاندي عادي — معبأ', unit: 'شيكارة', price: 210 },
    { id: 6, name: 'سولار — لتر (مولدات الموقع)', unit: 'لتر', price: 17.5 },
  ],
  boq: [
    { code: '01-01', name: 'حفر وردم وتسوية الموقع', qty: 1800, unit: 'م3', price: 95, prev: 100 },
    { code: '02-01', name: 'خرسانة عادية للأساسات', qty: 420, unit: 'م3', price: 1650, prev: 100 },
    { code: '02-02', name: 'خرسانة مسلحة أعمدة وأسقف', qty: 1150, unit: 'م3', price: 2850, prev: 55 },
    { code: '03-01', name: 'مباني طوب — حوائط خارجية', qty: 2600, unit: 'م2', price: 420, prev: 20 },
    { code: '04-01', name: 'أعمال عزل الأسطح (بيتومين + فوم)', qty: 900, unit: 'م2', price: 310, prev: 0 },
  ],
  invoices: [
    { no: 'SAL-1042', date: '2026-10-18', nature: 'مقابل مستخلص PRX-0005', project: 1, customer: 1, total: 262080, paid: 262080 },
    { no: 'SAL-1039', date: '2026-10-11', nature: 'مقابل مستخلص PRX-0004', project: 1, customer: 1, total: 285120, paid: 150000 },
    { no: 'SAL-1035', date: '2026-10-04', nature: 'حرة — بلا مشروع', project: 0, customer: 3, total: 84500, paid: 84500 },
    { no: 'SAL-1028', date: '2026-09-27', nature: 'مواد مباعة للمشروع', project: 1, customer: 1, total: 56200, paid: 0 },
  ],
  invSeq: 1043, prxSeq: 7, pexSeq: 31,
}
const customerName = (id) => DB.customers.find((c) => c.id === id)?.name ?? 'عميل نقدي'
const projectOf = (id) => DB.projects.find((p) => p.id === id) ?? null

/* ─── تنبيهات ─── */
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 5200)
}

/* ═══════════ مدير النوافذ ═══════════ */
const WM = { wins: new Map(), z: 100, seq: 0, MAX: 10 }
const TASK_H = 48
const view = () => ({ w: innerWidth, h: innerHeight - TASK_H })

function openWin({ key, title, subtitle = '', icon = '🪟', w = 880, h = 580, render, dedupe = true, askHint }) {
  if (dedupe && key) { const ex = [...WM.wins.values()].find((x) => x.key === key); if (ex) { restoreWin(ex); return ex } }
  if (WM.wins.size >= WM.MAX) { toast(`⛔ الحد الأقصى ${WM.MAX} نوافذ مفتوحة — أغلق نافذة أو صغّرها أولاً (هذا هو السلوك المطلوب)`, 'err'); return null }
  const id = `w${++WM.seq}`; const v = view()
  const wpx = Math.min(w, v.w - 16), hpx = Math.min(h, v.h - 14)
  const step = (WM.wins.size % 6) * 30
  const x = Math.max(8, Math.min(v.w - wpx - 8, (v.w - wpx) / 2 - 40 + step))
  const y = Math.max(8, Math.min(v.h - hpx - 6, 40 + step))
  const el = document.createElement('section')
  el.className = 'win'; el.tabIndex = -1; el.dataset.win = id
  el.innerHTML = `
    <header class="titlebar">
      <span class="win-icon">${icon}</span>
      <span class="win-title"></span><span class="win-dirty" hidden title="بيانات غير محفوظة">●</span>
      <span class="win-subtitle">${esc(subtitle)}</span>
      <nav class="caption">
        <button type="button" data-cap="min" title="تصغير" aria-label="تصغير">—</button>
        <button type="button" data-cap="max" title="تكبير/استعادة" aria-label="تكبير">▢</button>
        <button type="button" data-cap="close" class="close" title="إغلاق — يغلق هذه النافذة وحدها" aria-label="إغلاق">✕</button>
      </nav>
    </header>
    <div class="win-body"></div>
    <footer class="win-foot" hidden></footer>
    ${['e','w','s','n','se','sw','ne','nw'].map((d) => `<span class="rz ${d}" data-rz="${d}"></span>`).join('')}`
  document.body.appendChild(el)
  const win = {
    id, key: key ?? id, title, icon, el, dirty: false, maxed: false, min: false,
    rect: { x, y, w: wpx, h: hpx }, prev: null, data: {},
    body: $('.win-body', el), foot: $('.win-foot', el), askHint,
    setTitle(t) { win.title = t; $('.win-title', el).textContent = t; el.setAttribute('aria-label', t); renderChips() },
    setDirty(v) { if (win.dirty === v) return; win.dirty = v; $('.win-dirty', el).hidden = !v; renderChips() },
    showFoot(html) { win.foot.innerHTML = html; win.foot.hidden = false },
    close(force = false) { requestClose(win, force) },
  }
  WM.wins.set(id, win); applyRect(win); win.setTitle(title)
  el.addEventListener('pointerdown', () => focusWin(win), true)
  $('.titlebar', el).addEventListener('pointerdown', (e) => startDrag(e, win))
  $('.titlebar', el).addEventListener('dblclick', (e) => { if (!e.target.closest('[data-cap]')) toggleMax(win) })
  $$('[data-cap]', el).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.cap === 'min') minimizeWin(win)
    else if (b.dataset.cap === 'max') toggleMax(win)
    else requestClose(win)
  }))
  $$('[data-rz]', el).forEach((r) => r.addEventListener('pointerdown', (e) => startResize(e, win, r.dataset.rz)))
  focusWin(win); renderChips()
  try { render?.(win) } catch (err) { win.body.innerHTML = `<div class="empty">خطأ في النموذج: ${esc(err.message)}</div>` }
  setTimeout(() => win.body.querySelector('input:not([readonly]), select')?.focus(), 40)
  return win
}
function applyRect(win) {
  const { x, y, w, h } = win.rect, s = win.el.style
  s.left = `${x}px`; s.top = `${y}px`; s.width = `${w}px`; s.height = `${h}px`
}
function focusWin(win) {
  win.el.style.zIndex = String(++WM.z)
  $$('.win').forEach((x) => x.classList.toggle('inactive', x !== win.el))
  renderChips()
}
function topWin() { return [...WM.wins.values()].filter((w) => !w.min).sort((a, b) => (+b.el.style.zIndex) - (+a.el.style.zIndex))[0] ?? null }
function minimizeWin(win) { win.min = true; win.el.style.display = 'none'; const t = topWin(); if (t) focusWin(t); renderChips() }
function restoreWin(win) { win.min = false; win.el.style.display = ''; focusWin(win) }
function toggleMax(win) {
  const v = view()
  if (win.maxed) { win.rect = win.prev; win.maxed = false; win.el.classList.remove('max') }
  else { win.prev = { ...win.rect }; win.rect = { x: 0, y: 0, w: v.w, h: v.h }; win.maxed = true; win.el.classList.add('max') }
  applyRect(win); focusWin(win)
}
function requestClose(win, force = false) {
  if (win.dirty && !force) {
    if ($('.win-ask', win.el)) return
    const ask = document.createElement('div'); ask.className = 'win-ask'
    ask.innerHTML = `<div class="win-ask-card"><b>إغلاق «${esc(win.title)}»؟</b>
      <p>${esc(win.askHint ?? 'توجد بيانات غير محفوظة في هذه النافذة وستُفقد. النوافذ الأخرى لن تتأثر.')}</p>
      <div class="win-ask-actions">
        <button class="btn btn-primary" data-a="keep">متابعة العمل</button>
        <button class="btn danger" data-a="discard">إغلاق وفقد البيانات</button>
      </div></div>`
    win.el.appendChild(ask)
    $('[data-a="keep"]', ask).onclick = () => ask.remove()
    $('[data-a="discard"]', ask).onclick = () => requestClose(win, true)
    return
  }
  win.el.remove(); WM.wins.delete(win.id)
  const t = topWin(); if (t) focusWin(t); renderChips()
}
function renderChips() {
  const box = $('#taskbarChips'); box.innerHTML = ''
  const top = topWin()
  for (const win of WM.wins.values()) {
    const chip = document.createElement('span')
    chip.className = `chip ${win === top && !win.min ? 'active' : ''} ${win.min ? 'min' : ''}`
    chip.innerHTML = `<span>${win.icon}</span><span class="chip-title">${esc(win.title)}</span>${win.dirty ? '<span class="dirty-dot">●</span>' : ''}<button class="chip-x" title="إغلاق">✕</button>`
    chip.onclick = (e) => { if (e.target.closest('.chip-x')) return; win.min ? restoreWin(win) : (win === top ? minimizeWin(win) : focusWin(win)) }
    $('.chip-x', chip).onclick = () => { if (win.min) restoreWin(win); requestClose(win) }
    box.appendChild(chip)
  }
  $('#winCount').textContent = `النوافذ المفتوحة: ${WM.wins.size} / ${WM.MAX}`
}
/* السحب + الالتقاط */
function startDrag(e, win) {
  if (e.button !== 0 || e.target.closest('[data-cap]') || win.maxed) return
  const ox = e.clientX - win.rect.x, oy = e.clientY - win.rect.y; let zone = null
  const prev = $('#snapPreview')
  const zoneAt = (x, y) => (y <= 6 ? 'max' : x <= 6 ? 'start' : x >= innerWidth - 6 ? 'end' : null)
  const zoneRect = (z) => { const v = view(); const half = Math.floor(v.w / 2)
    return z === 'max' ? { x: 0, y: 0, w: v.w, h: v.h } : z === 'start' ? { x: v.w - half, y: 0, w: half, h: v.h } : { x: 0, y: 0, w: half, h: v.h } }
  const move = (ev) => {
    win.rect.x = Math.min(Math.max(-win.rect.w + 140, ev.clientX - ox), innerWidth - 90)
    win.rect.y = Math.min(Math.max(0, ev.clientY - oy), view().h - 40)
    applyRect(win); zone = zoneAt(ev.clientX, ev.clientY)
    if (zone) { const r = zoneRect(zone); Object.assign(prev.style, { left: `${r.x + 5}px`, top: `${r.y + 5}px`, width: `${r.w - 10}px`, height: `${r.h - 10}px` }); prev.hidden = false }
    else prev.hidden = true
  }
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); prev.hidden = true
    if (zone === 'max') { if (!win.maxed) toggleMax(win) }
    else if (zone) { win.prev = { ...win.rect }; win.rect = zoneRect(zone); applyRect(win) }
  }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
}
function startResize(e, win, dir) {
  e.stopPropagation(); if (win.maxed) return; focusWin(win)
  const sx = e.clientX, sy = e.clientY, o = { ...win.rect }
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy; let { x, y, w, h } = o
    if (dir.includes('e')) w = o.w + dx
    if (dir.includes('w')) { w = o.w - dx; x = o.x + dx }
    if (dir.includes('s')) h = o.h + dy
    if (dir.includes('n')) { h = o.h - dy; y = o.y + dy }
    if (w < 380) { if (dir.includes('w')) x -= (380 - w); w = 380 }
    if (h < 260) { if (dir.includes('n')) y -= (260 - h); h = 260 }
    win.rect = { x, y, w, h }; applyRect(win)
  }
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
  addEventListener('pointermove', move); addEventListener('pointerup', up)
}
function arrange(kind) {
  const list = [...WM.wins.values()]
  if (!list.length) { toast('لا نوافذ مفتوحة بعد — افتح نافذة من سجل النوافذ'); return }
  const v = view()
  if (kind === 'closeall') { [...list].forEach((w) => requestClose(w)); return }
  if (kind === 'minall') { list.forEach((w) => minimizeWin(w)); return }
  list.forEach((w) => { w.min = false; w.el.style.display = ''; if (w.maxed) toggleMax(w) })
  if (kind === 'cascade') list.forEach((w, i) => { w.rect = { x: 30 + i * 34, y: 16 + i * 30, w: Math.min(900, v.w - 80), h: Math.min(600, v.h - 60) }; applyRect(w); focusWin(w) })
  if (kind === 'tile') {
    const cols = Math.ceil(Math.sqrt(list.length)), rows = Math.ceil(list.length / cols)
    const cw = Math.floor(v.w / cols), ch = Math.floor(v.h / rows)
    list.forEach((w, i) => { w.rect = { x: (i % cols) * cw + 4, y: Math.floor(i / cols) * ch + 4, w: cw - 8, h: ch - 8 }; applyRect(w) })
    focusWin(list[list.length - 1])
  }
  renderChips()
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const t = topWin(); if (!t) return
    const ask = $('.win-ask', t.el); if (ask) { ask.remove(); return }
    requestClose(t)
  }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'w') {
    e.preventDefault(); const list = [...WM.wins.values()].filter((w) => !w.min)
    if (list.length > 1) focusWin(list.sort((a, b) => (+a.el.style.zIndex) - (+b.el.style.zIndex))[0])
  }
})
addEventListener('resize', () => { for (const w of WM.wins.values()) if (w.maxed) { w.rect = { x: 0, y: 0, ...view(), w: view().w, h: view().h }; applyRect(w) } })

function refreshAllGuards() { for (const w of WM.wins.values()) w.data.refreshGuard?.() }

/* ═══════════ N-01 فاتورة بيع ═══════════ */
function openInvoice(preset = {}) {
  const win = openWin({
    key: null, dedupe: false, icon: '🧾', w: 1120, h: 700,
    title: 'فاتورة بيع — جديدة', subtitle: 'نافذة مستقلة · شريط عنوان واحد',
    askHint: 'هذه الفاتورة فيها بنود لم تُرحَّل. الإغلاق يفقدها — والنوافذ الأخرى تبقى كما هي.',
    render: (win) => renderInvoice(win, preset),
  })
  return win
}
function renderInvoice(win, preset) {
  const S = {
    customer: preset.customer ?? 0, project: preset.project ?? 0,
    nature: preset.nature ?? 'against', vat: true,
    lines: preset.lines ?? [{ name: 'أعمال خرسانة مسلحة — توريد وتنفيذ', unit: 'م3', qty: 12, price: 2850 }],
    posted: false,
  }
  win.data.S = S
  win.body.innerHTML = `
    <div class="doc-toolbar">
      <button class="btn btn-small" data-act="draft">💾 حفظ مسودة (F8)</button>
      <button class="btn btn-small" data-act="preview">👁 معاينة (F6)</button>
      <span class="sep"></span>
      <button class="btn btn-small" data-act="pickItem">🔍 اختيار صنف…</button>
      <button class="btn btn-small" data-act="pickCustomer">👤 اختيار عميل…</button>
      <span class="sep"></span>
      <span class="small muted">لاحظ: أدوات المستند هنا فقط — <b>لا أزرار نافذة مكررة</b>؛ التصغير/التكبير/الإغلاق من شريط عنوان النافذة وحده.</span>
    </div>
    <div class="head-wide">
      <div class="field mega-field"><span>العميل — الحقل كامل العرض والاسم ظاهر كله</span>
        <div class="pick-row">
          <select class="grow" data-f="customer"></select>
          <button class="plus-btn" data-act="newCustomer" title="عميل جديد — إضافة سريعة دون مغادرة الفاتورة">＋</button>
        </div>
        <span class="bal-chip" data-f="bal"></span>
      </div>
      <div class="field mega-field"><span>مشروع المقاولات (اختياري) — الربط من داخل الفاتورة</span>
        <div class="pick-row">
          <select class="grow" data-f="project"></select>
          <button class="plus-btn" data-act="newProject" title="مشروع جديد — إضافة سريعة">＋</button>
        </div>
        <span class="bal-chip" data-f="prjMeta"></span>
      </div>
    </div>
    <div class="head-row2">
      <div class="field"><span>التاريخ</span><input type="date" value="2026-10-22"></div>
      <div class="field"><span>الدفع</span><select><option>آجل — على حساب العميل</option><option>نقدي</option><option>مجزأ</option></select></div>
      <div class="field" data-f="natureWrap" hidden><span>طبيعة فاتورة المشروع *</span>
        <select data-f="nature">
          <option value="against">فاتورة مقابل مستخلصات صادرة (توثيق ضريبي)</option>
          <option value="extra">أعمال/مواد إضافية خارج المستخلصات</option>
        </select></div>
      <div class="field"><span>المخزن</span><select><option>المخزن الرئيسي</option><option>مخزن الموقع — برج النيل</option></select></div>
    </div>
    <div data-f="guard"></div>
    <table class="lines-table">
      <thead><tr><th style="width:42%">البند / الصنف</th><th>الوحدة</th><th style="width:110px">الكمية</th><th style="width:140px">سعر الوحدة</th><th class="num" style="width:130px">إجمالي السطر</th><th style="width:40px"></th></tr></thead>
      <tbody data-f="lines"></tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-small" data-act="addFree">＋ بند حر</button>
      <button class="btn btn-small" data-act="pickItem2">🔍 اختيار من سجل الأصناف…</button>
      <label class="toggle" style="margin-inline-start:auto"><input type="checkbox" data-f="vat" checked> خاضعة لضريبة القيمة المضافة 14٪</label>
    </div>
    <div class="totals">
      <div class="trow"><span>الإجمالي قبل الضريبة</span><b data-f="tNet">0</b></div>
      <div class="trow"><span>ض.ق.م 14٪</span><b data-f="tVat">0</b></div>
      <div class="trow grand" data-f="tGrandRow"><span>الإجمالي المستحق</span><b data-f="tGrand">0</b></div>
    </div>
    <div class="err-box" data-f="err"></div>`
  win.showFoot(`<span class="small muted" data-f="footInfo"></span><span class="spacer"></span>
    <button class="btn" data-act="close">إغلاق</button>
    <button class="btn btn-ok" data-act="post">✔ حفظ وترحيل الفاتورة (F9)</button>`)

  const B = win.body, q = (s) => $(s, B)
  const custSel = q('[data-f="customer"]'), prjSel = q('[data-f="project"]')
  const fillSelects = () => {
    custSel.innerHTML = `<option value="0">عميل نقدي — بدون حساب</option>` + DB.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    custSel.value = String(S.customer)
    prjSel.innerHTML = `<option value="0">بدون مشروع — فاتورة حرة</option>` + DB.projects.map((p) => `<option value="${p.id}">${p.code} — ${esc(p.name)}</option>`).join('')
    prjSel.value = String(S.project)
  }
  const totals = () => {
    const net = S.lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0)
    const vat = S.vat ? Math.round(net * 0.14) : 0
    return { net, vat, grand: net + vat }
  }
  const guard = () => {
    const p = projectOf(S.project); if (!p) return null
    const capAgainst = p.extracted - p.invoicedDoc
    const capExtra = p.contract - p.extracted - p.invoicedExtra
    const cap = S.nature === 'against' ? capAgainst : capExtra
    return { p, capAgainst, capExtra, cap, t: totals(), over: totals().net > cap }
  }
  const renderGuard = () => {
    const g = guard(); const box = q('[data-f="guard"]')
    q('[data-f="natureWrap"]').hidden = !g
    q('[data-f="prjMeta"]').textContent = g ? `الجهة المالكة: ${customerName(g.p.customer).slice(0, 42)}… · عقد فعلي ${fmt(g.p.contract)} ج.م · محتجز ${g.p.retention}٪` : 'اختر مشروعاً لربط الفاتورة به — أو اتركها حرة'
    if (!g) { box.innerHTML = ''; q('[data-f="footInfo"]').textContent = 'فاتورة حرة — لا حارس فوترة'; return }
    const pct = (x) => Math.max(0, Math.min(100, (x / g.p.contract) * 100))
    box.innerHTML = `<div class="guard ${g.over ? 'bad' : ''}">
      <div class="guard-head"><span>🛡 حارس فوترة المشروع — منع التضاعف مع المستخلصات</span>
      <span class="pill ${S.nature === 'against' ? 'doc' : 'proj'}">${S.nature === 'against' ? 'مقابل مستخلصات: سقفها ما صدر ولم يُفوتر' : 'إضافية: سقفها متبقي العقد خارج المستخلصات'}</span></div>
      <div class="guard-nums">
        <div><small>العقد الفعلي (+ أوامر تغيير)</small><b>${fmt(g.p.contract)}</b></div>
        <div><small>مستخلصات صادرة (ذمة قائمة)</small><b>${fmt(g.p.extracted)}</b></div>
        <div><small>مفوتر مقابل المستخلصات</small><b>${fmt(g.p.invoicedDoc)}</b></div>
        <div><small>متاح «مقابل مستخلصات» الآن</small><b>${fmt(g.capAgainst)}</b></div>
        <div><small>متاح «إضافية» (متبقي عقد)</small><b>${fmt(g.capExtra)}</b></div>
      </div>
      <div class="guard-bar"><i class="b-inv" style="width:${pct(g.p.invoicedDoc)}%"></i><i class="b-avail" style="width:${pct(g.capAgainst)}%"></i><i class="b-rest" style="width:${pct(g.capExtra)}%"></i></div>
      <div class="guard-legend"><span>🔵 مفوتر ${fmt(g.p.invoicedDoc)}</span><span>🟠 مستخلصات تنتظر فاتورة ${fmt(g.capAgainst)}</span><span>⚪ لم يُنفَّذ بعد ${fmt(g.capExtra)}</span></div>
      <div class="guard-msg ${g.over ? 'err' : 'ok'}">${g.over
        ? `⛔ صافي هذه الفاتورة ${fmt(g.t.net)} يتجاوز المتاح ${fmt(g.cap)} بطبيعة «${S.nature === 'against' ? 'مقابل مستخلصات' : 'إضافية'}» — الترحيل مرفوض. إصدارها كما هي سيضاعف ذمة العميل والإيراد والضريبة. خفّض القيمة أو غيّر الطبيعة أو اعتمد أمر تغيير.`
        : `✅ صافي الفاتورة ${fmt(g.t.net)} داخل المتاح ${fmt(g.cap)} — الترحيل آمن ولا مضاعفة على العميل.`}</div>
    </div>`
    q('[data-f="footInfo"]').textContent = g.over ? '⚠ الترحيل سيُرفض بالحارس' : 'الحارس: داخل السقف'
    q('[data-f="tGrandRow"]').classList.toggle('bad', g.over)
  }
  win.data.refreshGuard = renderGuard
  const renderLines = () => {
    const tb = q('[data-f="lines"]'); tb.innerHTML = ''
    S.lines.forEach((l, i) => {
      const tr = document.createElement('tr')
      tr.innerHTML = `<td><input value="${esc(l.name)}" data-l="name" placeholder="اسم البند…"></td>
        <td><input value="${esc(l.unit)}" data-l="unit" style="width:76px"></td>
        <td><input type="number" step="any" value="${l.qty}" data-l="qty" dir="ltr"></td>
        <td><input type="number" step="any" value="${l.price}" data-l="price" dir="ltr"></td>
        <td class="num" data-l="total">${fmt(num(l.qty) * num(l.price))}</td>
        <td><button class="row-del" title="حذف البند">🗑</button></td>`
      $$('input', tr).forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.l; S.lines[i][k] = (k === 'name' || k === 'unit') ? inp.value : inp.value
        $('[data-l="total"]', tr).textContent = fmt(num(S.lines[i].qty) * num(S.lines[i].price))
        win.setDirty(true); renderTotals(); renderGuard()
      }))
      $('.row-del', tr).onclick = () => { S.lines.splice(i, 1); win.setDirty(true); renderLines(); renderTotals(); renderGuard() }
      tb.appendChild(tr)
    })
  }
  const renderTotals = () => {
    const t = totals()
    q('[data-f="tNet"]').textContent = `${fmt(t.net)} ج.م`
    q('[data-f="tVat"]').textContent = `${fmt(t.vat)} ج.م`
    q('[data-f="tGrand"]').textContent = `${fmt(t.grand)} ج.م`
  }
  const renderBal = () => {
    const c = DB.customers.find((x) => x.id === S.customer)
    q('[data-f="bal"]').innerHTML = c ? `رصيد سابق: <b>${fmt(Math.abs(c.bal))} ج.م ${c.bal > 0 ? '(مدين)' : c.bal < 0 ? '(دائن)' : ''}</b> · ${esc(c.phone)}` : 'بيع نقدي — لا رصيد'
  }
  fillSelects(); renderLines(); renderTotals(); renderBal(); renderGuard()
  custSel.onchange = () => { S.customer = num(custSel.value); win.setDirty(true); renderBal() }
  prjSel.onchange = () => {
    S.project = num(prjSel.value); win.setDirty(true)
    const p = projectOf(S.project)
    if (p && !S.customer) { S.customer = p.customer; custSel.value = String(p.customer); renderBal(); toast('عميل المشروع عُبّأ تلقائياً — يمكنك تغييره') }
    renderGuard()
  }
  q('[data-f="nature"]').onchange = (e) => { S.nature = e.target.value; win.setDirty(true); renderGuard() }
  q('[data-f="vat"]').onchange = (e) => { S.vat = e.target.checked; win.setDirty(true); renderTotals() }
  const act = (name, fn) => $$(`[data-act="${name}"]`, win.el).forEach((b) => b.onclick = fn)
  act('addFree', () => { S.lines.push({ name: '', unit: 'مقطوعية', qty: 1, price: 0 }); renderLines(); win.setDirty(true) })
  act('pickItem', () => openItemPicker(win)); act('pickItem2', () => openItemPicker(win))
  act('pickCustomer', () => openCustomerPicker(win))
  act('newCustomer', () => openQuickAdd('customer', win, (c) => { fillSelects(); S.customer = c.id; custSel.value = String(c.id); renderBal() }))
  act('newProject', () => openQuickAdd('project', win, (p) => { fillSelects(); S.project = p.id; prjSel.value = String(p.id); renderGuard() }))
  act('draft', () => { win.setDirty(false); toast('حُفظت مسودة الفاتورة — النافذة تبقى مفتوحة') })
  act('preview', () => toast('في التطبيق: تفتح «معاينة طباعة» كنافذة ابنة فوق الفاتورة'))
  act('close', () => win.close())
  act('post', () => {
    const err = q('[data-f="err"]'); const g = guard(); const t = totals()
    if (!S.lines.some((l) => num(l.qty) * num(l.price) > 0)) { err.textContent = '⛔ أضف بنداً بقيمة موجبة أولاً'; err.classList.add('show'); return }
    if (g?.over) {
      err.textContent = `⛔ رفض حارس الفوترة الترحيل: صافي الفاتورة ${fmt(t.net)} أكبر من المتاح ${fmt(g.cap)}. ذمة العميل الحالية من المستخلصات ${fmt(g.p.extracted)} — إصدار هذه الفاتورة فوقها سيضاعف المبلغ خطأً كما حذّرتَ تماماً.`
      err.classList.add('show'); toast('رفض حارس الفوترة ترحيل الفاتورة — انظر التفصيل داخل النافذة', 'err'); return
    }
    err.classList.remove('show')
    const no = `SAL-${DB.invSeq++}`
    if (g) { if (S.nature === 'against') g.p.invoicedDoc += t.net; else g.p.invoicedExtra += t.net }
    DB.invoices.unshift({ no, date: '2026-10-22', nature: g ? (S.nature === 'against' ? 'مقابل مستخلص' : 'إضافية للمشروع') : 'حرة — بلا مشروع', project: S.project, customer: S.customer, total: t.grand, paid: 0 })
    win.setTitle(`فاتورة بيع — ${no}`); win.setDirty(false); S.posted = true
    toast(`✅ رُحّلت الفاتورة ${no} بإجمالي ${fmt(t.grand)} ج.م — حُدّث «المتاح» في كل النوافذ المفتوحة لنفس المشروع فوراً`, 'ok')
    renderBgInvoices(); refreshAllGuards()
  })
  win.data.addItem = (item) => { S.lines.push({ name: item.name, unit: item.unit, qty: 1, price: item.price }); renderLines(); renderTotals(); renderGuard(); win.setDirty(true) }
  win.data.setCustomer = (id) => { S.customer = id; fillSelects(); renderBal(); win.setDirty(true) }
}

/* ═══════════ N-05/N-06 منتقيات + N-07 إضافة سريعة ═══════════ */
function openItemPicker(parent) {
  openWin({
    key: `item-picker:${parent.id}`, icon: '🔍', w: 680, h: 520,
    title: 'اختيار صنف', subtitle: 'نافذة ابنة — إغلاقها لا يمس الفاتورة',
    render: (win) => {
      win.body.innerHTML = `
        <div class="search-row"><input data-f="q" placeholder="ابحث بالاسم أو الكود… (اكتب وستُصفّى القائمة)">
        <button class="btn btn-ok" data-act="new">＋ صنف جديد</button></div>
        <div class="pick-list" data-f="list"></div>
        <p class="small muted mt">زر «＋ صنف جديد» يفتح إضافة سريعة فوق هذه النافذة — الحفظ يُنشئ الصنف ويختاره في الفاتورة فوراً، وستبقى الفاتورة خلفهما كما هي.</p>`
      const draw = (filter = '') => {
        const rows = DB.items.filter((i) => !filter || i.name.includes(filter))
        $('[data-f="list"]', win.body).innerHTML = rows.length ? rows.map((i) => `
          <button class="pick-item" data-id="${i.id}"><span>📦</span><span><b>${esc(i.name)}</b><small>وحدة: ${esc(i.unit)} · كود ITM-${i.id}</small></span><span class="price">${fmt(i.price)} ج.م</span></button>`).join('')
          : '<div class="empty">لا نتائج — أنشئه جديداً بالزر الأخضر</div>'
        $$('.pick-item', win.body).forEach((b) => b.onclick = () => {
          const item = DB.items.find((x) => x.id === num(b.dataset.id))
          parent.data.addItem?.(item); win.close(true); focusWin(parent); toast(`أُضيف «${item.name}» لبنود الفاتورة`)
        })
      }
      draw()
      $('[data-f="q"]', win.body).oninput = (e) => draw(e.target.value.trim())
      $('[data-act="new"]', win.body).onclick = () => openQuickAdd('item', win, (item) => { parent.data.addItem?.(item); win.close(true); focusWin(parent) })
    },
  })
}
function openCustomerPicker(parent) {
  openWin({
    key: `customer-picker:${parent.id}`, icon: '👤', w: 640, h: 480,
    title: 'اختيار عميل', subtitle: 'نافذة ابنة للفاتورة',
    render: (win) => {
      win.body.innerHTML = `
        <div class="search-row"><input data-f="q" placeholder="ابحث باسم العميل أو الهاتف…">
        <button class="btn btn-ok" data-act="new">＋ عميل جديد</button></div>
        <div class="pick-list" data-f="list"></div>`
      const draw = (f = '') => {
        const rows = DB.customers.filter((c) => !f || c.name.includes(f) || c.phone.includes(f))
        $('[data-f="list"]', win.body).innerHTML = `<button class="pick-item" data-id="0"><span>💵</span><span><b>عميل نقدي</b><small>بيع فوري بلا حساب آجل</small></span></button>` +
          rows.map((c) => `<button class="pick-item" data-id="${c.id}"><span>👤</span><span><b>${esc(c.name)}</b><small>${esc(c.phone)} · رصيد ${fmt(Math.abs(c.bal))} ج.م ${c.bal > 0 ? 'مدين' : ''}</small></span></button>`).join('')
        $$('.pick-item', win.body).forEach((b) => b.onclick = () => { parent.data.setCustomer?.(num(b.dataset.id)); win.close(true); focusWin(parent) })
      }
      draw(); $('[data-f="q"]', win.body).oninput = (e) => draw(e.target.value.trim())
      $('[data-act="new"]', win.body).onclick = () => openQuickAdd('customer', win, (c) => { parent.data.setCustomer?.(c.id); win.close(true); focusWin(parent) })
    },
  })
}
function openQuickAdd(kind, parent, onSaved) {
  const conf = {
    item: { title: 'صنف جديد — إضافة سريعة', icon: '📦', w: 520, h: 430, fields: `
      <div class="grid-2">
        <div class="field" style="grid-column:1/-1"><span>اسم الصنف *</span><input data-k="name" placeholder="مثال: أعمال لياسة خارجية"></div>
        <div class="field"><span>الوحدة</span><input data-k="unit" value="مقطوعية"></div>
        <div class="field"><span>سعر البيع (ج.م)</span><input data-k="price" type="number" step="any" dir="ltr" placeholder="0"></div>
      </div><p class="small muted mt">الحقول الأساسية فقط — التفاصيل (باركود/فئة/تكلفة) تُستكمل لاحقاً من شاشة الأصناف متى شئت.</p>` },
    customer: { title: 'عميل جديد — إضافة سريعة', icon: '👤', w: 520, h: 430, fields: `
      <div class="grid-2">
        <div class="field" style="grid-column:1/-1"><span>اسم العميل *</span><input data-k="name" placeholder="مثال: شركة المستقبل للاستثمار العقاري"></div>
        <div class="field"><span>الهاتف</span><input data-k="phone" placeholder="01xxxxxxxxx"></div>
        <div class="field"><span>حد الائتمان (ج.م)</span><input data-k="credit" type="number" dir="ltr" placeholder="0 = نقدي فقط"></div>
      </div>` },
    supplier: { title: 'مورد جديد — إضافة سريعة', icon: '🏭', w: 500, h: 380, fields: `
      <div class="grid-2">
        <div class="field" style="grid-column:1/-1"><span>اسم المورد *</span><input data-k="name" placeholder="مثال: ورشة حدادة النور"></div>
        <div class="field"><span>الهاتف</span><input data-k="phone" placeholder="01xxxxxxxxx"></div>
      </div>` },
    project: { title: 'مشروع جديد — إضافة سريعة', icon: '🏗️', w: 560, h: 460, fields: `
      <div class="grid-2">
        <div class="field" style="grid-column:1/-1"><span>اسم المشروع *</span><input data-k="name" placeholder="مثال: فيلا خاصة — التجمع الخامس"></div>
        <div class="field"><span>قيمة العقد (ج.م)</span><input data-k="contract" type="number" dir="ltr" placeholder="0"></div>
        <div class="field"><span>محتجز الضمان ٪</span><input data-k="retention" type="number" dir="ltr" value="10"></div>
      </div><p class="small muted mt">جدول الكميات وباقي البيانات من شاشة المشروعات — هنا ما يكفي لربط الفاتورة الآن.</p>` },
  }[kind]
  openWin({
    key: `quick-${kind}:${parent.id}`, icon: conf.icon, w: conf.w, h: conf.h,
    title: conf.title, subtitle: 'حفظ = إنشاء واختيار فوراً',
    askHint: 'لم يُحفظ السجل الجديد بعد. الإغلاق يلغي الإضافة — النافذة الأم لن تتأثر.',
    render: (win) => {
      win.body.innerHTML = conf.fields
      win.showFoot(`<span class="spacer"></span><button class="btn" data-a="cancel">إلغاء</button><button class="btn btn-ok" data-a="save">✔ حفظ واختيار</button>`)
      $$('input', win.body).forEach((i) => i.addEventListener('input', () => win.setDirty(true)))
      $('[data-a="cancel"]', win.foot).onclick = () => win.close()
      $('[data-a="save"]', win.foot).onclick = () => {
        const v = {}; $$('[data-k]', win.body).forEach((i) => v[i.dataset.k] = i.value.trim())
        if (!v.name) { toast('الاسم مطلوب لحفظ السجل', 'err'); return }
        let rec
        if (kind === 'item') { rec = { id: Math.max(...DB.items.map((i) => i.id)) + 1, name: v.name, unit: v.unit || 'قطعة', price: num(v.price) }; DB.items.push(rec) }
        if (kind === 'customer') { rec = { id: Math.max(...DB.customers.map((i) => i.id)) + 1, name: v.name, bal: 0, phone: v.phone || '—' }; DB.customers.push(rec) }
        if (kind === 'supplier') { rec = { id: Math.max(...DB.suppliers.map((i) => i.id)) + 1, name: v.name }; DB.suppliers.push(rec) }
        if (kind === 'project') { rec = { id: Math.max(...DB.projects.map((i) => i.id)) + 1, code: `PRJ-000${DB.projects.length + 6}`, name: v.name, customer: 1, contract: num(v.contract) || 300000, extracted: 0, invoicedDoc: 0, invoicedExtra: 0, retention: num(v.retention) || 10, advanceBalance: 0 }; DB.projects.push(rec) }
        win.setDirty(false); onSaved?.(rec); win.close(true); focusWin(parent); toast(`✅ أُنشئ «${rec.name}» واختير فوراً`, 'ok')
      }
    },
  })
}

/* ═══════════ N-03 مستخلص مبسّط (معالج ٣ خطوات) ═══════════ */
function openExtract() {
  openWin({
    key: 'extract-new', icon: '📐', w: 980, h: 640,
    title: 'مستخلص أعمال — برج النيل السكني', subtitle: 'طريقة مبسطة: ٣ خطوات فقط',
    askHint: 'نِسَب المستخلص لم تُرحَّل بعد. الإغلاق يفقد ما كتبته في هذا المستخلص فقط.',
    render: (win) => {
      const p = DB.projects[0]
      const S = { step: 1, pct: Object.fromEntries(DB.boq.map((b) => [b.code, b.prev])), vat: true, recovery: 0, final: false, desc: 'أعمال أسقف الدور الثالث ومباني الدور الثاني' }
      const sliceOf = (b) => Math.max(0, Math.round((b.qty * b.price * (num(S.pct[b.code]) - b.prev)) / 100))
      const gross = () => DB.boq.reduce((a, b) => a + sliceOf(b), 0)
      const draw = () => {
        const donePct = Math.round((p.extracted / p.contract) * 100)
        const stepsHtml = `<div class="steps">${['١ المشروع والدفعة', '٢ نِسَب بنود الأعمال', '٣ المراجعة والترحيل'].map((t, i) => `<span class="step ${S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : ''}"><i>${S.step > i + 1 ? '✓' : i + 1}</i>${t.slice(2)}</span>`).join('')}</div>`
        let inner = ''
        if (S.step === 1) inner = `
          <div class="grid-2">
            <div class="field mega-field"><span>المشروع</span><select><option>${p.code} — ${esc(p.name)}</option><option>PRJ-0007 — مخزن لوجستي — بدر (بلا جدول كميات: مبلغ إجمالي)</option></select></div>
            <div class="field"><span>وصف أعمال هذه الدفعة</span><input data-k="desc" value="${esc(S.desc)}"></div>
          </div>
          <div class="mt"><div class="small" style="font-weight:800;margin-bottom:6px">منفَّذ ومستخلَص حتى الآن: ${fmt(p.extracted)} من ${fmt(p.contract)} ج.م (${donePct}٪) — المتبقي من العقد ${fmt(p.contract - p.extracted)}</div>
          <div class="progress"><i style="width:${donePct}%"></i></div></div>
          <div class="mt"><div class="small" style="font-weight:800;margin-bottom:6px">تعبئة سريعة لنِسَب البنود (اختياري — أو عبّئ بنداً بنداً في الخطوة ٢):</div>
          <div class="chips">
            <button class="chip-btn" data-slice="10">+10٪ لكل بند جارٍ</button>
            <button class="chip-btn" data-slice="25">+25٪ لكل بند جارٍ</button>
            <button class="chip-btn" data-slice="100">إتمام كل البنود (ختامي)</button>
          </div></div>
          <div class="note-box mt">💡 لا أرقام مالية هنا إطلاقاً — المحتجز والضريبة واسترداد الدفعة المقدمة محجوبة حتى خطوة «المراجعة»، فلا تشتيت أثناء قياس الأعمال. هذا هو التبسيط المطلوب.</div>`
        if (S.step === 2) inner = `
          <table class="lines-table"><thead><tr><th style="width:40%">بند جدول الكميات</th><th>إجمالي البند</th><th>مفوتر سابقاً</th><th style="width:120px">النسبة الجديدة ٪</th><th class="num">قيمة هذه الدفعة</th></tr></thead>
          <tbody>${DB.boq.map((b) => `<tr>
            <td><b>${b.code}</b> — ${esc(b.name)}<br><span class="muted small">${fmt(b.qty)} ${b.unit} × ${fmt(b.price)} ج.م</span></td>
            <td>${fmt(b.qty * b.price)}</td><td>${b.prev}٪</td>
            <td><input type="number" min="${b.prev}" max="100" step="any" dir="ltr" data-pct="${b.code}" value="${S.pct[b.code]}"></td>
            <td class="num" data-slice="${b.code}">${sliceOf(b) ? fmt(sliceOf(b)) : '—'}</td></tr>`).join('')}</tbody></table>
          <p class="small muted mt">خانة إدخال واحدة لكل بند (النسبة التراكمية الجديدة) والقيمة تُحسب وحدها — بدل خانتي «كمية + نسبة» المترابطتين الحالية. البند المكتمل 100٪ مقفل فعلياً بسقفه.</p>
          <div class="totals"><div class="trow grand"><span>أعمال هذه الدفعة</span><b data-f="g">${fmt(gross())} ج.م</b></div></div>`
        if (S.step === 3) {
          const g = gross(), ret = Math.round(g * p.retention / 100), vat = S.vat ? Math.round(g * 0.14) : 0, due = g + vat - ret - num(S.recovery)
          inner = `<div class="grid-2">
            <div class="summary-card">
              <div class="trow"><span>قيمة الأعمال المنفذة</span><b>${fmt(g)} ج.م</b></div>
              <div class="trow"><span>محتجز ضمان أعمال (${p.retention}٪ ← 1105)</span><b>− ${fmt(ret)}</b></div>
              <div class="trow"><span>ضريبة قيمة مضافة 14٪</span><b>${S.vat ? `+ ${fmt(vat)}` : 'معطّلة'}</b></div>
              <div class="trow"><span>استرداد دفعة مقدمة (رصيدها ${fmt(p.advanceBalance)})</span><b>− ${fmt(S.recovery)}</b></div>
              <div class="trow due"><span>الصافي المستحق على العميل</span><b>${fmt(due)} ج.م</b></div>
            </div>
            <div>
              <div class="field"><span>استرداد من الدفعة المقدمة (ج.م)</span><input type="number" dir="ltr" data-k="recovery" value="${S.recovery || ''}" placeholder="0"></div>
              <div class="field mt"><span>التحصيل</span><select><option>آجل — مستحق على العميل (المتبع للمستخلصات)</option><option>محصَّل فوراً — خزينة/بنك</option></select></div>
              <label class="toggle mt"><input type="checkbox" data-k="vat" ${S.vat ? 'checked' : ''}> إخضاع المستخلص للضريبة</label>
              <details class="adv"><summary>خيارات متقدمة (نادرة — مطوية افتراضياً)</summary>
                <label class="toggle mt"><input type="checkbox" data-k="final" ${S.final ? 'checked' : ''}> مستخلص ختامي — لا مستخلصات بعده، ويبدأ مسار التسليم والإفراج عن المحتجز</label>
                <p class="small muted">دفع بالماكينة · بوابات اعتماد · تجاوز حد ائتمان — كلها هنا لا في وجهك كل مرة.</p></details>
            </div></div>
            <p class="small muted mt">الأثر المحاسبي (نفس محرك اليوم بلا تغيير): 1104 ذمة العميل بالصافي · 1105 محتجز · 4107 إيراد مقاولات · 2102 ضريبة. وبعد الترحيل يرتفع «متاح الفوترة مقابل مستخلصات» في أي فاتورة مفتوحة لهذا المشروع فوراً.</p>`
        }
        win.body.innerHTML = stepsHtml + inner
        win.showFoot(`<span class="small muted">الخطوة ${S.step} من ٣</span><span class="spacer"></span>
          ${S.step > 1 ? '<button class="btn" data-a="back">→ السابق</button>' : ''}
          ${S.step < 3 ? '<button class="btn btn-primary" data-a="next">التالي ←</button>' : '<button class="btn btn-ok" data-a="post">✔ ترحيل المستخلص</button>'}`)
        $$('[data-slice]', win.body).forEach((b) => { if (!b.dataset.pct) b.onclick = () => {
          const add = num(b.dataset.slice)
          DB.boq.forEach((x) => { if (x.prev < 100) S.pct[x.code] = Math.min(100, x.prev + add) })
          if (add >= 100) S.final = true
          win.setDirty(true); S.step = 2; draw()
        } })
        $$('[data-pct]', win.body).forEach((inp) => inp.oninput = () => {
          S.pct[inp.dataset.pct] = inp.value; win.setDirty(true)
          const b = DB.boq.find((x) => x.code === inp.dataset.pct)
          $(`[data-slice="${inp.dataset.pct}"]`, win.body).textContent = sliceOf(b) ? fmt(sliceOf(b)) : '—'
          $('[data-f="g"]', win.body).textContent = `${fmt(gross())} ج.م`
        })
        const desc = $('[data-k="desc"]', win.body); if (desc) desc.oninput = () => { S.desc = desc.value; win.setDirty(true) }
        const rec = $('[data-k="recovery"]', win.body); if (rec) { rec.oninput = () => win.setDirty(true); rec.onchange = () => { S.recovery = Math.min(num(rec.value), p.advanceBalance); draw() } }
        const vt = $('[data-k="vat"]', win.body); if (vt) vt.onchange = () => { S.vat = vt.checked; win.setDirty(true); draw() }
        const fin = $('[data-k="final"]', win.body); if (fin) fin.onchange = () => { S.final = fin.checked; win.setDirty(true) }
        $('[data-a="back"]', win.foot)?.addEventListener('click', () => { S.step--; draw() })
        $('[data-a="next"]', win.foot)?.addEventListener('click', () => {
          if (S.step === 2 && gross() <= 0) { toast('ارفع نسبة بند واحد على الأقل فوق سابقته', 'err'); return }
          S.step++; draw()
        })
        $('[data-a="post"]', win.foot)?.addEventListener('click', () => {
          const g = gross(); p.extracted += g; DB.boq.forEach((b) => b.prev = Math.max(b.prev, num(S.pct[b.code])))
          const no = `PRX-000${DB.prxSeq++}`
          win.setTitle(`مستخلص ${no} — برج النيل السكني`); win.setDirty(false)
          toast(`✅ رُحّل المستخلص ${no} بأعمال ${fmt(g)} ج.م${S.final ? ' (ختامي)' : ''} — ارتفع «متاح الفوترة» في فواتير المشروع المفتوحة`, 'ok')
          refreshAllGuards()
        })
      }
      draw()
    },
  })
}

/* ═══════════ N-04 مصروف مشروع بتصنيفات حرة ═══════════ */
let cats = (() => { try { return JSON.parse(localStorage.getItem('fw-cats') || 'null') } catch { return null } })()
  ?? ['مواد خام', 'وقود ومحروقات', 'عمالة يومية', 'نقل وشحن', 'صيانة معدات', 'إيجار معدات', 'رسوم وتراخيص', 'ضيافة موقع']
const saveCats = () => { try { localStorage.setItem('fw-cats', JSON.stringify(cats)) } catch { /* نموذج */ } }

function openExpense() {
  openWin({
    key: 'expense-new', icon: '💸', w: 1020, h: 640,
    title: 'تسجيل مصروف مشروع — جديد', subtitle: 'نافذة حرة · تصنيفات تنمو معك',
    askHint: 'بنود المصروف لم تُسجَّل بعد. الإغلاق يفقد هذا المصروف فقط.',
    render: (win) => {
      const S = {
        project: 1, supplier: 2, paidNow: '', source: 'خزينة رئيسية',
        lines: [
          { desc: 'سولار مولد الموقع — دفعة أسبوعية', cat: 'وقود ومحروقات', qty: 400, price: 17.5 },
          { desc: 'يوميات عمالة مساعدة (٦ عمال)', cat: 'عمالة يومية', qty: 6, price: 350 },
        ],
      }
      win.body.innerHTML = `
        <div class="head-wide">
          <div class="field mega-field"><span>المشروع المحمَّل عليه المصروف</span>
            <select data-f="project">${DB.projects.map((p) => `<option value="${p.id}">${p.code} — ${esc(p.name)}</option>`).join('')}</select>
            <span class="bal-chip" data-f="pmeta"></span></div>
          <div class="field mega-field"><span>المورد / الجهة (للآجل وكشف الحساب)</span>
            <div class="pick-row"><select class="grow" data-f="supplier"></select>
            <button class="plus-btn" data-act="newSupplier" title="مورد جديد — إضافة سريعة">＋</button></div></div>
        </div>
        <div class="head-row2">
          <div class="field"><span>التاريخ</span><input type="date" value="2026-10-22"></div>
          <div class="field"><span>رقم فاتورة/إيصال مرجعي</span><input placeholder="مثال: INV-8821"></div>
          <div class="field"><span>المدفوع الآن (ج.م)</span><input type="number" dir="ltr" data-f="paid" placeholder="0"></div>
          <div class="field"><span>مصدر المدفوع</span><select><option>خزينة رئيسية</option><option>البنك الأهلي — جارٍ</option><option>عهدة: م. موقع برج النيل</option></select></div>
        </div>
        <table class="lines-table">
          <thead><tr><th style="width:34%">بيان البند</th><th style="width:26%">التصنيف — اختر أو أنشئ من «أخرى…»</th><th style="width:90px">الكمية</th><th style="width:120px">السعر</th><th class="num" style="width:120px">القيمة</th><th style="width:38px"></th></tr></thead>
          <tbody data-f="lines"></tbody>
        </table>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-small" data-act="addLine">＋ بند مصروف</button>
          <label class="toggle"><input type="checkbox" data-f="vat"> توجد ضريبة مدخلات 14٪ تُسترد (2102)</label>
        </div>
        <div class="totals">
          <div class="trow"><span>صافي المصروف على المشروع (5110)</span><b data-f="tNet">0</b></div>
          <div class="trow"><span>ضريبة مدخلات مستردة</span><b data-f="tVat">0</b></div>
          <div class="trow grand"><span>الإجمالي · مدفوع الآن · متبقٍّ آجل</span><b data-f="tSplit">0</b></div>
        </div>
        <div class="err-box" data-f="err"></div>
        <div class="note-box mt">جرّب: اختر «أخرى…» في أي تصنيف واكتب اسماً جديداً (مثل «أتعاب مكتب هندسي») ثم «إضافة للقائمة» — سيُحفظ دائماً ويظهر في كل القوائم بعدها، كما طلبت بالضبط.</div>`
      win.showFoot(`<span class="small muted">تصنيفاتك الحرة محفوظة وتعود معك كل مرة</span><span class="spacer"></span>
        <button class="btn" data-a="close">إغلاق</button><button class="btn btn-ok" data-a="save">✔ تسجيل المصروف</button>`)
      const B = win.body, q = (s) => $(s, B)
      const supSel = q('[data-f="supplier"]')
      const fillSup = () => { supSel.innerHTML = `<option value="0">— بلا مورد (يجب أن يكون مدفوعاً بالكامل) —</option>` + DB.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join(''); supSel.value = String(S.supplier) }
      const catOptions = (sel) => cats.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('') + `<option value="__other">أخرى… (تصنيف جديد)</option>`
      const net = () => S.lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0)
      const renderTotals = () => {
        const n = net(), vat = q('[data-f="vat"]').checked ? Math.round(n * 0.14) : 0, paid = Math.min(num(q('[data-f="paid"]').value), n + vat)
        q('[data-f="tNet"]').textContent = `${fmt(n)} ج.م`
        q('[data-f="tVat"]').textContent = `${fmt(vat)} ج.م`
        q('[data-f="tSplit"]').textContent = `${fmt(n + vat)} · ${fmt(paid)} · ${fmt(n + vat - paid)}`
      }
      const renderMeta = () => { const p = projectOf(num(q('[data-f="project"]').value)); q('[data-f="pmeta"]').textContent = p ? `عقد ${fmt(p.contract)} ج.م · مستخلصات ${fmt(p.extracted)} (${Math.round(p.extracted / p.contract * 100)}٪ منجز)` : '' }
      const renderLines = () => {
        const tb = q('[data-f="lines"]'); tb.innerHTML = ''
        S.lines.forEach((l, i) => {
          const tr = document.createElement('tr')
          tr.innerHTML = `<td><input value="${esc(l.desc)}" data-l="desc" placeholder="بيان المصروف…"></td>
            <td><select data-l="cat">${catOptions(l.cat)}</select>
              <div class="other-add"><input placeholder="اسم التصنيف الجديد…"><button class="btn btn-small btn-ok" type="button">إضافة للقائمة</button></div></td>
            <td><input type="number" step="any" value="${l.qty}" data-l="qty" dir="ltr"></td>
            <td><input type="number" step="any" value="${l.price}" data-l="price" dir="ltr"></td>
            <td class="num" data-l="total">${fmt(num(l.qty) * num(l.price))}</td>
            <td><button class="row-del" title="حذف">🗑</button></td>`
          const catSel = $('[data-l="cat"]', tr), otherBox = $('.other-add', tr)
          catSel.onchange = () => {
            if (catSel.value === '__other') { otherBox.classList.add('show'); $('input', otherBox).focus() }
            else { otherBox.classList.remove('show'); S.lines[i].cat = catSel.value; win.setDirty(true) }
          }
          $('button', otherBox).onclick = () => {
            const name = $('input', otherBox).value.trim()
            if (!name) { toast('اكتب اسم التصنيف أولاً', 'err'); return }
            if (!cats.includes(name)) { cats.push(name); saveCats() }
            S.lines[i].cat = name; win.setDirty(true); renderLines()
            toast(`✅ أُضيف التصنيف «${name}» لقائمتك الدائمة — سيظهر في كل مصروفات المشاريع بعد الآن`, 'ok')
          }
          $$('[data-l="desc"],[data-l="qty"],[data-l="price"]', tr).forEach((inp) => inp.oninput = () => {
            S.lines[i][inp.dataset.l] = inp.value
            $('[data-l="total"]', tr).textContent = fmt(num(S.lines[i].qty) * num(S.lines[i].price))
            win.setDirty(true); renderTotals()
          })
          $('.row-del', tr).onclick = () => { if (S.lines.length > 1) { S.lines.splice(i, 1); renderLines(); renderTotals(); win.setDirty(true) } }
          tb.appendChild(tr)
        })
      }
      fillSup(); renderLines(); renderTotals(); renderMeta()
      q('[data-f="project"]').onchange = () => { renderMeta(); win.setDirty(true) }
      q('[data-f="paid"]').oninput = () => { win.setDirty(true); renderTotals() }
      q('[data-f="vat"]').onchange = () => { win.setDirty(true); renderTotals() }
      supSel.onchange = () => { S.supplier = num(supSel.value); win.setDirty(true) }
      $('[data-act="addLine"]', B).onclick = () => { S.lines.push({ desc: '', cat: cats[0], qty: 1, price: 0 }); renderLines(); win.setDirty(true) }
      $('[data-act="newSupplier"]', B).onclick = () => openQuickAdd('supplier', win, (s) => { S.supplier = s.id; fillSup() })
      $('[data-a="close"]', win.foot).onclick = () => win.close()
      $('[data-a="save"]', win.foot).onclick = () => {
        const err = q('[data-f="err"]'); const n = net()
        const vat = q('[data-f="vat"]').checked ? Math.round(n * 0.14) : 0
        const paid = num(q('[data-f="paid"]').value), due = n + vat - paid
        if (n <= 0) { err.textContent = '⛔ أدخل بنداً بقيمة موجبة'; err.classList.add('show'); return }
        if (due > 0 && !S.supplier) { err.textContent = '⛔ يوجد متبقٍّ آجل — اختر المورد أو الجهة ليظهر في كشف حسابها'; err.classList.add('show'); return }
        err.classList.remove('show')
        const no = `PEX-000${DB.pexSeq++}`
        win.setTitle(`مصروف مشروع ${no} — ${projectOf(num(q('[data-f="project"]').value))?.code}`); win.setDirty(false)
        toast(`✅ سُجّل المصروف ${no} على المشروع: صافي ${fmt(n)} · مدفوع ${fmt(paid)} · آجل ${fmt(due)}`, 'ok')
      }
    },
  })
}

/* ═══════════ N-09 صفحات كاملة كنوافذ (الإعدادات) ═══════════ */
const SETTINGS = {
  general: { icon: '⚙️', title: 'الإعدادات العامة', body: `
    <div class="grid-2">
      <div class="field" style="grid-column:1/-1"><span>اسم المنشأة</span><input value="شركة التعمير للمقاولات والتطوير"></div>
      <div class="field"><span>الدولة / العملة</span><select><option>مصر — جنيه مصري (ج.م)</option><option>السعودية — ريال</option></select></div>
      <div class="field"><span>بداية السنة المالية</span><input type="date" value="2026-01-01"></div>
      <div class="field"><span>لغة الواجهة</span><select><option>العربية (RTL)</option><option>English</option></select></div>
      <div class="field"><span>نمط التنقل</span><select><option>شريط قوائم علوي (Windows)</option><option>شريط جانبي</option></select></div>
    </div><p class="small muted mt">صفحة إعدادات كاملة داخل نافذة مستقلة — عدّل هنا بينما فاتورتك مفتوحة بجانبك، والحفظ لا يغلق شيئاً.</p>` },
  tax: { icon: '🧮', title: 'إعدادات الضريبة', body: `
    <div class="grid-2">
      <div class="field"><span>حالة التسجيل الضريبي</span><select><option>مسجلة ض.ق.م</option><option>غير مسجلة</option></select></div>
      <div class="field"><span>نسبة ض.ق.م ٪</span><input type="number" dir="ltr" value="14"></div>
      <div class="field"><span>الرقم الضريبي</span><input dir="ltr" value="204-555-821"></div>
      <div class="field"><span>نمط الأسعار</span><select><option>الأسعار شاملة الضريبة</option><option>تُضاف الضريبة فوق السعر</option></select></div>
    </div><label class="toggle mt"><input type="checkbox" checked> الفاتورة الإلكترونية (ETA) مفعلة</label>` },
  invoice: { icon: '🖨️', title: 'إعدادات الفاتورة والطباعة', body: `
    <div class="grid-2">
      <div class="field"><span>القالب الافتراضي</span><select><option>A4 رسمي — للمقاولات والمستخلصات</option><option>A5</option><option>حراري 80mm</option></select></div>
      <div class="field"><span>طابعة المستندات الرسمية</span><select><option>HP LaserJet — مكتب الإدارة</option><option>حفظ PDF فقط</option></select></div>
      <div class="field" style="grid-column:1/-1"><span>تذييل الفاتورة</span><input value="شكراً لتعاملكم — السداد خلال 30 يوماً من اعتماد المستخلص"></div>
    </div>
    <label class="toggle mt"><input type="checkbox" checked> إظهار الشعار والترويسة</label><br>
    <label class="toggle"><input type="checkbox"> طباعة صامتة دون معاينة</label>` },
}
function openSettings(kind) {
  const c = SETTINGS[kind]
  return openWin({
    key: `settings-${kind}`, icon: c.icon, w: 580, h: 520,
    title: c.title, subtitle: 'صفحة كاملة كنافذة مستقلة',
    askHint: `توجد تعديلات غير محفوظة في «${c.title}». الإغلاق يفقدها — نوافذ الإعدادات الأخرى لن تتأثر.`,
    render: (win) => {
      win.body.innerHTML = c.body
      win.showFoot(`<span class="small muted">تفتح بجانب أي نافذة أخرى وتعيش باستقلال</span><span class="spacer"></span>
        <button class="btn" data-a="close">إغلاق</button><button class="btn btn-primary" data-a="save">💾 حفظ الإعدادات</button>`)
      $$('input, select', win.body).forEach((i) => i.addEventListener('input', () => win.setDirty(true)))
      $('[data-a="close"]', win.foot).onclick = () => win.close()
      $('[data-a="save"]', win.foot).onclick = () => { win.setDirty(false); toast(`✅ حُفظت «${c.title}» — بقيت النافذة والبقية مفتوحات`, 'ok') }
    },
  })
}

/* ═══════════ جدول خلفية المقاولات ═══════════ */
function renderBgInvoices() {
  const pf = num($('#bgProjectFilter').value), q = $('#bgSearch').value.trim()
  const rows = DB.invoices.filter((s) => (!pf || s.project === pf) && (!q || s.no.includes(q) || customerName(s.customer).includes(q)))
  $('#bgInvoicesBody').innerHTML = rows.map((s) => {
    const p = projectOf(s.project), remain = s.total - s.paid
    return `<tr><td><b>${s.no}</b></td><td>${s.date}</td>
      <td><span class="pill ${s.nature.includes('مقابل') ? 'doc' : s.project ? 'proj' : ''}">${esc(s.nature)}</span></td>
      <td>${p ? `${p.code} — ${esc(p.name.split('—')[0])}` : '<span class="pill">حرة</span>'}</td>
      <td title="${esc(customerName(s.customer))}">${esc(customerName(s.customer).slice(0, 34))}…</td>
      <td class="num"><b>${fmt(s.total)}</b></td><td class="num" style="color:var(--ok)">${fmt(s.paid)}</td>
      <td class="num" style="color:${remain ? 'var(--warn)' : '#9c9c9c'}">${remain ? fmt(remain) : '✓ مسددة'}</td>
      <td><button class="btn btn-small" data-edit="${s.no}">✎ فتح كنافذة</button></td></tr>`
  }).join('') || '<tr><td colspan="9"><div class="empty">لا فواتير مطابقة</div></td></tr>'
  $('#bgFilterNote').textContent = pf ? `معروض: فواتير ${projectOf(pf)?.code} فقط (${rows.length})` : `معروض: كل الفواتير (${rows.length})`
  $$('[data-edit]').forEach((b) => b.onclick = () => {
    const inv = DB.invoices.find((x) => x.no === b.dataset.edit)
    const w = openInvoice({ customer: inv.customer, project: inv.project, nature: inv.nature.includes('مقابل') ? 'against' : 'extra', lines: [{ name: `بنود الفاتورة ${inv.no} (للمعاينة)`, unit: 'مقطوعية', qty: 1, price: Math.round(inv.total / 1.14) }] })
    if (w) w.setTitle(`فاتورة بيع — ${inv.no} (مراجعة)`)
  })
}
$('#bgProjectFilter').onchange = renderBgInvoices
$('#bgSearch').oninput = renderBgInvoices
renderBgInvoices()

/* ═══════════ الربط: سجل النوافذ + الساعة ═══════════ */
const actions = {
  'invoice-free': () => openInvoice(),
  'invoice-project': () => openInvoice({
    customer: 1, project: 1, nature: 'against',
    lines: [{ name: 'كامل أعمال المشروع — محاولة خاطئة للتجربة (خفّضها إلى 240,000 لتنجح)', unit: 'مقطوعية', qty: 1, price: 1200000 }],
  }),
  'invoice-two': () => { openInvoice(); openInvoice({ customer: 3, project: 0, lines: [{ name: 'يومية نجار مسلح (صنايعي)', unit: 'يوم', qty: 10, price: 650 }] }); arrange('tile') },
  'extract': () => openExtract(),
  'expense': () => openExpense(),
  'settings-general': () => openSettings('general'),
  'settings-tax': () => openSettings('tax'),
  'settings-invoice': () => openSettings('invoice'),
  'settings-three': () => { openSettings('general'); openSettings('tax'); openSettings('invoice'); arrange('tile') },
}
$$('[data-open]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.open]?.()))
$$('[data-arrange]').forEach((b) => b.addEventListener('click', () => arrange(b.dataset.arrange)))
$('#launcherToggle').onclick = () => { $('#launcher').classList.add('hidden'); $('#launcherFab').classList.add('show') }
$('#launcherFab').onclick = () => { $('#launcher').classList.remove('hidden'); $('#launcherFab').classList.remove('show') }
const tick = () => { $('#clock').textContent = new Date().toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }) }
tick(); setInterval(tick, 30000); renderChips()
