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
import { computeLandedCosts, weightedAverage, allocateExpense, type ExpenseInput, type CostLine } from '../core/costing.ts'
import { computeTotals, buildSaleEntry, baseQty, type CartLine, type PaymentMethod, type CartTotals } from '../core/pos.ts'
import { buildReturnLines, buildReturnEntry, deriveTaxConfig } from '../core/returns.ts'
import { saleEditBlocks } from '../core/invoiceEdit.ts'
import { auditFromPatch, appendAudit, sanitizeText, validateIssue, verifyPin, type AuditEvent, type AppUser, type IssueReport, type IssueStatus } from '../core/audit.ts'
import {
  EMPTY_GUARD, registerFailure, lockoutMinutesLeft, tempPinExpired, validateResetRequest,
  type LoginGuard, type OwnerTempPin, type PinResetRequest,
} from '../core/auth.ts'
import { validateConsumption, buildConsumptionEntry, consumptionTotalMinor, INTERNAL_USE_ACCOUNT } from '../core/consumption.ts'
import { validateWalletService, computeWalletTotals, buildWalletServiceEntry, type WalletServiceInput, type WalletServiceType, type WalletProvider, type WalletServiceTotals } from '../core/walletServices.ts'
import { buildPurchaseEntryV2, buildLateExpenseEntry, buildPurchaseReturnLines, purchaseReturnTotal, buildPurchaseReturnEntry, type PurchaseReturnLine, type ExpensePaymentCredit } from '../core/purchases.ts'
import { computeStocktake, buildAdjustmentEntry, type CountInput, type StocktakeResult } from '../core/stocktake.ts'
import { validateRecipe, recipeIngredientsCostMinor, recipeUnitCostMinor, buildProductionEntry, explodeIngredientNeeds, type Recipe, type RecipeInput, type ProductionOrder } from '../core/recipes.ts'
import { validateProfile, jewelryPriceMinor, buildScrapPurchaseEntry, buildScrapSaleEntry, planScrapConsumption, computeTradeInNet, validateTradeIn, EMPTY_GRAM_PRICES, KARAT_LABELS, type GramPrices, type JewelryProfile, type Karat, type ScrapLot, type ScrapSale } from '../core/jewelry.ts'
import { validatePriceList, resolvePrice, type PriceList, type PriceListEntry } from '../core/priceLists.ts'
import { validateProvider, splitCoverage, buildInsuredEntry, buildClaimSettlementEntry, type InsuranceProvider, type InsuranceClaim } from '../core/insurance.ts'
import { variantKey, undistributedQty, hasVariantStock, validateVariantAssignment, planVariantDeduction, type VariantStock } from '../core/variants.ts'
import { buildReceiptVoucherEntry, buildPaymentVoucherEntry, buildTransferEntry, validateManualEntry, type VoucherKind, type TreasuryAccount } from '../core/accounting.ts'
import { STANDARD_COA, buildReversalLines, type JournalLine } from '../core/ledger.ts'
import { validateCustomAccount, customAsAccounts, rootOfParent, type CustomAccount } from '../core/customAccounts.ts'
import { validateLaundryOrder, laundryTotal, buildLaundryPrepaidEntry, buildLaundryDeliverEntry, buildLaundryCancelEntry, assertLaundryTransition, type LaundryLine, type LaundryStatus } from '../core/laundry.ts'
import { validateCommissionParty, buildEarnedAccrualEntry, buildEarnedCollectEntry, buildOwedAccrualEntry, buildOwedPayEntry, type CommissionParty, type CommissionDirection } from '../core/commissions.ts'
import { fullCoa } from '../core/treasury.ts'
import { validateOpenShift, currentOpenShift, summarizeShift, buildVarianceExpenseEntry, buildVarianceAdvanceEntry, type Shift } from '../core/shifts.ts'
import { computePayrollLine, computePayrollTotals, validatePayrollRun, buildPayrollEntry, monthLabelAr, type PayrollPayMode, type PayrollLineInput, type PayrollLineComputed, type PayrollTotals } from '../core/payroll.ts'
import { buildSchedule, applyPayment, planProgress, type InstallmentItem } from '../core/installments.ts'
import { validateTrip, computeTripTotals, buildTripEntry, type TripInput, type TripTotals, buildDriverCommissionEntry, buildDriverSettlementEntry } from '../core/logistics.ts'
import { validateRental, computeRentalTotals, buildRentalOpenEntry, buildRentalCloseEntry, type RentalInput, type RentalTotals } from '../core/rental.ts'
import { makeUniqueRefCode } from '../core/refcode.ts'
import { validateTicket, validateDelivery, computeTicketTotals, buildTicketDeliveryEntry, validateService, TICKET_TRANSITIONS, type TicketStatus, type TicketDeliveryInput, type TicketTotals, type MaintenanceService, type TicketServiceInput } from '../core/maintenance.ts'
import { validateTransfer, computeWarehouseStock, buildWarehouseDocs, transferTotalQty, type TransferLine } from '../core/transfers.ts'
import { planFefo, applyFefo, isValidExpiryDate, ExpiredStockError, type StockBatch } from '../core/batches.ts'
import { validateWastage, buildWastageEntry, wastageTotalMinor } from '../core/wastage.ts'
import { validateOpening, buildOpeningDeltaEntry, openingKey, OPENING_KIND_LABELS, type OpeningKind } from '../core/openingBalances.ts'
import { validateSettlement, buildSettlementEntry, settlementVariance, SETTLEMENT_LABELS, type SettlementInput } from '../core/settlement.ts'
import { customerStatement, supplierStatement, statementBalance, customerUnitDocs } from '../core/statements.ts'
import { buildYearClosingLines, validateYearClose, dateInClosedYear, type FiscalYear } from '../core/fiscal.ts'
import { useAppStore } from '../stores/app.store.ts'
import { validateExchange, computeExchangeNet } from '../core/exchange.ts'
import { validateRestaurantOrder, feeLine, serviceChargeMinor, orderSubtotalMinor, occupiedTables, type RestaurantOrder, type RestaurantOrderType } from '../core/restaurant.ts'
import { validateAsset, buildAssetPurchaseEntry, buildAssetPaymentEntry, buildAssetInstallments, buildDepreciationEntry, monthlyDepreciation, nextDepreciationMonth, type AssetInput, type AssetFunding, type AssetInstallment } from '../core/assets.ts'
import { parseSerialsInput, markSold, markReturned, type SerialUnit } from '../core/serials.ts'
import { computeUsageBilling, buildExtraUsageEntry, validateOperatorShift, isValidMeterReading, usageHours, shiftsSummary, equipmentProfitability, EQUIPMENT_COST_LABELS, type RateType, type OperatorShift, type EquipmentCostKind } from '../core/rentalMeter.ts'
import { validateLabTest, validateReferrer, computeLabTotals, buildLabOrderEntry, commissionFor, buildCommissionAccrualEntry, buildCommissionPayoutEntry, canTransition, STARTER_TESTS, ageYears as ageYearsFn, matchRefRange as matchRefRangeFn, evaluateResult as evaluateResultFn, type LabTest, type Referrer, type TestStatus, type LabOrderTotals, type Gender } from '../core/lab.ts'
import {
  custodyFileNumber, validateCustodyFile, summarizeCustody, buildCustodyFundEntry,
  splitCustodyExpense, buildCustodyExpenseEntry, buildCustodySettleEntry as buildCustodyFileSettleEntry,
  assertFileOpen, CUSTODY_ACCOUNT,
  type CustodyFile, type CustodyTx, type CustodySummary,
} from '../core/custody.ts'
import { validateProject, computeExtractTotals, buildExtractEntry, buildProjectCostEntry, buildRetentionReleaseEntry, projectProfit, validateQuotation, quotationTotal, QUOTATION_TRANSITIONS, type Project, type CostKind, type ExtractTotals, type ProjectProfit, type Quotation, type QuotationLine, type QuotationStatus,
  validateBoqItem, boqItemTotal, effectiveContractValue, buildClientAdvanceEntry, buildExtractEntryWithAdvance,
  validateSubContract, buildSubCertificateEntry, buildSubPaymentEntry, buildSubRetentionReleaseEntry, buildSubAdvanceEntry,
  validateBond, buildBondIssueEntry, buildBondReleaseEntry, buildBondForfeitEntry, buildDailyWorkSettlementEntry, computeWip,
  type BoqItem, type ChangeOrder, type SubContract, type SubAdvance, type SubCertificate, type SubPayment, type Bond, type BondType, type DailyWorker, type DailyWorkRecord, type WipResult } from '../core/contracting.ts'
import {
  buildIssueLine, buildMaterialIssueEntry, allocateClientPayment, buildClientReceiptEntry, computeProjectEvm,
  validateApprovalFlow, applyApprovalDecision, APPROVAL_ACTION_LABELS,
  type MaterialRequisition, type MaterialIssueLine, type IssueLineInput, type StockMove,
  type OpenInvoice, type FifoAllocation, type EvmProjectResult,
  type ApprovalAction, type ApprovalFlow, type ApprovalRequest,
} from '../core/projectOps.ts'
import { computeVisitTotals, buildVisitEntry, buildPatientCollectionEntry, validateTreatmentPlan, sessionFees, patientBalance, type VisitKind, type VisitTotals } from '../core/clinic.ts'
import { validateRxLines, validateAttachment, migrateFreeHistory, EMPTY_VITALS, type RxLine, type MedicalHistory, type Vitals, type AttachmentKind } from '../core/prescription.ts'
import { validateCar, buildCarPurchaseEntry, buildCarPrepEntry, computeCarSale, buildCarSaleEntry, buildConsignmentSaleEntry, buildConsignmentPayoutEntry, type CarInput, type CarPurpose, type CarStatus } from '../core/cars.ts'
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
  /** قائمة الأسعار المربوطة (جملة/نصف جملة…) — null = تجزئة */
  priceListId?: number | null
}

export interface Supplier extends PartyExtended {
  id: number
  nameAr: string
  phone: string
  notes: string
  /* مركز الموردين (أمر التعديل) — كلها اختيارية التزاماً بقاعدة المالك */
  contactPerson?: string // مسؤول التواصل
  category?: string // تصنيف: مواد بناء، خدمات، مقاول باطن…
  paymentTermsDays?: number // شروط السداد بالأيام (0 = نقدي)
  bankName?: string
  iban?: string
  active?: boolean
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
  totalMinor: number // إجمالي المديونية المجدولة (شامل هامش التقسيط)
  downPaymentMinor: number
  /**
   * هامش التمويل (الأمر 22 — مراجعة برامج التقسيط): إجمالي الخطة = أصل الدين + الهامش.
   * الهامش يُثبت إيراداً (4111 أرباح تقسيط) بقيد: من ح/ العملاء إلى ح/ 4111 —
   * فترتفع ذمة العميل للإجمالي الجديد ويظهر ربح التقسيط في قائمة الدخل.
   */
  interestMinor?: number
  interestEntryId?: number | null // قيد إثبات الهامش إن وُجد
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
  /** التحصيل الجزئي (إصلاح المالك): المحصَّل نقداً الآن — الباقي دين 1104. غيابه = حسب payment */
  paidMinor?: number
  vatPercent: number
  containerNumbers: string[]
  expenses: { nameAr: string; qty: number; unitAmountMinor: number; source: 'cash' | 'customer' | 'credit' | 'custody'; amountMinor: number }[]
  /** ملف العهدة الذي صُرفت منه مصاريف source='custody' (إن وجدت) */
  custodyFileId?: number | null
  totals: TripTotals
  journalEntryId: number
  notes: string
}

/** استحقاق عمولة سائق عن رحلة — يتجمع حتى التسوية */
export interface DriverDue {
  id: number
  driverId: number
  tripId: number
  date: string
  amountMinor: number
  settled: boolean
  settlementEntryId: number | null
  entryId: number
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

/** مصروف تشغيل معدة (وقود/صيانة/إصلاح/مشغل) — يقيد 5105/خزينة ويغذي ربحية المعدة */
export interface EquipmentCost {
  id: number
  equipmentId: number
  date: string
  kind: EquipmentCostKind
  amountMinor: number
  description: string
  treasury: string
  journalEntryId: number
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
  /** ربط بعميل مالي (إصلاح الترابط): طلباته الآجلة تظهر في كشف حساب العميل */
  linkedCustomerId?: number | null
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
  medicalHistory: string // (قديم) نص حر — يُرحَّل إلى history.extraNotes
  /** التاريخ المرضي المنظم (ترقية العيادة): فصيلة/مزمنة/حساسية/عمليات/أدوية حالية */
  history?: MedicalHistory
  /**
   * ربط المريض بحساب عميل (سؤال المالك: المرضى هم العملاء مالياً) —
   * ملف المريض طبي، وحساب العميل مالي. الربط يجعل كشف حساب العميل
   * يشمل الزيارات، مع بقاء السرية الطبية في ملف العيادة فقط.
   */
  linkedCustomerId?: number | null
  notes: string
}

/** مرفق مستند طبي: أشعة/تحليل/تقرير — صورة مضغوطة أو PDF (Base64 محلياً) */
export interface PatientAttachment {
  id: number
  patientId: number
  kind: AttachmentKind
  name: string // «أشعة صدر 2026-09»
  mime: string // image/jpeg | application/pdf
  dataUrl: string // data:...;base64,...
  addedAt: string // ISO
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
  treatment: string // (قديم) نص حر — الزيارات الجديدة تستخدم rxLines
  /** الروشتة المنظمة (ترقية العيادة): بند لكل دواء بجرعة ووجبات ومدة وتكرار وصرف */
  rxLines?: RxLine[]
  /** العلامات الحيوية: ضغط/نبض/حرارة/وزن */
  vitals?: Vitals
  /** موعد المراجعة المقترح — يُطبع أسفل الروشتة ('' = بلا) */
  nextVisit?: string
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
  /**
   * إن كان التحصيل جاء عبر سند قبض على العميل المرتبط (إصلاح المالك:
   * «حصّلت بسند قبض ولم يخفض رصيد المريض») — السند نفسه يظهر في كشف العميل
   * فلا يُكرر هذا الصف هناك، لكنه يخفض رصيد المريض في ملفه.
   */
  viaVoucherId?: number | null
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

/**
 * سيارة أمانة (Consignment): ملك الغير تُعرض للبيع بعمولة —
 * لا تدخل المخزون ولا قيد عند الاستلام؛ عند البيع: صافي للمالك (2110)
 * والباقي عمولة معرض (4109). ثم سداد المالك يطفئ 2110.
 */
export interface ConsignmentCar {
  id: number
  make: string
  model: string
  year: number
  plateOrVin: string
  ownerName: string
  ownerPhone: string
  /** الصافي المتفق أن يقبضه المالك */
  ownerNetMinor: number
  askingPriceMinor: number // سعر العرض المبدئي
  status: 'available' | 'sold' | 'paid' | 'returned'
  receivedAt: string
  // بيانات البيع
  salePriceMinor: number | null
  commissionMinor: number | null
  vatOnCommissionMinor: number
  buyerName: string
  saleEntryId: number | null
  soldAt: string | null
  payoutEntryId: number | null
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
  /** مصدر التمويل (طلب المالك): نقدي/آجل مورد/رأس مال/جاري شريك */
  funding?: AssetFunding
  /** المورد المرتبط بالجزء الآجل — إلزامي لو funding يترك ديناً (إصلاح «مورد غير موجود») */
  supplierId?: number | null
  paidMinor?: number // المدفوع عند الاقتناء
  /** جدول أقساط الشراء الآجل (يظهر بملف الأصل مع المسدد والمتبقي وتواريخ الصرف) */
  installments?: AssetInstallment[]
  /** سدادات الأصل: كل دفعة بقيدها وتاريخها */
  payments?: { id: number; date: string; amountMinor: number; treasury: string; journalEntryId: number; installmentSeq: number | null }[]
}

/** أمر غسيل (وحدة المغاسل المستقلة — طلب المالك) */
export interface LaundryOrder {
  id: number
  orderNumber: string // LN-0001
  customerId: number | null // null = عميل نقدي عابر
  customerName: string
  phone: string
  receivedAt: string
  promisedAt: string // موعد التسليم الموعود ('' = بلا)
  status: LaundryStatus
  lines: LaundryLine[]
  prepaidMinor: number // العربون المقبوض عند الاستلام
  prepaidEntryId: number | null
  deliverEntryId: number | null
  cancelEntryId: number | null
  totalMinor: number // إجمالي قبل الضريبة (أسعار البنود)
  grandMinor: number // النهائي بعد الضريبة (يتحدد عند التسليم)
  taxMinor: number
  notes: string
  statusHistory: { status: LaundryStatus; at: string }[]
}

/** عمولة خارجية مستحقة للمنشأة لدى الغير (طلب المالك — طبيب له عمولة عند مركز أشعة مثلاً) */
export interface ExternalCommission {
  id: number
  commissionNumber: string // EXC-0001 (لي) / CMO-0001 (عليّ)
  /** القسمان (طلب المالك): earned = لي لدى الغير (إيراد) · owed = عليّ للغير (مصروف) */
  direction: CommissionDirection
  partyId: number | null // شخص/جهة مسجلة في سجل أطراف العمولات
  partyName: string // الجهة: مركز أشعة النور، سمسار…
  date: string
  amountMinor: number
  collectedMinor: number // المحصَّل (لي) أو المدفوع (عليّ) حتى الآن
  description: string
  journalEntryId: number // قيد الاستحقاق: 1112/4112 (لي) أو 5113/2114 (عليّ)
  collections: { id: number; date: string; amountMinor: number; treasury: string; journalEntryId: number }[]
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
/**
 * عملية خدمة محافظ/دفع إلكتروني (طلب المالك — نمط mobileshop):
 * الربح = المحصَّل من العميل − المدفوع للمزوّد، مشتق آلياً.
 */
export interface WalletServiceOp {
  id: number
  opNumber: string // WS-0001
  refCode: string // WLT-YYMMDD-XXXXXC
  date: string
  type: WalletServiceType
  provider: WalletProvider
  targetPhone: string
  customerId: number | null
  paidToProviderMinor: number
  chargeMinor: number
  paidMinor: number
  fundingTreasury: string
  receiveTreasury: string
  totals: WalletServiceTotals
  status: 'done' | 'returned'
  journalEntryId: number
  returnEntryId: number | null
  notes: string
}

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
  /** موعد التسليم الموعود (جولة المغسلة) — '' أو غياب = بلا موعد */
  promisedAt?: string
  status: TicketStatus
  statusHistory: { status: TicketStatus; at: string }[]
  // تُملأ عند التسليم فقط:
  parts: { itemId: number; nameAr: string; qty: number; unitPriceMinor: number; unitCostMinor: number }[]
  /** خدمات مقدمة من الكتالوج بتكلفة وسعر (الأمر 23) — التكلفة لا تُطبع للعميل */
  services?: TicketServiceInput[]
  totals: TicketTotals | null
  payment: 'cash' | 'credit' | null
  journalEntryId: number | null
  deliveredAt: string | null
  notes: string
}

/** مستند إتلاف مخزون (هالك وتوالف) — موثق بسبب ومربوط بقيده (مراجعة نشاط الأغذية) */
export interface WastageDoc {
  id: number
  wastageNumber: string // WST-0001
  date: string // ISO
  reason: string
  lines: { itemId: number; nameAr: string; qty: number; unitCostMinor: number }[]
  totalCostMinor: number
  journalEntryId: number
  notes: string
}

/** مستند صرف داخلي (استهلاك مخزون للتشغيل) — موثق بغرض ومربوط بقيده: مصروف / 1103 */
export interface ConsumptionDoc {
  id: number
  consumptionNumber: string // CNS-0001
  date: string // ISO
  purpose: string
  expenseAccount: string // 5114 افتراضياً أو حساب مصروف آخر
  lines: { itemId: number; nameAr: string; qty: number; unitCostMinor: number }[]
  totalCostMinor: number
  journalEntryId: number
  notes: string
}

/** مستند تسوية شاملة (نمط mobileshop): جرد خزينة/مطابقة عميل أو مورد — الفرق يضرب 5112 إجبارياً */
export interface SettlementDoc {
  id: number
  settlementNumber: string // SET-0001
  date: string // ISO
  section: 'treasury' | 'customer' | 'supplier'
  refId: string | number // كود الخزينة أو رقم الطرف
  refNameAr: string
  bookMinor: number
  actualMinor: number
  varianceMinor: number // الفعلي − الدفتري
  reason: string
  journalEntryId: number | null // null لو الفرق صفر (توثيق مطابقة فقط)
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
  nameAr: string // نولون، جمارك، تأمين... (نص حر + اقتراحات)
  amountMinor: number
  method: 'value' | 'qty'
  /**
   * من دفع هذا المصروف؟ (طلب المالك — ليس إجبارياً على حساب المورد):
   * supplier = على حساب المورد (يزيد ديننا له) — الافتراضي للتوافق الخلفي
   * treasury = دفعته أنا من خزينة/بنك (payAccount)
   * custody  = دفعه موظف من عهدته (custodyFileId)
   */
  paidBy?: 'supplier' | 'treasury' | 'custody'
  payAccount?: string | null // كود الخزينة/البنك عند paidBy=treasury
  custodyFileId?: number | null // ملف العهدة عند paidBy=custody
  /** مصروف لاحق أُضيف بعد ترحيل الفاتورة (Landed Cost Voucher) */
  late?: boolean
  date?: string
}

export interface PurchaseInvoice {
  id: number
  invoiceNumber: string
  /** الرقم المرجعي الفريد للتتبع — PUR-YYMMDD-XXXXXC (يُطبع ويُبحث به) */
  refCode: string
  supplierId: number
  date: string
  lines: PurchaseLine[]
  expenses: PurchaseExpense[]
  goodsTotalMinor: number
  expensesTotalMinor: number
  grandTotalMinor: number
  /**
   * مستحق المورد فقط = البضاعة + المصاريف المحملة على حسابه (طلب المالك):
   * المصاريف التي دفعتُها بنفسي (خزينة/بنك/عهدة) لا تدخل دين المورد أبداً.
   * للفواتير القديمة = grandTotalMinor (كل المصاريف كانت على المورد).
   */
  supplierDueMinor?: number
  paidMinor: number
  treasury?: TreasuryAccount // الخزينة/البنك الذي دُفع منه
  custodyFileId?: number | null // دُفعت من ملف عهدة موظف (طلب المالك)
  projectId?: number | null // مربوطة بمشروع مقاولات
  /** T1: ض.ق.م مدخلات قابلة للخصم قُيّدت 2102 مديناً (للمسجلين ضريبياً) — 0/غياب = ضمن التكلفة */
  inputVatMinor?: number
  notes: string
  journalEntryId: number | null // القيد المتولد (فواتير قديمة قبل الترحيل = null)
  /** سجل تدقيق التعديلات (طلب المالك) */
  editHistory?: { at: string; reason: string; previousEntryId: number; reversalEntryId: number }[]
  /** المخزن الذي وردت إليه البضاعة (الأمر 8) — null/undefined = «مخزن غير محدد» (يعامل كالرئيسي) */
  warehouseId?: number | null
}

/** مرتجع شراء — مربوط بفاتورة الشراء الأصلية، مُقيَّم بتكلفتها النهائية */
export interface PurchaseReturn {
  id: number
  returnNumber: string // PR-0001
  /** الرقم المرجعي الفريد — PRT-YYMMDD-XXXXXC */
  refCode: string
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

/**
 * جزاء/خصم مسجل على موظف (إصلاح فجوة الرواتب): يُسجَّل بمستند مرقم DED-0001
 * بلا قيد لحظة التسجيل — محاسبياً يُخصم عند المسير فيخفض مصروف الرواتب 5102 تلقائياً
 * (طريقة صافي التكلفة). recoveredMinor يتتبع المخصوم منه عبر المسيرات (كامل/جزء/تأجيل).
 */
export interface EmployeeDeduction {
  id: number
  dedNumber: string // DED-0001
  employeeId: number
  date: string
  amountMinor: number
  recoveredMinor: number // المخصوم فعلاً من المسيرات حتى الآن
  reason: string // غياب، تأخير، جزاء إداري…
  notes: string
}

/** سداد نقدي لسلفة موظف خارج المسير: خزينة مدين / 1107 دائن */
export interface AdvanceRepayment {
  id: number
  repayNumber: string // ADR-0001
  employeeId: number
  date: string
  amountMinor: number
  treasury: TreasuryAccount
  journalEntryId: number
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
  /** الرقم المرجعي الفريد للتتبع — SAL-YYMMDD-XXXXXC (يُطبع على الإيصال ويُبحث به) */
  refCode: string
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
  /** سجل تدقيق التعديلات (طلب المالك): كل تعديل يعكس قيده القديم ويولد قيداً جديداً */
  editHistory?: { at: string; reason: string; previousEntryId: number; reversalEntryId: number }[]
  /** المخزن الذي بيعت منه (الأمر 8) — null/undefined = «مخزن غير محدد» (يعامل كالرئيسي) */
  warehouseId?: number | null
}

/** مرتجع مبيعات — دائماً مربوط بفاتورته الأصلية وبقيده العاكس */
export interface SaleReturn {
  id: number
  returnNumber: string // R-0001
  /** الرقم المرجعي الفريد — SRT-YYMMDD-XXXXXC */
  refCode: string
  date: string
  saleId: number // الفاتورة الأصلية
  refund: PaymentMethod // رد نقدي أو تخفيض ذمم العميل
  lines: CartLine[]
  totals: CartTotals
  journalEntryId: number
  reason: string
  shiftId: number | null
}

/** مستند مقايضة ذهب (الصاغة): بيع مشغول جديد + شراء كسر العميل بعملية واحدة — الفرق النقدي فقط بالخزينة */
export interface GoldTradeInDoc {
  id: number
  tradeNumber: string // GTI-0001
  date: string // ISO
  saleId: number // فاتورة المشغول الجديد
  scrapLotId: number // لوط كسر العميل
  saleMinor: number
  scrapValueMinor: number
  netMinor: number // موجب = دفع العميل، سالب = رُدّ له
  notes: string
}

/** مستند استبدال (نشاط الملابس): مرتجع + بيع جديد بعملية واحدة — يربط المستندين والصافي */
export interface ExchangeDoc {
  id: number
  exchangeNumber: string // EXC-0001
  date: string // ISO
  originalSaleId: number
  returnId: number // مستند المرتجع المولد
  newSaleId: number // فاتورة البيع الجديدة
  returnValueMinor: number
  newValueMinor: number
  netMinor: number // موجب = دفع العميل الفرق، سالب = رُدّ له
  notes: string
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
  /* عمق المقاولات (مقارنة pro-acc — طلب المالك) */
  boqItems: BoqItem[] // جداول الكميات لكل مشروع
  changeOrders: ChangeOrder[] // أوامر التغيير على العقود
  clientAdvances: { id: number; projectId: number; date: string; amountMinor: number; recoveredMinor: number; journalEntryId: number }[]
  subContracts: SubContract[] // عقود مقاولي الباطن
  subCertificates: SubCertificate[] // شهادات أعمال الباطن
  subPayments: SubPayment[] // دفعات الباطن وإفراجات محتجزاته
  bonds: Bond[] // خطابات الضمان البنكية
  dailyWorkers: DailyWorker[] // عمال اليومية
  dailyWorkRecords: DailyWorkRecord[] // سجلات أيام العمل (مشروع أو تشغيل عام)
  /* أوامر التعديل: أذون صرف مواد، تدقيق حركة مخزون، تحصيلات FIFO، دفعات باطن مقدمة، موافقات */
  materialRequisitions: MaterialRequisition[] // أذون صرف مواد للمشاريع
  stockMoves: StockMove[] // سجل تدقيق حركات المخزون
  clientSettlements: { id: number; settlementNumber: string; customerId: number; date: string; amountMinor: number; treasury: string; allocations: FifoAllocation[]; unallocatedMinor: number; notes: string; journalEntryId: number }[]
  subAdvances: SubAdvance[] // دفعات مقدمة لمقاولي الباطن (1111)
  approvalFlows: ApprovalFlow[] // مسارات الموافقات المعرفة
  approvalRequests: ApprovalRequest[] // طلبات الاعتماد الجارية والمحسومة
  recipes: Recipe[] // وصفات الأطباق والتصنيع (مطاعم)
  productionOrders: ProductionOrder[] // أوامر الإنتاج المسبق
  gramPrices: GramPrices // أسعار الجرام اليومية بالعيار (صاغة)
  jewelryProfiles: JewelryProfile[] // الوصف الذهبي للأصناف: عيار/وزن/مصنعية
  scrapLots: ScrapLot[] // دفعات الكسر المشتراة (FIFO)
  scrapSales: ScrapSale[] // مبيعات الكسر
  equipmentCosts: EquipmentCost[] // مصاريف تشغيل المعدات (وقود/صيانة/إصلاح)
  priceLists: PriceList[] // قوائم الأسعار (جملة/نصف جملة/VIP)
  priceListEntries: PriceListEntry[] // أسعار خاصة لكل صنف داخل قائمة
  custodyFiles: CustodyFile[] // ملفات عهد الموظفين (طلب المالك — نظام متكامل بنمط pro-acc)
  custodyTxs: CustodyTx[] // حركات ملفات العهد (تعزيز/مصروف/فاتورة/مرتجع/عجز)
  clinicPatients: ClinicPatient[] // العيادة (القرار 27)
  patientAttachments: PatientAttachment[] // مستندات المرضى: أشعة/تحاليل/تقارير
  clinicVisits: ClinicVisit[]
  treatmentPlans: TreatmentPlan[]
  clinicCollections: ClinicCollection[]
  clinicAppointments: ClinicAppointment[]
  cars: Car[] // معرض السيارات (القرار 27)
  consignmentCars: ConsignmentCar[] // سيارات أمانة (بيع بالعمولة)
  driverDues: DriverDue[] // مستحقات سائقين تتجمع وتسوى دفعة واحدة
  insuranceProviders: InsuranceProvider[] // جهات تأمين وتعاقد بنسب تحمل
  insuranceClaims: InsuranceClaim[] // مطالبات تتجمع حتى التحصيل
  variantStocks: VariantStock[] // مصفوفة مخزون لون×مقاس (دفتر فرعي لرصيد الصنف)
  tickets: MaintenanceTicket[]
  /** كتالوج خدمات الصيانة بتكلفة وسعر بيع (الأمر 23) */
  maintenanceServices: MaintenanceService[]
  walletOps: WalletServiceOp[] // خدمات المحافظ والدفع الإلكتروني (نمط mobileshop)
  transfers: StockTransfer[]
  batches: StockBatch[] // دفعات الصلاحية FEFO (القراران 5 و8)
  assets: FixedAsset[]
  externalCommissions: ExternalCommission[] // العمولات بقسميها: لي لدى الغير / عليّ للغير (طلب المالك)
  commissionParties: CommissionParty[] // سجل أشخاص/جهات العمولات — التسجيل إلزامي قبل أي عمولة
  customAccounts: CustomAccount[] // حسابات مخصصة يضيفها المالك للشجرة (بند شجرة الحسابات المفتوحة)
  laundryOrders: LaundryOrder[] // أوامر الغسيل (وحدة المغاسل)
  serials: SerialUnit[] // وحدات السيريال/IMEI والضمان (نمط موبايل شوب)
  cheques: Cheque[] // أوراق القبض والدفع (الشيكات)
  purchases: PurchaseInvoice[]
  purchaseReturns: PurchaseReturn[]
  stocktakes: Stocktake[]
  /** مستندات الإتلاف (هالك وتوالف) — 5111/1103 */
  wastages: WastageDoc[]
  consumptions: ConsumptionDoc[] // مستندات الصرف الداخلي (استهلاك تشغيل) — مصروف/1103
  /** الأرصدة الافتتاحية المثبتة: key = kind:refId → آخر رصيد مرحّل (Minor) — التعديل يرحّل الفرق فقط */
  openingBalances: Record<string, number>
  /** التسويات الشاملة (خزينة/عميل/مورد) — كل فرق مربوط بقيد 5112 */
  settlements: SettlementDoc[]
  /** الاستبدالات (ملابس): مرتجع + بيع مربوطان بمستند EXC واحد */
  exchanges: ExchangeDoc[]
  /** أوامر المطعم المفتوحة (صالة/تيك أواي/دليفري) — لا تلمس الدفاتر حتى القفل بفاتورة */
  restaurantOrders: RestaurantOrder[]
  /** مقايضات الذهب (بيع مشغول + شراء كسر العميل بمستند GTI واحد) */
  goldTradeIns: GoldTradeInDoc[]
  vouchers: Voucher[]
  employeeAdvances: EmployeeAdvance[] // سلف الموظفين (طلب المالك)
  employeeDeductions: EmployeeDeduction[] // جزاءات/خصومات مسجلة تُخصم من المسيرات (كامل/جزء/تأجيل)
  advanceRepayments: AdvanceRepayment[] // سدادات نقدية للسلف خارج المسير
  sales: SaleInvoice[]
  saleReturns: SaleReturn[]
  shifts: Shift[]
  journal: JournalEntry[] // دفتر اليومية — Append-Only (القرار 9)
  /* ─── سجل النشاطات والمستخدمون والبلاغات (طلب المالك) ─── */
  auditLog: AuditEvent[] // «من فعل ماذا ومتى» — يُبنى تلقائياً من كل كتابة، يظهر للمالك فقط
  appUsers: AppUser[] // مستخدمو التطبيق (المالك + الفرعيون) برقم سري ودور
  /** تعديلات الأدوار المحفوظة (البند 4): roleId → قائمة صلاحيات — تعلو على الافتراضي (owner لا يُعدل أبداً) */
  roleOverrides: Record<string, string[]>
  setRolePermissions: (roleId: string, permissions: string[]) => void
  /** استثناءات فردية لمستخدم: منح فوق الدور / حجب رغم الدور */
  setUserPermExceptions: (id: number, extraPerms: string[], deniedPerms: string[]) => void
  currentUserId: number | null // المستخدم النشط حالياً (null = المالك الافتراضي)
  issues: IssueReport[] // بلاغات المشاكل الداخلية (مستخدم → مدير/محاسب)
  /* ─── تسجيل الدخول الفعلي (سد ثغرة انتحال الصلاحيات) ─── */
  /** تجزئة الرقم السري للمالك — null = لم يعيّن بعد فلا تُفرض شاشة الدخول */
  ownerPinHash: string | null
  /** true = لا أحد داخل — شاشة الدخول تحجب التطبيق كله (متى كانت المصادقة مطلوبة) */
  loggedOut: boolean
  /** حارس المحاولات الفاشلة (يبقى بعد تحديث الصفحة — لا تحايل) */
  loginGuard: LoginGuard
  /** رقم مؤقت للمالك أُرسل عبر تليجرام (تجزئة + انتهاء) — يُمحى فور استخدامه */
  ownerTempPin: OwnerTempPin | null
  /** طلبات استعادة كلمة سر الموظفين — تظهر إشعاراً للمالك */
  pinResetRequests: PinResetRequest[]
  /** تعيين/تغيير الرقم السري للمالك (يفعّل شاشة الدخول من أول تعيين) */
  setOwnerPin: (pinHash: string) => void
  /** دخول بفحص PIN فعلي: id=null للمالك — يرمي خطأً عربياً عند الرفض؛ usedTempPin=true ⇒ ألزم المالك بتعيين رقم جديد */
  login: (id: number | null, pin: string) => Promise<{ usedTempPin: boolean }>
  /** خروج — يعيد شاشة الدخول */
  logout: () => void
  /** موظف نسي رقمه: يسجل طلباً من شاشة الدخول ← إشعار للمالك */
  requestPinReset: (userId: number) => void
  /** المالك ينفذ/يرفض طلب الاستعادة (مع تعيين pinHash جديد عند التنفيذ) */
  resolvePinReset: (requestId: number, action: 'done' | 'cancelled', newPinHash?: string) => void
  /** حفظ الرقم المؤقت للمالك (تجزئة) بعد إرساله عبر البوت */
  setOwnerTempPin: (t: OwnerTempPin | null) => void
  addAppUser: (u: { nameAr: string; roleId: string; pinHash: string }) => AppUser
  updateAppUser: (id: number, patch: Partial<Pick<AppUser, 'nameAr' | 'roleId' | 'pinHash' | 'active' | 'extraPerms' | 'deniedPerms'>>) => void
  removeAppUser: (id: number) => void
  setCurrentUser: (id: number | null) => void
  /** بلاغ داخلي عن مشكلة في عملية — يظهر للمدير/المحاسب مع إشعار بالجرس */
  reportIssue: (input: { title: string; details: string; refKey: string }) => IssueReport
  setIssueStatus: (id: number, status: IssueStatus, resolution?: string) => void
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
    /** المخزن المستلم للبضاعة (الأمر 8) — null = غير محدد */
    warehouseId?: number | null
    /**
     * ض.ق.م مدخلات قابلة للخصم (T1 — للمسجلين ضريبياً): تُقيَّد 2102 مديناً
     * فتُخصم من ضريبة المخرجات، ولا تدخل تكلفة المخزون. 0/غياب = ضمن التكلفة.
     */
    inputVatMinor?: number
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
    /** المخزن المختار أعلى الفاتورة (الأمر 8) — null = غير محدد */
    warehouseId?: number | null
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
   * مصروف لاحق على فاتورة شراء مرحّلة (Landed Cost Voucher — طلب المالك):
   * وصلت فاتورة الشحن/الجمارك بعد الترحيل؟ سجّلها هنا:
   * 1) توزَّع على أصناف الفاتورة (قيمة/كمية) وترفع تكلفتها بالمتوسط المرجح
   * 2) نصيب الكمية المتبقية بالمخزون → 1103، ونصيب ما بيع بالفعل → 5101
   *    (فاتورة المشروع: كله → 5110 تكاليف المشروع)
   * 3) الدائن حسب من دفع: مورد (2101) أو خزينة/بنك أو عهدة موظف (1108)
   */
  addLatePurchaseExpense: (args: {
    purchaseId: number
    nameAr: string
    amountMinor: number
    method: 'value' | 'qty'
    paidBy: 'supplier' | 'treasury' | 'custody'
    payAccount?: string | null
    custodyFileId?: number | null
    date: string
  }) => PurchaseInvoice
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
  /** إتلاف مخزون موثق بسبب: يخصم الكميات + يستهلك دفعات FEFO + قيد 5111/1103 */
  postWastage: (args: { reason: string; lines: { itemId: number; qty: number }[]; notes: string }) => WastageDoc
  /** صرف داخلي (استهلاك مخزون للتشغيل): يخصم الرصيد + FEFO + قيد مصروف/1103 بالمتوسط المرجح */
  postConsumption: (args: { purpose: string; expenseAccount?: string; lines: { itemId: number; qty: number }[]; notes: string }) => ConsumptionDoc
  /**
   * ضبط رصيد افتتاحي (نمط mobileshop): عميل/مورد/خزينة/سلفة موظف —
   * يرحّل قيد الفرق فقط مقابل رأس المال 3101، فيبقى المركز المالي متزناً.
   */
  setOpeningBalance: (args: { kind: OpeningKind; refId: string | number; amountMinor: number; label: string }) => void
  /**
   * تسوية شاملة (نمط mobileshop): مطابقة رصيد خزينة/عميل/مورد بالواقع —
   * الفرق يضرب 5112 إجبارياً (درس عجز الـ5,000 المتبخر) ويُوثق بمستند SET-####.
   */
  applySettlement: (args: { section: 'treasury' | 'customer' | 'supplier'; refId: string | number; actualMinor: number; reason: string }) => SettlementDoc
  /**
   * استبدال (ملابس): مرتجع عن فاتورة أصلية + بيع جديد فوري بمستند EXC واحد —
   * قيدا العمليتين يبقيان كاملين (4102 و4101 بلا تشويه) وحركة الخزينة الصافية = الفرق فقط.
   * ذري: أي فشل في البيع الجديد يسترجع الحالة قبل المرتجع.
   */
  postExchange: (args: {
    originalSaleId: number
    returnQtyByItem: Map<number, number>
    newLines: CartLine[]
    treasury?: TreasuryAccount
    notes: string
  }) => ExchangeDoc
  /** فتح أمر مطعم (صالة/تيك أواي/دليفري) — لا قيود حتى القفل؛ طاولة الصالة لا تُفتح مرتين */
  openRestaurantOrder: (args: { type: RestaurantOrderType; tableName?: string; deliveryInfo?: string; notes?: string }) => RestaurantOrder
  /** استبدال سطور الأمر المفتوح بالكامل (الشاشة ترسل السلة الحالية) */
  setRestaurantOrderLines: (orderId: number, lines: CartLine[]) => void
  /** إلغاء أمر مفتوح (لم يلمس الدفاتر أصلاً — توثيق حالة فقط) */
  cancelRestaurantOrder: (orderId: number, reason: string) => void
  /**
   * قفل الأمر بفاتورة: رسوم الخدمة/التوصيل تُحقن سطوراً صناعية (itemId=-1)
   * ثم postSale واحد يتولى المخزون/الوصفات/الضريبة/القيد — المحاسبة تبدأ هنا فقط.
   */
  settleRestaurantOrder: (args: {
    orderId: number
    payment: PaymentMethod
    customerId?: number | null
    treasury?: TreasuryAccount
    paidMinor?: number
    serviceChargePercent?: number
    deliveryFeeMinor?: number
    taxPercent: number
    taxInclusive: boolean
  }) => SaleInvoice
  /** سند قبض/صرف/تحويل — يولّد قيده المتوازن فوراً */
  postVoucher: (args: {
    kind: VoucherKind
    treasury: TreasuryAccount
    counterAccountCode: string // في التحويل: الخزينة الوجهة
    amountMinor: number
    description: string
    partyKind?: 'customer' | 'supplier' | null
    partyId?: number | null
    /** مصروف التحويل بين الخزائن (رسوم بنكية) — يخرج من المصدر ويقيد 5108 (طلب المالك) */
    feeMinor?: number
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
  /** تسوية عجز/زيادة وردية مقفلة (طلب المالك): مصروف/إيراد أو سلفة على الموظف تُخصم من رواتبه */
  settleShiftVariance: (args: { shiftId: number; mode: 'expense' | 'advance'; employeeId?: number | null }) => Shift
  /**
   * تعديل فاتورة بيع (طلب المالك) — يعمل فقط عندما تكون الفاتورة الإلكترونية غير مفعلة:
   * ① يُعكس القيد القديم (سجل تدقيق كامل) ② يعاد المخزون القديم ③ يُخصم الجديد
   * ④ يتولد قيد جديد متوازن — رقم الفاتورة والمرجع يبقيان كما هما.
   * ملاحظة: الحارس saleEditBlocks يمنع تعديل فواتير عليها مستندات لاحقة.
   */
  editSale: (args: {
    saleId: number
    lines: CartLine[]
    customerId: number | null
    payment: PaymentMethod
    paidMinor: number
    treasury: TreasuryAccount
    invoiceDiscountPercent: number
    reason: string
    /** الفاتورة الإلكترونية مفعلة بمفتاح الترخيص؟ — تُمرر من الواجهة وتُرفض العملية لو true */
    einvoiceActive: boolean
    allowNegativeStock?: boolean
  }) => SaleInvoice
  /** تعديل فاتورة شراء — نفس منهج editSale (عكس + إعادة ترحيل). يُرفض لو الفاتورة الإلكترونية مفعلة */
  editPurchase: (args: {
    purchaseId: number
    lines: { itemId: number; qty: number; unitPriceMinor: number }[]
    expenses: PurchaseExpense[]
    paidMinor: number
    treasury: TreasuryAccount
    reason: string
    einvoiceActive: boolean
  }) => PurchaseInvoice
  addWarehouse: (nameAr: string) => void
  /** إضافة خزينة/بنك جديد — يفتح له حساب دفتري تلقائياً (1121+) + بيانات احترافية اختيارية */
  addTreasury: (nameAr: string, kind: 'cash' | 'bank', extra?: Partial<Omit<TreasuryDef, 'code' | 'nameAr' | 'kind' | 'isDefault'>>) => TreasuryDef
  renameTreasury: (code: string, nameAr: string, extra?: Partial<Omit<TreasuryDef, 'code' | 'nameAr' | 'kind' | 'isDefault'>>) => void
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
  /** تسجيل جزاء/خصم على موظف — يُخصم من المسيرات لاحقاً (كامل/جزء/تأجيل بحرية المالك) */
  addEmployeeDeduction: (args: { employeeId: number; amountMinor: number; reason: string; notes?: string }) => EmployeeDeduction
  /** متبقي الجزاءات غير المخصومة لموظف — يغذي زر «خصم الكل» في المسير */
  getEmployeeDeductionBalance: (employeeId: number) => { totalMinor: number; remainingMinor: number; deductions: EmployeeDeduction[] }
  /** سداد نقدي لسلفة خارج المسير: قيد خزينة ← 1107 ويخفض متبقي السلفة */
  repayEmployeeAdvance: (args: { employeeId: number; amountMinor: number; treasury: TreasuryAccount }) => AdvanceRepayment
  /** إقفال سنة مالية (منهجية QuickBooks/Xero): قيد يصفّر 4xxx/5xxx → أرباح مرحلة 3102 ثم يقفل الفترة */
  closeFiscalYear: (fy: FiscalYear, allYears: readonly FiscalYear[]) => { entryId: number; netProfitMinor: number }
  /** رصيد العميل الموحّد من كل الأنشطة — مصدر حقيقة واحد لكل الشاشات */
  getCustomerBalance: (customerId: number) => number
  /** رصيد المورد الموحّد (افتتاحي + مشتريات − مرتجعات − سندات − شيكات + تسويات) — نفس مصدر كل الشاشات */
  getSupplierBalance: (supplierId: number) => number
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
    /** هامش تمويل مُضمَّن في الإجمالي (الأمر 22) — يُثبت إيراداً 4111 بقيد 1104/4111 */
    interestMinor?: number
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
    /** التحصيل الجزئي: المحصَّل نقداً الآن (0..grand) — غيابه = حسب payment */
    paidMinor?: number
    /** ملف عهدة مفتوح تُخصم منه مصاريف source='custody' */
    custodyFileId?: number | null
    /** عمولة السائق عن الرحلة — تُستحق (2111) ولا تُدفع الآن؛ تسوى مجمعة */
    driverCommissionMinor?: number
  }) => Trip
  /** إجمالي غير المسوى لسائق */
  getDriverDueBalance: (driverId: number) => number
  /** تسوية كل مستحقات سائق دفعة واحدة من خزينة/بنك */
  settleDriverDues: (driverId: number, treasury?: string) => { total: number; count: number }

