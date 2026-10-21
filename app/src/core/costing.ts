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

export interface StockValueWithdrawal {
  withdrawnValueMinor: Minor
  remainingQty: number
  remainingValueMinor: Minor
}

/**
 * Allocate a movement against an exact on-hand stock value (Minor), not the
 * rounded display average. Sequential withdrawals telescope to the original
 * value; a final depletion receives every remaining minor unit.
 */
export function withdrawStockValue(
  currentQty: number,
  currentValueMinor: Minor,
  outgoingQty: number,
): StockValueWithdrawal {
  if (!Number.isFinite(currentQty) || currentQty < 0 || !Number.isFinite(outgoingQty) || outgoingQty < 0) {
    throw new RangeError('كمية المخزون غير صالحة')
  }
  if (!Number.isSafeInteger(currentValueMinor) || currentValueMinor < 0) {
    throw new RangeError('قيمة المخزون يجب أن تكون Minor صحيحة غير سالبة')
  }
  if (outgoingQty > currentQty + 1e-9) throw new RangeError('الكمية المصروفة تتجاوز الرصيد')
  if (currentQty === 0 || outgoingQty === 0) {
    return { withdrawnValueMinor: 0, remainingQty: currentQty, remainingValueMinor: currentValueMinor }
  }
  const allOut = Math.abs(outgoingQty - currentQty) <= 1e-9
  // Match the rounded moving-average cost used by current stock movements and
  // their journal lines. Any accumulated rounding remainder stays with stock
  // and is consumed on later movements (or entirely on final depletion).
  const currentUnitCostMinor = Math.round(currentValueMinor / currentQty)
  const withdrawnValueMinor = allOut
    ? currentValueMinor
    : Math.min(currentValueMinor, Math.round(currentUnitCostMinor * outgoingQty))
  const remainingQty = Math.round((currentQty - outgoingQty) * 1000) / 1000
  return {
    withdrawnValueMinor,
    remainingQty,
    remainingValueMinor: currentValueMinor - withdrawnValueMinor,
  }
}

export interface StockValueReconciliation {
  stockValueMinor: Minor
  costMinor: Minor
}

/** Keep carried value aligned when any stock path changes its on-hand quantity. */
export function reconcileStockValue(
  currentQty: number,
  currentUnitCostMinor: Minor,
  currentValueMinor: Minor,
  nextQty: number,
  nextUnitCostMinor: Minor,
): StockValueReconciliation {
  if (![currentQty, nextQty].every(Number.isFinite)) {
    throw new RangeError('كمية المخزون غير صالحة')
  }
  if (![currentUnitCostMinor, nextUnitCostMinor].every((value) => Number.isSafeInteger(value) && value >= 0)
    || !Number.isSafeInteger(currentValueMinor)
    || (currentValueMinor < 0 && currentQty >= 0)) {
    throw new RangeError('تكلفة/قيمة المخزون يجب أن تكون Minor صحيحة غير سالبة')
  }
  let stockValueMinor: Minor
  if (nextQty <= 0) {
    // Negative stock is an optional operational mode; it has no on-hand asset value.
    return { stockValueMinor: 0, costMinor: nextUnitCostMinor }
  }
  if (currentQty < 0) {
    // Crossing back from a negative balance establishes a fresh positive stock basis.
    stockValueMinor = Math.round(nextQty * nextUnitCostMinor)
  } else if (nextUnitCostMinor !== currentUnitCostMinor) {
    // A changed unit cost signals an explicit valuation (opening stock,
    // count adjustment, return or reversal) rather than a routine withdrawal.
    stockValueMinor = Math.round(nextQty * nextUnitCostMinor)
  } else if (nextQty < currentQty) {
    stockValueMinor = withdrawStockValue(currentQty, currentValueMinor, currentQty - nextQty).remainingValueMinor
  } else if (nextQty > currentQty) {
    stockValueMinor = currentValueMinor + Math.round((nextQty - currentQty) * currentUnitCostMinor)
  } else {
    stockValueMinor = Math.round(nextQty * nextUnitCostMinor)
  }
  if (!Number.isSafeInteger(stockValueMinor) || stockValueMinor < 0) throw new RangeError('قيمة المخزون خارج النطاق الآمن')
  return {
    stockValueMinor,
    costMinor: nextQty > 0 ? Math.round(stockValueMinor / nextQty) : nextUnitCostMinor,
  }
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
  currentValueMinor?: Minor,
): Minor {
  if (incomingQty <= 0) return currentUnitCostMinor
  const totalQty = currentQty + incomingQty
  if (totalQty <= 0) return currentUnitCostMinor
  const carriedValue = currentValueMinor ?? Math.round(currentQty * currentUnitCostMinor)
  const validCarriedValue = Number.isSafeInteger(carriedValue) && (carriedValue >= 0 || currentQty < 0)
  if (!validCarriedValue || !Number.isSafeInteger(incomingLandedTotalMinor) || incomingLandedTotalMinor < 0) {
    throw new RangeError('قيمة المخزون/الوارد غير صالحة')
  }
  const totalValue = carriedValue + incomingLandedTotalMinor
  return Math.round(totalValue / totalQty)
}
