/**
 * قسم «جهات التأمين والتعاقد» — مكوّن مشترك بين الأنشطة الطبية.
 * كان مدموجاً داخل `LabReferrersPage` حصراً فلا تصل إدارة الجهات ولا
 * تحصيل المطالبات لأي نشاط آخر لا يملك وحدة `lab` (سد فجوة النشاط #12:
 * العيادة تحتاج نفس القدرة لزياراتها المؤمَّنة عبر `registerInsuredVisit`).
 * مُستخرَج بلا أي تغيير سلوكي عن النسخة الأصلية في LabPages.tsx.
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { insuredPartialAmounts } from '../../core/insurance.ts'
import { Btn, Field, inputCls, Modal, useToast } from './ui.tsx'
import { type TerminalPaymentDraft } from './TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from './PaymentMethodPicker.tsx'
import { TreasuryPicker } from './TreasuryPicker.tsx'
import { DocSectionHead, DocOutcome } from './DocSection.tsx'

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

export function InsuranceProvidersSection() {
  const { insuranceProviders, insuranceClaims, items, paymentTerminals, addInsuranceProvider, toggleInsuranceProvider, getClaimBalance, settleInsuranceClaims, getInsuranceRefundBalance, payInsuranceRefund, refundSettledInsuredSale, refundSettledInsuredSalePartial } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [insOpen, setInsOpen] = useState(false)
  const [insName, setInsName] = useState('')
  const [insPercent, setInsPercent] = useState('80')
  const [insPhone, setInsPhone] = useState('')
  const saveIns = () => {
    try {
      addInsuranceProvider({ nameAr: insName, coveragePercent: Number(insPercent) || 0, phone: insPhone.trim() })
      toast.show('أُضيفت الجهة — ستظهر كخيار تغطية ✅')
      setInsOpen(false); setInsName(''); setInsPercent('80'); setInsPhone('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const [claimTreasury, setClaimTreasury] = useState('1101')
  const [claimTerminal, setClaimTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const doSettleClaims = (id: number, name: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === claimTerminal.terminalId)
      const r = settleInsuranceClaims(id, terminal?.settlementAccountCode ?? claimTreasury, terminal ? { terminalId: terminal.id, providerReference: claimTerminal.providerReference.trim(), cardLast4: claimTerminal.cardLast4 || undefined } : undefined)
      toast.show(`حُصلت مطالبات ${name}: ${fmt(r.total)} عن ${r.count} مطالبة ✅`); setClaimTerminal({ terminalId: '', providerReference: '', cardLast4: '' })
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const [refundClaimId, setRefundClaimId] = useState<number | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refundTreasury, setRefundTreasury] = useState('1101')
  const recordRefundPayment = () => {
    try {
      if (refundClaimId == null) return
      payInsuranceRefund({ claimId: refundClaimId, amountMinor: toMinor(refundAmount, cur.decimals), treasury: refundTreasury, reason: refundReason })
      toast.show('سُجل صرف رد التأمين المؤكد ✅')
      setRefundClaimId(null); setRefundAmount(''); setRefundReason('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const [saleReturnClaimId, setSaleReturnClaimId] = useState<number | null>(null)
  const [saleReturnReason, setSaleReturnReason] = useState('')
  const [saleReturnTreasury, setSaleReturnTreasury] = useState('1101')
  const [saleReturnConfirmed, setSaleReturnConfirmed] = useState(false)
  const saleReturnClaim = insuranceClaims.find(claim => claim.id === saleReturnClaimId)
  const doSaleReturn = () => {
    try {
      if (saleReturnClaimId == null) return
      refundSettledInsuredSale({ claimId: saleReturnClaimId, treasury: saleReturnTreasury, reason: saleReturnReason, confirmReturnedStock: saleReturnConfirmed })
      toast.show('سُجل رد البيع كاملاً وأُثبت مستحق الجهة؛ لم يُصرف للجهة تلقائياً')
      setSaleReturnClaimId(null)
    } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر رد البيع', 'error') }
  }

  const [partialClaimId, setPartialClaimId] = useState<number | null>(null)
  const [partialQty, setPartialQty] = useState('')
  const [partialReason, setPartialReason] = useState('')
  const [partialTreasury, setPartialTreasury] = useState('1101')
  const [partialConfirmed, setPartialConfirmed] = useState(false)
  const partialClaim = insuranceClaims.find(claim => claim.id === partialClaimId)
  const partialPrevious = Array.isArray(partialClaim?.salePartialRefunds) ? partialClaim.salePartialRefunds.reduce((sum, row) => sum + row.qty, 0) : 0
  const partialPreview = (() => { try { return partialClaim?.salePartialBasis ? insuredPartialAmounts(partialClaim.salePartialBasis, partialPrevious, Number(partialQty)) : null } catch { return null } })()
  const doPartialReturn = () => {
    try {
      if (partialClaimId == null) return
      refundSettledInsuredSalePartial({ claimId: partialClaimId, qty: Number(partialQty), treasury: partialTreasury, reason: partialReason, confirmReturnedStock: partialConfirmed })
      toast.show('سُجل رد الكمية المؤكدة ومستحق الجهة دون صرفه تلقائياً')
      setPartialClaimId(null)
    } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذر رد الكمية', 'error') }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pt-2">
        <h2 className="font-black flex items-center gap-2">🏥 جهات التأمين والتعاقد</h2>
        <div className="flex items-center gap-2">
          {insuranceProviders.length > 0 && <div className="space-y-1"><PaymentMethodPicker value={{ treasury: claimTreasury, terminalPayment: claimTerminal }} onChange={(value) => { setClaimTreasury(value.treasury); setClaimTerminal(value.terminalPayment) }} operation="receipt" /></div>}
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
                const refundClaims = insuranceClaims.filter((c) => c.providerId === pv.id && c.settled && (c.settledRefundMinor != null || c.refundPayments != null)).map((claim) => {
                  try { return { claim, balance: getInsuranceRefundBalance(claim.id), error: false } }
                  catch { return { claim, balance: 0, error: true } }
                })
                return (
                  <tr key={pv.id} className={`border-t border-slate-100 dark:border-slate-800 ${!pv.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 font-bold">{pv.nameAr}</td>
                    <td className="px-4 py-2.5 text-[12px]">تتحمل {pv.coveragePercent}٪</td>
                    <td className="px-4 py-2.5 font-black text-violet-600 tabular-nums">{balance > 0 ? `${fmt(balance)} (${count} مطالبة)` : 'لا مطالبات'}
                      {insuranceClaims.filter(claim => claim.providerId === pv.id && claim.source === 'sale' && claim.settled && !claim.saleRefund).map(claim => {
                        const returned = Array.isArray(claim.salePartialRefunds) ? claim.salePartialRefunds.reduce((sum, row) => sum + row.qty, 0) : 0
                        const remaining = claim.salePartialBasis ? claim.salePartialBasis.qty - returned : 0
                        if (claim.salePartialBasis && remaining <= 0) return null
                        return <div key={claim.id} className="text-[11px] text-slate-600">بيع مؤمّن #{claim.id} — {fmt(claim.totalMinor)} {returned === 0 && <button type="button" className="underline text-rose-600" onClick={() => { setSaleReturnClaimId(claim.id); setSaleReturnReason(''); setSaleReturnConfirmed(false) }}>رد البيع كاملاً</button>} {claim.salePartialBasis && remaining > 0 && <button type="button" className="underline text-rose-600" onClick={() => { setPartialClaimId(claim.id); setPartialQty(''); setPartialReason(''); setPartialConfirmed(false) }}>رد كمية من البيع</button>}</div>
                      })}
                      {refundClaims.map(({ claim, balance: due, error }) => error ? <div key={claim.id} className="text-rose-600">مرتجع المطالبة #{claim.id} يحتاج مراجعة</div> : due > 0 ? <div key={claim.id} className="text-amber-700">مستحق للجهة عن المطالبة #{claim.id}: {fmt(due)} <button className="underline" onClick={() => { setRefundClaimId(claim.id); setRefundAmount(''); setRefundReason('') }}>تسجيل صرف</button></div> : null)}
                    </td>
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

      <Modal open={saleReturnClaimId != null} onClose={() => setSaleReturnClaimId(null)} title="رد بيع مؤمّن محصّل بالكامل" subtitle="يُسجّل رد حصة المريض الآن ويُثبت مستحق الجهة، دون دفعه تلقائياً. الرد الجزئي يحتاج مساراً مستقلاً.">
        <div className="space-y-3">
          {saleReturnClaim && <p>حصة المريض التي ستُصرف: {fmt(saleReturnClaim.totalMinor - saleReturnClaim.claimMinor)} · مستحق جهة التأمين: {fmt(saleReturnClaim.claimMinor)}</p>}
          {Array.isArray(saleReturnClaim?.saleSerials) && saleReturnClaim.saleSerials.length > 0 && <p>الوحدات التي يجب استلامها: {saleReturnClaim.saleSerials.map(row => `${row.serial}${row.batch ? ` (دفعة ${row.batch.lotNumber || row.batch.id}، صلاحية ${row.batch.expiryDate})` : ''}`).join('، ')}</p>}
          <Field label="خزينة رد المريض"><TreasuryPicker operation="refund" value={saleReturnTreasury} onChange={value => { setSaleReturnTreasury(value); setSaleReturnConfirmed(false) }} /></Field>
          <Field label="سبب المرتجع ومرجع رد المريض"><input aria-label="سبب رد البيع المؤمن" value={saleReturnReason} onChange={event => { setSaleReturnReason(event.target.value); setSaleReturnConfirmed(false) }} className={inputCls} /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={saleReturnConfirmed} onChange={event => setSaleReturnConfirmed(event.target.checked)} /> أؤكد استلام كامل البضاعة وصرف حصة المريض فعلياً</label>
          <Btn disabled={!saleReturnConfirmed || !saleReturnReason.trim()} onClick={doSaleReturn}>تأكيد رد البيع كاملاً</Btn>
        </div>
      </Modal>

      <Modal open={partialClaimId != null} onClose={() => setPartialClaimId(null)} title="رد كمية من بيع مؤمّن محصّل" subtitle="لبيع صنف واحد بوحدات كاملة مثبتة، بلا صلاحية أو سيريال. توزّع الكسور تراكمياً ويُحفظ أصل البيع.">
        <div className="space-y-3">
          {partialClaim?.salePartialBasis && <p>الصنف: {items.find(item => item.id === partialClaim.salePartialBasis!.itemId)?.nameAr ?? `#${partialClaim.salePartialBasis.itemId}`} · الكمية المتبقية: {partialClaim.salePartialBasis.qty - partialPrevious} من {partialClaim.salePartialBasis.qty}</p>}
          <Field label="الكمية المرتجعة"><input aria-label="كمية مرتجع البيع المؤمن" className={inputCls} value={partialQty} inputMode="numeric" onChange={event => { setPartialQty(event.target.value); setPartialConfirmed(false) }} /></Field>
          {partialPreview && <p>حصة المريض المصروفة: {fmt(partialPreview.patient)} · مستحق الجهة: {fmt(partialPreview.provider)} · الضريبة: {fmt(partialPreview.tax)} · تكلفة المخزون: {fmt(partialPreview.cost)}</p>}
          <Field label="خزينة رد المريض"><TreasuryPicker value={partialTreasury} operation="refund" onChange={value => { setPartialTreasury(value); setPartialConfirmed(false) }} /></Field>
          <Field label="سبب المرتجع ومرجع رد المريض"><input aria-label="سبب رد كمية البيع المؤمن" value={partialReason} onChange={event => { setPartialReason(event.target.value); setPartialConfirmed(false) }} className={inputCls} /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={partialConfirmed} onChange={event => setPartialConfirmed(event.target.checked)} /> أؤكد استلام الكمية المحددة وصرف حصة المريض الموضحة فعلياً</label>
          <Btn disabled={!partialConfirmed || !partialReason.trim() || !partialPreview || partialPreview.total <= 0} onClick={doPartialReturn}>تأكيد رد الكمية</Btn>
        </div>
      </Modal>

      <Modal open={refundClaimId != null} onClose={() => setRefundClaimId(null)} title="تسجيل صرف رد لجهة التأمين" subtitle={`المطالبة #${refundClaimId ?? ''} — لا تسجل إلا الصرف الفعلي المثبت`}>
        <div className="space-y-3">
          <p className="text-sm">هذا إجراء مستقل عن المرتجع والتحصيل السابق. لا تضغط التسجيل إلا بعد صرف المبلغ فعلياً للجهة؛ الصرف الجزئي متاح.</p>
          <Field label="المبلغ المصروف"><input aria-label="المبلغ المصروف للجهة" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          <Field label="الخزينة أو البنك"><TreasuryPicker operation="payment" value={refundTreasury} onChange={setRefundTreasury} /></Field>
          <Field label="سبب الصرف ومرجع العملية"><input aria-label="سبب ومرجع صرف التأمين" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className={inputCls} /></Field>
          <DocOutcome>الأثر: مدين <b>2117 مستحقات متنوعة (رد التأمين)</b> ودائن الخزينة أو البنك، دون تغيير قيد التحصيل الأصلي.</DocOutcome>
          <Btn className="w-full" onClick={recordRefundPayment} disabled={!refundAmount.trim() || !refundReason.trim()}>تأكيد تسجيل الصرف الفعلي</Btn>
        </div>
      </Modal>

      <Modal open={insOpen} onClose={() => setInsOpen(false)} title="جهة تأمين / تعاقد جديدة" subtitle="ملف تعاقد: نسبة تحمّل الجهة وما يدفعه المريض نقداً">
        <div className="space-y-3"><DocSectionHead step="١" title="الجهة ونسبة تحمّلها وشروط التحصيل" hint="حصة الجهة ذمة عليها لا نقدية في الخزينة" />
          <Field label="اسم الجهة *"><input value={insName} onChange={(e) => setInsName(e.target.value)} placeholder="شركة مصر للتأمين…" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نسبة التحمل ٪ *" hint="ما تتحمله الجهة من الفاتورة"><input value={insPercent} onChange={(e) => setInsPercent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="هاتف"><input value={insPhone} onChange={(e) => setInsPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <DocOutcome>الأثر: <b>لا قيد</b> عند التعاقد — ومع كل زيارة/طلب مؤمَّن يتوزع الإيراد: حصة المريض تحصيلاً نقدياً وحصة الجهة ذمةً على <b>1110 مطالبات تأمين</b> باسمها حتى التحصيل.</DocOutcome>
          <Btn onClick={saveIns} className="w-full" disabled={!insName.trim() || !insPercent}>إضافة الجهة</Btn>
        </div>
      </Modal>
    </div>
  )
}
