import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الموظفون والرواتب (المرحلة 5) — تبويبان:
 * 1) سجل الموظفين: نفس البيانات الموسعة الاختيارية للأطراف + بيانات التوظيف
 * 2) مسيرات الرواتب: مسير شهري (أساسي + بدلات + إضافي − خصومات − سلف)
 *    يترحّل بقيد متوازن بنيوياً: 5102 → خزينة (نقدي) أو 2104 (استحقاق)
 */
import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Trash2, Phone, ChevronDown, FileBadge, BookOpenText, Eye, BadgeCheck, BadgeX, FileSpreadsheet, Download, UserSearch, CalendarCheck2, UserCog, Banknote, HandCoins, Percent } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Employee, type PayrollRun } from '../../data/repo.ts'
import { rolesWithOverrides, visibleRolesForModules } from '../../core/permissions.ts'
import { suggestRoleForJobTitle } from '../../core/audit.ts'
import type { PartyExtended } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { matchesPartyCode, partyCode } from '../../core/partyCodes.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { toCsv } from '../../core/security.ts'
import { monthLabelAr, type PayrollPayMode, type PayrollLineInput } from '../../core/payroll.ts'
import { matchesSearch } from '../../core/search.ts'
import { STAFF_COMMISSION_SOURCE_LABELS, STAFF_COMMISSION_STATUS_LABELS, type StaffCommissionSource } from '../../core/staffCommissions.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { DocSectionHead, DocOutcome } from '../components/DocSection.tsx'
import { jobTitlesFor, jobTitleLabel } from '../../core/jobTitles.ts'

