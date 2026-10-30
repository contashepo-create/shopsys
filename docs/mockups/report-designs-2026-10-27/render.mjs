/**
 * مولّد تصورات «التقرير الرسمي الموحّد» (طلب المالك 2026-10-27).
 * يرسم SVG يدوياً ثم يحوّله PNG عبر resvg بخط Cairo — لأن البيئة بلا متصفح.
 *
 * التشغيل:  node docs/mockups/report-designs-2026-10-27/render.mjs
 * المتطلبات (خارج المستودع، لا تُلزم التطبيق):
 *   npm i --prefix /home/user/tools @resvg/resvg-js @expo-google-fonts/cairo
 *
 * المخرجات: أربع صور PNG + معرض HTML مستقل (index.html) يعرضها مع نافذة معاينة
 * طباعة تفاعلية. الأرقام والبيانات توضيحية لكنها مأخوذة من حقول التطبيق الفعلية:
 *   projectReportCard / buildProjectExpenseLedger / getOpenClientInvoices /
 *   cheques / clientSettlements / vouchers / renderReportShell.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire('/home/user/tools/')
const { Resvg } = require('@resvg/resvg-js')
const CAIRO = '/home/user/tools/node_modules/@expo-google-fonts/cairo'
const FONTS = [
  `${CAIRO}/400Regular/Cairo_400Regular.ttf`,
  `${CAIRO}/600SemiBold/Cairo_600SemiBold.ttf`,
  `${CAIRO}/700Bold/Cairo_700Bold.ttf`,
  `${CAIRO}/900Black/Cairo_900Black.ttf`,
].filter((f) => existsSync(f))
if (!FONTS.length) throw new Error('ثبّت خط Cairo: npm i --prefix /home/user/tools @expo-google-fonts/cairo')

const HERE = dirname(fileURLToPath(import.meta.url))
mkdirSync(HERE, { recursive: true })

/* ═══════════════ بيانات التقرير (من حقول التطبيق) ═══════════════ */
const CO = {
  name: 'مجموعة البناء الحديث للمقاولات',
  sub: 'الرياض — المملكة العربية السعودية · س.ت ١٠١٠٤٥٦٧٨٩ · الرقم الضريبي ٣٠٠١٢٣٤٥٦٧٨٩٠٠٣',
  logo: 'ب',
}
const DOC = {
  title: 'تقرير متابعة مشروع',
  project: 'فيلا النخيل — التجمع الخامس',
  code: 'PRJ-2026-014',
  client: 'شركة الأفق للاستثمار العقاري',
  status: 'جارٍ التنفيذ',
  period: '2026-01-01  |  2026-10-27',
  printed: '2026-10-27  |  15:03',
  user: 'محمد عبد الرحمن',
  currency: 'ر.س',
}
const SUMMARY = [
  ['قيمة العقد الأصلية', '2,450,000.00'],
  ['أوامر التغيير المعتمدة', '85,000.00'],
  ['قيمة العقد الفعلية', '2,535,000.00'],
  ['قيمة الأعمال المستخلصة', '1,780,000.00'],
  ['إجمالي ما تم تحصيله', '1,265,000.00'],
  ['المتبقي من التحصيل', '515,000.00'],
  ['نسبة التحصيل', '71.1%'],
  ['إجمالي المصروفات', '631,950.00'],
  ['صافي الربح التقديري', '1,148,050.00'],
]
const EXPENSES = [
  ['2026-03-04', 'EXP-0041', 'توريد حديد تسليح ١٢ مم', 'شركة الحديد والصلب', 'مواد', 'نقدي', '186,500.00'],
  ['2026-03-11', 'PAY-0088', 'أجور عمالة يومية — الأسبوع ١١', 'مقاول أعمال مدنية', 'أجور', 'آجل', '74,250.00'],
  ['2026-03-19', 'CERT-0007', 'شهادة باطن — أعمال الخرسانة', 'مؤسسة البناء الحديث', 'مقاول باطن', 'آجل', '210,000.00'],
  ['2026-04-02', 'ISS-0033', 'إذن صرف مواد — أسمنت ورمل', 'مخزن المشروع', 'مواد', 'نقدي', '62,800.00'],
  ['2026-04-15', 'PUR-0172', 'فاتورة شراء أسمنت بورتلاندي', 'مصنع أسمنت الشرق', 'مواد', 'آجل', '98,400.00'],
]
const COLLECTIONS = [
  ['2026-03-08', 'RCV-0031', 'سند قبض نقدي', 'الخزينة الرئيسية', 'محصّل', '250,000.00'],
  ['2026-03-22', 'CHQ-884213', 'شيك وارد — بنك مصر', 'ورقة قبض', 'محصّل ✓', '400,000.00'],
  ['2026-04-06', 'RCV-0044', 'تحويل بنكي', 'البنك الأهلي', 'محصّل', '315,000.00'],
  ['2026-04-20', 'ADV-0009', 'استرداد دفعة مقدمة', 'مقاصة مستخلص', 'مقاصة', '300,000.00'],
]
const TOTAL_EXPENSES = '631,950.00'
const TOTAL_COLLECTIONS = '1,265,000.00'

/* ═══════════════ أدوات رسم SVG ═══════════════ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rect = (x, y, w, h, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 0}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`
const line = (x1, y1, x2, y2, c = '#cbd5e1', w = 1, dash = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
const circ = (cx, cy, r, o = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}/>`
/** نص عربي RTL: x = الحافة اليمنى (text-anchor=end يضع نهاية النص عند x فيمدّه يساراً) */
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="Cairo" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? '#0f172a'}" text-anchor="${o.anchor ?? 'end'}" direction="rtl" unicode-bidi="plaintext"${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`
/** رقم/كود لاتيني LTR: x = الحافة اليسرى */
const num = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="Cairo" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 600}" fill="${o.fill ?? '#0f172a'}" text-anchor="${o.anchor ?? 'start'}" direction="ltr" unicode-bidi="isolate" font-variant-numeric="tabular-nums">${esc(s)}</text>`
/** قيمة خلية: لاتينية/رقمية تُرسَم LTR معزولة، وعربية تُرسَم RTL — يمنع انعكاس التواريخ والأكواد */
const val = (x, y, value, o = {}) => /^[A-Za-z0-9]/.test(String(value))
  ? num(x, y, value, { ...o, anchor: o.anchor ?? 'end' })
  : txt(x, y, value, { ...o, anchor: o.anchor ?? 'end' })
const mid = (cx, y, s, o = {}) => txt(cx, y, s, { ...o, anchor: 'middle' })
/** تدرّج رأسي/أفقي */
const grad = (id, from, to) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
const defs = (...items) => `<defs>${items.join('')}</defs>`

