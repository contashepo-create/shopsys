/**
 * المواعيد والحجوزات (سد الفجوة العالمية 1 — نمط Fresha/Booksy/CleanCloud):
 * يوم واحد في كل مرة: قائمة مواعيده بالساعة، إضافة/تعديل بحوار، حالات
 * (محجوز ← تم/لم يحضر/ملغى)، تحذير التداخل الزمني (لا منع — تعدد الكراسي
 * والفنيين)، وتنبيه أرقام اليوم.
 *
 * صراحة محاسبية: الموعد وعد تشغيلي — لا قيد عند الحجز ولا عند الحالة «تم»؛
 * المال يُسجل عند البيع الفعلي (كاشير/أمر مغسلة/طلب معمل).
 */
import { useMemo, useState } from 'react'
import { Plus, ChevronRight, ChevronLeft, CheckCircle2, XCircle, UserX, Pencil, Trash2, AlertTriangle, Copy } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLE, bookingsForDate, bookingDayStats, bookingConflicts, validateBooking, type Booking } from '../../core/booking.ts'
import { Btn, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

const todayIso = () => new Date().toISOString().slice(0, 10)
const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const arabicDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })

type Draft = Pick<Booking, 'customerName' | 'phone' | 'serviceName' | 'date' | 'time' | 'durationMin' | 'notes'>

