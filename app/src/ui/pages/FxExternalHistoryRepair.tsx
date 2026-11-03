import { useState } from 'react'
import { COMMON_FX_CURRENCIES, parseRateToPpm } from '../../core/foreignCurrency.ts'
import { toMinor } from '../../core/money.ts'
import { useDataStore } from '../../data/repo.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

/** لا يغير القيد، إنما يطابق ساق العملة وتاريخ مذكرتها مع المستند المثبت. */
export function FxExternalHistoryRepair({ bookCode }: { bookCode: string }) {
  const { vouchers, purchases, repairExternalFx } = useDataStore()
  const toast = useToast()
  const [kind, setKind] = useState<'voucher' | 'purchase'>('voucher')
  const [id, setId] = useState('')
  const [currency, setCurrency] = useState(() => COMMON_FX_CURRENCIES.find(row => row.code !== bookCode.toUpperCase())?.code ?? 'USD')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const doc = kind === 'voucher' ? vouchers.find(row => row.id === Number(id)) : purchases.find(row => row.id === Number(id))
  const decimals = COMMON_FX_CURRENCIES.find(row => row.code === currency)?.decimals ?? 2
  const clear = () => { setId(''); setAmount(''); setRate(''); setDate(''); setReason(''); setConfirmed(false) }
  return <details className="border-t border-slate-300 dark:border-slate-700 p-3" data-fx-external-history-repair>
    <summary className="cursor-pointer font-bold">مطابقة عملة سند أو شراء تاريخي</summary>
    <p className="my-2 text-xs">أدخل بيانات الإيصال الأصلي كاملة حتى عند تصحيح التاريخ فقط. تتحقق المطابقة من القيد وتكلفة الحيازة والحركات الأخرى؛ لا تُعدّل مبلغ أو تاريخ المستند أو اليومية أو فروق العملة. سندات التحويل القديمة والعهدة غير مدعومة هنا.</p>
    <div className="space-y-3">
      <Field label="نوع المستند"><select aria-label="نوع مستند العملة التاريخي" className={inputCls} value={kind} onChange={event => { setKind(event.target.value as 'voucher' | 'purchase'); clear() }}><option value="voucher">سند قبض أو صرف</option><option value="purchase">فاتورة شراء</option></select></Field>
      <Field label="المستند"><select aria-label="مستند العملة التاريخي" className={inputCls} value={id} onChange={event => { clear(); setId(event.target.value) }}><option value="">اختر المستند</option>{kind === 'voucher' ? vouchers.filter(row => row.kind !== 'transfer' && row.amountMinor > 0).map(row => <option key={row.id} value={row.id}>{row.voucherNumber} — {row.kind === 'receipt' ? 'قبض' : 'صرف'} {row.fx ? `— ${row.fx.currencyCode}` : '— بلا ساق عملة'}</option>) : purchases.filter(row => row.paidMinor > 0).map(row => <option key={row.id} value={row.id}>{row.invoiceNumber} {row.fx ? `— ${row.fx.currencyCode}` : '— بلا ساق عملة'}</option>)}</select></Field>
      {doc && <>
        <p className="text-xs">تاريخ المستند: {doc.date?.slice(0, 10) || 'غير مثبت'} — تاريخ المذكرة الحالي: {doc.fxRepairHistory?.at(-1)?.date ?? doc.date?.slice(0, 10) ?? 'غير مثبت'}</p>
        <Field label="تاريخ الإيصال الفعلي"><input aria-label="تاريخ مستند العملة المثبت" type="date" className={inputCls} value={date} onChange={event => { setDate(event.target.value); setConfirmed(false) }} /></Field>
        <Field label="عملة الإيصال"><select aria-label="عملة المستند المثبتة" className={inputCls} value={currency} onChange={event => { setCurrency(event.target.value); setConfirmed(false) }}>{COMMON_FX_CURRENCIES.filter(row => row.code !== bookCode.toUpperCase()).map(row => <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}</select></Field>
        <Field label="المبلغ بالعملة الأجنبية"><input aria-label="مبلغ المستند المثبت" className={inputCls} value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false) }} inputMode="decimal" /></Field>
        <Field label="سعر الصرف الفعلي"><input aria-label="سعر المستند المثبت" className={inputCls} value={rate} onChange={event => { setRate(event.target.value); setConfirmed(false) }} inputMode="decimal" /></Field>
        <Field label="سبب ومرجع الإثبات"><input aria-label="مرجع مستند العملة" className={inputCls} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false) }} /></Field>
        <label className="flex items-center gap-2"><input aria-label="تأكيد مستند العملة" type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> أؤكد مطابقة القيم للإيصال الفعلي والمستند المؤيد.</label>
        <Btn disabled={!confirmed || !reason.trim()} onClick={() => { try {
          repairExternalFx({ kind, id: doc.id, fx: { currencyCode: currency, amountMinor: toMinor(amount, decimals), ratePpm: parseRateToPpm(rate), decimals }, date, reason, confirmed })
          toast.show('حُفظ إثبات حركة العملة دون تعديل اليومية'); clear()
        } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذرت مطابقة المستند', 'error') } }}>حفظ مطابقة المستند</Btn>
        {doc.fxRepairHistory?.map((row, index) => <p key={`${row.at}-${index}`} className="text-xs">{row.previousDate || 'بلا تاريخ'} ← {row.date} · {row.reason} · {row.by} · الساق السابقة {row.previousFx ? JSON.stringify(row.previousFx) : 'مفقودة'}</p>)}
      </>}
    </div>
  </details>
}
