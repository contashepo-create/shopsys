/**
 * مخزن حالة التطبيق — الإعدادات العامة والثيم ومعالج أول تشغيل
 * (اليوم: localStorage — غداً: جدول settings في SQLite عبر نفس الواجهة)
 */
import { create } from 'zustand'
import { setActiveDeviceFlags } from '../core/featureFlags.ts'
import { DEFAULT_WAREHOUSE_RECEIPT, type WarehouseReceiptSettings } from '../core/warehouseReceipt.ts'
import { persist } from 'zustand/middleware'
import type { Country } from '../core/countries.ts'
import { toggleModuleList, effectiveModules, clampModulesToLicense, withDependencies, ACTIVITY_TEMPLATES, type ActivityTemplate, type ItemFeature, type BusinessModule } from '../core/activities.ts'
import { bindLegacyFiscalYearsToMain as bindFiscalYearsToMain, validateFiscalYear, type FiscalYear } from '../core/fiscal.ts'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '../core/receipt.ts'
import { createJSONStorage } from 'zustand/middleware'
import { settingsAppStorage, registerExternalSnapshotApplier } from '../data/persistentStorage.ts'
import { desktopDeviceIdentity } from '../data/desktopBridge.ts'
import { DEFAULT_PRINTER_PROFILES, normalizePrinterProfiles, type PrinterProfile, type PrintRoute, type PrinterProfiles } from '../core/printers.ts'
import { DEFAULT_LOYALTY, type LoyaltySettings } from '../core/loyalty.ts'
import { DEFAULT_APPROVALS, type ApprovalSettings } from '../core/approvals.ts'
import { generateDeviceId, verifyActivityChangeKey, verifyLicenseKey, auditStoredLicense, ACTIVITY_CHANGE_COOLDOWN_DAYS, daysBetween, isValidIsoDay, oldestValidDay, keyFingerprint, type LicensePayload } from '../core/license.ts'
import { LEGAL_VERSION } from '../core/legal.ts'
import { DEFAULT_APPEARANCE, sanitizeAppearance, activityAccentId, type AppearanceSettings } from '../core/appearance.ts'
import { DEFAULT_TELEGRAM_SETTINGS, type TelegramSettings } from '../core/telegram.ts'
import { DEFAULT_EINVOICE_SETTINGS, type EinvoiceSettings } from '../core/einvoice.ts'
import { branchOfRecord, resolveBranchActivityId, resolveBranchModules, type Branch, type BranchScopedRecord } from '../core/branches.ts'
import { resolveBusinessTax, type BusinessTaxStatus } from '../core/taxRegistration.ts'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '../core/schedule.ts'
import { DEFAULT_REPORT_PRINT, type ReportPrintSettings } from '../core/reportPrint.ts'
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from '../core/labels.ts'
import { DEFAULT_FX_RATES_SETTINGS, normalizeFxRatesSettings, type FxRatesMap, type FxRatesSettings, type FxRateRecord } from '../core/fxRates.ts'
import { DEFAULT_SCALE_RULES, validateScaleRule, type ScaleRule } from '../core/barcode.ts'
import type { AboutContent, CloudNotice } from '../core/cloud.ts'
import type { DeviceFlags } from '../core/featureFlags.ts'
import { todayLocalIso } from '../core/time.ts'

export type ThemeMode = 'light' | 'dark'

export interface SetupState {
  completed: boolean
  countryCode: string | null
  activityId: string | null
  shopName: string
  ownerName: string
  features: ItemFeature[]
  modules: BusinessModule[]
  taxInclusive: boolean
  vatPercent: number
  /** الصفة القانونية منفصلة عن النسبة: المسجل بنسبة صفر ليس معفى */
  taxRegistrationStatus?: BusinessTaxStatus
  accountingMode: 'simple' | 'full'
  /** السماح بالرصيد السالب في الخزائن والبنوك (طلب المالك — الافتراضي: ممنوع) */
  allowNegativeTreasury: boolean
  /**
   * إلزام فتح وردية قبل البيع (النمط العالمي — Toast/Square: كل بيع نقدي يُربط
   * بدرج/وردية مفتوحة كي يُحاسب الكاشير على العجز والزيادة عند الإقفال).
   * الافتراضي: إلزامي. أطفئه فقط لو تعمل وحدك بلا محاسبة ورديات.
   */
  requireOpenShiftForSales: boolean
  /** السماح بالبيع/الصرف برصيد مخزون سالب (الافتراضي: ممنوع) */
  allowNegativeStock: boolean
  /** المخزن الافتراضي للفواتير (إعدادات الفواتير) — null = المخزن الرئيسي */
  defaultWarehouseId: number | null
  // ─── بيانات المنشأة (معالج أول التشغيل — إلزامية بطلب المالك) ───
  phone: string
  email: string
  city: string
  street: string
  /**
   * بيانات المنشأة الرسمية الإضافية (طلب المالك — صفحة «بيانات المنشأة» الموحّدة):
   * كلها اختيارية ولا تمنع التشغيل، لكنها تظهر في المستندات الرسمية عند توفرها.
   * الرقم الضريبي يبقى حقلاً واحداً في إعدادات الفاتورة الإلكترونية (einvoice.taxNumber)
   * — صفحة بيانات المنشأة تحرّره مباشرة فلا يتكرر التخزين في مكانين.
   */
  commercialRegister?: string // رقم السجل التجاري
  poBox?: string // صندوق البريد
  postalCode?: string // الرمز البريدي
  buildingNo?: string // رقم المبنى (العنوان الوطني)
  website?: string // الموقع الإلكتروني
  /** تخصص الطبيب لنشاط العيادة (يختاره/يكتبه المالك في معالج أول تشغيل — لا يُفرض «أسنان») */
  doctorSpecialty: string
  /** v1.0.7: آخر تغيير نشاط بمفتاح الدعم — التقييد 30 يوماً بين تغييرين */
  lastActivityChangeAt: string | null
  /** v1.0.7: الأنشطة المرخصة على الجهاز (الأصلي + كل تغيير موقّع) — مفتاح التفعيل القديم يظل صالحاً */
  activityKeyHistory: string[]
  /** ح8 (مراجعة ③): بصمات مفاتيح تحويل النشاط المطبّقة — المفتاح الواحد لا يُعاد تطبيقه */
  activityKeyFingerprints: string[]
  /**
   * v1.0.24: بصمة «سياسة النواة الموحّدة» — تُكتب مرة واحدة عند ترحيل
   * التخزين القديم (إضافة المخزون والمشتريات لكل نشاط). وجودُها يمنع المِهاجر
   * من إعادة إضافة وحدة أطفأها المالك بنفسه بعد التحديث.
   */
  coreModulesMigratedAt?: string | null
  /**
   * عتبة التحذير الاستباقي من حد الائتمان (سد فجوة النشاط #2: تجارة الأعلاف
   * والحبوب) — كانت نسبة 85% ثابتة في الكود؛ الآن قابلة للتخصيص بالإعدادات.
   * undefined/null = الافتراضي 85.
   */
  creditWarningThresholdPercent?: number | null
}

/** سياق الفرع النشط الذي يمرره مخزن البيانات إلى إعدادات التطبيق العامة. */
export type AppBranchContext = Pick<Branch, 'id' | 'nameAr' | 'isMain' | 'warehouseId' | 'customModulesMode' | 'enabledModules' | 'activityId'>

/**
 * الهوية القانونية والتجارية التي تملكها كل منشأة/فرع بصورة مستقلة.
 * الرقم الضريبي يبقى في einvoice.taxNumber حتى لا يتكرر مصدر الحقيقة.
 */
export interface BranchLegalIdentity {
  shopName?: string
  phone?: string
  email?: string
  website?: string
  city?: string
  street?: string
  buildingNo?: string
  postalCode?: string
  poBox?: string
  commercialRegister?: string
}

/**
 * ملف أعمال مستقل لكل فرع غير رئيسي. الهوية القانونية وإعدادات الطباعة
 * تُحفظ هنا كاملة ولا تُستعار من الملف الأساسي للفرع الرئيسي.
 */
export interface BranchBusinessProfile {
  shopName: string
  phone: string
  email: string
  website?: string
  city: string
  street: string
  buildingNo?: string
  postalCode?: string
  poBox?: string
  commercialRegister?: string
  vatPercent: number
  taxInclusive: boolean
  taxRegistrationStatus?: BusinessTaxStatus
  doctorSpecialty: string
  allowNegativeTreasury: boolean
  allowNegativeStock: boolean
  requireOpenShiftForSales: boolean
  receiptShopName: string
  /** تصميم الإيصال والفاتورة لهذا الفرع وحده (اختياري للتوافق مع ملفات قديمة) */
  receipt?: ReceiptSettings
  /** تصميم طباعة التقارير لهذا الفرع وحده (اختياري للتوافق مع ملفات قديمة) */
  reportPrint?: ReportPrintSettings
  einvoice: EinvoiceSettings
  approvals: ApprovalSettings
}

export interface BranchEffectiveAppSettings {
  setup: SetupState
  receipt: ReceiptSettings
  einvoice: EinvoiceSettings
  approvals: ApprovalSettings
  reportPrint: ReportPrintSettings
}

export interface BranchAppSettingsState {
  setup: SetupState
  companySetup?: SetupState
  branchBusinessProfiles?: Record<number, BranchBusinessProfile>
  receipt: ReceiptSettings
  baseReceipt?: ReceiptSettings
  einvoice: EinvoiceSettings
  baseEinvoice?: EinvoiceSettings
  approvals: ApprovalSettings
  baseApprovals?: ApprovalSettings
  reportPrint: ReportPrintSettings
  baseReportPrint?: ReportPrintSettings
}

/**
 * تفضيلات أعمدة جدول البنود — أعمدة **عرضية** فقط (لا تحمل إدخالاً):
 * كود الصنف · الوحدة · عمود الضريبة. (سطر التفاصيل أسفل الاسم أُلغي نهائياً
 * بقرار المالك ⑩ي: خلية الاسم تحمل اسم الصنف فقط.)
 */
export interface InvoiceColumnPrefs {
  code: boolean
  unit: boolean
  tax: boolean
}

/* عمود الضريبة مخفي افتراضياً (قرار المالك v1.0.3 ④) ويُعاد من «تخصيص الحقول».
   خانة الضريبة المستقلة لكل بند تعيش داخل هذا العمود نفسه؛ إخفاؤه افتراضياً
   لا يمنع الحساب التلقائي من نسبة الإعدادات — فقط يُخفي إمكانية استثناء بند
   بعينه حتى يفتحها من يحتاجها عبر «تخصيص الحقول». */
export const DEFAULT_INVOICE_COLUMNS: InvoiceColumnPrefs = { code: true, unit: true, tax: false }

/** أسماء الأعمدة كما تظهر في قائمة «تخصيص الحقول» */
export const INVOICE_COLUMN_LABELS: Record<keyof InvoiceColumnPrefs, string> = {
  code: 'كود الصنف',
  unit: 'وحدة القياس',
  tax: 'عمود الضريبة (الربحية والمتقدمة فقط)',
}

