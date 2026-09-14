/**
 * طبقة البيانات — ShopSys
 * ─────────────────────────
 * (وثيقة التصميم — القرار 2: طبقة وصول بيانات مجرّدة)
 * اليوم: تخزين محلي في المتصفح للمعاينة الحية.
 * غداً: نفس هذه الواجهة تُنفَّذ فوق SQLite (better-sqlite3) في قشرة Electron،
 * ثم PostgreSQL للفروع — دون أي تغيير في الواجهات أو النواة.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { secureStorage } from './secureStorage.ts'
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
import { parseSerialsInput, markSold, markReturned, type SerialUnit } from '../core/serials.ts'
import { computeUsageBilling, buildExtraUsageEntry, validateOperatorShift, isValidMeterReading, type RateType, type OperatorShift } from '../core/rentalMeter.ts'
import { validateLabTest, validateReferrer, computeLabTotals, buildLabOrderEntry, commissionFor, buildCommissionAccrualEntry, buildCommissionPayoutEntry, canTransition, STARTER_TESTS, ageYears as ageYearsFn, matchRefRange as matchRefRangeFn, evaluateResult as evaluateResultFn, type LabTest, type Referrer, type TestStatus, type LabOrderTotals, type Gender } from '../core/lab.ts'
import {
  custodyFileNumber, validateCustodyFile, summarizeCustody, buildCustodyFundEntry,
  splitCustodyExpense, buildCustodyExpenseEntry, buildCustodySettleEntry as buildCustodyFileSettleEntry,
  assertFileOpen, CUSTODY_ACCOUNT,
  type CustodyFile, type CustodyTx, type CustodySummary,
} from '../core/custody.ts'
import { validateProject, computeExtractTotals, buildExtractEntry, buildProjectCostEntry, buildRetentionReleaseEntry, projectProfit, validateQuotation, quotationTotal, QUOTATION_TRANSITIONS, type Project, type CostKind, type ExtractTotals, type ProjectProfit, type Quotation, type QuotationLine, type QuotationStatus } from '../core/contracting.ts'
import { computeVisitTotals, buildVisitEntry, buildPatientCollectionEntry, validateTreatmentPlan, sessionFees, patientBalance, type VisitKind, type VisitTotals } from '../core/clinic.ts'
import { validateCar, buildCarPurchaseEntry, buildCarPrepEntry, computeCarSale, buildCarSaleEntry, type CarInput, type CarPurpose, type CarStatus } from '../core/cars.ts'
import { validateCheque, assertTransition, buildChequeReceiveEntry, buildChequeCollectEntry, buildChequeBounceEntry, buildChequeIssueEntry, buildChequeClearEntry, buildChequeCancelEntry, type Cheque, type ChequeStatus } from '../core/cheques.ts'
import { DEFAULT_TREASURIES, nextTreasuryCode, validateTreasury, type TreasuryDef } from '../core/treasury.ts'
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

/** معدة ثقيلة قابلة للإيجار (المرحلة 6 — القرار 13 + ترقية القرار 25) */
export interface Equipment {
  id: number
  nameAr: string // حفار، لودر، ونش…
  code: string // كود/لوحة اختياري
  dailyRateMinor: number // السعر اليومي الافتراضي
  /** ترقية القرار 25: أسعار الساعة والشهر (0 = غير متاح بهذا النظام) */
  hourlyRateMinor: number
  monthlyRateMinor: number
  /** قراءة عدّاد الساعات الحالية (Hour Meter) — تتقدم مع الوردانيات والعقود */
  meterReading: number
  /** صيانة وقائية كل N ساعة تشغيل (0 = بلا خطة) */
  serviceEveryHours: number
  /** قراءة العدّاد عند آخر خدمة */
  lastServiceReading: number
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
  days: number // الوحدات المحجوزة (ساعات/أيام/أشهر حسب rateType)
  dailyRateMinor: number // سعر الوحدة المحجوزة
  /** ترقية القرار 25: نوع العقد الزمني — العقود القديمة يومية */
  rateType: RateType
  /** قراءة العدّاد عند التسليم (العقود الساعية) */
  startReading: number | null
  /** قراءة العدّاد/تاريخ الإرجاع عند الإقفال */
  endReading: number | null
  /** تسوية التجاوز عند الإقفال (0 = لا تجاوز) */
  extraMinor: number
  extraEntryId: number | null
  payment: 'cash' | 'credit'
  vatPercent: number
  totals: RentalTotals
  status: 'active' | 'closed'
  openEntryId: number
  closeEntryId: number | null // null = لم يُقفل أو لا تأمين
  deductMinor: number // المخصوم من التأمين عند الإقفال
  notes: string
}

/* ─── معامل التحاليل (القرار 26) ─── */

/** مريض المعمل — سجل مستقل عن عملاء البيع (بياناته طبية) */
export interface LabPatient {
  id: number
  nameAr: string
  phone: string
  gender: Gender
  birthDate: string // YYYY-MM-DD ('' = غير معروف)
  notes: string
}

/** فحص داخل طلب — لقطة السعر والنطاق وقت الطلب + النتيجة ودورتها */
export interface LabOrderTest {
  testId: number
  code: string
  nameAr: string
  unit: string
  priceMinor: number
  status: TestStatus
  resultValue: string // '' = لم تُدخل
  resultFlag: 'low' | 'high' | 'normal' | 'none'
  refLow: number | null // النطاق المطبق لهذا المريض (لقطة)
  refHigh: number | null
  collectedAt: string | null
  resultedAt: string | null
  approvedAt: string | null
}

/** طلب تحاليل LAB-#### — مربوط بقيده وقيد عمولة مُحيله */
export interface LabOrder {
  id: number
  orderNumber: string
  date: string // ISO
  patientId: number
  patientName: string
  referrerId: number | null
  payment: 'cash' | 'credit'
  discountPercent: number
  tests: LabOrderTest[]
  totals: LabOrderTotals
  journalEntryId: number
  commissionMinor: number
  commissionEntryId: number | null
  commissionPaid: boolean
  commissionPayoutEntryId: number | null
  notes: string
}

/* ─── المقاولات (القرار 27) ─── */

/** مستخلص أعمال PRX-#### مربوط بقيده */
export interface ProjectExtract {
  id: number
  extractNumber: string
  projectId: number
  date: string // ISO
  description: string
  payment: 'cash' | 'credit'
  totals: ExtractTotals
  journalEntryId: number
}

/** تكلفة مسجلة على مشروع ببند */
export interface ProjectCost {
  id: number
  projectId: number
  date: string
  kind: CostKind
  description: string
  amountMinor: number
  payment: 'cash' | 'credit'
  journalEntryId: number
}

/** إفراج عن محتجز ضمان */
export interface RetentionRelease {
  id: number
  projectId: number
  date: string
  amountMinor: number
  journalEntryId: number
}

/* ─── العيادة (القرار 27) ─── */

/** ملف مريض العيادة — بيانات + تاريخ طبي */
export interface ClinicPatient {
  id: number
  nameAr: string
  phone: string
  gender: Gender
  birthDate: string // '' = غير معروف
  medicalHistory: string // أمراض مزمنة/حساسية/عمليات
  notes: string
}

/** زيارة بملاحظات الكشف وقيمتها — مربوطة بقيدها */
export interface ClinicVisit {
  id: number
  visitNumber: string // VIS-####
  patientId: number
  date: string // ISO
  kind: VisitKind
  complaint: string // الشكوى
  diagnosis: string // التشخيص
  treatment: string // العلاج / الإجراء المنفذ
  totals: VisitTotals
  planId: number | null // إن كانت جلسة ضمن خطة علاج
  journalEntryId: number
}

/** خطة علاج متعددة الجلسات (أسنان/جلدية/علاج طبيعي) */
export interface TreatmentPlan {
  id: number
  patientId: number
  title: string // «تقويم»، «زراعة ضرس»…
  totalSessions: number
  totalFeeMinor: number
  sessionFeesMinor: number[] // قسمة بلا فقد قرش
  doneSessions: number
  createdAt: string
}

/** تحصيل متأخرات مريض */
export interface ClinicCollection {
  id: number
  patientId: number
  date: string
  amountMinor: number
  journalEntryId: number
}

/** موعد قادم */
export interface ClinicAppointment {
  id: number
  patientId: number
  date: string // YYYY-MM-DD
  time: string // HH:MM
  purpose: string
  done: boolean
}

/* ─── معرض السيارات (القرار 27) ─── */

/** سيارة فريدة بتكلفتها الكاملة وربحيتها */
export interface Car {
  id: number
  make: string
  model: string
  year: number
  plateOrVin: string
  purpose: CarPurpose
  status: CarStatus
  odometerKm: number
  purchaseCostMinor: number
  prepCostMinor: number // إجمالي التجهيزات المرسملة
  purchaseEntryId: number
  prepEntryIds: number[]
  // بيانات البيع (إن بيعت)
  salePriceMinor: number | null
  saleProfitMinor: number | null
  saleEntryId: number | null
  soldAt: string | null
  buyerName: string
  /** ربط بسجل معدات الإيجار إن حُوّلت للتأجير */
  rentalEquipmentId: number | null
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
  treasury?: TreasuryAccount // الخزينة/البنك الذي دُفع منه
  custodyFileId?: number | null // دُفعت من ملف عهدة موظف (طلب المالك)
  projectId?: number | null // مربوطة بمشروع مقاولات
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
  // ربط السند بطرفه — يغذي كشوف حساب العميل/المورد (طلب المالك)
  partyKind?: 'customer' | 'supplier' | null
  partyId?: number | null
}

/** سلفة موظف — أصل على الموظف (1107) تُخصم من الرواتب على دفعات بحرية المالك */
export interface EmployeeAdvance {
  id: number
  advanceNumber: string // ADV-0001
  employeeId: number
  date: string
  amountMinor: number
  /** المسترد حتى الآن من مسيرات الرواتب — المتبقي = amountMinor − recoveredMinor */
  recoveredMinor: number
  /** مصدرها: سلفة نقدية عادية أو عجز تسوية عهدة (طلب المالك) */
  source: 'cash' | 'custody_shortage'
  custodyFileId: number | null // لو كان مصدرها عجز عهدة
  treasury: TreasuryAccount
  notes: string
  journalEntryId: number
}

