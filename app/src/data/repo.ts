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
import { buildSchedule, applyPayment, planProgress, type InstallmentItem } from '../core/installments.ts'
import { validateTrip, computeTripTotals, buildTripEntry, type TripInput, type TripTotals } from '../core/logistics.ts'
import { validateRental, computeRentalTotals, buildRentalOpenEntry, buildRentalCloseEntry, type RentalInput, type RentalTotals } from '../core/rental.ts'
import { validateTicket, validateDelivery, computeTicketTotals, buildTicketDeliveryEntry, TICKET_TRANSITIONS, type TicketStatus, type TicketDeliveryInput, type TicketTotals } from '../core/maintenance.ts'
import { validateTransfer, computeWarehouseStock, transferTotalQty, type TransferLine } from '../core/transfers.ts'
import { planFefo, applyFefo, isValidExpiryDate, ExpiredStockError, type StockBatch } from '../core/batches.ts'
import { validateAsset, buildAssetPurchaseEntry, buildDepreciationEntry, monthlyDepreciation, nextDepreciationMonth, type AssetInput } from '../core/assets.ts'
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

/**
 * خطة أقساط لعميل — الذمة أصلها قائم من فاتورة بيع آجلة (1104)،
 * فالخطة جدولة للتحصيل فقط: إنشاؤها لا يولّد قيداً إلا للمقدم إن وُجد،
 * وكل سداد يولّد قيده: من ح/ الخزينة → إلى ح/ العملاء
 */
export interface InstallmentPlan {
  id: number
  planNumber: string // INS-0001
  customerId: number
  saleId: number | null // الفاتورة الآجلة المرتبطة (اختياري)
  createdAt: string
  totalMinor: number // إجمالي المديونية المجدولة
  downPaymentMinor: number
  items: InstallmentItem[]
  downPaymentEntryId: number | null // قيد المقدم إن وُجد
  notes: string
}

/** مركبة في أسطول النقل (المرحلة 6 — نمط logistics-web) */
export interface Vehicle {
  id: number
  plateNumber: string
  vehicleType: string // تريلا، قلاب، دينا…
  defaultDriverId: number | null // سائق افتراضي (من الموظفين)
  notes: string
}

/** نقلة مرحّلة — وحدة العمل في اللوجستيات، مربوطة بقيدها (القرار 13) */
export interface Trip {
  id: number
  tripNumber: string // TR-0001
  date: string // ISO
  customerId: number | null // null = عميل نقدي
  vehicleId: number | null
  driverId: number | null // موظف بنوع سائق
  fromLoc: string
  toLoc: string
  qty: number
  unitPriceMinor: number
  payment: 'cash' | 'credit'
  vatPercent: number
  containerNumbers: string[]
  expenses: { nameAr: string; qty: number; unitAmountMinor: number; source: 'cash' | 'customer' | 'credit'; amountMinor: number }[]
  totals: TripTotals
  journalEntryId: number
  notes: string
}

/** معدة ثقيلة قابلة للإيجار (المرحلة 6 — القرار 13) */
export interface Equipment {
  id: number
  nameAr: string // حفار، لودر، ونش…
  code: string // كود/لوحة اختياري
  dailyRateMinor: number // السعر اليومي الافتراضي
  notes: string
}

/** عقد إيجار معدة — مربوط بقيد الفتح، وقيد الإقفال عند ردّ التأمين */
export interface RentalContract {
  id: number
  contractNumber: string // RC-0001
  date: string // ISO
  customerId: number | null // null = عميل نقدي
  equipmentId: number | null
  equipmentName: string
  days: number
  dailyRateMinor: number
  payment: 'cash' | 'credit'
  vatPercent: number
  totals: RentalTotals
  status: 'active' | 'closed'
  openEntryId: number
  closeEntryId: number | null // null = لم يُقفل أو لا تأمين
  deductMinor: number // المخصوم من التأمين عند الإقفال
  notes: string
}

