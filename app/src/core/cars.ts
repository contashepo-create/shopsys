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
export type CarPaymentMode = 'cash' | 'credit' | 'mixed'

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

/**
 * قيد شراء سيارة كبضاعة: 1103 ← مصدر الدفع + 2101.
 * يدعم الشراء النقدي الكامل، الآجل الكامل، أو النقدي/البنكي مع باقي آجل.
 */
export function buildCarPurchaseEntry(costMinor: Minor, payment: CarPaymentMode, label: string, treasury = '1101', paidMinor?: Minor): JournalLine[] {
  if (!Number.isInteger(costMinor) || costMinor <= 0) throw new Error('تكلفة الشراء يجب أن تكون موجبة')
  const paid = paidMinor ?? (payment === 'cash' ? costMinor : 0)
  if (!Number.isInteger(paid) || paid < 0 || paid > costMinor) throw new Error('المدفوع يجب أن يكون بين صفر وإجمالي السيارة')
  const remaining = costMinor - paid
  const lines: JournalLine[] = [{ accountCode: '1103', debit: costMinor, credit: 0, note: `شراء ${label}` }]
  if (paid > 0) lines.push({ accountCode: treasury, debit: 0, credit: paid, note: 'مدفوع نقداً/بنكياً' })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'المتبقي مستحق للمورد' })
  assertBalanced(lines)
  return lines
}

/**
 * قيد تجهيز يُرسمل على السيارة: 1103 ← مصدر الدفع + 2101.
 * لا يشترط وجود ورشة مسجلة؛ يمكن تسجيل اسم الجهة اختيارياً في وصف القيد.
 */
export function buildCarPrepEntry(costMinor: Minor, payment: CarPaymentMode, label: string, treasury = '1101', paidMinor?: Minor): JournalLine[] {
  if (!Number.isInteger(costMinor) || costMinor <= 0) throw new Error('تكلفة التجهيز يجب أن تكون موجبة')
  const paid = paidMinor ?? (payment === 'cash' ? costMinor : 0)
  if (!Number.isInteger(paid) || paid < 0 || paid > costMinor) throw new Error('المدفوع يجب أن يكون بين صفر وإجمالي التجهيز')
  const remaining = costMinor - paid
  const lines: JournalLine[] = [{ accountCode: '1103', debit: costMinor, credit: 0, note: `تجهيز ${label} (يرسمل على التكلفة)` }]
  if (paid > 0) lines.push({ accountCode: treasury, debit: 0, credit: paid, note: 'مدفوع نقداً/بنكياً' })
  if (remaining > 0) lines.push({ accountCode: '2101', debit: 0, credit: remaining, note: 'تجهيز مستحق لاحقاً' })
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
 * 1101 و/أو 1104 بالإجمالي ← 4101 + 2102، ثم 5101 التكلفة ← 1103 إخراج من المخزون.
 * يدعم البيع النقدي، الآجل، أو قبض جزء الآن والباقي على حساب العميل.
 */
export function buildCarSaleEntry(t: CarSaleTotals, payment: CarPaymentMode, label: string, treasury = '1101', paidMinor?: Minor): JournalLine[] {
  const paid = paidMinor ?? (payment === 'cash' ? t.totalMinor : 0)
  if (!Number.isInteger(paid) || paid < 0 || paid > t.totalMinor) throw new Error('المحصّل يجب أن يكون بين صفر وإجمالي البيع')
  const remainder = t.totalMinor - paid
  const lines: JournalLine[] = []
  if (paid > 0) lines.push({ accountCode: treasury, debit: paid, credit: 0, note: `تحصيل نقدي/بنكي ${label}` })
  if (remainder > 0) lines.push({ accountCode: '1104', debit: remainder, credit: 0, note: `المتبقي على العميل ${label}` })
  lines.push({ accountCode: '4101', debit: 0, credit: t.priceMinor, note: 'إيراد بيع سيارة' })
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


/* ─── البيع بالأمانة (Consignment) — سد فجوة معارض الوساطة ─── */

/**
 * سيارة أمانة: ليست ملك المعرض — لا تدخل المخزون ولا يُقيد شيء عند الاستلام.
 * المالك يحدد صافياً يستلمه؛ كل ما زاد عنه عمولة المعرض.
 * قيد البيع: خزينة|عملاء مدين بسعر البيع /
 *            2110 دائن بصافي المالك + 4109 دائن بالعمولة (+2102 ضريبة على العمولة إن وجدت)
 * قيد السداد للمالك: 2110 مدين / خزينة دائن
 */
export function buildConsignmentSaleEntry(
  salePriceMinor: Minor,
  ownerNetMinor: Minor,
  vatOnCommissionMinor: Minor,
  payment: 'cash' | 'credit',
  label: string,
  treasury = '1101',
): JournalLine[] {
  if (!Number.isInteger(salePriceMinor) || salePriceMinor <= 0) throw new Error('سعر البيع يجب أن يكون موجباً')
  if (!Number.isInteger(ownerNetMinor) || ownerNetMinor <= 0) throw new Error('صافي المالك يجب أن يكون موجباً')
  const commission = salePriceMinor - ownerNetMinor - vatOnCommissionMinor
  if (commission < 0) throw new Error('سعر البيع أقل من صافي المالك — لا تبع بخسارة على حساب المعرض دون تعديل الاتفاق')
  const lines: JournalLine[] = [
    { accountCode: payment === 'cash' ? treasury : '1104', debit: salePriceMinor, credit: 0, note: `بيع أمانة ${label}` },
    { accountCode: '2110', debit: 0, credit: ownerNetMinor, note: 'صافي مستحق للمالك' },
  ]
  if (commission > 0) lines.push({ accountCode: '4109', debit: 0, credit: commission, note: 'عمولة المعرض' })
  if (vatOnCommissionMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: vatOnCommissionMinor, note: 'ض.ق.م على العمولة' })
  assertBalanced(lines)
  return lines
}

export function buildConsignmentPayoutEntry(ownerNetMinor: Minor, label: string, treasury = '1101'): JournalLine[] {
  if (!Number.isInteger(ownerNetMinor) || ownerNetMinor <= 0) throw new Error('المستحق للمالك يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: '2110', debit: ownerNetMinor, credit: 0, note: `سداد مالك ${label}` },
    { accountCode: treasury, debit: 0, credit: ownerNetMinor, note: 'دفع نقدي للمالك' },
  ]
  assertBalanced(lines)
  return lines
}
