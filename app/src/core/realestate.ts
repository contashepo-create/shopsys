/**
 * نواة نشاط العقارات — إيجار وبيع وإدارة أملاك (خصوصاً السوق السعودي).
 * المعايير مستخلصة من مقارنة برامج العقارات السعودية (سند، الوسيط، سمات):
 * - عقار بوحدات؛ الملكية «خاصة» (الإيراد كله للمكتب) أو «إدارة أملاك الغير»
 *   (التحصيل للمالك 2115 والمكتب يكسب «السعي» نسبةً 4114).
 * - عقد إيجار بجدول أقساط تلقائي (شهري/ربع/نصف/سنوي) + تأمين مسترد (2103)
 *   + رقم توثيق منصة إيجار الحكومية.
 * - بيع عقار مملوك: إيراد 4115 وتكلفة 5116 وإخراج من أصل العقارات 1113.
 * كل الدوال نقية، والمبالغ integer minors، وكل قيد يمر على assertBalanced.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

/* ─── العقار والوحدات ─── */

/** نمط الملكية: خاص بالمكتب أم إدارة أملاك للغير (سعي) — معيار «الوسيط» */
export type PropertyOwnership = 'owned' | 'managed'

export type PropertyKind = 'residential' | 'commercial' | 'mixed' | 'land'

export const PROPERTY_KIND_LABELS: Record<PropertyKind, { nameAr: string; icon: string }> = {
  residential: { nameAr: 'سكني', icon: '🏢' },
  commercial: { nameAr: 'تجاري', icon: '🏬' },
  mixed: { nameAr: 'مختلط', icon: '🏙️' },
  land: { nameAr: 'أرض', icon: '🗺️' },
}

export interface Property {
  id: number
  code: string // RE-0001
  nameAr: string
  kind: PropertyKind
  ownership: PropertyOwnership
  /** اسم المالك (عند إدارة أملاك الغير) — الملكية الخاصة: فارغ */
  ownerName: string
  /** نسبة السعي (عمولة المكتب) من كل تحصيلة عند إدارة أملاك الغير 0–100 */
  commissionPercent: number
  address: string
  /** تكلفة الاقتناء للعقار المملوك (أساس ربح البيع) — 0 للمدار */
  costMinor: Minor
  /** بيع العقار يقفل سجله */
  status: 'active' | 'sold'
  notes: string
}

export type UnitStatus = 'vacant' | 'leased' | 'maintenance'

export interface PropertyUnit {
  id: number
  propertyId: number
  code: string // شقة 3 — الدور الأول
  /** الأجرة السنوية الاسترشادية للوحدة */
  annualRentMinor: Minor
  status: UnitStatus
}

export function validateProperty(p: Pick<Property, 'nameAr' | 'ownership' | 'ownerName' | 'commissionPercent' | 'costMinor'>): string[] {
  const errors: string[] = []
  if (!p.nameAr.trim()) errors.push('اسم العقار مطلوب')
  if (p.ownership === 'managed' && !p.ownerName.trim()) errors.push('اسم المالك مطلوب عند إدارة أملاك الغير')
  if (p.ownership === 'managed' && (p.commissionPercent <= 0 || p.commissionPercent > 100)) errors.push('نسبة السعي بين أكبر من 0 و100٪')
  if (p.ownership === 'owned' && p.commissionPercent !== 0) errors.push('لا سعي على عقار مملوك — الإيراد كله للمكتب')
  if (!Number.isInteger(p.costMinor) || p.costMinor < 0) errors.push('تكلفة الاقتناء لا تكون سالبة')
  if (p.ownership === 'managed' && p.costMinor !== 0) errors.push('العقار المدار ليس أصلاً لديك — التكلفة صفر')
  return errors
}

/* ─── عقد الإيجار وجدول الأقساط ─── */

export type RentFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export const RENT_FREQUENCY_LABELS: Record<RentFrequency, { nameAr: string; months: number }> = {
  monthly: { nameAr: 'شهري', months: 1 },
  quarterly: { nameAr: 'ربع سنوي', months: 3 },
  semiannual: { nameAr: 'نصف سنوي', months: 6 },
  annual: { nameAr: 'سنوي', months: 12 },
}

export type LeaseStatus = 'active' | 'ended' | 'evicted'

export interface LeaseInstallment {
  seq: number
  dueDate: string // ISO
  amountMinor: Minor
  paidMinor: Minor
  paidAt: string | null
}

