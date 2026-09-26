import { afterEach, describe, expect, it, vi } from 'vitest'
import { rotateStoreAccessToken, type SyncConfig } from '../src/data/syncClient.ts'

const config: SyncConfig = {
  url: 'https://demo.supabase.co', anonKey: 'k'.repeat(40), storeId: 'store-a',
  secret: 'S'.repeat(43), accessToken: 'A'.repeat(43),
}

describe('تدوير اعتماد عزل المتجر', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('يرسل القديم للتوثيق والجديد في ترويسة مستقلة', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify('2026-09-23T12:00:00Z'), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const next = 'B'.repeat(43)
    expect(await rotateStoreAccessToken(config, next)).toContain('2026-09-23')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rpc/rotate_store_access_token')
    expect((init.headers as Record<string, string>)['X-Store-Access-Token']).toBe(config.accessToken)
    expect((init.headers as Record<string, string>)['X-New-Store-Access-Token']).toBe(next)
    expect(JSON.parse(init.body as string).p_store_id).toBe(config.storeId)
  })

  it('يرفض اعتماداً مطابقاً قبل الشبكة', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(rotateStoreAccessToken(config, config.accessToken)).rejects.toThrow('مطابق')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
