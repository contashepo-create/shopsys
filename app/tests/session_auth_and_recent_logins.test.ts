import { beforeEach, describe, expect, it } from 'vitest'
import { isSessionAuthenticated, markSessionAuthenticated, clearSessionAuthenticated } from '../src/data/sessionAuth.ts'
import {
  loadRecentLogins, rememberRecentLogin, forgetRecentLogin, purgeLegacySavedPin, type RecentLogin,
} from '../src/data/recentLogins.ts'
import { authRequired } from '../src/core/auth.ts'

describe('sessionAuth — إجبار الدخول في كل فتح جديد للتطبيق', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearSessionAuthenticated() // تصفير العلم في الذاكرة — محاكاة جلسة جديدة
  })

  it('جلسة جديدة لم تُصادَق عليها بعد (محاكاة فتح تبويب/تطبيق جديد)', () => {
    expect(isSessionAuthenticated()).toBe(false)
  })

  it('تُصبح مصادَقاً عليها بعد نجاح الدخول، وتبقى سارية داخل نفس الجلسة (تنقل/تحديث صفحة)', () => {
    markSessionAuthenticated()
    expect(isSessionAuthenticated()).toBe(true)
    // تحديث الصفحة لا يمسح sessionStorage فعلياً — نحاكي ذلك بعدم استدعاء clear
    expect(isSessionAuthenticated()).toBe(true)
  })

  it('تسجيل الخروج الصريح يمسح علم الجلسة فوراً', () => {
    markSessionAuthenticated()
    expect(isSessionAuthenticated()).toBe(true)
    clearSessionAuthenticated()
    expect(isSessionAuthenticated()).toBe(false)
  })

  it('بوابة App.tsx: المستخدم النشط + لم تُصادَق عليه الجلسة بعد ⇒ تُجبر شاشة الدخول حتى لو loggedOut=false', () => {
    const ownerPinHash = 'hash-xyz'
    const activeUsersCount = 0
    const loggedOut = false
    const required = authRequired(ownerPinHash, activeUsersCount)
    const gate = required && (loggedOut || !isSessionAuthenticated())
    expect(required).toBe(true)
    expect(isSessionAuthenticated()).toBe(false)
    expect(gate).toBe(true) // يجب إظهار شاشة الدخول
  })

  it('بوابة App.tsx: بعد تسجيل دخول ناجح (markSessionAuthenticated) لا تُطلب شاشة الدخول مجدداً بلا تسجيل خروج', () => {
    const ownerPinHash = 'hash-xyz'
    markSessionAuthenticated()
    const gate = authRequired(ownerPinHash, 0) && (false || !isSessionAuthenticated())
    expect(gate).toBe(false)
  })
})

describe('recentLogins — تذكّر المعرف فقط دون أي رقم سري', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('لا يوجد شيء قبل أي دخول', () => {
    expect(loadRecentLogins()).toEqual([])
  })

  it('يضيف بطاقة جديدة بعد دخول ناجح، والأحدث يظهر أولاً', () => {
    rememberRecentLogin('01000000001', 'موظف أول')
    rememberRecentLogin('01000000002', 'موظف ثانٍ')
    const list = loadRecentLogins()
    expect(list.map((r) => r.identifier)).toEqual(['01000000002', '01000000001'])
  })

  it('إعادة دخول معرف موجود يرفعه لأعلى القائمة بدل تكراره', () => {
    rememberRecentLogin('01000000001', 'موظف أول')
    rememberRecentLogin('01000000002', 'موظف ثانٍ')
    rememberRecentLogin('01000000001', 'موظف أول')
    const list = loadRecentLogins()
    expect(list).toHaveLength(2)
    expect(list[0].identifier).toBe('01000000001')
  })

  it('لا يتجاوز الحد الأقصى 8 بطاقات — الأقدم يُحذف تلقائياً', () => {
    for (let i = 0; i < 10; i++) rememberRecentLogin(`user-${i}`, `مستخدم ${i}`)
    const list = loadRecentLogins()
    expect(list).toHaveLength(8)
    expect(list.map((r) => r.identifier)).not.toContain('user-0')
    expect(list.map((r) => r.identifier)).not.toContain('user-1')
    expect(list[0].identifier).toBe('user-9')
  })

  it('forgetRecentLogin يحذف بطاقة واحدة فقط دون المساس بالباقي', () => {
    rememberRecentLogin('01000000001', 'موظف أول')
    rememberRecentLogin('01000000002', 'موظف ثانٍ')
    forgetRecentLogin('01000000001')
    const list = loadRecentLogins()
    expect(list.map((r) => r.identifier)).toEqual(['01000000002'])
  })

  it('لا تُخزَّن أي كلمة سر أو قيمة تشبه رقماً سرياً مطلقاً ضمن القائمة أو خامها في التخزين', () => {
    rememberRecentLogin('01000000001', 'موظف أول')
    const raw = localStorage.getItem('tahakam-recent-logins') ?? ''
    expect(raw).not.toMatch(/pin/i)
    const parsed = JSON.parse(raw) as RecentLogin[]
    for (const entry of parsed) {
      expect(Object.keys(entry).sort()).toEqual(['displayName', 'identifier', 'lastLoginAt'])
    }
  })

  it('purgeLegacySavedPin يحذف مفتاح «حفظ بيانات الدخول» القديم (كان يخزّن رقماً سرياً مشفَّراً) دون المساس بقائمة الأسماء الجديدة', () => {
    localStorage.setItem('tahakam-saved-login', JSON.stringify({ identifier: 'x', pin: 'encrypted-should-not-exist' }))
    rememberRecentLogin('01000000001', 'موظف أول')
    purgeLegacySavedPin()
    expect(localStorage.getItem('tahakam-saved-login')).toBeNull()
    expect(loadRecentLogins()).toHaveLength(1)
  })

  it('تجاهل بصمت عند تخزين تالف بدل إلقاء استثناء', () => {
    localStorage.setItem('tahakam-recent-logins', '{not json')
    expect(loadRecentLogins()).toEqual([])
    localStorage.setItem('tahakam-recent-logins', JSON.stringify([{ identifier: 'ok', displayName: 'ok' }, { bad: true }]))
    expect(loadRecentLogins()).toEqual([])
  })
})
