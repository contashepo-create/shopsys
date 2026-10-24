/**
 * 🧾 فحص دائم — حارس فوترة المشاريع، النموذج (أ)، الشريحة أ-١
 * (قرار المالك: المستخلص هو الأصل المالي؛ لا ازدواج فوترة بعده):
 *  أ) الحاسبة النقية: عقد فعلي بأوامر التغيير، مستخلَص/موثَّق/متاح — بمرتجعاتها.
 *  ب) «إضافية» داخل المتاح تمر وتُختم طبيعتها على المستند.
 *  ج) «إضافية» تتجاوز السقف الموحد (مستخلصات + إضافيات ≤ العقد) تُرفض برسالة بمبالغ صريحة.
 *  د) «توثيق» محجوب في هذه الشريحة برسالة صريحة (لا نصف نموذج دفتري).
 *  هـ) مشروع مقفل يرفض الإضافية؛ وطبيعة بلا مشروع تُرفض.
 *  و) المسار التاريخي بلا طبيعة **لا يتغيّر في أ-١** (قفل مقصود ضد الكسر —
 *     إلزام الطبيعة يأتي مع واجهة الشريحة أ-٢)، لكنه يُحسب إضافية في الحارس.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_project_billing_guard.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'contracting', countryCode: 'EG' }, license: { plan: 'pro' } } }))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}`); pass++; console.log('  ✓', name) }
const throws = (fn, re, name) => { assert.throws(fn, re, name); pass++; console.log('  ✓', name) }

const { computeProjectBillingGuard } = await import(pathToFileURL(join(root, 'src/core/contracting.ts')).href)
const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?billing=1`)
const S = () => useDataStore.getState()

console.log('\n═══ أ) الحاسبة النقية: سقف موحد ومتاح توثيق بمرتجعاتهما ═══')
{
  const g = computeProjectBillingGuard({
    contractValueMinor: 100_000_000, // 1,000,000 عقد صافٍ
    changeOrders: [
      { projectId: 1, amountMinor: 10_000_000, status: 'approved' }, // +100,000 معتمد
      { projectId: 1, amountMinor: 5_000_000, status: 'draft' }, // مسودة لا تدخل
    ],
    extracts: [
      { totals: { grossMinor: 60_000_000, vatMinor: 8_400_000, retentionMinor: 6_000_000, dueMinor: 62_400_000 } },
      { totals: { grossMinor: 10_000_000, vatMinor: 1_400_000, retentionMinor: 1_000_000, dueMinor: 10_400_000 }, refundedMinor: 1_140_000, refundedTaxMinor: 140_000 }, // رُدّت أعمال بصافي 1,000,000
    ],
    saleInvoices: [
      { id: 11, projectBilling: 'extra', totals: { totalMinor: 22_800_000, taxMinor: 2_800_000 } }, // صافي 20,000,000
      { id: 12, totals: { totalMinor: 5_700_000, taxMinor: 700_000 } }, // تاريخية بلا طبيعة = إضافية، صافي 5,000,000
      { id: 13, projectBilling: 'documentation', totals: { totalMinor: 30_000_000, taxMinor: 3_684_211 } },
    ],
    saleReturns: [
      { saleId: 11, totals: { totalMinor: 2_280_000, taxMinor: 280_000 } }, // مرتجع من الإضافية بصافي 2,000,000
    ],
  })
  eq(g.effectiveContractNetMinor, 110_000_000, 'العقد الفعلي = الأصلي + المعتمد فقط')
  eq(g.extractedNetMinor, 69_000_000, 'صافي المستخلصات بعد ردّ الأعمال (60M + 10M − 1M)')
  eq(g.extraInvoicedNetMinor, 23_000_000, 'الإضافيات بعد مرتجعها (20M − 2M + 5M تاريخية)')
  eq(g.billedNetMinor, 92_000_000, 'المفوتَر كله بصافي الأعمال')
  eq(g.extraRoomNetMinor, 18_000_000, 'المتاح لإضافية جديدة = العقد − المفوتَر')
  // قابل للتوثيق: (68.4M) + (11.4M − 1.14M) = 78.66M؛ وُثّق 30M
  eq(g.availableToDocumentGrossMinor, 78_660_000 - 30_000_000, 'المتاح للتوثيق = مستخلَص شامل لم يُوثَّق')
  const over = computeProjectBillingGuard({
    contractValueMinor: 10_000, changeOrders: [],
    extracts: [{ totals: { grossMinor: 20_000, vatMinor: 0, retentionMinor: 0, dueMinor: 20_000 } }],
    saleInvoices: [],
  })
  eq(over.extraRoomNetMinor, 0, 'تجاوز تاريخي للعقد يُصفّر المتاح ولا يسالب')
}

console.log('\n═══ تجهيز متجر حقيقي: عميل + مشروع 1,000,000 + مستخلص 600,000 ═══')
S().seed([])
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
S().addCustomer({ nameAr: 'المالك العقاري', phone: '0100', notes: '', creditLimitMinor: 0, ...EXT })
const client = S().customers.at(-1)
const prj = S().addProject({ nameAr: 'برج النيل', clientName: client.nameAr, clientId: client.id, contractValueMinor: 100_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
S().addProjectExtract({ projectId: prj.id, grossMinor: 60_000_000, vatPercent: 14, payment: 'credit', description: 'مستخلص ١ — خرسانات' })
S().addItem({ nameAr: 'أعمال إضافية مقطوعية', sku: 'SVC-X', barcodes: [], categoryId: 1, baseUnit: 'مقطوعية', extraUnits: [], costMinor: 0, priceMinor: 0, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: true })
const svc = S().items.at(-1)
const saleArgs = (unitPriceMinor, extra = {}) => ({
  lines: [{ itemId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: client.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
  projectId: prj.id, ...extra,
})

const g0 = S().getProjectBillingGuard(prj.id)
eq(g0.extractedNetMinor, 60_000_000, 'الحارس يقرأ المستخلص الحقيقي من المتجر')
eq(g0.extraRoomNetMinor, 40_000_000, 'المتاح لإضافية = 400,000')
eq(g0.availableToDocumentGrossMinor, 68_400_000, 'المتاح للتوثيق = أعمال + ضريبتها')

console.log('\n═══ ب+ج) إضافية داخل المتاح تمر، وفوق السقف تُرفض ═══')
const extra1 = S().postSale(saleArgs(30_000_000, { projectBilling: 'extra' }))
eq(extra1.projectBilling, 'extra', 'طبيعة «إضافية» مختومة على المستند')
eq(S().getProjectBillingGuard(prj.id).extraRoomNetMinor, 10_000_000, 'بعد إضافية 300,000 يتبقى 100,000 فقط')
throws(
  () => S().postSale(saleArgs(10_000_100, { projectBilling: 'extra' })),
  /سقف فوترة المشروع/,
  'إضافية تتجاوز المتاح بمائة تُرفض بالسقف الموحد',
)
S().postSale(saleArgs(10_000_000, { projectBilling: 'extra' }))
eq(S().getProjectBillingGuard(prj.id).extraRoomNetMinor, 0, 'إضافية بتمام المتاح تمر ويُقفل السقف')

console.log('\n═══ د+هـ) التوثيق بلا مستخلصات محددة يُرفض + طبيعة بلا مشروع تُرفض ═══')
// كان التوثيق محجوباً كلياً في أ-١؛ فُعّل في أ-٢ (بوابته: verify_project_billing_documentation)
throws(
  () => S().postSale(saleArgs(100, { projectBilling: 'documentation' })),
  /المستخلصات الموثَّقة/,
  'التوثيق بلا مستخلصات محددة بأعينها يُرفض',
)
throws(
  () => S().postSale(saleArgs(100, { projectBilling: 'extra', projectId: null })),
  /اختيار المشروع/,
  'طبيعة بلا مشروع مرتبط تُرفض',
)

console.log('\n═══ و) المسار التاريخي في أ-١: لا ينكسر، لكن الحارس يراه ═══')
const legacy = S().postSale(saleArgs(5_000_000))
ok(legacy.id > 0 && legacy.projectBilling === undefined, 'فاتورة بلا طبيعة تُرحَّل كما كانت دائماً (قفل ضد الكسر)')
const gNow = S().getProjectBillingGuard(prj.id)
eq(gNow.extraInvoicedNetMinor, 45_000_000, 'الحارس يحسب التاريخية إضافية (300k + 100k + 50k)')
eq(gNow.billedNetMinor, 105_000_000, 'التجاوز التراكمي ظاهر رقمياً للوحة القادمة')

console.log('\n═══ مشروع مقفل يرفض الإضافية ═══')
const prj2 = S().addProject({ nameAr: 'فيلا الساحل', clientName: client.nameAr, clientId: client.id, contractValueMinor: 1_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
S().addProjectExtract({ projectId: prj2.id, grossMinor: 500_000, vatPercent: 14, payment: 'credit', description: 'مستخلص وحيد' })
S().releaseRetention(prj2.id)
eq(S().projects.find((p) => p.id === prj2.id).status, 'completed', 'الإفراج عن المحتجز أغلق المشروع')
throws(
  () => S().postSale({ ...saleArgs(100, { projectBilling: 'extra' }), projectId: prj2.id }),
  /مقفل/,
  'لا فواتير إضافية على مشروع مقفل',
)


/* التعديل لا يتسلل فوق السقف: إضافية 30M قائمة وإضافيات أخرى 15M فوق
   مستخلصات 60M من عقد 100M — المتاح بعد استبعاد القديمة = 25M؛ تعديل
   إلى 45M يُرفض، وإلى 24M يمر */
const editArgs = (unitPriceMinor) => ({
  saleId: extra1.id,
  lines: [{ itemId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }],
  customerId: client.id, payment: 'credit', paidMinor: 0, treasury: '1101',
  invoiceDiscountPercent: 0, reason: 'تصحيح قيمة الأعمال الإضافية', einvoiceActive: false,
})
throws(() => S().editSale(editArgs(45_000_000)), /سقف فوترة المشروع/, 'تعديل يرفع إضافية فوق سقف العقد يُرفض')
eq(S().getProjectBillingGuard(prj.id).extraInvoicedNetMinor, 45_000_000, 'الرفض لم يغيّر المفوتَر (30M إضافية + 15M لاحقة/تاريخية بالبوابة)')
const edited = S().editSale(editArgs(24_000_000))
eq(edited.totals.totalMinor, 24_000_000, 'تعديل داخل السقف يمر (24M)')
eq(S().getProjectBillingGuard(prj.id).extraInvoicedNetMinor, 39_000_000, 'والحارس يرى القيمة المعدّلة لا القديمة (15M أخرى + 24M)')

console.log(`\nPASS=${pass} — سقف أ-١ صلب حيث يُطلب، وصامت حيث لم تصل الواجهة بعد`)
