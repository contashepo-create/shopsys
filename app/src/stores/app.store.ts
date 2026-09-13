/**
 * مخزن حالة التطبيق — الإعدادات العامة والثيم ومعالج أول تشغيل
 * (اليوم: localStorage — غداً: جدول settings في SQLite عبر نفس الواجهة)
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Country } from '../core/countries.ts'
import type { ActivityTemplate, ItemFeature, BusinessModule } from '../core/activities.ts'

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
  completeSetup: (data: {
    country: Country
    activity: ActivityTemplate
    shopName: string
    ownerName: string
  }) => void
  setAccountingMode: (m: 'simple' | 'full') => void
  resetSetup: () => void
}

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
      completeSetup: ({ country, activity, shopName, ownerName }) =>
        set({
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
        }),
      setAccountingMode: (m) => set((s) => ({ setup: { ...s.setup, accountingMode: m } })),
      resetSetup: () =>
        set((s) => ({
          setup: { ...s.setup, completed: false, countryCode: null, activityId: null },
        })),
    }),
    { name: 'shopsys-app' },
  ),
)
