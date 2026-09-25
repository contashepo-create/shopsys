import { QuickSelect } from '../components/KeyboardPickers.tsx'
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
import { quotationTotal, quotationEstCost, quotationPipeline, QUOTATION_STATUS_LABELS, type Quotation, type QuotationLine } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'

interface DraftLine { nameAr: string; descriptionAr: string; qty: string; unitAr: string; unitPrice: string; estCost: string }

const UNITS = ['مقطوعية', 'م2', 'م3', 'م.ط', 'طن', 'عدد', 'يوم عمل']

export function QuotationsPage() {
  const { quotations, projects, customers, addQuotation, setQuotationStatus, convertQuotationToProject } = useDataStore()
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
  const [clientId, setClientId] = useState('') // ربط إداري بسجل العميل — لا أثر محاسبياً
  const [validUntil, setValidUntil] = useState('')
  const [qLines, setQLines] = useState<DraftLine[]>([])
  const [notes, setNotes] = useState('')
  const [winProb, setWinProb] = useState('50')
  const [bidBond, setBidBond] = useState('')

  const openNew = () => {
    setKind('quotation'); setTitleAr(''); setClientName(''); setClientId('')
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setValidUntil(d.toISOString().slice(0, 10))
    setQLines([{ nameAr: '', descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '', estCost: '' }])
    setNotes(''); setOpen(true)
  }

  const safeMinor = (v: string) => { try { return toMinor(v || '0', cur.decimals) } catch { return 0 } }
  const parsedLines: QuotationLine[] = qLines
    .filter((l) => l.descriptionAr.trim() && Number(l.qty) > 0)
    .map((l) => ({
      nameAr: l.nameAr.trim() || l.descriptionAr.trim().slice(0, 40),
      descriptionAr: l.descriptionAr.trim(),
      qty: Number(l.qty),
      unitAr: l.unitAr,
      unitPriceMinor: safeMinor(l.unitPrice),
      estCostMinor: safeMinor(l.estCost),
    }))
  const draftTotal = quotationTotal(parsedLines)
  const draftEstCost = quotationEstCost(parsedLines)

  const save = () => {
    try {
      const q = addQuotation({ kind, clientName, clientId: clientId ? Number(clientId) : null, titleAr, validUntil, lines: parsedLines, notes: notes.trim(), winProbability: Number(winProb) || 0, bidBondMinor: bidBond ? toMinor(bidBond, cur.decimals) : 0 })
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
        <>
          {(() => {
            const pipe = quotationPipeline(quotations)
            return pipe.submittedCount === 0 ? null : (
              <div className="anim-up grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
                  <div className="text-[11px] font-bold text-slate-400">عروض مقدمة قيد البت</div>
                  <div className="text-xl font-black text-slate-800 dark:text-white mt-1">{pipe.submittedCount}</div>
                </div>
                <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4">
                  <div className="text-[11px] font-bold text-slate-400">قيمتها الإجمالية</div>
                  <div className="text-xl font-black text-slate-800 dark:text-white mt-1">{fmt(pipe.submittedMinor)}</div>
                </div>
                <div className="rounded-2xl bg-orange-500/10 border border-orange-500/30 p-4">
                  <div className="text-[11px] font-bold text-orange-600 dark:text-orange-300">القيمة المتوقعة (× الاحتمالية)</div>
                  <div className="text-xl font-black text-orange-700 dark:text-orange-300 mt-1">{fmt(pipe.expectedMinor)}</div>
                </div>
              </div>
            )
          })()}
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
                        <div className="text-[11px] text-slate-400">{q.kind === 'tender' ? '🏛️ مناقصة' : '📄 عرض سعر'} · {q.lines.length} بنداً · {q.date}{q.status === 'submitted' ? ` · فوز ${q.winProbability}٪` : ''}</div>
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
        </>
      )}

      {/* عرض جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عرض سعر / مناقصة جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setKind('quotation')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${kind === 'quotation' ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>📄 عرض سعر</button>
            <button onClick={() => setKind('tender')} className={`p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${kind === 'tender' ? 'border-orange-500/60 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>🏛️ مناقصة</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="عنوان الأعمال *"><input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} className={inputCls} placeholder="تشطيب فيلا…" autoFocus /></Field>
            <Field label="العميل / الجهة *"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} /></Field>
            <Field label="ربط بسجل عميل (إداري)" hint="للمتابعة فقط — لا يؤثر على رصيد العميل إطلاقاً؛ الذمة تنشأ من الفاتورة/المستخلص">
              <QuickSelect value={clientId} onChange={(e) => { setClientId(e.target.value); const c = customers.find((x) => x.id === Number(e.target.value)); if (c && !clientName.trim()) setClientName(c.nameAr) }} className={inputCls}>
                <option value="">— بلا ربط —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="ساري حتى"><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label="احتمالية الفوز ٪" hint="أساس «القيمة المتوقعة» في ملخص المناقصات المقدمة">
              <input value={winProb} onChange={(e) => setWinProb(e.target.value)} inputMode="numeric" className={inputCls} />
            </Field>
            {kind === 'tender' && (
              <Field label={`التأمين الابتدائي (${cur.symbol})`} hint="للمتابعة — إصدار خطاب الضمان من قسم خطابات الضمان">
                <input value={bidBond} onChange={(e) => setBidBond(e.target.value)} inputMode="decimal" className={inputCls} />
              </Field>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">بنود الأعمال</span>
              <Btn variant="soft" onClick={() => setQLines((l) => [...l, { nameAr: '', descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '', estCost: '' }])}>+ بند</Btn>
            </div>
            {/* إدخال بنود عالمي (طلب المالك): كل خانة مسماة فوق حقلها في كل المقاسات —
                لا اعتماد على صف عناوين يختفي في الشاشات الصغيرة */}
            <div className="space-y-2">
              {qLines.map((l, i) => {
                const lineTotal = Math.round((Number(l.qty) || 0) * safeMinor(l.unitPrice))
                return (
                  <div key={i} className="anim-in p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 lg:grid-cols-[130px_1fr_80px_100px_110px_110px] gap-2 items-end">
                      <Field label="اسم البند *"><input value={l.nameAr} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, nameAr: e.target.value } : x)))} placeholder="حفر وأساسات" className={inputCls} /></Field>
                      <Field label="الوصف التفصيلي *"><input value={l.descriptionAr} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, descriptionAr: e.target.value } : x)))} placeholder="حفر حتى منسوب التأسيس مع نقل المخلفات…" className={inputCls} /></Field>
                      <Field label="الكمية *"><input value={l.qty} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} type="number" min={0} className={inputCls} dir="ltr" /></Field>
                      <Field label="الوحدة *">
                        <QuickSelect value={l.unitAr} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitAr: e.target.value } : x)))} className={inputCls}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </QuickSelect>
                      </Field>
                      <Field label={`سعر الوحدة (${cur.symbol}) *`}><input value={l.unitPrice} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} type="number" min={0} className={inputCls} dir="ltr" /></Field>
                      <Field label="تكلفة تقديرية/وحدة" hint=""><input value={l.estCost} onChange={(e) => setQLines((arr) => arr.map((x, j) => (j === i ? { ...x, estCost: e.target.value } : x)))} type="number" min={0} placeholder="للموازنة" className={inputCls} dir="ltr" /></Field>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[12px] font-black text-emerald-600 dark:text-emerald-400">إجمالي البند: {lineTotal > 0 ? `${fmt(lineTotal)} ${cur.symbol}` : '—'}</span>
                      <button onClick={() => setQLines((arr) => arr.filter((_, j) => j !== i))} title="حذف البند" className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {draftTotal > 0 && (
            <div className="anim-pop p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 text-[13px] font-bold text-orange-700 dark:text-orange-300 grid grid-cols-3 gap-2 text-center">
              <span>الإجمالي: <b className="font-black">{fmt(draftTotal)}</b></span>
              <span>التكلفة التقديرية: <b className="font-black">{fmt(draftEstCost)}</b></span>
              <span className={draftTotal - draftEstCost >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}>هامش متوقع: <b className="font-black">{fmt(draftTotal - draftEstCost)}</b></span>
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
              بقيمة عقد <b>{fmt(quotationTotal(convertFor.lines))} {cur.symbol}</b> — وتنتقل بنوده الـ{convertFor.lines.length}
              كاملةً إلى جدول كميات المشروع (بأسعارها وتكاليفها التقديرية) تمهيداً للمستخلصات ولوحة القيمة المكتسبة.
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
