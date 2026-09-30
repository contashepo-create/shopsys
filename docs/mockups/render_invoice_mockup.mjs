/**
 * مولّد صور التصميم المقترح لشاشة الفاتورة (قبل التنفيذ).
 * يرسم SVG يدوياً ثم يحوّله PNG عبر resvg مع خط Cairo — لأن البيئة بلا متصفح.
 *
 * التشغيل:  node docs/mockups/render_invoice_mockup.mjs
 * المتطلبات (خارج المستودع، لا تُلزم التطبيق):
 *   npm i --prefix /home/user/tools @resvg/resvg-js @expo-google-fonts/cairo
 */
import { writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/home/user/tools/')
const { Resvg } = require('@resvg/resvg-js')
const FONTS = [
  '/home/user/tools/node_modules/@expo-google-fonts/cairo/400Regular/Cairo_400Regular.ttf',
  '/home/user/tools/node_modules/@expo-google-fonts/cairo/600SemiBold/Cairo_600SemiBold.ttf',
  '/home/user/tools/node_modules/@expo-google-fonts/cairo/700Bold/Cairo_700Bold.ttf',
].filter((file) => existsSync(file))

// ── لوحة ألوان المستند (نفس متغيرات --doc-* في index.css) ───────────────
const C = {
  ink: '#0f172a', inkSoft: '#1e293b', surface: '#f1f5f9', paper: '#ffffff',
  tint: '#f8fafc', tintStrong: '#eef2ff', band: '#f1f5f9', line: '#e2e8f0',
  muted: '#475569', faint: '#64748b', accent: '#4338ca', accentDeep: '#3730a3',
  ok: '#047857', okTint: '#ecfdf5', okLine: '#a7f3d0',
  danger: '#b91c1c', dangerTint: '#fef2f2', dangerLine: '#fecaca',
  warn: '#b45309', warnTint: '#fffbeb', warnLine: '#fde68a',
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 8}" fill="${o.fill ?? C.paper}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="Cairo" font-size="${o.size ?? 13}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.inkSoft}" text-anchor="${o.anchor ?? 'end'}"${o.rtl === false ? '' : ' direction="rtl"'}${o.mono ? ' letter-spacing="0.2"' : ''}>${esc(s)}</text>`
const num = (x, y, s, o = {}) => txt(x, y, s, { ...o, rtl: false, anchor: o.anchor ?? 'start' })
// ── أيقونات مرسومة (الخط لا يملك رموز الإيموجي) ──────────────────────
const ico = {
  edit: (cx, cy, f = C.faint) => `<g stroke="${f}" stroke-width="1.3" fill="none" stroke-linecap="round"><path d="M${cx - 4} ${cy + 4} l0 -3 l6 -6 l3 3 l-6 6 z"/><path d="M${cx - 4} ${cy + 4} h1.5"/></g>`,
  copy: (cx, cy, f = C.faint) => `<g stroke="${f}" stroke-width="1.2" fill="none"><rect x="${cx - 5}" y="${cy - 5}" width="7" height="8" rx="1.5"/><rect x="${cx - 2}" y="${cy - 2}" width="7" height="8" rx="1.5" fill="#fff"/></g>`,
  trash: (cx, cy, f = C.danger) => `<g stroke="${f}" stroke-width="1.2" fill="none" stroke-linecap="round"><path d="M${cx - 5} ${cy - 3} h10"/><path d="M${cx - 3.5} ${cy - 3} v7 M${cx} ${cy - 3} v7 M${cx + 3.5} ${cy - 3} v7"/><path d="M${cx - 4} ${cy - 3} l.8 8 h6.4 l.8 -8"/><path d="M${cx - 1.6} ${cy - 5} h3.2"/></g>`,
  plus: (cx, cy, f = C.accentDeep) => `<g stroke="${f}" stroke-width="1.6" stroke-linecap="round"><path d="M${cx - 4} ${cy} h8 M${cx} ${cy - 4} v8"/></g>`,
  check: (cx, cy, f = '#fff') => `<path d="M${cx - 5} ${cy} l3.5 3.5 l6.5 -7" stroke="${f}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  caret: (cx, cy, f = C.faint) => `<path d="M${cx - 3.5} ${cy - 1.5} l3.5 4 l3.5 -4" stroke="${f}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  search: (cx, cy, f = C.faint) => `<g stroke="${f}" stroke-width="1.4" fill="none" stroke-linecap="round"><circle cx="${cx - 1}" cy="${cy - 1}" r="4"/><path d="M${cx + 2.5} ${cy + 2.5} l3 3"/></g>`,
  barcode: (cx, cy, f = C.faint) => `<g stroke="${f}" stroke-width="1.1">${[-6, -3.5, -1.5, 1, 3.5, 6].map((d, i) => `<path d="M${cx + d} ${cy - 5} v10" stroke-width="${i % 2 ? 1.8 : 1}"/>`).join('')}</g>`,
  clip: (cx, cy, f = C.faint) => `<path d="M${cx + 3} ${cy - 4} l-6 6 a2.6 2.6 0 0 0 3.6 3.6 l6 -6 a3.8 3.8 0 0 0 -5.4 -5.4 l-5.6 5.6" stroke="${f}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  wallet: (cx, cy, f = C.warn) => `<g stroke="${f}" stroke-width="1.2" fill="none"><rect x="${cx - 6}" y="${cy - 4}" width="12" height="9" rx="2"/><path d="M${cx + 1} ${cy + .5} h4"/></g>`,
}
/** رقاقة بنص وأيقونة اختيارية على يمين النص */

/** رقاقة صغيرة تُرسم من حافتها اليمنى (RTL) وتُعيد العرض المستهلك */
function chip(xRight, yTop, label, o = {}) {
  const size = o.size ?? 11
  const iconW = o.icon ? 16 : 0
  const w = o.w ?? Math.round(label.length * size * 0.53) + 18 + iconW
  const h = o.h ?? 20
  const cy = yTop + h / 2
  let svg = rect(xRight - w, yTop, w, h, { r: 5, fill: o.fill ?? C.paper, stroke: o.stroke ?? C.line })
  svg += txt(xRight - 8 - iconW, cy + size * 0.36, label, { size, weight: o.weight ?? 700, fill: o.fill2 ?? C.muted })
  if (o.icon) svg += ico[o.icon](xRight - 9, cy, o.iconFill ?? o.fill2 ?? C.faint)
  return { svg, w: w + (o.gap ?? 6) }
}
function chipRow(xRight, yTop, chips) {
  let x = xRight, out = ''
  for (const c of chips) { const made = chip(x, yTop, c.label, c); out += made.svg; x -= made.w }
  return out
}
function field(xRight, y, w, label, value, o = {}) {
  return txt(xRight, y + 11, label, { size: 11, weight: 700, fill: C.muted })
    + rect(xRight - w, y + 16, w, 30, { r: 6, fill: o.fill ?? C.paper, stroke: o.stroke ?? C.line })
    + txt(xRight - 9, y + 36, value, { size: 12.5, weight: o.vw ?? 600, fill: o.vf ?? C.ink })
    + (o.tag ? chip(xRight - w + 46, y + 20, o.tag, { size: 9, h: 16, fill: C.tintStrong, stroke: C.tintStrong, fill2: C.accentDeep }).svg : '')
}

const W = 1680, H = 1014, RX = 1666, LX = 14
const rows = { top: 14, header: 68, entry: 210, lines: 262, panels: 700, status: 922 }
const hh = { top: 46, header: 134, entry: 44, lines: 428, panels: 214, status: 38 }

// ═══ ① شريط المستند ═══════════════════════════════════════════════════
function topBar(y) {
  let s = rect(LX, y, RX - LX, hh.top, { stroke: C.line })
  s += [1648, 1634, 1620].map((cx) => `<circle cx="${cx}" cy="${y + 23}" r="5" fill="${C.line}"/>`).join('')
  s += `<line x1="1606" y1="${y + 14}" x2="1606" y2="${y + 32}" stroke="${C.line}"/>`
  for (const [i, g] of ['←', '≡', '؟'].entries()) s += txt(1590 - i * 26, y + 28, g, { size: 15, fill: C.faint, anchor: 'middle' })
  s += rect(1360, y + 11, 150, 24, { r: 6, fill: C.tint, stroke: C.line })
  s += txt(1502, y + 27, 'فاتورة مبيعات · S-0042', { size: 12, weight: 700, fill: C.ink })
  s += chip(1358, y + 13, 'مسودة', { size: 10, h: 20, fill: C.warnTint, stroke: C.warnLine, fill2: C.warn }).svg
  // اليسار: زر الترحيل الوحيد في النظام
  s += rect(LX + 8, y + 9, 300, 28, { r: 7, fill: C.accent, stroke: C.accent })
  s += ico.check(LX + 294, y + 23, '#fff')
  s += txt(LX + 284, y + 28, 'ترحيل وتحصيل', { size: 13, weight: 700, fill: '#fff' })
  s += num(LX + 58, y + 28, '11,200.00', { size: 12.5, weight: 700, fill: '#e0e7ff' })
  s += rect(LX + 18, y + 15, 28, 16, { r: 4, fill: 'none', stroke: '#c7d2fe' })
  s += txt(LX + 32, y + 27, 'F9', { size: 9.5, weight: 700, fill: '#e0e7ff', anchor: 'middle' })
  let x = 596
  for (const [label, key] of [['المسودات (2)', ''], ['حفظ مسودة', 'F8'], ['معاينة', 'F6']]) {
    const w = key ? 104 : 96
    s += rect(x - w, y + 9, w, 28, { r: 7, fill: C.paper, stroke: C.line })
    s += txt(x - 10, y + 28, label, { size: 12, weight: 700, fill: C.muted })
    if (key) s += txt(x - w + 18, y + 28, key, { size: 9.5, weight: 700, fill: C.faint, anchor: 'middle' })
    x -= w + 8
  }
  return s
}

// ═══ ② ترويسة الفاتورة ════════════════════════════════════════════════
function headerCard(y) {
  let s = rect(LX, y, RX - LX, hh.header, { stroke: C.line })
  const fx = RX - 10, colW = 330, gap = 12
  const r1 = [['العميل', 'مؤسسة النخيل التجارية'], ['التاريخ', '2026-09-28'], ['الاستحقاق', '2026-10-28'], ['المرجع / أمر الشراء', 'PO-9841']]
  const r2 = [['المخزن', 'المخزن الرئيسي'], ['نمط الفاتورة', 'قياسي'], ['مركز التكلفة', 'الفرع الرئيسي'], ['المشروع', 'بدون']]
  r1.forEach(([l, v], i) => { s += field(fx - i * (colW + gap), y + 8, colW, l, v) })
  r2.forEach(([l, v], i) => {
    s += field(fx - i * (colW + gap), y + 66, colW, l, v, i >= 2 ? { fill: C.tint, vf: C.faint, tag: 'متقدم' } : i === 1 ? { tag: 'يغيّر الأعمدة' } : {})
  })
  // بطاقة الطرف على اليسار
  const px = LX + 10, pw = 250
  s += rect(px, y + 10, pw, hh.header - 20, { r: 8, fill: C.tint, stroke: C.line })
  s += txt(px + pw - 10, y + 32, 'مؤسسة النخيل التجارية', { size: 13, weight: 700, fill: C.ink })
  s += `<circle cx="${px + 16}" cy="${y + 28}" r="4" fill="${C.ok}"/>`
  s += txt(px + 46, y + 32, 'نشط', { size: 10.5, weight: 700, fill: C.ok })
  const prow = (i, label, value, color) =>
    txt(px + pw - 10, y + 58 + i * 22, label, { size: 11, weight: 600, fill: C.faint })
    + num(px + 10, y + 58 + i * 22, value, { size: 11.5, weight: 700, fill: color ?? C.inkSoft })
  s += prow(0, 'الرصيد الحالي', '4,300.00') + prow(1, 'بعد هذه الفاتورة', '15,500.00', C.warn) + prow(2, 'حد الائتمان', '50,000.00')
  return s
}

// ═══ ③ شريط الإدخال ═══════════════════════════════════════════════════
function entryBar(y) {
  let s = rect(LX, y, RX - LX, hh.entry, { stroke: C.line })
  s += rect(452, y + 8, RX - 10 - 452, 28, { r: 7, fill: C.tint, stroke: C.line })
  s += ico.barcode(RX - 26, y + 22, C.accent)
  s += txt(RX - 40, y + 27, 'امسح الباركود أو اكتب اسم الصنف / الكود السريع', { size: 12, fill: C.faint })
  s += chip(500, y + 13, 'جاهز للمسح', { size: 10, h: 18, fill: C.okTint, stroke: C.okLine, fill2: C.ok }).svg
  s += chip(578, y + 13, 'F5', { size: 10, h: 18, w: 34 }).svg
  let x = 442
  for (const [label, w, primary] of [['كل الأصناف ▾', 116, false], ['تصفية', 74, false], ['إضافة سريعة', 130, true], ['بحث العميل', 104, false]]) {
    s += rect(x - w, y + 8, w, 28, { r: 7, fill: primary ? C.accent : C.paper, stroke: primary ? C.accent : C.line })
    s += txt(x - w / 2, y + 27, label, { size: 12, weight: 700, fill: primary ? '#fff' : C.muted, anchor: 'middle' })
    x -= w + 8
  }
  return s
}

// ═══ ④ جدول البنود ════════════════════════════════════════════════════
const COLS = [ // من اليمين إلى اليسار
  { key: 'no', label: 'م', w: 42, align: 'center' },
  { key: 'code', label: 'كود الصنف', w: 108, align: 'num' },
  { key: 'desc', label: 'الصنف / الوصف', w: 0, align: 'rtl' },
  { key: 'qty', label: 'الكمية', w: 96, align: 'input' },
  { key: 'unit', label: 'الوحدة', w: 86, align: 'select' },
  { key: 'price', label: 'السعر', w: 112, align: 'input' },
  { key: 'disc', label: 'خصم %', w: 82, align: 'input' },
  { key: 'tax', label: 'الضريبة', w: 92, align: 'chip' },
  { key: 'total', label: 'الإجمالي', w: 134, align: 'num' },
  { key: 'tools', label: 'إجراءات', w: 92, align: 'tools' },
]
function linesCard(y) {
  const cardW = RX - LX, innerR = RX - 14, innerL = LX + 14
  let s = rect(LX, y, cardW, hh.lines, { stroke: C.line })
  // ترويسة القسم
  s += `<path d="M${LX} ${y + 8} a8 8 0 0 1 8 -8 h${cardW - 16} a8 8 0 0 1 8 8 v24 h-${cardW} z" fill="${C.band}"/>`
  s += `<line x1="${LX}" y1="${y + 32}" x2="${RX}" y2="${y + 32}" stroke="${C.line}"/>`
  s += txt(innerR, y + 22, 'الأصناف والكميات والأسعار', { size: 13, weight: 700, fill: C.inkSoft })
  s += chipRow(innerR - 190, y + 6, [
    { label: '2 بند', size: 10, h: 20, fill: C.tintStrong, stroke: C.tintStrong, fill2: C.accentDeep },
    { label: 'قيمة البنود 11,200.00 ر.س', size: 10, h: 20, fill: C.okTint, stroke: C.okLine, fill2: C.ok },
  ])
  s += txt(innerL + 320, y + 22, 'Enter للسطر التالي · Ctrl+D تكرار · Del حذف', { size: 10.5, weight: 600, fill: C.faint })
  // حساب عرض عمود الوصف
  const fixed = COLS.reduce((sum, col) => sum + col.w, 0)
  const descW = innerR - innerL - fixed
  const xs = []; let cx = innerR
  for (const col of COLS) { const w = col.w || descW; xs.push({ ...col, right: cx, w }); cx -= w }
  // رأس الجدول
  const headY = y + 32
  s += `<rect x="${LX + 1}" y="${headY}" width="${cardW - 2}" height="30" fill="${C.tint}"/>`
  s += `<line x1="${LX}" y1="${headY + 30}" x2="${RX}" y2="${headY + 30}" stroke="${C.line}"/>`
  for (const col of xs) {
    const anchor = ['num', 'input'].includes(col.align) ? 'start' : col.align === 'center' ? 'middle' : 'end'
    const x = anchor === 'start' ? col.right - col.w + 8 : anchor === 'middle' ? col.right - col.w / 2 : col.right - 8
    s += txt(x, headY + 20, col.label, { size: 11, weight: 700, fill: C.muted, anchor, rtl: anchor !== 'start' })
  }
  // الصفوف
  const data = [
    { no: '1', code: 'ITM-1001', name: 'تمر سكري فاخر', sub: 'متاح 1000 كجم · المخزن الرئيسي', qty: '100', unit: 'كجم', price: '100.00', disc: '0', tax: 'معفى', total: '10,000.00' },
    { no: '2', code: 'ITM-1042', name: 'عسل سدر جبلي', sub: 'متاح 60 كجم · المخزن الرئيسي', qty: '10', unit: 'كجم', price: '120.00', disc: '0', tax: 'معفى', total: '1,200.00' },
  ]
  let ry = headY + 30
  const rowH = 44
  data.forEach((row) => {
    s += `<line x1="${LX}" y1="${ry + rowH}" x2="${RX}" y2="${ry + rowH}" stroke="${C.line}"/>`
    for (const col of xs) {
      const cxRight = col.right, mid = ry + rowH / 2
      if (col.key === 'no') s += txt(cxRight - col.w / 2, mid + 4, row.no, { size: 11.5, fill: C.faint, anchor: 'middle' })
      else if (col.key === 'code') s += num(cxRight - col.w + 8, mid + 4, row.code, { size: 11.5, fill: C.inkSoft })
      else if (col.key === 'desc') {
        s += txt(cxRight - 8, mid - 3, row.name, { size: 12.5, weight: 700, fill: C.ink })
        s += txt(cxRight - 8, mid + 13, row.sub, { size: 10, fill: C.faint })
      } else if (['qty', 'price', 'disc'].includes(col.key)) {
        s += rect(cxRight - col.w + 6, ry + 10, col.w - 12, 24, { r: 5, fill: C.paper, stroke: C.line })
        s += num(cxRight - col.w + 14, mid + 4, row[col.key], { size: 12, weight: 600, fill: C.ink })
      } else if (col.key === 'unit') {
        s += rect(cxRight - col.w + 6, ry + 10, col.w - 12, 24, { r: 5, fill: C.paper, stroke: C.line })
        s += txt(cxRight - 14, mid + 4, row.unit, { size: 11.5, weight: 600, fill: C.ink })
        s += ico.caret(cxRight - col.w + 18, mid - 1)
      } else if (col.key === 'tax') s += chip(cxRight - 10, ry + 12, row.tax, { size: 10, h: 20, fill: C.tint, fill2: C.faint }).svg
      else if (col.key === 'total') s += num(cxRight - col.w + 10, mid + 4, row.total, { size: 13, weight: 700, fill: C.ink })
      else if (col.key === 'tools') {
        s += ico.edit(cxRight - 22, mid) + ico.copy(cxRight - 46, mid) + ico.trash(cxRight - 70, mid)
      }
    }
    ry += rowH
  })
  // سطر الإضافة الشبحي + فراغ نظيف
  s += ico.plus(innerR - 14, ry + 22, '#94a3b8')
  s += txt(innerR - 28, ry + 26, 'اكتب أو امسح لإضافة صنف جديد…', { size: 11.5, fill: '#94a3b8' })
  // تذييل الجدول: أدوات السطر يميناً ورقاقات المصروفات يساراً
  const footY = y + hh.lines - 38
  s += `<rect x="${LX + 1}" y="${footY}" width="${cardW - 2}" height="37" fill="${C.tint}"/>`
  s += `<line x1="${LX}" y1="${footY}" x2="${RX}" y2="${footY}" stroke="${C.line}"/>`
  s += chipRow(innerR, footY + 8, [
    { label: 'إضافة صنف أو خدمة', size: 11, h: 22, fill: C.paper, fill2: C.accentDeep, stroke: C.line, icon: 'plus' },
    { label: 'تكرار السطر', size: 11, h: 22, icon: 'copy' }, { label: 'حذف السطر', size: 11, h: 22, icon: 'trash' }, { label: 'مسح باركود', size: 11, h: 22, icon: 'barcode' },
  ])
  s += chipRow(innerL + 470, footY + 8, [
    { label: 'مرفقات (0)', size: 11, h: 22, icon: 'clip' },
    { label: 'عمولة موظف', size: 11, h: 22, icon: 'plus', iconFill: C.faint },
    { label: 'مصروف داخلي (0)', size: 11, h: 22, fill: C.warnTint, stroke: C.warnLine, fill2: C.warn, icon: 'wallet' },
    { label: 'مصروف على العميل (0)', size: 11, h: 22, fill: C.warnTint, stroke: C.warnLine, fill2: C.warn, icon: 'wallet' },
  ])
  return s
}

// ═══ ⑤ اللوحات الثلاث بارتفاع واحد ═════════════════════════════════════
function panels(y) {
  const gap = 10, pw = Math.floor((RX - LX - gap * 2) / 3), h = hh.panels
  const mk = (x, title, sub, body, foot) => {
    let s = rect(x, y, pw, h, { stroke: C.line })
    s += `<path d="M${x} ${y + 8} a8 8 0 0 1 8 -8 h${pw - 16} a8 8 0 0 1 8 8 v20 h-${pw} z" fill="${C.band}"/>`
    s += `<line x1="${x}" y1="${y + 28}" x2="${x + pw}" y2="${y + 28}" stroke="${C.line}"/>`
    s += txt(x + pw - 10, y + 20, title, { size: 12.5, weight: 700, fill: C.inkSoft })
    s += txt(x + 10, y + 20, sub, { size: 10, weight: 600, fill: C.faint, anchor: 'start', rtl: true })
    s += body(x, y + 36)
    s += `<line x1="${x}" y1="${y + h - 28}" x2="${x + pw}" y2="${y + h - 28}" stroke="${C.line}"/>`
    s += `<rect x="${x + 1}" y="${y + h - 27}" width="${pw - 2}" height="26" fill="${C.tint}"/>`
    s += foot(x, y + h - 10)
    return s
  }
  const xNotes = RX - pw, xCollect = xNotes - pw - gap, xTotals = xCollect - pw - gap
  // ① الملاحظات والشروط
  let s = mk(xNotes, 'الملاحظات وشروط التعامل', 'تُطبع في نسخة العميل', (x, yy) => {
    let b = chipRow(x + pw - 10, yy, [{ label: 'السداد خلال 30 يوماً', size: 10, h: 20, icon: 'plus', iconFill: C.faint }, { label: 'لا يُرد ولا يُستبدل', size: 10, h: 20, icon: 'plus', iconFill: C.faint }])
    b += chipRow(x + pw - 10, yy + 26, [{ label: 'التسليم من المخزن', size: 10, h: 20, icon: 'plus', iconFill: C.faint }, { label: 'ضمان سنة', size: 10, h: 20, icon: 'plus', iconFill: C.faint }])
    b += rect(x + 10, yy + 52, pw - 20, 74, { r: 6, fill: C.paper, stroke: C.line })
    b += txt(x + pw - 20, yy + 72, 'شروط السداد · موعد التسليم · أي تعهد يظهر للعميل…', { size: 10.5, fill: '#94a3b8' })
    return b
  }, (x, yy) => txt(x + pw - 10, yy, 'تاريخ الاستحقاق', { size: 11, weight: 700, fill: C.muted }) + num(x + 10, yy, '2026-10-28', { size: 11, weight: 700, fill: C.inkSoft }))
  // ② التحصيل الآن
  s += mk(xCollect, 'التحصيل الآن', 'نقدية / بنك', (x, yy) => {
    let b = ''
    const segW = Math.floor((pw - 20 - 8) / 3)
    ;['نقدي', 'تحويل بنكي', 'ماكينة دفع'].forEach((label, i) => {
      const sx = x + pw - 10 - (i + 1) * segW - i * 4
      b += rect(sx, yy, segW, 24, { r: 6, fill: i === 0 ? C.tintStrong : C.paper, stroke: i === 0 ? C.accent : C.line })
      b += txt(sx + segW / 2, yy + 16, label, { size: 11, weight: 700, fill: i === 0 ? C.accentDeep : C.muted, anchor: 'middle' })
    })
    b += field(x + pw - 10, yy + 28, pw - 20, 'الخزينة', 'الخزينة الرئيسية')
    b += txt(x + pw - 10, yy + 89, 'المبلغ المحصل', { size: 11, weight: 700, fill: C.muted })
    b += rect(x + 10, yy + 94, pw - 20, 30, { r: 6, fill: C.paper, stroke: C.line })
    b += num(x + 18, yy + 115, '0.00', { size: 16, weight: 700, fill: C.ink })
    b += chip(x + pw - 18, yy + 99, 'SAR', { size: 9.5, h: 20, w: 40, fill: C.tint, fill2: C.faint }).svg
    return b
  }, (x, yy) => txt(x + pw - 10, yy, 'المحصَّل 0.00', { size: 11, weight: 700, fill: C.muted }) + txt(x + 10, yy, 'المتبقي 11,200.00', { size: 11, weight: 700, fill: C.danger, anchor: 'start', rtl: true }))
  // ③ إجمالي الفاتورة
  s += mk(xTotals, 'إجمالي الفاتورة', 'ملخص الحساب', (x, yy) => {
    let b = ''
    const halfW = Math.floor((pw - 24) / 2)
    b += field(x + pw - 10, yy - 8, halfW, 'خصم نسبة %', '0')
    b += field(x + pw - 14 - halfW, yy - 8, halfW, 'خصم يدوي (ر.س)', '0')
    const lines = [['إجمالي البنود', '11,200.00'], ['الخصم', '0.00'], ['مصاريف على العميل', '0.00'], ['الضريبة', '0.00']]
    lines.forEach(([l, v], i) => {
      const ly = yy + 48 + i * 18
      b += txt(x + pw - 12, ly, l, { size: 11, weight: 600, fill: C.muted })
      b += num(x + 12, ly, v, { size: 11, weight: 700, fill: C.inkSoft })
      b += `<line x1="${x + 70}" y1="${ly - 4}" x2="${x + pw - 110}" y2="${ly - 4}" stroke="${C.line}" stroke-dasharray="2 3"/>`
    })
    b += rect(x + 10, yy + 124, pw - 20, 30, { r: 7, fill: C.tintStrong, stroke: C.accent })
    b += txt(x + pw - 20, yy + 144, 'صافي إجمالي الفاتورة', { size: 12.5, weight: 700, fill: C.accentDeep })
    b += num(x + 20, yy + 145, '11,200.00', { size: 15, weight: 700, fill: C.accentDeep })
    return b
  }, (x, yy) => txt(x + pw - 10, yy, 'قيد الفاتورة', { size: 11, weight: 700, fill: C.muted })
    + `<circle cx="${x + 18}" cy="${yy - 4}" r="4" fill="${C.ok}"/>` + txt(x + 28, yy, 'متزن — مدين = دائن', { size: 11, weight: 700, fill: C.ok, anchor: 'start', rtl: true }))
  return s
}

// ═══ ⑥ شريط الحالة ════════════════════════════════════════════════════
function statusBar(y) {
  let s = rect(LX, y, RX - LX, hh.status, { stroke: C.line })
  s += `<circle cx="${RX - 20}" cy="${y + 19}" r="4" fill="${C.ok}"/>`
  s += txt(RX - 32, y + 24, 'متصل — وضع محلي', { size: 11, weight: 700, fill: C.ok })
  s += txt(RX - 160, y + 24, 'تمور وتعبئة · الفرع الواحد · محمد عبده · الطباعة: thermal', { size: 11, fill: C.faint })
  s += txt(950, y + 24, 'الإجمالي', { size: 11, weight: 700, fill: C.muted })
  s += num(828, y + 24, '11,200.00', { size: 12, weight: 700, fill: C.ink })
  s += txt(800, y + 24, 'المتبقي على العميل', { size: 11, weight: 700, fill: C.muted })
  s += num(610, y + 24, '11,200.00', { size: 12, weight: 700, fill: C.danger })
  s += chipRow(LX + 250, y + 8, [{ label: 'تخصيص الحقول', size: 11, h: 22 }, { label: 'تصدير PDF', size: 11, h: 22 }])
  return s
}

// ═══ نافذة اختيار الصنف: عائمة بلا تعتيم ولا عزل ═══════════════════════
function pickerWindow() {
  const w = 720, x = (W - w) / 2, y = 250, h = 250
  let s = `<g filter="url(#soft)">` + rect(x, y, w, h, { r: 10, fill: C.paper, stroke: C.accent, sw: 1.4 }) + `</g>`
  s += `<path d="M${x} ${y + 10} a10 10 0 0 1 10 -10 h${w - 20} a10 10 0 0 1 10 10 v22 h-${w} z" fill="${C.band}"/>`
  s += `<line x1="${x}" y1="${y + 32}" x2="${x + w}" y2="${y + 32}" stroke="${C.line}"/>`
  s += ico.search(x + w - 18, y + 16, C.accent)
  s += txt(x + w - 32, y + 22, 'نتائج بحث الأصناف — «تمر»', { size: 12.5, weight: 700, fill: C.inkSoft })
  s += txt(x + 40, y + 22, 'Esc للإغلاق · ↑↓ تنقل · Enter إضافة', { size: 10, weight: 600, fill: C.faint, anchor: 'start', rtl: true })
  s += rect(x + 8, y + 7, 22, 20, { r: 5, fill: C.paper, stroke: C.line })
  s += `<g stroke="${C.danger}" stroke-width="1.5" stroke-linecap="round"><path d="M${x + 15} ${y + 13} l8 8 M${x + 23} ${y + 13} l-8 8"/></g>`
  const res = [['ITM-1001', 'تمر سكري فاخر — متاح 1000 كجم', '100.00'], ['ITM-1007', 'تمر عجوة — متاح 240 كجم', '180.00'], ['ITM-1019', 'تمر خلاص معبأ — متاح 75 كرتونة', '95.00'], ['SRV-2001', 'خدمة تعبئة وتغليف', '25.00']]
  res.forEach(([code, name, price], i) => {
    const ry = y + 38 + i * 36
    if (i === 0) s += rect(x + 6, ry - 4, w - 12, 32, { r: 6, fill: C.tintStrong, stroke: C.tintStrong })
    s += txt(x + w - 14, ry + 17, name, { size: 12, weight: i === 0 ? 700 : 400, fill: C.inkSoft })
    s += num(x + 70, ry + 17, code, { size: 10.5, fill: C.faint })
    s += num(x + 14, ry + 17, price, { size: 12, weight: 700, fill: C.ink })
    if (i < res.length - 1) s += `<line x1="${x + 10}" y1="${ry + 28}" x2="${x + w - 10}" y2="${ry + 28}" stroke="${C.line}"/>`
  })
  s += txt(x + w - 12, y + h - 10, 'لا تعتيم ولا عزل: الفاتورة خلفها تُقرأ وتعمل — والنافذة تُغلق بـ Esc أو ✕ أو بالنقر خارجها', { size: 10.5, weight: 700, fill: C.accentDeep })
  return s
}

function build({ picker = false, caption }) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  s += `<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#0f172a" flood-opacity=".14"/></filter></defs>`
  s += rect(0, 0, W, H, { r: 0, fill: C.surface })
  s += topBar(rows.top) + headerCard(rows.header) + entryBar(rows.entry) + linesCard(rows.lines) + panels(rows.panels) + statusBar(rows.status)
  if (picker) s += pickerWindow()
  s += txt(RX, H - 14, caption, { size: 11.5, weight: 600, fill: C.faint })
  s += `</svg>`
  return s
}

const out = [
  { file: 'docs/mockups/فاتورة_التصميم_المقترح.png', svg: build({ caption: 'التصميم المقترح · شبكة بارتفاع الشاشة: التمرير داخل جدول البنود فقط · زر ترحيل واحد في الأعلى · ثلاث لوحات بارتفاع واحد · رقاقات المصروفات في تذييل الجدول' }) },
  { file: 'docs/mockups/فاتورة_نافذة_اختيار_الصنف.png', svg: build({ picker: true, caption: 'نافذة اختيار الصنف كما ستصبح: عائمة فوق الفاتورة بلا تعتيم ولا عزل — وبها زر إغلاق وتستجيب لـ Esc' }) },
]
for (const { file, svg } of out) {
  const png = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Cairo' }, fitTo: { mode: 'width', value: W * 1.25 } }).render().asPng()
  writeFileSync(file, png)
  console.log('✓', file, (png.length / 1024).toFixed(0) + 'KB')
}
