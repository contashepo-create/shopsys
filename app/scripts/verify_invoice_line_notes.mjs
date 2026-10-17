// بند 8 (طلب المالك): عمود ملاحظات لكل بند في كل الفواتير
// تشيك بوكس «ملاحظات البنود» بجانب «النمط» ⇒ عمود «ملاحظات البند» في جدول البنود
// (بيع + شراء)، والملاحظة تنتقل مع السطر حتى الطباعة (A4 + حراري) ولا تؤثر على الحسابات.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

// ── ① النواة: الملاحظة جزء من سطر السلة وصف الإيصال ────────────────────────
const pos = read('src/core/pos.ts')
ok('CartLine يحمل notes (نص وصفي — لا affect الحسابات)', /notes\?:\s*string/.test(pos))

const receipt = read('src/core/receipt.ts')
ok('ReceiptRow يحمل notes', /export interface ReceiptRow[\s\S]*?notes\?:\s*string/.test(receipt))
ok('buildReceiptModel ينقل الملاحظة من السطر', /notes:\s*l\.notes\s*\?\?\s*''/.test(receipt))
ok('buildSimpleDocModel يقبل ملاحظة الصف', /rows:\s*\{[^}]*notes\?:\s*string/.test(receipt))

// ── ② جدول البنود: عمود ملاحظات كامل (خطة + رأس + خلية + صف فارغ) ──────────
const table = read('src/ui/components/InvoiceLinesTable.tsx')
ok('نوع سطر الجدول يحمل notes', /notes\?:\s*string/.test(table))
ok('عرض العمود ثابت (COLW.notes)', /notes:\s*13/.test(table))
ok('خيار showNotes في العقد', /showNotes\?:\s*boolean/.test(table))
ok('العمود داخل خطة الأعمدة', /showNotes\s*\)\s*plan\.push\(\{\s*key:\s*'notes'/.test(table))
ok('عدد الأعمدة يزيد بعمود الملاحظات', /\+\s*\(showNotes\s*\?\s*1\s*:\s*0\)/.test(table))
ok('رأس العمود «ملاحظات البند»', /<th[^>]*>ملاحظات البند<\/th>/.test(table))
ok('خلية الإدخال تكتب في notes السطر', /onPatch\(line\.key,\s*\{\s*notes:/.test(table))
ok('الصف الفارغ (Ghost) فيه خلية ملاحظات', /showNotes\s*&&\s*<td/.test(table))

// ── ③ الصفحتان: تشيك بوكس «ملاحظات البنود» بجانب النمط + تمرير showNotes ──
for (const [label, file] of [['البيع', 'src/ui/pages/AdvancedSalesInvoicePage.tsx'], ['الشراء', 'src/ui/pages/AdvancedPurchaseInvoicePage.tsx']]) {
  const src = read(file)
  ok(`${label}: تشيك بوكس «ملاحظات البنود»`, /label="ملاحظات البنود"/.test(src))
  ok(`${label}: نص الخيار «إظهار عمود الملاحظات»`, /إظهار عمود الملاحظات/.test(src))
  ok(`${label}: حالة showLineNotes`, /showLineNotes,setShowLineNotes\]=useState\(false\)/.test(src))
  ok(`${label}: تمرير showNotes للجدول`, /showNotes=\{showLineNotes\}/.test(src))
}
ok('الشراء: سطر الشراء يحمل notes', /notes\?:\s*string/.test(read('src/ui/pages/AdvancedPurchaseInvoicePage.tsx')))

// ── ④ الطباعة: الملاحظة تحت اسم الصنف (A4 + حراري) ───────────────────────
const a4 = read('src/ui/print/printInvoiceA4.ts')
ok('طباعة A4 تُظهر الملاحظة تحت اسم الصنف', /r\.notes[\s\S]{0,120}esc\(r\.notes\)/.test(a4))
const thermal = read('src/ui/print/printReceipt.ts')
ok('الإيصال الحراري يُظهر الملاحظة تحت اسم الصنف', /r\.notes/.test(thermal))

// ── ⑤ سلوك: الملاحظة لا تغيّر الحسابات ───────────────────────────────────
const { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } = await import(pathToFileURL(join(appRoot, 'src/core/receipt.ts')).href)
const base = {
  invoiceNumber: 'INV-1', dateIso: '2026-10-17', payment: 'cash', customerName: null,
  taxPercent: 14, taxInclusive: true, operatorName: 'المالك',
  settings: { ...DEFAULT_RECEIPT_SETTINGS, shopName: 'محل' },
}
const line = { itemId: 1, nameAr: 'صنف', qty: 2, unitPriceMinor: 1000, unitCostMinor: 500, discountPercent: 0, soldByWeight: false }
const totals = { totalMinor: 2000, netMinor: 1754, taxMinor: 246, discountMinor: 0, costMinor: 1000 }
const withNote = buildReceiptModel({ ...base, lines: [{ ...line, notes: 'بدون سكر' }], totals })
const without = buildReceiptModel({ ...base, lines: [line], totals })
ok('الملاحظة تُنقل إلى صف الإيصال', withNote.rows[0].notes === 'بدون سكر')
ok('بدون ملاحظة ⇒ نص فارغ (لا يترك أثراً)', without.rows[0].notes === '')
ok('الملاحظة لا تغيّر الإجمالي', withNote.totalMinor === without.totalMinor)
ok('الملاحظة لا تغيّر عدد القطع', withNote.itemCount === without.itemCount)

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
