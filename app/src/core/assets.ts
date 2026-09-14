/**
 * الأصول الثابتة والإهلاك (من مواصفة Easy Store المرجعية):
 * شراء أصل: من ح/ 1201 أصول ومعدات ← إلى ح/ 1101 خزينة (و/أو 2101 آجل).
 * إهلاك شهري بالقسط الثابت: من ح/ 5107 إهلاك ← إلى ح/ 1202 مجمع الإهلاك.
 * القيمة الدفترية = التكلفة − مجمع الإهلاك، ولا تهبط تحت الخردة.
 * نواة خالصة — الأموال أعداد صحيحة (Minor) وتوزيع «آخر شهر يلتقط الباقي»
 * كي لا يضيع مليم على مدى العمر الإنتاجي.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export interface AssetInput {
  nameAr: string
  costMinor: Minor // تكلفة الاقتناء
  salvageMinor: Minor // قيمة الخردة (قد تكون 0)
  lifeMonths: number // العمر الإنتاجي بالأشهر
  paidMinor: Minor // المدفوع نقداً الآن (الباقي آجل على مورد)
}

const isPosInt = (n: number) => Number.isInteger(n) && n >= 0

/** تحقق شامل — يعيد قائمة أخطاء عربية (فارغة = سليم) */
export function validateAsset(input: AssetInput): string[] {
  const errors: string[] = []
  if (!input.nameAr.trim()) errors.push('حدد اسم الأصل')
  if (!isPosInt(input.costMinor) || input.costMinor <= 0) errors.push('التكلفة يجب أن تكون موجبة')
  if (!isPosInt(input.salvageMinor)) errors.push('قيمة الخردة لا تكون سالبة')
  if (input.salvageMinor >= input.costMinor) errors.push('قيمة الخردة يجب أن تقل عن التكلفة')
  if (!Number.isInteger(input.lifeMonths) || input.lifeMonths < 1 || input.lifeMonths > 600) errors.push('العمر الإنتاجي بين شهر و600 شهر')
  if (!isPosInt(input.paidMinor)) errors.push('المدفوع لا يكون سالباً')
  if (input.paidMinor > input.costMinor) errors.push('المدفوع لا يتجاوز التكلفة')
  return errors
}

/**
 * قيد اقتناء الأصل:
 *   من ح/ 1201 أصول ومعدات (cost)
 *     إلى ح/ 1101 الخزينة (paid)
 *     إلى ح/ 2101 الموردون (cost − paid)
 */
export function buildAssetPurchaseEntry(costMinor: Minor, paidMinor: Minor, label: string, treasury = '1101'): JournalLine[] {
  if (costMinor <= 0) throw new Error('تكلفة الأصل يجب أن تكون موجبة')
  if (paidMinor > costMinor) throw new Error('المدفوع لا يتجاوز التكلفة')
  const lines: JournalLine[] = [{ accountCode: '1201', debit: costMinor, credit: 0, note: `اقتناء ${label}` }]
  if (paidMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: paidMinor, note: 'مدفوع نقداً' })
  if (costMinor - paidMinor > 0) lines.push({ accountCode: '2101', debit: 0, credit: costMinor - paidMinor, note: 'آجل على المورد' })
  assertBalanced(lines)
  return lines
}

/**
 * جدول الإهلاك بالقسط الثابت: (التكلفة − الخردة) ÷ الأشهر،
 * بتوزيع لا يضيع مليماً — الشهر الأخير يلتقط الباقي.
 */
export function depreciationSchedule(costMinor: Minor, salvageMinor: Minor, lifeMonths: number): Minor[] {
  const base = costMinor - salvageMinor
  if (base <= 0 || lifeMonths < 1) return []
  const per = Math.floor(base / lifeMonths)
  const schedule = Array.from({ length: lifeMonths }, () => per)
  schedule[lifeMonths - 1] = base - per * (lifeMonths - 1)
  return schedule
}

/** قسط شهر محدد (0-مفهرس) — 0 بعد انتهاء العمر */
export function monthlyDepreciation(costMinor: Minor, salvageMinor: Minor, lifeMonths: number, monthIndex: number): Minor {
  const schedule = depreciationSchedule(costMinor, salvageMinor, lifeMonths)
  return monthIndex >= 0 && monthIndex < schedule.length ? schedule[monthIndex] : 0
}

/**
 * قيد الإهلاك الشهري (يُجمَّع لكل الأصول في قيد واحد):
 *   من ح/ 5107 إهلاك ← إلى ح/ 1202 مجمع الإهلاك
 */
export function buildDepreciationEntry(totalMinor: Minor, monthLabel: string): JournalLine[] {
  if (totalMinor <= 0) throw new Error('لا إهلاك مستحقاً لهذا الشهر')
  const lines: JournalLine[] = [
    { accountCode: '5107', debit: totalMinor, credit: 0, note: `إهلاك شهر ${monthLabel}` },
    { accountCode: '1202', debit: 0, credit: totalMinor, note: 'مجمع الإهلاك' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── تقرير الأصول ─── */

export interface AssetReportRow {
  assetId: number
  nameAr: string
  costMinor: Minor
  accumulatedMinor: Minor // مجمع إهلاك هذا الأصل
  bookValueMinor: Minor // التكلفة − المجمع
  monthsDepreciated: number
  lifeMonths: number
  fullyDepreciated: boolean
}

export function assetsReport(
  assets: {
    id: number
    nameAr: string
    costMinor: Minor
    salvageMinor: Minor
    lifeMonths: number
    monthsDepreciated: number
  }[],
): { rows: AssetReportRow[]; totalCostMinor: Minor; totalAccumulatedMinor: Minor; totalBookMinor: Minor } {
  const rows: AssetReportRow[] = assets.map((a) => {
    const schedule = depreciationSchedule(a.costMinor, a.salvageMinor, a.lifeMonths)
    const accumulated = schedule.slice(0, a.monthsDepreciated).reduce((x, y) => x + y, 0)
    return {
      assetId: a.id,
      nameAr: a.nameAr,
      costMinor: a.costMinor,
      accumulatedMinor: accumulated,
      bookValueMinor: a.costMinor - accumulated,
      monthsDepreciated: a.monthsDepreciated,
      lifeMonths: a.lifeMonths,
      fullyDepreciated: a.monthsDepreciated >= a.lifeMonths,
    }
  })
  return {
    rows,
    totalCostMinor: rows.reduce((x, r) => x + r.costMinor, 0),
    totalAccumulatedMinor: rows.reduce((x, r) => x + r.accumulatedMinor, 0),
    totalBookMinor: rows.reduce((x, r) => x + r.bookValueMinor, 0),
  }
}

/** الشهر التالي YYYY-MM بعد آخر إهلاك (أو شهر الشراء إن لم يُهلك بعد) */
export function nextDepreciationMonth(purchaseMonth: string, monthsDepreciated: number): string {
  const [y, m] = purchaseMonth.split('-').map(Number)
  const total = (y ?? 0) * 12 + (m ?? 1) - 1 + monthsDepreciated
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`
}
