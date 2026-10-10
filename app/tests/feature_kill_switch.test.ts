/**
 * الإطفاء السحابي للميزات (kill-switch) يسري على كل بوابة ترخيص:
 * ميزة ممنوحة بمفتاح موقّع + مُطفأة من المطوّر ⇒ hasFeature = false في كل مكان.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { evaluateLicense, hasFeature, type LicensePayload } from '../src/core/license.ts'
import { setActiveDeviceFlags, effectiveFeatures, isCloudDisabled } from '../src/core/featureFlags.ts'

const payload: LicensePayload = {
  v: 1, deviceId: 'DEV-1', customer: 'محل', plan: 'pro',
  features: ['einvoice_sa', 'cloud_sync', 'telegram_bot'],
  issuedAt: '2026-10-01', expiresAt: null,
}
const base = { activatedPayload: payload, trialStartedAt: '2026-10-01', lastSeenAt: '2026-10-09', today: '2026-10-10T08:00:00Z' }

afterEach(() => setActiveDeviceFlags(null))

describe('الإطفاء السحابي للميزات', () => {
  it('بلا أعلام: الميزات الممنوحة تعمل كما هي', () => {
    const state = evaluateLicense(base)
    expect(hasFeature(state, 'einvoice_sa')).toBe(true)
    expect(hasFeature(state, 'telegram_bot')).toBe(true)
  })

  it('ميزة مُطفأة سحابياً ⇒ hasFeature = false، والبقية تعمل', () => {
    setActiveDeviceFlags({ disabledFeatures: ['einvoice_sa', 'telegram_bot'], noteAr: 'متأخر في السداد', updatedAt: '2026-10-10' })
    const state = evaluateLicense(base)
    expect(hasFeature(state, 'einvoice_sa')).toBe(false)
    expect(hasFeature(state, 'telegram_bot')).toBe(false)
    expect(hasFeature(state, 'cloud_sync')).toBe(true)
  })

  it('الإطفاء لا يُضيف ميزة غير ممنوحة ولا يغيّر المفتاح الأصلي', () => {
    setActiveDeviceFlags({ disabledFeatures: ['multi_branch'], noteAr: '', updatedAt: '' })
    const state = evaluateLicense(base)
    expect(hasFeature(state, 'multi_branch')).toBe(false)
    expect(payload.features).toEqual(['einvoice_sa', 'cloud_sync', 'telegram_bot'])
  })

  it('isCloudDisabled يميّز «مُطفأة مؤقتاً» عن «غير مشتراة»', () => {
    const flags = { disabledFeatures: ['einvoice_sa' as const], noteAr: '', updatedAt: '' }
    expect(isCloudDisabled('einvoice_sa', payload.features, flags)).toBe(true)
    expect(isCloudDisabled('multi_branch', payload.features, flags)).toBe(false)
    expect(effectiveFeatures(payload.features, flags)).not.toContain('einvoice_sa')
  })

  it('الأعلام الممرّرة صراحة تتغلب على الحالة المحفوظة (اعتماد صريح لـuseMemo)', () => {
    setActiveDeviceFlags({ disabledFeatures: ['cloud_sync'], noteAr: '', updatedAt: '' })
    // المرسَل صراحةً هو الحقيقة: null يعني «لا إطفاء» حتى لو بقيت حالة قديمة في الوحدة
    expect(hasFeature(evaluateLicense({ ...base, deviceFlags: null }), 'cloud_sync')).toBe(true)
    const off = evaluateLicense({ ...base, deviceFlags: { disabledFeatures: ['telegram_bot'], noteAr: '', updatedAt: '' } })
    expect(hasFeature(off, 'telegram_bot')).toBe(false)
    expect(hasFeature(off, 'cloud_sync')).toBe(true)
  })

  it('إلغاء الأعلام (null) يعيد الميزة فوراً', () => {
    setActiveDeviceFlags({ disabledFeatures: ['cloud_sync'], noteAr: '', updatedAt: '' })
    expect(hasFeature(evaluateLicense(base), 'cloud_sync')).toBe(false)
    setActiveDeviceFlags(null)
    expect(hasFeature(evaluateLicense(base), 'cloud_sync')).toBe(true)
  })
})
