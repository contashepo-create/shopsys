/**
 * صفحات العيادة — ترقية شاملة (طلب المالك):
 * • روشتة منظمة كالفاتورة: بند لكل دواء بجرعة (مرات/ساعات) ووجبات (1/2/3)
 *   ومدة وتكرار وشكل صرف (شريط/علبة) وملاحظات — وطباعة احترافية A5.
 * • تاريخ مرضي منظم: فصيلة دم + أمراض مزمنة (تشيك) + حساسية + عمليات… لا نص حر.
 * • مرفقات المريض: أشعة/تحاليل/تقارير — صورة (تُضغط تلقائياً) أو PDF.
 * • ربط المريض بحساب عميل: الملف طبي والحساب مالي — كشف واحد للفلوس.
 * • علامات حيوية بكل زيارة (ضغط/نبض/حرارة/وزن) مع تنبيهات بصرية.
 */
import { useMemo, useRef, useState } from 'react'
import { Plus, Stethoscope, CalendarClock, Eye, BookOpenText, Banknote, ClipboardList, CheckCircle2, Trash2, Paperclip, FileText, Printer, Link2, HeartPulse, X } from 'lucide-react'
import { useDataStore, type ClinicPatient, type ClinicVisit } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { VISIT_KIND_LABELS, patientFileSummary, type VisitKind } from '../../core/clinic.ts'
import {
  emptyRxLine, doseText, dispenseText, DISPENSE_FORMS, MEAL_RELATIONS, BLOOD_TYPES, COMMON_CHRONIC,
  emptyMedicalHistory, historySummary, vitalsText, vitalsFlags, EMPTY_VITALS, ATTACHMENT_KINDS,
  type RxLine, type DispenseForm, type MealRelation, type MedicalHistory, type Vitals, type AttachmentKind,
} from '../../core/prescription.ts'
import type { Gender } from '../../core/lab.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { renderPrescriptionHtml, parsePrescriptionText } from '../print/printPrescription.ts'
import { renderPatientRecordHtml } from '../print/printPatientRecord.ts'
import { partyCode, partySearchFilter } from '../../core/partyCodes.ts'
import { printHtml } from '../print/printReceipt.ts'

function useCur() {
  const { setup } = useAppStore()
  return useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
}

/** ضغط صورة إلى JPEG بعرض أقصى 1400px — يجعل الأشعة والتقارير تدخل حد التخزين */
async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('تعذرت قراءة الملف'))
    r.readAsDataURL(file)
  })
  if (file.type === 'application/pdf') return dataUrl // PDF كما هو
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => reject(new Error('الصورة غير مقروءة'))
    img.src = dataUrl
  })
}

/* ═══════════ محرر التاريخ المرضي المنظم ═══════════ */

