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
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
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
      expiryDate: b.expiryDate,
      qty: b.qty,
      daysLeft,
      status: daysLeft < 0 ? 'expired' : 'soon',
    })
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft)
  return rows
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
