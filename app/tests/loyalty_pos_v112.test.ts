/**
 * جولة v1.0.12 — تنفيذ الاقتراحات بالترتيب (1-3):
 *   ① الولاء في الكاشير: سقف استبدال للعملية + نقاط العميل وكسبه المعروضان
 *   ② بطاقة مواعيد اليوم في الداشبورد (تغطيتها نصياً في بوابة الجولة)
 *   ③ تذكيرات واتساب الجماعية من صفحة المواعيد
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { earnedPoints, validateRedeem, DEFAULT_LOYALTY, redeemValue } = await import('../src/core/loyalty.ts')
const { buildBookingReminderMessage, bookingWhatsappLink } = await import('../src/core/booking.ts')

describe('① الولاء — السقف الجديد والكسب', () => {
  it('سقف الاستبدال للعملية الواحدة: يرفض التجاوز ويسمح عند 0 (بلا سقف)', () => {
    const s = { ...DEFAULT_LOYALTY, enabled: true, minRedeemPoints: 100, maxRedeemPoints: 500 }
    expect(validateRedeem({ requestedPoints: 500, customerPoints: 900, settings: s })).toEqual([])
    expect(validateRedeem({ requestedPoints: 501, customerPoints: 900, settings: s })).toContain('سقف الاستبدال في العملية الواحدة 500 نقطة')
    expect(validateRedeem({ requestedPoints: 900, customerPoints: 900, settings: { ...s, maxRedeemPoints: 0 } })).toEqual([]) // 0 = بلا سقف
  })

  it('الكسب كما في Lightspeed: نقطة لكل وحدة عملة كاملة — تقريب لأسفل', () => {
    const s = { ...DEFAULT_LOYALTY, enabled: true, pointsPerUnit: 1 }
    expect(earnedPoints(10000, 2, s)).toBe(100) // 100 ج.م
    expect(earnedPoints(10999, 2, s)).toBe(109) // لا أنصاف نقاط
    expect(earnedPoints(10000, 2, { ...s, enabled: false })).toBe(0) // البرنامج معطل
    expect(redeemValue(100, s)).toBe(500) // 100 نقطة × 5 قروش = 5 ج.م
  })
})

describe('③ تذكير المواعيد عبر واتساب', () => {
  it('رسالة تذكير عربية بالاسم والخدمة واليوم والوقت + رابط صحيح بتحويل الرقم', () => {
    const msg = buildBookingReminderMessage({ customerName: 'كريم سامي', serviceName: 'قص وشور', date: '2026-10-07', time: '17:30' }, 'صالون الأناقة')
    expect(msg).toContain('كريم سامي')
    expect(msg).toContain('2026-10-07')
    expect(msg).toContain('17:30')
    expect(msg).toContain('قص وشور')
    expect(msg).toContain('صالون الأناقة')
    const link = bookingWhatsappLink('01098765432', msg)
    expect(link).toContain('https://wa.me/201098765432?text=')
    expect(decodeURIComponent(link.split('text=')[1])).toBe(msg)
  })
})
