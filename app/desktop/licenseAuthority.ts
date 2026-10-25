import { isRevoked, verifyLicenseKey, type LicensePayload } from '../src/core/license.ts'

export type MainLicenseStatus = {
  status: 'no_key' | 'verified' | 'tampered' | 'unverifiable'
  payload: LicensePayload | null
  reason?: string
  at: string
}

type PersistedSnapshot = { revision: number; payloadJson: string | null }
type Verify = (key: string, deviceId: string) => Promise<LicensePayload>

function persistedState(payloadJson: string | null): Record<string, unknown> | null {
  if (!payloadJson) return null
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const root = parsed as Record<string, unknown>
    if (Object.hasOwn(root, 'state')) {
      if (!root.state || typeof root.state !== 'object' || Array.isArray(root.state)) return null
      return root.state as Record<string, unknown>
    }
    return root
  } catch {
    return null
  }
}

function equalStatus(a: MainLicenseStatus | null, b: MainLicenseStatus): boolean {
  return !!a && a.status === b.status && a.reason === b.reason
    && JSON.stringify(a.payload) === JSON.stringify(b.payload)
}

/**
 * Main-process authority for signed license material. The renderer never supplies
 * a key or device ID: both are read from the canonical SQLite snapshot and the
 * OS-owned device identity. Identical inputs share one verification result across
 * all BrowserWindows; unrelated settings writes do not trigger another signature
 * check.
 */
export function createLicenseAuthority(args: {
  readSnapshot: () => PersistedSnapshot
  readDeviceId: () => string
  verify?: Verify
  now?: () => string
}) {
  const verify = args.verify ?? verifyLicenseKey
  const now = args.now ?? (() => new Date().toISOString())
  let cacheKey: string | null = null
  let lastInputKey: string | null = null
  let cached: MainLicenseStatus | null = null
  let pendingKey: string | null = null
  let pending: Promise<{ status: MainLicenseStatus; changed: boolean }> | null = null
  let generation = 0

  const unreadable = (reason: string): { status: MainLicenseStatus; changed: boolean } => {
    /* Any verification already in flight was started from inputs we can no
       longer establish; invalidate it and never let it publish a stale result. */
    generation += 1
    cacheKey = null
    lastInputKey = null
    pendingKey = null
    pending = null
    const status: MainLicenseStatus = { status: 'unverifiable', payload: null, reason, at: now() }
    const changed = !equalStatus(cached, status)
    cached = status // remember the diagnostic, but not as a reusable license result
    return { status, changed }
  }

  const audit = async (): Promise<{ status: MainLicenseStatus; changed: boolean }> => {
    let snapshot: PersistedSnapshot
    let deviceId: string
    try {
      snapshot = args.readSnapshot()
      deviceId = args.readDeviceId()
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !deviceId) throw new Error('تعذّر قراءة هوية الجهاز أو لقطة الإعدادات')
    } catch (error) {
      return unreadable(error instanceof Error ? error.message : 'تعذّر قراءة بيانات الترخيص من العملية الرئيسية')
    }

    const state = persistedState(snapshot.payloadJson)
    if (!state && snapshot.payloadJson !== null) {
      return unreadable('لقطة إعدادات الترخيص غير قابلة للقراءة')
    }
    const rawKey = state?.activatedKey
    if (rawKey !== undefined && rawKey !== null && typeof rawKey !== 'string') {
      return unreadable('حقل مفتاح التفعيل في لقطة الإعدادات تالف')
    }
    const rawRevoked = state?.revokedKeys
    if (rawRevoked !== undefined && rawRevoked !== null
      && (!Array.isArray(rawRevoked) || rawRevoked.some((value) => typeof value !== 'string'))) {
      return unreadable('قائمة إبطال التراخيص في لقطة الإعدادات تالفة')
    }
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    const revoked = Array.isArray(rawRevoked) ? rawRevoked as string[] : []
    const fingerprint = `${deviceId}\u0000${key}\u0000${JSON.stringify([...revoked].sort())}`
    if (cacheKey === fingerprint && cached) return { status: cached, changed: false }
    if (pendingKey === fingerprint && pending) return pending

    pendingKey = fingerprint
    const requestGeneration = ++generation
    pending = (async () => {
      let status: MainLicenseStatus
      if (!key) {
        status = { status: 'no_key', payload: null, at: now() }
      } else if (isRevoked(key, revoked)) {
        status = { status: 'tampered', payload: null, reason: 'مفتاح التفعيل المخزّن مُبطَل محلياً', at: now() }
      } else if (typeof globalThis.crypto?.subtle?.verify !== 'function') {
        status = { status: 'unverifiable', payload: null, reason: 'بيئة العملية الرئيسية لا تتيح WebCrypto للتحقق', at: now() }
      } else {
        try {
          const payload = await verify(key, deviceId)
          status = { status: 'verified', payload, at: now() }
        } catch (error) {
          const errorRecord = error && typeof error === 'object' ? error as { name?: unknown; message?: unknown } : null
          const name = typeof errorRecord?.name === 'string' ? errorRecord.name : ''
          const unavailable = name === 'NotSupportedError' || name === 'InvalidStateError'
          const message = typeof errorRecord?.message === 'string' ? errorRecord.message : 'مفتاح التفعيل المخزّن غير صالح'
          status = unavailable
            ? { status: 'unverifiable', payload: null, reason: 'خوارزمية التحقق غير متاحة في بيئة التشغيل', at: now() }
            : { status: 'tampered', payload: null, reason: message, at: now() }
        }
      }
      const latest = generation === requestGeneration
      if (!latest) return audit() // inputs changed while awaiting crypto; never return the old decision
      const changed = lastInputKey !== fingerprint || !equalStatus(cached, status)
      lastInputKey = fingerprint
      /* الحالات القابلة للتحقق تُخزَّن بحسب المدخلات؛ أما تعذّر التحقق فلا يُخزَّن
         كمصدر نهائي، كي تُعاد المحاولة عند الطلب التالي من دون اعتماد قديم. */
      cacheKey = status.status === 'unverifiable' ? null : fingerprint
      cached = status
      return { status, changed }
    })()
    try {
      return await pending
    } finally {
      if (pendingKey === fingerprint) { pendingKey = null; pending = null }
    }
  }

  return { audit }
}