interface AppState {
  theme: ThemeMode
  toggleTheme: () => void
  /** v1.0.8: موافقة الاتفاقية والخصوصية (الإصدار والتاريخ) — null = لم يوافق بعد */
  legal: { version: string; acceptedAt: string } | null
  acceptLegal: () => void
  /** الإعدادات العامة الأساسية؛ setup في الواجهة هو النسخة الفعالة بعد تراكب إعداد الفرع. */
  setup: SetupState
  companySetup: SetupState
  activeBranchContext: AppBranchContext | null
  branchBusinessProfiles: Record<number, BranchBusinessProfile>
  setActiveBranchContext: (branch: AppBranchContext | null) => void
  removeBranchBusinessProfile: (branchId: number) => void
  updateSetup: (patch: Partial<SetupState>) => void
  updateCompanyName: (name: string) => void
  updateTaxSettings: (patch: Pick<SetupState, 'vatPercent' | 'taxInclusive' | 'taxRegistrationStatus'>) => void
  fiscalYears: FiscalYear[]
  /** يربط السنوات القديمة غير المنسوبة بالفرع الرئيسي عند تفعيل نموذج الفروع. */
  bindLegacyFiscalYearsToMain: (branchId: number) => void
  /** ينشئ السنة الافتتاحية لفرع جديد بعد التحقق. */
  addBranchFiscalYear: (branchId: number, fy: Omit<FiscalYear, 'id' | 'status' | 'branchId'>) => void
  completeSetup: (data: {
    country: Country
    activity: ActivityTemplate
    shopName: string
    ownerName: string
    fiscalYear: Omit<FiscalYear, 'id' | 'status'>
    contact?: { phone: string; email: string; city: string; street: string }
    doctorSpecialty?: string
  }) => void
  addFiscalYear: (fy: Omit<FiscalYear, 'id' | 'status'>) => void
  /** وسم سنة مالية مقفلة — يُستدعى بعد نجاح قيد الإقفال في repo (closeFiscalYear) */
  markFiscalYearClosed: (id: number) => void
  reopenFiscalYear: (id: number) => void
  setAccountingMode: (m: 'simple' | 'full') => void
  /** تفعيل/إلغاء وحدة عمل من الإعدادات (طلب المالك: الوحدات حسب النشاط وقابلة للتبديل) */
  toggleModule: (m: BusinessModule) => void
  resetSetup: () => void
  /**
   * صفحة «بيانات المنشأة» الموحّدة (طلب المالك): تحديث حر لهوية المنشأة
   * وبيانات التواصل والعنوان والسجل التجاري بعد الإعداد الأول — كانت تُكتب
   * مرة واحدة فقط بالمعالج بلا أي شاشة لاحقة لتعديلها.
   */
  updateCompanyProfile: (patch: Partial<Pick<SetupState,
    'shopName' | 'ownerName' | 'phone' | 'email' | 'city' | 'street' |
    'commercialRegister' | 'poBox' | 'postalCode' | 'buildingNo' | 'website'
  >>) => void
  receipt: ReceiptSettings
  baseReceipt: ReceiptSettings
  /** §102 (تعدد الطابعات): مسار لكل نسخة مطبوعة — اسم الطابعة + طباعة آلية */
  printerProfiles: PrinterProfiles
  setPrinterProfile: (route: PrintRoute, patch: Partial<PrinterProfile>) => void
  /** برنامج نقاط الولاء (نمط Lightspeed Loyalty) — الكسب والاستبدال من الكاشير */
  loyalty: LoyaltySettings
  approvals: ApprovalSettings
  baseApprovals: ApprovalSettings
  updateApprovals: (patch: Partial<ApprovalSettings>) => void
  updateLoyalty: (patch: Partial<LoyaltySettings>) => void
  /** إعدادات طباعة التقارير الفعالة للفرع الحالي؛ baseReportPrint هو ملف الرئيسي. */
  reportPrint: ReportPrintSettings
  baseReportPrint: ReportPrintSettings
  updateReportPrint: (patch: Partial<ReportPrintSettings>) => void
  /** قالب ملصقات الباركود/السيريال — يُضبط مرة ويسري على كل الطباعات (طلب المالك) */
  labelSettings: LabelSettings
  updateLabelSettings: (patch: Partial<LabelSettings>) => void
  /**
   * أسعار الصرف المركزية (طلب المالك 2026-10-01): سعر محفوظ لكل عملة يستعمله
   * الفاتورة/السند افتراضياً. التعديل يدوي أو من API — والمسؤول عنه المالك
   * فقط (بواجهة تطلب الرقم السري عند الحفظ).
   */
  fxRates: FxRatesMap
  fxRatesSettings: FxRatesSettings
  setFxRate: (code: string, ratePpm: number, updatedBy: string) => void
  applyFxApiQuotes: (quotes: { code: string; ratePpm: number }[], updatedBy: string) => number
  updateFxRatesSettings: (patch: Partial<FxRatesSettings>) => void
  /** قواعد باركود الميزان العالمية (أي ميزان بأي صيغة) — تُجرب بالترتيب في الكاشير */
  scaleRules: ScaleRule[]
  addScaleRule: (rule: Omit<ScaleRule, 'id'>) => void
  updateScaleRule: (id: number, patch: Partial<Omit<ScaleRule, 'id'>>) => void
  removeScaleRule: (id: number) => void
  autoPrintAfterSale: boolean
  /**
   * أعمدة جدول بنود الفاتورة القابلة للإخفاء (زر «تخصيص الحقول» في شريط الفاتورة).
   * **إخفاء عمود عرضٌ فقط ولا يغيّر أي حساب**: الضريبة تُحتسب وتظهر في ملخص
   * الحسابات وفي القيد سواء ظهر عمودها أم لا. لذلك تُمنع هنا الأعمدة التي
   * تُدخَل منها القيم (الكمية/السعر/الخصم/المخزن) — تلك لا تُخفى أبداً.
   */
  invoiceColumns: InvoiceColumnPrefs
  toggleInvoiceColumn: (key: keyof InvoiceColumnPrefs) => void
  resetInvoiceColumns: () => void
  /** إعدادات «إذن استلام المستودع» — كميات فقط، تُفتح من الفاتورة ومن إعدادات الطباعة */
  warehouseReceipt: WarehouseReceiptSettings
  updateWarehouseReceipt: (patch: Partial<WarehouseReceiptSettings>) => void
  resetWarehouseReceipt: () => void
  updateReceipt: (patch: Partial<ReceiptSettings>) => void
  setAutoPrint: (v: boolean) => void
  appearance: AppearanceSettings
  updateAppearance: (patch: Partial<AppearanceSettings>) => void
  telegram: TelegramSettings
  updateTelegram: (patch: Partial<TelegramSettings>) => void
  // ─── الفاتورة الإلكترونية (القرار 30 — ميزة بمفتاح ترخيص فقط) ───
  einvoice: EinvoiceSettings
  baseEinvoice: EinvoiceSettings
  updateEinvoice: (patch: Partial<EinvoiceSettings>) => void
  // ─── الإرسال المجدول عبر التليجرام (القرار 32) ───
  schedule: ScheduleSettings
  updateSchedule: (patch: Partial<ScheduleSettings>) => void
  /** §102 مضيف شبكة المحل — هذا الجهاز يخدم قاعدة واحدة لأجهزة المحل */
  lanHost: LanHostSettings
  updateLanHost: (patch: Partial<LanHostSettings>) => void
  /** §102 عميل شبكة المحل — هذا الجهاز يتصل بمضيف المحل */
  lanClient: LanClientSettings
  updateLanClient: (patch: Partial<LanClientSettings>) => void
  lastDailySentDay: string | null // «YYYY-MM-DD» — يمنع تكرار إرسال اليوم
  setLastDailySentDay: (day: string) => void
  // ─── الترخيص (القرار 4) ───
  deviceId: string // معرف الجهاز — يتولد مرة واحدة
  trialStartedAt: string // مرساة بداية التجربة
  lastSeenAt: string // مرساة ضد إرجاع الساعة
  activatedKey: string | null // مفتاح التفعيل النصي كما أدخل
  activatedPayload: LicensePayload | null // حمولته الموثقة بعد التحقق
  /**
   * ث1 (تدقيق 2026-10-08): حالة فحص سلامة الترخيص عند الإقلاع.
   * `checking` = جارٍ إعادة التحقق من توقيع المفتاح — لا يُحكم على الترخيص
   * ولا تُعرض شاشة القفل قبل انتهائه (وإلا ومضت شاشة قفل لعميل مفعّل).
   */
  /**
   * ث9: `unverifiable` = بيئة لا تتيح التحقق من التوقيع (لا WebCrypto — سياق
   * غير آمن http:// مثلاً). المفتاح **يُحفظ** ولا يُحذف: حذفه يُفقد عميلاً
   * مدفوعاً مفتاحه لسبب لا يد له فيه، ولا يستعيده إلا بإعادة إصدار من المطوّر.
   */
  licenseAudit: { status: 'checking' | 'verified' | 'no_key' | 'tampered' | 'unverifiable'; reason?: string; at?: string }
  /** إعادة اشتقاق الحمولة من المفتاح الموقّع + قصّ الوحدات غير الممنوحة — تُنفَّذ في كل إقلاع */
  reverifyActivation: () => Promise<void>
  /**
   * بند 5 (تدقيق 2026-10-08): اليوم الذي أسكت فيه المستخدم شريط «قرب انتهاء
   * الاشتراك» — الشريط لا يعود قبل الغد (حق الإسكات = الرسالة غير مزعجة فعلاً).
   * إدراج الجرس لا يتأثر بالإسكات.
   */
  renewalDismissedDay: string | null
  dismissRenewalNotice: (day?: string) => void
  /**
   * بند 2 (تدقيق 2026-10-08): متى أُبلغ المطوّر بهذا التسجيل — مرة واحدة لكل
   * جهاز. تُحفظ عند **نجاح** الإرسال فقط، فيُعاد المحاولة في الإقلاع التالي لو
   * كان العميل أوفلاين (بند 6: لا إجبار على الإنترنت ولا تعطيل للعمل).
   */
  registrationReportedAt: string | null
  markRegistrationReported: (at?: string) => void
  setActivated: (key: string, payload: LicensePayload) => void
  /** v1.0.7: تطبيق مفتاح تغيير النشاط الموقّع (SHOPSYS2) — يعيد اسم النشاط الجديد */
  applyActivityChangeKey: (key: string, pubB64u?: string) => Promise<string>
  clearActivation: () => void
  touchLastSeen: () => void
  // ─── السحابة (القرار 28): آخر ما جُلب من Cloudflare — يعمل أوفلاين بآخر نسخة ───
  cloudAbout: AboutContent | null
  /** رسالة المطوّر لهذا الجهاز (عرض فقط) — تُحفظ آخر قيمة للعمل أوفلاين */
  cloudAccountMessage: string
  revokedKeys: string[] // بصمات المفاتيح المحروقة
  cloudNotifications: CloudNotice[]
  cloudSyncedAt: string | null
  setCloudData: (patch: { about?: AboutContent | null; accountMessage?: string; revoked?: string[]; flags?: DeviceFlags | null; notifications?: CloudNotice[] }) => void
  /**
   * بند 10 (تدقيق 2026-10-08): التنبيهات التي أقرّ بها المستخدم — تُحفظ محلياً
   * فلا تعود النافذة المنبثقة، ويُرسل إيصال قراءة للمطوّر (best-effort).
   */
  ackedNoticeIds: string[]
  ackNotice: (id: string) => void
  /** أعلام الميزات عن بُعد (البند 5): المطفأ سحابياً من الميزات الممنوحة — kill-switch فقط */
  deviceFlags: DeviceFlags | null
  // ─── النسخ الاحتياطي التلقائي (القرار 28 + جدولة بطلب المالك) ───
  lastHourlyBackupAt: string | null
  setLastHourlyBackupAt: (iso: string) => void
  /** فاصل النسخ التلقائي بالدقائق — الافتراضي 60 (كل ساعة) */
  backupIntervalMinutes: number
  setBackupIntervalMinutes: (minutes: number) => void
  // ─── المزامنة السحابية متعددة الأجهزة (Supabase — ميزة cloud_sync المدفوعة) ───
  sync: SyncSettings
  updateSync: (patch: Partial<SyncSettings>) => void
}

