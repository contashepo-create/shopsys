/**
 * طبقة البيانات — ShopSys
 * ─────────────────────────
 * (وثيقة التصميم — القرار 2: طبقة وصول بيانات مجرّدة)
 * اليوم: تخزين محلي في المتصفح للمعاينة الحية.
 * غداً: نفس هذه الواجهة تُنفَّذ فوق SQLite (better-sqlite3) في قشرة Electron،
 * ثم PostgreSQL للفروع — دون أي تغيير في الواجهات أو النواة.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Item, Category } from '../core/items.ts'
import type { ItemFeature } from '../core/activities.ts'
import { computeLandedCosts, weightedAverage, type ExpenseInput, type CostLine } from '../core/costing.ts'
import { computeTotals, buildSaleEntry, checkStock, type CartLine, type PaymentMethod, type CartTotals } from '../core/pos.ts'
import { buildReturnLines, buildReturnEntry, deriveTaxConfig } from '../core/returns.ts'
import { buildPurchaseEntry, buildPurchaseReturnLines, purchaseReturnTotal, buildPurchaseReturnEntry, type PurchaseReturnLine } from '../core/purchases.ts'
import { computeStocktake, buildAdjustmentEntry, type CountInput, type StocktakeResult } from '../core/stocktake.ts'
import { buildReceiptVoucherEntry, buildPaymentVoucherEntry, buildTransferEntry, validateManualEntry, type VoucherKind, type TreasuryAccount } from '../core/accounting.ts'
import { STANDARD_COA, buildReversalLines, type JournalLine } from '../core/ledger.ts'
import { validateOpenShift, currentOpenShift, type Shift } from '../core/shifts.ts'
import { computePayrollLine, computePayrollTotals, validatePayrollRun, buildPayrollEntry, monthLabelAr, type PayrollPayMode, type PayrollLineInput, type PayrollLineComputed, type PayrollTotals } from '../core/payroll.ts'
import type { JournalEntry } from '../core/ledger.ts'

export interface Warehouse {
  id: number
  nameAr: string
  isMain: boolean
}

/**
 * بيانات موسعة للأطراف — كلها اختيارية (طلب المالك)،
 * لكنها ضرورية لإصدار فاتورة ضريبية (السعودية: الرقم الضريبي والسجل والعنوان الوطني)
 */
export interface PartyExtended {
  taxNumber: string // الرقم الضريبي (VAT/TIN)
  commercialReg: string // السجل التجاري
  email: string
  address: string // الشارع/الحي
  city: string
  postalCode: string
  buildingNo: string // رقم المبنى (العنوان الوطني السعودي)
  nationalId: string // هوية/إقامة (للأفراد)
}

export const EMPTY_EXTENDED: PartyExtended = {
  taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '',
}

export interface Customer extends PartyExtended {
  id: number
  nameAr: string
  phone: string
  creditLimitMinor: number
  notes: string
}

export interface Supplier extends PartyExtended {
  id: number
  nameAr: string
  phone: string
  notes: string
}

/** موظف — نفس البيانات الموسعة الاختيارية للأطراف + بيانات التوظيف */
export interface Employee extends PartyExtended {
  id: number
  nameAr: string
  phone: string
  jobTitle: string // المسمى الوظيفي
  hireDate: string // تاريخ التعيين YYYY-MM-DD
  baseSalaryMinor: number // الراتب الأساسي الشهري
  allowancesMinor: number // بدلات شهرية ثابتة
  active: boolean // موظف على رأس العمل؟
  notes: string
}

/** مسير رواتب مرحّل لشهر — مربوط بقيده المحاسبي */
export interface PayrollRun {
  id: number
  runNumber: string // SAL-0001
  month: string // YYYY-MM
  date: string // تاريخ الترحيل ISO
  payMode: PayrollPayMode
  treasury: TreasuryAccount // عند الصرف النقدي
  lines: PayrollLineComputed[]
  totals: PayrollTotals
  journalEntryId: number
  notes: string
}

/* ─── فواتير الشراء (مع مصاريف الشراء الموزعة) ─── */
export interface PurchaseLine {
  itemId: number
  qty: number
  unitPriceMinor: number // سعر الوحدة قبل المصاريف
  expenseShareMinor: number // نصيب السطر من المصاريف (يُحسب)
  landedUnitCostMinor: number // التكلفة النهائية للوحدة (يُحسب)
}

