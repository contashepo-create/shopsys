/**
 * الفروع الحقيقية (سد فجوة تدقيق المالك — «إدارة فروع بمستوى البرامج العالمية»)
 * ─────────────────────────────────────────────────────────────────────────────
 * الفرع = هوية تنظيمية تربط: مخزنه الخاص + خزينته الخاصة + موظفيه.
 * التصميم يبني فوق البنية القائمة بلا كسر أي شيء:
 *   - المخزون لكل فرع: computeWarehouseStock القائمة (كل فاتورة تحمل warehouseId)
 *   - الخزينة لكل فرع: كل فاتورة/سند يحمل كود الخزينة — رصيدها من اليومية
 *   - التحويل بين الفروع بضاعةً: مستند TRF القائم بين مخزنَي الفرعين
 *   - التحويل بين الفروع نقداً: سند التحويل القائم بين خزينتَي الفرعين
 *   - نسبة كل عملية لفرعها: بمخزن الفاتورة (البيع/المرتجع) — بلا حقول جديدة
 * «وضع الفرع الواحد»: قائمة فروع فارغة = التطبيق كما هو تماماً (توافق خلفي كامل).
 */

export interface Branch {
  id: number
  nameAr: string
  /** الفرع الرئيسي (المركز) — يُنشأ تلقائياً مع أول فرع ولا يُحذف إلا آخراً */
  isMain: boolean
  /** مخزن الفرع — كل بضاعته وأرصدته عليه */
  warehouseId: number
  /** خزينة الفرع — كل نقديته عليها (كود حساب من الخزائن) */
  treasuryCode: string
  address?: string
  phone?: string
  /** اسم مدير الفرع (عرض وتقارير — الربط الصارم بالمستخدمين عبر branchId) */
  managerName?: string
  active: boolean
}

export interface BranchInput {
  nameAr: string
  warehouseId: number
  treasuryCode: string
  address?: string
  phone?: string
  managerName?: string
}

/** تحقق قبل الإنشاء/التعديل — يعيد أخطاء عربية (فارغة = سليم) */
export function validateBranch(
  input: BranchInput,
  branches: readonly Branch[],
  warehouses: readonly { id: number }[],
  treasuries: readonly { code: string }[],
  editingId?: number,
): string[] {
  const errors: string[] = []
  const name = input.nameAr.trim()
  if (!name) errors.push('اسم الفرع مطلوب')
  if (branches.some((b) => b.nameAr === name && b.id !== editingId)) errors.push('يوجد فرع بهذا الاسم بالفعل')
  if (!warehouses.some((w) => w.id === input.warehouseId)) errors.push('مخزن الفرع غير موجود')
  if (!treasuries.some((t) => t.code === input.treasuryCode)) errors.push('خزينة الفرع غير موجودة')
  // فرعان على نفس المخزن = أرصدة مختلطة لا تُفصل — نمنعها من المنبع
  if (branches.some((b) => b.warehouseId === input.warehouseId && b.id !== editingId))
    errors.push('هذا المخزن مربوط بفرع آخر — لكل فرع مخزنه الخاص')
  if (branches.some((b) => b.treasuryCode === input.treasuryCode && b.id !== editingId))
    errors.push('هذه الخزينة مربوطة بفرع آخر — لكل فرع خزينته الخاصة')
  return errors
}

/** نسبة مستند لفرعه بمخزنه — null = لا ينتمي لفرع (وضع الفرع الواحد/مخزن حر) */
export function branchOfWarehouse(warehouseId: number | null | undefined, branches: readonly Branch[]): Branch | null {
  if (warehouseId == null) return branches.find((b) => b.isMain) ?? null
  return branches.find((b) => b.warehouseId === warehouseId) ?? branches.find((b) => b.isMain) ?? null
}

/** صف مقارنة فرع في لوحة المالك */
export interface BranchComparisonRow {
  branchId: number
  nameAr: string
  isMain: boolean
  salesCount: number
  /** إيراد المبيعات (إجمالي الفواتير) */
  revenueMinor: number
  /** مرتجعات المبيعات (قيمة) */
  returnsMinor: number
  /** صافي الإيراد = الإيراد − المرتجعات */
  netRevenueMinor: number
  /** تكلفة البضاعة المباعة */
  cogsMinor: number
  /** مجمل الربح = صافي الإيراد − التكلفة (تقريب: تكلفة المرتجع السليم تعود للمخزون) */
  grossProfitMinor: number
  /** رصيد خزينة الفرع الآن (من اليومية) */
  treasuryBalanceMinor: number
  /** قيمة مخزون الفرع الآن (كمية × متوسط التكلفة) */
  stockValueMinor: number
}