export function BookingsPage() {
  const { bookings, addBooking, updateBooking, setBookingStatus, deleteBooking } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const [day, setDay] = useState(todayIso())
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<(Draft & { id?: number; allowConflict?: boolean }) | null>(null)

  const dayList = useMemo(() => {
    const list = bookingsForDate(bookings, day)
    const q = query.trim()
    return q ? list.filter((b) => b.customerName.includes(q) || b.phone.includes(q) || b.serviceName.includes(q)) : list
  }, [bookings, day, query])
  const stats = bookingDayStats(bookings, day)
  const conflicts = useMemo(
    () => (draft && validateBooking(draft).length === 0 ? bookingConflicts(bookings, draft, draft.id) : []),
    [bookings, draft],
  )

  const openNew = () => setDraft({ customerName: '', phone: '', serviceName: '', date: day, time: '10:00', durationMin: 30, notes: '' })
  const save = () => {
    if (!draft) return
    const errors = validateBooking(draft)
    if (errors.length) { toast.show(errors[0], 'error'); return }
    if (draft.id != null) {
      const res = updateBooking(draft.id, draft)
      toast.show(res.conflicts.length && !draft.allowConflict ? `حُفظ التعديل — تنبيه: يتداخل مع ${res.conflicts.length} موعداً بنفس الوقت` : 'حُفظ تعديل الموعد ✓')
      setDraft(null)
      return
    }
    const res = addBooking({ ...draft, itemId: null })
    if (res.booking.id === -1) {
      if (!draft.allowConflict) { setDraft({ ...draft, allowConflict: true }); return } // أول مرة: أظهر التحذير
    }
    toast.show('حُجز الموعد ✓')
    setDraft(null)
  }

  return (
    <div className="space-y-4">
      {/* رأس الصفحة: تنقل الأيام + إحصاءات */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Btn variant="ghost" onClick={() => setDay(shiftDate(day, -1))}><ChevronRight size={16} /></Btn>
          <button onClick={() => setDay(todayIso())} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-extrabold text-slate-700 dark:text-white text-[13px] hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            {day === todayIso() ? 'اليوم' : 'الانتقال لليوم'}
          </button>
          <Btn variant="ghost" onClick={() => setDay(shiftDate(day, 1))}><ChevronLeft size={16} /></Btn>
          <div className="font-extrabold text-slate-800 dark:text-white text-[14px]">{arabicDay(day)}</div>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value || day)} className={`${inputCls} !w-36 text-[12px]`} dir="ltr" />
        </div>
        <Btn variant="primary" onClick={openNew}><Plus size={15} /> حجز موعد</Btn>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="محجوز" value={stats.scheduled} cls="text-sky-600" />
        <Stat label="تم" value={stats.done} cls="text-emerald-600" />
        <Stat label="ملغى" value={stats.cancelled} cls="text-rose-500" />
        <Stat label="لم يحضر" value={stats.noShow} cls="text-amber-600" />
      </div>

      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث بالاسم أو الهاتف أو الخدمة…" className={`${inputCls} !w-full`} />

      {/* قائمة اليوم */}
      {dayList.length === 0 ? (
        <EmptyState icon="📅" title="لا مواعيد في هذا اليوم" sub={day === todayIso() ? 'اضغط «حجز موعد» لإضافة أول موعد اليوم' : 'اختر يوماً آخر أو أضف موعداً لهذا اليوم'} />
      ) : (
        <div className="space-y-2">
          {dayList.map((b) => (
            <div key={b.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border-2 p-3.5 ${b.status === 'cancelled' || b.status === 'no_show' ? 'border-slate-200 dark:border-slate-700 opacity-60' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="text-center min-w-[64px]">
                <div className="font-black text-[15px] text-slate-800 dark:text-white" dir="ltr">{b.time}</div>
                <div className="text-[10px] text-slate-400">{b.durationMin} دقيقة</div>
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[13px] text-slate-800 dark:text-white">{b.customerName}</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${BOOKING_STATUS_STYLE[b.status]}`}>{BOOKING_STATUS_LABELS[b.status]}</span>
                  {b.phone && (
                    <button
                      title="نسخ رقم الهاتف"
                      onClick={() => { void navigator.clipboard.writeText(b.phone).then(() => toast.show('نُسخ الرقم 📋')).catch(() => toast.show(b.phone)) }}
                      className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                      dir="ltr"
                    ><Copy size={11} /> {b.phone}</button>
                  )}
                </div>
                <div className="text-[12px] text-slate-500 dark:text-slate-400">✂️ {b.serviceName}{b.notes ? ` — ${b.notes}` : ''}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {b.status === 'scheduled' && (
                  <>
                    <Btn variant="ghost" onClick={() => setBookingStatus(b.id, 'done')}><CheckCircle2 size={14} className="text-emerald-600" /> تم</Btn>
                    <Btn variant="ghost" onClick={() => setBookingStatus(b.id, 'no_show')}><UserX size={14} className="text-amber-600" /> لم يحضر</Btn>
                    <Btn variant="ghost" onClick={() => setBookingStatus(b.id, 'cancelled')}><XCircle size={14} className="text-rose-500" /> إلغاء</Btn>
                  </>
                )}
                <Btn variant="ghost" onClick={() => setDraft({ customerName: b.customerName, phone: b.phone, serviceName: b.serviceName, date: b.date, time: b.time, durationMin: b.durationMin, notes: b.notes, id: b.id })}><Pencil size={14} /></Btn>
                <Btn variant="ghost" onClick={() => { deleteBooking(b.id); toast.show('حُذف الموعد') }}><Trash2 size={14} className="text-rose-500" /></Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-slate-400 leading-relaxed">
        💡 الموعد وعد تشغيلي لا يلمس الدفاتر — عند حضور العميل سجّل بيعه من الكاشير (أو أمر الغسيل/طلب التحليل) كالمعتاد.
        المواعيد القادمة تظهر هنا حسب وحدة «{useAppStore.getState().setup.modules.includes('booking') ? 'المواعيد والحجوزات' : ''}» لنشاط{setup.activityId ?? ''}.
      </div>

      {/* حوار الإضافة/التعديل */}
      <Modal open={draft != null} onClose={() => setDraft(null)} title={draft?.id != null ? 'تعديل موعد' : 'حجز موعد جديد'} subtitle="بيانات الموعد — الاسم والخدمة والتاريخ والوقت">
        {draft && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LabeledInput label="اسم العميل *" value={draft.customerName} onChange={(v) => setDraft({ ...draft, customerName: v })} placeholder="مثال: أحمد محمود" />
              <LabeledInput label="رقم الهاتف" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} placeholder="01xxxxxxxxx" ltr />
              <LabeledInput label="الخدمة *" value={draft.serviceName} onChange={(v) => setDraft({ ...draft, serviceName: v })} placeholder="مثال: قص وشور / تحليل صورة دم كاملة / غسيل بدلة" />
              <div>
                <div className="text-[11px] font-bold text-slate-500 mb-1">المدة (دقيقة)</div>
                <input type="number" min={5} max={480} step={5} value={draft.durationMin} onChange={(e) => setDraft({ ...draft, durationMin: Number(e.target.value) || 30 })} className={`${inputCls} !w-full`} dir="ltr" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 mb-1">التاريخ *</div>
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${inputCls} !w-full`} dir="ltr" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 mb-1">الوقت *</div>
                <input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={`${inputCls} !w-full`} dir="ltr" />
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1">ملاحظات</div>
              <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} className={`${inputCls} !w-full`} placeholder="مثال: يفضل الفني خالد" />
            </div>
            {conflicts.length > 0 && (
              <div className={`rounded-xl border-2 p-3 space-y-1 ${draft.allowConflict ? 'border-amber-400 bg-amber-500/[0.06]' : 'border-amber-400 bg-amber-500/[0.1]'}`}>
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-amber-700 dark:text-amber-400"><AlertTriangle size={14} /> تداخل زمني مع موعد آخر</div>
                <div className="text-[11.5px] text-slate-600 dark:text-slate-300">
                  {conflicts.map((c) => `${c.time} — ${c.customerName}`).join(' · ')} — إن كان لديك أكثر من كرسي/فني فالتداخل مقبول عادة.
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => setDraft(null)}>إلغاء</Btn>
              <Btn variant="primary" onClick={save}>
                {conflicts.length > 0 && !draft.allowConflict ? 'متابعة رغم التداخل…' : draft.id != null ? 'حفظ التعديل' : 'حجز'}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-2xl bg-slate-100/70 dark:bg-slate-800/60 p-3 text-center">
      <div className={`text-[20px] font-black ${cls}`}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

function LabeledInput({ label, value, onChange, placeholder, ltr }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; ltr?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-slate-500 mb-1">{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputCls} !w-full`} dir={ltr ? 'ltr' : undefined} />
    </div>
  )
}
