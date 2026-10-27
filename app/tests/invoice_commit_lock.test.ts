import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  electron: true,
  acquire: vi.fn<() => Promise<string | null>>(),
  release: vi.fn<(token: string) => void>(),
  refresh: vi.fn<(storeName: string) => Promise<void>>(),
  flush: vi.fn<(storeName?: string) => Promise<void>>(),
  secureFlush: vi.fn<(storeName?: string) => Promise<void>>(),
}))

vi.mock('../src/data/desktopBridge.ts', () => ({
  desktopBridge: () => mocks.electron ? { invoiceCommit: { acquire: mocks.acquire, release: mocks.release } } : null,
}))
vi.mock('../src/data/persistentStorage.ts', () => ({
  refreshDesktopSnapshot: mocks.refresh,
  flushPendingDesktopSnapshots: mocks.flush,
}))
vi.mock('../src/data/secureStorage.ts', () => ({ flushSecureStorageWrites: mocks.secureFlush }))

import { withInvoiceCommitLock } from '../src/data/invoiceCommitLock.ts'

describe('قفل ترحيل الفواتير عبر النوافذ', () => {
  beforeEach(() => {
    mocks.electron = true
    mocks.acquire.mockReset().mockResolvedValue('lock-1')
    mocks.release.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.flush.mockReset().mockResolvedValue(undefined)
    mocks.secureFlush.mockReset().mockResolvedValue(undefined)
  })

  it('يحدّث اللقطة أولاً، وينفذ العملية، وينتظر حفظها قبل تحرير القفل', async () => {
    const order: string[] = []
    mocks.acquire.mockImplementation(async () => { order.push('acquire'); return 'lock-1' })
    mocks.refresh.mockImplementation(async () => { order.push('refresh-snapshot') })
    mocks.flush.mockImplementation(async () => { order.push('flush') })
    mocks.release.mockImplementation(() => { order.push('release') })
    const result = await withInvoiceCommitLock(async () => { order.push('rehydrate'); return undefined }, async () => {
      order.push('commit')
      return 42
    })
    expect(result).toBe(42)
    expect(order).toEqual(['acquire', 'refresh-snapshot', 'rehydrate', 'commit', 'flush', 'release'])
    expect(mocks.refresh).toHaveBeenCalledWith('shopsys-data')
    expect(mocks.flush).toHaveBeenCalledWith('shopsys-data')
    expect(mocks.release).toHaveBeenCalledWith('lock-1')
  })

  it('يحرر القفل عند فشل الترحيل ولا يصمت عن الخطأ', async () => {
    await expect(withInvoiceCommitLock(async () => undefined, () => { throw new Error('رفض الترحيل') }))
      .rejects.toThrow('رفض الترحيل')
    expect(mocks.release).toHaveBeenCalledWith('lock-1')
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('في الويب يستخدم Web Locks ويعيد الترطيب ويحفظ قبل تحرير القفل', async () => {
    mocks.electron = false
    const order: string[] = []
    mocks.secureFlush.mockImplementation(async () => { order.push('flush') })
    const request = vi.fn(async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<unknown>) => {
      order.push('lock-acquired')
      const result = await callback()
      order.push('lock-released')
      return result
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const commit = vi.fn(async () => { order.push('commit'); return 'ok' })
    await expect(withInvoiceCommitLock(async () => { order.push('rehydrate') }, commit)).resolves.toBe('ok')
    expect(order).toEqual(['lock-acquired', 'flush', 'rehydrate', 'commit', 'flush', 'lock-released'])
    expect(commit).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('shopsys:invoice-commit', { mode: 'exclusive' }, expect.any(Function))
    expect(mocks.acquire).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.secureFlush).toHaveBeenNthCalledWith(1, 'shopsys-data')
    expect(mocks.secureFlush).toHaveBeenNthCalledWith(2, 'shopsys-data')
  })

  it('يمنع بدء ترحيل تبويب ثانٍ حتى يكتمل حفظ الأول', async () => {
    mocks.electron = false
    let tail: Promise<void> = Promise.resolve()
    const request = vi.fn(async (_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<unknown>) => {
      const previous = tail
      let unlock!: () => void
      tail = new Promise<void>((resolve) => { unlock = resolve })
      await previous
      try { return await callback() } finally { unlock() }
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })

    let announceFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve })
    let releaseFirst!: () => void
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve })
    const order: string[] = []
    const first = withInvoiceCommitLock(async () => undefined, async () => {
      order.push('first:start')
      announceFirst()
      await holdFirst
      order.push('first:finish')
    })
    await firstStarted
    const second = withInvoiceCommitLock(async () => undefined, () => { order.push('second:commit') })
    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:finish', 'second:commit'])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('يرفض الترحيل في متصفح لا يوفّر قفلاً آمناً بين التبويبات', async () => {
    mocks.electron = false
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const commit = vi.fn(async () => 'unsafe')
    await expect(withInvoiceCommitLock(async () => undefined, commit)).rejects.toThrow(/لا يدعم قفل الترحيل الآمن/)
    expect(commit).not.toHaveBeenCalled()
  })

  /**
   * بلاغ المالك: «الفاتورة تُكتب ولا تُغلق النافذة». فشل تصريف لحظي بعد
   * نجاح commit كان يُرفض به الوعد فتظن الصفحة أن الترحيل فشل وتبقى مفتوحة.
   */
  it('يعيد محاولة التصريف بعد الترحيل الناجح ولا يرفض مستنداً اكتمل بفشل لحظي', async () => {
    mocks.flush
      .mockRejectedValueOnce(new Error('IPC مشغول'))
      .mockRejectedValueOnce(new Error('قاعدة مشغولة'))
      .mockResolvedValueOnce(undefined)
    const result = await withInvoiceCommitLock(async () => undefined, async () => 'posted')
    expect(result).toBe('posted')
    expect(mocks.flush).toHaveBeenCalledTimes(3)
    expect(mocks.release).toHaveBeenCalledWith('lock-1')
  })

  it('يرفض بعد الترحيل فقط إن استعصى التصريف بعد كل المحاولات (بقاء مفتوحاً حفاظاً على البيانات)', async () => {
    mocks.flush.mockRejectedValue(new Error('قرص ممتلئ'))
    await expect(withInvoiceCommitLock(async () => undefined, async () => 'posted')).rejects.toThrow('قرص ممتلئ')
    expect(mocks.flush).toHaveBeenCalledTimes(3)
    expect(mocks.release).toHaveBeenCalledWith('lock-1')
  })

  it('كل واجهات إنشاء أو اعتماد الفواتير تستخدم طبقة القفل نفسها قبل الترحيل', () => {
    const entrypoints = [
      'AdvancedSalesInvoicePage.tsx', 'AdvancedPurchaseInvoicePage.tsx', 'SalesInvoicesPage.tsx',
      'PosPage.tsx', 'PurchasesPage.tsx', 'ContractingInvoicesPage.tsx',
      'RestaurantOrdersPage.tsx', 'ExchangePage.tsx', 'JewelryPage.tsx', 'ApprovalsPage.tsx',
    ]
    const pagesDir = `${process.cwd()}/src/ui/pages`
    const sources = new Map(readdirSync(pagesDir).filter((file) => file.endsWith('.tsx')).map((file) => [file, readFileSync(`${pagesDir}/${file}`, 'utf8')]))
    for (const file of entrypoints) {
      const source = sources.get(file) ?? ''
      expect(source, `${file} must serialize invoice posting`).toContain('withInvoiceCommitLock')
      expect(source, `${file} must rehydrate after acquiring the lock`).toContain('useRawDataStore.persist.rehydrate()')
    }
    const commitPath = /\b(?:postSale|postPurchase|editSale|editPurchase|postExchange|settleRestaurantOrder|postGoldTradeIn|decideDocApproval)\s*\(/g
    for (const [file, source] of sources) {
      if (!commitPath.test(source)) continue
      expect(source, `${file} contains a sales/purchase posting but has no shared lock`).toContain('withInvoiceCommitLock')
      expect(source, `${file} contains a posting but does not refresh after acquiring the lock`).toContain('useRawDataStore.persist.rehydrate()')
      commitPath.lastIndex = 0
    }
  })
})