/** إعدادات مضيف شبكة المحل (§102) — تُخزن لكل جهاز */
export interface LanHostSettings {
  enabled: boolean
  /** رمز الاقتران الذي يُدخله كل جهاز مرة واحدة */
  pairingCode: string
  /** منفذ الاستماع (افتراضي 8787) */
  port: number
  /** اسم يظهر للأجهزة عند اللقطة */
  hostName: string
}

/** إعدادات عميل شبكة المحل (§102) — العنوان والتوكن يُحفظان لكل جهاز */
export interface LanClientSettings {
  enabled: boolean
  /** ws://192.168.1.10:8787 */
  hostUrl: string
  /** توكن الجهاز بعد أول اقتران ناجح — يتيح العودة بلا رمز */
  token: string | null
  /** اسم هذا الجهاز عند المضيف */
  deviceName: string
}

export const DEFAULT_LAN_HOST_SETTINGS: LanHostSettings = {
  enabled: false,
  pairingCode: '',
  port: 8787,
  hostName: 'مضيف محل تَحَكَّم',
}

export const DEFAULT_LAN_CLIENT_SETTINGS: LanClientSettings = {
  enabled: false,
  hostUrl: '',
  token: null,
  deviceName: '',
}

export interface SyncSettings {
  enabled: boolean
  url: string
  anonKey: string
  storeId: string
  secret: string
  /** اعتماد RLS عشوائي 256-bit، منفصل عن سر تشفير المحتوى */
  accessToken: string
  lastKnownRev: number // آخر مراجعة سحابية طبقها هذا الجهاز
  lastSyncedAt: string | null
  lastResult: string | null // آخر رسالة نتيجة للعرض
  dirty: boolean // توجد تغييرات محلية لم تُدفع بعد
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false, url: '', anonKey: '', storeId: '', secret: '', accessToken: '',
  lastKnownRev: 0, lastSyncedAt: null, lastResult: null, dirty: false,
}

/**
 * توليد معرف جهاز + مراسي زمنية عند أول تشغيل.
 * مرساة ثانية مستقلة (shopsys-i) تنجو من مسح بيانات التطبيق:
 * لو مسح المستخدم قاعدة البيانات لإعادة عدّاد التجربة، تُستعاد بداية التجربة
 * الأصلية ومعرف الجهاز الأصلي من هذه المرساة — فلا تتجدد التجربة أبداً.
 */
const IDENTITY_ANCHOR_KEY = 'shopsys-i'

/** قراءة مرساة الهوية من التخزين المحلي (base64) — أو null */
const readLocalIdentityAnchor = (): { deviceId: string; firstTrialAt: string } | null => {
  try {
    const raw = localStorage.getItem(IDENTITY_ANCHOR_KEY)
    if (raw) {
      const a = JSON.parse(atob(raw)) as { d?: string; t?: string }
      if (typeof a.d === 'string' && a.d && typeof a.t === 'string' && a.t) {
        return { deviceId: a.d, firstTrialAt: a.t }
      }
    }
  } catch { /* مرساة تالفة — تُعاد كتابتها أدناه */ }
  return null
}

/** كتابة مرساة الهوية محلياً (مرآة لمرساة العملية الرئيسية) */
const writeLocalIdentityAnchor = (deviceId: string, firstTrialAt: string): void => {
  try {
    localStorage.setItem(IDENTITY_ANCHOR_KEY, btoa(JSON.stringify({ d: deviceId, t: firstTrialAt })))
  } catch { /* تخزين ممتلئ — نكمل بالقيم الحالية */ }
}

const bootIdentity = (): { deviceId: string; now: string; firstTrialAt: string } => {
  const nowIso = new Date().toISOString()
  const local = readLocalIdentityAnchor()
  /* بند 2 (طلب المالك): على سطح المكتب العملية الرئيسية هي المرجع — ملف الهوية
     في userData **خارج** القاعدة ⇒ مسح القاعدة (أو فقد مرساة Chromium) لا يغيّر
     المعرّف، فيبقى العميل في لوحة المطوّر عميلاً قديماً لا جديداً، ويبقى
     الترخيص المرتبط بالجهاز صالحاً. القراءة **متزامنة** لأن فحص الترخيص يحتاج
     المعرّف فور الإقلاع. */
  const desktop = desktopDeviceIdentity()
  if (desktop) {
    try {
      const anchored = desktop({ deviceId: local?.deviceId, firstTrialAt: local?.firstTrialAt })
      if (anchored && typeof anchored.deviceId === 'string' && anchored.deviceId) {
        const firstTrialAt = anchored.firstTrialAt ?? local?.firstTrialAt ?? nowIso
        if (!local || local.deviceId !== anchored.deviceId || local.firstTrialAt !== firstTrialAt) {
          writeLocalIdentityAnchor(anchored.deviceId, firstTrialAt)
        }
        return { deviceId: anchored.deviceId, now: nowIso, firstTrialAt }
      }
    } catch { /* الجسر غير متاح أو فشل — نكمل بمرساة التخزين المحلي */ }
  }
  if (local) return { deviceId: local.deviceId, now: nowIso, firstTrialAt: local.firstTrialAt }
  const rnd = new Uint8Array(12)
  crypto.getRandomValues(rnd)
  const deviceId = generateDeviceId(rnd)
  writeLocalIdentityAnchor(deviceId, nowIso)
  return { deviceId, now: nowIso, firstTrialAt: nowIso }
}
const BOOT = bootIdentity()

const DEFAULT_SETUP_STATE: SetupState = {
  completed: false,
  countryCode: null,
  activityId: null,
  shopName: '',
  ownerName: '',
  features: [],
  modules: [],
  taxInclusive: true,
  vatPercent: 14,
  taxRegistrationStatus: 'registered',
  accountingMode: 'simple',
  allowNegativeTreasury: false,
  allowNegativeStock: false,
  requireOpenShiftForSales: true,
  defaultWarehouseId: null,
  phone: '', email: '', city: '', street: '',
  commercialRegister: '', poBox: '', postalCode: '', buildingNo: '', website: '',
  doctorSpecialty: '',
  lastActivityChangeAt: null,
  activityKeyHistory: [],
  activityKeyFingerprints: [],
  coreModulesMigratedAt: null,
}

const cleanIdentityValue = (value: string | null | undefined) => (value ?? '').trim()

/** الحقول الأساسية التي إن نقص أيٌّ منها تُطبع هوية الفرع باسمها فقط مع تنبيه. */
export function branchIdentityMissingFields(
  identity: BranchLegalIdentity | null | undefined,
  einvoice?: Pick<EinvoiceSettings, 'taxNumber'> | null,
): string[] {
  const missing: string[] = []
  if (!cleanIdentityValue(identity?.shopName)) missing.push('اسم المنشأة')
  if (!cleanIdentityValue(einvoice?.taxNumber)) missing.push('الرقم الضريبي')
  if (!cleanIdentityValue(identity?.commercialRegister)) missing.push('السجل التجاري')
  if (!cleanIdentityValue(identity?.city) || !cleanIdentityValue(identity?.street)) missing.push('العنوان')
  if (!cleanIdentityValue(identity?.phone)) missing.push('الهاتف')
  return missing
}

function branchIdentityHeaderLines(identity: SetupState, einvoice: EinvoiceSettings): string[] {
  const lines: string[] = []
  const address = [
    cleanIdentityValue(identity.city),
    cleanIdentityValue(identity.street),
    cleanIdentityValue(identity.buildingNo) ? `مبنى ${cleanIdentityValue(identity.buildingNo)}` : '',
    cleanIdentityValue(identity.postalCode) ? `الرمز البريدي ${cleanIdentityValue(identity.postalCode)}` : '',
    cleanIdentityValue(identity.poBox) ? `صندوق بريد ${cleanIdentityValue(identity.poBox)}` : '',
  ].filter(Boolean).join('، ')
  if (address) lines.push(`العنوان: ${address}`)
  if (cleanIdentityValue(identity.phone)) lines.push(`الهاتف: ${cleanIdentityValue(identity.phone)}`)
  const electronicContact = [cleanIdentityValue(identity.email), cleanIdentityValue(identity.website)].filter(Boolean).join(' · ')
  if (electronicContact) lines.push(electronicContact)
  if (cleanIdentityValue(einvoice.taxNumber)) lines.push(`الرقم الضريبي: ${cleanIdentityValue(einvoice.taxNumber)}`)
  if (cleanIdentityValue(identity.commercialRegister)) lines.push(`السجل التجاري: ${cleanIdentityValue(identity.commercialRegister)}`)
  return lines
}

function withBranchIdentityHeaderLines(
  receipt: ReceiptSettings,
  identitySetup: SetupState,
  einvoice: EinvoiceSettings,
  nameOnlyWhenIncomplete: boolean,
): ReceiptSettings {
  // «اسم فقط» عند نقص الهوية يتقدم حتى على ترويسة مخصصة/قديمة؛ بذلك لا
  // يتسرب رقم أو عنوان قديم من بيانات رئيسية منسوخة إلى مستند الفرع.
  if (nameOnlyWhenIncomplete && branchIdentityMissingFields(identitySetup, einvoice).length > 0) {
    // الفرع غير المكتمل يطبع اسمه وحده: لا ترويسة تعريفية ولا شعار ناقص.
    return { ...receipt, headerLines: [], logoDataUrl: '' }
  }
  const identityLines = branchIdentityHeaderLines(identitySetup, einvoice)
  const headerLines = [...new Set([
    ...identityLines,
    ...receipt.headerLines.filter((line) => line.trim()),
  ])]
  return headerLines.length ? { ...receipt, headerLines } : receipt
}

function sanitizedBranchReceipt(baseReceipt: ReceiptSettings, shopName: string): ReceiptSettings {
  return {
    ...baseReceipt,
    shopName,
    // عناصر التصميم تُنسخ كنقطة بداية، أما أي نص/شعار قد يحمل هوية الرئيسي فلا ينتقل.
    headerLines: [],
    footerText: DEFAULT_RECEIPT_SETTINGS.footerText,
    logoDataUrl: '',
    watermarkEnabled: false,
    watermarkText: '',
  }
}

function sanitizedBranchReportPrint(baseReportPrint: ReportPrintSettings): ReportPrintSettings {
  return {
    ...baseReportPrint,
    headerLine: '',
    footerText: '',
    watermarkEnabled: false,
    watermarkText: '',
  }
}

function branchReceiptFromProfile(profile: BranchBusinessProfile, baseReceipt: ReceiptSettings): ReceiptSettings {
  const shopName = profile.receipt?.shopName || profile.receiptShopName || profile.shopName
  if (profile.receipt) return { ...DEFAULT_RECEIPT_SETTINGS, ...profile.receipt, shopName }
  return sanitizedBranchReceipt(baseReceipt, shopName)
}

function branchReportPrintFromProfile(profile: BranchBusinessProfile, baseReportPrint: ReportPrintSettings): ReportPrintSettings {
  if (profile.reportPrint) return { ...DEFAULT_REPORT_PRINT, ...profile.reportPrint }
  return sanitizedBranchReportPrint(baseReportPrint)
}

