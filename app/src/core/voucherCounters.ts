/**
 * كتالوج الحسابات المقابلة في سندات القبض والصرف — مصدر واحد للحقيقة.
 * ─────────────────────────────────────────────────────────────────────
 * لماذا ملف مستقل؟ لأن الشاشة (`ui/pages/VouchersPage.tsx`) والبوابات
 * ووثيقة العقد يجب أن تقرأ **نفس** القائمة: أي بند يُضاف هنا يظهر فوراً
 * في الشاشة ويخضع تلقائياً لبوابة `verify_voucher_counters.mjs`.
 *
 * قاعدتان حاكمتان:
 *  ① بند بوحدة (`when`) لا يظهر إلا لمن فعّل واحدة من وحداته — فالقسم
 *    المطعَّم يفتح بنوده، والنشاط الذي لا يملكها لا يرى حساب غيره.
 *  ② بند بمرئية حساب (`ACCOUNT_MODULE_MAP`) لا يظهر لحساب غير مكشوف في
 *    شجرته — فلا سند يُرحَّل على حساب مخفي (نفس قاعدة الشجرة والقيود).
 */
import type { BusinessModule } from './activities.ts'
import type { CustomAccount } from './customAccounts.ts'
import { ACCOUNT_MODULE_MAP } from './coaVisibility.ts'

/** كود خاص: مصروف على فاتورة شراء — يوزَّع على أصنافها ويرفع تكلفتها (طلب المالك) */
export const PURCHASE_EXPENSE_CODE = '__purchase_expense__'

export interface VoucherCounter {
  code: string
  label: string
  /** وحدة تُشغّل هذا البند (تكفي واحدة مفعّلة) — البنود الأساسية بلا وحدة */
  when?: readonly BusinessModule[]
}

/** الوحدات التي تُحتفظ بأموال العملاء (عربون/تأمين) فيمرّ قبضها على 2109/2103 */
const DEPOSIT_MODULES = ['maintenance', 'laundry', 'equipment_rental', 'cars', 'realestate', 'contracting'] as const
/** الوحدات التي تُقبض منها تأمينات من العملاء (2110 للسيارات/2103 للإيجار) */
const RENTAL_DEPOSIT_MODULES = ['equipment_rental', 'realestate', 'cars'] as const

/** القبض: الخزينة مدين، والبند دائن (تخفيض ذمة، أو إيراد، أو التزام/رأس مال) */
export const RECEIPT_COUNTERS: readonly VoucherCounter[] = [
  { code: '1104', label: 'سداد من عميل (تخفيض مديونيته)' },
  { code: '4103', label: 'إيراد خدمات' },
  { code: '3101', label: 'زيادة رأس المال' },
  { code: '4101', label: 'إيراد مبيعات (بدون فاتورة)' },
  { code: '1107', label: 'سداد سلفة/استرداد من موظف (تخفيض سلفته)' },
  /* بندو الأقسام — تظهر بمنح الوحدة (مرتبة تصاعدياً بالكود) */
  { code: '1105', label: 'تحصيل محتجزات ضمان أعمال من العميل', when: ['contracting'] },
  { code: '1110', label: 'تحصيل من جهة تأمين أو تعاقد', when: ['lab', 'clinic'] },
  { code: '2103', label: 'تأمين مسترد من مستأجر/عميل', when: RENTAL_DEPOSIT_MODULES },
  { code: '2109', label: 'دفعة مقدمة أو عربون من عميل (التزام)', when: DEPOSIT_MODULES },
  { code: '2110', label: 'تحصيل أمانة لصالح مالك السيارة', when: ['cars'] },
]

