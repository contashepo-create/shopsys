/**
 * شؤون الموظفين — الحضور والانصراف والإجازات (طلب المالك ㉘).
 * ─────────────────────────────────────────────────────────────
 * نواة خالصة بلا React تُغطي:
 *   • الحضور اليومي: حالات (حاضر · غياب · إجازة · إذن · عطلة · مأمورية)
 *     مع دخول/خروج، وحساب التأخير والانصراف المبكر والإضافي.
 *   • استيراد جهاز البصمة: تحليل CSV/Excel بأعمدة مرنة (كود/اسم · تاريخ ·
 *     دخول · خروج) مع مطابقة الموظفين ومعاينة قبل الاعتماد.
 *   • الإجازات: أرصدة سنوية/مرضية/بدون أجر، طلب ⇐ اعتماد ⇐ خصم من الرصيد.
 *   • الربط بالرواتب: خصم الغياب والتأخير وأجر الإضافي كبنود **مرئية**
 *     في مسار القسيمة — لا خصم صامت أبداً (قاعدة المالك).
 *
 * المحاسبة: لا قيود هنا إطلاقاً — كل الأثر المالي يدخل عبر قسائم الرواتب
 * (5102/2104) في مسارها الرسمي، فلا مسار ترحيل جديد ولا حساب جديد.
 * كل المبالغ أعداد صحيحة بالوحدة الصغرى (Minor).
 */
import type { Minor } from './money.ts'

/* ───────────────────────── 1) الحضور اليومي ───────────────────────── */

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'permission' | 'holiday' | 'mission'

export const ATTENDANCE_STATUS_AR: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غياب',
  leave: 'إجازة',
  permission: 'إذن خروج',
  holiday: 'عطلة',
  mission: 'مأمورية',
}

/** ألوان الحالات في الشبكة الشهرية — نفس لغة ألوان التطبيق */
export const ATTENDANCE_STATUS_TONE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  absent: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
  leave: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
  permission: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  holiday: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
  mission: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
}

export const ATTENDANCE_STATUSES = Object.keys(ATTENDANCE_STATUS_AR) as AttendanceStatus[]

export interface AttendanceRecord {
  id: number
  employeeId: number
  date: string // YYYY-MM-DD
  status: AttendanceStatus
  checkIn?: string | null // HH:MM
  checkOut?: string | null // HH:MM
  /** يدوي أم من استيراد بصمة */
  source: 'manual' | 'import'
  importBatch?: number | null
  notes?: string
}

/** وردية عمل: دقائق من منتصف الليل (540 = 9:00) */
export interface ShiftRule {
  startMin: number
  endMin: number
  graceMinutes: number // سماح التأخير بالدقائق
}

export interface HrRules {
  /** الوردية الافتراضية للمنشأة */
  shift: ShiftRule
  /** خصم التأخير: كل هذا العدد من الدقائق ⇒ مبلغ الخصم */
  latePerMinutes: number
  lateAmountMinor: Minor
  /** خصم الغياب: يومية كاملة / نصف يومية / لا خصم */
  absenceMode: 'daily' | 'half' | 'none'
  /** أيام العمل المعيارية بالشهر (أساس حساب اليومية) */
  workingDaysPerMonth: number
  /** معامل أجر الإضافي (1.5 = وقت ونصف) */
  overtimeMultiplier: number
  /** أدنى دقائق إضافية تُحتسب (أقل من ذلك تُهمل) */
  overtimeMinMinutes: number
  /** احتساب أجر الإضافي تلقائياً في مسار الرواتب (مطفأ = بنود استرشادية فقط) */
  overtimePaid: boolean
}

export const DEFAULT_HR_RULES: HrRules = {
  shift: { startMin: 9 * 60, endMin: 17 * 60, graceMinutes: 15 },
  latePerMinutes: 60,
  lateAmountMinor: 0,
  absenceMode: 'daily',
  workingDaysPerMonth: 26,
  overtimeMultiplier: 1.5,
  overtimeMinMinutes: 30,
  overtimePaid: false,
}

