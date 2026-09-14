/**
 * وحدة معارض السيارات: بيع + إيجار (القرار 27) — نواة خالصة
 * ─────────────────────────────────────────────────────────
 * كل سيارة وحدة فريدة (شاسيه/لوحة) بتكلفة شراء + مصاريف تجهيز تُرسمل
 * عليها، فتكون ربحية البيع دقيقة لكل سيارة على حدة. السيارات المعدّة
 * للإيجار تستفيد من وحدة إيجار المعدات نفسها (عقود يومية/شهرية
 * بعدّاد كيلومترات) — لا تكرار للمنطق.
 *
 * القيود:
 * - شراء سيارة (بضاعة): 1103 مخزون ← 1101|2101
 * - تجهيز/إصلاح قبل البيع: 1103 (رسملة) ← 1101|2101
 * - بيع: 1101|1104 ← 4101 مبيعات + 2102، مع 5101 تكلفة ← 1103
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type CarPurpose = 'sale' | 'rent'
export type CarStatus = 'in_stock' | 'sold' | 'renting'

export interface CarInput {
  make: string // ماركة
  model: string
  year: number
  plateOrVin: string // لوحة أو شاسيه — معرف فريد
  purpose: CarPurpose
  purchaseCostMinor: Minor
  odometerKm: number
}

export function validateCar(c: CarInput, existingPlates: readonly string[]): string[] {
  const errors: string[] = []
  if (!c.make.trim() || !c.model.trim()) errors.push('الماركة والموديل مطلوبان')
  if (!c.plateOrVin.trim()) errors.push('رقم اللوحة أو الشاسيه مطلوب')
  if (existingPlates.some((p) => p.trim().toLowerCase() === c.plateOrVin.trim().toLowerCase())) {
    errors.push(`السيارة ${c.plateOrVin} مسجلة بالفعل`)
  }
  if (!Number.isInteger(c.year) || c.year < 1950 || c.year > 2100) errors.push('سنة الصنع غير منطقية')
  if (!Number.isInteger(c.purchaseCostMinor) || c.purchaseCostMinor <= 0) errors.push('تكلفة الشراء يجب أن تكون موجبة')
  if (!Number.isInteger(c.odometerKm) || c.odometerKm < 0) errors.push('عداد الكيلومترات لا يكون سالباً')
  return errors
}

/** قيد شراء سيارة كبضاعة: 1103 ← 1101|2101 */
export function buildCarPurchaseEntry(costMinor: Minor, payment: 'cash' | 'credit', label: string): JournalLine[] {
  if (!Number.isInteger(costMinor) || costMinor <= 0) throw new Error('تكلفة الشراء يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: costMinor, credit: 0, note: `شراء ${label}` },
    { accountCode: payment === 'cash' ? '1101' : '2101', debit: 0, credit: costMinor, note: payment === 'cash' ? 'سداد نقدي' : 'مستحق للمورد' },
  ]
  assertBalanced(lines)
  return lines
}

/** قيد تجهيز يُرسمل على السيارة (سمكرة/دهان/قطع): 1103 ← 1101|2101 */
export function buildCarPrepEntry(costMinor: Minor, payment: 'cash' | 'credit', label: string): JournalLine[] {
  if (!Number.isInteger(costMinor) || costMinor <= 0) throw new Error('تكلفة التجهيز يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: costMinor, credit: 0, note: `تجهيز ${label} (يرسمل على التكلفة)` },
    { accountCode: payment === 'cash' ? '1101' : '2101', debit: 0, credit: costMinor, note: payment === 'cash' ? 'سداد نقدي' : 'آجل' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── البيع ─── */

export interface CarSaleTotals {
  priceMinor: Minor // سعر البيع (قبل الضريبة)
  vatMinor: Minor
  totalMinor: Minor
  fullCostMinor: Minor // شراء + كل التجهيزات
  profitMinor: Minor // السعر − التكلفة الكاملة
}

export function computeCarSale(priceMinor: Minor, fullCostMinor: Minor, vatPercent: number): CarSaleTotals {
  if (!Number.isInteger(priceMinor) || priceMinor <= 0) throw new Error('سعر البيع يجب أن يكون موجباً')
  if (vatPercent < 0 || vatPercent > 100) throw new Error('نسبة الضريبة بين 0 و100')
  const vat = Math.round((priceMinor * vatPercent) / 100)
  return { priceMinor, vatMinor: vat, totalMinor: priceMinor + vat, fullCostMinor, profitMinor: priceMinor - fullCostMinor }
}

/**
 * قيدا البيع معاً (سطور قيد واحد متوازن):
 * 1101|1104 بالإجمالي ← 4101 + 2102، ثم 5101 التكلفة ← 1103 إخراج من المخزون
 */
export function buildCarSaleEntry(t: CarSaleTotals, payment: 'cash' | 'credit', label: string): JournalLine[] {
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? '1101' : '1104', debit: t.totalMinor, credit: 0, note: `بيع ${label}` },
    { accountCode: '4101', debit: 0, credit: t.priceMinor, note: 'إيراد بيع سيارة' },
  ]
  if (t.vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: t.vatMinor, note: 'ض.ق.م' })
  // إثبات التكلفة وإخراج السيارة من المخزون
  lines.push({ accountCode: '5101', debit: t.fullCostMinor, credit: 0, note: 'تكلفة السيارة المباعة' })
  lines.push({ accountCode: '1103', debit: 0, credit: t.fullCostMinor, note: 'إخراج من المخزون' })
  assertBalanced(lines)
  return lines
}

/* ─── تقرير المعرض ─── */

export interface ShowroomSummary {
  inStock: number
  sold: number
  renting: number
  stockValueMinor: Minor // تكلفة السيارات المتاحة
  totalProfitMinor: Minor // أرباح البيع المحققة
}

export function showroomSummary(
  cars: readonly { status: CarStatus; fullCostMinor: Minor; profitMinor: Minor | null }[],
): ShowroomSummary {
  let inStock = 0, sold = 0, renting = 0, stockValue = 0, profit = 0
  for (const c of cars) {
    if (c.status === 'in_stock') { inStock++; stockValue += c.fullCostMinor }
    else if (c.status === 'sold') { sold++; profit += c.profitMinor ?? 0 }
    else renting++
  }
  return { inStock, sold, renting, stockValueMinor: stockValue, totalProfitMinor: profit }
}
