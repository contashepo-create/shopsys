/**
 * بلاغ المالك: بعد إغلاق البرنامج تبقى العملية حية في الخلفية ولا تفتح النافذة.
 * الإغلاق يجب أن ينتهي بـ exit في كل الحالات: نسخة متعثرة، أو قاعدة لا تُغلق، أو نسخة فاشلة.
 */
import { describe, it, expect, vi } from 'vitest'
import { gracefulShutdown } from '../desktop/shutdown.ts'

function harness(overrides: Partial<Parameters<typeof gracefulShutdown>[0]> = {}) {
  const log = vi.fn()
  const exit = vi.fn()
  const closeDb = vi.fn()
  const backup = vi.fn(() => Promise.resolve())
  const deps = { backup, closeDb, exit, log, timeoutMs: 50, ...overrides }
  return { deps, log, exit, closeDb, backup }
}

describe('gracefulShutdown — الإغلاق ينتهي دائماً', () => {
  it('الحالة السعيدة: نسخة ← إغلاق القاعدة ← خروج واحد بالرمز 0', async () => {
    const h = harness()
    await gracefulShutdown(h.deps)
    expect(h.backup).toHaveBeenCalledTimes(1)
    expect(h.closeDb).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledWith(0)
  })

  it('نسخة تتعلّق: تنتهي المهلة ويُغلق البرنامج دون انتظارها', async () => {
    const h = harness({ backup: () => new Promise<void>(() => { /* لا تنتهي أبداً */ }), timeoutMs: 20 })
    await gracefulShutdown(h.deps)
    expect(h.closeDb).toHaveBeenCalledTimes(1)
    expect(h.exit).toHaveBeenCalledWith(0)
    expect(h.log.mock.calls.some((c) => String(c[1]).includes('مهلة'))).toBe(true)
  })

  it('نسخة ترفض: تُسجَّل ويُكمل الإغلاق', async () => {
    const h = harness({ backup: () => Promise.reject(new Error('قرص ممتلئ')) })
    await gracefulShutdown(h.deps)
    expect(h.exit).toHaveBeenCalledWith(0)
    expect(h.log.mock.calls.some((c) => String(c[1]).includes('قرص ممتلئ'))).toBe(true)
  })

  it('إغلاق القاعدة يرمي خطأ: تُسجَّل ويُنهى البرنامج مع ذلك', async () => {
    const h = harness({ closeDb: () => { throw new Error('busy') } })
    await gracefulShutdown(h.deps)
    expect(h.exit).toHaveBeenCalledTimes(1)
    expect(h.log.mock.calls.some((c) => String(c[1]).includes('busy'))).toBe(true)
  })

  it('النسخة تُرمى بشكل متزامن: الخروج يبقى مضموناً', async () => {
    const h = harness({ backup: () => { throw new Error('sync boom') } })
    await gracefulShutdown(h.deps)
    expect(h.exit).toHaveBeenCalledWith(0)
  })
})
