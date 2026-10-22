/**
 * دفعات الصلاحية FEFO (القراران 5 و8):
 * كل استلام لصنف يتتبع الصلاحية يفتح «دفعة» بتاريخ انتهاء،
 * والبيع يصرف من الأقرب انتهاءً أولاً (FEFO). بيع كمية من دفعة منتهية
 * محظور ويتطلب تجاوز مدير مسجَّلاً على الفاتورة (expiryOverrideBy — القرار 8).
 *
 * الدفعات تتبُّع إرشادي فوق رصيد الصنف الكلي: لو تباعد الرصيدان
 * (جرد/مرتجعات قديمة) يُصرف الفائض غير المتتبَّع بلا اعتراض — لا نحبس البيع.
 * نواة خالصة بلا واجهات.
 */
import { calendarDateIso } from './time.ts'

export interface StockBatch {
  id: number
  itemId: number
  /** المخزن الفعلي للدفعة؛ undefined لسجلات قديمة قبل التتبع المخزني */
  warehouseId?: number | null
  /** رقم التشغيلة/الدفعة التجاري الظاهر للمستخدم؛ مستقل عن id الداخلي */
  lotNumber?: string | null
  expiryDate: string | null // YYYY-MM-DD — null = بلا تاريخ معروف (مرتجع مثلاً)
  qty: number // المتبقي من الدفعة
  purchaseId: number | null // فاتورة الشراء المنشئة (null = مرتجع/افتتاحي)
  receivedAt: string // ISO
}

/** خطأ مخصص: البيع يمس كمية منتهية — يلتقطه الكاشير ليطلب موافقة المدير */
export class ExpiredStockError extends Error {
  readonly itemNames: string[]
  constructor(itemNames: string[]) {
    super(`أصناف منتهية الصلاحية: ${itemNames.join('، ')} — البيع يتطلب موافقة المدير (القرار 8)`)
    this.name = 'ExpiredStockError'
    this.itemNames = itemNames
  }
}

/** صيغة تاريخ الصلاحية YYYY-MM-DD صحيحة فعلياً؟ */
export function isValidExpiryDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && calendarDateIso(d) === s
}

/** ترتيب FEFO: الأقرب انتهاءً أولاً، وبلا تاريخ في الآخر، ثم الأقدم استلاماً */
export function sortFefo(batches: StockBatch[]): StockBatch[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return a.receivedAt < b.receivedAt ? -1 : 1
    if (a.expiryDate === null) return 1
    if (b.expiryDate === null) return -1
    if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
    return a.receivedAt < b.receivedAt ? -1 : 1
  })
}

export interface FefoAllocation {
  batchId: number
  qty: number
  expiryDate: string | null
  expired: boolean // الدفعة منتهية يوم البيع
}

export interface FefoPlan {
  allocations: FefoAllocation[]
  untrackedQty: number // كمية فوق ما تغطيه الدفعات — تُصرف بلا اعتراض
  touchesExpired: boolean
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** خطة صرف FEFO لكمية من صنف — لا تعدّل شيئاً، تُخطط فقط */
export function planFefo(batches: StockBatch[], itemId: number, qty: number, today: string, warehouseId?: number | null): FefoPlan {
  const day = today.slice(0, 10)
  const mine = sortFefo(batches.filter((b) => b.itemId === itemId && b.qty > 0 && (warehouseId == null || b.warehouseId == null || b.warehouseId === warehouseId)))
  const allocations: FefoAllocation[] = []
  let remaining = qty
  for (const b of mine) {
    if (remaining <= 0) break
    const take = round3(Math.min(remaining, b.qty))
    if (take <= 0) continue
    allocations.push({
      batchId: b.id,
      qty: take,
      expiryDate: b.expiryDate,
      expired: b.expiryDate !== null && b.expiryDate < day,
    })
    remaining = round3(remaining - take)
  }
  return {
    allocations,
    untrackedQty: round3(Math.max(0, remaining)),
    touchesExpired: allocations.some((a) => a.expired),
  }
}

/** تطبيق خطة الصرف: يعيد قائمة دفعات جديدة (الدفعات الصفرية تُحذف) */
export function applyFefo(batches: StockBatch[], plan: FefoPlan): StockBatch[] {
  const takeById = new Map(plan.allocations.map((a) => [a.batchId, a.qty]))
  return batches
    .map((b) => (takeById.has(b.id) ? { ...b, qty: round3(b.qty - takeById.get(b.id)!) } : b))
    .filter((b) => b.qty > 0)
}

/* ─── تنبيهات الصلاحية ─── */

export interface ExpiryAlertRow {
  itemId: number
  nameAr: string
  /** رقم التشغيلة/الدفعة التجاري — null إن لم يُسجَّل وقت الاستلام */
  lotNumber: string | null
  expiryDate: string
  qty: number
  daysLeft: number // سالب = منتهٍ
  status: 'expired' | 'soon'
}

/**
 * تنبيهات الصلاحية: دفعات منتهية أو تنتهي خلال horizon يوماً —
 * مرتبة بالأشد (المنتهي أولاً ثم الأقرب انتهاءً)
 */
export function expiryAlerts(
  batches: StockBatch[],
  itemName: (itemId: number) => string,
  today: string,
  horizonDays = 30,
): ExpiryAlertRow[] {
  const day = today.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)
  const rows: ExpiryAlertRow[] = []
  for (const b of batches) {
    if (b.expiryDate === null || b.qty <= 0) continue
    const daysLeft = Math.floor((Date.parse(`${b.expiryDate}T00:00:00Z`) - dayMs) / 86_400_000)
    if (daysLeft > horizonDays) continue
    rows.push({
      itemId: b.itemId,
      nameAr: itemName(b.itemId),
      lotNumber: b.lotNumber ?? null,
      expiryDate: b.expiryDate,
      qty: b.qty,
      daysLeft,
      status: daysLeft < 0 ? 'expired' : 'soon',
    })
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft)
  return rows
}

