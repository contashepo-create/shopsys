/**
 * ث1 (تدقيق 2026-10-08) — نزاهة الترخيص عند الإقلاع:
 * كان التطبيق يقيّم الحالة من `activatedPayload` **المحفوظ في التخزين** ولا يعيد
 * التحقق من التوقيع إلا عند إدخال مفتاح يدوياً، والتخزين في نسخة الويب نص صريح
 * (localStorage) ⇒ كتابة `{plan:'lifetime',expiresAt:null}` تفتح كل الميزات المدفوعة
 * بلا أي مفتاح. القاعدة الجديدة: **المفتاح الموقّع هو المصدر الوحيد للحمولة.**
 *
 * يثبت هذا الاختبار:
 *   ① حمولة محفوظة بلا مفتاح ⇒ تُسقط (لا تفعيل).
 *   ② حمولة مزوّرة + مفتاح صالح ⇒ تُستبدل بحمولة التوقيع (basic لا lifetime).
 *   ③ مفتاح معدّل / لجهاز آخر ⇒ `tampered` ويُحذف المفتاح نفسه.
 *   ④ `setup.modules` تُقَص على الممنوح: ما لا سند له يُحذف، وما أطفأه المستخدم
 *      بنفسه لا يعود، ونشاط غير معروف ⇒ لا قصّ (لا تخمين على حساب العميل).
 *   ⑤ `partialize` لا يكتب الحمولة ولا حالة الفحص في التخزين أصلاً.
 *
 * زوج Ed25519 مؤقت كما في activity_change_key.test.ts — المفتاح العام المضمّن
 * يُستبدل بعام هذا الزوج كي يعمل مسار «مفتاح صالح» بلا أسرار النشر.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

/** جسر بين مصنع الـmock (يُولَّد قبل كل شيء) وجسم الاختبار */
const harness = vi.hoisted(() => ({
  pub: '',
  sign: null as null | ((payload: Record<string, unknown>) => Promise<string>),
}))

vi.mock('../src/core/license.ts', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../src/core/license.ts')
  const { subtle } = crypto
  const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const b64u = (b: Uint8Array) => {
    let s = ''
    for (const x of b) s += String.fromCharCode(x)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  harness.pub = b64u(new Uint8Array((await subtle.exportKey('spki', pair.publicKey)).slice(-32)))
  harness.sign = async (payload) => {
    const canonical = actual.canonicalPayload(payload as never)
    const sig = new Uint8Array(await subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(canonical) as unknown as ArrayBuffer))
    return actual.encodeLicenseKey(payload as never, sig)
  }
  // كل تحقق في هذا الملف يمر بمفتاحنا العام المؤقت
  return { ...actual, verifyLicenseKey: (key: string, deviceId: string) => actual.verifyLicenseKey(key, deviceId, harness.pub) }
})

const { useAppStore } = await import('../src/stores/app.store.ts')
const { auditStoredLicense, evaluateLicense } = await import('../src/core/license.ts')
const { lockReasonFor } = await import('../src/core/security.ts')
const { clampModulesToLicense, effectiveModules, ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')
type LicensePayload = import('../src/core/license.ts').LicensePayload
type BusinessModule = import('../src/core/activities.ts').BusinessModule

const A = () => useAppStore.getState()
const payloadFor = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1, deviceId: A().deviceId, customer: 'بقالة النور', plan: 'basic',
  features: [], issuedAt: '2026-10-01', expiresAt: '2027-10-01', ...over,
})
/** حمولة مزوّرة كما يكتبها مهاجم في التخزين: مدى الحياة بكل الميزات المدفوعة */
const forgedLifetime = (deviceId: string): LicensePayload => ({
  v: 1, deviceId, customer: 'مزوّر', plan: 'lifetime',
  features: ['einvoice_eg', 'einvoice_sa', 'multi_branch', 'telegram_bot', 'cloud_sync', 'multi_user_lan'],
  issuedAt: '2026-01-01', expiresAt: null, extraModules: ['clinic', 'cars', 'realestate'],
})

