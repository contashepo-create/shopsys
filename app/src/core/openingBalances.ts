/**
 * الأرصدة الافتتاحية (جولة مراجعة الموبايلات — نمط mobileshop):
 * المتجر المنتقل للبرنامج يحمل أرصدة قائمة: ديون عملاء له، ديون موردين عليه،
 * نقدية بالخزائن والبنوك، سلف موظفين. كل رصيد يُثبت بقيد متوازن مقابل
 * رأس المال (3101) فيبقى مركز مالي متزن من اليوم الأول:
 *   عميل مدين لنا:   من ح/ 1104  إلى ح/ 3101
 *   مورد دائن لنا:   من ح/ 3101  إلى ح/ 2101
 *   خزينة/بنك:       من ح/ الخزينة إلى ح/ 3101
 *   سلفة موظف قائمة: من ح/ 1107  إلى ح/ 3101
 * التعديل اللاحق يرحّل قيد الفرق فقط (delta) — لا حذف ولا تعديل قيود قديمة.
 * نواة خالصة بلا واجهات — كل الأموال أعداد صحيحة (Minor).
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export type OpeningKind = 'customer' | 'supplier' | 'treasury' | 'employee_advance' | 'item_stock' | 'account'

export const OPENING_KIND_LABELS: Record<OpeningKind, string> = {
  customer: 'رصيد عميل افتتاحي (مدين لنا)',
  supplier: 'رصيد مورد افتتاحي (دائن لنا)',
  treasury: 'رصيد خزينة/بنك افتتاحي',
  employee_advance: 'سلفة موظف قائمة',
  item_stock: 'مخزون افتتاحي (بضاعة أول المدة)',
  account: 'رصيد حساب عام افتتاحي (بطبيعة الحساب)',
}

/**
 * الحسابات النظامية المغطاة بأنواع افتتاحية مخصصة (سجلات فرعية تُزامن):
 * العملاء/الموردون/السلف/المخزون/رأس المال/الخزائن والبنوك — لا يقبلها نوع
 * «حساب عام» حتى لا يظهر رصيدان متوازيان لنفس الطرف من مسارين مختلفين.
 */
export const OPENING_COVERED_SYSTEM_KEYS = new Set([
  'customers', 'suppliers', 'employee_advances', 'inventory', 'capital', 'main_cash', 'bank',
])

/** مفتاح فريد للرصيد: نوع + مُعرّف (رقم الطرف أو كود الخزينة) */
export function openingKey(kind: OpeningKind, refId: string | number): string {
  return `${kind}:${refId}`
}

/** تحقق: المبلغ عدد صحيح ≥ 0 (صفر = تصفير رصيد سابق) */
export function validateOpening(kind: OpeningKind, amountMinor: number): string[] {
  const errors: string[] = []
  if (!Number.isInteger(amountMinor) || amountMinor < 0) errors.push('الرصيد الافتتاحي لا يكون سالباً — الاتجاه يحدده النوع (عميل مدين / مورد دائن)')
  if (!(kind in OPENING_KIND_LABELS)) errors.push('نوع رصيد افتتاحي غير معروف')
  return errors
}

/**
 * قيد فرق الرصيد الافتتاحي: deltaMinor = الجديد − القديم (بإشارته).
 * موجب = زيادة الرصيد بنفس اتجاه النوع؛ سالب = تخفيضه (قيد معاكس).
 * يعيد [] لو الفرق صفر (لا قيد بلا أثر).
 */
export function buildOpeningDeltaEntry(
  kind: OpeningKind,
  deltaMinor: Minor,
  label: string,
  treasuryCode?: string,
  accountNatureKind?: 'debit' | 'credit',
): JournalLine[] {
  if (deltaMinor === 0) return []
  const amount = Math.abs(deltaMinor)
  const up = deltaMinor > 0 // زيادة الرصيد الافتتاحي
  let debitAcc: string, creditAcc: string
  switch (kind) {
    case 'customer': // زيادة = 1104 مدين / 3101 دائن
      debitAcc = up ? '1104' : '3101'
      creditAcc = up ? '3101' : '1104'
      break
    case 'supplier': // زيادة = 3101 مدين / 2101 دائن
      debitAcc = up ? '3101' : '2101'
      creditAcc = up ? '2101' : '3101'
      break
    case 'treasury': {
      if (!treasuryCode) throw new Error('حدد كود الخزينة/البنك')
      debitAcc = up ? treasuryCode : '3101'
      creditAcc = up ? '3101' : treasuryCode
      break
    }
    case 'employee_advance': // زيادة = 1107 مدين / 3101 دائن
      debitAcc = up ? '1107' : '3101'
      creditAcc = up ? '3101' : '1107'
      break
    case 'item_stock': // سد فجوة T2: بضاعة أول المدة — زيادة = 1103 مدين / 3101 دائن
      debitAcc = up ? '1103' : '3101'
      creditAcc = up ? '3101' : '1103'
      break
    case 'account': {
      // حساب عام: الاتجاه بطبيعة الحساب — طبيعة مدينة (أصول/مصاريف): زيادة = الحساب مدين
      // وطبيعة دائنة (التزامات/حقوق ملكية/إيرادات): زيادة = الحساب دائن (كالموردين).
      // المعامل الرابع يحمل كود الحساب هنا (انظر setOpeningBalance في repo.ts)
      const acc = treasuryCode ?? ''
      if (!acc) throw new Error('حدد كود الحساب')
      if (accountNatureKind === 'debit') {
        debitAcc = up ? acc : '3101'
        creditAcc = up ? '3101' : acc
      } else {
        debitAcc = up ? '3101' : acc
        creditAcc = up ? acc : '3101'
      }
      break
    }
  }
  const lines: JournalLine[] = [
    { accountCode: debitAcc, debit: amount, credit: 0, note: label },
    { accountCode: creditAcc, debit: 0, credit: amount, note: 'مقابل رأس المال — رصيد افتتاحي' },
  ]
  assertBalanced(lines)
  return lines
}