/** جدول رسمي RTL: الأعمدة تُمرَّر بترتيبها المنطقي (الأول = أقصى اليمين) */
function table({ x, y, w, cols, headers, rows, o = {} }) {
  const rh = o.rh ?? 34, hh = o.hh ?? 34, pad = o.pad ?? 10
  const totalW = cols.reduce((a, b) => a + b, 0)
  const right = x + w
  const edges = [right]
  let acc = right
  for (const cw of cols) { acc -= (cw / totalW) * w; edges.push(acc) }
  let s = ''
  /* رأس الجدول — كل العناوين عربية RTL (حتى أعمدة الأرقام) وإلا انعكست الأقواس */
  s += rect(x, y, w, hh, { fill: o.headFill ?? '#0f172a', r: o.headR ?? 0 })
  headers.forEach((h, i) => {
    const rEdge = edges[i] - pad
    s += txt(rEdge, y + hh / 2 + (o.headSize ?? 12) * 0.35, h, { size: o.headSize ?? 12, weight: 800, fill: o.headColor ?? '#fff' })
  })
  /* الصفوف */
  let cy = y + hh
  rows.forEach((row, ri) => {
    const isTotal = row.total === true
    const isSub = row.sub === true
    if (isTotal) s += rect(x, cy, w, rh, { fill: o.totalFill ?? '#f1f5f9' })
    else if (isSub) s += rect(x, cy, w, rh, { fill: o.subFill ?? '#f8fafc' })
    else if (o.zebra && ri % 2 === 1) s += rect(x, cy, w, rh, { fill: o.zebraFill ?? `${o.accent ?? '#0f172a'}08` })
    if (isTotal) s += line(x, cy, x + w, cy, o.accentDark ?? '#0f172a', 2)
    const cells = row.cells ?? row
    cells.forEach((cell, i) => {
      const rEdge = edges[i] - pad, lEdge = edges[i + 1] + pad
      if (cell == null) return
      const value = typeof cell === 'object' ? cell.v : cell
      const sub = typeof cell === 'object' ? cell.sub : null
      const tone = typeof cell === 'object' ? cell.tone : null
      const fill = tone ?? (isTotal ? o.totalColor ?? '#0f172a' : o.bodyColor ?? '#1e293b')
      const weight = isTotal || isSub ? 800 : 600
      const size = o.bodySize ?? 12.5
      if (o.numCols?.includes(i)) {
        s += num(lEdge, cy + rh / 2 + size * 0.35 - (sub ? 6 : 0), value, { size, weight, fill })
      } else {
        s += txt(rEdge, cy + rh / 2 + size * 0.35 - (sub ? 6 : 0), value, { size, weight, fill })
        if (sub) s += txt(rEdge, cy + rh / 2 + size * 0.35 + 11, sub, { size: size - 3, weight: 500, fill: o.subColor ?? '#94a3b8' })
      }
    })
    cy += rh
    s += line(x, cy, x + w, cy, o.rowLine ?? '#e2e8f0', 0.8)
  })
  /* حدود رأسية خفيفة */
  if (o.vLines !== false) for (let i = 1; i < edges.length - 1; i++) s += line(edges[i], y, edges[i], cy, o.vLine ?? '#eef2f7', 0.7)
  return { svg: s, bottom: cy }
}
/** شريط عنوان قسم */
function sectionBar(x, y, w, label, note, o = {}) {
  const h = o.h ?? 34
  let s = rect(x, y, w, h, { fill: o.fill ?? '#0f172a', r: o.r ?? 0 })
  if (o.strip) s += rect(x, y, 5, h, { fill: o.strip })
  s += txt(x + w - 14, y + h / 2 + (o.size ?? 14) * 0.35, label, { size: o.size ?? 14, weight: 800, fill: o.color ?? '#fff' })
  if (note) s += txt(x + 14, y + h / 2 + (o.size ?? 12) * 0.35, note, { size: o.size ?? 12, weight: 600, fill: o.noteColor ?? '#94a3b8', anchor: 'start' })
  return s
}
/** توقيعات */
function signatures(x, y, w, o = {}) {
  const gap = 30, colW = (w - gap * 2) / 3
  let s = line(x, y, x + w, y, o.line ?? '#cbd5e1', 1)
  const labels = ['إعداد', 'مراجعة', 'اعتماد']
  labels.forEach((l, i) => {
    const r = x + w - i * (colW + gap)
    s += mid(r - colW / 2, y + 22, l, { size: 12, weight: 800, fill: o.label ?? '#334155' })
    s += line(r - colW, y + 54, r, y + 54, o.signLine ?? '#94a3b8', 1, '4 3')
    s += mid(r - colW / 2, y + 70, 'الاسم والتوقيع', { size: 9.5, weight: 500, fill: o.sub ?? '#94a3b8' })
  })
  return s
}
/** تذييل */
function footer(x, y, w, o = {}) {
  let s = line(x, y, x + w, y, o.line ?? '#e2e8f0', 1)
  /* فصل النص العربي عن التواريخ/الرموز اللاتينية حتى لا يعيد bidi ترتيبها */
  s += txt(x + w, y + 18, `طُبع بواسطة ${DOC.user} · تَحَكَّم`, { size: 10, weight: 500, fill: '#94a3b8' })
  s += num(x, y + 18, `PAGE 1/1 · TAHAKAM ERP · ${DOC.printed}`, { size: 9.5, weight: 500, fill: '#94a3b8' })
  return s
}
/** كتلة معلومات (تسمية/قيمة) بشكل رسمي — صفوف متجاورة لا بطاقات */
function infoGrid(x, y, w, pairs, o = {}) {
  const cols = o.cols ?? 2, rh = o.rh ?? 32, lw = o.lw ?? 0.34
  const colW = w / cols
  let s = ''
  pairs.forEach(([k, v], i) => {
    const col = i % cols, rowN = Math.floor(i / cols)
    const rEdge = x + w - col * colW
    const cx = rEdge - colW
    const yy = y + rowN * rh
    s += rect(cx, yy, colW, rh, { fill: rowN % 2 ? '#f8fafc' : '#ffffff', stroke: o.grid ?? '#e2e8f0', sw: 0.7 })
    s += txt(rEdge - 12, yy + rh / 2 + 4.5, k, { size: 10.5, weight: 700, fill: '#64748b' })
    s += val(rEdge - 12 - colW * lw, yy + rh / 2 + 4.5, v, { size: 11.5, weight: 700, fill: '#0f172a' })
  })
  return { svg: s, bottom: y + Math.ceil(pairs.length / cols) * rh }
}
/** شعار المنشأة (مربع بحرف) */
function logo(x, y, size, o = {}) {
  let s = rect(x, y, size, size, { fill: o.fill ?? '#0f172a', r: o.r ?? 8 })
  s += mid(x + size / 2, y + size / 2 + size * 0.21, o.letter ?? CO.logo, { size: size * 0.6, weight: 900, fill: o.color ?? '#fff' })
  return s
}