function withBranchReportIdentity(
  settings: ReportPrintSettings,
  identitySetup: SetupState,
  einvoice: EinvoiceSettings,
  nameOnlyWhenIncomplete: boolean,
): ReportPrintSettings {
  if (nameOnlyWhenIncomplete && branchIdentityMissingFields(identitySetup, einvoice).length > 0) {
    return { ...settings, headerLine: '' }
  }
  const identityLine = branchIdentityHeaderLines(identitySetup, einvoice).join(' · ')
  const headerLine = [...new Set([identityLine, cleanIdentityValue(settings.headerLine)].filter(Boolean))].join(' · ')
  return headerLine ? { ...settings, headerLine } : settings
}

function branchProfileFromBase(
  setup: SetupState,
  receipt: ReceiptSettings,
  einvoice: EinvoiceSettings,
  approvals: ApprovalSettings,
  branchName = '',
  reportPrint: ReportPrintSettings = DEFAULT_REPORT_PRINT,
): BranchBusinessProfile {
  const shopName = branchName
  return {
    shopName,
    // هوية قانونية جديدة تبدأ فارغة عمداً: لا نسخ من بيانات الفرع الرئيسي.
    phone: '',
    email: '',
    website: '',
    city: '',
    street: '',
    buildingNo: '',
    postalCode: '',
    poBox: '',
    commercialRegister: '',
    vatPercent: setup.vatPercent,
    taxInclusive: setup.taxInclusive,
    taxRegistrationStatus: setup.taxRegistrationStatus,
    doctorSpecialty: setup.doctorSpecialty ?? '',
    allowNegativeTreasury: setup.allowNegativeTreasury,
    allowNegativeStock: setup.allowNegativeStock,
    requireOpenShiftForSales: setup.requireOpenShiftForSales,
    receiptShopName: shopName,
    receipt: sanitizedBranchReceipt(receipt, shopName),
    reportPrint: sanitizedBranchReportPrint(reportPrint),
    // تفضيلات الإصدار قد تُنسخ، أما الرقم الضريبي وعنوان الممول فهوية مستقلة.
    einvoice: { ...einvoice, taxNumber: '', address: '' },
    approvals: { ...approvals, scope: [...approvals.scope], approverUserIds: [...approvals.approverUserIds], autoApprovedUserIds: [...approvals.autoApprovedUserIds] },
  }
}

function effectiveBranchAppSettings(
  companySetup: SetupState,
  branch: AppBranchContext | null,
  profiles: Record<number, BranchBusinessProfile>,
  baseReceipt: ReceiptSettings,
  baseEinvoice: EinvoiceSettings,
  baseApprovals: ApprovalSettings,
  baseReportPrint: ReportPrintSettings = DEFAULT_REPORT_PRINT,
): BranchEffectiveAppSettings {
  if (!branch || branch.isMain) {
    return {
      setup: companySetup,
      receipt: withBranchIdentityHeaderLines(baseReceipt, companySetup, baseEinvoice, false),
      einvoice: baseEinvoice,
      approvals: baseApprovals,
      reportPrint: withBranchReportIdentity(baseReportPrint, companySetup, baseEinvoice, false),
    }
  }
  const profile = profiles[branch.id]
    ?? branchProfileFromBase(companySetup, baseReceipt, baseEinvoice, baseApprovals, branch.nameAr, baseReportPrint)
  const activityId = resolveBranchActivityId(branch, companySetup.activityId)
  const activity = ACTIVITY_TEMPLATES.find((candidate) => candidate.id === activityId)
  const setup: SetupState = {
    ...companySetup,
    // الهوية القانونية للفرع مستقلة؛ الحقول الغائبة في ملفات قديمة تبقى فارغة ولا ترث الرئيسي.
    shopName: profile.shopName || branch.nameAr,
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    website: profile.website ?? '',
    city: profile.city ?? '',
    street: profile.street ?? '',
    buildingNo: profile.buildingNo ?? '',
    postalCode: profile.postalCode ?? '',
    poBox: profile.poBox ?? '',
    commercialRegister: profile.commercialRegister ?? '',
    vatPercent: profile.vatPercent,
    taxInclusive: profile.taxInclusive,
    taxRegistrationStatus: profile.taxRegistrationStatus,
    doctorSpecialty: profile.doctorSpecialty,
    allowNegativeTreasury: profile.allowNegativeTreasury,
    allowNegativeStock: profile.allowNegativeStock,
    requireOpenShiftForSales: profile.requireOpenShiftForSales,
    activityId,
    defaultWarehouseId: branch.warehouseId,
    modules: resolveBranchModules(branch, companySetup.modules),
    features: activity?.features ?? companySetup.features,
  }
  const rawReceipt = branchReceiptFromProfile({ ...profile, shopName: setup.shopName }, baseReceipt)
  return {
    setup,
    receipt: withBranchIdentityHeaderLines(rawReceipt, setup, profile.einvoice, true),
    einvoice: profile.einvoice,
    approvals: profile.approvals,
    reportPrint: withBranchReportIdentity(branchReportPrintFromProfile(profile, baseReportPrint), setup, profile.einvoice, true),
  }
}

/** إعدادات أي فرع بعينه دون تغيير الفرع النشط — أساس طباعة مستندات الفروع الأخرى. */
export function resolveBranchAppSettings(
  state: BranchAppSettingsState,
  branch: AppBranchContext | Branch | null | undefined,
): BranchEffectiveAppSettings {
  return effectiveBranchAppSettings(
    state.companySetup ?? state.setup,
    branch ?? null,
    state.branchBusinessProfiles ?? {},
    state.baseReceipt ?? state.receipt,
    state.baseEinvoice ?? state.einvoice,
    state.baseApprovals ?? state.approvals,
    state.baseReportPrint ?? state.reportPrint,
  )
}

/**
 * هوية المستند نفسه: branchId الصريح أولاً، ثم مخزن/خزينة المستند، ثم الرئيسي
 * للسجلات القديمة وحدها. لا علاقة للنتيجة بالفرع المعروض حالياً في الواجهة.
 */
export function resolveDocumentBranchAppSettings(
  state: BranchAppSettingsState,
  record: BranchScopedRecord | object | null | undefined,
  branches: readonly Branch[],
  warehouses: readonly { id: number; branchId?: number | null }[] = [],
  treasuries: readonly { code: string; branchId?: number | null }[] = [],
): { branch: Branch | null } & BranchEffectiveAppSettings {
  const branch = branchOfRecord(record, branches, warehouses, treasuries)
  return { branch, ...resolveBranchAppSettings(state, branch) }
}