/**
 * لوحة مقارنة الفروع (للمالك): كل فرع بإيراده ومرتجعاته وربحه ورصيد خزينته
 * وقيمة مخزونه — من نفس بيانات الدفاتر بلا أي عدّادات موازية قد تنحرف.
 */
export function compareBranches(args: {
  branches: readonly Branch[]
  sales: readonly { warehouseId?: number | null; totals: { totalMinor: number; cogsMinor: number } }[]
  saleReturns: readonly { saleId: number; totals: { totalMinor: number; cogsMinor: number } }[]
  /** خريطة فاتورة → مخزنها (لنسبة المرتجع لفرع فاتورته الأصلية) */
  saleWarehouseById: ReadonlyMap<number, number | null>
  /** أرصدة الحسابات من اليومية: code → (مدين − دائن) بالوحدة الصغرى */
  accountBalances: ReadonlyMap<string, number>
  /** أرصدة المخازن: warehouseId → itemId → qty (من computeWarehouseStock) */
  warehouseStock: ReadonlyMap<number, ReadonlyMap<number, number>>
  /** متوسط تكلفة كل صنف الآن */
  itemCostById: ReadonlyMap<number, number>
}): BranchComparisonRow[] {
  const rows = new Map<number, BranchComparisonRow>()
  for (const b of args.branches) {
    if (!b.active) continue
    const whStock = args.warehouseStock.get(b.warehouseId)
    let stockValue = 0
    if (whStock) for (const [itemId, qty] of whStock) stockValue += Math.round(qty * (args.itemCostById.get(itemId) ?? 0))
    rows.set(b.id, {
      branchId: b.id, nameAr: b.nameAr, isMain: b.isMain,
      salesCount: 0, revenueMinor: 0, returnsMinor: 0, netRevenueMinor: 0,
      cogsMinor: 0, grossProfitMinor: 0,
      treasuryBalanceMinor: args.accountBalances.get(b.treasuryCode) ?? 0,
      stockValueMinor: stockValue,
    })
  }
  const rowOf = (warehouseId: number | null | undefined) => {
    const b = branchOfWarehouse(warehouseId, args.branches)
    return b ? rows.get(b.id) : undefined
  }
  for (const s of args.sales) {
    const r = rowOf(s.warehouseId)
    if (!r) continue
    r.salesCount += 1
    r.revenueMinor += s.totals.totalMinor
    r.cogsMinor += s.totals.cogsMinor
  }
  for (const ret of args.saleReturns) {
    const r = rowOf(args.saleWarehouseById.get(ret.saleId))
    if (!r) continue
    r.returnsMinor += ret.totals.totalMinor
    r.cogsMinor -= ret.totals.cogsMinor // تكلفة المرتجع تخرج من تكلفة المبيعات
  }
  for (const r of rows.values()) {
    r.netRevenueMinor = r.revenueMinor - r.returnsMinor
    r.grossProfitMinor = r.netRevenueMinor - r.cogsMinor
  }
  // الرئيسي أولاً ثم الأعلى صافي إيراد
  return [...rows.values()].sort((a, b) => (a.isMain === b.isMain ? b.netRevenueMinor - a.netRevenueMinor : a.isMain ? -1 : 1))
}

/**
 * فحص حذف فرع: الرئيسي لا يُحذف وغيره قائم، والحذف لا يمس مخزنه ولا خزينته
 * ولا تاريخه — يفك الربط التنظيمي فقط (المستندات تبقى على المخزن والخزينة).
 */
export function canRemoveBranch(branch: Branch, branches: readonly Branch[]): string | null {
  if (branch.isMain && branches.some((b) => b.id !== branch.id)) {
    return 'الفرع الرئيسي لا يُحذف وباقي الفروع قائمة — احذف الفروع الأخرى أولاً'
  }
  return null
}