/* ═══════════════ التصميم ① — الرسمي الكلاسيكي ═══════════════ */
function designA() {
  const W = 1120, H = 1580, M = 56, CW = W - M * 2
  const C = { ink: '#0f172a', soft: '#1e293b', line: '#cbd5e1', faint: '#94a3b8', tint: '#f8fafc' }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`
  s += rect(M, 40, CW, H - 80, { fill: '#fff', stroke: '#e2e8f0', sw: 1 })
  /* ترويسة */
  s += logo(M + 28, 68, 54, { fill: C.ink })
  /* x بحافة النص اليمنى بعد الشعار — لا يبدأ من يسار الصفحة فيختفي خلفه */
  s += txt(M + 100 + 300, 92, CO.name, { size: 20, weight: 900, fill: C.ink })
  s += txt(M + 100 + 300, 114, CO.sub, { size: 9.5, weight: 500, fill: '#64748b' })
  /* صندوق عنوان المستند */
  const tbW = 260, tbX = M + CW - tbW - 28
  s += rect(tbX, 68, tbW, 58, { fill: '#fff', stroke: C.ink, sw: 2, r: 4 })
  s += mid(tbX + tbW / 2, 96, DOC.title, { size: 17, weight: 900, fill: C.ink })
  s += mid(tbX + tbW / 2, 116, `تقرير مشروع — ${DOC.code}`, { size: 10, weight: 600, fill: '#475569' })
  s += line(M + 28, 146, M + CW - 28, 146, C.ink, 2.5)
  s += line(M + 28, 151, M + CW - 28, 151, C.ink, 0.8)
  /* بيانات المستند */
  const ig = infoGrid(M + 28, 166, CW - 56, [
    ['اسم المشروع', DOC.project], ['رمز المشروع', DOC.code],
    ['العميل', DOC.client], ['حالة المشروع', DOC.status],
    ['الفترة', DOC.period], ['العملة', DOC.currency],
  ], { cols: 2, rh: 32, grid: '#e2e8f0' })
  s += ig.svg
  let y = ig.bottom + 22
  /* ① ملخص */
  s += txt(M + CW - 28, y + 22, 'أولاً: ملخص المشروع والتحصيل', { size: 16, weight: 900, fill: C.ink })
  s += line(M + 28, y + 32, M + CW - 28, y + 32, C.line, 1.2)
  y += 40
  const sumRows = SUMMARY.map(([k, v], i) => ({
    cells: [k, v],
    total: i === 5,
    sub: false,
  }))
  const t1 = table({
    x: M + 28, y, w: CW - 56, cols: [3.4, 1.1], headers: ['البيان', `القيمة — ${DOC.currency}`],
    rows: sumRows, o: { rh: 31, hh: 32, headFill: C.ink, headColor: '#fff', numCols: [1], totalFill: '#eef2ff', totalColor: '#1e40af', zebra: true, zebraFill: '#f8fafc', bodySize: 12.5, accentDark: C.ink },
  })
  s += t1.svg
  y = t1.bottom + 10
  s += txt(M + CW - 28, y + 14, 'الأرقام مبنية من القيود المرحّلة: المستخلصات، التحصيلات، الشيكات، الدفعات المقدمة، وتكاليف المشروع.', { size: 10, weight: 500, fill: C.faint })
  y += 30
  /* ② المصروفات */
  s += sectionBar(M + 28, y, CW - 56, 'ثانياً: كشف جميع المصروفات', `${EXPENSES.length} مستندات`, { fill: C.ink, h: 34 })
  y += 34
  const t2 = table({
    x: M + 28, y, w: CW - 56, cols: [0.45, 1.1, 1.15, 3.1, 1.25, 0.9, 1.25],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'التصنيف', 'الطريقة', `المبلغ — ${DOC.currency}`],
    rows: [
      ...EXPENSES.map((r, i) => [String(i + 1), r[0], r[1], { v: r[2], sub: r[3] }, r[4], r[5], r[6]]),
      { cells: ['', '', '', 'الإجمالي', '', '', TOTAL_EXPENSES], total: true },
    ],
    o: { rh: 38, hh: 34, headFill: '#334155', headColor: '#fff', numCols: [0, 1, 2, 6], zebra: true, zebraFill: '#f8fafc', bodySize: 11.5, totalFill: C.tint, headSize: 11 },
  })
  s += t2.svg
  y = t2.bottom + 22
  /* ③ التحصيلات */
  s += sectionBar(M + 28, y, CW - 56, 'ثالثاً: كشف جميع التحصيلات', `${COLLECTIONS.length} عمليات`, { fill: C.ink, h: 34 })
  y += 34
  const t3 = table({
    x: M + 28, y, w: CW - 56, cols: [0.45, 1.1, 1.35, 2.5, 1.6, 1.0, 1.3],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'الوسيلة / الحساب', 'الحالة', `المبلغ (${DOC.currency})`],
    rows: [
      ...COLLECTIONS.map((r, i) => [String(i + 1), r[0], r[1], r[2], r[3], r[4], r[5]]),
      { cells: ['', '', '', 'الإجمالي', '', '', TOTAL_COLLECTIONS], total: true },
    ],
    o: { rh: 36, hh: 34, headFill: '#334155', headColor: '#fff', numCols: [0, 1, 2, 6], zebra: true, zebraFill: '#f8fafc', bodySize: 11.5, totalFill: C.tint, headSize: 11 },
  })
  s += t3.svg
  y = t3.bottom + 12
  /* ملاحظة إصلاح الشيك */
  s += rect(M + 28, y, CW - 56, 30, { fill: '#fffbeb', stroke: '#fde68a', sw: 1, r: 3 })
  s += txt(M + CW - 42, y + 20, 'ملاحظة: الشيك الوارد CHQ-884213 مُدرَج ضمن التحصيلات بعد ربطه بذمم المستخلصات — وهو ما كان مفقوداً.', { size: 10.5, weight: 700, fill: '#92400e' })
  y += 42
  /* التسوية */
  s += rect(M + 28, y, CW - 56, 40, { fill: '#f1f5f9', stroke: C.line, sw: 1, r: 3 })
  s += txt(M + CW - 42, y + 26, 'المستخلص 1,780,000.00  −  المحصّل 1,265,000.00  =  المتبقي من التحصيل  515,000.00  ر.س', { size: 13, weight: 900, fill: C.ink })
  y += 62
  s += signatures(M + 28, y, CW - 56, {})
  s += footer(M + 28, H - 96, CW - 56, {})
  return s + '</svg>'
}

/* ═══════════════ التصميم ② — الحديث المؤسسي ═══════════════ */
function designB() {
  const W = 1120, H = 1580, M = 48, CW = W - M * 2
  const C = { ink: '#0f172a', accent: '#0f766e', accent2: '#115e59', light: '#f0fdfa', line: '#d7e3e1', faint: '#64748b' }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs(grad('band', '#0f766e', '#134e4a'), grad('soft', '#f0fdfa', '#ffffff'))}<rect width="${W}" height="${H}" fill="#f1f5f9"/>`
  s += rect(M, 34, CW, H - 68, { fill: '#fff', r: 10 })
  /* شريط الترويسة الملون */
  s += rect(M, 34, CW, 112, { fill: 'url(#band)', r: 10 })
  s += rect(M, 120, CW, 26, { fill: 'url(#band)' })
  s += logo(M + 26, 54, 64, { fill: '#ffffff', color: C.accent, r: 10 })
  s += txt(M + 104 + 300, 78, CO.name, { size: 22, weight: 900, fill: '#ffffff' })
  s += txt(M + 104 + 300, 102, CO.sub, { size: 10.5, weight: 500, fill: '#c9f2eb' })
  s += txt(M + CW - 26, 74, DOC.title, { size: 21, weight: 900, fill: '#ffffff' })
  s += txt(M + CW - 26, 100, `${DOC.project}  ·  ${DOC.code}`, { size: 12, weight: 600, fill: '#c9f2eb' })
  s += rect(M + CW - 150, 112, 124, 26, { fill: '#ffffff', r: 13 })
  s += mid(M + CW - 88, 130, 'تقرير رسمي · 1/1', { size: 10.5, weight: 800, fill: C.accent2 })
  /* شريط بيانات واحد (ليس بطاقات) */
  let y = 158
  const meta = [['العميل', DOC.client], ['الفترة', DOC.period], ['الحالة', DOC.status], ['العملة', DOC.currency], ['طُبع', DOC.printed]]
  s += rect(M + 24, y, CW - 48, 54, { fill: '#f8fafc', stroke: C.line, sw: 1, r: 6 })
  const mw = (CW - 48) / meta.length
  meta.forEach(([k, v], i) => {
    const rEdge = M + 24 + (CW - 48) - i * mw
    if (i > 0) s += line(rEdge, y + 10, rEdge, y + 44, C.line, 1)
    s += txt(rEdge - 14, y + 23, k, { size: 10, weight: 700, fill: C.faint })
    s += txt(rEdge - 14, y + 42, v, { size: 11.5, weight: 800, fill: C.ink })
  })
  y += 72
  /* شريط مؤشرات واحد متصل — بلا بطاقات */
  const kpis = [
    ['قيمة العقد الفعلية', '2,535,000.00', C.ink],
    ['ما تم تحصيله', '1,265,000.00', C.accent],
    ['المتبقي من التحصيل', '515,000.00', '#b45309'],
    ['إجمالي المصروفات', TOTAL_EXPENSES, '#b91c1c'],
  ]
  s += rect(M + 24, y, CW - 48, 78, { fill: '#fff', stroke: C.line, sw: 1.2, r: 6 })
  const kw = (CW - 48) / kpis.length
  kpis.forEach(([k, v, color], i) => {
    const rEdge = M + 24 + (CW - 48) - i * kw
    if (i > 0) s += line(rEdge, y + 12, rEdge, y + 66, C.line, 1)
    s += txt(rEdge - 16, y + 26, k, { size: 11, weight: 700, fill: C.faint })
    s += num(rEdge - kw + 16, y + 58, v, { size: 21, weight: 900, fill: color })
  })
  y += 90
  /* شريط تقدم التحصيل */
  s += txt(M + CW - 24, y + 14, 'نسبة التحصيل من الأعمال المستخلصة', { size: 11.5, weight: 800, fill: C.ink })
  s += num(M + 24, y + 14, '71.1%', { size: 12, weight: 900, fill: C.accent })
  s += rect(M + 24, y + 24, CW - 48, 12, { fill: '#e2e8f0', r: 6 })
  s += rect(M + 24, y + 24, (CW - 48) * 0.711, 12, { fill: 'url(#band)', r: 6 })
  y += 56
  /* ① المصروفات */
  s += sectionBar(M + 24, y, CW - 48, '١ — كشف المصروفات', `${EXPENSES.length} مستندات · ${TOTAL_EXPENSES} ر.س`, { fill: C.light, color: C.accent2, h: 36, strip: C.accent, r: 6, noteColor: C.accent2 })
  y += 40
  const t2 = table({
    x: M + 24, y, w: CW - 48, cols: [0.45, 1.05, 1.15, 3.0, 1.2, 0.9, 1.25],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'التصنيف', 'الطريقة', `المبلغ — ر.س`],
    rows: [
      ...EXPENSES.map((r, i) => [String(i + 1), r[0], r[1], { v: r[2], sub: r[3] }, r[4], r[5], r[6]]),
      { cells: ['', '', '', 'الإجمالي', '', '', TOTAL_EXPENSES], total: true },
    ],
    o: { rh: 38, hh: 34, headFill: C.accent, headColor: '#fff', numCols: [0, 1, 2, 6], zebra: true, zebraFill: '#f0fdfa', bodySize: 11.5, totalFill: '#f0fdfa', totalColor: C.accent2, headSize: 11, vLine: '#e6f2f0' },
  })
  s += t2.svg
  y = t2.bottom + 24
  /* ② التحصيلات */
  s += sectionBar(M + 24, y, CW - 48, '٢ — كشف التحصيلات', `${COLLECTIONS.length} عمليات · ${TOTAL_COLLECTIONS} ر.س`, { fill: C.light, color: C.accent2, h: 36, strip: C.accent, r: 6, noteColor: C.accent2 })
  y += 40
  const t3 = table({
    x: M + 24, y, w: CW - 48, cols: [0.45, 1.05, 1.35, 2.4, 1.55, 1.05, 1.25],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'الوسيلة / الحساب', 'الحالة', `المبلغ — ر.س`],
    rows: [
      ...COLLECTIONS.map((r, i) => [String(i + 1), r[0], r[1], r[2], r[3], { v: r[4], tone: i === 1 ? C.accent : null }, r[5]]),
      { cells: ['', '', '', 'الإجمالي', '', '', TOTAL_COLLECTIONS], total: true },
    ],
    o: { rh: 36, hh: 34, headFill: C.accent, headColor: '#fff', numCols: [0, 1, 2, 6], zebra: true, zebraFill: '#f0fdfa', bodySize: 11.5, totalFill: '#f0fdfa', totalColor: C.accent2, headSize: 11, vLine: '#e6f2f0' },
  })
  s += t3.svg
  y = t3.bottom + 12
  s += rect(M + 24, y, CW - 48, 30, { fill: '#ecfdf5', stroke: '#a7f3d0', sw: 1, r: 6 })
  s += txt(M + CW - 40, y + 20, 'الشيكات الواردة — ومنها CHQ-884213 — تُحتسب ضمن التحصيلات وتُخصم من رصيد المشروع.', { size: 10.5, weight: 700, fill: '#065f46' })
  y += 42
  /* خلاصة التسوية */
  s += rect(M + 24, y, CW - 48, 44, { fill: 'url(#band)', r: 6 })
  s += txt(M + CW - 40, y + 28, 'المتبقي من التحصيل = قيمة الأعمال المستخلصة − إجمالي التحصيلات', { size: 12.5, weight: 800, fill: '#ffffff' })
  s += num(M + 40, y + 29, '515,000.00', { size: 17, weight: 900, fill: '#ffffff' })
  s += txt(M + 40 + 150, y + 29, DOC.currency, { size: 17, weight: 900, fill: '#ffffff', anchor: 'start' })
  y += 66
  s += signatures(M + 24, y, CW - 48, { signLine: '#94a3b8' })
  s += footer(M + 24, H - 90, CW - 48, {})
  return s + '</svg>'
}