/** إعداد منشأة بنشاط البقالة — يعيد الحالة لنقطة بداية معروفة */
const seedSetup = () => {
  useAppStore.setState({
    activatedKey: null,
    activatedPayload: null,
    licenseAudit: { status: 'no_key' },
    revokedKeys: [],
  })
  A().completeSetup({
    country: { code: 'EG', nameAr: 'مصر', vatPercent: 14, currency: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' } } as never,
    activity: ACTIVITY_TEMPLATES.find((t) => t.id === 'grocery')! as never,
    shopName: 'بقالة النور', ownerName: 'المالك',
    fiscalYear: { nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' } as never,
  })
}

beforeEach(() => { seedSetup() })

describe('① auditStoredLicense — القرار الخالص (بلا crypto)', () => {
  it('بلا مفتاح ⇒ no_key حتى لو وُجدت حمولة محفوظة', () => {
    const out = auditStoredLicense({ activatedKey: null, storedPayload: forgedLifetime('X'), verifiedPayload: null })
    expect(out.kind).toBe('no_key')
    expect(out).toMatchObject({ hadStoredPayload: true })
  })

  it('مفتاح تحقّق ⇒ الحمولة المعتمدة هي حمولة التوقيع مع رصد اختلاف المحفوظة', () => {
    const signed = payloadFor()
    const out = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: forgedLifetime('X'), verifiedPayload: signed })
    expect(out.kind).toBe('verified')
    if (out.kind === 'verified') {
      expect(out.payload.plan).toBe('basic')
      expect(out.storedPayloadDiffered).toBe(true)
    }
    const same = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: signed, verifiedPayload: signed })
    expect(same.kind === 'verified' && same.storedPayloadDiffered).toBe(false)
  })

  it('مفتاح لم يتحقّق ⇒ tampered مع سبب عربي، ولا تُعتمد الحمولة المحفوظة', () => {
    const out = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: payloadFor(), verifiedPayload: null, verifyError: 'التوقيع غير صحيح' })
    expect(out).toMatchObject({ kind: 'tampered', reason: 'التوقيع غير صحيح' })
    const noMsg = auditStoredLicense({ activatedKey: 'SHOPSYS1.a.b', storedPayload: null, verifiedPayload: null })
    expect(noMsg.kind === 'tampered' && noMsg.reason.length > 3).toBe(true)
  })
})

describe('② clampModulesToLicense — حذف ما لا سند له بلا إعادة ما أُطفئ', () => {
  it('يسقط الأقسام غير الممنوحة ويُبقي الممنوحة بمفتاح', () => {
    const stored = [...effectiveModules('grocery', undefined), 'clinic', 'cars'] as BusinessModule[]
    const out = clampModulesToLicense({ stored, activityId: 'grocery', licensedExtra: ['clinic'] })
    expect(out).toContain('clinic')   // ممنوح بمفتاح ⇒ يبقى
    expect(out).not.toContain('cars') // لا سند له ⇒ يسقط
  })

  it('لا يعيد قسماً أطفأه المستخدم بنفسه (حقه في الإخفاء)', () => {
    const allowed = effectiveModules('grocery', undefined)
    const stored = allowed.filter((m) => m !== 'installments')
    const out = clampModulesToLicense({ stored, activityId: 'grocery', licensedExtra: undefined })
    expect(out).toEqual(stored)
    expect(out).not.toContain('installments')
  })

  it('نشاط غير معروف ⇒ لا قصّ (لا نخمّن على حساب أقسام العميل)', () => {
    const stored = ['clinic', 'lab'] as BusinessModule[]
    expect(clampModulesToLicense({ stored, activityId: 'نشاط_غير_موجود', licensedExtra: undefined })).toEqual(stored)
  })
})

