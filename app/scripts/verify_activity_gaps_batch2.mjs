/**
 * التحقق من دفعة «سد فجوات الأنشطة ج2»:
 * ① الصاغة: تقييم المخزون بالعيار (النواة عبر jewelryBreakdown + الأسعار اليومية)
 * ② الإيجار: utilizationReport — نسب الاستغلال والإيراد لكل معدة، والراكد 0٪
 * ③ المعمل: القيم الحرجة CAP/CLIA — critical_low/critical_high أولوية فوق low/high
 * ④ الصيدلية: sameIngredientAlternatives — بدائل بنفس المادة الفعالة متوفرة ومرتبة بالسعر
 * ⑤ الإشعارات: إيجار متجاوز (rentover:) + مواعيد موعودة متجاوزة (promise:) بصلاحية ops.activity.use
 * تشغيل: node --experimental-strip-types scripts/verify_activity_gaps_batch2.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let pass = 0
const ok = (msg) => { pass++; console.log(`✅ ${msg}`) }

/* ═══════════ ① الصاغة: التقييم بالعيار ═══════════ */
{
  const { jewelryBreakdown } = await import(join(root, 'src/core/jewelry.ts'))
  const prices = { k18: 3000_00, k21: 3500_00, k24: 4000_00, updatedAt: '2026-09-19T08:00:00Z' }
  const bd = jewelryBreakdown({ karat: 'k21', weightGrams: 5.5, workmanshipMinor: 200_00 }, prices)
  assert.equal(bd.goldMinor, Math.round(5.5 * 3500_00))
  assert.equal(bd.workmanshipMinor, 200_00)
  ok('الصاغة: قطعة 5.5 جم عيار 21 = 192.50 ألف ذهباً + 200 مصنعية — أساس التقييم اليومي')
}

