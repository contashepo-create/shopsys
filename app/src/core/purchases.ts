/**
 * محاسبة المشتريات ومرتجعاتها — ShopSys (المرحلة 3)
 * ─────────────────────────────────────────────────
 * قيد الشراء: البضاعة تدخل المخزون بتكلفتها الكاملة (بضاعة + مصاريف موزعة)،
 * والمدفوع يخرج من الخزينة والباقي ديناً على المورد.
 * المرتجع: يُقيَّم بالتكلفة النهائية للوحدة من فاتورته الأصلية (Landed Cost)،
 * ولا يُرجَع أكثر مما اشتُري (تراكمياً) ولا أكثر من المخزون الحالي.
 */
import type { Minor } from './money.ts'
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'

/**
 * قيد فاتورة الشراء:
 *   مدين: المخزون (1103) بالتكلفة الكاملة (بضاعة + مصاريف)
 *   دائن: الخزينة (1101) بالمدفوع
 *   دائن: الموردون (2101) بالمتبقي
 * يرمي خطأ لو المدفوع أكبر من الإجمالي.
 */
export function buildPurchaseEntry(grandTotalMinor: Minor, paidMinor: Minor): JournalLine[] {
  if (paidMinor < 0) throw new RangeError('المدفوع لا يكون سالباً')
  if (paidMinor > grandTotalMinor) throw new RangeError('المدفوع أكبر من إجمالي الفاتورة')
  const remaining = grandTotalMinor - paidMinor
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: grandTotalMinor, credit: 0, note: 'بضاعة واردة بتكلفتها الكاملة' },
  ]
  if (paidMinor > 0) lines.push({ accountCode: '1101', debit: 0, credit: paidMinor, note: 'مدفوع نقداً' })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'دين للمورد' })
  assertBalanced(lines)
  return lines
}

/* ─── مرتجع الشراء ─── */

export interface PurchaseReturnLine {
  itemId: number
  nameAr: string
  qty: number
  landedUnitCostMinor: Minor // تكلفة الوحدة النهائية من فاتورة الشراء الأصلية
}

/** سطر من فاتورة الشراء الأصلية كما تحتاجه حسابات المرتجع */
export interface OriginalPurchaseLine {
  itemId: number
  qty: number
  landedUnitCostMinor: Minor
}

/** المتبقي القابل للإرجاع لكل صنف (المشترى − مجموع المرتجعات السابقة على نفس الفاتورة) */
export function remainingPurchasable(
  purchaseLines: OriginalPurchaseLine[],
  priorReturnLines: { itemId: number; qty: number }[],
): Map<number, number> {
  const map = new Map<number, number>()
  for (const l of purchaseLines) map.set(l.itemId, (map.get(l.itemId) ?? 0) + l.qty)
  for (const r of priorReturnLines) {
    map.set(r.itemId, Math.round(((map.get(r.itemId) ?? 0) - r.qty) * 1000) / 1000)
  }
  return map
}

/**
 * بناء سطور مرتجع الشراء بكميات مطلوبة — بتكلفة الوحدة النهائية من الأصل.
 * يرمي خطأ لو الكمية تتجاوز المتبقي القابل للإرجاع أو المخزون الحالي
 * (لا يمكن إرجاع بضاعة بِيعت بالفعل).
 */
export function buildPurchaseReturnLines(
  purchaseLines: OriginalPurchaseLine[],
  priorReturnLines: { itemId: number; qty: number }[],
  qtyByItem: Map<number, number>,
  itemInfo: (itemId: number) => { nameAr: string; stockQty: number } | undefined,
): PurchaseReturnLine[] {
  const remaining = remainingPurchasable(purchaseLines, priorReturnLines)
  const out: PurchaseReturnLine[] = []
  for (const [itemId, wanted] of qtyByItem) {
    if (wanted <= 0) continue
    const info = itemInfo(itemId)
    const name = info?.nameAr ?? `#${itemId}`
    const orig = purchaseLines.find((l) => l.itemId === itemId)
    if (!orig) throw new RangeError(`«${name}» ليس في فاتورة الشراء الأصلية`)
    const canReturn = remaining.get(itemId) ?? 0
    if (wanted > canReturn + 1e-9) {
      throw new RangeError(`«${name}»: المطلوب إرجاع ${wanted} والمتبقي القابل للإرجاع ${canReturn}`)
    }
    if (info && wanted > info.stockQty + 1e-9) {
      throw new RangeError(`«${name}»: المخزون الحالي ${info.stockQty} فقط — لا يمكن إرجاع بضاعة بيعت بالفعل`)
    }
    out.push({ itemId, nameAr: name, qty: wanted, landedUnitCostMinor: orig.landedUnitCostMinor })
  }
  if (!out.length) throw new RangeError('لا كميات للإرجاع')
  return out
}

export function purchaseReturnTotal(lines: PurchaseReturnLine[]): Minor {
  return lines.reduce((a, l) => a + Math.round(l.qty * l.landedUnitCostMinor), 0)
}

/**
 * قيد مرتجع الشراء:
 *   دائن: المخزون (1103) — البضاعة تخرج بقيمتها
 *   مدين: الخزينة (1101) استرداد نقدي، أو الموردون (2101) تخفيض الدين
 */
export function buildPurchaseReturnEntry(
  totalMinor: Minor,
  refund: 'cash' | 'debt',
): JournalLine[] {
  if (totalMinor <= 0) throw new RangeError('قيمة المرتجع يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    {
      accountCode: refund === 'cash' ? '1101' : '2101',
      debit: totalMinor,
      credit: 0,
      note: refund === 'cash' ? 'استرداد نقدي من المورد' : 'تخفيض دين المورد',
    },
    { accountCode: '1103', debit: 0, credit: totalMinor, note: 'بضاعة خارجة للمورد' },
  ]
  assertBalanced(lines)
  return lines
}
