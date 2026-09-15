/**
 * التسويات الشاملة (جولة مراجعة الموبايلات — نمط mobileshop settlements:apply):
 * جرد الواقع مقابل الدفاتر لغير المخزون (المخزون له شاشة الجرد FEFO الخاصة):
 *   - خزينة/بنك: عدّ النقدية الفعلي مقابل رصيد الحساب.
 *   - عميل: الرصيد المتفق عليه بعد مطابقة كشف الحساب معه.
 *   - مورد: الرصيد المتفق عليه بعد مطابقة كشفه.
 * درس mobileshop المقاس: عجز نقدية 5,000 «تبخّر» لأن الفرق عُدّل في الرصيد
 * دون قيد نتيجة — هنا كل فرق يضرب قائمة الدخل إجبارياً عبر 5112:
 *   عجز خزينة:  من ح/ 5112 إلى ح/ الخزينة   (مصروف)
 *   زيادة خزينة: من ح/ الخزينة إلى ح/ 5112   (تخفيض مصروف)
 *   تخفيض دين عميل (إعدام/خصم اتفاق): من ح/ 5112 إلى ح/ 1104
 *   زيادة دين مورد مكتشفة: من ح/ 5112 إلى ح/ 2101 — والعكس بالعكس.
 * الرصيد المعدود السالب مرفوض للأقسام القابلة للعدّ (خزينة) فقط —
 * أرصدة الأطراف قد تكون سالبة شرعاً (دفعة مقدمة).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type SettlementSection = 'treasury' | 'customer' | 'supplier'

export const SETTLEMENT_LABELS: Record<SettlementSection, string> = {
  treasury: 'تسوية خزينة/بنك',
  customer: 'تسوية رصيد عميل',
  supplier: 'تسوية رصيد مورد',
}

export interface SettlementInput {
  section: SettlementSection
  /** الرصيد الدفتري (Minor) — بإشارته الطبيعية للقسم */
  bookMinor: Minor
  /** الرصيد الفعلي المعدود/المتفق عليه (Minor) */
  actualMinor: Minor
  /** كود حساب الخزينة/البنك — مطلوب لقسم treasury فقط */
  treasuryCode?: string
  reason: string
}

/** الفرق = الفعلي − الدفتري (بإشارته) */
export function settlementVariance(input: SettlementInput): Minor {
  return input.actualMinor - input.bookMinor
}

export function validateSettlement(input: SettlementInput): string[] {
  const errors: string[] = []
  if (!Number.isInteger(input.actualMinor)) errors.push('الرصيد الفعلي يجب أن يكون رقماً صحيحاً')
  // القاعدة المقاسة من mobileshop: السالب مرفوض للقابل للعدّ فقط —
  // لا توجد نقدية سالبة في درج، لكن رصيد عميل سالب = دفعة مقدمة شرعية
  if (input.section === 'treasury') {
    if (input.actualMinor < 0) errors.push('النقدية المعدودة لا تكون سالبة — لا يوجد درج به نقود سالبة')
    if (!input.treasuryCode) errors.push('حدد الخزينة/البنك')
  }
  if (!input.reason.trim()) errors.push('سبب التسوية مطلوب — سيظهر في القيد وسجل المراجعة')
  return errors
}

/**
 * قيد التسوية: الفرق يضرب 5112 (فروق تسويات) إجبارياً — لا فرق بلا أثر
 * على قائمة الدخل. يعيد [] لو لا فرق.
 */
export function buildSettlementEntry(input: SettlementInput): JournalLine[] {
  const variance = settlementVariance(input)
  if (variance === 0) return []
  const amount = Math.abs(variance)
  const subjectAccount =
    input.section === 'treasury' ? input.treasuryCode! : input.section === 'customer' ? '1104' : '2101'

  let lines: JournalLine[]
  if (input.section === 'supplier') {
    // المورد دائن: الفعلي أكبر = دين إضافي علينا (مصروف)، أصغر = إعفاء (تخفيض مصروف)
    lines = variance > 0
      ? [
          { accountCode: '5112', debit: amount, credit: 0, note: `فرق تسوية مورد: ${input.reason}` },
          { accountCode: subjectAccount, debit: 0, credit: amount, note: 'زيادة رصيد المورد بالتسوية' },
        ]
      : [
          { accountCode: subjectAccount, debit: amount, credit: 0, note: 'تخفيض رصيد المورد بالتسوية' },
          { accountCode: '5112', debit: 0, credit: amount, note: `فرق تسوية مورد: ${input.reason}` },
        ]
  } else {
    // خزينة/عميل مدينان: الفعلي أكبر = زيادة أصل، أصغر = عجز/إعدام (مصروف)
    lines = variance > 0
      ? [
          { accountCode: subjectAccount, debit: amount, credit: 0, note: 'زيادة بالتسوية' },
          { accountCode: '5112', debit: 0, credit: amount, note: `فرق تسوية: ${input.reason}` },
        ]
      : [
          { accountCode: '5112', debit: amount, credit: 0, note: `فرق تسوية (عجز): ${input.reason}` },
          { accountCode: subjectAccount, debit: 0, credit: amount, note: 'تخفيض بالتسوية' },
        ]
  }
  assertBalanced(lines)
  return lines
}
