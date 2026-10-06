/**
 * جولة v1.0.11 — سد الفجوات العالمية 1 و3 (والفجوتان 2 و4 كانتا مسدودتين أصلاً):
 *   ① المواعيد والحجوزات (نمط Fresha/Booksy) — النواة النقية + المتجر
 *   ② إشعار حالة تذكرة الصيانة عبر واتساب (نمط RepairShopr) — بناء الرسالة والرابط
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { validateBooking, bookingsForDate, bookingConflicts, bookingDayStats, BOOKING_STATUS_LABELS } = await import('../src/core/booking.ts')
const { buildTicketStatusMessage, ticketWhatsappLink, TICKET_STATUS_LABELS } = await import('../src/core/maintenance.ts')

describe('الفجوة ① — المواعيد والحجوزات (booking)', () => {
  const base = { customerName: 'محمود علي', phone: '01000000000', serviceName: 'قص وشور', date: '2026-10-06', time: '10:00', durationMin: 30, notes: '' }

  it('تحقق صارم: اسم وتاريخ ووقت ومدة — ورفض الصيغ الفاسدة', () => {
    expect(validateBooking(base)).toEqual([])
    expect(validateBooking({ ...base, customerName: '  ' })).toContain('اسم العميل مطلوب')
    expect(validateBooking({ ...base, date: '06-10-2026' })).toContain('تاريخ الموعد غير صالح')
    expect(validateBooking({ ...base, time: '25:00' })).toContain('وقت الموعد غير صالح (HH:MM)')
    expect(validateBooking({ ...base, durationMin: 2 })).toContain('المدة بين 5 و480 دقيقة')
  })

  it('قائمة اليوم مرتبة بالوقت والإحصاءات صحيحة بكل حالة', () => {
    const list = [
      { ...base, id: 1, time: '14:00', status: 'scheduled' as const, createdAt: '' },
      { ...base, id: 2, time: '09:30', status: 'done' as const, createdAt: '' },
      { ...base, id: 3, time: '11:00', status: 'no_show' as const, createdAt: '' },
      { ...base, id: 4, time: '16:00', status: 'cancelled' as const, createdAt: '' },
      { ...base, id: 5, date: '2026-10-07', time: '10:00', status: 'scheduled' as const, createdAt: '' }, // يوم آخر
    ]
    const day = bookingsForDate(list, '2026-10-06')
    expect(day.map((b) => b.time)).toEqual(['09:30', '11:00', '14:00', '16:00'])
    const stats = bookingDayStats(list, '2026-10-06')
    expect(stats).toEqual({ scheduled: 1, done: 1, cancelled: 1, noShow: 1 })
    expect(BOOKING_STATUS_LABELS.no_show).toBe('لم يحضر')
  })

  it('كشف التداخل الزمني: يتقاطع جزئياً = تعارض، وبعده مباشرة = لا تعارض، والملغى لا يحجب', () => {
    const existing = [
      { ...base, id: 1, time: '10:00', durationMin: 60, status: 'scheduled' as const, createdAt: '' },
      { ...base, id: 2, time: '15:00', durationMin: 30, status: 'cancelled' as const, createdAt: '' },
    ]
    expect(bookingConflicts(existing, { date: base.date, time: '10:30', durationMin: 30 })).toHaveLength(1) // تداخل جزئي
    expect(bookingConflicts(existing, { date: base.date, time: '11:00', durationMin: 30 })).toHaveLength(0) // بعد نهايته مباشرة
    expect(bookingConflicts(existing, { date: base.date, time: '15:00', durationMin: 30 })).toHaveLength(0) // الملغى لا يعيق
    expect(bookingConflicts(existing, { date: '2026-10-07', time: '10:00', durationMin: 30 })).toHaveLength(0) // يوم آخر
  })

  it('المتجر: إضافة موعد وحالاته وحذفه — وتحذير التعارض قبل القبول الصريح', async () => {
    const { useDataStore } = await import('../src/data/repo.ts')
    const S = () => useDataStore.getState()
    // تعارض: أول إضافة تعاد بلا تسجيل (id=-1) حتى allowConflict
    const first = S().addBooking({ ...base, itemId: null })
    expect(first.booking.id).toBeGreaterThanOrEqual(0)
    const clash = S().addBooking({ ...base, itemId: null, customerName: 'عميل آخر', time: '10:15', durationMin: 15 })
    expect(clash.booking.id).toBe(-1)
    expect(clash.conflicts).toHaveLength(1)
    const forced = S().addBooking({ ...base, itemId: null, customerName: 'عميل آخر', time: '10:15', durationMin: 15, allowConflict: true })
    expect(forced.booking.id).toBeGreaterThan(first.booking.id)
    // الحالات والتعديل والحذف
    S().setBookingStatus(forced.booking.id, 'done')
    expect(S().bookings.find((b) => b.id === forced.booking.id)?.status).toBe('done')
    S().updateBooking(first.booking.id, { time: '12:00' })
    expect(S().bookings.find((b) => b.id === first.booking.id)?.time).toBe('12:00')
    S().deleteBooking(forced.booking.id)
    expect(S().bookings.some((b) => b.id === forced.booking.id)).toBe(false)
  })
})

describe('الفجوة ③ — إشعار حالة التذكرة عبر واتساب', () => {
  const ticket = { ticketNumber: 'MT-0001', customerName: 'سيد إبراهيم', deviceName: 'آيفون 12', status: 'ready' as const, estimateMinor: 150000, promisedAt: '2026-10-06T17:00:00.000Z' }

  it('رسالة عربية مهذبة لكل حالة — الاسم والجهاز والرقم والتقدير والموعد', () => {
    const msg = buildTicketStatusMessage(ticket, 'موبايلات النور')
    expect(msg).toContain('سيد إبراهيم')
    expect(msg).toContain('آيفون 12')
    expect(msg).toContain('MT-0001')
    expect(msg).toContain('جاهز للتسليم')
    expect(msg).toContain('1,500 ج.م')
    expect(msg).toContain('موبايلات النور')
    // حالة الاستلام: بلا «جاهز» وبالتقدير
    const received = buildTicketStatusMessage({ ...ticket, status: 'received' }, 'موبايلات النور')
    expect(received).toContain('استلمنا جهازك')
    expect(received).toContain('سنبلغك بأي مستجد')
  })

  it('رابط واتساب: رقم مصري يتحول للصيغة الدولية والرسالة مرمّزة', () => {
    const link = ticketWhatsappLink('01012345678', 'جاهز للتسليم')
    expect(link).toContain('https://wa.me/201012345678?text=')
    expect(decodeURIComponent(link.split('text=')[1])).toBe('جاهز للتسليم')
    // رقم دولي مباشر بلا صفر بادئ
    expect(ticketWhatsappLink('+966501234567', 'مرحبا')).toContain('wa.me/966501234567')
    expect(TICKET_STATUS_LABELS.ready).toBe('جاهزة للتسليم')
  })
})