export function normalizeHrRules(raw: Partial<HrRules> | null | undefined): HrRules {
  const shift = raw?.shift
  return {
    shift: {
      startMin: clampInt(shift?.startMin, 0, 24 * 60, DEFAULT_HR_RULES.shift.startMin),
      endMin: clampInt(shift?.endMin, 0, 24 * 60, DEFAULT_HR_RULES.shift.endMin),
      graceMinutes: clampInt(shift?.graceMinutes, 0, 240, DEFAULT_HR_RULES.shift.graceMinutes),
    },
    latePerMinutes: clampInt(raw?.latePerMinutes, 1, 720, DEFAULT_HR_RULES.latePerMinutes),
    lateAmountMinor: Math.max(0, Math.round(raw?.lateAmountMinor ?? DEFAULT_HR_RULES.lateAmountMinor)),
    absenceMode: raw?.absenceMode === 'half' || raw?.absenceMode === 'none' ? raw.absenceMode : 'daily',
    workingDaysPerMonth: clampInt(raw?.workingDaysPerMonth, 1, 31, DEFAULT_HR_RULES.workingDaysPerMonth),
    overtimeMultiplier: Number.isFinite(raw?.overtimeMultiplier) && (raw?.overtimeMultiplier ?? 0) > 0 ? Number(raw?.overtimeMultiplier) : DEFAULT_HR_RULES.overtimeMultiplier,
    overtimeMinMinutes: clampInt(raw?.overtimeMinMinutes, 0, 240, DEFAULT_HR_RULES.overtimeMinMinutes),
    overtimePaid: raw?.overtimePaid ?? DEFAULT_HR_RULES.overtimePaid,
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/* ─── أدوات الوقت ─── */

/** «09:30» أو «09:30:45» ⇐ 570 دقيقة؛ null إن كان غير صالح */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function formatClock(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return ''
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** حسم دقائق التأخير والانصراف المبكر والإضافي ليوم واحد */
export function dayMetrics(
  record: Pick<AttendanceRecord, 'status' | 'checkIn' | 'checkOut'>,
  rules: HrRules,
): { lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number; workedMinutes: number } {
  const none = { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0 }
  if (record.status !== 'present' && record.status !== 'mission') return none
  const inMin = parseClock(record.checkIn)
  const outMin = parseClock(record.checkOut)
  if (inMin == null || outMin == null) return none
  const worked = outMin - inMin
  if (worked <= 0) return none
  const late = Math.max(0, inMin - (rules.shift.startMin + rules.shift.graceMinutes))
  const early = Math.max(0, rules.shift.endMin - outMin)
  const raw = Math.max(0, outMin - rules.shift.endMin)
  const overtime = raw >= rules.overtimeMinMinutes ? raw : 0
  return { lateMinutes: late, earlyLeaveMinutes: early, overtimeMinutes: overtime, workedMinutes: worked }
}

/* ─── الشبكة الشهرية ─── */

export const MONTHS_DAYS_AR = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']

/** كل تواريخ الشهر بصيغة YYYY-MM-DD */
export function monthDates(month: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** 2026-09-15 ⇐ 2 (الأحد=0 … السبت=6) */
export function weekdayIndex(dateIso: string): number {
  const d = new Date(`${dateIso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? 0 : d.getDay()
}

/* ───────────────────────── 2) الإجازات ───────────────────────── */

export interface LeaveTypeDef {
  id: string
  nameAr: string
  paid: boolean
  annualQuotaDays: number
}

export const DEFAULT_LEAVE_TYPES: LeaveTypeDef[] = [
  { id: 'annual', nameAr: 'سنوية مدفوعة', paid: true, annualQuotaDays: 21 },
  { id: 'sick', nameAr: 'مرضية', paid: true, annualQuotaDays: 30 },
  { id: 'emergency', nameAr: 'طارئة', paid: true, annualQuotaDays: 7 },
  { id: 'unpaid', nameAr: 'بدون أجر', paid: false, annualQuotaDays: 60 },
]

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequest {
  id: number
  employeeId: number
  typeId: string
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD (شاملة)
  days: number
  status: LeaveStatus
  reason: string
  requestedAt: string
  decidedBy?: string | null
  decidedAt?: string | null
  notes?: string
}

export const LEAVE_STATUS_AR: Record<LeaveStatus, string> = { pending: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة' }

/** عدد الأيام بين تاريخين شاملَين */
export function leaveDaysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}

/** كل التواريخ التي تغطيها إجازة */
export function leaveDates(leave: Pick<LeaveRequest, 'from' | 'to'>): string[] {
  const out: string[] = []
  const cursor = new Date(`${leave.from}T00:00:00`)
  const end = new Date(`${leave.to}T00:00:00`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || end < cursor) return out
  for (let d = cursor; d <= end; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10))
  return out
}

/** أيام النوع المعتمدة لموظف في سنة معينة */
export function usedLeaveDays(leaves: LeaveRequest[], employeeId: number, year: number, typeId: string): number {
  return leaves
    .filter((l) => l.employeeId === employeeId && l.typeId === typeId && l.status === 'approved' && l.from.startsWith(String(year)))
    .reduce((sum, l) => sum + l.days, 0)
}

export interface LeaveBalanceRow {
  typeId: string
  nameAr: string
  paid: boolean
  quotaDays: number
  usedDays: number
  remainingDays: number
}

export function leaveBalances(leaves: LeaveRequest[], types: LeaveTypeDef[], employeeId: number, year: number): LeaveBalanceRow[] {
  return types.map((type) => {
    const usedDays = usedLeaveDays(leaves, employeeId, year, type.id)
    return { typeId: type.id, nameAr: type.nameAr, paid: type.paid, quotaDays: type.annualQuotaDays, usedDays, remainingDays: Math.max(0, type.annualQuotaDays - usedDays) }
  })
}

/** تحقق طلب إجازة — أخطاء عربية (فارغة = سليم) */
export function validateLeaveRequest(args: {
  employeeId: number
  typeId: string
  from: string
  to: string
  leaves: LeaveRequest[]
  types: LeaveTypeDef[]
}): string[] {
  const errors: string[] = []
  const type = args.types.find((t) => t.id === args.typeId)
  if (!args.employeeId) errors.push('اختر الموظف')
  if (!type) errors.push('اختر نوع الإجازة')
  const days = leaveDaysBetween(args.from, args.to)
  if (days <= 0) errors.push('نطاق التاريخ غير سليم — «إلى» قبل «من»')
  if (type && days > 0) {
    const balance = type.annualQuotaDays - usedLeaveDays(args.leaves, args.employeeId, new Date(args.from).getFullYear() || new Date().getFullYear(), type.id)
    if (days > balance) errors.push(`رصيد ${type.nameAr} لا يكفي — المتبقي ${balance} يوم فقط`)
  }
  /* تعارض مع إجازة أخرى معتمدة/معلقة لنفس الموظف */
  const overlap = args.leaves.find((l) =>
    l.employeeId === args.employeeId && l.status !== 'rejected' &&
    leaveDates(l).some((d) => d >= args.from && d <= args.to),
  )
  if (overlap) errors.push(`تعارض مع إجازة ${LEAVE_STATUS_AR[overlap.status]} ${overlap.from} ⇐ ${overlap.to}`)
  return errors
}

/* ───────────────────────── 3) استيراد البصمة ───────────────────────── */

export interface FingerprintRow {
  employeeKey: string // كود أو اسم كما ورد في الملف
  date: string // YYYY-MM-DD
  checkIn: string // HH:MM (قد تكون فارغة)
  checkOut: string // HH:MM (قد تكون فارغة)
}

export interface ImportMatch {
  row: FingerprintRow
  employeeId: number | null // null = غير مطابق
}

/**
 * تحليل ملف البصمة (CSV نصي — وأي تصدية Excel بتنسيق CSV):
 * يتقبل رؤوس أعمدة عربية/إنجليزية بمرادفات، وبلا رأس أصلاً (ترتيب:
 * الكود، التاريخ، الدخول، الخروج). يوحّد التاريخ إلى YYYY-MM-DD
 * (يقبل YYYY-MM-DD · DD/MM/YYYY · DD-MM-YYYY) والوقت إلى HH:MM.
 */
export function parseFingerprintCsv(text: string): { rows: FingerprintRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: FingerprintRow[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { rows, errors: ['الملف فارغ'] }

  const splitLine = (line: string): string[] =>
    line.includes('\t') ? line.split('\t') : line.split(',').map((c) => c.trim())

  /* اكتشاف رؤوس الأعمدة بالمرادفات */
  const header = splitLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
  const colOf = (words: string[]): number =>
    header.findIndex((cell) => words.some((w) => cell.includes(w) || w.includes(cell) && cell.length > 2))

  const codeCol = colOf(['كودالموظف', 'الكود', 'الرقمالوظيفي', 'رقم', 'employee', 'code', 'id', 'empno'])
  const nameCol = colOf(['الاسم', 'الموظف', 'name'])
  const dateCol = colOf(['التاريخ', 'تاريخ', 'date'])
  const inCol = colOf(['الدخول', 'حضور', 'بداية', 'checkin', 'in', 'starttime', 'from'])
  const outCol = colOf(['الخروج', 'انصراف', 'نهاية', 'checkout', 'out', 'endtime', 'to'])

  /* لا رأس مفهوم ⇐ الافتراضي: كود · تاريخ · دخول · خروج */
  const hasHeader = [codeCol, nameCol, dateCol, inCol, outCol].some((i) => i >= 0)
  const cols = hasHeader
    ? { code: codeCol, name: nameCol, date: dateCol, in: inCol, out: outCol }
    : { code: 0, name: -1, date: 1, in: 2, out: 3 }
  const dataLines = hasHeader ? lines.slice(1) : lines

  const normDate = (raw: string, lineNo: number): string | null => {
    const v = raw.trim()
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v)
    if (m) {
      // صيغة مصرية/عربية شائعة: يوم/شهر/سنة
      const d = Number(m[1]), mo = Number(m[2])
      const day = d > 12 ? d : d /* يوم أولاً */ , month = d > 12 && mo <= 12 ? mo : mo
      if (month > 12 || day > 31) { errors.push(`سطر ${lineNo}: تاريخ غير مفهوم «${raw}»`); return null }
      return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    errors.push(`سطر ${lineNo}: تاريخ غير مفهوم «${raw}»`)
    return null
  }

  const normTime = (raw: string | undefined): string => {
    if (!raw) return ''
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|am)?\s*(م|pm)?/i.exec(raw.trim())
    if (!m) return ''
    let h = Number(m[1])
    if ((m[5] ?? '').toLowerCase() === 'م' || m[5]?.toLowerCase() === 'pm') h = h % 12 + 12
    if (h > 23 || Number(m[2]) > 59) return ''
    return `${String(h).padStart(2, '0')}:${m[2]}`
  }

  for (let i = 0; i < dataLines.length; i++) {
    const cells = splitLine(dataLines[i])
    const key = (cols.code >= 0 ? cells[cols.code] : '') || (cols.name >= 0 ? cells[cols.name] : '')
    if (!key) { errors.push(`سطر ${i + 1}: لا كود ولا اسم موظف`); continue }
    const date = cols.date >= 0 ? normDate(cells[cols.date] ?? '', i + 1) : null
    if (!date) continue
    const checkIn = normTime(cols.in >= 0 ? cells[cols.in] : undefined)
    const checkOut = normTime(cols.out >= 0 ? cells[cols.out] : undefined)
    rows.push({ employeeKey: key.trim(), date, checkIn, checkOut })
  }

  /* دمج التكرارات: نفس الموظف بنفس اليوم ⇐ أول دخول وآخر خروج */
  const merged = new Map<string, FingerprintRow>()
  for (const row of rows) {
    const k = `${row.employeeKey}|${row.date}`
    const prev = merged.get(k)
    if (!prev) merged.set(k, row)
    else merged.set(k, {
      ...prev,
      checkIn: prev.checkIn && row.checkIn && prev.checkIn <= row.checkIn ? prev.checkIn : (row.checkIn || prev.checkIn),
      checkOut: prev.checkOut && row.checkOut && prev.checkOut >= row.checkOut ? prev.checkOut : (row.checkOut || prev.checkOut),
    })
  }
  return { rows: [...merged.values()], errors }
}

/** تطبيع نص عربي للمطابقة: بلا تشكيل ولا مسافات زائدة */
export function normalizeArabicName(name: string): string {
  return name
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
}

/** مطابقة صفوف الاستيراد بالموظفين: بالكود (EMP-0007/7) ثم بالاسم المطوَّع */
export function matchImportRows(
  rows: FingerprintRow[],
  employees: { id: number; nameAr: string }[],
): ImportMatch[] {
  const byCode = new Map<string, number>()
  for (const e of employees) {
    byCode.set(String(e.id), e.id)
    byCode.set(`emp-${String(e.id).padStart(4, '0')}`, e.id)
    byCode.set(`emp-${e.id}`, e.id)
  }
  const byName = new Map<string, number>()
  for (const e of employees) byName.set(normalizeArabicName(e.nameAr), e.id)
  return rows.map((row) => {
    const key = row.employeeKey.trim()
    const codeHit = byCode.get(key.toLowerCase()) ?? byCode.get(key.replace(/\D/g, '')) ?? null
    if (codeHit) return { row, employeeId: codeHit }
    const nameHit = byName.get(normalizeArabicName(key))
    return { row, employeeId: nameHit ?? null }
  })
}

/* ───────────────────────── 4) الملخص الشهري والربط بالرواتب ───────────────────────── */

export interface MonthlyAttendanceSummary {
  employeeId: number
  month: string
  presentDays: number
  absentDays: number
  leaveDays: number
  permissionDays: number
  holidayDays: number
  missionDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  totalLateMinutes: number
  totalEarlyLeaveMinutes: number
  totalOvertimeMinutes: number
  recordedDays: number
}

export function monthlySummary(args: {
  employeeId: number
  month: string
  records: AttendanceRecord[] // سجلات الموظف في الشهر (يُرشَّح خارجها أو هنا)
  leaves: LeaveRequest[] // إجازات الموظف المعتمدة في الشهر
  types: LeaveTypeDef[]
}): MonthlyAttendanceSummary {
  const base: MonthlyAttendanceSummary = {
    employeeId: args.employeeId, month: args.month,
    presentDays: 0, absentDays: 0, leaveDays: 0, permissionDays: 0, holidayDays: 0, missionDays: 0,
    paidLeaveDays: 0, unpaidLeaveDays: 0,
    totalLateMinutes: 0, totalEarlyLeaveMinutes: 0, totalOvertimeMinutes: 0, recordedDays: 0,
  }
  for (const record of args.records) {
    if (record.employeeId !== args.employeeId || !record.date.startsWith(args.month)) continue
    base.recordedDays += 1
    if (record.status === 'present') base.presentDays += 1
    else if (record.status === 'absent') base.absentDays += 1
    else if (record.status === 'leave') base.leaveDays += 1
    else if (record.status === 'permission') base.permissionDays += 1
    else if (record.status === 'holiday') base.holidayDays += 1
    else if (record.status === 'mission') base.missionDays += 1
  }
  /* أيام الإجازات المعتمدة المتقاطعة مع الشهر — من سجل الإجازات لا من الشبكة
     (حتى لو لم تُعلَّم في الشبكة اليومية تبقى مستحقة الخصم من الرصيد) */
  for (const leave of args.leaves) {
    if (leave.employeeId !== args.employeeId || leave.status !== 'approved') continue
    const dates = leaveDates(leave).filter((d) => d.startsWith(args.month))
    if (!dates.length) continue
    const type = args.types.find((t) => t.id === leave.typeId)
    if (type?.paid) base.paidLeaveDays += dates.length
    else base.unpaidLeaveDays += dates.length
  }
  return base
}

/** اليومية = (الأساسي + البدلات) ÷ أيام العمل المعيارية */
export function dailyRateMinor(grossMinor: Minor, rules: HrRules): Minor {
  if (rules.workingDaysPerMonth <= 0) return 0
  return Math.round(grossMinor / rules.workingDaysPerMonth)
}

/** أثر الحضور على راتب الشهر — بنود مرئية تُعرض في مسار القسيمة قبل الترحيل */
export interface AttendancePayrollImpact {
  employeeId: number
  month: string
  summary: MonthlyAttendanceSummary
  /** بدل إضافي مقترح (بالساعات الإضافية × أجر الساعة × المعامل) */
  overtimeAllowanceMinor: Minor
  /** خصم غياب (باليومية أو نصفها حسب القاعدة) */
  absenceDeductionMinor: Minor
  /** خصم إجازات بدون أجر */
  unpaidLeaveDeductionMinor: Minor
  /** خصم تأخير (كل N دقيقة ⇒ مبلغ) */
  lateDeductionMinor: Minor
  netAdjustmentMinor: Minor
  notes: string[]
}

export function attendancePayrollImpact(args: {
  employeeId: number
  month: string
  grossMinor: Minor // الأساسي + البدلات الشهرية
  rules: HrRules
  records: AttendanceRecord[]
  leaves: LeaveRequest[]
  types: LeaveTypeDef[]
  /** مجموع دقائق التأخير/الإضافي — يُمرَّر مباشرة إن حُسب مسبقاً */
  lateMinutes?: number
  overtimeMinutes?: number
}): AttendancePayrollImpact {
  const summary = monthlySummary({ employeeId: args.employeeId, month: args.month, records: args.records, leaves: args.leaves, types: args.types })
  const dayRate = dailyRateMinor(args.grossMinor, args.rules)
  const shiftHours = Math.max(1, (args.rules.shift.endMin - args.rules.shift.startMin) / 60)
  const hourRate = Math.round(dayRate / shiftHours)

  let lateMinutes = args.lateMinutes ?? 0
  let overtimeMinutes = args.overtimeMinutes ?? 0
  if (args.lateMinutes == null || args.overtimeMinutes == null) {
    for (const record of args.records) {
      if (record.employeeId !== args.employeeId || !record.date.startsWith(args.month)) continue
      const metrics = dayMetrics(record, args.rules)
      lateMinutes += metrics.lateMinutes
      overtimeMinutes += metrics.overtimeMinutes
    }
  }

  const absenceUnit = args.rules.absenceMode === 'none' ? 0 : args.rules.absenceMode === 'half' ? 0.5 : 1
  const absenceDeductionMinor = Math.round(summary.absentDays * dayRate * absenceUnit)
  const unpaidLeaveDeductionMinor = Math.round(summary.unpaidLeaveDays * dayRate)
  const lateDeductionMinor = args.rules.lateAmountMinor > 0
    ? Math.floor(lateMinutes / args.rules.latePerMinutes) * args.rules.lateAmountMinor
    : 0
  const overtimeAllowanceMinor = args.rules.overtimePaid
    ? Math.round((overtimeMinutes / 60) * hourRate * args.rules.overtimeMultiplier)
    : 0

  const notes: string[] = []
  if (summary.absentDays) notes.push(`غياب ${summary.absentDays} يوم`)
  if (summary.unpaidLeaveDays) notes.push(`إجازة بدون أجر ${summary.unpaidLeaveDays} يوم`)
  if (lateMinutes) notes.push(`تأخير ${Math.round(lateMinutes)} دقيقة`)
  if (overtimeMinutes) notes.push(`إضافي ${(overtimeMinutes / 60).toFixed(1)} ساعة`)
  if (summary.paidLeaveDays) notes.push(`إجازة مدفوعة ${summary.paidLeaveDays} يوم`)

  return {
    employeeId: args.employeeId,
    month: args.month,
    summary,
    overtimeAllowanceMinor,
    absenceDeductionMinor,
    unpaidLeaveDeductionMinor,
    lateDeductionMinor,
    netAdjustmentMinor: overtimeAllowanceMinor - absenceDeductionMinor - unpaidLeaveDeductionMinor - lateDeductionMinor,
    notes,
  }
}

/* ───────────────────────── 5) تصدير التقارير ───────────────────────── */

/** CSV كشف الحضور الشهري — يُصدَّر للملف أو يُطبع */
export function attendanceSummaryCsv(rows: {
  code: string
  name: string
  summary: MonthlyAttendanceSummary
  lateMinutes: number
  overtimeMinutes: number
}[]): string {
  const head = ['الكود', 'الموظف', 'حاضر', 'غياب', 'إجازة مدفوعة', 'إجازة بلا أجر', 'إذن', 'عطلة', 'مأمورية', 'دقائق تأخير', 'ساعات إضافي']
  const body = rows.map((r) => [
    r.code, r.name, r.summary.presentDays, r.summary.absentDays, r.summary.paidLeaveDays, r.summary.unpaidLeaveDays,
    r.summary.permissionDays, r.summary.holidayDays, r.summary.missionDays,
    r.lateMinutes, (r.overtimeMinutes / 60).toFixed(2),
  ].join(','))
  return [head.join(','), ...body].join('\n')
}
