/**
 * تأكيد بلاغ المالك: «دخول موفق» ثم تبقى شاشة الدخول من جديد.
 * السيناريو: بدون أي rerender() يدوي — التطبيق يجب أن ينتقل للوحة التحكم
 * تلقائياً بعد نجاح الدخول (كما يحدث في المتصفح الحقيقي).
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
const { clearSessionAuthenticated } = await import('../src/data/sessionAuth.ts')

const OWNER_NAME = 'م. محمد عبدة'
const OWNER_PIN = 'Owner@2026'

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

describe('بلاغ: «دخول موفق» بلا دخول فعلي', () => {
  it('دخول ناجح — بدون rerender يدوي — يجب أن يفتح التطبيق لوحة التحكم مباشرة', async () => {
    await seedRegisteredShop()
    render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    fireEvent.change(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد'), { target: { value: OWNER_NAME } })
    fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: OWNER_PIN } })
    fireEvent.click(screen.getByText('دخول'))

    // بدون rerender() — في المتصفح الحقيقي لا يوجد rerender!
    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy(), { timeout: 3000 })
  })
})
