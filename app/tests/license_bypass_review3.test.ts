/**
 * مراجعة ③ (2026-10-09) — منع التحايل على مدة الاشتراك وعلى الإبطال.
 * كل حالة هنا كانت ثغرة مؤكدة بالتجربة قبل الإصلاح (انظر القسم «المراجعة الشاملة الثالثة»
 * في docs/تدقيق_الدعم_والتنبيهات_والترخيص_2026-10-08.md).
 */
import { describe, it, expect } from 'vitest'
import {
  encodeLicenseKey, encodeActivityChangeKey, canonicalPayload, canonicalActivityChangePayload,
  verifyLicenseKey, keyFingerprint, isRevoked, evaluateLicense, oldestValidDay, newestValidDay,
  isValidIsoDay, b64uEncode, type LicensePayload, type LicenseState,
} from '../src/core/license.ts'
import { currentLockReason, lockReasonFor, LOCK_REASON_LABELS } from '../src/core/security.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const DEV = 'SHOP-AAAA-BBBB-CCCC'
const TODAY = '2026-10-09T10:00:00.000Z'

async function devKeys() {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const pub = b64uEncode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)))
  return { kp, pub }
}

async function signLicense(kp: CryptoKeyPair, payload: LicensePayload): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonicalPayload(payload))))
  return encodeLicenseKey(payload, sig)
}

const payloadOf = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1, deviceId: DEV, customer: 'عميل', plan: 'pro', features: ['cloud_sync'],
  issuedAt: '2026-10-01', expiresAt: '2027-10-01', ...over,
})

