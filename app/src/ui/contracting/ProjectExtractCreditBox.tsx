import { useState } from 'react'
import type { ProjectExtract } from '../../data/repo.ts'
import { planProjectCreditAmounts, projectCreditEvidence } from '../../core/projectCreditAllocation.ts'
import type { ProjectRefundQuantity } from '../../core/projectRefundQuantities.ts'
import { Btn, Field, inputCls } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'

/** إشعار بكميات شريحة المستخلص؛ لا يستنتج كمية من المستخلصات القديمة. */
export function ProjectExtractCreditBox({ extract, currencySymbol, fmt, terminalOriginal, hasRetentionRelease, hasDocumentationInvoice, onSubmit }: {
  extract: ProjectExtract
  currencySymbol: string
  fmt: (minor: number) => string
  terminalOriginal?: { transactionId: string; terminalName: string }
  hasRetentionRelease: boolean
  hasDocumentationInvoice: boolean
  onSubmit: (args: { amountMinor: number; quantities: ProjectRefundQuantity[]; mode: 'cash' | 'customer_credit'; treasury: string; reason: string; approvedBy?: string; terminalRefund?: { originalTransactionId: string; providerReference: string } }) => void
}) {
  const [quantities, setQuantities] = useState<Record<number, string>>({})
  const [mode, setMode] = useState<'cash' | 'customer_credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const approval = useSupervisorApproval()
  const lines = extract.lines ?? []
  const selected = lines.filter(line => (quantities[line.boqItemId] ?? '').trim() !== '').map(line => ({ boqItemId: line.boqItemId, qty: Number(quantities[line.boqItemId]) }))
  let error = '', preview: ReturnType<typeof planProjectCreditAmounts> | null = null
  try {
    if ((extract.advanceRecoveryMinor ?? 0) !== 0) throw new Error('تسوية إشعار الكميات مع استرداد الدفعة المقدمة غير متاحة بعد — راجع المحاسب')
    if (extract.totals.retentionMinor > 0 && hasRetentionRelease) throw new Error('سبق تحصيل محتجز المشروع بلا توزيع مثبت على المستخلصات — راجع تسوية المحتجز')
    if (extract.totals.retentionMinor > 0 && hasDocumentationInvoice) throw new Error('توجد فاتورة توثيق للمشروع — راجع تسوية المستندات قبل إشعار المحتجز')
    if (!lines.length) throw new Error('المستخلص بلا بنود كمية مثبتة — راجع التاريخ')
    const previous = projectCreditEvidence(extract.refunds ?? [])
    if (selected.length) preview = planProjectCreditAmounts({ lines, totals: extract.totals, refunds: previous, refundedMinor: extract.refundedMinor ?? 0, refundedTaxMinor: extract.refundedTaxMinor ?? 0, selected })
  } catch (err) { error = err instanceof Error ? err.message : 'تعذرت معاينة الإشعار' }
  const submit = () => {
    if (!preview || !reason.trim()) return
    const amountMinor = preview.amountMinor
    approval.request(approvedBy => onSubmit({ amountMinor, quantities: selected, mode, treasury, reason: reason.trim(), approvedBy, ...(mode === 'cash' && terminalOriginal ? { terminalRefund: { originalTransactionId: terminalOriginal.transactionId, providerReference: reference.trim() } } : {}) }))
  }
  return <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-3" data-project-quantity-refund>
    <p className="text-xs text-slate-500">اختر كمية البند المردودة من شريحة هذا المستخلص. لا تتغير كمية الحصر الفعلي تلقائياً، وتُراجع تسوية الختامي مستقلة.</p>
    {lines.map(line => <Field key={line.boqItemId} label={`كمية الرد — ${line.code} ${line.descriptionAr}`}>
      <input aria-label={`كمية الرد ${line.code}`} className={inputCls} type="number" min="0" step="0.001" value={quantities[line.boqItemId] ?? ''} onChange={e => setQuantities(previous => ({ ...previous, [line.boqItemId]: e.target.value }))} />
      <span className="text-xs text-slate-500">شريحة المستخلص: {line.prevExecutedQty != null && line.newExecutedQty != null ? (Math.round(line.newExecutedQty * 1000) - Math.round(line.prevExecutedQty * 1000)) / 1000 : 'غير مثبتة'} {line.unit ?? ''}</span>
    </Field>)}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    {preview && <p className="text-sm font-bold" data-project-refund-amount>قيمة الأعمال {fmt(preview.grossMinor)} · الضريبة {fmt(preview.taxShareMinor)} · عكس المحتجز {fmt(preview.retentionMinor)} · المبلغ {fmt(preview.amountMinor)} {currencySymbol}</p>}
    <Field label="سبب الإشعار"><input aria-label="سبب الإشعار" value={reason} onChange={e => setReason(e.target.value)} className={inputCls} /></Field>
    <div className="flex gap-2"><Btn variant={mode === 'cash' ? 'primary' : 'ghost'} onClick={() => setMode('cash')}>رد نقدي / تحويل</Btn><Btn variant={mode === 'customer_credit' ? 'primary' : 'ghost'} onClick={() => setMode('customer_credit')}>على حساب العميل</Btn></div>
    {mode === 'cash' && (terminalOriginal ? <Field label={`مرجع رد الماكينة — ${terminalOriginal.terminalName}`}><input aria-label="مرجع رد الماكينة" className={inputCls} value={reference} onChange={e => setReference(e.target.value)} /></Field> : <Field label="الرد من"><TreasuryPicker value={treasury} onChange={setTreasury} operation="refund" compact /></Field>)}
    {approval.willAskPin && <p className="text-xs text-amber-700">سيُطلب اعتماد مشرف أو المالك.</p>}
    <Btn onClick={submit} disabled={!preview || !!error || !reason.trim()}>تنفيذ إشعار الكميات</Btn>
    {approval.dialog}
  </div>
}
