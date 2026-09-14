/**
 * الجرد بالباركود وتسوية المخزون — ShopSys (المرحلة 3)
 * ─────────────────────────────────────────────────────
 * جلسة جرد: امسح/عدّ الأصناف، والنظام يقارن المعدود بالدفتري
 * ويحسب الفوارق مُقيَّمة بتكلفة كل صنف، ثم قيد تسوية واحد متوازن:
 * العجز مصروف (5108) والزيادة تخفيض للمصروف — والمخزون يُضبط على المعدود.
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

export interface CountInput {
  itemId: number
  nameAr: string
  expectedQty: number // الرصيد الدفتري وقت الجرد
  countedQty: number // المعدود فعلياً
  unitCostMinor: Minor // تكلفة الوحدة (متوسط مرجح) للتقييم
}

export interface Variance {
  itemId: number
  nameAr: string
  expectedQty: number
  countedQty: number
  diffQty: number // موجب = زيادة، سالب = عجز
  valueMinor: Minor // قيمة الفارق (بإشارته)
}

export interface StocktakeResult {
  variances: Variance[] // الأصناف المختلفة فقط
  matchedCount: number // أصناف مطابقة تماماً
  shortageValueMinor: Minor // إجمالي قيمة العجز (موجب)
  surplusValueMinor: Minor // إجمالي قيمة الزيادة (موجب)
  netValueMinor: Minor // الزيادة − العجز (بإشارته)
}

/** حساب فوارق الجرد — منطق خالص قابل للفحص */
export function computeStocktake(counts: CountInput[]): StocktakeResult {
  const seen = new Set<number>()
  for (const c of counts) {
    if (c.countedQty < 0) throw new RangeError(`«${c.nameAr}»: المعدود لا يكون سالباً`)
    if (seen.has(c.itemId)) throw new RangeError(`«${c.nameAr}» مكرر في الجرد`)
    seen.add(c.itemId)
  }
  const variances: Variance[] = []
  let matched = 0
  let shortage = 0
  let surplus = 0
  for (const c of counts) {
    const diff = Math.round((c.countedQty - c.expectedQty) * 1000) / 1000
    if (diff === 0) { matched++; continue }
    const value = Math.round(diff * c.unitCostMinor)
    variances.push({
      itemId: c.itemId, nameAr: c.nameAr,
      expectedQty: c.expectedQty, countedQty: c.countedQty,
      diffQty: diff, valueMinor: value,
    })
    if (value < 0) shortage += -value
    else surplus += value
  }
  return {
    variances,
    matchedCount: matched,
    shortageValueMinor: shortage,
    surplusValueMinor: surplus,
    netValueMinor: surplus - shortage,
  }
}

/**
 * قيد تسوية الجرد (sourceType: adjustment):
 *   عجز: مدين مصروفات عمومية (5108) / دائن مخزون (1103)
 *   زيادة: مدين مخزون (1103) / دائن مصروفات عمومية (5108)
 * يُبنى قيد واحد صافٍ بطرفي العجز والزيادة معاً — ويرمي خطأ لو لا فوارق.
 */
export function buildAdjustmentEntry(result: StocktakeResult): JournalLine[] {
  const { shortageValueMinor: sh, surplusValueMinor: su } = result
  if (sh === 0 && su === 0) throw new RangeError('لا فوارق — لا حاجة لقيد تسوية')
  const lines: JournalLine[] = []
  if (sh > 0) {
    lines.push({ accountCode: '5108', debit: sh, credit: 0, note: 'عجز جرد' })
    lines.push({ accountCode: '1103', debit: 0, credit: sh, note: 'تخفيض المخزون بالعجز' })
  }
  if (su > 0) {
    lines.push({ accountCode: '1103', debit: su, credit: 0, note: 'زيادة جرد للمخزون' })
    lines.push({ accountCode: '5108', debit: 0, credit: su, note: 'زيادة جرد (تخفيض مصروف)' })
  }
  assertBalanced(lines)
  return lines
}
