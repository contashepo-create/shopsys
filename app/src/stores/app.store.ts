/**
 * مخزن حالة التطبيق — الإعدادات العامة والثيم ومعالج أول تشغيل
 * (اليوم: localStorage — غداً: جدول settings في SQLite عبر نفس الواجهة)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Country } from '../core/countries.ts'
import type { ActivityTemplate, ItemFeature, BusinessModule } from '../core/activities.ts'
import type { FiscalYear } from '../core/fiscal.ts'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '../core/receipt.ts'
import { generateDeviceId, type LicensePayload } from '../core/license.ts'

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
  accountingMode: 'simple' | 'full'
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
  }) => void
  addFiscalYear: (fy: Omit<FiscalYear, 'id' | 'status'>) => void
  setAccountingMode: (m: 'simple' | 'full') => void
  resetSetup: () => void
  receipt: ReceiptSettings
  autoPrintAfterSale: boolean
  updateReceipt: (patch: Partial<ReceiptSettings>) => void
  setAutoPrint: (v: boolean) => void
  // ─── الترخيص (القرار 4) ───
  deviceId: string // معرف الجهاز — يتولد مرة واحدة
  trialStartedAt: string // مرساة بداية التجربة
  lastSeenAt: string // مرساة ضد إرجاع الساعة
  activatedKey: string | null // مفتاح التفعيل النصي كما أدخل
  activatedPayload: LicensePayload | null // حمولته الموثقة بعد التحقق
  setActivated: (key: string, payload: LicensePayload) => void
  clearActivation: () => void
  touchLastSeen: () => void
}

/** توليد معرف جهاز + مراسي زمنية عند أول تشغيل */
const bootIdentity = () => {
  const rnd = new Uint8Array(12)
  crypto.getRandomValues(rnd)
  return { deviceId: generateDeviceId(rnd), now: new Date().toISOString() }
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
        accountingMode: 'simple',
      },
      fiscalYears: [],
      completeSetup: ({ country, activity, shopName, ownerName, fiscalYear }) =>
        set((s) => ({
          fiscalYears: [{ ...fiscalYear, id: 1, status: 'open' }],
          receipt: { ...s.receipt, shopName }, // اسم المحل يظهر على الإيصال تلقائياً
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
          },
        })),
      addFiscalYear: (fy) =>
        set((s) => ({
          fiscalYears: [...s.fiscalYears, { ...fy, id: s.fiscalYears.reduce((m, y) => Math.max(m, y.id), 0) + 1, status: 'open' }],
        })),
      setAccountingMode: (m) => set((s) => ({ setup: { ...s.setup, accountingMode: m } })),
      resetSetup: () =>
        set((s) => ({
          setup: { ...s.setup, completed: false, countryCode: null, activityId: null },
        })),
      receipt: DEFAULT_RECEIPT_SETTINGS,
      autoPrintAfterSale: false,
      updateReceipt: (patch) => set((s) => ({ receipt: { ...s.receipt, ...patch } })),
      setAutoPrint: (v) => set({ autoPrintAfterSale: v }),
      deviceId: BOOT.deviceId,
      trialStartedAt: BOOT.now,
      lastSeenAt: BOOT.now,
      activatedKey: null,
      activatedPayload: null,
      setActivated: (key, payload) => set({ activatedKey: key, activatedPayload: payload }),
      clearActivation: () => set({ activatedKey: null, activatedPayload: null }),
      touchLastSeen: () =>
        set((s) => {
          const now = new Date().toISOString()
          // لا نرجع المرساة للخلف أبداً — هي خط دفاع ضد إرجاع الساعة
          return now > s.lastSeenAt ? { lastSeenAt: now } : {}
        }),
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
        // ترحيل: إعدادات إيصال لحسابات قديمة (قبل ميزة الطباعة / قبل قالب A4 / قبل مفاتيح الإظهار)
        if (state && !state.receipt) {
          state.receipt = { ...DEFAULT_RECEIPT_SETTINGS, shopName: state.setup.shopName }
        } else if (state) {
          // أي مفتاح جديد أُضيف لاحقاً يأخذ قيمته الافتراضية دون المساس بما اختاره المستخدم
          state.receipt = { ...DEFAULT_RECEIPT_SETTINGS, ...state.receipt }
        }
        // ترحيل: حسابات قبل ميزة الترخيص تحصل على هوية جهاز ومراسي زمنية
        if (state && !state.deviceId) {
          state.deviceId = BOOT.deviceId
          state.trialStartedAt = BOOT.now
          state.lastSeenAt = BOOT.now
          state.activatedKey = null
          state.activatedPayload = null
        }
      },
    },
  ),
)
