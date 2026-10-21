/**
 * اختبار انحدار لبلاغ المالك (2026-10-21):
 * «يكتب دخول موفق ولا يسجّل دخول»
 * السبب: sessionStorage محظور في تطبيق سطح المكتب (Electron على file:// —
 * SecurityError: Access is denied for this document، انظر issue electron/electron#18470)
 * بينما localStorage يعمل. يجب أن يفتح التطبيق بعد الرقم السري الصحيح،
 * وأن تُفرض شاشة الدخول من جديد عند «إغلاق التطبيق وإعادة فتحه».
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { default: App } = await import('../src/App.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { getCountry } = await import('../src/core/countries.ts')
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')
const { hashPin } = await import('../src/core/audit.ts')
const { clearSessionAuthenticated, isSessionAuthenticated } = await import('../src/data/sessionAuth.ts')

const OWNER_NAME = 'م. محمد عبدة'
const OWNER_PIN = 'Owner@2026'

/** يحظر sessionStorage بالكامل — محاكاة SecurityError في تطبيق سطح المكتب (file://) */
function blockSessionStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    },
  })
  return () => {
    if (original) Object.defineProperty(window, 'sessionStorage', original)
    else delete (window as unknown as Record<string, unknown>).sessionStorage
  }
}

async function seedRegisteredShop() {
  const app = useAppStore.getState()
  app.acceptLegal()
  const country = getCountry('EG')!
  const activity = ACTIVITY_TEMPLATES.find((a) => a.id === 'grocery')!
  app.completeSetup({
    country, activity, shopName: 'سوق الاختبار', ownerName: OWNER_NAME,
    fiscalYear: { nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' },
    contact: { phone: '01000000000', email: 'owner@tahakam.app', city: 'القاهرة', street: 'شارع التحرير' },
  })
  const pinHash = await hashPin(OWNER_PIN)
  useDataStore.getState().updateOwnerProfile({ nameAr: OWNER_NAME })
  useDataStore.getState().setOwnerPin(pinHash)
}

function resetAll() {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  clearSessionAuthenticated()
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: false, countryCode: null, activityId: null, shopName: '', ownerName: '', features: [], modules: [], accountingMode: 'simple' },
    fiscalYears: [],
  })
  useDataStore.setState({ ...useDataStore.getState(), categories: [], items: [], journal: [], seeded: false, ownerPinHash: null, currentUserId: null, loggedOut: false, appUsers: [] })
}

async function waitForHydration() {
  await new Promise<void>((resolve) => {
    let doneApp = useAppStore.persist.hasHydrated()
    let doneData = useDataStore.persist.hasHydrated()
    const check = () => { if (doneApp && doneData) resolve() }
    useAppStore.persist.onFinishHydration(() => { doneApp = true; check() })
    useDataStore.persist.onFinishHydration(() => { doneData = true; check() })
    check()
  })
}

beforeAll(waitForHydration)
beforeEach(resetAll)
afterEach(cleanup)

describe('بلاغ: sessionStorage محظور (تطبيق سطح المكتب file://)', () => {
  it('دخول — بعد الرقم السري الصحيح يفتح التطبيق رغم فشل الكتابة في sessionStorage', async () => {
    const unblock = blockSessionStorage()
    try {
      await seedRegisteredShop()
      render(<App />)
      await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

      fireEvent.change(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد'), { target: { value: OWNER_NAME } })
      fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: OWNER_PIN } })
      fireEvent.click(screen.getByText('دخول'))

      // التطبيق: بعد «دخول موفق» يجب أن ينتقل التطبيق للوحة التحكم — لا تبقى شاشة الدخول
      await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy(), { timeout: 3000 })
      expect(isSessionAuthenticated()).toBe(true)
    } finally {
      unblock()
    }
  })

  it('«إغلاق التطبيق وإعادة فتحه» — تُفرض شاشة الدخول من جديد رغم أن sessionStorage لا يعمل', async () => {
    const unblock = blockSessionStorage()
    try {
      await seedRegisteredShop()
      const first = render(<App />)
      await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
      fireEvent.change(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد'), { target: { value: OWNER_NAME } })
      fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: OWNER_PIN } })
      fireEvent.click(screen.getByText('دخول'))
      await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy(), { timeout: 3000 })
      first.unmount()

      // محاكاة إغلاق التطبيق وإعادة فتحه: نافذة جديدة = علم جلسة فارغ
      clearSessionAuthenticated()
      expect(isSessionAuthenticated()).toBe(false)
      render(<App />)
      await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
      expect(document.querySelector('[role="menubar"]')).toBeFalsy()
    } finally {
      unblock()
    }
  })

  it('رقم خاطئ — لا يفتح التطبيق ولا تُصادَق الجلسة', async () => {
    const unblock = blockSessionStorage()
    try {
      await seedRegisteredShop()
      render(<App />)
      await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
      fireEvent.change(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد'), { target: { value: OWNER_NAME } })
      fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: 'WrongPin@1' } })
      fireEvent.click(screen.getByText('دخول'))
      await screen.findByText(/رقم سري خاطئ/)
      expect(document.querySelector('[role="menubar"]')).toBeFalsy()
      expect(isSessionAuthenticated()).toBe(false)
    } finally {
      unblock()
    }
  })
})