  // ————— جهات التأمين والتعاقد (صيدلية/معمل) —————
  addInsuranceProvider: (args: { nameAr: string; coveragePercent: number; phone?: string; notes?: string }) => InsuranceProvider
  updateInsuranceProvider: (id: number, args: { nameAr: string; coveragePercent: number; phone?: string; notes?: string }) => void
  toggleInsuranceProvider: (id: number) => void
  /** بيع كاشير بتغطية: نصيب المريض نقداً + نصيب الجهة مطالبة 1110 (مع التكلفة) */
  postInsuredSale: (args: { lines: CartLine[]; providerId: number; taxPercent: number; taxInclusive: boolean; treasury?: string }) => { patientShareMinor: number; providerShareMinor: number }
  /** طلب معمل بتغطية: نفس المنطق على إيراد 4106 بلا تكلفة بضاعة */
  registerInsuredLabOrder: (args: { patientId: number; referrerId: number | null; testIds: number[]; providerId: number; vatPercent: number; notes?: string; treasury?: string }) => LabOrder
  /** رصيد مطالبات جهة غير محصلة */
  getClaimBalance: (providerId: number) => number
  /** تحصيل كل مطالبات جهة دفعة واحدة */
  settleInsuranceClaims: (providerId: number, treasury?: string) => { total: number; count: number }

  // ————— مصفوفة المتغيرات لون×مقاس (ملابس) —————
  /** تعيين رصيد تركيبة — التحقق: من ألوان/مقاسات الصنف، والمجموع ≤ رصيد الصنف */
  setVariantStock: (itemId: number, color: string, size: string, qty: number) => void
  /** الكمية غير الموزعة على تركيبات لصنف */
  getUndistributedQty: (itemId: number) => number
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
  /** مصروف تشغيل معدة بقيده (5105/خزينة) — وقود/صيانة/إصلاح/مشغل */
  addEquipmentCost: (args: { equipmentId: number; kind: EquipmentCostKind; amountMinor: number; description?: string; treasury?: string }) => EquipmentCost
  /** ربحية معدة: إيراد عقودها − تكاليفها، وربح الساعة من الساعات الموثقة */
  getEquipmentProfit: (equipmentId: number) => { revenueMinor: number; costsMinor: number; profitMinor: number; hours: number; profitPerHourMinor: number | null }
  /* ─── معامل التحاليل (القرار 26) ─── */
  addLabTest: (t: Omit<LabTest, 'id' | 'isActive'>) => LabTest
  updateLabTest: (id: number, patch: Partial<Omit<LabTest, 'id'>>) => void
  /** تحميل كتالوج البدء (10 فحوصات شائعة) بأسعار افتراضية — مرة واحدة */
  seedStarterTests: (defaultPriceMinor: number) => number
  addLabReferrer: (r: Omit<Referrer, 'id'>) => Referrer
  addLabPatient: (p: Omit<LabPatient, 'id'>) => LabPatient
  /** تعديل مريض معمل — منه ربطه بعميل مالي (linkedCustomerId) فتظهر طلباته الآجلة بكشف العميل */
  updateLabPatient: (id: number, patch: Partial<Omit<LabPatient, 'id'>>) => void
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
  addProject: (p: Omit<Project, 'id' | 'code' | 'status' | 'clientId'> & { clientId?: number | null }) => Project
  /** عرض سعر/مناقصة — مستند غير محاسبي، الفائز يتحول مشروعاً بضغطة */
  addQuotation: (q: { kind: 'quotation' | 'tender'; clientName: string; clientId?: number | null; titleAr: string; validUntil: string; lines: (Omit<QuotationLine, 'nameAr' | 'estCostMinor'> & { nameAr?: string; estCostMinor?: number })[]; notes: string }) => Quotation
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
  addProjectExtract: (args: { projectId: number; grossMinor: number; vatPercent: number; payment: 'cash' | 'credit'; description: string; treasury?: string; advanceRecoveryMinor?: number }) => ProjectExtract
  /** تكلفة على المشروع ببند: 5110 ← 1101|2101 */
  addProjectCost: (args: { projectId: number; kind: CostKind; amountMinor: number; payment: 'cash' | 'credit'; description: string; treasury?: string; custodyFileId?: number | null }) => ProjectCost
  /** الإفراج عن كل المحتجزات المتبقية عند التسليم: 1101 ← 1105 + إقفال المشروع */
  releaseRetention: (projectId: number, treasury?: string) => { amount: number }
  /** ربحية مشروع محسوبة من مستخلصاته وتكاليفه */
  getProjectProfit: (projectId: number) => ProjectProfit
  /* ─── عمق المقاولات: BOQ، أوامر تغيير، دفعات مقدمة، باطن، ضمانات، يوميات، WIP ─── */
  addBoqItem: (args: Omit<BoqItem, 'id' | 'progressPercent' | 'estCostMinor'> & { estCostMinor?: number }) => BoqItem
  updateBoqProgress: (id: number, progressPercent: number) => void
  removeBoqItem: (id: number) => void
  addChangeOrder: (args: { projectId: number; titleAr: string; amountMinor: number }) => ChangeOrder
  setChangeOrderStatus: (id: number, status: 'approved' | 'rejected') => void
  /** دفعة مقدمة من عميل المشروع: نقدية ← 2109 (التزام حتى تنفيذ الأعمال) */
  receiveClientAdvance: (args: { projectId: number; amountMinor: number; treasury: string }) => void
  /** رصيد الدفعات المقدمة غير المستردة لمشروع */
  getAdvanceBalance: (projectId: number) => number
  addSubContract: (args: Omit<SubContract, 'id' | 'contractNumber' | 'status' | 'supplierId' | 'taxWithholdPercent' | 'boqItemIds'> & { supplierId?: number | null; taxWithholdPercent?: number; boqItemIds?: number[] }) => SubContract
  /** شهادة أعمال باطن: 5110 ← 2101 صافي + 2108 محتجز */
  addSubCertificate: (args: { contractId: number; amountMinor: number; description: string; advanceRecoveryMinor?: number }) => SubCertificate
  /** دفعة لمقاول الباطن من مستحقاته */
  paySubContractor: (args: { contractId: number; amountMinor: number; treasury: string }) => void
  /** إفراج محتجزات الباطن وإقفال عقده */
  releaseSubRetention: (contractId: number, treasury: string) => { amount: number }
  /** خطاب ضمان: هامش 1109 + مصاريف ← البنك */
  issueBond: (args: { projectId: number | null; bondNumber: string; type: BondType; beneficiary: string; amountMinor: number; marginMinor: number; feesMinor: number; bank: string; issueDate: string; expiryDate: string }) => Bond
  /** رد الخطاب (release) أو مصادرته (forfeit) */
  settleBond: (bondId: number, outcome: 'released' | 'forfeited') => Bond
  addDailyWorker: (args: { nameAr: string; phone: string; dailyWageMinor: number }) => DailyWorker
  addDailyWorkRecord: (args: { workerId: number; projectId: number | null; date: string; days: number; wageMinor?: number }) => DailyWorkRecord
  /** تسوية كل يوميات عامل غير المسددة: مشاريع→5110 وتشغيل عام→5108 ← خزينة */
  settleDailyWorker: (workerId: number, treasury: string) => { total: number; recordCount: number }
  /* ─── أوامر التعديل: أذون صرف مواد + تحصيلات FIFO + دفعات باطن + EVM + موافقات ─── */
  /** إذن صرف مواد لمشروع: خصم مخزون بالمتوسط المرجح → 5110/1103 بصارف ومستلم إلزاميين */
  issueMaterials: (args: { projectId: number; issuedByEmployeeId: number; receivedByEmployeeId: number; lines: IssueLineInput[]; notes: string }) => MaterialRequisition
  /** الفواتير المفتوحة لعميل (بيع آجل + مستخلصات مشاريعه الآجلة) بعد التحصيلات والمرتجعات */
  getOpenClientInvoices: (customerId: number) => OpenInvoice[]
  /** تحصيل من عميل على مستوى الحساب: FIFO افتراضياً أو مطابقة فاتورة محددة اختيارياً */
  receiveClientPayment: (args: { customerId: number; amountMinor: number; treasury: string; specificDocKey?: string | null; notes?: string }) => { settlementNumber: string; allocations: FifoAllocation[]; unallocatedMinor: number }
  /** دفعة مقدمة لمقاول باطن: 1111 ← خزينة (تُسترد من شهاداته) */
  addSubAdvance: (args: { contractId: number; amountMinor: number; treasury: string }) => SubAdvance
  /** رصيد الدفعات المقدمة غير المستردة لعقد باطن */
  getSubAdvanceBalance: (contractId: number) => number
  /** توريد ضريبة الاستقطاع المحتجزة للمصلحة: 2112 ← خزينة */
  remitWithholdingTax: (treasury: string) => { amount: number }
  /** لوحة القيمة المكتسبة EVM لمشروع من بنود BOQ وتكاليفه الفعلية */
  getProjectEvm: (projectId: number) => EvmProjectResult
  /** تعريف/تحديث مسار موافقات لإجراء حرج (تسلسل أدوار حتى 6 مستويات) */
  setApprovalFlow: (action: ApprovalAction, steps: { roleAr: string; employeeId: number | null }[], active: boolean) => ApprovalFlow
  /** طلب اعتماد لإجراء خاضع لمسار موافقات */
  requestApproval: (action: ApprovalAction, subject: string, refId: number) => ApprovalRequest
  /** قرار على المستوى الحالي: موافقة تنقل للمستوى التالي، ورفضٌ يقفل الطلب */
  decideApproval: (requestId: number, decision: 'approved' | 'rejected', decidedBy: string, note?: string) => ApprovalRequest
  /** حارس داخلي: إجراء له مسار نشط ⇒ لا بد من طلب معتمد غير مستهلك (يُستهلك عند التنفيذ) */
  assertApproved: (action: ApprovalAction, refId: number, subject: string) => void

  // ————— الوصفات والتصنيع (مطاعم) —————
  addRecipe: (input: RecipeInput) => Recipe
  updateRecipe: (id: number, input: RecipeInput) => void
  toggleRecipe: (id: number) => void
  removeRecipe: (id: number) => void
  /** تكلفة وحدة الناتج بالمتوسط المرجح الحالي للخامات */
  getRecipeUnitCost: (recipeId: number) => number
  /** أمر إنتاج مسبق: يستهلك الخامات ويُدخل الناتج للمخزون بمتوسط مرجح جديد */
  postProduction: (args: { recipeId: number; batches: number; treasury?: string; notes?: string }) => ProductionOrder

  // ————— الذهب والمجوهرات (صاغة) —————
  /** تحديث أسعار الجرام اليومية — لا يعيد التسعير تلقائياً */
  setGramPrices: (prices: { k18: number; k21: number; k24: number }) => void
  /** إعادة تسعير كل الأصناف الموصوفة: السعر = الوزن×جرام العيار + المصنعية. ترجع عدد المحدَّث */
  repriceJewelry: () => number
  /** ربط/تعديل الوصف الذهبي لصنف (عيار/وزن/مصنعية) — ويسعّره فوراً لو الأسعار محدثة */
  setJewelryProfile: (profile: JewelryProfile) => void
  removeJewelryProfile: (itemId: number) => void
  /** شراء كسر من عميل: يدخل دفعة FIFO ويقيد 1103/خزينة */
  buyScrap: (args: { karat: Karat; weightGrams: number; pricePerGramMinor: number; sellerName?: string; treasury?: string }) => ScrapLot
  /** بيع كسر للتاجر/المصنع: يستهلك FIFO ويظهر الربح/الخسارة في القيد */
  sellScrap: (args: { karat: Karat; weightGrams: number; pricePerGramMinor: number; buyerName?: string; treasury?: string }) => ScrapSale
  /**
   * مقايضة ذهب (جولة الصاغة): بيع مشغول جديد يُدفع جزء من ثمنه بكسر العميل —
   * فاتورة بيع كاملة + لوط كسر FIFO بمستند GTI واحد؛ ذرية بلقطة استرجاع.
   */
  postGoldTradeIn: (args: {
    lines: CartLine[]
    customerId?: number | null
    scrapKarat: Karat
    scrapWeightGrams: number
    scrapPricePerGramMinor: number
    treasury?: TreasuryAccount
    taxPercent: number
    taxInclusive: boolean
    notes?: string
  }) => GoldTradeInDoc