export interface Lease {
  id: number
  contractNumber: string // LC-0001
  propertyId: number
  unitId: number
  tenantName: string
  /** ربط إداري بسجل عميل */
  tenantId: number | null
  startDate: string
  months: number // مدة العقد بالأشهر
  frequency: RentFrequency
  /** إجمالي أجرة كامل المدة */
  totalRentMinor: Minor
  /** التأمين المسترد المقبوض (التزام 2103) */
  depositMinor: Minor
  /** رقم توثيق العقد في منصة إيجار الحكومية (السعودية) — اختياري */
  ejarNumber: string
  installments: LeaseInstallment[]
  status: LeaseStatus
  /** رُدَّ التأمين عند الإنهاء؟ */
  depositRefundedMinor: Minor
}

/** توليد جدول أقساط متساوٍ بفارق الأشهر حسب الدورية — الباقي من القسمة يُحمَّل على القسط الأخير */
export function generateLeaseSchedule(startDate: string, months: number, frequency: RentFrequency, totalRentMinor: Minor): LeaseInstallment[] {
  if (!startDate) throw new Error('تاريخ بداية العقد مطلوب')
  if (!Number.isInteger(months) || months <= 0 || months > 600) throw new Error('مدة العقد بالأشهر بين 1 و600')
  if (!Number.isInteger(totalRentMinor) || totalRentMinor <= 0) throw new Error('إجمالي الأجرة يجب أن يكون موجباً')
  const step = RENT_FREQUENCY_LABELS[frequency].months
  if (months % step !== 0) throw new Error(`مدة العقد (${months} شهراً) لا تقبل القسمة على الدورية (${step} أشهر)`)
  const count = months / step
  const base = Math.floor(totalRentMinor / count)
  const schedule: LeaseInstallment[] = []
  const d0 = new Date(startDate + 'T00:00:00Z')
  if (Number.isNaN(d0.getTime())) throw new Error('تاريخ بداية العقد غير صالح')
  let allocated = 0
  for (let i = 0; i < count; i++) {
    const due = new Date(d0)
    due.setUTCMonth(due.getUTCMonth() + i * step)
    const amount = i === count - 1 ? totalRentMinor - allocated : base
    allocated += amount
    schedule.push({ seq: i + 1, dueDate: due.toISOString().slice(0, 10), amountMinor: amount, paidMinor: 0, paidAt: null })
  }
  return schedule
}

export function validateLease(l: Pick<Lease, 'tenantName' | 'totalRentMinor' | 'depositMinor'>): string[] {
  const errors: string[] = []
  if (!l.tenantName.trim()) errors.push('اسم المستأجر مطلوب')
  if (!Number.isInteger(l.totalRentMinor) || l.totalRentMinor <= 0) errors.push('إجمالي الأجرة يجب أن يكون موجباً')
  if (!Number.isInteger(l.depositMinor) || l.depositMinor < 0) errors.push('التأمين لا يكون سالباً')
  return errors
}

/* ─── القيود ─── */

/**
 * قيد قبض التأمين المسترد عند توقيع العقد: نقدية مدين ← 2103 دائن.
 * التزام لا إيراد — يُرد عند الإخلاء السليم.
 */
