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
/**
 * التقييم المادي للمخزون الافتتاحي (بلاغ المالك v1.0.3→v1.0.4 — نمط QuickBooks/Odoo):
 * الأصل يسجَّل «كمية × تكلفة الوحدة» لا مبلغاً مجرداً — فتثبت الكمية الفعلية
 * (stockQty) والقيمة الدفترية (1103) معاً ولا يتباعدان أبداً.
 */
export interface OpeningItemDetail {
  qty: number // الكمية الافتتاحية (تقبل كسور الوزن حتى 3 خانات)
  unitCostMinor: number // تكلفة الوحدة الافتتاحية (Minor)
}

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


/* ─── توازن الميزانية الافتتاحية (نمط Xero/Odoo: يجب أن تتوازن) ─── */

export interface OpeningSummary {
  /** مجموع الأصول الافتتاحية (عملاء + خزائن + سلف + مخزون + حسابات عامة مدينة) */
  debitMinor: number
  /** مجموع الالتزامات الافتتاحية (موردون + حسابات عامة دائنة) */
  creditMinor: number
  /** رأس المال المحتسب = الأصول − الالتزامات = رصيد 3101 الدفتري حتماً (كل افتتاحي قُيّد مقابله) */
  capitalImpliedMinor: number
}

/**
 * تجميع الميزانية الافتتاحية من قيمها المخزونة (openingKey → amount).
 * طبيعة كل «حساب عام» تُمرر من الشجرة — الأصول والمصاريف مدينة، والالتزامات
 * وحقوق الملكية والإيرادات دائنة.
 */
export function summarizeOpeningBalances(
  openingBalances: Record<string, number>,
  natureByAccountCode: Record<string, 'debit' | 'credit'> = {},
): OpeningSummary {
  let debitMinor = 0
  let creditMinor = 0
  for (const [key, amount] of Object.entries(openingBalances ?? {})) {
    if (!Number.isFinite(amount)) continue
    const kind = key.split(':')[0]
    const refId = key.slice(kind.length + 1)
    if (kind === 'supplier') creditMinor += amount
    else if (kind === 'account') {
      if (natureByAccountCode[refId] === 'credit') creditMinor += amount
      else debitMinor += amount
    } else if (kind in OPENING_KIND_LABELS) debitMinor += amount
  }
  return { debitMinor, creditMinor, capitalImpliedMinor: debitMinor - creditMinor }
}

/**
 * قيد إعلان رأس المال (نمط QuickBooks «تصفير OBE» وOdoo «الأرباح المحتفظة»):
 * الفرق بين رأس المال المعلن ورصيد 3101 الدفتري يُرحَّل لأرباح مرحّلة 3102 —
 * متوازن دائماً: زائد ⇒ من 3102 إلى 3101 (جزء من رأس المال أرباح متراكمة)،
 * سالب ⇒ من 3101 إلى 3102. يعيد [] لو الفرق صفر.
 */
export function buildCapitalDeclarationEntry(declaredMinor: number, capitalBalanceMinor: number): JournalLine[] {
  const diff = declaredMinor - capitalBalanceMinor
  if (diff === 0) return []
  const amount = Math.abs(diff)
  if (diff > 0) {
    return [
      { accountCode: '3102', debit: amount, credit: 0, note: 'إعلان رأس المال — نقل من الأرباح المرحّلة' },
      { accountCode: '3101', debit: 0, credit: amount, note: 'استكمال رأس المال المعلن' },
    ]
  }
  return [
    { accountCode: '3101', debit: amount, credit: 0, note: 'جزء من رأس المال المعلن' },
    { accountCode: '3102', debit: 0, credit: amount, note: 'إعلان رأس المال — الفائض أرباح مرحّلة' },
  ]
}
