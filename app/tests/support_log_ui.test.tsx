import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ fetchConversation: vi.fn(async () => []), sendSupportMessage: vi.fn(async (_base: string, _device: string, _token: string, _payload: import('../src/core/support.ts').ClientSupportPayload) => ({ ok: true, status: 200, reason: 'حُفظت الرسالة وأُرسل إشعار إلى المطوّر', notified: true, logNotified: true, offline: false, attempts: 1 })), token: vi.fn(async () => 'A'.repeat(43)) }))
vi.mock('../src/data/supportAuth.ts', () => ({ getOrCreateSupportToken: mocks.token }))
vi.mock('../src/core/support.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/core/support.ts')>(), fetchConversation: mocks.fetchConversation, sendSupportMessage: mocks.sendSupportMessage }))
import { SupportPage } from '../src/ui/pages/SupportPage.tsx'
import { logEvent } from '../src/core/applog.ts'
const attach = () => screen.getByRole('checkbox', { name: /إرفاق مقتطف/ })
const text = () => screen.getByPlaceholderText(/اشرح مشكلتك/)
const send = () => screen.getByRole('button', { name: /إرسال للمطوّر/ }) as HTMLButtonElement
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); delete (window as { shopsysSupport?: unknown }).shopsysSupport; delete (window as { shopsysDesktop?: unknown }).shopsysDesktop; localStorage.clear(); vi.clearAllMocks() })
it('الافتراضي لا يقرأ main.log ولا يرسل سجلاً', async () => {
 const read = vi.fn()
 Object.defineProperty(window, 'shopsysDesktop', { configurable: true, value: { runtime: 'electron' } })
 Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: { readMainLog: read } })
 render(<SupportPage />); fireEvent.change(text(), { target: { value: 'مشكلة اختبار' } }); fireEvent.click(send())
 await waitFor(() => expect(mocks.sendSupportMessage).toHaveBeenCalled())
 expect(read).not.toHaveBeenCalled(); expect(mocks.sendSupportMessage.mock.calls[0][3]).not.toHaveProperty('log')
})
it('الموافقة تعرض مقتطف main والواجهة ثم ترسل نفس المعاينة المحجوبة', async () => {
 const read = vi.fn(async () => ({ ok: true, text: '[2026-11-05T10:00:00Z] [fatal] ERR_MAIN\n[2026-11-05T10:00:01Z] [updater] Set-Cookie: hidden', truncated: false }))
 Object.defineProperty(window, 'shopsysDesktop', { configurable: true, value: { runtime: 'electron' } })
 Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: { readMainLog: read } })
 logEvent('error', 'ERR_RENDERER')
 render(<SupportPage />); fireEvent.change(text(), { target: { value: 'مشكلة اختبار' } }); fireEvent.click(attach())
 const preview = await screen.findByLabelText('معاينة السجل المرفق')
 expect(preview.textContent).toContain('ERR_MAIN'); expect(preview.textContent).toContain('ERR_RENDERER'); expect(preview.textContent).not.toContain('hidden')
 fireEvent.click(send()); await waitFor(() => expect(mocks.sendSupportMessage).toHaveBeenCalled())
 const payload = mocks.sendSupportMessage.mock.calls[0][3] as { log: string }
 expect(payload.log).toBe(preview.textContent); expect(read).toHaveBeenCalledTimes(1)
})
it('فشل قراءة main.log يمنع إرسال مرفق ناقص ويتيح إلغاءه', async () => {
 Object.defineProperty(window, 'shopsysDesktop', { configurable: true, value: { runtime: 'electron' } })
 Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: { readMainLog: async () => ({ ok: false, reason: 'unavailable' }) } })
 render(<SupportPage />); fireEvent.change(text(), { target: { value: 'مشكلة اختبار' } }); fireEvent.click(attach())
 expect((await screen.findByRole('alert')).textContent).toContain('تعذرت قراءة main.log')
 expect(send().disabled).toBe(true); fireEvent.click(attach()); expect(send().disabled).toBe(false)
 fireEvent.click(send()); await waitFor(() => expect(mocks.sendSupportMessage).toHaveBeenCalled())
 expect(mocks.sendSupportMessage.mock.calls[0][3]).not.toHaveProperty('log')
})

it('النسخة القديمة تعرض عدم توفر الجسر بدلاً من الادعاء بإرفاق الملف', async () => {
 Object.defineProperty(window, 'shopsysDesktop', { configurable: true, value: { runtime: 'electron' } })
 Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: {} })
 render(<SupportPage />); fireEvent.change(text(), { target: { value: 'مشكلة اختبار' } }); fireEvent.click(attach())
 expect((await screen.findByRole('alert')).textContent).toContain('لا تدعم إرفاق main.log'); expect(send().disabled).toBe(true)
})
it('الويب يخبر المستخدم أن main.log غير متاح، والإلغاء يبطل القراءة الجارية', async () => {
 render(<SupportPage />); fireEvent.click(attach()); expect((await screen.findByLabelText('معاينة السجل المرفق')).textContent).toContain('غير متاح في نسخة الويب')
 cleanup()
 let finish!: (v: { ok: true; text: string; truncated: boolean }) => void
 const readMainLog = () => new Promise<{ ok: true; text: string; truncated: boolean }>(resolve => { finish = resolve })
 Object.defineProperty(window, 'shopsysDesktop', { configurable: true, value: { runtime: 'electron' } })
 Object.defineProperty(window, 'shopsysSupport', { configurable: true, value: { readMainLog } })
 render(<SupportPage />); fireEvent.click(attach()); fireEvent.click(attach()); finish({ ok: true, text: '[2026-11-05T10:00:00Z] [error] ERR_LATE', truncated: false })
 await waitFor(() => expect(screen.queryByLabelText('معاينة السجل المرفق')).toBeNull())
})