describe('③ المتجر: إعادة التحقق في كل إقلاع', () => {
  it('حمولة lifetime مزوّرة بلا مفتاح ⇒ تُسقط وتُقص الأقسام', async () => {
    const forged = forgedLifetime(A().deviceId)
    useAppStore.setState({ activatedKey: null, activatedPayload: forged, setup: { ...A().setup, modules: effectiveModules('grocery', forged.extraModules) } })
    expect(A().activatedPayload?.plan).toBe('lifetime') // قبل الفحص: التزوير «نافذ»

    await A().reverifyActivation()

    expect(A().activatedPayload).toBeNull()
    expect(A().licenseAudit.status).toBe('no_key')
    expect(A().setup.modules).not.toContain('clinic')
    expect(A().setup.modules).not.toContain('realestate')
  })

  it('مفتاح صالح + حمولة مزوّرة ⇒ الحمولة تُشتق من التوقيع لا من التخزين', async () => {
    const key = await harness.sign!(payloadFor({ plan: 'basic', expiresAt: '2027-10-01' }))
    useAppStore.setState({ activatedKey: key, activatedPayload: forgedLifetime(A().deviceId) })

    await A().reverifyActivation()

    expect(A().licenseAudit.status).toBe('verified')
    expect(A().activatedPayload?.plan).toBe('basic')          // لا lifetime
    expect(A().activatedPayload?.expiresAt).toBe('2027-10-01') // لا null
    expect(A().activatedPayload?.features).toEqual([])         // لا كل الميزات المدفوعة
    expect(A().setup.modules).not.toContain('clinic')          // extraModules المزوّرة لا تمنح شيئاً
  })

  it('مفتاح معدّل بايت واحد ⇒ tampered ويُحذف المفتاح نفسه', async () => {
    const key = await harness.sign!(payloadFor())
    const parts = key.split('.')
    const tamperedSig = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'AA' ? 'BB' : 'AA')
    useAppStore.setState({ activatedKey: `${parts[0]}.${parts[1]}.${tamperedSig}`, activatedPayload: payloadFor() })

    await A().reverifyActivation()

    expect(A().licenseAudit.status).toBe('tampered')
    expect(A().licenseAudit.reason).toBeTruthy()
    expect(A().activatedKey).toBeNull()
    expect(A().activatedPayload).toBeNull()
  })

  it('مفتاح صادر لجهاز آخر ⇒ مرفوض (الربط بمعرّف الجهاز يبقى نافذاً)', async () => {
    const key = await harness.sign!(payloadFor({ deviceId: 'SHOP-ZZZZ-ZZZZ-ZZZZ' }))
    useAppStore.setState({ activatedKey: key, activatedPayload: null })

    await A().reverifyActivation()

    expect(A().licenseAudit.status).toBe('tampered')
    expect(A().activatedKey).toBeNull()
  })

  /* ث9: غياب WebCrypto (سياق غير آمن http:// مثلاً) يجعل التحقق مستحيلاً.
     الخطأ أن يُعامل كتلاعب فيُحذف مفتاح عميل مدفوع لسبب لا يد له فيه ولا
     يستعيده إلا بإعادة إصدار من المطوّر — والصحيح حفظ المفتاح والقفل بوضوح. */
  it('بيئة بلا WebCrypto ⇒ المفتاح يُحفظ، لا حمولة تُعتمد، وسبب القفل صادق', async () => {
    const key = await harness.sign!(payloadFor({ plan: 'pro', expiresAt: '2027-10-01' }))
    useAppStore.setState({ activatedKey: key, activatedPayload: null, licenseAudit: { status: 'checking' } })
    const original = globalThis.crypto.subtle
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true })
    try {
      await A().reverifyActivation()
      expect(A().licenseAudit.status).toBe('unverifiable')
      expect(A().activatedKey).toBe(key)       // لا حذف لمفتاح صالح
      expect(A().activatedPayload).toBeNull()  // ولا اعتماد بلا تحقق (لا ثغرة)
      const state = evaluateLicense({
        activatedPayload: A().activatedPayload,
        trialStartedAt: A().trialStartedAt, lastSeenAt: A().lastSeenAt, today: new Date().toISOString(),
      })
      /* السبب المعروض ليس «انتهت التجربة» الكاذب */
      expect(lockReasonFor(state, { unverifiable: A().licenseAudit.status === 'unverifiable' })).toBe('license_unverifiable')
      /* والحرق يبقى أسبق — لا يُتذرع بتعذّر التحقق للتهرب من الإبطال */
      expect(lockReasonFor(state, { revoked: true, unverifiable: true })).toBe('revoked')
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: original, configurable: true })
    }
    /* ومتى توفّرت البيئة رجع المفتاح نفسه إلى العمل بلا تدخل من أحد */
    await A().reverifyActivation()
    expect(A().licenseAudit.status).toBe('verified')
    expect(A().activatedPayload?.plan).toBe('pro')
  })

  it('فحص متكرر بلا تغيّر ⇒ لا تحديث للحالة (يمنع إعادة رسم بلا سبب)', async () => {
    const key = await harness.sign!(payloadFor())
    useAppStore.setState({ activatedKey: key, activatedPayload: null })
    await A().reverifyActivation()
    const snapshot = JSON.stringify({ p: A().activatedPayload, m: A().setup.modules, s: A().licenseAudit.status })

    let renders = 0
    const off = useAppStore.subscribe(() => { renders++ })
    await A().reverifyActivation()
    await A().reverifyActivation()
    off()

    expect(renders).toBe(0)
    expect(JSON.stringify({ p: A().activatedPayload, m: A().setup.modules, s: A().licenseAudit.status })).toBe(snapshot)
  })
})

describe('④ التخزين: الحمولة لا تُكتب ولا تُقرأ', () => {
  it('partialize يستثني activatedPayload وlicenseAudit ويُبقي activatedKey', () => {
    const options = useAppStore.persist.getOptions()
    const key = 'SHOPSYS1.x.y'
    useAppStore.setState({ activatedKey: key, activatedPayload: forgedLifetime(A().deviceId), licenseAudit: { status: 'verified' } })
    const written = options.partialize?.(A()) as Record<string, unknown>

    expect(Object.hasOwn(written, 'activatedPayload')).toBe(false)
    expect(Object.hasOwn(written, 'licenseAudit')).toBe(false)
    expect(written.activatedKey).toBe(key) // المفتاح وحده يُخزَّن — وهو الموقّع
    expect(Object.hasOwn(written, 'setup')).toBe(true) // باقي الإعدادات كما هي
  })

  it('الترطيب يسقط أي حمولة محفوظة ويعلّم الفحص إن وُجد مفتاح', () => {
    const onRehydrate = useAppStore.persist.getOptions().onRehydrateStorage?.(A())
    const state = { ...A(), activatedPayload: forgedLifetime(A().deviceId), activatedKey: 'SHOPSYS1.x.y', licenseAudit: { status: 'verified' as const } }
    onRehydrate?.(state as never, undefined)

    expect((state as { activatedPayload: LicensePayload | null }).activatedPayload).toBeNull()
    expect((state as { licenseAudit: { status: string } }).licenseAudit.status).toBe('checking')

    const noKey = { ...A(), activatedPayload: forgedLifetime(A().deviceId), activatedKey: null, licenseAudit: { status: 'verified' as const } }
    onRehydrate?.(noKey as never, undefined)
    expect((noKey as { activatedPayload: LicensePayload | null }).activatedPayload).toBeNull()
    expect((noKey as { licenseAudit: { status: string } }).licenseAudit.status).toBe('no_key')
  })
})
