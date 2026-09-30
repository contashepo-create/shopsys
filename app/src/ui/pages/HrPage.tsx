/**
 * شؤون الموظفين — قسم مستقل بتابات داخلية (طلب المالك ㉘).
 * ─────────────────────────────────────────────────────────────
 * «نظام تتبع ذكي» لإدارة القسم بالكامل من مكان واحد:
 *   • الحضور اليومي     : شبكة شهرية (موظف × يوم) بحالات ملوّنة + دخول/خروج.
 *   • استيراد البصمة    : رفع CSV من جهاز البصمة، مطابقة، معاينة، ثم اعتماد.
 *   • الإجازات          : طلب ⇐ اعتماد/رفض ⇐ أرصدة + تقويم الفريق.
 *   • الورديات والقواعد : وردية المنشأة وورديات خاصة، وخصومات وأجر إضافي.
 *   • التقارير          : كشف شهري شامل + أثر الرواتب + طباعة وتصدير.
 *
 * التصميم يتماشى مع لغة التطبيق (بطاقات rounded-2xl · ألوان الأقسام · RTL).
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CalendarCheck2, ClipboardPaste, FileDown, Fingerprint,
  Printer, Settings2, Users, CheckCircle2, Trash2, Plus, CalendarRange,
} from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { partyCode } from '../../core/partyCodes.ts'
import {
  ATTENDANCE_STATUSES, ATTENDANCE_STATUS_AR, ATTENDANCE_STATUS_TONE,
  MONTHS_DAYS_AR, dayMetrics, formatClock, leaveDates, matchImportRows, monthDates, parseClock,
  parseFingerprintCsv, weekdayIndex,
  type AttendanceStatus, type FingerprintRow,
} from '../../core/attendance.ts'
import { monthLabelAr } from '../../core/payroll.ts'
import { Btn, Field, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'
import { printHtml } from '../print/printReceipt.ts'

export const HR_TABS = [
  { id: 'attendance', nameAr: 'الحضور والانصراف', icon: CalendarCheck2, path: '/hr/attendance' },
  { id: 'fingerprint', nameAr: 'استيراد البصمة', icon: Fingerprint, path: '/hr/fingerprint' },
  { id: 'leaves', nameAr: 'الإجازات', icon: CalendarRange, path: '/hr/leaves' },
  { id: 'shifts', nameAr: 'الورديات والقواعد', icon: Settings2, path: '/hr/shifts' },
  { id: 'reports', nameAr: 'تقارير الموارد البشرية', icon: FileDown, path: '/hr/reports' },
] as const

export type HrTabId = (typeof HR_TABS)[number]['id']

/** شريط التابات المشترك — يُستعمل من صفحات شؤون الموظفين كافة */
export function HrSectionTabs({ active }: { active: HrTabId }) {
  const nav = useNavigate()
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-card-dark" role="tablist" data-hr-tabs>
      {HR_TABS.map((tab) => {
        const Icon = tab.icon
        const on = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => nav(tab.path)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-bold transition-all ${
              on
                ? 'bg-teal-500/15 text-teal-700 shadow-sm ring-1 ring-teal-500/30 dark:text-teal-300'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Icon size={14} /> {tab.nameAr}
          </button>
        )
      })}
      <button
        type="button"
        role="tab"
        aria-selected={false}
        onClick={() => nav('/parties/employees')}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-bold text-violet-600 transition-all hover:bg-violet-500/10 dark:text-violet-300"
      >
        <Users size={14} /> الموظفون والرواتب
      </button>
    </div>
  )
}

export function HrPage() {
  const { tab = 'attendance' } = useParams<{ tab?: string }>()
  const active = (HR_TABS.some((t) => t.id === tab) ? tab : 'attendance') as HrTabId
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-slate-800 dark:text-slate-100">شؤون الموظفين — تتبع ذكي للحضور والإجازات</h1>
          <p className="text-[12px] text-slate-500">قسم مستقل يدير الحضور والانصراف والبصمة والإجازات والورديات وربطها بالرواتب — بلا خصم صامت.</p>
        </div>
      </header>
      <HrSectionTabs active={active} />
      {active === 'attendance' && <AttendanceTab />}
      {active === 'fingerprint' && <FingerprintTab />}
      {active === 'leaves' && <LeavesTab />}
      {active === 'shifts' && <ShiftsTab />}
      {active === 'reports' && <HrReportsTab />}
    </div>
  )
}

/* ═══════════════════ 1) الحضور اليومي ═══════════════════ */