/* ═══════════════ التصميم ③ — الدفتر التحليلي ═══════════════ */
function designC() {
  const W = 1120, H = 1580, M = 52, CW = W - M * 2
  const C = { ink: '#0f172a', accent: '#1e3a8a', accent2: '#1d4ed8', line: '#dbe3f0', faint: '#64748b', tint: '#f5f8ff' }
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`
  s += rect(M, 40, CW, H - 80, { fill: '#fff', stroke: '#e2e8f0', sw: 1 })
  /* ترويسة بخط مزدوج */
  s += line(M + 26, 74, M + CW - 26, 74, C.accent, 3)
  s += line(M + 26, 80, M + CW - 26, 80, C.accent, 0.8)
  s += logo(M + 26, 94, 46, { fill: C.accent, r: 6 })
  s += txt(M + 84 + 300, 116, CO.name, { size: 18, weight: 900, fill: C.ink })
  s += txt(M + 84 + 300, 136, CO.sub, { size: 9.5, weight: 500, fill: C.faint })
  s += txt(M + CW - 26, 112, DOC.title, { size: 20, weight: 900, fill: C.accent })
  s += txt(M + CW - 26, 134, 'كشف تحليلي مع رصيد جارٍ — بالريال السعودي', { size: 10.5, weight: 600, fill: C.faint })
  s += line(M + 26, 156, M + CW - 26, 156, C.accent, 1.5)
  /* عمودان متجاوران بلا تداخل:
     العمود الأول (يمين الصفحة) x ∈ [rightX, M+CW-26] — والثاني (يسارها) x ∈ [leftX, leftX+half].
     كل عمود: التسمية عند حافته اليمنى، والقيمة عند حافته اليسرى. */
  const half = (CW - 52 - 22) / 2
  const leftX = M + 26
  const rightX = leftX + half + 22
  const rightEdge = M + CW - 26
  const rightColLabelX = rightEdge, rightColValueX = rightX
  const leftColLabelX = leftX + half, leftColValueX = leftX
  s += txt(rightColLabelX, 182, 'بيانات المشروع', { size: 13, weight: 900, fill: C.accent })
  s += txt(leftColLabelX, 182, 'الخلاصة المالية', { size: 13, weight: 900, fill: C.accent })
  const pairsL = [['المشروع', DOC.project], ['الرمز', DOC.code], ['العميل', DOC.client], ['الفترة', DOC.period], ['الحالة', DOC.status]]
  const pairsR = [['قيمة العقد الفعلية', '2,535,000.00'], ['الأعمال المستخلصة', '1,780,000.00'], ['ما تم تحصيله', '1,265,000.00'], ['المتبقي', '515,000.00'], ['المصروفات', TOTAL_EXPENSES]]
  pairsL.forEach(([k, v], i) => {
    const yy = 196 + i * 27
    s += txt(rightColLabelX, yy + 9, k, { size: 10.5, weight: 700, fill: C.faint })
    s += val(rightColLabelX - 132, yy + 9, v, { size: 11, weight: 700, fill: C.ink })
    s += line(rightColLabelX, yy + 16, rightColValueX, yy + 16, '#eef2f7', 0.8)
  })
  pairsR.forEach(([k, v], i) => {
    const yy = 196 + i * 27
    s += txt(leftColLabelX, yy + 9, k, { size: 10.5, weight: 700, fill: C.faint })
    s += num(leftColValueX, yy + 9, v, { size: 11.5, weight: 800, fill: i === 3 ? '#b45309' : C.ink })
    s += line(leftColLabelX, yy + 16, leftColValueX, yy + 16, '#eef2f7', 0.8)
  })
  s += line(leftX + half + 11, 170, leftX + half + 11, 335, C.line, 1)
  let y = 350
  /* ① المصروفات مع رصيد تراكمي */
  s += txt(M + CW - 26, y + 18, 'أولاً — المصروفات برصيد تراكمي', { size: 14, weight: 900, fill: C.accent })
  s += line(M + 26, y + 28, M + CW - 26, y + 28, C.line, 1.2)
  y += 36
  let cumulative = 0
  const expRows = EXPENSES.map((r, i) => {
    cumulative += Number(r[6].replace(/,/g, ''))
    return [String(i + 1), r[0], r[1], { v: r[2], sub: r[3] }, r[4], r[6], cumulative.toLocaleString('en-US', { minimumFractionDigits: 2 })]
  })
  const t2 = table({
    x: M + 26, y, w: CW - 52, cols: [0.4, 1.0, 1.1, 2.9, 1.0, 1.2, 1.35],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'التصنيف', 'المبلغ', 'الرصيد التراكمي'],
    rows: [
      ...expRows,
      { cells: ['', '', '', 'إجمالي المصروفات', '', TOTAL_EXPENSES, TOTAL_EXPENSES], total: true },
    ],
    o: { rh: 37, hh: 34, headFill: C.accent, headColor: '#fff', numCols: [0, 1, 2, 5, 6], zebra: true, zebraFill: C.tint, bodySize: 11, totalFill: '#eef2ff', totalColor: C.accent, headSize: 10.5 },
  })
  s += t2.svg
  y = t2.bottom + 26
  /* ② التحصيلات مع رصيد متبقٍ متناقص */
  s += txt(M + CW - 26, y + 18, 'ثانياً — التحصيلات والمتبقي بعد كل عملية', { size: 14, weight: 900, fill: C.accent })
  s += line(M + 26, y + 28, M + CW - 26, y + 28, C.line, 1.2)
  y += 36
  let remaining = 1780000
  const colRows = COLLECTIONS.map((r, i) => {
    remaining -= Number(r[5].replace(/,/g, ''))
    return [String(i + 1), r[0], r[1], r[2], r[3], r[5], Math.max(0, remaining).toLocaleString('en-US', { minimumFractionDigits: 2 })]
  })
  const t3 = table({
    x: M + 26, y, w: CW - 52, cols: [0.4, 1.0, 1.25, 2.5, 1.5, 1.2, 1.4],
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'الوسيلة', 'المبلغ', 'المتبقي بعد التحصيل'],
    rows: [
      ...colRows,
      { cells: ['', '', '', 'إجمالي التحصيلات', '', TOTAL_COLLECTIONS, '515,000.00'], total: true },
    ],
    o: { rh: 36, hh: 34, headFill: C.accent, headColor: '#fff', numCols: [0, 1, 2, 5, 6], zebra: true, zebraFill: C.tint, bodySize: 11, totalFill: '#eef2ff', totalColor: C.accent, headSize: 10.5 },
  })
  s += t3.svg
  y = t3.bottom + 14
  s += rect(M + 26, y, CW - 52, 30, { fill: '#eff6ff', stroke: '#bfdbfe', sw: 1, r: 3 })
  s += txt(M + CW - 40, y + 20, 'الشيك الوارد CHQ-884213 مُدرَج بالتحصيلات بعد إصلاح ربط الشيكات بذمم المستخلصات — لا يُحتسب مرتين.', { size: 10.5, weight: 700, fill: '#1e40af' })
  y += 44
  /* التسوية الختامية */
  s += txt(M + CW - 26, y + 16, 'ثالثاً — التسوية الختامية', { size: 14, weight: 900, fill: C.accent })
  y += 26
  const t4 = table({
    x: M + 26, y, w: CW - 52, cols: [4.2, 1.5], headers: ['البند', `القيمة — ر.س`],
    rows: [
      { cells: ['قيمة الأعمال المستخلصة', '1,780,000.00'], sub: true },
      { cells: ['يُطرح: إجمالي التحصيلات — سندات وشيكات ومقاصات', `- ${TOTAL_COLLECTIONS}`], sub: false },
      { cells: ['المتبقي من التحصيل — رصيد العميل المدين', '515,000.00'], total: true },
      { cells: ['يُطرح: إجمالي مصروفات المشروع', `- ${TOTAL_EXPENSES}`], sub: false },
      { cells: ['صافي نتيجة المشروع حتى تاريخه', '1,148,050.00'], total: true },
    ],
    o: { rh: 31, hh: 32, headFill: C.accent, headColor: '#fff', numCols: [1], totalFill: '#eef2ff', totalColor: C.accent, bodySize: 12, zebra: true, zebraFill: C.tint },
  })
  s += t4.svg
  y = t4.bottom + 34
  s += signatures(M + 26, y, CW - 52, { signLine: '#94a3b8' })
  s += footer(M + 26, H - 92, CW - 52, {})
  return s + '</svg>'
}

/* ═══════════════ التصميم ④ — نافذة معاينة الطباعة (UX) ═══════════════ */
function designD() {
  const W = 1440, H = 940
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f1f5f9"/>`
  /* خلفية التطبيق */
  s += rect(0, 0, W, 56, { fill: '#0f172a' })
  s += txt(30, 36, 'تَحَكَّم — مركز تقارير المقاولات', { size: 17, weight: 800, fill: '#fff', anchor: 'start' })
  s += txt(W - 30, 36, 'التبويبات:  لوحة المشاريع  ·  مشروع بعينه  ·  تقرير المشروع', { size: 12, weight: 600, fill: '#cbd5e1' })
  s += rect(30, 76, 190, 860, { fill: '#fff', stroke: '#e2e8f0', r: 8 })
  s += txt(200, 106, 'الفلاتر', { size: 14, weight: 900, fill: '#0f172a' })
  const filters = ['المشروع', 'العميل', 'من تاريخ', 'إلى تاريخ', 'نوع المستند', 'الحالة']
  filters.forEach((f, i) => {
    const yy = 126 + i * 62
    s += txt(200, yy + 14, f, { size: 11, weight: 700, fill: '#64748b' })
    s += rect(46, yy + 22, 158, 30, { fill: '#f8fafc', stroke: '#e2e8f0', r: 5 })
    s += txt(190, yy + 42, i === 0 ? 'فيلا النخيل' : i === 1 ? 'شركة الأفق' : '— الكل —', { size: 11, weight: 600, fill: '#0f172a' })
  })
  s += rect(46, 520, 158, 40, { fill: '#0f766e', r: 6 })
  s += mid(125, 546, 'تطبيق الفلاتر', { size: 12, weight: 800, fill: '#fff' })
  /* نافذة المعاينة */
  const px = 244, py = 76, pw = W - px - 30, ph = H - py - 20
  s += rect(px, py, pw, ph, { fill: '#fff', stroke: '#cbd5e1', sw: 1, r: 10 })
  s += rect(px, py, pw, 54, { fill: '#f8fafc', r: 10 })
  s += rect(px, py + 44, pw, 10, { fill: '#f8fafc' })
  s += line(px, py + 54, px + pw, py + 54, '#e2e8f0', 1)
  s += circ(px + 24, py + 27, 6, { fill: '#0f766e' })
  s += txt(px + 42, py + 33, 'معاينة التقرير قبل الطباعة', { size: 15, weight: 900, fill: '#0f172a', anchor: 'start' })
  s += txt(px + 300, py + 32, 'تقرير مشروع — فيلا النخيل · A4 عمودي · صفحة 1 من 1', { size: 11, weight: 600, fill: '#64748b', anchor: 'start' })
  /* أدوات */
  s += rect(px + pw - 470, py + 12, 92, 30, { fill: '#fff', stroke: '#cbd5e1', r: 6 })
  s += mid(px + pw - 424, py + 32, 'A4  ▾', { size: 11, weight: 700, fill: '#334155' })
  s += rect(px + pw - 370, py + 12, 92, 30, { fill: '#fff', stroke: '#cbd5e1', r: 6 })
  s += mid(px + pw - 324, py + 32, 'عمودي ▾', { size: 11, weight: 700, fill: '#334155' })
  s += rect(px + pw - 270, py + 12, 92, 30, { fill: '#fff', stroke: '#cbd5e1', r: 6 })
  s += mid(px + pw - 224, py + 32, '٪100 ▾', { size: 11, weight: 700, fill: '#334155' })
  s += rect(px + pw - 168, py + 12, 156, 30, { fill: '#0f172a', r: 6 })
  s += mid(px + pw - 90, py + 32, 'طباعة التقرير', { size: 12, weight: 800, fill: '#fff' })
  /* ورقة المعاينة (مصغّرة من التصميم ②) */
  const iw = 720, ih = 760, ix = px + 60, iy = py + 74
  s += rect(ix - 8, iy - 8, iw + 16, ih + 16, { fill: '#e2e8f0', r: 4 })
  s += rect(ix, iy, iw, ih, { fill: '#fff', stroke: '#cbd5e1', sw: 1 })
  s += rect(ix, iy, iw, 70, { fill: '#0f766e' })
  s += txt(ix + iw - 20, iy + 30, DOC.title, { size: 15, weight: 900, fill: '#fff' })
  s += txt(ix + iw - 20, iy + 52, `${DOC.project} · ${DOC.code}`, { size: 10, weight: 600, fill: '#c9f2eb' })
  /* شريط مؤشرات */
  const kpis = [['قيمة العقد', '2,535,000.00', '#0f172a'], ['المحصّل', '1,265,000.00', '#0f766e'], ['المتبقي', '515,000.00', '#b45309'], ['المصروفات', TOTAL_EXPENSES, '#b91c1c']]
  const kw = iw / 4
  kpis.forEach(([k, v, color], i) => {
    const rEdge = ix + iw - i * kw
    if (i > 0) s += line(rEdge, iy + 84, rEdge, iy + 132, '#e2e8f0', 1)
    s += txt(rEdge - 12, iy + 98, k, { size: 9, weight: 700, fill: '#64748b' })
    s += num(rEdge - kw + 12, iy + 122, v, { size: 14, weight: 900, fill: color })
  })
  s += line(ix + 16, iy + 140, ix + iw - 16, iy + 140, '#e2e8f0', 1)
  /* جدول مصروفات مصغّر */
  s += txt(ix + iw - 16, iy + 162, '① كشف المصروفات', { size: 11, weight: 900, fill: '#115e59' })
  s += rect(ix + 16, iy + 174, iw - 32, 24, { fill: '#0f766e' })
  const hx = ['م', 'التاريخ', 'المستند', 'البيان', 'التصنيف', 'المبلغ']
  const hw = [0.4, 1, 1, 2.6, 1, 1.2], hsum = hw.reduce((a, b) => a + b, 0)
  let accx = ix + 16 + iw - 32
  hx.forEach((h, i) => { const w = (hw[i] / hsum) * (iw - 32); s += txt(accx - 8, iy + 190, h, { size: 9, weight: 800, fill: '#fff' }); accx -= w })
  EXPENSES.forEach((r, i) => {
    const yy = iy + 198 + i * 30
    if (i % 2 === 1) s += rect(ix + 16, yy, iw - 32, 30, { fill: '#f0fdfa' })
    let ax = ix + 16 + iw - 32
    const cells = [String(i + 1), r[0], r[1], r[2], r[4], r[6]]
    cells.forEach((c, j) => { const w = (hw[j] / hsum) * (iw - 32); const size = 8.5; if ([0, 1, 2, 5].includes(j)) s += num(ax - w + 8, yy + 19, c, { size, weight: 600, fill: '#1e293b' }); else s += txt(ax - 8, yy + 19, c, { size, weight: 600, fill: '#1e293b' }); ax -= w })
    s += line(ix + 16, yy + 30, ix + iw - 16, yy + 30, '#eef2f7', 0.8)
  })
  const ey = iy + 198 + EXPENSES.length * 30
  s += rect(ix + 16, ey, iw - 32, 28, { fill: '#f1f5f9' })
  s += txt(ix + iw - 24, ey + 19, 'الإجمالي', { size: 9.5, weight: 800, fill: '#0f172a' })
  s += num(ix + 24, ey + 19, TOTAL_EXPENSES, { size: 9.5, weight: 800, fill: '#0f172a' })
  /* جدول تحصيلات مصغّر */
  s += txt(ix + iw - 16, ey + 56, '② كشف التحصيلات', { size: 11, weight: 900, fill: '#115e59' })
  s += rect(ix + 16, ey + 68, iw - 32, 24, { fill: '#0f766e' })
  let bx = ix + 16 + iw - 32
  hx.forEach((h, i) => { const w = (hw[i] / hsum) * (iw - 32); s += txt(bx - 8, ey + 84, h, { size: 9, weight: 800, fill: '#fff' }); bx -= w })
  COLLECTIONS.forEach((r, i) => {
    const yy = ey + 92 + i * 30
    if (i % 2 === 1) s += rect(ix + 16, yy, iw - 32, 30, { fill: '#f0fdfa' })
    let ax = ix + 16 + iw - 32
    const cells = [String(i + 1), r[0], r[1], r[2], r[3], r[5]]
    cells.forEach((c, j) => { const w = (hw[j] / hsum) * (iw - 32); const size = 8.5; if ([0, 1, 2, 5].includes(j)) s += num(ax - w + 8, yy + 19, c, { size, weight: 600, fill: '#1e293b' }); else s += txt(ax - 8, yy + 19, c, { size, weight: 600, fill: '#1e293b' }); ax -= w })
    s += line(ix + 16, yy + 30, ix + iw - 16, yy + 30, '#eef2f7', 0.8)
  })
  const cy = ey + 92 + COLLECTIONS.length * 30
  s += rect(ix + 16, cy, iw - 32, 28, { fill: '#f1f5f9' })
  s += txt(ix + iw - 24, cy + 19, 'الإجمالي', { size: 9.5, weight: 800, fill: '#0f172a' })
  s += num(ix + 24, cy + 19, TOTAL_COLLECTIONS, { size: 9.5, weight: 800, fill: '#0f172a' })
  /* شريط التسوية */
  s += rect(ix + 16, cy + 44, iw - 32, 34, { fill: '#0f766e', r: 5 })
  s += txt(ix + iw - 28, cy + 66, 'المتبقي من التحصيل', { size: 11, weight: 800, fill: '#fff' })
  s += num(ix + 28, cy + 66, '515,000.00 ر.س', { size: 13, weight: 900, fill: '#fff' })
  s += line(ix + 16, cy + 104, ix + iw - 16, cy + 104, '#e2e8f0', 1)
  ;['إعداد', 'مراجعة', 'اعتماد'].forEach((l, i) => {
    const rEdge = ix + iw - 16 - i * ((iw - 32) / 3)
    s += mid(rEdge - (iw - 32) / 6, cy + 124, l, { size: 9.5, weight: 800, fill: '#334155' })
    s += line(rEdge - (iw - 32) / 3 + 20, cy + 148, rEdge - 20, cy + 148, '#cbd5e1', 1, '4 3')
  })
  /* لوحة الإعدادات السريعة */
  const sx = px + pw - 330
  s += rect(sx, py + 74, 306, 360, { fill: '#f8fafc', stroke: '#e2e8f0', r: 8 })
  s += txt(sx + 290, py + 104, 'إعدادات سريعة', { size: 14, weight: 900, fill: '#0f172a' })
  s += txt(sx + 290, py + 124, 'تُحدَّث المعاينة فوراً', { size: 10.5, weight: 600, fill: '#64748b' })
  const toggles = [
    ['حجم الورق', 'A4'], ['الاتجاه', 'عمودي'], ['اللون الرئيسي', '■ أخضر'],
    ['تظليل الصفوف', 'مفعّل ✓'], ['اسم المنشأة', 'ظاهر ✓'], ['الشعار', 'ظاهر ✓'],
    ['خانات التوقيع', 'ظاهرة ✓'], ['تاريخ الطباعة', 'ظاهر ✓'],
  ]
  toggles.forEach(([k, v], i) => {
    const yy = py + 148 + i * 34
    s += txt(sx + 290, yy + 20, k, { size: 11, weight: 700, fill: '#334155' })
    s += rect(sx + 16, yy + 4, 108, 24, { fill: '#fff', stroke: '#e2e8f0', r: 5 })
    s += mid(sx + 70, yy + 20, v, { size: 10, weight: 700, fill: '#0f766e' })
    s += line(sx + 16, yy + 32, sx + 290, yy + 32, '#e2e8f0', 0.7)
  })
  /* شريط سفلي */
  s += rect(px, py + ph - 58, pw, 58, { fill: '#f8fafc', r: 10 })
  s += line(px, py + ph - 58, px + pw, py + ph - 58, '#e2e8f0', 1)
  s += txt(px + 24, py + ph - 24, 'الورقة جاهزة للطباعة — راجعها ثم اضغط «طباعة التقرير»', { size: 11.5, weight: 700, fill: '#334155', anchor: 'start' })
  s += rect(px + pw - 300, py + ph - 46, 110, 34, { fill: '#fff', stroke: '#cbd5e1', r: 6 })
  s += mid(px + pw - 245, py + ph - 24, 'حفظ PDF', { size: 11, weight: 700, fill: '#334155' })
  s += rect(px + pw - 180, py + ph - 46, 156, 34, { fill: '#0f172a', r: 6 })
  s += mid(px + pw - 102, py + ph - 24, 'طباعة', { size: 12, weight: 800, fill: '#fff' })
  return s + '</svg>'
}

