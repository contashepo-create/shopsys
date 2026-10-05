/**
 * المواعيد والحجوزات (سد الفجوة العالمية رقم 1 — نمط Fresha/Booksy/CleanCloud):
 * وحدة موحدة تخدم الصالون والمعمل والمغسلة وأي نشاط بخدمات موعودة.
 *
 * المبدأ المحاسبي (صراحة كاملة): الموعد وعد تشغيلي لا يلمس الدفاتر —
 * لا قيد عند الحجز ولا عند الحالة «تم». المال يُسجل عند البيع الفعلي
 * (كاشير/أمر مغسلة/طلب معمل) كما هو الحال في Fresha (الدفع منفصل عن الحجز).
 *
 * النموذج مقصود التبسيط: اسم + هاتف + خدمة (صنف اختياري أو نص) + يوم ووقت
 * ومدة وحالة. التداخل الزمني يُكشف ويُحذَّر به ولا يُمنع (صالون بأكثر من
 * كرسي/فني يسمح بتزامن موعدين — القرار للمستخدم).
 */
export type BookingStatus = 'scheduled' | 'done' | 'cancelled' | 'no_show'

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: 'محجوز',
  done: 'تم',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
}

export const BOOKING_STATUS_STYLE: Record<BookingStatus, string> = {
  scheduled: 'bg-sky-500/10 text-sky-600',
  done: 'bg-emerald-500/10 text-emerald-600',
  cancelled: 'bg-rose-500/10 text-rose-500',
  no_show: 'bg-amber-500/10 text-amber-600',
}

export interface Booking {
  id: number
  customerName: string
  phone: string
  /** خدمة من الأصناف (اختياري — قد تكون خدمة حرة غير مقيّدة بصنف) */
  itemId: number | null
  serviceName: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  durationMin: number
  status: BookingStatus
  notes: string
  createdAt: string
}

export function validateBooking(b: Pick<Booking, 'customerName' | 'date' | 'time' | 'durationMin'>): string[] {
  const errors: string[] = []
  if (!b.customerName.trim()) errors.push('اسم العميل مطلوب')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errors.push('تاريخ الموعد غير صالح')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time)) errors.push('وقت الموعد غير صالح (HH:MM)')
  if (!Number.isInteger(b.durationMin) || b.durationMin < 5 || b.durationMin > 480) errors.push('المدة بين 5 و480 دقيقة')
  return errors
}

export function bookingsForDate(list: readonly Booking[], date: string): Booking[] {
  return list.filter((b) => b.date === date).sort((a, b) => a.time.localeCompare(b.time))
}

function endMinutes(b: Pick<Booking, 'time' | 'durationMin'>): number {
  const [h, m] = b.time.split(':').map(Number)
  return h * 60 + m + b.durationMin
}

/** المواعيد المحجوزة المتداخلة زمنياً مع مرشح — للتحذير عند الإضافة (لا منع) */
export function bookingConflicts(list: readonly Booking[], candidate: Pick<Booking, 'date' | 'time' | 'durationMin'>, excludeId?: number): Booking[] {
  const [ch, cm] = candidate.time.split(':').map(Number)
  const start = ch * 60 + cm
  const end = endMinutes(candidate)
  return list.filter((b) => b.date === candidate.date && b.status === 'scheduled' && b.id !== excludeId && (b.time === candidate.time
    || (start < endMinutes(b) && end > (Number(b.time.split(':')[0]) * 60 + Number(b.time.split(':')[1])))))
}

/** إحصاء يوم واحد — لبطاقة رأس الصفحة */
export function bookingDayStats(list: readonly Booking[], date: string): { scheduled: number; done: number; cancelled: number; noShow: number } {
  const day = bookingsForDate(list, date)
  return {
    scheduled: day.filter((b) => b.status === 'scheduled').length,
    done: day.filter((b) => b.status === 'done').length,
    cancelled: day.filter((b) => b.status === 'cancelled').length,
    noShow: day.filter((b) => b.status === 'no_show').length,
  }
}
