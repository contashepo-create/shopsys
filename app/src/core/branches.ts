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

import type { BusinessModule } from './activities.ts'

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
  /** وضع أقسام الفرع: شامل لكل أقسام الشركة المفعلة ('all') أو مخصص بأقسام محددة ('custom') */
  customModulesMode?: 'all' | 'custom'
  /** الأقسام المفعلة لهذا الفرع عند اختيار وضع التخصيص ('custom') — مجموعة جزئية من أقسام الشركة */
  enabledModules?: BusinessModule[]
  /** النشاط التجاري المخصص لهذا الفرع (اختياري — لتخصيص المسميات وشاشات النشاط؛ فارغ = نشاط الشركة العام) */
  activityId?: string | null
}

export interface BranchInput {
  nameAr: string
  warehouseId: number
  treasuryCode: string
  address?: string
  phone?: string
  managerName?: string
  customModulesMode?: 'all' | 'custom'
  enabledModules?: BusinessModule[]
  activityId?: string | null
}

/**
 * الأقسام الفعالة للفرع النشط:
 * - إن لم يُحدد فرع (عرض شامل) أو كان وضع الفرع 'all' ⇒ كل أقسام الشركة المفعلة.
 * - إن كان وضع الفرع 'custom' ⇒ تقاطع أقسام الفرع مع أقسام الشركة المرخصة/المفعلة.
 */
export function resolveBranchModules(
  branch: Pick<Branch, 'customModulesMode' | 'enabledModules'> | null | undefined,
  companyModules: readonly BusinessModule[],
): BusinessModule[] {
  if (!branch || branch.customModulesMode !== 'custom' || !Array.isArray(branch.enabledModules)) {
    return [...companyModules]
  }
  return companyModules.filter((m) => branch.enabledModules!.includes(m))
}

/** النشاط الفعال للفرع النشط (يعود لنشاط الشركة إن لم يُخصص للفرع نشاط مستقل) */
export function resolveBranchActivityId(
  branch: Pick<Branch, 'activityId'> | null | undefined,
  companyActivityId: string | null | undefined,
): string | null {
  if (branch?.activityId) return branch.activityId
  return companyActivityId ?? null
}

export interface BranchScopedRecord {
  branchId?: number | null
  warehouseId?: number | null
  treasury?: string | null
  treasuryCode?: string | null
}

/**
 * عزل السجلات حسب الفرع النشط (عندما يعمل كل فرع كشركة مستقلة تماماً):
 * - إن لم يكن هناك فرع نشط (`!activeBranch` = العرض الشامل لكل الفروع) ⇒ `true` (تظهر كل السجلات).
 * - إن كان للسجل `branchId` صريح ⇒ يظهر فقط إن طابق `activeBranch.id`.
 * - إن لم يكن للسجل `branchId`:
 *   1) إن كان يحمل `warehouseId` مربوطاً بفرع ⇒ يتبع ذلك الفرع.
 *   2) إن كان يحمل `treasury` أو `treasuryCode` مربوطاً بفرع ⇒ يتبع ذلك الفرع.
 *   3) السجلات القديمة بلا `branchId` تتبع الفرع الرئيسي (`activeBranch.isMain === true`)
 *      ولا تظهر في الفروع الجديدة المستقلة كي يبدأ كل فرع جديد كشركة مستقلة نظيفة.
 */
export function belongsToBranch(
  record: object,
  activeBranch: Branch | null | undefined,
  allBranches: readonly Branch[] = [],
): boolean {
  if (!activeBranch) return true
  const rec = record as BranchScopedRecord
  if (rec.branchId != null) return rec.branchId === activeBranch.id
  if (rec.warehouseId != null) {
    const whBranch = allBranches.find((b) => b.warehouseId === rec.warehouseId)
    if (whBranch) return whBranch.id === activeBranch.id
  }
  const trCode = rec.treasury ?? rec.treasuryCode ?? null
  if (trCode) {
    const trBranch = allBranches.find((b) => b.treasuryCode === trCode)
    if (trBranch) return trBranch.id === activeBranch.id
  }
  return Boolean(activeBranch.isMain)
}

