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

/**
 * مصدر تمويل الأصل (طلب المالك — سد فجوة المعالجة المحاسبية):
 * cash: مدفوع من خزينة/بنك (كلياً أو جزئياً والباقي على مورد محدد)
 * supplier_credit: آجل بالكامل على مورد مسجَّل (يُقسَّط ويُسدد بسندات صرف)
 * capital: مقدَّم من المالك بلا دفع من خزائن المنشأة → رأس المال 3101
 * partner: مقدَّم من شريك → جاري الشريك 3103 (التزام داخلي يُسوَّى لاحقاً)
 */
export type AssetFunding = 'cash' | 'supplier_credit' | 'capital' | 'partner'

export const ASSET_FUNDING_LABELS: Record<AssetFunding, string> = {
  cash: 'دفع من خزينة/بنك (والباقي آجل على مورد)',
  supplier_credit: 'آجل بالكامل على مورد (يُقسَّط)',
  capital: 'مقدَّم من المالك — يُثبت في رأس المال (بلا دفع)',
  partner: 'مقدَّم من شريك — جاري الشريك (بلا دفع)',
}

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
 * قيد اقتناء الأصل حسب مصدر التمويل (طلب المالك):
 *   cash:            1201 / خزينة (+ 2101 للباقي)
 *   supplier_credit: 1201 / 2101 بالكامل
 *   capital:         1201 / 3101 رأس المال (المالك قدّم الأصل عيناً أو دفع من جيبه)
 *   partner:         1201 / 3103 جاري الشريك
 */
export function buildAssetPurchaseEntry(
  costMinor: Minor,
  paidMinor: Minor,
  label: string,
  treasury = '1101',
  funding: AssetFunding = 'cash',
): JournalLine[] {
  if (costMinor <= 0) throw new Error('تكلفة الأصل يجب أن تكون موجبة')
  if (paidMinor > costMinor) throw new Error('المدفوع لا يتجاوز التكلفة')
  const lines: JournalLine[] = [{ accountCode: '1201', debit: costMinor, credit: 0, note: `اقتناء ${label}` }]
  if (funding === 'capital') {
    lines.push({ accountCode: '3101', debit: 0, credit: costMinor, note: 'أصل مقدَّم من المالك — زيادة رأس المال' })
  } else if (funding === 'partner') {
    lines.push({ accountCode: '3103', debit: 0, credit: costMinor, note: 'أصل مقدَّم من شريك — جاري الشريك' })
  } else if (funding === 'supplier_credit') {
    lines.push({ accountCode: '2101', debit: 0, credit: costMinor, note: 'آجل بالكامل على المورد' })
  } else {
    if (paidMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: paidMinor, note: 'مدفوع نقداً' })
    if (costMinor - paidMinor > 0) lines.push({ accountCode: '2101', debit: 0, credit: costMinor - paidMinor, note: 'آجل على المورد' })
  }
  assertBalanced(lines)
  return lines
}

/**
 * جدول أقساط شراء الأصل (شراء آجل مقسَّط — طلب المالك):
 * الباقي بعد الدفعة الأولى يوزَّع بالتساوي وأول قسط يلتقط الباقي — لا يضيع مليم.
 */
export interface AssetInstallment {
  seq: number // 1..n
  dueDate: string // YYYY-MM-DD
  amountMinor: Minor
  paidMinor: Minor
  paidAt: string | null
}

export function buildAssetInstallments(
  remainingMinor: Minor,
  count: number,
  intervalMonths: number,
  firstDueDate: string,
): AssetInstallment[] {
  if (remainingMinor <= 0) return []
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error('عدد الأقساط بين 1 و120')
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1) throw new Error('الفاصل الشهري يبدأ من شهر')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new Error('تاريخ أول قسط بصيغة YYYY-MM-DD')
  const per = Math.floor(remainingMinor / count)
  const first = remainingMinor - per * (count - 1)
  const base = new Date(firstDueDate + 'T00:00:00Z')
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base)
    d.setUTCMonth(d.getUTCMonth() + i * intervalMonths)
    return { seq: i + 1, dueDate: d.toISOString().slice(0, 10), amountMinor: i === 0 ? first : per, paidMinor: 0, paidAt: null }
  })
}

/** قيد سداد قسط/دفعة أصل: 2101 مدين / خزينة دائن */
export function buildAssetPaymentEntry(amountMinor: Minor, label: string, treasury = '1101'): JournalLine[] {
  if (amountMinor <= 0) throw new Error('مبلغ السداد يجب أن يكون موجباً')
  const lines: JournalLine[] = [
    { accountCode: '2101', debit: amountMinor, credit: 0, note: `سداد ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'صرف نقدي' },
  ]
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
