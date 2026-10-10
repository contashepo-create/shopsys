/**
 * v1.0.22 — التفعيل والتسجيل عبر الإنترنت:
 *   • التفعيل: الفحوص المحلية أولاً، ثم تأكيد الخادم، وبلا اتصال لا تفعيل.
 *   • التسجيل: إلزامي بقبول الاتفاقية (لا خانة موافقة)، ويحمل بيانات المعالج كاملة،
 *     ولا يحمل كلمة مرور المالك أبداً.
 */
import { describe, it, expect } from 'vitest'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { acceptActivationKey, b64uEncode, encodeLicenseKey, canonicalPayload, keyFingerprint } =
  await import('../src/core/license.ts')
const { checkActivationOnline, activateOnline, OFFLINE_ACTIVATION_AR, ACTIVATE_PATH } =
  await import('../src/core/activation.ts')
const { buildRegistrationReport, shouldReportRegistration, sendRegistrationReport, REGISTRATION_NEEDS_INTERNET_AR } =
  await import('../src/core/registration.ts')
const { sanitizeRegistration } = await import('../../tools/devbot/src/registrations.js')
const { LEGAL_VERSION, EULA, LEGAL_DOCUMENTS, INSTALLER_LICENSE_SUMMARY, LEGAL_CONSENT_CHECKBOXES } = await import('../src/core/legal.ts')

const DEVICE = 'SHOP-AAAA-BBBB-CCCC'
const BASE = 'https://control.example.test'

async function signedKey(payload: Record<string, unknown> = {}) {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
  const body = { v: 1 as const, deviceId: DEVICE, customer: 'اختبار', plan: 'pro', features: [], issuedAt: '2026-10-01', expiresAt: '2099-01-01', activityId: 'retail', ...payload }
  const sig = new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(canonicalPayload(body as never))))
  const key = encodeLicenseKey(body as never, sig)
  return { key, pubB64u: b64uEncode(raw), fingerprint: keyFingerprint(key) }
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Call = { url: string; init?: RequestInit }
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return respond()
  }
  return { fn, calls }
}

describe('التفعيل: تأكيد الخادم قبل الحفظ', () => {
  it('المسار POST /activate على عامل الترخيص', () => {
    expect(ACTIVATE_PATH).toBe('/activate')
  })

  it('الخادم يقبل ⇒ accepted مع الخطة وتاريخ الانتهاء', async () => {
    const f = fakeFetch(() => jsonResponse(200, { ok: true, plan: 'pro', expiresAt: '2099-01-01' }))
    const r = await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: f.fn })
    expect(r).toEqual({ kind: 'accepted', plan: 'pro', expiresAt: '2099-01-01' })
    expect(f.calls[0].url).toBe(`${BASE}${ACTIVATE_PATH}`)
    expect(f.calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ deviceId: DEVICE, key: 'SHOPSYS1.a.b' })
  })

  it('الخادم يرفض (403) ⇒ rejected بالسبب العربي والرمز', async () => {
    const f = fakeFetch(() => jsonResponse(403, { ok: false, code: 'revoked', reason: 'تم إبطال هذا المفتاح' }))
    const r = await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: f.fn })
    expect(r).toEqual({ kind: 'rejected', code: 'revoked', reasonAr: 'تم إبطال هذا المفتاح' })
  })

  it('خطأ خادم 500 ⇒ offline (لا نحكم بالرفض)', async () => {
    const f = fakeFetch(() => new Response('boom', { status: 500 }))
    expect(await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: f.fn })).toEqual({ kind: 'offline' })
  })

  it('انقطاع الشبكة ⇒ offline', async () => {
    const f = fakeFetch(() => { throw new TypeError('fetch failed') })
    expect(await checkActivationOnline({ deviceId: DEVICE, key: 'SHOPSYS1.a.b', baseUrl: BASE, fetchImpl: f.fn })).toEqual({ kind: 'offline' })
  })

  it('مفتاح مُبطل محلياً يُرفض قبل أي اتصال بالشبكة', async () => {
    const { key, pubB64u, fingerprint } = await signedKey()
    const f = fakeFetch(() => jsonResponse(200, { ok: true, plan: 'pro', expiresAt: null }))
    await expect(activateOnline({
      key, deviceId: DEVICE, revokedKeys: [fingerprint], activityId: 'retail', baseUrl: BASE, fetchImpl: f.fn, pubB64u,
    })).rejects.toThrow('محروق')
    expect(f.calls).toHaveLength(0)
  })

  it('توقيع فاسد يُرفض قبل أي اتصال بالشبكة', async () => {
    const { key, pubB64u } = await signedKey()
    const tampered = key.slice(0, -3) + (key.endsWith('A') ? 'B' : 'A') + key.slice(-2)
    const f = fakeFetch(() => jsonResponse(200, { ok: true, plan: 'pro', expiresAt: null }))
    await expect(activateOnline({
      key: tampered, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', baseUrl: BASE, fetchImpl: f.fn, pubB64u,
    })).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })

  it('مفتاح صالح محلياً + الخادم يقبل ⇒ يُعاد payload المفتاح', async () => {
    const { key, pubB64u } = await signedKey({ plan: 'business' })
    const f = fakeFetch(() => jsonResponse(200, { ok: true, plan: 'business', expiresAt: '2099-01-01' }))
    const payload = await activateOnline({
      key, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', baseUrl: BASE, fetchImpl: f.fn, pubB64u,
    })
    expect(payload.plan).toBe('business')
    expect(f.calls).toHaveLength(1)
  })

  it('مفتاح صالح محلياً + بلا اتصال ⇒ يفشل برسالة الاتصال ولا يُحفظ', async () => {
    const { key, pubB64u } = await signedKey()
    const f = fakeFetch(() => { throw new TypeError('offline') })
    await expect(activateOnline({
      key, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', baseUrl: BASE, fetchImpl: f.fn, pubB64u,
    })).rejects.toThrow(OFFLINE_ACTIVATION_AR)
  })

  it('مفتاح صالح محلياً + الخادم يرفض (منتهٍ) ⇒ يفشل بسبب الخادم', async () => {
    const { key, pubB64u } = await signedKey()
    const f = fakeFetch(() => jsonResponse(403, { ok: false, code: 'expired', reason: 'انتهت صلاحية هذا المفتاح' }))
    await expect(activateOnline({
      key, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', baseUrl: BASE, fetchImpl: f.fn, pubB64u,
    })).rejects.toThrow('انتهت صلاحية هذا المفتاح')
  })

  it('واجهتا القفل والترخيص تستعملان activateOnline لا الدالة المحلية وحدها', () => {
    const lock = readFileSync(join(process.cwd(), 'src/ui/LockScreen.tsx'), 'utf8')
    const page = readFileSync(join(process.cwd(), 'src/ui/pages/LicensePage.tsx'), 'utf8')
    for (const src of [lock, page]) {
      expect(src).toContain('activateOnline(')
      expect(src).not.toContain('await acceptActivationKey(')
    }
  })
})

