/**
 * مراجعة أمنية شاملة (2026-10-11) — مضيف الشبكة المحلية:
 *  ① رمز الاقتران يُغلق بعد محاولات خاطئة متتالية (لا تخمين بالقوة الغاشمة).
 *  ② المقارنة بزمن ثابت، والرمز غير النصي مرفوض.
 *  ③ الدوال الإدارية (المستخدمون/الصلاحيات/PIN/الفروع) لا تُنفَّذ عبر الشبكة.
 *  ④ الدوال العادية (البيع...) تبقى متاحة لجهاز مقترن ومسجّل دخوله.
 */
import { describe, it, expect, vi } from 'vitest'
import { LanHostCore, LAN_FORBIDDEN_FNS, PAIR_MAX_FAILURES, PAIR_LOCK_MS, pairingCodesMatch } from '../src/data/lan/hostCore.ts'

const CODE = '482913'

function fakeStore() {
  const state: Record<string, unknown> = {
    currentUserId: null,
    login: vi.fn(async () => ({ usedTempPin: false, mustChangePin: false })),
    addAppUser: vi.fn(() => 99),
    postSale: vi.fn(() => 'sale-ok'),
  }
  return {
    state,
    getState: () => state,
    setState: (partial: Record<string, unknown>) => { Object.assign(state, partial) },
    subscribe: () => () => undefined,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 15))

function harness(now: { t: number }) {
  const store = fakeStore()
  const host = new LanHostCore(store as never, CODE, 'المضيف', {}, () => 'token-1', { now: () => now.t })
  const sent: { op: string; [k: string]: unknown }[] = []
  const id = host.attach({ send: (m) => sent.push(m as never), deviceName: 'جهاز-1' })
  const last = () => sent[sent.length - 1]
  return { store, host, id, sent, last }
}

describe('① قفل الاقتران بعد المحاولات الخاطئة', () => {
  it('بعد 5 محاولات خاطئة يُرفض حتى الرمز الصحيح، ثم يُفتح بعد انقضاء المدة', () => {
    const now = { t: 1_000_000 }
    const { host, id, last } = harness(now)
    for (let i = 0; i < PAIR_MAX_FAILURES; i++) host.handle(id, { op: 'pair', code: '000000', deviceName: 'جهاز-1' } as never)
    expect(last().op).toBe('error')

    host.handle(id, { op: 'pair', code: CODE, deviceName: 'جهاز-1' } as never)
    expect(last().message).toMatch(/مغلق مؤقتاً/)

    now.t += PAIR_LOCK_MS + 1
    host.handle(id, { op: 'pair', code: CODE, deviceName: 'جهاز-1' } as never)
    expect(last().op).toBe('paired')
  })

  it('محاولة صحيحة قبل بلوغ الحد تُصفّر العداد', () => {
    const now = { t: 5 }
    const { host, id, last } = harness(now)
    for (let i = 0; i < PAIR_MAX_FAILURES - 1; i++) host.handle(id, { op: 'pair', code: '111111', deviceName: 'x' } as never)
    host.handle(id, { op: 'pair', code: CODE, deviceName: 'x' } as never)
    expect(last().op).toBe('paired')
    // بعد الاقتران الناجح تبدأ العدادات من جديد: أربع محاولات خاطئة لا تقفل
    for (let i = 0; i < PAIR_MAX_FAILURES - 1; i++) host.handle(id, { op: 'pair', code: '111111', deviceName: 'x' } as never)
    host.handle(id, { op: 'pair', code: CODE, deviceName: 'x' } as never)
    expect(last().op).toBe('paired')
  })

  it('الحد الافتراضي للقفل معقول: 5 محاولات و10 دقائق', () => {
    expect(PAIR_MAX_FAILURES).toBe(5)
    expect(PAIR_LOCK_MS).toBe(600_000)
  })
})

describe('② مقارنة الرمز', () => {
  it('تقبل الرمز المطابق وترفض غير المطابق والطول المختلف وغير النصي', () => {
    expect(pairingCodesMatch(CODE, CODE)).toBe(true)
    expect(pairingCodesMatch('482912', CODE)).toBe(false)
    expect(pairingCodesMatch('4829', CODE)).toBe(false)
    expect(pairingCodesMatch(482913, CODE)).toBe(false)
    expect(pairingCodesMatch(undefined, CODE)).toBe(false)
    expect(pairingCodesMatch('', CODE)).toBe(false)
  })
})

describe('③ الدوال الإدارية ممنوعة عبر الشبكة', () => {
  it('كل الدوال الإدارية المعروفة مدرجة في قائمة المنع', () => {
    for (const fn of ['addAppUser', 'updateAppUser', 'removeAppUser', 'setOwnerPin', 'setRolePermissions', 'setUserPermExceptions', 'setCurrentUser', 'resolvePinReset', 'addBranch', 'migrate']) {
      expect(LAN_FORBIDDEN_FNS.has(fn)).toBe(true)
    }
  })

  it('اعتماد المدير بالـPIN متاح عن بُعد عمداً (قرار المالك)', () => {
    expect(LAN_FORBIDDEN_FNS.has('approveByPin')).toBe(false)
  })

  it('جهاز مقترن ومسجّل دخوله لا ينفّذ addAppUser، والمتجر لا يُستدعى', async () => {
    const now = { t: 10 }
    const { host, id, store, last } = harness(now)
    host.handle(id, { op: 'pair', code: CODE, deviceName: 'جهاز-1' } as never)
    host.handle(id, { op: 'hello', token: 'token-1', deviceName: 'جهاز-1' } as never)
    host.handle(id, { op: 'call', id: 1, fn: 'login', args: [1, '1234'] } as never)
    await tick()
    host.handle(id, { op: 'call', id: 2, fn: 'addAppUser', args: [{ nameAr: 'مدير خفي', role: 'owner' }] } as never)
    await tick()
    expect(last().op).toBe('result')
    expect(last().ok).toBe(false)
    expect(last().error).toMatch(/جهاز المالك مباشرة/)
    expect(store.state.addAppUser).not.toHaveBeenCalled()
  })

  it('الدوال العادية (البيع) تبقى متاحة بعد تسجيل الدخول', async () => {
    const now = { t: 20 }
    const { host, id, store, last } = harness(now)
    host.handle(id, { op: 'pair', code: CODE, deviceName: 'جهاز-1' } as never)
    host.handle(id, { op: 'hello', token: 'token-1', deviceName: 'جهاز-1' } as never)
    host.handle(id, { op: 'call', id: 1, fn: 'login', args: [1, '1234'] } as never)
    await tick()
    host.handle(id, { op: 'call', id: 2, fn: 'postSale', args: [{ total: 10 }] } as never)
    await tick()
    expect(last().ok).toBe(true)
    expect(store.state.postSale).toHaveBeenCalledTimes(1)
  })
})