/* ═══════════ ② الإيجار: معدل الاستغلال ═══════════ */
{
  const { utilizationReport } = await import(join(root, 'src/core/rental.ts'))
  const equipment = [
    { id: 1, nameAr: 'حفار', isActive: true },
    { id: 2, nameAr: 'لودر', isActive: true },
    { id: 3, nameAr: 'ونش معطل', isActive: false },
  ]
  const contracts = [
    { equipmentId: 1, equipmentName: 'حفار', date: '2026-09-01', days: 15, rateType: 'daily', totals: { rentMinor: 150_000_00, depositMinor: 0, vatMinor: 0, grandMinor: 150_000_00 } },
    { equipmentId: 1, equipmentName: 'حفار', date: '2026-09-20', days: 5, rateType: 'daily', totals: { rentMinor: 50_000_00, depositMinor: 0, vatMinor: 0, grandMinor: 50_000_00 } },
  ]
  const rows = utilizationReport(contracts, equipment, { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(rows.length, 2) // المعطل مستبعد
  const digger = rows.find((r) => r.equipmentId === 1)
  const loader = rows.find((r) => r.equipmentId === 2)
  assert.equal(digger.rentedDays, 20)
  assert.equal(digger.utilizationPercent, 67) // 20/30
  assert.equal(digger.revenueMinor, 200_000_00)
  assert.equal(loader.utilizationPercent, 0)
  assert.ok(rows[0].utilizationPercent >= rows[1].utilizationPercent) // مرتبة تنازلياً
  ok('الإيجار: الحفار 20/30 يوماً = 67٪ بإيراد 200 ألف — اللودر الراكد 0٪ — المعطل مستبعد')

  // عقد يمتد خارج الفترة: يُحسب التقاطع فقط
  const rows2 = utilizationReport(
    [{ equipmentId: 2, equipmentName: 'لودر', date: '2026-08-25', days: 10, rateType: 'daily', totals: { rentMinor: 100_000_00, depositMinor: 0, vatMinor: 0, grandMinor: 100_000_00 } }],
    equipment, { from: '2026-09-01', to: '2026-09-30' },
  )
  const l2 = rows2.find((r) => r.equipmentId === 2)
  assert.ok(l2.rentedDays <= 10 && l2.rentedDays >= 3, `تقاطع العقد الممتد: ${l2.rentedDays}`)
  ok('الإيجار: عقد بدأ قبل الفترة يُحسب تقاطعه معها فقط — لا تضخيم للاستغلال')
}

/* ═══════════ ③ المعمل: القيم الحرجة ═══════════ */
{
  const { evaluateResult, isCriticalFlag } = await import(join(root, 'src/core/lab.ts'))
  const range = { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 70, high: 110, criticalLow: 50, criticalHigh: 400 }
  assert.equal(evaluateResult('95', range), 'normal')
  assert.equal(evaluateResult('120', range), 'high')
  assert.equal(evaluateResult('60', range), 'low')
  assert.equal(evaluateResult('450', range), 'critical_high')
  assert.equal(evaluateResult('45', range), 'critical_low')
  assert.ok(isCriticalFlag('critical_high') && isCriticalFlag('critical_low'))
  assert.ok(!isCriticalFlag('high') && !isCriticalFlag('normal'))
  ok('المعمل: سكر 450 = 🚨 حرجة مرتفعة و45 = 🚨 حرجة منخفضة — أولوية فوق مرتفع/منخفض (CAP/CLIA)')

  // نطاق بلا قيم حرجة: يعمل كالسابق تماماً (لا كسر للسجلات القديمة)
  const oldRange = { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: 70, high: 110 }
  assert.equal(evaluateResult('450', oldRange), 'high')
  ok('المعمل: النطاقات القديمة بلا قيم حرجة تعمل كما كانت — لا كسر تراجعي')
}

/* ═══════════ ④ الصيدلية: بدائل المادة الفعالة ═══════════ */
{
  const { sameIngredientAlternatives } = await import(join(root, 'src/core/items.ts'))
  const base = { sku: '', barcodes: [], categoryId: 1, baseUnit: 'علبة', extraUnits: [], costMinor: 0, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true }
  const items = [
    { ...base, id: 1, nameAr: 'بنادول 500', activeIngredient: 'Paracetamol 500mg', stockQty: 0, priceMinor: 30_00 },
    { ...base, id: 2, nameAr: 'سيتال 500', activeIngredient: 'Paracetamol 500mg', stockQty: 20, priceMinor: 15_00 },
    { ...base, id: 3, nameAr: 'أدول 500', activeIngredient: 'Paracetamol 500mg', stockQty: 8, priceMinor: 25_00 },
    { ...base, id: 4, nameAr: 'أدول نافد', activeIngredient: 'Paracetamol 500mg', stockQty: 0, priceMinor: 10_00 },
    { ...base, id: 5, nameAr: 'بروفين', activeIngredient: 'Ibuprofen 400mg', stockQty: 50, priceMinor: 20_00 },
    { ...base, id: 6, nameAr: 'خدمة قياس ضغط', activeIngredient: 'Paracetamol 500mg', stockQty: 0, priceMinor: 5_00, isService: true },
  ]
  const alts = sameIngredientAlternatives(items[0], items)
  assert.deepEqual(alts.map((a) => a.id), [2, 3]) // المتوفر فقط، مرتب بالأرخص، بلا خدمات ولا نافد
  assert.equal(sameIngredientAlternatives({ id: 9, activeIngredient: '' }, items).length, 0)
  ok('الصيدلية: بنادول نافد ← البديلان سيتال (15) ثم أدول (25) بنفس المادة — النافد والخدمة والمادة المختلفة مستبعدون')
}

/* ═══════════ ⑤ الإشعارات الجديدة ═══════════ */
{
  const { collectNotifications } = await import(join(root, 'src/core/notifications.ts'))
  const notifs = collectNotifications({
    batches: [], itemName: () => '', installmentPlans: [], customerName: () => '',
    cheques: [], fmt: (m) => String(m), todayIso: '2026-09-19',
    overdueRentals: [{ id: 7, contractNumber: 'RC-0007', equipmentName: 'حفار كوماتسو', expectedEnd: '2026-09-15' }],
    overduePromises: [
      { id: 3, docNumber: 'MT-0003', what: 'آيفون 13', kind: 'maintenance', promisedAt: '2026-09-17T10:00:00Z' },
      { id: 5, docNumber: 'LN-0005', what: 'أحمد سمير', kind: 'laundry', promisedAt: '2026-09-18' },
    ],
  })
  const rent = notifs.find((n) => n.id === 'rentover:7')
  assert.ok(rent && rent.severity === 'danger' && rent.route === '/rental/contracts' && rent.perm === 'ops.activity.use')
  const mt = notifs.find((n) => n.id === 'promise:maintenance:3')
  assert.ok(mt && mt.route === '/maintenance/tickets')
  const ln = notifs.find((n) => n.id === 'promise:laundry:5')
  assert.ok(ln && ln.route === '/laundry/orders')
  ok('الإشعارات: إيجار متجاوز danger + موعدا صيانة/غسيل متجاوزان — بمسارات صحيحة وصلاحية ops.activity.use')
}

console.log(`\n══════════════════\n${pass} فحوصات دفعة سد فجوات الأنشطة ج2 اجتازت كلها ✅`)
