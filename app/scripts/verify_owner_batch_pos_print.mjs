/**
 * فحص دفعة مراجعة المالك (7 نقاط): وجهة إشعار الصلاحية + قالب A5 + شريط الطباعة السريع
 * + أغراض الصرف الموسعة والحرة + الكمية العشرية في POS + المودال فوق كل شيء
 * ① notifications: المنتهي → /inventory/wastage (زر إعدام فوري)، الموشِك → /reports (جدول FEFO)
 * ② receipt core: InvoiceTemplate يشمل a5 + INVOICE_TEMPLATE_OPTIONS ثلاثية حصرية
 * ③ renderInvoiceA4Html: paper='a5' يصدر @page A5 بهوامش أصغر، و'a4' يبقى كما كان
 * ④ consumption: قائمة موسعة (16 غرضاً) + postConsumption يقبل غرضاً حراً تماماً
 * ⑤ POS عشري: computeTotals بكمية 0.25 وزنية يحسب صحيحاً + regex الكتابة الحرة
 * ⑥ ثبات الإعدادات: التجاوز في الكاشير لا يكتب في receipt الدائمة (فحص كود ثابت)
 * تشغيل: node --experimental-strip-types scripts/verify_owner_batch_pos_print.mjs
 */
import { readFileSync } from 'node:fs'
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { collectNotifications } = await import('../src/core/notifications.ts')
const { CONSUMPTION_PURPOSES } = await import('../src/core/consumption.ts')
const receipt = await import('../src/core/receipt.ts')
const { renderInvoiceA4Html } = await import('../src/ui/print/printInvoiceA4.ts')
const { computeTotals, lineTotal } = await import('../src/core/pos.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }

console.log('\n1️⃣ وجهة إشعار الصلاحية (النقطة 1)')
{
  const base = {
    batches: [
      { id: 1, itemId: 1, qty: 4, expiryDate: '2026-01-01', purchasedAt: '2025-01-01' }, // منتهية
      { id: 2, itemId: 2, qty: 2, expiryDate: '2026-10-01', purchasedAt: '2025-01-01' }, // توشك (< 30 يوماً)
    ],
    itemName: (id) => (id === 1 ? 'لبن' : 'جبن'),
    installmentPlans: [], customerName: () => '', fmt: (m) => String(m), openIssues: [],
    items: [], suppliers: [], purchases: [], vouchers: [], cheques: [],
    todayIso: '2026-09-18',
  }
  const ns = collectNotifications(base)
  const expired = ns.find((n) => n.id.startsWith('exp:1:'))
  const soon = ns.find((n) => n.id.startsWith('exp:2:'))
  ok('إشعار المنتهي موجود وخطير', expired && expired.severity === 'danger')
  ok('المنتهي ينقل لصفحة الهوالك (إعدام فوري)', expired?.route === '/inventory/wastage', expired?.route)
  ok('الموشِك ينقل لتقارير المخزون (جدول FEFO)', soon?.route === '/reports', soon?.route)
}

console.log('\n2️⃣ نواة قالب الطباعة A5 (النقطة 7)')
{
  ok('INVOICE_TEMPLATE_OPTIONS ثلاثية: حراري + A4 + A5',
    receipt.INVOICE_TEMPLATE_OPTIONS.length === 3 &&
    JSON.stringify(receipt.INVOICE_TEMPLATE_OPTIONS.map((o) => o.id)) === JSON.stringify(['thermal', 'a4', 'a5']))
  ok('الافتراضي الدائم يبقى حرارياً', receipt.DEFAULT_RECEIPT_SETTINGS.defaultTemplate === 'thermal')

  const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' }
  const settings = { ...receipt.DEFAULT_RECEIPT_SETTINGS, shopName: 'محل الاختبار' }
  const model = receipt.buildReceiptModel({
    invoiceNumber: 'INV-1', dateIso: '2026-09-18T10:00:00Z',
    lines: [{ itemId: 1, nameAr: 'صنف', qty: 1, unitPriceMinor: 1000, discountPercent: 0, soldByWeight: false }],
    totals: { subtotalMinor: 1000, discountMinor: 0, taxMinor: 0, totalMinor: 1000 },
    payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings,
  })
  const a4 = renderInvoiceA4Html(model, cur, settings)
  const a5 = renderInvoiceA4Html(model, cur, settings, 'a5')
  ok('A4 الافتراضي: @page size A4 وهامش 12مم', a4.includes('size: A4') && a4.includes('margin: 12mm'))
  ok('A5: @page size A5 وهامش 7مم', a5.includes('size: A5') && a5.includes('margin: 7mm'))
  ok('A5 يحمل تكييف الخطوط الأصغر', a5.includes('تكييف A5'))
  ok('A4 بلا تكييف A5 (لا تسريب)', !a4.includes('تكييف A5'))
  ok('كلاهما يحمل اسم المحل والرقم', a4.includes('محل الاختبار') && a5.includes('INV-1'))
}

console.log('\n3️⃣ أغراض الصرف الداخلي الموسعة + الغرض الحر (النقطة 4)')
{
  ok('القائمة 16 غرضاً (موسعة من 7)', CONSUMPTION_PURPOSES.length === 16, CONSUMPTION_PURPOSES.length)
  const wanted = ['عينات وتذوق للعملاء', 'وقود ومحروقات معدات', 'صرف لموقع / مشروع', 'تالف أثناء التشغيل', 'مستلزمات سلامة ووقاية']
  ok('الأغراض الجديدة حاضرة', wanted.every((w) => CONSUMPTION_PURPOSES.includes(w)))

  // غرض حر تماماً عبر repo (بضاعة حقيقية ثم صرف)
  S().addItem({ nameAr: 'زيت قلي', sku: 'OIL-1', barcodes: [], categoryId: 1, baseUnit: 'عبوة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 15_000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = S().items.at(-1)
  S().addSupplier({ nameAr: 'مورد زيوت', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const sup = S().suppliers.at(-1)
  S().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 10_000 }], expenses: [], paidMinor: 0, notes: '' })
  const freeText = 'تشحيم سيور المصنع — طلب مدير الإنتاج'
  const doc = S().postConsumption({ purpose: freeText, expenseAccount: '5114', lines: [{ itemId: item.id, qty: 2 }], notes: '' })
  ok('postConsumption يقبل غرضاً حراً بالكامل', doc.purpose === freeText)
  const entry = S().journal.find((e) => e.id === doc.journalEntryId)
  ok('قيد الصرف الحر متوازن 5114/1103', entry && entry.lines.some((l) => l.accountCode === '5114') && entry.lines.some((l) => l.accountCode === '1103'))
  ok('الرصيد خُصم 5→3', S().items.find((i) => i.id === item.id).stockQty === 3)
}

console.log('\n4️⃣ الكمية العشرية في POS (النقطة 5)')
{
  // regex الكتابة الحرة المستخدم في PosPage: يقبل «.25» و«2.5» أثناء الكتابة
  const re = /^\d*\.?\d*$/
  ok('«.25» مقبولة أثناء الكتابة', re.test('.25'))
  ok('«0.75» و«2.» مقبولتان', re.test('0.75') && re.test('2.'))
  ok('حروف ورموز مرفوضة', !re.test('1a') && !re.test('1.2.3') && !re.test('-1'))
  // تحويل الأرقام العربية كما في الحقل
  const norm = (t) => t.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.').replace(',', '.')
  ok('«٠٫٢٥» تتحول «0.25»', norm('٠٫٢٥') === '0.25')
  ok('الفاصلة اللاتينية «,» تتحول نقطة', norm('1,5') === '1.5')

  // الحسابات: ربع كيلو بسعر 80 ج/كجم = 20 ج
  const line = { itemId: 1, nameAr: 'لحم', qty: 0.25, unitPriceMinor: 80_00, unitCostMinor: 50_00, discountPercent: 0, soldByWeight: true }
  ok('ربع كيلو × 80 ج = 20 ج بالضبط', lineTotal(line) === 20_00)
  const totals = computeTotals([line], 0, 0, true)
  ok('الإجمالي النهائي 20 ج', totals.totalMinor === 20_00)
}

console.log('\n5️⃣ ثبات الإعدادات الدائمة + بنية الواجهة (فحص كود ثابت)')
{
  const pos = readFileSync(new URL('../src/ui/pages/PosPage.tsx', import.meta.url), 'utf-8')
  ok('شريط القالب يقرأ INVOICE_TEMPLATE_OPTIONS', pos.includes('INVOICE_TEMPLATE_OPTIONS.map'))
  ok('حالة التجاوز محلية useState لا store', pos.includes("useState<InvoiceTemplate>"))
  ok('التبديل الحصري: زر واحد setPosTemplate(t.id)', pos.includes('setPosTemplate(t.id)'))
  ok('لا يُكتب defaultTemplate من الكاشير إطلاقاً', !pos.includes('updateReceipt({ defaultTemplate'))
  ok('printSale يستخدم posTemplate والتجاوز A5', pos.includes("posTemplate === 'a5' ? 'a5' : 'a4'"))
  ok('مودال الخيارات السريعة موجود ويضبط autoPrint', pos.includes('quickPrintOpen') && pos.includes('setAutoPrint(!autoPrintAfterSale)'))
  ok('مسودة الكمية النصية qtyDrafts حاضرة', pos.includes('qtyDrafts[i] ?? String(l.qty)'))
  ok('لوحة أرقام عشرية بالجوال inputMode=decimal', pos.includes('inputMode="decimal"'))

  const ui = readFileSync(new URL('../src/ui/components/ui.tsx', import.meta.url), 'utf-8')
  ok('المودال عبر createPortal إلى body (فوق الهيدر)', ui.includes('createPortal(') && ui.includes('document.body'))
  ok('طبقة المودال z-[100] أعلى من هيدر z-20', ui.includes('z-[100]'))

  const parties = readFileSync(new URL('../src/ui/pages/PartiesPages.tsx', import.meta.url), 'utf-8')
  ok('تصنيف المورد حقل نص حر (لا select مغلق)', parties.includes('placeholder="مثال: مورد لحوم') && !parties.includes('<select value={category}'))
  ok('شرائح اقتراح من التصنيفات المكتوبة سابقاً', parties.includes('new Set([...suppliers.map((s) => s.category'))

  const consPage = readFileSync(new URL('../src/ui/pages/ConsumptionPage.tsx', import.meta.url), 'utf-8')
  ok('خيار الغرض الحر في القائمة + حقل نصي', consPage.includes('CUSTOM_PURPOSE') && consPage.includes('customPurpose'))
  ok('الترحيل بالغرض الفعلي effectivePurpose', consPage.includes('purpose: effectivePurpose'))
}

console.log(`\n══════════════════\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) { process.exit(1) }
console.log('OWNER-BATCH-POS-PRINT-OK ✅')