/* ═══════════════ التصدير ═══════════════ */
function render(file, svg, width) {
  const r = new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Cairo' },
    fitTo: { mode: 'width', value: width },
    background: '#ffffff',
  })
  const png = r.render().asPng()
  writeFileSync(join(HERE, file), png)
  console.log(`✓ ${file}  (${(png.length / 1024).toFixed(0)} KB)`)
  return png
}

const images = [
  ['1-الرسمي-الكلاسيكي.png', designA(), 1120],
  ['2-الحديث-المؤسسي.png', designB(), 1120],
  ['3-الدفتر-التحليلي.png', designC(), 1120],
  ['4-معاينة-الطباعة.png', designD(), 1440],
]
const pngs = images.map(([f, svg, w]) => [f, render(f, svg, w)])

/* ═══════════════ دليل مقارنة: التصورات الأربعة في صورة واحدة ═══════════════ */
function comparisonSheet(files) {
  const CW = 1860, CH = 2560, PAD = 36, GAP = 26, HEAD = 132
  const cellW = (CW - PAD * 2 - GAP) / 2
  const cellH = (CH - HEAD - PAD * 2 - GAP) / 2
  const labels = [
    '① الرسمي الكلاسيكي — أبيض وكحلي، ترويسة بخانة عنوان، تسوية وتوقيعات',
    '② الحديث المؤسسي — شريط مؤشرات واحد متصل، تقدّم التحصيل، ألوان دالّة',
    '③ الدفتر التحليلي — رصيد تراكمي للمصروفات ومتبقٍ بعد كل تحصيل',
    '④ معاينة الطباعة — نافذة معاينة كاملة بزر طباعة وإعدادات حيّة',
  ]
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}"><rect width="${CW}" height="${CH}" fill="#eef2f7"/>`
  s += txt(CW - PAD, 52, 'تصورات التقرير الرسمي الموحّد — دليل الاختيار', { size: 30, weight: 900, fill: '#0f172a' })
  s += txt(CW - PAD, 88, 'أربع رؤى من قراءة كود التطبيق: كشف حساب · تقارير المشاريع · القوائم المالية — بلا بطاقات، ومعاينة طباعة قبل الطباعة', { size: 14, weight: 600, fill: '#475569' })
  s += num(PAD, 88, 'TAHAKAM ERP · 2026-10-27', { size: 13, weight: 700, fill: '#0f766e' })
  files.forEach(([file, buf], i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = PAD + (1 - col) * (cellW + GAP)
    const y = HEAD + row * (cellH + GAP)
    s += rect(x - 8, y - 8, cellW + 16, cellH + 16, { fill: '#ffffff', stroke: '#cbd5e1', sw: 1, r: 12 })
    const href = `data:image/png;base64,${buf.toString('base64')}`
    const srcW = i === 3 ? 1440 : 1120, srcH = i === 3 ? 940 : 1580
    const scale = Math.min((cellW - 16) / srcW, (cellH - 58) / srcH)
    const dw = srcW * scale, dh = srcH * scale
    s += `<image href="${href}" x="${x + (cellW - dw) / 2}" y="${y + 6}" width="${dw}" height="${dh}" preserveAspectRatio="xMidYMid meet"/>`
    s += rect(x - 8, y + cellH - 36, cellW + 16, 44, { fill: '#0f172a', r: 10 })
    s += txt(x + cellW - 4, y + cellH - 8, labels[i], { size: 13.5, weight: 800, fill: '#ffffff' })
  })
  s += '</svg>'
  return s
}
const sheetSvg = comparisonSheet(pngs)
render('0-دليل-المقارنة.png', sheetSvg, 1860)

