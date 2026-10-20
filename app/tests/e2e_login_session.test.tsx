/**
 * E2E — دخول/خروج حقيقي عبر الواجهة (ثلاثة قرارات المالك):
 * ① إجبار شاشة الدخول في كل فتح جديد (جلسة جديدة) حتى بلا تسجيل خروج صريح.
 * ② المعرف وحده يُحفظ تلقائياً — الرقم السري يُكتب يدوياً دوماً ولا يُحفظ قط.
 * ③ قائمة بأسماء من دخلوا من قبل على هذا الجهاز + خيار «مستخدم جديد».
 *
 * ملاحظة فنية: المتجران (useAppStore/useDataStore) متجران عامّان بمستوى
 * الوحدة (persist بتخزين مشفّر غير متزامن)، وتشغيل عدة سيناريوهات «فتح
 * تطبيق جديد» في نفس ملف الاختبار (mount/unmount متكرر) قد لا يُطلق إعادة
 * تصيير React تلقائياً بعد تغيّر متجر خارجي من دالة async خارج دورة الحدث
 * (محدودية بيئة jsdom/zustand في الاختبار وحده — لا علاقة لها بسلوك
 * المتصفح الحقيقي حيث يُحمَّل التطبيق مرة واحدة فقط). لذا نستدعي rerender()
 * يدوياً بعد أي إجراء يغيّر حالة الدخول قبل التحقق من الواجهة.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import React from 'react'

vi.stubGlobal('fetch', vi.fn((url: string) => (
  String(url).includes('/register')
    ? Promise.resolve(new Response(JSON.stringify({ ok: true, isNew: true }), { status: 200 }))
    : Promise.reject(new Error('offline'))
)))

const { default: App } = await import('../src/App.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useDataStore } = await import('../src/data/repo.ts')
const { getCountry } = await import('../src/core/countries.ts')
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')
const { hashPin } = await import('../src/core/audit.ts')
const { isSessionAuthenticated } = await import('../src/data/sessionAuth.ts')
const { rememberRecentLogin } = await import('../src/data/recentLogins.ts')

const OWNER_NAME = 'م. محمد عبدة'
const OWNER_PIN = 'Owner@2026'

/** يهيّئ متجراً كاملاً مُسجَّلاً (تخطي معالج أول تشغيل) + رقم سري معروف للمالك */
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
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: false, countryCode: null, activityId: null, shopName: '', ownerName: '', features: [], modules: [], accountingMode: 'simple' },
    fiscalYears: [],
  })
  useDataStore.setState({ ...useDataStore.getState(), categories: [], items: [], journal: [], seeded: false, ownerPinHash: null, currentUserId: null, loggedOut: false, appUsers: [] })
}

/**
 * المتجران محفوظان عبر persist (زوستاند) بتخزين مشفّر غير متزامن (WebCrypto) —
 * الترطيب الأول من القرص عملية لمرة واحدة لكل تحميل للوحدة، تحدث في خلفية
 * الاختبار الأول وقد تَصِل متأخرة فتُطيح بحالة اختبار لاحق إن لم نَنتظرها
 * أولاً (محاكاة واقعية لفتح تطبيق حقيقي ينتظر تحميله قبل أي تفاعل مستخدم).
 */
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