function companySetupPatch(state: AppState, patch: Partial<SetupState>): Partial<AppState> {
  const branch = state.activeBranchContext
  const baseReportPrint = state.baseReportPrint ?? state.reportPrint
  if (branch && !branch.isMain) {
    // الهوية القانونية للفرع تُعدَّل من داخله وتُحفظ في ملفه فقط. ownerName
    // والدولة والعملة والترخيص ما تزال على مستوى قاعدة البيانات/المنشأة الأم.
    const branchSettingKeys = new Set<keyof SetupState>([
      'shopName', 'phone', 'email', 'website', 'city', 'street', 'buildingNo', 'postalCode', 'poBox', 'commercialRegister',
      'doctorSpecialty', 'allowNegativeTreasury', 'allowNegativeStock', 'requireOpenShiftForSales',
    ])
    const unsupported = Object.keys(patch).filter((key) => !branchSettingKeys.has(key as keyof SetupState))
    if (unsupported.length) throw new Error('الإعدادات العامة للشركة لا تُعدّل من داخل فرع مستقل — غيّر الفرع إلى الرئيسي أولاً')
    const current = state.branchBusinessProfiles[branch.id]
      ?? branchProfileFromBase(state.companySetup ?? state.setup, state.baseReceipt, state.baseEinvoice, state.baseApprovals, branch.nameAr, baseReportPrint)
    const nextProfile = { ...current, ...patch }
    if (patch.shopName && patch.shopName !== current.shopName) {
      nextProfile.receiptShopName = patch.shopName
      if (nextProfile.receipt) nextProfile.receipt = { ...nextProfile.receipt, shopName: patch.shopName }
    }
    const branchBusinessProfiles = { ...state.branchBusinessProfiles, [branch.id]: nextProfile }
    const companySetup = state.companySetup ?? state.setup
    return {
      branchBusinessProfiles,
      ...effectiveBranchAppSettings(companySetup, branch, branchBusinessProfiles, state.baseReceipt, state.baseEinvoice, state.baseApprovals, baseReportPrint),
    }
  }
  const companySetup = { ...(state.companySetup ?? state.setup), ...patch }
  const baseReceipt = patch.shopName != null
    ? { ...state.baseReceipt, shopName: patch.shopName }
    : state.baseReceipt
  return {
    companySetup,
    baseReceipt,
    ...effectiveBranchAppSettings(companySetup, branch, state.branchBusinessProfiles, baseReceipt, state.baseEinvoice, state.baseApprovals, baseReportPrint),
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      /* v1.0.8: موافقة الاتفاقية والخصوصية — تسجل بالإصدار والتاريخ وتطلب مجدداً عند التحديث */
      legal: null as { version: string; acceptedAt: string } | null,
      acceptLegal: () => set({ legal: { version: LEGAL_VERSION, acceptedAt: new Date().toISOString() } }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      setup: DEFAULT_SETUP_STATE,
      companySetup: DEFAULT_SETUP_STATE,
      activeBranchContext: null,
      branchBusinessProfiles: {},
      setActiveBranchContext: (branch) => set((s) => {
        const nextBranch = branch ? { ...branch } : null
        if (s.activeBranchContext?.id === nextBranch?.id
          && s.activeBranchContext?.nameAr === nextBranch?.nameAr
          && s.activeBranchContext?.isMain === nextBranch?.isMain
          && s.activeBranchContext?.warehouseId === nextBranch?.warehouseId
          && s.activeBranchContext?.customModulesMode === nextBranch?.customModulesMode
          && s.activeBranchContext?.activityId === nextBranch?.activityId
          && JSON.stringify(s.activeBranchContext?.enabledModules ?? []) === JSON.stringify(nextBranch?.enabledModules ?? [])) return {}
        let branchBusinessProfiles = s.branchBusinessProfiles ?? {}
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (nextBranch && !nextBranch.isMain && !branchBusinessProfiles[nextBranch.id]) {
          branchBusinessProfiles = {
            ...branchBusinessProfiles,
            [nextBranch.id]: branchProfileFromBase(s.companySetup ?? s.setup, s.baseReceipt ?? s.receipt, s.baseEinvoice ?? s.einvoice, s.baseApprovals ?? s.approvals, nextBranch.nameAr, baseReportPrint),
          }
        }
        const companySetup = s.companySetup ?? s.setup
        return {
          activeBranchContext: nextBranch,
          branchBusinessProfiles,
          baseReportPrint,
          ...effectiveBranchAppSettings(companySetup, nextBranch, branchBusinessProfiles, s.baseReceipt ?? s.receipt, s.baseEinvoice ?? s.einvoice, s.baseApprovals ?? s.approvals, baseReportPrint),
        }
      }),
      removeBranchBusinessProfile: (branchId) => set((s) => {
        if (!s.branchBusinessProfiles?.[branchId]) return {}
        const { [branchId]: _removed, ...branchBusinessProfiles } = s.branchBusinessProfiles
        return { branchBusinessProfiles }
      }),
      updateSetup: (patch) => set((s) => companySetupPatch(s, patch)),
      updateCompanyName: (name) => set((s) => {
        const shopName = name.trim()
        if (!shopName) throw new Error('اسم المنشأة مطلوب')
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id] ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const nextProfile = {
            ...current,
            shopName,
            receiptShopName: shopName,
            ...(current.receipt ? { receipt: { ...current.receipt, shopName } } : {}),
          }
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: nextProfile }
          return {
            branchBusinessProfiles,
            baseReportPrint,
            ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
          }
        }
        const companySetup = { ...s.companySetup, shopName }
        const baseReceipt = { ...s.baseReceipt, shopName }
        return {
          companySetup,
          baseReceipt,
          baseReportPrint,
          ...effectiveBranchAppSettings(companySetup, branch, s.branchBusinessProfiles, baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
        }
      }),
      updateTaxSettings: (patch) => set((s) => {
        resolveBusinessTax(patch.taxRegistrationStatus, patch.vatPercent)
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id] ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: { ...current, ...patch } }
          return {
            branchBusinessProfiles,
            baseReportPrint,
            ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
          }
        }
        const companySetup = { ...s.companySetup, ...patch }
        return { companySetup, baseReportPrint, ...effectiveBranchAppSettings(companySetup, branch, s.branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint) }
      }),
      fiscalYears: [],
      completeSetup: ({ country, activity, shopName, ownerName, fiscalYear, contact, doctorSpecialty }) =>
        set((s) => {
          const fiscalErrors = validateFiscalYear(fiscalYear, [])
          if (fiscalErrors.length) throw new Error(fiscalErrors.join(' — '))
          const companySetup: SetupState = {
            completed: true,
            countryCode: country.code,
            activityId: activity.id,
            shopName,
            ownerName,
            features: activity.features,
            modules: activity.modules,
            taxInclusive: activity.taxInclusiveDefault,
            vatPercent: country.vatPercent,
            taxRegistrationStatus: 'registered',
            accountingMode: 'simple',
            allowNegativeTreasury: false,
            allowNegativeStock: false,
            requireOpenShiftForSales: true,
            defaultWarehouseId: null,
            phone: contact?.phone ?? '', email: contact?.email ?? '', city: contact?.city ?? '', street: contact?.street ?? '',
            doctorSpecialty: doctorSpecialty?.trim() ?? '',
            lastActivityChangeAt: null,
            activityKeyHistory: [],
            activityKeyFingerprints: [],
            coreModulesMigratedAt: null,
          }
          const baseReceipt = { ...s.baseReceipt, shopName, defaultTemplate: activity.defaultInvoiceTemplate }
          const baseEinvoice = { ...s.baseEinvoice }
          const baseApprovals = { ...s.baseApprovals }
          const baseReportPrint = { ...(s.baseReportPrint ?? s.reportPrint) }
          return {
            fiscalYears: [{ ...fiscalYear, id: 1, status: 'open' }],
            // الهوية اللونية حسب النشاط (بعد نقاش المالك) — قابلة للتغيير لاحقاً من المظهر
            appearance: { ...s.appearance, accentId: activityAccentId(activity.id) },
            companySetup,
            activeBranchContext: null,
            branchBusinessProfiles: {},
            baseReceipt,
            baseEinvoice,
            baseApprovals,
            baseReportPrint,
            ...effectiveBranchAppSettings(companySetup, null, {}, baseReceipt, baseEinvoice, baseApprovals, baseReportPrint),
          }
        }),
      bindLegacyFiscalYearsToMain: (branchId) => set((s) => ({
        fiscalYears: bindFiscalYearsToMain(s.fiscalYears, branchId),
      })),
      addBranchFiscalYear: (branchId, fy) => set((s) => {
        const scopedYears = s.fiscalYears.filter((year) => year.branchId === branchId)
        const errors = validateFiscalYear(fy, scopedYears)
        if (errors.length) throw new Error(errors.join(' — '))
        const id = s.fiscalYears.reduce((max, year) => Math.max(max, year.id), 0) + 1
        return { fiscalYears: [...s.fiscalYears, { ...fy, id, branchId, status: 'open' }] }
      }),
      /* سنة مالية واحدة مفتوحة فقط لكل فرع — الحارس مركزي داخل المتجر. */
      addFiscalYear: (fy) =>
        set((s) => {
          const branchId = s.activeBranchContext?.id
          const scopedYears = s.fiscalYears.filter((year) => branchId == null ? year.branchId == null : year.branchId === branchId)
          const errors = validateFiscalYear(fy, scopedYears)
          if (errors.length) throw new Error(errors.join(' — '))
          return {
            fiscalYears: [...s.fiscalYears, { ...fy, id: s.fiscalYears.reduce((m, y) => Math.max(m, y.id), 0) + 1, ...(branchId != null ? { branchId } : {}), status: 'open' }],
          }
        }),
      markFiscalYearClosed: (id) =>
        set((s) => ({ fiscalYears: s.fiscalYears.map((y) => (y.id === id ? { ...y, status: 'closed' as const } : y)) })),
      /** إعادة فتح سنة مقفلة (نمط عالمي — تُستدعى من مسار reopenFiscalYear بجوار عكس قيد الإقفال) */
      reopenFiscalYear: (id) =>
        set((s) => ({ fiscalYears: s.fiscalYears.map((y) => (y.id === id ? { ...y, status: 'open' as const } : y)) })),
      setAccountingMode: (m) => set((s) => companySetupPatch(s, { accountingMode: m })),
      updateCompanyProfile: (patch) => set((s) => companySetupPatch(s, patch)),
      toggleModule: (m) =>
        /* v1.0.10: لا إيقاف آخر وحدة مفعّلة — التطبيق بلا أقسام لا معنى له.
           حارس الترخيص: لا إظهار لوحدة خارج الممنوح (افتراضيات النشاط + extraModules
           الموقّعة) — الواجهة تمنع ذلك، والمتجر لا يعتمد عليها وحدها. */
        set((s) => {
          const setup = s.companySetup ?? s.setup
          if (setup.modules.includes(m) && setup.modules.length <= 1) return {}
          if (!setup.modules.includes(m) && !effectiveModules(setup.activityId, s.activatedPayload?.extraModules).includes(m)) return {}
          return companySetupPatch(s, { modules: toggleModuleList(setup.modules, m) })
        }),
      resetSetup: () => set((s) => companySetupPatch(s, { completed: false, countryCode: null, activityId: null })),

      receipt: DEFAULT_RECEIPT_SETTINGS,
      baseReceipt: DEFAULT_RECEIPT_SETTINGS,
      printerProfiles: DEFAULT_PRINTER_PROFILES,
      setPrinterProfile: (route, patch) => set((s) => ({
        printerProfiles: { ...s.printerProfiles, [route]: { ...s.printerProfiles[route], ...patch } },
      })),
      loyalty: DEFAULT_LOYALTY,
      approvals: DEFAULT_APPROVALS,
      baseApprovals: DEFAULT_APPROVALS,
      updateApprovals: (patch) => set((s) => {
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id] ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const approvals = { ...current.approvals, ...patch }
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: { ...current, approvals } }
          return { branchBusinessProfiles, baseReportPrint, ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint) }
        }
        const baseApprovals = { ...s.baseApprovals, ...patch }
        return { baseApprovals, baseReportPrint, ...effectiveBranchAppSettings(s.companySetup, branch, s.branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, baseApprovals, baseReportPrint) }
      }),
      updateLoyalty: (patch) => set((s) => ({ loyalty: { ...s.loyalty, ...patch } })),
      reportPrint: DEFAULT_REPORT_PRINT,
      baseReportPrint: DEFAULT_REPORT_PRINT,
      updateReportPrint: (patch) => set((s) => {
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id]
            ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const currentReportPrint = branchReportPrintFromProfile(current, baseReportPrint)
          const nextProfile = { ...current, reportPrint: { ...currentReportPrint, ...patch } }
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: nextProfile }
          return {
            branchBusinessProfiles,
            baseReportPrint,
            ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
          }
        }
        const nextBaseReportPrint = { ...baseReportPrint, ...patch }
        return {
          baseReportPrint: nextBaseReportPrint,
          ...effectiveBranchAppSettings(s.companySetup, branch, s.branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, nextBaseReportPrint),
        }
      }),
      labelSettings: DEFAULT_LABEL_SETTINGS,
      updateLabelSettings: (patch) => set((s) => ({ labelSettings: { ...s.labelSettings, ...patch } })),
      fxRates: {},
      fxRatesSettings: DEFAULT_FX_RATES_SETTINGS,
      setFxRate: (code, ratePpm, updatedBy) => {
        const key = String(code ?? '').trim().toUpperCase()
        if (!/^[A-Z]{3}$/.test(key)) throw new Error('رمز العملة غير سليم')
        if (!Number.isInteger(ratePpm) || ratePpm <= 0) throw new Error('سعر الصرف يجب أن يكون عدداً أكبر من صفر')
        const record: FxRateRecord = { ratePpm, updatedAt: new Date().toISOString(), updatedBy, source: 'manual' }
        set((s) => ({ fxRates: { ...s.fxRates, [key]: record } }))
      },
      applyFxApiQuotes: (quotes, updatedBy) => {
        const stamp = new Date().toISOString()
        let applied = 0
        set((s) => {
          const next: FxRatesMap = { ...s.fxRates }
          for (const quote of quotes) {
            const key = String(quote.code ?? '').trim().toUpperCase()
            if (!/^[A-Z]{3}$/.test(key) || !Number.isInteger(quote.ratePpm) || quote.ratePpm <= 0) continue
            next[key] = { ratePpm: quote.ratePpm, updatedAt: stamp, updatedBy, source: 'api' }
            applied += 1
          }
          return { fxRates: next }
        })
        return applied
      },
      updateFxRatesSettings: (patch) => set((s) => ({ fxRatesSettings: normalizeFxRatesSettings({ ...s.fxRatesSettings, ...patch }) })),
      scaleRules: DEFAULT_SCALE_RULES,
      addScaleRule: (rule) => set((s) => {
        const errors = validateScaleRule(rule)
        if (errors.length) throw new Error(errors.join(' — '))
        const id = s.scaleRules.reduce((m, r) => Math.max(m, r.id), 0) + 1
        return { scaleRules: [...s.scaleRules, { ...rule, id }] }
      }),
      updateScaleRule: (id, patch) => set((s) => {
        const cur = s.scaleRules.find((r) => r.id === id)
        if (!cur) throw new Error('القاعدة غير موجودة')
        const next = { ...cur, ...patch }
        const errors = validateScaleRule(next)
        if (errors.length) throw new Error(errors.join(' — '))
        return { scaleRules: s.scaleRules.map((r) => (r.id === id ? next : r)) }
      }),
      removeScaleRule: (id) => set((s) => ({ scaleRules: s.scaleRules.filter((r) => r.id !== id) })),
      autoPrintAfterSale: false,
      invoiceColumns: DEFAULT_INVOICE_COLUMNS,
      toggleInvoiceColumn: (key) => set((s) => ({ invoiceColumns: { ...s.invoiceColumns, [key]: !s.invoiceColumns[key] } })),
      resetInvoiceColumns: () => set({ invoiceColumns: DEFAULT_INVOICE_COLUMNS }),
      warehouseReceipt: DEFAULT_WAREHOUSE_RECEIPT,
      updateWarehouseReceipt: (patch) => set((s) => ({ warehouseReceipt: { ...s.warehouseReceipt, ...patch } })),
      resetWarehouseReceipt: () => set({ warehouseReceipt: DEFAULT_WAREHOUSE_RECEIPT }),
      updateReceipt: (patch) => set((s) => {
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id]
            ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const currentReceipt = branchReceiptFromProfile(current, s.baseReceipt)
          const receipt = { ...currentReceipt, ...patch }
          const nextProfile = { ...current, receipt, receiptShopName: receipt.shopName }
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: nextProfile }
          return {
            branchBusinessProfiles,
            baseReportPrint,
            ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
          }
        }
        const baseReceipt = { ...s.baseReceipt, ...patch }
        return { baseReceipt, baseReportPrint, ...effectiveBranchAppSettings(s.companySetup, branch, s.branchBusinessProfiles, baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint) }
      }),
      setAutoPrint: (v) => set({ autoPrintAfterSale: v }),
      appearance: DEFAULT_APPEARANCE,
      updateAppearance: (patch) => set((s) => ({ appearance: sanitizeAppearance({ ...s.appearance, ...patch }) })),
      telegram: DEFAULT_TELEGRAM_SETTINGS,
      updateTelegram: (patch) => set((s) => ({ telegram: { ...s.telegram, ...patch } })),
      einvoice: DEFAULT_EINVOICE_SETTINGS,
      baseEinvoice: DEFAULT_EINVOICE_SETTINGS,
      updateEinvoice: (patch) => set((s) => {
        const branch = s.activeBranchContext
        const baseReportPrint = s.baseReportPrint ?? s.reportPrint
        if (branch && !branch.isMain) {
          const current = s.branchBusinessProfiles[branch.id] ?? branchProfileFromBase(s.companySetup, s.baseReceipt, s.baseEinvoice, s.baseApprovals, branch.nameAr, baseReportPrint)
          const branchBusinessProfiles = { ...s.branchBusinessProfiles, [branch.id]: { ...current, einvoice: { ...current.einvoice, ...patch } } }
          return { branchBusinessProfiles, baseReportPrint, ...effectiveBranchAppSettings(s.companySetup, branch, branchBusinessProfiles, s.baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint) }
        }
        const baseEinvoice = { ...s.baseEinvoice, ...patch }
        return { baseEinvoice, baseReportPrint, ...effectiveBranchAppSettings(s.companySetup, branch, s.branchBusinessProfiles, s.baseReceipt, baseEinvoice, s.baseApprovals, baseReportPrint) }
      }),
      schedule: DEFAULT_SCHEDULE_SETTINGS,
      updateSchedule: (patch) => set((s) => ({ schedule: { ...s.schedule, ...patch } })),
      lanHost: DEFAULT_LAN_HOST_SETTINGS,
      updateLanHost: (patch) => set((s) => ({ lanHost: { ...s.lanHost, ...patch } })),
      lanClient: DEFAULT_LAN_CLIENT_SETTINGS,
      updateLanClient: (patch) => set((s) => ({ lanClient: { ...s.lanClient, ...patch } })),
      lastDailySentDay: null,
      setLastDailySentDay: (day) => set({ lastDailySentDay: day }),
      deviceId: BOOT.deviceId,
      trialStartedAt: BOOT.firstTrialAt,
      lastSeenAt: BOOT.now,
      activatedKey: null,
      activatedPayload: null,
      licenseAudit: { status: 'no_key' },
      /**
       * ث1 (تدقيق 2026-10-08): **المفتاح الموقّع هو المصدر الوحيد للحمولة.**
       * في كل إقلاع نعيد `verifyLicenseKey` على المفتاح المخزّن ونستبدل الحمولة
       * بنتيجة التوقيع؛ مفتاح فاسد/معدّل/لجهاز آخر ⇒ إسقاط التفعيل (يعود
       * المستخدم للتجربة أو شاشة القفل حسب حالته). حمولة محفوظة بلا مفتاح
       * صالح تُرفض مهما كانت — هذا يسدّ تعديل `activatedPayload` في التخزين
       * (نسخة الويب: localStorage نص صريح) لفتح `lifetime` بكل الميزات.
       *
       * ومعها قصّ الوحدات: `setup.modules` حالة محفوظة كذلك، فلا يبقى منها
       * إلا ما تمنحه افتراضيات النشاط + `extraModules` الموقّعة (الحذف فقط —
       * ما أطفأه المستخدم بنفسه يبقى مطفأً).
       *
       * لا تُحدَّث الحالة إلا عند تغيّر فعلي: تحديث بلا سبب يعيد رسم الصدفة
       * ويستورد صفحاتها بعد انتهاء الاختبارات (EnvironmentTeardownError).
       */
      reverifyActivation: async () => {
        const before = get()
        /** الوحدات المسموح بظهورها لحمولة معيّنة (بلا إضافة — حذف فقط) */
        const companySetup = before.companySetup ?? before.setup
        const clamp = (payload: LicensePayload | null) => clampModulesToLicense({
          stored: companySetup.modules,
          activityId: companySetup.activityId,
          licensedExtra: payload?.extraModules,
        })
        const commit = (next: {
          activatedKey: string | null
          activatedPayload: LicensePayload | null
          licenseAudit: AppState['licenseAudit']
          modules: BusinessModule[]
        }) => {
          const modulesChanged = companySetup.completed
            && (next.modules.length !== companySetup.modules.length
              || next.modules.some((m, i) => m !== companySetup.modules[i]))
          const unchanged = before.activatedKey === next.activatedKey
            && JSON.stringify(before.activatedPayload ?? null) === JSON.stringify(next.activatedPayload)
            && before.licenseAudit.status === next.licenseAudit.status
            && !modulesChanged
          if (unchanged) return
          set((s) => ({
            activatedKey: next.activatedKey,
            activatedPayload: next.activatedPayload,
            licenseAudit: next.licenseAudit,
            ...(s.companySetup.completed && modulesChanged ? companySetupPatch(s, { modules: next.modules }) : {}),
          }))
        }

        if (!before.activatedKey) {
          // لا مفتاح ⇒ لا تفعيل معتمد، مهما كانت الحمولة المحفوظة
          commit({
            activatedKey: null,
            activatedPayload: null,
            licenseAudit: { status: 'no_key', at: new Date().toISOString() },
            modules: clamp(null),
          })
          return
        }

        /* لا نقلب الحالة إلى `checking` من هنا: الترطيب هو من يعلّمها عند الإقلاع
           (فتظهر بوابة «جارٍ التحقق» بدل وميض شاشة القفل). قلبها في كل استدعاء
           كان يعيد رسم الصدفة مرتين ويومض البوابة لو استُدعي الفحص لاحقاً. */
        /* ث9: غياب WebCrypto ليس تلاعباً — لا نحكم ولا نحذف (انظر النوع أعلاه). */
        if (typeof globalThis.crypto?.subtle?.verify !== 'function') {
          commit({
            activatedKey: before.activatedKey,
            activatedPayload: null,
            licenseAudit: {
              status: 'unverifiable',
              reason: 'بيئة التشغيل لا تتيح التحقق من التوقيع (WebCrypto غير متاح)',
              at: new Date().toISOString(),
            },
            modules: clamp(null),
          })
          return
        }

        let verified: LicensePayload | null = null
        let verifyError: string | null = null
        try { verified = await verifyLicenseKey(before.activatedKey, before.deviceId) }
        catch (e) { verifyError = (e as Error).message }

        const audit = auditStoredLicense({
          activatedKey: before.activatedKey,
          storedPayload: before.activatedPayload,
          verifiedPayload: verified,
          verifyError,
        })
        if (audit.kind === 'verified') {
          commit({
            activatedKey: before.activatedKey,
            activatedPayload: audit.payload,
            licenseAudit: { status: 'verified', at: new Date().toISOString() },
            modules: clamp(audit.payload),
          })
          return
        }
        // tampered ⇒ يُسقط المفتاح نفسه: لا يبقى شيء قابل لإعادة الاعتماد
        commit({
          activatedKey: null,
          activatedPayload: null,
          licenseAudit: { status: 'tampered', reason: audit.kind === 'tampered' ? audit.reason : undefined, at: new Date().toISOString() },
          modules: clamp(null),
        })
      },
      renewalDismissedDay: null,
      dismissRenewalNotice: (day) => set({ renewalDismissedDay: day ?? todayLocalIso() }),
      registrationReportedAt: null,
      /* حارس الفرق (درس ث1): لا set بلا تغيّر فعلي — لا تحديثات متكررة للمتجر */
      markRegistrationReported: (at) =>
        set((s) => (s.registrationReportedAt ? s : { registrationReportedAt: at ?? new Date().toISOString() })),
      setActivated: (key, payload) =>
        set((s) => {
          const setup = s.companySetup ?? s.setup
          if (!setup.completed) {
            return { activatedKey: key, activatedPayload: payload, licenseAudit: { status: 'verified', at: new Date().toISOString() } }
          }
          const modules = effectiveModules(setup.activityId, payload.extraModules)
          return {
            activatedKey: key,
            activatedPayload: payload,
            licenseAudit: { status: 'verified', at: new Date().toISOString() },
            ...companySetupPatch(s, {
              modules,
              /* v1.0.7: أول تفعيل على هذا الجهاز يثبّت النشاط المرخّص —
                 التغيير بعده بمفتاح SHOPSYS2 موقّع فقط (activityKeyHistory) */
              activityKeyHistory: setup.activityKeyHistory.length > 0
                ? setup.activityKeyHistory
                : [payload.activityId ?? setup.activityId ?? ''].filter(Boolean),
            }),
          }
        }),
      clearActivation: () => set({ activatedKey: null, activatedPayload: null, licenseAudit: { status: 'no_key', at: new Date().toISOString() } }),
      /* ═══ v1.0.7 (موافقة المالك): تغيير النشاط بمفتاح الدعم الفني فقط ═══
         SHOPSYS2 موقّع من المطوّر لهذا الجهاز تحديداً، من النشاط الحالي إلى
         نشاط قالب معروف. التقييد: 30 يوماً بين تغييرين. القوالب (الخصائص
         والوحدات والهوية اللونية وقالب الفاتورة) تُطبَّق كاملة — البيانات
         المحاسبية والمخزنية تبقى كما هي، وضريبة النشاط لا تُلمس (تُضبط
         يدوياً من الإعدادات إن لزم). */
      applyActivityChangeKey: async (key, pubB64u) => {
        const state = get()
        if (state.activeBranchContext && !state.activeBranchContext.isMain) {
          throw new Error('تغيير نشاط المنشأة العامة متاح من المنشأة الأساسية فقط')
        }
        const companySetup = state.companySetup ?? state.setup
        if (!companySetup.completed) throw new Error('أكمل الإعداد الأول أولاً')
        if (!companySetup.activityId) throw new Error('لا يوجد نشاط حالي على الجهاز')
        const payload = await verifyActivityChangeKey(key, state.deviceId, pubB64u)
        /* ح8 (مراجعة ③): مفتاح التحويل يُطبَّق مرة واحدة. التحقق السابق يمنع المفتاح إن لم
           يطابق النشاط الحالي فقط — فمفتاح A→B الموقّع يُعاد تطبيقه بعد عودة الجهاز إلى A
           بمفتاح B→A دون طلب جديد من الدعم. */
        const fingerprint = keyFingerprint(key)
        if ((companySetup.activityKeyFingerprints ?? []).includes(fingerprint)) {
          throw new Error('مفتاح تحويل النشاط هذا استُخدم من قبل — اطلب مفتاحاً جديداً من الدعم')
        }
        if (payload.fromActivityId !== companySetup.activityId) {
          throw new Error(`المفتاح صادر للتحويل من نشاط «${payload.fromActivityId}» — نشاطك الحالي «${companySetup.activityId}». اطلب مفتاحاً محدّثاً من الدعم`)
        }
        if (payload.toActivityId === companySetup.activityId) throw new Error('المفتاح يحوّل إلى نشاطك الحالي نفسه — لا حاجة لأي تغيير')
        const template = ACTIVITY_TEMPLATES.find((t) => t.id === payload.toActivityId)
        if (!template) throw new Error(`نشاط غير معروف في هذه النسخة («${payload.toActivityId}») — حدّث التطبيق أولاً`)
        if (companySetup.lastActivityChangeAt) {
          const since = daysBetween(companySetup.lastActivityChangeAt.slice(0, 10), todayLocalIso())
          if (since < ACTIVITY_CHANGE_COOLDOWN_DAYS) {
            throw new Error(`مضى ${since} يوماً فقط على آخر تغيير نشاط — التغيير مسموح كل ${ACTIVITY_CHANGE_COOLDOWN_DAYS} يوماً (باقٍ ${ACTIVITY_CHANGE_COOLDOWN_DAYS - since} يوماً)`)
          }
        }
        const now = new Date().toISOString()
        set((s) => {
          if (s.activeBranchContext && !s.activeBranchContext.isMain) {
            throw new Error('تغيير نشاط المنشأة العامة متاح من المنشأة الأساسية فقط')
          }
          const companySetup = s.companySetup ?? s.setup
          const nextCompanySetup: SetupState = {
            ...companySetup,
            activityId: template.id,
            features: template.features,
            modules: template.modules,
            lastActivityChangeAt: now,
            activityKeyHistory: [...companySetup.activityKeyHistory, template.id],
            activityKeyFingerprints: [...(companySetup.activityKeyFingerprints ?? []), fingerprint],
          }
          const baseReceipt = { ...s.baseReceipt, defaultTemplate: template.defaultInvoiceTemplate }
          const baseReportPrint = s.baseReportPrint ?? s.reportPrint
          return {
            appearance: { ...s.appearance, accentId: activityAccentId(template.id) },
            companySetup: nextCompanySetup,
            baseReceipt,
            baseReportPrint,
            ...effectiveBranchAppSettings(nextCompanySetup, s.activeBranchContext, s.branchBusinessProfiles, baseReceipt, s.baseEinvoice, s.baseApprovals, baseReportPrint),
          }
        })
        return template.nameAr
      },
      touchLastSeen: () =>
        set((s) => {
          /* ح3 (مراجعة ③): مرساة تالفة لا تُستبدل بـ«الآن» — ذلك كان يمحو دليل إرجاع الساعة
             (lastSeenAt = "" كان يُكتب فوراً بالوقت الحالي عند الإقلاع فيمر التلاعب) */
          if (!isValidIsoDay(s.lastSeenAt)) return {}
          const now = new Date().toISOString()
          // لا نرجع المرساة للخلف أبداً — هي خط دفاع ضد إرجاع الساعة
          return now > s.lastSeenAt ? { lastSeenAt: now } : {}
        }),
      cloudAbout: null,
      cloudAccountMessage: '',
      revokedKeys: [],
      cloudNotifications: [],
      ackedNoticeIds: [],
      /* حارس الفرق (درس ث1): لا set بلا تغيّر فعلي. ويُقتصر على آخر 200 معرّف
         كي لا تنمو القائمة للأبد في التخزين المشفر. */
      ackNotice: (id) =>
        set((s) => (
          !id || s.ackedNoticeIds.includes(id)
            ? s
            : { ackedNoticeIds: [...s.ackedNoticeIds, id].slice(-200) }
        )),
      deviceFlags: null,
      cloudSyncedAt: null,
      setCloudData: (patch) => {
        // الإطفاء يسري فوراً على كل بوابة ترخيص (evaluateLicense يقرأ هذه الحالة)
        if (patch.flags !== undefined) setActiveDeviceFlags(patch.flags)
        set((s) => ({
          cloudAbout: patch.about !== undefined ? patch.about : s.cloudAbout,
          cloudAccountMessage: patch.accountMessage !== undefined ? patch.accountMessage : s.cloudAccountMessage,
          revokedKeys: patch.revoked !== undefined ? patch.revoked : s.revokedKeys,
          cloudNotifications: patch.notifications !== undefined ? patch.notifications : s.cloudNotifications,
          deviceFlags: patch.flags !== undefined ? patch.flags : s.deviceFlags,
          cloudSyncedAt: new Date().toISOString(),
        }))
      },
      lastHourlyBackupAt: null,
      setLastHourlyBackupAt: (iso) => set({ lastHourlyBackupAt: iso }),
      backupIntervalMinutes: 60,
      setBackupIntervalMinutes: (minutes) => set({ backupIntervalMinutes: Math.max(5, Math.round(minutes)) }),
      sync: DEFAULT_SYNC_SETTINGS,
      updateSync: (patch) => set((s) => ({ sync: { ...s.sync, ...patch } })),
    }),
    {
      name: 'shopsys-app',
      /* §101 التنفيذية: SQLite داخل نسخة سطح المكتب — وlocalStorage الخام في الويب كما هو */
      storage: createJSONStorage(settingsAppStorage),
      /* ترحيل بنيوي بعد فصل companySetup عن setup الفعال: لقطات الإصدارات السابقة
         لا تحمل companySetup/baseReceipt/baseEinvoice/baseApprovals، وكانت قيمة
         الافتراضية في الحالة الحالية تحجب البيانات القديمة عند الدمج السطحي. */
      merge: (persistedState, currentState) => {
        const saved = persistedState as Partial<AppState> | undefined
        if (!saved) return currentState
        const merged = { ...currentState, ...saved }
        const savedSetup = saved.companySetup ?? saved.setup
        if (savedSetup) {
          const companySetup = { ...DEFAULT_SETUP_STATE, ...savedSetup }
          merged.companySetup = companySetup
          merged.setup = companySetup
        }
        if (!saved.baseReceipt && saved.receipt) merged.baseReceipt = saved.receipt
        if (!saved.receipt && saved.baseReceipt) merged.receipt = saved.baseReceipt
        if (!saved.baseEinvoice && saved.einvoice) merged.baseEinvoice = saved.einvoice
        if (!saved.einvoice && saved.baseEinvoice) merged.einvoice = saved.baseEinvoice
        if (!saved.baseApprovals && saved.approvals) merged.baseApprovals = saved.approvals
        if (!saved.approvals && saved.baseApprovals) merged.approvals = saved.baseApprovals
        if (!saved.baseReportPrint && saved.reportPrint) merged.baseReportPrint = saved.reportPrint
        if (!saved.reportPrint && saved.baseReportPrint) merged.reportPrint = saved.baseReportPrint
        return merged
      },
      /**
       * ث1 (تدقيق 2026-10-08): الحمولة لا تُخزَّن ولا تُقرأ من التخزين —
       * تُشتق من المفتاح الموقّع في كل إقلاع (`reverifyActivation`). وحالة
       * الفحص نفسها جلسة فقط. ما عدا ذلك يُحفظ كما هو حرفياً.
       */
      partialize: (state) => {
        const { activatedPayload: _payload, licenseAudit: _audit, activeBranchContext: _branchContext, ...rest } = state
        return {
          ...rest,
          // تبقى أسماء المفاتيح القديمة متوافقة، لكن التخزين يحمل دائماً قيم الشركة الأساسية لا تراكب فرع عابر.
          setup: state.companySetup,
          companySetup: state.companySetup,
          receipt: state.baseReceipt,
          baseReceipt: state.baseReceipt,
          einvoice: state.baseEinvoice,
          baseEinvoice: state.baseEinvoice,
          approvals: state.baseApprovals,
          baseApprovals: state.baseApprovals,
          reportPrint: state.baseReportPrint ?? state.reportPrint,
          baseReportPrint: state.baseReportPrint ?? state.reportPrint,
        }
      },
      onRehydrateStorage: () => (state) => {
        /* ث1: أي حمولة محفوظة تُسقط فوراً — لا تُعتمد قبل إعادة التحقق من
           التوقيع. تُعلَّم الحالة `checking` كي لا تُعرض شاشة القفل في نافذة
           الفحص (وإلا ومضت لعميل مفعّل) — `App.tsx` ينتظرها قبل الحكم. */
        if (state) {
          // ترحيل متوافق: الإعداد المحفوظ سابقاً هو ملف الشركة الرئيسي، لا نغير قيمه ولا نفرض ترحيلاً على الفروع القديمة.
          state.companySetup = state.companySetup ?? state.setup
          state.activeBranchContext = null
          state.baseReceipt = { ...DEFAULT_RECEIPT_SETTINGS, ...(state.baseReceipt ?? state.receipt ?? {}) }
          state.baseEinvoice = { ...DEFAULT_EINVOICE_SETTINGS, ...(state.baseEinvoice ?? state.einvoice ?? {}) }
          state.baseApprovals = { ...DEFAULT_APPROVALS, ...(state.baseApprovals ?? state.approvals ?? {}) }
          state.baseReportPrint = { ...DEFAULT_REPORT_PRINT, ...(state.baseReportPrint ?? state.reportPrint ?? {}) }
          const savedBranchProfiles = state.branchBusinessProfiles ?? {}
          state.branchBusinessProfiles = Object.fromEntries(Object.entries(savedBranchProfiles).map(([branchId, saved]) => {
            const defaults = branchProfileFromBase(state.companySetup, state.baseReceipt, state.baseEinvoice, state.baseApprovals, '', state.baseReportPrint)
            return [Number(branchId), {
              ...defaults,
              ...saved,
              // هوية قديمة بلا هذه المفاتيح تبقى فارغة؛ القيم المحفوظة صراحةً لا تُلمس.
              phone: saved.phone ?? '',
              email: saved.email ?? '',
              website: saved.website ?? '',
              city: saved.city ?? '',
              street: saved.street ?? '',
              buildingNo: saved.buildingNo ?? '',
              postalCode: saved.postalCode ?? '',
              poBox: saved.poBox ?? '',
              commercialRegister: saved.commercialRegister ?? '',
              shopName: saved.shopName ?? defaults.shopName,
              vatPercent: saved.vatPercent ?? defaults.vatPercent,
              taxInclusive: saved.taxInclusive ?? defaults.taxInclusive,
              taxRegistrationStatus: saved.taxRegistrationStatus ?? defaults.taxRegistrationStatus,
              doctorSpecialty: saved.doctorSpecialty ?? defaults.doctorSpecialty,
              allowNegativeTreasury: saved.allowNegativeTreasury ?? defaults.allowNegativeTreasury,
              allowNegativeStock: saved.allowNegativeStock ?? defaults.allowNegativeStock,
              requireOpenShiftForSales: saved.requireOpenShiftForSales ?? defaults.requireOpenShiftForSales,
              receiptShopName: saved.receiptShopName ?? defaults.receiptShopName,
              receipt: saved.receipt
                ? { ...DEFAULT_RECEIPT_SETTINGS, ...saved.receipt }
                : defaults.receipt,
              reportPrint: saved.reportPrint
                ? { ...DEFAULT_REPORT_PRINT, ...saved.reportPrint }
                : defaults.reportPrint,
              einvoice: { ...defaults.einvoice, ...(saved.einvoice ?? {}) },
              approvals: saved.approvals ?? defaults.approvals,
            }]
          }))
          state.setup = state.companySetup
          state.receipt = state.baseReceipt
          state.einvoice = state.baseEinvoice
          state.approvals = state.baseApprovals
          state.reportPrint = state.baseReportPrint
          // آخر أعلام محفوظة (وضع الأوفلاين) تسري من أول لحظة قبل أي جلب جديد
          setActiveDeviceFlags(state.deviceFlags ?? null)
          state.activatedPayload = null
          state.licenseAudit = state.activatedKey
            ? { status: 'checking', at: new Date().toISOString() }
            : { status: 'no_key' }
        }
        // ترحيل: حسابات أُنشئت قبل خطوة السنة المالية تحصل على سنة ميلادية حالية تلقائياً
        if (state && state.setup.completed && state.fiscalYears.length === 0) {
          const y = new Date().getFullYear()
          state.fiscalYears = [{
            id: 1,
            nameAr: `السنة المالية ${y}`,
            startDate: `${y}-01-01`,
            endDate: `${y}-12-31`,
            status: 'open',
          }]
        }
        // ترحيل تاريخي (v1.0.2x): حسابات أُنشئت قبل فصل وحدتي «المخزون» و«المشتريات» كانت
        // تراهما دائماً. استثناء لوجيستيات/إيجار المعدات هنا **متجاوَز** بالسياسة الجديدة
        // أدناه (v1.0.24: النواة لكل الأنشطة) — أُبقي لأن بصمته التاريخية قد تكون كُتبت
        if (state && state.setup.completed) {
          const mods = new Set(state.setup.modules)
          const knowsSplit = mods.has('inventory') || mods.has('purchases')
          const stockless = state.setup.activityId === 'logistics' || state.setup.activityId === 'equipment_rental'
          if (!knowsSplit && !stockless) {
            state.setup = { ...state.setup, modules: [...state.setup.modules, 'inventory', 'purchases'] }
          }
        }
        /* ترحيل v1.0.24 (سياسة النواة الموحّدة — أمر المالك): «كل الأنشطة لها مخزون
           ومشتريات وموردون». يُطبَّق مرة واحدة لكل جهاز (البصمة أدناه)، لئلا
           تعود وحدة أطفأها المالك بنفسه بعد التحديث. المبيعات لا تُمس إطلاقاً. */
        if (state && state.setup.completed && !state.setup.coreModulesMigratedAt) {
          const mods = new Set<BusinessModule>(state.setup.modules)
          mods.add('inventory'); mods.add('purchases')
          state.setup = {
            ...state.setup,
            modules: withDependencies([...mods]),
            coreModulesMigratedAt: new Date().toISOString(),
          }
        }
        // ترحيل: نشاط المغسلة كان يعرض «الصيانة» خطأً (بلاغ المالك) — نستبدلها بوحدة المغسلة المستقلة
        if (state && state.setup.completed && state.setup.activityId === 'laundry') {
          const mods = state.setup.modules.filter((m) => m !== 'maintenance')
          if (!mods.includes('laundry')) mods.push('laundry')
          if (mods.length !== state.setup.modules.length || !state.setup.modules.includes('laundry')) {
            state.setup = { ...state.setup, modules: mods }
          }
        }
        // ترحيل: مفاتيح الرصيد السالب والمخزن الافتراضي (طلب المالك) — الافتراضي: ممنوع
        if (state?.setup) {
          state.setup.allowNegativeTreasury = state.setup.allowNegativeTreasury ?? false
        // ترحيل §102: مسارات الطابعات — القديم بلا المفتاح أو بشكل فاسد يُستكمل دفاعياً
        if (state) state.printerProfiles = normalizePrinterProfiles(state.printerProfiles)
          state.setup.requireOpenShiftForSales = state.setup.requireOpenShiftForSales ?? true
          state.loyalty = { ...DEFAULT_LOYALTY, ...(state.loyalty ?? {}) }
          state.approvals = { ...DEFAULT_APPROVALS, ...(state.approvals ?? {}) }
          state.setup.allowNegativeStock = state.setup.allowNegativeStock ?? false
          state.setup.defaultWarehouseId = state.setup.defaultWarehouseId ?? null
          // ترحيل: تخصص الطبيب (طلب المالك — لا يُفرض «أسنان»)
          state.setup.doctorSpecialty = state.setup.doctorSpecialty ?? ''
        }
        // ترحيل: إعدادات إيصال لحسابات قديمة (قبل ميزة الطباعة / قبل قالب A4 / قبل مفاتيح الإظهار)
        if (state && !state.receipt) {
          state.receipt = { ...DEFAULT_RECEIPT_SETTINGS, shopName: state.setup.shopName }
        } else if (state) {
          // أي مفتاح جديد أُضيف لاحقاً يأخذ قيمته الافتراضية دون المساس بما اختاره المستخدم
          state.receipt = { ...DEFAULT_RECEIPT_SETTINGS, ...state.receipt }
        }
        // ترحيل: إعدادات طباعة التقارير المعممة (طلب المالك)
        if (state) state.reportPrint = { ...DEFAULT_REPORT_PRINT, ...state.reportPrint }
        // ترحيل: قالب الملصقات (قسم الباركود والسيريال)
        if (state) state.labelSettings = { ...DEFAULT_LABEL_SETTINGS, ...state.labelSettings }
        // ترحيل: قواعد باركود الميزان — حسابات قديمة تحصل على القاعدة الافتراضية (بادئة 22)
        if (state && (!state.scaleRules || state.scaleRules.length === 0)) state.scaleRules = DEFAULT_SCALE_RULES
        // ترحيل: حسابات قبل ميزة المظهر تحصل على الافتراضيات (مع تنقية القيم)
        if (state) state.appearance = sanitizeAppearance(state.appearance)
        // ترحيل لمرة واحدة (طلب المالك): شريط القوائم العلوي صار نمط التنقل الافتراضي.
        // يُطبَّق مرة واحدة فقط، وبعدها يظل اختيار المستخدم (جانبي/علوي) محفوظاً كما هو.
        if (state && typeof localStorage !== 'undefined' && localStorage.getItem('shopsys:menubar-default') !== '1') {
          state.appearance = { ...state.appearance, navigationMode: 'topbar' }
          try { localStorage.setItem('shopsys:menubar-default', '1') } catch { /* وضع خاص بلا تخزين */ }
        }
        // ترحيل: حسابات قبل ميزة التليجرام تحصل على الافتراضيات
        if (state) state.telegram = { ...DEFAULT_TELEGRAM_SETTINGS, ...state.telegram }
        // ترحيل: حسابات قبل ميزة المزامنة السحابية تحصل على الافتراضيات
        if (state) state.sync = { ...DEFAULT_SYNC_SETTINGS, ...state.sync }
        // ترحيل: حسابات قبل شبكة المحل تحصل على الافتراضيات (§102)
        if (state) state.lanHost = { ...DEFAULT_LAN_HOST_SETTINGS, ...state.lanHost }
        if (state) state.lanClient = { ...DEFAULT_LAN_CLIENT_SETTINGS, ...state.lanClient }
        // ترحيل: حسابات قبل ميزة الفاتورة الإلكترونية تحصل على الافتراضيات
        if (state) state.einvoice = { ...DEFAULT_EINVOICE_SETTINGS, ...state.einvoice }
        // ترحيل: حسابات قبل الإرسال المجدول تحصل على الافتراضيات
        if (state) state.schedule = { ...DEFAULT_SCHEDULE_SETTINGS, ...state.schedule }
        // ترحيل: حسابات قبل ميزة الترخيص تحصل على هوية جهاز ومراسي زمنية
        if (state && !state.deviceId) {
          state.deviceId = BOOT.deviceId
          state.trialStartedAt = BOOT.firstTrialAt
          state.lastSeenAt = BOOT.now
          state.activatedKey = null
          state.activatedPayload = null
        }
        // حماية: مرساة الجهاز (shopsys-i) هي المرجع — لو بداية التجربة المخزنة
        // أحدث من المرساة (مسح بيانات/تلاعب لإعادة العدّاد) نرجع للأقدم دائماً
        if (state) state.trialStartedAt = oldestValidDay(state.trialStartedAt, BOOT.firstTrialAt) ?? state.trialStartedAt
        // ح2 (مراجعة ③): القيمة التالفة ("" أو نص) تُستبدل بالأقدم **الصالح** بينها وبين
        // المرساة — ولا تبقى لتعطي تجربة لا تنتهي (evaluateLicense يفشل مغلقاً عليها).
        // ح4: مخطط الإعداد القديم لا يعرف بصمات تحويل النشاط
        if (state && state.setup && !Array.isArray(state.setup.activityKeyFingerprints)) {
          state.setup = { ...state.setup, activityKeyFingerprints: [] }
        }
        if (state) {
          // تُحفظ الترحيلات السابقة على الإعدادات الأساسية، ثم يبدأ التطبيق بلا فرع محدد.
          state.companySetup = state.setup
          state.baseReceipt = state.receipt
          state.baseEinvoice = state.einvoice
          state.baseApprovals = { ...DEFAULT_APPROVALS, ...state.approvals }
          state.baseReportPrint = { ...DEFAULT_REPORT_PRINT, ...(state.baseReportPrint ?? state.reportPrint ?? {}) }
          state.setup = state.companySetup
          state.receipt = state.baseReceipt
          state.einvoice = state.baseEinvoice
          state.approvals = state.baseApprovals
          state.reportPrint = state.baseReportPrint
        }
      },
    },
  ),
)

