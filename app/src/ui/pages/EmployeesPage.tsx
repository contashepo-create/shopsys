/**
 * الموظفون والرواتب (المرحلة 5) — تبويبان:
 * 1) سجل الموظفين: نفس البيانات الموسعة الاختيارية للأطراف + بيانات التوظيف
 * 2) مسيرات الرواتب: مسير شهري (أساسي + بدلات + إضافي − خصومات − سلف)
 *    يترحّل بقيد متوازن بنيوياً: 5102 → خزينة (نقدي) أو 2104 (استحقاق)
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Trash2, Phone, ChevronDown, FileBadge, BookOpenText, Eye, BadgeCheck, BadgeX, FileSpreadsheet, Download } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Employee, type PayrollRun } from '../../data/repo.ts'
import { rolesWithOverrides, visibleRolesForModules } from '../../core/permissions.ts'
import { suggestRoleForJobTitle } from '../../core/audit.ts'
import type { PartyExtended } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { matchesPartyCode } from '../../core/partyCodes.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { toCsv } from '../../core/security.ts'
import { monthLabelAr, type PayrollPayMode, type PayrollLineInput } from '../../core/payroll.ts'
import { STAFF_COMMISSION_SOURCE_LABELS, STAFF_COMMISSION_STATUS_LABELS, type StaffCommissionSource } from '../../core/staffCommissions.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'

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
  const { employees, payrollRuns, journal, employeeAdvances, employeeDeductions, advanceRepayments, staffCommissions, sales, cars, projects, leases, properties, addEmployee, updateEmployee, removeEmployee, postPayroll, grantEmployeeAdvance, getEmployeeAdvanceBalance, getEmployeeDeductionBalance, getEmployeeExcessDue, addEmployeeDeduction, repayEmployeeAdvance, waiveEmployeeDeduction, addStaffCommission, payStaffCommission, cancelStaffCommission, updateStaffCommissionAmount, getStaffCommissionsDue, roleOverrides, customRoles } = useDataStore()
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

  const tab = initialTab
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
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [payMode, setPayMode] = useState<PayrollPayMode>('cash')
  const [paySource, setPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [runNotes, setRunNotes] = useState('')
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [viewingRun, setViewingRun] = useState<PayrollRun | null>(null)
  const runEntry = viewingRun ? journal.find((e) => e.id === viewingRun.journalEntryId) : null

  const openRun = () => {
    const activeStaff = employees.filter((e) => e.active)
    if (activeStaff.length === 0) return toast.show('لا يوجد موظفون على رأس العمل — أضفهم أولاً', 'error')
    setDraft(activeStaff.map((e) => ({
      employeeId: e.id,
      base: toMajor(e.baseSalaryMinor),
      allowances: toMajor(e.allowancesMinor),
      overtime: '', deductions: '', advances: '', excessPaid: '', payCommissions: false,
    })))
    setMonth(new Date().toISOString().slice(0, 7))
    setPayMode('cash'); setPaySource(DEFAULT_PAY_SOURCE); setRunNotes('')
    setRunOpen(true)
  }
  const patchDraft = (id: number, patch: Partial<DraftLine>) =>
    setDraft((d) => d.map((l) => (l.employeeId === id ? { ...l, ...patch } : l)))
  const dropDraft = (id: number) => setDraft((d) => d.filter((l) => l.employeeId !== id))

  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)
  const draftTotals = useMemo(() => {
    let gross = 0, ded = 0, excess = 0
    for (const l of draft) {
      gross += toM(l.base) + toM(l.allowances) + toM(l.overtime)
      ded += toM(l.deductions) + toM(l.advances)
      excess += toM(l.excessPaid)
    }
    return { gross, ded, excess, net: gross - ded }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, cur.decimals])

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
          <Modal open={repayOpen} onClose={() => setRepayOpen(false)} title="💵 سداد نقدي لسلفة (خارج المسير)">
            <div className="space-y-4">
              <Field label="الموظف *">
                <select value={repayEmployeeId} onChange={(e) => setRepayEmployeeId(Number(e.target.value))} className={inputCls}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
                </select>
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
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setRepayOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveRepayment} shortcut="F9" disabled={!repayEmployeeId || !repayAmount.trim()}>💾 تسجيل السداد</Btn>
              </div>
            </div>
          </Modal>
          <Modal open={advOpen} onClose={() => setAdvOpen(false)} title="💸 صرف سلفة لموظف">
            <div className="space-y-4">
              <Field label="الموظف *">
                <select value={advEmployeeId} onChange={(e) => setAdvEmployeeId(Number(e.target.value))} className={inputCls}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
                </select>
              </Field>
              <Field label={`المبلغ (${cur.symbol}) *`}>
                <input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} type="number" min={0} className={inputCls} dir="ltr" autoFocus />
              </Field>
              <Field label="من أي خزينة/بنك؟">
                <TreasuryPicker value={advTreasury} onChange={setAdvTreasury} />
              </Field>
              <Field label="ملاحظات">
                <input value={advNotes} onChange={(e) => setAdvNotes(e.target.value)} className={inputCls} placeholder="سلفة عيد، ظرف طارئ…" />
              </Field>
              <div className="flex justify-end gap-2">
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
          <Modal open={dedOpen} onClose={() => setDedOpen(false)} title="⚖️ تسجيل خصم / جزاء على موظف">
            <div className="space-y-4">
              <Field label="الموظف *">
                <select value={dedEmployeeId} onChange={(e) => setDedEmployeeId(Number(e.target.value))} className={inputCls}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
                </select>
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
              <div className="flex justify-end gap-2">
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
          <Modal open={comOpen} onClose={() => setComOpen(false)} title="🤝 استحقاق عمولة موظف عن عملية">
            <div className="space-y-4">
              <Field label="الموظف *">
                <select value={comEmployeeId} onChange={(e) => setComEmployeeId(Number(e.target.value))} className={inputCls}>
                  {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="نوع العملية *">
                  <select value={comSource} onChange={(e) => { setComSource(e.target.value as StaffCommissionSource); setComSourceId('') }} className={inputCls}>
                    {Object.entries(STAFF_COMMISSION_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="المستند" hint="اختر المستند من قائمته — لا كتابة أرقام يدوية">
                  {comSource === 'manual' ? (
                    <input value="" className={inputCls} placeholder="— يدوية بلا مستند —" disabled />
                  ) : (
                    <select value={comSourceId} onChange={(e) => setComSourceId(e.target.value)} className={inputCls}>
                      <option value="">— اختر —</option>
                      {comSource === 'sale' && sales.slice(-80).reverse().map((x) => <option key={x.id} value={x.id}>{x.invoiceNumber} — {new Date(x.date).toLocaleDateString('ar-EG')}</option>)}
                      {comSource === 'car_sale' && cars.map((x) => <option key={x.id} value={x.id}>{x.make} {x.model} {x.year} — {x.plateOrVin}</option>)}
                      {comSource === 'project' && projects.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.nameAr}</option>)}
                      {comSource === 'lease' && leases.map((x) => <option key={x.id} value={x.id}>{x.contractNumber} — {x.tenantName}</option>)}
                      {comSource === 'property_sale' && properties.map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
                    </select>
                  )}
                </Field>
              </div>
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
              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setComOpen(false)}>إلغاء</Btn>
                <Btn onClick={saveCommission} shortcut="F9" disabled={!comEmployeeId || !comAmount.trim() || !comDesc.trim()}>💾 استحقاق العمولة</Btn>
              </div>
            </div>
          </Modal>
          <Modal open={comPayId != null} onClose={() => setComPayId(null)} title="💵 صرف عمولة منفردة">
            <div className="space-y-4">
              {(() => {
                const c = staffCommissions.find((x) => x.id === comPayId)
                if (!c) return null
                return <div className="text-sm font-bold text-slate-600 dark:text-slate-300">{c.code} — {employees.find((e) => e.id === c.employeeId)?.nameAr}: <span className="text-violet-600 font-black">{fmt(c.amountMinor)}</span></div>
              })()}
              <Field label="الصرف من *"><TreasuryPicker value={comPayTreasury} onChange={setComPayTreasury} /></Field>
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
          <div className="anim-up flex justify-end">
            <Btn onClick={openRun}><span className="flex items-center gap-1.5"><Plus size={15} /> مسير رواتب جديد</span></Btn>
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
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `تعديل «${editing.nameAr}»` : 'موظف جديد'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="اسم الموظف *">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
            </Field>
            <Field label="الهاتف">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
            </Field>
            <Field label="المسمى الوظيفي">
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputCls} placeholder="كاشير، بائع، محاسب…" />
            </Field>
            <Field label="الفئة / الدور التشغيلي *" hint="يحدد صلاحيات حساب الدخول تلقائياً عند إنشائه من الإعدادات — لا ينشئ حساباً أو رقماً سرياً هنا">
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputCls}>
                {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.nameAr}</option>)}
              </select>
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

      {/* نموذج مسير رواتب */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title="مسير رواتب جديد" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="الشهر">
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} dir="ltr" />
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
              <div className="text-[11px] text-amber-600 bg-amber-500/10 rounded-xl p-3 self-end">
                يُقيَّد على «رواتب مستحقة 2104» ويُسدَّد لاحقاً بسند صرف
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-slate-400 text-[10px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2 text-right font-bold">الموظف</th>
                  <th className="px-2 py-2 font-bold">الأساسي</th>
                  <th className="px-2 py-2 font-bold">بدلات</th>
                  <th className="px-2 py-2 font-bold">إضافي</th>
                  <th className="px-2 py-2 font-bold">خصومات</th>
                  <th className="px-2 py-2 font-bold">خصم سلفة</th>
                  <th className="px-2 py-2 font-bold">مستحق عهدة</th>
                  <th className="px-2 py-2 font-bold">عمولات</th>
                  <th className="px-2 py-2 font-bold">الصافي</th>
                  <th className="px-1 py-2" />
                </tr>
              </thead>
              <tbody>
                {draft.map((l) => {
                  const net = toM(l.base) + toM(l.allowances) + toM(l.overtime) - toM(l.deductions) - toM(l.advances)
                  const cell = 'w-20 px-1.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent text-center text-[12px] focus:border-brand-500 outline-none'
                  // شفافية كاملة (طلب المالك): إجمالي سلف الموظف والمتبقي منها وسببها + مستحقه من زيادات العهد
                  const advBal = getEmployeeAdvanceBalance(l.employeeId)
                  const dedBal = getEmployeeDeductionBalance(l.employeeId)
                  const excessDue = getEmployeeExcessDue(l.employeeId)
                  const advReasons = advBal.advances.filter((a) => a.amountMinor > a.recoveredMinor)
                    .map((a) => `${a.advanceNumber}${a.source === 'custody_shortage' ? ' (عجز عهدة)' : ''}: متبقٍ ${fmt(a.amountMinor - a.recoveredMinor)}${a.notes ? ` — ${a.notes}` : ''}`)
                    .join('\n')
                  return (
                    <tr key={l.employeeId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-1.5 font-bold text-slate-700 dark:text-slate-200 whitespace-nowrap">{empName(l.employeeId)}</td>
                      <td className="px-1 py-1.5 text-center"><input value={l.base} onChange={(e) => patchDraft(l.employeeId, { base: e.target.value })} className={cell} dir="ltr" /></td>
                      <td className="px-1 py-1.5 text-center"><input value={l.allowances} onChange={(e) => patchDraft(l.employeeId, { allowances: e.target.value })} className={cell} dir="ltr" /></td>
                      <td className="px-1 py-1.5 text-center"><input value={l.overtime} onChange={(e) => patchDraft(l.employeeId, { overtime: e.target.value })} className={cell} dir="ltr" placeholder="0" /></td>
                      <td className="px-1 py-1.5 text-center">
                        <input value={l.deductions} onChange={(e) => patchDraft(l.employeeId, { deductions: e.target.value })} className={cell} dir="ltr" placeholder="0" title={dedBal.remainingMinor > 0 ? `جزاءات مسجلة غير مخصومة: ${fmt(dedBal.remainingMinor)}\nاكتب المبلغ كاملاً أو جزءاً — أو 0 للتأجيل` : 'اكتب أي خصم مباشر لهذا الشهر'} />
                        {dedBal.remainingMinor > 0 && (
                          <button
                            type="button"
                            onClick={() => patchDraft(l.employeeId, { deductions: String(dedBal.remainingMinor / 10 ** cur.decimals) })}
                            title={dedBal.deductions.filter((d) => d.amountMinor > d.recoveredMinor).map((d) => `${d.dedNumber}: ${d.reason} — متبقٍ ${fmt(d.amountMinor - d.recoveredMinor)}`).join('\n')}
                            className="block mx-auto mt-0.5 text-[9.5px] font-bold text-rose-500 hover:underline"
                          >جزاءات {fmt(dedBal.remainingMinor)}</button>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input value={l.advances} onChange={(e) => patchDraft(l.employeeId, { advances: e.target.value })} className={cell} dir="ltr" placeholder="0" title={advReasons || 'لا سلف على الموظف'} disabled={advBal.remainingMinor === 0} />
                        {advBal.remainingMinor > 0 && (
                          <button
                            type="button"
                            onClick={() => patchDraft(l.employeeId, { advances: String(advBal.remainingMinor / 10 ** cur.decimals) })}
                            title={`إجمالي السلف ${fmt(advBal.totalMinor)}\n${advReasons}`}
                            className="block mx-auto mt-0.5 text-[9.5px] font-bold text-amber-600 hover:underline"
                          >متبقٍ {fmt(advBal.remainingMinor)}</button>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <input value={l.excessPaid} onChange={(e) => patchDraft(l.employeeId, { excessPaid: e.target.value })} className={cell} dir="ltr" placeholder="0" disabled={excessDue === 0} title={excessDue > 0 ? `مستحق الموظف من زيادات مصاريف عهده: ${fmt(excessDue)}` : 'لا مستحقات عهد'} />
                        {excessDue > 0 && (
                          <button
                            type="button"
                            onClick={() => patchDraft(l.employeeId, { excessPaid: String(excessDue / 10 ** cur.decimals) })}
                            className="block mx-auto mt-0.5 text-[9.5px] font-bold text-emerald-600 hover:underline"
                          >له {fmt(excessDue)}</button>
                        )}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        {(() => {
                          const commDue = getStaffCommissionsDue(l.employeeId).totalMinor
                          if (commDue === 0) return <span className="text-[10px] text-slate-300">—</span>
                          return (
                            <label className="flex flex-col items-center gap-0.5 cursor-pointer" title={`عمولات مستحقة: ${fmt(commDue)} — تُصرف كاملة مع الراتب (تصفية لا مصروف جديد)`}>
                              <input type="checkbox" checked={l.payCommissions} onChange={(e) => patchDraft(l.employeeId, { payCommissions: e.target.checked })} className="accent-brand-600" />
                              <span className="text-[9.5px] font-bold text-violet-600">{fmt(commDue)}</span>
                            </label>
                          )
                        })()}
                      </td>
                      <td className={`px-2 py-1.5 text-center font-black whitespace-nowrap ${net < 0 ? 'text-rose-500' : ''}`}>{fmt(net)}{toM(l.excessPaid) > 0 && <span className="block text-[9px] text-emerald-600 font-bold">+{fmt(toM(l.excessPaid))} عهدة</span>}{l.payCommissions && getStaffCommissionsDue(l.employeeId).totalMinor > 0 && <span className="block text-[9px] text-violet-600 font-bold">+{fmt(getStaffCommissionsDue(l.employeeId).totalMinor)} عمولات</span>}</td>
                      <td className="px-1 py-1.5">
                        <button onClick={() => dropDraft(l.employeeId)} title="استبعاد من هذا المسير" className="p-1 rounded text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
            <div className="text-[12px] text-slate-500 space-y-0.5">
              <div>إجمالي الاستحقاق: <b>{fmt(draftTotals.gross)}</b></div>
              <div>إجمالي الخصومات والسلف: <b className="text-rose-500">-{fmt(draftTotals.ded)}</b></div>
            </div>
            <div className="text-left">
              <div className="text-[11px] text-slate-400">صافي المسير</div>
              <div className="font-black text-2xl text-brand-600">{fmt(draftTotals.net)} {cur.symbol}</div>
            </div>
          </div>

          <Field label="ملاحظات">
            <input value={runNotes} onChange={(e) => setRunNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setRunOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveRun} shortcut="F9" disabled={draft.length === 0 || draftTotals.net <= 0}>💾 ترحيل المسير وتوليد القيد</Btn>
          </div>
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
              <span className="font-black text-lg text-brand-600">{fmt(viewingRun.totals.netMinor)} {cur.symbol}</span>
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
