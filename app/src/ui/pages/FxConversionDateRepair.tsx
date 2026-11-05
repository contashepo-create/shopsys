import { useState } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

/** تاريخ مذكرة التحويل لا يغير مستند التحويل ولا اليومية. */
export function FxConversionDateRepair() {
  const { fxConversions, correctFxConversionMemoDate } = useDataStore()
  const toast = useToast()
  const [id, setId] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const doc = fxConversions.find(row => row.id === Number(id))
  const reset = () => { setId(''); setDate(''); setReason(''); setConfirmed(false) }
  return <details className="border-t border-slate-300 dark:border-slate-700 p-3" data-fx-conversion-date-repair>
    <summary className="cursor-pointer font-bold">مطابقة تاريخ مذكرة تحويل العملة</summary>
    <p className="my-2 text-xs">أدخل تاريخ إيصال التحويل ومرجع دليله. يُصحح تاريخ ساقي المذكرة بعد مراجعة ترتيب الحركات وتكاليفها في الخزينتين؛ لا يتغير تاريخ المستند أو القيد المحاسبي ولا الفترة المحاسبية.</p>
    <div className="space-y-3">
      <Field label="التحويل"><select aria-label="تحويل العملة التاريخي" value={id} className={inputCls} onChange={event => { reset(); setId(event.target.value) }}><option value="">اختر التحويل</option>{fxConversions.filter(row => row.reversalEntryId == null).map(row => <option key={row.id} value={row.id}>{row.docNumber} — {row.fromCurrency} ← {row.toCurrency}</option>)}</select></Field>
      {doc && <>
        <p className="text-xs">تاريخ المستند والقيد لا يتغير: {doc.date || 'غير مثبت'} · تاريخ المذكرة الحالي: {(Array.isArray(doc.memoDateHistory) ? doc.memoDateHistory.at(-1)?.date : null) ?? doc.date ?? 'غير مثبت'}</p>
        <Field label="تاريخ الإيصال"><input aria-label="تاريخ تحويل العملة المثبت" type="date" className={inputCls} value={date} onChange={event => { setDate(event.target.value); setConfirmed(false) }} /></Field>
        <Field label="سبب ومرجع الإثبات"><input aria-label="مرجع تاريخ تحويل العملة" className={inputCls} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false) }} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> أؤكد مطابقة التاريخ لإيصال التحويل والمستند المؤيد.</label>
        <Btn disabled={!confirmed || !reason.trim()} onClick={() => { try {
          correctFxConversionMemoDate({ conversionId: doc.id, date, reason, confirmed })
          toast.show('حُفظ تاريخ مذكرة التحويل دون تعديل القيد'); reset()
        } catch (error) { toast.show(error instanceof Error ? error.message : 'تعذرت مطابقة تاريخ التحويل', 'error') } }}>حفظ تاريخ مذكرة التحويل</Btn>
        {Array.isArray(doc.memoDateHistory) && doc.memoDateHistory.map((row, index) => <p className="text-xs" key={`${row.at}-${index}`}>{row.previousDate || 'بلا تاريخ'} ← {row.date} · {row.reason} · {row.by}</p>)}
      </>}
    </div>
  </details>
}