/* التوافق مع اختبارات/أدوات قديمة تستدعي Zustand setState مباشرةً: اعتبر تعديلات الإعدادات القديمة تعديلات للملف الأساسي عند عدم تحديد فرع. */
const rawAppSetState = useAppStore.setState.bind(useAppStore)
useAppStore.setState = ((partial, replace) => {
  const current = useAppStore.getState()
  const value = typeof partial === 'function' ? partial(current) : partial
  if (!value || typeof value !== 'object') return rawAppSetState(value as never, replace as never)
  const patch = { ...value } as Partial<AppState>
  const branchContextChanged = 'activeBranchContext' in patch
    && JSON.stringify(patch.activeBranchContext) !== JSON.stringify(current.activeBranchContext)
  const branchProfilesChanged = 'branchBusinessProfiles' in patch
    && JSON.stringify(patch.branchBusinessProfiles) !== JSON.stringify(current.branchBusinessProfiles)
  if (branchContextChanged || branchProfilesChanged) {
    throw new Error('سياق الفروع وملفاتها تُحدَّث عبر إجراءاتها المخصصة فقط')
  }
  if (current.activeBranchContext && !current.activeBranchContext.isMain
    && ['setup', 'companySetup', 'receipt', 'baseReceipt', 'einvoice', 'baseEinvoice', 'approvals', 'baseApprovals', 'reportPrint', 'baseReportPrint'].some((key) => key in patch)) {
    throw new Error('لا يمكن تعديل إعدادات المنشأة العامة من داخل فرع مستقل')
  }
  if (patch.setup && (!patch.companySetup || patch.companySetup === current.companySetup || JSON.stringify(patch.companySetup) === JSON.stringify(current.companySetup))) {
    patch.companySetup = patch.setup
  }
  if (patch.receipt && (!patch.baseReceipt || patch.baseReceipt === current.baseReceipt)) patch.baseReceipt = patch.receipt
  if (patch.einvoice && (!patch.baseEinvoice || patch.baseEinvoice === current.baseEinvoice)) patch.baseEinvoice = patch.einvoice
  if (patch.approvals && (!patch.baseApprovals || patch.baseApprovals === current.baseApprovals)) patch.baseApprovals = patch.approvals
  if (patch.reportPrint && (!patch.baseReportPrint || patch.baseReportPrint === current.baseReportPrint)) patch.baseReportPrint = patch.reportPrint
  return rawAppSetState(patch as never, replace as never)
}) as typeof useAppStore.setState

/* نوافذ الأقمار الحرة (سطح المكتب): إعدادات/مظهر غُيّرت في نافذة أخرى تصل
   هنا فوراً عبر إعادة ترطيب «shopsys-app» — بما فيها تسجيل الخروج. */
registerExternalSnapshotApplier((storeName) => {
  if (storeName === 'shopsys-app') void useAppStore.persist.rehydrate()
})