/* ─── اقتراح تسعير تصاعدي قرب الانتهاء (سد فجوة «مستقبلية»: تسعير ديناميكي) ───
   اقتراح استرشادي فقط — لا يُغيّر سعر الصنف تلقائياً، يعرضه المالك ليقرر
   تفعيله يدوياً (عبر قائمة أسعار أو عرض). نسبة الخصم تتصاعد خطياً كلما
   قرب موعد الانتهاء، من 10٪ عند أفق الرصد إلى 50٪ يوم الانتهاء. */

export interface MarkdownSuggestionRow {
  itemId: number
  nameAr: string
  lotNumber: string | null
  expiryDate: string
  qty: number
  daysLeft: number
  currentPriceMinor: number
  suggestedDiscountPercent: number
  suggestedPriceMinor: number
}

export function markdownSuggestions(
  batches: StockBatch[],
  items: readonly { id: number; nameAr: string; priceMinor: number }[],
  today: string,
  horizonDays = 7,
): MarkdownSuggestionRow[] {
  const itemName = (id: number) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`
  // لا نقترح خصماً على المنتهي فعلاً (status='expired') — ذاك مرشح للإتلاف لا للبيع
  const soon = expiryAlerts(batches, itemName, today, horizonDays).filter((a) => a.status === 'soon')
  return soon.map((a) => {
    const priceMinor = items.find((it) => it.id === a.itemId)?.priceMinor ?? 0
    const ratio = 1 - Math.max(0, Math.min(horizonDays, a.daysLeft)) / horizonDays
    const suggestedDiscountPercent = Math.round(10 + ratio * 40)
    return {
      itemId: a.itemId,
      nameAr: a.nameAr,
      lotNumber: a.lotNumber,
      expiryDate: a.expiryDate,
      qty: a.qty,
      daysLeft: a.daysLeft,
      currentPriceMinor: priceMinor,
      suggestedDiscountPercent,
      suggestedPriceMinor: Math.max(0, Math.round(priceMinor * (1 - suggestedDiscountPercent / 100))),
    }
  })
}

/** إجمالي الكمية المنتهية لصنف (تُعرض في الكاشير والتقارير) */
export function expiredQty(batches: StockBatch[], itemId: number, today: string): number {
  const day = today.slice(0, 10)
  return round3(
    batches
      .filter((b) => b.itemId === itemId && b.expiryDate !== null && b.expiryDate < day)
      .reduce((a, b) => a + b.qty, 0),
  )
}

/* ─── أقرب انتهاء لكل صنف (سد فجوة: شارة استباقية في شبكة/بحث الكاشير) ───
   خلافاً لتنبيهات التقارير (بعد البيع)، هذه تُستخدم قبل الإضافة للسلة —
   تعرض أقرب تاريخ انتهاء معروف لكل صنف (قد يكون سالباً = منتهٍ فعلاً) */

export interface NearestExpiry {
  daysLeft: number // سالب = منتهٍ
  expiryDate: string
}

/** أقرب تاريخ انتهاء لكل صنف من بين دفعاته ذات الرصيد الموجب */
export function nearestExpiryByItem(batches: StockBatch[], today: string): Map<number, NearestExpiry> {
  const day = today.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)
  const map = new Map<number, NearestExpiry>()
  for (const b of batches) {
    if (b.expiryDate === null || b.qty <= 0) continue
    const daysLeft = Math.floor((Date.parse(`${b.expiryDate}T00:00:00Z`) - dayMs) / 86_400_000)
    const cur = map.get(b.itemId)
    if (!cur || daysLeft < cur.daysLeft) map.set(b.itemId, { daysLeft, expiryDate: b.expiryDate })
  }
  return map
}

/* ─── قيمة المخزون المعرَّض لخطر الانتهاء بالعملة (سد فجوة تقرير #5 الفوري) ───
   التنبيهات التفصيلية (expiryAlerts) تعرض الكمية والتاريخ فقط لكل دفعة؛
   هذه تجمعها في مؤشر مالي واحد لكل أفق زمني — نمط لوحات التحكم في البرامج
   العالمية المتخصصة (ShelfLifePro وغيره) */

export interface ExpiryValueAtRiskRow {
  horizonDays: number
  qty: number
  valueMinor: number
  batchCount: number
}

/** تجميع كمية/قيمة الدفعات المنتهية أو التي تنتهي خلال كل أفق من الآفاق المطلوبة */
export function expiryValueAtRisk(
  batches: StockBatch[],
  items: readonly { id: number; costMinor: number }[],
  today: string,
  horizons: readonly number[] = [30, 60, 90],
): ExpiryValueAtRiskRow[] {
  const day = today.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)
  const costOf = (itemId: number) => items.find((it) => it.id === itemId)?.costMinor ?? 0
  return horizons.map((horizonDays) => {
    let qty = 0
    let valueMinor = 0
    let batchCount = 0
    for (const b of batches) {
      if (b.expiryDate === null || b.qty <= 0) continue
      const daysLeft = Math.floor((Date.parse(`${b.expiryDate}T00:00:00Z`) - dayMs) / 86_400_000)
      if (daysLeft > horizonDays) continue
      qty = round3(qty + b.qty)
      valueMinor += Math.round(b.qty * costOf(b.itemId))
      batchCount += 1
    }
    return { horizonDays, qty, valueMinor, batchCount }
  })
}

/* ─── دفعات داخل نافذة إرجاع موردها (سد فجوة الدليل الداخلي: "جهّز مرتجعات
   الموردين قبل فوات موعد الإرجاع") ───
   النافذة تُقرأ من `supplier.returnWindowDays` (عدد الأيام قبل الانتهاء
   التي يقبل المورد خلالها استرجاع الدفعة): دفعة «داخل النافذة» إن كانت لم
   تنتهِ بعد (daysLeft >= 0) وباقي أيامها حتى الانتهاء ≤ هذه النافذة.
   مورد بلا نافذة مسجَّلة (0/undefined) لا تظهر دفعاته هنا إطلاقاً — لا
   نخمّن سياسة إرجاع غير موثَّقة. */

export interface SupplierReturnCandidateRow {
  itemId: number
  nameAr: string
  lotNumber: string | null
  expiryDate: string
  qty: number
  daysLeft: number
  supplierId: number
  supplierName: string
  returnWindowDays: number
}

export function supplierReturnCandidates(
  batches: StockBatch[],
  items: readonly { id: number; nameAr: string }[],
  purchases: readonly { id: number; supplierId: number }[],
  suppliers: readonly { id: number; nameAr: string; returnWindowDays?: number }[],
  today: string,
): SupplierReturnCandidateRow[] {
  const day = today.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)
  const purchaseSupplier = new Map(purchases.map((p) => [p.id, p.supplierId]))
  const supplierById = new Map(suppliers.map((s) => [s.id, s]))
  const itemName = (id: number) => items.find((it) => it.id === id)?.nameAr ?? `صنف #${id}`
  const rows: SupplierReturnCandidateRow[] = []
  for (const b of batches) {
    if (b.expiryDate === null || b.qty <= 0 || b.purchaseId === null) continue
    const supplierId = purchaseSupplier.get(b.purchaseId)
    if (supplierId == null) continue
    const supplier = supplierById.get(supplierId)
    const windowDays = supplier?.returnWindowDays ?? 0
    if (!supplier || windowDays <= 0) continue
    const daysLeft = Math.floor((Date.parse(`${b.expiryDate}T00:00:00Z`) - dayMs) / 86_400_000)
    if (daysLeft < 0 || daysLeft > windowDays) continue
    rows.push({
      itemId: b.itemId,
      nameAr: itemName(b.itemId),
      lotNumber: b.lotNumber ?? null,
      expiryDate: b.expiryDate,
      qty: b.qty,
      daysLeft,
      supplierId,
      supplierName: supplier.nameAr,
      returnWindowDays: windowDays,
    })
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft)
  return rows
}
