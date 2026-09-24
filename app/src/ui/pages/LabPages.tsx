/**
 * صفحات معمل التحاليل (القرار 26):
 * 1) LabOrdersPage — تسجيل طلب، دورة العينة (سحب ← نتيجة ← اعتماد)، طباعة تقرير A4
 * 2) LabTestsPage — كتالوج الفحوصات بالنطاقات المرجعية + كتالوج بدء جاهز
 * 3) LabPatientsPage — سجل المرضى
 * 4) LabReferrersPage — الأطباء المُحيلون: عمولات، كشف شهري، صرف بقيد
 * المحاسبة تلقائية بالكامل على المحرك الموحد (4106 / 5109 / 2105).
 */
import { useMemo, useState } from 'react'
import { Plus, Microscope, FlaskConical, Printer, Eye, BookOpenText, Stethoscope, HeartPulse, CheckCircle2, Banknote, Sparkles } from 'lucide-react'
import { useDataStore, type LabOrder, type LabPatient } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { partyCode, partySearchFilter } from '../../core/partyCodes.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeLabTotals, deriveOrderStatus, ORDER_STATUS_LABELS, referrerStatement, patientResultHistory, resultDeltaPercent, type RefRange, type Gender, type TestStatus } from '../../core/lab.ts'
import { printHtml } from '../print/printReceipt.ts'
import { renderLabReportHtml } from '../print/printLabReport.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

function useCur() {
  const { setup } = useAppStore()
  return useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
}

