/**
 * مراجعة 2026-10-09 — إصلاحات ثلاثة مؤكدة بالتجربة:
 *   H2  التنبيه المهم/العاجل لا يسقط بتراكم الإعلانات (التخزين والتسليم معاً).
 *   M4  شاشة «الترخيص» تطبّق فحص الإبطال والنشاط كشاشة القفل (دالة مشتركة واحدة).
 *   M1  بلاغ تسجيل لاحق غير موثّق لا يستبدل الحقول المعتمدة، ويُعرض للمالك كتغيير معلّق.
 */
import { describe, it, expect } from 'vitest'
import { webcrypto } from 'node:crypto'

const { capNotices, getNotificationsForDevice, NOTICE_KEEP_INFO, NOTICE_KEEP_URGENT } =
  await import('../../tools/devbot/src/adminPanel.js')
const { saveRegistration, sanitizeRegistration, formatRegistrationDetailAr } =
  await import('../../tools/devbot/src/registrations.js')
const { acceptActivationKey, b64uEncode, encodeLicenseKey, canonicalPayload, keyFingerprint } =
  await import('../src/core/license.ts')

/* ─── مساعدات ─── */
const memKv = () => {
  const m = new Map<string, string>()
  return {
    _m: m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v) },
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: null })),
      list_complete: true,
    }),
  }
}

const notice = (id: string, level: string, createdAt: string) => ({
  id, level, body: `نص ${id}`, title: id, createdAt, requiresAck: level !== 'info',
  expiresAt: '2099-01-01T00:00:00.000Z',
})

/* ─── H2: الإشعارات ─── */
describe('H2 — التنبيه الحرج لا يسقط بتراكم الإعلانات', () => {
  it('التسليم: تنبيه critical قديم يبقى بعد 50 إعلاناً أحدث منه', async () => {
    const kv = memKv()
    const infos = Array.from({ length: 50 }, (_, i) =>
      notice(`INFO-${i}`, 'info', `2026-02-01T00:00:${String(i).padStart(2, '0')}Z`))
    kv._m.set('notices:global', JSON.stringify([notice('CRIT-1', 'critical', '2026-01-01T00:00:00Z'), ...infos]))
    const got = await getNotificationsForDevice({ kv }, 'SHOP-ABCD-EFGH-JKLM')
    expect(got.some((n: { id: string }) => n.id === 'CRIT-1')).toBe(true)
    expect(got.filter((n: { level: string }) => n.level === 'info')).toHaveLength(NOTICE_KEEP_INFO)
  })

  it('التخزين (capNotices): المهم يبقى حتى مع تراكم إعلانات بعده', () => {
    const urgent = [notice('IMP-1', 'important', '2026-01-02T00:00:00Z')]
    const infos = Array.from({ length: 120 }, (_, i) => notice(`I${i}`, 'info', `2026-02-01T00:${String(i % 60).padStart(2, '0')}:00Z`))
    const kept = capNotices([...urgent, ...infos])
    expect(kept.some((n) => n.id === 'IMP-1')).toBe(true)
    expect(kept.filter((n) => n.level === 'info')).toHaveLength(NOTICE_KEEP_INFO)
  })

  it('السقف للمهم/العاجل نفسه محدود (لا نمو بلا حد)', () => {
    const many = Array.from({ length: NOTICE_KEEP_URGENT + 30 }, (_, i) =>
      notice(`C${i}`, 'critical', `2026-01-01T00:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}Z`))
    expect(capNotices(many).length).toBe(NOTICE_KEEP_URGENT)
  })

  it('التنبيه المنتهي يُسقط حتى لو كان عاجلاً', async () => {
    const kv = memKv()
    kv._m.set('notices:global', JSON.stringify([{ ...notice('OLD', 'critical', '2026-01-01T00:00:00Z'), expiresAt: '2020-01-01T00:00:00.000Z' }]))
    const got = await getNotificationsForDevice({ kv }, 'SHOP-ABCD-EFGH-JKLM')
    expect(got.some((n: { id: string }) => n.id === 'OLD')).toBe(false)
  })
})

