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
}

interface DataState {
  seeded: boolean
  items: Item[]
  categories: Category[]
  warehouses: Warehouse[]
  customers: Customer[]
  suppliers: Supplier[]
  purchases: PurchaseInvoice[]
  sales: SaleInvoice[]
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
  addWarehouse: (nameAr: string) => void
  removeWarehouse: (id: number) => void
  addCustomer: (c: Omit<Customer, 'id'>) => void
  updateCustomer: (id: number, patch: Partial<Customer>) => void
  removeCustomer: (id: number) => void
  addSupplier: (s: Omit<Supplier, 'id'>) => void
  updateSupplier: (id: number, patch: Partial<Supplier>) => void
  removeSupplier: (id: number) => void
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
      purchases: [],
      sales: [],
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

        const invoice: PurchaseInvoice = {
          id: nextId(state.purchases),
          invoiceNumber: `P-${String(nextId(state.purchases)).padStart(4, '0')}`,
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
          grandTotalMinor: goodsTotal + expensesTotal,
          paidMinor: inv.paidMinor,
          notes: inv.notes,
        }

        // تحديث تكلفة الأصناف بالمتوسط المرجح + زيادة المخزون
        const updatedItems = state.items.map((it) => {
          const line = landed.find((l) => l.itemId === it.id)
          if (!line) return it
          const newCost = weightedAverage(it.stockQty ?? 0, it.costMinor, line.qty, line.landedTotalMinor)
          return { ...it, costMinor: newCost, stockQty: (it.stockQty ?? 0) + line.qty }
        })

        set({ purchases: [...state.purchases, invoice], items: updatedItems })
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
    }),
    {
      name: 'shopsys-data',
      version: 2,
      // ترحيل البيانات المحفوظة بالشكل القديم (قبل الأقسام الهرمية وstockQty)
      migrate: (persisted: unknown) => {
        const s = persisted as Partial<DataState>
        return {
          ...s,
          categories: (s.categories ?? []).map((c) => ({ ...c, parentId: c.parentId ?? null })),
          items: (s.items ?? []).map((it) => ({ ...it, stockQty: it.stockQty ?? 0 })),
          customers: (s.customers ?? []).map((c) => ({ ...EMPTY_EXTENDED, ...c })),
          suppliers: (s.suppliers ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          purchases: s.purchases ?? [],
          sales: s.sales ?? [],
          journal: s.journal ?? [],
        } as DataState
      },
    },
  ),
)