const STATUS_BADGE: Record<string, string> = {
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

const TEST_STEP: Record<TestStatus, { label: string; next: TestStatus | null; nextLabel: string }> = {
  pending: { label: 'بانتظار العينة', next: 'collected', nextLabel: 'سحب العينة' },
  collected: { label: 'العينة مسحوبة', next: 'resulted', nextLabel: 'إدخال النتيجة' },
  resulted: { label: 'نتيجة مُدخلة', next: 'approved', nextLabel: 'اعتماد' },
  approved: { label: 'معتمد ✔', next: null, nextLabel: '' },
}

/* ═══════════════ 1) الطلبات والنتائج ═══════════════ */

export function LabOrdersPage() {
  const { labOrders, labPatients, labReferrers, labTests, journal, paymentTerminals, paymentTerminalTransactions, registerLabOrder, advanceLabTest, refundLabOrder, insuranceProviders, registerInsuredLabOrder } = useDataStore()
  const { setup, receipt } = useAppStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  /* تسجيل طلب */
  const [open, setOpen] = useState(false)
  const [patientId, setPatientId] = useState('')
  const [referrerId, setReferrerId] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [insuranceId, setInsuranceId] = useState('') // '' = بلا تغطية
  const [treasury, setTreasury] = useState('1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [discount, setDiscount] = useState('0')
  const [withVat, setWithVat] = useState(false)
  const [notes, setNotes] = useState('')

  const activeTests = labTests.filter((t) => t.isActive)
  const preview = useMemo(() => {
    try {
      const prices = selected.map((id) => activeTests.find((t) => t.id === id)?.priceMinor ?? 0).filter((p) => p > 0)
      if (!prices.length) return null
      return computeLabTotals(prices, Number(discount) || 0, withVat ? setup.vatPercent : 0)
    } catch { return null }
  }, [selected, discount, withVat, setup.vatPercent, activeTests])

  const resetForm = () => { setPatientId(''); setReferrerId(''); setSelected([]); setPayment('cash'); setDiscount('0'); setWithVat(false); setNotes('') }

  // طلب آجل لمريض مربوط بعميل تجاوز حده — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const save = (creditLimitOverrideBy?: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === terminalPayment.terminalId)
      if (terminal && !terminalPayment.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
      const terminalInput = terminal ? { terminalId: terminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined
      const o = insuranceId
        ? registerInsuredLabOrder({
            patientId: Number(patientId),
            referrerId: referrerId ? Number(referrerId) : null,
            testIds: selected,
            providerId: Number(insuranceId),
            vatPercent: withVat ? setup.vatPercent : 0,
            notes: notes.trim(),
            treasury: terminal?.settlementAccountCode ?? treasury,
            terminalPayment: terminalInput,
          })
        : registerLabOrder({
            patientId: Number(patientId),
            referrerId: referrerId ? Number(referrerId) : null,
            testIds: selected,
            payment,
            discountPercent: Number(discount) || 0,
            vatPercent: withVat ? setup.vatPercent : 0,
            notes: notes.trim(),
            treasury: terminal?.settlementAccountCode ?? treasury,
            terminalPayment: terminalInput,
            creditLimitOverrideBy: creditLimitOverrideBy ?? null,
          })
      toast.show(`سُجل الطلب ${o.orderNumber} بقيد متوازن${o.commissionMinor > 0 ? ` + استحقاق عمولة ${fmt(o.commissionMinor)}` : ''} ✅`)
      setOpen(false); resetForm()
    } catch (e) {
      if (e instanceof CreditLimitError) { creditApproval.request((by) => save(by ?? 'المشرف')); return }
      toast.show((e as Error).message, 'error')
    }
  }

  /* دورة العينة */
  const [working, setWorking] = useState<LabOrder | null>(null)
  const workingLive = working ? labOrders.find((o) => o.id === working.id) ?? null : null
  const [resultDraft, setResultDraft] = useState<Record<number, string>>({})

  const advance = (orderId: number, testId: number, to: TestStatus) => {
    try {
      advanceLabTest(orderId, testId, to, to === 'resulted' ? resultDraft[testId] : undefined)
      toast.show(to === 'approved' ? 'اعتُمدت النتيجة ✔' : to === 'resulted' ? 'سُجلت النتيجة' : 'سُجل سحب العينة 🧪')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض القيود */
  const [viewing, setViewing] = useState<LabOrder | null>(null)
  const viewEntries = viewing
    ? journal.filter((e) => e.id === viewing.journalEntryId || e.id === viewing.commissionEntryId || e.id === viewing.commissionPayoutEntryId || (viewing.refunds ?? []).some((r) => r.journalEntryId === e.id))
    : []

  const doPrint = (o: LabOrder) => {
    const patient = labPatients.find((p) => p.id === o.patientId) ?? null
    const refName = o.referrerId != null ? labReferrers.find((r) => r.id === o.referrerId)?.nameAr ?? null : null
    printHtml(renderLabReportHtml(o, patient, refName, receipt))
    toast.show(`أُرسل تقرير ${o.orderNumber} للطباعة 📄`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><FlaskConical className="w-6 h-6 text-violet-500" /> طلبات التحاليل والنتائج</h1>
        <Btn onClick={() => setOpen(true)} disabled={!labPatients.length || !activeTests.length}>
          <Plus className="w-4 h-4" /> طلب جديد
        </Btn>
      </div>

      {labOrders.length === 0 ? (
        <EmptyState icon="🧪" title="لا طلبات بعد"
          sub={!labPatients.length ? 'ابدأ بتسجيل المرضى من صفحة «المرضى»، وجهّز كتالوج الفحوصات' : 'سجّل أول طلب تحاليل — القيد المحاسبي يُنشأ تلقائياً'} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <tr>
                {['الرقم', 'التاريخ', 'المريض', 'المُحيل', 'الفحوصات', 'الإجمالي', 'الحالة', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...labOrders].reverse().map((o) => {
                const st = deriveOrderStatus(o.tests.map((t) => t.status))
                const info = ORDER_STATUS_LABELS[st]
                return (
                  <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-violet-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-black">{o.orderNumber}</td>
                    <td className="px-3 py-2.5 text-slate-500">{o.date.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 font-bold">{o.patientName}</td>
                    <td className="px-3 py-2.5">{o.referrerId != null ? `د. ${labReferrers.find((r) => r.id === o.referrerId)?.nameAr ?? '—'}` : '—'}</td>
                    <td className="px-3 py-2.5">{o.tests.length}</td>
                    <td className="px-3 py-2.5 font-bold">{fmt(o.totals.totalMinor)} {cur.symbol}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${STATUS_BADGE[info.color]}`}>{info.nameAr}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setWorking(o); setResultDraft({}) }} title="دورة العينة والنتائج" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all hover:scale-110"><Microscope className="w-4 h-4" /></button>
                        <button onClick={() => doPrint(o)} title="طباعة تقرير النتائج A4" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all hover:scale-110"><Printer className="w-4 h-4" /></button>
                        <button onClick={() => setViewing(o)} title="التفاصيل والقيود" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Eye className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── تسجيل طلب ─── */}
      <Modal open={open} onClose={() => setOpen(false)} title="طلب تحاليل جديد" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="المريض *">
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className={inputCls}>
                <option value="">— اختر —</option>
                {labPatients.map((p) => <option key={p.id} value={p.id}>{p.nameAr} {p.phone && `(${p.phone})`}</option>)}
              </select>
            </Field>
            <Field label="الطبيب المُحيل (اختياري)" hint="تُستحق عمولته تلقائياً بقيد منفصل">
              <select value={referrerId} onChange={(e) => setReferrerId(e.target.value)} className={inputCls}>
                <option value="">بدون إحالة</option>
                {labReferrers.map((r) => <option key={r.id} value={r.id}>د. {r.nameAr} — {r.commissionPercent}٪</option>)}
              </select>
            </Field>
          </div>

          <Field label={`الفحوصات المطلوبة * (${selected.length} مختار)`}>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {activeTests.map((t) => {
                const on = selected.includes(t.id)
                return (
                  <label key={t.id} className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${on ? 'bg-violet-500/10' : 'hover:bg-slate-500/5'}`}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={on} onChange={() => setSelected(on ? selected.filter((x) => x !== t.id) : [...selected, t.id])} className="accent-violet-600" />
                      <span className="font-bold">{t.nameAr}</span>
                      <span className="text-[11px] text-slate-400 font-mono">{t.code}</span>
                    </span>
                    <span className="text-[12px] font-bold text-violet-600 dark:text-violet-400">{fmt(t.priceMinor)} {cur.symbol}</span>
                  </label>
                )
              })}
            </div>
          </Field>

          {insuranceProviders.some((pv) => pv.isActive) && (
            <Field label="تغطية تأمين / جهة تعاقد" hint="الجهة تتحمل نسبتها كمطالبة (1110) والمريض يدفع الباقي نقداً">
              <select value={insuranceId} onChange={(e) => setInsuranceId(e.target.value)} className={inputCls}>
                <option value="">بلا تغطية (المريض يدفع كاملاً)</option>
                {insuranceProviders.filter((pv) => pv.isActive).map((pv) => <option key={pv.id} value={pv.id}>{pv.nameAr} — تتحمل {pv.coveragePercent}٪</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="طريقة السداد">
              <div className="flex gap-2">
                {(['cash', 'credit'] as const).map((p) => (
                  <button key={p} onClick={() => setPayment(p)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${payment === p ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {p === 'cash' ? 'نقدي' : 'آجل / شركة'}
                  </button>
                ))}
              </div>
              {(payment === 'cash' || insuranceId) && <div className="mt-2 space-y-2"><PaymentMethodPicker value={{treasury,terminalPayment}} onChange={value=>{setTreasury(value.treasury);setTerminalPayment(value.terminalPayment)}} operation="receipt"/></div>}
            </Field>
            <Field label="خصم ٪"><input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="الضريبة">
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="accent-violet-600" />
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
              </label>
            </Field>
          </div>

          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="صائم 12 ساعة…" /></Field>

          {preview && (
            <div className="rounded-xl bg-violet-500/10 border border-violet-500/30 p-3 grid grid-cols-4 gap-2 text-center text-sm">
              <div><div className="text-[11px] text-slate-500">الفحوصات</div><div className="font-black">{fmt(preview.grossMinor)}</div></div>
              <div><div className="text-[11px] text-slate-500">الخصم</div><div className="font-black text-rose-500">{fmt(preview.discountMinor)}</div></div>
              <div><div className="text-[11px] text-slate-500">الضريبة</div><div className="font-black">{fmt(preview.vatMinor)}</div></div>
              <div><div className="text-[11px] text-slate-500">الإجمالي</div><div className="font-black text-violet-600 dark:text-violet-400">{fmt(preview.totalMinor)} {cur.symbol}</div></div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} shortcut="F9" disabled={!patientId || !selected.length}>تسجيل الطلب وإنشاء القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* ─── دورة العينة والنتائج ─── */}
      <Modal open={!!workingLive} onClose={() => setWorking(null)} title={workingLive ? `${workingLive.orderNumber} — ${workingLive.patientName}` : ''} wide>
        {workingLive && (
          <div className="space-y-3">
            {workingLive.tests.map((t) => {
              const step = TEST_STEP[t.status]
              return (
                <div key={t.testId} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-black">{t.nameAr}</span>
                      <span className="text-[11px] text-slate-400 font-mono mr-2">{t.code}</span>
                    </div>
                    <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${t.status === 'approved' ? STATUS_BADGE.emerald : t.status === 'resulted' ? STATUS_BADGE.sky : t.status === 'collected' ? STATUS_BADGE.amber : STATUS_BADGE.slate}`}>{step.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-slate-500">
                    <span>النطاق: {t.refLow ?? '—'} – {t.refHigh ?? '—'} {t.unit}</span>
                    {t.resultValue && (
                      <span className={`font-black text-sm ${t.resultFlag === 'critical_high' || t.resultFlag === 'critical_low' ? 'text-white bg-rose-600 px-2 py-0.5 rounded-lg animate-pulse' : t.resultFlag === 'high' ? 'text-rose-600' : t.resultFlag === 'low' ? 'text-sky-600' : 'text-emerald-600'}`}>
                        النتيجة: {t.resultValue} {t.unit} {t.resultFlag === 'critical_high' ? '🚨 حرجة مرتفعة — أبلغ الطبيب فوراً' : t.resultFlag === 'critical_low' ? '🚨 حرجة منخفضة — أبلغ الطبيب فوراً' : t.resultFlag === 'high' ? '▲' : t.resultFlag === 'low' ? '▼' : ''}
                      </span>
                    )}
                  </div>
                  {/* جولة المعمل: السجل التراكمي — النتائج السابقة لنفس الفحص مع نسبة التغير (Delta Check) */}
                  {(() => {
                    const hist = patientResultHistory(labOrders, workingLive.patientId, t.testId)
                      .filter((h) => h.orderNumber !== workingLive.orderNumber).slice(0, 3)
                    if (!hist.length) return null
                    const delta = t.resultValue ? resultDeltaPercent(t.resultValue, hist[0].resultValue) : null
                    return (
                      <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 px-2.5 py-1.5 text-[10.5px] text-slate-500">
                        <span className="font-bold text-violet-600">سوابق:</span>
                        {hist.map((h) => (
                          <span key={h.orderNumber} className="ms-2">{h.date.slice(0, 10)}: <b className={h.resultFlag === 'high' ? 'text-rose-500' : h.resultFlag === 'low' ? 'text-sky-500' : ''}>{h.resultValue}</b></span>
                        ))}
                        {delta !== null && Math.abs(delta) >= 20 && (
                          <span className="ms-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold">Δ {delta > 0 ? '+' : ''}{delta}% عن السابقة — راجِع</span>
                        )}
                      </div>
                    )
                  })()}
                  {step.next && (
                    <div className="flex items-center gap-2">
                      {step.next === 'resulted' && (
                        <input value={resultDraft[t.testId] ?? ''} onChange={(e) => setResultDraft({ ...resultDraft, [t.testId]: e.target.value })}
                          className={`${inputCls} max-w-[200px]`} placeholder={`القيمة${t.unit ? ` (${t.unit})` : ''}`} />
                      )}
                      <Btn onClick={() => advance(workingLive.id, t.testId, step.next!)}>
                        {step.next === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <Microscope className="w-4 h-4" />} {step.nextLabel}
                      </Btn>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setWorking(null)}>إغلاق</Btn>
              <Btn onClick={() => doPrint(workingLive)}><Printer className="w-4 h-4" /> طباعة التقرير</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── التفاصيل والقيود ─── */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `تفاصيل ${viewing.orderNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">المريض</div><div className="font-black">{viewing.patientName}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">السداد</div><div className="font-black">{viewing.payment === 'cash' ? 'نقدي' : 'آجل'}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">الإجمالي</div><div className="font-black text-violet-600">{fmt(viewing.totals.totalMinor)} {cur.symbol}</div></div>
            </div>
            {viewing.commissionMinor > 0 && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[13px] font-bold text-amber-700 dark:text-amber-400">
                عمولة المُحيل: {fmt(viewing.commissionMinor)} {cur.symbol} — {viewing.commissionPaid ? 'مدفوعة ✔' : 'مستحقة (تُصرف من صفحة الأطباء)'}
              </div>
            )}
            <ServiceRefundBox
              grandMinor={viewing.totals.totalMinor}
              refundedMinor={viewing.refundedMinor ?? 0}
              currencySymbol={cur.symbol}
              fmt={fmt}
              terminalOriginal={(() => { const x = paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'lab' && row.documentId === String(viewing.id)); return x ? { transactionId: x.id, terminalName: paymentTerminals.find((t) => t.id === x.terminalId)?.nameAr ?? x.terminalId } : undefined })()}
              allowCredit={viewing.payment === 'credit' || labPatients.find((pt) => pt.id === viewing.patientId)?.linkedCustomerId != null}
              hint="فحص أُلغي أو أُعيدت العينة؟ اختر الفحوصات الملغاة — يعكس الإيراد وحصة الضريبة، وعمولة المُحيل غير المصروفة تُعكس بنفس النسبة تلقائياً."
              refundableItems={viewing.tests.map((t, ti) => ({ key: `test:${ti}`, label: `${t.nameAr} (${t.code})`, valueMinor: t.priceMinor }))}
              onSubmit={(a) => {
                try {
                  const original = a.terminalRefund ? paymentTerminalTransactions.find((row) => row.id === a.terminalRefund!.originalTransactionId) : undefined
                  const treasury = original ? paymentTerminals.find((row) => row.id === original.terminalId)?.settlementAccountCode ?? a.treasury : a.treasury
                  const u = refundLabOrder({ orderId: viewing.id, ...a, treasury })
                  setViewing(u)
                  toast.show(`سُجل مرتجع التحاليل ${u.orderNumber} وتولد القيد العاكس ✅`)
                } catch (err) { toast.show((err as Error).message, 'error') }
              }}
            />
            {viewEntries.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-rose-500/10 px-3 py-2 flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-[12px]">
                  <BookOpenText className="w-4 h-4" /> قيد #{e.entryNumber} — {e.description}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {e.lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                        <td className="px-3 py-1.5 text-emerald-600 font-bold">{l.debit ? fmt(l.debit) : ''}</td>
                        <td className="px-3 py-1.5 text-rose-600 font-bold">{l.credit ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}

/* ═══════════════ 2) كتالوج الفحوصات ═══════════════ */

const EMPTY_RANGE: RefRange = { gender: 'any', ageMinYears: 0, ageMaxYears: 999, low: null, high: null }

export function LabTestsPage() {
  const { labTests, addLabTest, updateLabTest, seedStarterTests } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [category, setCategory] = useState('كيمياء')
  const [sampleType, setSampleType] = useState('دم وريدي')
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [ranges, setRanges] = useState<RefRange[]>([])

  const openNew = () => { setEditingId(null); setCode(''); setNameAr(''); setCategory('كيمياء'); setSampleType('دم وريدي'); setUnit(''); setPrice(''); setCost(''); setRanges([]); setOpen(true) }
  const openEdit = (id: number) => {
    const t = labTests.find((x) => x.id === id)
    if (!t) return
    setEditingId(id); setCode(t.code); setNameAr(t.nameAr); setCategory(t.category); setSampleType(t.sampleType); setUnit(t.unit)
    setPrice(String(t.priceMinor / 10 ** cur.decimals)); setCost(t.costMinor ? String(t.costMinor / 10 ** cur.decimals) : '')
    setRanges(t.refRanges.map((r) => ({ ...r }))); setOpen(true)
  }

  const save = () => {
    try {
      const payload = {
        code: code.trim().toUpperCase(), nameAr: nameAr.trim(), category: category.trim(), sampleType: sampleType.trim(), unit: unit.trim(),
        priceMinor: toMinor(price, cur.decimals), costMinor: cost ? toMinor(cost, cur.decimals) : 0, refRanges: ranges,
      }
      if (editingId != null) { updateLabTest(editingId, payload); toast.show('عُدّل الفحص ✅') }
      else { addLabTest(payload); toast.show(`أُضيف الفحص ${payload.code} ✅`) }
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const seed = () => {
    const n = seedStarterTests(toMinor('100', cur.decimals))
    toast.show(n ? `أُضيف ${n} فحصاً شائعاً بسعر افتراضي 100 — عدّل الأسعار ✨` : 'كل فحوصات كتالوج البدء موجودة بالفعل')
  }

  const setRange = (i: number, patch: Partial<RefRange>) => setRanges(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><Microscope className="w-6 h-6 text-violet-500" /> كتالوج الفحوصات</h1>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={seed}><Sparkles className="w-4 h-4" /> كتالوج بدء جاهز</Btn>
          <Btn onClick={openNew}><Plus className="w-4 h-4" /> فحص جديد</Btn>
        </div>
      </div>

      {labTests.length === 0 ? (
        <EmptyState icon="🔬" title="لا فحوصات بعد" sub="أضف فحوصاتك يدوياً، أو حمّل كتالوج البدء (CBC، سكر، وظائف كلى وكبد…) وعدّل الأسعار" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <tr>{['الكود', 'الفحص', 'التصنيف', 'العينة', 'الوحدة', 'النطاقات', 'السعر', 'الحالة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {labTests.map((t) => (
                <tr key={t.id} onClick={() => openEdit(t.id)} className="border-t border-slate-100 dark:border-slate-800 hover:bg-violet-500/5 cursor-pointer transition-colors">
                  <td className="px-3 py-2.5 font-mono font-black">{t.code}</td>
                  <td className="px-3 py-2.5 font-bold">{t.nameAr}</td>
                  <td className="px-3 py-2.5">{t.category}</td>
                  <td className="px-3 py-2.5 text-slate-500">{t.sampleType}</td>
                  <td className="px-3 py-2.5">{t.unit || '—'}</td>
                  <td className="px-3 py-2.5">{t.refRanges.length || '—'}</td>
                  <td className="px-3 py-2.5 font-bold">{fmt(t.priceMinor)} {cur.symbol}</td>
                  <td className="px-3 py-2.5">
                    <button onClick={(e) => { e.stopPropagation(); updateLabTest(t.id, { isActive: !t.isActive }) }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${t.isActive ? STATUS_BADGE.emerald : STATUS_BADGE.slate}`}>
                      {t.isActive ? 'مفعل' : 'موقوف'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingId != null ? 'تعديل فحص' : 'فحص جديد'} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="الكود *" hint="CBC، FBS…"><input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="اسم الفحص *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} /></Field>
            <Field label="التصنيف"><input value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} placeholder="كيمياء، هرمونات…" /></Field>
            <Field label="نوع العينة"><input value={sampleType} onChange={(e) => setSampleType(e.target.value)} className={inputCls} /></Field>
            <Field label="وحدة القياس" hint="فارغة = نتيجة وصفية"><input value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls} dir="ltr" placeholder="mg/dL" /></Field>
            <Field label={`السعر (${cur.symbol}) *`}><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="تكلفة المستهلكات (اختياري)"><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>

          <Field label="النطاقات المرجعية" hint="حسب الجنس والعمر — تُطبع في التقرير ويُقيَّم بها مرتفع/منخفض — والقيم الحرجة 🚨 تستلزم إبلاغ الطبيب فوراً (معيار CAP/CLIA)">
            <div className="space-y-2">
              {ranges.map((r, i) => (
                <div key={i} className="grid grid-cols-8 gap-2 items-center">
                  <select value={r.gender} onChange={(e) => setRange(i, { gender: e.target.value as RefRange['gender'] })} className={inputCls}>
                    <option value="any">الجميع</option><option value="male">ذكور</option><option value="female">إناث</option>
                  </select>
                  <input value={r.ageMinYears} onChange={(e) => setRange(i, { ageMinYears: Number(e.target.value) || 0 })} inputMode="numeric" className={inputCls} placeholder="من سن" />
                  <input value={r.ageMaxYears} onChange={(e) => setRange(i, { ageMaxYears: Number(e.target.value) || 999 })} inputMode="numeric" className={inputCls} placeholder="إلى سن" />
                  <input value={r.low ?? ''} onChange={(e) => setRange(i, { low: e.target.value === '' ? null : Number(e.target.value) })} inputMode="decimal" className={inputCls} placeholder="الأدنى" dir="ltr" />
                  <input value={r.high ?? ''} onChange={(e) => setRange(i, { high: e.target.value === '' ? null : Number(e.target.value) })} inputMode="decimal" className={inputCls} placeholder="الأعلى" dir="ltr" />
                  <input value={r.criticalLow ?? ''} onChange={(e) => setRange(i, { criticalLow: e.target.value === '' ? null : Number(e.target.value) })} inputMode="decimal" className={`${inputCls} !border-rose-300`} placeholder="🚨 حرج أدنى" dir="ltr" title="قيمة حرجة منخفضة (CAP/CLIA) — دونها إبلاغ فوري للطبيب" />
                  <input value={r.criticalHigh ?? ''} onChange={(e) => setRange(i, { criticalHigh: e.target.value === '' ? null : Number(e.target.value) })} inputMode="decimal" className={`${inputCls} !border-rose-300`} placeholder="🚨 حرج أعلى" dir="ltr" title="قيمة حرجة مرتفعة (CAP/CLIA) — فوقها إبلاغ فوري للطبيب" />
                  <button onClick={() => setRanges(ranges.filter((_, j) => j !== i))} className="text-rose-500 font-bold text-sm hover:scale-110 transition-transform">حذف</button>
                </div>
              ))}
              <Btn variant="ghost" onClick={() => setRanges([...ranges, { ...EMPTY_RANGE }])}><Plus className="w-4 h-4" /> إضافة نطاق</Btn>
            </div>
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save}>{editingId != null ? 'حفظ التعديل' : 'إضافة الفحص'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════════ 3) المرضى ═══════════════ */

export function LabPatientsPage() {
  const { labPatients, labOrders, addLabPatient, updateLabPatient, customers } = useDataStore()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [phone, setPhone] = useState('')
  const [gender, setGender] = useState<Gender>('male')
  const [birthDate, setBirthDate] = useState('')
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')

  const save = () => {
    try {
      addLabPatient({ nameAr: nameAr.trim(), phone: phone.trim(), gender, birthDate, notes: notes.trim() })
      toast.show('سُجل المريض ✅')
      setOpen(false); setNameAr(''); setPhone(''); setGender('male'); setBirthDate(''); setNotes('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  // البحث بالكود: LPT-0001 أو 1
  const filtered = partySearchFilter(labPatients, q, 'LPT')
  const orderCount = (p: LabPatient) => labOrders.filter((o) => o.patientId === p.id).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><HeartPulse className="w-6 h-6 text-violet-500" /> المرضى</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> مريض جديد</Btn>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="بحث بالاسم أو الهاتف أو الكود (LPT-0001 أو 1)…" />

      {filtered.length === 0 ? (
        <EmptyState icon="🫀" title="لا مرضى" sub="سجّل أول مريض لبدء استقبال الطلبات — كل البيانات اختيارية عدا الاسم" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <tr>{['الكود', 'الاسم', 'الهاتف', 'النوع', 'تاريخ الميلاد', 'الطلبات', 'العميل المرتبط', 'ملاحظات'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-violet-500/5 transition-colors">
                  <td className="px-3 py-2.5"><span className="font-mono font-black text-[11px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300" dir="ltr">{partyCode('LPT', p.id)}</span></td>
                  <td className="px-3 py-2.5 font-bold">{p.nameAr}</td>
                  <td className="px-3 py-2.5" dir="ltr">{p.phone || '—'}</td>
                  <td className="px-3 py-2.5">{p.gender === 'female' ? 'أنثى' : 'ذكر'}</td>
                  <td className="px-3 py-2.5">{p.birthDate || '—'}</td>
                  <td className="px-3 py-2.5 font-bold">{orderCount(p)}</td>
                  <td className="px-3 py-2.5">
                    {/* ربط بعميل مالي (إصلاح الترابط): طلباته الآجلة تدخل كشف حساب العميل */}
                    <select
                      value={p.linkedCustomerId ?? 0}
                      onChange={(e) => { updateLabPatient(p.id, { linkedCustomerId: Number(e.target.value) || null }); }}
                      className="text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-1.5 py-1 max-w-[130px]"
                      title="اربط المريض بعميل مالي — طلباته الآجلة تظهر في كشف حساب العميل"
                    >
                      <option value={0}>بلا ربط</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="تسجيل مريض">
        <div className="space-y-3">
          <Field label="الاسم *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} /></Field>
            <Field label="النوع" hint="يحدد النطاق المرجعي المناسب">
              <div className="flex gap-2">
                {(['male', 'female'] as const).map((g) => (
                  <button key={g} onClick={() => setGender(g)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${gender === g ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {g === 'male' ? 'ذكر' : 'أنثى'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="تاريخ الميلاد" hint="يحدد الشريحة العمرية للنطاقات"><input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} /></Field>
          <Field label="ملاحظات طبية"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="سكري، حساسية…" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!nameAr.trim()}>تسجيل</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ═══════════════ 4) الأطباء المُحيلون ═══════════════ */

export function LabReferrersPage() {
  const { labReferrers, labOrders, paymentTerminals, addLabReferrer, payReferrerCommissions, insuranceProviders, insuranceClaims, addInsuranceProvider, toggleInsuranceProvider, getClaimBalance, settleInsuranceClaims } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [phone, setPhone] = useState('')
  const [percent, setPercent] = useState('10')
  const [notes, setNotes] = useState('')

  const save = () => {
    try {
      addLabReferrer({ nameAr: nameAr.trim(), phone: phone.trim(), commissionPercent: Number(percent) || 0, notes: notes.trim() })
      toast.show('أُضيف الطبيب ✅')
      setOpen(false); setNameAr(''); setPhone(''); setPercent('10'); setNotes('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* كشف شهري */
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [stmtRef, setStmtRef] = useState<number | null>(null)
  const [month, setMonth] = useState(thisMonth)
  const stmt = useMemo(() => {
    if (stmtRef == null) return null
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return referrerStatement(labOrders, stmtRef, { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` })
  }, [stmtRef, month, labOrders])

  const [payoutFor, setPayoutFor] = useState<{ id: number; name: string } | null>(null)
  const [payoutTreasury, setPayoutTreasury] = useState('1101')

  /* جهات التأمين والتعاقد */
  const [insOpen, setInsOpen] = useState(false)
  const [insName, setInsName] = useState('')
  const [insPercent, setInsPercent] = useState('80')
  const [insPhone, setInsPhone] = useState('')
  const saveIns = () => {
    try {
      addInsuranceProvider({ nameAr: insName, coveragePercent: Number(insPercent) || 0, phone: insPhone.trim() })
      toast.show('أُضيفت الجهة — ستظهر في نموذج الطلب كخيار تغطية ✅')
      setInsOpen(false); setInsName(''); setInsPercent('80'); setInsPhone('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const [claimTreasury, setClaimTreasury] = useState('1101')
  const [claimTerminal, setClaimTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const doSettleClaims = (id: number, name: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === claimTerminal.terminalId)
      if (terminal && !claimTerminal.providerReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
      const r = settleInsuranceClaims(id, terminal?.settlementAccountCode ?? claimTreasury, terminal ? { terminalId: terminal.id, providerReference: claimTerminal.providerReference.trim(), cardLast4: claimTerminal.cardLast4 || undefined } : undefined)
      toast.show(`حُصلت مطالبات ${name}: ${fmt(r.total)} عن ${r.count} مطالبة ✅`); setClaimTerminal({ terminalId: '', providerReference: '', cardLast4: '' })
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const doPayout = () => {
    if (!payoutFor) return
    try {
      const r = payReferrerCommissions(payoutFor.id, payoutTreasury)
      toast.show(`صُرفت عمولات د. ${payoutFor.name}: ${fmt(r.total)} ${cur.symbol} عن ${r.orderCount} طلب — بقيد متوازن ✅`)
      setPayoutFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const unpaidFor = (id: number) => labOrders.filter((o) => o.referrerId === id && !o.commissionPaid).reduce((a, o) => a + o.commissionMinor, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><Stethoscope className="w-6 h-6 text-violet-500" /> الأطباء المُحيلون</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> طبيب جديد</Btn>
      </div>

      {labReferrers.length === 0 ? (
        <EmptyState icon="🩺" title="لا أطباء محيلون" sub="أضف الأطباء ونسبة عمولة كلٍّ منهم — الاستحقاق تلقائي مع كل طلب محال، والصرف بقيد واحد شهرياً" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <tr>{['الطبيب', 'الهاتف', 'العمولة ٪', 'إحالات', 'مستحق غير مدفوع', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {labReferrers.map((r) => {
                const unpaid = unpaidFor(r.id)
                return (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-violet-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-bold">د. {r.nameAr}</td>
                    <td className="px-3 py-2.5" dir="ltr">{r.phone || '—'}</td>
                    <td className="px-3 py-2.5 font-bold">{r.commissionPercent}٪</td>
                    <td className="px-3 py-2.5">{labOrders.filter((o) => o.referrerId === r.id).length}</td>
                    <td className="px-3 py-2.5 font-black text-amber-600 dark:text-amber-400">{unpaid ? `${fmt(unpaid)} ${cur.symbol}` : '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => { setStmtRef(r.id); setMonth(thisMonth) }} title="كشف شهري" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all hover:scale-110"><BookOpenText className="w-4 h-4" /></button>
                        {unpaid > 0 && (
                          <button onClick={() => setPayoutFor({ id: r.id, name: r.nameAr })} title="صرف العمولات المستحقة" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Banknote className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="طبيب مُحيل جديد">
        <div className="space-y-3">
          <Field label="اسم الطبيب *"><input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الهاتف"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} /></Field>
            <Field label="نسبة العمولة ٪ *" hint="من صافي الطلب بعد الخصم (حد أقصى 50٪)"><input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!nameAr.trim()}>إضافة</Btn>
          </div>
        </div>
      </Modal>

      <Modal open={stmtRef != null} onClose={() => setStmtRef(null)} title={stmtRef != null ? `كشف د. ${labReferrers.find((r) => r.id === stmtRef)?.nameAr ?? ''}` : ''} wide>
        {stmt && (
          <div className="space-y-3">
            <Field label="الشهر"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} /></Field>
            {stmt.rows.length === 0 ? (
              <EmptyState icon="📭" title="لا إحالات في هذا الشهر" sub="جرّب شهراً آخر" />
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-[12px]">
                    <thead className="bg-violet-500/10 text-violet-700 dark:text-violet-300">
                      <tr>{['التاريخ', 'الطلب', 'المريض', 'الصافي', 'العمولة', 'الحالة'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {stmt.rows.map((r) => (
                        <tr key={r.orderId} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-3 py-2">{r.date}</td>
                          <td className="px-3 py-2 font-bold">{r.orderNumber}</td>
                          <td className="px-3 py-2">{r.patientName}</td>
                          <td className="px-3 py-2">{fmt(r.netMinor)}</td>
                          <td className="px-3 py-2 font-bold">{fmt(r.commissionMinor)}</td>
                          <td className="px-3 py-2">{r.paid ? <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${STATUS_BADGE.emerald}`}>مدفوعة</span> : <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${STATUS_BADGE.amber}`}>مستحقة</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">صافي الإحالات</div><div className="font-black">{fmt(stmt.totalNetMinor)}</div></div>
                  <div className="rounded-xl bg-violet-500/10 p-3"><div className="text-[11px] text-slate-500">إجمالي العمولات</div><div className="font-black text-violet-600">{fmt(stmt.totalCommissionMinor)}</div></div>
                  <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">غير مدفوع</div><div className="font-black text-amber-600">{fmt(stmt.unpaidCommissionMinor)}</div></div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* صرف عمولات محيل — باختيار الخزينة (طلب المالك) */}
      <Modal open={!!payoutFor} onClose={() => setPayoutFor(null)} title={payoutFor ? `صرف عمولات د. ${payoutFor.name}` : ''}>
        {payoutFor && (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 text-[13px] font-bold text-amber-700 dark:text-amber-300">
              المستحق غير المدفوع: {fmt(unpaidFor(payoutFor.id))} {cur.symbol}
            </div>
            <Field label="من أي خزينة/بنك؟"><TreasuryPicker value={payoutTreasury} onChange={setPayoutTreasury} compact /></Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPayoutFor(null)}>إلغاء</Btn>
              <Btn onClick={doPayout} shortcut="F9">💸 صرف الآن</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ═══ جهات التأمين والتعاقد ═══ */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="font-black flex items-center gap-2">🏥 جهات التأمين والتعاقد</h2>
        <div className="flex items-center gap-2">
          {insuranceProviders.length > 0 && <div className="space-y-1"><PaymentMethodPicker value={{treasury:claimTreasury,terminalPayment:claimTerminal}} onChange={value=>{setClaimTreasury(value.treasury);setClaimTerminal(value.terminalPayment)}} operation="receipt"/></div>}
          <Btn variant="soft" onClick={() => setInsOpen(true)}><Plus className="w-4 h-4" /> جهة جديدة</Btn>
        </div>
      </div>
      {insuranceProviders.length === 0 ? (
        <div className="text-[12px] text-slate-400 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          أضف شركة تأمين أو جهة تعاقد بنسبة تحملها — المريض يدفع نصيبه فقط، ونصيب الجهة يتجمع كمطالبات تُحصَّل دفعة واحدة
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {insuranceProviders.map((pv) => {
                const balance = getClaimBalance(pv.id)
                const count = insuranceClaims.filter((c) => c.providerId === pv.id && !c.settled).length
                return (
                  <tr key={pv.id} className={`border-t border-slate-100 dark:border-slate-800 ${!pv.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 font-bold">{pv.nameAr}</td>
                    <td className="px-4 py-2.5 text-[12px]">تتحمل {pv.coveragePercent}٪</td>
                    <td className="px-4 py-2.5 font-black text-violet-600 tabular-nums">{balance > 0 ? `${fmt(balance)} (${count} مطالبة)` : 'لا مطالبات'}</td>
                    <td className="px-4 py-2.5 text-left">
                      <div className="flex gap-1 justify-end">
                        {balance > 0 && <Btn variant="soft" onClick={() => doSettleClaims(pv.id, pv.nameAr)}>تحصيل الكل</Btn>}
                        <button onClick={() => toggleInsuranceProvider(pv.id)} className="text-[11px] font-bold text-slate-400 hover:text-amber-600 px-2">{pv.isActive ? 'تعطيل' : 'تفعيل'}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* نافذة جهة جديدة */}
      <Modal open={insOpen} onClose={() => setInsOpen(false)} title="جهة تأمين / تعاقد جديدة">
        <div className="space-y-3">
          <Field label="اسم الجهة *"><input value={insName} onChange={(e) => setInsName(e.target.value)} placeholder="شركة مصر للتأمين…" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نسبة التحمل ٪ *" hint="ما تتحمله الجهة من الفاتورة"><input value={insPercent} onChange={(e) => setInsPercent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="هاتف"><input value={insPhone} onChange={(e) => setInsPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <Btn onClick={saveIns} className="w-full" disabled={!insName.trim() || !insPercent}>إضافة الجهة</Btn>
        </div>
      </Modal>
    </div>
  )
}