/* ─── M1: البلاغ اللاحق لا يستبدل القيم المعتمدة ─── */
describe('M1 — بلاغ تسجيل لاحق لا يكتب فوق القيم المعتمدة', () => {
  const DEV = 'SHOP-ABCD-EFGH-JKLM'
  const honest = () => sanitizeRegistration({ deviceId: DEV, shopName: 'محل الأمانة', ownerName: 'أحمد', phone: '01012345678', email: 'a@x.com', plan: 'basic', activityId: 'retail' })
  const forged = () => sanitizeRegistration({ deviceId: DEV, shopName: 'محل مزيف', ownerName: 'مجهول', phone: '01000000000', email: 'evil@x.com', plan: 'trial', activityId: 'retail' })

  it('البلاغ الأول يُنشئ السجل كما هو', async () => {
    const kv = memKv()
    const r = await saveRegistration({ kv }, honest())
    expect(r.isNew).toBe(true)
    expect(r.record.shopName).toBe('محل الأمانة')
  })

  it('البلاغ اللاحق المزيف لا يغيّر الحقول المعتمدة ولا يُرسل تنبيهاً جديداً', async () => {
    const kv = memKv()
    const first = await saveRegistration({ kv }, honest())
    const second = await saveRegistration({ kv }, forged())
    expect(second.isNew).toBe(false)
    expect(second.record.shopName).toBe('محل الأمانة')
    expect(second.record.phone).toBe('01012345678')
    expect(second.record.email).toBe('a@x.com')
    expect(second.record.firstSeenAt).toBe(first.record.firstSeenAt)
    expect(second.record.reports).toBe(2)
  })

  it('الاختلافات تُحفظ في pendingChanges ويعرضها تفصيل السجل للمالك', async () => {
    const kv = memKv()
    await saveRegistration({ kv }, honest())
    const second = await saveRegistration({ kv }, forged())
    expect(second.record.pendingChanges).toMatchObject({ shopName: 'محل مزيف', phone: '01000000000' })
    const card = formatRegistrationDetailAr(second.record)
    expect(card).toContain('لم تُعتمد')
    expect(card).toContain('محل مزيف')
  })

  it('بلاغ مطابق للقيم المعتمدة لا يترك تغييراً معلقاً قديماً', async () => {
    const kv = memKv()
    await saveRegistration({ kv }, honest())
    await saveRegistration({ kv }, forged())
    const third = await saveRegistration({ kv }, honest())
    expect(third.record.pendingChanges).toBeUndefined()
    expect(formatRegistrationDetailAr(third.record)).not.toContain('لم تُعتمد')
  })
})

/* ─── M4: قبول المفتاح بفحص واحد مشترك ─── */
describe('M4 — قبول مفتاح التفعيل يطبّق الإبطال والنشاط في كل الشاشات', () => {
  const DEVICE = 'SHOP-AAAA-BBBB-CCCC'

  async function signedKey(payload: Record<string, unknown>) {
    const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
    const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
    const body = { v: 1 as const, deviceId: DEVICE, customer: 'اختبار', plan: 'pro', features: [], issuedAt: '2026-10-01', expiresAt: '2099-01-01', activityId: 'retail', ...payload }
    const sig = new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(canonicalPayload(body as never))))
    const key = encodeLicenseKey(body as never, sig)
    return { key, pubB64u: b64uEncode(raw), fingerprint: keyFingerprint(key), body }
  }

  it('مفتاح صالح يُقبل', async () => {
    const { key, pubB64u } = await signedKey({})
    const p = await acceptActivationKey({ key, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', pubB64u })
    expect(p.plan).toBe('pro')
  })

  it('مفتاح مُبطل يُرفض حتى لو صحّ توقيعه (كانت شاشة الترخيص تقبله)', async () => {
    const { key, pubB64u, fingerprint } = await signedKey({})
    await expect(acceptActivationKey({ key, deviceId: DEVICE, revokedKeys: [fingerprint], activityId: 'retail', pubB64u }))
      .rejects.toThrow('محروق')
  })

  it('مفتاح لنشاط آخر يُرفض (كانت شاشة الترخيص تقبله)', async () => {
    const { key, pubB64u } = await signedKey({ activityId: 'pharmacy' })
    await expect(acceptActivationKey({ key, deviceId: DEVICE, revokedKeys: [], activityId: 'retail', pubB64u }))
      .rejects.toThrow('لنشاط آخر')
  })

  it('مفتاح لجهاز آخر يُرفض', async () => {
    const { key, pubB64u } = await signedKey({})
    await expect(acceptActivationKey({ key, deviceId: 'SHOP-ZZZZ-ZZZZ-ZZZZ', revokedKeys: [], activityId: 'retail', pubB64u }))
      .rejects.toThrow()
  })
})
