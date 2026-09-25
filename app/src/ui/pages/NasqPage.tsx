import { useMemo, useState } from 'react'
import { Calculator, Download, Plus, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { exportNasqCsv, materializeNasqSheet, summarizeNasq, type NasqColumn } from '../../core/nasq.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

export function NasqPage() {
  const { journal } = useDataStore(); const toast=useToast()
  const [columns,setColumns]=useState<NasqColumn[]>([{key:'date',labelAr:'التاريخ'},{key:'debit',labelAr:'مدين'},{key:'credit',labelAr:'دائن'},{key:'net',labelAr:'الصافي',formula:'[debit]-[credit]'}])
  const rows=useMemo(()=>journal.flatMap(e=>e.lines.map(l=>({date:e.date,debit:l.debit,credit:l.credit,account:l.accountCode}))),[journal])
  const sheet=useMemo(()=>materializeNasqSheet({nameAr:'تحليل دفتر اليومية',columns,rows}),[columns,rows])
  const summary=summarizeNasq(sheet,'net')
  const addFormula=()=>{const key=`calc${columns.length}`;setColumns([...columns,{key,labelAr:'عمود محسوب',formula:'[debit]-[credit]'}])}
  const download=()=>{const blob=new Blob(['\uFEFF'+exportNasqCsv(sheet)],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='nasq.csv';a.click();URL.revokeObjectURL(a.href)}
  return <div className="p-4 md:p-6 space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black flex items-center gap-2"><Calculator className="text-violet-500"/>نَسَق | NASQ</h1><p className="text-sm text-slate-500">مختبر الجداول والمعادلات البصرية — يعمل محلياً دون إنترنت</p></div><div className="flex gap-2"><Btn variant="ghost" onClick={addFormula}><Plus size={16}/> عمود محسوب</Btn><Btn onClick={download}><Download size={16}/> CSV</Btn></div></div>
    <div className="grid grid-cols-3 gap-3">{[['الصفوف',summary.count],['صافي الحركة',summary.sum],['المتوسط',summary.average]].map(([k,v])=><div key={String(k)} className="rounded-2xl border p-4"><div className="text-xs text-slate-500">{k}</div><b>{Number(v).toLocaleString('ar-EG')}</b></div>)}</div>
    <div className="overflow-auto rounded-2xl border"><table className="w-full text-sm"><thead><tr className="bg-slate-500/10">{columns.map((c,i)=><th key={c.key} className="p-2 min-w-40"><input className={inputCls} value={c.labelAr} onChange={e=>setColumns(columns.map((x,j)=>j===i?{...x,labelAr:e.target.value}:x))}/>{c.formula&&<div className="flex gap-1 mt-1"><input dir="ltr" className={inputCls} value={c.formula} onChange={e=>{try{setColumns(columns.map((x,j)=>j===i?{...x,formula:e.target.value}:x))}catch(err){toast.show((err as Error).message,'error')}}}/><button onClick={()=>setColumns(columns.filter((_,j)=>j!==i))}><Trash2 size={15}/></button></div>}</th>)}</tr></thead><tbody>{sheet.rows.slice(0,500).map((r,i)=><tr key={i} className="border-t">{columns.map(c=><td key={c.key} className="p-2" dir={typeof r[c.key]==='number'?'ltr':'rtl'}>{String(r[c.key]??'')}</td>)}</tr>)}</tbody></table></div>
    {sheet.rows.length>500&&<p className="text-xs text-amber-600">تُعرض أول 500 صف للأداء؛ التصدير يشمل جميع الصفوف.</p>}
  </div>
}
