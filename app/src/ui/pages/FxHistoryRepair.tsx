import { useState } from 'react'
import { COMMON_FX_CURRENCIES, convertFxToBookMinor, parseRateToPpm, validateFxLeg } from '../../core/foreignCurrency.ts'
import { toMinor } from '../../core/money.ts'
import { useDataStore } from '../../data/repo.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

/** إصلاح المذكرة فقط: لا يُغيّر تاريخ الفاتورة أو قيم القيود المحاسبية. */
export function FxHistoryRepair({ bookCode, bookDecimals }: { bookCode: string; bookDecimals: 0 | 2 | 3 }) {
  const { sales, reconstructSaleFx, correctSaleFxMemoDate } = useDataStore()
  const toast = useToast()
  const [saleId, setSaleId] = useState('')
  const [currency, setCurrency] = useState(() => COMMON_FX_CURRENCIES.find(row => row.code !== bookCode.toUpperCase())?.code ?? 'USD')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const sale = sales.find(row => row.id === Number(saleId))
  const decimals = COMMON_FX_CURRENCIES.find(row => row.code === currency)?.decimals ?? 2
  const needsReconstruction = (() => {
    if (!sale?.fx) return true
    try { return validateFxLeg(sale.fx, bookCode).length > 0 || sale.fx.currencyCode !== sale.fx.currencyCode.trim().toUpperCase() || convertFxToBookMinor(sale.fx, bookDecimals) !== sale.paidMinor } catch { return true }
  })()
  const reset = () => { setSaleId(''); setAmount(''); setRate(''); setDate(''); setReason(''); setConfirmed(false) }

  return <details className="border-t border-slate-300 dark:border-slate-700 p-3" data-fx-history-repair>
    <summary className="cursor-pointer font-bold">مطابقة إيصال قبض تاريخي</summary>
    <p className="my-2 text-xs">اختر الفاتورة وافحص الإيصال الأصلي. استعادة ساق مفقودة أو تالفة أو تصحيح تاريخ حركة المذكرة لا يغيّر مبلغ القيد أو تاريخ الفاتورة واليومية، ولا يعدّل فروق العملة المحاسبية. تُرفض الحالات التي لا يثبت توافقها مع الحركات والتكاليف اللاحقة.</p>
    <div className="space-y-3">
      <Field label="فاتورة القبض"><select aria-label="فاتورة القبض التاريخي" className={inputCls} value={saleId} onChange={event => { setSaleId(event.target.value); setConfirmed(false); setReason(''); setDate('') }}><option value="">اختر الفاتورة</option>{sales.filter(row => (row.paidMinor ?? 0) > 0).map(row => <option key={row.id} value={row.id}>{row.invoiceNumber} — {row.fx ? `ساق ${row.fx.currencyCode}` : 'لا توجد ساق عملة'}</option>)}</select></Field>
      {sale && (!needsReconstruction ? <>
        <p className="text-xs">تاريخ الفاتورة الأصلي: {sale.date?.slice(0, 10) || 'غير مثبت'} — تاريخ حركة المذكرة الحالي: {sale.fxMemoDateHistory?.at(-1)?.correctedDate ?? sale.date?.slice(0, 10) ?? 'غير مثبت'}</p>
        <Field label="تاريخ إيصال القبض الفعلي"><input aria-label="تاريخ القبض المثبت" type="date" className={inputCls} value={date} onChange={event => setDate(event.target.value)} /></Field>
        {sale.fxMemoDateHistory?.map((row, index) => <p key={`${row.at}-${index}`} className="text-xs">{row.previousDate || 'بلا تاريخ'} ← {row.correctedDate} · {row.reason} · {row.by}</p>)}
      </> : <>
        <p className="text-xs">تاريخ الفاتورة الأصلي: {sale.date?.slice(0, 10) || 'غير مثبت'}</p>
        <Field label="تاريخ إيصال القبض الفعلي"><input aria-label="تاريخ القبض المثبت" type="date" className={inputCls} value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="عملة الإيصال"><select aria-label="عملة الساق المستعادة" className={inputCls} value={currency} onChange={event => setCurrency(event.target.value)}>{COMMON_FX_CURRENCIES.filter(row => row.code !== bookCode.toUpperCase()).map(row => <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}</select></Field>
        <Field label="مبلغ الإيصال الفعلي"><input aria-label="مبلغ الساق المستعادة" className={inputCls} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" /></Field>
        <Field label="سعر صرف الإيصال"><input aria-label="سعر الساق المستعادة" className={inputCls} value={rate} onChange={event => setRate(event.target.value)} inputMode="decimal" /></Field>
      </>)}
      {sale && <>
        <Field label="سبب ومرجع الإثبات"><input aria-label="مرجع مطابقة القبض" className={inputCls} value={reason} onChange={event => setReason(event.target.value)} placeholder="رقم الإيصال والمستند المؤيد" /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> أؤكد مطابقة المدخلات للإيصال الفعلي والمستند المؤيد.</label>
        <Btn disabled={!confirmed || !reason.trim()} onClick={() => { try {
          if (!needsReconstruction) correctSaleFxMemoDate({ saleId: sale.id, date, reason, confirmed })
          else reconstructSaleFx({ saleId: sale.id, fx: { currencyCode: currency, amountMinor: toMinor(amount, decimals), ratePpm: parseRateToPpm(rate), decimals }, receiptDate: date, reason, confirmed })
          toast.show('حُفظ إثبات حركة العملة دون تعديل قيد اليومية'); reset()
        } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذرت مطابقة الإيصال', 'error') } }}>حفظ مطابقة القبض</Btn>
      </>}
      {sale?.fxReconstructionEvidence && <p className="text-xs">الساق المستعادة: {sale.fxReconstructionEvidence.reason} · {sale.fxReconstructionEvidence.by} · {sale.fxReconstructionEvidence.at} — التاريخ {sale.fxReconstructionEvidence.receiptDate} — السابق {sale.fxReconstructionEvidence.previousFx ? JSON.stringify(sale.fxReconstructionEvidence.previousFx) : 'مفقود'}</p>}
    </div>
  </details>
}