export function buildDepositReceiptEntry(depositMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(depositMinor) || depositMinor <= 0) throw new Error('قيمة التأمين يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: depositMinor, credit: 0, note: `تأمين مسترد ${label}` },
    { accountCode: '2103', debit: 0, credit: depositMinor, note: 'التزام تأمين مسترد' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد تحصيل قسط إيجار:
 * - عقار مملوك: نقدية ← 4113 إيراد إيجار عقارات (+2102 ض.ق.م إن وجدت).
 * - إدارة أملاك الغير («الوسيط»): نقدية ← 2115 نصيب المالك + 4114 سعي المكتب
 *   (السعي يُحسب من الأصل قبل الضريبة، والضريبة على السعي فقط إن فُعلت —
 *    أجرة السكني معفاة من ض.ق.م في السعودية والعمولة خاضعة).
 */
export function buildRentCollectionEntry(args: {
  amountMinor: Minor
  ownership: PropertyOwnership
  commissionPercent: number
  vatOnCommissionMinor: Minor
  vatOnRentMinor: Minor
  treasury: string
  label: string
}): { lines: JournalLine[]; commissionMinor: Minor; ownerShareMinor: Minor } {
  const { amountMinor, ownership, commissionPercent, vatOnCommissionMinor, vatOnRentMinor, treasury, label } = args
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة التحصيل يجب أن تكون موجبة')
  if (!Number.isInteger(vatOnCommissionMinor) || vatOnCommissionMinor < 0) throw new Error('ضريبة السعي غير صحيحة')
  if (!Number.isInteger(vatOnRentMinor) || vatOnRentMinor < 0) throw new Error('ضريبة الأجرة غير صحيحة')
  const lines: JournalLine[] = []
  if (ownership === 'owned') {
    const received = amountMinor + vatOnRentMinor
    lines.push({ accountCode: treasury, debit: received, credit: 0, note: `تحصيل إيجار ${label}` })
    lines.push({ accountCode: '4113', debit: 0, credit: amountMinor, note: 'إيراد إيجار عقارات' })
    if (vatOnRentMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: vatOnRentMinor, note: 'ض.ق.م على الأجرة' })
    assertBalanced(lines)
    return { lines, commissionMinor: 0, ownerShareMinor: 0 }
  }
  // إدارة أملاك الغير: سعي بنسبة من الأصل + الباقي للمالك
  const commission = Math.round(amountMinor * commissionPercent / 100)
  const ownerShare = amountMinor - commission
  const received = amountMinor + vatOnCommissionMinor
  lines.push({ accountCode: treasury, debit: received, credit: 0, note: `تحصيل إيجار ${label}` })
  if (ownerShare > 0) lines.push({ accountCode: '2115', debit: 0, credit: ownerShare, note: 'نصيب مالك العقار' })
  if (commission > 0) lines.push({ accountCode: '4114', debit: 0, credit: commission, note: 'سعي (عمولة إدارة أملاك)' })
  if (vatOnCommissionMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: vatOnCommissionMinor, note: 'ض.ق.م على السعي' })
  assertBalanced(lines)
  return { lines, commissionMinor: commission, ownerShareMinor: ownerShare }
}