describe('التسجيل: إلزامي بقبول الاتفاقية', () => {
  const base = { deviceId: DEVICE }

  it('لا توجد موافقة منفصلة: الإرسال يكفيه اكتمال الإعداد ولم يُبلَّغ بعد', () => {
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: DEVICE, reportedAt: null })).toBe(true)
  })

  it('لم يكتمل الإعداد ⇒ لا إرسال', () => {
    expect(shouldReportRegistration({ setupCompleted: false, deviceId: DEVICE, reportedAt: null })).toBe(false)
  })

  it('أُبلغ من قبل ⇒ لا إعادة إرسال', () => {
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: DEVICE, reportedAt: '2026-10-10T00:00:00Z' })).toBe(false)
  })

  it('معرّف جهاز تالف ⇒ لا إرسال', () => {
    expect(shouldReportRegistration({ setupCompleted: true, deviceId: 'تالف', reportedAt: null })).toBe(false)
  })

  it('البلاغ يحمل الحقول المعلنة فقط (لا خطة ولا سنة مالية ولا تخصص ولا رمز دولة)', () => {
    const r = buildRegistrationReport({
      ...base, shopName: 'متجر النور', ownerName: 'أحمد', phone: '01012345678', email: 'a@b.co',
      city: 'المنصورة', street: 'شارع الجمهورية', activityNameAr: 'تجزئة',
      // حقول قديمة يمررها مستدعٍ قديم — يجب ألا تصل
      ...({ countryCode: 'EG', activityId: 'retail', plan: 'trial', doctorSpecialty: '', fiscalYearName: '2026', fiscalYearStart: '2026-01-01' } as Record<string, string>),
    })
    expect(r).not.toBeNull()
    expect(r).toMatchObject({
      shopName: 'متجر النور', ownerName: 'أحمد', phone: '01012345678', email: 'a@b.co',
      city: 'المنصورة', street: 'شارع الجمهورية', activityNameAr: 'تجزئة',
    })
    for (const k of ['countryCode', 'activityId', 'plan', 'doctorSpecialty', 'fiscalYearName', 'fiscalYearStart', 'appVersion', 'platform', 'pin', 'ownerPin']) {
      expect(r).not.toHaveProperty(k)
    }
  })

  it('الخادم يحفظ السنة المالية ويُسقط ما هو غير صالح (مطابقة لـ core)', () => {
    const clean = sanitizeRegistration({
      deviceId: DEVICE, shopName: 'س', fiscalYearName: '2026', fiscalYearStart: '2026-01-01', fiscalYearEnd: 'x',
    })
    expect(clean?.fiscalYearName).toBe('2026')
    expect(clean?.fiscalYearStart).toBe('2026-01-01')
    expect(clean?.fiscalYearEnd).toBeUndefined()
  })

  it('فشل الشبكة ⇒ failed بلا استثناء (فلا يُعلَّم المتجر ولا يُكمل المعالج)', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => { throw new TypeError('network down') }) as unknown as typeof fetch
    try {
      const report = buildRegistrationReport({ ...base })
      expect(report).not.toBeNull()
      expect(await sendRegistrationReport(BASE, report!)).toBe('failed')
    } finally {
      globalThis.fetch = original
    }
    expect(REGISTRATION_NEEDS_INTERNET_AR).toContain('يتطلب اتصالاً')
  })

  it('رد الخادم 200 مع isNew ⇒ sent، وبدونه ⇒ duplicate', async () => {
    const original = globalThis.fetch
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, isNew: true }), { status: 200 })) as unknown as typeof fetch
      expect(await sendRegistrationReport(BASE, buildRegistrationReport({ ...base })!)).toBe('sent')
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, isNew: false }), { status: 200 })) as unknown as typeof fetch
      expect(await sendRegistrationReport(BASE, buildRegistrationReport({ ...base })!)).toBe('duplicate')
    } finally {
      globalThis.fetch = original
    }
  })

  it('المعالج لا يحوي خانة موافقة ولا يعتمد على consent', () => {
    const wizard = readFileSync(join(process.cwd(), 'src/ui/setup/FirstRunWizard.tsx'), 'utf8')
    expect(wizard).not.toMatch(/setRegistrationConsent|sendRegistration\b|أوافق على إبلاغ المطوّر/)
    expect(wizard).toContain('sendRegistrationReport(')
    expect(wizard).toContain('if (result === \'failed\')')
  })
})

