/**
 * محرك التكلفة — ShopSys
 * ─────────────────────────
 * (ملاحظة المالك المعتمدة): سعر التكلفة لا يُدخل يدوياً —
 * يُحسب تلقائياً من فواتير الشراء بطريقة المتوسط المرجح المتحرك،
 * ومصاريف الشراء (Landed Cost) تُوزَّع على الأصناف فترفع تكلفتها الحقيقية.
 *
 * طريقتا التوزيع (والاختيار لكل مصروف على حدة):
 *  - value: حسب القيمة — الصنف الأغلى يتحمل أكثر (جمارك، تأمين)
 *  - qty:   حسب الكمية — بالتساوي على الوحدات (نولون، نقل)
 *
 * قاعدة صارمة: التوزيع لا يفقد قرشاً واحداً — طريقة الباقي الأكبر
 * (Largest Remainder) تضمن أن مجموع الأنصبة = المصروف تماماً.
 */
import type { Minor } from './money.ts'

export type AllocationMethod = 'value' | 'qty'

export interface CostLine {
  itemId: number
  qty: number
  unitPriceMinor: Minor // سعر شراء الوحدة قبل المصاريف
}

export interface ExpenseInput {
  nameAr: string
  amountMinor: Minor
  method: AllocationMethod
}

/** توزيع مصروف واحد على السطور — يعيد نصيب كل سطر (Minor) بمجموع مطابق تماماً */
export function allocateExpense(lines: CostLine[], expense: ExpenseInput): Minor[] {
  if (lines.length === 0) return []
  if (expense.amountMinor < 0) throw new RangeError('مصروف سالب مرفوض')
  const weights =
    expense.method === 'value'
      ? lines.map((l) => l.qty * l.unitPriceMinor)
      : lines.map((l) => l.qty)
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) {
    // كل الأوزان صفرية — توزيع متساوٍ بالباقي الأكبر
    return largestRemainder(lines.map(() => 1), lines.length, expense.amountMinor)
  }
  return largestRemainder(weights, totalWeight, expense.amountMinor)
}

function largestRemainder(weights: number[], totalWeight: number, amount: Minor): Minor[] {
  const raw = weights.map((w) => (w / totalWeight) * amount)
  const floors = raw.map(Math.floor)
  let remainder = amount - floors.reduce((a, b) => a + b, 0)
  // وزّع الباقي على أكبر الكسور
  const order = raw
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac)
  const result = [...floors]
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1
  }
  return result
}

export interface LandedLine extends CostLine {
  expenseShareMinor: Minor // إجمالي نصيب السطر من كل المصاريف
  landedTotalMinor: Minor // (سعر×كمية) + النصيب
  landedUnitCostMinor: Minor // تكلفة الوحدة النهائية بعد المصاريف
}

/** حساب التكلفة الهابطة لكل سطر بعد توزيع كل المصاريف */
export function computeLandedCosts(lines: CostLine[], expenses: ExpenseInput[]): LandedLine[] {
  const shares = lines.map(() => 0)
  for (const exp of expenses) {
    const alloc = allocateExpense(lines, exp)
    alloc.forEach((a, i) => (shares[i] += a))
  }
  return lines.map((l, i) => {
    const gross = Math.round(l.qty * l.unitPriceMinor)
    const landedTotal = gross + shares[i]
    return {
      ...l,
      expenseShareMinor: shares[i],
      landedTotalMinor: landedTotal,
      landedUnitCostMinor: l.qty > 0 ? Math.round(landedTotal / l.qty) : 0,
    }
  })
}

/**
 * المتوسط المرجح المتحرك:
 * التكلفة الجديدة = (الرصيد الحالي×تكلفته + الوارد×تكلفته الهابطة) ÷ (الرصيد + الوارد)
 */
export function weightedAverage(
  currentQty: number,
  currentUnitCostMinor: Minor,
  incomingQty: number,
  incomingLandedTotalMinor: Minor,
): Minor {
  if (incomingQty <= 0) return currentUnitCostMinor
  const totalQty = currentQty + incomingQty
  if (totalQty <= 0) return currentUnitCostMinor
  const totalValue = Math.round(currentQty * currentUnitCostMinor) + incomingLandedTotalMinor
  return Math.round(totalValue / totalQty)
}
