/**
 * محرك القيود المزدوجة — ShopSys
 * (وثيقة التصميم — القرار 9)
 * ─────────────────────────────
 * القواعد البنيوية غير القابلة للكسر:
 * 1. القيد لا يُقبل إلا متوازناً: مجموع المدين = مجموع الدائن (بأصغر وحدة العملة).
 * 2. دفتر الأستاذ Append-Only: لا تعديل ولا حذف — التصحيح بقيد عكسي موثق.
 * 3. كل قيد آلي مربوط بمستنده (sourceType + sourceId).
 * 4. كل المبالغ Minor (أعداد صحيحة) — يمر عبر محرك النقود حصراً.
 */
import type { Minor } from './money.ts'
import { addMinor } from './money.ts'

export type AccountNature = 'debit' | 'credit'
export type AccountRootType = 'assets' | 'liabilities' | 'equity' | 'revenue' | 'expenses'

export interface Account {
  code: string // مثل 1101
  nameAr: string
  rootType: AccountRootType
  parentCode: string | null
  isPostable: boolean // الحسابات الورقية فقط تقبل القيود
  systemKey?: string // مفاتيح النظام: main_cash, inventory, sales...
}

export interface JournalLine {
  accountCode: string
  debit: Minor
  credit: Minor
  note?: string
  /** مركز التكلفة العام على سطر المصروف؛ لا يخلط مع مركز تكلفة المركبة */
  costCenterId?: number | null
}

export interface CostCenterAllocationWeight {
  costCenterId: number
  weight: number
}

/** يوزع قيمة سطر واحد على مراكز متعددة بالباقي الأكبر دون فقد أصغر وحدة عملة. */
export function allocateJournalLine(line: JournalLine, weights: CostCenterAllocationWeight[]): JournalLine[] {
  const amount = line.debit > 0 ? line.debit : line.credit
  if (!Number.isInteger(amount) || amount < 0 || (line.debit > 0 && line.credit > 0)) throw new RangeError('سطر القيد المراد توزيعه غير صالح')
  if (!weights.length || weights.some((item) => !Number.isInteger(item.costCenterId) || !Number.isFinite(item.weight) || item.weight <= 0)) throw new RangeError('أوزان توزيع مركز التكلفة غير صالحة')
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0)
  const raw = weights.map((item) => amount * item.weight / totalWeight)
  const floors = raw.map(Math.floor)
  let remainder = amount - floors.reduce((sum, value) => sum + value, 0)
  const order = raw.map((value, index) => ({ index, fraction: value - floors[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  const shares = [...floors]
  for (let i = 0; i < remainder; i++) shares[order[i].index]++
  return shares.map((share, index) => ({ ...line, debit: line.debit > 0 ? share : 0, credit: line.credit > 0 ? share : 0, costCenterId: weights[index].costCenterId }))
}

export type SourceType =
  | 'sale' | 'sale_return' | 'purchase' | 'purchase_return'
  | 'wallet_service'
  | 'receipt_voucher' | 'payment_voucher' | 'adjustment'
  | 'payroll' | 'rental_contract' | 'logistics_trip' | 'maintenance_ticket'
  | 'lab_order' | 'lab_commission' | 'lab_commission_payout'
  | 'clinic_visit' | 'project_extract' | 'project_cost' | 'retention_release'
  | 'sub_certificate' | 'sub_payment' | 'bond_issue' | 'bond_settle' | 'client_advance' | 'daily_wages'
  | 'production' | 'processing' | 'scrap_purchase' | 'scrap_sale' | 'equipment_cost'
  | 'consignment_sale' | 'consignment_payout' | 'driver_settlement'
  | 'sub_advance' | 'material_issue' | 'client_payment' | 'wastage' | 'internal_use'
  | 'insured_sale' | 'claim_settlement'
  | 'car_purchase' | 'car_sale'
  | 'cheque_receive' | 'cheque_collect' | 'cheque_bounce'
  | 'cheque_issue' | 'cheque_clear' | 'cheque_cancel'
  | 'lease' | 'lease_collection' | 'owner_payout' | 'lease_end' | 'unit_maintenance' | 'property_acquisition' | 'property_sale'
  | 'staff_commission' | 'staff_commission_payout' | 'staff_commission_cancel'
  | 'opening' | 'manual' | 'year_closing' | 'asset_purchase' | 'asset_payment' | 'depreciation' | 'external_commission' | 'laundry' | 'reversal'

export interface JournalEntry {
  id: number
  entryNumber: number
  date: string // ISO
  description: string
  sourceType: SourceType
  sourceId: number | null
  lines: JournalLine[]
  createdBy: string
  createdAt: string
  reversedByEntryId: number | null // إن عُكس هذا القيد
  reversesEntryId: number | null // إن كان هذا قيداً عاكساً
}

export class UnbalancedEntryError extends Error {
  constructor(debit: Minor, credit: Minor) {
    super(`قيد غير متوازن: مدين ${debit} ≠ دائن ${credit} — القيد مرفوض بنيوياً`)
    this.name = 'UnbalancedEntryError'
  }
}

/** التحقق البنيوي: يرمي خطأ إن لم يتوازن القيد — لا مسار آخر للحفظ */
export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new Error('القيد يحتاج طرفين على الأقل')
  const debit = addMinor(...lines.map((l) => l.debit))
  const credit = addMinor(...lines.map((l) => l.credit))
  if (debit !== credit) throw new UnbalancedEntryError(debit, credit)
  if (debit === 0) throw new Error('قيد صفري مرفوض')
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) throw new Error('المبالغ السالبة مرفوضة — استخدم الطرف المقابل')
    if (l.debit > 0 && l.credit > 0) throw new Error('السطر لا يكون مديناً ودائناً معاً')
  }
}