export interface PurchaseExpense {
  nameAr: string // نولون، جمارك، تأمين...
  amountMinor: number
  method: 'value' | 'qty'
}

export interface PurchaseInvoice {
  id: number
  invoiceNumber: string
  supplierId: number
  date: string
  lines: PurchaseLine[]
  expenses: PurchaseExpense[]
  goodsTotalMinor: number
  expensesTotalMinor: number
  grandTotalMinor: number
  paidMinor: number
  notes: string
  journalEntryId: number | null // القيد المتولد (فواتير قديمة قبل الترحيل = null)
}

/** مرتجع شراء — مربوط بفاتورة الشراء الأصلية، مُقيَّم بتكلفتها النهائية */
export interface PurchaseReturn {
  id: number
  returnNumber: string // PR-0001
  date: string
  purchaseId: number
  refund: 'cash' | 'debt' // استرداد نقدي أو تخفيض دين المورد
  lines: PurchaseReturnLine[]
  totalMinor: number
  journalEntryId: number
  reason: string
}

/** جلسة جرد مرحّلة — الفوارق وقيد التسوية */
export interface Stocktake {
  id: number
  stocktakeNumber: string // ST-0001
  date: string
  result: StocktakeResult
  countedItems: number // عدد الأصناف المشمولة بالجرد
  journalEntryId: number | null // null لو الجرد مطابق تماماً (لا قيد)
  notes: string
}

/** سند قبض/صرف/تحويل — كل سند مربوط بقيده */
export interface Voucher {
  id: number
  voucherNumber: string // RV-0001 / PV-0001 / TV-0001
  kind: VoucherKind
  date: string
  treasury: TreasuryAccount // الخزينة المعنية (في التحويل: المصدر)
  counterAccountCode: string // الحساب المقابل (في التحويل: الوجهة)
  amountMinor: number
  description: string
  journalEntryId: number
}

/* ─── فواتير البيع (الكاشير) ─── */
export interface SaleInvoice {
  id: number
  invoiceNumber: string
  date: string // ISO datetime
  customerId: number | null // null = عميل نقدي
  payment: PaymentMethod
  lines: CartLine[]
  invoiceDiscountPercent: number
  totals: CartTotals
  journalEntryId: number // القيد المتولد — كل مستند مربوط بقيده (القرار 9)
  expiryOverrideBy: string | null // من وافق على تجاوز الصلاحية (القرار 8)
  shiftId: number | null // الوردية التي بيعت خلالها (null = خارج وردية)
}

/** مرتجع مبيعات — دائماً مربوط بفاتورته الأصلية وبقيده العاكس */
export interface SaleReturn {
  id: number
  returnNumber: string // R-0001
  date: string
  saleId: number // الفاتورة الأصلية
  refund: PaymentMethod // رد نقدي أو تخفيض ذمم العميل
  lines: CartLine[]
  totals: CartTotals
  journalEntryId: number
  reason: string
  shiftId: number | null
}

