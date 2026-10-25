import { describe, expect, it, vi } from 'vitest'
import { createLicenseAuthority, type MainLicenseStatus } from '../desktop/licenseAuthority.ts'
import { keyFingerprint, type LicensePayload } from '../src/core/license.ts'

const payload: LicensePayload = {
  v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'اختبار', plan: 'pro',
  features: ['multi_branch'], issuedAt: '2026-01-01', expiresAt: null,
}

function snapshot(state: Record<string, unknown> | null, revision = 1) {
  return { revision, payloadJson: state === null ? null : JSON.stringify({ state, version: 0 }) }
}

describe('Main-process license authority', () => {
  it('verifies a persisted key once and serves the same result to every window despite unrelated settings revisions', async () => {
    let current = snapshot({ activatedKey: 'SHOPSYS1.signed.key', revokedKeys: [], theme: 'light' })
    const verify = vi.fn(async () => payload)
    const authority = createLicenseAuthority({
      readSnapshot: () => current,
      readDeviceId: () => payload.deviceId,
      verify,
      now: () => '2026-10-25T00:00:00.000Z',
    })

    const first = await authority.audit()
    current = snapshot({ activatedKey: 'SHOPSYS1.signed.key', revokedKeys: [], theme: 'dark' }, 2)
    const secondWindow = await authority.audit()
    const thirdWindow = await authority.audit()

    expect(first.status.status).toBe('verified')
    expect(secondWindow.status.payload).toEqual(payload)
    expect(thirdWindow.changed).toBe(false)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('revalidates when the signed key or local revocation list changes', async () => {
    let current = snapshot({ activatedKey: 'key-one', revokedKeys: [] })
    const verify = vi.fn(async (key: string) => {
      if (key === 'key-one') return payload
      throw new Error('signature-invalid')
    })
    const authority = createLicenseAuthority({ readSnapshot: () => current, readDeviceId: () => payload.deviceId, verify })

    expect((await authority.audit()).status.status).toBe('verified')
    current = snapshot({ activatedKey: 'key-two', revokedKeys: [] }, 2)
    expect((await authority.audit()).status.status).toBe('tampered')
    current = snapshot({ activatedKey: 'key-one', revokedKeys: [keyFingerprint('key-one')] }, 3)
    expect((await authority.audit()).status.status).toBe('tampered')
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('fails closed on unreadable snapshots and never treats them as an empty license', async () => {
    let current = { revision: 4, payloadJson: '{broken json' }
    const authority = createLicenseAuthority({ readSnapshot: () => current, readDeviceId: () => payload.deviceId })

    const result: MainLicenseStatus = (await authority.audit()).status
    expect(result.status).toBe('unverifiable')
    expect(result.payload).toBeNull()
    expect((await authority.audit()).status.status).toBe('unverifiable')
  })

  it('returns no_key only for an actually empty activation key', async () => {
    const authority = createLicenseAuthority({ readSnapshot: () => snapshot({ activatedKey: null }), readDeviceId: () => payload.deviceId })
    expect((await authority.audit()).status.status).toBe('no_key')
  })

  it('treats a crypto-provider outage as unverifiable and retries instead of deleting or trusting the key', async () => {
    let attempts = 0
    const verify = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw new DOMException('provider unavailable', 'NotSupportedError')
      return payload
    })
    const authority = createLicenseAuthority({
      readSnapshot: () => snapshot({ activatedKey: 'same-key', revokedKeys: [] }),
      readDeviceId: () => payload.deviceId,
      verify,
    })

    expect((await authority.audit()).status.status).toBe('unverifiable')
    expect((await authority.audit()).status.status).toBe('verified')
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('coalesces simultaneous verification requests across windows', async () => {
    let resolveVerify!: (value: LicensePayload) => void
    const verify = vi.fn(() => new Promise<LicensePayload>((resolve) => { resolveVerify = resolve }))
    const authority = createLicenseAuthority({
      readSnapshot: () => snapshot({ activatedKey: 'same-key', revokedKeys: [] }),
      readDeviceId: () => payload.deviceId,
      verify,
    })

    const a = authority.audit()
    const b = authority.audit()
    expect(verify).toHaveBeenCalledTimes(1)
    resolveVerify(payload)
    const [first, second] = await Promise.all([a, b])
    expect(first.status).toEqual(second.status)
  })
})
