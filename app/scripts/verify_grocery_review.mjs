/**
 * فحص جولة مراجعة نشاط الأغذية/السوبرماركت (الطلبات 6–9 — الجولة الأولى):
 * ① الإتلاف والهالك: تحقق النواة + قيد 5111/1103 + خصم الرصيد واستهلاك الدفعات + حساب 5111 موجود
 * ② مولد Code128: ترميز B/C سليم + checksum + SVG للملصقات
 * ③ قالب الملصقات: اسم/سعر/باركود وتعدد النسخ
 * تشغيل: node --experimental-strip-types scripts/verify_grocery_review.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { validateWastage, buildWastageEntry, wastageTotalMinor, WASTAGE_REASONS } = await import('../src/core/wastage.ts')
const { encode128, barcodeSvg } = await import('../src/core/code128.ts')
const { renderLabelsHtml } = await import('../src/ui/print/printLabels.ts')
const { STANDARD_COA } = await import('../src/core/ledger.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const balanced = (lines) => lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('\n1️⃣ الإتلاف والهالك (5111/1103)')
ok('حساب 5111 هالك وتوالف موجود بالشجرة', STANDARD_COA.some((a) => a.code === '5111' && a.systemKey === 'wastage'))
ok('أسباب الإتلاف تشمل انتهاء الصلاحية', WASTAGE_REASONS.includes('انتهاء صلاحية'))
// النواة
const wLines = [{ itemId: 1, nameAr: 'زبادي', qty: 10, unitCostMinor: 500 }]
ok('لا أخطاء لمدخل سليم', validateWastage({ reason: 'انتهاء صلاحية', lines: wLines }, () => 50).length === 0)
ok('بلا سبب يُرفض', validateWastage({ reason: ' ', lines: wLines }, () => 50).some((e) => e.includes('سبب')))
ok('كمية تتجاوز الرصيد تُرفض', validateWastage({ reason: 'تلف', lines: wLines }, () => 5).some((e) => e.includes('تتجاوز')))
ok('صنف مكرر يُرفض', validateWastage({ reason: 'تلف', lines: [...wLines, ...wLines] }, () => 100).some((e) => e.includes('مكرر')))
ok('الإجمالي = Σ qty×cost', wastageTotalMinor(wLines) === 5000)
const wEntry = buildWastageEntry(wLines, 'WST-0001')
ok('القيد متوازن: 5111 مدين / 1103 دائن', balanced(wEntry) && wEntry.some((l) => l.accountCode === '5111' && l.debit === 5000) && wEntry.some((l) => l.accountCode === '1103' && l.credit === 5000))
throws('قيمة صفرية تُرفض', () => buildWastageEntry([{ itemId: 1, nameAr: 'x', qty: 1, unitCostMinor: 0 }], 'WST-X'), 'موجبة')

// repo: إعدام فعلي بخصم رصيد ودفعات
S().addItem(item({ nameAr: 'لبن فحص', stockQty: 30, costMinor: 700, priceMinor: 1200, trackExpiry: true }))
const wIt = S().items.at(-1)
useDataStore.setState({ batches: [...S().batches, { id: 9001, itemId: wIt.id, expiryDate: '2020-01-01', qty: 12, purchaseId: null }] })
const jN = S().journal.length
const doc = S().postWastage({ reason: 'انتهاء صلاحية', lines: [{ itemId: wIt.id, qty: 12 }], notes: 'محضر 1' })
ok('المستند برقم WST متسلسل', /^WST-\d{4}$/.test(doc.wastageNumber))
ok('القيمة بالتكلفة المرجحة 12×700', doc.totalCostMinor === 8400)
const wJE = S().journal.find((e) => e.id === doc.journalEntryId)
ok('القيد في الدفتر متوازن ومصدره wastage', wJE && balanced(wJE.lines) && wJE.sourceType === 'wastage')
ok('الرصيد نقص 30−12=18', S().items.find((i) => i.id === wIt.id).stockQty === 18)
ok('الدفعة المنتهية استُهلكت بالكامل', S().batches.find((b) => b.id === 9001).qty === 0)
ok('قيد واحد فقط أُضيف', S().journal.length === jN + 1)
throws('إعدام أكثر من الرصيد يُرفض', () => S().postWastage({ reason: 'تلف', lines: [{ itemId: wIt.id, qty: 999 }], notes: '' }), 'تتجاوز')

console.log('\n2️⃣ مولد Code128')
const v1 = encode128('123456') // أرقام زوجية ⇒ نمط C
ok('أرقام زوجية ⇒ StartC (105)', v1[0] === 105)
ok('ترميز C يضغط كل رقمين بقيمة', v1.length === 1 + 3 + 1 + 1) // start + 3 أزواج + checksum + stop
ok('ينتهي بـ STOP (106)', v1.at(-1) === 106)
// checksum يدوي: 105 + 12*1 + 34*2 + 56*3 = 353 → 353%103=44
ok('checksum صحيح', v1.at(-2) === (105 + 12 * 1 + 34 * 2 + 56 * 3) % 103)
const v2 = encode128('AB-12')
ok('نص مختلط ⇒ StartB (104)', v2[0] === 104)
throws('محرف عربي يُرفض', () => encode128('ص123'), 'غير مدعوم')
throws('نص فارغ يُرفض', () => encode128(''), 'فارغ')
const svg = barcodeSvg('6224000123457')
ok('SVG يحوي أشرطة', svg.startsWith('<svg') && svg.includes('<rect'))

console.log('\n3️⃣ قالب الملصقات')
const html = renderLabelsHtml('بقالة الفحص', [
  { nameAr: 'أرز 5 كجم', barcode: '6224000123457', priceMinor: 18500, count: 3 },
  { nameAr: 'زيت', barcode: 'OIL-77', priceMinor: 9000, count: 1 },
], { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' })
ok('الاسم والسعر ظاهران', html.includes('أرز 5 كجم') && html.includes('185'))
ok('تعدد النسخ: 3 ملصقات للأرز', html.split('أرز 5 كجم').length - 1 === 3)
ok('باركود SVG داخل الملصق', html.includes('<svg'))
ok('تهريب HTML', !renderLabelsHtml('<b>x</b>', [{ nameAr: '<i>y</i>', barcode: 'A1', priceMinor: 1, count: 1 }], { code: 'EGP', symbol: '', decimals: 2, name: '' }).includes('<i>'))

console.log(`\n${'═'.repeat(40)}\n✅ نجح: ${pass}  ❌ فشل: ${fail}\n${'═'.repeat(40)}`)
if (fail > 0) process.exit(1)