/* معرض HTML مستقل (الصور مضمّنة base64 فتعمل بلا خادم) */
const cards = [
  ['1-الرسمي-الكلاسيكي.png', 'التصميم ① — الرسمي الكلاسيكي', 'أبيض/كحلي، خطوط مزدوجة، جداول مسطّرة، ترويسة بخانة عنوان مستند، وتوقيعات ثلاثية. الأقرب للتقارير الحكومية — أوضح شيء على الطباعة بالأبيض والأسود.'],
  ['2-الحديث-المؤسسي.png', 'التصميم ② — الحديث المؤسسي', 'شريط ترويسة ملوّن، شريط مؤشرات واحد متصل (لا بطاقات)، شريط تقدّم التحصيل، وعناوين أقسام مرقّمة. نفس هوية تقارير التطبيق الحالية لكن بلا كروت.'],
  ['3-الدفتر-التحليلي.png', 'التصميم ③ — الدفتر التحليلي', 'عمود رصيد تراكمي للمصروفات، وعمود «المتبقي بعد كل تحصيل»، ثم تسوية ختامية بالمعادلة. الأفضل لمراجعة المحاسب واكتشاف الفروق.'],
  ['4-معاينة-الطباعة.png', 'التصميم ④ — نافذة معاينة الطباعة', 'شكل شاشة «معاينة قبل الطباعة»: ورقة A4 كاملة داخل نافذة، أدوات ورق/اتجاه/تكبير، إعدادات سريعة حيّة، وزر طباعة واضح + حفظ PDF.'],
]
const sheetPng = readFileSync(join(HERE, '0-دليل-المقارنة.png'))
const b64 = Object.fromEntries([...pngs, ['0-دليل-المقارنة.png', sheetPng]].map(([f, buf]) => [f, `data:image/png;base64,${buf.toString('base64')}`]))
const gallery = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تصورات التقرير الرسمي — تَحَكَّم</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Cairo,"Segoe UI",Tahoma,sans-serif}
  header{background:#0f172a;color:#fff;padding:28px 6vw 34px}
  h1{margin:0 0 6px;font-size:26px;font-weight:900}
  header p{margin:0;color:#cbd5e1;font-size:14px;line-height:1.9;max-width:900px}
  .wrap{max-width:1280px;margin:-18px auto 60px;padding:0 22px}
  .intro{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 22px;margin-bottom:26px;font-size:13.5px;line-height:2}
  .intro b{color:#0f766e}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .item{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .item .top{padding:16px 18px 12px;border-bottom:1px solid #f1f5f9}
  .item h2{margin:0 0 6px;font-size:17px;font-weight:900}
  .item p{margin:0;color:#64748b;font-size:12.5px;line-height:1.9}
  .shot{background:#eef2f7;padding:16px;display:grid;place-items:center;cursor:zoom-in;min-height:260px}
  .shot img{width:100%;max-width:520px;box-shadow:0 8px 30px #0f172a22;border-radius:6px;display:block}
  .acts{display:flex;gap:8px;padding:12px 18px 16px;margin-top:auto}
  button{font-family:inherit;cursor:pointer;border-radius:8px;padding:9px 16px;font-size:12.5px;font-weight:800;border:1px solid #cbd5e1;background:#fff;color:#334155}
  button.primary{background:#0f766e;border-color:#0f766e;color:#fff}
  button.primary:hover{background:#115e59}
  button:hover{border-color:#0f766e;color:#0f766e}
  .chosen{border:2px solid #0f766e !important}
  .toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:12px 22px;border-radius:10px;font-size:13px;font-weight:800;opacity:0;transition:.3s;pointer-events:none;z-index:99}
  .toast.show{opacity:1}
  /* نافذة معاينة الطباعة التفاعلية */
  .overlay{position:fixed;inset:0;background:#0f172a99;display:none;place-items:center;z-index:50;padding:20px}
  .overlay.open{display:grid}
  .modal{background:#fff;border-radius:14px;width:min(980px,96vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px #0005}
  .modal .bar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;flex-wrap:wrap}
  .modal .bar b{font-size:14px;font-weight:900;margin-inline-end:auto}
  .modal .bar select{border:1px solid #cbd5e1;border-radius:7px;padding:7px 10px;font-family:inherit;font-size:12px}
  .modal .body{overflow:auto;background:#eef2f7;padding:20px;display:grid;place-items:start center}
  .modal .body img{width:min(720px,100%);background:#fff;box-shadow:0 6px 24px #0f172a22}
  .modal .foot{display:flex;gap:10px;padding:14px 18px;border-top:1px solid #e2e8f0;justify-content:flex-end;flex-wrap:wrap}
  @media print{body>header,.wrap,.overlay .bar,.overlay .foot{display:none!important}.overlay{position:static;background:#fff;display:block;padding:0}.overlay.open{display:block}.modal{box-shadow:none;width:100%;max-height:none;border-radius:0}.modal .body{overflow:visible;background:#fff;padding:0}.modal .body img{width:100%;box-shadow:none}}
</style></head><body>
<header><h1>تصورات «التقرير الرسمي الموحّد»</h1>
<p>أربع رؤى لتقرير المشروع بعد إزالة البطاقات: اسم المشروع وقيمته، ما حُصِّل، المتبقي، ثم كل المصروفات ثم كل التحصيلات في جداول نظامية — ومعاينة طباعة بزر طباعة. البيانات توضيحية من حقول التطبيق الفعلية (المستخلصات، الشيكات، سندات القبض، مصروفات المشروع).</p></header>
<div class="wrap">
  <div class="intro"><b>ما الذي تعالجه هذه التصورات؟</b> ① توحيد شكل كشف حساب العميل وتقارير المشاريع والقوائم المالية في قالب جداول رسمي واحد بلا كروت. ② إظهار الشيكات ضمن التحصيلات وخصمها من ذمم المستخلصات (ربط الدفتر المساعد). ③ الحفاظ على فلاتر كل تبويب عند التنقل. ④ كل زر طباعة يفتح <b>معاينة</b> بدل الطباعة الفورية.</div>
  <div class="item" style="margin-bottom:26px">
    <div class="top"><h2>دليل المقارنة — التصورات الأربعة في صورة واحدة</h2><p>اضغط على الصورة لتكبيرها، ثم اختر التصميم المناسب من البطاقات أدناه.</p></div>
    <div class="shot" onclick="openPreview('0-دليل-المقارنة.png')" title="اضغط للتكبير"><img src="${b64['0-دليل-المقارنة.png']}" alt="دليل المقارنة"></div>
    <div class="acts"><button onclick="openPreview('0-دليل-المقارنة.png')">تكبير دليل المقارنة</button><button class="primary" onclick="printImage('0-دليل-المقارنة.png')">🖨 معاينة وطباعة</button></div>
  </div>
  <div class="grid">${cards.map(([f, t, d], i) => `
    <section class="item" id="item-${i}">
      <div class="top"><h2>${t}</h2><p>${d}</p></div>
      <div class="shot" onclick="openPreview('${f}')" title="اضغط للتكبير"><img src="${b64[f]}" alt="${t}"></div>
      <div class="acts"><button class="primary" onclick="choose('${f}',${i})">اختيار هذا التصميم</button><button onclick="openPreview('${f}')">معاينة كاملة</button><button onclick="printImage('${f}')">🖨 معاينة وطباعة</button></div>
    </section>`).join('')}
  </div>
</div>
<div class="overlay" id="overlay" onclick="if(event.target===this)closePreview()">
  <div class="modal"><div class="bar"><b>معاينة التقرير قبل الطباعة</b><select><option>A4 — عمودي</option><option>A4 — أفقي</option><option>A5</option></select><select><option>٪100</option><option>٪75</option><option>٪125</option></select><button onclick="closePreview()">إغلاق ✕</button></div>
  <div class="body"><img id="big" src="" alt="معاينة التقرير"></div>
  <div class="foot"><button onclick="closePreview()">إلغاء</button><button class="primary" onclick="window.print()">🖨 طباعة التقرير</button></div></div>
</div>
<div class="toast" id="toast"></div>
<script>
const imgs = ${JSON.stringify(b64)};
function openPreview(f){document.getElementById('big').src=imgs[f];document.getElementById('overlay').classList.add('open')}
function closePreview(){document.getElementById('overlay').classList.remove('open')}
function printImage(f){openPreview(f);setTimeout(()=>window.print(),250)}
function choose(f,i){document.querySelectorAll('.item').forEach(e=>e.classList.remove('chosen'));document.getElementById('item-'+i).classList.add('chosen');const t=document.getElementById('toast');t.textContent='تم اختيار: '+f.replace(/\\.png$/,'').replace(/-/g,' ')+' — أخبر الوكيل باسم التصميم ليطبّقه في الكود.';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4200)}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePreview()});
</script></body></html>`
writeFileSync(join(HERE, 'index.html'), gallery)
console.log('✓ index.html (معرض مستقل)')