/** djb2 على النص الخام للتوقيع — الصيغة القديمة للبصمة (يجب أن تبقى مطابقة للمفاتيح المعيارية) */
function legacyDjb2(key: string): string {
  const sig = key.trim().split('.')[2] ?? key
  let h = 5381
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** صور مكافئة للتوقيع نفسه: حشو `=`، واستبدال `-`/`_` بـ`+`/`/` (كلها تفك إلى البايتات نفسها) */
function encodingVariants(key: string): string[] {
  const [head, body, sig] = key.split('.')
  return [
    `${head}.${body}.${sig}=`,
    `${head}.${body}.${sig.replace(/-/g, '+').replace(/_/g, '/')}`,
  ]
}

describe('ح1 — تغيير ترميز التوقيع لا يتجاوز الإبطال', () => {
  it('الصور المكافئة للتوقيع لها البصمة نفسها (والمفتاح المعياري لم تتغير بصمته)', async () => {
    const { kp } = await devKeys()
    // نُكرّر حتى يحوي التوقيع `-` أو `_` فيكون استبدال الترميز فعّالاً
    let key = await signLicense(kp, payloadOf())
    for (let n = 0; n < 8 && !/[-_]/.test(key.split('.')[2]); n++) key = await signLicense(kp, payloadOf({ issuedAt: `2026-10-0${(n % 9) + 1}` }))
    const fp = keyFingerprint(key)
    expect(fp).toBe(legacyDjb2(key)) // المفاتيح المعيارية: لا تغيّر في القوائم المحفوظة
    for (const variant of encodingVariants(key)) expect(keyFingerprint(variant)).toBe(fp)
  })

  it('مفتاح محروق بصورته المعيارية يبقى محروقاً بكل صوره التي يقبلها التحقق', async () => {
    const { kp, pub } = await devKeys()
    const key = await signLicense(kp, payloadOf())
    const fp = keyFingerprint(key)
    expect(isRevoked(key, [fp])).toBe(true)
    for (const variant of encodingVariants(key)) {
      let accepted = true
      try { await verifyLicenseKey(variant, DEV, pub) } catch { accepted = false }
      // أي صورة يقبلها التحقق يجب أن تُعرف كمحروقة — هذا هو الاختبار الجوهري
      if (accepted) expect(isRevoked(variant, [fp])).toBe(true)
    }
  })
})

describe('ح2 — فشل مغلق على القيم الزمنية التالفة (لا تجربة ولا اشتراك بلا نهاية)', () => {
  it.each([['فارغة', ''], ['نص عابر', 'junk']])('بداية تجربة %s ⇒ invalid لا trial', (_label, value) => {
    expect(evaluateLicense({ activatedPayload: null, trialStartedAt: value, lastSeenAt: TODAY, today: TODAY }).status).toBe('invalid')
  })

  it('تاريخ انتهاء تالف في مفتاح موقّع ⇒ invalid لا active', () => {
    const st = evaluateLicense({ activatedPayload: payloadOf({ expiresAt: '' }), trialStartedAt: TODAY, lastSeenAt: TODAY, today: TODAY })
    expect(st.status).toBe('invalid')
  })

  it('آخر ظهور تالف ⇒ clock_tampered (دليل إرجاع الساعة لا يُمحى)', () => {
    expect(evaluateLicense({ activatedPayload: null, trialStartedAt: '2026-10-01T00:00:00.000Z', lastSeenAt: '', today: TODAY }).status).toBe('clock_tampered')
  })

  it('القيم السليمة لم تتغير: تجربة في يومها الثالث تُحسب 12 يوماً متبقياً', () => {
    expect(evaluateLicense({ activatedPayload: null, trialStartedAt: '2026-10-07T00:00:00.000Z', lastSeenAt: TODAY, today: TODAY }))
      .toEqual({ status: 'trial', daysLeft: 12 })
  })

  it('مفتاح ساري بتاريخ صالح يبقى active بالأيام الصحيحة، ومدى الحياة يبقى بلا أيام', () => {
    const st = evaluateLicense({ activatedPayload: payloadOf({ expiresAt: '2026-10-19' }), trialStartedAt: TODAY, lastSeenAt: TODAY, today: TODAY })
    expect(st).toMatchObject({ status: 'active', daysLeft: 10 })
    expect(evaluateLicense({ activatedPayload: payloadOf({ expiresAt: null }), trialStartedAt: TODAY, lastSeenAt: TODAY, today: TODAY }))
      .toMatchObject({ status: 'active', daysLeft: null })
  })

  it('invalid يُقفل بسبب صادق license_invalid لا بـ«انتهى اشتراكك»', () => {
    expect(lockReasonFor({ status: 'invalid', reason: 'x' })).toBe('license_invalid')
    expect(LOCK_REASON_LABELS.license_invalid.title).toContain('غير صالحة')
  })
})

describe('ح2 — دوال الأيام الصالحة (مرساة بداية التجربة وآخر ظهور)', () => {
  it('oldestValidDay يتجاهل القيم التالفة ويختار الأقدم الصالح', () => {
    expect(oldestValidDay('', 'junk', '2026-10-05T00:00:00.000Z', '2026-10-01T00:00:00.000Z')).toBe('2026-10-01T00:00:00.000Z')
    expect(oldestValidDay('', 'x', null)).toBeNull()
  })

  it('newestValidDay لا يرجع للخلف أبداً', () => {
    expect(newestValidDay('2026-10-05T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '')).toBe('2026-10-05T00:00:00.000Z')
  })

  it('isValidIsoDay يقبل ISO كاملاً ويرفض ما ليس تاريخاً', () => {
    expect(isValidIsoDay('2026-10-09T10:00:00.000Z')).toBe(true)
    for (const v of ['', 'junk', 12, null, undefined]) expect(isValidIsoDay(v)).toBe(false)
  })
})

describe('ح6 — القرار الموحّد للقفل يشمل الإبطال وعدم تطابق النشاط', () => {
  it('مفتاح محروق يُقفل حتى لو كانت الحالة سارية، ويُفكّ حين لا يكون في القائمة', async () => {
    const { kp } = await devKeys()
    const payload = payloadOf()
    const key = await signLicense(kp, payload)
    const state: LicenseState = { status: 'active', payload, daysLeft: 100 }
    const store = {
      activatedKey: key, activatedPayload: payload, revokedKeys: [keyFingerprint(key)],
      licenseAudit: { status: 'verified' }, setup: { completed: true, activityId: null, activityKeyHistory: [] },
    }
    expect(currentLockReason(state, store)).toBe('revoked')
    expect(currentLockReason(state, { ...store, revokedKeys: [] })).toBeNull()
  })

  it('عدم تطابق النشاط يُقفل بـ activity_mismatch حتى مع حالة سارية', async () => {
    const { kp } = await devKeys()
    const payload = payloadOf({ activityId: 'grocery' })
    const key = await signLicense(kp, payload)
    const state: LicenseState = { status: 'active', payload, daysLeft: 100 }
    const store = {
      activatedKey: key, activatedPayload: payload, revokedKeys: [],
      licenseAudit: { status: 'verified' }, setup: { completed: true, activityId: 'mobile', activityKeyHistory: [] },
    }
    expect(currentLockReason(state, store)).toBe('activity_mismatch')
  })
})

describe('ح3 — مرساة آخر ظهور التالفة لا تُمحى بالوقت الحالي', () => {
  it('touchLastSeen لا يستبدل قيمة تالفة (كانت تمحو دليل إرجاع الساعة)', () => {
    const prev = useAppStore.getState().lastSeenAt
    useAppStore.setState({ lastSeenAt: '' })
    useAppStore.getState().touchLastSeen()
    expect(useAppStore.getState().lastSeenAt).toBe('')
    useAppStore.setState({ lastSeenAt: prev })
  })

  it('touchLastSeen يتقدم بالقيمة الصالحة كما كان', () => {
    const prev = useAppStore.getState().lastSeenAt
    useAppStore.setState({ lastSeenAt: '2000-01-01T00:00:00.000Z' })
    useAppStore.getState().touchLastSeen()
    expect(useAppStore.getState().lastSeenAt > '2000-01-01T00:00:00.000Z').toBe(true)
    useAppStore.setState({ lastSeenAt: prev })
  })
})

describe('ح8 — مفتاح تحويل النشاط يُطبَّق مرة واحدة', () => {
  it('المفتاح نفسه يُرفض بعد تطبيقه، حتى لو عاد الجهاز إلى النشاط الأصلي', async () => {
    const { kp, pub } = await devKeys()
    const deviceId = useAppStore.getState().deviceId
    const payload = { v: 1 as const, deviceId, fromActivityId: 'grocery', toActivityId: 'mobile', issuedAt: '2026-10-09' }
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(canonicalActivityChangePayload(payload))))
    const key = encodeActivityChangeKey(payload, sig)
    useAppStore.setState((s) => ({ setup: { ...s.setup, completed: true, activityId: 'grocery', lastActivityChangeAt: null, activityKeyHistory: ['grocery'], activityKeyFingerprints: [] } }))

    await expect(useAppStore.getState().applyActivityChangeKey(key, pub)).resolves.toBeTruthy()
    // عودة الجهاز إلى النشاط الأصلي (كما لو وصل مفتاح B→A) — المفتاح الأول لا يُعاد تطبيقه
    useAppStore.setState((s) => ({ setup: { ...s.setup, activityId: 'grocery', lastActivityChangeAt: null } }))
    await expect(useAppStore.getState().applyActivityChangeKey(key, pub)).rejects.toThrow(/استُخدم من قبل/)
  })
})
