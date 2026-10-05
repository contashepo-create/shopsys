/**
 * جولة v1.0.7 — موافقة المالك: النشاط يُقفل بعد الإعداد، وتغييره يتم
 * فقط بمفتاح SHOPSYS2 موقّع من المطوّر (بوت/لوحة المطوّر أو أداة CLI)،
 * بتقييد تغيير واحد كل 30 يوماً، ومفتاح التفعيل القديم يظل صالحاً.
 *
 * الاختبار يولّد زوج Ed25519 مؤقتاً (كما في devbot_license_compat) ويثبت:
 * دورة كاملة عبر المتجر الحقيقي: إعداد → تفعيل مربوط بالنشاط → مفتاح
 * نشاط يغيّر النشاط بالقوالب → مفتاح التفعيل القديم ما زال مقبولاً →
 * التقييد يمنع تغييراً ثانياً → المفاتيح المزيفة/لجهاز آخر مرفوضة.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useAppStore } = await import('../src/stores/app.store.ts')
const license = await import('../src/core/license.ts')
const { verifyActivityChangeKey, encodeActivityChangeKey, activityMatches, ACTIVITY_CHANGE_COOLDOWN_DAYS } = license
type ActivityChangePayload = import('../src/core/license.ts').ActivityChangePayload
const { ACTIVITY_TEMPLATES } = await import('../src/core/activities.ts')

/* زوج Ed25519 مؤقت — التوقيع الذي سيستعمله المركز بعد النشر بنفس الخوارزمية */
const { subtle } = crypto
const pair = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
const privPkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))
const pubRaw = new Uint8Array((await subtle.exportKey('spki', pair.publicKey)).slice(-32))
const b64u = (b: Uint8Array) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const PUB = b64u(pubRaw)

const sign = async (payload: ActivityChangePayload) => {
  const canonical = JSON.stringify({ v: payload.v, deviceId: payload.deviceId, fromActivityId: payload.fromActivityId, toActivityId: payload.toActivityId, issuedAt: payload.issuedAt })
  const msg = new TextEncoder().encode(canonical)
  const sig = new Uint8Array(await subtle.sign('Ed25519', pair.privateKey, msg as unknown as ArrayBuffer))
  return encodeActivityChangeKey(payload, sig)
}

describe('تغيير النشاط بمفتاح الدعم الموقّع (v1.0.7)', () => {
  it('دورة كاملة: الإعداد ثم التفعيل ثم مفتاح النشاط يغيّره بالقوالب ويبقي مفتاح التفعيل صالحاً', async () => {
    const A = () => useAppStore.getState()
    // الإعداد الأول بنشاط البقالة
    A().completeSetup({
      country: { code: 'EG', nameAr: 'مصر', vatPercent: 14, currency: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' } } as never,
      activity: ACTIVITY_TEMPLATES.find((t) => t.id === 'grocery')! as never,
      shopName: 'بقالة النور', ownerName: 'المالك', fiscalYear: { nameAr: '2026', startDate: '2026-01-01', endDate: '2026-12-31' } as never,
    })
    expect(A().setup.activityId).toBe('grocery')
    // تفعيل مربوط بالنشاط (قرار 28)
    const licensePayload = { v: 1 as const, deviceId: A().deviceId, customer: 'بقالة النور', plan: 'pro' as const, features: [], issuedAt: '2026-10-01', expiresAt: '2027-10-01', activityId: 'grocery' }
    A().setActivated('SHOPSYS1.dummy', licensePayload)
    expect(A().setup.activityKeyHistory).toEqual(['grocery'])
    // مفتاح نشاط موقّع: بقالة ← صيدلية
    const key = await sign({ v: 1, deviceId: A().deviceId, fromActivityId: 'grocery', toActivityId: 'pharmacy', issuedAt: '2026-10-05' })
    const nameAr = await A().applyActivityChangeKey(key, PUB)
    expect(nameAr).toBeTruthy()
    expect(A().setup.activityId).toBe('pharmacy')
    expect(A().setup.activityKeyHistory).toEqual(['grocery', 'pharmacy'])
    expect(A().setup.lastActivityChangeAt).toBeTruthy()
    // القوالب طُبقت (خصائص ووحدات الصيدلية من القالب لا من البقالة)
    const pharmacy = ACTIVITY_TEMPLATES.find((t) => t.id === 'pharmacy')!
    expect(A().setup.features).toEqual(pharmacy.features)
    expect(A().setup.modules).toEqual(pharmacy.modules)
    // مفتاح التفعيل القديم (grocery) ما زال صالحاً مع النشاط الحالي (pharmacy)
    expect(activityMatches(licensePayload, A().setup.activityId, A().setup.activityKeyHistory)).toBe(true)
    // وبلا سجل التاريخ يُرفض (توافق سلوك الإصدارات القديمة)
    expect(activityMatches(licensePayload, 'pharmacy')).toBe(false)
  })

  it('التقييد: تغيير ثانٍ خلال 30 يوماً يُرفض برسالة الأيام المتبقية', async () => {
    const A = () => useAppStore.getState()
    const key = await sign({ v: 1, deviceId: A().deviceId, fromActivityId: A().setup.activityId!, toActivityId: 'grocery', issuedAt: '2026-10-05' })
    await expect(A().applyActivityChangeKey(key, PUB)).rejects.toThrow(/باقٍ/)
    expect(A().setup.activityId).toBe('pharmacy') // لم يتغير
  })

  it('الأمان: توقيع مزيف/جهاز آخر/نشاط مصدر خاطئ/نشاط مجهول — كلها مرفوضة', async () => {
    const A = () => useAppStore.getState()
    // جهاز آخر
    const otherDevice = await sign({ v: 1, deviceId: 'SHOP-OTHE-R000-0000', fromActivityId: 'pharmacy', toActivityId: 'grocery', issuedAt: '2026-10-05' })
    await expect(A().applyActivityChangeKey(otherDevice, PUB)).rejects.toThrow('جهاز آخر')
    // نشاط المصدر لا يطابق الحالي
    const wrongFrom = await sign({ v: 1, deviceId: A().deviceId, fromActivityId: 'laundry', toActivityId: 'grocery', issuedAt: '2026-10-05' })
    await expect(A().applyActivityChangeKey(wrongFrom, PUB)).rejects.toThrow('محدّثاً من الدعم')
    // نشاط مجهول
    const unknownTo = await sign({ v: 1, deviceId: A().deviceId, fromActivityId: 'pharmacy', toActivityId: 'does_not_exist', issuedAt: '2026-10-05' })
    await expect(A().applyActivityChangeKey(unknownTo, PUB)).rejects.toThrow('غير معروف')
    // نص عشوائي
    await expect(A().applyActivityChangeKey('SHOPSYS2.abc.def', PUB)).rejects.toThrow()
    await expect(A().applyActivityChangeKey('SHOPSYS1.x.y', PUB)).rejects.toThrow('صيغة مفتاح تغيير النشاط')
    // التحقق المباشر بالمفتاح العام يتطلب جهازاً مطابقاً وتوقيعاً صحيحاً
    await expect(verifyActivityChangeKey('SHOPSYS2.a.b', A().deviceId, PUB)).rejects.toThrow()
  })
})