interface DataState {
  seeded: boolean
  items: Item[]
  categories: Category[]
  warehouses: Warehouse[]
  customers: Customer[]
  suppliers: Supplier[]
  employees: Employee[]
  payrollRuns: PayrollRun[]
  purchases: PurchaseInvoice[]
  purchaseReturns: PurchaseReturn[]
  stocktakes: Stocktake[]
  vouchers: Voucher[]
  sales: SaleInvoice[]
  saleReturns: SaleReturn[]
  shifts: Shift[]
  journal: JournalEntry[] // دفتر اليومية — Append-Only (القرار 9)
  // بذر البيانات الأولية حسب النشاط المختار
  seed: (activityFeatures: ItemFeature[]) => void
  addItem: (item: Omit<Item, 'id'>) => void
  updateItem: (id: number, patch: Partial<Item>) => void
  removeItem: (id: number) => void
  addCategory: (nameAr: string, features: ItemFeature[], parentId?: number | null) => void
  updateCategory: (id: number, patch: Partial<Category>) => void
  removeCategory: (id: number) => void
  /**
   * ترحيل فاتورة شراء — القلب المحاسبي للتكلفة:
   * 1) يوزع المصاريف على السطور (Landed Cost)
   * 2) يحدّث تكلفة كل صنف بالمتوسط المرجح المتحرك
   * 3) يزيد رصيد المخزون
   */
  postPurchase: (inv: {
    supplierId: number
    date: string
    lines: { itemId: number; qty: number; unitPriceMinor: number }[]
    expenses: PurchaseExpense[]
    paidMinor: number
    notes: string
  }) => PurchaseInvoice
  /**
   * ترحيل فاتورة بيع من الكاشير:
   * 1) يتحقق من المخزون  2) يخصم الكميات  3) يولّد القيد المحاسبي المتوازن
   * يرمي خطأ لو نقص المخزون أو اختل القيد (بنيوياً لا يمكن حفظ فاتورة بلا قيد)
   */
  postSale: (args: {
    lines: CartLine[]
    customerId: number | null
    payment: PaymentMethod
    invoiceDiscountPercent: number
    taxPercent: number
    taxInclusive: boolean
    expiryOverrideBy?: string | null
    allowNegativeStock?: boolean
  }) => SaleInvoice
  /**
   * ترحيل مرتجع مبيعات مربوط بفاتورة أصلية:
   * 1) يتحقق أن الكميات لا تتجاوز المتبقي القابل للإرجاع (تراكمياً)
   * 2) يعيد البضاعة للمخزون  3) يولّد القيد العاكس المتوازن
   */
  postSaleReturn: (args: {
    saleId: number
    qtyByItem: Map<number, number>
    refund: PaymentMethod
    reason: string
  }) => SaleReturn
  /**
   * ترحيل مرتجع شراء مربوط بفاتورة أصلية:
   * يُقيَّم بالتكلفة النهائية للوحدة (Landed) — ولا يتجاوز المتبقي ولا المخزون الحالي
   */
  postPurchaseReturn: (args: {
    purchaseId: number
    qtyByItem: Map<number, number>
    refund: 'cash' | 'debt'
    reason: string
  }) => PurchaseReturn
  /**
   * ترحيل جلسة جرد: يقارن المعدود بالدفتري، يضبط المخزون على المعدود،
   * ويولّد قيد تسوية متوازناً (عجز = مصروف، زيادة = تخفيض مصروف)
   */
  postStocktake: (counts: CountInput[], notes: string) => Stocktake
  /** سند قبض/صرف/تحويل — يولّد قيده المتوازن فوراً */
  postVoucher: (args: {
    kind: VoucherKind
    treasury: TreasuryAccount
    counterAccountCode: string // في التحويل: الخزينة الوجهة
    amountMinor: number
    description: string
  }) => Voucher
  /** قيد يدوي — يُرفض بنيوياً إن لم يتوازن (validateManualEntry ثم assertBalanced) */
  postManualEntry: (args: { date: string; description: string; lines: JournalLine[] }) => JournalEntry
  /** عكس قيد موثق — التصحيح الوحيد المسموح (Append-Only) */
  reverseEntry: (entryId: number, reason: string) => JournalEntry
  /** فتح وردية كاشير برصيد درج افتتاحي — لا ورديتين مفتوحتين معاً */
  openShift: (openedBy: string, openingCashMinor: number) => Shift
  /** إقفال الوردية بالنقدية المعدودة — يظهر العجز/الزيادة في الملخص */
  closeShift: (countedCashMinor: number) => Shift
  addWarehouse: (nameAr: string) => void
  removeWarehouse: (id: number) => void
  addCustomer: (c: Omit<Customer, 'id'>) => void
  updateCustomer: (id: number, patch: Partial<Customer>) => void
  removeCustomer: (id: number) => void
  addSupplier: (s: Omit<Supplier, 'id'>) => void
  updateSupplier: (id: number, patch: Partial<Supplier>) => void
  removeSupplier: (id: number) => void
  addEmployee: (e: Omit<Employee, 'id'>) => void
  updateEmployee: (id: number, patch: Partial<Employee>) => void
  removeEmployee: (id: number) => void
  /**
   * ترحيل مسير رواتب شهر كامل:
   * 1) يتحقق (شهر صالح، لا تكرار، صافٍ موجب)  2) يحسب كل سطر بالنواة الخالصة
   * 3) يولّد قيداً متوازناً بنيوياً (5102 → خزينة أو 2104 حسب طريقة الصرف)
   */
  postPayroll: (args: {
    month: string
    payMode: PayrollPayMode
    treasury: TreasuryAccount
    lines: PayrollLineInput[]
    notes: string
  }) => PayrollRun
}

