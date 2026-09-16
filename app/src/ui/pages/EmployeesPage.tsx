/**
 * الموظفون والرواتب (المرحلة 5) — تبويبان:
 * 1) سجل الموظفين: نفس البيانات الموسعة الاختيارية للأطراف + بيانات التوظيف
 * 2) مسيرات الرواتب: مسير شهري (أساسي + بدلات + إضافي − خصومات − سلف)
 *    يترحّل بقيد متوازن بنيوياً: 5102 → خزينة (نقدي) أو 2104 (استحقاق)
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Pencil, Trash2, Phone, UserRound, ChevronDown, FileBadge, Wallet, BookOpenText, Eye, BadgeCheck, BadgeX, Landmark, FileSpreadsheet } from 'lucide-react'
import { useDataStore, EMPTY_EXTENDED, type Employee, type PayrollRun } from '../../data/repo.ts'
import type { PartyExtended } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { matchesPartyCode } from '../../core/partyCodes.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { monthLabelAr, type PayrollPayMode, type PayrollLineInput } from '../../core/payroll.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

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
}

export function EmployeesPage() {
  const { employees, payrollRuns, journal, employeeAdvances, addEmployee, updateEmployee, removeEmployee, postPayroll, grantEmployeeAdvance, getEmployeeAdvanceBalance, getEmployeeExcessDue } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const navigate = useNavigate()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const toMajor = (m: number) => (m ? String(m / 10 ** cur.decimals) : '')

  const [tab, setTab] = useState<'staff' | 'payroll' | 'advances'>('staff')

  /* ─── تبويب السلف (طلب المالك) ─── */
  const [advOpen, setAdvOpen] = useState(false)
  const [advEmployeeId, setAdvEmployeeId] = useState(0)
  const [advAmount, setAdvAmount] = useState('')
  const [advTreasury, setAdvTreasury] = useState('1101')
  const [advNotes, setAdvNotes] = useState('')
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
    setEditing(null); setName(''); setPhone(''); setJobTitle(''); setHireDate(new Date().toISOString().slice(0, 10))
    setBaseSalary(''); setAllowances(''); setActive(true); setNotes(''); setExt(EMPTY_EXTENDED); setOpen(true)
  }
  const openEdit = (e: Employee) => {
    setEditing(e); setName(e.nameAr); setPhone(e.phone); setJobTitle(e.jobTitle); setHireDate(e.hireDate)
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
      nameAr: name.trim(), phone: phone.trim(), jobTitle: jobTitle.trim(), hireDate,
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
      overtime: '', deductions: '', advances: '', excessPaid: '',
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
      }))
      const run = postPayroll({
        month, payMode,
        treasury: paySource.kind === 'treasury' ? paySource.treasury : '1101',
        custodyFileId: paySource.kind === 'custody' ? paySource.custodyFileId : null,
        lines, notes: runNotes.trim(),
      })
      toast.show(`رُحّل مسير ${run.runNumber} — صافي ${fmt(run.totals.netMinor)} ${cur.symbol} ✅`)
      setRunOpen(false)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const listedRuns = useMemo(() => [...payrollRuns].reverse(), [payrollRuns])
  const empName = (id: number) => employees.find((e) => e.id === id)?.nameAr ?? `موظف #${id}`

  const tabCls = (t: 'staff' | 'payroll' | 'advances') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-brand-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center gap-2">
        <button onClick={() => setTab('staff')} className={tabCls('staff')}><UserRound size={14} className="inline -mt-0.5 me-1" /> الموظفون ({employees.length})</button>
        <button onClick={() => setTab('payroll')} className={tabCls('payroll')}><Wallet size={14} className="inline -mt-0.5 me-1" /> مسيرات الرواتب ({payrollRuns.length})</button>
        <button onClick={() => setTab('advances')} className={tabCls('advances')}><Landmark size={14} className="inline -mt-0.5 me-1" /> السلف ({employeeAdvances.length})</button>
      </div>

      {tab === 'advances' && (
        <>
          <div className="anim-up flex items-center justify-between flex-wrap gap-2">
            <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
              💡 السلفة تُصرف من الخزينة وتُقيَّد على الموظف (حساب «سلف وعهد الموظفين») —
              وتُسترد تلقائياً حين تكتبها في خانة «سلف» بمسير الرواتب. رصيد كل موظف في
              <b> التقارير ← كشوف الحساب</b>.
            </p>
            <Btn onClick={() => { setAdvEmployeeId(employees[0]?.id ?? 0); setAdvAmount(''); setAdvTreasury('1101'); setAdvNotes(''); setAdvOpen(true) }} disabled={employees.length === 0}>
              <Plus size={15} /> صرف سلفة
            </Btn>
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
                      <td className="px-4 py-3 font-bold text-emerald-600">{a.recoveredMinor ? fmt(a.recoveredMinor) : '—'}</td>
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
                <Btn onClick={saveAdvance} disabled={!advEmployeeId || !advAmount.trim()}>💾 صرف السلفة</Btn>
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
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="المسمى الوظيفي">
              <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputCls} placeholder="كاشير، بائع، محاسب…" />
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
                      <td className="px-1 py-1.5 text-center"><input value={l.deductions} onChange={(e) => patchDraft(l.employeeId, { deductions: e.target.value })} className={cell} dir="ltr" placeholder="0" /></td>
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
                      <td className={`px-2 py-1.5 text-center font-black whitespace-nowrap ${net < 0 ? 'text-rose-500' : ''}`}>{fmt(net)}{toM(l.excessPaid) > 0 && <span className="block text-[9px] text-emerald-600 font-bold">+{fmt(toM(l.excessPaid))} عهدة</span>}</td>
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
            <Btn onClick={saveRun} disabled={draft.length === 0 || draftTotals.net <= 0}>💾 ترحيل المسير وتوليد القيد</Btn>
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
    </div>
  )
}
