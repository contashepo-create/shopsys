/**
 * F14 (مراجعة التوافق 2026-10-10): رسالة المطوّر للاشتراك.
 * المطوّر يكتبها (مثل «تم إيقاف الاشتراك — تواصل مع المطوّر») في dev:<id>.message،
 * والتطبيق يجلبها من /subscription/<id> على عامل الترخيص ويعرضها في صفحة الترخيص.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseSubscriptionNote, fetchSubscriptionNote, SUBSCRIPTION_NOTE_MAX } from '../src/core/cloud.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const BASE = 'https://shopsys-control.example.workers.dev'

afterEach(() => { vi.unstubAllGlobals() })

describe('parseSubscriptionNote', () => {
  it('ترجع نص الرسالة كما هو', () => {
    expect(parseSubscriptionNote({ plan: 'basic', expiresAt: null, message: 'تم إيقاف الاشتراك — تواصل مع المطوّر' }))
      .toBe('تم إيقاف الاشتراك — تواصل مع المطوّر')
  })

  it('رسالة فارغة ⇒ «» (تعني: لا رسالة، فتُمسح القديمة)', () => {
    expect(parseSubscriptionNote({ plan: '', expiresAt: null, message: '' })).toBe('')
    expect(parseSubscriptionNote({ plan: 'basic' })).toBe('')
  })

  it('يُنزع منها < و > ومحارف التحكم، ويُقصّ الطول', () => {
    const cleaned = parseSubscriptionNote({ message: '<script>x</script>\u0007' })
    expect(cleaned).not.toMatch(/[<>\u0007]/)
    const long = parseSubscriptionNote({ message: 'ا'.repeat(SUBSCRIPTION_NOTE_MAX + 200) })
    expect(long).toHaveLength(SUBSCRIPTION_NOTE_MAX)
  })

  it('شكل غير متوقع ⇒ null (لا تُمسّ الرسالة المحفوظة)', () => {
    expect(parseSubscriptionNote(null)).toBeNull()
    expect(parseSubscriptionNote('نص')).toBeNull()
    expect(parseSubscriptionNote([{ message: 'x' }])).toBeNull()
  })
})

describe('fetchSubscriptionNote', () => {
  it('يطلب /subscription/<id> ويعيد الرسالة', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan: 'pro', expiresAt: null, message: 'تجديد الاشتراك' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSubscriptionNote(BASE, 'SHOP-ABC123')).resolves.toBe('تجديد الاشتراك')
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE}/subscription/SHOP-ABC123`)
  })

  it('الشبكة متوقفة (أوفلاين) ⇒ null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    await expect(fetchSubscriptionNote(BASE, 'SHOP-ABC123')).resolves.toBeNull()
  })

  it('رد غير ناجح ⇒ null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    await expect(fetchSubscriptionNote(BASE, 'SHOP-ABC123')).resolves.toBeNull()
  })
})

describe('حفظ الرسالة في المتجر', () => {
  it('تُحفظ وتبقى عند تحديثات أخرى، وتُمسح برسالة فارغة', () => {
    const { setCloudData } = useAppStore.getState()
    setCloudData({ subscriptionNote: 'تم إيقاف الاشتراك' })
    expect(useAppStore.getState().cloudSubscriptionNote).toBe('تم إيقاف الاشتراك')
    setCloudData({ revoked: [] })
    expect(useAppStore.getState().cloudSubscriptionNote).toBe('تم إيقاف الاشتراك')
    setCloudData({ subscriptionNote: '' })
    expect(useAppStore.getState().cloudSubscriptionNote).toBe('')
  })
})
