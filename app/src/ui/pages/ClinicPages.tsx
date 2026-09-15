/**
 * صفحات العيادة (القرار 27):
 * ClinicPatientsPage — ملف لكل مريض: زيارات بملاحظات الكشف وقيمتها،
 * خطط علاج بجلسات، تحصيل متأخرات، رصيد المريض.
 * ClinicAppointmentsPage — مواعيد اليوم والقادمة.
 */
import { useMemo, useState } from 'react'
import { Plus, Stethoscope, CalendarClock, Eye, BookOpenText, Banknote, ClipboardList, CheckCircle2 } from 'lucide-react'
import { useDataStore, type ClinicPatient } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { VISIT_KIND_LABELS, patientFileSummary, type VisitKind } from '../../core/clinic.ts'
import type { Gender } from '../../core/lab.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { renderPrescriptionHtml, parsePrescriptionText } from '../print/printPrescription.ts'
import { printHtml } from '../print/printReceipt.ts'

function useCur() {
  const { setup } = useAppStore()
  return useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
}

export function ClinicPatientsPage() {
  const {
    clinicPatients, clinicVisits, treatmentPlans, journal,
    addClinicPatient, addClinicVisit, addTreatmentPlan, collectFromPatient, getPatientBalance,
  } = useDataStore()
  const { setup } = useAppStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [q, setQ] = useState('')

  /* مريض جديد */
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState<Gender>('male')
  const [birthDate, setBirthDate] = useState('')
  const [history, setHistory] = useState('')

  const savePatient = () => {
    try {
      addClinicPatient({ nameAr: nameAr.trim(), phone: phone.trim(), gender, birthDate, medicalHistory: history.trim(), notes: '' })
      toast.show('فُتح ملف المريض ✅')
      setOpen(false); setNameAr(''); setPhone(''); setGender('male'); setBirthDate(''); setHistory('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ملف المريض */
  const [file, setFile] = useState<ClinicPatient | null>(null)
  const fileVisits = file ? clinicVisits.filter((v) => v.patientId === file.id) : []
  const filePlans = file ? treatmentPlans.filter((p) => p.patientId === file.id) : []
  const fileSummary = patientFileSummary(fileVisits.map((v) => ({ kind: v.kind, feeMinor: v.totals.feeMinor, dueMinor: v.totals.dueMinor, date: v.date })))
  const fileBalance = file ? getPatientBalance(file.id) : 0

  /* زيارة جديدة */
  const [visitOpen, setVisitOpen] = useState(false)
  const [vKind, setVKind] = useState<VisitKind>('checkup')
  const [vComplaint, setVComplaint] = useState('')
  const [vDiagnosis, setVDiagnosis] = useState('')
  const [vTreatment, setVTreatment] = useState('')
  const [vFee, setVFee] = useState('')
  const [vPaid, setVPaid] = useState('')
  const [vTreasury, setVTreasury] = useState('1101')
  const [vVat, setVVat] = useState(false)
  const [vPlan, setVPlan] = useState('')

  const openVisit = () => {
    setVKind('checkup'); setVComplaint(''); setVDiagnosis(''); setVTreatment(''); setVFee(''); setVPaid(''); setVVat(false); setVPlan('')
    setVisitOpen(true)
  }

  /** اختيار خطة يملأ قيمة الجلسة القادمة تلقائياً */
  const pickPlan = (pid: string) => {
    setVPlan(pid)
    if (pid) {
      const plan = filePlans.find((p) => p.id === Number(pid))
      if (plan && plan.doneSessions < plan.totalSessions) {
        const fee = plan.sessionFeesMinor[plan.doneSessions]
        setVFee(String(fee / 10 ** cur.decimals))
        setVKind('procedure')
      }
    }
  }

  /** طباعة روشتة الزيارة (جولة العيادة): العلاج الحر يتحول لسطور ℞ — «دواء | جرعة» لكل سطر */
  const printPrescription = (v: { visitNumber: string; date: string; diagnosis: string; treatment: string }) => {
    if (!file) return
    const age = file.birthDate ? `${Math.max(0, Math.floor((Date.now() - Date.parse(file.birthDate)) / 31_557_600_000))} سنة` : ''
    printHtml(renderPrescriptionHtml({
      clinicName: setup.shopName || 'العيادة',
      doctorName: setup.ownerName ? `د/ ${setup.ownerName}` : '',
      clinicPhone: '',
      patientName: file.nameAr,
      patientAge: age,
      dateIso: v.date,
      visitNumber: v.visitNumber,
      diagnosis: v.diagnosis,
      lines: parsePrescriptionText(v.treatment),
      notes: file.medicalHistory ? `تنبيه ملف: ${file.medicalHistory}` : '',
    }))
  }

  const saveVisit = () => {
    if (!file) return
    try {
      const fee = toMinor(vFee, cur.decimals)
      const paid = vPaid.trim() === '' ? fee + (vVat ? Math.round((fee * setup.vatPercent) / 100) : 0) : toMinor(vPaid, cur.decimals)
      const v = addClinicVisit({
        patientId: file.id, kind: vKind, complaint: vComplaint.trim(), diagnosis: vDiagnosis.trim(), treatment: vTreatment.trim(),
        feeMinor: fee, paidMinor: paid, vatPercent: vVat ? setup.vatPercent : 0,
        planId: vPlan ? Number(vPlan) : null,
        treasury: vTreasury,
      })
      toast.show(`سُجلت الزيارة ${v.visitNumber}${v.totals.dueMinor > 0 ? ` — متبقٍ ${fmt(v.totals.dueMinor)} على المريض` : ''} ✅`)
      setVisitOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* خطة علاج */
  const [planOpen, setPlanOpen] = useState(false)
  const [pTitle, setPTitle] = useState('')
  const [pSessions, setPSessions] = useState('4')
  const [pFee, setPFee] = useState('')

  const savePlan = () => {
    if (!file) return
    try {
      addTreatmentPlan({ patientId: file.id, title: pTitle.trim(), totalSessions: Number(pSessions) || 0, totalFeeMinor: toMinor(pFee, cur.decimals) })
      toast.show('أُنشئت خطة العلاج — سجّل الجلسات كزيارات مربوطة بها ✅')
      setPlanOpen(false); setPTitle(''); setPSessions('4'); setPFee('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تحصيل */
  const [collectAmount, setCollectAmount] = useState('')
  const [collectTreasury, setCollectTreasury] = useState('1101')
  const doCollect = () => {
    if (!file) return
    try {
      collectFromPatient(file.id, toMinor(collectAmount, cur.decimals), collectTreasury)
      toast.show('حُصّل المبلغ بقيد متوازن ✅')
      setCollectAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض قيد زيارة */
  const [viewEntryId, setViewEntryId] = useState<number | null>(null)
  const viewEntry = viewEntryId != null ? journal.find((e) => e.id === viewEntryId) : null

  const filtered = clinicPatients.filter((p) => !q.trim() || p.nameAr.includes(q.trim()) || p.phone.includes(q.trim()))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><Stethoscope className="w-6 h-6 text-cyan-500" /> ملفات المرضى</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> ملف مريض جديد</Btn>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="بحث بالاسم أو الهاتف…" />

      {filtered.length === 0 ? (
        <EmptyState icon="🩺" title="لا مرضى بعد" sub="افتح ملفاً لكل مريض — كل زيارة تُسجل بملاحظات الكشف وقيمتها وقيدها المحاسبي" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
              <tr>{['المريض', 'الهاتف', 'الزيارات', 'آخر زيارة', 'المستحق عليه', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const visits = clinicVisits.filter((v) => v.patientId === p.id)
                const last = visits.length ? visits[visits.length - 1].date.slice(0, 10) : '—'
                const bal = getPatientBalance(p.id)
                return (
                  <tr key={p.id} onClick={() => setFile(p)} className="border-t border-slate-100 dark:border-slate-800 hover:bg-cyan-500/5 cursor-pointer transition-colors">
                    <td className="px-3 py-2.5 font-bold">{p.nameAr}</td>
                    <td className="px-3 py-2.5" dir="ltr">{p.phone || '—'}</td>
                    <td className="px-3 py-2.5">{visits.length}</td>
                    <td className="px-3 py-2.5 text-slate-500">{last}</td>
                    <td className={`px-3 py-2.5 font-black ${bal > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{bal > 0 ? `${fmt(bal)} ${cur.symbol}` : '—'}</td>
                    <td className="px-3 py-2.5 text-left"><Eye className="w-4 h-4 text-slate-400 inline" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ملف مريض جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="فتح ملف مريض">
        <div className="space-y-3">
          <Field label="الاسم *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="النوع">
              <div className="flex gap-2">
                {(['male', 'female'] as const).map((g) => (
                  <button key={g} onClick={() => setGender(g)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${gender === g ? 'bg-cyan-600 text-white border-cyan-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {g === 'male' ? 'ذكر' : 'أنثى'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="تاريخ الميلاد"><input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} /></Field>
          <Field label="التاريخ الطبي" hint="أمراض مزمنة، حساسية أدوية، عمليات سابقة"><textarea value={history} onChange={(e) => setHistory(e.target.value)} className={`${inputCls} min-h-[70px]`} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={savePatient} disabled={!nameAr.trim()}>فتح الملف</Btn>
          </div>
        </div>
      </Modal>

      {/* ملف المريض */}
      <Modal open={!!file} onClose={() => setFile(null)} title={file ? `ملف: ${file.nameAr}` : ''} wide>
        {file && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-cyan-500/10 p-3"><div className="text-[11px] text-slate-500">الزيارات</div><div className="font-black text-cyan-600">{fileSummary.visitCount}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">إجمالي الأتعاب</div><div className="font-black">{fmt(fileSummary.totalFeesMinor)}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">آخر زيارة</div><div className="font-black">{fileSummary.lastVisit?.slice(0, 10) ?? '—'}</div></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">مستحق عليه</div><div className="font-black text-amber-600">{fmt(fileBalance)}</div></div>
            </div>

            {file.medicalHistory && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-[12px]">
                <b className="text-rose-600">⚕️ التاريخ الطبي:</b> {file.medicalHistory}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Btn onClick={openVisit}><Plus className="w-4 h-4" /> زيارة / كشف جديد</Btn>
              <Btn variant="ghost" onClick={() => setPlanOpen(true)}><ClipboardList className="w-4 h-4" /> خطة علاج بجلسات</Btn>
              {fileBalance > 0 && (
                <div className="flex gap-1 items-center">
                  <input value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} inputMode="decimal" className={`${inputCls} !w-40`} placeholder="المبلغ المحصل" />
                  <TreasuryPicker value={collectTreasury} onChange={setCollectTreasury} compact />
                  <Btn variant="ghost" onClick={doCollect} disabled={!collectAmount}><Banknote className="w-4 h-4" /> تحصيل</Btn>
                </div>
              )}
            </div>

            {filePlans.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-bold text-[12px] text-slate-500">خطط العلاج</div>
                {filePlans.map((pl) => (
                  <div key={pl.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5 flex items-center justify-between">
                    <span className="font-bold">{pl.title}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-cyan-500 transition-all" style={{ width: `${(pl.doneSessions / pl.totalSessions) * 100}%` }} />
                      </div>
                      <span className="text-[11px] font-bold">{pl.doneSessions}/{pl.totalSessions} جلسة</span>
                      <span className="text-[11px] font-bold text-cyan-600">{fmt(pl.totalFeeMinor)} {cur.symbol}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {fileVisits.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-bold text-[12px] text-slate-500">سجل الزيارات</div>
                {[...fileVisits].reverse().map((v) => (
                  <div key={v.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-black">{VISIT_KIND_LABELS[v.kind].icon} {VISIT_KIND_LABELS[v.kind].nameAr} — {v.visitNumber}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">{v.date.slice(0, 10)}</span>
                        <span className="font-bold text-cyan-600">{fmt(v.totals.totalMinor)} {cur.symbol}</span>
                        {v.totals.dueMinor > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">متبقٍ {fmt(v.totals.dueMinor)}</span>}
                        <button onClick={() => setViewEntryId(v.journalEntryId)} title="عرض القيد" className="p-1 rounded text-slate-400 hover:text-rose-500"><BookOpenText className="w-3.5 h-3.5" /></button>
                        <button onClick={() => printPrescription(v)} title="طباعة روشتة" className="p-1 rounded text-slate-400 hover:text-cyan-600">℞</button>
                      </div>
                    </div>
                    {(v.complaint || v.diagnosis || v.treatment) && (
                      <div className="text-[12px] text-slate-500 space-y-0.5">
                        {v.complaint && <div><b>الشكوى:</b> {v.complaint}</div>}
                        {v.diagnosis && <div><b>التشخيص:</b> {v.diagnosis}</div>}
                        {v.treatment && <div><b>العلاج:</b> {v.treatment}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* زيارة جديدة */}
      <Modal open={visitOpen} onClose={() => setVisitOpen(false)} title={file ? `زيارة جديدة — ${file.nameAr}` : ''} wide>
        <div className="space-y-3">
          <Field label="نوع الزيارة">
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(VISIT_KIND_LABELS) as VisitKind[]).map((k) => (
                <button key={k} onClick={() => setVKind(k)} className={`py-2 rounded-xl text-[12px] font-bold border transition-all ${vKind === k ? 'bg-cyan-600 text-white border-cyan-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                  {VISIT_KIND_LABELS[k].icon} {VISIT_KIND_LABELS[k].nameAr}
                </button>
              ))}
            </div>
          </Field>
          {filePlans.some((p) => p.doneSessions < p.totalSessions) && (
            <Field label="ضمن خطة علاج؟" hint="اختيار الخطة يملأ قيمة الجلسة تلقائياً">
              <select value={vPlan} onChange={(e) => pickPlan(e.target.value)} className={inputCls}>
                <option value="">زيارة مستقلة</option>
                {filePlans.filter((p) => p.doneSessions < p.totalSessions).map((p) => (
                  <option key={p.id} value={p.id}>{p.title} — الجلسة {p.doneSessions + 1}/{p.totalSessions}</option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label={`قيمة الزيارة (${cur.symbol}) *`}><input value={vFee} onChange={(e) => setVFee(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="المسدد الآن" hint="فارغ = سداد كامل"><input value={vPaid} onChange={(e) => setVPaid(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={vTreasury} onChange={setVTreasury} compact /></Field>
            <Field label="الضريبة">
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                <input type="checkbox" checked={vVat} onChange={(e) => setVVat(e.target.checked)} className="accent-cyan-600" />
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
              </label>
            </Field>
          </div>
          <Field label="الشكوى"><input value={vComplaint} onChange={(e) => setVComplaint(e.target.value)} className={inputCls} /></Field>
          <Field label="التشخيص"><input value={vDiagnosis} onChange={(e) => setVDiagnosis(e.target.value)} className={inputCls} /></Field>
          <Field label="العلاج / الروشتة" hint="سطر لكل دواء بصيغة: اسم الدواء | الجرعة — والروشتة تُطبع من ملف المريض ℞">
            <textarea value={vTreatment} onChange={(e) => setVTreatment(e.target.value)} className={`${inputCls} min-h-20`} placeholder={'أموكسيسيللين 500 | كبسولة كل 8 ساعات — 5 أيام\nباراسيتامول | عند اللزوم'} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setVisitOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveVisit} disabled={!vFee}>تسجيل الزيارة وقيدها</Btn>
          </div>
        </div>
      </Modal>

      {/* خطة علاج */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title={file ? `خطة علاج — ${file.nameAr}` : ''}>
        <div className="space-y-3">
          <Field label="عنوان الخطة *"><input value={pTitle} onChange={(e) => setPTitle(e.target.value)} className={inputCls} placeholder="تقويم أسنان، زراعة ضرس…" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="عدد الجلسات *"><input value={pSessions} onChange={(e) => setPSessions(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
            <Field label={`إجمالي الخطة (${cur.symbol}) *`} hint="يقسم على الجلسات تلقائياً بلا فقد قرش"><input value={pFee} onChange={(e) => setPFee(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setPlanOpen(false)}>إلغاء</Btn>
            <Btn onClick={savePlan} disabled={!pTitle.trim() || !pFee}>إنشاء الخطة</Btn>
          </div>
        </div>
      </Modal>

      {/* قيد */}
      <Modal open={!!viewEntry} onClose={() => setViewEntryId(null)} title={viewEntry ? `قيد #${viewEntry.entryNumber}` : ''}>
        {viewEntry && (
          <table className="w-full text-[12px]"><tbody>
            {viewEntry.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                <td className="px-3 py-1.5 text-emerald-600 font-bold">{l.debit ? fmt(l.debit) : ''}</td>
                <td className="px-3 py-1.5 text-rose-600 font-bold">{l.credit ? fmt(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </Modal>
    </div>
  )
}

/* ═══════════════ المواعيد ═══════════════ */

export function ClinicAppointmentsPage() {
  const { clinicAppointments, clinicPatients, addAppointment, markAppointmentDone } = useDataStore()
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)

  const [open, setOpen] = useState(false)
  const [patientId, setPatientId] = useState('')
  const [date, setDate] = useState(today)
  const [time, setTime] = useState('10:00')
  const [purpose, setPurpose] = useState('')

  const save = () => {
    try {
      addAppointment({ patientId: Number(patientId), date, time, purpose: purpose.trim() })
      toast.show('حُجز الموعد 📅')
      setOpen(false); setPatientId(''); setPurpose('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const pName = (id: number) => clinicPatients.find((p) => p.id === id)?.nameAr ?? '—'
  const upcoming = clinicAppointments.filter((a) => !a.done).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
  const done = clinicAppointments.filter((a) => a.done)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><CalendarClock className="w-6 h-6 text-cyan-500" /> المواعيد</h1>
        <Btn onClick={() => setOpen(true)} disabled={!clinicPatients.length}><Plus className="w-4 h-4" /> حجز موعد</Btn>
      </div>

      {upcoming.length === 0 && done.length === 0 ? (
        <EmptyState icon="📅" title="لا مواعيد" sub="احجز مواعيد المرضى — مواعيد اليوم تظهر أولاً" />
      ) : (
        <div className="space-y-2">
          {upcoming.map((a) => (
            <div key={a.id} className={`rounded-xl border p-3 flex items-center justify-between transition-colors ${a.date === today ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-slate-200 dark:border-slate-700'}`}>
              <div>
                <span className="font-black">{pName(a.patientId)}</span>
                <span className="text-[12px] text-slate-500 mr-2">{a.purpose || '—'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[12px] font-bold ${a.date === today ? 'text-cyan-600' : 'text-slate-500'}`}>{a.date === today ? 'اليوم' : a.date} — {a.time}</span>
                <button onClick={() => markAppointmentDone(a.id)} title="تم الحضور" className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><CheckCircle2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {done.length > 0 && <div className="text-[11px] text-slate-400 font-bold pt-2">مكتملة: {done.length} موعد</div>}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="حجز موعد">
        <div className="space-y-3">
          <Field label="المريض *">
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {clinicPatients.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="التاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
            <Field label="الوقت"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="الغرض"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} placeholder="متابعة، جلسة تقويم…" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!patientId}>حجز</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