  // ————— قوائم الأسعار —————
  addPriceList: (nameAr: string, defaultDiscountPercent: number) => PriceList
  updatePriceList: (id: number, nameAr: string, defaultDiscountPercent: number) => void
  togglePriceList: (id: number) => void
  removePriceList: (id: number) => void
  /** سعر خاص لصنف في قائمة — priceMinor = null يحذف السعر الخاص */
  setPriceListEntry: (listId: number, itemId: number, priceMinor: number | null) => void
  /** السعر الفعلي لصنف حسب قائمة عميل (null = تجزئة) */
  getEffectivePrice: (itemId: number, listId: number | null) => number
  /** ربط عميل بقائمة أسعار */
  setCustomerPriceList: (customerId: number, listId: number | null) => void
  /** تقرير WIP لمشروع: نسبة الإنجاز والفوترة الزائدة/الناقصة */
  getProjectWip: (projectId: number) => WipResult & { contractMinor: number; billedMinor: number; costsMinor: number }
  /* ─── العيادة (القرار 27) ─── */
  addClinicPatient: (p: Omit<ClinicPatient, 'id'>) => ClinicPatient
  /** تحديث بيانات مريض (تاريخ مرضي منظم/ربط عميل/هاتف) */
  updateClinicPatient: (id: number, patch: Partial<Omit<ClinicPatient, 'id'>>) => void
  /** إرفاق مستند طبي (صورة/PDF) لملف المريض */
  addPatientAttachment: (a: Omit<PatientAttachment, 'id' | 'addedAt'>) => PatientAttachment
  removePatientAttachment: (id: number) => void
  /** زيارة بملاحظات الكشف وقيمتها — سداد جزئي مدعوم، والمتبقي دين على المريض */
  addClinicVisit: (args: {
    patientId: number; kind: VisitKind; complaint: string; diagnosis: string; treatment: string
    feeMinor: number; paidMinor: number; vatPercent: number; planId: number | null; treasury?: string
    rxLines?: RxLine[]; vitals?: Vitals; nextVisit?: string
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
  // ————— سيارات الأمانة (بيع بالعمولة) —————
  /** استلام سيارة أمانة: لا قيد — تسجيل فقط */
  addConsignmentCar: (args: { make: string; model: string; year: number; plateOrVin: string; ownerName: string; ownerPhone?: string; ownerNetMinor: number; askingPriceMinor: number; notes?: string }) => ConsignmentCar
  /** بيع الأمانة: خزينة|عملاء / 2110 صافي المالك + 4109 عمولة (+2102 على العمولة) */
  sellConsignmentCar: (args: { id: number; salePriceMinor: number; vatPercentOnCommission?: number; payment: 'cash' | 'credit'; buyerName?: string; treasury?: string }) => ConsignmentCar
  /** سداد صافي المالك: 2110 / خزينة — يقفل الملف */
  payConsignmentOwner: (id: number, treasury?: string) => void
  /** رد سيارة الأمانة لمالكها دون بيع */
  returnConsignmentCar: (id: number) => void
  /** فتح تذكرة صيانة — لا قيد عند الاستلام (لا التزام مالي بعد) */
  openTicket: (args: {
    customerId: number | null
    customerName: string
    customerPhone: string
    deviceName: string
    issue: string
    estimateMinor: number
    promisedAt?: string
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
  /** كتالوج خدمات الصيانة (الأمر 23): إضافة/تعديل/تعطيل — التكلفة سرية لا تُطبع للعميل */
  addMaintenanceService: (input: { nameAr: string; costMinor: number; priceMinor: number }) => MaintenanceService
  updateMaintenanceService: (id: number, patch: Partial<Omit<MaintenanceService, 'id'>>) => void
  /** خدمة محافظ/دفع إلكتروني (نمط mobileshop): الربح = المحصَّل − المدفوع للمزوّد، قيد متوازن فوري */
  postWalletService: (input: WalletServiceInput & { date?: string }) => WalletServiceOp
  /** مرتجع خدمة محافظ: قيد عاكس كامل + وسم العملية returned */
  returnWalletService: (opId: number, reason: string) => WalletServiceOp
  /** ترحيل تحويل مخزني: تحقق ضد رصيد المخزن المصدر — بلا قيد (حركة داخلية) */
  postTransfer: (args: { fromWarehouseId: number; toWarehouseId: number; lines: TransferLine[]; notes: string }) => StockTransfer
  /** اقتناء أصل ثابت: قيد 1201 / 1101 + 2101 وترقيم FA-#### */
  addAsset: (args: AssetInput & {
    notes: string; treasury?: string
    /** مصدر التمويل: نقدي/آجل مورد/رأس مال/جاري شريك (طلب المالك) */
    funding?: AssetFunding
    /** المورد — إلزامي لو بقي دين آجل */
    supplierId?: number | null
    /** تقسيط الجزء الآجل: عدد + فاصل شهري + أول استحقاق */
    installmentCount?: number
    installmentIntervalMonths?: number
    firstInstallmentDate?: string
  }) => FixedAsset
  /** سداد دفعة/قسط من أصل آجل: قيد 2101 ← خزينة + تحديث الجدول (الأقدم أولاً) */
  payAssetInstallment: (args: { assetId: number; amountMinor: number; treasury: TreasuryAccount }) => FixedAsset
  /** متبقي الدين على أصل (لسند الصرف وشاشة الملف) */
  getAssetDue: (assetId: number) => { totalDueMinor: number; paidMinor: number; remainingMinor: number; nextInstallment: AssetInstallment | null }
  /** استحقاق عمولة خارجية للمنشأة لدى الغير: 1112 / 4112 */
  /** تسجيل شخص/جهة عمولات — إلزامي قبل تسجيل أي عمولة (طلب المالك) */
  addCommissionParty: (args: { nameAr: string; phone: string; kind: string; notes: string }) => CommissionParty
  updateCommissionParty: (id: number, patch: Partial<Omit<CommissionParty, 'id' | 'code' | 'createdAt'>>) => void
  /** حذف طرف عمولات — يُرفض لو عليه عمولات مسجلة */
  deleteCommissionParty: (id: number) => void
  /** استحقاق عمولة: لي (1112/4112) أو عليّ (5113/2114) — الطرف من السجل حصراً */
  addExternalCommission: (args: { direction: CommissionDirection; partyId: number; amountMinor: number; description: string }) => ExternalCommission
  /** تحصيل من عمولة خارجية: خزينة / 1112 */
  /** تسوية عمولة: تحصيل (لي) أو دفع (عليّ) من الخزينة/البنك المختار */
  collectExternalCommission: (args: { commissionId: number; amountMinor: number; treasury: TreasuryAccount }) => ExternalCommission
  /** إضافة حساب مخصص لشجرة الحسابات — يُستخدم فوراً في القيود والتقارير (الشجرة ليست مفروضة) */
  addCustomAccount: (args: { code: string; nameAr: string; parentCode: string }) => CustomAccount
  /** حذف حساب مخصص — يُرفض لو عليه حركة في اليومية */
  deleteCustomAccount: (code: string) => void
  /* ─── المغاسل (وحدة مستقلة — طلب المالك) ─── */
  /** فتح أمر غسيل: قطع + خدمات + عربون اختياري (قيده: خزينة/2109 دفعات مقدمة) */
  openLaundryOrder: (args: { customerId: number | null; customerName: string; phone: string; promisedAt: string; lines: LaundryLine[]; prepaidMinor: number; treasury?: TreasuryAccount; notes: string }) => LaundryOrder
  /** نقل حالة أمر الغسيل (بلا قيد — القيود عند التسليم/الإلغاء فقط) */
  setLaundryStatus: (orderId: number, status: LaundryStatus) => LaundryOrder
  /** تسليم الأمر: تحقق الإيراد — خزينة (المتبقي) + 2109 (العربون) ← 4103 + 2102 */
  deliverLaundryOrder: (args: { orderId: number; treasury?: TreasuryAccount }) => LaundryOrder
  /** إلغاء الأمر: لو عليه عربون يُرد بقيد 2109 ← خزينة */
  cancelLaundryOrder: (orderId: number) => LaundryOrder
  /** ترحيل إهلاك شهر واحد لكل الأصول المستحقة — قيد مجمع واحد 5107/1202 */
  postMonthlyDepreciation: () => { entry: JournalEntry; totalMinor: number; assetCount: number }
  /** إهلاك تلقائي (طلب المالك): يرحّل كل الأشهر المتأخرة دفعة واحدة بلا تدخل — يُستدعى عند فتح البرنامج. يعيد عدد القيود المرحّلة */
  runAutoDepreciation: () => number
  /* ─── الشيكات (أوراق القبض والدفع) ─── */
  /** استلام شيك وارد من عميل: قيد 1106 ← 1104 */
  /** استلام شيك وارد: من عميل مسجل (partyId) أو بلا طرف (partyName + counterAccount — افتراضي 4110 إيرادات أخرى) */
  receiveCheque: (args: { chequeNumber: string; partyId: number | null; partyName?: string; counterAccount?: string; bankName: string; amountMinor: number; dueDate: string; notes: string }) => Cheque
  /** تحرير شيك صادر لمورد: قيد 2101 ← 2106 */
  /** تحرير شيك صادر: لمورد مسجل (partyId) أو لمستفيد آخر (partyName + counterAccount — مصروف/رواتب/مخصص، افتراضي 5108) */
  issueCheque: (args: { chequeNumber: string; partyId: number | null; partyName?: string; counterAccount?: string; bankName: string; amountMinor: number; dueDate: string; notes: string }) => Cheque
  /** نقل حالة الشيك وفق آلة الحالات — يولّد قيد التحصيل/الارتداد/الصرف/الإلغاء تلقائياً */
  /** نقل حالة الشيك — التحصيل/الصرف يتطلبان حساب إيداع (بنك أو خزينة مسجلة) */
  setChequeStatus: (chequeId: number, status: ChequeStatus, settleAccount?: string) => Cheque
}

const nextId = <T extends { id: number }>(arr: T[]) => arr.reduce((m, x) => Math.max(m, x.id), 0) + 1

/** كل الأكواد المرجعية المستخدمة حالياً — لضمان تفرد الكود الجديد */
function usedRefCodes(state: Pick<DataState, 'sales' | 'purchases' | 'saleReturns' | 'purchaseReturns'>): Set<string> {
  const set = new Set<string>()
  for (const x of state.sales) if (x.refCode) set.add(x.refCode)
  for (const x of state.purchases) if (x.refCode) set.add(x.refCode)
  for (const x of state.saleReturns) if (x.refCode) set.add(x.refCode)
  for (const x of state.purchaseReturns) if (x.refCode) set.add(x.refCode)
  return set
}

/** إصدار persist لقاعدة shopsys-data — مصدر وحيد تستورده صفحات النسخ والتليجرام
 *  (9 = أكواد مرجعية للفواتير، 8 = ملفات العهد المتكاملة + استرداد السلف على شهور، 7 = خزائن متعددة + دفع مجزأ) */
export const DATA_VERSION = 18 // 16: مقايضة ذهب GTI — 17: تمويل الأصول والحسابات المخصصة — 18: تسجيل الدخول الفعلي + الصرف الداخلي

/**
 * الحارس المركزي للرصيد السالب (طلب المالك):
 * أي كتابة تضيف قيوداً لليومية تُفحص قبل التنفيذ — لو نتج عنها رصيد سالب
 * في خزينة/بنك والإعداد يمنع ذلك، تُرفض العملية كلها برسالة واضحة.
 * (فحص المخزون السالب يتم في مواضع الخصم نفسها لأنه لكل عملية سياقها)
 */
function assertTreasuryNotNegative(
  prevJournal: JournalEntry[],
  nextJournal: JournalEntry[],
  treasuries: TreasuryDef[],
): void {
  if (nextJournal === prevJournal || nextJournal.length <= prevJournal.length) return
  // الإعداد من مخزن التطبيق — قراءة مباشرة لتفادي دورة استيراد
  let allow = false
  try {
    const raw = localStorage.getItem('shopsys-app')
    if (raw) allow = JSON.parse(raw)?.state?.setup?.allowNegativeTreasury === true
  } catch { /* الافتراضي: ممنوع */ }
  if (allow) return
  const codes = new Set(treasuries.map((t) => t.code))
  const balances = new Map<string, number>()
  for (const e of nextJournal) {
    for (const l of e.lines) {
      if (!codes.has(l.accountCode)) continue
      balances.set(l.accountCode, (balances.get(l.accountCode) ?? 0) + l.debit - l.credit)
    }
  }
  for (const [code, bal] of balances) {
    if (bal < 0) {
      const name = treasuries.find((t) => t.code === code)?.nameAr ?? code
      throw new Error(`رصيد «${name}» سيصبح سالباً — العملية مرفوضة. فعّل السماح بالرصيد السالب من الإعدادات العامة لو كنت تقصد ذلك`)
    }
  }
}

export const useDataStore = create<DataState>()(
  persist(
    (rawSet, get) => {
      // كل كتابة تمر عبر الحارس أولاً — تُرفض بأكملها لو خالفت شرط الرصيد السالب
      const set = ((partial: unknown, replace?: boolean) => {
        const state = get()
        const patch = typeof partial === 'function' ? (partial as (s: DataState) => Partial<DataState>)(state) : partial as Partial<DataState>
        if (patch && (patch as Partial<DataState>).journal) {
          assertTreasuryNotNegative(state.journal, (patch as Partial<DataState>).journal!, (patch as Partial<DataState>).treasuries ?? state.treasuries)
        }
        // سجل النشاطات (طلب المالك): كل كتابة تولد أحداث تدقيق تلقائياً —
        // «من فعل ماذا ومتى» بلا اعتماد على تسجيل يدوي في كل إجراء
        let finalPatch = patch as Partial<DataState>
        if (patch && !(patch as Partial<DataState>).auditLog) {
          const activeUser = state.appUsers.find((u) => u.id === state.currentUserId)
          const events = auditFromPatch(
            state as unknown as Record<string, unknown>,
            patch as Record<string, unknown>,
            activeUser?.nameAr ?? 'المالك',
            new Date().toISOString(),
          )
          if (events.length) finalPatch = { ...(patch as Partial<DataState>), auditLog: appendAudit(state.auditLog ?? [], events) }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(rawSet as any)(finalPatch, replace)
      }) as typeof rawSet
      return {
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
      boqItems: [],
      changeOrders: [],
      clientAdvances: [],
      subContracts: [],
      subCertificates: [],
      subPayments: [],
      bonds: [],
      dailyWorkers: [],
      dailyWorkRecords: [],
      materialRequisitions: [],
      stockMoves: [],
      clientSettlements: [],
      subAdvances: [],
      approvalFlows: [],
      approvalRequests: [],
      recipes: [],
      productionOrders: [],
      gramPrices: EMPTY_GRAM_PRICES,
      jewelryProfiles: [],
      scrapLots: [],
      scrapSales: [],
      equipmentCosts: [],
      priceLists: [],
      priceListEntries: [],
      custodyFiles: [],
      custodyTxs: [],
      clinicPatients: [],
      patientAttachments: [],
      clinicVisits: [],
      treatmentPlans: [],
      clinicCollections: [],
      clinicAppointments: [],
      cars: [],
      consignmentCars: [],
      driverDues: [],
      insuranceProviders: [],
      insuranceClaims: [],
      variantStocks: [],
      tickets: [],
      maintenanceServices: [],
      walletOps: [],
      transfers: [],
      batches: [],
      assets: [],
      externalCommissions: [],
      commissionParties: [],
      customAccounts: [],
      laundryOrders: [],
      serials: [],
      cheques: [],
      purchases: [],
      purchaseReturns: [],
      stocktakes: [],
      wastages: [],
      consumptions: [],
      openingBalances: {},
      settlements: [],
      exchanges: [],
      restaurantOrders: [],
      goldTradeIns: [],
      vouchers: [],
      employeeAdvances: [],
      employeeDeductions: [],
      advanceRepayments: [],
      sales: [],
      saleReturns: [],
      shifts: [],
      journal: [],
      auditLog: [],
      appUsers: [],
      roleOverrides: {},
      currentUserId: null,
      issues: [],
      ownerPinHash: null,
      loggedOut: false,
      loginGuard: EMPTY_GUARD,
      ownerTempPin: null,
      pinResetRequests: [],

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
        // تحقق صارم قبل أي كتابة: سطور موجودة وكميات وأسعار سليمة (حماية من إفساد المخزون)
        if (!inv.lines.length) throw new Error('الفاتورة بلا أصناف')
        for (const l of inv.lines) {
          if (!Number.isFinite(l.qty) || l.qty <= 0) throw new Error('كل كمية يجب أن تكون رقماً موجباً')
          if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) throw new Error('سعر شراء غير صالح')
        }
        if (!Number.isInteger(inv.paidMinor) || inv.paidMinor < 0) throw new Error('المدفوع لا يكون سالباً')
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

        // مصادر دفع المصاريف (طلب المالك): كل مصروف يحدد من دفعه —
        // على حساب المورد (الافتراضي) أو من خزينة/بنك أو من عهدة موظف.
        // ما دفعتُه بنفسي لا يدخل دين المورد أبداً.
        const expensePayments: ExpensePaymentCredit[] = []
        const expenseCustodyNeeds = new Map<number, number>() // fileId → إجمالي المطلوب من عهدته
        for (const e of inv.expenses) {
          const paidBy = e.paidBy ?? 'supplier'
          if (e.amountMinor <= 0) continue
          if (paidBy === 'treasury') {
            const acc = e.payAccount || '1101'
            if (!state.treasuries.some((t) => t.code === acc)) throw new Error(`خزينة مصروف «${e.nameAr}» غير موجودة`)
            expensePayments.push({ account: acc, amountMinor: e.amountMinor, note: `${e.nameAr} — مدفوع من ${state.treasuries.find((t) => t.code === acc)?.nameAr ?? acc}` })
          } else if (paidBy === 'custody') {
            if (e.custodyFileId == null) throw new Error(`حدد ملف العهدة الذي دفع مصروف «${e.nameAr}»`)
            expenseCustodyNeeds.set(e.custodyFileId, (expenseCustodyNeeds.get(e.custodyFileId) ?? 0) + e.amountMinor)
            expensePayments.push({ account: CUSTODY_ACCOUNT, amountMinor: e.amountMinor, note: `${e.nameAr} — مدفوع من عهدة موظف` })
          }
        }
        const expensesPaidDirect = expensePayments.reduce((a, e) => a + e.amountMinor, 0)
        // T1: ضريبة مدخلات قابلة للخصم — تُفحص مبكراً وتدخل مستحق المورد (يقبضها ليوردها للدولة)
        const inputVatMinor = inv.inputVatMinor ?? 0
        if (!Number.isInteger(inputVatMinor) || inputVatMinor < 0) throw new Error('ضريبة المدخلات لا تكون سالبة')
        // مستحق المورد = البضاعة + ضريبة المدخلات + المصاريف المحملة على حسابه فقط
        const supplierDue = grandTotal + inputVatMinor - expensesPaidDirect

        // مصدر دفع البضاعة: خزينة/بنك أو ملف عهدة موظف (طلب المالك) — العهدة تُفحص قبل أي كتابة
        let custodyFile: CustodyFile | null = null
        if (inv.custodyFileId != null && inv.paidMinor > 0) {
          custodyFile = state.custodyFiles.find((f) => f.id === inv.custodyFileId) ?? null
          if (!custodyFile) throw new Error('ملف العهدة غير موجود')
          assertFileOpen(custodyFile)
        }
        // فحص أرصدة كل ملفات العهد المستخدمة (بضاعة + مصاريف) مجمعةً قبل أي كتابة
        {
          const totalNeeds = new Map<number, number>(expenseCustodyNeeds)
          if (custodyFile) totalNeeds.set(custodyFile.id, (totalNeeds.get(custodyFile.id) ?? 0) + inv.paidMinor)
          for (const [fileId, need] of totalNeeds) {
            const f = state.custodyFiles.find((x) => x.id === fileId)
            if (!f) throw new Error('ملف العهدة غير موجود')
            assertFileOpen(f)
            const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === fileId)).remainingMinor
            if (need > remaining) {
              throw new Error(`المطلوب من عهدة ${f.fileNumber} (${need}) أكبر من متبقيها (${remaining}) — عزّز العهدة أو غيّر مصدر الدفع`)
            }
          }
        }
        const linkedProject = inv.projectId != null ? state.projects.find((p) => p.id === inv.projectId) : undefined
        if (inv.projectId != null && !linkedProject) throw new Error('المشروع غير موجود')
        if (linkedProject?.status === 'completed') throw new Error('المشروع مقفل — لا تكاليف جديدة عليه')
        // القيد المحاسبي (يرمي لو المدفوع > مستحق المورد):
        // - فاتورة عادية: مخزون 1103 مدين / (خزينة أو 1108 عهد) + مصاريف مدفوعة مباشرة + موردون دائن
        // - فاتورة مشروع مقاولات: 5110 تكاليف مشروعات مدين بدل المخزون —
        //   البضاعة تذهب للموقع مباشرة فلا ترفع مخزون المتجر ولا تغيّر متوسط التكلفة
        //   (يمنع ازدواج التكلفة: مخزون + بند تكلفة مشروع معاً)
        const payAccount = custodyFile ? CUSTODY_ACCOUNT : (inv.treasury ?? '1101')
        const entryLines = buildPurchaseEntryV2({
          inventoryAccount: linkedProject ? '5110' : '1103',
          inventoryNote: linkedProject ? `مشتريات لمشروع ${linkedProject.nameAr}` : 'بضاعة واردة بتكلفتها الكاملة',
          grandTotalMinor: grandTotal,
          paidMinor: inv.paidMinor,
          payAccount,
          expensePayments,
          inputVatMinor,
        })
        const purchaseId = nextId(state.purchases)
        const entryId = nextId(state.journal)
        const invoiceNumber = `P-${String(purchaseId).padStart(4, '0')}`
        const refCode = makeUniqueRefCode('PUR', inv.date, usedRefCodes(state))
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
          refCode,
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
          supplierDueMinor: supplierDue,
          paidMinor: inv.paidMinor,
          treasury: custodyFile ? undefined : (inv.treasury ?? '1101'),
          custodyFileId: custodyFile?.id ?? null,
          projectId: inv.projectId ?? null,
          warehouseId: inv.warehouseId ?? null,
          inputVatMinor,
          notes: inv.notes,
          journalEntryId: entryId,
        }

        // تحديث تكلفة الأصناف بالمتوسط المرجح + زيادة المخزون
        // (فاتورة المشروع لا تمس المخزون: بضاعتها تكلفة موقع مباشرة 5110)
        const updatedItems = linkedProject ? state.items : state.items.map((it) => {
          const line = landed.find((l) => l.itemId === it.id)
          if (!line) return it
          const newCost = weightedAverage(it.stockQty ?? 0, it.costMinor, line.qty, line.landedTotalMinor)
          return { ...it, costMinor: newCost, stockQty: (it.stockQty ?? 0) + line.qty }
        })

        // فتح دفعات صلاحية للأصناف المتتبَّعة (FEFO — القرار 5)
        // (لا دفعات ولا سيريالات لفاتورة المشروع — بضاعتها ليست مخزوناً)
        let batchId = nextId(state.batches)
        const newBatches: StockBatch[] = []
        for (const l of linkedProject ? [] : inv.lines) {
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
          if (linkedProject) return
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
        // مصاريف مدفوعة من عهد موظفين → حركة لكل مصروف في ملف عهدته (طلب المالك)
        for (const e of inv.expenses) {
          if ((e.paidBy ?? 'supplier') !== 'custody' || e.custodyFileId == null || e.amountMinor <= 0) continue
          custodyTxs = [...custodyTxs, {
            id: nextId(custodyTxs), fileId: e.custodyFileId, type: 'expense' as const,
            date: inv.date, amountMinor: e.amountMinor, excessMinor: 0,
            description: `${e.nameAr} — فاتورة شراء ${invoiceNumber}`,
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

      addLatePurchaseExpense: (args) => {
        const state = get()
        const purchase = state.purchases.find((p) => p.id === args.purchaseId)
        if (!purchase) throw new Error('فاتورة الشراء غير موجودة')
        if (!args.nameAr.trim()) throw new Error('اكتب بيان المصروف (نولون، جمارك…)')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ المصروف يجب أن يكون موجباً')

        // 1) توزيع المصروف على سطور الفاتورة الأصلية (قيمة أو كمية)
        const costLines: CostLine[] = purchase.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor }))
        const shares = allocateExpense(costLines, { nameAr: args.nameAr, amountMinor: args.amountMinor, method: args.method })

        // 2) الدائن حسب من دفع (طلب المالك): مورد / خزينة / عهدة — مع فحوصها قبل أي كتابة
        let creditAccount: string
        let creditNote: string
        let custodyFile: CustodyFile | null = null
        if (args.paidBy === 'supplier') {
          creditAccount = '2101'
          creditNote = `${args.nameAr} على حساب المورد — فاتورة ${purchase.invoiceNumber}`
        } else if (args.paidBy === 'treasury') {
          const acc = args.payAccount || '1101'
          if (!state.treasuries.some((t) => t.code === acc)) throw new Error('الخزينة/البنك غير موجود')
          creditAccount = acc
          creditNote = `${args.nameAr} مدفوع من ${state.treasuries.find((t) => t.code === acc)?.nameAr ?? acc}`
        } else {
          if (args.custodyFileId == null) throw new Error('حدد ملف العهدة الذي دفع المصروف')
          custodyFile = state.custodyFiles.find((f) => f.id === args.custodyFileId) ?? null
          if (!custodyFile) throw new Error('ملف العهدة غير موجود')
          assertFileOpen(custodyFile)
          const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === custodyFile!.id)).remainingMinor
          if (args.amountMinor > remaining) throw new Error(`المبلغ أكبر من متبقي العهدة (${remaining})`)
          creditAccount = CUSTODY_ACCOUNT
          creditNote = `${args.nameAr} مدفوع من عهدة ${custodyFile.fileNumber}`
        }

        // 3) المدين: فاتورة مشروع → 5110 كلها؛ فاتورة عادية → نصيب المتبقي بالمخزون 1103
        //    ونصيب ما بيع بالفعل 5101 (لا يمكن رفع تكلفة بضاعة خرجت من المخزون)
        const debits: { account: string; amountMinor: number; note: string }[] = []
        let itemsAfter = state.items
        if (purchase.projectId != null) {
          debits.push({ account: '5110', amountMinor: args.amountMinor, note: `${args.nameAr} — تكلفة مشروع (فاتورة ${purchase.invoiceNumber})` })
        } else {
          let toInventory = 0
          let toCogs = 0
          const invPortionByItem = new Map<number, number>()
          purchase.lines.forEach((l, i) => {
            const share = shares[i]
            const item = state.items.find((it) => it.id === l.itemId)
            const stockQty = item?.stockQty ?? 0
            // من كمية هذا السطر: ما زال بالمخزون على الأكثر رصيده الحالي
            const stillInStock = Math.max(0, Math.min(stockQty, l.qty))
            const invPortion = l.qty > 0 ? Math.round((share * stillInStock) / l.qty) : 0
            toInventory += invPortion
            toCogs += share - invPortion
            if (invPortion > 0) invPortionByItem.set(l.itemId, (invPortionByItem.get(l.itemId) ?? 0) + invPortion)
          })
          if (toInventory > 0) debits.push({ account: '1103', amountMinor: toInventory, note: `${args.nameAr} — رفع تكلفة المخزون المتبقي` })
          if (toCogs > 0) debits.push({ account: '5101', amountMinor: toCogs, note: `${args.nameAr} — نصيب بضاعة بيعت بالفعل` })
          // رفع متوسط تكلفة الأصناف بقيمة نصيبها (بلا تغيير كمية)
          itemsAfter = state.items.map((it) => {
            const inv = invPortionByItem.get(it.id)
            if (!inv || (it.stockQty ?? 0) <= 0) return it
            const q = it.stockQty ?? 0
            return { ...it, costMinor: Math.round((q * it.costMinor + inv) / q) }
          })
        }

        const entryLines = buildLateExpenseEntry({ debits, creditAccount, creditNote })
        const entryId = nextId(state.journal)
        const nowIso = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: args.date,
          description: `مصروف لاحق «${args.nameAr}» على فاتورة الشراء ${purchase.invoiceNumber}`,
          sourceType: 'purchase',
          sourceId: purchase.id,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: nowIso,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        // 4) تحديث الفاتورة: المصروف يُلحق بها، وأنصبة السطور وتكاليفها النهائية تُحدَّث
        const updatedInvoice: PurchaseInvoice = {
          ...purchase,
          lines: purchase.lines.map((l, i) => {
            const newShare = l.expenseShareMinor + shares[i]
            const landedTotal = Math.round(l.qty * l.unitPriceMinor) + newShare
            return { ...l, expenseShareMinor: newShare, landedUnitCostMinor: l.qty > 0 ? Math.round(landedTotal / l.qty) : l.landedUnitCostMinor }
          }),
          expenses: [...purchase.expenses, {
            nameAr: args.nameAr, amountMinor: args.amountMinor, method: args.method,
            paidBy: args.paidBy, payAccount: args.paidBy === 'treasury' ? (args.payAccount || '1101') : null,
            custodyFileId: args.paidBy === 'custody' ? (args.custodyFileId ?? null) : null,
            late: true, date: args.date,
          }],
          expensesTotalMinor: purchase.expensesTotalMinor + args.amountMinor,
          grandTotalMinor: purchase.grandTotalMinor + args.amountMinor,
          supplierDueMinor: (purchase.supplierDueMinor ?? purchase.grandTotalMinor) + (args.paidBy === 'supplier' ? args.amountMinor : 0),
        }

        // حركة عهدة إن دُفع منها + بند تكلفة مشروع إن كانت فاتورة مشروع
        let custodyTxs = state.custodyTxs
        if (custodyFile) {
          custodyTxs = [...custodyTxs, {
            id: nextId(custodyTxs), fileId: custodyFile.id, type: 'expense' as const,
            date: args.date, amountMinor: args.amountMinor, excessMinor: 0,
            description: `${args.nameAr} — مصروف لاحق على فاتورة ${purchase.invoiceNumber}`,
            treasury: null, projectId: purchase.projectId ?? null, purchaseId: purchase.id, journalEntryId: entryId,
          }]
        }
        let projectCosts = state.projectCosts
        if (purchase.projectId != null) {
          projectCosts = [...projectCosts, {
            id: nextId(projectCosts), projectId: purchase.projectId, kind: 'materials' as CostKind,
            amountMinor: args.amountMinor, date: args.date,
            description: `${args.nameAr} — مصروف لاحق على فاتورة ${purchase.invoiceNumber}`,
            payment: args.paidBy === 'supplier' ? 'credit' as const : 'cash' as const,
            journalEntryId: entryId,
          }]
        }

        set({
          purchases: state.purchases.map((p) => (p.id === purchase.id ? updatedInvoice : p)),
          journal: [...state.journal, entry],
          items: itemsAfter,
          custodyTxs,
          projectCosts,
        })
        return updatedInvoice
      },

      postSale: (args) => {
        const state = get()
        // 0) وصفات «يُجهَّز عند الطلب» (مطاعم): الطبق بلا مخزون —
        // تُفكَّك سطوره إلى احتياجات خامات تُفحص وتُخصم بدلاً منه
        const recipeOf = (itemId: number) => state.recipes.find((r) => r.productItemId === itemId && r.mode === 'made_to_order' && r.isActive)
        const saleQty = new Map<number, number>()
        // البيع بوحدة أكبر (صيدلية: شريط/علبة) — المخزون يُخصم بالوحدة الأساسية qty×factor
        for (const l of args.lines) saleQty.set(l.itemId, (saleQty.get(l.itemId) ?? 0) + baseQty(l))
        const stockNeeds = explodeIngredientNeeds(saleQty, recipeOf)
        // 1) فحص المخزون (على الخامات للأطباق، وعلى الصنف نفسه لغيرها)
        if (!args.allowNegativeStock) {
          const shortages: string[] = []
          for (const [itemId, needed] of stockNeeds) {
            const item = state.items.find((it) => it.id === itemId)
            if (!item) continue
            if ((item.stockQty ?? 0) < needed) shortages.push(`«${item.nameAr}»: متاح ${item.stockQty ?? 0} ومطلوب ${needed}`)
          }
          if (shortages.length) throw new Error(`مخزون غير كافٍ — ${shortages.join('، ')}`)
        }
        // 2) دفعات الصلاحية FEFO (القراران 5 و8): تخطيط الصرف وحظر المنتهي بلا تجاوز مدير
        const now0 = new Date().toISOString()
        const qtyPlanned = stockNeeds
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

        // 2.4) مصفوفة المتغيرات (ملابس — استشارية كنمط السيريالات):
        // صنف له تركيبات برصيد ⇒ يجب تحديد لون/مقاس لكل سطر ويُخصم من رصيد التركيبة
        const variantWanted: { itemId: number; color: string; size: string; qty: number; itemName: string }[] = []
        for (const l of args.lines) {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item) continue
          if (!hasVariantStock(state.variantStocks, l.itemId)) continue
          if (!l.variantColor && !l.variantSize) {
            throw new Error(`«${item.nameAr}»: حدد اللون/المقاس — الصنف موزع على تركيبات`)
          }
          variantWanted.push({ itemId: l.itemId, color: l.variantColor ?? '', size: l.variantSize ?? '', qty: l.qty, itemName: item.nameAr })
        }
        const variantPlan = variantWanted.length ? planVariantDeduction(state.variantStocks, variantWanted) : null

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
        // 2.7) تثبيت تكلفة السطر على المتوسط المرجح لحظة الترحيل (لا لحظة الإضافة للسلة):
        // لو رُحّلت فاتورة شراء أثناء وجود الصنف في السلة تغيّر المتوسط —
        // فيجب أن يخرج قيد التكلفة (5101/1103) بنفس متوسط لحظة البيع وإلا انفصل الدفتر عن المخزون
        const costedLines = args.lines.map((l) => {
          // طبق بوصفة «عند الطلب»: تكلفته = تكلفة خاماته بالمتوسط المرجح لحظة البيع
          const recipe = recipeOf(l.itemId)
          if (recipe) {
            const dishCost = recipeIngredientsCostMinor(recipe, (id) => state.items.find((it) => it.id === id)?.costMinor ?? 0)
            return { ...l, unitCostMinor: dishCost }
          }
          const current = state.items.find((it) => it.id === l.itemId)?.costMinor
          // لقطة المتوسط تؤخذ فقط لو كانت قيمة سليمة — أصناف قديمة قد تحمل تكلفة تالفة
          // سطر بوحدة أكبر: تكلفة الوحدة المختارة = متوسط الأساسية × المعامل
          if (!Number.isInteger(current)) return l
          const expected = Math.round((current as number) * (l.unitFactor ?? 1))
          return expected !== l.unitCostMinor ? { ...l, unitCostMinor: expected } : l
        })
        const totals = computeTotals(costedLines, args.invoiceDiscountPercent, args.taxPercent, args.taxInclusive)
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
        const refCode = makeUniqueRefCode('SAL', now, usedRefCodes(state))

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
          refCode,
          date: now,
          customerId: args.customerId,
          payment: args.payment,
          paidMinor: paidM,
          treasury: args.treasury ?? '1101',
          lines: costedLines,
          invoiceDiscountPercent: args.invoiceDiscountPercent,
          totals,
          journalEntryId: entryId,
          expiryOverrideBy: args.expiryOverrideBy ?? null,
          shiftId: currentOpenShift(state.shifts)?.id ?? null,
          warehouseId: args.warehouseId ?? null,
        }

        // 4) خصم المخزون (خامات الأطباق بدل الطبق نفسه) + تعليم السيريالات مباعة
        const updatedItems = state.items.map((it) =>
          stockNeeds.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) - stockNeeds.get(it.id)!) * 1000) / 1000 } : it,
        )
        // markSold يتحقق (موجود/متاح/يخص الصنف/غير مكرر) ويرمي خطأ عربياً قبل أي كتابة
        const updatedSerials = assignments.length ? markSold(state.serials, assignments, saleId, now) : state.serials
        // خصم مصفوفة المتغيرات (الرصيد الإجمالي خُصم أعلاه — هذا الدفتر الفرعي)
        const updatedVariants = variantPlan
          ? state.variantStocks.map((v) => {
              const k = `${v.itemId}⁞${variantKey(v.color, v.size)}`
              const dec = variantPlan.get(k)
              return dec ? { ...v, qty: Math.round((v.qty - dec) * 1000) / 1000 } : v
            })
          : state.variantStocks

        set({ sales: [...state.sales, sale], journal: [...state.journal, entry], items: updatedItems, batches: workingBatches, serials: updatedSerials, variantStocks: updatedVariants })
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
        const rawLines = buildReturnLines(sale.lines, priorLines, args.qtyByItem)
        // أطباق الوصفات «عند الطلب»: الخامات طُهيت ولا تعود للمخزون —
        // تبقى تكلفتها في 5101 (هالك اقتصادياً) ويُرد للعميل السعر فقط
        const isDish = (itemId: number) => state.recipes.some((r) => r.productItemId === itemId && r.mode === 'made_to_order')
        const lines = rawLines.map((l) => (isDish(l.itemId) ? { ...l, unitCostMinor: 0 } : l))
        // 2) نفس المعاملة الضريبية وقت البيع (حتى لو تغيرت الإعدادات لاحقاً)
        const { taxPercent, taxInclusive } = deriveTaxConfig(sale.totals)
        const totals = computeTotals(lines, sale.invoiceDiscountPercent, taxPercent, taxInclusive)
        // 3) القيد العاكس المتوازن
        // الرد النقدي من نفس خزينة البيع الأصلية (فواتير قديمة بلا خزينة → الرئيسية)
        const entryLines = buildReturnEntry(totals, args.refund, sale.treasury ?? '1101')
        const returnId = nextId(state.saleReturns)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const returnNumber = `R-${String(returnId).padStart(4, '0')}`
        const refCode = makeUniqueRefCode('SRT', now, usedRefCodes(state))

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
          refCode,
          date: now,
          saleId: sale.id,
          refund: args.refund,
          lines,
          totals,
          journalEntryId: entryId,
          reason: args.reason,
          shiftId: currentOpenShift(state.shifts)?.id ?? null,
        }

        // 4) عودة البضاعة للمخزون بتكلفة بيعها التاريخية (نفس قيمة القيد 1103 مدين)
        //    مع إعادة حساب المتوسط المرجح بالقيمة — وإلا انفصل رصيد المخزون الدفتري
        //    عن قيمته الفعلية (كمية × متوسط) وتراكم الانحراف مع كل مرتجع
        const qtyBack = new Map<number, number>()
        const valueBack = new Map<number, number>()
        for (const l of lines) {
          if (isDish(l.itemId)) continue // الطبق بلا مخزون — لا عودة
          // سطر بوحدة أكبر: يعود للمخزون بالوحدة الأساسية qty×factor وبقيمته الكاملة
          qtyBack.set(l.itemId, (qtyBack.get(l.itemId) ?? 0) + baseQty(l))
          valueBack.set(l.itemId, (valueBack.get(l.itemId) ?? 0) + Math.round(l.qty * l.unitCostMinor))
        }
        const updatedItems = state.items.map((it) => {
          if (!qtyBack.has(it.id)) return it
          const newQty = Math.round(((it.stockQty ?? 0) + qtyBack.get(it.id)!) * 1000) / 1000
          const newValue = Math.round((it.stockQty ?? 0) * it.costMinor) + valueBack.get(it.id)!
          return { ...it, stockQty: newQty, costMinor: newQty > 0 ? Math.round(newValue / newQty) : it.costMinor }
        })
        // سيريالات هذه الفاتورة تعود متاحة بعدد الكمية المرتجعة (الأقدم بيعاً أولاً)
        const serialsToReturn: string[] = []
        for (const [itemId, qty] of qtyBack) {
          const soldUnits = state.serials.filter((u) => u.saleId === sale.id && u.itemId === itemId && u.status === 'sold')
          for (const u of soldUnits.slice(0, Math.floor(qty))) serialsToReturn.push(u.serial)
        }
        const updatedSerials = serialsToReturn.length ? markReturned(state.serials, sale.id, serialsToReturn) : state.serials

        // إعادة أرصدة التركيبات (سطور البيع تحمل اللون/المقاس)
        let updatedVariantStocks = state.variantStocks
        for (const l of lines) {
          if (!l.variantColor && !l.variantSize) continue
          const key = variantKey(l.variantColor ?? '', l.variantSize ?? '')
          const idx = updatedVariantStocks.findIndex((v) => v.itemId === l.itemId && variantKey(v.color, v.size) === key)
          if (idx >= 0) {
            updatedVariantStocks = updatedVariantStocks.map((v, i2) => (i2 === idx ? { ...v, qty: Math.round((v.qty + l.qty) * 1000) / 1000 } : v))
          } else {
            updatedVariantStocks = [...updatedVariantStocks, { itemId: l.itemId, color: (l.variantColor ?? '').trim(), size: (l.variantSize ?? '').trim(), qty: l.qty }]
          }
        }
        set({ saleReturns: [...state.saleReturns, ret], journal: [...state.journal, entry], items: updatedItems, serials: updatedSerials, variantStocks: updatedVariantStocks })
        return ret
      },

      postPurchaseReturn: (args) => {
        const state = get()
        const purchase = state.purchases.find((p) => p.id === args.purchaseId)
        if (!purchase) throw new Error('فاتورة الشراء الأصلية غير موجودة')
        // فاتورة مشروع: بضاعتها حُمّلت تكلفة موقع 5110 لا مخزوناً — مرتجعها يُسوَّى
        // بسند قبض من المورد أو تسوية تكلفة على المشروع، لا بمرتجع مخزني يفسد 1103
        if (purchase.projectId != null) {
          throw new Error('فاتورة مشروع مقاولات — لا مرتجع مخزنياً لها: سجّل التسوية بسند قبض من المورد')
        }
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
          // دين المورد = مستحقه فقط (البضاعة + مصاريفه) — لا المصاريف التي دفعتُها بنفسي
          const unpaid = (purchase.supplierDueMinor ?? purchase.grandTotalMinor) - purchase.paidMinor - priorDebtReturns
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
        const refCode = makeUniqueRefCode('PRT', now, usedRefCodes(state))
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
          refCode,
          date: now,
          purchaseId: purchase.id,
          refund: args.refund,
          lines,
          totalMinor: total,
          journalEntryId: entryId,
          reason: args.reason,
        }
        // 3) خصم الكميات من المخزون بتكلفة الشراء الأصلية (نفس قيمة القيد 1103 دائن)
        //    مع إعادة حساب المتوسط المرجح بالقيمة — يبقي دفتر الأستاذ = كمية × متوسط
        const qtyOut = new Map<number, number>()
        const valueOut = new Map<number, number>()
        for (const l of lines) {
          qtyOut.set(l.itemId, (qtyOut.get(l.itemId) ?? 0) + l.qty)
          valueOut.set(l.itemId, (valueOut.get(l.itemId) ?? 0) + Math.round(l.qty * l.landedUnitCostMinor))
        }
        const updatedItems = state.items.map((it) => {
          if (!qtyOut.has(it.id)) return it
          const newQty = Math.round(((it.stockQty ?? 0) - qtyOut.get(it.id)!) * 1000) / 1000
          const newValue = Math.round((it.stockQty ?? 0) * it.costMinor) - valueOut.get(it.id)!
          return { ...it, stockQty: newQty, costMinor: newQty > 0 ? Math.round(Math.max(0, newValue) / newQty) : it.costMinor }
        })
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

      postWastage: (args) => {
        const state = get()
        // 1) إثراء السطور بالتكلفة المرجحة ثم تحقق النواة الخالصة قبل أي كتابة
        const lines = args.lines.map((l) => {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item) throw new Error('صنف غير موجود بالمخزون')
          return { itemId: l.itemId, nameAr: item.nameAr, qty: l.qty, unitCostMinor: item.costMinor }
        })
        const errors = validateWastage(
          { reason: args.reason, lines },
          (itemId) => state.items.find((it) => it.id === itemId)?.stockQty ?? 0,
        )
        if (errors.length) throw new Error(errors.join(' — '))

        const wastageId = nextId(state.wastages)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const wastageNumber = `WST-${String(wastageId).padStart(4, '0')}`
        const entryLines = buildWastageEntry(lines, wastageNumber)
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `إتلاف مخزون ${wastageNumber} — ${args.reason}`,
          sourceType: 'wastage',
          sourceId: wastageId,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        // 2) خصم الكميات + استهلاك دفعات الصلاحية الأقدم أولاً (يشمل المنتهية — هذا هو الإعدام)
        const qtyBy = new Map(lines.map((l) => [l.itemId, l.qty]))
        const updatedItems = state.items.map((it) =>
          qtyBy.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) - qtyBy.get(it.id)!) * 1000) / 1000 } : it,
        )
        let batches = state.batches
        for (const l of lines) {
          let rest = l.qty
          batches = batches
            .slice()
            .sort((a, b) => ((a.expiryDate ?? '9999') < (b.expiryDate ?? '9999') ? -1 : 1))
            .map((b) => {
              if (b.itemId !== l.itemId || rest <= 0 || b.qty <= 0) return b
              const take = Math.min(b.qty, rest)
              rest -= take
              return { ...b, qty: Math.round((b.qty - take) * 1000) / 1000 }
            })
        }

        const doc: WastageDoc = {
          id: wastageId,
          wastageNumber,
          date: now,
          reason: args.reason,
          lines,
          totalCostMinor: wastageTotalMinor(lines),
          journalEntryId: entryId,
          notes: args.notes,
        }
        set({ wastages: [...state.wastages, doc], journal: [...state.journal, entry], items: updatedItems, batches })
        return doc
      },

      postConsumption: (args) => {
        const state = get()
        const expenseAccount = (args.expenseAccount ?? INTERNAL_USE_ACCOUNT).trim()
        // 1) إثراء السطور بالتكلفة المرجحة ثم تحقق النواة الخالصة قبل أي كتابة
        const lines = args.lines.map((l) => {
          const item = state.items.find((it) => it.id === l.itemId)
          if (!item) throw new Error('صنف غير موجود بالمخزون')
          return { itemId: l.itemId, nameAr: item.nameAr, qty: l.qty, unitCostMinor: item.costMinor }
        })
        const isExpense = (code: string) => {
          const std = STANDARD_COA.find((a) => a.code === code)
          if (std) return std.rootType === 'expenses' && std.isPostable
          const custom = state.customAccounts.find((a) => a.code === code)
          return !!custom && custom.rootType === 'expenses'
        }
        const errors = validateConsumption(
          { purpose: args.purpose, expenseAccount, lines },
          (itemId) => state.items.find((it) => it.id === itemId)?.stockQty ?? 0,
          isExpense,
        )
        if (errors.length) throw new Error(errors.join(' — '))

        const consumptionId = nextId(state.consumptions)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const consumptionNumber = `CNS-${String(consumptionId).padStart(4, '0')}`
        const entryLines = buildConsumptionEntry(lines, expenseAccount, consumptionNumber)
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `صرف داخلي ${consumptionNumber} — ${args.purpose}`,
          sourceType: 'internal_use',
          sourceId: consumptionId,
          lines: entryLines,
          createdBy: state.appUsers.find((u) => u.id === state.currentUserId)?.nameAr ?? 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }

        // 2) خصم الكميات + استهلاك دفعات الصلاحية الأقدم أولاً (FEFO — نفس نمط الإتلاف)
        const qtyBy = new Map(lines.map((l) => [l.itemId, l.qty]))
        const updatedItems = state.items.map((it) =>
          qtyBy.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) - qtyBy.get(it.id)!) * 1000) / 1000 } : it,
        )
        let batches = state.batches
        for (const l of lines) {
          let rest = l.qty
          batches = batches
            .slice()
            .sort((a, b) => ((a.expiryDate ?? '9999') < (b.expiryDate ?? '9999') ? -1 : 1))
            .map((b) => {
              if (b.itemId !== l.itemId || rest <= 0 || b.qty <= 0) return b
              const take = Math.min(b.qty, rest)
              rest -= take
              return { ...b, qty: Math.round((b.qty - take) * 1000) / 1000 }
            })
        }

        const doc: ConsumptionDoc = {
          id: consumptionId,
          consumptionNumber,
          date: now,
          purpose: args.purpose,
          expenseAccount,
          lines,
          totalCostMinor: consumptionTotalMinor(lines),
          journalEntryId: entryId,
          notes: sanitizeText(args.notes, 500),
        }
        set({ consumptions: [...state.consumptions, doc], journal: [...state.journal, entry], items: updatedItems, batches })
        return doc
      },

      setOpeningBalance: (args) => {
        const state = get()
        const errors = validateOpening(args.kind, args.amountMinor)
        // تحقق وجود المرجع قبل أي كتابة (فخ mobileshop: نجاح صامت لمعرّف شبح)
        if (args.kind === 'customer' && !state.customers.some((c) => c.id === Number(args.refId))) errors.push('العميل غير موجود')
        if (args.kind === 'supplier' && !state.suppliers.some((x) => x.id === Number(args.refId))) errors.push('المورد غير موجود')
        if (args.kind === 'treasury' && !state.treasuries.some((t) => t.code === String(args.refId))) errors.push('الخزينة/البنك غير موجود')
        if (args.kind === 'employee_advance' && !state.employees.some((e) => e.id === Number(args.refId))) errors.push('الموظف غير موجود')
        if (args.kind === 'item_stock' && !state.items.some((it) => it.id === Number(args.refId))) errors.push('الصنف غير موجود')
        if (errors.length) throw new Error(errors.join(' — '))

        const key = openingKey(args.kind, args.refId)
        const previous = state.openingBalances[key] ?? 0
        const delta = args.amountMinor - previous
        if (delta === 0) return // لا تغيير — لا قيد بلا أثر

        const entryLines = buildOpeningDeltaEntry(
          args.kind,
          delta,
          `${OPENING_KIND_LABELS[args.kind]} — ${args.label}`,
          args.kind === 'treasury' ? String(args.refId) : undefined,
        )
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `رصيد افتتاحي: ${args.label} (${previous === 0 ? 'إثبات' : 'تعديل بفرق'})`,
          sourceType: 'adjustment',
          sourceId: null,
          lines: entryLines,
          createdBy: 'المالك',
          createdAt: now,
          reversedByEntryId: null,
          reversesEntryId: null,
        }
        set({
          openingBalances: { ...state.openingBalances, [key]: args.amountMinor },
          journal: [...state.journal, entry],
        })
      },

      applySettlement: (args) => {
        const state = get()
        // 1) الرصيد الدفتري الحالي للقسم من نفس مصادر الشاشات (لا حساب موازٍ)
        let bookMinor = 0
        let refNameAr = ''
        if (args.section === 'treasury') {
          const t = state.treasuries.find((x) => x.code === String(args.refId))
          if (!t) throw new Error('الخزينة/البنك غير موجود')
          refNameAr = t.nameAr
          for (const e of state.journal) for (const l of e.lines) if (l.accountCode === t.code) bookMinor += l.debit - l.credit
        } else if (args.section === 'customer') {
          const c = state.customers.find((x) => x.id === Number(args.refId))
          if (!c) throw new Error('العميل غير موجود')
          refNameAr = c.nameAr
          // الرصيد الموحّد من كل الأنشطة (إصلاح الترابط) — نفس مصدر كل الشاشات
          bookMinor = get().getCustomerBalance(c.id)
        } else {
          const sup = state.suppliers.find((x) => x.id === Number(args.refId))
          if (!sup) throw new Error('المورد غير موجود')
          refNameAr = sup.nameAr
          // الرصيد الموحّد — نفس مصدر كل الشاشات (كشف المورد: الدائن = له علينا)
          bookMinor = get().getSupplierBalance(sup.id)
        }

        // 2) تحقق النواة: السالب مرفوض للخزائن فقط + السبب إلزامي
        const input: SettlementInput = {
          section: args.section,
          bookMinor,
          actualMinor: args.actualMinor,
          treasuryCode: args.section === 'treasury' ? String(args.refId) : undefined,
          reason: args.reason,
        }
        const errors = validateSettlement(input)
        if (errors.length) throw new Error(errors.join(' — '))

        // 3) قيد الفرق (يضرب 5112 إجبارياً — درس عجز الـ5,000 المتبخر في mobileshop)
        const variance = settlementVariance(input)
        const entryLines = buildSettlementEntry(input)
        const now = new Date().toISOString()
        const id = nextId(state.settlements)
        const doc: SettlementDoc = {
          id,
          settlementNumber: `SET-${String(id).padStart(4, '0')}`,
          date: now,
          section: args.section,
          refId: args.refId,
          refNameAr,
          bookMinor,
          actualMinor: args.actualMinor,
          varianceMinor: variance,
          reason: args.reason.trim(),
          journalEntryId: null,
        }
        const journal = [...state.journal]
        if (entryLines.length) {
          const entryId = nextId(journal)
          doc.journalEntryId = entryId
          journal.push({
            id: entryId,
            entryNumber: entryId,
            date: now.slice(0, 10),
            description: `${SETTLEMENT_LABELS[args.section]} ${doc.settlementNumber}: ${refNameAr} — ${args.reason.trim()}`,
            sourceType: 'adjustment',
            sourceId: id,
            lines: entryLines,
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          })
        }
        set({ settlements: [...state.settlements, doc], journal })
        return doc
      },

      postExchange: (args) => {
        const state = get()
        const sale = state.sales.find((x) => x.id === args.originalSaleId)
        if (!sale) throw new Error('الفاتورة الأصلية غير موجودة')
        const coreErrors = validateExchange({
          returnLines: [...args.returnQtyByItem].map(([itemId, qty]) => ({ itemId, qty })),
          newLines: args.newLines.map((l) => ({ itemId: l.itemId, qty: l.qty, variantColor: l.variantColor, variantSize: l.variantSize })),
        })
        if (coreErrors.length) throw new Error(coreErrors.join(' — '))

        // ذرية العملية المركبة: لقطة كاملة قبل المرتجع — فشل البيع الجديد يسترجعها
        // (وإلا بقي مرتجع «يتيم» نصف استبدال — نفس درس فاتورة الكاشير)
        const snapshot = get()
        try {
          // 1) المرتجع نقدي من خزينة الاستبدال: النقدية الخارجة والداخلة في نفس
          //    الخزينة فحركتها الصافية = الفرق فقط (ما يراه الكاشير في الدرج)
          const treasury = args.treasury ?? sale.treasury ?? '1101'
          const ret = get().postSaleReturn({
            saleId: sale.id,
            qtyByItem: args.returnQtyByItem,
            refund: 'cash',
            reason: `استبدال${args.notes.trim() ? ` — ${args.notes.trim()}` : ''}`,
          })
          // 2) البيع الجديد بنفس المعاملة الضريبية للفاتورة الأصلية (اتساق المستندين)
          const { taxPercent, taxInclusive } = deriveTaxConfig(sale.totals)
          const newSale = get().postSale({
            lines: args.newLines,
            customerId: sale.customerId,
            payment: 'cash',
            invoiceDiscountPercent: 0,
            taxPercent,
            taxInclusive,
            treasury: treasury as TreasuryAccount,
            warehouseId: sale.warehouseId ?? null,
          })
          // 3) مستند الربط والصافي
          const afterState = get()
          const preview = computeExchangeNet(ret.totals.totalMinor, newSale.totals.totalMinor)
          const id = nextId(afterState.exchanges)
          const doc: ExchangeDoc = {
            id,
            exchangeNumber: `EXC-${String(id).padStart(4, '0')}`,
            date: new Date().toISOString(),
            originalSaleId: sale.id,
            returnId: ret.id,
            newSaleId: newSale.id,
            returnValueMinor: preview.returnValueMinor,
            newValueMinor: preview.newValueMinor,
            netMinor: preview.netMinor,
            notes: args.notes.trim(),
          }
          set({ exchanges: [...afterState.exchanges, doc] })
          return doc
        } catch (e) {
          // استرجاع كامل — لا مرتجع يتيم بلا بيعه المقابل
          useDataStore.setState(snapshot, true)
          throw e
        }
      },

      openRestaurantOrder: (args) => {
        const state = get()
        const errors = validateRestaurantOrder({ type: args.type, tableName: args.tableName ?? '', deliveryInfo: args.deliveryInfo ?? '' })
        if (errors.length) throw new Error(errors.join(' — '))
        // طاولة مشغولة بأمر مفتوح لا تُفتح ثانية — الأصناف تُضاف للأمر القائم
        if (args.type === 'dine_in' && occupiedTables(state.restaurantOrders).has((args.tableName ?? '').trim())) {
          throw new Error(`الطاولة «${args.tableName}» عليها أمر مفتوح بالفعل — أضف الأصناف إليه`)
        }
        const id = nextId(state.restaurantOrders)
        const order: RestaurantOrder = {
          id,
          orderNumber: `ORD-${String(id).padStart(4, '0')}`,
          type: args.type,
          tableName: (args.tableName ?? '').trim(),
          deliveryInfo: (args.deliveryInfo ?? '').trim(),
          lines: [],
          notes: (args.notes ?? '').trim(),
          status: 'open',
          openedAt: new Date().toISOString(),
          settledAt: null,
          saleId: null,
        }
        set({ restaurantOrders: [...state.restaurantOrders, order] })
        return order
      },

      setRestaurantOrderLines: (orderId, lines) => {
        const state = get()
        const order = state.restaurantOrders.find((o) => o.id === orderId)
        if (!order) throw new Error('الأمر غير موجود')
        if (order.status !== 'open') throw new Error('الأمر مقفول — لا تعديل بعد الفوترة')
        set({ restaurantOrders: state.restaurantOrders.map((o) => (o.id === orderId ? { ...o, lines } : o)) })
      },

      cancelRestaurantOrder: (orderId, reason) => {
        const state = get()
        const order = state.restaurantOrders.find((o) => o.id === orderId)
        if (!order) throw new Error('الأمر غير موجود')
        if (order.status !== 'open') throw new Error('لا يُلغى إلا أمر مفتوح')
        if (!reason.trim()) throw new Error('سبب الإلغاء مطلوب — يُعرض في سجل الأوامر')
        set({
          restaurantOrders: state.restaurantOrders.map((o) =>
            o.id === orderId ? { ...o, status: 'cancelled' as const, notes: [o.notes, `أُلغي: ${reason.trim()}`].filter(Boolean).join(' — ') } : o,
          ),
        })
      },

      settleRestaurantOrder: (args) => {
        const state = get()
        const order = state.restaurantOrders.find((o) => o.id === args.orderId)
        if (!order) throw new Error('الأمر غير موجود')
        if (order.status !== 'open') throw new Error('الأمر مقفول أو ملغى بالفعل')
        if (order.lines.length === 0) throw new Error('الأمر بلا أصناف — أضف الطلبات أولاً أو ألغِ الأمر')
        // رسوم الخدمة (٪ من الأصناف) والتوصيل تُحقن سطوراً صناعية بلا مخزون
        const lines: CartLine[] = [...order.lines]
        const pct = args.serviceChargePercent ?? 0
        if (pct > 0) {
          const charge = serviceChargeMinor(orderSubtotalMinor(order.lines), pct)
          if (charge > 0) lines.push(feeLine(`رسوم خدمة ${pct}٪`, charge))
        }
        if (order.type === 'delivery' && (args.deliveryFeeMinor ?? 0) > 0) {
          lines.push(feeLine('رسوم توصيل', args.deliveryFeeMinor!))
        }
        // فاتورة واحدة تتولى الوصفات/المخزون/الضريبة/القيد — المحاسبة تبدأ هنا فقط
        const sale = get().postSale({
          lines,
          customerId: args.customerId ?? null,
          payment: args.payment,
          invoiceDiscountPercent: 0,
          taxPercent: args.taxPercent,
          taxInclusive: args.taxInclusive,
          treasury: args.treasury,
          paidMinor: args.paidMinor,
        })
        set({
          restaurantOrders: get().restaurantOrders.map((o) =>
            o.id === order.id ? { ...o, status: 'settled' as const, settledAt: new Date().toISOString(), saleId: sale.id } : o,
          ),
        })
        return sale
      },

      postVoucher: (args) => {
        const state = get()
        // القيد حسب نوع السند — كله عبر دوال النواة المتوازنة بنيوياً
        const entryLines =
          args.kind === 'receipt'
            ? buildReceiptVoucherEntry(args.treasury, args.counterAccountCode, args.amountMinor, args.description)
            : args.kind === 'payment'
              ? buildPaymentVoucherEntry(args.treasury, args.counterAccountCode, args.amountMinor, args.description)
              : buildTransferEntry(args.treasury, args.counterAccountCode as TreasuryAccount, args.amountMinor, args.description, args.feeMinor ?? 0)

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

        // ═══ إصلاح المالك: «المبالغ في الملف غير مطابقة لكشف الحساب» ═══
        // سند قبض من عميل (1104) مرتبط بمرضى عيادة ⇒ نوزع المبلغ على أرصدة
        // مرضاه المفتوحة (الأقدم أولاً) كتحصيلات عيادة، فيتصفّر ملف المريض
        // وكشف الحساب معاً من نفس السند — مصدر حقيقة واحد بلا ازدواج قيود.
        let clinicCollections = state.clinicCollections
        if (args.kind === 'receipt' && args.partyKind === 'customer' && args.partyId && args.counterAccountCode === '1104') {
          const linkedPatients = state.clinicPatients.filter((p) => p.linkedCustomerId === args.partyId)
          let toAllocate = args.amountMinor
          for (const pat of linkedPatients) {
            if (toAllocate <= 0) break
            const bal = patientBalance(
              state.clinicVisits.filter((v) => v.patientId === pat.id).map((v) => ({ dueMinor: v.totals.dueMinor })),
              clinicCollections.filter((c) => c.patientId === pat.id).map((c) => ({ amountMinor: c.amountMinor })),
            )
            const take = Math.min(bal, toAllocate)
            if (take > 0) {
              clinicCollections = [...clinicCollections, {
                id: nextId(clinicCollections), patientId: pat.id, date: now,
                amountMinor: take, journalEntryId: entryId, viaVoucherId: voucherId,
              }]
              toAllocate -= take
            }
          }
        }

        set({ vouchers: [...state.vouchers, voucher], journal: [...state.journal, entry], clinicCollections })
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
        const errors = validateManualEntry(args.lines, [...fullCoa(STANDARD_COA, state.treasuries), ...customAsAccounts(state.customAccounts)])
        if (errors.length) throw new Error(errors.join('، '))
        // حارس الفترة المقفلة (منهجية Closing Date العالمية): لا قيود بأثر رجعي في سنة مقفلة
        if (args.date) {
          const closed = dateInClosedYear(args.date, useAppStore.getState().fiscalYears)
          if (closed) throw new Error(`التاريخ ${args.date} داخل السنة المالية المقفلة «${closed.nameAr}» — لا قيود في فترة مقفلة`)
        }
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

      settleShiftVariance: (args) => {
        const state = get()
        const shift = state.shifts.find((s) => s.id === args.shiftId)
        if (!shift) throw new Error('الوردية غير موجودة')
        if (shift.status !== 'closed' || shift.countedCashMinor === null) throw new Error('تسوية الفرق بعد إقفال الوردية وعدّ الدرج')
        if (shift.varianceSettledMode) throw new Error('فرق هذه الوردية سُوّي بالفعل')
        // فرق الوردية بنفس نواة الملخص — لا حسابين مختلفين
        const kindOf = (code?: string) => state.treasuries.find((t) => t.code === (code ?? '1101'))?.kind ?? 'cash'
        const saleDocs = state.sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf(s.treasury) }))
        const returnDocs = state.saleReturns.map((r) => ({ shiftId: r.shiftId, payment: r.refund, totalMinor: r.totals.totalMinor, treasuryKind: kindOf(state.sales.find((s) => s.id === r.saleId)?.treasury) }))
        const variance = summarizeShift(shift, saleDocs, returnDocs).varianceMinor
        if (variance === null || variance === 0) throw new Error('لا فرق في هذه الوردية للتسوية')
        const now = new Date().toISOString()
        const label = `وردية #${shift.id}`

        if (args.mode === 'advance') {
          // سلفة على الموظف تُخصم من رواتبه (تظهر في مسير الرواتب تلقائياً)
          if (variance > 0) throw new Error('السلفة تكون عن عجز فقط — الزيادة تُسوى كإيراد')
          const emp = state.employees.find((e) => e.id === args.employeeId)
          if (!emp) throw new Error('اختر الموظف الذي يتحمل العجز')
          const advId = nextId(state.employeeAdvances)
          const entryId = nextId(state.journal)
          const advanceNumber = `ADV-${String(advId).padStart(4, '0')}`
          const entry: JournalEntry = {
            id: entryId, entryNumber: entryId, date: now.slice(0, 10),
            description: `عجز ${label} محمَّل سلفة على ${emp.nameAr} — ${advanceNumber}`,
            sourceType: 'payment_voucher', sourceId: advId,
            lines: buildVarianceAdvanceEntry(variance, '1101', emp.nameAr),
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }
          const advance: EmployeeAdvance = {
            id: advId, advanceNumber, employeeId: emp.id, date: now,
            amountMinor: Math.abs(variance), recoveredMinor: 0,
            source: 'cash', custodyFileId: null, treasury: '1101',
            notes: `عجز ${label} — يُخصم من الرواتب`, journalEntryId: entryId,
          }
          const updated: Shift = { ...shift, varianceSettledMode: 'advance', varianceEntryId: entryId, varianceAdvanceId: advId }
          set({
            employeeAdvances: [...state.employeeAdvances, advance],
            journal: [...state.journal, entry],
            shifts: state.shifts.map((s) => (s.id === shift.id ? updated : s)),
          })
          return updated
        }

        // مصروف (عجز) أو إيراد آخر (زيادة)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: variance < 0 ? `تسوية عجز ${label} كمصروف` : `تسوية زيادة ${label} كإيراد آخر`,
          sourceType: 'adjustment', sourceId: shift.id,
          lines: buildVarianceExpenseEntry(variance, '1101', label),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: Shift = { ...shift, varianceSettledMode: 'expense', varianceEntryId: entryId, varianceAdvanceId: null }
        set({ journal: [...state.journal, entry], shifts: state.shifts.map((s) => (s.id === shift.id ? updated : s)) })
        return updated
      },

      editSale: (args) => {
        const state = get()
        // ⛔ سياسة المالك: الفاتورة الضريبية الإلكترونية مفعلة ⇒ لا تعديل — إشعار دائن/مدين فقط
        if (args.einvoiceActive) {
          throw new Error('الفاتورة الضريبية الإلكترونية مفعلة — الفواتير الصادرة مرتبطة بمنظومة الضرائب ولا تُعدَّل. استخدم إشعار دائن (مرتجع) أو إشعار مدين (فاتورة إضافية)')
        }
        const sale = state.sales.find((s) => s.id === args.saleId)
        if (!sale) throw new Error('الفاتورة غير موجودة')
        if (!args.lines.length) throw new Error('الفاتورة المعدلة بلا أصناف')
        // موانع السلامة المحاسبية: مستندات لاحقة بُنيت على الفاتورة
        const blocks = saleEditBlocks({
          hasReturns: state.saleReturns.some((r) => r.saleId === sale.id),
          hasSoldSerials: state.serials.some((u) => u.saleId === sale.id && u.status === 'sold'),
          hasInstallmentPlan: state.installmentPlans.some((p) => p.saleId === sale.id),
          hasSettlementAllocation: state.clientSettlements.some((st) => st.allocations.some((a) => a.docKey === `sale:${sale.id}`)),
          shiftClosed: sale.shiftId != null && state.shifts.some((sh) => sh.id === sale.shiftId && sh.status === 'closed'),
        })
        if (blocks.length) throw new Error(`لا يمكن تعديل هذه الفاتورة: ${blocks.join('؛ ')}`)
        // أصناف الوصفات والمتغيرات تعديلها له تشعبات (خامات مطبوخة/تركيبات) — الأسلم مرتجع + فاتورة جديدة
        const usesRecipes = sale.lines.some((l) => state.recipes.some((r) => r.productItemId === l.itemId && r.mode === 'made_to_order'))
        const usesVariants = sale.lines.some((l) => l.variantColor || l.variantSize) || args.lines.some((l) => l.variantColor || l.variantSize)
        if (usesRecipes) throw new Error('فاتورة أطباق بوصفات — الخامات صُرفت فعلاً؛ صحّح بمرتجع وفاتورة جديدة')
        if (usesVariants) throw new Error('فاتورة بتركيبات لون/مقاس — صحّح بمرتجع وفاتورة جديدة للحفاظ على أرصدة التركيبات')

        // ① إعادة مخزون السطور القديمة (بتكلفتها التاريخية — نفس منطق المرتجع)
        const stockAfterRestore = new Map<number, { qty: number; costMinor: number }>()
        for (const it of state.items) stockAfterRestore.set(it.id, { qty: it.stockQty ?? 0, costMinor: it.costMinor })
        for (const l of sale.lines) {
          const cur = stockAfterRestore.get(l.itemId)
          if (!cur) continue
          const newQty = Math.round((cur.qty + l.qty) * 1000) / 1000
          const newValue = Math.round(cur.qty * cur.costMinor) + Math.round(l.qty * l.unitCostMinor)
          stockAfterRestore.set(l.itemId, { qty: newQty, costMinor: newQty > 0 ? Math.round(newValue / newQty) : cur.costMinor })
        }
        // ② فحص كفاية المخزون للسطور الجديدة (بعد الإعادة)
        if (!args.allowNegativeStock) {
          const need = new Map<number, number>()
          for (const l of args.lines) need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty)
          const shortages: string[] = []
          for (const [itemId, qty] of need) {
            const cur = stockAfterRestore.get(itemId)
            const item = state.items.find((it) => it.id === itemId)
            if (!cur || !item) { shortages.push(`صنف #${itemId} غير موجود`); continue }
            if (cur.qty < qty) shortages.push(`«${item.nameAr}»: متاح ${cur.qty} ومطلوب ${qty}`)
          }
          if (shortages.length) throw new Error(`مخزون غير كافٍ للتعديل — ${shortages.join('، ')}`)
        }
        // ③ تثبيت تكلفة السطور الجديدة على المتوسط بعد الإعادة (لا متوسط لحظة الإدخال)
        const costedLines = args.lines.map((l) => {
          const cur = stockAfterRestore.get(l.itemId)
          return cur && Number.isInteger(cur.costMinor) ? { ...l, unitCostMinor: cur.costMinor } : l
        })
        // ④ الإجماليات والقيد الجديد بنفس المعاملة الضريبية الأصلية
        const { taxPercent, taxInclusive } = deriveTaxConfig(sale.totals)
        const totals = computeTotals(costedLines, args.invoiceDiscountPercent, taxPercent, taxInclusive)
        const paidM = args.paidMinor
        if (!Number.isInteger(paidM) || paidM < 0) throw new Error('المدفوع لا يكون سالباً')
        if (paidM > totals.totalMinor) throw new Error('المدفوع أكبر من إجمالي الفاتورة المعدلة')
        if (paidM < totals.totalMinor && args.customerId == null) {
          throw new Error('الجزء الآجل يحتاج اختيار عميل — لا دين على «عميل نقدي»')
        }
        const newEntryLines = buildSaleEntry(totals, args.payment, args.treasury, paidM)
        const now = new Date().toISOString()

        // ⑤ قيد عكس القيد القديم + القيد الجديد (سجل تدقيق كامل — لا حذف أبداً)
        const oldEntry = state.journal.find((e) => e.id === sale.journalEntryId)
        if (!oldEntry) throw new Error('قيد الفاتورة الأصلي غير موجود — الدفتر تالف')
        if (oldEntry.reversedByEntryId) throw new Error('قيد الفاتورة معكوس بالفعل')
        const reversalId = nextId(state.journal)
        const reversal: JournalEntry = {
          id: reversalId, entryNumber: reversalId, date: now.slice(0, 10),
          description: `عكس قيد ${sale.invoiceNumber} — تعديل الفاتورة${args.reason ? `: ${args.reason}` : ''}`,
          sourceType: 'reversal', sourceId: oldEntry.id,
          lines: buildReversalLines(oldEntry.lines),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: oldEntry.id,
        }
        const newEntryId = reversalId + 1
        const newEntry: JournalEntry = {
          id: newEntryId, entryNumber: newEntryId, date: now.slice(0, 10),
          description: `فاتورة بيع ${sale.invoiceNumber} (معدلة)`,
          sourceType: 'sale', sourceId: sale.id,
          lines: newEntryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }

        // ⑥ المخزون النهائي = بعد الإعادة − السطور الجديدة (متوسط التكلفة لا يتغير بالبيع)
        const finalStock = new Map(stockAfterRestore)
        for (const l of costedLines) {
          const cur = finalStock.get(l.itemId)
          if (!cur) continue
          finalStock.set(l.itemId, { ...cur, qty: Math.round((cur.qty - l.qty) * 1000) / 1000 })
        }
        const updatedItems = state.items.map((it) => {
          const f = finalStock.get(it.id)
          if (!f) return it
          if (f.qty === (it.stockQty ?? 0) && f.costMinor === it.costMinor) return it
          return { ...it, stockQty: f.qty, costMinor: f.costMinor }
        })

        const updatedSale: SaleInvoice = {
          ...sale,
          customerId: args.customerId,
          payment: args.payment,
          paidMinor: paidM,
          treasury: args.treasury,
          lines: costedLines,
          invoiceDiscountPercent: args.invoiceDiscountPercent,
          totals,
          journalEntryId: newEntryId,
          editHistory: [
            ...(sale.editHistory ?? []),
            { at: now, reason: args.reason, previousEntryId: oldEntry.id, reversalEntryId: reversalId },
          ],
        }
        set({
          sales: state.sales.map((s) => (s.id === sale.id ? updatedSale : s)),
          journal: [
            ...state.journal.map((e) => (e.id === oldEntry.id ? { ...e, reversedByEntryId: reversalId } : e)),
            reversal,
            newEntry,
          ],
          items: updatedItems,
        })
        return updatedSale
      },

      editPurchase: (args) => {
        const state = get()
        // ⛔ نفس سياسة المالك: منظومة إلكترونية مفعلة ⇒ لا تعديل
        if (args.einvoiceActive) {
          throw new Error('الفاتورة الضريبية الإلكترونية مفعلة — لا تُعدَّل الفواتير المسجلة. استخدم مرتجع شراء (إشعار مدين على المورد) أو فاتورة إضافية')
        }
        const inv = state.purchases.find((p) => p.id === args.purchaseId)
        if (!inv) throw new Error('فاتورة الشراء غير موجودة')
        if (!args.lines.length) throw new Error('الفاتورة المعدلة بلا أصناف')
        if (inv.journalEntryId == null) throw new Error('فاتورة قديمة بلا قيد — لا تُعدَّل')
        for (const l of args.lines) {
          if (!Number.isFinite(l.qty) || l.qty <= 0) throw new Error('كل كمية يجب أن تكون رقماً موجباً')
          if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) throw new Error('سعر شراء غير صالح')
        }
        // موانع السلامة: مستندات لاحقة بُنيت على الفاتورة
        if (state.purchaseReturns.some((r) => r.purchaseId === inv.id)) {
          throw new Error('عليها مرتجعات شراء — صحّح بمرتجع إضافي أو فاتورة جديدة')
        }
        if (state.serials.some((u) => u.purchaseId === inv.id)) {
          throw new Error('سُجلت سيريالات من هذه الفاتورة — صحّح بمرتجع شراء ثم فاتورة جديدة')
        }
        if (state.batches.some((b) => b.purchaseId === inv.id && b.qty !== inv.lines.find((l) => l.itemId === b.itemId)?.qty)) {
          throw new Error('صُرف من دفعات صلاحية هذه الفاتورة — صحّح بمرتجع لا بتعديل')
        }
        if (inv.custodyFileId != null) throw new Error('فاتورة مدفوعة من عهدة — عدّلها بمرتجع وفاتورة جديدة حفاظاً على ملف العهدة')
        if (inv.projectId != null) throw new Error('فاتورة مشروع — تكاليف المشاريع تُصحح بمستند تكلفة عاكس لا بتعديل')
        if (inv.expenses.some((e) => (e.paidBy ?? 'supplier') !== 'supplier')) {
          throw new Error('فيها مصاريف مدفوعة من خزائن/عهد — عدّلها بمرتجع وفاتورة جديدة')
        }

        // ① التراجع عن أثر المخزون القديم (كمية وقيمة بالتكلفة المحملة القديمة)
        const stockAfterUndo = new Map<number, { qty: number; costMinor: number }>()
        for (const it of state.items) stockAfterUndo.set(it.id, { qty: it.stockQty ?? 0, costMinor: it.costMinor })
        const soldFrom: string[] = []
        for (const l of inv.lines) {
          const cur = stockAfterUndo.get(l.itemId)
          const item = state.items.find((it) => it.id === l.itemId)
          if (!cur || !item) continue
          if (cur.qty < l.qty) { soldFrom.push(item.nameAr); continue }
          const newQty = Math.round((cur.qty - l.qty) * 1000) / 1000
          const newValue = Math.round(cur.qty * cur.costMinor) - (Math.round(l.qty * l.unitPriceMinor) + (l.expenseShareMinor ?? 0))
          stockAfterUndo.set(l.itemId, { qty: newQty, costMinor: newQty > 0 ? Math.max(0, Math.round(newValue / newQty)) : cur.costMinor })
        }
        if (soldFrom.length) {
          throw new Error(`بيع من بضاعة هذه الفاتورة (${soldFrom.join('، ')}) — التعديل يفسد التكلفة؛ استخدم مرتجع شراء جزئياً`)
        }

        // ② الفاتورة الجديدة: تكاليف محملة + قيد V2 (مصاريف على المورد فقط هنا)
        const costLines: CostLine[] = args.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor }))
        const landed = computeLandedCosts(costLines, args.expenses as ExpenseInput[])
        const goodsTotal = landed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
        const expensesTotal = args.expenses.reduce((a, e) => a + e.amountMinor, 0)
        const grandTotal = goodsTotal + expensesTotal
        if (!Number.isInteger(args.paidMinor) || args.paidMinor < 0) throw new Error('المدفوع لا يكون سالباً')
        const newEntryLines = buildPurchaseEntryV2({
          inventoryAccount: '1103',
          inventoryNote: 'بضاعة واردة بتكلفتها الكاملة (فاتورة معدلة)',
          grandTotalMinor: grandTotal,
          paidMinor: args.paidMinor,
          payAccount: args.treasury,
          expensePayments: [],
        })
        const now = new Date().toISOString()

        // ③ عكس القيد القديم + قيد جديد
        const oldEntry = state.journal.find((e) => e.id === inv.journalEntryId)
        if (!oldEntry) throw new Error('قيد الفاتورة الأصلي غير موجود')
        if (oldEntry.reversedByEntryId) throw new Error('قيد الفاتورة معكوس بالفعل')
        const reversalId = nextId(state.journal)
        const reversal: JournalEntry = {
          id: reversalId, entryNumber: reversalId, date: now.slice(0, 10),
          description: `عكس قيد ${inv.invoiceNumber} — تعديل الفاتورة${args.reason ? `: ${args.reason}` : ''}`,
          sourceType: 'reversal', sourceId: oldEntry.id,
          lines: buildReversalLines(oldEntry.lines),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: oldEntry.id,
        }
        const newEntryId = reversalId + 1
        const newEntry: JournalEntry = {
          id: newEntryId, entryNumber: newEntryId, date: now.slice(0, 10),
          description: `فاتورة شراء ${inv.invoiceNumber} (معدلة)`,
          sourceType: 'purchase', sourceId: inv.id,
          lines: newEntryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }

        // ④ المخزون النهائي: إضافة السطور الجديدة بمتوسط مرجح على أساس ما بعد التراجع
        const finalStock = new Map(stockAfterUndo)
        for (const l of landed) {
          const cur = finalStock.get(l.itemId)
          if (!cur) continue
          const newCost = weightedAverage(cur.qty, cur.costMinor, l.qty, l.landedTotalMinor)
          finalStock.set(l.itemId, { qty: Math.round((cur.qty + l.qty) * 1000) / 1000, costMinor: newCost })
        }
        const updatedItems = state.items.map((it) => {
          const f = finalStock.get(it.id)
          if (!f) return it
          if (f.qty === (it.stockQty ?? 0) && f.costMinor === it.costMinor) return it
          return { ...it, stockQty: f.qty, costMinor: f.costMinor }
        })
        // دفعات الصلاحية المفتوحة بهذه الفاتورة تُستبدل بكميات السطور الجديدة
        let nextBatchId = nextId(state.batches)
        const keptBatches = state.batches.filter((b) => b.purchaseId !== inv.id)
        const newBatches: StockBatch[] = []
        for (const l of args.lines) {
          const item = state.items.find((it) => it.id === l.itemId)
          const oldBatch = state.batches.find((b) => b.purchaseId === inv.id && b.itemId === l.itemId)
          if (!item?.trackExpiry) continue
          newBatches.push({ id: nextBatchId++, itemId: l.itemId, expiryDate: oldBatch?.expiryDate ?? null, qty: l.qty, purchaseId: inv.id, receivedAt: now })
        }

        const updatedInv: PurchaseInvoice = {
          ...inv,
          lines: landed.map((l) => ({
            itemId: l.itemId, qty: l.qty, unitPriceMinor: l.unitPriceMinor,
            expenseShareMinor: l.expenseShareMinor, landedUnitCostMinor: l.landedUnitCostMinor,
          })),
          expenses: args.expenses,
          goodsTotalMinor: goodsTotal,
          expensesTotalMinor: expensesTotal,
          grandTotalMinor: grandTotal,
          supplierDueMinor: grandTotal,
          paidMinor: args.paidMinor,
          treasury: args.treasury,
          journalEntryId: newEntryId,
          editHistory: [
            ...(inv.editHistory ?? []),
            { at: now, reason: args.reason, previousEntryId: oldEntry.id, reversalEntryId: reversalId },
          ],
        }
        set({
          purchases: state.purchases.map((p) => (p.id === inv.id ? updatedInv : p)),
          journal: [
            ...state.journal.map((e) => (e.id === oldEntry.id ? { ...e, reversedByEntryId: reversalId } : e)),
            reversal,
            newEntry,
          ],
          items: updatedItems,
          batches: [...keptBatches, ...newBatches],
        })
        return updatedInv
      },

      /* ─── المستخدمون وسجل النشاطات والبلاغات (طلب المالك) ─── */
      addAppUser: (u) => {
        const state = get()
        // أمان: لا مستخدمين فرعيين قبل تحصين حساب المالك برقم سري — وإلا صار «المالك» باباً مفتوحاً بشاشة الدخول
        if (state.ownerPinHash == null) throw new Error('عيّن رقماً سرياً لحساب المالك أولاً (من نفس الشاشة) ثم أضف المستخدمين')
        const nameAr = sanitizeText(u.nameAr, 60)
        if (!nameAr) throw new Error('اسم المستخدم مطلوب')
        if (state.appUsers.some((x) => x.nameAr === nameAr && x.active)) throw new Error('يوجد مستخدم نشط بنفس الاسم')
        if (!u.pinHash) throw new Error('الرقم السري مطلوب')
        if (u.roleId === 'owner' && state.appUsers.some((x) => x.roleId === 'owner' && x.active)) {
          throw new Error('يوجد حساب مالك بالفعل — دور المالك لحساب واحد فقط')
        }
        const user: AppUser = { id: nextId(state.appUsers), nameAr, roleId: u.roleId, pinHash: u.pinHash, active: true }
        set({ appUsers: [...state.appUsers, user] })
        return user
      },
      updateAppUser: (id, patch) => {
        const state = get()
        const user = state.appUsers.find((u) => u.id === id)
        if (!user) throw new Error('المستخدم غير موجود')
        if (user.roleId === 'owner' && patch.roleId && patch.roleId !== 'owner') {
          throw new Error('حساب المالك لا يُخفَّض دوره — محمي بنيوياً')
        }
        set({
          appUsers: state.appUsers.map((u) => (u.id === id
            ? { ...u, ...patch, ...(patch.nameAr !== undefined ? { nameAr: sanitizeText(patch.nameAr, 60) || u.nameAr } : {}) }
            : u)),
        })
      },
      setRolePermissions: (roleId, permissions) => {
        // دور المالك محمي بنيوياً — أي محاولة تعديل تُرفض (صفر تجاوز)
        if (roleId === 'owner') throw new Error('دور المالك محمي — كل الصلاحيات دائماً')
        const state = get()
        set({ roleOverrides: { ...state.roleOverrides, [roleId]: [...new Set(permissions)] } })
      },
      setUserPermExceptions: (id, extraPerms, deniedPerms) => {
        const state = get()
        const user = state.appUsers.find((u) => u.id === id)
        if (!user) throw new Error('المستخدم غير موجود')
        if (user.roleId === 'owner') throw new Error('حساب المالك لا تُحجب عنه صلاحية')
        set({
          appUsers: state.appUsers.map((u) => (u.id === id
            ? { ...u, extraPerms: [...new Set(extraPerms)], deniedPerms: [...new Set(deniedPerms)] }
            : u)),
        })
      },
      removeAppUser: (id) => {
        const state = get()
        const user = state.appUsers.find((u) => u.id === id)
        if (!user) return
        if (user.roleId === 'owner') throw new Error('حساب المالك لا يُحذف')
        // لا حذف فعلياً — تعطيل فقط ليبقى اسمه في سجل النشاطات القديم صحيحاً
        set({
          appUsers: state.appUsers.map((u) => (u.id === id ? { ...u, active: false } : u)),
          ...(state.currentUserId === id ? { currentUserId: null } : {}),
        })
      },
      setCurrentUser: (id) => {
        const state = get()
        if (id != null && !state.appUsers.some((u) => u.id === id && u.active)) throw new Error('مستخدم غير موجود أو معطل')
        // سد ثغرة انتحال الصلاحيات: متى فُعّلت المصادقة، التبديل يمر عبر login() بفحص PIN فقط
        if (state.ownerPinHash != null || state.appUsers.some((u) => u.active)) {
          throw new Error('تبديل المستخدم يتم من شاشة الدخول بالرقم السري — سجّل خروجاً ثم ادخل بالحساب الآخر')
        }
        set({ currentUserId: id })
      },
      setOwnerPin: (pinHash) => {
        if (!pinHash) throw new Error('الرقم السري مطلوب')
        set({ ownerPinHash: pinHash, ownerTempPin: null })
      },
      login: async (id, pin) => {
        const state = get()
        const nowIso = new Date().toISOString()
        const lockLeft = lockoutMinutesLeft(state.loginGuard, nowIso)
        if (lockLeft > 0) throw new Error(`محاولات كثيرة خاطئة — الدخول مقفول ${lockLeft} دقيقة`)
        let ok = false
        let usedTempPin = false
        if (id == null) {
          // المالك: الرقم الأساسي أو الرقم المؤقت (تليجرام) غير المنتهي
          if (state.ownerPinHash && (await verifyPin(pin, state.ownerPinHash))) ok = true
          else if (state.ownerTempPin && !tempPinExpired(state.ownerTempPin, nowIso) && (await verifyPin(pin, state.ownerTempPin.pinHash))) {
            ok = true
            usedTempPin = true
          }
        } else {
          const user = state.appUsers.find((u) => u.id === id && u.active)
          if (!user) throw new Error('مستخدم غير موجود أو معطل')
          if (await verifyPin(pin, user.pinHash)) ok = true
        }
        if (!ok) {
          const guard = registerFailure(state.loginGuard, nowIso)
          set({ loginGuard: guard })
          throw new Error(guard.lockedUntil
            ? `رقم سري خاطئ — قُفل الدخول ${lockoutMinutesLeft(guard, nowIso)} دقائق`
            : 'رقم سري خاطئ')
        }
        const userName = id == null ? 'المالك' : (state.appUsers.find((u) => u.id === id)?.nameAr ?? '؟')
        set({
          currentUserId: id,
          loggedOut: false,
          loginGuard: EMPTY_GUARD,
          // الرقم المؤقت يُحرق فور استخدامه (استخدام واحد)
          ...(usedTempPin ? { ownerTempPin: null } : {}),
          auditLog: appendAudit(state.auditLog, [{ at: nowIso, user: userName, kind: 'auth', title: usedTempPin ? 'دخول المالك برقم مؤقت (استعادة تليجرام)' : `تسجيل دخول «${userName}»` }]),
        })
        return { usedTempPin }
      },
      logout: () => {
        const state = get()
        const activeUser = state.appUsers.find((u) => u.id === state.currentUserId)
        set({
          loggedOut: true,
          auditLog: appendAudit(state.auditLog, [{ at: new Date().toISOString(), user: activeUser?.nameAr ?? 'المالك', kind: 'auth', title: `تسجيل خروج «${activeUser?.nameAr ?? 'المالك'}»` }]),
        })
      },
      requestPinReset: (userId) => {
        const state = get()
        const user = state.appUsers.find((u) => u.id === userId && u.active)
        const errors = validateResetRequest(state.pinResetRequests, userId, !!user)
        if (errors.length) throw new Error(errors.join(' — '))
        const req: PinResetRequest = {
          id: nextId(state.pinResetRequests),
          userId,
          nameAr: user!.nameAr,
          requestedAt: new Date().toISOString(),
          status: 'open',
          resolvedAt: null,
        }
        set({
          pinResetRequests: [...state.pinResetRequests, req],
          auditLog: appendAudit(state.auditLog, [{ at: req.requestedAt, user: user!.nameAr, kind: 'auth', title: `طلب استعادة رقم سري من «${user!.nameAr}»` }]),
        })
      },
      resolvePinReset: (requestId, action, newPinHash) => {
        const state = get()
        const req = state.pinResetRequests.find((r) => r.id === requestId)
        if (!req) throw new Error('الطلب غير موجود')
        if (req.status !== 'open') throw new Error('الطلب محسوم بالفعل')
        if (action === 'done') {
          if (!newPinHash) throw new Error('عيّن الرقم السري الجديد أولاً')
          const user = state.appUsers.find((u) => u.id === req.userId)
          if (!user) throw new Error('المستخدم غير موجود')
          set({
            appUsers: state.appUsers.map((u) => (u.id === req.userId ? { ...u, pinHash: newPinHash } : u)),
            pinResetRequests: state.pinResetRequests.map((r) => (r.id === requestId ? { ...r, status: 'done' as const, resolvedAt: new Date().toISOString() } : r)),
            auditLog: appendAudit(state.auditLog, [{ at: new Date().toISOString(), user: 'المالك', kind: 'auth', title: `أعاد المالك تعيين الرقم السري لـ«${req.nameAr}»` }]),
          })
        } else {
          set({ pinResetRequests: state.pinResetRequests.map((r) => (r.id === requestId ? { ...r, status: 'cancelled' as const, resolvedAt: new Date().toISOString() } : r)) })
        }
      },
      setOwnerTempPin: (t) => set({ ownerTempPin: t }),
      reportIssue: (input) => {
        const state = get()
        const errors = validateIssue(input)
        if (errors.length) throw new Error(errors.join(' — '))
        const activeUser = state.appUsers.find((u) => u.id === state.currentUserId)
        const issue: IssueReport = {
          id: nextId(state.issues),
          title: sanitizeText(input.title, 120),
          details: sanitizeText(input.details, 2000),
          refKey: sanitizeText(input.refKey, 60),
          status: 'open',
          reportedBy: activeUser?.nameAr ?? 'المالك',
          reportedAt: new Date().toISOString(),
        }
        set({ issues: [...state.issues, issue] })
        return issue
      },
      setIssueStatus: (id, status, resolution) => {
        const state = get()
        const issue = state.issues.find((i) => i.id === id)
        if (!issue) throw new Error('البلاغ غير موجود')
        const activeUser = state.appUsers.find((u) => u.id === state.currentUserId)
        set({
          issues: state.issues.map((i) => (i.id === id
            ? {
                ...i, status,
                ...(status === 'resolved'
                  ? { resolvedBy: activeUser?.nameAr ?? 'المالك', resolvedAt: new Date().toISOString(), resolution: sanitizeText(resolution ?? '', 500) }
                  : {}),
              }
            : i)),
        })
      },

      addWarehouse: (nameAr) =>
        set((s) => ({ warehouses: [...s.warehouses, { id: nextId(s.warehouses), nameAr, isMain: false }] })),

      addTreasury: (nameAr, kind, extra) => {
        const state = get()
        const errors = validateTreasury(nameAr, state.treasuries)
        if (errors.length) throw new Error(errors.join(' — '))
        const t: TreasuryDef = { code: nextTreasuryCode(state.treasuries), nameAr: nameAr.trim(), kind, ...extra }
        set({ treasuries: [...state.treasuries, t] })
        return t
      },

      renameTreasury: (code, nameAr, extra) => {
        const state = get()
        const errors = validateTreasury(nameAr, state.treasuries, code)
        if (errors.length) throw new Error(errors.join(' — '))
        set({ treasuries: state.treasuries.map((t) => (t.code === code ? { ...t, ...extra, nameAr: nameAr.trim() } : t)) })
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
        // توزيع الخصومات على الجزاءات المسجلة — الأقدم أولاً (تتبع الجزاء كامل/جزء/تأجيل)
        // الفائض عن المسجل = خصم مباشر لهذا الشهر (غياب/تأخير لحظي) — مسموح بلا سجل
        let employeeDeductions = state.employeeDeductions
        for (const l of computed) {
          let toRecover = l.deductionsMinor
          if (toRecover <= 0) continue
          employeeDeductions = employeeDeductions.map((d) => {
            if (d.employeeId !== l.employeeId || toRecover <= 0) return d
            const open = d.amountMinor - d.recoveredMinor
            if (open <= 0) return d
            const take = Math.min(open, toRecover)
            toRecover -= take
            return { ...d, recoveredMinor: d.recoveredMinor + take }
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
        set({ payrollRuns: [...state.payrollRuns, run], journal: [...state.journal, entry], employeeAdvances, employeeDeductions, custodyTxs })
        return run
      },

      getEmployeeAdvanceBalance: (employeeId) => {
        const advances = get().employeeAdvances.filter((a) => a.employeeId === employeeId)
        const totalMinor = advances.reduce((s2, a) => s2 + a.amountMinor, 0)
        const remainingMinor = advances.reduce((s2, a) => s2 + (a.amountMinor - a.recoveredMinor), 0)
        return { totalMinor, remainingMinor, advances }
      },

      addEmployeeDeduction: (args) => {
        const state = get()
        const emp = state.employees.find((e) => e.id === args.employeeId)
        if (!emp) throw new Error('الموظف غير موجود')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ الخصم يجب أن يكون موجباً')
        if (!args.reason.trim()) throw new Error('سبب الخصم مطلوب — غياب، تأخير، جزاء…')
        const id = nextId(state.employeeDeductions)
        const ded: EmployeeDeduction = {
          id, dedNumber: `DED-${String(id).padStart(4, '0')}`, employeeId: args.employeeId,
          date: new Date().toISOString(), amountMinor: args.amountMinor, recoveredMinor: 0,
          reason: args.reason.trim(), notes: args.notes?.trim() ?? '',
        }
        // لا قيد الآن — الخصم يتحقق محاسبياً عند المسير (يخفض 5102 بطريقة صافي التكلفة)
        set({ employeeDeductions: [...state.employeeDeductions, ded] })
        return ded
      },

      getEmployeeDeductionBalance: (employeeId) => {
        const deductions = get().employeeDeductions.filter((d) => d.employeeId === employeeId)
        const totalMinor = deductions.reduce((s2, d) => s2 + d.amountMinor, 0)
        const remainingMinor = deductions.reduce((s2, d) => s2 + (d.amountMinor - d.recoveredMinor), 0)
        return { totalMinor, remainingMinor, deductions }
      },

      repayEmployeeAdvance: (args) => {
        const state = get()
        const emp = state.employees.find((e) => e.id === args.employeeId)
        if (!emp) throw new Error('الموظف غير موجود')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('المبلغ يجب أن يكون موجباً')
        const remaining = state.employeeAdvances
          .filter((a) => a.employeeId === args.employeeId)
          .reduce((s2, a) => s2 + (a.amountMinor - a.recoveredMinor), 0)
        if (args.amountMinor > remaining) throw new Error(`المبلغ أكبر من متبقي سلف الموظف (${remaining})`)
        const id = nextId(state.advanceRepayments)
        const repayNumber = `ADR-${String(id).padStart(4, '0')}`
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `سداد نقدي لسلفة — ${emp.nameAr} (${repayNumber})`,
          sourceType: 'receipt_voucher', sourceId: id,
          lines: [
            { accountCode: args.treasury, debit: args.amountMinor, credit: 0, note: 'نقدية واردة' },
            { accountCode: '1107', debit: 0, credit: args.amountMinor, note: `سداد سلفة ${emp.nameAr}` },
          ],
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        // توزيع السداد على السلف الأقدم أولاً (نفس منهج المسير)
        let toRecover = args.amountMinor
        const employeeAdvances = state.employeeAdvances.map((a) => {
          if (a.employeeId !== args.employeeId || toRecover <= 0) return a
          const open = a.amountMinor - a.recoveredMinor
          if (open <= 0) return a
          const take = Math.min(open, toRecover)
          toRecover -= take
          return { ...a, recoveredMinor: a.recoveredMinor + take }
        })
        const repayment: AdvanceRepayment = { id, repayNumber, employeeId: args.employeeId, date: now, amountMinor: args.amountMinor, treasury: args.treasury, journalEntryId: entryId }
        set({ advanceRepayments: [...state.advanceRepayments, repayment], employeeAdvances, journal: [...state.journal, entry] })
        return repayment
      },

      closeFiscalYear: (fy, allYears) => {
        const state = get()
        // ① تحققات الإقفال (منتهية فعلاً + بالترتيب الزمني)
        const errors = validateYearClose(fy, allYears, new Date().toISOString().slice(0, 10))
        if (errors.length) throw new Error(errors.join(' — '))
        // ② لا يُقفل مرتين: قيد إقفال سابق لنفس السنة؟
        if (state.journal.some((e) => e.sourceType === 'year_closing' && e.sourceId === fy.id)) {
          throw new Error(`السنة «${fy.nameAr}» عليها قيد إقفال بالفعل`)
        }
        // ③ بناء قيد الإقفال من اليومية (يستثني قيود إقفال سابقة تلقائياً — لا 4xxx/5xxx فيها أصلاً غير مصفَّرة)
        const result = buildYearClosingLines(state.journal.filter((e) => e.sourceType !== 'year_closing'), fy)
        if (result.lines.length === 0) throw new Error('لا حركة إيرادات أو مصروفات في هذه السنة — لا شيء يُقفل')
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId,
          date: fy.endDate, // قيد الإقفال بتاريخ آخر يوم في السنة (المنهجية العالمية)
          description: `إقفال السنة المالية «${fy.nameAr}» — صافي ${result.netProfitMinor >= 0 ? 'ربح' : 'خسارة'} يُرحَّل للأرباح المرحلة`,
          sourceType: 'year_closing', sourceId: fy.id,
          lines: result.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit, credit: l.credit, note: l.note })),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({ journal: [...state.journal, entry] })
        return { entryId, netProfitMinor: result.netProfitMinor }
      },

      getCustomerBalance: (customerId) => {
        const state = get()
        return statementBalance(customerStatement({
          customerId,
          openingMinor: state.openingBalances[`customer:${customerId}`] ?? 0,
          adjustments: state.settlements.filter((st) => st.section === 'customer' && Number(st.refId) === customerId).map((st) => ({
            docLabel: `تسوية ${st.settlementNumber}`, date: st.date.slice(0, 10),
            debitMinor: st.varianceMinor > 0 ? st.varianceMinor : 0,
            creditMinor: st.varianceMinor < 0 ? -st.varianceMinor : 0,
          })),
          sales: state.sales, saleReturns: state.saleReturns, allSales: state.sales,
          vouchers: [
            ...state.vouchers,
            ...state.clientSettlements.map((st) => ({ voucherNumber: st.settlementNumber, kind: 'receipt', date: st.date, partyKind: 'customer', partyId: st.customerId, amountMinor: st.amountMinor })),
          ],
          cheques: state.cheques,
          extraDocs: customerUnitDocs({
            customerId,
            trips: state.trips, tickets: state.tickets, rentals: state.rentalContracts,
            clinicVisits: state.clinicVisits, clinicCollections: state.clinicCollections,
            linkedPatientIds: state.clinicPatients.filter((p) => p.linkedCustomerId === customerId).map((p) => p.id),
            labOrders: state.labOrders, linkedLabPatientIds: state.labPatients.filter((p) => p.linkedCustomerId === customerId).map((p) => p.id),
            walletOps: state.walletOps,
            projectExtracts: state.projectExtracts, linkedProjectIds: state.projects.filter((p) => p.clientId === customerId).map((p) => p.id),
            installmentPlans: state.installmentPlans,
          }),
        }))
      },

      getSupplierBalance: (supplierId) => {
        const state = get()
        return statementBalance(supplierStatement({
          supplierId,
          openingMinor: state.openingBalances[`supplier:${supplierId}`] ?? 0,
          purchases: state.purchases, purchaseReturns: state.purchaseReturns, allPurchases: state.purchases,
          vouchers: state.vouchers, cheques: state.cheques,
          adjustments: state.settlements.filter((st) => st.section === 'supplier' && Number(st.refId) === supplierId).map((st) => ({
            docLabel: `تسوية ${st.settlementNumber}`, date: st.date.slice(0, 10),
            debitMinor: st.varianceMinor < 0 ? -st.varianceMinor : 0,
            creditMinor: st.varianceMinor > 0 ? st.varianceMinor : 0,
          })),
        }))
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

        // 2) قيد إثبات هامش التقسيط إن وُجد (الأمر 22): من ح/ العملاء إلى ح/ 4111 —
        // ذمة العميل ترتفع بالهامش (الأصل أثبتته فاتورة البيع الآجلة) وربح التقسيط يدخل قائمة الدخل
        const interestMinor = args.interestMinor ?? 0
        if (!Number.isInteger(interestMinor) || interestMinor < 0) throw new Error('هامش التقسيط لا يكون سالباً')
        if (interestMinor >= args.totalMinor) throw new Error('هامش التقسيط يجب أن يكون أقل من إجمالي الخطة')
        let interestEntryId: number | null = null
        let downPaymentEntryId: number | null = null
        const journal = [...state.journal]
        if (interestMinor > 0) {
          const entryId = nextId(journal)
          journal.push({
            id: entryId,
            entryNumber: entryId,
            date: now.slice(0, 10),
            description: `إثبات هامش تقسيط ${planNumber} — ${customerName}`,
            sourceType: 'receipt_voucher',
            sourceId: planId,
            lines: [
              { accountCode: '1104', debit: interestMinor, credit: 0, note: `هامش تقسيط ${planNumber} على العميل` },
              { accountCode: '4111', debit: 0, credit: interestMinor, note: 'أرباح تقسيط (هامش تمويل)' },
            ],
            createdBy: 'المالك',
            createdAt: now,
            reversedByEntryId: null,
            reversesEntryId: null,
          })
          interestEntryId = entryId
        }
        if (args.downPaymentMinor > 0) {
          const entryId = nextId(journal)
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
          interestMinor,
          interestEntryId,
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
        // مصاريف العهدة (إصلاح المالك): تتطلب ملف عهدة مفتوحاً برصيد كافٍ
        const custodyTotal = args.input.expenses
          .filter((e) => e.source === 'custody')
          .reduce((a, e) => a + Math.round(e.unitAmountMinor * e.qty), 0)
        let custodyFile: CustodyFile | undefined
        if (custodyTotal > 0) {
          custodyFile = state.custodyFiles.find((f) => f.id === args.custodyFileId)
          if (!custodyFile) errors.push('اختر ملف العهدة الذي تُصرف منه مصاريف النقلة')
          else if (custodyFile.status !== 'open') errors.push('ملف العهدة مغلق')
          else {
            const remaining = summarizeCustody(state.custodyTxs.filter((t) => t.fileId === custodyFile!.id)).remainingMinor
            if (custodyTotal > remaining) errors.push(`مصاريف العهدة (${custodyTotal}) تتجاوز متبقي الملف (${remaining})`)
          }
        }
        // التحصيل الجزئي: يتطلب عميلاً مسجلاً إن بقي دين
        const totalsProbe = computeTripTotals(args.input)
        if (args.paidMinor != null) {
          if (!Number.isInteger(args.paidMinor) || args.paidMinor < 0 || args.paidMinor > totalsProbe.grandMinor) errors.push('المحصَّل الآن بين صفر وإجمالي النقلة')
          else if (args.paidMinor < totalsProbe.grandMinor && args.customerId == null) errors.push('التحصيل الجزئي يترك ديناً — يتطلب عميلاً مسجلاً')
        }
        if (errors.length) throw new Error(errors.join(' — '))

        // 2) الإجماليات والقيد بالنواة الخالصة
        const totals = totalsProbe
        const tripId = nextId(state.trips)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const tripNumber = `TR-${String(tripId).padStart(4, '0')}`
        const entryLines = buildTripEntry(totals, args.input.payment, tripNumber, args.treasury ?? '1101', args.paidMinor)

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
          paidMinor: args.paidMinor,
          custodyFileId: custodyTotal > 0 ? (custodyFile?.id ?? null) : null,
          totals,
          journalEntryId: entryId,
          notes: args.notes,
        }

        // عمولة السائق: استحقاق (2111) يتجمع حتى التسوية — لا نقدية الآن
        let newJournal = [...state.journal, entry]
        let newDues = state.driverDues
        const commission = args.driverCommissionMinor ?? 0
        if (commission > 0) {
          if (args.driverId == null) throw new Error('عمولة السائق تتطلب اختيار سائق')
          const driver = state.employees.find((e) => e.id === args.driverId)
          const commEntryId = entryId + 1
          const commLines = buildDriverCommissionEntry(commission, driver?.nameAr ?? 'سائق', trip.tripNumber)
          const commEntry: JournalEntry = {
            id: commEntryId, entryNumber: commEntryId, date: now.slice(0, 10),
            description: `استحقاق عمولة سائق ${driver?.nameAr ?? ''} — ${trip.tripNumber}`,
            sourceType: 'driver_settlement', sourceId: trip.id, lines: commLines,
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }
          newJournal = [...newJournal, commEntry]
          newDues = [...newDues, {
            id: nextId(state.driverDues), driverId: args.driverId, tripId: trip.id,
            date: now.slice(0, 10), amountMinor: commission, settled: false, settlementEntryId: null, entryId: commEntryId,
          }]
        }
        // مصاريف العهدة تدخل ملف العهدة كحركة مصروف (تظهر بملف الموظف وتخصم من متبقيه)
        let newCustodyTxs = state.custodyTxs
        if (custodyTotal > 0 && custodyFile) {
          newCustodyTxs = [...newCustodyTxs, {
            id: nextId(state.custodyTxs), fileId: custodyFile.id, type: 'expense' as const,
            date: now.slice(0, 10), amountMinor: custodyTotal, excessMinor: 0,
            description: `مصاريف نقلة ${tripNumber}`, treasury: null, projectId: null, purchaseId: null,
            journalEntryId: entryId,
          }]
        }
        set({ trips: [...state.trips, trip], journal: newJournal, driverDues: newDues, custodyTxs: newCustodyTxs })
        return trip
      },
      getDriverDueBalance: (driverId) => {
        return get().driverDues.filter((d) => d.driverId === driverId && !d.settled).reduce((s2, d) => s2 + d.amountMinor, 0)
      },
      settleDriverDues: (driverId, treasury = '1101') => {
        const state = get()
        const driver = state.employees.find((e) => e.id === driverId)
        if (!driver) throw new Error('السائق غير مسجل')
        const unsettled = state.driverDues.filter((d) => d.driverId === driverId && !d.settled)
        const total = unsettled.reduce((s2, d) => s2 + d.amountMinor, 0)
        const lines = buildDriverSettlementEntry(total, driver.nameAr, treasury) // يرمي لو صفر
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تسوية مستحقات السائق ${driver.nameAr} (${unsettled.length} رحلة)`,
          sourceType: 'driver_settlement', sourceId: driverId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          driverDues: state.driverDues.map((d) => (d.driverId === driverId && !d.settled ? { ...d, settled: true, settlementEntryId: entryId } : d)),
          journal: [...state.journal, entry],
        })
        return { total, count: unsettled.length }
      },

      /* ─── جهات التأمين والتعاقد (صيدلية/معمل) ─── */
      addInsuranceProvider: (args) => {
        const state = get()
        const errors = validateProvider(args.nameAr, args.coveragePercent, state.insuranceProviders)
        if (errors.length) throw new Error(errors.join('، '))
        const provider: InsuranceProvider = {
          id: nextId(state.insuranceProviders), nameAr: args.nameAr.trim(),
          coveragePercent: args.coveragePercent, phone: args.phone ?? '', notes: args.notes ?? '', isActive: true,
        }
        set({ insuranceProviders: [...state.insuranceProviders, provider] })
        return provider
      },
      updateInsuranceProvider: (id, args) => {
        const state = get()
        if (!state.insuranceProviders.some((p) => p.id === id)) throw new Error('الجهة غير موجودة')
        const errors = validateProvider(args.nameAr, args.coveragePercent, state.insuranceProviders, id)
        if (errors.length) throw new Error(errors.join('، '))
        set({ insuranceProviders: state.insuranceProviders.map((p) => (p.id === id ? { ...p, nameAr: args.nameAr.trim(), coveragePercent: args.coveragePercent, phone: args.phone ?? p.phone, notes: args.notes ?? p.notes } : p)) })
      },
      toggleInsuranceProvider: (id) => set((s) => ({ insuranceProviders: s.insuranceProviders.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)) })),
      postInsuredSale: (args) => {
        const state = get()
        const provider = state.insuranceProviders.find((p) => p.id === args.providerId && p.isActive)
        if (!provider) throw new Error('جهة التأمين غير موجودة أو معطلة')
        if (!args.lines.length) throw new Error('لا أصناف')
        // فحص المخزون
        const qtyByItem = new Map<number, number>()
        for (const l of args.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty)
        for (const [itemId, qty] of qtyByItem) {
          const it = state.items.find((x) => x.id === itemId)
          if (!it) throw new Error('صنف غير موجود')
          if ((it.stockQty ?? 0) < qty) throw new Error(`مخزون غير كافٍ — «${it.nameAr}»`)
        }
        const totals = computeTotals(args.lines, 0, args.taxPercent, args.taxInclusive)
        const { providerShareMinor, patientShareMinor } = splitCoverage(totals.totalMinor, provider.coveragePercent)
        const lines = buildInsuredEntry({
          patientShareMinor, providerShareMinor, revenueMinor: totals.taxBaseMinor,
          revenueAccount: '4101', vatMinor: totals.taxMinor, cogsMinor: totals.cogsMinor,
          treasury: args.treasury ?? '1101', providerName: provider.nameAr,
        })
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const claimId = nextId(state.insuranceClaims)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `بيع بتغطية ${provider.nameAr} (${provider.coveragePercent}٪)`,
          sourceType: 'insured_sale', sourceId: claimId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const claim: InsuranceClaim = {
          id: claimId, providerId: provider.id, source: 'sale', sourceId: entryId,
          date: now.slice(0, 10), totalMinor: totals.totalMinor, claimMinor: providerShareMinor,
          settled: false, settlementEntryId: null,
        }
        const updatedItems = state.items.map((it) =>
          qtyByItem.has(it.id) ? { ...it, stockQty: Math.round(((it.stockQty ?? 0) - qtyByItem.get(it.id)!) * 1000) / 1000 } : it,
        )
        set({ items: updatedItems, insuranceClaims: [...state.insuranceClaims, claim], journal: [...state.journal, entry] })
        return { patientShareMinor, providerShareMinor }
      },
      registerInsuredLabOrder: (args) => {
        const state = get()
        const provider = state.insuranceProviders.find((p) => p.id === args.providerId && p.isActive)
        if (!provider) throw new Error('جهة التأمين غير موجودة أو معطلة')
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
        const totals = computeLabTotals(chosen.map((t) => t.priceMinor), 0, args.vatPercent)
        const { providerShareMinor, patientShareMinor } = splitCoverage(totals.totalMinor, provider.coveragePercent)
        const now = new Date().toISOString()
        const orderId = nextId(state.labOrders)
        const orderNumber = `LAB-${String(orderId).padStart(4, '0')}`
        const entryLines = buildInsuredEntry({
          patientShareMinor, providerShareMinor, revenueMinor: totals.netMinor,
          revenueAccount: '4106', vatMinor: totals.vatMinor, cogsMinor: 0,
          treasury: args.treasury ?? '1101', providerName: provider.nameAr,
        })
        let journal = state.journal
        const entryId = nextId(journal)
        journal = [...journal, {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `طلب تحاليل ${orderNumber} — ${patient.nameAr} بتغطية ${provider.nameAr}`,
          sourceType: 'insured_sale', sourceId: orderId, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }]
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
          payment: 'credit', discountPercent: 0,
          tests: orderTests, totals,
          journalEntryId: entryId,
          commissionMinor, commissionEntryId, commissionPaid: false, commissionPayoutEntryId: null,
          notes: `${args.notes ?? ''} [تغطية ${provider.nameAr} ${provider.coveragePercent}٪]`.trim(),
        }
        const claim: InsuranceClaim = {
          id: nextId(state.insuranceClaims), providerId: provider.id, source: 'lab_order', sourceId: orderId,
          date: now.slice(0, 10), totalMinor: totals.totalMinor, claimMinor: providerShareMinor,
          settled: false, settlementEntryId: null,
        }
        set({ labOrders: [...state.labOrders, order], insuranceClaims: [...state.insuranceClaims, claim], journal })
        return order
      },
      getClaimBalance: (providerId) => {
        return get().insuranceClaims.filter((c) => c.providerId === providerId && !c.settled).reduce((s2, c) => s2 + c.claimMinor, 0)
      },
      settleInsuranceClaims: (providerId, treasury = '1101') => {
        const state = get()
        const provider = state.insuranceProviders.find((p) => p.id === providerId)
        if (!provider) throw new Error('الجهة غير موجودة')
        const unsettled = state.insuranceClaims.filter((c) => c.providerId === providerId && !c.settled)
        const total = unsettled.reduce((s2, c) => s2 + c.claimMinor, 0)
        const lines = buildClaimSettlementEntry(total, provider.nameAr, treasury) // يرمي لو صفر
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تحصيل مطالبات ${provider.nameAr} (${unsettled.length} مطالبة)`,
          sourceType: 'claim_settlement', sourceId: providerId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          insuranceClaims: state.insuranceClaims.map((c) => (c.providerId === providerId && !c.settled ? { ...c, settled: true, settlementEntryId: entryId } : c)),
          journal: [...state.journal, entry],
        })
        return { total, count: unsettled.length }
      },

      /* ─── مصفوفة المتغيرات لون×مقاس (ملابس) ─── */
      setVariantStock: (itemId, color, size, qty) => {
        const state = get()
        const item = state.items.find((it) => it.id === itemId)
        if (!item) throw new Error('الصنف غير موجود')
        const errors = validateVariantAssignment({
          color, size, qty,
          itemColors: item.variantColors, itemSizes: item.variantSizes,
          itemStockQty: item.stockQty ?? 0, currentStocks: state.variantStocks, itemId,
        })
        if (errors.length) throw new Error(errors.join('، '))
        const key = variantKey(color, size)
        const rest = state.variantStocks.filter((v) => !(v.itemId === itemId && variantKey(v.color, v.size) === key))
        const next = qty > 0 ? [...rest, { itemId, color: color.trim(), size: size.trim(), qty }] : rest
        set({ variantStocks: next })
      },
      getUndistributedQty: (itemId) => {
        const state = get()
        const item = state.items.find((it) => it.id === itemId)
        if (!item) throw new Error('الصنف غير موجود')
        return undistributedQty(item.stockQty ?? 0, state.variantStocks, itemId)
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
      addEquipmentCost: (args) => {
        const state = get()
        const eq = state.equipment.find((e) => e.id === args.equipmentId)
        if (!eq) throw new Error('المعدة غير موجودة')
        if (!(args.amountMinor > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر')
        const treasury = args.treasury ?? '1101'
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const costId = nextId(state.equipmentCosts)
        const label = EQUIPMENT_COST_LABELS[args.kind]
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `${label} — ${eq.nameAr}${args.description ? ` (${args.description})` : ''}`,
          sourceType: 'equipment_cost', sourceId: costId,
          lines: [
            { accountCode: '5105', debit: args.amountMinor, credit: 0, note: `${label} ${eq.nameAr}` },
            { accountCode: treasury, debit: 0, credit: args.amountMinor, note: 'دفع مصروف تشغيل' },
          ],
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cost: EquipmentCost = {
          id: costId, equipmentId: args.equipmentId, date: now.slice(0, 10), kind: args.kind,
          amountMinor: args.amountMinor, description: args.description ?? '', treasury, journalEntryId: entryId,
        }
        set({ equipmentCosts: [...state.equipmentCosts, cost], journal: [...state.journal, entry] })
        return cost
      },
      getEquipmentProfit: (equipmentId) => {
        const state = get()
        if (!state.equipment.some((e) => e.id === equipmentId)) throw new Error('المعدة غير موجودة')
        let rent = 0, extra = 0, contractHours = 0
        for (const c of state.rentalContracts) {
          if (c.equipmentId !== equipmentId) continue
          rent += c.totals.rentMinor
          extra += c.extraMinor
          if (c.rateType === 'hourly' && c.startReading != null && c.endReading != null && c.endReading > c.startReading) {
            contractHours += usageHours(c.startReading, c.endReading)
          }
        }
        const costs = state.equipmentCosts.filter((c) => c.equipmentId === equipmentId).reduce((s2, c) => s2 + c.amountMinor, 0)
        const sh = shiftsSummary(state.operatorShifts, equipmentId)
        return equipmentProfitability({ rentMinor: rent, extraMinor: extra, costsMinor: costs, contractHours, shiftHours: sh.totalHours })
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
      updateLabPatient: (id, patch) => {
        set((s2) => ({ labPatients: s2.labPatients.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
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
        // الربط بالعميل إداري بحت (أمر التعديل): يُتحقق من وجوده فقط — لا قيد ولا ذمة
        if (p.clientId != null && !state.customers.find((c) => c.id === p.clientId)) throw new Error('العميل المربوط غير موجود')
        if (p.managerEmployeeId != null && !state.employees.find((e) => e.id === p.managerEmployeeId)) throw new Error('مدير المشروع غير موجود في سجل الموظفين')
        const id = nextId(state.projects)
        const project: Project = { ...p, clientId: p.clientId ?? null, id, code: `PRJ-${String(id).padStart(4, '0')}`, status: 'active' }
        set({ projects: [...state.projects, project] })
        return project
      },

      addQuotation: (q) => {
        const state = get()
        // بنود كاملة: اسم + وصف + كمية + وحدة + سعر + تكلفة تقديرية (أمر التعديل)
        const fullLines: QuotationLine[] = q.lines.map((l) => ({
          nameAr: (l.nameAr ?? '').trim() || l.descriptionAr.trim().slice(0, 40),
          descriptionAr: l.descriptionAr,
          qty: l.qty,
          unitAr: l.unitAr,
          unitPriceMinor: l.unitPriceMinor,
          estCostMinor: Number.isInteger(l.estCostMinor) && (l.estCostMinor ?? 0) >= 0 ? (l.estCostMinor as number) : 0,
        }))
        const errors = validateQuotation({ ...q, lines: fullLines })
        if (errors.length) throw new Error(errors.join(' — '))
        // ربط العميل إداري — لا أثر على رصيده المحاسبي إطلاقاً
        if (q.clientId != null && !state.customers.find((c) => c.id === q.clientId)) throw new Error('العميل المربوط غير موجود')
        const id = nextId(state.quotations)
        const quote: Quotation = {
          id,
          quoteNumber: `${q.kind === 'tender' ? 'TN' : 'QT'}-${String(id).padStart(4, '0')}`,
          kind: q.kind,
          clientName: q.clientName.trim(),
          clientId: q.clientId ?? null,
          titleAr: q.titleAr.trim(),
          date: new Date().toISOString().slice(0, 10),
          validUntil: q.validUntil,
          lines: fullLines.filter((l) => l.descriptionAr.trim() && l.qty > 0),
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
        // بوابة الموافقات (أمر التعديل): مسار نشط ⇒ يتطلب اعتماداً مكتملاً غير مستهلك
        get().assertApproved('quotation_to_project', q.id, `تحويل ${q.quoteNumber} إلى مشروع`)
        const project = get().addProject({
          nameAr: q.titleAr,
          clientName: q.clientName,
          clientId: q.clientId ?? null, // الربط الإداري ينتقل مع التحويل — بلا أي أثر مالي
          contractValueMinor: quotationTotal(q.lines),
          retentionPercent,
          startDate: new Date().toISOString().slice(0, 10),
          notes: `متولد من ${q.quoteNumber}`,
        })
        // تحويل بضغطة: كل بنود العرض تنتقل جدولَ كميات للمشروع بأكوادها وتكاليفها التقديرية
        const startBoqId = nextId(get().boqItems)
        const boq: BoqItem[] = q.lines.map((l, i) => ({
          id: startBoqId + i,
          projectId: project.id,
          code: String(i + 1),
          descriptionAr: l.nameAr && l.nameAr !== l.descriptionAr ? `${l.nameAr} — ${l.descriptionAr}` : l.descriptionAr,
          unit: l.unitAr,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          estCostMinor: l.estCostMinor,
          progressPercent: 0,
        }))
        set((s) => ({
          quotations: s.quotations.map((x) => (x.id === id ? { ...x, projectId: project.id } : x)),
          boqItems: [...s.boqItems, ...boq],
        }))
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
        // بوابة الموافقات: إصدار مستخلص العميل إجراء حرج (أمر التعديل)
        get().assertApproved('project_extract', project.id, `مستخلص جديد — ${project.nameAr}`)
        const totals = computeExtractTotals(args.grossMinor, project.retentionPercent, args.vatPercent)
        const id = nextId(state.projectExtracts)
        const extractNumber = `PRX-${String(id).padStart(4, '0')}`
        // استرداد الدفعة المقدمة (اختياري): يخصم من مستحق المستخلص ويطفئ 2109
        const recovery = args.advanceRecoveryMinor ?? 0
        if (recovery > 0) {
          const advBalance = state.clientAdvances.filter((a) => a.projectId === project.id).reduce((sum, a) => sum + a.amountMinor - a.recoveredMinor, 0)
          if (recovery > advBalance) throw new Error(`الاسترداد أكبر من رصيد الدفعات المقدمة (${advBalance})`)
        }
        const lines = recovery > 0
          ? buildExtractEntryWithAdvance(totals, args.payment, extractNumber, args.treasury ?? '1101', recovery)
          : buildExtractEntry(totals, args.payment, extractNumber, args.treasury ?? '1101')
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
        // استهلاك الدفعات المقدمة FIFO (الأقدم أولاً)
        let toRecover = recovery
        const updatedAdvances = state.clientAdvances.map((a) => {
          if (toRecover <= 0 || a.projectId !== project.id) return a
          const room = a.amountMinor - a.recoveredMinor
          const take = Math.min(room, toRecover)
          toRecover -= take
          return take > 0 ? { ...a, recoveredMinor: a.recoveredMinor + take } : a
        })
        set({ projectExtracts: [...state.projectExtracts, extract], clientAdvances: updatedAdvances, journal: [...state.journal, entry] })
        return extract
      },
      addProjectCost: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        if (project.status === 'completed') throw new Error('المشروع مقفل — لا تكاليف جديدة عليه')
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

      /* ─── عمق المقاولات: BOQ وأوامر التغيير والدفعات المقدمة والباطن والضمانات واليوميات ─── */
      addBoqItem: (args) => {
        const state = get()
        if (!state.projects.find((p) => p.id === args.projectId)) throw new Error('المشروع غير موجود')
        const errors = validateBoqItem(args)
        const estCost = args.estCostMinor ?? 0
        if (!Number.isInteger(estCost) || estCost < 0) errors.push('التكلفة التقديرية غير صحيحة')
        if (errors.length) throw new Error(errors.join(' — '))
        const item: BoqItem = { ...args, estCostMinor: estCost, id: nextId(state.boqItems), progressPercent: 0 }
        set({ boqItems: [...state.boqItems, item] })
        return item
      },
      updateBoqProgress: (id, progressPercent) => {
        if (progressPercent < 0 || progressPercent > 100) throw new Error('نسبة الإنجاز بين 0 و100')
        set((s) => ({ boqItems: s.boqItems.map((b) => (b.id === id ? { ...b, progressPercent } : b)) }))
      },
      removeBoqItem: (id) => set((s) => ({ boqItems: s.boqItems.filter((b) => b.id !== id) })),

      addChangeOrder: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        if (project.status === 'completed') throw new Error('المشروع مقفل — لا أوامر تغيير')
        if (!args.titleAr.trim()) throw new Error('عنوان أمر التغيير مطلوب')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor === 0) throw new Error('قيمة أمر التغيير لا تكون صفراً')
        const id = nextId(state.changeOrders)
        const order: ChangeOrder = {
          id, projectId: args.projectId, number: `CO-${String(id).padStart(4, '0')}`,
          titleAr: args.titleAr.trim(), amountMinor: args.amountMinor,
          status: 'draft', date: new Date().toISOString().slice(0, 10), approvedAt: null,
        }
        set({ changeOrders: [...state.changeOrders, order] })
        return order
      },
      setChangeOrderStatus: (id, status) => {
        const state = get()
        const order = state.changeOrders.find((o) => o.id === id)
        if (!order) throw new Error('أمر التغيير غير موجود')
        if (order.status !== 'draft') throw new Error('أمر التغيير محسوم بالفعل')
        // التخفيض لا يهبط بالعقد الفعلي تحت الصفر
        if (status === 'approved' && order.amountMinor < 0) {
          const project = state.projects.find((p) => p.id === order.projectId)!
          const effective = effectiveContractValue(project.contractValueMinor, state.changeOrders.filter((o) => o.projectId === order.projectId))
          if (effective + order.amountMinor < 0) throw new Error('التخفيض أكبر من قيمة العقد الفعلية')
        }
        set({
          changeOrders: state.changeOrders.map((o) =>
            o.id === id ? { ...o, status, approvedAt: status === 'approved' ? new Date().toISOString() : null } : o),
        })
      },

      receiveClientAdvance: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        if (project.status === 'completed') throw new Error('المشروع مقفل')
        const lines = buildClientAdvanceEntry(args.amountMinor, args.treasury, project.nameAr)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `دفعة مقدمة من عميل ${project.nameAr}`,
          sourceType: 'client_advance', sourceId: project.id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          clientAdvances: [...state.clientAdvances, { id: nextId(state.clientAdvances), projectId: project.id, date: now.slice(0, 10), amountMinor: args.amountMinor, recoveredMinor: 0, journalEntryId: entryId }],
          journal: [...state.journal, entry],
        })
      },
      getAdvanceBalance: (projectId) => {
        return get().clientAdvances.filter((a) => a.projectId === projectId).reduce((s, a) => s + a.amountMinor - a.recoveredMinor, 0)
      },

      addSubContract: (args) => {
        const state = get()
        if (!state.projects.find((p) => p.id === args.projectId)) throw new Error('المشروع غير موجود')
        const errors = validateSubContract(args)
        const withhold = args.taxWithholdPercent ?? 0
        if (withhold < 0 || withhold > 20) errors.push('نسبة ضريبة الاستقطاع بين 0 و20٪')
        // ربط اختياري بسجل مورد — يوحّد المستحقات في كشف حسابه (تكامل الموردين)
        if (args.supplierId != null && !state.suppliers.find((x) => x.id === args.supplierId)) errors.push('المورد المربوط غير موجود')
        const boqIds = args.boqItemIds ?? []
        for (const bid of boqIds) {
          const b = state.boqItems.find((x) => x.id === bid)
          if (!b || b.projectId !== args.projectId) errors.push(`بند BOQ رقم ${bid} ليس من بنود هذا المشروع`)
        }
        if (errors.length) throw new Error(errors.join(' — '))
        const id = nextId(state.subContracts)
        const contract: SubContract = {
          ...args, supplierId: args.supplierId ?? null, taxWithholdPercent: withhold, boqItemIds: boqIds,
          id, contractNumber: `SC-${String(id).padStart(4, '0')}`, status: 'active',
        }
        set({ subContracts: [...state.subContracts, contract] })
        return contract
      },
      addSubCertificate: (args) => {
        const state = get()
        const contract = state.subContracts.find((c) => c.id === args.contractId)
        if (!contract) throw new Error('عقد الباطن غير موجود')
        if (contract.status !== 'active') throw new Error('العقد غير نشط')
        // بوابة الموافقات: اعتماد مستخلص الباطن إجراء حرج
        get().assertApproved('sub_certificate', contract.id, `اعتماد شهادة أعمال ${contract.contractNumber}`)
        // حماية تجاوز قيمة العقد
        const certified = state.subCertificates.filter((c) => c.contractId === contract.id).reduce((s, c) => s + c.amountMinor, 0)
        if (certified + args.amountMinor > contract.contractValueMinor) {
          throw new Error(`الشهادات تتجاوز قيمة العقد (متبقٍ ${contract.contractValueMinor - certified})`)
        }
        const retention = Math.round(args.amountMinor * contract.retentionPercent / 100)
        // ضريبة الاستقطاع من نسبة العقد → التزام 2112 حتى توريدها للمصلحة
        const withhold = Math.round(args.amountMinor * contract.taxWithholdPercent / 100)
        // استرداد الدفعة المقدمة (اختياري) — لا يتجاوز رصيدها غير المسترد
        const recovery = args.advanceRecoveryMinor ?? 0
        if (recovery > 0) {
          const advBalance = get().getSubAdvanceBalance(contract.id)
          if (recovery > advBalance) throw new Error(`الاسترداد أكبر من رصيد الدفعات المقدمة (${advBalance})`)
        }
        const label = `${contract.contractNumber} — ${contract.contractorName}`
        const lines = buildSubCertificateEntry(args.amountMinor, retention, withhold, recovery, label)
        const now = new Date().toISOString()
        const id = nextId(state.subCertificates)
        const entryId = nextId(state.journal)
        const number = state.subCertificates.filter((c) => c.contractId === contract.id).length + 1
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `شهادة أعمال باطن #${number} — ${label}`,
          sourceType: 'sub_certificate', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cert: SubCertificate = {
          id, contractId: contract.id, number, date: now.slice(0, 10),
          descriptionAr: args.description, amountMinor: args.amountMinor,
          retentionMinor: retention, taxWithholdMinor: withhold, advanceRecoveryMinor: recovery,
          netMinor: args.amountMinor - retention - withhold - recovery, journalEntryId: entryId,
        }
        // إطفاء الدفعات المقدمة FIFO (الأقدم أولاً)
        let toRecover = recovery
        const updatedSubAdvances = state.subAdvances.map((a) => {
          if (toRecover <= 0 || a.contractId !== contract.id) return a
          const room = a.amountMinor - a.recoveredMinor
          const take = Math.min(room, toRecover)
          toRecover -= take
          return take > 0 ? { ...a, recoveredMinor: a.recoveredMinor + take } : a
        })
        // شهادة الباطن تكلفة مشروع أيضاً — تدخل ربحية المشروع تلقائياً
        const cost = {
          id: nextId(state.projectCosts), projectId: contract.projectId, date: now.slice(0, 10),
          kind: 'subcontract' as CostKind, description: `شهادة ${label}: ${args.description}`,
          amountMinor: args.amountMinor, payment: 'credit' as const, journalEntryId: entryId,
        }
        set({ subCertificates: [...state.subCertificates, cert], projectCosts: [...state.projectCosts, cost], subAdvances: updatedSubAdvances, journal: [...state.journal, entry] })
        return cert
      },
      paySubContractor: (args) => {
        const state = get()
        const contract = state.subContracts.find((c) => c.id === args.contractId)
        if (!contract) throw new Error('عقد الباطن غير موجود')
        // لا ندفع أكثر من صافي شهاداته غير المدفوع
        const netCertified = state.subCertificates.filter((c) => c.contractId === contract.id).reduce((s, c) => s + c.netMinor, 0)
        const paid = state.subPayments.filter((pm) => pm.contractId === contract.id && pm.kind === 'payment').reduce((s, pm) => s + pm.amountMinor, 0)
        if (args.amountMinor > netCertified - paid) throw new Error(`الدفعة أكبر من مستحقه (المتبقي ${netCertified - paid})`)
        const label = `${contract.contractNumber} — ${contract.contractorName}`
        const lines = buildSubPaymentEntry(args.amountMinor, args.treasury, label)
        const now = new Date().toISOString()
        const id = nextId(state.subPayments)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `دفعة لمقاول باطن ${label}`,
          sourceType: 'sub_payment', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({ subPayments: [...state.subPayments, { id, contractId: contract.id, date: now.slice(0, 10), amountMinor: args.amountMinor, kind: 'payment', journalEntryId: entryId }], journal: [...state.journal, entry] })
      },
      releaseSubRetention: (contractId, treasury) => {
        const state = get()
        const contract = state.subContracts.find((c) => c.id === contractId)
        if (!contract) throw new Error('عقد الباطن غير موجود')
        const held = state.subCertificates.filter((c) => c.contractId === contractId).reduce((s, c) => s + c.retentionMinor, 0)
        const released = state.subPayments.filter((pm) => pm.contractId === contractId && pm.kind === 'retention_release').reduce((s, pm) => s + pm.amountMinor, 0)
        const remaining = held - released
        const label = `${contract.contractNumber} — ${contract.contractorName}`
        const lines = buildSubRetentionReleaseEntry(remaining, treasury, label)
        const now = new Date().toISOString()
        const id = nextId(state.subPayments)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `إفراج محتجزات باطن ${label} وإقفال عقده`,
          sourceType: 'retention_release', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          subPayments: [...state.subPayments, { id, contractId, date: now.slice(0, 10), amountMinor: remaining, kind: 'retention_release', journalEntryId: entryId }],
          subContracts: state.subContracts.map((c) => (c.id === contractId ? { ...c, status: 'completed' as const } : c)),
          journal: [...state.journal, entry],
        })
        return { amount: remaining }
      },

      issueBond: (args) => {
        const state = get()
        const errors = validateBond(args)
        if (errors.length) throw new Error(errors.join(' — '))
        if (args.projectId != null && !state.projects.find((p) => p.id === args.projectId)) throw new Error('المشروع غير موجود')
        const label = `${args.bondNumber} — ${args.beneficiary}`
        const lines = buildBondIssueEntry(args.marginMinor, args.feesMinor, args.bank, label)
        const now = new Date().toISOString()
        const id = nextId(state.bonds)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `إصدار خطاب ضمان ${label}`,
          sourceType: 'bond_issue', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const bond: Bond = { ...args, id, status: 'active', issueEntryId: entryId, settleEntryId: null }
        set({ bonds: [...state.bonds, bond], journal: [...state.journal, entry] })
        return bond
      },
      settleBond: (bondId, outcome) => {
        const state = get()
        const bond = state.bonds.find((b) => b.id === bondId)
        if (!bond) throw new Error('الخطاب غير موجود')
        if (bond.status !== 'active') throw new Error('الخطاب مُسوَّى بالفعل')
        const label = `${bond.bondNumber} — ${bond.beneficiary}`
        const lines = outcome === 'released'
          ? buildBondReleaseEntry(bond.marginMinor, bond.bank, label)
          : buildBondForfeitEntry(bond.marginMinor, label)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: outcome === 'released' ? `رد خطاب ضمان ${label}` : `مصادرة خطاب ضمان ${label}`,
          sourceType: 'bond_settle', sourceId: bond.id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: Bond = { ...bond, status: outcome, settleEntryId: entryId }
        set({ bonds: state.bonds.map((b) => (b.id === bondId ? updated : b)), journal: [...state.journal, entry] })
        return updated
      },

      addDailyWorker: (args) => {
        const state = get()
        if (!args.nameAr.trim()) throw new Error('اسم العامل مطلوب')
        if (!Number.isInteger(args.dailyWageMinor) || args.dailyWageMinor <= 0) throw new Error('اليومية يجب أن تكون موجبة')
        const worker: DailyWorker = { id: nextId(state.dailyWorkers), nameAr: args.nameAr.trim(), phone: args.phone, dailyWageMinor: args.dailyWageMinor, active: true }
        set({ dailyWorkers: [...state.dailyWorkers, worker] })
        return worker
      },
      addDailyWorkRecord: (args) => {
        const state = get()
        const worker = state.dailyWorkers.find((w) => w.id === args.workerId)
        if (!worker) throw new Error('العامل غير مسجل')
        // الربط بالمشروع اختياري (أمر التعديل): null = عمالة تشغيل عام → مصروف عمومي 5108
        if (args.projectId != null) {
          const project = state.projects.find((p) => p.id === args.projectId)
          if (!project) throw new Error('المشروع غير موجود')
          if (project.status === 'completed') throw new Error('المشروع مقفل')
        }
        if (!(args.days > 0) || args.days > 31) throw new Error('عدد الأيام بين نصف يوم و31')
        const wage = args.wageMinor ?? Math.round(worker.dailyWageMinor * args.days)
        if (!Number.isInteger(wage) || wage <= 0) throw new Error('الأجر يجب أن يكون موجباً')
        const rec: DailyWorkRecord = { id: nextId(state.dailyWorkRecords), workerId: worker.id, projectId: args.projectId ?? null, date: args.date, days: args.days, wageMinor: wage, settled: false, settlementId: null }
        set({ dailyWorkRecords: [...state.dailyWorkRecords, rec] })
        return rec
      },
      settleDailyWorker: (workerId, treasury) => {
        const state = get()
        const worker = state.dailyWorkers.find((w) => w.id === workerId)
        if (!worker) throw new Error('العامل غير مسجل')
        const unsettled = state.dailyWorkRecords.filter((r) => r.workerId === workerId && !r.settled)
        const total = unsettled.reduce((s, r) => s + r.wageMinor, 0)
        // فرز تلقائي (أمر التعديل): سجل بمشروع → 5110 تكاليف مشاريع؛ بلا مشروع → 5108 تشغيل عام
        const projectTotal = unsettled.filter((r) => r.projectId != null).reduce((s, r) => s + r.wageMinor, 0)
        const overheadTotal = total - projectTotal
        const lines = buildDailyWorkSettlementEntry(projectTotal, overheadTotal, treasury, worker.nameAr) // يرمي لو صفر
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تسوية أجور يومية ${worker.nameAr} (${unsettled.length} سجل)`,
          sourceType: 'daily_wages', sourceId: workerId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        // السجلات المشروعية فقط تدخل تكاليف مشاريعها (لدقة الربحية) — التشغيل العام مصروف عمومي
        let costId = nextId(state.projectCosts)
        const byProject = new Map<number, number>()
        for (const r of unsettled) if (r.projectId != null) byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.wageMinor)
        const newCosts = [...byProject].map(([projectId, amountMinor]) => ({
          id: costId++, projectId, date: now.slice(0, 10), kind: 'labor' as CostKind,
          description: `أجور يومية ${worker.nameAr}`, amountMinor, payment: 'cash' as const, journalEntryId: entryId,
        }))
        set({
          dailyWorkRecords: state.dailyWorkRecords.map((r) => (r.workerId === workerId && !r.settled ? { ...r, settled: true, settlementId: entryId } : r)),
          projectCosts: [...state.projectCosts, ...newCosts],
          journal: [...state.journal, entry],
        })
        return { total, recordCount: unsettled.length }
      },

      /* ─── أوامر التعديل: أذون صرف مواد + تحصيلات FIFO + دفعات باطن + EVM + موافقات ─── */
      issueMaterials: (args) => {
        const state = get()
        const project = state.projects.find((p) => p.id === args.projectId)
        if (!project) throw new Error('المشروع غير موجود')
        if (project.status === 'completed') throw new Error('المشروع مقفل — لا صرف مواد عليه')
        // الصارف والمستلم إلزاميان من قاعدة الموظفين (أمر التعديل)
        const issuer = state.employees.find((e) => e.id === args.issuedByEmployeeId)
        if (!issuer) throw new Error('حدد أمين المخزن (الصارف) من سجل الموظفين')
        const receiver = state.employees.find((e) => e.id === args.receivedByEmployeeId)
        if (!receiver) throw new Error('حدد مهندس الموقع/المشرف (المستلم) من سجل الموظفين')
        if (issuer.id === receiver.id) throw new Error('الصارف والمستلم لا يكونان نفس الموظف')
        if (args.lines.length === 0) throw new Error('أضف صنفاً واحداً على الأقل')
        // بوابة الموافقات: إذن الصرف إجراء حرج
        get().assertApproved('material_requisition', project.id, `إذن صرف مواد — ${project.nameAr}`)
        // بناء السطور بالتحويل للوحدة الأساسية وفحص التوافر الصارم (لا سالب إطلاقاً)
        const planned = new Map<number, number>()
        const lines: MaterialIssueLine[] = args.lines.map((input) => {
          const item = state.items.find((it) => it.id === input.itemId)
          if (!item) throw new Error('صنف غير موجود في إذن الصرف')
          const line = buildIssueLine(input, item, planned.get(item.id) ?? 0)
          planned.set(item.id, (planned.get(item.id) ?? 0) + line.baseQty)
          return line
        })
        const totalCost = lines.reduce((sum, l) => sum + l.costMinor, 0)
        const id = nextId(state.materialRequisitions)
        const reqNumber = `MRQ-${String(id).padStart(4, '0')}`
        const entryLines = buildMaterialIssueEntry(totalCost, `${reqNumber} — ${project.nameAr}`)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `إذن صرف مواد ${reqNumber} — ${project.nameAr}`,
          sourceType: 'material_issue', sourceId: id, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const req: MaterialRequisition = {
          id, reqNumber, projectId: project.id, date: now,
          issuedByEmployeeId: issuer.id, issuedByName: issuer.nameAr,
          receivedByEmployeeId: receiver.id, receivedByName: receiver.nameAr,
          lines, totalCostMinor: totalCost, notes: args.notes, status: 'issued', journalEntryId: entryId,
        }
        // خصم المخزون بالوحدة الأساسية + سجل تدقيق كامل للحركة (Audit Trail)
        const updatedItems = state.items.map((it) => {
          const issued = planned.get(it.id)
          return issued ? { ...it, stockQty: Math.round((it.stockQty - issued) * 1000) / 1000 } : it
        })
        let moveId = nextId(state.stockMoves)
        const moves: StockMove[] = lines.map((l) => ({
          id: moveId++, date: now, itemId: l.itemId, qtyDelta: -l.baseQty,
          balanceAfter: updatedItems.find((it) => it.id === l.itemId)?.stockQty ?? 0,
          reason: `إذن صرف ${reqNumber} — ${project.nameAr}`, docType: 'material_issue', docId: id, byUser: issuer.nameAr,
        }))
        // التكلفة تدخل تكاليف المشروع المباشرة فوراً (بند مواد) — لدقة الربحية وEVM
        const cost = {
          id: nextId(state.projectCosts), projectId: project.id, date: now.slice(0, 10),
          kind: 'materials' as CostKind, description: `مواد منصرفة ${reqNumber}`,
          amountMinor: totalCost, payment: 'cash' as const, journalEntryId: entryId,
        }
        set({
          materialRequisitions: [...state.materialRequisitions, req],
          stockMoves: [...state.stockMoves, ...moves],
          projectCosts: [...state.projectCosts, cost],
          items: updatedItems, journal: [...state.journal, entry],
        })
        return req
      },

      getOpenClientInvoices: (customerId) => {
        const state = get()
        // المُحصَّل سابقاً لكل مستند من سجلات التحصيل
        const settled = new Map<string, number>()
        for (const st of state.clientSettlements) {
          if (st.customerId !== customerId) continue
          for (const a of st.allocations) settled.set(a.docKey, (settled.get(a.docKey) ?? 0) + a.appliedMinor)
        }
        const open: OpenInvoice[] = []
        // فواتير البيع: الجزء الآجل فقط ينشئ ذمة — مخصوماً منه مرتجعات «على الحساب»
        for (const sale of state.sales) {
          if (sale.customerId !== customerId) continue
          const paid = sale.paidMinor ?? (sale.payment === 'cash' ? sale.totals.totalMinor : 0)
          const creditPart = sale.totals.totalMinor - paid
          if (creditPart <= 0) continue
          const creditReturns = state.saleReturns
            .filter((r) => r.saleId === sale.id && r.refund === 'credit')
            .reduce((sum, r) => sum + r.totals.totalMinor, 0)
          const due = creditPart - creditReturns
          if (due <= 0) continue
          const key = `sale:${sale.id}`
          open.push({ docKey: key, docLabel: `فاتورة ${sale.invoiceNumber}`, date: sale.date, dueMinor: due, settledMinor: settled.get(key) ?? 0 })
        }
        // مستخلصات المشاريع المربوطة إدارياً بالعميل: الآجلة فقط (المستحق بعد المحتجز)
        for (const ex of state.projectExtracts) {
          if (ex.payment !== 'credit') continue
          const project = state.projects.find((pr) => pr.id === ex.projectId)
          if (!project || project.clientId !== customerId) continue
          const key = `extract:${ex.id}`
          open.push({ docKey: key, docLabel: `مستخلص ${ex.extractNumber}`, date: ex.date, dueMinor: ex.totals.dueMinor, settledMinor: settled.get(key) ?? 0 })
        }
        return open.filter((inv) => inv.dueMinor - inv.settledMinor > 0).sort((a, b) => a.date.localeCompare(b.date))
      },

      receiveClientPayment: (args) => {
        const state = get()
        const customer = state.customers.find((c) => c.id === args.customerId)
        if (!customer) throw new Error('العميل غير موجود')
        // التحصيل على مستوى الحساب الإجمالي: FIFO افتراضياً، ومطابقة محددة عند الطلب (أمر الإصلاح)
        const openInvoices = get().getOpenClientInvoices(customer.id)
        const { allocations, unallocatedMinor } = allocateClientPayment(args.amountMinor, openInvoices, args.specificDocKey ?? null)
        const id = nextId(state.clientSettlements)
        const settlementNumber = `CLR-${String(id).padStart(4, '0')}`
        const entryLines = buildClientReceiptEntry(args.amountMinor, args.treasury, `${settlementNumber} — ${customer.nameAr}`)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تحصيل ${settlementNumber} من ${customer.nameAr}${unallocatedMinor > 0 ? ' (يشمل دفعة تحت الحساب)' : ''}`,
          sourceType: 'client_payment', sourceId: id, lines: entryLines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const settlement = {
          id, settlementNumber, customerId: customer.id, date: now,
          amountMinor: args.amountMinor, treasury: args.treasury,
          allocations, unallocatedMinor, notes: args.notes ?? '', journalEntryId: entryId,
        }
        set({ clientSettlements: [...state.clientSettlements, settlement], journal: [...state.journal, entry] })
        return { settlementNumber, allocations, unallocatedMinor }
      },

      addSubAdvance: (args) => {
        const state = get()
        const contract = state.subContracts.find((c) => c.id === args.contractId)
        if (!contract) throw new Error('عقد الباطن غير موجود')
        if (contract.status !== 'active') throw new Error('العقد غير نشط')
        const lines = buildSubAdvanceEntry(args.amountMinor, args.treasury, `${contract.contractNumber} — ${contract.contractorName}`)
        const now = new Date().toISOString()
        const id = nextId(state.subAdvances)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `دفعة مقدمة لمقاول باطن ${contract.contractorName} (${contract.contractNumber})`,
          sourceType: 'sub_advance', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const adv: SubAdvance = { id, contractId: contract.id, date: now.slice(0, 10), amountMinor: args.amountMinor, recoveredMinor: 0, journalEntryId: entryId }
        set({ subAdvances: [...state.subAdvances, adv], journal: [...state.journal, entry] })
        return adv
      },

      getSubAdvanceBalance: (contractId) => {
        return get().subAdvances.filter((a) => a.contractId === contractId).reduce((sum, a) => sum + a.amountMinor - a.recoveredMinor, 0)
      },

      remitWithholdingTax: (treasury) => {
        const state = get()
        // رصيد 2112 الدائن من القيود = المستحق توريده
        let balance = 0
        for (const e of state.journal) for (const l of e.lines) if (l.accountCode === '2112') balance += l.credit - l.debit
        if (balance <= 0) throw new Error('لا ضريبة استقطاع مستحقة للتوريد')
        const lines: JournalLine[] = [
          { accountCode: '2112', debit: balance, credit: 0, note: 'توريد ضريبة الاستقطاع' },
          { accountCode: treasury, debit: 0, credit: balance, note: 'المسدد للمصلحة' },
        ]
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `توريد ضريبة استقطاع مقاولي الباطن`,
          sourceType: 'payment_voucher', sourceId: entryId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({ journal: [...state.journal, entry] })
        return { amount: balance }
      },

      getProjectEvm: (projectId) => {
        const state = get()
        const project = state.projects.find((p) => p.id === projectId)
        if (!project) throw new Error('المشروع غير موجود')
        const evmLines = state.boqItems
          .filter((b) => b.projectId === projectId)
          .map((b) => ({ boqItemId: b.id, code: b.code, descriptionAr: b.descriptionAr, qty: b.qty, unitPriceMinor: b.unitPriceMinor, estCostMinor: b.estCostMinor, progressPercent: b.progressPercent }))
        const actual = state.projectCosts.filter((c) => c.projectId === projectId).reduce((sum, c) => sum + c.amountMinor, 0)
        return computeProjectEvm(evmLines, actual)
      },

      setApprovalFlow: (action, steps, active) => {
        const state = get()
        const errors = validateApprovalFlow(steps)
        if (errors.length) throw new Error(errors.join(' — '))
        for (const st of steps) {
          if (st.employeeId != null && !state.employees.find((e) => e.id === st.employeeId)) throw new Error(`موظف المستوى «${st.roleAr}» غير موجود`)
        }
        const existing = state.approvalFlows.find((f) => f.action === action)
        const flow: ApprovalFlow = {
          id: existing?.id ?? nextId(state.approvalFlows),
          action,
          steps: steps.map((st, i) => ({ order: i + 1, roleAr: st.roleAr.trim(), employeeId: st.employeeId })),
          active,
        }
        set({ approvalFlows: existing ? state.approvalFlows.map((f) => (f.id === existing.id ? flow : f)) : [...state.approvalFlows, flow] })
        return flow
      },

      requestApproval: (action, subject, refId) => {
        const state = get()
        const flow = state.approvalFlows.find((f) => f.action === action && f.active)
        if (!flow) throw new Error(`لا مسار موافقات نشطاً للإجراء «${APPROVAL_ACTION_LABELS[action]}»`)
        const duplicate = state.approvalRequests.find((r) => r.action === action && r.refId === refId && r.status === 'pending')
        if (duplicate) throw new Error('يوجد طلب اعتماد معلق لنفس المستند')
        const req: ApprovalRequest = {
          id: nextId(state.approvalRequests), action, subject, refId,
          createdAt: new Date().toISOString(), status: 'pending', currentStep: 0, consumedAt: null, decisions: [],
        }
        set({ approvalRequests: [...state.approvalRequests, req] })
        return req
      },

      decideApproval: (requestId, decision, decidedBy, note) => {
        const state = get()
        const req = state.approvalRequests.find((r) => r.id === requestId)
        if (!req) throw new Error('طلب الاعتماد غير موجود')
        const flow = state.approvalFlows.find((f) => f.action === req.action)
        if (!flow) throw new Error('مسار الموافقات غير معرف')
        const updated = applyApprovalDecision(req, flow, decision, decidedBy, note ?? '')
        set({ approvalRequests: state.approvalRequests.map((r) => (r.id === requestId ? updated : r)) })
        return updated
      },

      assertApproved: (action, refId, subject) => {
        const state = get()
        const flow = state.approvalFlows.find((f) => f.action === action && f.active)
        if (!flow) return // لا مسار نشطاً = الإجراء حر (المحرك اختياري قابل للتخصيص)
        const approved = state.approvalRequests.find((r) => r.action === action && r.refId === refId && r.status === 'approved' && r.consumedAt == null)
        if (!approved) throw new Error(`«${APPROVAL_ACTION_LABELS[action]}» يتطلب اعتماداً مكتملاً عبر مسار الموافقات — ${subject}`)
        // استهلاك الاعتماد: كل تنفيذ يحتاج اعتماداً جديداً
        set({ approvalRequests: state.approvalRequests.map((r) => (r.id === approved.id ? { ...r, consumedAt: new Date().toISOString() } : r)) })
      },

      /* ─── الوصفات والتصنيع (مطاعم — سد فجوة Foodics) ─── */
      addRecipe: (input) => {
        const state = get()
        const errors = validateRecipe(
          input,
          (id) => state.items.some((it) => it.id === id),
          (pid) => state.recipes.some((r) => r.productItemId === pid),
          (id) => state.recipes.some((r) => r.productItemId === id && r.mode === 'made_to_order'),
        )
        if (errors.length) throw new Error(errors.join('، '))
        const recipe: Recipe = { ...input, id: nextId(state.recipes) }
        set({ recipes: [...state.recipes, recipe] })
        return recipe
      },
      updateRecipe: (id, input) => {
        const state = get()
        const existing = state.recipes.find((r) => r.id === id)
        if (!existing) throw new Error('الوصفة غير موجودة')
        const errors = validateRecipe(
          input,
          (iid) => state.items.some((it) => it.id === iid),
          (pid) => state.recipes.some((r) => r.productItemId === pid && r.id !== id),
          (iid) => state.recipes.some((r) => r.productItemId === iid && r.mode === 'made_to_order' && r.id !== id),
        )
        if (errors.length) throw new Error(errors.join('، '))
        set({ recipes: state.recipes.map((r) => (r.id === id ? { ...input, id } : r)) })
      },
      toggleRecipe: (id) => set((s) => ({ recipes: s.recipes.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r)) })),
      removeRecipe: (id) => {
        const state = get()
        if (state.productionOrders.some((o) => o.recipeId === id)) throw new Error('لهذه الوصفة أوامر إنتاج مرحلة — عطّلها بدل حذفها')
        set({ recipes: state.recipes.filter((r) => r.id !== id) })
      },
      getRecipeUnitCost: (recipeId) => {
        const state = get()
        const r = state.recipes.find((x) => x.id === recipeId)
        if (!r) throw new Error('الوصفة غير موجودة')
        return recipeUnitCostMinor(r, (id) => state.items.find((it) => it.id === id)?.costMinor ?? 0)
      },
      postProduction: (args) => {
        const state = get()
        const recipe = state.recipes.find((r) => r.id === args.recipeId)
        if (!recipe) throw new Error('الوصفة غير موجودة')
        if (recipe.mode !== 'prepped') throw new Error('أوامر الإنتاج للوصفات «إنتاج مسبق» فقط — أطباق الطلب تُخصم خاماتها عند البيع تلقائياً')
        if (!recipe.isActive) throw new Error('الوصفة معطلة')
        if (!Number.isInteger(args.batches) || args.batches <= 0) throw new Error('عدد التشغيلات يجب أن يكون عدداً صحيحاً موجباً')
        // فحص توافر الخامات (كميات التشغيلة × عدد التشغيلات)
        const shortages: string[] = []
        for (const ing of recipe.ingredients) {
          const item = state.items.find((it) => it.id === ing.itemId)
          const needed = ing.qty * args.batches
          if (!item) throw new Error('مكوّن غير موجود')
          if ((item.stockQty ?? 0) < needed) shortages.push(`«${item.nameAr}»: متاح ${item.stockQty ?? 0} ومطلوب ${needed}`)
        }
        if (shortages.length) throw new Error(`خامات غير كافية — ${shortages.join('، ')}`)
        const costOf = (id: number) => state.items.find((it) => it.id === id)?.costMinor ?? 0
        const ingredientsCost = recipeIngredientsCostMinor(recipe, costOf) * args.batches
        const overhead = recipe.overheadMinor * args.batches
        const producedQty = recipe.yieldQty * args.batches
        const treasury = args.treasury ?? '1101'
        const lines = buildProductionEntry(ingredientsCost, overhead, treasury)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const orderId = nextId(state.productionOrders)
        const orderNumber = `PRD-${String(orderId).padStart(4, '0')}`
        const product = state.items.find((it) => it.id === recipe.productItemId)
        if (!product) throw new Error('الصنف الناتج غير موجود')
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `أمر إنتاج ${orderNumber} — ${product.nameAr} (${producedQty})`,
          sourceType: 'production', sourceId: orderId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const order: ProductionOrder = {
          id: orderId, orderNumber, refCode: makeUniqueRefCode('PRD', now, usedRefCodes(state)),
          date: now, recipeId: recipe.id, productItemId: recipe.productItemId,
          batches: args.batches, producedQty, ingredientsCostMinor: ingredientsCost,
          overheadMinor: overhead, totalCostMinor: ingredientsCost + overhead,
          treasury: overhead > 0 ? treasury : null, journalEntryId: entryId, notes: args.notes ?? '',
        }
        // خصم الخامات + إدخال الناتج بمتوسط مرجح جديد (قيمة قديمة + تكلفة الإنتاج)
        const consumed = new Map<number, number>()
        for (const ing of recipe.ingredients) consumed.set(ing.itemId, ing.qty * args.batches)
        const updatedItems = state.items.map((it) => {
          if (consumed.has(it.id)) {
            return { ...it, stockQty: Math.round(((it.stockQty ?? 0) - consumed.get(it.id)!) * 1000) / 1000 }
          }
          if (it.id === recipe.productItemId) {
            const oldQty = it.stockQty ?? 0
            const newQty = oldQty + producedQty
            const newValue = Math.round(oldQty * it.costMinor) + ingredientsCost + overhead
            return { ...it, stockQty: newQty, costMinor: Math.round(newValue / newQty) }
          }
          return it
        })
        set({ items: updatedItems, productionOrders: [...state.productionOrders, order], journal: [...state.journal, entry] })
        return order
      },

      /* ─── الذهب والمجوهرات (صاغة) ─── */
      setGramPrices: (prices) => {
        if (!(prices.k18 > 0) || !(prices.k21 > 0) || !(prices.k24 > 0)) throw new Error('أدخل سعراً موجباً لكل عيار')
        if (!(prices.k18 < prices.k21 && prices.k21 < prices.k24)) throw new Error('ترتيب الأسعار غير منطقي — عيار 24 أغلى من 21 أغلى من 18')
        set({ gramPrices: { ...prices, updatedAt: new Date().toISOString() } })
      },
      repriceJewelry: () => {
        const state = get()
        if (!state.gramPrices.updatedAt) throw new Error('حدّث أسعار الجرام أولاً')
        let count = 0
        const updated = state.items.map((it) => {
          const prof = state.jewelryProfiles.find((p) => p.itemId === it.id)
          if (!prof) return it
          const newPrice = jewelryPriceMinor(prof, state.gramPrices)
          if (newPrice === it.priceMinor) return it
          count++
          return { ...it, priceMinor: newPrice }
        })
        if (count > 0) set({ items: updated })
        return count
      },
      setJewelryProfile: (profile) => {
        const state = get()
        const item = state.items.find((it) => it.id === profile.itemId)
        if (!item) throw new Error('الصنف غير موجود')
        const errors = validateProfile(profile)
        if (errors.length) throw new Error(errors.join('، '))
        const exists = state.jewelryProfiles.some((p) => p.itemId === profile.itemId)
        const profiles = exists
          ? state.jewelryProfiles.map((p) => (p.itemId === profile.itemId ? profile : p))
          : [...state.jewelryProfiles, profile]
        // تسعير فوري لو الأسعار محدثة يوماً ما
        const items = state.gramPrices.updatedAt
          ? state.items.map((it) => (it.id === profile.itemId ? { ...it, priceMinor: jewelryPriceMinor(profile, state.gramPrices) } : it))
          : state.items
        set({ jewelryProfiles: profiles, items })
      },
      removeJewelryProfile: (itemId) => set((s) => ({ jewelryProfiles: s.jewelryProfiles.filter((p) => p.itemId !== itemId) })),
      buyScrap: (args) => {
        const state = get()
        if (!(args.weightGrams > 0)) throw new Error('الوزن يجب أن يكون أكبر من صفر')
        if (!(args.pricePerGramMinor > 0)) throw new Error('سعر الجرام يجب أن يكون أكبر من صفر')
        const totalMinor = Math.round(args.weightGrams * args.pricePerGramMinor)
        const treasury = args.treasury ?? '1101'
        const lines = buildScrapPurchaseEntry(totalMinor, treasury, KARAT_LABELS[args.karat])
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const lotId = nextId(state.scrapLots)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `شراء كسر ${KARAT_LABELS[args.karat]} — ${args.weightGrams} جم${args.sellerName ? ` من ${args.sellerName}` : ''}`,
          sourceType: 'scrap_purchase', sourceId: lotId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const lot: ScrapLot = {
          id: lotId, refCode: makeUniqueRefCode('SCR', now, usedRefCodes(state)), date: now,
          karat: args.karat, weightGrams: args.weightGrams, remainingGrams: args.weightGrams,
          pricePerGramMinor: args.pricePerGramMinor, totalMinor, sellerName: args.sellerName ?? '', journalEntryId: entryId,
        }
        set({ scrapLots: [...state.scrapLots, lot], journal: [...state.journal, entry] })
        return lot
      },
      sellScrap: (args) => {
        const state = get()
        if (!(args.pricePerGramMinor > 0)) throw new Error('سعر الجرام يجب أن يكون أكبر من صفر')
        const plan = planScrapConsumption(state.scrapLots, args.karat, args.weightGrams) // يرمي لو الوزن غير متاح
        const costMinor = plan.reduce((s, p) => s + p.costMinor, 0)
        const saleMinor = Math.round(args.weightGrams * args.pricePerGramMinor)
        const treasury = args.treasury ?? '1101'
        const lines = buildScrapSaleEntry(saleMinor, costMinor, treasury, KARAT_LABELS[args.karat])
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const saleId = nextId(state.scrapSales)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `بيع كسر ${KARAT_LABELS[args.karat]} — ${args.weightGrams} جم${args.buyerName ? ` إلى ${args.buyerName}` : ''}`,
          sourceType: 'scrap_sale', sourceId: saleId, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const consumed = new Map(plan.map((p) => [p.lotId, p.grams]))
        const sale: ScrapSale = {
          id: saleId, refCode: makeUniqueRefCode('SCR', now, usedRefCodes(state)), date: now,
          karat: args.karat, weightGrams: args.weightGrams, pricePerGramMinor: args.pricePerGramMinor,
          saleMinor, costMinor, profitMinor: saleMinor - costMinor, buyerName: args.buyerName ?? '', journalEntryId: entryId,
        }
        set({
          scrapLots: state.scrapLots.map((l) => (consumed.has(l.id) ? { ...l, remainingGrams: Math.round((l.remainingGrams - consumed.get(l.id)!) * 1000) / 1000 } : l)),
          scrapSales: [...state.scrapSales, sale],
          journal: [...state.journal, entry],
        })
        return sale
      },
      postGoldTradeIn: (args) => {
        const coreErrors = validateTradeIn({ scrapWeightGrams: args.scrapWeightGrams, scrapPricePerGramMinor: args.scrapPricePerGramMinor })
        if (coreErrors.length) throw new Error(coreErrors.join(' — '))
        if (args.lines.length === 0) throw new Error('لا مشغولات بالفاتورة — شراء الكسر وحده من شاشة الصاغة')
        // ذرية العملية المركبة: لقطة قبل البيع — فشل شراء الكسر يسترجعها
        // (نفس درس الاستبدال: لا بيع «يتيم» نصف مقايضة)
        const snapshot = get()
        try {
          const treasury = args.treasury ?? '1101'
          // 1) بيع المشغول الجديد نقداً كاملاً في الخزينة (قيد بيع كامل: 4101/2102/5101)
          const sale = get().postSale({
            lines: args.lines,
            customerId: args.customerId ?? null,
            payment: 'cash',
            invoiceDiscountPercent: 0,
            taxPercent: args.taxPercent,
            taxInclusive: args.taxInclusive,
            treasury: treasury as TreasuryAccount,
          })
          // 2) شراء كسر العميل من نفس الخزينة (لوط FIFO بقيده الكامل) —
          //    النقدية الداخلة والخارجة بنفس الخزينة فصافي حركتها = الفرق فقط
          const lot = get().buyScrap({
            karat: args.scrapKarat,
            weightGrams: args.scrapWeightGrams,
            pricePerGramMinor: args.scrapPricePerGramMinor,
            sellerName: args.customerId != null ? get().customers.find((c) => c.id === args.customerId)?.nameAr : 'عميل مقايضة',
            treasury,
          })
          // 3) مستند الربط والصافي
          const afterState = get()
          const preview = computeTradeInNet(sale.totals.totalMinor, args.scrapWeightGrams, args.scrapPricePerGramMinor)
          const id = nextId(afterState.goldTradeIns)
          const doc: GoldTradeInDoc = {
            id,
            tradeNumber: `GTI-${String(id).padStart(4, '0')}`,
            date: new Date().toISOString(),
            saleId: sale.id,
            scrapLotId: lot.id,
            saleMinor: preview.saleMinor,
            scrapValueMinor: preview.scrapValueMinor,
            netMinor: preview.netMinor,
            notes: (args.notes ?? '').trim(),
          }
          set({ goldTradeIns: [...afterState.goldTradeIns, doc] })
          return doc
        } catch (e) {
          useDataStore.setState(snapshot, true)
          throw e
        }
      },

      /* ─── قوائم الأسعار (جملة/نصف جملة/VIP) ─── */
      addPriceList: (nameAr, defaultDiscountPercent) => {
        const state = get()
        const errors = validatePriceList(nameAr, defaultDiscountPercent, state.priceLists)
        if (errors.length) throw new Error(errors.join('، '))
        const list: PriceList = { id: nextId(state.priceLists), nameAr: nameAr.trim(), defaultDiscountPercent, isActive: true }
        set({ priceLists: [...state.priceLists, list] })
        return list
      },
      updatePriceList: (id, nameAr, defaultDiscountPercent) => {
        const state = get()
        if (!state.priceLists.some((l) => l.id === id)) throw new Error('القائمة غير موجودة')
        const errors = validatePriceList(nameAr, defaultDiscountPercent, state.priceLists, id)
        if (errors.length) throw new Error(errors.join('، '))
        set({ priceLists: state.priceLists.map((l) => (l.id === id ? { ...l, nameAr: nameAr.trim(), defaultDiscountPercent } : l)) })
      },
      togglePriceList: (id) => set((s) => ({ priceLists: s.priceLists.map((l) => (l.id === id ? { ...l, isActive: !l.isActive } : l)) })),
      removePriceList: (id) => {
        const state = get()
        if (state.customers.some((c) => c.priceListId === id)) throw new Error('عملاء مربوطون بهذه القائمة — انقلهم أولاً أو عطّلها')
        set({ priceLists: state.priceLists.filter((l) => l.id !== id), priceListEntries: state.priceListEntries.filter((e) => e.listId !== id) })
      },
      setPriceListEntry: (listId, itemId, priceMinor) => {
        const state = get()
        if (!state.priceLists.some((l) => l.id === listId)) throw new Error('القائمة غير موجودة')
        if (!state.items.some((it) => it.id === itemId)) throw new Error('الصنف غير موجود')
        const rest = state.priceListEntries.filter((e) => !(e.listId === listId && e.itemId === itemId))
        if (priceMinor == null) { set({ priceListEntries: rest }); return }
        if (!(priceMinor > 0)) throw new Error('السعر يجب أن يكون أكبر من صفر')
        set({ priceListEntries: [...rest, { listId, itemId, priceMinor }] })
      },
      getEffectivePrice: (itemId, listId) => {
        const state = get()
        const retail = state.items.find((it) => it.id === itemId)?.priceMinor ?? 0
        return resolvePrice(itemId, retail, listId, state.priceLists, state.priceListEntries)
      },
      setCustomerPriceList: (customerId, listId) => {
        const state = get()
        if (!state.customers.some((c) => c.id === customerId)) throw new Error('العميل غير موجود')
        if (listId != null && !state.priceLists.some((l) => l.id === listId && l.isActive)) throw new Error('القائمة غير موجودة أو معطلة')
        set({ customers: state.customers.map((c) => (c.id === customerId ? { ...c, priceListId: listId } : c)) })
      },

      getProjectWip: (projectId) => {
        const state = get()
        const project = state.projects.find((p) => p.id === projectId)
        if (!project) throw new Error('المشروع غير موجود')
        const contractMinor = effectiveContractValue(project.contractValueMinor, state.changeOrders.filter((o) => o.projectId === projectId))
        const billedMinor = state.projectExtracts.filter((e) => e.projectId === projectId).reduce((s, e) => s + e.totals.grossMinor, 0)
        const costsMinor = state.projectCosts.filter((c) => c.projectId === projectId).reduce((s, c) => s + c.amountMinor, 0)
        // موازنة التكاليف = مجموع BOQ إن وُجد (أدق من قيمة العقد)
        const budget = state.boqItems.filter((b) => b.projectId === projectId).reduce((s, b) => s + boqItemTotal(b), 0)
        return { contractMinor, billedMinor, costsMinor, ...computeWip({ contractMinor, budgetCostMinor: budget, costsIncurredMinor: costsMinor, billedMinor }) }
      },

      /* ─── العيادة (القرار 27) ─── */
      addClinicPatient: (p) => {
        const state = get()
        if (!p.nameAr.trim()) throw new Error('اسم المريض مطلوب')
        if (p.linkedCustomerId != null && !state.customers.some((c) => c.id === p.linkedCustomerId)) {
          throw new Error('حساب العميل المرتبط غير موجود')
        }
        const patient: ClinicPatient = { ...p, id: nextId(state.clinicPatients) }
        set({ clinicPatients: [...state.clinicPatients, patient] })
        return patient
      },
      updateClinicPatient: (id, patch) => {
        const state = get()
        const patient = state.clinicPatients.find((p) => p.id === id)
        if (!patient) throw new Error('المريض غير مسجل')
        if (patch.nameAr !== undefined && !patch.nameAr.trim()) throw new Error('اسم المريض مطلوب')
        if (patch.linkedCustomerId != null && !state.customers.some((c) => c.id === patch.linkedCustomerId)) {
          throw new Error('حساب العميل المرتبط غير موجود')
        }
        set({ clinicPatients: state.clinicPatients.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
      },
      addPatientAttachment: (a) => {
        const state = get()
        if (!state.clinicPatients.some((p) => p.id === a.patientId)) throw new Error('المريض غير مسجل')
        const errors = validateAttachment({ name: a.name, mime: a.mime, dataUrl: a.dataUrl })
        if (errors.length) throw new Error(errors.join(' — '))
        const att: PatientAttachment = { ...a, name: sanitizeText(a.name, 120), id: nextId(state.patientAttachments), addedAt: new Date().toISOString() }
        set({ patientAttachments: [...state.patientAttachments, att] })
        return att
      },
      removePatientAttachment: (id) => {
        set({ patientAttachments: get().patientAttachments.filter((x) => x.id !== id) })
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
        // الروشتة المنظمة: بنود بها اسم دواء تُفحص بصرامة (بنود فارغة بالكامل تُستبعد)
        const rxLines = (args.rxLines ?? []).filter((l) => l.medication.trim())
        if (rxLines.length > 0) {
          const rxErrors = validateRxLines(rxLines)
          if (rxErrors.length) throw new Error(rxErrors.join(' — '))
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
          rxLines, vitals: args.vitals ?? EMPTY_VITALS, nextVisit: args.nextVisit ?? '',
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

      /* ─── سيارات الأمانة (بيع بالعمولة — لا مخزون ولا قيد استلام) ─── */
      addConsignmentCar: (args) => {
        const state = get()
        if (!args.make.trim() || !args.model.trim()) throw new Error('الماركة والموديل مطلوبان')
        if (!args.plateOrVin.trim()) throw new Error('رقم اللوحة أو الشاسيه مطلوب')
        const taken = [...state.cars.map((c) => c.plateOrVin), ...state.consignmentCars.filter((c) => c.status === 'available' || c.status === 'sold').map((c) => c.plateOrVin)]
        if (taken.some((pv) => pv.trim().toLowerCase() === args.plateOrVin.trim().toLowerCase())) throw new Error(`السيارة ${args.plateOrVin} مسجلة بالفعل`)
        if (!args.ownerName.trim()) throw new Error('اسم المالك مطلوب — السيارة ملك الغير')
        if (!(args.ownerNetMinor > 0)) throw new Error('صافي المالك يجب أن يكون موجباً')
        if (!(args.askingPriceMinor >= args.ownerNetMinor)) throw new Error('سعر العرض لا يقل عن صافي المالك — وإلا فلا عمولة')
        const car: ConsignmentCar = {
          id: nextId(state.consignmentCars), make: args.make.trim(), model: args.model.trim(), year: args.year,
          plateOrVin: args.plateOrVin.trim(), ownerName: args.ownerName.trim(), ownerPhone: args.ownerPhone ?? '',
          ownerNetMinor: args.ownerNetMinor, askingPriceMinor: args.askingPriceMinor, status: 'available',
          receivedAt: new Date().toISOString(), salePriceMinor: null, commissionMinor: null, vatOnCommissionMinor: 0,
          buyerName: '', saleEntryId: null, soldAt: null, payoutEntryId: null, notes: args.notes ?? '',
        }
        set({ consignmentCars: [...state.consignmentCars, car] })
        return car
      },
      sellConsignmentCar: (args) => {
        const state = get()
        const car = state.consignmentCars.find((c) => c.id === args.id)
        if (!car) throw new Error('سيارة الأمانة غير موجودة')
        if (car.status !== 'available') throw new Error('السيارة ليست معروضة — بيعت أو رُدت')
        const label = `${car.make} ${car.model} ${car.year} (${car.plateOrVin})`
        const grossCommission = args.salePriceMinor - car.ownerNetMinor
        if (grossCommission < 0) throw new Error('سعر البيع أقل من صافي المالك المتفق عليه')
        // الضريبة على العمولة فقط (خدمة الوساطة) — تُفصل من العمولة الإجمالية
        const vatPct = args.vatPercentOnCommission ?? 0
        const vatOnCommission = vatPct > 0 ? Math.round(grossCommission - grossCommission / (1 + vatPct / 100)) : 0
        const lines = buildConsignmentSaleEntry(args.salePriceMinor, car.ownerNetMinor, vatOnCommission, args.payment, label, args.treasury ?? '1101')
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `بيع أمانة ${label} — عمولة المعرض`,
          sourceType: 'consignment_sale', sourceId: car.id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: ConsignmentCar = {
          ...car, status: 'sold', salePriceMinor: args.salePriceMinor,
          commissionMinor: grossCommission - vatOnCommission, vatOnCommissionMinor: vatOnCommission,
          buyerName: args.buyerName ?? '', saleEntryId: entryId, soldAt: now,
        }
        set({ consignmentCars: state.consignmentCars.map((c) => (c.id === car.id ? updated : c)), journal: [...state.journal, entry] })
        return updated
      },
      payConsignmentOwner: (id, treasury = '1101') => {
        const state = get()
        const car = state.consignmentCars.find((c) => c.id === id)
        if (!car) throw new Error('سيارة الأمانة غير موجودة')
        if (car.status !== 'sold') throw new Error('لا مستحق للمالك — السيارة لم تُبع بعد أو سُدد بالفعل')
        const label = `${car.make} ${car.model} (${car.plateOrVin})`
        const lines = buildConsignmentPayoutEntry(car.ownerNetMinor, label, treasury)
        const now = new Date().toISOString()
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `سداد مالك الأمانة ${car.ownerName} — ${label}`,
          sourceType: 'consignment_payout', sourceId: car.id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        set({
          consignmentCars: state.consignmentCars.map((c) => (c.id === id ? { ...c, status: 'paid' as const, payoutEntryId: entryId } : c)),
          journal: [...state.journal, entry],
        })
      },
      returnConsignmentCar: (id) => {
        const state = get()
        const car = state.consignmentCars.find((c) => c.id === id)
        if (!car) throw new Error('سيارة الأمانة غير موجودة')
        if (car.status !== 'available') throw new Error('لا تُرد إلا سيارة معروضة لم تُبع')
        set({ consignmentCars: state.consignmentCars.map((c) => (c.id === id ? { ...c, status: 'returned' as const } : c)) })
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
          promisedAt: args.promisedAt || undefined,
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
        // الآجل كلياً (والجزئي يُفحص بعد حساب الإجماليات بالأسفل) يتطلب عميلاً مسجلاً
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

        // 2) تحقق وإجماليات وقيد بالنواة الخالصة (خدمات + تحصيل مجزأ — الأمر 23)
        const delivery: TicketDeliveryInput = { laborMinor: input.laborMinor, parts, services: input.services, payment: input.payment, paidMinor: input.paidMinor, vatPercent: input.vatPercent }
        const errors = validateDelivery(delivery)
        if (errors.length) throw new Error(errors.join(' — '))
        const totals = computeTicketTotals(delivery)
        if (totals.creditMinor > 0 && ticket.customerId == null) {
          throw new Error('يوجد مبلغ آجل غير محصَّل — التحصيل الجزئي يتطلب عميلاً مسجلاً على التذكرة')
        }
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
          services: input.services ?? [],
          totals,
          payment: totals.creditMinor > 0 ? 'credit' : 'cash',
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
      addMaintenanceService: (input) => {
        const errors = validateService(input)
        if (errors.length) throw new Error(errors.join(' — '))
        const state = get()
        const svc: MaintenanceService = { id: nextId(state.maintenanceServices), nameAr: input.nameAr.trim(), costMinor: input.costMinor, priceMinor: input.priceMinor, isActive: true }
        set({ maintenanceServices: [...state.maintenanceServices, svc] })
        return svc
      },
      updateMaintenanceService: (id, patch) => {
        set((s) => ({ maintenanceServices: s.maintenanceServices.map((sv) => (sv.id === id ? { ...sv, ...patch } : sv)) }))
      },
      postWalletService: (input) => {
        const state = get()
        const errors = validateWalletService(input)
        if (errors.length) throw new Error(errors.join(' — '))
        if (input.customerId != null && !state.customers.some((c) => c.id === input.customerId)) throw new Error('العميل غير موجود')
        if (!state.treasuries.some((t) => t.code === input.fundingTreasury)) throw new Error('خزينة التمويل غير موجودة')
        if (input.paidMinor > 0 && !state.treasuries.some((t) => t.code === input.receiveTreasury)) throw new Error('خزينة الاستلام غير موجودة')
        const totals = computeWalletTotals(input)
        const opId = nextId(state.walletOps)
        const opNumber = `WS-${String(opId).padStart(4, '0')}`
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const date = input.date ?? now.slice(0, 10)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date,
          description: `خدمة محافظ ${opNumber} — ${input.provider}`,
          sourceType: 'wallet_service', sourceId: opId,
          lines: buildWalletServiceEntry(input, totals, opNumber),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const op: WalletServiceOp = {
          id: opId, opNumber,
          refCode: makeUniqueRefCode('WLT', date, usedRefCodes(state)),
          date, type: input.type, provider: input.provider,
          targetPhone: sanitizeText(input.targetPhone, 30),
          customerId: input.customerId,
          paidToProviderMinor: input.paidToProviderMinor,
          chargeMinor: input.chargeMinor,
          paidMinor: input.paidMinor,
          fundingTreasury: input.fundingTreasury,
          receiveTreasury: input.receiveTreasury,
          totals, status: 'done', journalEntryId: entryId, returnEntryId: null,
          notes: sanitizeText(input.notes, 300),
        }
        set({ walletOps: [...state.walletOps, op], journal: [...state.journal, entry] })
        return op
      },

      returnWalletService: (opId, reason) => {
        const state = get()
        const op = state.walletOps.find((o) => o.id === opId)
        if (!op) throw new Error('العملية غير موجودة')
        if (op.status === 'returned') throw new Error('العملية مرتجعة بالفعل')
        const orig = state.journal.find((e) => e.id === op.journalEntryId)
        if (!orig) throw new Error('قيد العملية الأصلي غير موجود')
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `مرتجع خدمة محافظ ${op.opNumber}${reason ? ` — ${sanitizeText(reason, 120)}` : ''}`,
          sourceType: 'reversal', sourceId: orig.id,
          lines: buildReversalLines(orig.lines),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: orig.id,
        }
        const updated: WalletServiceOp = { ...op, status: 'returned', returnEntryId: entryId }
        set({
          walletOps: state.walletOps.map((o) => (o.id === opId ? updated : o)),
          journal: [...state.journal.map((e) => (e.id === orig.id ? { ...e, reversedByEntryId: entryId } : e)), entry],
        })
        return updated
      },

      postTransfer: (args) => {
        const state = get()
        if (!state.warehouses.some((w) => w.id === args.fromWarehouseId)) throw new Error('المخزن المصدر غير موجود')
        if (!state.warehouses.some((w) => w.id === args.toWarehouseId)) throw new Error('المخزن المستقبل غير موجود')

        // 1) الأرصدة الحالية لكل المخازن ثم تحقق النواة الخالصة
        const stock = computeWarehouseStock(state.items, state.warehouses, state.transfers, buildWarehouseDocs(state.purchases, state.sales))
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
        const funding: AssetFunding = args.funding ?? 'cash'
        // رأس مال/جاري شريك: لا دفع نقدياً من خزائن المنشأة إطلاقاً
        const paid = funding === 'capital' || funding === 'partner' ? 0 : funding === 'supplier_credit' ? 0 : args.paidMinor
        const errors = validateAsset({ ...args, paidMinor: paid })
        if (errors.length) throw new Error(errors.join(' — '))
        const remaining = funding === 'cash' ? args.costMinor - paid : funding === 'supplier_credit' ? args.costMinor : 0
        // إصلاح بلاغ المالك «عالج الدين على مورد غير موجود»: أي دين آجل يتطلب مورداً مسجلاً
        if (remaining > 0) {
          if (!args.supplierId) throw new Error('الجزء الآجل يحتاج مورداً مسجلاً — اختر المورد أو سجّله أولاً من قسم الموردين')
          if (!state.suppliers.some((x) => x.id === args.supplierId)) throw new Error('المورد غير موجود')
        }
        // جدول الأقساط الاختياري للجزء الآجل
        let installments: AssetInstallment[] = []
        if (remaining > 0 && (args.installmentCount ?? 0) > 1) {
          installments = buildAssetInstallments(
            remaining, args.installmentCount!, args.installmentIntervalMonths ?? 1,
            args.firstInstallmentDate ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          )
        }

        const id = nextId(state.assets)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const assetNumber = `FA-${String(id).padStart(4, '0')}`
        const entryLines = buildAssetPurchaseEntry(args.costMinor, paid, assetNumber, args.treasury ?? '1101', funding)

        const entry: JournalEntry = {
          id: entryId,
          entryNumber: entryId,
          date: now.slice(0, 10),
          description: `اقتناء أصل ${assetNumber} — ${args.nameAr.trim()}${remaining > 0 ? ` (آجل على ${state.suppliers.find((x) => x.id === args.supplierId)?.nameAr ?? 'مورد'})` : funding === 'capital' ? ' (مقدَّم من المالك — رأس مال)' : funding === 'partner' ? ' (جاري الشريك)' : ''}`,
          sourceType: 'asset_purchase',
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
          funding,
          supplierId: remaining > 0 ? args.supplierId : null,
          paidMinor: paid,
          installments,
          payments: [],
        }
        set({ assets: [...state.assets, asset], journal: [...state.journal, entry] })
        return asset
      },

      payAssetInstallment: (args) => {
        const state = get()
        const asset = state.assets.find((a) => a.id === args.assetId)
        if (!asset) throw new Error('الأصل غير موجود')
        const due = get().getAssetDue(asset.id)
        if (due.remainingMinor <= 0) throw new Error('الأصل مسدد بالكامل — لا دين عليه')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ السداد يجب أن يكون موجباً')
        if (args.amountMinor > due.remainingMinor) throw new Error(`المبلغ أكبر من متبقي دين الأصل (${due.remainingMinor})`)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const supName = state.suppliers.find((x) => x.id === asset.supplierId)?.nameAr ?? ''
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `سداد دفعة أصل ${asset.assetNumber} — ${asset.nameAr}${supName ? ` (${supName})` : ''}`,
          sourceType: 'asset_payment', sourceId: asset.id,
          lines: buildAssetPaymentEntry(args.amountMinor, `${asset.assetNumber}`, args.treasury),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        // توزيع السداد على الأقساط الأقدم أولاً
        let toApply = args.amountMinor
        let firstSeq: number | null = null
        const installments = (asset.installments ?? []).map((it) => {
          if (toApply <= 0) return it
          const open = it.amountMinor - it.paidMinor
          if (open <= 0) return it
          const take = Math.min(open, toApply)
          toApply -= take
          if (firstSeq == null) firstSeq = it.seq
          return { ...it, paidMinor: it.paidMinor + take, paidAt: now }
        })
        const payment = { id: (asset.payments ?? []).length + 1, date: now, amountMinor: args.amountMinor, treasury: args.treasury, journalEntryId: entryId, installmentSeq: firstSeq }
        const updated: FixedAsset = { ...asset, installments, payments: [...(asset.payments ?? []), payment] }
        set({ assets: state.assets.map((a) => (a.id === asset.id ? updated : a)), journal: [...state.journal, entry] })
        return updated
      },

      getAssetDue: (assetId) => {
        const asset = get().assets.find((a) => a.id === assetId)
        if (!asset) return { totalDueMinor: 0, paidMinor: 0, remainingMinor: 0, nextInstallment: null }
        const funding = asset.funding ?? 'cash'
        const totalDue = funding === 'supplier_credit' ? asset.costMinor : funding === 'cash' ? asset.costMinor - (asset.paidMinor ?? 0) : 0
        const paid = (asset.payments ?? []).reduce((a2, p) => a2 + p.amountMinor, 0)
        const remaining = Math.max(0, totalDue - paid)
        const nextInstallment = (asset.installments ?? []).find((it) => it.paidMinor < it.amountMinor) ?? null
        return { totalDueMinor: totalDue, paidMinor: paid, remainingMinor: remaining, nextInstallment }
      },

      addCommissionParty: (args) => {
        const state = get()
        const errors = validateCommissionParty(args, state.commissionParties)
        if (errors.length) throw new Error(errors.join('، '))
        const id = nextId(state.commissionParties)
        const party: CommissionParty = {
          id, code: `CMP-${String(id).padStart(4, '0')}`,
          nameAr: args.nameAr.trim(), phone: args.phone.trim(), kind: args.kind.trim(), notes: args.notes.trim(),
          createdAt: new Date().toISOString(),
        }
        set({ commissionParties: [...state.commissionParties, party] })
        return party
      },

      updateCommissionParty: (id, patch) => {
        const state = get()
        const party = state.commissionParties.find((p) => p.id === id)
        if (!party) throw new Error('الطرف غير موجود')
        if (patch.nameAr !== undefined) {
          const errors = validateCommissionParty({ nameAr: patch.nameAr }, state.commissionParties, id)
          if (errors.length) throw new Error(errors.join('، '))
        }
        set({ commissionParties: state.commissionParties.map((p) => (p.id === id ? { ...p, ...patch, nameAr: (patch.nameAr ?? p.nameAr).trim() } : p)) })
      },

      deleteCommissionParty: (id) => {
        const state = get()
        if (state.externalCommissions.some((c) => c.partyId === id)) {
          throw new Error('لا يمكن حذف الطرف — عليه عمولات مسجلة (سلامة السجلات)')
        }
        set({ commissionParties: state.commissionParties.filter((p) => p.id !== id) })
      },

      addExternalCommission: (args) => {
        const state = get()
        // الطرف يجب أن يكون مسجلاً في السجل (طلب المالك — لا أسماء حرة)
        const party = state.commissionParties.find((p) => p.id === args.partyId)
        if (!party) throw new Error('سجّل الشخص/الجهة أولاً في تبويب «الأشخاص المتعامل معهم»')
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('مبلغ العمولة يجب أن يكون موجباً')
        const id = nextId(state.externalCommissions)
        const commissionNumber = `${args.direction === 'earned' ? 'EXC' : 'CMO'}-${String(id).padStart(4, '0')}`
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: args.direction === 'earned'
            ? `استحقاق عمولة ${commissionNumber} لدى ${party.nameAr}${args.description ? ` — ${args.description}` : ''}`
            : `استحقاق عمولة ${commissionNumber} لـ${party.nameAr}${args.description ? ` — ${args.description}` : ''}`,
          sourceType: 'external_commission', sourceId: id,
          lines: args.direction === 'earned'
            ? buildEarnedAccrualEntry(args.amountMinor, party.nameAr)
            : buildOwedAccrualEntry(args.amountMinor, party.nameAr),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const commission: ExternalCommission = {
          id, commissionNumber, direction: args.direction, partyId: party.id, partyName: party.nameAr, date: now,
          amountMinor: args.amountMinor, collectedMinor: 0, description: args.description.trim(),
          journalEntryId: entryId, collections: [],
        }
        set({ externalCommissions: [...state.externalCommissions, commission], journal: [...state.journal, entry] })
        return commission
      },

      collectExternalCommission: (args) => {
        const state = get()
        const com = state.externalCommissions.find((c) => c.id === args.commissionId)
        if (!com) throw new Error('العمولة غير موجودة')
        const remaining = com.amountMinor - com.collectedMinor
        if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) throw new Error('المبلغ يجب أن يكون موجباً')
        if (args.amountMinor > remaining) throw new Error(`المبلغ أكبر من المتبقي (${remaining})`)
        const entryId = nextId(state.journal)
        const now = new Date().toISOString()
        const earned = (com.direction ?? 'earned') === 'earned'
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: earned ? `تحصيل عمولة ${com.commissionNumber} من ${com.partyName}` : `سداد عمولة ${com.commissionNumber} لـ${com.partyName}`,
          sourceType: 'external_commission', sourceId: com.id,
          lines: earned
            ? buildEarnedCollectEntry(args.amountMinor, com.partyName, args.treasury)
            : buildOwedPayEntry(args.amountMinor, com.partyName, args.treasury),
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: ExternalCommission = {
          ...com, collectedMinor: com.collectedMinor + args.amountMinor,
          collections: [...com.collections, { id: com.collections.length + 1, date: now, amountMinor: args.amountMinor, treasury: args.treasury, journalEntryId: entryId }],
        }
        set({ externalCommissions: state.externalCommissions.map((c) => (c.id === com.id ? updated : c)), journal: [...state.journal, entry] })
        return updated
      },

      addCustomAccount: (args) => {
        const state = get()
        const coa = fullCoa(STANDARD_COA, state.treasuries)
        const errors = validateCustomAccount(args, coa, state.customAccounts)
        if (errors.length) throw new Error(errors.join('، '))
        const rootType = rootOfParent(args.parentCode, coa)!
        const account: CustomAccount = {
          code: args.code.trim(),
          nameAr: args.nameAr.trim(),
          parentCode: args.parentCode,
          rootType,
          createdAt: new Date().toISOString(),
        }
        set({ customAccounts: [...state.customAccounts, account] })
        return account
      },

      deleteCustomAccount: (code) => {
        const state = get()
        const acc = state.customAccounts.find((a) => a.code === code)
        if (!acc) throw new Error('الحساب غير موجود')
        // حماية سلامة الدفاتر: لا حذف لحساب عليه حركة
        if (state.journal.some((e) => e.lines.some((l) => l.accountCode === code))) {
          throw new Error(`«${acc.nameAr}» عليه قيود في اليومية — لا يمكن حذفه حفاظاً على توازن الدفاتر`)
        }
        set({ customAccounts: state.customAccounts.filter((a) => a.code !== code) })
      },

      openLaundryOrder: (args) => {
        const state = get()
        const lines = args.lines.filter((l) => l.desc.trim() && l.qty > 0)
        const errors = validateLaundryOrder({ lines, prepaidMinor: args.prepaidMinor })
        if (errors.length) throw new Error(errors.join('، '))
        if (args.customerId != null && !state.customers.some((c) => c.id === args.customerId)) throw new Error('العميل غير موجود')
        const id = nextId(state.laundryOrders)
        const orderNumber = `LN-${String(id).padStart(4, '0')}`
        const now = new Date().toISOString()
        let prepaidEntryId: number | null = null
        let journal = state.journal
        if (args.prepaidMinor > 0) {
          const entryId = nextId(journal)
          prepaidEntryId = entryId
          journal = [...journal, {
            id: entryId, entryNumber: entryId, date: now.slice(0, 10),
            description: `عربون أمر غسيل ${orderNumber} — ${args.customerName || 'عميل نقدي'}`,
            sourceType: 'laundry', sourceId: id,
            lines: buildLaundryPrepaidEntry(args.prepaidMinor, `عربون ${orderNumber}`, args.treasury ?? '1101'),
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }]
        }
        const order: LaundryOrder = {
          id, orderNumber,
          customerId: args.customerId, customerName: args.customerName.trim() || 'عميل نقدي', phone: args.phone.trim(),
          receivedAt: now, promisedAt: args.promisedAt, status: 'received',
          lines, prepaidMinor: args.prepaidMinor,
          prepaidEntryId, deliverEntryId: null, cancelEntryId: null,
          totalMinor: laundryTotal(lines), grandMinor: 0, taxMinor: 0,
          notes: args.notes.trim(),
          statusHistory: [{ status: 'received', at: now }],
        }
        set({ laundryOrders: [...state.laundryOrders, order], journal })
        return order
      },

      setLaundryStatus: (orderId, status) => {
        const state = get()
        const order = state.laundryOrders.find((o) => o.id === orderId)
        if (!order) throw new Error('الأمر غير موجود')
        assertLaundryTransition(order.status, status)
        if (status === 'delivered') throw new Error('التسليم من زر «تسليم وتحصيل» — يولّد قيد الإيراد')
        if (status === 'cancelled') throw new Error('الإلغاء من زر الإلغاء — يرد العربون إن وُجد')
        const updated: LaundryOrder = { ...order, status, statusHistory: [...order.statusHistory, { status, at: new Date().toISOString() }] }
        set({ laundryOrders: state.laundryOrders.map((o) => (o.id === orderId ? updated : o)) })
        return updated
      },

      deliverLaundryOrder: (args) => {
        const state = get()
        const order = state.laundryOrders.find((o) => o.id === args.orderId)
        if (!order) throw new Error('الأمر غير موجود')
        assertLaundryTransition(order.status, 'delivered')
        const { vatPercent, taxInclusive } = useAppStore.getState().setup
        const now = new Date().toISOString()
        const built = buildLaundryDeliverEntry({
          totalMinor: order.totalMinor, prepaidMinor: order.prepaidMinor,
          taxPercent: vatPercent, taxInclusive,
          note: `إيراد ${order.orderNumber}`, treasury: args.treasury ?? '1101',
        })
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تسليم أمر غسيل ${order.orderNumber} — ${order.customerName}`,
          sourceType: 'laundry', sourceId: order.id,
          lines: built.lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const updated: LaundryOrder = {
          ...order, status: 'delivered', deliverEntryId: entryId,
          grandMinor: built.grandMinor, taxMinor: built.taxMinor,
          statusHistory: [...order.statusHistory, { status: 'delivered', at: now }],
        }
        set({ laundryOrders: state.laundryOrders.map((o) => (o.id === order.id ? updated : o)), journal: [...state.journal, entry] })
        return updated
      },

      cancelLaundryOrder: (orderId) => {
        const state = get()
        const order = state.laundryOrders.find((o) => o.id === orderId)
        if (!order) throw new Error('الأمر غير موجود')
        assertLaundryTransition(order.status, 'cancelled')
        const now = new Date().toISOString()
        let journal = state.journal
        let cancelEntryId: number | null = null
        if (order.prepaidMinor > 0) {
          const entryId = nextId(journal)
          cancelEntryId = entryId
          journal = [...journal, {
            id: entryId, entryNumber: entryId, date: now.slice(0, 10),
            description: `إلغاء أمر غسيل ${order.orderNumber} — رد العربون`,
            sourceType: 'laundry', sourceId: order.id,
            lines: buildLaundryCancelEntry(order.prepaidMinor, `رد عربون ${order.orderNumber}`),
            createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
          }]
        }
        const updated: LaundryOrder = { ...order, status: 'cancelled', cancelEntryId, statusHistory: [...order.statusHistory, { status: 'cancelled', at: now }] }
        set({ laundryOrders: state.laundryOrders.map((o) => (o.id === orderId ? updated : o)), journal })
        return updated
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
          sourceType: 'depreciation',
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

      runAutoDepreciation: () => {
        // حماية المالك من النسيان: كل شهر متأخر يُرحَّل قيده فور فتح البرنامج
        let posted = 0
        for (let guard = 0; guard < 240; guard++) {
          const state = get()
          const nowMonth = new Date().toISOString().slice(0, 7)
          const due = state.assets.some(
            (a) => a.monthsDepreciated < a.lifeMonths && nextDepreciationMonth(a.purchaseMonth, a.monthsDepreciated) <= nowMonth,
          )
          if (!due) break
          try {
            get().postMonthlyDepreciation()
            posted++
          } catch { break } // مثلاً: منع الرصيد السالب لا يمس الإهلاك، لكن احتياط لأي رفض
        }
        return posted
      },

      /* ─── الشيكات (أوراق القبض والدفع) ─── */
      receiveCheque: (args) => {
        const state = get()
        validateCheque(args)
        // شيك مربوط بعميل مسجل أو شيك بلا طرف (طلب المالك) — الحساب المقابل يتكيف
        const customer = args.partyId != null ? state.customers.find((c) => c.id === args.partyId) : null
        if (args.partyId != null && !customer) throw new Error('العميل غير موجود')
        const counterAccount = customer ? '1104' : (args.counterAccount ?? '4110')
        const partyName = customer ? customer.nameAr : (args.partyName ?? '').trim()
        if (state.cheques.some((c) => c.direction === 'incoming' && c.chequeNumber === args.chequeNumber.trim() && c.bankName === args.bankName.trim())) {
          throw new Error('شيك بنفس الرقم والبنك مسجل من قبل')
        }
        const id = nextId(state.cheques)
        const now = new Date().toISOString()
        const note = `شيك وارد ${args.chequeNumber} — ${partyName}`
        const lines = buildChequeReceiveEntry(args.amountMinor, note, counterAccount)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `استلام ${note} (استحقاق ${args.dueDate})`,
          sourceType: 'cheque_receive', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cheque: Cheque = {
          id, chequeNumber: args.chequeNumber.trim(), direction: 'incoming',
          partyId: customer?.id ?? null, partyName, counterAccount, bankName: args.bankName.trim(),
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
        // صادر لمورد مسجل أو لمستفيد آخر: مصروف/راتب/حساب مخصص (طلب المالك — كل السيناريوهات)
        const supplier = args.partyId != null ? state.suppliers.find((s) => s.id === args.partyId) : null
        if (args.partyId != null && !supplier) throw new Error('المورد غير موجود')
        const counterAccount = supplier ? '2101' : (args.counterAccount ?? '5108')
        const partyName = supplier ? supplier.nameAr : (args.partyName ?? '').trim()
        if (state.cheques.some((c) => c.direction === 'outgoing' && c.chequeNumber === args.chequeNumber.trim())) {
          throw new Error('رقم شيك صادر مكرر — كل ورقة من دفترك برقم فريد')
        }
        const id = nextId(state.cheques)
        const now = new Date().toISOString()
        const note = `شيك صادر ${args.chequeNumber} — ${partyName}`
        const lines = buildChequeIssueEntry(args.amountMinor, note, counterAccount)
        const entryId = nextId(state.journal)
        const entry: JournalEntry = {
          id: entryId, entryNumber: entryId, date: now.slice(0, 10),
          description: `تحرير ${note} (استحقاق ${args.dueDate})`,
          sourceType: 'cheque_issue', sourceId: id, lines,
          createdBy: 'المالك', createdAt: now, reversedByEntryId: null, reversesEntryId: null,
        }
        const cheque: Cheque = {
          id, chequeNumber: args.chequeNumber.trim(), direction: 'outgoing',
          partyId: supplier?.id ?? null, partyName, counterAccount, bankName: args.bankName.trim(),
          amountMinor: args.amountMinor, dueDate: args.dueDate, status: 'issued', notes: args.notes,
          createdAt: now, receiveEntryId: entryId, settleEntryId: null, reverseEntryId: null,
          depositedAt: null, settledAt: null,
        }
        set({ cheques: [...state.cheques, cheque], journal: [...state.journal, entry] })
        return cheque
      },

      setChequeStatus: (chequeId, status, bank) => {
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
        // حساب الإيداع/الصرف يجب أن يكون خزينة أو بنكاً مسجلاً فعلاً (طلب المالك — لا مبلغ عائماً)
        const settleAccount = bank ?? state.treasuries.find((t) => t.kind === 'bank')?.code ?? '1101'
        if ((status === 'collected' || status === 'cleared') && !state.treasuries.some((t) => t.code === settleAccount)) {
          throw new Error('اختر حساب الإيداع/الصرف: خزينة أو بنكاً مسجلاً')
        }
        const counter = cheque.counterAccount ?? (cheque.direction === 'incoming' ? '1104' : '2101')
        const built =
          status === 'collected' ? { lines: buildChequeCollectEntry(cheque.amountMinor, note, settleAccount), src: 'cheque_collect' as const, desc: `تحصيل ${note}`, reversal: false }
          : status === 'bounced' ? { lines: buildChequeBounceEntry(cheque.amountMinor, note, counter), src: 'cheque_bounce' as const, desc: `ارتداد ${note} — عاد الالتزام كما كان`, reversal: true }
          : status === 'cleared' ? { lines: buildChequeClearEntry(cheque.amountMinor, note, settleAccount), src: 'cheque_clear' as const, desc: `صرف ${note}`, reversal: false }
          : { lines: buildChequeCancelEntry(cheque.amountMinor, note, counter), src: 'cheque_cancel' as const, desc: `إلغاء ${note} — عاد الالتزام كما كان`, reversal: true }
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
    }},
    {
      name: 'shopsys-data',
      version: DATA_VERSION,
      // القرار 28: قاعدة البيانات مشفرة AES-256-GCM بمفتاح مشتق لهذا الجهاز
      storage: createJSONStorage(() => secureStorage),
      // ترحيل البيانات المحفوظة بالأشكال القديمة (أقسام هرمية، stockQty، مرتجعات وورديات وجرد)
      migrate: (persisted: unknown) => {
        const s = persisted as Partial<DataState>
        return {
          ...s,
          // سجل النشاطات والمستخدمون والبلاغات (الإصدار 11) — قواعد قديمة بلا هذه الحقول
          auditLog: s.auditLog ?? [],
          // الإصدار 17: عمولات لدى الغير + تمويل الأصول وأقساطها
          externalCommissions: (s.externalCommissions ?? []).map((c) => ({ ...c, direction: c.direction ?? 'earned', partyId: c.partyId ?? null })),
          commissionParties: s.commissionParties ?? [],
          customAccounts: s.customAccounts ?? [],
          laundryOrders: s.laundryOrders ?? [],
          cheques: (s.cheques ?? []).map((c) => ({ ...c, counterAccount: c.counterAccount ?? (c.direction === 'incoming' ? '1104' : '2101') })),
          assets: (s.assets ?? []).map((a) => ({ ...a, funding: a.funding ?? 'cash', supplierId: a.supplierId ?? null, paidMinor: a.paidMinor ?? a.costMinor, installments: a.installments ?? [], payments: a.payments ?? [] })),
          appUsers: s.appUsers ?? [],
          roleOverrides: s.roleOverrides ?? {},
          currentUserId: s.currentUserId ?? null,
          issues: s.issues ?? [],
          // الإصدار 18: تسجيل الدخول الفعلي + الصرف الداخلي
          ownerPinHash: s.ownerPinHash ?? null,
          loggedOut: s.loggedOut ?? false,
          loginGuard: s.loginGuard ?? EMPTY_GUARD,
          ownerTempPin: s.ownerTempPin ?? null,
          pinResetRequests: s.pinResetRequests ?? [],
          consumptions: s.consumptions ?? [],
          // ترحيل الخزائن المتعددة: الحسابات القديمة تحصل على الافتراضيتين
          treasuries: s.treasuries && s.treasuries.length > 0 ? s.treasuries : DEFAULT_TREASURIES,
          categories: (s.categories ?? []).map((c) => ({ ...c, parentId: c.parentId ?? null })),
          // الأكواد المرجعية (الإصدار 9): فواتير قديمة بلا refCode تحصل على كود فريد فوراً
          sales: (() => {
            const used = new Set<string>()
            return (s.sales ?? []).map((x) => {
              if (x.refCode) { used.add(x.refCode); return { ...x, shiftId: x.shiftId ?? null } }
              const code = makeUniqueRefCode('SAL', x.date, used); used.add(code)
              return { ...x, shiftId: x.shiftId ?? null, refCode: code }
            })
          })(),
          purchases: (() => {
            const used = new Set<string>()
            return (s.purchases ?? []).map((x) => {
              if (x.refCode) { used.add(x.refCode); return { ...x, journalEntryId: x.journalEntryId ?? null } }
              const code = makeUniqueRefCode('PUR', x.date, used); used.add(code)
              return { ...x, journalEntryId: x.journalEntryId ?? null, refCode: code }
            })
          })(),
          saleReturns: (() => {
            const used = new Set<string>()
            return (s.saleReturns ?? []).map((x) => {
              if (x.refCode) { used.add(x.refCode); return x }
              const code = makeUniqueRefCode('SRT', x.date, used); used.add(code)
              return { ...x, refCode: code }
            })
          })(),
          purchaseReturns: (() => {
            const used = new Set<string>()
            return (s.purchaseReturns ?? []).map((x) => {
              if (x.refCode) { used.add(x.refCode); return x }
              const code = makeUniqueRefCode('PRT', x.date, used); used.add(code)
              return { ...x, refCode: code }
            })
          })(),
          items: (s.items ?? []).map((it) => ({ ...it, stockQty: it.stockQty ?? 0, warrantyMonths: it.warrantyMonths ?? 0 })),
          customers: (s.customers ?? []).map((c) => ({ ...EMPTY_EXTENDED, ...c })),
          suppliers: (s.suppliers ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          employees: (s.employees ?? []).map((x) => ({ ...EMPTY_EXTENDED, ...x })),
          payrollRuns: s.payrollRuns ?? [],
          employeeDeductions: s.employeeDeductions ?? [],
          advanceRepayments: s.advanceRepayments ?? [],
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
          // الإصدار 10 (أوامر التعديل): ربط إداري بالعملاء وبنود موسعة ومستندات جديدة
          projects: (s.projects ?? []).map((x) => ({ ...x, clientId: x.clientId ?? null })),
          quotations: (s.quotations ?? []).map((q) => ({
            ...q,
            clientId: q.clientId ?? null,
            lines: (q.lines ?? []).map((l) => ({ ...l, nameAr: l.nameAr ?? l.descriptionAr.slice(0, 40), estCostMinor: l.estCostMinor ?? 0 })),
          })),
          boqItems: (s.boqItems ?? []).map((b) => ({ ...b, estCostMinor: b.estCostMinor ?? 0 })),
          subContracts: (s.subContracts ?? []).map((c) => ({ ...c, supplierId: c.supplierId ?? null, taxWithholdPercent: c.taxWithholdPercent ?? 0, boqItemIds: c.boqItemIds ?? [] })),
          subCertificates: (s.subCertificates ?? []).map((c) => ({ ...c, taxWithholdMinor: c.taxWithholdMinor ?? 0, advanceRecoveryMinor: c.advanceRecoveryMinor ?? 0 })),
          materialRequisitions: s.materialRequisitions ?? [],
          stockMoves: s.stockMoves ?? [],
          clientSettlements: s.clientSettlements ?? [],
          subAdvances: s.subAdvances ?? [],
          approvalFlows: s.approvalFlows ?? [],
          approvalRequests: s.approvalRequests ?? [],
          labTests: s.labTests ?? [],
          labReferrers: s.labReferrers ?? [],
          labPatients: s.labPatients ?? [],
          labOrders: s.labOrders ?? [],
          changeOrders: s.changeOrders ?? [],
          clientAdvances: s.clientAdvances ?? [],
          subPayments: s.subPayments ?? [],
          bonds: s.bonds ?? [],
          dailyWorkers: s.dailyWorkers ?? [],
          dailyWorkRecords: s.dailyWorkRecords ?? [],
          recipes: s.recipes ?? [],
          productionOrders: s.productionOrders ?? [],
          gramPrices: s.gramPrices ?? EMPTY_GRAM_PRICES,
          jewelryProfiles: s.jewelryProfiles ?? [],
          scrapLots: s.scrapLots ?? [],
          scrapSales: s.scrapSales ?? [],
          equipmentCosts: s.equipmentCosts ?? [],
          consignmentCars: s.consignmentCars ?? [],
          driverDues: s.driverDues ?? [],
          insuranceProviders: s.insuranceProviders ?? [],
          insuranceClaims: s.insuranceClaims ?? [],
          variantStocks: s.variantStocks ?? [],
          priceLists: s.priceLists ?? [],
          priceListEntries: s.priceListEntries ?? [],
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
          clinicVisits: s.clinicVisits ?? [],
          treatmentPlans: s.treatmentPlans ?? [],
          clinicCollections: s.clinicCollections ?? [],
          clinicAppointments: s.clinicAppointments ?? [],
          patientAttachments: s.patientAttachments ?? [],
          // ترحيل التاريخ المرضي الحر القديم إلى البنية المنظمة (بلا فقد)
          clinicPatients: (s.clinicPatients ?? []).map((p) => (p.history ? p : { ...p, history: migrateFreeHistory(p.medicalHistory ?? ''), linkedCustomerId: p.linkedCustomerId ?? null })),
          cars: s.cars ?? [],
          // الأمر 23: تذاكر قديمة إجمالياتها بلا حقول الخدمات/التحصيل المجزأ/الربح — تُستكمل بأمان
          tickets: (s.tickets ?? []).map((t: MaintenanceTicket) => {
            if (!t.totals || t.totals.paidMinor != null) return t
            const tot = t.totals
            const paid = t.payment === 'cash' ? tot.grandMinor : 0
            return {
              ...t,
              totals: {
                ...tot,
                servicesPriceMinor: tot.servicesPriceMinor ?? 0,
                servicesCostMinor: tot.servicesCostMinor ?? 0,
                paidMinor: paid,
                creditMinor: tot.grandMinor - paid,
                profitMinor: tot.revenueMinor - tot.partsCostMinor - (tot.servicesCostMinor ?? 0),
              },
            }
          }),
          maintenanceServices: s.maintenanceServices ?? [],
          walletOps: s.walletOps ?? [],
          transfers: s.transfers ?? [],
          batches: s.batches ?? [],
          serials: s.serials ?? [],
          stocktakes: s.stocktakes ?? [],
          wastages: s.wastages ?? [],
          openingBalances: s.openingBalances ?? {},
          settlements: s.settlements ?? [],
          exchanges: s.exchanges ?? [],
          restaurantOrders: s.restaurantOrders ?? [],
          goldTradeIns: s.goldTradeIns ?? [],
          vouchers: s.vouchers ?? [],
          shifts: s.shifts ?? [],
          journal: s.journal ?? [],
        } as DataState
      },
    },
  ),
)