function AttendanceTab() {
  const { employees, attendanceRecords, leaveRequests, hrRules, employeeShifts, setAttendanceDay, clearAttendanceDay } = useDataStore()
  const toast = useToast()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [selected, setSelected] = useState<{ employeeId: number; date: string } | null>(null)
  const [dayStatus, setDayStatus] = useState<AttendanceStatus>('present')
  const [dayIn, setDayIn] = useState('')
  const [dayOut, setDayOut] = useState('')
  const [dayNotes, setDayNotes] = useState('')

  const active = useMemo(() => employees.filter((e) => e.active), [employees])
  const dates = useMemo(() => monthDates(month), [month])
  const byKey = useMemo(() => {
    const map = new Map<string, typeof attendanceRecords[number]>()
    for (const r of attendanceRecords) map.set(`${r.employeeId}|${r.date}`, r)
    return map
  }, [attendanceRecords])
  const today = new Date().toISOString().slice(0, 10)

  const openDay = (employeeId: number, date: string) => {
    const existing = byKey.get(`${employeeId}|${date}`)
    setSelected({ employeeId, date })
    setDayStatus(existing?.status ?? 'present')
    setDayIn(existing?.checkIn ?? '')
    setDayOut(existing?.checkOut ?? '')
    setDayNotes(existing?.notes ?? '')
  }

  const saveDay = () => {
    if (!selected) return
    try {
      if (dayIn && parseClock(dayIn) == null) throw new Error('صيغة الدخول غير سليمة — استعمل HH:MM مثل 08:45')
      if (dayOut && parseClock(dayOut) == null) throw new Error('صيغة الخروج غير سليمة — استعمل HH:MM مثل 17:30')
      setAttendanceDay({ employeeId: selected.employeeId, date: selected.date, status: dayStatus, checkIn: dayIn || null, checkOut: dayOut || null, notes: dayNotes.trim() || undefined })
      toast.show('سُجّل حضور اليوم ✓')
      setSelected(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const shiftFor = (employeeId: number) => employeeShifts.find((s) => s.employeeId === employeeId) ?? hrRules.shift

  /* ملخص الشهر لكل موظف */
  const monthStats = useMemo(() => active.map((employee) => {
    let late = 0, ot = 0
    const counts = { present: 0, absent: 0, leave: 0, permission: 0, holiday: 0, mission: 0 } as Record<AttendanceStatus, number>
    for (const date of dates) {
      const record = byKey.get(`${employee.id}|${date}`)
      if (!record) continue
      counts[record.status] += 1
      const m = dayMetrics(record, { ...hrRules, shift: shiftFor(employee.id) })
      late += m.lateMinutes
      ot += m.overtimeMinutes
    }
    return { employee, counts, late, ot }
  }), [active, dates, byKey, hrRules, employeeShifts])

  const todayStats = useMemo(() => {
    const counts = { present: 0, absent: 0, leave: 0, none: 0 }
    for (const employee of active) {
      const record = byKey.get(`${employee.id}|${today}`)
      if (!record) counts.none += 1
      else counts[record.status as keyof typeof counts] = (counts[record.status as keyof typeof counts] ?? 0) + 1
    }
    return counts
  }, [active, byKey, today])

  if (!active.length) return <EmptyState icon="🧑‍💼" title="لا موظفين بعد" sub="أضف الموظفين من قسم «الموظفون» ثم عد لتسجيل الحضور." />

  return (
    <div className="space-y-4" data-hr-attendance>
      {/* بطاقات مؤشرات اليوم */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="على رأس العمل" value={active.length} tone="violet" />
        <KpiCard label={`حاضر اليوم (${todayStats.present})`} value={todayStats.present} tone="emerald" />
        <KpiCard label={`غياب اليوم (${todayStats.absent})`} value={todayStats.absent} tone="rose" />
        <KpiCard label={`إجازة اليوم (${todayStats.leave})`} value={todayStats.leave} tone="sky" />
        <KpiCard label="إجازات بانتظار الاعتماد" value={leaveRequests.filter((l) => l.status === 'pending').length} tone="amber" />
      </div>

      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">شبكة الحضور الشهرية — {monthLabelAr(month)}</h3>
          <div className="flex items-center gap-2">
            <input type="month" className={inputCls + ' w-40'} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="شهر الحضور" />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">انقر خلية اليوم لتسجيل الحالة والدخول/الخروج — الألوان: أخضر حاضر · أحمر غياب · أزرق إجازة · كهرماني إذن · رمادي عطلة · بنفسجي مأمورية.</p>

        <div className="mt-3 overflow-x-auto" dir="rtl">
          <table className="w-full min-w-max text-[11.5px]" data-attendance-grid>
            <thead>
              <tr className="text-slate-500">
                <th className="sticky right-0 z-10 bg-white px-2 py-1 text-right dark:bg-card-dark">الموظف</th>
                {dates.map((date) => (
                  <th key={date} className={`px-1 py-1 text-center font-bold ${date === today ? 'text-teal-600 dark:text-teal-400' : weekdayIndex(date) === 5 ? 'text-rose-500' : ''}`} title={`${MONTHS_DAYS_AR[weekdayIndex(date)]} ${date.slice(8)}`}>
                    {Number(date.slice(8))}
                  </th>
                ))}
                <th className="px-2 py-1 text-center" title="أيام مسجلة">◉</th>
              </tr>
            </thead>
            <tbody>
              {monthStats.map(({ employee, counts, late, ot }) => (
                <tr key={employee.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="sticky right-0 z-10 bg-white px-2 py-1 dark:bg-card-dark">
                    <div className="font-bold text-slate-700 dark:text-slate-200">{employee.nameAr}</div>
                    <div className="text-[10px] text-slate-400">{partyCode('EMP', employee.id)} · {formatClock(shiftFor(employee.id).startMin)}-{formatClock(shiftFor(employee.id).endMin)}</div>
                  </td>
                  {dates.map((date) => {
                    const record = byKey.get(`${employee.id}|${date}`)
                    const tone = record ? ATTENDANCE_STATUS_TONE[record.status] : 'bg-slate-50 text-slate-300 border-slate-100 dark:bg-slate-800/40 dark:text-slate-600'
                    const letter = record ? ATTENDANCE_STATUS_AR[record.status].charAt(0) : '·'
                    const m = record ? dayMetrics(record, { ...hrRules, shift: shiftFor(employee.id) }) : null
                    return (
                      <td key={date} className="p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => openDay(employee.id, date)}
                          title={record ? `${ATTENDANCE_STATUS_AR[record.status]}${record.checkIn ? ` — دخول ${record.checkIn}` : ''}${record.checkOut ? ` · خروج ${record.checkOut}` : ''}${m?.lateMinutes ? ` · تأخير ${m.lateMinutes}د` : ''}${m?.overtimeMinutes ? ` · إضافي ${m.overtimeMinutes}د` : ''}` : 'يوم غير مسجل — انقر للتسجيل'}
                          className={`h-6 w-6 rounded-md border text-[10px] font-black transition-transform hover:scale-110 ${tone} ${date === today ? 'ring-1 ring-teal-500/60' : ''}`}
                        >
                          {letter}
                        </button>
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-center text-[11px]">
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400" title="حاضر">{counts.present}</span>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono font-bold text-rose-600 dark:text-rose-400" title="غياب">{counts.absent}</span>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400" title="إجازة">{counts.leave}</span>
                    {late > 0 && <span className="ms-1 text-[10px] text-amber-600" title="مجموع التأخير بالدقائق">⏱{late}</span>}
                    {ot > 0 && <span className="ms-1 text-[10px] text-violet-600" title="مجموع الإضافي بالدقائق">+{ot}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ATTENDANCE_STATUSES.map((status) => (
            <span key={status} className={`rounded-md border px-2 py-0.5 text-[10.5px] font-bold ${ATTENDANCE_STATUS_TONE[status]}`}>
              {ATTENDANCE_STATUS_AR[status]} — {ATTENDANCE_STATUS_AR[status].charAt(0)}
            </span>
          ))}
        </div>
      </section>

      {/* محرر اليوم */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `حضور ${employees.find((e) => e.id === selected.employeeId)?.nameAr ?? ''} — ${selected.date}` : ''}>
        {selected && (
          <div className="space-y-3" dir="rtl" data-day-editor>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="الحالة">
                <QuickSelect className={inputCls} value={dayStatus} onChange={(e) => setDayStatus(e.target.value as AttendanceStatus)} aria-label="حالة الحضور">
                  {ATTENDANCE_STATUSES.map((status) => <option key={status} value={status}>{ATTENDANCE_STATUS_AR[status]}</option>)}
                </QuickSelect>
              </Field>
              <Field label="وقت الدخول" hint="HH:MM">
                <input className={inputCls} dir="ltr" value={dayIn} onChange={(e) => setDayIn(e.target.value)} placeholder="08:45" />
              </Field>
              <Field label="وقت الخروج" hint="HH:MM">
                <input className={inputCls} dir="ltr" value={dayOut} onChange={(e) => setDayOut(e.target.value)} placeholder="17:30" />
              </Field>
            </div>
            <Field label="ملاحظة">
              <input className={inputCls} value={dayNotes} onChange={(e) => setDayNotes(e.target.value)} placeholder="اختياري — مثال: مأمورية عند العميل" />
            </Field>
            {dayIn && dayOut && (
              <div className="rounded-lg bg-slate-50 p-2 text-[11.5px] dark:bg-slate-800/60">
                {(() => {
                  const shift = shiftFor(selected.employeeId)
                  const m = dayMetrics({ status: dayStatus, checkIn: dayIn, checkOut: dayOut }, { ...hrRules, shift })
                  return (
                    <span className="flex flex-wrap gap-3">
                      <span>عمل <b className="font-mono">{(m.workedMinutes / 60).toFixed(1)}</b> ساعة</span>
                      {m.lateMinutes > 0 && <span className="text-amber-600">تأخير <b className="font-mono">{m.lateMinutes}</b> دقيقة (بعد سماح {shift.graceMinutes}د)</span>}
                      {m.earlyLeaveMinutes > 0 && <span className="text-amber-600">انصراف مبكر <b className="font-mono">{m.earlyLeaveMinutes}</b> دقيقة</span>}
                      {m.overtimeMinutes > 0 && <span className="text-violet-600">إضافي <b className="font-mono">{(m.overtimeMinutes / 60).toFixed(1)}</b> ساعة</span>}
                      {m.lateMinutes === 0 && m.overtimeMinutes === 0 && <span className="text-emerald-600">ضمن الوردية — لا خصم ولا إضافي</span>}
                    </span>
                  )
                })()}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Btn variant="danger" onClick={() => {
                try { clearAttendanceDay(selected.employeeId, selected.date); toast.show('حُذف سجل اليوم'); setSelected(null) } catch (e) { toast.show((e as Error).message, 'error') }
              }}><span className="flex items-center gap-1.5"><Trash2 size={14} /> حذف السجل</span></Btn>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setSelected(null)}>إلغاء</Btn>
                <Btn onClick={saveDay}>حفظ اليوم</Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  }
  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${tones[tone] ?? tones.violet}`}>
      <div className="text-[11px] font-bold opacity-80">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-black">{value.toLocaleString('en-US')}</div>
    </div>
  )
}

/* ═══════════════════ 2) استيراد البصمة ═══════════════════ */

function FingerprintTab() {
  const { employees, attendanceImports, importAttendance } = useDataStore()
  const toast = useToast()
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('لصق يدوي')
  const [preview, setPreview] = useState<{ matches: { employeeId: number | null; row: FingerprintRow }[]; errors: string[] } | null>(null)
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const doParse = (text: string, name: string) => {
    const parsed = parseFingerprintCsv(text)
    const matches = matchImportRows(parsed.rows, employees.filter((e) => e.active))
    setPreview({ matches, errors: parsed.errors })
    setOverrides({})
    setFileName(name)
    const unmatched = matches.filter((m) => m.employeeId == null).length
    toast.show(`تحليل الملف: ${parsed.rows.length} صف · مطابق ${parsed.rows.length - unmatched} · غير مطابق ${unmatched}${parsed.errors.length ? ` · ${parsed.errors.length} سطر مرفوض` : ''}`)
  }

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => doParse(String(reader.result ?? ''), file.name)
    reader.readAsText(file, 'utf-8')
  }

  const commit = () => {
    if (!preview) return
    const rows = preview.matches
      .map((m, i) => ({ ...m, employeeId: m.employeeId ?? overrides[i] ?? null }))
      .filter((m): m is { employeeId: number; row: FingerprintRow } => m.employeeId != null)
      .map((m) => {
        const hasTimes = Boolean(m.row.checkIn || m.row.checkOut)
        return {
          employeeId: m.employeeId,
          date: m.row.date,
          status: (hasTimes ? 'present' : 'absent') as AttendanceStatus,
          checkIn: m.row.checkIn || null,
          checkOut: m.row.checkOut || null,
        }
      })
    if (!rows.length) return toast.show('لا صفوف مطابقة — اربط غير المطابق بموظفيه أولاً', 'error')
    try {
      const result = importAttendance({ rows, fileName, by: 'المالك' })
      toast.show(`اعتمد الاستيراد: ${result.inserted} سجل جديد + ${result.updated} تحديث ✓`)
      setPreview(null)
      setRaw('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const activeEmployees = employees.filter((e) => e.active)

  return (
    <div className="space-y-4" data-hr-fingerprint>
      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <h3 className="text-sm font-black">استيراد الحضور من جهاز البصمة (CSV / تصدير Excel بتنسيق CSV)</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          الأعمدة المفهومة تلقائياً: <b>كود أو اسم الموظف</b> · <b>التاريخ</b> (2026-09-30 أو 30/09/2026) · <b>الدخول</b> · <b>الخروج</b> —
          بلا رأس أعمدة يُفترض الترتيب: كود، تاريخ، دخول، خروج. تُدمج بصمات اليوم المكررة (أول دخول وآخر خروج).
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="md:col-span-2">
            <textarea
              className={inputCls + ' h-28 font-mono text-[11px]'}
              dir="ltr"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'EMP-0001,2026-09-30,08:52,17:35\nأحمد سعيد,30/09/2026,09:10,18:02'}
              aria-label="لصق بيانات البصمة"
              data-fingerprint-paste
            />
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} data-fingerprint-file />
            <Btn variant="soft" onClick={() => fileRef.current?.click()}><span className="flex items-center gap-1.5"><ClipboardPaste size={15} /> اختيار ملف CSV</span></Btn>
            <Btn onClick={() => doParse(raw, 'لصق يدوي')} disabled={!raw.trim()}><span className="flex items-center gap-1.5"><Fingerprint size={15} /> تحليل ومعاينة</span></Btn>
          </div>
        </div>
        {preview && (
          <div className="mt-3 space-y-2" data-fingerprint-preview>
            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                {preview.errors.slice(0, 5).map((error, i) => <div key={i}>⚠ {error}</div>)}
                {preview.errors.length > 5 && <div>…و{preview.errors.length - 5} سطر آخر مرفوض</div>}
              </div>
            )}
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-[11.5px]">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60">
                  <tr><th className="p-1.5 text-right">الموظف في الملف</th><th className="p-1.5">التاريخ</th><th className="p-1.5">دخول</th><th className="p-1.5">خروج</th><th className="p-1.5">المطابقة</th></tr>
                </thead>
                <tbody>
                  {preview.matches.map((match, i) => {
                    const employeeId = match.employeeId ?? overrides[i] ?? null
                    return (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-1.5 font-bold">{match.row.employeeKey}</td>
                        <td className="p-1.5 text-center font-mono">{match.row.date}</td>
                        <td className="p-1.5 text-center font-mono">{match.row.checkIn || '—'}</td>
                        <td className="p-1.5 text-center font-mono">{match.row.checkOut || '—'}</td>
                        <td className="p-1.5">
                          {match.employeeId != null ? (
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">✓ {employees.find((e) => e.id === match.employeeId)?.nameAr}</span>
                          ) : (
                            <QuickSelect className={inputCls + ' !py-0.5 text-[11px]'} value={employeeId ?? ''} onChange={(e) => setOverrides((o) => ({ ...o, [i]: Number(e.target.value) }))} aria-label="ربط بموظف">
                              <option value="">— اربط بموظف —</option>
                              {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.nameAr} ({partyCode('EMP', e.id)})</option>)}
                            </QuickSelect>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                الصفوف بلا أوقات دخول/خروج تُسجَّل «غياب»؛ وبها أوقات تُسجَّل «حاضر». التكرار لنفس اليوم يحدَّث السجل القائم.
              </span>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setPreview(null)}>إلغاء</Btn>
                <Btn onClick={commit}><span className="flex items-center gap-1.5"><CheckCircle2 size={15} /> اعتماد الاستيراد</span></Btn>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <h3 className="text-sm font-black">سجل عمليات الاستيراد</h3>
        {attendanceImports.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-500">لم تُستورد أي ملفات بصمة بعد.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-slate-500"><tr><th className="p-1.5 text-right">الملف</th><th className="p-1.5">التاريخ</th><th className="p-1.5">الصفوف</th><th className="p-1.5">جديد</th><th className="p-1.5">تحديث</th><th className="p-1.5">بواسطة</th></tr></thead>
              <tbody>
                {[...attendanceImports].reverse().map((imp) => (
                  <tr key={imp.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-1.5 font-bold">{imp.fileName}</td>
                    <td className="p-1.5 text-center font-mono">{imp.at.slice(0, 16).replace('T', ' ')}</td>
                    <td className="p-1.5 text-center font-mono">{imp.rows}</td>
                    <td className="p-1.5 text-center font-mono text-emerald-600">{imp.inserted}</td>
                    <td className="p-1.5 text-center font-mono text-sky-600">{imp.updated}</td>
                    <td className="p-1.5 text-center">{imp.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ═══════════════════ 3) الإجازات ═══════════════════ */

function LeavesTab() {
  const { employees, leaveRequests, leaveTypes, addLeaveRequest, decideLeaveRequest, deleteLeaveRequest, getLeaveBalances } = useDataStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState(0)
  const [typeId, setTypeId] = useState('annual')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const active = useMemo(() => employees.filter((e) => e.active), [employees])

  const submit = () => {
    try {
      addLeaveRequest({ employeeId, typeId, from, to, reason })
      toast.show('سُجّل طلب الإجازة — بانتظار الاعتماد')
      setOpen(false)
      setReason('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const pending = leaveRequests.filter((l) => l.status === 'pending')
  const history = [...leaveRequests].reverse()
  const dates = useMemo(() => monthDates(month), [month])
  const typeName = (id: string) => leaveTypes.find((t) => t.id === id)?.nameAr ?? id
  const empName = (id: number) => employees.find((e) => e.id === id)?.nameAr ?? `#${id}`
  /* تقويم الفريق: لكل يوم من الشهر — من في إجازة معتمدة */
  const calendar = useMemo(() => {
    const approved = leaveRequests.filter((l) => l.status === 'approved')
    return dates.map((date) => ({
      date,
      onLeave: approved.filter((l) => leaveDates(l).includes(date)).map((l) => ({ employee: empName(l.employeeId), type: typeName(l.typeId) })),
    }))
  }, [dates, leaveRequests, employees, leaveTypes])

  return (
    <div className="space-y-4" data-hr-leaves>
      <div className="grid gap-2 sm:grid-cols-3">
        <KpiCard label="طلبات بانتظار الاعتماد" value={pending.length} tone="amber" />
        <KpiCard label="إجازات معتمدة هذا العام" value={leaveRequests.filter((l) => l.status === 'approved' && l.from.startsWith(String(new Date().getFullYear()))).length} tone="emerald" />
        <KpiCard label="مرفوضة هذا العام" value={leaveRequests.filter((l) => l.status === 'rejected' && l.from.startsWith(String(new Date().getFullYear()))).length} tone="rose" />
      </div>

      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">طلبات الإجازات</h3>
          <Btn onClick={() => { setEmployeeId(active[0]?.id ?? 0); setOpen(true) }} disabled={!active.length}><span className="flex items-center gap-1.5"><Plus size={15} /> طلب إجازة</span></Btn>
        </div>

        {pending.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-amber-500/30">
            <table className="w-full text-[12px]">
              <thead className="bg-amber-500/10 text-amber-700 dark:text-amber-300"><tr><th className="p-1.5 text-right">الموظف</th><th className="p-1.5">النوع</th><th className="p-1.5">من</th><th className="p-1.5">إلى</th><th className="p-1.5">الأيام</th><th className="p-1.5">السبب</th><th className="p-1.5">قرار</th></tr></thead>
              <tbody>
                {pending.map((leave) => (
                  <tr key={leave.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-1.5 font-bold">{empName(leave.employeeId)}</td>
                    <td className="p-1.5 text-center">{typeName(leave.typeId)}</td>
                    <td className="p-1.5 text-center font-mono">{leave.from}</td>
                    <td className="p-1.5 text-center font-mono">{leave.to}</td>
                    <td className="p-1.5 text-center font-mono font-bold">{leave.days}</td>
                    <td className="p-1.5 text-[11px]">{leave.reason || '—'}</td>
                    <td className="p-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300" onClick={() => { try { decideLeaveRequest(leave.id, true, 'المالك'); toast.show('اعتُمدت الإجازة ووُسمت أيامها في شبكة الحضور ✓') } catch (e) { toast.show((e as Error).message, 'error') } }}>اعتماد</button>
                        <button type="button" className="rounded-lg bg-rose-500/15 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-500/25 dark:text-rose-300" onClick={() => { try { decideLeaveRequest(leave.id, false, 'المالك'); toast.show('رُفض الطلب') } catch (e) { toast.show((e as Error).message, 'error') } }}>رفض</button>
                        <button type="button" className="rounded-lg px-1.5 py-1 text-slate-400 hover:text-rose-600" title="حذف الطلب" onClick={() => { try { deleteLeaveRequest(leave.id); toast.show('حُذف الطلب') } catch (e) { toast.show((e as Error).message, 'error') } }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="text-slate-500"><tr><th className="p-1.5 text-right">الموظف</th><th className="p-1.5">النوع</th><th className="p-1.5">من</th><th className="p-1.5">إلى</th><th className="p-1.5">الأيام</th><th className="p-1.5">الحالة</th><th className="p-1.5">القرار</th></tr></thead>
              <tbody>
                {history.map((leave) => (
                  <tr key={leave.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-1.5 font-bold">{empName(leave.employeeId)}</td>
                    <td className="p-1.5 text-center">{typeName(leave.typeId)}</td>
                    <td className="p-1.5 text-center font-mono">{leave.from}</td>
                    <td className="p-1.5 text-center font-mono">{leave.to}</td>
                    <td className="p-1.5 text-center font-mono">{leave.days}</td>
                    <td className="p-1.5 text-center">
                      <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${leave.status === 'approved' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : leave.status === 'rejected' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
                        {leave.status === 'approved' ? 'معتمدة' : leave.status === 'rejected' ? 'مرفوضة' : 'معلقة'}
                      </span>
                    </td>
                    <td className="p-1.5 text-center text-[10.5px] text-slate-400">{leave.decidedBy ?? '—'}{leave.decidedAt ? ` · ${leave.decidedAt.slice(0, 10)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!history.length && <p className="mt-2 text-[12px] text-slate-500">لا طلبات إجازة بعد.</p>}
      </section>

      {/* أرصدة الإجازات */}
      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <h3 className="text-sm font-black">أرصدة الإجازات — {new Date().getFullYear()}</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-slate-500">
              <tr><th className="p-1.5 text-right">الموظف</th>{leaveTypes.map((t) => <th key={t.id} className="p-1.5">{t.nameAr}</th>)}</tr>
            </thead>
            <tbody>
              {active.map((employee) => {
                const balances = getLeaveBalances(employee.id, new Date().getFullYear())
                return (
                  <tr key={employee.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-1.5 font-bold">{employee.nameAr}</td>
                    {leaveTypes.map((type) => {
                      const row = balances.find((b) => b.typeId === type.id)
                      return (
                        <td key={type.id} className="p-1.5 text-center font-mono" title={`الرصيد ${row?.remainingDays ?? 0} من ${type.annualQuotaDays}`}>
                          <span className={(row?.remainingDays ?? 0) > 5 ? 'text-emerald-600 dark:text-emerald-400' : (row?.remainingDays ?? 0) > 0 ? 'text-amber-600' : 'text-rose-600'}>
                            {row?.usedDays ?? 0}/{type.annualQuotaDays}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* تقويم الفريق */}
      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">تقويم الفريق — {monthLabelAr(month)}</h3>
          <input type="month" className={inputCls + ' w-40'} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="شهر التقويم" />
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10.5px] sm:grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))]">
          {calendar.map(({ date, onLeave }) => (
            <div key={date} className={`rounded-lg border p-1 ${onLeave.length ? 'border-sky-500/40 bg-sky-500/10' : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40'}`} title={onLeave.map((row) => `${row.employee} — ${row.type}`).join('\n') || 'لا إجازات'}>
              <div className="font-mono font-bold text-slate-600 dark:text-slate-300">{Number(date.slice(8))}</div>
              {onLeave.length > 0 && <div className="text-[9.5px] font-bold text-sky-700 dark:text-sky-300">{onLeave.length} إجازة</div>}
            </div>
          ))}
        </div>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="طلب إجازة">
        <div className="space-y-3" dir="rtl" data-leave-form>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الموظف">
              <QuickSelect className={inputCls} value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))} aria-label="موظف الإجازة">
                {active.map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="نوع الإجازة">
              <QuickSelect className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="نوع الإجازة">
                {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.nameAr} — رصيد {getLeaveBalances(employeeId, new Date(from).getFullYear()).find((b) => b.typeId === t.id)?.remainingDays ?? 0} يوم</option>)}
              </QuickSelect>
            </Field>
            <Field label="من تاريخ"><input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="إلى تاريخ"><input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <Field label="السبب"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اختياري" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={submit}>تسجيل الطلب</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════════════ 4) الورديات والقواعد ═══════════════════ */

function ShiftsTab() {
  const { employees, hrRules, leaveTypes, employeeShifts, updateHrRules, updateLeaveTypes, setEmployeeShift } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const [shiftEmployee, setShiftEmployee] = useState(0)
  const [shiftStart, setShiftStart] = useState('09:00')
  const [shiftEnd, setShiftEnd] = useState('17:00')
  const [shiftGrace, setShiftGrace] = useState('15')
  const [typesDraft, setTypesDraft] = useState(() => leaveTypes.map((t) => ({ ...t })))
  const active = useMemo(() => employees.filter((e) => e.active), [employees])

  const rulesForm = (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="بداية الوردية" hint="HH:MM"><input className={inputCls} dir="ltr" value={formatClock(hrRules.shift.startMin)} onChange={(e) => { const v = parseClock(e.target.value); if (v != null) updateHrRules({ shift: { ...hrRules.shift, startMin: v } }) }} /></Field>
      <Field label="نهاية الوردية" hint="HH:MM"><input className={inputCls} dir="ltr" value={formatClock(hrRules.shift.endMin)} onChange={(e) => { const v = parseClock(e.target.value); if (v != null) updateHrRules({ shift: { ...hrRules.shift, endMin: v } }) }} /></Field>
      <Field label="سماح التأخير (دقيقة)"><input type="number" min={0} className={inputCls} value={hrRules.shift.graceMinutes} onChange={(e) => updateHrRules({ shift: { ...hrRules.shift, graceMinutes: Number(e.target.value) } })} /></Field>
      <Field label="أيام العمل بالشهر" hint="أساس حساب اليومية"><input type="number" min={1} max={31} className={inputCls} value={hrRules.workingDaysPerMonth} onChange={(e) => updateHrRules({ workingDaysPerMonth: Number(e.target.value) })} /></Field>
      <Field label="خصم الغياب">
        <QuickSelect className={inputCls} value={hrRules.absenceMode} onChange={(e) => updateHrRules({ absenceMode: e.target.value as 'daily' | 'half' | 'none' })} aria-label="وضع خصم الغياب">
          <option value="daily">يومية كاملة</option>
          <option value="half">نصف يومية</option>
          <option value="none">لا خصم (تسجيل فقط)</option>
        </QuickSelect>
      </Field>
      <Field label="كل كم دقيقة تأخير ⇒ خصم"><input type="number" min={1} className={inputCls} value={hrRules.latePerMinutes} onChange={(e) => updateHrRules({ latePerMinutes: Number(e.target.value) })} /></Field>
      <Field label={`مبلغ خصم التأخير (${cur.symbol})`} hint="0 = لا خصم مالي على التأخير">
        <input className={inputCls} value={hrRules.lateAmountMinor / 10 ** cur.decimals} onChange={(e) => { const v = toMinor(e.target.value || '0', cur.decimals); if (Number.isFinite(v)) updateHrRules({ lateAmountMinor: Math.max(0, v) }) }} />
      </Field>
      <Field label="معامل أجر الإضافي" hint="1.5 = وقت ونصف"><input type="number" step="0.25" min={0.25} className={inputCls} value={hrRules.overtimeMultiplier} onChange={(e) => updateHrRules({ overtimeMultiplier: Number(e.target.value) })} /></Field>
      <Field label="أدنى دقائق تُحتسب إضافياً"><input type="number" min={0} className={inputCls} value={hrRules.overtimeMinMinutes} onChange={(e) => updateHrRules({ overtimeMinMinutes: Number(e.target.value) })} /></Field>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 p-2.5 text-[12px] font-bold dark:border-slate-700 sm:col-span-2 lg:col-span-1">
        <input type="checkbox" checked={hrRules.overtimePaid} onChange={(e) => updateHrRules({ overtimePaid: e.target.checked })} className="size-4 accent-teal-600" />
        احتساب أجر الإضافي في مسار الرواتب
      </label>
    </div>
  )

  return (
    <div className="space-y-4" data-hr-shifts>
      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <h3 className="text-sm font-black">قواعد الاحتساب — وردية المنشأة</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          اليومية = (الأساسي + البدلات) ÷ أيام العمل بالشهر = <b className="font-mono">…</b> — الخصومات تظهر كبنود مرئية في مسار القسيمة قبل الترحيل، لا خصم صامت.
        </p>
        <div className="mt-3">{rulesForm}</div>
      </section>

      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <h3 className="text-sm font-black">ورديات خاصة بالموظفين</h3>
        <p className="mt-1 text-[11px] text-slate-500">من يعمل وردية مغايرة (مسائي/ليلي) — تُحتسب تأخيراته وإضافياته على ورديته هو لا على وردية المنشأة.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="الموظف">
            <QuickSelect className={inputCls + ' w-48'} value={shiftEmployee} onChange={(e) => {
              const id = Number(e.target.value); setShiftEmployee(id)
              const custom = employeeShifts.find((s) => s.employeeId === id)
              setShiftStart(formatClock(custom?.startMin ?? hrRules.shift.startMin)); setShiftEnd(formatClock(custom?.endMin ?? hrRules.shift.endMin)); setShiftGrace(String(custom?.graceMinutes ?? hrRules.shift.graceMinutes))
            }} aria-label="موظف الوردية">
              <option value={0}>— اختر موظفاً —</option>
              {active.map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
            </QuickSelect>
          </Field>
          <Field label="من"><input className={inputCls + ' w-24'} dir="ltr" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} /></Field>
          <Field label="إلى"><input className={inputCls + ' w-24'} dir="ltr" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} /></Field>
          <Field label="سماح"><input className={inputCls + ' w-20'} type="number" min={0} value={shiftGrace} onChange={(e) => setShiftGrace(e.target.value)} /></Field>
          <Btn disabled={!shiftEmployee} onClick={() => {
            const start = parseClock(shiftStart), end = parseClock(shiftEnd)
            if (start == null || end == null || end <= start) return toast.show('أوقات الوردية غير سليمة', 'error')
            try { setEmployeeShift(shiftEmployee, { startMin: start, endMin: end, graceMinutes: Number(shiftGrace) || 0 }); toast.show('حُفظت وردية الموظف ✓') } catch (e) { toast.show((e as Error).message, 'error') }
          }}>حفظ الوردية</Btn>
          <Btn variant="ghost" disabled={!shiftEmployee || !employeeShifts.some((s) => s.employeeId === shiftEmployee)} onClick={() => { setEmployeeShift(shiftEmployee, null); toast.show('عاد الموظف لوردية المنشأة') }}>إلغاء الخاصة</Btn>
        </div>
        {employeeShifts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {employeeShifts.map((s) => (
              <span key={s.employeeId} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] font-bold text-violet-700 dark:text-violet-300">
                {employees.find((e) => e.id === s.employeeId)?.nameAr ?? `#${s.employeeId}`}: {formatClock(s.startMin)}–{formatClock(s.endMin)} (سماح {s.graceMinutes}د)
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">أنواع الإجازات وأرصدتها السنوية</h3>
          <div className="flex gap-2">
            <Btn variant="ghost" onClick={() => setTypesDraft(typesDraft.map((t) => ({ ...t })))}>تحديث من المحفوظ</Btn>
            <Btn onClick={() => { try { updateLeaveTypes(typesDraft); toast.show('حُفظت أنواع الإجازات ✓') } catch (e) { toast.show((e as Error).message, 'error') } }}>حفظ</Btn>
          </div>
        </div>
        <div className="mt-2 space-y-2">
          {typesDraft.map((type, i) => (
            <div key={i} className="grid items-end gap-2 rounded-xl border border-slate-100 p-2 dark:border-slate-800 sm:grid-cols-[1fr_1fr_100px_120px]">
              <Field label="الكود"><input className={inputCls} value={type.id} onChange={(e) => setTypesDraft((d) => d.map((row, j) => (j === i ? { ...row, id: e.target.value.trim() } : row)))} /></Field>
              <Field label="الاسم"><input className={inputCls} value={type.nameAr} onChange={(e) => setTypesDraft((d) => d.map((row, j) => (j === i ? { ...row, nameAr: e.target.value } : row)))} /></Field>
              <Field label="الرصيد"><input type="number" min={0} className={inputCls} value={type.annualQuotaDays} onChange={(e) => setTypesDraft((d) => d.map((row, j) => (j === i ? { ...row, annualQuotaDays: Number(e.target.value) } : row)))} /></Field>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold">
                <input type="checkbox" checked={type.paid} onChange={(e) => setTypesDraft((d) => d.map((row, j) => (j === i ? { ...row, paid: e.target.checked } : row)))} className="size-4 accent-teal-600" />
                مدفوعة
                <button type="button" className="ms-auto text-slate-400 hover:text-rose-600" title="حذف النوع" onClick={() => setTypesDraft((d) => d.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </label>
            </div>
          ))}
          <Btn variant="soft" onClick={() => setTypesDraft((d) => [...d, { id: '', nameAr: '', paid: true, annualQuotaDays: 14 }])}><span className="flex items-center gap-1.5"><Plus size={14} /> نوع جديد</span></Btn>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">الإجازة غير المدفوعة تُخصم من الراتب كيومية كاملة في مسار القسيمة (بند مرئي قابل للتعديل).</p>
      </section>
    </div>
  )
}

/* ═══════════════════ 5) التقارير ═══════════════════ */

function HrReportsTab() {
  const { employees, attendanceRecords, hrRules, employeeShifts, getAttendancePayrollImpact } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))

  const rows = useMemo(() => {
    const impacts = new Map(getAttendancePayrollImpact(month).map((row) => [row.employeeId, row]))
    return employees.filter((e) => e.active).map((employee) => {
      const impact = impacts.get(employee.id)
      let late = 0, ot = 0
      const shift = employeeShifts.find((s) => s.employeeId === employee.id) ?? hrRules.shift
      for (const record of attendanceRecords) {
        if (record.employeeId !== employee.id || !record.date.startsWith(month)) continue
        const m = dayMetrics(record, { ...hrRules, shift })
        late += m.lateMinutes
        ot += m.overtimeMinutes
      }
      return { employee, impact, late, ot }
    })
  }, [employees, month, attendanceRecords, employeeShifts, hrRules, getAttendancePayrollImpact])

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    present: sum.present + (row.impact?.summary.presentDays ?? 0),
    absent: sum.absent + (row.impact?.summary.absentDays ?? 0),
    late: sum.late + row.late,
    ot: sum.ot + row.ot,
    overtime: sum.overtime + (row.impact?.overtimeAllowanceMinor ?? 0),
    deductions: sum.deductions + (row.impact ? row.impact.absenceDeductionMinor + row.impact.unpaidLeaveDeductionMinor + row.impact.lateDeductionMinor : 0),
  }), { present: 0, absent: 0, late: 0, ot: 0, overtime: 0, deductions: 0 }), [rows])

  const exportCsv = () => {
    const head = ['الكود', 'الموظف', 'حاضر', 'غياب', 'إجازة مدفوعة', 'إجازة بلا أجر', 'إذن', 'عطلة', 'مأمورية', 'دقائق تأخير', 'ساعات إضافي', `بدل إضافي (${cur.code})`, `خصم غياب (${cur.code})`, `خصم إجازة بلا أجر (${cur.code})`, `خصم تأخير (${cur.code})`]
    const body = rows.map(({ employee, impact, late, ot }) => [
      partyCode('EMP', employee.id), employee.nameAr,
      impact?.summary.presentDays ?? 0, impact?.summary.absentDays ?? 0, impact?.summary.paidLeaveDays ?? 0, impact?.summary.unpaidLeaveDays ?? 0,
      impact?.summary.permissionDays ?? 0, impact?.summary.holidayDays ?? 0, impact?.summary.missionDays ?? 0,
      late, (ot / 60).toFixed(2),
      (impact?.overtimeAllowanceMinor ?? 0) / 10 ** cur.decimals,
      (impact?.absenceDeductionMinor ?? 0) / 10 ** cur.decimals,
      (impact?.unpaidLeaveDeductionMinor ?? 0) / 10 ** cur.decimals,
      (impact?.lateDeductionMinor ?? 0) / 10 ** cur.decimals,
    ].join(','))
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `حضور-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const print = () => {
    const body = rows.map(({ employee, impact, late, ot }) => `<tr>
      <td>${employee.nameAr}</td><td class="n">${impact?.summary.presentDays ?? 0}</td><td class="n">${impact?.summary.absentDays ?? 0}</td>
      <td class="n">${impact?.summary.paidLeaveDays ?? 0}</td><td class="n">${impact?.summary.unpaidLeaveDays ?? 0}</td>
      <td class="n">${impact?.summary.permissionDays ?? 0}</td><td class="n">${late}</td><td class="n">${(ot / 60).toFixed(1)}</td>
      <td class="n">${fmt(impact?.overtimeAllowanceMinor ?? 0)}</td><td class="n">${fmt((impact?.absenceDeductionMinor ?? 0) + (impact?.unpaidLeaveDeductionMinor ?? 0) + (impact?.lateDeductionMinor ?? 0))}</td>
    </tr>`).join('')
    printHtml(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف الحضور ${month}</title>
      <style>body{font-family:system-ui,'Segoe UI',Tahoma;padding:24px;color:#0f172a}h1{font-size:18px;margin:0 0 4px}p{color:#64748b;font-size:12px;margin:0 0 14px}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:center}th{background:#f1f5f9}
      td:first-child{text-align:right;font-weight:700}.n{font-variant-numeric:tabular-nums}tfoot td{font-weight:800;background:#f8fafc}</style></head><body>
      <h1>كشف الحضور والانصراف — ${monthLabelAr(month)}</h1><p>${setup.shopName ?? ''} · تاريخ الطباعة ${new Date().toISOString().slice(0, 10)}</p>
      <table><thead><tr><th>الموظف</th><th>حاضر</th><th>غياب</th><th>إجازة مدفوعة</th><th>إجازة بلا أجر</th><th>إذن</th><th>دقائق تأخير</th><th>ساعات إضافي</th><th>بدل إضافي</th><th>إجمالي الخصومات</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>الإجمالي</td><td class="n">${totals.present}</td><td class="n">${totals.absent}</td><td></td><td></td><td></td><td class="n">${totals.late}</td><td class="n">${(totals.ot / 60).toFixed(1)}</td><td class="n">${fmt(totals.overtime)}</td><td class="n">${fmt(totals.deductions)}</td></tr></tfoot></table>
      </body></html>`)
  }

  return (
    <div className="space-y-4" data-hr-reports>
      <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-card-dark">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black">كشف الحضور الشهري وأثره على الرواتب — {monthLabelAr(month)}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" className={inputCls + ' w-40'} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="شهر التقرير" />
            <Btn variant="soft" onClick={exportCsv}><span className="flex items-center gap-1.5"><FileDown size={15} /> تصدير CSV</span></Btn>
            <Btn onClick={print}><span className="flex items-center gap-1.5"><Printer size={15} /> طباعة</span></Btn>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          البنود أدناه <b>مقترحات مرئية</b> تُعرَض في مسار قسائم الرواتب (زر «احتساب من الحضور») وتظل قابلة للتعديل قبل الترحيل — لا خصم صامت.
        </p>
        {rows.length === 0 ? (
          <p className="mt-3 text-[12px] text-slate-500">لا موظفين على رأس العمل.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="p-1.5 text-right">الموظف</th><th className="p-1.5">حاضر</th><th className="p-1.5">غياب</th>
                  <th className="p-1.5">إجازة مدفوعة</th><th className="p-1.5">إجازة بلا أجر</th><th className="p-1.5">إذن</th><th className="p-1.5">مأمورية</th>
                  <th className="p-1.5">دقائق تأخير</th><th className="p-1.5">ساعات إضافي</th>
                  <th className="p-1.5">بدل إضافي</th><th className="p-1.5">خصم غياب</th><th className="p-1.5">خصم بلا أجر</th><th className="p-1.5">خصم تأخير</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, impact, late, ot }) => (
                  <tr key={employee.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-1.5 text-right font-bold">{employee.nameAr}</td>
                    <td className="p-1.5 text-center font-mono text-emerald-600 dark:text-emerald-400">{impact?.summary.presentDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono text-rose-600 dark:text-rose-400">{impact?.summary.absentDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono text-sky-600 dark:text-sky-400">{impact?.summary.paidLeaveDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono">{impact?.summary.unpaidLeaveDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono">{impact?.summary.permissionDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono">{impact?.summary.missionDays ?? 0}</td>
                    <td className="p-1.5 text-center font-mono text-amber-600">{late}</td>
                    <td className="p-1.5 text-center font-mono text-violet-600">{(ot / 60).toFixed(1)}</td>
                    <td className="p-1.5 text-center font-mono text-violet-600">{fmt(impact?.overtimeAllowanceMinor ?? 0)}</td>
                    <td className="p-1.5 text-center font-mono text-rose-600">{fmt(impact?.absenceDeductionMinor ?? 0)}</td>
                    <td className="p-1.5 text-center font-mono text-rose-600">{fmt(impact?.unpaidLeaveDeductionMinor ?? 0)}</td>
                    <td className="p-1.5 text-center font-mono text-rose-600">{fmt(impact?.lateDeductionMinor ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold dark:border-slate-600">
                  <td className="p-1.5 text-right">الإجمالي</td>
                  <td className="p-1.5 text-center font-mono">{totals.present}</td>
                  <td className="p-1.5 text-center font-mono">{totals.absent}</td>
                  <td colSpan={4} />
                  <td className="p-1.5 text-center font-mono">{totals.late}</td>
                  <td className="p-1.5 text-center font-mono">{(totals.ot / 60).toFixed(1)}</td>
                  <td className="p-1.5 text-center font-mono">{fmt(totals.overtime)}</td>
                  <td className="p-1.5 text-center font-mono" colSpan={3}>{fmt(totals.deductions)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
