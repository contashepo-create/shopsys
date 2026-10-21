/**
 * تشخيص بلاغ المالك: «دخول موفق» لكن التطبيق يبقى على شاشة الدخول ويطلب الرقم مرة أخرى.
 * سيناريوهات Mitarbeiter/الموظف + إعادة فتح التطبيق بجلسة محفوظة.
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
const { isSessionAuthenticated, clearSessionAuthenticated } = await import('../src/data/sessionAuth.ts')
const { rememberRecentLogin } = await import('../src/data/recentLogins.ts')

const OWNER_NAME = 'م. محمد عبدة'
const OWNER_PIN = 'Owner@2026'
const EMP_NAME = 'أحمد الكاشير'
const EMP_PIN = 'Emp@12345'

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

async function seedEmployee(mustChangePin: boolean) {
  const pinHash = await hashPin(EMP_PIN)
  useDataStore.getState().addAppUser({
    nameAr: EMP_NAME, roleId: 'cashier', pinHash, phone: '01011111111',
    initialPin: mustChangePin ? EMP_PIN : null, mustChangePin,
  })
}

function resetAll() {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  clearSessionAuthenticated() // تصفير علم الجلسة في الذاكرة — محاكاة جلسة جديدة
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: false, countryCode: null, activityId: null, shopName: '', ownerName: '', features: [], modules: [], accountingMode: 'simple' },
    fiscalYears: [],
  })
  useDataStore.setState({ ...useDataStore.getState(), categories: [], items: [], journal: [], seeded: false, ownerPinHash: null, currentUserId: null, loggedOut: false, appUsers: [], loginGuard: { failures: 0, lockedUntil: null } })
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

async function loginViaForm(identifier: string, pin: string) {
  const idInput = screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد')
  fireEvent.change(idInput, { target: { value: identifier } })
  fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: pin } })
  fireEvent.click(screen.getByText('دخول'))
}

describe('تشخيص بلاغ «دخول موفق بلا دخول فعلي»', () => {
  it('سيناريو 1: دخول موظف (رقم known، mustChangePin=false) في جلسة جديدة', async () => {
    await seedRegisteredShop()
    await seedEmployee(false)
    const { rerender } = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    await loginViaForm(EMP_NAME, EMP_PIN)
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    rerender(<App />)

    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())
    expect(isSessionAuthenticated()).toBe(true)
    expect(useDataStore.getState().currentUserId).not.toBeNull()
  })

  it('سيناريو 2: إعادة فتح التطبيق (جلسة جديدة) مع currentUserId محفوظ من الجلسة السابقة — ثم دخول الموظف مرة أخرى', async () => {
    await seedRegisteredShop()
    await seedEmployee(false)
    const first = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
    await loginViaForm(EMP_NAME, EMP_PIN)
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    first.rerender(<App />)
    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())
    const empId = useDataStore.getState().currentUserId
    expect(empId).not.toBeNull()
    first.unmount()

    // محاكاة «إغلاق التطبيق وإعادة فتحه»: sessionStorage SOLO تمسح، localStorage (persist) تبقى
    clearSessionAuthenticated() // محاكاة «إغلاق التطبيق»: العلم في الذاكرة و sessionStorage معاً
    expect(isSessionAuthenticated()).toBe(false)
    // currentUserId و loggedOut= false محفوظان في localStorage (persist)
    expect(useDataStore.getState().currentUserId).toBe(empId)
    expect(useDataStore.getState().loggedOut).toBe(false)

    const second = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
    // الاسم محفوظ لبطاقة اختيار سريع
    rememberRecentLogin(EMP_NAME, EMP_NAME)
    second.rerender(<App />)
    await screen.findByText(EMP_NAME)
    fireEvent.click(screen.getByText(EMP_NAME)) // اختيار البطاقة (المعرف فقط)

    fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: EMP_PIN } })
    fireEvent.click(screen.getByText('دخول'))
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    second.rerender(<App />)

    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())
    expect(isSessionAuthenticated()).toBe(true)
  })

  it('سيناريو 3: أول دخول لموظف (mustChangePin=true) — Arbeitgeber modal + تعيين رقم جديد', async () => {
    await seedRegisteredShop()
    await seedEmployee(true)
    const { rerender } = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    await loginViaForm(EMP_NAME, EMP_PIN)
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    rerender(<App />)

    // يجب أن يظهر مودال «تعيين رقم جديد» (إجباري)
    await screen.findByText('🔑 عيّن رقمك السري الجديد الآن')
    // لا masih شاشة الدخول خلف المودال
    expect(document.querySelector('[role="menubar"]')).toBeFalsy()

    const newPin = 'NewPin@2026'
    const pinInputs = screen.getAllByPlaceholderText(/كلمة السر|تأكيد/)
    fireEvent.change(screen.getByPlaceholderText('كلمة السر الجديدة'), { target: { value: newPin } })
    fireEvent.change(screen.getByPlaceholderText('تأكيد كلمة السر'), { target: { value: newPin } })
    fireEvent.click(screen.getByText('حفظ كلمة السر الجديدة'))
    await waitFor(() => expect(useDataStore.getState().appUsers.find((u) => u.nameAr === EMP_NAME)?.mustChangePin).toBe(false))
    rerender(<App />)

    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())
    expect(isSessionAuthenticated()).toBe(true)
    void pinInputs
  })

  it('سيناريو 4: دخول المالك بينما currentUserId محفوظ لموظف (جلسة سابقة) — المالك يدخل من نفس النموذج', async () => {
    await seedRegisteredShop()
    await seedEmployee(false)
    // محاكاة جلسة سابقة لموظف: currentUserId محفوظ، loggedOut=false، لكن sessionStorage فارغة (فتح جديد)
    const emp = useDataStore.getState().appUsers.find((u) => u.nameAr === EMP_NAME)!
    useDataStore.setState({ currentUserId: emp.id, loggedOut: false })
    clearSessionAuthenticated() // جلسة نافذة جديدة — العلم في الذاكرة فارغ

    const { rerender } = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    await loginViaForm(OWNER_NAME, OWNER_PIN)
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    rerender(<App />)

    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())
    expect(useDataStore.getState().currentUserId).toBeNull() // المالك = null
    expect(isSessionAuthenticated()).toBe(true)
  })
})
