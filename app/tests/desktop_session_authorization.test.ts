import { describe, expect, it } from 'vitest'
import { createHash, pbkdf2Sync } from 'node:crypto'
import {
  authorizeDesktopIdentity,
  hasConfiguredDesktopAuth,
  isAuthorizedDesktopSender,
  persistedAuthState,
  verifyDesktopPin,
} from '../desktop/sessionAuthorization.ts'

const modernHash = (pin: string) => {
  const salt = '00112233445566778899aabbccddeeff'
  const digest = pbkdf2Sync(Buffer.from(`tahakam:${pin}`), Buffer.from(salt, 'hex'), 310_000, 32, 'sha256').toString('hex')
  return `pbkdf2-sha256$310000$${salt}$${digest}`
}

describe('مصادقة الجلسات في عملية Electron الرئيسية', () => {
  it('يفهم لقطة Zustand المغلفة أو الحالة المباشرة', () => {
    expect(persistedAuthState(JSON.stringify({ state: { ownerPinHash: 'x' }, version: 1 }))).toEqual({ ownerPinHash: 'x' })
    expect(persistedAuthState(JSON.stringify({ ownerPinHash: 'y' }))).toEqual({ ownerPinHash: 'y' })
    expect(persistedAuthState('{broken')).toBeNull()
  })

  it('يتحقق من PBKDF2 وSHA-256 القديمين، ويرفض كلمات مرور خاطئة ومدخلات iteration خطرة', () => {
    const hash = modernHash('123456')
    const legacy = createHash('sha256').update('tahakam:123456').digest('hex')
    expect(verifyDesktopPin('123456', hash)).toBe(true)
    expect(verifyDesktopPin('123457', hash)).toBe(false)
    expect(verifyDesktopPin('123456', legacy)).toBe(true)
    expect(verifyDesktopPin('123456', `pbkdf2-sha256$99999999$00112233445566778899aabbccddeeff$${'0'.repeat(64)}`)).toBe(false)
  })

  it('لا يمنح جلسة محمية إلا لـ PIN المالك أو مستخدم نشط، ويحترم انتهاء PIN المؤقت', () => {
    const ownerPinHash = modernHash('123456')
    const state = {
      ownerPinHash,
      ownerTempPin: { pinHash: modernHash('654321'), expiresAt: '2026-10-24T12:00:00.000Z' },
      appUsers: [{ id: 8, active: true, pinHash: modernHash('222222') }, { id: 9, active: false, pinHash: modernHash('333333') }],
    }
    expect(hasConfiguredDesktopAuth(state)).toBe(true)
    expect(authorizeDesktopIdentity(state, null, '123456', Date.parse('2026-10-24T11:00:00Z'))).toBe(true)
    expect(authorizeDesktopIdentity(state, null, '654321', Date.parse('2026-10-24T11:00:00Z'))).toBe(true)
    expect(authorizeDesktopIdentity(state, null, '654321', Date.parse('2026-10-24T13:00:00Z'))).toBe(false)
    expect(authorizeDesktopIdentity(state, 8, '222222')).toBe(true)
    expect(authorizeDesktopIdentity(state, 9, '333333')).toBe(false)
    expect(authorizeDesktopIdentity(state, 8, '123456')).toBe(false)
  })

  it('لا تسمح نافذة غير مخولة بفتح الأقمار متى كان الدخول مفعّلاً', () => {
    const allowlist = new Set([11])
    expect(isAuthorizedDesktopSender(true, allowlist, 11)).toBe(true)
    expect(isAuthorizedDesktopSender(true, allowlist, 12)).toBe(false)
    expect(isAuthorizedDesktopSender(false, allowlist, 12)).toBe(true)
  })
})