/* ─── فواتير البيع (الكاشير) ─── */
export interface SaleInvoice {
  id: number
  invoiceNumber: string
  date: string // ISO datetime
  customerId: number | null // null = عميل نقدي
  payment: PaymentMethod
  paidMinor?: number // المدفوع نقداً (الدفع المجزأ) — undefined للفواتير القديمة = حسب payment
  treasury?: TreasuryAccount // الخزينة/البنك الذي استلم النقدية
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
  treasuries: TreasuryDef[] // الخزائن والبنوك المتعددة (طلب المالك)
  customers: Customer[]
  suppliers: Supplier[]
  employees: Employee[]
  payrollRuns: PayrollRun[]
  installmentPlans: InstallmentPlan[]
  vehicles: Vehicle[]
  trips: Trip[]
  equipment: Equipment[]
  rentalContracts: RentalContract[]
  operatorShifts: OperatorShift[] // وردانيات المشغلين (ترقية القرار 25)
  labTests: LabTest[] // كتالوج فحوصات المعمل (القرار 26)
  labReferrers: Referrer[] // الأطباء المُحيلون
  labPatients: LabPatient[]
  labOrders: LabOrder[]
  projects: Project[] // مشروعات المقاولات (القرار 27)
  projectExtracts: ProjectExtract[]
  projectCosts: ProjectCost[]
  retentionReleases: RetentionRelease[]
  quotations: Quotation[] // عروض أسعار ومناقصات (طلب المالك)
  custodyFiles: CustodyFile[] // ملفات عهد الموظفين (طلب المالك — نظام متكامل بنمط pro-acc)
  custodyTxs: CustodyTx[] // حركات ملفات العهد (تعزيز/مصروف/فاتورة/مرتجع/عجز)
  clinicPatients: ClinicPatient[] // العيادة (القرار 27)
  clinicVisits: ClinicVisit[]
  treatmentPlans: TreatmentPlan[]
  clinicCollections: ClinicCollection[]
  clinicAppointments: ClinicAppointment[]
  cars: Car[] // معرض السيارات (القرار 27)
  tickets: MaintenanceTicket[]
  transfers: StockTransfer[]
  batches: StockBatch[] // دفعات الصلاحية FEFO (القراران 5 و8)
  assets: FixedAsset[]
  serials: SerialUnit[] // وحدات السيريال/IMEI والضمان (نمط موبايل شوب)
  cheques: Cheque[] // أوراق القبض والدفع (الشيكات)
  purchases: PurchaseInvoice[]
  purchaseReturns: PurchaseReturn[]
  stocktakes: Stocktake[]
  vouchers: Voucher[]
  employeeAdvances: EmployeeAdvance[] // سلف الموظفين (طلب المالك)
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
    lines: { itemId: number; qty: number; unitPriceMinor: number; expiryDate?: string | null; serialsRaw?: string }[]
    expenses: PurchaseExpense[]
    paidMinor: number
    treasury?: TreasuryAccount // الخزينة/البنك الذي دُفع منه (افتراضياً الرئيسية)
    /** الدفع من ملف عهدة موظف بدل الخزينة (طلب المالك) — يخصم من عهدته ويظهر في ملفه */
    custodyFileId?: number | null
    /** ربط الفاتورة بمشروع مقاولات → تدخل تكاليفه وربحيته */
    projectId?: number | null
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
    treasury?: TreasuryAccount // الخزينة/البنك الذي استلم النقدية
    paidMinor?: number // الدفع المجزأ: المدفوع نقداً الآن والباقي آجل (طلب المالك)
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
    treasury?: string
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
    partyKind?: 'customer' | 'supplier' | null
    partyId?: number | null
  }) => Voucher
  /** صرف سلفة لموظف: قيد 1107 ← خزينة، وتُسترد من مسيرات الرواتب */
  grantEmployeeAdvance: (args: { employeeId: number; amountMinor: number; treasury: TreasuryAccount; notes: string }) => EmployeeAdvance
  /** قيد يدوي — يُرفض بنيوياً إن لم يتوازن (validateManualEntry ثم assertBalanced) */
  postManualEntry: (args: { date: string; description: string; lines: JournalLine[] }) => JournalEntry
  /** عكس قيد موثق — التصحيح الوحيد المسموح (Append-Only) */
  reverseEntry: (entryId: number, reason: string) => JournalEntry
  /** فتح وردية كاشير برصيد درج افتتاحي — لا ورديتين مفتوحتين معاً */
  openShift: (openedBy: string, openingCashMinor: number) => Shift
  /** إقفال الوردية بالنقدية المعدودة — يظهر العجز/الزيادة في الملخص */
  closeShift: (countedCashMinor: number) => Shift
  addWarehouse: (nameAr: string) => void
  /** إضافة خزينة/بنك جديد — يفتح له حساب دفتري تلقائياً (1121+) */
  addTreasury: (nameAr: string, kind: 'cash' | 'bank') => TreasuryDef
  renameTreasury: (code: string, nameAr: string) => void
  /** حذف خزينة مخصصة — يُرفض لو عليها حركة في اليومية أو كانت أساسية */
  removeTreasury: (code: string) => void
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
    /** الصرف من ملف عهدة موظف بدل الخزينة (طلب المالك) — يخصم من عهدته */
    custodyFileId?: number | null
    lines: PayrollLineInput[]
    notes: string
  }) => PayrollRun
  /** المتبقي غير المسترد من سلف موظف (سلفة نقدية أو عجز عهدة) — للخصم الحر بالمسير */
  getEmployeeAdvanceBalance: (employeeId: number) => { totalMinor: number; remainingMinor: number; advances: EmployeeAdvance[] }
  /** مستحق الموظف من زيادات مصاريف العهد (2107) غير المصروف بعد */
  getEmployeeExcessDue: (employeeId: number) => number
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
    treasury?: string
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
    /** ترقية القرار 25: نوع العقد (الافتراضي يومي) وقراءة العدّاد عند التسليم للساعي */
    rateType?: RateType
    startReading?: number | null
    treasury?: string
  }) => RentalContract
  /**
   * إقفال عقد: ردّ التأمين نقداً مع خصم اختياري يُعترف به إيراداً (4104).
   * ترقية القرار 25: قراءة عدّاد الإرجاع (ساعي) أو تاريخ الإرجاع (يومي/شهري)
   * ⇒ تسوية تجاوز الاستخدام بقيد منفصل، وتقدُّم عدّاد المعدة.
   */
  closeRental: (contractId: number, deductMinor: number, usage?: { endReading?: number; endDate?: string }, treasury?: string) => RentalContract
  /** وردية مشغل على معدة — تتحقق من القراءات وتقدّم عدّاد المعدة */
  addOperatorShift: (s: Omit<OperatorShift, 'id'>) => OperatorShift
  /** تسجيل خدمة صيانة للمعدة عند قراءتها الحالية (يصفّر عدّاد الفترة الوقائية) */
  recordEquipmentService: (equipmentId: number) => void
  /* ─── معامل التحاليل (القرار 26) ─── */
  addLabTest: (t: Omit<LabTest, 'id' | 'isActive'>) => LabTest
  updateLabTest: (id: number, patch: Partial<Omit<LabTest, 'id'>>) => void
  /** تحميل كتالوج البدء (10 فحوصات شائعة) بأسعار افتراضية — مرة واحدة */
  seedStarterTests: (defaultPriceMinor: number) => number
  addLabReferrer: (r: Omit<Referrer, 'id'>) => Referrer
  addLabPatient: (p: Omit<LabPatient, 'id'>) => LabPatient
  /**
   * تسجيل طلب تحاليل: لقطة أسعار ونطاقات وقت الطلب ← قيد تحصيل متوازن
   * (1101/1104 ← 4106+2102) + قيد استحقاق عمولة المُحيل (5109 ← 2105) إن وجد
   */
  registerLabOrder: (args: {
    patientId: number
    referrerId: number | null
    testIds: number[]
    payment: 'cash' | 'credit'
    discountPercent: number
    vatPercent: number
    notes: string
    treasury?: string
  }) => LabOrder
  /** تقدُّم فحص في دورته: سحب العينة ← نتيجة (بقيمة) ← اعتماد. انتقالات مشروعة فقط */
  advanceLabTest: (orderId: number, testId: number, to: TestStatus, resultValue?: string) => LabOrder
  /** صرف كل عمولات مُحيل غير المدفوعة بقيد واحد (2105 ← 1101) */
  payReferrerCommissions: (referrerId: number, treasury?: string) => { total: number; orderCount: number }
  /* ─── المقاولات (القرار 27) ─── */
  addProject: (p: Omit<Project, 'id' | 'code' | 'status'>) => Project
  /** عرض سعر/مناقصة — مستند غير محاسبي، الفائز يتحول مشروعاً بضغطة */
  addQuotation: (q: { kind: 'quotation' | 'tender'; clientName: string; titleAr: string; validUntil: string; lines: QuotationLine[]; notes: string }) => Quotation
  setQuotationStatus: (id: number, status: QuotationStatus) => void
  /** تحويل عرض فائز لمشروع (يرث الاسم والعميل وقيمة العرض) */
  convertQuotationToProject: (id: number, retentionPercent: number) => Project
  /* ─── ملفات العهد المتكاملة (طلب المالك — نمط pro-acc) ─── */
  /** فتح ملف عهدة لموظف (بلا قيد — أول عهدة تُسجَّل فيه بعد الفتح) — أكثر من ملف لنفس الموظف */
  openCustodyFile: (args: { employeeId: number; projectId: number | null; reason: string; notes: string }) => CustodyFile
  /** تمويل/تعزيز ملف عهدة: قيد 1108 ← خزينة/بنك مختار */
  fundCustodyFile: (args: { fileId: number; amountMinor: number; treasury: string; description: string }) => CustodyTx
  /** مصروف من العهدة — الزيادة عن الرصيد (بموافقة) تُسجَّل مستحقاً للموظف على 2107 وتُصرف مع راتبه */
  postCustodyExpense: (args: { fileId: number; amountMinor: number; description: string; expenseAccount?: string; projectId?: number | null; allowExcess?: boolean }) => CustodyTx
  /** تسوية وإغلاق الملف: المرتجع نقداً للخزينة، والعجز سلفة (1107) تُخصم من الرواتب على دفعات */
  settleCustodyFile: (args: { fileId: number; returnedMinor: number; treasury: string }) => CustodyFile
  /** ملخص ملف عهدة (تعزيزات/منصرف/زيادة/متبقٍ) من حركاته */
  getCustodySummary: (fileId: number) => CustodySummary
  /** مستخلص أعمال: قيد متوازن 1101|1104 + 1105 محتجز ← 4107 + 2102 */
  addProjectExtract: (args: { projectId: number; grossMinor: number; vatPercent: number; payment: 'cash' | 'credit'; description: string; treasury?: string }) => ProjectExtract
  /** تكلفة على المشروع ببند: 5110 ← 1101|2101 */
  addProjectCost: (args: { projectId: number; kind: CostKind; amountMinor: number; payment: 'cash' | 'credit'; description: string; treasury?: string; custodyFileId?: number | null }) => ProjectCost
  /** الإفراج عن كل المحتجزات المتبقية عند التسليم: 1101 ← 1105 + إقفال المشروع */
  releaseRetention: (projectId: number, treasury?: string) => { amount: number }
  /** ربحية مشروع محسوبة من مستخلصاته وتكاليفه */
  getProjectProfit: (projectId: number) => ProjectProfit
  /* ─── العيادة (القرار 27) ─── */
  addClinicPatient: (p: Omit<ClinicPatient, 'id'>) => ClinicPatient
  /** زيارة بملاحظات الكشف وقيمتها — سداد جزئي مدعوم، والمتبقي دين على المريض */
  addClinicVisit: (args: {
    patientId: number; kind: VisitKind; complaint: string; diagnosis: string; treatment: string
    feeMinor: number; paidMinor: number; vatPercent: number; planId: number | null; treasury?: string
  }) => ClinicVisit
  addTreatmentPlan: (args: { patientId: number; title: string; totalSessions: number; totalFeeMinor: number }) => TreatmentPlan
  /** تحصيل متأخرات مريض بقيد 1101 ← 1104 */
  collectFromPatient: (patientId: number, amountMinor: number, treasury?: string) => ClinicCollection
  /** رصيد المريض الحالي (المتبقي عليه) */
  getPatientBalance: (patientId: number) => number
  addAppointment: (a: Omit<ClinicAppointment, 'id' | 'done'>) => ClinicAppointment
  markAppointmentDone: (id: number) => void
  /* ─── معرض السيارات (القرار 27) ─── */
  /** شراء سيارة كبضاعة بقيد 1103 ← 1101|2101 */
  addCar: (args: CarInput & { payment: 'cash' | 'credit'; notes: string; treasury?: string }) => Car
  /** تجهيز يُرسمل على تكلفة السيارة (سمكرة/دهان/قطع) */
  addCarPrep: (carId: number, amountMinor: number, payment: 'cash' | 'credit', description: string, treasury?: string) => void
  /** بيع سيارة: إيراد + إخراج التكلفة الكاملة من المخزون في قيد واحد */
  sellCar: (args: { carId: number; priceMinor: number; vatPercent: number; payment: 'cash' | 'credit'; buyerName: string; treasury?: string }) => Car
  /** تحويل سيارة للتأجير: تُنشأ كمعدة في وحدة الإيجار وتُربط بها */
  moveCarToRental: (carId: number, dailyRateMinor: number, monthlyRateMinor: number) => void
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
    treasury?: string
  }) => MaintenanceTicket
  /** ترحيل تحويل مخزني: تحقق ضد رصيد المخزن المصدر — بلا قيد (حركة داخلية) */
  postTransfer: (args: { fromWarehouseId: number; toWarehouseId: number; lines: TransferLine[]; notes: string }) => StockTransfer
  /** اقتناء أصل ثابت: قيد 1201 / 1101 + 2101 وترقيم FA-#### */
  addAsset: (args: AssetInput & { notes: string; treasury?: string }) => FixedAsset
  /** ترحيل إهلاك شهر واحد لكل الأصول المستحقة — قيد مجمع واحد 5107/1202 */
  postMonthlyDepreciation: () => { entry: JournalEntry; totalMinor: number; assetCount: number }
  /* ─── الشيكات (أوراق القبض والدفع) ─── */
  /** استلام شيك وارد من عميل: قيد 1106 ← 1104 */
  receiveCheque: (args: { chequeNumber: string; partyId: number; bankName: string; amountMinor: number; dueDate: string; notes: string }) => Cheque
  /** تحرير شيك صادر لمورد: قيد 2101 ← 2106 */
  issueCheque: (args: { chequeNumber: string; partyId: number; bankName: string; amountMinor: number; dueDate: string; notes: string }) => Cheque
  /** نقل حالة الشيك وفق آلة الحالات — يولّد قيد التحصيل/الارتداد/الصرف/الإلغاء تلقائياً */
  setChequeStatus: (chequeId: number, status: ChequeStatus) => Cheque
}

