import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSupportToken, getOrCreateSupportToken, isSupportToken } from '../src/data/supportAuth.ts'
import { fetchConversation, sendSupportMessage } from '../src/core/support.ts'

describe('توثيق قناة الدعم', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSupportToken()
    vi.restoreAllMocks()
  })

  it('ينشئ اعتماد 256-bit ثابتاً ومشفراً على الجهاز', async () => {
    const first = await getOrCreateSupportToken()
    const second = await getOrCreateSupportToken()
    expect(isSupportToken(first)).toBe(true)
    expect(second).toBe(first)
    expect(localStorage.getItem('tahakam-support-token-v1')).not.toContain(first)
  })

  it('يرسل الاعتماد في Authorization عند القراءة والكتابة', async () => {
    const token = await getOrCreateSupportToken()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchConversation('https://support.example', 'SHOP-AAAA-BBBB-CCCC', token)
    await sendSupportMessage('https://support.example', 'SHOP-AAAA-BBBB-CCCC', token, {
      text: 'مشكلة اختبار', customer: 'متجر', activity: 'عام', appVersion: '1.0',
    })

    for (const call of fetchMock.mock.calls) {
      const options = call[1] as RequestInit
      expect((options.headers as Record<string, string>).Authorization).toBe(`Support ${token}`)
      const headers = options.headers as Record<string, string>
      expect(headers['X-Support-Protocol']).toBe('2')
      expect(headers['X-Support-Timestamp']).toMatch(/^\d{10}$/)
      expect(headers['X-Support-Nonce']).toMatch(/^[A-Za-z0-9_-]{24}$/)
      expect(headers['X-Support-Signature']).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('لا يجري طلباً باعتماد ضعيف أو مشوه', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchConversation('https://support.example', 'SHOP-AAAA-BBBB-CCCC', 'weak')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