/** أصل ثابت — اقتناء بقيد، وإهلاك شهري بالقسط الثابت (مواصفة Easy Store) */
export interface FixedAsset {
  id: number
  assetNumber: string // FA-0001
  nameAr: string
  purchaseDate: string // ISO
  purchaseMonth: string // YYYY-MM (بداية جدول الإهلاك)
  costMinor: number
  salvageMinor: number
  lifeMonths: number
  monthsDepreciated: number // كم شهراً رُحّل إهلاكه
  purchaseEntryId: number
  notes: string
}

/** تحويل مخزني مرحّل — حركة داخلية بلا قيد (لا تغيّر قيمة 1103) */
export interface StockTransfer {
  id: number
  transferNumber: string // TRF-0001
  date: string // ISO
  fromWarehouseId: number
  toWarehouseId: number
  lines: { itemId: number; nameAr: string; qty: number }[]
  totalQty: number
  notes: string
}

/** أمر صيانة (تذكرة) — جهاز وعطل بحالات، وقيد التسليم عند القبض (المرحلة 6) */
export interface MaintenanceTicket {
  id: number
  ticketNumber: string // MT-0001
  date: string // ISO (تاريخ الاستلام)
  customerId: number | null // null = عميل نقدي
  customerName: string // اسم حر عند عدم التسجيل
  customerPhone: string
  deviceName: string
  issue: string
  estimateMinor: number // تقدير مبدئي يُتفق عليه عند الاستلام (0 = بلا)
  status: TicketStatus
  statusHistory: { status: TicketStatus; at: string }[]
  // تُملأ عند التسليم فقط:
  parts: { itemId: number; nameAr: string; qty: number; unitPriceMinor: number; unitCostMinor: number }[]
  totals: TicketTotals | null
  payment: 'cash' | 'credit' | null
  journalEntryId: number | null
  deliveredAt: string | null
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
  installmentPlans: InstallmentPlan[]
  vehicles: Vehicle[]
  trips: Trip[]
  equipment: Equipment[]
  rentalContracts: RentalContract[]
  tickets: MaintenanceTicket[]
  transfers: StockTransfer[]
  batches: StockBatch[] // دفعات الصلاحية FEFO (القراران 5 و8)
  assets: FixedAsset[]
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
    lines: { itemId: number; qty: number; unitPriceMinor: number; expiryDate?: string | null }[]
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
  /**
   * إنشاء خطة أقساط لعميل: جدول بتوزيع «أكبر البواقي»،
   * المقدم (إن وُجد) يولّد قيد تحصيل فوري: خزينة ← عملاء
   */
  createInstallmentPlan: (args: {
    customerId: number
    saleId: number | null
    totalMinor: number
    downPaymentMinor: number
    count: number
    intervalMonths: number
    firstDueDate: string
    treasury: TreasuryAccount
    notes: string
  }) => InstallmentPlan
  /** سداد دفعة على خطة: توزَّع على الأقساط الأقدم أولاً + قيد تحصيل متوازن */
  payInstallment: (planId: number, amountMinor: number, treasury: TreasuryAccount) => InstallmentPlan
  addVehicle: (v: Omit<Vehicle, 'id'>) => void
  updateVehicle: (id: number, patch: Partial<Vehicle>) => void
  removeVehicle: (id: number) => void
  /**
   * ترحيل نقلة (المرحلة 6): تحقق شامل ← حساب الإجماليات بالنواة الخالصة ←
   * قيد واحد متوازن بنيوياً (4105 إيراد / 5106 مصاريف / 2102 ضريبة)
   */
  postTrip: (args: {
    customerId: number | null
    vehicleId: number | null
    driverId: number | null
    input: TripInput
    notes: string
  }) => Trip
  addEquipment: (e: Omit<Equipment, 'id'>) => void
  updateEquipment: (id: number, patch: Partial<Equipment>) => void
  removeEquipment: (id: number) => void
  /**
   * فتح عقد إيجار (المرحلة 6): تحقق ← إجماليات ← قيد فتح متوازن
   * (تحصيل مقابل 4104 إيراد + 2102 ضريبة + 2103 تأمين كالتزام)
   */
  openRental: (args: {
    customerId: number | null
    equipmentId: number | null
    input: RentalInput
    notes: string
  }) => RentalContract
  /** إقفال عقد: ردّ التأمين نقداً مع خصم اختياري يُعترف به إيراداً (4104) */
  closeRental: (contractId: number, deductMinor: number) => RentalContract
  /** فتح تذكرة صيانة — لا قيد عند الاستلام (لا التزام مالي بعد) */
  openTicket: (args: {
    customerId: number | null
    customerName: string
    customerPhone: string
    deviceName: string
    issue: string
    estimateMinor: number
    notes: string
  }) => MaintenanceTicket
  /** نقل حالة التذكرة وفق الانتقالات المسموحة (مع سجل الحالات) */
  setTicketStatus: (ticketId: number, status: TicketStatus) => MaintenanceTicket
  /**
   * تسليم التذكرة (المرحلة 6): تحقق ← إجماليات ← قيد متوازن
   * (تحصيل مقابل 4103 إيراد صيانة + 2102 ضريبة، وقطع الغيار 5101/1103
   * بمتوسط التكلفة المرجح — القرار 14) + إنقاص مخزون القطع
   */
  deliverTicket: (ticketId: number, input: Omit<TicketDeliveryInput, 'parts'> & {
    parts: { itemId: number; qty: number; unitPriceMinor: number }[]
  }) => MaintenanceTicket
  /** ترحيل تحويل مخزني: تحقق ضد رصيد المخزن المصدر — بلا قيد (حركة داخلية) */
  postTransfer: (args: { fromWarehouseId: number; toWarehouseId: number; lines: TransferLine[]; notes: string }) => StockTransfer
  /** اقتناء أصل ثابت: قيد 1201 / 1101 + 2101 وترقيم FA-#### */
  addAsset: (args: AssetInput & { notes: string }) => FixedAsset
  /** ترحيل إهلاك شهر واحد لكل الأصول المستحقة — قيد مجمع واحد 5107/1202 */
  postMonthlyDepreciation: () => { entry: JournalEntry; totalMinor: number; assetCount: number }
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
      installmentPlans: [],
      vehicles: [],
      trips: [],
      equipment: [],
      rentalContracts: [],
      tickets: [],
      transfers: [],
      batches: [],
      assets: [],
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
        // تحقق تواريخ الصلاحية للأصناف المتتبَّعة (القرار 5) قبل أي كتابة
        for (const l of inv.lines) {
          const item = state.items.find((it) => it.id === l.itemId)
          if (item?.trackExpiry && l.expiryDate && !isValidExpiryDate(l.expiryDate)) {
            throw new Error(`تاريخ صلاحية غير صحيح لـ«${item.nameAr}» — الصيغة YYYY-MM-DD`)
          }
        }
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