/** قيد سداد نصيب المالك المتجمع: 2115 مدين ← نقدية دائن */
export function buildOwnerPayoutEntry(amountMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة السداد يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '2115', debit: amountMinor, credit: 0, note: `سداد لمالك ${label}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'المنصرف' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد رد التأمين عند الإخلاء: 2103 مدين ← نقدية (المردود) + خصومات أضرار إيراداً (4110).
 * الخصم لا يتجاوز التأمين المقبوض.
 */
export function buildDepositRefundEntry(depositMinor: Minor, deductionMinor: Minor, treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(depositMinor) || depositMinor <= 0) throw new Error('لا تأمين لرده')
  if (!Number.isInteger(deductionMinor) || deductionMinor < 0) throw new Error('الخصم لا يكون سالباً')
  if (deductionMinor > depositMinor) throw new Error('الخصم لا يتجاوز التأمين المقبوض')
  const refund = depositMinor - deductionMinor
  const lines: JournalLine[] = [{ accountCode: '2103', debit: depositMinor, credit: 0, note: `تسوية تأمين ${label}` }]
  if (refund > 0) lines.push({ accountCode: treasury, debit: 0, credit: refund, note: 'المردود للمستأجر' })
  if (deductionMinor > 0) lines.push({ accountCode: '4110', debit: 0, credit: deductionMinor, note: 'خصم أضرار من التأمين' })
  assertBalanced(lines)
  return lines
}

/**
 * قيد بيع عقار مملوك (طريقة الإجمالي):
 *   نقدية/عميل مدين بسعر البيع ← 4115 إيراد بيع عقارات
 *   5116 تكلفة عقارات مباعة مدين ← 1113 العقارات (إخراج الأصل بتكلفته)
 */
export function buildPropertySaleEntry(args: { salePriceMinor: Minor; costMinor: Minor; payment: 'cash' | 'credit'; treasury: string; vatMinor: Minor; label: string }): JournalLine[] {
  const { salePriceMinor, costMinor, payment, treasury, vatMinor, label } = args
  if (!Number.isInteger(salePriceMinor) || salePriceMinor <= 0) throw new Error('سعر البيع يجب أن يكون موجباً')
  if (!Number.isInteger(costMinor) || costMinor < 0) throw new Error('التكلفة لا تكون سالبة')
  if (!Number.isInteger(vatMinor) || vatMinor < 0) throw new Error('الضريبة غير صحيحة')
  const debitAccount = payment === 'cash' ? treasury : '1104'
  const lines: JournalLine[] = [
    { accountCode: debitAccount, debit: salePriceMinor + vatMinor, credit: 0, note: `بيع عقار ${label}` },
    { accountCode: '4115', debit: 0, credit: salePriceMinor, note: 'إيراد بيع عقارات' },
  ]
  if (vatMinor > 0) lines.push({ accountCode: '2102', debit: 0, credit: vatMinor, note: 'ض.ق.م' })
  if (costMinor > 0) {
    lines.push({ accountCode: '5116', debit: costMinor, credit: 0, note: 'تكلفة العقار المباع' })
    lines.push({ accountCode: '1113', debit: 0, credit: costMinor, note: 'إخراج العقار من الأصول' })
  }
  assertBalanced(lines)
  return lines
}

/** قيد اقتناء عقار بغرض الاستثمار/البيع: 1113 مدين ← نقدية/مورد دائن */
export function buildPropertyAcquisitionEntry(costMinor: Minor, payment: 'cash' | 'credit', treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(costMinor) || costMinor <= 0) throw new Error('تكلفة الاقتناء يجب أن تكون موجبة')
  const creditAccount = payment === 'cash' ? treasury : '2101'
  const lines: JournalLine[] = [
    { accountCode: '1113', debit: costMinor, credit: 0, note: `اقتناء عقار ${label}` },
    { accountCode: creditAccount, debit: 0, credit: costMinor, note: payment === 'cash' ? 'المنصرف' : 'مستحق للبائع' },
  ]
  assertBalanced(lines)
  return lines
}

/**
 * قيد صيانة وحدة: مصروف على المكتب (5108) أو خصماً من مستحق المالك (2115) عند إدارة الأملاك —
 * معيار «الوسيط»: صيانة العقار المدار على مالكه ما لم يتحملها المكتب.
 */
export function buildUnitMaintenanceEntry(amountMinor: Minor, bearer: 'office' | 'owner', treasury: string, label: string): JournalLine[] {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error('قيمة الصيانة يجب أن تكون موجبة')
  const debitAccount = bearer === 'office' ? '5108' : '2115'
  const lines: JournalLine[] = [
    { accountCode: debitAccount, debit: amountMinor, credit: 0, note: `صيانة ${label}${bearer === 'owner' ? ' (على المالك)' : ''}` },
    { accountCode: treasury, debit: 0, credit: amountMinor, note: 'المنصرف' },
  ]
  assertBalanced(lines)
  return lines
}

/* ─── تنبيهات العقود (نمط «سمات»: عقود منتهية وأقساط متأخرة) ─── */

export interface LeaseAlert {
  leaseId: number
  contractNumber: string
  tenantName: string
  kind: 'expiring' | 'overdue'
  /** أيام للانتهاء (موجبة) أو أيام التأخير (موجبة) */
  days: number
  amountMinor: Minor // المتأخر للقسط، أو 0 للانتهاء
}

/** نهاية العقد = بداية + مدة بالأشهر */
export function leaseEndDate(startDate: string, months: number): string {
  const d = new Date(startDate + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function collectLeaseAlerts(leases: readonly Lease[], todayIso: string, expiryWindowDays = 60): LeaseAlert[] {
  const alerts: LeaseAlert[] = []
  const today = new Date(todayIso + 'T00:00:00Z').getTime()
  const DAY = 86_400_000
  for (const l of leases) {
    if (l.status !== 'active') continue
    const end = new Date(leaseEndDate(l.startDate, l.months) + 'T00:00:00Z').getTime()
    const daysToEnd = Math.ceil((end - today) / DAY)
    if (daysToEnd <= expiryWindowDays) {
      alerts.push({ leaseId: l.id, contractNumber: l.contractNumber, tenantName: l.tenantName, kind: 'expiring', days: daysToEnd, amountMinor: 0 })
    }
    for (const inst of l.installments) {
      const remaining = inst.amountMinor - inst.paidMinor
      if (remaining <= 0) continue
      const due = new Date(inst.dueDate + 'T00:00:00Z').getTime()
      if (due < today) {
        alerts.push({ leaseId: l.id, contractNumber: l.contractNumber, tenantName: l.tenantName, kind: 'overdue', days: Math.floor((today - due) / DAY), amountMinor: remaining })
      }
    }
  }
  return alerts.sort((a, b) => (a.kind === b.kind ? b.days - a.days : a.kind === 'overdue' ? -1 : 1))
}
