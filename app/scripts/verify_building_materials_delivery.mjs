/**
 * تحقق سد فجوة تقرير النشاط #27 (مواد بناء وحدايد وبويات):
 * وصف النشاط الظاهر يَعِد صراحة بـ"تسليم ونقل"، والمحرك (DeliveryJob/
 * scheduleDelivery/setDeliveryStatus/completeDeliveryWithSignature) عام
 * بالفعل بلا أي قيد نشاط — وشاشة جدولة التوصيل في التقارير (تبويب
 * المبيعات) ظاهرة لكل الأنشطة من الأصل. الفجوة الوحيدة كانت شاشة طاقم
 * التوصيل المخصصة (مهامه اليوم + تأكيد بتوقيع رقمي عبر SignaturePad)
 * محصورة في كتالوج التنقل بنشاط "أجهزة كهربائية" فقط، رغم أن توصيل مواد
 * البناء الثقيلة (حديد/أسمنت/رمل) يحتاج تتبعاً وتوقيع تسليم أكثر لا أقل.
 * الإصلاح: إضافة 'building_materials' لقائمة activities البيضاء لعنصر
 * 'delivery-tasks' في navCatalog.tsx — بلا أي تعديل في المحرك نفسه.
 * تشغيل: node --experimental-strip-types scripts/verify_building_materials_delivery.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let PASS = 0
const ok = (cond, msg) => {
  assert.ok(cond, msg)
  PASS++
  console.log(`  ✓ ${msg}`)
}

console.log('— ① navCatalog: عنصر delivery-tasks يسمح الآن بنشاطي الأجهزة الكهربائية ومواد البناء —')
const navSrc = readFileSync(new URL('../src/ui/navCatalog.tsx', import.meta.url), 'utf8')
const deliveryLineMatch = navSrc.match(/\{ id: 'delivery-tasks'[^}]*\}/)
ok(deliveryLineMatch != null, 'عنصر delivery-tasks موجود في كتالوج التنقل')
const deliveryLine = deliveryLineMatch[0]
ok(/activities: \[[^\]]*'electronics'[^\]]*\]/.test(deliveryLine), 'لا يزال متاحاً لنشاط الأجهزة الكهربائية (الأصل)')
ok(/activities: \[[^\]]*'building_materials'[^\]]*\]/.test(deliveryLine), 'أصبح متاحاً لنشاط مواد البناء وحدايد وبويات')

console.log('— ② المحرك (repo.ts): وظائف التوصيل عامة بلا أي قيد نشاط —')
const repoSrc = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
const scheduleFn = repoSrc.slice(repoSrc.indexOf('scheduleDelivery: (args'), repoSrc.indexOf('scheduleDelivery: (args') + 1200)
ok(!/activityId/.test(scheduleFn), 'scheduleDelivery لا يفحص activityId إطلاقاً (عام لكل الأنشطة)')

console.log('— ③ سيناريو حيّ: جدولة توصيل حديد تسليح لمقاول، تنفيذ، وتأكيد بتوقيع —')
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 15, activityId: 'building_materials', countryCode: 'SA', taxInclusive: false }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])
S().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1_000_000, label: 'خزينة' })
S().addCustomer({ nameAr: 'مقاول سعيد', phone: '', openingBalanceMinor: 0, creditLimitMinor: 10_000_000 })
const cust = S().customers.at(-1)
S().addItem({ nameAr: 'حديد تسليح 12مم', sku: 'B-1', barcodes: [], categoryId: 1, baseUnit: 'طن', extraUnits: [], costMinor: 0, priceMinor: 2_000_000, minQty: 0, stockQty: 100, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false })
const steel = S().items.at(-1)
const sale = S().postSale({ lines: [{ itemId: steel.id, nameAr: steel.nameAr, qty: 2, unitPriceMinor: 2_000_000, unitCostMinor: 1_500_000, discountPercent: 0 }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 15, taxInclusive: false })
ok(sale.invoiceNumber === 'S-0001', 'فاتورة البيع الآجل للمقاول تمت (حد الائتمان كافٍ)')

const job = S().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-25', assignedTo: 'سائق 1', notes: 'توصيل حديد + رفع للموقع' })
ok(job.status === 'scheduled', 'مهمة التوصيل جُدولت بنجاح (مجدوَلة)')

S().setDeliveryStatus(job.id, 'in_progress')
ok(S().deliveryJobs.find((j) => j.id === job.id).status === 'in_progress', 'المندوب بدأ التنفيذ')

S().completeDeliveryWithSignature(job.id, 'data:image/png;base64,AAAA')
const completed = S().deliveryJobs.find((j) => j.id === job.id)
ok(completed.status === 'done', 'التوصيل اكتمل')
ok(completed.deliverySignatureDataUrl === 'data:image/png;base64,AAAA', 'توقيع التسليم الرقمي محفوظ (دليل استلام مواد البناء في الموقع)')

console.log(`\nPASS=${PASS} FAIL=0`)
console.log('🎉 نشاط مواد البناء وحدايد وبويات: شاشة طاقم التوصيل ظاهرة الآن ومُختبرة حياً بسيناريو حقيقي')