function HistoryEditor({ value, onChange }: { value: MedicalHistory; onChange: (h: MedicalHistory) => void }) {
  const [allergyInput, setAllergyInput] = useState('')
  const toggleChronic = (d: string) =>
    onChange({ ...value, chronicDiseases: value.chronicDiseases.includes(d) ? value.chronicDiseases.filter((x) => x !== d) : [...value.chronicDiseases, d] })
  const addAllergy = () => {
    const a = allergyInput.trim()
    if (a && !value.allergies.includes(a)) onChange({ ...value, allergies: [...value.allergies, a] })
    setAllergyInput('')
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="فصيلة الدم">
          <select value={value.bloodType} onChange={(e) => onChange({ ...value, bloodType: e.target.value })} className={inputCls}>
            <option value="">غير معروفة</option>
            {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="التدخين">
          <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
            <input type="checkbox" checked={value.smoker} onChange={(e) => onChange({ ...value, smoker: e.target.checked })} className="accent-cyan-600 w-4 h-4" />
            <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">مدخّن</span>
          </label>
        </Field>
      </div>
      <Field label="أمراض مزمنة" hint="اختر بنقرة — لا كتابة">
        <div className="flex flex-wrap gap-1.5">
          {COMMON_CHRONIC.map((d) => (
            <button key={d} type="button" onClick={() => toggleChronic(d)}
              className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold border transition-all ${value.chronicDiseases.includes(d) ? 'bg-cyan-600 text-white border-cyan-600' : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:border-cyan-400'}`}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Field label="حساسية (أدوية/أطعمة)" hint="اكتب واضغط إضافة — تظهر كتحذير أحمر أعلى كل روشتة">
        <div className="flex gap-1.5">
          <input value={allergyInput} onChange={(e) => setAllergyInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAllergy() } }} className={inputCls} placeholder="بنسلين…" />
          <Btn variant="ghost" onClick={addAllergy} disabled={!allergyInput.trim()}><Plus className="w-4 h-4" /></Btn>
        </div>
        {value.allergies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {value.allergies.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/10 text-rose-600 text-[11px] font-bold border border-rose-500/25">
                ⚠️ {a}
                <button onClick={() => onChange({ ...value, allergies: value.allergies.filter((x) => x !== a) })} className="hover:text-rose-800"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="عمليات سابقة"><input value={value.surgeries} onChange={(e) => onChange({ ...value, surgeries: e.target.value })} className={inputCls} placeholder="زائدة 2019…" /></Field>
        <Field label="أدوية يتناولها حالياً"><input value={value.currentMeds} onChange={(e) => onChange({ ...value, currentMeds: e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="تاريخ عائلي"><input value={value.familyHistory} onChange={(e) => onChange({ ...value, familyHistory: e.target.value })} className={inputCls} placeholder="سكري لدى الوالد…" /></Field>
        <Field label="ملاحظات إضافية"><input value={value.extraNotes} onChange={(e) => onChange({ ...value, extraNotes: e.target.value })} className={inputCls} /></Field>
      </div>
    </div>
  )
}

/* ═══════════ محرر بند الروشتة (سطر كالفاتورة) ═══════════ */

function RxLineEditor({ line, index, onChange, onRemove }: { line: RxLine; index: number; onChange: (l: RxLine) => void; onRemove: () => void }) {
  const doseMode = line.everyHours > 0 ? 'hours' : 'times'
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3 space-y-2.5">
      {/* السطر الأول: رقم + اسم الدواء + الصرف + حذف */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-6 h-6 rounded-lg bg-cyan-600 text-white text-[11px] font-black flex items-center justify-center">{index + 1}</span>
        <input value={line.medication} onChange={(e) => onChange({ ...line, medication: e.target.value })} className={`${inputCls} flex-1 font-bold`} placeholder="اسم الدواء والتركيز — أموكسيسيللين 500 مجم" />
        <input value={line.formQty || ''} onChange={(e) => onChange({ ...line, formQty: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} inputMode="numeric" className={`${inputCls} !w-14 text-center`} placeholder="1" title="كم شريط/علبة" />
        <select value={line.form} onChange={(e) => onChange({ ...line, form: e.target.value as DispenseForm })} className={`${inputCls} !w-24`}>
          {(Object.keys(DISPENSE_FORMS) as DispenseForm[]).map((f) => <option key={f} value={f}>{DISPENSE_FORMS[f]}</option>)}
        </select>
        <button onClick={onRemove} title="حذف البند" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
      </div>

      {/* السطر الثاني: الجرعة (مرات أو ساعات) + الوجبات + المدة */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
          <button type="button" onClick={() => onChange({ ...line, everyHours: 0, timesPerDay: line.timesPerDay || 2 })}
            className={`px-2 py-1.5 font-bold transition-colors ${doseMode === 'times' ? 'bg-cyan-600 text-white' : 'text-slate-500'}`}>مرات/يوم</button>
          <button type="button" onClick={() => onChange({ ...line, timesPerDay: 0, everyHours: line.everyHours || 8 })}
            className={`px-2 py-1.5 font-bold transition-colors ${doseMode === 'hours' ? 'bg-cyan-600 text-white' : 'text-slate-500'}`}>كل X ساعات</button>
        </div>
        {doseMode === 'times' ? (
          <select value={line.timesPerDay} onChange={(e) => onChange({ ...line, timesPerDay: Number(e.target.value) })} className={`${inputCls} !w-28 !py-1.5`}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'مرة واحدة' : n === 2 ? 'مرتين' : `${n} مرات`} يومياً</option>)}
          </select>
        ) : (
          <select value={line.everyHours} onChange={(e) => onChange({ ...line, everyHours: Number(e.target.value) })} className={`${inputCls} !w-28 !py-1.5`}>
            {[4, 6, 8, 12, 24].map((h) => <option key={h} value={h}>كل {h} ساعات</option>)}
          </select>
        )}
        <select value={line.mealRelation} onChange={(e) => onChange({ ...line, mealRelation: e.target.value as MealRelation })} className={`${inputCls} !w-32 !py-1.5`}>
          {(Object.keys(MEAL_RELATIONS) as MealRelation[]).map((m) => <option key={m} value={m}>{MEAL_RELATIONS[m]}</option>)}
        </select>
        {line.mealRelation !== 'none' && (
          <select value={line.mealsCount} onChange={(e) => onChange({ ...line, mealsCount: Number(e.target.value) })} className={`${inputCls} !w-28 !py-1.5`} title="بعد وجبة أم وجبتين أم ثلاث">
            <option value={1}>وجبة واحدة</option>
            <option value={2}>وجبتان</option>
            <option value={3}>ثلاث وجبات</option>
          </select>
        )}
        <div className="flex items-center gap-1">
          <span className="text-slate-400 font-bold">المدة:</span>
          <input value={line.durationDays || ''} onChange={(e) => onChange({ ...line, durationDays: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} inputMode="numeric" className={`${inputCls} !w-14 !py-1.5 text-center`} placeholder="∞" />
          <span className="text-slate-400 font-bold">يوم</span>
        </div>
      </div>

      {/* السطر الثالث: التكرار + ملاحظات */}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={line.repeated} onChange={(e) => onChange({ ...line, repeated: e.target.checked, repeatTimes: e.target.checked ? (line.repeatTimes || 1) : 0, repeatEveryDays: e.target.checked ? (line.repeatEveryDays || 30) : 0 })} className="accent-cyan-600 w-4 h-4" />
          مكرر؟
        </label>
        {line.repeated && (
          <>
            <input value={line.repeatTimes || ''} onChange={(e) => onChange({ ...line, repeatTimes: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} inputMode="numeric" className={`${inputCls} !w-14 !py-1.5 text-center`} placeholder="1" />
            <span className="text-slate-400 font-bold">مرة — كل</span>
            <input value={line.repeatEveryDays || ''} onChange={(e) => onChange({ ...line, repeatEveryDays: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} inputMode="numeric" className={`${inputCls} !w-14 !py-1.5 text-center`} placeholder="30" />
            <span className="text-slate-400 font-bold">يوم</span>
          </>
        )}
        <input value={line.notes} onChange={(e) => onChange({ ...line, notes: e.target.value })} className={`${inputCls} flex-1 !py-1.5 min-w-40`} placeholder="ملاحظات البند — يُرج قبل الاستخدام…" />
      </div>

      {/* معاينة حية للجملة المطبوعة */}
      {line.medication.trim() && (
        <div className="text-[11px] text-cyan-700 dark:text-cyan-300 bg-cyan-500/8 rounded-lg px-2.5 py-1.5">
          👁️ {line.medication} — {doseText(line)}{dispenseText(line) ? ` · ${dispenseText(line)}` : ''}
        </div>
      )}
    </div>
  )
}

/* ═══════════ ملفات المرضى ═══════════ */

export function ClinicPatientsPage() {
  const {
    clinicPatients, clinicVisits, treatmentPlans, journal, customers, patientAttachments,
    addClinicPatient, updateClinicPatient, addClinicVisit, addTreatmentPlan, collectFromPatient, getPatientBalance,
    addPatientAttachment, removePatientAttachment, addCustomer, refundClinicVisit,
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
  const [history, setHistory] = useState<MedicalHistory>(emptyMedicalHistory())
  const [linkCustomer, setLinkCustomer] = useState(true) // إنشاء/ربط حساب عميل تلقائياً

  const savePatient = () => {
    try {
      // الربط المالي (سؤال المالك): ملف المريض طبي وحساب العميل مالي —
      // ننشئ حساب عميل بنفس الاسم تلقائياً ليظهر في كشوف الحساب والتقارير
      let customerId: number | null = null
      if (linkCustomer) {
        const existing = customers.find((c) => c.nameAr === nameAr.trim() || (phone.trim() && c.phone === phone.trim()))
        if (existing) {
          customerId = existing.id
        } else {
          addCustomer({ nameAr: nameAr.trim(), phone: phone.trim(), creditLimitMinor: 0, notes: 'حساب مالي لمريض العيادة', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
          customerId = useDataStore.getState().customers.at(-1)?.id ?? null
        }
      }
      addClinicPatient({ nameAr: nameAr.trim(), phone: phone.trim(), gender, birthDate, medicalHistory: '', history, linkedCustomerId: customerId, notes: '' })
      toast.show(`فُتح ملف المريض${customerId ? ' وربُط بحساب عميل مالي' : ''} ✅`)
      setOpen(false); setNameAr(''); setPhone(''); setGender('male'); setBirthDate(''); setHistory(emptyMedicalHistory())
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* ملف المريض */
  const [file, setFile] = useState<ClinicPatient | null>(null)
  const liveFile = file ? clinicPatients.find((p) => p.id === file.id) ?? file : null
  const fileVisits = liveFile ? clinicVisits.filter((v) => v.patientId === liveFile.id) : []
  const filePlans = liveFile ? treatmentPlans.filter((p) => p.patientId === liveFile.id) : []
  const fileAtts = liveFile ? patientAttachments.filter((a) => a.patientId === liveFile.id) : []
  const fileSummary = patientFileSummary(fileVisits.map((v) => ({ kind: v.kind, feeMinor: v.totals.feeMinor, dueMinor: v.totals.dueMinor, date: v.date })))
  const fileBalance = liveFile ? getPatientBalance(liveFile.id) : 0
  const fileHistory = liveFile?.history ?? emptyMedicalHistory()
  const fileHistoryLine = historySummary(fileHistory)

  /* تعديل التاريخ المرضي */
  const [histOpen, setHistOpen] = useState(false)
  const [histDraft, setHistDraft] = useState<MedicalHistory>(emptyMedicalHistory())
  const openHistory = () => { setHistDraft(liveFile?.history ?? emptyMedicalHistory()); setHistOpen(true) }
  const saveHistory = () => {
    if (!liveFile) return
    try {
      updateClinicPatient(liveFile.id, { history: histDraft })
      toast.show('حُدّث التاريخ المرضي ✅')
      setHistOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* مرفقات */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attKind, setAttKind] = useState<AttachmentKind>('xray')
  const [viewAtt, setViewAtt] = useState<number | null>(null)
  const viewingAtt = viewAtt != null ? patientAttachments.find((a) => a.id === viewAtt) : null

  const onPickFile = async (f: File | null) => {
    if (!f || !liveFile) return
    try {
      const dataUrl = await compressImage(f)
      addPatientAttachment({ patientId: liveFile.id, kind: attKind, name: f.name.replace(/\.[^.]+$/, ''), mime: f.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg', dataUrl, notes: '' })
      toast.show(`أُرفق «${ATTACHMENT_KINDS[attKind].nameAr}» بملف المريض ✅`)
    } catch (e) { toast.show((e as Error).message, 'error') }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* زيارة جديدة — روشتة منظمة */
  const [visitOpen, setVisitOpen] = useState(false)
  const [vKind, setVKind] = useState<VisitKind>('checkup')
  const [vComplaint, setVComplaint] = useState('')
  const [vDiagnosis, setVDiagnosis] = useState('')
  const [vRx, setVRx] = useState<RxLine[]>([])
  const [vVitals, setVVitals] = useState<Vitals>(EMPTY_VITALS)
  const [vNext, setVNext] = useState('')
  const [vFee, setVFee] = useState('')
  const [vPaid, setVPaid] = useState('')
  const [vTreasury, setVTreasury] = useState('1101')
  const [vVat, setVVat] = useState(false)
  const [vPlan, setVPlan] = useState('')

  const openVisit = () => {
    setVKind('checkup'); setVComplaint(''); setVDiagnosis(''); setVRx([emptyRxLine()]); setVVitals(EMPTY_VITALS); setVNext('')
    setVFee(''); setVPaid(''); setVVat(false); setVPlan('')
    setVisitOpen(true)
  }

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

  /** طباعة روشتة احترافية: البنود المنظمة أولاً — والزيارات القديمة نصها الحر يتحول لسطور */
  const printPrescription = (v: ClinicVisit) => {
    if (!liveFile) return
    const age = liveFile.birthDate ? `${Math.max(0, Math.floor((Date.now() - Date.parse(liveFile.birthDate)) / 31_557_600_000))} سنة` : ''
    const h = liveFile.history ?? emptyMedicalHistory()
    printHtml(renderPrescriptionHtml({
      clinicName: setup.shopName || 'العيادة',
      doctorName: setup.ownerName ? `د/ ${setup.ownerName}` : '',
      doctorTitle: setup.doctorSpecialty ? `أخصائي ${setup.doctorSpecialty}` : '',
      clinicPhone: setup.phone ?? '',
      clinicAddress: [setup.city, setup.street].filter(Boolean).join(' — '),
      patientName: liveFile.nameAr,
      patientCode: partyCode('PAT', liveFile.id),
      patientAge: age,
      patientGender: liveFile.gender === 'male' ? 'ذكر' : 'أنثى',
      dateIso: v.date,
      visitNumber: v.visitNumber,
      diagnosis: v.diagnosis,
      rxLines: v.rxLines?.length ? v.rxLines : undefined,
      legacyLines: v.rxLines?.length ? undefined : parsePrescriptionText(v.treatment),
      allergyWarning: h.allergies.length ? `حساسية: ${h.allergies.join('، ')}` : '',
      notes: '',
      nextVisit: v.nextVisit ?? '',
    }))
  }

  /** تقرير سجل المريض الكامل (طلب المالك): من بداية التعامل حتى الآن — A4 احترافي */
  const printFullRecord = () => {
    if (!liveFile) return
    const age = liveFile.birthDate ? `${Math.max(0, Math.floor((Date.now() - Date.parse(liveFile.birthDate)) / 31_557_600_000))} سنة` : ''
    const ordered = [...fileVisits].sort((a, b) => a.date.localeCompare(b.date))
    printHtml(renderPatientRecordHtml({
      clinicName: setup.shopName || 'العيادة',
      doctorName: setup.ownerName ? `د/ ${setup.ownerName}` : '',
      clinicPhone: setup.phone ?? '',
      clinicAddress: [setup.city, setup.street].filter(Boolean).join(' — '),
      patientName: liveFile.nameAr,
      patientCode: partyCode('PAT', liveFile.id),
      patientPhone: liveFile.phone,
      patientAge: age,
      patientGender: liveFile.gender === 'male' ? 'ذكر' : 'أنثى',
      firstVisitDate: ordered[0]?.date.slice(0, 10) ?? '',
      history: liveFile.history ?? emptyMedicalHistory(),
      visits: ordered.map((v) => ({
        visitNumber: v.visitNumber, date: v.date, kindLabel: VISIT_KIND_LABELS[v.kind].nameAr,
        complaint: v.complaint, diagnosis: v.diagnosis, treatment: v.treatment,
        rxLines: v.rxLines ?? [], vitals: v.vitals ?? null, nextVisit: v.nextVisit ?? '',
        totalMinor: v.totals.totalMinor, dueMinor: v.totals.dueMinor,
      })),
      plans: filePlans.map((p) => ({ title: p.title, doneSessions: p.doneSessions, totalSessions: p.totalSessions, totalFeeMinor: p.totalFeeMinor })),
      attachments: fileAtts.map((a) => ({ kind: a.kind, name: a.name, addedAt: a.addedAt })),
      totalFees: `${fmt(fileSummary.totalFeesMinor)} ${cur.symbol}`,
      totalDue: `${fmt(fileBalance)} ${cur.symbol}`,
      printedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }))
  }

  const saveVisit = () => {
    if (!liveFile) return
    try {
      const fee = toMinor(vFee, cur.decimals)
      const paid = vPaid.trim() === '' ? fee + (vVat ? Math.round((fee * setup.vatPercent) / 100) : 0) : toMinor(vPaid, cur.decimals)
      const v = addClinicVisit({
        patientId: liveFile.id, kind: vKind, complaint: vComplaint.trim(), diagnosis: vDiagnosis.trim(), treatment: '',
        rxLines: vRx.filter((l) => l.medication.trim()), vitals: vVitals, nextVisit: vNext,
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
    if (!liveFile) return
    try {
      addTreatmentPlan({ patientId: liveFile.id, title: pTitle.trim(), totalSessions: Number(pSessions) || 0, totalFeeMinor: toMinor(pFee, cur.decimals) })
      toast.show('أُنشئت خطة العلاج — سجّل الجلسات كزيارات مربوطة بها ✅')
      setPlanOpen(false); setPTitle(''); setPSessions('4'); setPFee('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تحصيل */
  const [collectAmount, setCollectAmount] = useState('')
  const [collectTreasury, setCollectTreasury] = useState('1101')
  const doCollect = () => {
    if (!liveFile) return
    try {
      collectFromPatient(liveFile.id, toMinor(collectAmount, cur.decimals), collectTreasury)
      toast.show('حُصّل المبلغ بقيد متوازن ✅')
      setCollectAmount('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض قيد */
  const [viewEntryId, setViewEntryId] = useState<number | null>(null)
  const [refundingVisit, setRefundingVisit] = useState<ClinicVisit | null>(null)
  const viewEntry = viewEntryId != null ? journal.find((e) => e.id === viewEntryId) : null

  // البحث بالكود (طلب المالك): PAT-0042 أو 42 أو pat42 — أسرع وأدق من الاسم
  const filtered = partySearchFilter(clinicPatients, q, 'PAT')
  const linkedName = (id: number | null | undefined) => (id != null ? customers.find((c) => c.id === id)?.nameAr ?? null : null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><Stethoscope className="w-6 h-6 text-cyan-500" /> ملفات المرضى</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> ملف مريض جديد</Btn>
      </div>
      <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/15 px-3 py-2 text-[11.5px] text-slate-500 dark:text-slate-400">
        💡 <b>الملف الطبي غير حساب العميل:</b> ملف المريض يحمل السرية الطبية (تاريخ/روشتات/أشعة) —
        وعند فتح الملف يُنشأ له <b>حساب عميل مالي</b> تلقائياً تظهر فيه الزيارات والمديونية في كشوف الحساب والتقارير كباقي العملاء.
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="بحث بالاسم أو الهاتف أو الكود (PAT-0001 أو 1)…" />

      {filtered.length === 0 ? (
        <EmptyState icon="🩺" title="لا مرضى بعد" sub="افتح ملفاً لكل مريض — تاريخ مرضي منظم وروشتات مطبوعة ومرفقات أشعة وتحاليل" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
              <tr>{['الكود', 'المريض', 'الهاتف', 'تنبيهات الملف', 'الزيارات', 'آخر زيارة', 'المستحق عليه', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const visits = clinicVisits.filter((v) => v.patientId === p.id)
                const last = visits.length ? visits[visits.length - 1].date.slice(0, 10) : '—'
                const bal = getPatientBalance(p.id)
                const warn = p.history ? historySummary(p.history) : ''
                return (
                  <tr key={p.id} onClick={() => setFile(p)} className="border-t border-slate-100 dark:border-slate-800 hover:bg-cyan-500/5 cursor-pointer transition-colors">
                    <td className="px-3 py-2.5"><span className="font-mono font-black text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" dir="ltr">{partyCode('PAT', p.id)}</span></td>
                    <td className="px-3 py-2.5 font-bold">{p.nameAr}</td>
                    <td className="px-3 py-2.5" dir="ltr">{p.phone || '—'}</td>
                    <td className="px-3 py-2.5 text-[11px] max-w-48 truncate">{warn ? <span className={warn.startsWith('⚠️') ? 'text-rose-500 font-bold' : 'text-slate-400'}>{warn}</span> : <span className="text-slate-300">—</span>}</td>
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
      <Modal open={open} onClose={() => setOpen(false)} title="فتح ملف مريض" wide>
        <div className="space-y-3">
          <Field label="الاسم *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-3 gap-3">
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
            <Field label="تاريخ الميلاد"><input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} /></Field>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="font-bold text-[12px] text-slate-500 mb-2">⚕️ التاريخ المرضي — منظم بنقرات، لا كتابة حرة</div>
            <HistoryEditor value={history} onChange={setHistory} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-[12.5px] font-bold text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={linkCustomer} onChange={(e) => setLinkCustomer(e.target.checked)} className="accent-cyan-600 w-4 h-4" />
            <Link2 className="w-4 h-4 text-cyan-500" /> إنشاء/ربط حساب عميل مالي تلقائياً (يُنصح به — الزيارات تظهر في كشف الحساب)
          </label>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={savePatient} disabled={!nameAr.trim()}>فتح الملف</Btn>
          </div>
        </div>
      </Modal>

      {/* ملف المريض */}
      <Modal open={!!liveFile} onClose={() => setFile(null)} title={liveFile ? `ملف: ${liveFile.nameAr} — ${partyCode('PAT', liveFile.id)}` : ''} wide>
        {liveFile && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-cyan-500/10 p-3"><div className="text-[11px] text-slate-500">الزيارات</div><div className="font-black text-cyan-600">{fileSummary.visitCount}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">إجمالي الأتعاب</div><div className="font-black">{fmt(fileSummary.totalFeesMinor)}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">آخر زيارة</div><div className="font-black">{fileSummary.lastVisit?.slice(0, 10) ?? '—'}</div></div>
              <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">مستحق عليه</div><div className="font-black text-amber-600">{fmt(fileBalance)}</div></div>
            </div>

            {/* التاريخ المرضي + الربط المالي */}
            <div className={`rounded-xl border p-3 text-[12px] flex items-start justify-between gap-3 ${fileHistory.allergies.length ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-500/5 border-slate-200 dark:border-slate-700'}`}>
              <div>
                <b className={fileHistory.allergies.length ? 'text-rose-600' : 'text-slate-600 dark:text-slate-300'}>⚕️ التاريخ المرضي:</b>{' '}
                {fileHistoryLine || <span className="text-slate-400">لم يُسجل — اضغط تعديل</span>}
                {fileHistory.currentMeds && <div className="text-slate-500 mt-0.5">💊 أدوية حالية: {fileHistory.currentMeds}</div>}
                {fileHistory.surgeries && <div className="text-slate-500 mt-0.5">🔪 عمليات: {fileHistory.surgeries}</div>}
                {fileHistory.extraNotes && <div className="text-slate-400 mt-0.5">📝 {fileHistory.extraNotes}</div>}
                {linkedName(liveFile.linkedCustomerId) && (
                  <div className="text-cyan-600 mt-1 font-bold"><Link2 className="w-3 h-3 inline" /> مرتبط بحساب العميل: {linkedName(liveFile.linkedCustomerId)}</div>
                )}
              </div>
              <Btn variant="ghost" className="!text-[11px] !py-1 shrink-0" onClick={openHistory}>تعديل</Btn>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Btn onClick={openVisit}><Plus className="w-4 h-4" /> زيارة / كشف جديد</Btn>
              <Btn variant="ghost" onClick={() => setPlanOpen(true)}><ClipboardList className="w-4 h-4" /> خطة علاج بجلسات</Btn>
              <Btn variant="ghost" onClick={printFullRecord} disabled={fileVisits.length === 0 && !fileHistoryLine}><Printer className="w-4 h-4" /> طباعة السجل الكامل</Btn>
              {fileBalance > 0 && (
                <div className="flex gap-1 items-center">
                  <input value={collectAmount} onChange={(e) => setCollectAmount(e.target.value)} inputMode="decimal" className={`${inputCls} !w-40`} placeholder="المبلغ المحصل" />
                  <TreasuryPicker value={collectTreasury} onChange={setCollectTreasury} compact />
                  <Btn variant="ghost" onClick={doCollect} disabled={!collectAmount}><Banknote className="w-4 h-4" /> تحصيل</Btn>
                </div>
              )}
            </div>

            {/* المرفقات: أشعة/تحاليل/تقارير */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-bold text-[12px] text-slate-500 flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" /> مستندات المريض ({fileAtts.length})</div>
                <div className="flex items-center gap-1.5">
                  <select value={attKind} onChange={(e) => setAttKind(e.target.value as AttachmentKind)} className={`${inputCls} !w-32 !py-1.5 !text-[11.5px]`}>
                    {(Object.keys(ATTACHMENT_KINDS) as AttachmentKind[]).map((k) => <option key={k} value={k}>{ATTACHMENT_KINDS[k].icon} {ATTACHMENT_KINDS[k].nameAr}</option>)}
                  </select>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
                  <Btn variant="ghost" className="!text-[11px] !py-1.5" onClick={() => fileInputRef.current?.click()}><Plus className="w-3.5 h-3.5" /> إرفاق صورة/PDF</Btn>
                </div>
              </div>
              {fileAtts.length === 0 ? (
                <div className="text-center text-[11.5px] text-slate-400 py-3">لا مستندات — أرفق أشعة أو تقرير تحليل (الصور تُضغط تلقائياً)</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {fileAtts.map((a) => (
                    <div key={a.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden group relative">
                      <button onClick={() => setViewAtt(a.id)} className="block w-full text-right">
                        {a.mime === 'application/pdf' ? (
                          <div className="h-24 flex items-center justify-center bg-rose-500/5"><FileText className="w-9 h-9 text-rose-400" /></div>
                        ) : (
                          <img src={a.dataUrl} alt={a.name} className="h-24 w-full object-cover" />
                        )}
                        <div className="px-2 py-1.5">
                          <div className="text-[11px] font-bold truncate">{ATTACHMENT_KINDS[a.kind].icon} {a.name}</div>
                          <div className="text-[9.5px] text-slate-400">{a.addedAt.slice(0, 10)}</div>
                        </div>
                      </button>
                      <button onClick={() => { removePatientAttachment(a.id); toast.show('حُذف المستند') }} title="حذف" className="absolute top-1 left-1 p-1 rounded-lg bg-white/80 dark:bg-slate-900/80 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
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
                {[...fileVisits].reverse().map((v) => {
                  const vt = v.vitals ? vitalsText(v.vitals) : ''
                  const flags = v.vitals ? vitalsFlags(v.vitals) : []
                  return (
                    <div key={v.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-black">{VISIT_KIND_LABELS[v.kind].icon} {VISIT_KIND_LABELS[v.kind].nameAr} — {v.visitNumber}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{v.date.slice(0, 10)}</span>
                          <span className="font-bold text-cyan-600">{fmt(v.totals.totalMinor)} {cur.symbol}</span>
                          {v.totals.dueMinor > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">متبقٍ {fmt(v.totals.dueMinor)}</span>}
                          <button onClick={() => setViewEntryId(v.journalEntryId)} title="عرض القيد" className="p-1 rounded text-slate-400 hover:text-rose-500"><BookOpenText className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setRefundingVisit(v)} title="مرتجع زيارة (استرداد)" className="p-1 rounded text-slate-400 hover:text-amber-500 font-black text-[11px]">↩️</button>
                          <button onClick={() => printPrescription(v)} title="طباعة الروشتة" className="p-1 rounded text-slate-400 hover:text-cyan-600 flex items-center gap-0.5"><Printer className="w-3.5 h-3.5" /><span className="font-black text-[12px]">℞</span></button>
                        </div>
                      </div>
                      {vt && (
                        <div className="text-[11px] flex items-center gap-2 flex-wrap">
                          <span className="text-slate-500"><HeartPulse className="w-3 h-3 inline text-rose-400" /> {vt}</span>
                          {flags.map((f) => <span key={f} className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 font-bold text-[10px]">{f}</span>)}
                        </div>
                      )}
                      {(v.complaint || v.diagnosis) && (
                        <div className="text-[12px] text-slate-500 space-y-0.5">
                          {v.complaint && <div><b>الشكوى:</b> {v.complaint}</div>}
                          {v.diagnosis && <div><b>التشخيص:</b> {v.diagnosis}</div>}
                        </div>
                      )}
                      {(v.rxLines?.length ?? 0) > 0 && (
                        <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-2.5 py-1.5 space-y-0.5">
                          {v.rxLines!.map((l, i) => (
                            <div key={i} className="text-[11.5px]">
                              <b className="text-cyan-700 dark:text-cyan-300">℞ {l.medication}</b>
                              <span className="text-slate-500"> — {doseText(l)}{dispenseText(l) ? ` · ${dispenseText(l)}` : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {!v.rxLines?.length && v.treatment && <div className="text-[12px] text-slate-500"><b>العلاج:</b> {v.treatment}</div>}
                      {v.nextVisit && <div className="text-[11px] font-bold text-cyan-600">🗓️ المراجعة: {v.nextVisit}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* مرتجع زيارة (مراجعة المرتجعات) */}
      <Modal open={!!refundingVisit} onClose={() => setRefundingVisit(null)} title={refundingVisit ? `مرتجع زيارة ${refundingVisit.visitNumber}` : ''}>
        {refundingVisit && (
          <ServiceRefundBox
            grandMinor={refundingVisit.totals.totalMinor}
            refundedMinor={refundingVisit.refundedMinor ?? 0}
            currencySymbol={cur.symbol}
            fmt={fmt}
            allowCredit={true}
            creditLabel="حساب المريض"
            hint="كشف ملغي أو تنازل عن أتعاب: يعكس الإيراد وحصة الضريبة — «على حساب المريض» يخفض مديونيته إن وُجدت."
            onSubmit={(a) => {
              try {
                const u = refundClinicVisit({ visitId: refundingVisit.id, amountMinor: a.amountMinor, mode: a.mode === 'cash' ? 'cash' : 'patient_credit', treasury: a.treasury, reason: a.reason, approvedBy: a.approvedBy })
                setRefundingVisit(null)
                toast.show(`سُجل مرتجع الزيارة ${u.visitNumber} وتولد القيد العاكس ✅`)
              } catch (err) { toast.show((err as Error).message, 'error') }
            }}
          />
        )}
      </Modal>

      {/* تعديل التاريخ المرضي */}
      <Modal open={histOpen} onClose={() => setHistOpen(false)} title={liveFile ? `التاريخ المرضي — ${liveFile.nameAr}` : ''} wide>
        <div className="space-y-3">
          <HistoryEditor value={histDraft} onChange={setHistDraft} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setHistOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveHistory}>حفظ</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض مرفق */}
      <Modal open={!!viewingAtt} onClose={() => setViewAtt(null)} title={viewingAtt ? `${ATTACHMENT_KINDS[viewingAtt.kind].icon} ${viewingAtt.name}` : ''} wide>
        {viewingAtt && (
          viewingAtt.mime === 'application/pdf' ? (
            <iframe src={viewingAtt.dataUrl} title={viewingAtt.name} className="w-full h-[70vh] rounded-xl border border-slate-200 dark:border-slate-700" />
          ) : (
            <img src={viewingAtt.dataUrl} alt={viewingAtt.name} className="max-w-full max-h-[70vh] mx-auto rounded-xl" />
          )
        )}
      </Modal>

      {/* زيارة جديدة — روشتة منظمة كالفاتورة */}
      <Modal open={visitOpen} onClose={() => setVisitOpen(false)} title={liveFile ? `زيارة جديدة — ${liveFile.nameAr}` : ''} wide>
        <div className="space-y-3">
          {fileHistory.allergies.length > 0 && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-[12px] font-bold text-rose-600">
              ⚠️ حساسية مسجلة: {fileHistory.allergies.join('، ')} — راجع قبل الوصف
            </div>
          )}
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

          {/* العلامات الحيوية */}
          <Field label="العلامات الحيوية (اختياري)">
            <div className="grid grid-cols-5 gap-2">
              <input value={vVitals.bpSys || ''} onChange={(e) => setVVitals({ ...vVitals, bpSys: Number(e.target.value.replace(/\D/g, '')) || 0 })} inputMode="numeric" className={`${inputCls} text-center`} placeholder="ضغط ▲" title="الانقباضي" />
              <input value={vVitals.bpDia || ''} onChange={(e) => setVVitals({ ...vVitals, bpDia: Number(e.target.value.replace(/\D/g, '')) || 0 })} inputMode="numeric" className={`${inputCls} text-center`} placeholder="ضغط ▼" title="الانبساطي" />
              <input value={vVitals.pulse || ''} onChange={(e) => setVVitals({ ...vVitals, pulse: Number(e.target.value.replace(/\D/g, '')) || 0 })} inputMode="numeric" className={`${inputCls} text-center`} placeholder="نبض" />
              <input value={vVitals.tempC ? String(vVitals.tempC / 10) : ''} onChange={(e) => setVVitals({ ...vVitals, tempC: Math.round((Number(e.target.value.replace(/[^\d.]/g, '')) || 0) * 10) })} inputMode="decimal" className={`${inputCls} text-center`} placeholder="حرارة °" />
              <input value={vVitals.weightKg ? String(vVitals.weightKg / 10) : ''} onChange={(e) => setVVitals({ ...vVitals, weightKg: Math.round((Number(e.target.value.replace(/[^\d.]/g, '')) || 0) * 10) })} inputMode="decimal" className={`${inputCls} text-center`} placeholder="وزن كجم" />
            </div>
            {vitalsFlags(vVitals).length > 0 && (
              <div className="flex gap-1.5 mt-1.5">{vitalsFlags(vVitals).map((f) => <span key={f} className="px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600 font-bold text-[10.5px]">⚠️ {f}</span>)}</div>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="الشكوى"><input value={vComplaint} onChange={(e) => setVComplaint(e.target.value)} className={inputCls} /></Field>
            <Field label="التشخيص"><input value={vDiagnosis} onChange={(e) => setVDiagnosis(e.target.value)} className={inputCls} /></Field>
          </div>

          {/* الروشتة: بند لكل دواء — كالفاتورة */}
          <div className="rounded-xl border border-cyan-500/25 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-black text-[13px] text-cyan-700 dark:text-cyan-300">℞ الروشتة — بند لكل دواء</div>
              <Btn variant="ghost" className="!text-[11px] !py-1.5" onClick={() => setVRx([...vRx, emptyRxLine()])}><Plus className="w-3.5 h-3.5" /> إضافة دواء</Btn>
            </div>
            {vRx.length === 0 ? (
              <div className="text-center text-[12px] text-slate-400 py-3">لا أدوية — أضف بنداً لكل دواء (زيارة بلا روشتة مقبولة أيضاً)</div>
            ) : (
              <div className="space-y-2">
                {vRx.map((l, i) => (
                  <RxLineEditor key={i} line={l} index={i}
                    onChange={(nl) => setVRx(vRx.map((x, xi) => (xi === i ? nl : x)))}
                    onRemove={() => setVRx(vRx.filter((_, xi) => xi !== i))} />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Field label={`قيمة الزيارة (${cur.symbol}) *`}><input value={vFee} onChange={(e) => setVFee(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="المسدد الآن" hint="فارغ = سداد كامل"><input value={vPaid} onChange={(e) => setVPaid(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={vTreasury} onChange={setVTreasury} compact /></Field>
            <Field label="موعد المراجعة" hint="يُطبع أسفل الروشتة"><input type="date" value={vNext} onChange={(e) => setVNext(e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="الضريبة">
            <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer w-fit">
              <input type="checkbox" checked={vVat} onChange={(e) => setVVat(e.target.checked)} className="accent-cyan-600" />
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
            </label>
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setVisitOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveVisit} disabled={!vFee}>تسجيل الزيارة وقيدها</Btn>
          </div>
        </div>
      </Modal>

      {/* خطة علاج */}
      <Modal open={planOpen} onClose={() => setPlanOpen(false)} title={liveFile ? `خطة علاج — ${liveFile.nameAr}` : ''}>
        <div className="space-y-3">
          <Field label="عنوان الخطة *"><input value={pTitle} onChange={(e) => setPTitle(e.target.value)} className={inputCls} placeholder="خطة علاج متعددة الجلسات — مثال: جلسات ليزر، تقويم، علاج طبيعي…" /></Field>
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