/** قسم البيانات الموسعة القابل للطي — نفس نمط العملاء والموردين */
function ExtendedFields({ ext, setExt }: { ext: PartyExtended; setExt: (e: PartyExtended) => void }) {
  const [open, setOpen] = useState(false)
  const filledCount = Object.values(ext).filter(Boolean).length
  const p = (patch: Partial<PartyExtended>) => setExt({ ...ext, ...patch })
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors duration-200"
      >
        <FileBadge size={15} className="text-brand-500" />
        <span className="flex-1 text-right">بيانات إضافية (كلها اختيارية)</span>
        {filledCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">{filledCount} مكتمل</span>}
        <ChevronDown size={15} className={`opacity-50 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="p-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="الهوية / الإقامة">
              <input value={ext.nationalId} onChange={(e) => p({ nationalId: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="البريد الإلكتروني">
              <input value={ext.email} onChange={(e) => p({ email: e.target.value })} className={inputCls} dir="ltr" type="email" />
            </Field>
            <Field label="العنوان (الشارع / الحي)">
              <input value={ext.address} onChange={(e) => p({ address: e.target.value })} className={inputCls} />
            </Field>
            <Field label="المدينة">
              <input value={ext.city} onChange={(e) => p({ city: e.target.value })} className={inputCls} />
            </Field>
            <Field label="الرمز البريدي">
              <input value={ext.postalCode} onChange={(e) => p({ postalCode: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="رقم المبنى (العنوان الوطني)">
              <input value={ext.buildingNo} onChange={(e) => p({ buildingNo: e.target.value })} className={inputCls} dir="ltr" />
            </Field>
          </div>
        </div>
      </div>
    </div>
  )
}

/** سطر مسير قابل للتحرير — قيم نصية تُحوَّل عند الترحيل */
interface DraftLine {
  employeeId: number
  base: string
  allowances: string
  overtime: string
  deductions: string
  advances: string
  excessPaid: string // صرف مستحق زيادة مصاريف العهدة مع الراتب
  /** صرف عمولات الموظف المستحقة مع الراتب — كاملة أو لا شيء (تصفية 2116) */
  payCommissions: boolean
}

export function EmployeesPage({ initialTab = 'staff' }: { initialTab?: 'staff' | 'payroll' | 'advances' | 'deductions' | 'commissions' }) {
  /* قسم مستقل بتابات داخلية (طلب المالك ㉘): التابات تُبدَّل من الشاشة نفسها،
     والمسار الخارجي (initialTab) يحدد التاب الابتدائي فقط */
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const { employees, payrollRuns, journal, employeeAdvances, employeeDeductions, advanceRepayments, staffCommissions, getDriverDueBalance, sales, cars, projects, leases, properties, addEmployee, updateEmployee, removeEmployee, postPayroll, grantEmployeeAdvance, getEmployeeAdvanceBalance, getEmployeeDeductionBalance, getEmployeeExcessDue, addEmployeeDeduction, repayEmployeeAdvance, waiveEmployeeDeduction, addStaffCommission, payStaffCommission, cancelStaffCommission, updateStaffCommissionAmount, getStaffCommissionsDue, roleOverrides, customRoles } = useDataStore()
  // تجاوز سقف الخصم 50% من الراتب (قوانين العمل) — اعتماد مشرف موثق بالاسم
  const dedOverrideApproval = useSupervisorApproval('trs.payment.approve')
  // العفو عن جزاء عملية حساسة — نفس صلاحية الاعتماد
  const waiveApproval = useSupervisorApproval('trs.payment.approve')
  const { setup } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toMajor = (m: number) => (m ? String(m / 10 ** cur.decimals) : '')

  /* ── حالة قسائم الرواتب (طلب المالك) ── */
  const payrollSlips = useDataStore((state) => state.payrollSlips)
  const accruePayrollSlips = useDataStore((state) => state.accruePayrollSlips)
  const payPayrollSlip = useDataStore((state) => state.payPayrollSlip)
  /* الربط بالحضور (طلب المالك ㉘): خصومات وأجر إضافي من بيانات الحضور والإجازات */
  const getAttendancePayrollImpact = useDataStore((state) => state.getAttendancePayrollImpact)
  const getMonthlyAttendance = useDataStore((state) => state.getMonthlyAttendance)
  const attendanceRecords = useDataStore((state) => state.attendanceRecords)
  /* جسر الحضور ⑤: أسماء المحددين بلا أي سجل حضور في شهر المسير — تحذير صريح قبل الترحيل */
  const [slipNoAttendance, setSlipNoAttendance] = useState<string[] | null>(null)
  const [slipMonth, setSlipMonth] = useState(() => new Date().toISOString().slice(0, 7))
  /* كشف حساب الموظف (طلب المالك: يُعامل كالعميل) */
  const getEmployeeBalance = useDataStore((state) => state.getEmployeeBalance)
  const getEmployeeStatementRows = useDataStore((state) => state.getEmployeeStatementRows)
  const [statementFor, setStatementFor] = useState<number | null>(null)
  const [slipDraftOpen, setSlipDraftOpen] = useState(false)
  const [slipSearch, setSlipSearch] = useState('')
  const [slipScope, setSlipScope] = useState<'all' | 'selected'>('all')
  const [slipRows, setSlipRows] = useState<{ employeeId: number; name: string; on: boolean; gross: number; allowances: number; deductions: number; advance: number }[]>([])
  useEffect(() => {
    if (!slipDraftOpen) return
    setSlipRows(employees.filter((employee) => employee.active !== false).map((employee) => ({
      employeeId: employee.id, name: employee.nameAr, on: true,
      gross: employee.baseSalaryMinor ?? 0, allowances: 0, deductions: 0, advance: 0,
    })))
  }, [employees, slipDraftOpen])
  /* بحث الموظف داخل المسير: تُعرض قسيمته وحده (طلب المالك) */
  const visibleSlipRows = slipRows.filter((row) => {
    const term = slipSearch.trim()
    if (term && !row.name.includes(term)) return false
    if (slipScope === 'selected' && !row.on) return false
    return true
  })
  const patchSlipRow = (employeeId: number, patch: Partial<{ on: boolean; gross: number; allowances: number; deductions: number; advance: number }>) =>
    setSlipRows((rows) => rows.map((row) => (row.employeeId === employeeId ? { ...row, ...patch } : row)))
  /**
   * «احتساب من الحضور» (طلب المالك ㉘): يملأ خصومات الغياب/التأخير والإجازة بلا
   * أجر وبدل الإضافي من بيانات الشبكة الشهرية — بنود مرئية قابلة للتعديل قبل
   * الترحيل، لا خصم صامت. يعمل فوق أي قيم يدوية موجودة (يستبدل الخصومات).
   */
  const applyAttendanceImpact = () => {
    const impacts = new Map(getAttendancePayrollImpact(slipMonth).map((row) => [row.employeeId, row]))
    let touched = 0
    setSlipRows((rows) => rows.map((row) => {
      const impact = impacts.get(row.employeeId)
      if (!impact) return row
      touched += 1
      return {
        ...row,
        deductions: impact.absenceDeductionMinor + impact.unpaidLeaveDeductionMinor + impact.lateDeductionMinor,
        allowances: (row.allowances || 0) + impact.overtimeAllowanceMinor,
      }
    }))
    toast.show(touched
      ? `احتُسبت بنود الحضور لـ${touched} موظف — راجعها قبل الترحيل (خصم غياب/تأخير + بدل إضافي)`
      : 'لا بيانات حضور لهذا الشهر — سجّلها من «شؤون الموظفين» أولاً')
  }
  const accrueSlips = () => {
    /* جسر الحضور ⑤ (جولة «اكمل ونفذ»): لا ترحيل أعمى لمسير شهرٍ بلا أي سجلات
       حضور لمحددينه — تحذير صريح بالأسماء، والقرار النهائي للمالك بموافقة ثانية */
    const chosen = slipRows.filter((row) => row.on)
    const withRecords = new Set(attendanceRecords.filter((r) => r.date.startsWith(slipMonth)).map((r) => r.employeeId))
    const missing = chosen.filter((row) => !withRecords.has(row.employeeId)).map((row) => row.name)
    if (missing.length > 0 && slipNoAttendance == null) {
      setSlipNoAttendance(missing)
      toast.show(`تحذير: ${missing.length} من المحددَدين بلا أي سجل حضور في ${slipMonth} — أكّد الترحيل رغم ذلك`)
      return
    }
    setSlipNoAttendance(null)
    try {
      const rows = slipRows.filter((row) => row.on).map((row) => ({
        employeeId: row.employeeId, grossMinor: row.gross, allowancesMinor: row.allowances,
        deductionsMinor: row.deductions, advanceMinor: row.advance,
      }))
      const slips = accruePayrollSlips({ month: slipMonth, rows })
      toast.show(`استُحقت ${slips.length} قسيمة لشهر ${slipMonth} — كل موظف بذمة مستقلة`)
      setSlipDraftOpen(false)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const paySlip = (slipId: number) => {
    try {
      const slip = payPayrollSlip(slipId, { treasury: '1101' })
      toast.show(`صُرف راتب ${slip.employeeName} (${slip.slipNumber}) بقيد مستقل`)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const roleOptions = useMemo(
    () => visibleRolesForModules(rolesWithOverrides(roleOverrides, customRoles, setup.activityId), setup.modules).filter((role) => !role.isOwner),
    [roleOverrides, customRoles, setup.activityId, setup.modules],
  )

  /* ─── تبويب العمولات (طلب المالك): مربوطة بالعمليات وتُصرف منفردة أو مع الراتب ─── */
  const [comOpen, setComOpen] = useState(false)
  const [comEmployeeId, setComEmployeeId] = useState(0)
  const [comSource, setComSource] = useState<StaffCommissionSource>('manual')
  const [comSourceId, setComSourceId] = useState('')
  const [comAmount, setComAmount] = useState('')
  const [comDesc, setComDesc] = useState('')
  const [comPayId, setComPayId] = useState<number | null>(null)
  const [comPayTreasury, setComPayTreasury] = useState('1101')
  const saveCommission = () => {
    try {
      const c = addStaffCommission({
        employeeId: comEmployeeId,
        source: comSource,
        sourceId: comSourceId.trim() ? Number(comSourceId) : null,
        description: comDesc.trim(),
        amountMinor: toMinor(comAmount, cur.decimals),
      })
      toast.show(`سُجلت العمولة ${c.code} — حُمّلت مصروفاً وتُصرف منفردة أو مع الراتب ✓`)
      setComOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── تبويب السلف (طلب المالك) ─── */
  const [advOpen, setAdvOpen] = useState(false)
  const [advEmployeeId, setAdvEmployeeId] = useState(0)
  const [advAmount, setAdvAmount] = useState('')
  const [advTreasury, setAdvTreasury] = useState('1101')
  const [advNotes, setAdvNotes] = useState('')

  /* ─── تبويب الخصومات والجزاءات (إصلاح فجوة الرواتب) ─── */
  const [dedOpen, setDedOpen] = useState(false)
  const [dedEmployeeId, setDedEmployeeId] = useState(0)
  const [dedAmount, setDedAmount] = useState('')
  const [dedReason, setDedReason] = useState('')
  const [dedNotes, setDedNotes] = useState('')
  const saveDeduction = () => {
    try {
      const ded = addEmployeeDeduction({
        employeeId: dedEmployeeId,
        amountMinor: toMinor(dedAmount, cur.decimals),
        reason: dedReason.trim(),
        notes: dedNotes.trim(),
      })
      toast.show(`سُجل الخصم ${ded.dedNumber} — يُخصم من مسير الرواتب (كامل أو جزء بحريتك) ✓`)
      setDedOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── سداد نقدي لسلفة خارج المسير ─── */
  const [repayOpen, setRepayOpen] = useState(false)
  const [repayEmployeeId, setRepayEmployeeId] = useState(0)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayTreasury, setRepayTreasury] = useState('1101')
  const saveRepayment = () => {
    try {
      const rp = repayEmployeeAdvance({
        employeeId: repayEmployeeId,
        amountMinor: toMinor(repayAmount, cur.decimals),
        treasury: repayTreasury,
      })
      toast.show(`سُدد ${rp.repayNumber} نقداً — انخفض متبقي سلف الموظف ✓`)
      setRepayOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  const saveAdvance = () => {
    try {
      const adv = grantEmployeeAdvance({
        employeeId: advEmployeeId,
        amountMinor: toMinor(advAmount || '0', cur.decimals),
        treasury: advTreasury,
        notes: advNotes.trim(),
      })
      toast.show(`صُرفت السلفة ${adv.advanceNumber} — تُسترد من مسير الرواتب (خانة «سلف») ✓`)
      setAdvOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ─── تبويب الموظفين ─── */
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  /* المسمى الوظيفي يتبع مجال النشاط (طلب المالك) */
  const jobTitleSuggestions = jobTitlesFor(setup.activityId)
  const jobFieldLabel = jobTitleLabel(setup.activityId)
  const [roleId, setRoleId] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [baseSalary, setBaseSalary] = useState('')
  const [allowances, setAllowances] = useState('')
  const [active, setActive] = useState(true)
  const [notes, setNotes] = useState('')
  const [ext, setExt] = useState<PartyExtended>(EMPTY_EXTENDED)

  const filtered = useMemo(
    () => employees.filter((e) => !query.trim() || e.nameAr.includes(query) || e.phone.includes(query) || e.jobTitle.includes(query) || matchesPartyCode(query, 'EMP', e.id)),
    [employees, query],
  )

  const openNew = () => {
    setEditing(null); setName(''); setPhone(''); setJobTitle(''); setRoleId(roleOptions[0]?.id ?? 'accountant'); setHireDate(new Date().toISOString().slice(0, 10))
    setBaseSalary(''); setAllowances(''); setActive(true); setNotes(''); setExt(EMPTY_EXTENDED); setOpen(true)
  }
  const openEdit = (e: Employee) => {
    const suggestedRole = e.roleId ?? suggestRoleForJobTitle(e.jobTitle)
    setEditing(e); setName(e.nameAr); setPhone(e.phone); setJobTitle(e.jobTitle); setRoleId(roleOptions.some((role) => role.id === suggestedRole) ? suggestedRole : (roleOptions[0]?.id ?? 'accountant')); setHireDate(e.hireDate)
    setBaseSalary(toMajor(e.baseSalaryMinor)); setAllowances(toMajor(e.allowancesMinor)); setActive(e.active); setNotes(e.notes)
    setExt({
      taxNumber: e.taxNumber, commercialReg: e.commercialReg, email: e.email, address: e.address,
      city: e.city, postalCode: e.postalCode, buildingNo: e.buildingNo, nationalId: e.nationalId,
    })
    setOpen(true)
  }
  const save = () => {
    if (!name.trim()) return
    const data = {
      nameAr: name.trim(), phone: phone.trim(), jobTitle: jobTitle.trim(), roleId: roleId || null, hireDate,
      baseSalaryMinor: baseSalary ? toMinor(baseSalary, cur.decimals) : 0,
      allowancesMinor: allowances ? toMinor(allowances, cur.decimals) : 0,
      active, notes: notes.trim(),
      ...ext,
    }
    if (editing) { updateEmployee(editing.id, data); toast.show('تم تعديل بيانات الموظف') }
    else { addEmployee(data); toast.show(`تم إضافة الموظف «${data.nameAr}»`) }
    setOpen(false)
  }
  const remove = (e: Employee) => {
    try { removeEmployee(e.id); toast.show(`حُذف «${e.nameAr}»`) }
    catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── تبويب المسيرات ─── */
  const [runOpen, setRunOpen] = useState(false)
  /** نطاق المسير (طلب المالك): «all» كل الموظفين كما كان، و«single» موظف واحد بالبحث */
  const [runScope, setRunScope] = useState<'all' | 'single'>('all')
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [payMode, setPayMode] = useState<PayrollPayMode>('cash')
  const [paySource, setPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [runNotes, setRunNotes] = useState('')
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [runFilter, setRunFilter] = useState('')
  const [viewingRun, setViewingRun] = useState<PayrollRun | null>(null)
  const runEntry = viewingRun ? journal.find((e) => e.id === viewingRun.journalEntryId) : null

  const draftLineFor = (employee: Employee): DraftLine => ({
    employeeId: employee.id,
    base: toMajor(employee.baseSalaryMinor),
    allowances: toMajor(employee.allowancesMinor),
    overtime: '', deductions: '', advances: '', excessPaid: '', payCommissions: false,
  })
  /** أُسند راتب هذا الشهر لهذا الموظف من قبل؟ (يمنع التكرار قبل الترحيل) */
  const paidThisMonth = (employeeId: number, forMonth: string) =>
    payrollRuns.some((run) => run.month === forMonth && run.lines.some((line) => line.employeeId === employeeId))

  const resetRunHeader = () => {
    setMonth(new Date().toISOString().slice(0, 7))
    setPayMode('cash'); setPaySource(DEFAULT_PAY_SOURCE); setRunNotes(''); setRunFilter('')
  }
  const openRun = () => {
    const activeStaff = employees.filter((e) => e.active)
    if (activeStaff.length === 0) return toast.show('لا يوجد موظفون على رأس العمل — أضفهم أولاً', 'error')
    const thisMonth = new Date().toISOString().slice(0, 7)
    setRunScope('all')
    setDraft(activeStaff.filter((employee) => !paidThisMonth(employee.id, thisMonth)).map(draftLineFor))
    resetRunHeader()
    setRunOpen(true)
  }
  /** مسير راتب موظف واحد — يفتح فارغاً وتبحث أنت عن الموظف (طلب المالك) */
  const openSingleRun = () => {
    if (employees.filter((e) => e.active).length === 0) return toast.show('لا يوجد موظفون على رأس العمل — أضفهم أولاً', 'error')
    setRunScope('single')
    setDraft([])
    resetRunHeader()
    setRunOpen(true)
  }
  const pickSingleEmployee = (employeeId: number) => {
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee) return
    if (paidThisMonth(employee.id, month)) {
      toast.show(`صُرف راتب ${monthLabelAr(month)} لـ«${employee.nameAr}» من قبل — اختر شهراً آخر`, 'error')
      return
    }
    setDraft([draftLineFor(employee)])
  }
  /** إعادة تعبئة مسير «كل الموظفين» عند تغيير الشهر — يستبعد من صُرف له بالفعل */
  const refillAll = (forMonth: string) => {
    if (runScope !== 'all') return
    setDraft(employees.filter((employee) => employee.active && !paidThisMonth(employee.id, forMonth)).map(draftLineFor))
  }
  const patchDraft = (id: number, patch: Partial<DraftLine>) =>
    setDraft((d) => d.map((l) => (l.employeeId === id ? { ...l, ...patch } : l)))
  const dropDraft = (id: number) => setDraft((d) => d.filter((l) => l.employeeId !== id))

  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)
  const draftTotals = useMemo(() => {
    let gross = 0, ded = 0, excess = 0, commissions = 0, driverDues = 0
    for (const l of draft) {
      gross += toM(l.base) + toM(l.allowances) + toM(l.overtime)
      ded += toM(l.deductions) + toM(l.advances)
      excess += toM(l.excessPaid)
      if (l.payCommissions) {
        commissions += getStaffCommissionsDue(l.employeeId).totalMinor
        driverDues += getDriverDueBalance(l.employeeId) // عمولات نقلات السائقين (2111)
      }
    }
    const net = gross - ded
    return { gross, ded, excess, commissions, driverDues, net, payout: net + excess + commissions + driverDues }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, cur.decimals])

  /** كل أرقام سطر المسير في مكان واحد — يستخدمها الجدول الشامل وبطاقة الموظف الواحد */
  const payrollRowData = (line: DraftLine) => {
    const gross = toM(line.base) + toM(line.allowances) + toM(line.overtime)
    const cut = toM(line.deductions) + toM(line.advances)
    const salesCommissionsDue = getStaffCommissionsDue(line.employeeId).totalMinor
    // بلاغ المالك: عمولة سائق اللوجستيات (مستحقات النقلات على 2111) لم تكن تظهر بالمسير
    const driverDuesDue = getDriverDueBalance(line.employeeId)
    const commissionsDue = salesCommissionsDue + driverDuesDue
    const excessDue = getEmployeeExcessDue(line.employeeId)
    const advanceBalance = getEmployeeAdvanceBalance(line.employeeId)
    const deductionBalance = getEmployeeDeductionBalance(line.employeeId)
    const net = gross - cut
    return {
      employee: employees.find((e) => e.id === line.employeeId),
      gross, cut, net, commissionsDue, salesCommissionsDue, driverDuesDue, excessDue, advanceBalance, deductionBalance,
      payout: net + toM(line.excessPaid) + (line.payCommissions ? commissionsDue : 0),
      advanceReasons: advanceBalance.advances.filter((a) => a.amountMinor > a.recoveredMinor)
        .map((a) => `${a.advanceNumber}${a.source === 'custody_shortage' ? ' (عجز عهدة)' : ''}: متبقٍ ${fmt(a.amountMinor - a.recoveredMinor)}${a.notes ? ` — ${a.notes}` : ''}`)
        .join('\n'),
      deductionReasons: deductionBalance.deductions.filter((d) => d.amountMinor > d.recoveredMinor)
        .map((d) => `${d.dedNumber}: ${d.reason} — متبقٍ ${fmt(d.amountMinor - d.recoveredMinor)}`)
        .join('\n'),
    }
  }
  /** الموظفون المعروضون في جدول المسير بعد بحث المستخدم داخل النافذة */
  const visibleDraft = useMemo(() => draft.filter((line) => {
    const employee = employees.find((e) => e.id === line.employeeId)
    return matchesSearch([employee?.nameAr, employee?.jobTitle, partyCode('EMP', line.employeeId)], runFilter)
  }), [draft, employees, runFilter])
  /** موظفون على رأس العمل خارج المسير الحالي — لإعادة إدراج من استُبعد */
  const draftCandidates = useMemo(
    () => employees.filter((employee) => employee.active && !draft.some((line) => line.employeeId === employee.id) && !paidThisMonth(employee.id, month)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, draft, month, payrollRuns],
  )

  const saveRun = () => {
    try {
      const lines: PayrollLineInput[] = draft.map((l) => ({
        employeeId: l.employeeId,
        baseMinor: toM(l.base),
        allowancesMinor: toM(l.allowances),
        overtimeMinor: toM(l.overtime),
        deductionsMinor: toM(l.deductions),
        advancesMinor: toM(l.advances),
        excessPaidMinor: toM(l.excessPaid),
        commissionsPaidMinor: l.payCommissions ? getStaffCommissionsDue(l.employeeId).totalMinor : 0,
        driverDuesPaidMinor: l.payCommissions ? getDriverDueBalance(l.employeeId) : 0,
      }))
      const post = (overrideBy?: string) => {
        const run = postPayroll({
          month, payMode,
          treasury: paySource.kind === 'treasury' ? paySource.treasury : '1101',
          custodyFileId: paySource.kind === 'custody' ? paySource.custodyFileId : null,
          lines, notes: runNotes.trim(),
          ...(overrideBy ? { deductionOverrideBy: overrideBy } : {}),
        })
        toast.show(`رُحّل مسير ${run.runNumber} — صافي ${fmt(run.totals.netMinor)} ${cur.symbol} ✅`)
        setRunOpen(false)
      }
      try {
        post()
      } catch (err) {
        // سقف الخصم 50% (قوانين العمل): نطلب اعتماد المشرف بالرقم السري ثم نعيد الترحيل باسمه
        if ((err as Error).message.includes('50%')) {
          toast.show((err as Error).message, 'error')
          dedOverrideApproval.request((approvedBy) => {
            try { post(approvedBy) } catch (e2) { toast.show((e2 as Error).message, 'error') }
          })
          return
        }
        throw err
      }
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const listedRuns = useMemo(() => [...payrollRuns].reverse(), [payrollRuns])
  const empName = (id: number) => employees.find((e) => e.id === id)?.nameAr ?? `موظف #${id}`



  const sectionMeta = {
    staff: ['الموظفون', employees], payroll: ['المرتبات', payrollRuns], advances: ['سلف الموظفين', employeeAdvances],
    deductions: ['الخصومات والجزاءات', employeeDeductions], commissions: ['عمولات الموظفين', staffCommissions],
  } as const
  const exportSection = () => {
    const [name, rows] = sectionMeta[tab]
    const blob = new Blob([toCsv(rows as unknown as Record<string, unknown>[])], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-black">{sectionMeta[tab][0]}</h1><Btn variant="ghost" onClick={exportSection}><Download size={14}/> تصدير Excel</Btn></div>
      {/* إدارة القسم بالكامل من مكان واحد (طلب المالك ㉘): تابات داخلية للتبديل الفوري
          بين سجلات الموظفين ورواتبهم وسلفهم وخصوماتهم وعمولاتهم */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-card-dark" role="tablist" data-employees-tabs>
        {([
          ['staff', 'الموظفون', UserCog], ['payroll', 'المرتبات والقسائم', Banknote], ['advances', 'السلف', HandCoins],
          ['deductions', 'الخصومات والجزاءات', Percent], ['commissions', 'العمولات', BadgeCheck],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-bold transition-all ${
              tab === id ? 'bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/hr/attendance')}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] font-bold text-teal-600 transition-all hover:bg-teal-500/10 dark:text-teal-300">
          <CalendarCheck2 size={14} /> الحضور والإجازات
        </button>
      </div>
      {tab === 'advances' && (
        <>
          <div className="anim-up flex items-center justify-between flex-wrap gap-2">
            <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
              💡 السلفة تُصرف من الخزينة وتُقيَّد على الموظف (حساب «سلف وعهد الموظفين») —
              وتُسترد تلقائياً حين تكتبها في خانة «سلف» بمسير الرواتب. رصيد كل موظف في
              <b> التقارير ← كشوف الحساب</b>.
            </p>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => { setRepayEmployeeId(employees[0]?.id ?? 0); setRepayAmount(''); setRepayTreasury('1101'); setRepayOpen(true) }} disabled={employeeAdvances.length === 0}>
                💵 سداد نقدي لسلفة
              </Btn>
              <Btn onClick={() => { setAdvEmployeeId(employees[0]?.id ?? 0); setAdvAmount(''); setAdvTreasury('1101'); setAdvNotes(''); setAdvOpen(true) }} disabled={employees.length === 0}>
                <Plus size={15} /> صرف سلفة
              </Btn>
            </div>
          </div>
          {employeeAdvances.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <EmptyState icon="💸" title="لا سلف بعد" sub="صرف سلفة لموظف يولّد قيداً فورياً ويظهر في كشف حسابه" />
            </div>
          ) : (
            <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 font-bold">السلفة</th>
                    <th className="px-4 py-3 font-bold">الموظف</th>
                    <th className="px-4 py-3 font-bold">المبلغ</th>
                    <th className="px-4 py-3 font-bold">المسترد</th>
                    <th className="px-4 py-3 font-bold">المتبقي</th>
                    <th className="px-4 py-3 font-bold">المصدر</th>
                    <th className="px-4 py-3 font-bold">القيد</th>
                  </tr>
                </thead>
                <tbody>
                  {[...employeeAdvances].reverse().map((a, i) => (
                    <tr key={a.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-white">{a.advanceNumber}</div>
                        <div className="text-[11px] text-slate-400">{a.date.slice(0, 10)}{a.notes && ` · ${a.notes}`}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{employees.find((e) => e.id === a.employeeId)?.nameAr ?? '—'}</td>
                      <td className="px-4 py-3 font-black text-rose-500">{fmt(a.amountMinor)}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600" title={advanceRepayments.some((r) => r.employeeId === a.employeeId) ? 'يشمل سداداً نقدياً خارج المسير' : 'استقطاع من مسيرات الرواتب'}>{a.recoveredMinor ? fmt(a.recoveredMinor) : '—'}</td>
                      <td className="px-4 py-3">
                        {a.amountMinor - (a.recoveredMinor ?? 0) === 0
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">مُسدَّدة ✓</span>
                          : <span className="font-black text-amber-600">{fmt(a.amountMinor - (a.recoveredMinor ?? 0))}</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">
                        {a.source === 'custody_shortage'
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">عجز عهدة</span>
                          : (ACCOUNT_NAMES[a.treasury] ?? a.treasury)}
                      </td>
                      <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 font-bold">#{a.journalEntryId}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal open={repayOpen} onClose={() => setRepayOpen(false)} title="سداد نقدي لسلفة (خارج المسير)" subtitle="مستند سداد: الموظف يردّ سلفته نقداً قبل المسير">
            <div className="space-y-4"><DocSectionHead step="١" title="الموظف والمبلغ المسدَّد" hint="السداد يقلّل ذمة الموظف ولا يُعد إيراداً" />
              <Field label="الموظف *">
                <PartyQuickPicker parties={employees} value={repayEmployeeId} onChange={setRepayEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
              </Field>
              {repayEmployeeId > 0 && (
                <div className="text-[12px] rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 font-bold">
                  متبقي سلف الموظف: {fmt(getEmployeeAdvanceBalance(repayEmployeeId).remainingMinor)} {cur.symbol}
                </div>
              )}
              <Field label={`المبلغ المسدد (${cur.symbol}) *`} hint="قيد فوري: الخزينة ← سلف وعهد الموظفين 1107">
                <input value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
              <Field label="إلى أي خزينة؟"><TreasuryPicker value={repayTreasury} onChange={setRepayTreasury} /></Field>
              <DocOutcome>الأثر: <b>الخزينة/البنك</b> مديناً بالمبلغ · <b>1107 سلف وعهد الموظفين</b> دائناً — فيقل متبقي السلفة فوراً ولا يمسّ مصروف الرواتب.</DocOutcome>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setRepayOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveRepayment} shortcut="F9" disabled={!repayEmployeeId || !repayAmount.trim()}>💾 تسجيل السداد</Btn>
              </div>
            </div>
          </Modal>
          <Modal open={advOpen} onClose={() => setAdvOpen(false)} title="صرف سلفة لموظف" subtitle="مستند سلفة: مبلغ على حساب الموظف يُخصم لاحقاً">
            <div className="space-y-4"><DocSectionHead step="١" title="الموظف والمبلغ ومصدر الصرف" hint="السلفة ذمة على الموظف لا مصروف على المنشأة" />
              <Field label="الموظف *">
                <PartyQuickPicker parties={employees} value={advEmployeeId} onChange={setAdvEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
              </Field>
              <Field label={`المبلغ (${cur.symbol}) *`}>
                <input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} dir="ltr" autoFocus />
              </Field>
              <Field label="من أي خزينة/بنك؟">
                <TreasuryPicker value={advTreasury} onChange={setAdvTreasury} />
              </Field>
              <Field label="ملاحظات">
                <input value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} className={inputCls} placeholder="سلفة عيد، ظرف طارئ…" />
              </Field>
              <DocOutcome>الأثر: <b>1107 سلف الموظفين</b> مديناً بالمبلغ · <b>الخزينة</b> دائناً · ويُخصم من المسير أو يُسدَّد نقداً لاحقاً.</DocOutcome><div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setAdvOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveAdvance} shortcut="F9" disabled={!advEmployeeId || !advAmount.trim()}>💾 صرف السلفة</Btn>
              </div>
            </div>
          </Modal>
        </>
      )}

      {tab === 'deductions' && (
        <>
          <div className="anim-up flex items-center justify-between flex-wrap gap-2">
            <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
              ⚖️ سجّل الجزاء (غياب، تأخير، تلفيات…) بمستند مرقم — <b>بلا قيد فوري</b>:
              يتحقق محاسبياً عند مسير الرواتب حيث تخصمه <b>كاملاً أو جزءاً أو تؤجله</b> بحرية،
              والمتبقي يظل متتبَّعاً للشهور التالية.
            </p>
            <Btn onClick={() => { setDedEmployeeId(employees[0]?.id ?? 0); setDedAmount(''); setDedReason(''); setDedNotes(''); setDedOpen(true) }} disabled={employees.length === 0}>
              <Plus size={15} /> تسجيل خصم / جزاء
            </Btn>
          </div>
          {employeeDeductions.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <EmptyState icon="⚖️" title="لا خصومات مسجلة" sub="سجّل جزاء بمستند مرقم يُخصم من المسيرات على دفعات بحريتك" />
            </div>
          ) : (
            <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 font-bold">الخصم</th>
                    <th className="px-4 py-3 font-bold">الموظف</th>
                    <th className="px-4 py-3 font-bold">السبب</th>
                    <th className="px-4 py-3 font-bold">المبلغ</th>
                    <th className="px-4 py-3 font-bold">المخصوم</th>
                    <th className="px-4 py-3 font-bold">المتبقي</th>
                    <th className="px-4 py-3 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...employeeDeductions].reverse().map((d, i) => (
                    <tr key={d.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-white">{d.dedNumber}</div>
                        <div className="text-[11px] text-slate-400">{d.date.slice(0, 10)}{d.notes && ` · ${d.notes}`}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{employees.find((e) => e.id === d.employeeId)?.nameAr ?? '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">{d.reason}</td>
                      <td className="px-4 py-3 font-black text-rose-500">{fmt(d.amountMinor)}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600">{d.recoveredMinor ? fmt(d.recoveredMinor) : '—'}</td>
                      <td className="px-4 py-3">
                        {(d.waivedMinor ?? 0) > 0
                          ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold" title={`عفا عنه ${d.waivedBy ?? ''} — ${d.waivedReason ?? ''}`}>معفو عنه ({d.waivedBy}) ✓</span>
                          : d.amountMinor - d.recoveredMinor === 0
                            ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">خُصم بالكامل ✓</span>
                            : <span className="font-black text-amber-600">{fmt(d.amountMinor - d.recoveredMinor)}</span>}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {d.amountMinor - d.recoveredMinor - (d.waivedMinor ?? 0) > 0 && (
                          <button
                            title="عفو/إلغاء المتبقي (تسجيل خاطئ أو صفح) — يتطلب اعتماد المشرف"
                            onClick={() => waiveApproval.request((approvedBy) => {
                              try {
                                waiveEmployeeDeduction({ deductionId: d.id, approvedBy: approvedBy ?? 'المالك', reason: 'عفو معتمد من الشاشة' })
                                toast.show(`عُفي عن متبقي ${d.dedNumber} — لن يُخصم من المسيرات ✓`)
                              } catch (e2) { toast.show((e2 as Error).message, 'error') }
                            })}
                            className="text-[11px] px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-colors"
                          >🕊️ عفو</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal open={dedOpen} onClose={() => setDedOpen(false)} title="تسجيل خصم / جزاء على موظف" subtitle="مستند خصم: جزاء يُخصم من مستحقات الراتب">
            <div className="space-y-4"><DocSectionHead step="١" title="الموظف وقيمة الخصم وسببه" hint="الخصم يقلّل مصروف الرواتب ولا يُعد إيراداً" />
              <Field label="الموظف *">
                <PartyQuickPicker parties={employees} value={dedEmployeeId} onChange={setDedEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
              </Field>
              <Field label={`مبلغ الخصم (${cur.symbol}) *`}>
                <input value={dedAmount} onChange={(e) => setDedAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
              <Field label="السبب *" hint="غياب، تأخير متكرر، تلفيات، جزاء إداري…">
                <input value={dedReason} onChange={(e) => setDedReason(e.target.value)} className={inputCls} placeholder="غياب 3 أيام بدون إذن" />
              </Field>
              <Field label="ملاحظات">
                <input value={dedNotes} onChange={(e) => setDedNotes(e.target.value)} className={inputCls} />
              </Field>
              <div className="text-[11px] text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 leading-relaxed">
                💡 لا يتولد قيد الآن — عند ترحيل المسير يدخل الخصم ضمن خانة «خصومات»
                فيقل مصروف الرواتب (5102) بالمبلغ المخصوم تلقائياً.
              </div>
              <DocOutcome>الأثر: يُخصم من صافي مستحق الموظف في المسير القادم، ويظهر في كشف حسابه بسببه الموثّق.</DocOutcome><div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setDedOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveDeduction} shortcut="F9" disabled={!dedEmployeeId || !dedAmount.trim() || !dedReason.trim()}>💾 تسجيل الخصم</Btn>
              </div>
            </div>
          </Modal>
        </>
      )}

      {tab === 'commissions' && (
        <>
          <div className="anim-up flex items-center justify-between gap-3">
            <div className="text-[12px] text-slate-400 leading-relaxed">
              عمولة الموظف تُسجل <b>مربوطة بعمليتها</b> (عقد إيجار/بيع عقار/فاتورة…) وتُحمَّل مصروفاً (5117)
              لحظة الاستحقاق فتدخل الأرباح والخسائر فوراً — ثم تُصرف <b>منفردة</b> بسند أو <b>مع الراتب</b> من خانة «عمولات» في المسير.
            </div>
            <Btn onClick={() => {
              if (employees.filter((e) => e.active).length === 0) return toast.show('لا يوجد موظفون نشطون', 'error')
              setComEmployeeId(employees.find((e) => e.active)?.id ?? 0)
              setComSource('manual'); setComSourceId(''); setComAmount(''); setComDesc(''); setComOpen(true)
            }}><span className="flex items-center gap-1.5"><Plus size={15} /> عمولة جديدة</span></Btn>
          </div>
          {staffCommissions.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <EmptyState icon="🤝" title="لا عمولات بعد" sub="سجّل عمولة موظف عن عملية إيجار أو بيع أو أي مستند — وستتبع صرفها هنا" />
            </div>
          ) : (
            <div className="anim-up overflow-x-auto rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 font-bold">العمولة</th>
                    <th className="px-4 py-3 font-bold">الموظف</th>
                    <th className="px-4 py-3 font-bold">العملية</th>
                    <th className="px-4 py-3 font-bold">المبلغ</th>
                    <th className="px-4 py-3 font-bold">الحالة</th>
                    <th className="px-4 py-3 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...staffCommissions].reverse().map((c, i) => (
                    <tr key={c.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-white">{c.code}</div>
                        <div className="text-[11px] text-slate-400">{c.date} · {c.description}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{employees.find((e) => e.id === c.employeeId)?.nameAr ?? '—'}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">{STAFF_COMMISSION_SOURCE_LABELS[c.source]}{c.sourceId != null && ` #${c.sourceId}`}</td>
                      <td className="px-4 py-3 font-black text-violet-600">{fmt(c.amountMinor)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${c.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : c.status === 'cancelled' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-600'}`}
                          title={c.status === 'paid' ? (c.payoutMode === 'payroll' ? 'صُرفت ضمن مسير رواتب' : 'صُرفت بسند منفرد') : c.status === 'cancelled' ? c.cancelReason : 'بانتظار الصرف'}>
                          {STAFF_COMMISSION_STATUS_LABELS[c.status].icon} {STAFF_COMMISSION_STATUS_LABELS[c.status].nameAr}
                          {c.status === 'paid' && (c.payoutMode === 'payroll' ? ' (مع الراتب)' : ' (منفردة)')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        {c.status === 'accrued' && (
                          <>
                            <button title="صرف منفرد الآن من الخزينة" onClick={() => setComPayId(c.id)}
                              className="text-[11px] px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors">💵 صرف</button>
                            <button title="تعديل المبلغ (إلغاء + استحقاق جديد بأثر تدقيقي)" onClick={() => {
                              const raw = prompt(`المبلغ الجديد لـ${c.code} (${cur.symbol}):`, String(c.amountMinor / 10 ** cur.decimals))
                              if (raw == null || !raw.trim()) return
                              const reason = prompt('سبب التعديل:')
                              if (reason == null || !reason.trim()) return toast.show('سبب التعديل مطلوب', 'error')
                              try {
                                const nc = updateStaffCommissionAmount({ commissionId: c.id, newAmountMinor: toMinor(raw, cur.decimals), reason: reason.trim() })
                                toast.show(`عُدلت — العمولة الجديدة ${nc.code} ✓`)
                              } catch (e2) { toast.show((e2 as Error).message, 'error') }
                            }} className="text-[11px] px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-colors">✏️ تعديل</button>
                            <button title="إلغاء العمولة (قيد عاكس + سبب موثق)" onClick={() => {
                              const reason = prompt(`سبب إلغاء ${c.code}:`)
                              if (reason == null || !reason.trim()) return
                              try {
                                cancelStaffCommission({ commissionId: c.id, reason: reason.trim() })
                                toast.show(`أُلغيت ${c.code} بقيد عاكس ✓`)
                              } catch (e2) { toast.show((e2 as Error).message, 'error') }
                            }} className="text-[11px] px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors">🚫 إلغاء</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal open={comOpen} onClose={() => setComOpen(false)} title="استحقاق عمولة موظف عن عملية" subtitle="مستند استحقاق: عمولة مرتبطة بعمليتها تدخل الأرباح لحظة الاستحقاق">
            <div className="space-y-4"><DocSectionHead step="١" title="الموظف والعملية المرتبطة" hint="لا عمولة معلّقة في الهواء — لكل عمولة مستندها" />
              <Field label="الموظف *">
                <PartyQuickPicker parties={employees.filter((employee) => employee.active)} value={comEmployeeId} onChange={setComEmployeeId} cashLabel="اختر الموظف" label="بحث الموظف" showCash={false} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="نوع العملية *">
                  <QuickSelect value={comSource} onChange={(e) => { setComSource(e.target.value as StaffCommissionSource); setComSourceId('') }} className={inputCls}>
                    {Object.entries(STAFF_COMMISSION_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </QuickSelect>
                </Field>
                <Field label="المستند" hint="اختر المستند من قائمته — لا كتابة أرقام يدوية">
                  {comSource === 'manual' ? (
                    <input value="" className={inputCls} placeholder="— يدوية بلا مستند —" disabled />
                  ) : (
                    <QuickSelect value={comSourceId} onChange={(e) => setComSourceId(e.target.value)} className={inputCls}>
                      <option value="">— اختر —</option>
                      {comSource === 'sale' && sales.slice(-80).reverse().map((x) => <option key={x.id} value={x.id}>{x.invoiceNumber} — {new Date(x.date).toLocaleDateString('ar-EG')}</option>)}
                      {comSource === 'car_sale' && cars.map((x) => <option key={x.id} value={x.id}>{x.make} {x.model} {x.year} — {x.plateOrVin}</option>)}
                      {comSource === 'project' && projects.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.nameAr}</option>)}
                      {comSource === 'lease' && leases.map((x) => <option key={x.id} value={x.id}>{x.contractNumber} — {x.tenantName}</option>)}
                      {comSource === 'property_sale' && properties.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
                    </QuickSelect>
                  )}
                </Field>
              </div>
              <DocSectionHead step="٢" title="قيمة العمولة وبيانها" hint="البيان يظهر في القيد وكشف متابعة العمولات" />
              <Field label={`مبلغ العمولة (${cur.symbol}) *`}>
                <input value={comAmount} onChange={(e) => setComAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
              <Field label="البيان *" hint="يظهر في القيد وكشوف المتابعة">
                <input value={comDesc} onChange={(e) => setComDesc(e.target.value)} className={inputCls} placeholder="عمولة تأجير وحدة A-3 — عقد LC-0007" />
              </Field>
              <div className="text-[11px] text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 leading-relaxed">
                💡 يتولد فوراً قيد استحقاق: <b>مصروف عمولات موظفين (5117)</b> ← <b>عمولات مستحقة (2116)</b>
                — فتنخفض أرباح الفترة بالعمولة من لحظة العملية، والصرف لاحقاً تصفية لا مصروف جديد.
              </div>
              <DocOutcome>الأثر: <b>5117 عمولات موظفين</b> مديناً · <b>2116 عمولات مستحقة</b> دائناً — ولا نقدية تتحرك الآن؛ الصرف لاحقاً يقفل الالتزام.</DocOutcome>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setComOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveCommission} shortcut="F9" disabled={!comEmployeeId || !comAmount.trim() || !comDesc.trim()}>💾 استحقاق العمولة</Btn>
              </div>
            </div>
          </Modal>
          <Modal open={comPayId != null} onClose={() => setComPayId(null)} title="صرف عمولة منفردة" subtitle="مستند صرف: تصفية عمولة مستحقة سبق قيدها">
            <div className="space-y-4"><DocSectionHead step="١" title="العمولة المستحقة ومصدر الصرف" hint="الصرف تصفية التزام لا مصروف جديد" />
              {(() => {
                const c = staffCommissions.find((x) => x.id === comPayId)
                if (!c) return null
                return <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{c.code} — {employees.find((e) => e.id === c.employeeId)?.nameAr}: <span className="text-violet-600 font-black">{fmt(c.amountMinor)}</span></div>
              })()}
              <Field label="الصرف من *"><TreasuryPicker value={comPayTreasury} onChange={setComPayTreasury} /></Field>
              <DocOutcome>الأثر: <b>2116 عمولات مستحقة</b> مديناً بقيمة العمولة · <b>الخزينة/البنك</b> دائناً — ولا يتكرر تحميل <b>5117</b> مرة ثانية.</DocOutcome>
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setComPayId(null)}>إلغاء</Btn>
                <Btn onClick={() => {
                  try {
                    const c = payStaffCommission({ commissionId: comPayId!, treasury: comPayTreasury })
                    toast.show(`صُرفت ${c.code} من الخزينة ✓`)
                    setComPayId(null)
                  } catch (e2) { toast.show((e2 as Error).message, 'error') }
                }}>💵 صرف الآن</Btn>
              </div>
            </div>
          </Modal>
        </>
      )}

      {tab === 'staff' && (
        <>
          <div className="anim-up flex gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف أو الوظيفة أو الكود (EMP-0001)…" className={`${inputCls} pr-10`} />
            </div>
            <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> موظف جديد</span></Btn>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <EmptyState icon="👥" title="لا يوجد موظفون بعد" sub="أضف موظفيك ثم رحّل مسير الرواتب من التبويب المجاور" />
            </div>
          ) : (
            <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">الموظف</th>
                    <th className="px-4 py-3 text-right font-bold">الوظيفة</th>
                    <th className="px-4 py-3 text-right font-bold">الفئة / الصلاحية</th>
                    <th className="px-4 py-3 text-right font-bold">الهاتف</th>
                    <th className="px-4 py-3 text-right font-bold">الأساسي + البدلات</th>
                    <th className="px-4 py-3 text-right font-bold">الحالة</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{e.nameAr}</td>
                      <td className="px-4 py-3 text-slate-500">{e.jobTitle || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{roleOptions.find((role) => role.id === e.roleId)?.nameAr ?? e.roleId ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500" dir="ltr">{e.phone ? <span className="flex items-center gap-1 justify-end"><Phone size={11} />{e.phone}</span> : '—'}</td>
                      <td className="px-4 py-3 font-bold">{fmt(e.baseSalaryMinor + e.allowancesMinor)} {cur.symbol}</td>
                      <td className="px-4 py-3">
                        {e.active
                          ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full"><BadgeCheck size={11} /> على رأس العمل</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 bg-slate-500/10 px-2 py-0.5 rounded-full"><BadgeX size={11} /> موقوف</span>}
                      </td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        {/* كشف حساب فوري بجانب كل موظف (طلب المالك) */}
                        <button title="كشف حساب الموظف (سلف واستقطاعات)" onClick={() => navigate(`/reports/statements?kind=employee&id=${e.id}`)} className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all duration-200 hover:scale-110"><FileSpreadsheet size={14} /></button>
                        <button title="كشف حساب الموظف — رواتب وسلف وسندات" aria-label={`كشف حساب ${e.nameAr}`}
                          data-employee-statement-open={e.id} onClick={() => setStatementFor(e.id)}
                          className="p-2 rounded-lg text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-600">
                          <FileSpreadsheet size={16} />
                        </button>
                        <button title="تعديل بيانات الموظف" onClick={() => openEdit(e)} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110"><Pencil size={14} /></button>
                        <button title="حذف الموظف" onClick={() => remove(e)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'payroll' && (
        <>
          {/* ── قسائم الرواتب: ذمة مستقلة لكل موظف (طلب المالك) ── */}
          <section className="anim-up rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-card-dark" data-payroll-slips>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black">قسائم الرواتب — لكل موظف ذمة مستقلة</h3>
                <p className="text-[11px] text-slate-500">
                  الاستحقاق قيد واحد بسطر دائن لكل موظف على 2104، والصرف قيد مستقل لكل قسيمة — فتصرف راتب موظف اليوم وآخر غداً بلا خلل.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input type="month" className={inputCls + ' w-36'} value={slipMonth} onChange={(event) => setSlipMonth(event.target.value)} aria-label="شهر الاستحقاق" />
                <Btn onClick={() => setSlipDraftOpen(true)} disabled={!employees.length}>
                  <span className="flex items-center gap-1.5"><Plus size={15} /> استحقاق قسائم</span>
                </Btn>
              </div>
            </div>

      <Modal open={slipDraftOpen} onClose={() => setSlipDraftOpen(false)} title="مسير رواتب — قسائم الموظفين" wide>
              <div className="space-y-3" dir="rtl" data-slip-draft>
                <div className="grid gap-2 md:grid-cols-3">
                  <Field label="شهر الاستحقاق">
                    <input type="month" className={inputCls} value={slipMonth} onChange={(event) => setSlipMonth(event.target.value)} aria-label="شهر المسير" />
                  </Field>
                  <Field label="ابحث عن موظف" hint="اكتب اسم الموظف — تُعرض قسيمته وحده">
                    <input className={inputCls} value={slipSearch} onChange={(event) => setSlipSearch(event.target.value)}
                      placeholder="اسم الموظف…" aria-label="بحث الموظف في المسير" data-slip-search />
                  </Field>
                  <Field label="نطاق المسير">
                    <QuickSelect className={inputCls} aria-label="نطاق المسير" value={slipScope} onChange={(event) => setSlipScope(event.target.value as 'all' | 'selected')}>
                      <option value="all">كل الموظفين النشطين</option>
                      <option value="selected">المحدَّدون فقط</option>
                    </QuickSelect>
                  </Field>
                </div>

                <table className="w-full text-[12px]">
                  <thead className="text-[11px] font-black text-slate-500">
                    <tr><th className="p-1">الموظف</th><th className="p-1 w-24">الأساسي</th><th className="p-1 w-24">بدلات</th><th className="p-1 w-24">خصومات</th><th className="p-1 w-24">سلف</th><th className="p-1 w-24">الصافي</th></tr>
                  </thead>
                  <tbody>
                    {visibleSlipRows.length === 0 && (
                      <tr><td colSpan={6} className="p-4 text-center text-slate-400">لا موظف مطابق لبحثك</td></tr>
                    )}
                    {visibleSlipRows.map((row) => {
                      const net = Math.max(0, row.gross + row.allowances - row.deductions - row.advance)
                      return (
                        <tr key={row.employeeId} data-slip-row={row.employeeId}>
                          <td className="p-1">
                            <label className="flex items-center gap-1">
                              <input type="checkbox" checked={row.on} onChange={(event) => patchSlipRow(row.employeeId, { on: event.target.checked })} aria-label={`اختيار ${row.name}`} />
                              {row.name}
                            </label>
                          </td>
                          {(['gross', 'allowances', 'deductions', 'advance'] as const).map((field) => (
                            <td className="p-1" key={field}>
                              <input className={inputCls} inputMode="decimal" value={String(row[field] / 100)}
                                aria-label={`${field} ${row.name}`}
                                onChange={(event) => patchSlipRow(row.employeeId, { [field]: Math.round((Number(event.target.value) || 0) * 100) })} />
                            </td>
                          ))}
                          <td className="p-1 text-center font-mono font-bold">{fmt(net)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] text-slate-500">
                    المحدَّد: <b>{slipRows.filter((row) => row.on).length}</b> موظف · إجمالي الصافي{' '}
                    <b className="font-mono">{fmt(slipRows.filter((row) => row.on).reduce((sum, row) => sum + Math.max(0, row.gross + row.allowances - row.deductions - row.advance), 0))}</b>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {/* الربط بالحضور (طلب المالك ㉘): بنود مرئية من الشبكة الشهرية — لا خصم صامت */}
                    <Btn variant="soft" onClick={applyAttendanceImpact} data-apply-attendance title="يملأ خصم الغياب والتأخير والإجازة بلا أجر وبدل الإضافي من بيانات الحضور لهذا الشهر">
                      <span className="flex items-center gap-1.5"><CalendarCheck2 size={15} /> احتساب من الحضور</span>
                    </Btn>
                    <Btn variant="ghost" onClick={() => setSlipDraftOpen(false)}>إلغاء</Btn>
                    <Btn onClick={accrueSlips}>ترحيل الاستحقاق</Btn>
                  </div>
                </div>
              </div>
            </Modal>

            {/* جسر الحضور ⑤: تحذير صريح قبل ترحيل مسير شهرٍ بلا سجلات حضور — لا خصم صامت ولا ترحيل أعمى */}
            <Modal open={slipNoAttendance != null} onClose={() => setSlipNoAttendance(null)} title={`ترحيل مسير ${slipMonth} بلا بيانات حضور؟`}>
              <div className="space-y-3" data-slip-attendance-warning>
                <p className="text-[13px] font-bold text-amber-600">
                  ⚠ {slipNoAttendance?.length ?? 0} من الموظفين المحددين ليس لديهم أي سجل حضور في هذا الشهر:
                </p>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-300 rounded-xl bg-amber-500/10 p-2" data-slip-attendance-names>
                  {slipNoAttendance?.join('، ')}
                </p>
                <p className="text-[11.5px] text-slate-500 leading-relaxed">
                  معنى ذلك أن غيابهم وتأخيرهم لن يُحتسب في هذه القسائم. سجّل الحضور أولاً من «شؤون الموظفين ← الحضور اليومي»
                  أو استورد ملف البصمة، ثم اضغط «احتساب من الحضور» — أو رحّل كما هو إن كان هذا قصدك.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Btn variant="ghost" onClick={() => setSlipNoAttendance(null)}>رجوع لمراجعة المسير</Btn>
                  <Btn variant="danger" onClick={() => { accrueSlips() }} data-slip-force>الترحيل رغم ذلك</Btn>
                </div>
              </div>
            </Modal>

            <table className="mt-3 w-full text-[12px]" data-slips-table>
              <thead className="text-[11px] font-black text-slate-500">
                <tr><th className="p-1">القسيمة</th><th className="p-1">الموظف</th><th className="p-1">الشهر</th><th className="p-1">الصافي</th><th className="p-1">الحالة</th><th className="p-1">إجراء</th></tr>
              </thead>
              <tbody>
                {payrollSlips.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-[12px] text-slate-400">لا قسائم بعد — استحق مسيراً لموظف أو أكثر وستظهر هنا بذمة مستقلة لكل موظف.</td></tr>
                )}
                {payrollSlips.slice().reverse().map((slip) => (
                  <tr key={slip.id} className="border-t border-slate-200/70 dark:border-slate-700/60" data-slip={slip.slipNumber}>
                    <td className="p-1 text-center font-mono font-bold">{slip.slipNumber}</td>
                    <td className="p-1 text-center">{slip.employeeName}</td>
                    <td className="p-1 text-center font-mono">{slip.month}</td>
                    <td className="p-1 text-center font-mono font-bold">{fmt(slip.netMinor)}</td>
                    <td className="p-1 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${slip.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : slip.status === 'cancelled' ? 'bg-slate-500/10 text-slate-500' : 'bg-amber-500/10 text-amber-600'}`}>
                        {slip.status === 'paid' ? 'مصروفة' : slip.status === 'cancelled' ? 'ملغاة' : 'مستحقة'}
                      </span>
                    </td>
                    <td className="p-1 text-center">
                      {slip.status === 'accrued' && (
                        <Btn variant="ghost" onClick={() => paySlip(slip.id)} data-pay-slip={slip.slipNumber}>صرف الآن</Btn>
                      )}
                      {slip.status === 'paid' && <span className="text-[11px] text-slate-400">{(slip.paidAt ?? '').slice(0, 10)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="anim-up flex flex-wrap justify-end gap-2">
            <Btn variant="ghost" onClick={openSingleRun}><span className="flex items-center gap-1.5"><UserSearch size={15} /> مسير راتب موظف واحد</span></Btn>
            <Btn onClick={openRun}><span className="flex items-center gap-1.5"><Plus size={15} /> مسير رواتب لكل الموظفين</span></Btn>
          </div>

          {listedRuns.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
              <EmptyState icon="💰" title="لا مسيرات رواتب بعد" sub="كل مسير يتولّد له قيد متوازن تلقائياً: رواتب وأجور → خزينة أو رواتب مستحقة" />
            </div>
          ) : (
            <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">المسير</th>
                    <th className="px-4 py-3 text-right font-bold">الشهر</th>
                    <th className="px-4 py-3 text-right font-bold">الموظفون</th>
                    <th className="px-4 py-3 text-right font-bold">الصرف</th>
                    <th className="px-4 py-3 text-right font-bold">الصافي</th>
                    <th className="px-4 py-3 text-right font-bold">القيد</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {listedRuns.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3 font-bold text-brand-600">{r.runNumber}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-bold">{monthLabelAr(r.month)}</td>
                      <td className="px-4 py-3 text-slate-500">{r.totals.employeeCount}</td>
                      <td className="px-4 py-3">
                        {r.payMode === 'cash'
                          ? <span className="text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">نقدي — {ACCOUNT_NAMES[r.treasury]}</span>
                          : <span className="text-[11px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">استحقاق (2104)</span>}
                      </td>
                      <td className="px-4 py-3 font-black">{fmt(r.totals.netMinor)} {cur.symbol}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] text-rose-500 font-bold"><BookOpenText size={11} /> #{r.journalEntryId}</span>
                      </td>
                      <td className="px-4 py-3 text-left">
                        <button onClick={() => setViewingRun(r)} className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><Eye size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* نموذج موظف */}
      {/* كشف حساب الموظف — نفس منطق كشف العميل */}
      <Modal open={statementFor != null} onClose={() => setStatementFor(null)} wide
        title={`كشف حساب — ${employees.find((employee) => employee.id === statementFor)?.nameAr ?? ''}`}>
        {statementFor != null && (() => {
          const rows = getEmployeeStatementRows(statementFor)
          let running = 0
          return (
            <div className="space-y-2" dir="rtl" data-employee-statement>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl doc-tint p-2 text-[12px]">
                <span>عدد الحركات: <b>{rows.length}</b></span>
                <span>
                  الرصيد الحالي:{' '}
                  <b className={getEmployeeBalance(statementFor) < 0 ? 'text-rose-600' : 'text-emerald-600'} data-statement-balance>
                    {fmt(Math.abs(getEmployeeBalance(statementFor)))} {getEmployeeBalance(statementFor) < 0 ? '(عليه للمنشأة)' : '(له على المنشأة)'}
                  </b>
                </span>
              </div>
              {/* جسر الحضور ④ (جولة «اكمل ونفذ»): ملخص حضور الشهر الجاري وأثره المالي داخل الكشف الموحد */}
              {(() => {
                const monthNow = new Date().toISOString().slice(0, 7)
                const employee = employees.find((e) => e.id === statementFor)
                if (!employee || employee.active === false) return null
                const summary = getMonthlyAttendance(statementFor, monthNow)
                const impact = getAttendancePayrollImpact(monthNow, [statementFor])[0]
                const net = impact?.netAdjustmentMinor ?? 0
                const hasAny = summary.recordedDays > 0 || summary.paidLeaveDays > 0 || summary.unpaidLeaveDays > 0
                return (
                  <div className="rounded-xl border border-slate-200 p-2 text-[11.5px] leading-relaxed dark:border-slate-700" data-employee-attendance>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <b>حضور {monthNow}:</b>
                      {hasAny ? (
                        <>
                          <span>حاضر {summary.presentDays} · غياب {summary.absentDays} · إجازة مدفوعة {summary.paidLeaveDays} · بلا أجر {summary.unpaidLeaveDays} · مأمورية {summary.missionDays}</span>
                          <span className={net < 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                            أثر الشهر على الراتب: {net < 0 ? '−' : '+'}{fmt(Math.abs(net))}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">لا سجلات حضور هذا الشهر — يُرحَّل الراتب كاملاً ما لم تُسجَّل الغيابات</span>
                      )}
                    </div>
                    {impact && impact.notes.length > 0 && <p className="mt-1 text-slate-500">{impact.notes.join(' · ')} — تُطبَّق عبر زر «احتساب من الحضور» في مسير الرواتب</p>}
                  </div>
                )
              })()}
              <table className="w-full text-[12px]">
                <thead className="text-[11px] font-black text-slate-500">
                  <tr><th className="p-1">التاريخ</th><th className="p-1">المرجع</th><th className="p-1">البيان</th><th className="p-1 w-24">مدين</th><th className="p-1 w-24">دائن</th><th className="p-1 w-28">الرصيد</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">لا حركات على حساب هذا الموظف بعد</td></tr>}
                  {rows.map((row, index) => {
                    running += row.creditMinor - row.debitMinor
                    return (
                      <tr key={`${row.ref}-${index}`} className="border-t border-slate-200/70 dark:border-slate-700/60" data-statement-row>
                        <td className="p-1 text-center font-mono text-[11px]">{row.date}</td>
                        <td className="p-1 text-center font-mono">{row.ref}</td>
                        <td className="p-1">{row.description}</td>
                        <td className="p-1 text-center font-mono">{row.debitMinor ? fmt(row.debitMinor) : '—'}</td>
                        <td className="p-1 text-center font-mono">{row.creditMinor ? fmt(row.creditMinor) : '—'}</td>
                        <td className={`p-1 text-center font-mono font-bold ${running < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(Math.abs(running))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })()}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل «${editing.nameAr}»` : 'موظف جديد'} wide subtitle="ملف موظف: بياناته وراتبه الأساسي وبدلاته — مرجع كل مسير قادم">
        <div className="space-y-4"><DocSectionHead step="١" title="بيانات الموظف وراتبه" hint="الراتب والبدلات هنا هي ما يملأ المسير تلقائياً" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم الموظف *">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
            </Field>
            <Field label="الهاتف">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
            </Field>
            <Field label={jobFieldLabel}>
              {/* المسميات تتغيّر حسب النشاط (طلب المالك) — والحقل يبقى حراً */}
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputCls}
                list="job-titles-by-activity" data-job-title
                placeholder={jobTitleSuggestions.slice(0, 3).join('، ') + '…'} />
              <datalist id="job-titles-by-activity">
                {jobTitleSuggestions.map((title) => <option key={title} value={title} />)}
              </datalist>
            </Field>
            <Field label="الفئة / الدور التشغيلي *" hint="يحدد صلاحيات حساب الدخول تلقائياً عند إنشائه من الإعدادات — لا ينشئ حساباً أو رقماً سرياً هنا">
              <QuickSelect value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputCls}>
                {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="تاريخ التعيين">
              <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label={`الراتب الأساسي الشهري (${cur.symbol})`}>
              <input value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`بدلات شهرية ثابتة (${cur.symbol})`} hint="سكن، مواصلات… تُملأ تلقائياً في المسير">
              <input value={allowances} onChange={(e) => setAllowances(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-brand-400/50 transition-colors">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">على رأس العمل (يدخل في مسير الرواتب)</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-brand-600" />
          </label>

          <ExtendedFields ext={ext} setExt={setExt} />

          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!name.trim()}>💾 حفظ</Btn>
          </div>
        </div>
      </Modal>

      {/* نموذج مسير الرواتب — أعيد تصميمه (طلب المالك): رأس مرتب، بحث داخل المسير،
          جدول عملي بأعمدة مجمّعة وصف إجماليات، ونمط «موظف واحد» ببطاقة راتب كاملة */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title={runScope === 'single' ? 'مسير راتب موظف واحد' : 'مسير رواتب شامل'} extraWide subtitle="مستند مسير: استحقاق الشهر ثم خصم السلف والجزاءات ثم الصرف نقداً أو تأجيله استحقاقاً">
        <div className="space-y-4">
          {/* 1) بيانات المسير */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-brand-500/10 px-4 py-2.5">
              <b className="text-[13px] text-brand-700 dark:text-brand-300">① بيانات المسير</b>
              <div className="flex gap-1.5">
                {([['all', 'كل الموظفين'], ['single', 'موظف واحد']] as const).map(([scope, label]) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => {
                      setRunScope(scope)
                      setRunFilter('')
                      setDraft(scope === 'all' ? employees.filter((employee) => employee.active && !paidThisMonth(employee.id, month)).map(draftLineFor) : [])
                    }}
                    className={`rounded-lg px-3 py-1 text-[11px] font-bold transition-all ${runScope === scope ? 'bg-brand-600 text-white' : 'bg-white/70 dark:bg-slate-800 text-slate-500'}`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <Field label="شهر الاستحقاق" hint={`يُصرف مرة واحدة لكل موظف في ${monthLabelAr(month)}`}>
                <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); refillAll(e.target.value) }} className={inputCls} dir="ltr" />
              </Field>
              <Field label="طريقة الصرف">
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => setPayMode('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payMode === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي فوري</button>
                  <button onClick={() => setPayMode('accrue')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payMode === 'accrue' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>استحقاق</button>
                </div>
              </Field>
              {payMode === 'cash' ? (
                <Field label="الصرف من" hint="خزينة/بنك — أو عهدة موظف مفتوحة">
                  <PaySourcePicker value={paySource} onChange={setPaySource} />
                </Field>
              ) : (
                <div className="self-end rounded-xl bg-amber-500/10 p-3 text-[11px] text-amber-600">
                  يُقيَّد على «رواتب مستحقة 2104» ويُسدَّد لاحقاً بسند صرف
                </div>
              )}
            </div>
          </section>

          {/* 2) الموظفون */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-500/5 px-4 py-2.5">
              <b className="text-[13px] text-slate-700 dark:text-slate-200">② {runScope === 'single' ? 'الموظف' : `الموظفون المدرجون (${draft.length})`}</b>
              {runScope === 'all' && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={runFilter} onChange={(e) => setRunFilter(e.target.value)} placeholder="بحث داخل المسير بالاسم أو الكود" className="h-8 w-56 rounded-lg border border-slate-200 bg-transparent pr-7 text-[11px] outline-none focus:border-brand-500 dark:border-slate-700" />
                  </div>
                  <button type="button" onClick={() => refillAll(month)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:border-brand-400 dark:border-slate-700">إعادة إدراج الكل</button>
                </div>
              )}
            </div>

            {runScope === 'single' ? (
              <div className="space-y-3 p-4">
                <Field label="ابحث عن الموظف بالاسم أو الكود أو الهاتف *" hint="مسير هذا الموظف وحده — لا يفتح باقي الحسابات">
                  <PartyQuickPicker
                    parties={employees.filter((employee) => employee.active).map((employee) => ({ id: employee.id, nameAr: employee.nameAr, phone: employee.phone, active: employee.active }))}
                    value={draft[0]?.employeeId ?? 0}
                    onChange={pickSingleEmployee}
                    cashLabel="اختر الموظف"
                    label="بحث الموظف"
                    showCash={false}
                    partyInfo={(party) => ({ code: partyCode('EMP', party.id), balance: paidThisMonth(party.id, month) ? `صُرف راتب ${monthLabelAr(month)}` : '' })}
                  />
                </Field>
                {draft.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-[12px] text-slate-400 dark:border-slate-700">اكتب أول حرف من اسم الموظف لاختياره — ثم تظهر بطاقة راتبه كاملة.</div>}
              </div>
            ) : draft.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-slate-400">لا موظف مدرج — كل من على رأس العمل صُرف راتب هذا الشهر، أو استبعدتهم يدوياً.</div>
            ) : null}

            {draft.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-[12px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/80">
                    <tr className="text-[10px] text-slate-500">
                      <th className="px-3 py-2 text-right font-black">الموظف</th>
                      <th className="px-2 py-2 font-black text-emerald-700 dark:text-emerald-300">الأساسي</th>
                      <th className="px-2 py-2 font-black text-emerald-700 dark:text-emerald-300">بدلات</th>
                      <th className="px-2 py-2 font-black text-emerald-700 dark:text-emerald-300">إضافي</th>
                      <th className="px-2 py-2 font-black">الإجمالي</th>
                      <th className="px-2 py-2 font-black text-rose-600">خصومات</th>
                      <th className="px-2 py-2 font-black text-rose-600">سلف</th>
                      <th className="px-2 py-2 font-black text-sky-600">مستحق عهدة</th>
                      <th className="px-2 py-2 font-black text-violet-600">عمولات</th>
                      <th className="px-2 py-2 font-black">المصروف للموظف</th>
                      <th className="px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDraft.map((l, rowIndex) => {
                      const row = payrollRowData(l)
                      const cell = 'h-9 w-[5.5rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-1 text-center text-[12px] font-bold tabular-nums outline-none focus:border-brand-500 disabled:opacity-40'
                      const quick = 'mx-auto mt-0.5 block text-[9.5px] font-bold hover:underline'
                      return (
                        <tr key={l.employeeId} className={`border-t border-slate-100 dark:border-slate-800 ${rowIndex % 2 ? 'bg-slate-500/[0.03]' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-[11px] font-black text-brand-700 dark:text-brand-300">{(row.employee?.nameAr ?? '؟').slice(0, 1)}</span>
                              <span className="min-w-0">
                                <b className="block truncate text-[12px] text-slate-700 dark:text-slate-200">{row.employee?.nameAr ?? empName(l.employeeId)}</b>
                                <span className="block text-[9.5px] text-slate-400">{partyCode('EMP', l.employeeId)}{row.employee?.jobTitle ? ` · ${row.employee.jobTitle}` : ''}</span>
                              </span>
                            </div>
                          </td>
                          <td className="px-1 py-2 text-center"><input value={l.base} onChange={(e) => patchDraft(l.employeeId, { base: e.target.value })} className={cell} dir="ltr" aria-label={`الأساسي ${row.employee?.nameAr ?? ''}`} /></td>
                          <td className="px-1 py-2 text-center"><input value={l.allowances} onChange={(e) => patchDraft(l.employeeId, { allowances: e.target.value })} className={cell} dir="ltr" aria-label={`بدلات ${row.employee?.nameAr ?? ''}`} /></td>
                          <td className="px-1 py-2 text-center"><input value={l.overtime} onChange={(e) => patchDraft(l.employeeId, { overtime: e.target.value })} className={cell} dir="ltr" placeholder="0" aria-label={`إضافي ${row.employee?.nameAr ?? ''}`} /></td>
                          <td className="px-2 py-2 text-center font-black tabular-nums text-slate-600 dark:text-slate-300">{fmt(row.gross)}</td>
                          <td className="px-1 py-2 text-center">
                            <input value={l.deductions} onChange={(e) => patchDraft(l.employeeId, { deductions: e.target.value })} className={cell} dir="ltr" placeholder="0" title={row.deductionBalance.remainingMinor > 0 ? `جزاءات مسجلة غير مخصومة: ${fmt(row.deductionBalance.remainingMinor)}\nاكتب المبلغ كاملاً أو جزءاً — أو 0 للتأجيل` : 'اكتب أي خصم مباشر لهذا الشهر'} />
                            {row.deductionBalance.remainingMinor > 0 && (
                              <button type="button" onClick={() => patchDraft(l.employeeId, { deductions: String(row.deductionBalance.remainingMinor / 10 ** cur.decimals) })} title={row.deductionReasons} className={`${quick} text-rose-500`}>جزاءات {fmt(row.deductionBalance.remainingMinor)}</button>
                            )}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <input value={l.advances} onChange={(e) => patchDraft(l.employeeId, { advances: e.target.value })} className={cell} dir="ltr" placeholder="0" title={row.advanceReasons || 'لا سلف على الموظف'} disabled={row.advanceBalance.remainingMinor === 0} />
                            {row.advanceBalance.remainingMinor > 0 && (
                              <button type="button" onClick={() => patchDraft(l.employeeId, { advances: String(row.advanceBalance.remainingMinor / 10 ** cur.decimals) })} title={`إجمالي السلف ${fmt(row.advanceBalance.totalMinor)}\n${row.advanceReasons}`} className={`${quick} text-amber-600`}>متبقٍ {fmt(row.advanceBalance.remainingMinor)}</button>
                            )}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <input value={l.excessPaid} onChange={(e) => patchDraft(l.employeeId, { excessPaid: e.target.value })} className={cell} dir="ltr" placeholder="0" disabled={row.excessDue === 0} title={row.excessDue > 0 ? `مستحق الموظف من زيادات مصاريف عهده: ${fmt(row.excessDue)}` : 'لا مستحقات عهد'} />
                            {row.excessDue > 0 && (
                              <button type="button" onClick={() => patchDraft(l.employeeId, { excessPaid: String(row.excessDue / 10 ** cur.decimals) })} className={`${quick} text-emerald-600`}>له {fmt(row.excessDue)}</button>
                            )}
                          </td>
                          <td className="px-1 py-2 text-center">
                            {row.commissionsDue === 0 ? <span className="text-[10px] text-slate-300">—</span> : (
                              <label className="flex cursor-pointer flex-col items-center gap-0.5" title={`عمولات مستحقة: ${fmt(row.commissionsDue)} — تُصرف كاملة مع الراتب (تصفية لا مصروف جديد)`
                                + (row.driverDuesDue > 0 ? `\nمنها عمولات نقلات السائق: ${fmt(row.driverDuesDue)} (تصفية 2111)` : '')
                                + (row.salesCommissionsDue > 0 && row.driverDuesDue > 0 ? `\nوعمولات مبيعات: ${fmt(row.salesCommissionsDue)} (تصفية 2116)` : '')}>
                                <input type="checkbox" checked={l.payCommissions} onChange={(e) => patchDraft(l.employeeId, { payCommissions: e.target.checked })} className="accent-brand-600" />
                                <span className="text-[9.5px] font-bold text-violet-600">{fmt(row.commissionsDue)}</span>
                                {row.driverDuesDue > 0 && <span data-driver-dues className="text-[8.5px] font-bold text-sky-600">نقلات {fmt(row.driverDuesDue)}</span>}
                              </label>
                            )}
                          </td>
                          <td className={`px-2 py-2 text-center font-black tabular-nums whitespace-nowrap ${row.net < 0 ? 'text-rose-500' : 'text-brand-600'}`}>
                            {fmt(row.payout)}
                            {row.payout !== row.net && <span className="block text-[9px] font-bold text-slate-400">الراتب {fmt(row.net)}</span>}
                          </td>
                          <td className="px-1 py-2">
                            <button onClick={() => dropDraft(l.employeeId)} title="استبعاد من هذا المسير" className="rounded p-1 text-slate-300 transition-colors hover:text-rose-500"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      )
                    })}
                    {visibleDraft.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-[12px] text-slate-400">لا نتيجة لبحثك داخل المسير.</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-500/5 text-[11px] font-black dark:border-slate-700">
                      <td className="px-3 py-2">الإجماليات ({draft.length} موظف)</td>
                      <td className="px-2 py-2 text-center tabular-nums" colSpan={3}>—</td>
                      <td className="px-2 py-2 text-center tabular-nums">{fmt(draftTotals.gross)}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-rose-600" colSpan={2}>-{fmt(draftTotals.ded)}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-sky-600">{fmt(draftTotals.excess)}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-violet-600">{fmt(draftTotals.commissions)}</td>
                      <td className="px-2 py-2 text-center tabular-nums text-brand-600">{fmt(draftTotals.payout)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {runScope === 'all' && draftCandidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-400">إضافة موظف مستبعد:</span>
                {draftCandidates.slice(0, 8).map((employee) => (
                  <button key={employee.id} type="button" onClick={() => setDraft((d) => [...d, draftLineFor(employee)])} className="rounded-full bg-brand-500/10 px-2.5 py-1 text-[11px] font-bold text-brand-700 hover:bg-brand-500/20 dark:text-brand-300">+ {employee.nameAr}</button>
                ))}
              </div>
            )}
          </section>

          {/* 3) الملخص والترحيل */}
          <section className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-slate-500/5 px-4 py-2.5"><b className="text-[13px] text-slate-700 dark:text-slate-200">③ الملخص والترحيل</b></div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              {([
                ['إجمالي الاستحقاق', fmt(draftTotals.gross), 'text-slate-700 dark:text-slate-200'],
                ['الخصومات والسلف', `-${fmt(draftTotals.ded)}`, 'text-rose-500'],
                ['صافي الرواتب', fmt(draftTotals.net), 'text-emerald-600'],
                ['المصروف الكلي', fmt(draftTotals.payout), 'text-brand-600'],
              ] as const).map(([label, value, color]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-3 text-center dark:border-slate-700">
                  <div className={`text-lg font-black tabular-nums ${color}`}>{value}</div>
                  <div className="text-[10px] font-bold text-slate-400">{label}</div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4">
              <Field label="ملاحظات المسير">
                <input value={runNotes} onChange={(e) => setRunNotes(e.target.value)} className={inputCls} placeholder="اختياري — يظهر في وصف القيد" />
              </Field>
            </div>
            <div className="px-4 pb-3">
              <DocOutcome>
                الأثر: <b>5102 رواتب وأجور</b> مديناً بصافي المستحق مضافاً إليه ما استُرد من السلف · {payMode === 'cash' ? <><b>الخزينة/البنك</b> دائناً بصافي المصروف {fmt(draftTotals.payout)}</> : <><b>2104 رواتب مستحقة</b> دائناً بالصافي {fmt(draftTotals.net)} حتى السداد</>} · و<b>1107 سلف الموظفين</b> دائناً بما استُقطع{draftTotals.excess > 0 ? <> · و<b>2107 عهد مستحقة للموظفين</b> مديناً بتسوية الفائض</> : null}{draftTotals.commissions > 0 ? <> · و<b>2116 عمولات مستحقة</b> مديناً بتصفية عمولات الفترة</> : null}{draftTotals.driverDues > 0 ? <> · و<b>2111 مستحقات سائقين</b> مديناً بتصفية عمولات النقلات {fmt(draftTotals.driverDues)}</> : null}.
              </DocOutcome>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-500/5 px-4 py-3 dark:border-slate-800">
              <span className="text-[11px] text-slate-500">مرة واحدة لكل موظف في الشهر — التكرار مرفوض آلياً</span>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setRunOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveRun} shortcut="F9" disabled={draft.length === 0 || draftTotals.net <= 0}>💾 ترحيل المسير وتوليد القيد</Btn>
              </div>
            </div>
          </section>
        </div>
      </Modal>

      {/* عرض مسير مرحّل وقيده */}
      <Modal open={!!viewingRun} onClose={() => setViewingRun(null)} title={viewingRun ? `المسير ${viewingRun.runNumber} — ${monthLabelAr(viewingRun.month)}` : ''} wide>
        {viewingRun && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-slate-400 text-[10px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-3 py-2 text-right font-bold">الموظف</th>
                    <th className="px-2 py-2 font-bold">الأساسي</th>
                    <th className="px-2 py-2 font-bold">بدلات</th>
                    <th className="px-2 py-2 font-bold">إضافي</th>
                    <th className="px-2 py-2 font-bold">خصومات</th>
                    <th className="px-2 py-2 font-bold">سلف</th>
                    <th className="px-2 py-2 font-bold">الصافي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingRun.lines.map((l) => (
                    <tr key={l.employeeId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-1.5 font-bold text-slate-700 dark:text-slate-200">{empName(l.employeeId)}</td>
                      <td className="px-2 py-1.5 text-center">{fmt(l.baseMinor)}</td>
                      <td className="px-2 py-1.5 text-center">{fmt(l.allowancesMinor)}</td>
                      <td className="px-2 py-1.5 text-center">{fmt(l.overtimeMinor)}</td>
                      <td className="px-2 py-1.5 text-center text-rose-500">{l.deductionsMinor ? `-${fmt(l.deductionsMinor)}` : '—'}</td>
                      <td className="px-2 py-1.5 text-center text-rose-500">{l.advancesMinor ? `-${fmt(l.advancesMinor)}` : '—'}</td>
                      <td className="px-2 py-1.5 text-center font-black">{fmt(l.netMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[13px] px-1">
              <span className="text-slate-500">الصرف: {viewingRun.payMode === 'cash' ? `نقدي من ${ACCOUNT_NAMES[viewingRun.treasury]}` : 'استحقاق على رواتب مستحقة'}</span>
              <span className="flex items-baseline gap-2">
                {(viewingRun.totals.driverDuesPaidMinor ?? 0) > 0 && (
                  <span data-run-driver-dues className="text-[11px] font-bold text-sky-600">
                    منها عمولات نقلات {fmt(viewingRun.totals.driverDuesPaidMinor ?? 0)} (تصفية 2111)
                  </span>
                )}
                <span className="font-black text-lg text-brand-600">{fmt(viewingRun.totals.netMinor)} {cur.symbol}</span>
              </span>
            </div>

            {runEntry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{runEntry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {runEntry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                          {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                        </td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
      {dedOverrideApproval.dialog}
      {waiveApproval.dialog}
    </div>
  )
}
