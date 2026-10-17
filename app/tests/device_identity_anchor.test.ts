/**
 * بند 2 (طلب المالك 2026-10-17) — هوية الجهاز: مرساة خارج القاعدة.
 *
 * معرّف الجهاز كان يعيش في مرساة `localStorage` وداخل القاعدة نفسها ⇒ مسح
 * القاعدة (أو فقد مرساة Chromium) كان يُنشئ معرّفاً جديداً: يخرج العميل من
 * لوحة المطوّر كـ«عميل جديد» ويُفقد الترخيص المرتبط بالجهاز.
 *
 * `desktop/deviceIdentity.ts` دالة خالصة: المحفوظ في `userData` هو **المرجع**
 * ولا يتغيّر أبداً؛ وإن لم يوجد محفوظ يُعتمد المرشّح الوارد من الواجهة.
 * هذا الملف يختبر المنطق نقياً (بلا Electron) — والبوابة النصّية
 * `scripts/verify_device_identity_anchor.mjs` تختبر الربط الفعلي.
 */
import { describe, it, expect } from 'vitest'
import {
  mergeDeviceIdentity,
  normalizeDeviceId,
  isValidDeviceId,
  generateDeviceIdFromBytes,
  isIsoDay,
  DEVICE_ID_PATTERN,
} from '../desktop/deviceIdentity.ts'

const A = 'SHOP-7K2M-9PXQ-4RTZ'
const B = 'SHOP-AAAA-BBBB-CCCC'

describe('② هوية الجهاز — تطبيع المعرّف', () => {
  it('يقبل الصيغة الصحيحة ويرفض الناقصة', () => {
    expect(isValidDeviceId(A)).toBe(true)
    expect(isValidDeviceId('SHOP-7K2M-9PXQ')).toBe(false)
    expect(isValidDeviceId('shop-7k2m-9pxq-4rtz')).toBe(true) // تُطبَّع للأحرف الكبيرة قبل الفحص
    expect(isValidDeviceId('')).toBe(false)
    expect(isValidDeviceId(null)).toBe(false)
    expect(isValidDeviceId(12345)).toBe(false)
  })

  it('يحوّل الأحرف الصغيرة إلى كبيرة قبل الفحص', () => {
    expect(normalizeDeviceId('shop-7k2m-9pxq-4rtz')).toBe(A)
    expect(normalizeDeviceId(`  ${A}  `)).toBe(A)
    expect(normalizeDeviceId('shop-7k2m-9pxq')).toBeNull()
  })

  it('الصيغة نفسها المستعملة في التطبيق (DEVICE_RE)', () => {
    expect(DEVICE_ID_PATTERN.test(A)).toBe(true)
    expect(DEVICE_ID_PATTERN.test('SHOP-IIII-OOOO-1111')).toBe(true) // I و O مسموحان في هذا النمط
  })
})

describe('② هوية الجهاز — توليد المعرّف', () => {
  it('يولّد معرّفاً بالصيغة نفسها من بايتات ثابتة (حتمي)', () => {
    const bytes = new Uint8Array(12).fill(7)
    const id = generateDeviceIdFromBytes(bytes)
    expect(DEVICE_ID_PATTERN.test(id)).toBe(true)
    expect(generateDeviceIdFromBytes(bytes)).toBe(id)
  })

  it('لا يستعمل حروفاً ملتبسة (I/O/0/1)', () => {
    for (let seed = 0; seed < 40; seed++) {
      const bytes = new Uint8Array(12).map((_, i) => (seed * 7 + i * 13) % 256)
      const id = generateDeviceIdFromBytes(bytes)
      expect(id.slice(5)).not.toMatch(/[IO01]/)
    }
  })
})

describe('② هوية الجهاز — الدمج (المحفوظ هو المرجع)', () => {
  it('المحفوظ يتقدّم على المرشّح الوارد (هوية الجهاز لا تتغيّر أبداً)', () => {
    const merged = mergeDeviceIdentity({ deviceId: A, firstTrialAt: '2026-01-01' }, { deviceId: B, firstTrialAt: '2026-05-05' })
    expect(merged.identity.deviceId).toBe(A)
    expect(merged.changed).toBe(false)
  })

  it('لا محفوظ ⇒ يُعتمد المرشّح الوارد (ترقية التطبيق لا تكسر الترخيص)', () => {
    const merged = mergeDeviceIdentity(null, { deviceId: B, firstTrialAt: '2026-05-05' })
    expect(merged.identity.deviceId).toBe(B)
    expect(merged.identity.firstTrialAt).toBe('2026-05-05')
    expect(merged.changed).toBe(true)
  })

  it('محفوظ بلا معرّف + مرشّح صالح ⇒ يُعتمد المرشّح', () => {
    const merged = mergeDeviceIdentity({ firstTrialAt: '2026-01-01' }, { deviceId: B })
    expect(merged.identity.deviceId).toBe(B)
    expect(merged.changed).toBe(true)
  })

  it('محفوظ بمعرّف تالف + مرشّح صالح ⇒ المرشّح', () => {
    const merged = mergeDeviceIdentity({ deviceId: 'مشوّه' }, { deviceId: B })
    expect(merged.identity.deviceId).toBe(B)
  })

  it('لا محفوظ ولا مرشّح ⇒ بلا معرّف (المولّد في العملية الرئيسية)', () => {
    const merged = mergeDeviceIdentity(null, null)
    expect(merged.identity.deviceId).toBeNull()
    expect(merged.changed).toBe(false)
  })

  it('بداية التجربة: الأقدم بين المحفوظ والوارد (كما في trialAnchor)', () => {
    const merged = mergeDeviceIdentity({ deviceId: A, firstTrialAt: '2026-01-01' }, { deviceId: A, firstTrialAt: '2025-12-31' })
    expect(merged.identity.firstTrialAt).toBe('2025-12-31')
    expect(merged.changed).toBe(true)
  })

  it('تاريخ غير صالح يُتجاهل (لا يُفسد بداية التجربة)', () => {
    const merged = mergeDeviceIdentity({ deviceId: A, firstTrialAt: 'مشوّه' }, { deviceId: A, firstTrialAt: '2026-02-02' })
    expect(merged.identity.firstTrialAt).toBe('2026-02-02')
  })
})

describe('② هوية الجهاز — قراءة التاريخ', () => {
  it('يقبل YYYY-MM-DD (أو ISO أطول) ويرفض غيره', () => {
    expect(isIsoDay('2026-01-31')).toBe(true)
    expect(isIsoDay('2026-01-31T10:00:00.000Z')).toBe(true)
    expect(isIsoDay('31-01-2026')).toBe(false)
    expect(isIsoDay('2026-13-31')).toBe(false)
    expect(isIsoDay('مشوّه')).toBe(false)
    expect(isIsoDay(null)).toBe(false)
  })
})