/** الصرف: الخزينة دائن، والبند مدين (سداد التزام، أو مصروف) */
export const PAYMENT_COUNTERS: readonly VoucherCounter[] = [
  { code: '2101', label: 'سداد لمورد (تخفيض ديننا له)' },
  { code: PURCHASE_EXPENSE_CODE, label: 'مصروف على فاتورة شراء (نولون/جمارك… يرفع تكلفة أصنافها)' },
  { code: '5103', label: 'إيجار المحل' },
  { code: '5104', label: 'كهرباء ومياه' },
  // سداد مسير مرحّل «استحقاقاً» يصفّي 2104 — أما 5102 فلأجور يومية عارضة لم تدخل مسيراً
  { code: '2104', label: 'سداد رواتب مستحقة (مسير استحقاق سابق)' },
  { code: '2117', label: 'سداد مصروفات تصنيع مستحقة (تعبئة/تشغيل…)' },
  { code: '5102', label: 'أجور يومية عارضة جديدة (غير مثبتة سابقاً)' },
  { code: '5108', label: 'مصروفات عمومية' },
  { code: '3101', label: 'مسحوبات شخصية (تخفيض رأس المال)' },
  { code: '1107', label: 'صرف سلفة لموظف (زيادة سلفته)' },
  /* بندو الأقسام — تظهر بمنح الوحدة (مرتبة تصاعدياً بالكود) */
  { code: '2103', label: 'رد تأمين مستأجر/عميل عند الانتهاء', when: RENTAL_DEPOSIT_MODULES },
  { code: '2108', label: 'إفراج محتجزات مقاولي الباطن', when: ['contracting'] },
  { code: '2109', label: 'تصفية/استرداد دفعة مقدمة من عميل', when: ['contracting', 'maintenance', 'laundry'] },
  { code: '2110', label: 'سداد لملاك سيارات الأمانة', when: ['cars'] },
  { code: '2111', label: 'سداد مستحقات سائقين (رواتب/عمولات)', when: ['logistics'] },
  { code: '2112', label: 'سداد ضريبة استقطاع مقاولي الباطن', when: ['contracting'] },
  { code: '2113', label: 'سداد مصروفات نقلات مستحقة (كروت/محطات)', when: ['logistics'] },
  { code: '2115', label: 'سداد مستحق لملاك العقارات المدارة', when: ['realestate'] },
  { code: '5105', label: 'مصروفات تشغيل معدات مستحقة', when: ['equipment_rental', 'cars'] },
  { code: '5106', label: 'مصروفات نقلات (سولار/طرق)', when: ['logistics'] },
  { code: '5109', label: 'عمولات أطباء محيلين', when: ['lab'] },
]

/** بندو الأقسام وحدها (بلا الأساسية) — تُستخدم للفحص والعرض التوضيحي */
export const moduleCounters = (kind: 'receipt' | 'payment'): readonly VoucherCounter[] =>
  (kind === 'receipt' ? RECEIPT_COUNTERS : PAYMENT_COUNTERS).filter((c) => Boolean(c.when))

/** هل الحساب مكشوف في شجرة الوحدات المفعّلة؟ (نفس منطق الشجرة والقيود) */
export function counterAccountAllowed(code: string, modules: readonly BusinessModule[]): boolean {
  if (code === PURCHASE_EXPENSE_CODE) return modules.includes('purchases')
  const req = ACCOUNT_MODULE_MAP[code]
  return !req || req.some((m) => modules.includes(m))
}

/**
 * القائمة الفعلية التي تراها نافذة السند: الأساسية + بندو الأقسام المفعلة
 * + الحسابات المخصصة (إيراد في القبض / مصروف في الصرف) — والأول هو الافتراضي.
 */
export function voucherCountersFor(
  kind: 'receipt' | 'payment',
  modules: readonly BusinessModule[],
  customAccounts: readonly CustomAccount[] = [],
): VoucherCounter[] {
  const list = kind === 'receipt' ? RECEIPT_COUNTERS : PAYMENT_COUNTERS
  const rows = list
    .filter((c) => (!c.when || c.when.some((m) => modules.includes(m))) && counterAccountAllowed(c.code, modules))
    .map((c) => ({ code: c.code, label: c.label }))
  const rootType = kind === 'receipt' ? 'revenue' : 'expenses'
  const custom = customAccounts
    .filter((a) => a.rootType === rootType)
    .map((a) => ({ code: a.code, label: `${a.nameAr} (حساب مخصص)` }))
  return [...rows, ...custom]
}