describe('الاتفاقية: إفصاح صريح عن الإرسال الإلزامي والاتصال والفترة', () => {
  const eulaText = JSON.stringify(EULA)

  it('إصدار الاتفاقية تغيّر ليُطلب القبول من جديد', () => {
    expect(LEGAL_VERSION).not.toBe('2026-10-08')
  })

  it('تُفصح الاتفاقية عن الإرسال التلقائي لبيانات التسجيل وأنه ضروري للتفعيل', () => {
    expect(eulaText).toContain('تُرسل تلقائياً بقبولك هذه الاتفاقية')
    expect(eulaText).toContain('إرسالها ضروري لإكمال التسجيل والتفعيل')
    expect(eulaText).toContain('إن لم توافق عليه فلن يكتمل تسجيل جهازك')
  })

  it('تُفصح الاتفاقية عن مسؤولية ملف مفتاح الاسترداد وكلمة مروره', () => {
    expect(eulaText).toContain('ملف مفتاح الاسترداد (.tkey)')
    expect(eulaText).toContain('أنت وحدك مسؤول عن حفظه')
  })

  it('شاشة القبول: موافقات منفصلة (الاتفاقية، بيانات التسجيل، مفتاح الاسترداد) — ولا خانة مدمجة', () => {
    expect(LEGAL_CONSENT_CHECKBOXES.map((c) => c.id)).toEqual(['legal', 'registration', 'recovery'])
    expect(LEGAL_CONSENT_CHECKBOXES[1].label).toContain('أوافق على إرسال بيانات التسجيل')
    expect(LEGAL_CONSENT_CHECKBOXES[1].label).toContain('إلغاء تثبيته')
  })

  it('تُفصح عن أن إنشاء الحساب والتفعيل يتطلبان اتصالاً', () => {
    expect(eulaText).toContain('إنشاء الحساب والتفعيل يتطلبان اتصالاً بالإنترنت')
  })

  it('تُفصح عن عدم فترة السماح عند انتهاء الاشتراك', () => {
    expect(eulaText).toContain('لا تُمنح فترة سماح')
  })

  it('ملف المثبّت يُولَّد من النص نفسه بلا عنصر نائب غير مُوسَّع', () => {
    expect(INSTALLER_LICENSE_SUMMARY).not.toContain('${LEGAL_DOCUMENTS}')
    expect(INSTALLER_LICENSE_SUMMARY.startsWith(LEGAL_DOCUMENTS)).toBe(true)
    const file = readFileSync(join(process.cwd(), 'desktop/build/license.txt'), 'utf8')
    expect(file).not.toContain('${LEGAL_DOCUMENTS}')
    expect(file).toContain('لا فترة سماح')
  })
})