/** طبيعة الحساب حسب جذره */
export function accountNature(rootType: AccountRootType): AccountNature {
  return rootType === 'assets' || rootType === 'expenses' ? 'debit' : 'credit'
}

/** رصيد حساب من مجموع حركاته حسب طبيعته */
export function accountBalance(rootType: AccountRootType, totalDebit: Minor, totalCredit: Minor): Minor {
  return accountNature(rootType) === 'debit' ? totalDebit - totalCredit : totalCredit - totalDebit
}

/** توليد القيد العاكس (التصحيح الوحيد المسموح — القاعدة 2) */
export function buildReversalLines(original: JournalLine[]): JournalLine[] {
  return original.map((l) => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, note: l.note }))
}

/**
 * شجرة الحسابات العربية القياسية — تُنشأ تلقائياً عند أول تشغيل
 * (تتوسع حسب النشاط: حسابات الإيجار للمعدات، النقلات للوجستيات...)
 */
export const STANDARD_COA: Account[] = [
  { code: '1', nameAr: 'الأصول', rootType: 'assets', parentCode: null, isPostable: false },
  { code: '11', nameAr: 'الأصول المتداولة', rootType: 'assets', parentCode: '1', isPostable: false },
  { code: '1101', nameAr: 'الخزينة الرئيسية', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'main_cash' },
  { code: '1102', nameAr: 'البنوك', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'bank' },
  { code: '1103', nameAr: 'المخزون', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'inventory' },
  { code: '1104', nameAr: 'العملاء (المدينون)', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'customers' },
  { code: '1105', nameAr: 'محتجزات ضمان أعمال', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'retention_receivable' },
  { code: '1106', nameAr: 'أوراق قبض (شيكات واردة)', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'notes_receivable' },
  { code: '1107', nameAr: 'سلف الموظفين', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'employee_advances' },
  { code: '1108', nameAr: 'عهد الموظفين', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'employee_custodies' },
  { code: '1109', nameAr: 'هوامش خطابات الضمان', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'bond_margins' },
  { code: '1110', nameAr: 'مطالبات جهات تأمين وتعاقد', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'insurance_claims' },
  { code: '1111', nameAr: 'دفعات مقدمة لمقاولي الباطن', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'sub_advances' },
  { code: '12', nameAr: 'الأصول الثابتة', rootType: 'assets', parentCode: '1', isPostable: false },
  { code: '1112', nameAr: 'عمولات مستحقة لدى الغير', rootType: 'assets', parentCode: '11', isPostable: true, systemKey: 'external_commissions_receivable' },
  { code: '1113', nameAr: 'عقارات مملوكة (استثمار/بيع)', rootType: 'assets', parentCode: '12', isPostable: true, systemKey: 'real_estate_assets' },
  { code: '1201', nameAr: 'أصول ومعدات', rootType: 'assets', parentCode: '12', isPostable: true, systemKey: 'fixed_assets' },
  { code: '1202', nameAr: 'مجمع الإهلاك', rootType: 'assets', parentCode: '12', isPostable: true, systemKey: 'acc_depreciation' },
  { code: '2', nameAr: 'الخصوم', rootType: 'liabilities', parentCode: null, isPostable: false },
  { code: '2101', nameAr: 'الموردون (الدائنون)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'suppliers' },
  { code: '2102', nameAr: 'ضريبة القيمة المضافة المستحقة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'vat_payable' },
  { code: '2103', nameAr: 'تأمينات مستردة (عملاء إيجار)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'rental_deposits' },
  { code: '2104', nameAr: 'رواتب مستحقة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'salaries_payable' },
  { code: '2105', nameAr: 'عمولات أطباء مستحقة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'commissions_payable' },
  { code: '2106', nameAr: 'أوراق دفع (شيكات صادرة)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'notes_payable' },
  { code: '2107', nameAr: 'مستحق للموظفين (فائض عهد)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'employee_payable' },
  { code: '2108', nameAr: 'محتجزات مقاولي الباطن', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'sub_retention_payable' },
  { code: '2109', nameAr: 'دفعات مقدمة من العملاء', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'client_advances' },
  { code: '2110', nameAr: 'مستحق لملاك سيارات الأمانة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'consignment_payable' },
  { code: '2111', nameAr: 'مستحقات سائقين', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'driver_dues' },
  { code: '2112', nameAr: 'ضريبة استقطاع مستحقة (مقاولو باطن)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'withholding_tax_payable' },
  { code: '2113', nameAr: 'مصروفات نقلات مستحقة (كروت/محطات)', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'trip_expenses_payable' },
  { code: '2114', nameAr: 'عمولات مستحقة للغير', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'commissions_payable_others' },
  { code: '2115', nameAr: 'مستحق لملاك العقارات المدارة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'property_owners_payable' },
  { code: '2116', nameAr: 'عمولات موظفين مستحقة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'staff_commissions_payable' },
  { code: '2117', nameAr: 'مصروفات داخلية مستحقة', rootType: 'liabilities', parentCode: '2', isPostable: true, systemKey: 'internal_expenses_payable' },
  { code: '3', nameAr: 'حقوق الملكية', rootType: 'equity', parentCode: null, isPostable: false },
  { code: '3101', nameAr: 'رأس المال', rootType: 'equity', parentCode: '3', isPostable: true, systemKey: 'capital' },
  { code: '3102', nameAr: 'أرباح مرحّلة', rootType: 'equity', parentCode: '3', isPostable: true, systemKey: 'retained_earnings' },
  { code: '3103', nameAr: 'جاري الشريك', rootType: 'equity', parentCode: '3', isPostable: true, systemKey: 'partner_current' },
  { code: '4', nameAr: 'الإيرادات', rootType: 'revenue', parentCode: null, isPostable: false },
  { code: '4101', nameAr: 'المبيعات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'sales' },
  { code: '4102', nameAr: 'مرتجعات المبيعات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'sales_returns' },
  { code: '4103', nameAr: 'إيرادات صيانة وخدمات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'service_revenue' },
  { code: '4104', nameAr: 'إيرادات إيجار معدات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'rental_revenue' },
  { code: '4105', nameAr: 'إيرادات نقلات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'logistics_revenue' },
  { code: '4106', nameAr: 'إيرادات تحاليل طبية', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'lab_revenue' },
  { code: '4107', nameAr: 'إيرادات مقاولات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'contracting_revenue' },
  { code: '4108', nameAr: 'إيرادات كشف وعلاج', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'clinic_revenue' },
  { code: '4109', nameAr: 'عمولات بيع بالأمانة', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'consignment_commission' },
  { code: '4110', nameAr: 'إيرادات أخرى (فوائض عدّ)', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'other_income' },
  { code: '4111', nameAr: 'أرباح تقسيط (هامش تمويل)', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'installment_interest' },
  { code: '4112', nameAr: 'إيرادات عمولات خارجية', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'external_commission_income' },
  { code: '4113', nameAr: 'إيرادات إيجار عقارات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'property_rent_revenue' },
  { code: '4114', nameAr: 'سعي وعمولات إدارة أملاك', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'property_commission_revenue' },
  { code: '4115', nameAr: 'إيرادات بيع عقارات', rootType: 'revenue', parentCode: '4', isPostable: true, systemKey: 'property_sale_revenue' },
  { code: '5', nameAr: 'المصروفات', rootType: 'expenses', parentCode: null, isPostable: false },
  { code: '5101', nameAr: 'تكلفة البضاعة المباعة', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'cogs' },
  { code: '5102', nameAr: 'رواتب وأجور', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'salaries' },
  { code: '5103', nameAr: 'إيجار المحل', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'rent_expense' },
  { code: '5104', nameAr: 'كهرباء ومياه', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'utilities' },
  { code: '5105', nameAr: 'مصروفات تشغيل معدات', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'equipment_opex' },
  { code: '5106', nameAr: 'مصروفات نقلات (سولار وطرق)', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'trip_costs' },
  { code: '5107', nameAr: 'إهلاك', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'depreciation' },
  { code: '5108', nameAr: 'مصروفات عمومية', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'general_expense' },
  { code: '5109', nameAr: 'عمولات أطباء محيلين', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'referral_commission' },
  { code: '5110', nameAr: 'تكاليف مشروعات مقاولات', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'project_costs' },
  { code: '5111', nameAr: 'هالك وتوالف مخزون', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'wastage' },
  { code: '5112', nameAr: 'فروق تسويات وجرد نقدية', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'settlement_variance' },
  { code: '5113', nameAr: 'مصروف عمولات للغير', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'commission_expense_others' },
  { code: '5114', nameAr: 'مستهلكات تشغيل داخلي', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'internal_use' },
  { code: '5115', nameAr: 'مصروف برنامج الولاء', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'loyalty_expense' },
  { code: '5116', nameAr: 'تكلفة عقارات مباعة', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'property_cogs' },
  { code: '5117', nameAr: 'مصروف عمولات موظفين', rootType: 'expenses', parentCode: '5', isPostable: true, systemKey: 'staff_commission_expense' },
]