const nextId = <T extends { id: number }>(arr: T[]) => arr.reduce((m, x) => Math.max(m, x.id), 0) + 1

export const useDataStore = create<DataState>()(
  persist(
    (set, get) => ({
      seeded: false,
      items: [],
      categories: [],
      warehouses: [],
      customers: [],
      suppliers: [],
      employees: [],
      payrollRuns: [],
      purchases: [],
      purchaseReturns: [],
      stocktakes: [],
      vouchers: [],
      sales: [],
      saleReturns: [],
      shifts: [],
      journal: [],

      seed: (activityFeatures) => {
        if (get().seeded) return
        set({
          seeded: true,
          categories: [{ id: 1, nameAr: 'عام', parentId: null, features: activityFeatures }],
          warehouses: [{ id: 1, nameAr: 'المخزن الرئيسي', isMain: true }],
        })
      },

      addItem: (item) => set((s) => ({ items: [...s.items, { ...item, id: nextId(s.items) }] })),
      updateItem: (id, patch) =>
        set((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),

      addCategory: (nameAr, features, parentId = null) =>
        set((s) => ({ categories: [...s.categories, { id: nextId(s.categories), nameAr, parentId, features }] })),
      updateCategory: (id, patch) =>
        set((s) => ({ categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeCategory: (id) =>
        set((s) => {
          // لا يُحذف قسم فيه أصناف أو له أقسام فرعية
          const hasItems = s.items.some((it) => it.categoryId === id)
          const hasChildren = s.categories.some((c) => c.parentId === id)
          if (hasItems || hasChildren || s.categories.length === 1) return s
          return { categories: s.categories.filter((c) => c.id !== id) }
        }),

      postPurchase: (inv) => {
        const state = get()
        const costLines: CostLine[] = inv.lines.map((l) => ({
          itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor,
        }))
        const landed = computeLandedCosts(costLines, inv.expenses as ExpenseInput[])
        const goodsTotal = landed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
        const expensesTotal = inv.expenses.reduce((a, e) => a + e.amountMinor, 0)
        const grandTotal = goodsTotal + expensesTotal

        // القيد المحاسبي: مخزون مدين / خزينة + موردون دائن (يرمي لو المدفوع > الإجمالي)
        const entryLines = buildPurchaseEntry(grandTotal, inv.paidMinor)
        const purchaseId = nextId(state.purchases)
        const entryId = nextId(state.journal)
        const invoiceNumber = `P-${String(purchaseId).padStart(4, '0')}`
        const nowIso = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: inv.date,
          description: `فاتورة شراء ${invoiceNumber}`,
          sourceType: 'purchase',
          sourceId: purchaseId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: nowIso,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const invoice: PurchaseInvoice = {
          id: purchaseId,
          invoiceNumber,
          supplierId: inv.supplierId,
          date: inv.date,
          lines: landed.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            unitPriceMinor: l.unitPriceMinor,
            expenseShareMinor: l.expenseShareMinor,
            landedUnitCostMinor: l.landedUnitCostMinor,
          })),
          expenses: inv.expenses,
          goodsTotalMinor: goodsTotal,
          expensesTotalMinor: expensesTotal,
          grandTotalMinor: grandTotal,
          paidMinor: inv.paidMinor,
          notes: inv.notes,
          journalEntryId: entryId,
        }

        // تحديث تكلفة الأصناف بالمتوسط المرجح + زيادة المخزون
        const updatedItems = state.items.map((it) => {
          const line = landed.find((l) => l.itemId === it.id)
          if (!line) return it
          const newCost = weightedAverage(it.stockQty ?? 0, it.costMinor, line.qty, line.landedTotalMinor)
          return { ...it, costMinor: newCost, stockQty: (it.stockQty ?? 0) + line.qty }
        })

        set({ purchases: [...state.purchases, invoice], journal: [...state.journal, entry], items: updatedItems })
        return invoice
      },

      postSale: (args) => {
        const state = get()
        // 1) فحص المخزون
        if (!args.allowNegativeStock) {
          const shortages = checkStock(args.lines, (id) => state.items.find((it) => it.id === id)?.stockQty ?? 0)
          if (shortages.length) {
            const msg = shortages.map((s) => `«${s.nameAr}»: متاح ${s.available} ومطلوب ${s.requested}`).join('، ')
            throw new Error(`مخزون غير كافٍ — ${msg}`)
          }
        }
        // 2) الإجماليات والقيد (يرمي UnbalancedEntryError لو اختل — مستحيل بنيوياً)
        const totals = computeTotals(args.lines, args.invoiceDiscountPercent, args.taxPercent, args.taxInclusive)
        const entryLines = buildSaleEntry(totals, args.payment)
        const saleId = nextId(state.sales)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const invoiceNumber = `S-${String(saleId).padStart(4, '0')}`

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `فاتورة بيع ${invoiceNumber}`,
          sourceType: 'sale',
          sourceId: saleId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const sale: SaleInvoice = {
          id: saleId,
          invoiceNumber,
          date: now,
          customerId: args.customerId,
          payment: args.payment,
          lines: args.lines,
          invoiceDiscountPercent: args.invoiceDiscountPercent,
          totals,
          journalEntryId: entryId,
          expiryOverrideBy: args.expiryOverrideBy ?? null,
          shiftId: currentOpenShift(state.shifts)?.id ?? null,
        }

        // 3) خصم المخزون
        const qtyByItem = new Map<number, number>()
        for (const l of args.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyByItem.has(it.id) ? { ...it, stockQty: (it.stockQty ?? 0) - qtyByItem.get(it.id)! } : it,
        )

        set({ sales: [...state.sales, sale], journal: [...state.journal, entry], items: updatedItems })
        return sale
      },

      postSaleReturn: (args) => {
        const state = get()
        const sale = state.sales.find((s) => s.id === args.saleId)
        if (!sale) throw new Error('الفاتورة الأصلية غير موجودة')
        if (args.refund === 'credit' && sale.customerId === null) {
          throw new Error('فاتورة عميل نقدي — الاسترداد نقدي فقط')
        }
        // 1) بناء سطور المرتجع بنفس أسعار وخصومات الأصل، مع منع تجاوز المتبقي
        const priorLines = state.saleReturns.filter((r) => r.saleId === sale.id).flatMap((r) => r.lines)
        const lines = buildReturnLines(sale.lines, priorLines, args.qtyByItem)
        // 2) نفس المعاملة الضريبية وقت البيع (حتى لو تغيرت الإعدادات لاحقاً)
        const { taxPercent, taxInclusive } = deriveTaxConfig(sale.totals)
        const totals = computeTotals(lines, sale.invoiceDiscountPercent, taxPercent, taxInclusive)
        // 3) القيد العاكس المتوازن
        const entryLines = buildReturnEntry(totals, args.refund)
        const returnId = nextId(state.saleReturns)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const returnNumber = `R-${String(returnId).padStart(4, '0')}`

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `مرتجع مبيعات ${returnNumber} عن الفاتورة ${sale.invoiceNumber}`,
          sourceType: 'sale_return',
          sourceId: returnId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const ret: SaleReturn = {
          id: returnId,
          returnNumber,
          date: now,
          saleId: sale.id,
          refund: args.refund,
          lines,
          totals,
          journalEntryId: entryId,
          reason: args.reason,
          shiftId: currentOpenShift(state.shifts)?.id ?? null,
        }

        // 4) عودة البضاعة للمخزون
        const qtyBack = new Map<number, number>()
        for (const l of lines) qtyBack.set(l.itemId, (qtyBack.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyBack.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) + qtyBack.get(it.id)!) * 1000) / 1000 } : it,
        )

        set({ saleReturns: [...state.saleReturns, ret], journal: [...state.journal, entry], items: updatedItems })
        return ret
      },

      postPurchaseReturn: (args) => {
        const state = get()
        const purchase = state.purchases.find((p) => p.id === args.purchaseId)
        if (!purchase) throw new Error('فاتورة الشراء الأصلية غير موجودة')
        // 1) سطور المرتجع بتكلفة الوحدة النهائية — بلا تجاوز للمتبقي ولا للمخزون
        const prior = state.purchaseReturns.filter((r) => r.purchaseId === purchase.id).flatMap((r) => r.lines)
        const lines = buildPurchaseReturnLines(
          purchase.lines, prior, args.qtyByItem,
          (id) => {
            const it = state.items.find((x) => x.id === id)
            return it ? { nameAr: it.nameAr, stockQty: it.stockQty ?? 0 } : undefined
          },
        )
        const total = purchaseReturnTotal(lines)
        // منطق الاسترداد: لا نخفض ديناً أكبر من المتبقي غير المدفوع على الفاتورة
        if (args.refund === 'debt') {
          const priorDebtReturns = state.purchaseReturns
            .filter((r) => r.purchaseId === purchase.id && r.refund === 'debt')
            .reduce((a, r) => a + r.totalMinor, 0)
          const unpaid = purchase.grandTotalMinor - purchase.paidMinor - priorDebtReturns
          if (total > unpaid) {
            throw new Error(`قيمة المرتجع أكبر من دين الفاتورة المتبقي (${unpaid}) — اختر الاسترداد النقدي`)
          }
        }
        // 2) القيد المتوازن
        const entryLines = buildPurchaseReturnEntry(total, args.refund)
        const returnId = nextId(state.purchaseReturns)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const returnNumber = `PR-${String(returnId).padStart(4, '0')}`
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `مرتجع شراء ${returnNumber} عن الفاتورة ${purchase.invoiceNumber}`,
          sourceType: 'purchase_return',
          sourceId: returnId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        const ret: PurchaseReturn = {
          id: returnId,
          returnNumber,
          date: now,
          purchaseId: purchase.id,
          refund: args.refund,
          lines,
          totalMinor: total,
          journalEntryId: entryId,
          reason: args.reason,
        }
        // 3) خصم الكميات من المخزون (التكلفة المتوسطة تبقى كما هي — الإخراج بالمتوسط)
        const qtyOut = new Map<number, number>()
        for (const l of lines) qtyOut.set(l.itemId, (qtyOut.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyOut.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) - qtyOut.get(it.id)!) * 1000) / 1000 } : it,
        )
        set({ purchaseReturns: [...state.purchaseReturns, ret], journal: [...state.journal, entry], items: updatedItems })
        return ret
      },

      postStocktake: (counts, notes) => {
        const state = get()
        if (!counts.length) throw new Error('لا أصناف في الجرد')
        const result = computeStocktake(counts)
        const stocktakeId = nextId(state.stocktakes)
        const now = new Date().toISOString()
        const stocktakeNumber = `ST-${String(stocktakeId).padStart(4, '0')}`

        let entryId: number | null = null
        let journal = state.journal
        if (result.variances.length > 0) {
          // قيد تسوية واحد متوازن للعجز والزيادة معاً
          const entryLines = buildAdjustmentEntry(result)
          entryId = nextId(state.journal)
          const entry: JournalEntry = {
            id: entryId,
            entryNumber: entryId,
            date: now.slice(0, 10),
            description: `تسوية جرد ${stocktakeNumber}`,
            sourceType: 'adjustment',
            sourceId: stocktakeId,
            lines: entryLines,
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          }
          journal = [...state.journal, entry]
        }

        const st: Stocktake = {
          id: stocktakeId,
          stocktakeNumber,
          date: now,
          result,
          countedItems: counts.length,
          journalEntryId: entryId,
          notes,
        }

        // ضبط المخزون على المعدود فعلياً
        const countedBy = new Map(counts.map((c) => [c.itemId, c.countedQty]))
        const updatedItems = state.items.map((it) =>
          countedBy.has(it.id) ? { ...it, stockQty: countedBy.get(it.id)! } : it,
        )

        set({ stocktakes: [...state.stocktakes, st], journal, items: updatedItems })
        return st
      },

      postVoucher: (args) => {
        const state = get()
        // القيد حسب نوع السند — كله عبر دوال النواة المتوازنة بنيوياً
        const entryLines =
          args.kind === 'receipt'
            ? buildReceiptVoucherEntry(args.treasury, args.counterAccountCode, args.amountMinor, args.description)
            : args.kind === 'payment'
              ? buildPaymentVoucherEntry(args.treasury, args.counterAccountCode, args.amountMinor, args.description)
              : buildTransferEntry(args.treasury, args.counterAccountCode as TreasuryAccount, args.amountMinor, args.description)

        const voucherId = nextId(state.vouchers)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const prefix = args.kind === 'receipt' ? 'RV' : args.kind === 'payment' ? 'PV' : 'TV'
        const voucherNumber = `${prefix}-${String(voucherId).padStart(4, '0')}`
        const kindAr = args.kind === 'receipt' ? 'سند قبض' : args.kind === 'payment' ? 'سند صرف' : 'تحويل خزينة'

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `${kindAr} ${voucherNumber}${args.description ? ` — ${args.description}` : ''}`,
          sourceType: args.kind === 'receipt' ? 'receipt_voucher' : 'payment_voucher',
          sourceId: voucherId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const voucher: Voucher = {
          id: voucherId,
          voucherNumber,
          kind: args.kind,
          date: now,
          treasury: args.treasury,
          counterAccountCode: args.counterAccountCode,
          amountMinor: args.amountMinor,
          description: args.description,
          journalEntryId: entryId,
        }

        set({ vouchers: [...state.vouchers, voucher], journal: [...state.journal, entry] })
        return voucher
      },

      postManualEntry: (args) => {
        const state = get()
        const errors = validateManualEntry(args.lines, STANDARD_COA)
        if (errors.length) throw new Error(errors.join('، '))
        const meaningful = args.lines.filter((l) => l.debit !== 0 || l.credit !== 0)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: args.date || now.slice(0, 10),
          description: args.description || `قيد يدوي #${entryId}`,
          sourceType: 'manual',
          sourceId: null,
          lines: meaningful,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        set({ journal: [...state.journal, entry] })
        return entry
      },

      reverseEntry: (entryId, reason) => {
        const state = get()
        const original = state.journal.find((e) => e.id === entryId)
        if (!original) throw new Error('القيد غير موجود')
        if (original.reversedByEntryId) throw new Error('القيد معكوس بالفعل — لا يُعكس مرتين')
        if (original.reversesEntryId) throw new Error('لا يُعكس قيد عاكس — عد للقيد الأصلي')
        const newId = nextId(state.journal)
        const now = new Date().toISOString()
        const reversal: JournalEntry = {
          id: newId,
          entryNumber: newId,
          date: now.slice(0, 10),
          description: `عكس القيد #${original.entryNumber}${reason ? ` — ${reason}` : ''}`,
          sourceType: 'reversal',
          sourceId: original.id,
          lines: buildReversalLines(original.lines),
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: original.id,
        }
        set({
          journal: [
            ...state.journal.map((e) => (e.id === original.id ? { ...e, reversedByEntryId: newId } : e)),
            reversal,
          ],
        })
        return reversal
      },

      openShift: (openedBy, openingCashMinor) => {
        const state = get()
        const errors = validateOpenShift(openingCashMinor, state.shifts)
        if (errors.length) throw new Error(errors.join('، '))
        const shift: Shift = {
          id: nextId(state.shifts),
          openedAt: new Date().toISOString(),
          openedBy,
          openingCashMinor,
          closedAt: null,
          countedCashMinor: null,
          status: 'open',
        }
        set({ shifts: [...state.shifts, shift] })
        return shift
      },

      closeShift: (countedCashMinor) => {
        const state = get()
        const open = currentOpenShift(state.shifts)
        if (!open) throw new Error('لا وردية مفتوحة')
        if (countedCashMinor < 0) throw new Error('النقدية المعدودة لا تكون سالبة')
        const closed: Shift = { ...open, closedAt: new Date().toISOString(), countedCashMinor, status: 'closed' }
        set({ shifts: state.shifts.map((s) => (s.id === open.id ? closed : s)) })
        return closed
      },

      addWarehouse: (nameAr) =>
        set((s) => ({ warehouses: [...s.warehouses, { id: nextId(s.warehouses), nameAr, isMain: false }] })),
      removeWarehouse: (id) =>
        set((s) => ({ warehouses: s.warehouses.filter((w) => w.id !== id || w.isMain) })),

      addCustomer: (c) => set((s) => ({ customers: [...s.customers, { ...c, id: nextId(s.customers) }] })),
      updateCustomer: (id, patch) =>
        set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeCustomer: (id) => set((s) => ({ customers: s.customers.filter((c) => c.id !== id) })),

      addSupplier: (sup) => set((s) => ({ suppliers: [...s.suppliers, { ...sup, id: nextId(s.suppliers) }] })),
      updateSupplier: (id, patch) =>
        set((s) => ({ suppliers: s.suppliers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeSupplier: (id) => set((s) => ({ suppliers: s.suppliers.filter((x) => x.id !== id) })),

      addEmployee: (e) => set((s) => ({ employees: [...s.employees, { ...e, id: nextId(s.employees) }] })),
      updateEmployee: (id, patch) =>
        set((s) => ({ employees: s.employees.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeEmployee: (id) => {
        const used = get().payrollRuns.some((r) => r.lines.some((l) => l.employeeId === id))
        if (used) throw new Error('لا يمكن حذف موظف له مسيرات رواتب مرحّلة — أوقف حالته «على رأس العمل» بدلاً من الحذف')
        set((s) => ({ employees: s.employees.filter((x) => x.id !== id) }))
      },

      postPayroll: (args) => {
        const state = get()
        // 1) حساب كل سطر بالنواة الخالصة (يرمي لو صافي سطر سالب)
        const computed: PayrollLineComputed[] = args.lines.map(computePayrollLine)
        // 2) تحقق شامل قبل أي كتابة
        const errors = validatePayrollRun({
          month: args.month,
          lines: computed,
          existingMonths: state.payrollRuns.map((r) => r.month),
        })
        if (errors.length) throw new Error(errors.join(' — '))

        const totals: PayrollTotals = computePayrollTotals(computed)
        const label = monthLabelAr(args.month)
        // 3) القيد المتوازن بنيوياً
        const entryLines = buildPayrollEntry(totals.netMinor, args.payMode, args.treasury, label)

        const runId = nextId(state.payrollRuns)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const runNumber = `SAL-${String(runId).padStart(4, '0')}`

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `مسير رواتب ${runNumber} — ${label} (${totals.employeeCount} موظف)${args.notes ? ` — ${args.notes}` : ''}`,
          sourceType: 'payroll',
          sourceId: runId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const run: PayrollRun = {
          id: runId,
          runNumber,
          month: args.month,
          date: now,
          payMode: args.payMode,
          treasury: args.treasury,
          lines: computed,
          totals,
          journalEntryId: entryId,
          notes: args.notes,
        }

        set({ payrollRuns: [...state.payrollRuns, run], journal: [...state.journal, entry] })
        return run
      },
    }),
    {
      name: 'shopsys-data',
      version: 6,
      // ترحيل البيانات المحفوظة بالأشكال القديمة (أقسام هرمية، stockQty، مرتجعات وورديات وجرد)
      migrate: (persisted: unknown) => {
        const s = persisted as Partial<DataState>
        return {
          ...s,
          categories: (s.categories ?? []).map((c) => ({ ...c, parentId: c.parentId ?? null })),
          items: (s.items ?? []).map((it) => ({ ...it, stockQty: it.stockQty ?? 0 })),
          customers: (s.customers ?? []).map((c) => ({ ...EMPTY_EXTENDED, ...c })),
          suppliers: (s.suppliers ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          employees: (s.employees ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          payrollRuns: s.payrollRuns ?? [],
          purchases: (s.purchases ?? []).map((p) => ({ ...p, journalEntryId: p.journalEntryId ?? null })),
          purchaseReturns: s.purchaseReturns ?? [],
          stocktakes: s.stocktakes ?? [],
          vouchers: s.vouchers ?? [],
          sales: (s.sales ?? []).map((x) => ({ ...x, shiftId: x.shiftId ?? null })),
          saleReturns: s.saleReturns ?? [],
          shifts: s.shifts ?? [],
          journal: s.journal ?? [],
        } as DataState
      },
    },
  ),
)
