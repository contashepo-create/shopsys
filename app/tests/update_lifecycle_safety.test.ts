// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { observeUpdateCheck, updateCheckRetryDelay, UPDATE_CHECK_INTERVAL_MS } from '../desktop/updateLifecycle.ts'

describe('التحديث الخلفي لا يترك رفضاً غير معالج ويعيد المحاولة بهدوء', () => {
  it('يستخدم تأخيراً تصاعدياً محدوداً ويعاود الفحص دورياً بعد النجاح', () => {
    expect([0, 1, 2, 3, 4, 100].map(updateCheckRetryDelay)).toEqual([30_000, 120_000, 600_000, 1_800_000, 1_800_000, 1_800_000])
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(60 * 60 * 1000)
  })

  it('يلتقط رفض checkForUpdates غير المتزامن مثل غياب app-update.yml', async () => {
    const errors: unknown[] = []
    observeUpdateCheck(() => Promise.reject(new Error('ENOENT: app-update.yml')), error => errors.push(error))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toContain('app-update.yml')
  })

  it('ينفذ مسار النجاح كي يجدول الفحص الدوري', async () => {
    const success = vi.fn()
    observeUpdateCheck(() => Promise.resolve(undefined), () => undefined, success)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(success).toHaveBeenCalledOnce()
  })

  it('يلتقط الخطأ المتزامن أيضاً', () => {
    const errors: unknown[] = []
    observeUpdateCheck(() => { throw new Error('provider unavailable') }, error => errors.push(error))
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('provider unavailable')
  })
})