describe('شاشة الدخول: جلسة جديدة + تذكّر المعرف فقط + قائمة أسماء', () => {
  it('متجر مسجَّل من قبل لكنه يُفتح في جلسة جديدة بلا جلسة مصادَق عليها ⇒ شاشة الدخول تظهر رغم عدم وجود تسجيل خروج صريح', async () => {
    await seedRegisteredShop()
    render(<App />)
    // لا أثر لشريط القوائم العلوي — شاشة الدخول وحدها هي الظاهرة
    expect(await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')).toBeTruthy()
    expect(document.querySelector('[role="menubar"]')).toBeFalsy()
  })

  it('بلا أي اسم محفوظ من قبل على الجهاز ⇒ النموذج اليدوي يظهر مباشرة بلا شاشة اختيار فارغة', async () => {
    await seedRegisteredShop()
    render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
    expect(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد')).toBeTruthy()
    expect(screen.queryByText('مستخدم جديد')).toBeFalsy()
  })

  it('دخول ناجح باسم جديد: يُسجَّل في قائمة الجهاز، يُصادَق على الجلسة، ولا يُحفظ أي رقم سري على الإطلاق', async () => {
    await seedRegisteredShop()
    const { rerender } = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    fireEvent.change(screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد'), { target: { value: OWNER_NAME } })
    fireEvent.change(screen.getByPlaceholderText('كلمة السر'), { target: { value: OWNER_PIN } })
    fireEvent.click(screen.getByText('دخول'))
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    rerender(<App />)

    // بعد الدخول: شريط القوائم العلوي (لوحة التحكم) يظهر بدل شاشة الدخول
    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())

    // الجلسة مصادَق عليها الآن — تبقى سارية بلا إزعاج داخل نفس الجلسة
    expect(isSessionAuthenticated()).toBe(true)

    // قائمة الأسماء على الجهاز تحوي الاسم الآن — والمعرف فقط، بلا أي قيمة تشبه رقماً سرياً
    const raw = localStorage.getItem('tahakam-recent-logins') ?? '[]'
    expect(raw).toContain(OWNER_NAME)
    expect(raw).not.toContain(OWNER_PIN)
    // لا يوجد أي مفتاح تخزين آخر يحتفظ بالرقم السري الفعلي (لا حفظ إطلاقاً)
    const allValues = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n')
    expect(allValues).not.toContain(OWNER_PIN)
  })

  it('خروج صريح ثم إعادة تحميل الشاشة داخل نفس الجهاز: تظهر بطاقة الاسم المحفوظ للاختيار السريع + خيار «مستخدم جديد»', async () => {
    await seedRegisteredShop()
    rememberRecentLogin(OWNER_NAME, OWNER_NAME)

    const { rerender } = render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')

    // بطاقة الاسم المحفوظ ظاهرة (لا نموذج يدوي مباشرة) + زر مستخدم جديد
    expect(screen.getByText(OWNER_NAME)).toBeTruthy()
    expect(screen.getByText('مستخدم جديد')).toBeTruthy()
    // لا حقل رقم سري ظاهر قبل اختيار بطاقة — إذ لا شيء يُحفظ أو يُملأ تلقائياً
    expect(screen.queryByPlaceholderText('كلمة السر')).toBeFalsy()

    // اختيار البطاقة يملأ المعرف فقط وينتقل للنموذج اليدوي لكتابة الرقم يدوياً
    fireEvent.click(screen.getByText(OWNER_NAME))
    const idInput = screen.getByPlaceholderText('الاسم الكامل أو رقم الهاتف أو البريد') as HTMLInputElement
    expect(idInput.value).toBe(OWNER_NAME)
    const pinInput = screen.getByPlaceholderText('كلمة السر') as HTMLInputElement
    expect(pinInput.value).toBe('') // الرقم السري لم ولن يُملأ تلقائياً

    fireEvent.change(pinInput, { target: { value: OWNER_PIN } })
    fireEvent.click(screen.getByText('دخول'))
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(false))
    rerender(<App />)
    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeTruthy())

    // خروج صريح: الزر في الهيدر
    fireEvent.click(screen.getByTitle('تسجيل خروج — العودة لشاشة الدخول'))
    await waitFor(() => expect(useDataStore.getState().loggedOut).toBe(true))
    rerender(<App />)
    await waitFor(() => expect(document.querySelector('[role="menubar"]')).toBeFalsy())
    expect(isSessionAuthenticated()).toBe(false)
    // لا يزال الاسم محفوظاً لاختيار سريع في الدخول التالي
    expect(localStorage.getItem('tahakam-recent-logins') ?? '').toContain(OWNER_NAME)
  })

  it('حذف بطاقة من القائمة (زر ×) يزيلها من شاشة الاختيار فوراً دون المساس ببقية البطاقات', async () => {
    await seedRegisteredShop()
    rememberRecentLogin(OWNER_NAME, OWNER_NAME)
    rememberRecentLogin('01099999999', 'موظف تجريبي')

    render(<App />)
    await screen.findByText('اكتب اسمك أو هاتفك أو بريدك ثم رقمك السري')
    expect(screen.getByText(OWNER_NAME)).toBeTruthy()
    expect(screen.getByText('موظف تجريبي')).toBeTruthy()

    const ownerTile = screen.getByText(OWNER_NAME).closest('button')!
    const removeBtn = within(ownerTile).getByTitle('إزالة هذا الاسم من قائمة الجهاز')
    fireEvent.click(removeBtn)

    expect(screen.queryByText(OWNER_NAME)).toBeFalsy()
    expect(screen.getByText('موظف تجريبي')).toBeTruthy()
    expect(localStorage.getItem('tahakam-recent-logins') ?? '').not.toContain(OWNER_NAME)
  })
})
