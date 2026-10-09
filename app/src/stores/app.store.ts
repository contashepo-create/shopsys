/**
 * مخزن حالة التطبيق — الإعدادات العامة والثيم ومعالج أول تشغيل
 * (اليوم: localStorage — غداً: جدول settings في SQLite عبر نفس الواجهة)
 */
import { create } from 'zustand'
import { DEFAULT_WAREHOUSE_RECEIPT, type WarehouseReceiptSettings } from '../core/warehouseReceipt.ts'
import { persist } from 'zustand/middleware'
import type { Country } from '../core/countries.ts'
import { toggleModuleList, effectiveModules, clampModulesToLicense, ACTIVITY_TEMPLATES, type ActivityTemplate, type ItemFeature, type BusinessModule } from '../core/activities.ts'
import type { FiscalYear } from '../core/fiscal.ts'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '../core/receipt.ts'
import { createJSONStorage } from 'zustand/middleware'
import { settingsAppStorage } from '../data/persistentStorage.ts'
import { DEFAULT_PRINTER_PROFILES, normalizePrinterProfiles, type PrinterProfile, type PrintRoute, type PrinterProfiles } from '../core/printers.ts'
import { DEFAULT_LOYALTY, type LoyaltySettings } from '../core/loyalty.ts'
import { DEFAULT_APPROVALS, type ApprovalSettings } from '../core/approvals.ts'
import { generateDeviceId, verifyActivityChangeKey, verifyLicenseKey, auditStoredLicense, ACTIVITY_CHANGE_COOLDOWN_DAYS, daysBetween, isValidIsoDay, oldestValidDay, keyFingerprint, type LicensePayload } from '../core/license.ts'
import { LEGAL_VERSION } from '../core/legal.ts'
import { DEFAULT_APPEARANCE, sanitizeAppearance, activityAccentId, type AppearanceSettings } from '../core/appearance.ts'
import { DEFAULT_TELEGRAM_SETTINGS, type TelegramSettings } from '../core/telegram.ts'
import { DEFAULT_EINVOICE_SETTINGS, type EinvoiceSettings } from '../core/einvoice.ts'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '../core/schedule.ts'
import { DEFAULT_REPORT_PRINT, type ReportPrintSettings } from '../core/reportPrint.ts'
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from '../core/labels.ts'
import { DEFAULT_FX_RATES_SETTINGS, normalizeFxRatesSettings, type FxRatesMap, type FxRatesSettings, type FxRateRecord } from '../core/fxRates.ts'
import { DEFAULT_SCALE_RULES, validateScaleRule, type ScaleRule } from '../core/barcode.ts'
import type { AboutContent, CloudNotice } from '../core/cloud.ts'
import type { DeviceFlags } from '../core/featureFlags.ts'

export type ThemeMode = 'light' | 'dark'

