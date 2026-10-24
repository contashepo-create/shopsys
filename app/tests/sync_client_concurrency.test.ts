import { describe, expect, it, vi } from 'vitest'
import { decryptFromSync, encryptForSync, syncOnce, type SyncConfig } from '../src/data/syncClient.ts'
import { syncChecksum } from '../src/core/sync.ts'

type TestRow = {
  store_id: string
  rev: number
  device_id: string
  updated_at: string
  checksum: string
  data: string
  access_token_hash: string
}

const config: SyncConfig = {
  url: 'https://demo.supabase.co',
  anonKey: 'a'.repeat(40),
  storeId: 'concurrent-test',
  secret: 's'.repeat(43),
  accessToken: 't'.repeat(43),
}

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

describe('المزامنة المتزامنة بجهازين', () => {
  it('يقبل دفعاً واحداً فقط عند سباق جهازين ويعيد للجهاز الخاسر أحدث لقطة', async () => {
    const initialData = await encryptForSync(JSON.stringify({ state: 'baseline' }), config.secret)
    let remote: TestRow = {
      store_id: config.storeId,
      rev: 1,
      device_id: 'seed-device',
      updated_at: '2026-10-24T09:00:00.000Z',
      checksum: syncChecksum(initialData),
      data: initialData,
      access_token_hash: 'claimed-token-hash',
    }

    let firstReadCount = 0
    let releaseInitialReads!: () => void
    const bothDevicesReadRevOne = new Promise<void>((resolve) => { releaseInitialReads = resolve })
    const concurrentFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'GET') {
        const snapshot = { ...remote }
        if (firstReadCount < 2) {
          firstReadCount++
          if (firstReadCount === 2) releaseInitialReads()
          await bothDevicesReadRevOne
        }
        return jsonResponse([snapshot])
      }

      if (method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Omit<TestRow, 'store_id' | 'access_token_hash'>
        const requestedRev = Number(url.match(/&rev=eq\.(\d+)/)?.[1])
        if (remote.rev !== requestedRev) return jsonResponse([])
        remote = { ...remote, ...body }
        return jsonResponse([remote])
      }

      throw new Error(`Unexpected fake cloud request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', concurrentFetch)

    const [a, b] = await Promise.all([
      syncOnce({ config, deviceId: 'device-A', lastKnownRev: 1, localData: JSON.stringify({ state: 'from-A' }), localDirty: true }),
      syncOnce({ config, deviceId: 'device-B', lastKnownRev: 1, localData: JSON.stringify({ state: 'from-B' }), localDirty: true }),
    ])

    vi.unstubAllGlobals()
    expect(firstReadCount).toBe(2)
    expect([a.action, b.action].sort()).toEqual(['pulled', 'pushed'])
    expect(remote.rev).toBe(2)
    const pulled = a.action === 'pulled' ? a : b
    const pushed = a.action === 'pushed' ? a : b
    expect(pulled.newRev).toBe(2)
    expect(pushed.newRev).toBe(2)
    const committed = JSON.parse(await decryptFromSync(remote.data, config.secret))
    expect(JSON.parse(pulled.pulledData ?? '{}')).toEqual(committed)
    expect(['from-A', 'from-B']).toContain(committed.state)
  })
})