const nextId = <T extends { id: number }>(arr: T[]) => arr.reduce((m, x) => Math.max(m, x.id), 0) + 1

export const useDataStore = create<DataState>()(
  persist(
    (set, get) => ({
      seeded: false,
      items: [],
      categories: [],
      warehouses: [],
      treasuries: DEFAULT_TREASURIES,
      customers: [],
      suppliers: [],
      employees: [],
      payrollRuns: [],
      installmentPlans: [],
      vehicles: [],
      trips: [],
      equipment: [],
      rentalContracts: [],
      operatorShifts: [],
      labTests: [],
      labReferrers: [],
      labPatients: [],
      labOrders: [],
      projects: [],
      projectExtracts: [],
      projectCosts: [],
      retentionReleases: [],
      quotations: [],
      custodyFiles: [],
      custodyTxs: [],
      clinicPatients: [],
      clinicVisits: [],
      treatmentPlans: [],
      clinicCollections: [],
      clinicAppointments: [],
      cars: [],
      tickets: [],
      transfers: [],
      batches: [],
      assets: [],
      serials: [],
      cheques: [],
      purchases: [],
      purchaseReturns: [],
      stocktakes: [],
      vouchers: [],
      employeeAdvances: [],
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
        // سيريالات أصناف الموبايلات/الأجهزة (نمط موبايل شوب): تُفرز قبل أي كتابة
        // — لو أُدخلت يجب أن يطابق عددها الكمية وألا تتكرر أو تكون مسجلة من قبل
        const existingSerialSet = new Set(state.serials.map((u) => u.serial))
        const parsedByLine = new Map<number, string[]>()
        inv.lines.forEach((l, li) => {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item?.trackSerial || !l.serialsRaw?.trim()) return
          const { accepted, errors } = parseSerialsInput(l.serialsRaw, existingSerialSet)
          if (errors.length) throw new Error(`سيريالات «${item.nameAr}»: ${errors.join('، ')}`)
          if (accepted.length !== l.qty) {
            throw new Error(`«${item.nameAr}»: عدد السيريالات (${accepted.length}) لا يطابق الكمية (${l.qty})`)
          }
          for (const s of accepted) existingSerialSet.add(s) // منع التكرار بين سطور نفس الفاتورة
          parsedByLine.set(li, accepted)
        })
        const costLines: CostLine[] = inv.lines.map((l) => ({
          itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor,
        }))
        const landed = computeLandedCosts(costLines, inv.expenses as ExpenseInput[])
        const goodsTotal = landed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
        const expensesTotal = inv.expenses.reduce((a, e) => a + e.amountMinor, 0)
        const grandTotal = goodsTotal + expensesTotal

        // مصدر الدفع: خزينة/بنك أو ملف عهدة موظف (طلب المالك) — العهدة تُفحص قبل أي كتابة
        let custodyFile: CustodyFile | null = null
        if (inv.custodyFileId != null && inv.paidMinor > 0) {
          custodyFile = state.custodyFiles.find((f) => f.id === inv.custodyFileId) ?? null
          if (!custodyFile) throw new Error('ملف العهدة غير موجود')
          assertFileOpen(custodyFile)
          const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === custodyFile!.id)).remainingMinor
          if (inv.paidMinor > remaining) {
            throw new Error(`المدفوع أكبر من المتبقي في ملف العهدة (${remaining}) — عزّز العهدة أو سجّل الباقي آجلاً`)
          }
        }
        if (inv.projectId != null && !state.projects.find((p) => p.id === inv.projectId)) throw new Error('المشروع غير موجود')
        // القيد المحاسبي: مخزون مدين / (خزينة أو 1108 عهد) + موردون دائن (يرمي لو المدفوع > الإجمالي)
        const payAccount = custodyFile ? CUSTODY_ACCOUNT : (inv.treasury ?? '1101')
        const entryLines = buildPurchaseEntry(grandTotal, inv.paidMinor, payAccount)
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
          treasury: custodyFile ? undefined : (inv.treasury ?? '1101'),
          custodyFileId: custodyFile?.id ?? null,
          projectId: inv.projectId ?? null,
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

        // تسجيل وحدات السيريال الداخلة مع هذه الفاتورة
        let serialId = nextId(state.serials)
        const newSerials: SerialUnit[] = []
        inv.lines.forEach((l, li) => {
          const accepted = parsedByLine.get(li)
          if (!accepted) return
          const item = state.items.find((it) => it.id === l.itemId)
          for (const s of accepted) {
            newSerials.push({
              id: serialId++,
              itemId: l.itemId,
              serial: s,
              status: 'in_stock',
              purchaseId,
              saleId: null,
              soldAt: null,
              warrantyMonths: item?.warrantyMonths ?? 0,
              receivedAt: nowIso,
            })
          }
        })

        // فاتورة مدفوعة من عهدة → حركة في ملف العهدة تظهر مقابل التعزيزات (طلب المالك)
        let custodyTxs = state.custodyTxs
        if (custodyFile && inv.paidMinor > 0) {
          custodyTxs = [...custodyTxs, {
            id: nextId(custodyTxs), fileId: custodyFile.id, type: 'invoice' as const,
            date: inv.date, amountMinor: inv.paidMinor, excessMinor: 0,
            description: `فاتورة شراء ${invoiceNumber}`,
            treasury: null, projectId: inv.projectId ?? null, purchaseId, journalEntryId: entryId,
          }]
        }
        // فاتورة مربوطة بمشروع → بند تكلفة «مواد» يدخل ربحيته (طلب المالك)
        let projectCosts = state.projectCosts
        if (inv.projectId != null) {
          projectCosts = [...projectCosts, {
            id: nextId(projectCosts), projectId: inv.projectId, kind: 'materials' as CostKind,
            amountMinor: grandTotal, date: inv.date,
            description: `فاتورة شراء ${invoiceNumber}${custodyFile ? ` — من عهدة ${custodyFile.fileNumber}` : ''}`,
            payment: inv.paidMinor >= grandTotal ? 'cash' as const : 'credit' as const,
            journalEntryId: entryId,
          }]
        }
        set({
          purchases: [...state.purchases, invoice],
          journal: [...state.journal, entry],
          items: updatedItems,
          batches: newBatches.length ? [...state.batches, ...newBatches] : state.batches,
          serials: newSerials.length ? [...state.serials, ...newSerials] : state.serials,
          custodyTxs,
          projectCosts,
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

        // 2.5) سيريالات القطع المعيّنة (نمط موبايل شوب — استشاري مثل الدفعات):
        // صنف يتتبع السيريال وله سيريالات متاحة ⇒ يجب تعيين سيريال لكل قطعة؛
        // لا سيريالات مسجلة أصلاً ⇒ يُباع عادياً (مخزون افتتاحي بلا سيريالات)
        const assignments: { itemId: number; serial: string }[] = []
        for (const l of args.lines) {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item?.trackSerial) continue
          const availCount = state.serials.filter((u) => u.itemId === l.itemId && u.status === 'in_stock').length
          const given = l.serials ?? []
          if (given.length === 0 && availCount === 0) continue // نظام استشاري
          if (given.length !== l.qty) {
            throw new Error(`«${item.nameAr}»: عيّن سيريالاً لكل قطعة (${given.length} من ${l.qty})`)
          }
          for (const s of given) assignments.push({ itemId: l.itemId, serial: s })
        }

        // 3) الإجماليات والقيد (يرمي UnbalancedEntryError لو اختل — مستحيل بنيوياً)
        const totals = computeTotals(args.lines, args.invoiceDiscountPercent, args.taxPercent, args.taxInclusive)
        // دفع مجزأ: جزء نقدي يحتاج خزينة، وأي جزء آجل يحتاج عميلاً محدداً
        const paidM = args.paidMinor ?? (args.payment === 'cash' ? totals.totalMinor : 0)
        if (paidM < totals.totalMinor && args.customerId == null) {
          throw new Error('الجزء الآجل يحتاج اختيار عميل — لا دين على «عميل نقدي»')
        }
        const entryLines = buildSaleEntry(totals, args.payment, args.treasury ?? '1101', paidM)
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
          paidMinor: paidM,
          treasury: args.treasury ?? '1101',
          lines: args.lines,
          invoiceDiscountPercent: args.invoiceDiscountPercent,
          totals,
          journalEntryId: entryId,
          expiryOverrideBy: args.expiryOverrideBy ?? null,
          shiftId: currentOpenShift(state.shifts)?.id ?? null,
        }

        // 4) خصم المخزون (والدفعات المحدثة بعد صرف FEFO) + تعليم السيريالات مباعة
        const qtyByItem = new Map<number, number>()
        for (const l of args.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyByItem.has(it.id) ? { ...it, stockQty: (it.stockQty ?? 0) - qtyByItem.get(it.id)! } : it,
        )
        // markSold يتحقق (موجود/متاح/يخص الصنف/غير مكرر) ويرمي خطأ عربياً قبل أي كتابة
        const updatedSerials = assignments.length ? markSold(state.serials, assignments, saleId, now) : state.serials

        set({ sales: [...state.sales, sale], journal: [...state.journal, entry], items: updatedItems, batches: workingBatches, serials: updatedSerials })
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

        // 4) عودة البضاعة للمخزون + عودة السيريالات المرتبطة بهذه الفاتورة
        const qtyBack = new Map<number, number>()
        for (const l of lines) qtyBack.set(l.itemId, (qtyBack.get(l.itemId) ?? 0) + l.qty)
        const updatedItems = state.items.map((it) =>
          qtyBack.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) + qtyBack.get(it.id)!) * 1000) / 1000 } : it,
        )
        // سيريالات هذه الفاتورة تعود متاحة بعدد الكمية المرتجعة (الأقدم بيعاً أولاً)
        const serialsToReturn: string[] = []
        for (const [itemId, qty] of qtyBack) {
          const soldUnits = state.serials.filter((u) => u.saleId === sale.id && u.itemId === itemId && u.status === 'sold')
          for (const u of soldUnits.slice(0, Math.floor(qty))) serialsToReturn.push(u.serial)
        }
        const updatedSerials = serialsToReturn.length ? markReturned(state.serials, sale.id, serialsToReturn) : state.serials

        set({ saleReturns: [...state.saleReturns, ret], journal: [...state.journal, entry], items: updatedItems, serials: updatedSerials })
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
        const entryLines = buildPurchaseReturnEntry(total, args.refund, args.treasury ?? '1101')
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
          partyKind: args.partyKind ?? null,
          partyId: args.partyId ?? null,
        }

        set({ vouchers: [...state.vouchers, voucher], journal: [...state.journal, entry] })
        return voucher
      },

      grantEmployeeAdvance: (args) => {
        const state = get()
        const emp = state.employees.find((e) => e.id === args.employeeId)
        if (!emp) throw new Error('الموظف غير موجود')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ السلفة يجب أن يكون موجباً')
        // قيد السلفة: مدين 1107 (أصل على الموظف) / دائن الخزينة المختارة
        const entryLines: JournalLine[] = [
          { accountCode: '1107', debit: args.amountMinor, credit: 0, note: `سلفة ${emp.nameAr}` },
          { accountCode: args.treasury, debit: 0, credit: args.amountMinor, note: 'صرف نقدي' },
        ]
        const advId = nextId(state.employeeAdvances)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const advanceNumber = `ADV-${String(advId).padStart(4, '0')}`
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `سلفة موظف ${advanceNumber} — ${emp.nameAr}${args.notes ? ` — ${args.notes}` : ''}`,
          sourceType: 'payment_voucher',
          sourceId: advId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        const advance: EmployeeAdvance = {
          id: advId,
          advanceNumber,
          employeeId: args.employeeId,
          date: now,
          amountMinor: args.amountMinor,
          recoveredMinor: 0,
          source: 'cash',
          custodyFileId: null,
          treasury: args.treasury,
          notes: args.notes,
          journalEntryId: entryId,
        }
        set({ employeeAdvances: [...state.employeeAdvances, advance], journal: [...state.journal, entry] })
        return advance
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

      addTreasury: (nameAr, kind) => {
        const state = get()
        const errors = validateTreasury(nameAr, state.treasuries)
        if (errors.length) throw new Error(errors.join(' — '))
        const t: TreasuryDef = { code: nextTreasuryCode(state.treasuries), nameAr: nameAr.trim(), kind }
        set({ treasuries: [...state.treasuries, t] })
        return t
      },

      renameTreasury: (code, nameAr) => {
        const state = get()
        const errors = validateTreasury(nameAr, state.treasuries, code)
        if (errors.length) throw new Error(errors.join(' — '))
        set({ treasuries: state.treasuries.map((t) => (t.code === code ? { ...t, nameAr: nameAr.trim() } : t)) })
      },

      removeTreasury: (code) => {
        const state = get()
        const t = state.treasuries.find((x) => x.code === code)
        if (!t) throw new Error('الخزينة غير موجودة')
        if (t.code === '1101' || t.code === '1102') throw new Error('الخزينة الرئيسية والبنك الرئيسي لا يُحذفان')
        const hasMoves = state.journal.some((e) => e.lines.some((l) => l.accountCode === code))
        if (hasMoves) throw new Error(`«${t.nameAr}» عليها حركة في اليومية — لا تُحذف حفاظاً على التوازن`)
        set({ treasuries: state.treasuries.filter((x) => x.code !== code) })
      },
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
        // تحقق السلف: المخصوم من كل موظف لا يتجاوز متبقي سلفه (الخصم حر على عدة رواتب — طلب المالك)
        for (const l of computed) {
          if (l.advancesMinor <= 0) continue
          const remaining = state.employeeAdvances
            .filter((a) => a.employeeId === l.employeeId)
            .reduce((sum, a) => sum + (a.amountMinor - a.recoveredMinor), 0)
          if (l.advancesMinor > remaining) {
            const emp = state.employees.find((e) => e.id === l.employeeId)
            throw new Error(`«${emp?.nameAr ?? l.employeeId}»: المخصوم (${l.advancesMinor}) أكبر من متبقي سلفه (${remaining})`)
          }
        }
        // تحقق مستحقات زيادة العهد: المصروف لا يتجاوز مستحق الموظف على 2107
        for (const l of computed) {
          const excess = l.excessPaidMinor ?? 0
          if (excess <= 0) continue
          const due = get().getEmployeeExcessDue(l.employeeId)
          if (excess > due) {
            const emp = state.employees.find((e) => e.id === l.employeeId)
            throw new Error(`«${emp?.nameAr ?? l.employeeId}»: المصروف من مستحق العهدة (${excess}) أكبر من رصيده (${due})`)
          }
        }
        // مصدر الصرف: خزينة/بنك أو ملف عهدة موظف مفتوح برصيد كافٍ (طلب المالك)
        let payCustodyFile: CustodyFile | null = null
        let payAccount: TreasuryAccount = args.treasury
        if (args.payMode === 'cash' && args.custodyFileId != null) {
          payCustodyFile = state.custodyFiles.find((f) => f.id === args.custodyFileId) ?? null
          if (!payCustodyFile) throw new Error('ملف العهدة غير موجود')
          assertFileOpen(payCustodyFile)
          payAccount = CUSTODY_ACCOUNT
        }
        // 3) القيد المتوازن بنيوياً — السلف المستقطعة تُقفل من 1107 ومستحقات العهد تُصفّى من 2107
        const advancesRecovered = computed.reduce((a, l) => a + l.advancesMinor, 0)
        const excessPaid = computed.reduce((a, l) => a + (l.excessPaidMinor ?? 0), 0)
        const totalOut = totals.netMinor + excessPaid
        if (payCustodyFile) {
          const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === payCustodyFile!.id)).remainingMinor
          if (totalOut > remaining) throw new Error(`المسير (${totalOut}) أكبر من المتبقي في ملف العهدة (${remaining})`)
        }
        const entryLines = buildPayrollEntry(totals.netMinor, args.payMode, payAccount, label, advancesRecovered, excessPaid)

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

        // توزيع المخصوم على سلف كل موظف — الأقدم أولاً (تتبع السلفة عبر عدة أشهر)
        let employeeAdvances = state.employeeAdvances
        for (const l of computed) {
          let toRecover = l.advancesMinor
          if (toRecover <= 0) continue
          employeeAdvances = employeeAdvances.map((a) => {
            if (a.employeeId !== l.employeeId || toRecover <= 0) return a
            const open = a.amountMinor - a.recoveredMinor
            if (open <= 0) return a
            const take = Math.min(open, toRecover)
            toRecover -= take
            return { ...a, recoveredMinor: a.recoveredMinor + take }
          })
        }
        // المسير المصروف من عهدة → حركة في ملف العهدة (طلب المالك)
        let custodyTxs = state.custodyTxs
        if (payCustodyFile && totalOut > 0) {
          custodyTxs = [...custodyTxs, {
            id: nextId(custodyTxs), fileId: payCustodyFile.id, type: 'expense' as const,
            date: now.slice(0, 10), amountMinor: totalOut, excessMinor: 0,
            description: `صرف مسير رواتب ${runNumber} — ${label}`,
            treasury: null, projectId: null, purchaseId: null, journalEntryId: entryId,
          }]
        }
        set({ payrollRuns: [...state.payrollRuns, run], journal: [...state.journal, entry], employeeAdvances, custodyTxs })
        return run
      },

      getEmployeeAdvanceBalance: (employeeId) => {
        const advances = get().employeeAdvances.filter((a) => a.employeeId === employeeId)
        const totalMinor = advances.reduce((s2, a) => s2 + a.amountMinor, 0)
        const remainingMinor = advances.reduce((s2, a) => s2 + (a.amountMinor - a.recoveredMinor), 0)
        return { totalMinor, remainingMinor, advances }
      },

      getEmployeeExcessDue: (employeeId) => {
        const state = get()
        // المستحق = زيادات مصاريف عهد الموظف (2107) − ما صُرف له بالمسيرات
        const fileIds = new Set(state.custodyFiles.filter((f) => f.employeeId === employeeId).map((f) => f.id))
        const accrued = state.custodyTxs.filter((t) => fileIds.has(t.fileId)).reduce((s2, t) => s2 + t.excessMinor, 0)
        const paid = state.payrollRuns.reduce((s2, r) =>
          s2 + r.lines.filter((l) => l.employeeId === employeeId).reduce((x, l) => x + (l.excessPaidMinor ?? 0), 0), 0)
        return Math.max(0, accrued - paid)
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
        const entryLines = buildTripEntry(totals, args.input.payment, tripNumber, args.treasury ?? '1101')

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
        const rateType: RateType = args.rateType ?? 'daily'
        // 1) تحقق شامل قبل أي كتابة
        const errors = validateRental(args.input)
        if (args.customerId != null && !state.customers.some((c) => c.id === args.customerId)) errors.push('العميل غير موجود')
        if (args.input.payment === 'credit' && args.customerId == null) errors.push('الإيجار الآجل يتطلب عميلاً مسجلاً')
        // ترقية القرار 25: العقد الساعي يتطلب قراءة عدّاد التسليم
        if (rateType === 'hourly') {
          if (args.startReading == null || !isValidMeterReading(args.startReading)) {
            errors.push('العقد الساعي يتطلب قراءة عدّاد صحيحة عند التسليم')
          } else if (args.equipmentId != null) {
            const eq = state.equipment.find((e) => e.id === args.equipmentId)
            if (eq && args.startReading < eq.meterReading) {
              errors.push(`قراءة التسليم (${args.startReading}) أقل من عدّاد المعدة الحالي (${eq.meterReading})`)
            }
          }
        }
        if (errors.length) throw new Error(errors.join(' — '))

        // 2) الإجماليات وقيد الفتح بالنواة الخالصة
        const totals = computeRentalTotals(args.input)
        const contractId = nextId(state.rentalContracts)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const contractNumber = `RC-${String(contractId).padStart(4, '0')}`
        const entryLines = buildRentalOpenEntry(totals, contractNumber, args.treasury ?? '1101')

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
          rateType,
          startReading: rateType === 'hourly' ? (args.startReading ?? null) : null,
          endReading: null,
          extraMinor: 0,
          extraEntryId: null,
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
      closeRental: (contractId, deductMinor, usage, treasury = '1101') => {
        const state = get()
        const contract = state.rentalContracts.find((c) => c.id === contractId)
        if (!contract) throw new Error('العقد غير موجود')
        if (contract.status === 'closed') throw new Error('العقد مُقفل بالفعل')

        const now = new Date().toISOString()
        let journal = state.journal

        // ترقية القرار 25: تسوية الاستخدام الفعلي (عدّاد للساعي، تاريخ إرجاع لليومي/الشهري)
        let extraMinor = 0
        let extraEntryId: number | null = null
        let endReading: number | null = null
        if (contract.rateType === 'hourly') {
          if (usage?.endReading == null) throw new Error('العقد الساعي يتطلب قراءة العدّاد عند الإرجاع')
          const billing = computeUsageBilling({
            rateType: 'hourly',
            rateMinor: contract.dailyRateMinor,
            bookedUnits: contract.days,
            startReading: contract.startReading ?? 0,
            endReading: usage.endReading,
          })
          endReading = usage.endReading
          extraMinor = billing.extraMinor
        } else if (usage?.endDate) {
          const billing = computeUsageBilling({
            rateType: contract.rateType,
            rateMinor: contract.dailyRateMinor,
            bookedUnits: contract.days,
            startDate: contract.date.slice(0, 10),
            endDate: usage.endDate,
          })
          extraMinor = billing.extraMinor
        }
        // قيد التجاوز — بنفس طريقة سداد العقد
        if (extraMinor > 0) {
          extraEntryId = nextId(journal)
          const extraLines = buildExtraUsageEntry(extraMinor, contract.vatPercent, contract.payment, contract.contractNumber, treasury)
          journal = [...journal, {
            id: extraEntryId,
            entryNumber: extraEntryId,
            date: now.slice(0, 10),
            description: `تسوية تجاوز استخدام عقد ${contract.contractNumber}`,
            sourceType: 'rental_contract',
            sourceId: contract.id,
            lines: extraLines,
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          }]
        }

        // قيد الإقفال (null لو لا تأمين — يبقى العقد يُقفل بلا قيد)
        const closeLines = buildRentalCloseEntry(contract.totals.depositMinor, deductMinor, contract.contractNumber, treasury)
        let closeEntryId: number | null = null
        if (closeLines) {
          closeEntryId = nextId(journal)
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
          journal = [...journal, entry]
        }

        // تقدُّم عدّاد المعدة لقراءة الإرجاع (لا يرجع للخلف أبداً)
        const equipment =
          endReading != null && contract.equipmentId != null
            ? state.equipment.map((e) =>
                e.id === contract.equipmentId && endReading! > e.meterReading ? { ...e, meterReading: endReading! } : e,
              )
            : state.equipment

        const updated: RentalContract = { ...contract, status: 'closed', closeEntryId, deductMinor, endReading, extraMinor, extraEntryId }
        set({
          rentalContracts: state.rentalContracts.map((c) => (c.id === contractId ? updated : c)),
          journal,
          equipment,
        })
        return updated
      },
      addOperatorShift: (s) => {
        const state = get()
        const errors = validateOperatorShift(s)
        const eq = state.equipment.find((e) => e.id === s.equipmentId)
        if (!eq) errors.push('المعدة غير موجودة')
        else if (s.startReading < eq.meterReading) {
          errors.push(`قراءة بداية الوردية (${s.startReading}) أقل من عدّاد المعدة (${eq.meterReading}) — العدّاد لا يرجع للخلف`)
        }
        if (errors.length) throw new Error(errors.join(' — '))
        const shift: OperatorShift = { ...s, id: nextId(state.operatorShifts) }
        set({
          operatorShifts: [...state.operatorShifts, shift],
          // عدّاد المعدة يتقدم لقراءة نهاية الوردية
          equipment: state.equipment.map((e) =>
            e.id === s.equipmentId && s.endReading > e.meterReading ? { ...e, meterReading: s.endReading } : e,
          ),
        })
        return shift
      },
      recordEquipmentService: (equipmentId) => {
        const state = get()
        const eq = state.equipment.find((e) => e.id === equipmentId)
        if (!eq) throw new Error('المعدة غير موجودة')
        set({
          equipment: state.equipment.map((e) =>
            e.id === equipmentId ? { ...e, lastServiceReading: e.meterReading } : e,
          ),
        })
      },

      /* ─── معامل التحاليل (القرار 26) ─── */
      addLabTest: (t) => {
        const state = get()
        const errors = validateLabTest(t, state.labTests)
        if (errors.length) throw new Error(errors.join(' — '))
        const test: LabTest = { ...t, id: nextId(state.labTests), isActive: true }
        set({ labTests: [...state.labTests, test] })
        return test
      },
      updateLabTest: (id, patch) => {
        const state = get()
        const existing = state.labTests.find((t) => t.id === id)
        if (!existing) throw new Error('الفحص غير موجود')
        const merged = { ...existing, ...patch }
        const errors = validateLabTest(merged, state.labTests, id)
        if (errors.length) throw new Error(errors.join(' — '))
        set({ labTests: state.labTests.map((t) => (t.id === id ? merged : t)) })
      },
      seedStarterTests: (defaultPriceMinor) => {
        const state = get()
        const existingCodes = new Set(state.labTests.map((t) => t.code.toUpperCase()))
        let id = nextId(state.labTests)
        const added: LabTest[] = []
        for (const st of STARTER_TESTS) {
          if (existingCodes.has(st.code.toUpperCase())) continue
          added.push({ ...st, id: id++, priceMinor: defaultPriceMinor, costMinor: 0, isActive: true })
        }
        if (added.length) set({ labTests: [...state.labTests, ...added] })
        return added.length
      },
      addLabReferrer: (r) => {
        const state = get()
        const errors = validateReferrer(r)
        if (errors.length) throw new Error(errors.join(' — '))
        const ref: Referrer = { ...r, id: nextId(state.labReferrers) }
        set({ labReferrers: [...state.labReferrers, ref] })
        return ref
      },
      addLabPatient: (p) => {
        const state = get()
        if (!p.nameAr.trim()) throw new Error('اسم المريض مطلوب')
        const patient: LabPatient = { ...p, id: nextId(state.labPatients) }
        set({ labPatients: [...state.labPatients, patient] })
        return patient
      },
      registerLabOrder: (args) => {
        const state = get()
        const patient = state.labPatients.find((p) => p.id === args.patientId)
        if (!patient) throw new Error('المريض غير مسجل')
        const referrer = args.referrerId != null ? state.labReferrers.find((r) => r.id === args.referrerId) : null
        if (args.referrerId != null && !referrer) throw new Error('الطبيب المُحيل غير موجود')
        if (!args.testIds.length) throw new Error('اختر فحصاً واحداً على الأقل')
        const chosen = args.testIds.map((tid) => {
          const t = state.labTests.find((x) => x.id === tid && x.isActive)
          if (!t) throw new Error(`فحص غير موجود (#${tid})`)
          return t
        })

        // الإجماليات وقيد التحصيل (كلاهما يرمي قبل أي كتابة)
        const totals = computeLabTotals(chosen.map((t) => t.priceMinor), args.discountPercent, args.vatPercent)
        const now = new Date().toISOString()
        const orderId = nextId(state.labOrders)
        const orderNumber = `LAB-${String(orderId).padStart(4, '0')}`
        const entryLines = buildLabOrderEntry(totals, args.payment, orderNumber, args.treasury ?? '1101')

        let journal = state.journal
        const entryId = nextId(journal)
        journal = [...journal, {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `طلب تحاليل ${orderNumber} — ${patient.nameAr}`,
          sourceType: 'lab_order', sourceId: orderId, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }]

        // عمولة المُحيل — استحقاق فوري بقيد منفصل (من صافي الطلب)
        const commissionMinor = referrer ? commissionFor(totals.netMinor, referrer.commissionPercent) : 0
        let commissionEntryId: number | null = null
        if (commissionMinor > 0) {
          commissionEntryId = nextId(journal)
          journal = [...journal, {
            id: commissionEntryId, entryNumber: commissionEntryId, date: now.slice(0, 10),
            description: `استحقاق عمولة د. ${referrer!.nameAr} عن ${orderNumber}`,
            sourceType: 'lab_commission', sourceId: orderId,
            lines: buildCommissionAccrualEntry(commissionMinor, orderNumber),
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }]
        }

        // لقطة الفحوصات بنطاقات هذا المريض تحديداً
        const age = patient.birthDate ? ageYearsFn(patient.birthDate, now) : 30
        const orderTests: LabOrderTest[] = chosen.map((t) => {
          const range = matchRefRangeFn(t, patient.gender, age)
          return {
            testId: t.id, code: t.code, nameAr: t.nameAr, unit: t.unit, priceMinor: t.priceMinor,
            status: 'pending', resultValue: '', resultFlag: 'none',
            refLow: range?.low ?? null, refHigh: range?.high ?? null,
            collectedAt: null, resultedAt: null, approvedAt: null,
          }
        })

        const order: LabOrder = {
          id: orderId, orderNumber, date: now,
          patientId: patient.id, patientName: patient.nameAr,
          referrerId: referrer?.id ?? null,
          payment: args.payment, discountPercent: args.discountPercent,
          tests: orderTests, totals,
          journalEntryId: entryId,
          commissionMinor, commissionEntryId, commissionPaid: false, commissionPayoutEntryId: null,
          notes: args.notes,
        }
        set({ labOrders: [...state.labOrders, order], journal })
        return order
      },
      advanceLabTest: (orderId, testId, to, resultValue) => {
        const state = get()
        const order = state.labOrders.find((o) => o.id === orderId)
        if (!order) throw new Error('الطلب غير موجود')
        const test = order.tests.find((t) => t.testId === testId)
        if (!test) throw new Error('الفحص ليس في هذا الطلب')
        if (!canTransition(test.status, to)) {
          throw new Error(`انتقال غير مشروع: لا يمكن من «${test.status}» إلى «${to}» — الدورة: تسجيل ← سحب عينة ← نتيجة ← اعتماد`)
        }
        if (to === 'resulted' && !resultValue?.trim()) throw new Error('أدخل قيمة النتيجة أولاً')
        const now = new Date().toISOString()
        const updatedTest: LabOrderTest = {
          ...test,
          status: to,
          ...(to === 'collected' ? { collectedAt: now } : {}),
          ...(to === 'resulted'
            ? {
                resultedAt: now,
                resultValue: resultValue!.trim(),
                resultFlag: evaluateResultFn(resultValue!, test.refLow == null && test.refHigh == null ? null : { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: test.refLow, high: test.refHigh }),
              }
            : {}),
          ...(to === 'approved' ? { approvedAt: now } : {}),
        }
        const updated: LabOrder = { ...order, tests: order.tests.map((t) => (t.testId === testId ? updatedTest : t)) }
        set({ labOrders: state.labOrders.map((o) => (o.id === orderId ? updated : o)) })
        return updated
      },
      payReferrerCommissions: (referrerId, treasury = '1101') => {
        const state = get()
        const referrer = state.labReferrers.find((r) => r.id === referrerId)
        if (!referrer) throw new Error('الطبيب غير موجود')
        const unpaid = state.labOrders.filter((o) => o.referrerId === referrerId && !o.commissionPaid && o.commissionMinor > 0)
        const total = unpaid.reduce((a, o) => a + o.commissionMinor, 0)
        const lines = buildCommissionPayoutEntry(total, referrer.nameAr, treasury) // يرمي لو صفر
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `صرف عمولات د. ${referrer.nameAr} (${unpaid.length} طلب)`,
          sourceType: 'lab_commission_payout', sourceId: referrerId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const paidIds = new Set(unpaid.map((o) => o.id))
        set({
          journal: [...state.journal, entry],
          labOrders: state.labOrders.map((o) =>
            paidIds.has(o.id) ? { ...o, commissionPaid: true, commissionPayoutEntryId: entryId } : o,
          ),
        })
        return { total, orderCount: unpaid.length }
      },

      /* ─── المقاولات (القرار 27) ─── */
      addProject: (p) => {
        const state = get()
        const errors = validateProject(p)
        if (errors.length) throw new Error(errors.join(' — '))
        const id = nextId(state.projects)
        const project: Project = { ...p, id, code: `PRJ-${String(id).padStart(4, '0')}`, status: 'active' }
        set({ projects: [...state.projects, project] })
        return project
      },

      addQuotation: (q) => {
        const state = get()
        const errors = validateQuotation(q)
        if (errors.length) throw new Error(errors.join(' — '))
        const id = nextId(state.quotations)
        const quote: Quotation = {
          id,
          quoteNumber: `${q.kind === 'tender' ? 'TN' : 'QT'}-${String(id).padStart(4, '0')}`,
          kind: q.kind,
          clientName: q.clientName.trim(),
          titleAr: q.titleAr.trim(),
          date: new Date().toISOString().slice(0, 10),
          validUntil: q.validUntil,
          lines: q.lines.filter((l) => l.descriptionAr.trim() && l.qty > 0),
          status: 'draft',
          notes: q.notes,
          projectId: null,
        }
        set({ quotations: [...state.quotations, quote] })
        return quote
      },

      setQuotationStatus: (id, status) => {
        const state = get()
        const q = state.quotations.find((x) => x.id === id)
        if (!q) throw new Error('العرض غير موجود')
        if (!QUOTATION_TRANSITIONS[q.status].includes(status)) {
          throw new Error(`لا يمكن الانتقال من «${q.status}» إلى «${status}»`)
        }
        set({ quotations: state.quotations.map((x) => (x.id === id ? { ...x, status } : x)) })
      },

      convertQuotationToProject: (id, retentionPercent) => {
        const state = get()
        const q = state.quotations.find((x) => x.id === id)
        if (!q) throw new Error('العرض غير موجود')
        if (q.status !== 'won') throw new Error('يتحول للمشروع العرضُ الفائز فقط — علّمه «فائز» أولاً')
        if (q.projectId != null) throw new Error('تحوّل هذا العرض لمشروع بالفعل')
        const project = get().addProject({
          nameAr: q.titleAr,
          clientName: q.clientName,
          contractValueMinor: quotationTotal(q.lines),
          retentionPercent,
          startDate: new Date().toISOString().slice(0, 10),
          notes: `متولد من ${q.quoteNumber}`,
        })
        set((s) => ({ quotations: s.quotations.map((x) => (x.id === id ? { ...x, projectId: project.id } : x)) }))
        return project
      },

      openCustodyFile: (args) => {
        const state = get()
        const errors = validateCustodyFile(args)
        if (errors.length) throw new Error(errors.join(' — '))
        if (!state.employees.find((e) => e.id === args.employeeId)) throw new Error('الموظف غير موجود')
        if (args.projectId != null && !state.projects.find((p) => p.id === args.projectId)) throw new Error('المشروع غير موجود')
        const id = nextId(state.custodyFiles)
        const openedAt = new Date().toISOString().slice(0, 10)
        const file: CustodyFile = {
          id, fileNumber: custodyFileNumber(id, openedAt),
          employeeId: args.employeeId, projectId: args.projectId,
          reason: args.reason.trim(), notes: args.notes.trim(),
          openedAt, status: 'open', settledAt: null,
          returnedMinor: 0, shortageMinor: 0, settleTreasury: null,
        }
        set({ custodyFiles: [...state.custodyFiles, file] })
        return file
      },

      fundCustodyFile: (args) => {
        const state = get()
        const file = state.custodyFiles.find((f) => f.id === args.fileId)
        if (!file) throw new Error('ملف العهدة غير موجود')
        assertFileOpen(file)
        const emp = state.employees.find((e) => e.id === file.employeeId)
        const entryLines = buildCustodyFundEntry(args.amountMinor, args.treasury, `${file.fileNumber} — ${emp?.nameAr ?? ''}`)
        const txId = nextId(state.custodyTxs)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تعزيز عهدة ${file.fileNumber} — ${emp?.nameAr ?? ''}${args.description ? ` — ${args.description}` : ''}`,
          sourceType: 'payment_voucher', sourceId: txId, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const tx: CustodyTx = {
          id: txId, fileId: file.id, type: 'fund', date: now.slice(0, 10),
          amountMinor: args.amountMinor, excessMinor: 0, description: args.description.trim(),
          treasury: args.treasury, projectId: null, purchaseId: null, journalEntryId: entryId,
        }
        set({ custodyTxs: [...state.custodyTxs, tx], journal: [...state.journal, entry] })
        return tx
      },

      postCustodyExpense: (args) => {
        const state = get()
        const file = state.custodyFiles.find((f) => f.id === args.fileId)
        if (!file) throw new Error('ملف العهدة غير موجود')
        assertFileOpen(file)
        if (!args.description.trim()) throw new Error('بيان المصروف مطلوب')
        const projectId = args.projectId !== undefined ? args.projectId : file.projectId
        if (projectId != null && !state.projects.find((p) => p.id === projectId)) throw new Error('المشروع غير موجود')
        const summary = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === file.id))
        const { fromCustodyMinor, excessMinor } = splitCustodyExpense(summary.remainingMinor, args.amountMinor, args.allowExcess ?? false)
        // المصروف على مشروع → 5110 يدخل ربحيته؛ وإلا مصروفات عمومية 5108
        const expenseAccount = args.expenseAccount ?? (projectId != null ? '5110' : '5108')
        const entryLines = buildCustodyExpenseEntry(expenseAccount, fromCustodyMinor, excessMinor, `${args.description.trim()} (${file.fileNumber})`)
        const txId = nextId(state.custodyTxs)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const emp = state.employees.find((e) => e.id === file.employeeId)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `مصروف من عهدة ${file.fileNumber} — ${args.description.trim()}${excessMinor > 0 ? ` (زيادة ${excessMinor} مستحقة لـ${emp?.nameAr ?? 'الموظف'})` : ''}`,
          sourceType: 'payment_voucher', sourceId: txId, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const tx: CustodyTx = {
          id: txId, fileId: file.id, type: 'expense', date: now.slice(0, 10),
          amountMinor: args.amountMinor, excessMinor, description: args.description.trim(),
          treasury: null, projectId, purchaseId: null, journalEntryId: entryId,
        }
        // مصروف مربوط بمشروع → بند تكلفة يدخل ربحيته (طلب المالك)
        let projectCosts = state.projectCosts
        if (projectId != null) {
          projectCosts = [...projectCosts, {
            id: nextId(projectCosts), projectId, kind: 'other' as CostKind,
            amountMinor: args.amountMinor, date: now.slice(0, 10),
            description: `${args.description.trim()} — من عهدة ${file.fileNumber}`,
            payment: 'cash' as const, journalEntryId: entryId,
          }]
        }
        set({ custodyTxs: [...state.custodyTxs, tx], journal: [...state.journal, entry], projectCosts })
        return tx
      },

      settleCustodyFile: (args) => {
        const state = get()
        const file = state.custodyFiles.find((f) => f.id === args.fileId)
        if (!file) throw new Error('ملف العهدة غير موجود')
        assertFileOpen(file)
        const summary = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === file.id))
        const entryLines = buildCustodyFileSettleEntry(summary.remainingMinor, args.returnedMinor, args.treasury, file.fileNumber)
        const shortage = summary.remainingMinor - args.returnedMinor
        const emp = state.employees.find((e) => e.id === file.employeeId)
        const now = new Date().toISOString()

        let journal = state.journal
        let custodyTxs = state.custodyTxs
        let employeeAdvances = state.employeeAdvances
        let entryId: number | null = null

        if (entryLines) {
          entryId = nextId(journal)
          journal = [...journal, {
            id: entryId, entryNumber: entryId, date: now.slice(0, 10),
            description: `تسوية عهدة ${file.fileNumber} — ${emp?.nameAr ?? ''}: مرتجع ${args.returnedMinor}${shortage > 0 ? ` + عجز ${shortage} سلفة تُخصم من الراتب` : ''}`,
            sourceType: 'payment_voucher', sourceId: file.id, lines: entryLines,
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }]
          if (args.returnedMinor > 0) {
            custodyTxs = [...custodyTxs, {
              id: nextId(custodyTxs), fileId: file.id, type: 'return' as const, date: now.slice(0, 10),
              amountMinor: args.returnedMinor, excessMinor: 0, description: 'مرتجع نقدي عند التسوية',
              treasury: args.treasury, projectId: null, purchaseId: null, journalEntryId: entryId,
            }]
          }
          if (shortage > 0) {
            custodyTxs = [...custodyTxs, {
              id: nextId(custodyTxs), fileId: file.id, type: 'shortage' as const, date: now.slice(0, 10),
              amountMinor: shortage, excessMinor: 0, description: 'عجز عهدة — سلفة على الموظف',
              treasury: null, projectId: null, purchaseId: null, journalEntryId: entryId,
            }]
            // العجز يصير سلفة تُخصم من الرواتب على دفعات بحرية المالك (طلب المالك)
            const advId = nextId(employeeAdvances)
            employeeAdvances = [...employeeAdvances, {
              id: advId, advanceNumber: `ADV-${String(advId).padStart(4, '0')}`,
              employeeId: file.employeeId, date: now,
              amountMinor: shortage, recoveredMinor: 0,
              source: 'custody_shortage' as const, custodyFileId: file.id,
              treasury: args.treasury, notes: `عجز تسوية ${file.fileNumber}`,
              journalEntryId: entryId,
            }]
          }
        }

        const settled: CustodyFile = {
          ...file, status: 'settled', settledAt: now.slice(0, 10),
          returnedMinor: args.returnedMinor, shortageMinor: Math.max(0, shortage),
          settleTreasury: args.treasury,
        }
        set({
          custodyFiles: state.custodyFiles.map((f) => (f.id === file.id ? settled : f)),
          custodyTxs, journal, employeeAdvances,
        })
        return settled
      },

      getCustodySummary: (fileId) => summarizeCustody(get().custodyTxs.filter((t) => t.fileId === fileId)),

      addProjectExtract: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        if (project.status === 'completed') throw new Error('المشروع مقفل — لا مستخلصات جديدة')
        const totals = computeExtractTotals(args.grossMinor, project.retentionPercent, args.vatPercent)
        const id = nextId(state.projectExtracts)
        const extractNumber = `PRX-${String(id).padStart(4, '0')}`
        const lines = buildExtractEntry(totals, args.payment, extractNumber, args.treasury ?? '1101')
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `مستخلص ${extractNumber} — ${project.nameAr}`,
          sourceType: 'project_extract', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const extract: ProjectExtract = {
          id, extractNumber, projectId: project.id, date: now,
          description: args.description, payment: args.payment, totals, journalEntryId: entryId,
        }
        set({ projectExtracts: [...state.projectExtracts, extract], journal: [...state.journal, entry] })
        return extract
      },
      addProjectCost: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        // الدفع من عهدة موظف (طلب المالك): تُفحص وتُخصم من ملفه بدل الخزينة
        let custodyFile: CustodyFile | null = null
        if (args.payment === 'cash' && args.custodyFileId != null) {
          custodyFile = state.custodyFiles.find((f) => f.id === args.custodyFileId) ?? null
          if (!custodyFile) throw new Error('ملف العهدة غير موجود')
          assertFileOpen(custodyFile)
          const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === custodyFile!.id)).remainingMinor
          if (args.amountMinor > remaining) throw new Error(`التكلفة أكبر من المتبقي في ملف العهدة (${remaining})`)
        }
        const payAccount = custodyFile ? CUSTODY_ACCOUNT : (args.treasury ?? '1101')
        const lines = buildProjectCostEntry(args.amountMinor, args.payment, args.description || project.nameAr, payAccount)
        const now = new Date().toISOString()
        const id = nextId(state.projectCosts)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تكلفة على ${project.nameAr}: ${args.description || '—'}${custodyFile ? ` — من عهدة ${custodyFile.fileNumber}` : ''}`,
          sourceType: 'project_cost', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cost: ProjectCost = {
          id, projectId: project.id, date: now, kind: args.kind,
          description: args.description, amountMinor: args.amountMinor, payment: args.payment, journalEntryId: entryId,
        }
        let custodyTxs = state.custodyTxs
        if (custodyFile) {
          custodyTxs = [...custodyTxs, {
            id: nextId(custodyTxs), fileId: custodyFile.id, type: 'expense' as const,
            date: now.slice(0, 10), amountMinor: args.amountMinor, excessMinor: 0,
            description: `تكلفة مشروع ${project.nameAr}: ${args.description || '—'}`,
            treasury: null, projectId: project.id, purchaseId: null, journalEntryId: entryId,
          }]
        }
        set({ projectCosts: [...state.projectCosts, cost], journal: [...state.journal, entry], custodyTxs })
        return cost
      },
      releaseRetention: (projectId, treasury = '1101') => {
        const state = get()
        const project = state.projects.find((p) => p.id === projectId)
        if (!project) throw new Error('المشروع غير موجود')
        const held = state.projectExtracts.filter((e) => e.projectId === projectId).reduce((a, e) => a + e.totals.retentionMinor, 0)
        const released = state.retentionReleases.filter((r) => r.projectId === projectId).reduce((a, r) => a + r.amountMinor, 0)
        const remaining = held - released
        const lines = buildRetentionReleaseEntry(remaining, project.nameAr, treasury) // يرمي لو صفر
        const now = new Date().toISOString()
        const id = nextId(state.retentionReleases)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `إفراج عن محتجزات ${project.nameAr} وإقفال المشروع`,
          sourceType: 'retention_release', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          retentionReleases: [...state.retentionReleases, { id, projectId, date: now, amountMinor: remaining, journalEntryId: entryId }],
          journal: [...state.journal, entry],
          projects: state.projects.map((p) => (p.id === projectId ? { ...p, status: 'completed' as const } : p)),
        })
        return { amount: remaining }
      },
      getProjectProfit: (projectId) => {
        const state = get()
        const project = state.projects.find((p) => p.id === projectId)
        if (!project) throw new Error('المشروع غير موجود')
        const released = state.retentionReleases.filter((r) => r.projectId === projectId).reduce((a, r) => a + r.amountMinor, 0)
        return projectProfit(
          project,
          state.projectExtracts.filter((e) => e.projectId === projectId).map((e) => ({ grossMinor: e.totals.grossMinor, retentionMinor: e.totals.retentionMinor })),
          state.projectCosts.filter((c) => c.projectId === projectId).map((c) => ({ kind: c.kind, amountMinor: c.amountMinor })),
          released,
        )
      },

      /* ─── العيادة (القرار 27) ─── */
      addClinicPatient: (p) => {
        const state = get()
        if (!p.nameAr.trim()) throw new Error('اسم المريض مطلوب')
        const patient: ClinicPatient = { ...p, id: nextId(state.clinicPatients) }
        set({ clinicPatients: [...state.clinicPatients, patient] })
        return patient
      },
      addClinicVisit: (args) => {
        const state = get()
        const patient = state.clinicPatients.find((p) => p.id === args.patientId)
        if (!patient) throw new Error('المريض غير مسجل')
        if (args.planId != null) {
          const plan = state.treatmentPlans.find((pl) => pl.id === args.planId)
          if (!plan) throw new Error('خطة العلاج غير موجودة')
          if (plan.patientId !== patient.id) throw new Error('الخطة لمريض آخر')
          if (plan.doneSessions >= plan.totalSessions) throw new Error('اكتملت جلسات هذه الخطة')
        }
        const totals = computeVisitTotals({ kind: args.kind, feeMinor: args.feeMinor, paidMinor: args.paidMinor, vatPercent: args.vatPercent })
        const id = nextId(state.clinicVisits)
        const visitNumber = `VIS-${String(id).padStart(4, '0')}`
        const lines = buildVisitEntry(totals, `${visitNumber} — ${patient.nameAr}`, args.treasury ?? '1101')
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `زيارة ${visitNumber} — ${patient.nameAr}`,
          sourceType: 'clinic_visit', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const visit: ClinicVisit = {
          id, visitNumber, patientId: patient.id, date: now, kind: args.kind,
          complaint: args.complaint, diagnosis: args.diagnosis, treatment: args.treatment,
          totals, planId: args.planId, journalEntryId: entryId,
        }
        set({
          clinicVisits: [...state.clinicVisits, visit],
          journal: [...state.journal, entry],
          treatmentPlans: args.planId != null
            ? state.treatmentPlans.map((pl) => (pl.id === args.planId ? { ...pl, doneSessions: pl.doneSessions + 1 } : pl))
            : state.treatmentPlans,
        })
        return visit
      },
      addTreatmentPlan: (args) => {
        const state = get()
        if (!state.clinicPatients.some((p) => p.id === args.patientId)) throw new Error('المريض غير مسجل')
        const errors = validateTreatmentPlan({ totalSessions: args.totalSessions, totalFeeMinor: args.totalFeeMinor })
        if (errors.length) throw new Error(errors.join(' — '))
        const plan: TreatmentPlan = {
          id: nextId(state.treatmentPlans), patientId: args.patientId, title: args.title.trim() || 'خطة علاج',
          totalSessions: args.totalSessions, totalFeeMinor: args.totalFeeMinor,
          sessionFeesMinor: sessionFees(args.totalFeeMinor, args.totalSessions),
          doneSessions: 0, createdAt: new Date().toISOString(),
        }
        set({ treatmentPlans: [...state.treatmentPlans, plan] })
        return plan
      },
      collectFromPatient: (patientId, amountMinor, treasury = '1101') => {
        const state = get()
        const patient = state.clinicPatients.find((p) => p.id === patientId)
        if (!patient) throw new Error('المريض غير مسجل')
        const balance = get().getPatientBalance(patientId)
        if (amountMinor > balance) throw new Error(`المبلغ أكبر من رصيد المريض المستحق`)
        const lines = buildPatientCollectionEntry(amountMinor, patient.nameAr, treasury)
        const now = new Date().toISOString()
        const id = nextId(state.clinicCollections)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تحصيل متأخرات من ${patient.nameAr}`,
          sourceType: 'clinic_visit', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const collection: ClinicCollection = { id, patientId, date: now, amountMinor, journalEntryId: entryId }
        set({ clinicCollections: [...state.clinicCollections, collection], journal: [...state.journal, entry] })
        return collection
      },
      getPatientBalance: (patientId) => {
        const state = get()
        return patientBalance(
          state.clinicVisits.filter((v) => v.patientId === patientId).map((v) => ({ dueMinor: v.totals.dueMinor })),
          state.clinicCollections.filter((c) => c.patientId === patientId).map((c) => ({ amountMinor: c.amountMinor })),
        )
      },
      addAppointment: (a) => {
        const state = get()
        if (!state.clinicPatients.some((p) => p.id === a.patientId)) throw new Error('المريض غير مسجل')
        const appt: ClinicAppointment = { ...a, id: nextId(state.clinicAppointments), done: false }
        set({ clinicAppointments: [...state.clinicAppointments, appt] })
        return appt
      },
      markAppointmentDone: (id) => {
        set((s) => ({ clinicAppointments: s.clinicAppointments.map((a) => (a.id === id ? { ...a, done: true } : a)) }))
      },

      /* ─── معرض السيارات (القرار 27) ─── */
      addCar: (args) => {
        const state = get()
        const errors = validateCar(args, state.cars.map((c) => c.plateOrVin))
        if (errors.length) throw new Error(errors.join(' — '))
        const label = `${args.make} ${args.model} ${args.year} (${args.plateOrVin})`
        const lines = buildCarPurchaseEntry(args.purchaseCostMinor, args.payment, label, args.treasury ?? '1101')
        const now = new Date().toISOString()
        const id = nextId(state.cars)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `شراء سيارة ${label}`,
          sourceType: 'car_purchase', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const car: Car = {
          id, make: args.make.trim(), model: args.model.trim(), year: args.year,
          plateOrVin: args.plateOrVin.trim(), purpose: args.purpose, status: 'in_stock',
          odometerKm: args.odometerKm, purchaseCostMinor: args.purchaseCostMinor, prepCostMinor: 0,
          purchaseEntryId: entryId, prepEntryIds: [],
          salePriceMinor: null, saleProfitMinor: null, saleEntryId: null, soldAt: null, buyerName: '',
          rentalEquipmentId: null, notes: args.notes,
        }
        set({ cars: [...state.cars, car], journal: [...state.journal, entry] })
        return car
      },
      addCarPrep: (carId, amountMinor, payment, description, treasury = '1101') => {
        const state = get()
        const car = state.cars.find((c) => c.id === carId)
        if (!car) throw new Error('السيارة غير موجودة')
        if (car.status === 'sold') throw new Error('السيارة مباعة — لا ترسمل تجهيزات عليها')
        const label = `${car.make} ${car.model} (${car.plateOrVin})`
        const lines = buildCarPrepEntry(amountMinor, payment, `${label}: ${description || 'تجهيز'}`, treasury)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تجهيز ${label}: ${description || '—'}`,
          sourceType: 'car_purchase', sourceId: carId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          journal: [...state.journal, entry],
          cars: state.cars.map((c) => (c.id === carId
            ? { ...c, prepCostMinor: c.prepCostMinor + amountMinor, prepEntryIds: [...c.prepEntryIds, entryId] }
            : c)),
        })
      },
      sellCar: (args) => {
        const state = get()
        const car = state.cars.find((c) => c.id === args.carId)
        if (!car) throw new Error('السيارة غير موجودة')
        if (car.status !== 'in_stock') throw new Error(car.status === 'sold' ? 'السيارة مباعة بالفعل' : 'السيارة مؤجرة حالياً — أنهِ عقدها أولاً')
        const fullCost = car.purchaseCostMinor + car.prepCostMinor
        const totals = computeCarSale(args.priceMinor, fullCost, args.vatPercent)
        const label = `${car.make} ${car.model} ${car.year} (${car.plateOrVin})`
        const lines = buildCarSaleEntry(totals, args.payment, label, args.treasury ?? '1101')
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `بيع سيارة ${label}${args.buyerName ? ` — ${args.buyerName}` : ''}`,
          sourceType: 'car_sale', sourceId: car.id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: Car = {
          ...car, status: 'sold', salePriceMinor: totals.priceMinor, saleProfitMinor: totals.profitMinor,
          saleEntryId: entryId, soldAt: now, buyerName: args.buyerName.trim(),
        }
        set({ cars: state.cars.map((c) => (c.id === car.id ? updated : c)), journal: [...state.journal, entry] })
        return updated
      },
      moveCarToRental: (carId, dailyRateMinor, monthlyRateMinor) => {
        const state = get()
        const car = state.cars.find((c) => c.id === carId)
        if (!car) throw new Error('السيارة غير موجودة')
        if (car.status === 'sold') throw new Error('السيارة مباعة')
        if (car.rentalEquipmentId != null) throw new Error('السيارة مضافة لوحدة الإيجار بالفعل')
        if (dailyRateMinor <= 0 && monthlyRateMinor <= 0) throw new Error('حدد سعر إيجار يومياً أو شهرياً')
        const eqId = nextId(state.equipment)
        const eq: Equipment = {
          id: eqId, nameAr: `${car.make} ${car.model} ${car.year}`, code: car.plateOrVin,
          dailyRateMinor, hourlyRateMinor: 0, monthlyRateMinor,
          meterReading: car.odometerKm, serviceEveryHours: 0, lastServiceReading: car.odometerKm,
          notes: 'سيارة معرض محولة للتأجير',
        }
        set({
          equipment: [...state.equipment, eq],
          cars: state.cars.map((c) => (c.id === carId ? { ...c, status: 'renting' as const, purpose: 'rent' as const, rentalEquipmentId: eqId } : c)),
        })
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
        const entryLines = buildTicketDeliveryEntry(totals, input.payment, ticket.ticketNumber, input.treasury ?? '1101')

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
        const entryLines = buildAssetPurchaseEntry(args.costMinor, args.paidMinor, assetNumber, args.treasury ?? '1101')

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

      /* ─── الشيكات (أوراق القبض والدفع) ─── */
      receiveCheque: (args) => {
        const state = get()
        validateCheque(args)
        const customer = state.customers.find((c) => c.id === args.partyId)
        if (!customer) throw new Error('العميل غير موجود')
        if (state.cheques.some((c) => c.direction === 'incoming' && c.chequeNumber === args.chequeNumber.trim() && c.bankName === args.bankName.trim())) {
          throw new Error('شيك بنفس الرقم والبنك مسجل من قبل')
        }
        const id = nextId(state.cheques)
        const now = new Date().toISOString()
        const note = `شيك وارد ${args.chequeNumber} — ${customer.nameAr}`
        const lines = buildChequeReceiveEntry(args.amountMinor, note)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `استلام ${note} (استحقاق ${args.dueDate})`,
          sourceType: 'cheque_receive', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cheque: Cheque = {
          id, chequeNumber: args.chequeNumber.trim(), direction: 'incoming',
          partyId: customer.id, partyName: customer.nameAr, bankName: args.bankName.trim(),
          amountMinor: args.amountMinor, dueDate: args.dueDate, status: 'held', notes: args.notes,
          createdAt: now, receiveEntryId: entryId, settleEntryId: null, reverseEntryId: null,
          depositedAt: null, settledAt: null,
        }
        set({ cheques: [...state.cheques, cheque], journal: [...state.journal, entry] })
        return cheque
      },

      issueCheque: (args) => {
        const state = get()
        validateCheque(args)
        const supplier = state.suppliers.find((s) => s.id === args.partyId)
        if (!supplier) throw new Error('المورد غير موجود')
        if (state.cheques.some((c) => c.direction === 'outgoing' && c.chequeNumber === args.chequeNumber.trim())) {
          throw new Error('رقم شيك صادر مكرر — كل ورقة من دفترك برقم فريد')
        }
        const id = nextId(state.cheques)
        const now = new Date().toISOString()
        const note = `شيك صادر ${args.chequeNumber} — ${supplier.nameAr}`
        const lines = buildChequeIssueEntry(args.amountMinor, note)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تحرير ${note} (استحقاق ${args.dueDate})`,
          sourceType: 'cheque_issue', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cheque: Cheque = {
          id, chequeNumber: args.chequeNumber.trim(), direction: 'outgoing',
          partyId: supplier.id, partyName: supplier.nameAr, bankName: args.bankName.trim(),
          amountMinor: args.amountMinor, dueDate: args.dueDate, status: 'issued', notes: args.notes,
          createdAt: now, receiveEntryId: entryId, settleEntryId: null, reverseEntryId: null,
          depositedAt: null, settledAt: null,
        }
        set({ cheques: [...state.cheques, cheque], journal: [...state.journal, entry] })
        return cheque
      },

      setChequeStatus: (chequeId, status) => {
        const state = get()
        const cheque = state.cheques.find((c) => c.id === chequeId)
        if (!cheque) throw new Error('الشيك غير موجود')
        assertTransition(cheque.status, status)
        const now = new Date().toISOString()
        const note = `شيك ${cheque.chequeNumber} — ${cheque.partyName}`
        // الإيداع تحول حالة فقط — لا قيد (الورقة ما زالت أصلاً بنفس القيمة)
        if (status === 'deposited') {
          const updated: Cheque = { ...cheque, status, depositedAt: now }
          set({ cheques: state.cheques.map((c) => (c.id === chequeId ? updated : c)) })
          return updated
        }
        const built =
          status === 'collected' ? { lines: buildChequeCollectEntry(cheque.amountMinor, note), src: 'cheque_collect' as const, desc: `تحصيل ${note}`, reversal: false }
          : status === 'bounced' ? { lines: buildChequeBounceEntry(cheque.amountMinor, note), src: 'cheque_bounce' as const, desc: `ارتداد ${note} — عاد الدين على العميل`, reversal: true }
          : status === 'cleared' ? { lines: buildChequeClearEntry(cheque.amountMinor, note), src: 'cheque_clear' as const, desc: `صرف ${note} من البنك`, reversal: false }
          : { lines: buildChequeCancelEntry(cheque.amountMinor, note), src: 'cheque_cancel' as const, desc: `إلغاء ${note} — عاد الدين للمورد`, reversal: true }
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: built.desc,
          sourceType: built.src, sourceId: cheque.id, lines: built.lines,
          createdBy: 'المالك', createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: built.reversal ? cheque.receiveEntryId : null,
        }
        const updated: Cheque = {
          ...cheque, status, settledAt: now,
          settleEntryId: built.reversal ? cheque.settleEntryId : entryId,
          reverseEntryId: built.reversal ? entryId : cheque.reverseEntryId,
        }
        set({
          cheques: state.cheques.map((c) => (c.id === chequeId ? updated : c)),
          journal: built.reversal
            ? [...state.journal.map((e) => (e.id === cheque.receiveEntryId ? { ...e, reversedByEntryId: entryId } : e)), entry]
            : [...state.journal, entry],
        })
        return updated
      },
    }),
    {
      name: 'shopsys-data',
      version: 8, // 8 = ملفات العهد المتكاملة + استرداد السلف على شهور (7 = خزائن متعددة + دفع مجزأ)
      // القرار 28: قاعدة البيانات مشفرة AES-256-GCM بمفتاح مشتق لهذا الجهاز
      storage: createJSONStorage(() => secureStorage),
      // ترحيل البيانات المحفوظة بالأشكال القديمة (أقسام هرمية، stockQty، مرتجعات وورديات وجرد)
      migrate: (persisted: unknown) => {
        const s = persisted as Partial<DataState>
        return {
          ...s,
          // ترحيل الخزائن المتعددة: الحسابات القديمة تحصل على الافتراضيتين
          treasuries: s.treasuries && s.treasuries.length > 0 ? s.treasuries : DEFAULT_TREASURIES,
          categories: (s.categories ?? []).map((c) => ({ ...c, parentId: c.parentId ?? null })),
          items: (s.items ?? []).map((it) => ({ ...it, stockQty: it.stockQty ?? 0, warrantyMonths: it.warrantyMonths ?? 0 })),
          customers: (s.customers ?? []).map((c) => ({ ...EMPTY_EXTENDED, ...c })),
          suppliers: (s.suppliers ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          employees: (s.employees ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          payrollRuns: s.payrollRuns ?? [],
          installmentPlans: s.installmentPlans ?? [],
          vehicles: s.vehicles ?? [],
          trips: s.trips ?? [],
          // ترقية القرار 25: معدات قديمة تحصل على حقول العدّاد والأسعار الجديدة
          equipment: (s.equipment ?? []).map((e) => ({
            ...e,
            hourlyRateMinor: e.hourlyRateMinor ?? 0,
            monthlyRateMinor: e.monthlyRateMinor ?? 0,
            meterReading: e.meterReading ?? 0,
            serviceEveryHours: e.serviceEveryHours ?? 0,
            lastServiceReading: e.lastServiceReading ?? 0,
          })),
          // عقود قديمة = يومية بلا عدّاد
          rentalContracts: (s.rentalContracts ?? []).map((c) => ({
            ...c,
            rateType: c.rateType ?? 'daily',
            startReading: c.startReading ?? null,
            endReading: c.endReading ?? null,
            extraMinor: c.extraMinor ?? 0,
            extraEntryId: c.extraEntryId ?? null,
          })),
          operatorShifts: s.operatorShifts ?? [],
          labTests: s.labTests ?? [],
          labReferrers: s.labReferrers ?? [],
          labPatients: s.labPatients ?? [],
          labOrders: s.labOrders ?? [],
          projects: s.projects ?? [],
          quotations: s.quotations ?? [],
          custodyFiles: s.custodyFiles ?? [],
          custodyTxs: s.custodyTxs ?? [],
          employeeAdvances: (s.employeeAdvances ?? []).map((a: EmployeeAdvance) => ({
            ...a,
            recoveredMinor: a.recoveredMinor ?? 0,
            source: a.source ?? ('cash' as const),
            custodyFileId: a.custodyFileId ?? null,
          })),
          projectExtracts: s.projectExtracts ?? [],
          projectCosts: s.projectCosts ?? [],
          retentionReleases: s.retentionReleases ?? [],
          clinicPatients: s.clinicPatients ?? [],
          clinicVisits: s.clinicVisits ?? [],
          treatmentPlans: s.treatmentPlans ?? [],
          clinicCollections: s.clinicCollections ?? [],
          clinicAppointments: s.clinicAppointments ?? [],
          cars: s.cars ?? [],
          tickets: s.tickets ?? [],
          transfers: s.transfers ?? [],
          batches: s.batches ?? [],
          assets: s.assets ?? [],
          serials: s.serials ?? [],
          cheques: s.cheques ?? [],
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
