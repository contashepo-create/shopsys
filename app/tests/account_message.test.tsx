/**
 * رسالة المطوّر لهذا الجهاز (عرض فقط) — مسار واحد من بوت المركز إلى شاشتي «حول» والقفل.
 *
 * يثبت هذا الاختبار:
 *   ① العقد: حقل `message` في dev:<id> يخرج من /subscription في عامل devbot ويصل التطبيق.
 *   ② التنقية: نص عرض عادي، بلا وسوم ولا محارف تحكم، وبطول محدود.
 *   ③ الفشل الشبكي لا يمسح الرسالة المحفوظة (أوفلاين أولاً).
 *   ④ الرسالة لا تُنفَّذ كـHTML، وتظهر فقط عند وجود نص.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import React from 'react'

const { parseAccountMessage, fetchAccountMessage, LICENSE_CLOUD_BASE_URL } = await import('../src/core/cloud.ts')
const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { DeveloperMessage } = await import('../src/ui/components/DeveloperMessage.tsx')

class MemoryKv {
  private values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string) { this.values.set(key, String(value)) }
  async delete(key: string) { this.values.delete(key) }
  async list() { return { keys: [...this.values.keys()].map((name) => ({ name })), list_complete: true } }
}

const DEV = 'a1b2c3d4e5f60718'
const env_ = (kv: MemoryKv) => ({
  SHOPSYS_CONTROL: kv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: 'unused-here',
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
})

describe('① العقد: dev.message من devbot يصل التطبيق', () => {
  it('الرسالة المكتوبة في dev: تُقرأ من /subscription بالاسم نفسه', async () => {
    const kv = new MemoryKv()
    await kv.put(`dev:${DEV}`, JSON.stringify({ plan: 'basic', expiresAt: null, message: 'يرجى التواصل لتجديد الاشتراك' }))
    const res = await devbotWorker.fetch(new Request(`https://x.dev/subscription/${DEV}`), env_(kv)) as Response
    expect(parseAccountMessage(await res.json())).toBe('يرجى التواصل لتجديد الاشتراك')
  })

  it('جهاز بلا سجل ⇒ رسالة فارغة (لا تبقى رسالة قديمة)', async () => {
    const kv = new MemoryKv()
    const res = await devbotWorker.fetch(new Request(`https://x.dev/subscription/${DEV}`), env_(kv)) as Response
    expect(parseAccountMessage(await res.json())).toBe('')
  })
})

describe('② التنقية', () => {
  it('ليس كائناً ⇒ فارغ', () => {
    expect(parseAccountMessage(null)).toBe('')
    expect(parseAccountMessage('نص')).toBe('')
    expect(parseAccountMessage({})).toBe('')
    expect(parseAccountMessage({ message: 42 })).toBe('')
  })

  it('تزيل الزاويتين < > ومحارف التحكم وتقصّ الطول (لا وسم فعلي يبقى)', () => {
    expect(parseAccountMessage({ message: '  <b>مرحبا</b>\u0007  ' })).toBe('bمرحبا/b')
    expect(parseAccountMessage({ message: 'x'.repeat(500) })).toHaveLength(300)
  })
})

describe('③ الجلب', () => {
  it('يبني الرابط بمعرف مُرمَّز ويعيد الرسالة', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ plan: 'basic', message: 'تنبيه' }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAccountMessage(`${LICENSE_CLOUD_BASE_URL}/`, 'id/with space')).toBe('تنبيه')
    expect(fetchMock.mock.calls[0][0]).toBe(`${LICENSE_CLOUD_BASE_URL}/subscription/id%2Fwith%20space`)
  })

  it('أوفلاين ⇒ null (لا يُمسّ المحفوظ)', async () => {
    expect(await fetchAccountMessage(LICENSE_CLOUD_BASE_URL, DEV)).toBeNull()
  })

  it('استجابة خطأ HTTP ⇒ null', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 500 }))))
    expect(await fetchAccountMessage(LICENSE_CLOUD_BASE_URL, DEV)).toBeNull()
  })
})

describe('④ العرض', () => {
  afterEach(() => cleanup())

  it('بلا نص لا يظهر أي صندوق', () => {
    const { container } = render(<DeveloperMessage message="" />)
    expect(container.innerHTML).toBe('')
  })

  it('النص يظهر كنص عادي ولا يُنفَّذ كـHTML', () => {
    render(<DeveloperMessage message="<img src=x onerror=alert(1)>مرحباً" />)
    expect(screen.getByRole('note').textContent).toContain('<img src=x onerror=alert(1)>مرحباً')
    expect(screen.getByRole('note').querySelector('img')).toBeNull()
  })
})
