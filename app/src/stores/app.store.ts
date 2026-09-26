/**
 * مخزن حالة التطبيق — الإعدادات العامة والثيم ومعالج أول تشغيل
 * (اليوم: localStorage — غداً: جدول settings في SQLite عبر نفس الواجهة)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Country } from '../core/countries.ts'
import { toggleModuleList, effectiveModules, type ActivityTemplate, type ItemFeature, type BusinessModule } from '../core/activities.ts'
import type { FiscalYear } from '../core/fiscal.ts'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '../core/receipt.ts'
import { DEFAULT_LOYALTY, type LoyaltySettings } from '../core/loyalty.ts'
import { generateDeviceId, type LicensePayload } from '../core/license.ts'
import { DEFAULT_APPEARANCE, sanitizeAppearance, activityAccentId, type AppearanceSettings } from '../core/appearance.ts'
import { DEFAULT_TELEGRAM_SETTINGS, type TelegramSettings } from '../core/telegram.ts'
import { DEFAULT_EINVOICE_SETTINGS, type EinvoiceSettings } from '../core/einvoice.ts'
import { DEFAULT_SCHEDULE_SETTINGS, type ScheduleSettings } from '../core/schedule.ts'
import { DEFAULT_REPORT_PRINT, type ReportPrintSettings } from '../core/reportPrint.ts'
import { DEFAULT_LABEL_SETTINGS, type LabelSettings } from '../core/labels.ts'
import { DEFAULT_SCALE_RULES, validateScaleRule, type ScaleRule } from '../core/barcode.ts'
import type { AboutContent } from '../core/cloud.ts'
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
}

interface AppState {
  theme: ThemeMode
  toggleTheme: () => void
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
  setAccountingMode: (m: 'simple' | 'full') => void
  /** تفعيل/إلغاء وحدة عمل من الإعدادات (طلب المالك: الوحدات حسب النشاط وقابلة للتبديل) */
  toggleModule: (m: BusinessModule) => void
  resetSetup: () => void
  receipt: ReceiptSettings
  /** برنامج نقاط الولاء (نمط Lightspeed Loyalty) — الكسب والاستبدال من الكاشير */
  loyalty: LoyaltySettings
  updateLoyalty: (patch: Partial<LoyaltySettings>) => void
  /** إعدادات طباعة التقارير المعممة (طلب المالك): كل تقارير النظام لا الفواتير فقط */
  reportPrint: ReportPrintSettings
  updateReportPrint: (patch: Partial<ReportPrintSettings>) => void
  /** قالب ملصقات الباركود/السيريال — يُضبط مرة ويسري على كل الطباعات (طلب المالك) */
  labelSettings: LabelSettings
  updateLabelSettings: (patch: Partial<LabelSettings>) => void
  /** قواعد باركود الميزان العالمية (أي ميزان بأي صيغة) — تُجرب بالترتيب في الكاشير */
  scaleRules: ScaleRule[]
  addScaleRule: (rule: Omit<ScaleRule, 'id'>) => void
  updateScaleRule: (id: number, patch: Partial<Omit<ScaleRule, 'id'>>) => void
  removeScaleRule: (id: number) => void
  autoPrintAfterSale: boolean
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
  lastDailySentDay: string | null // «YYYY-MM-DD» — يمنع تكرار إرسال اليوم
  setLastDailySentDay: (day: string) => void
  // ─── الترخيص (القرار 4) ───
  deviceId: string // معرف الجهاز — يتولد مرة واحدة
  trialStartedAt: string // مرساة بداية التجربة
  lastSeenAt: string // مرساة ضد إرجاع الساعة
  activatedKey: string | null // مفتاح التفعيل النصي كما أدخل
  activatedPayload: LicensePayload | null // حمولته الموثقة بعد التحقق
  setActivated: (key: string, payload: LicensePayload) => void
  clearActivation: () => void
  touchLastSeen: () => void
  // ─── السحابة (القرار 28): آخر ما جُلب من Cloudflare — يعمل أوفلاين بآخر نسخة ───
  cloudAbout: AboutContent | null
  revokedKeys: string[] // بصمات المفاتيح المحروقة
  cloudSyncedAt: string | null
  setCloudData: (patch: { about?: AboutContent | null; revoked?: string[]; flags?: DeviceFlags | null }) => void
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
    (set) => ({
      theme: 'light',
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
          },
        })),
      addFiscalYear: (fy) =>
        set((s) => ({
          fiscalYears: [...s.fiscalYears, { ...fy, id: s.fiscalYears.reduce((m, y) => Math.max(m, y.id), 0) + 1, status: 'open' }],
        })),
      markFiscalYearClosed: (id) =>
        set((s) => ({ fiscalYears: s.fiscalYears.map((y) => (y.id === id ? { ...y, status: 'closed' as const } : y)) })),
      setAccountingMode: (m) => set((s) => ({ setup: { ...s.setup, accountingMode: m } })),
      toggleModule: (m) =>
        set((s) => ({ setup: { ...s.setup, modules: toggleModuleList(s.setup.modules, m) } })),
      resetSetup: () =>
        set((s) => ({
          setup: { ...s.setup, completed: false, countryCode: null, activityId: null },
        })),
      receipt: DEFAULT_RECEIPT_SETTINGS,
      loyalty: DEFAULT_LOYALTY,
      updateLoyalty: (patch) => set((s) => ({ loyalty: { ...s.loyalty, ...patch } })),
      reportPrint: DEFAULT_REPORT_PRINT,
      updateReportPrint: (patch) => set((s) => ({ reportPrint: { ...s.reportPrint, ...patch } })),
      labelSettings: DEFAULT_LABEL_SETTINGS,
      updateLabelSettings: (patch) => set((s) => ({ labelSettings: { ...s.labelSettings, ...patch } })),
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
      lastDailySentDay: null,
      setLastDailySentDay: (day) => set({ lastDailySentDay: day }),
      deviceId: BOOT.deviceId,
      trialStartedAt: BOOT.firstTrialAt,
      lastSeenAt: BOOT.now,
      activatedKey: null,
      activatedPayload: null,
      setActivated: (key, payload) =>
        set((s) => ({
          activatedKey: key,
          activatedPayload: payload,
          // سياسة الأقسام: الوحدات = افتراضيات النشاط + ما فعّله المطوّر في المفتاح فقط
          setup: s.setup.completed
            ? { ...s.setup, modules: effectiveModules(s.setup.activityId, payload.extraModules) }
            : s.setup,
        })),
      clearActivation: () => set({ activatedKey: null, activatedPayload: null }),
      touchLastSeen: () =>
        set((s) => {
          const now = new Date().toISOString()
          // لا نرجع المرساة للخلف أبداً — هي خط دفاع ضد إرجاع الساعة
          return now > s.lastSeenAt ? { lastSeenAt: now } : {}
        }),
      cloudAbout: null,
      revokedKeys: [],
      deviceFlags: null,
      cloudSyncedAt: null,
      setCloudData: (patch) =>
        set((s) => ({
          cloudAbout: patch.about !== undefined ? patch.about : s.cloudAbout,
          revokedKeys: patch.revoked !== undefined ? patch.revoked : s.revokedKeys,
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
      onRehydrateStorage: () => (state) => {
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
          state.setup.requireOpenShiftForSales = state.setup.requireOpenShiftForSales ?? true
          state.loyalty = { ...DEFAULT_LOYALTY, ...(state.loyalty ?? {}) }
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
        // ترحيل: حسابات قبل ميزة التليجرام تحصل على الافتراضيات
        if (state) state.telegram = { ...DEFAULT_TELEGRAM_SETTINGS, ...state.telegram }
        // ترحيل: حسابات قبل ميزة المزامنة السحابية تحصل على الافتراضيات
        if (state) state.sync = { ...DEFAULT_SYNC_SETTINGS, ...state.sync }
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
        if (state && state.trialStartedAt > BOOT.firstTrialAt) {
          state.trialStartedAt = BOOT.firstTrialAt
        }
      },
    },
  ),
)