export function filterByBranch<T extends object>(
  rows: readonly T[] | undefined | null,
  activeBranch: Branch | null | undefined,
  allBranches: readonly Branch[] = [],
): T[] {
  if (!Array.isArray(rows)) return []
  if (!activeBranch) return [...rows]
  return rows.filter((row) => belongsToBranch(row, activeBranch, allBranches))
}

/** مخازن الفرع النشط فقط (مخزنه الأساسي + أي مخزن إضافي أُنشئ داخل هذا الفرع) */
export function filterWarehousesByBranch<T extends { id: number; branchId?: number | null }>(
  warehouses: readonly T[],
  activeBranch: Branch | null | undefined,
  allBranches: readonly Branch[] = [],
): T[] {
  if (!activeBranch) return [...warehouses]
  const otherBranchWhIds = new Set(allBranches.filter((b) => b.id !== activeBranch.id).map((b) => b.warehouseId))
  return warehouses.filter((w) => {
    if (w.id === activeBranch.warehouseId) return true
    if (w.branchId != null) return w.branchId === activeBranch.id
    if (otherBranchWhIds.has(w.id)) return false
    return Boolean(activeBranch.isMain)
  })
}

/** خزائن وبنوك الفرع النشط فقط (خزينته الأساسية + أي خزينة/بنك إضافي أُنشئ داخل هذا الفرع) */
export function filterTreasuriesByBranch<T extends { code: string; branchId?: number | null }>(
  treasuries: readonly T[],
  activeBranch: Branch | null | undefined,
  allBranches: readonly Branch[] = [],
): T[] {
  if (!activeBranch) return [...treasuries]
  const otherBranchTrCodes = new Set(allBranches.filter((b) => b.id !== activeBranch.id).map((b) => b.treasuryCode))
  return treasuries.filter((t) => {
    if (t.code === activeBranch.treasuryCode) return true
    if (t.branchId != null) return t.branchId === activeBranch.id
    if (otherBranchTrCodes.has(t.code)) return false
    return Boolean(activeBranch.isMain)
  })
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
  if (input.customModulesMode === 'custom' && (!input.enabledModules || input.enabledModules.length === 0))
    errors.push('اختر قسماً واحداً على الأقل عند تخصيص أقسام الفرع، أو اختر «شامل لكل أقسام الشركة»')
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
  /** القيمة والكمية الدقيقة للصنف، لاستخدامهما في توزيع قيمة المخزون على المخازن */
  itemValueById?: ReadonlyMap<number, number>
  itemQtyById?: ReadonlyMap<number, number>
}): BranchComparisonRow[] {
  const branchStockValueShares = new Map<string, number>()
  if (args.itemValueById && args.itemQtyById) {
    for (const [itemId, exactValue] of args.itemValueById) {
      const companyQty = args.itemQtyById.get(itemId) ?? 0
      if (companyQty <= 0) continue
      const weights = args.branches.filter((branch) => branch.active).map((branch) => ({
        branchId: branch.id,
        qty: args.warehouseStock.get(branch.warehouseId)?.get(itemId) ?? 0,
      })).filter((row) => row.qty > 0)
      const totalBranchQty = weights.reduce((sum, row) => sum + row.qty, 0)
      if (totalBranchQty <= 0) continue
      const distributableValue = Math.round(exactValue * totalBranchQty / companyQty)
      const rawShares = weights.map((row) => distributableValue * row.qty / totalBranchQty)
      const shares = rawShares.map(Math.floor)
      let remainder = distributableValue - shares.reduce((sum, share) => sum + share, 0)
      const order = rawShares.map((raw, index) => ({ index, fraction: raw - Math.floor(raw) }))
        .sort((a, b) => b.fraction - a.fraction)
      for (let index = 0; index < order.length && remainder > 0; index++, remainder--) shares[order[index].index]++
      weights.forEach((row, index) => branchStockValueShares.set(`${row.branchId}:${itemId}`, shares[index]))
    }
  }
  const rows = new Map<number, BranchComparisonRow>()
  for (const b of args.branches) {
    if (!b.active) continue
    const whStock = args.warehouseStock.get(b.warehouseId)
    let stockValue = 0
    if (whStock) for (const [itemId, qty] of whStock) {
      const exactShare = branchStockValueShares.get(`${b.id}:${itemId}`)
      stockValue += exactShare ?? Math.round(qty * (args.itemCostById.get(itemId) ?? 0))
    }
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
