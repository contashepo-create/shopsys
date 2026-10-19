/**
 * تحقق سد فجوات تقرير النشاط #16 (مغسلة ملابس — دفعة ب):
 * ① التسعير بالوزن (كجم) لغسيل الجملة — سد فجوة عالمية موثَّقة (CleanCloud/Enlite
 *    «Weight Scale Support») كان حقل الكمية يفرض عدداً صحيحاً دوماً فلا يمكن
 *    فوترة كيس «غسيل وكي بالكيلو» إطلاقاً (Gap 1).
 * ② إجمالي الأمر وتقرير المغسلة يتعاملان مع كسور الوزن بتدوير آمن (Minor صحيح
 *    دوماً) وبفصل «قطعة» عن «كجم» في كل بند خدمة.
 * ③ إشعار العميل بحالة الأمر عبر واتساب (نمط RepairShopr/CleanCloud SMS) —
 *    كان موجوداً فعلياً في الصيانة (buildTicketStatusMessage) ومفقوداً تماماً
 *    في المغسلة رغم أنها نفس آلة الحالات بالضبط (Gap 2).
 * ④ سجل الإشعارات المُرسَلة (logLaundryNotificationSent) يُحفظ على الأمر نفسه
 *    لأغراض التدقيق — بلا أي قيد محاسبي (الإشعار تشغيلي بحت).
 * ⑤ لا كود ميت: التوصيل الفعلي بالواجهة (LaundryPage.tsx).
 * تشغيل: node --experimental-strip-types scripts/verify_laundry_phase_b.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { validateLaundryOrder, laundryTotal, laundryReport, buildLaundryStatusMessage, laundryWhatsappLink } = await import('../src/core/laundry.ts')

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

const S = () => useDataStore.getState()
S().seed([])
// deliverLaundryOrder يقرأ الضريبة من إعداد المتجر (لا من الوسائط) — نثبّتها صراحة
useAppStore.setState((s) => ({ setup: { ...s.setup, vatPercent: 14, taxInclusive: false } }))

console.log('— ① التحقق: كمية صحيحة للقطعة، كسور مسموحة للوزن —')
ok(validateLaundryOrder({ lines: [{ desc: 'قميص', service: 'wash', qty: 1.5, unitPriceMinor: 1000 }], prepaidMinor: 0 }).length > 0, 'قطعة بكمية كسرية (بلا byWeight) تُرفض كالمعتاد')
ok(validateLaundryOrder({ lines: [{ desc: 'كيس جملة', service: 'wash', qty: 2.5, unitPriceMinor: 1000, byWeight: true }], prepaidMinor: 0 }).length === 0, 'بند بالوزن بكمية كسرية (2.5كجم) يُقبل')
ok(validateLaundryOrder({ lines: [{ desc: 'كيس', service: 'wash', qty: 0, unitPriceMinor: 1000, byWeight: true }], prepaidMinor: 0 }).length > 0, 'وزن صفر أو أقل يُرفض')
ok(validateLaundryOrder({ lines: [{ desc: 'كيس', service: 'wash', qty: 501, unitPriceMinor: 1000, byWeight: true }], prepaidMinor: 0 }).length > 0, 'وزن أكبر من 500كجم يُرفض (سقف معقول لحماية الإدخال)')

console.log('— ② الإجمالي يدوّر كسور الهللة دوماً إلى عدد صحيح —')
const mixedLines = [
  { desc: 'قميص', service: 'wash_iron', qty: 3, unitPriceMinor: 1500 },
  { desc: 'كيس جملة', service: 'wash', qty: 2.5, unitPriceMinor: 1033, byWeight: true }, // 1033×2.5=2582.5
]
const total = laundryTotal(mixedLines)
ok(Number.isInteger(total), `الإجمالي (${total}) عدد صحيح رغم كسر الوزن`)
ok(total === 3 * 1500 + Math.round(2.5 * 1033), 'الإجمالي = مجموع تدوير كل بند على حدة')

console.log('— ③ أمر غسيل فعلي عبر المتجر الحقيقي ببند بالوزن —')
const opened = S().openLaundryOrder({
  customerId: null, customerName: 'عميل نقدي', phone: '01012345678', promisedAt: '', rackNumber: 'A-1',
  lines: [
    { desc: 'بدلة', service: 'dry_clean', qty: 2, unitPriceMinor: 5000 },
    { desc: 'غسيل بالكيلو', service: 'wash', qty: 4.2, unitPriceMinor: 2000, byWeight: true },
  ],
  prepaidMinor: 0, notes: '',
})
ok(opened.lines.some((l) => l.byWeight === true), 'بند الوزن محفوظ على الأمر بعلامة byWeight')
ok(opened.totalMinor === 2 * 5000 + Math.round(4.2 * 2000), 'إجمالي الأمر الحقيقي صحيح بعد تقريب بند الوزن')

console.log('— ④ تقرير المغسلة يفصل «قطعة» عن «كجم» لكل خدمة —')
S().setLaundryStatus(opened.id, 'processing')
S().setLaundryStatus(opened.id, 'ready')
S().deliverLaundryOrder({ orderId: opened.id })
const report = laundryReport(S().laundryOrders)
const washRow = report.rows.find((r) => r.service === 'wash')
const dryRow = report.rows.find((r) => r.service === 'dry_clean')
ok(washRow && washRow.weightKg === 4.2 && washRow.pieces === 0, `صف «غسيل» بالوزن فقط (${washRow?.weightKg}كجم) بلا تلويث عدّاد القطع`)
ok(dryRow && dryRow.pieces === 2 && dryRow.weightKg === 0, 'صف «دراي كلين» بالقطعة فقط')
ok(report.totalWeightKg === 4.2, 'إجمالي الوزن على مستوى التقرير صحيح')

console.log('— ⑤ إشعار واتساب بحالة أمر الغسيل (نمط الصيانة المطبَّق فعلاً) —')
const msgReady = buildLaundryStatusMessage({ orderNumber: 'LN-0099', customerName: 'أحمد', status: 'ready', totalMinor: 10000, prepaidMinor: 3000, rackNumber: 'B-2' }, 'مغسلة النظافة')
ok(msgReady.includes('جاهز للاستلام') && msgReady.includes('B-2') && msgReady.includes('70'), 'رسالة الجاهزية تذكر الرف والمتبقي التقريبي')
const msgDelivered = buildLaundryStatusMessage({ orderNumber: 'LN-0099', customerName: 'أحمد', status: 'delivered', totalMinor: 10000, prepaidMinor: 10000 }, 'مغسلة النظافة')
ok(msgDelivered.includes('تم تسليم') && msgDelivered.includes('مغسلة النظافة'), 'رسالة التسليم تشكر باسم المحل')
ok(laundryWhatsappLink('01012345678', 'نص').startsWith('https://wa.me/201012345678?'), 'تحويل الرقم المصري المحلي لصيغة واتساب الدولية صحيح')

console.log('— ⑥ سجل الإشعارات المُرسَلة يُحفظ على الأمر بلا أي قيد محاسبي —')
const journalBefore = S().journal.length
const afterNotify = S().logLaundryNotificationSent(opened.id, 'delivered')
ok((afterNotify.notifications ?? []).length === 1 && afterNotify.notifications[0].status === 'delivered', 'الإشعار الأول مسجَّل بالحالة الصحيحة')
ok(S().journal.length === journalBefore, 'تسجيل الإشعار عملية تشغيلية بحتة — لا قيد محاسبي يتولد')
S().logLaundryNotificationSent(opened.id, 'delivered')
ok(S().laundryOrders.find((o) => o.id === opened.id).notifications.length === 2, 'إشعارات متعددة تتراكم دون استبدال')

console.log('— ⑦ لا كود ميت: التوصيل الفعلي بالواجهة —')
const { readFileSync } = await import('node:fs')
const page = readFileSync(new URL('../src/ui/pages/LaundryPage.tsx', import.meta.url), 'utf8')
ok(page.includes('buildLaundryStatusMessage') && page.includes('laundryWhatsappLink') && page.includes('logLaundryNotificationSent'), 'شاشة المغسلة تستدعي بناء الرسالة وإرسالها وتسجيلها')
ok(page.includes('byWeight'), 'شاشة المغسلة تعرض مفتاح التسعير بالوزن في محرر البنود')
const core = readFileSync(new URL('../src/core/laundry.ts', import.meta.url), 'utf8')
ok(core.includes('weightKg'), 'نواة المغسلة تُخرج وزن الكجم في التقرير')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