        // فتح دفعات صلاحية للأصناف المتتبَّعة (FEFO — القرار 5)
        let batchId = nextId(state.batches)
        const newBatches: StockBatch[] = []
        for (const l of inv.lines) {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item?.trackExpiry) continue
          newBatches.push({
            id: batchId++,
            itemId: l.itemId,
            expiryDate: l.expiryDate ?? null,
            qty: l.qty,
            purchaseId: purchaseId,
            receivedAt: nowIso,
          })
        }

        set({
          purchases: [...state.purchases, invoice],
          journal: [...state.journal, entry],
          items: updatedItems,
          batches: newBatches.length ? [...state.batches, ...newBatches] : state.batches,
        })
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
        // 2) دفعات الصلاحية FEFO (القراران 5 و8): تخطيط الصرف وحظر المنتهي بلا تجاوز مدير
        const now0 = new Date().toISOString()
        const qtyPlanned = new Map<number, number>()
        for (const l of args.lines) qtyPlanned.set(l.itemId, (qtyPlanned.get(l.itemId) ?? 0) + l.qty)
        let workingBatches = state.batches
        const expiredNames: string[] = []
        for (const [itemId, qty] of qtyPlanned) {
          const item = state.items.find((it) => it.id === itemId)
          if (!item?.trackExpiry) continue
          const plan = planFefo(workingBatches, itemId, qty, now0)
          if (plan.touchesExpired && !args.expiryOverrideBy) expiredNames.push(item.nameAr)
          workingBatches = applyFefo(workingBatches, plan)
        }
        if (expiredNames.length) throw new ExpiredStockError(expiredNames)

        // 3) الإجماليات والقيد (يرمي UnbalancedEntryError لو اختل — مستحيل بنيوياً)
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

        // 4) خصم المخزون (والدفعات المحدثة بعد صرف FEFO)
        const qtyByItem = new Map<number, number>()
        for (const l of args.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyByItem.has(it.id) ? { ...it, stockQty: (it.stockQty ?? 0) - qtyByItem.get(it.id)! } : it,
        )

        set({ sales: [...state.sales, sale], journal: [...state.journal, entry], items: updatedItems, batches: workingBatches })
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
      removeWarehouse: (id) => {
        const used = get().transfers.some((t) => t.fromWarehouseId === id || t.toWarehouseId === id)
        if (used) throw new Error('لا يمكن حذف مخزن له تحويلات مسجلة — احتفظ به للسجل')
        set((s) => ({ warehouses: s.warehouses.filter((w) => w.id !== id || w.isMain) }))
      },

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

      createInstallmentPlan: (args) => {
        const state = get()
        if (!state.customers.some((c) => c.id === args.customerId)) throw new Error('العميل غير موجود')
        // 1) الجدول بالنواة الخالصة (ترمي لو المدخلات غير سليمة)
        const items = buildSchedule({
          totalMinor: args.totalMinor,
          downPaymentMinor: args.downPaymentMinor,
          count: args.count,
          intervalMonths: args.intervalMonths,
          firstDueDate: args.firstDueDate,
        })
        const planId = nextId(state.installmentPlans)
        const now = new Date().toISOString()
        const planNumber = `INS-${String(planId).padStart(4, '0')}`
        const customerName = state.customers.find((c) => c.id === args.customerId)?.nameAr ?? ''

        // 2) قيد المقدم إن وُجد: تحصيل فوري من الذمة (خزينة ← عملاء)
        let downPaymentEntryId: number | null = null
        const journal = [...state.journal]
        if (args.downPaymentMinor > 0) {
          const entryId = nextId(state.journal)
          const entryLines = buildReceiptVoucherEntry(args.treasury, '1104', args.downPaymentMinor, `مقدم خطة أقساط ${planNumber}`)
          journal.push({
            id: entryId,
            entryNumber: entryId,
            date: now.slice(0, 10),
            description: `مقدم خطة أقساط ${planNumber} — ${customerName}`,
            sourceType: 'receipt_voucher',
            sourceId: planId,
            lines: entryLines,
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          })
          downPaymentEntryId = entryId
        }

        const plan: InstallmentPlan = {
          id: planId,
          planNumber,
          customerId: args.customerId,
          saleId: args.saleId,
          createdAt: now,
          totalMinor: args.totalMinor,
          downPaymentMinor: args.downPaymentMinor,
          items,
          downPaymentEntryId,
          notes: args.notes,
        }
        set({ installmentPlans: [...state.installmentPlans, plan], journal })
        return plan
      },

      payInstallment: (planId, amountMinor, treasury) => {
        const state = get()
        const plan = state.installmentPlans.find((p) => p.id === planId)
        if (!plan) throw new Error('خطة الأقساط غير موجودة')
        const progress = planProgress(plan.items, new Date().toISOString().slice(0, 10))
        if (progress.finished) throw new Error('الخطة مسددة بالكامل')
        if (amountMinor > progress.remainingMinor) {
          throw new Error(`المبلغ أكبر من المتبقي على الخطة (${progress.remainingMinor})`)
        }
        const now = new Date().toISOString()
        // 1) توزيع الدفعة على الأقساط الأقدم أولاً (نواة خالصة)
        const { items } = applyPayment(plan.items, amountMinor, now)
        // 2) قيد التحصيل المتوازن: خزينة ← عملاء
        const entryId = nextId(state.journal)
        const entryLines = buildReceiptVoucherEntry(treasury, '1104', amountMinor, `سداد قسط ${plan.planNumber}`)
        const customerName = state.customers.find((c) => c.id === plan.customerId)?.nameAr ?? ''
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `تحصيل قسط ${plan.planNumber} — ${customerName}`,
          sourceType: 'receipt_voucher',
          sourceId: plan.id,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        const updated: InstallmentPlan = { ...plan, items }
        set({
          installmentPlans: state.installmentPlans.map((p) => (p.id === planId ? updated : p)),
          journal: [...state.journal, entry],
        })
        return updated
      },

      addVehicle: (v) => set((s) => ({ vehicles: [...s.vehicles, { ...v, id: nextId(s.vehicles) }] })),
      updateVehicle: (id, patch) =>
        set((s) => ({ vehicles: s.vehicles.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeVehicle: (id) => {
        const used = get().trips.some((t) => t.vehicleId === id)
        if (used) throw new Error('لا يمكن حذف مركبة لها نقلات مرحّلة')
        set((s) => ({ vehicles: s.vehicles.filter((x) => x.id !== id) }))
      },

      postTrip: (args) => {
        const state = get()
        // 1) تحقق شامل قبل أي كتابة
        const errors = validateTrip(args.input)
        if (args.customerId != null && !state.customers.some((c) => c.id === args.customerId)) errors.push('العميل غير موجود')
        if (args.input.payment === 'credit' && args.customerId == null) errors.push('النقلة الآجلة تتطلب عميلاً مسجلاً')
        if (errors.length) throw new Error(errors.join(' — '))

        // 2) الإجماليات والقيد بالنواة الخالصة
        const totals = computeTripTotals(args.input)
        const tripId = nextId(state.trips)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const tripNumber = `TR-${String(tripId).padStart(4, '0')}`
        const entryLines = buildTripEntry(totals, args.input.payment, tripNumber)

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `نقلة ${tripNumber} — ${args.input.fromLoc} ← ${args.input.toLoc}${args.notes ? ` — ${args.notes}` : ''}`,
          sourceType: 'logistics_trip',
          sourceId: tripId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const trip: Trip = {
          id: tripId,
          tripNumber,
          date: now,
          customerId: args.customerId,
          vehicleId: args.vehicleId,
          driverId: args.driverId,
          fromLoc: args.input.fromLoc.trim(),
          toLoc: args.input.toLoc.trim(),
          qty: args.input.qty,
          unitPriceMinor: args.input.unitPriceMinor,
          payment: args.input.payment,
          vatPercent: args.input.vatPercent,
          containerNumbers: args.input.containerNumbers.filter((c) => c.trim()),
          expenses: args.input.expenses.map((e) => ({ ...e, amountMinor: Math.round(e.unitAmountMinor * e.qty) })),
          totals,
          journalEntryId: entryId,
          notes: args.notes,
        }

        set({ trips: [...state.trips, trip], journal: [...state.journal, entry] })
        return trip
      },
      addEquipment: (e) => set((s) => ({ equipment: [...s.equipment, { ...e, id: nextId(s.equipment) }] })),
      updateEquipment: (id, patch) =>
        set((s) => ({ equipment: s.equipment.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeEquipment: (id) => {
        const used = get().rentalContracts.some((c) => c.equipmentId === id)
        if (used) throw new Error('لا يمكن حذف معدة مرتبطة بعقود — احتفظ بها للسجل')
        set((s) => ({ equipment: s.equipment.filter((x) => x.id !== id) }))
      },
      openRental: (args) => {
        const state = get()
        // 1) تحقق شامل قبل أي كتابة
        const errors = validateRental(args.input)
        if (args.customerId != null && !state.customers.some((c) => c.id === args.customerId)) errors.push('العميل غير موجود')
        if (args.input.payment === 'credit' && args.customerId == null) errors.push('الإيجار الآجل يتطلب عميلاً مسجلاً')
        if (errors.length) throw new Error(errors.join(' — '))

        // 2) الإجماليات وقيد الفتح بالنواة الخالصة
        const totals = computeRentalTotals(args.input)
        const contractId = nextId(state.rentalContracts)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const contractNumber = `RC-${String(contractId).padStart(4, '0')}`
        const entryLines = buildRentalOpenEntry(totals, contractNumber)

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `عقد إيجار ${contractNumber} — ${args.input.equipmentName} × ${args.input.days} يوم${args.notes ? ` — ${args.notes}` : ''}`,
          sourceType: 'rental_contract',
          sourceId: contractId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const contract: RentalContract = {
          id: contractId,
          contractNumber,
          date: now,
          customerId: args.customerId,
          equipmentId: args.equipmentId,
          equipmentName: args.input.equipmentName.trim(),
          days: args.input.days,
          dailyRateMinor: args.input.dailyRateMinor,
          payment: args.input.payment,
          vatPercent: args.input.vatPercent,
          totals,
          status: 'active',
          openEntryId: entryId,
          closeEntryId: null,
          deductMinor: 0,
          notes: args.notes,
        }

        set({ rentalContracts: [...state.rentalContracts, contract], journal: [...state.journal, entry] })
        return contract
      },
      closeRental: (contractId, deductMinor) => {
        const state = get()
        const contract = state.rentalContracts.find((c) => c.id === contractId)
        if (!contract) throw new Error('العقد غير موجود')
        if (contract.status === 'closed') throw new Error('العقد مُقفل بالفعل')

        // قيد الإقفال (null لو لا تأمين — يبقى العقد يُقفل بلا قيد)
        const closeLines = buildRentalCloseEntry(contract.totals.depositMinor, deductMinor, contract.contractNumber)
        const now = new Date().toISOString()
        let closeEntryId: number | null = null
        let journal = state.journal
        if (closeLines) {
          closeEntryId = nextId(state.journal)
          const entry: JournalEntry = {
            id: closeEntryId,
            entryNumber: closeEntryId,
            date: now.slice(0, 10),
            description: `إقفال عقد ${contract.contractNumber} — ردّ التأمين${deductMinor > 0 ? ' بعد خصم أضرار' : ''}`,
            sourceType: 'rental_contract',
            sourceId: contract.id,
            lines: closeLines,
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          }
          journal = [...state.journal, entry]
        }

        const updated: RentalContract = { ...contract, status: 'closed', closeEntryId, deductMinor }
        set({
          rentalContracts: state.rentalContracts.map((c) => (c.id === contractId ? updated : c)),
          journal,
        })
        return updated
      },
      openTicket: (args) => {
        const state = get()
        const errors = validateTicket({ deviceName: args.deviceName, issue: args.issue })
        if (args.customerId != null && !state.customers.some((c) => c.id === args.customerId)) errors.push('العميل غير موجود')
        if (!Number.isInteger(args.estimateMinor) || args.estimateMinor < 0) errors.push('التقدير المبدئي لا يكون سالباً')
        if (errors.length) throw new Error(errors.join(' — '))

        const id = nextId(state.tickets)
        const now = new Date().toISOString()
        const ticket: MaintenanceTicket = {
          id,
          ticketNumber: `MT-${String(id).padStart(4, '0')}`,
          date: now,
          customerId: args.customerId,
          customerName: args.customerName.trim(),
          customerPhone: args.customerPhone.trim(),
          deviceName: args.deviceName.trim(),
          issue: args.issue.trim(),
          estimateMinor: args.estimateMinor,
          status: 'received',
          statusHistory: [{ status: 'received', at: now }],
          parts: [],
          totals: null,
          payment: null,
          journalEntryId: null,
          deliveredAt: null,
          notes: args.notes.trim(),
        }
        set({ tickets: [...state.tickets, ticket] })
        return ticket
      },
      setTicketStatus: (ticketId, status) => {
        const state = get()
        const ticket = state.tickets.find((t) => t.id === ticketId)
        if (!ticket) throw new Error('التذكرة غير موجودة')
        if (status === 'delivered') throw new Error('التسليم يتم من شاشة التسليم (بقيد محاسبي)')
        if (!TICKET_TRANSITIONS[ticket.status].includes(status)) {
          throw new Error(`لا يمكن الانتقال من «${ticket.status}» إلى «${status}»`)
        }
        const updated: MaintenanceTicket = {
          ...ticket,
          status,
          statusHistory: [...ticket.statusHistory, { status, at: new Date().toISOString() }],
        }
        set({ tickets: state.tickets.map((t) => (t.id === ticketId ? updated : t)) })
        return updated
      },
      deliverTicket: (ticketId, input) => {
        const state = get()
        const ticket = state.tickets.find((t) => t.id === ticketId)
        if (!ticket) throw new Error('التذكرة غير موجودة')
        if (!TICKET_TRANSITIONS[ticket.status].includes('delivered')) {
          throw new Error('التسليم متاح للتذاكر الجاهزة فقط — انقلها إلى «جاهزة للتسليم» أولاً')
        }
        if (input.payment === 'credit' && ticket.customerId == null) {
          throw new Error('التسليم الآجل يتطلب عميلاً مسجلاً')
        }

        // 1) إثراء القطع بأسمائها ومتوسط تكلفتها المرجح وقت التسليم (القرار 14)
        const parts = input.parts.map((p) => {
          const item = state.items.find((it) => it.id === p.itemId)
          if (!item) throw new Error('قطعة غيار غير موجودة بالمخزون')
          if ((item.stockQty ?? 0) < p.qty) throw new Error(`المخزون لا يكفي من «${item.nameAr}» (المتاح ${item.stockQty ?? 0})`)
          return { itemId: p.itemId, nameAr: item.nameAr, qty: p.qty, unitPriceMinor: p.unitPriceMinor, unitCostMinor: item.costMinor }
        })

        // 2) تحقق وإجماليات وقيد بالنواة الخالصة
        const delivery: TicketDeliveryInput = { laborMinor: input.laborMinor, parts, payment: input.payment, vatPercent: input.vatPercent }
        const errors = validateDelivery(delivery)
        if (errors.length) throw new Error(errors.join(' — '))
        const totals = computeTicketTotals(delivery)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entryLines = buildTicketDeliveryEntry(totals, input.payment, ticket.ticketNumber)

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `تسليم صيانة ${ticket.ticketNumber} — ${ticket.deviceName}`,
          sourceType: 'maintenance_ticket',
          sourceId: ticket.id,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        // 3) إنقاص مخزون القطع المستهلكة
        const qtyByItem = new Map<number, number>()
        for (const p of parts) qtyByItem.set(p.itemId, (qtyByItem.get(p.itemId) ?? 0) + p.qty)
        const items = state.items.map((it) =>
          qtyByItem.has(it.id) ? { ...it, stockQty: (it.stockQty ?? 0) - qtyByItem.get(it.id)! } : it,
        )

        const updated: MaintenanceTicket = {
          ...ticket,
          status: 'delivered',
          statusHistory: [...ticket.statusHistory, { status: 'delivered', at: now }],
          parts,
          totals,
          payment: input.payment,
          journalEntryId: entryId,
          deliveredAt: now,
        }
        set({
          tickets: state.tickets.map((t) => (t.id === ticketId ? updated : t)),
          journal: [...state.journal, entry],
          items,
        })
        return updated
      },
      postTransfer: (args) => {
        const state = get()
        if (!state.warehouses.some((w) => w.id === args.fromWarehouseId)) throw new Error('المخزن المصدر غير موجود')
        if (!state.warehouses.some((w) => w.id === args.toWarehouseId)) throw new Error('المخزن المستقبل غير موجود')

        // 1) الأرصدة الحالية لكل المخازن ثم تحقق النواة الخالصة
        const stock = computeWarehouseStock(state.items, state.warehouses, state.transfers)
        const sourceMap = stock.get(args.fromWarehouseId)
        const errors = validateTransfer(
          { fromWarehouseId: args.fromWarehouseId, toWarehouseId: args.toWarehouseId, lines: args.lines },
          (itemId) => sourceMap?.get(itemId) ?? 0,
        )
        for (const l of args.lines) {
          if (!state.items.some((it) => it.id === l.itemId)) errors.push('صنف غير موجود بالمخزون')
        }
        if (errors.length) throw new Error(errors.join(' — '))

        // 2) مستند مرقّم — بلا قيد (حركة داخلية لا تغيّر قيمة 1103)
        const id = nextId(state.transfers)
        const transfer: StockTransfer = {
          id,
          transferNumber: `TRF-${String(id).padStart(4, '0')}`,
          date: new Date().toISOString(),
          fromWarehouseId: args.fromWarehouseId,
          toWarehouseId: args.toWarehouseId,
          lines: args.lines.map((l) => ({
            itemId: l.itemId,
            nameAr: state.items.find((it) => it.id === l.itemId)?.nameAr ?? '',
            qty: l.qty,
          })),
          totalQty: transferTotalQty(args.lines),
          notes: args.notes.trim(),
        }
        set({ transfers: [...state.transfers, transfer] })
        return transfer
      },
      addAsset: (args) => {
        const state = get()
        const errors = validateAsset(args)
        if (errors.length) throw new Error(errors.join(' — '))

        const id = nextId(state.assets)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const assetNumber = `FA-${String(id).padStart(4, '0')}`
        const entryLines = buildAssetPurchaseEntry(args.costMinor, args.paidMinor, assetNumber)

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `اقتناء أصل ${assetNumber} — ${args.nameAr.trim()}`,
          sourceType: 'manual',
          sourceId: id,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        const asset: FixedAsset = {
          id,
          assetNumber,
          nameAr: args.nameAr.trim(),
          purchaseDate: now,
          purchaseMonth: now.slice(0, 7),
          costMinor: args.costMinor,
          salvageMinor: args.salvageMinor,
          lifeMonths: args.lifeMonths,
          monthsDepreciated: 0,
          purchaseEntryId: entryId,
          notes: args.notes.trim(),
        }
        set({ assets: [...state.assets, asset], journal: [...state.journal, entry] })
        return asset
      },
      postMonthlyDepreciation: () => {
        const state = get()
        const nowMonth = new Date().toISOString().slice(0, 7)
        // الأصول المستحقة: لم يكتمل عمرها، وشهرها التالي ≤ الشهر الحالي (لا إهلاك مستقبلي)
        const due = state.assets.filter(
          (a) => a.monthsDepreciated < a.lifeMonths && nextDepreciationMonth(a.purchaseMonth, a.monthsDepreciated) <= nowMonth,
        )
        if (due.length === 0) throw new Error('لا إهلاك مستحقاً — كل الأصول مُهلَكة حتى هذا الشهر')

        let totalMinor = 0
        for (const a of due) totalMinor += monthlyDepreciation(a.costMinor, a.salvageMinor, a.lifeMonths, a.monthsDepreciated)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        // تسمية الشهر المرحّل: شهر أقدم استحقاق (كلها تتقدم شهراً واحداً)
        const monthLabel = due.map((a) => nextDepreciationMonth(a.purchaseMonth, a.monthsDepreciated)).sort()[0]
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `إهلاك شهري (${due.length} أصل) — ${monthLabel}`,
          sourceType: 'manual',
          sourceId: null,
          lines: buildDepreciationEntry(totalMinor, monthLabel),
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        const dueIds = new Set(due.map((a) => a.id))
        set({
          assets: state.assets.map((a) => (dueIds.has(a.id) ? { ...a, monthsDepreciated: a.monthsDepreciated + 1 } : a)),
          journal: [...state.journal, entry],
        })
        return { entry, totalMinor, assetCount: due.length }
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
          installmentPlans: s.installmentPlans ?? [],
          vehicles: s.vehicles ?? [],
          trips: s.trips ?? [],
          equipment: s.equipment ?? [],
          rentalContracts: s.rentalContracts ?? [],
          tickets: s.tickets ?? [],
          transfers: s.transfers ?? [],
          batches: s.batches ?? [],
          assets: s.assets ?? [],
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
