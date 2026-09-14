/**
 * عروض الأسعار والمناقصات + عُهد المشاريع (طلب المالك — مرجعية pro-acc)
 * العرض مستند غير محاسبي ببنود أعمال؛ الفائز يتحول مشروعاً بضغطة.
 * العهدة تُصرف لمشرف الموقع (1107) وتُسوَّى: منصرف = تكلفة مشروع، ومرتجع للخزينة.
 */
import { useMemo, useState } from 'react'
import { Plus, FileText, Trophy, XCircle, Send, ArrowLeftCircle, Trash2, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { quotationTotal, QUOTATION_STATUS_LABELS, type Quotation, type QuotationLine } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

interface DraftLine { descriptionAr: string; qty: string; unitAr: string; unitPrice: string }

const UNITS = ['مقطوعية', 'م2', 'م3', 'م.ط', 'طن', 'عدد', 'يوم عمل']

export function QuotationsPage() {
  const { quotations, projects, addQuotation, setQuotationStatus, convertQuotationToProject } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)


  /* ─── عرض جديد ─── */
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'quotation' | 'tender'>('quotation')
  const [titleAr, setTitleAr] = useState('')
  const [clientName, setClientName] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [qLines, setQLines] = useState<DraftLine[]>([])
  const [notes, setNotes] = useState('')

  const openNew = () => {
    setKind('quotation'); setTitleAr(''); setClientName('')
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setValidUntil(d.toISOString().slice(0, 10))
    setQLines([{ descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '' }])
    setNotes(''); setOpen(true)
  }

  const parsedLines: QuotationLine[] = qLines
    .filter((l) => l.descriptionAr.trim() && Number(l.qty) > 0)
    .map((l) => ({
      descriptionAr: l.descriptionAr.trim(),
      qty: Number(l.qty),
      unitAr: l.unitAr,
      unitPriceMinor: (() => { try { return toMinor(l.unitPrice || '0', cur.decimals) } catch { return 0 } })(),
    }))
  const draftTotal = quotationTotal(parsedLines)

  const save = () => {
    try {
      const q = addQuotation({ kind, clientName, titleAr, validUntil, lines: parsedLines, notes: notes.trim() })
      toast.show(`سُجل ${q.kind === 'tender' ? 'ملف المناقصة' : 'عرض السعر'} ${q.quoteNumber} — الإجمالي ${fmt(quotationTotal(q.lines))} ✅`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const transition = (q: Quotation, status: 'submitted' | 'won' | 'lost') => {
    try {
      setQuotationStatus(q.id, status)
      toast.show(status === 'won' ? `🏆 فاز ${q.quoteNumber} — حوّله لمشروع الآن` : status === 'lost' ? 'سُجل كخاسر' : 'عُلّم كمُقدَّم ✓')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const [convertFor, setConvertFor] = useState<Quotation | null>(null)
  const [convRetention, setConvRetention] = useState('5')
  const doConvert = () => {
    if (!convertFor) return
    try {
      const p = convertQuotationToProject(convertFor.id, Number(convRetention) || 0)
      toast.show(`🏗️ أُنشئ المشروع ${p.code} من ${convertFor.quoteNumber} — تابعه في «المشروعات والمستخلصات»`)
      setConvertFor(null)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><FileText className="w-6 h-6 text-orange-500" /> عروض الأسعار والمناقصات</h1>
        <Btn onClick={openNew}><Plus size={15} /> عرض / مناقصة</Btn>
      </div>

      {quotations.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="📋" title="لا عروض أسعار بعد" sub="سجّل عرض سعر أو مناقصة ببنود الأعمال — الفائز يتحول لمشروع كامل بضغطة واحدة" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 font-bold">العرض</th>
                  <th className="px-4 py-3 font-bold">الجهة</th>
                  <th className="px-4 py-3 font-bold">القيمة</th>
                  <th className="px-4 py-3 font-bold">ساري حتى</th>
                  <th className="px-4 py-3 font-bold">الحالة</th>
                  <th className="px-4 py-3 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {[...quotations].reverse().map((q, i) => {
                  const st = QUOTATION_STATUS_LABELS[q.status]
                  return (
                    <tr key={q.id} style={{ animationDelay: `${i * 25}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800 dark:text-white">{q.quoteNumber} — {q.titleAr}</div>
                        <div className="text-[11px] text-slate-400">{q.kind === 'tender' ? '🏛️ مناقصة' : '📄 عرض سعر'} · {q.lines.length} بنداً · {q.date}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{q.clientName}</td>
                      <td className="px-4 py-3 font-black text-slate-800 dark:text-white">{fmt(quotationTotal(q.lines))}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-400">{q.validUntil}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                          q.status === 'won' ? 'bg-emerald-500/10 text-emerald-600' : q.status === 'lost' ? 'bg-rose-500/10 text-rose-500' : q.status === 'submitted' ? 'bg-sky-500/10 text-sky-600' : 'bg-slate-500/10 text-slate-500'
                        }`}>{st.icon} {st.nameAr}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          {q.status === 'draft' && (
                            <button onClick={() => transition(q, 'submitted')} title="تقديم العرض" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all hover:scale-110"><Send size={15} /></button>
                          )}
                          {q.status === 'submitted' && (
                            <>
                              <button onClick={() => transition(q, 'won')} title="فاز" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Trophy size={15} /></button>
                              <button onClick={() => transition(q, 'lost')} title="خسر" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><XCircle size={15} /></button>
                            </>
                          )}
                          {q.status === 'won' && q.projectId == null && (
                            <button onClick={() => { setConvertFor(q); setConvRetention('5') }} title="تحويل لمشروع" className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-orange-600 bg-orange-500/10 hover:bg-orange-500/20 transition-all flex items-center gap-1">
                              <ArrowLeftCircle size={13} /> حوّله مشروعاً
                            </button>
                          )}
                          {q.projectId != null && (
                            <span className="text-[11px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1"><CheckCircle2 size={12} /> مشروع {projects.find((p) => p.id === q.projectId)?.code}</span>
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

      {/* عرض جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عرض سعر / مناقصة جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setKind('quotation')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${kind === 'quotation' ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>📄 عرض سعر</button>
            <button onClick={() => setKind('tender')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${kind === 'tender' ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🏛️ مناقصة</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="عنوان الأعمال *"><input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} className={inputCls} placeholder="تشطيب فيلا…" autoFocus /></Field>
            <Field label="العميل / الجهة *"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
            <Field label="ساري حتى"><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">بنود الأعمال</span>
              <Btn variant="soft" onClick={() => setQLines((l) => [...l, { descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '' }])}>+ بند</Btn>
            </div>
            <div className="hidden sm:grid grid-cols-[1fr_80px_110px_130px_36px] gap-2 px-1 pb-1 text-[10.5px] font-bold text-slate-400">
              <span>وصف البند</span><span>الكمية</span><span>الوحدة</span><span>سعر الوحدة ({cur.symbol})</span><span />
            </div>
            <div className="space-y-2">
              {qLines.map((l, i) => (
                <div key={i} className="anim-in grid grid-cols-2 sm:grid-cols-[1fr_80px_110px_130px_36px] gap-2 items-center">
                  <input value={l.descriptionAr} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, descriptionAr: e.target.value } : x)))} placeholder="أعمال حفر وأساسات…" className={`${inputCls} col-span-2 sm:col-span-1`} />
                  <input value={l.qty} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} type="number" min={0} className={inputCls} />
                  <select value={l.unitAr} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitAr: e.target.value } : x)))} className={inputCls}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <input value={l.unitPrice} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} type="number" min={0} className={inputCls} />
                  <button onClick={() => setQLines((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-rose-500 transition-colors justify-self-center"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>

          {draftTotal > 0 && (
            <div className="anim-pop p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 text-[13px] font-bold text-orange-700 dark:text-orange-300 flex justify-between">
              <span>إجمالي العرض</span><span className="font-black">{fmt(draftTotal)} {cur.symbol}</span>
            </div>
          )}
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!titleAr.trim() || !clientName.trim() || parsedLines.length === 0}>💾 حفظ العرض</Btn>
          </div>
        </div>
      </Modal>

      {/* تحويل عرض فائز لمشروع */}
      <Modal open={!!convertFor} onClose={() => setConvertFor(null)} title={convertFor ? `🏗️ تحويل ${convertFor.quoteNumber} لمشروع` : ''}>
        {convertFor && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-orange-500/5 border border-orange-500/20 text-[13px] leading-relaxed">
              سيُنشأ مشروع باسم «<b>{convertFor.titleAr}</b>» للعميل «<b>{convertFor.clientName}</b>»
              بقيمة عقد <b>{fmt(quotationTotal(convertFor.lines))} {cur.symbol}</b> — تسجل عليه المستخلصات والتكاليف والعُهد.
            </div>
            <Field label="نسبة محتجز ضمان الأعمال ٪" hint="تُخصم من كل مستخلص ويُفرج عنها عند التسليم">
              <input value={convRetention} onChange={(e) => setConvRetention(e.target.value)} inputMode="decimal" className={inputCls} dir="ltr" />
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setConvertFor(null)}>إلغاء</Btn>
              <Btn onClick={doConvert}>🏗️ إنشاء المشروع</Btn>
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}