interface SetupState {
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
  taxRegistrationStatus?: 'registered' | 'exempt' | 'zero_rated'
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
  /** تخصص الطبيب لنشاط العيادة (يختاره/يكتبه المالك في معالج أول تشغيل — لا يُفرض «أسنان») */
  doctorSpecialty: string
  /** v1.0.7: آخر تغيير نشاط بمفتاح الدعم — التقييد 30 يوماً بين تغييرين */
  lastActivityChangeAt: string | null
  /** v1.0.7: الأنشطة المرخصة على الجهاز (الأصلي + كل تغيير موقّع) — مفتاح التفعيل القديم يظل صالحاً */
  activityKeyHistory: string[]
  /** ح8 (مراجعة ③): بصمات مفاتيح تحويل النشاط المطبّقة — المفتاح الواحد لا يُعاد تطبيقه */
  activityKeyFingerprints: string[]
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
  setup: SetupState
  fiscalYears: FiscalYear[]
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
  receipt: ReceiptSettings
  /** §102 (تعدد الطابعات): مسار لكل نسخة مطبوعة — اسم الطابعة + طباعة آلية */
  printerProfiles: PrinterProfiles
  setPrinterProfile: (route: PrintRoute, patch: Partial<PrinterProfile>) => void
  /** برنامج نقاط الولاء (نمط Lightspeed Loyalty) — الكسب والاستبدال من الكاشير */
  loyalty: LoyaltySettings
  approvals: ApprovalSettings
  updateApprovals: (patch: Partial<ApprovalSettings>) => void
  updateLoyalty: (patch: Partial<LoyaltySettings>) => void
  /** إعدادات طباعة التقارير المعممة (طلب المالك): كل تقارير النظام لا الفواتير فقط */
  reportPrint: ReportPrintSettings
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
   * بند 2 + سياسة الخصوصية (2026-10-08): موافقة العميل الصريحة على إرسال بلاغ
   * التسجيل. سياسة الخصوصية المنشورة تقول إن البيانات محلية ولا تُرفع ⇒ إرسال
   * بيانات المنشأة والتواصل بلا موافقة صريحة **مخالفة لوثيقتنا نفسها**. لذلك:
   * خانة اختيار في معالج أول التشغيل (غير مفعّلة افتراضياً)، وبلا موافقة لا
   * يُرسل شيء إطلاقاً — والتطبيق يعمل كاملاً دونها.
   */
  registrationConsentAt: string | null
  setRegistrationConsent: (at?: string) => void
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
  revokedKeys: string[] // بصمات المفاتيح المحروقة
  cloudNotifications: CloudNotice[]
  cloudSyncedAt: string | null
  setCloudData: (patch: { about?: AboutContent | null; revoked?: string[]; flags?: DeviceFlags | null; notifications?: CloudNotice[] }) => void
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
const bootIdentity = (): { deviceId: string; now: string; firstTrialAt: string } => {
  const nowIso = new Date().toISOString()
  try {
    const raw = localStorage.getItem(IDENTITY_ANCHOR_KEY)
    if (raw) {
      const a = JSON.parse(atob(raw)) as { d?: string; t?: string }
      if (typeof a.d === 'string' && a.d && typeof a.t === 'string' && a.t) {
        return { deviceId: a.d, now: nowIso, firstTrialAt: a.t }
      }
    }
  } catch { /* مرساة تالفة — تُعاد كتابتها أدناه */ }
  const rnd = new Uint8Array(12)
  crypto.getRandomValues(rnd)
  const deviceId = generateDeviceId(rnd)
  try {
    localStorage.setItem(IDENTITY_ANCHOR_KEY, btoa(JSON.stringify({ d: deviceId, t: nowIso })))
  } catch { /* تخزين ممتلئ — نكمل بالقيم الجديدة */ }
  return { deviceId, now: nowIso, firstTrialAt: nowIso }
}
const BOOT = bootIdentity()

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      /* v1.0.8: موافقة الاتفاقية والخصوصية — تسجل بالإصدار والتاريخ وتطلب مجدداً عند التحديث */
      legal: null as { version: string; acceptedAt: string } | null,
      acceptLegal: () => set({ legal: { version: LEGAL_VERSION, acceptedAt: new Date().toISOString() } }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
      setup: {
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
        doctorSpecialty: '',
        lastActivityChangeAt: null,
        activityKeyHistory: [],
        activityKeyFingerprints: [],
      },
      fiscalYears: [],
      completeSetup: ({ country, activity, shopName, ownerName, fiscalYear, contact, doctorSpecialty }) =>
        set((s) => ({
          fiscalYears: [{ ...fiscalYear, id: 1, status: 'open' }],
          // الهوية اللونية حسب النشاط (بعد نقاش المالك) — قابلة للتغيير لاحقاً من المظهر
          appearance: { ...s.appearance, accentId: activityAccentId(activity.id) },
          // اسم المحل على الإيصال + قالب الفاتورة الافتراضي من النشاط
          // (بقالة = حراري سريع، خدمات وعقود = A4 احترافية)
          receipt: { ...s.receipt, shopName, defaultTemplate: activity.defaultInvoiceTemplate },
          setup: {
            completed: true,
            countryCode: country.code,
            activityId: activity.id,
            shopName,
            ownerName,
            features: activity.features,
            modules: activity.modules,
            taxInclusive: activity.taxInclusiveDefault,
            vatPercent: country.vatPercent,
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
          },
        })),
      addFiscalYear: (fy) =>
        set((s) => ({
          fiscalYears: [...s.fiscalYears, { ...fy, id: s.fiscalYears.reduce((m, y) => Math.max(m, y.id), 0) + 1, status: 'open' }],
        })),
      markFiscalYearClosed: (id) =>
        set((s) => ({ fiscalYears: s.fiscalYears.map((y) => (y.id === id ? { ...y, status: 'closed' as const } : y)) })),
      /** إعادة فتح سنة مقفلة (نمط عالمي — تُستدعى من مسار reopenFiscalYear بجوار عكس قيد الإقفال) */
      reopenFiscalYear: (id) =>
        set((s) => ({ fiscalYears: s.fiscalYears.map((y) => (y.id === id ? { ...y, status: 'open' as const } : y)) })),
      setAccountingMode: (m) => set((s) => ({ setup: { ...s.setup, accountingMode: m } })),
      toggleModule: (m) =>
        /* v1.0.10: لا إيقاف آخر وحدة مفعّلة — التطبيق بلا أقسام لا معنى له */
        set((s) => (s.setup.modules.includes(m) && s.setup.modules.length <= 1
          ? {}
          : { setup: { ...s.setup, modules: toggleModuleList(s.setup.modules, m) } })),
      resetSetup: () =>
        set((s) => ({
          setup: { ...s.setup, completed: false, countryCode: null, activityId: null },
        })),
      receipt: DEFAULT_RECEIPT_SETTINGS,
      printerProfiles: DEFAULT_PRINTER_PROFILES,
      setPrinterProfile: (route, patch) => set((s) => ({
        printerProfiles: { ...s.printerProfiles, [route]: { ...s.printerProfiles[route], ...patch } },
      })),
      loyalty: DEFAULT_LOYALTY,
      approvals: DEFAULT_APPROVALS,
      updateApprovals: (patch) => set((s) => ({ approvals: { ...s.approvals, ...patch } })),
      updateLoyalty: (patch) => set((s) => ({ loyalty: { ...s.loyalty, ...patch } })),
      reportPrint: DEFAULT_REPORT_PRINT,
      updateReportPrint: (patch) => set((s) => ({ reportPrint: { ...s.reportPrint, ...patch } })),
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
      updateReceipt: (patch) => set((s) => ({ receipt: { ...s.receipt, ...patch } })),
      setAutoPrint: (v) => set({ autoPrintAfterSale: v }),
      appearance: DEFAULT_APPEARANCE,
      updateAppearance: (patch) => set((s) => ({ appearance: sanitizeAppearance({ ...s.appearance, ...patch }) })),
      telegram: DEFAULT_TELEGRAM_SETTINGS,
      updateTelegram: (patch) => set((s) => ({ telegram: { ...s.telegram, ...patch } })),
      einvoice: DEFAULT_EINVOICE_SETTINGS,
      updateEinvoice: (patch) => set((s) => ({ einvoice: { ...s.einvoice, ...patch } })),
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
        const clamp = (payload: LicensePayload | null) => clampModulesToLicense({
          stored: before.setup.modules,
          activityId: before.setup.activityId,
          licensedExtra: payload?.extraModules,
        })
        const commit = (next: {
          activatedKey: string | null
          activatedPayload: LicensePayload | null
          licenseAudit: AppState['licenseAudit']
          modules: BusinessModule[]
        }) => {
          const modulesChanged = before.setup.completed
            && (next.modules.length !== before.setup.modules.length
              || next.modules.some((m, i) => m !== before.setup.modules[i]))
          const unchanged = before.activatedKey === next.activatedKey
            && JSON.stringify(before.activatedPayload ?? null) === JSON.stringify(next.activatedPayload)
            && before.licenseAudit.status === next.licenseAudit.status
            && !modulesChanged
          if (unchanged) return
          set((s) => ({
            activatedKey: next.activatedKey,
            activatedPayload: next.activatedPayload,
            licenseAudit: next.licenseAudit,
            setup: s.setup.completed && modulesChanged ? { ...s.setup, modules: next.modules } : s.setup,
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
      dismissRenewalNotice: (day) => set({ renewalDismissedDay: day ?? new Date().toISOString().slice(0, 10) }),
      registrationConsentAt: null,
      setRegistrationConsent: (at) =>
        set((s) => (s.registrationConsentAt ? s : { registrationConsentAt: at ?? new Date().toISOString() })),
      registrationReportedAt: null,
      /* حارس الفرق (درس ث1): لا set بلا تغيّر فعلي — لا تحديثات متكررة للمتجر */
      markRegistrationReported: (at) =>
        set((s) => (s.registrationReportedAt ? s : { registrationReportedAt: at ?? new Date().toISOString() })),
      setActivated: (key, payload) =>
        set((s) => ({
          activatedKey: key,
          activatedPayload: payload,
          licenseAudit: { status: 'verified', at: new Date().toISOString() },
          // سياسة الأقسام: الوحدات = افتراضيات النشاط + ما فعّله المطوّر في المفتاح فقط
          setup: s.setup.completed
            ? {
                ...s.setup,
                modules: effectiveModules(s.setup.activityId, payload.extraModules),
                /* v1.0.7: أول تفعيل على هذا الجهاز يثبّت النشاط المرخّص —
                   التغيير بعده بمفتاح SHOPSYS2 موقّع فقط (activityKeyHistory) */
                activityKeyHistory: s.setup.activityKeyHistory.length > 0
                  ? s.setup.activityKeyHistory
                  : [payload.activityId ?? s.setup.activityId ?? ''].filter(Boolean),
              }
            : s.setup,
        })),
      clearActivation: () => set({ activatedKey: null, activatedPayload: null, licenseAudit: { status: 'no_key', at: new Date().toISOString() } }),
      /* ═══ v1.0.7 (موافقة المالك): تغيير النشاط بمفتاح الدعم الفني فقط ═══
         SHOPSYS2 موقّع من المطوّر لهذا الجهاز تحديداً، من النشاط الحالي إلى
         نشاط قالب معروف. التقييد: 30 يوماً بين تغييرين. القوالب (الخصائص
         والوحدات والهوية اللونية وقالب الفاتورة) تُطبَّق كاملة — البيانات
         المحاسبية والمخزنية تبقى كما هي، وضريبة النشاط لا تُلمس (تُضبط
         يدوياً من الإعدادات إن لزم). */
      applyActivityChangeKey: async (key, pubB64u) => {
        const state = get()
        if (!state.setup.completed) throw new Error('أكمل الإعداد الأول أولاً')
        if (!state.setup.activityId) throw new Error('لا يوجد نشاط حالي على الجهاز')
        const payload = await verifyActivityChangeKey(key, state.deviceId, pubB64u)
        /* ح8 (مراجعة ③): مفتاح التحويل يُطبَّق مرة واحدة. التحقق السابق يمنع المفتاح إن لم
           يطابق النشاط الحالي فقط — فمفتاح A→B الموقّع يُعاد تطبيقه بعد عودة الجهاز إلى A
           بمفتاح B→A دون طلب جديد من الدعم. */
        const fingerprint = keyFingerprint(key)
        if ((state.setup.activityKeyFingerprints ?? []).includes(fingerprint)) {
          throw new Error('مفتاح تحويل النشاط هذا استُخدم من قبل — اطلب مفتاحاً جديداً من الدعم')
        }
        if (payload.fromActivityId !== state.setup.activityId) {
          throw new Error(`المفتاح صادر للتحويل من نشاط «${payload.fromActivityId}» — نشاطك الحالي «${state.setup.activityId}». اطلب مفتاحاً محدّثاً من الدعم`)
        }
        if (payload.toActivityId === state.setup.activityId) throw new Error('المفتاح يحوّل إلى نشاطك الحالي نفسه — لا حاجة لأي تغيير')
        const template = ACTIVITY_TEMPLATES.find((t) => t.id === payload.toActivityId)
        if (!template) throw new Error(`نشاط غير معروف في هذه النسخة («${payload.toActivityId}») — حدّث التطبيق أولاً`)
        if (state.setup.lastActivityChangeAt) {
          const since = daysBetween(state.setup.lastActivityChangeAt.slice(0, 10), new Date().toISOString().slice(0, 10))
          if (since < ACTIVITY_CHANGE_COOLDOWN_DAYS) {
            throw new Error(`مضى ${since} يوماً فقط على آخر تغيير نشاط — التغيير مسموح كل ${ACTIVITY_CHANGE_COOLDOWN_DAYS} يوماً (باقٍ ${ACTIVITY_CHANGE_COOLDOWN_DAYS - since} يوماً)`)
          }
        }
        const now = new Date().toISOString()
        set((s) => ({
          appearance: { ...s.appearance, accentId: activityAccentId(template.id) },
          receipt: { ...s.receipt, defaultTemplate: template.defaultInvoiceTemplate },
          setup: {
            ...s.setup,
            activityId: template.id,
            features: template.features,
            modules: template.modules,
            lastActivityChangeAt: now,
            activityKeyHistory: [...s.setup.activityKeyHistory, template.id],
            activityKeyFingerprints: [...(s.setup.activityKeyFingerprints ?? []), fingerprint],
          },
        }))
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
      setCloudData: (patch) =>
        set((s) => ({
          cloudAbout: patch.about !== undefined ? patch.about : s.cloudAbout,
          revokedKeys: patch.revoked !== undefined ? patch.revoked : s.revokedKeys,
          cloudNotifications: patch.notifications !== undefined ? patch.notifications : s.cloudNotifications,
          deviceFlags: patch.flags !== undefined ? patch.flags : s.deviceFlags,
          cloudSyncedAt: new Date().toISOString(),
        })),
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
      /**
       * ث1 (تدقيق 2026-10-08): الحمولة لا تُخزَّن ولا تُقرأ من التخزين —
       * تُشتق من المفتاح الموقّع في كل إقلاع (`reverifyActivation`). وحالة
       * الفحص نفسها جلسة فقط. ما عدا ذلك يُحفظ كما هو حرفياً.
       */
      partialize: (state) => {
        const { activatedPayload: _payload, licenseAudit: _audit, ...rest } = state
        return rest
      },
      onRehydrateStorage: () => (state) => {
        /* ث1: أي حمولة محفوظة تُسقط فوراً — لا تُعتمد قبل إعادة التحقق من
           التوقيع. تُعلَّم الحالة `checking` كي لا تُعرض شاشة القفل في نافذة
           الفحص (وإلا ومضت لعميل مفعّل) — `App.tsx` ينتظرها قبل الحكم. */
        if (state) {
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
        // ترحيل: حسابات أُنشئت قبل فصل وحدتي «المخزون» و«المشتريات» كانت تراهما دائماً —
        // نضيفهما لها تلقائياً كي لا يختفي شيء بعد التحديث (إلا وجيستيكس/إيجار المعدات:
        // مخازنهم غير مستخدمة أصلاً فتبقى مطفأة كما يريد المالك، وتُفعَّل من الإعدادات عند الحاجة)
        if (state && state.setup.completed) {
          const mods = new Set(state.setup.modules)
          const knowsSplit = mods.has('inventory') || mods.has('purchases')
          const stockless = state.setup.activityId === 'logistics' || state.setup.activityId === 'equipment_rental'
          if (!knowsSplit && !stockless) {
            state.setup = { ...state.setup, modules: [...state.setup.modules, 'inventory', 'purchases'] }
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
      },
    },
  ),
)
