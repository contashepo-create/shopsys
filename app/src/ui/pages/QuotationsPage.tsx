import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * عروض الأسعار والمناقصات + عُهد المشاريع (طلب المالك — مرجعية pro-acc).
 * العرض مستند غير محاسبي ببنود أعمال؛ الفائز يتحول مشروعاً بضغطة.
 * العهدة تُصرف لمشرف الموقع (1107) وتُسوَّى: منصرف = تكلفة مشروع، ومرتجع للخزينة.
 *
 * **مستندي بالكامل (طلب المالك ㉘)**: المحرر صار بنفس هيئة فاتورة البيع —
 * إطار InvoicePOSFrame (نفس الترويسة والبنود واللوحات) بدل النافذة البسيطة.
 */
import { useMemo, useState } from 'react'
import { Plus, FileText, Trophy, XCircle, Send, ArrowLeftCircle, Trash2, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { quotationTotals, quotationTotal, quotationEstCost, quotationPipeline, QUOTATION_STATUS_LABELS, type Quotation, type QuotationLine } from '../../core/contracting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { ThermalPreview } from '../components/ThermalPreview.tsx'
import { printHtml } from '../print/printReceipt.ts'
import { usePrintSwitches } from '../components/PrintSwitches.tsx'

interface DraftLine { key: string; nameAr: string; descriptionAr: string; qty: string; unitAr: string; unitPrice: string; estCost: string; vat: string; incl: boolean }

const UNITS = ['مقطوعية', 'م2', 'م3', 'م.ط', 'طن', 'عدد', 'يوم عمل']

/** شروط جاهزة تُضاف بضغطة إلى شروط العرض — نمط لوحة شروط الفاتورة */
const QUOTE_TERMS = ['الأسعار سارية حتى تاريخ صلاحية العرض', 'الدفع 40% مقدماً و60% عند التسليم', 'مدة التنفيذ تبدأ من تاريخ التوقيع والمقدم', 'لا تشمل الأسعار أي أعمال تخطيط خارج نطاق البنود']

export function QuotationsPage() {
  const { quotations, projects, customers, addQuotation, setQuotationStatus, convertQuotationToProject } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const printSwitches = usePrintSwitches()
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
  const [previewHtml, setPreviewHtml] = useState<{ html: string; wide: boolean } | null>(null)

  const openNew = () => {
    setKind('quotation'); setTitleAr(''); setClientName(''); setClientId('')
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setValidUntil(d.toISOString().slice(0, 10))
    setQLines([{ key: crypto.randomUUID(), nameAr: '', descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '', estCost: '', vat: '0', incl: false }])
    setNotes(''); setWinProb('50'); setBidBond(''); setOpen(true)
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
      vatPercent: Math.min(100, Math.max(0, Number(l.vat) || 0)),
      taxIncluded: !!l.incl,
    }))
  const draftTotal = quotationTotal(parsedLines)
  const draftTax = quotationTotals(parsedLines)
  const draftEstCost = quotationEstCost(parsedLines)

  const save = () => {
    try {
      const q = addQuotation({ kind, clientName, clientId: clientId ? Number(clientId) : null, titleAr, validUntil, lines: parsedLines, notes: notes.trim(), winProbability: Number(winProb) || 0, bidBondMinor: bidBond ? toMinor(bidBond, cur.decimals) : 0 })
      toast.show(`سُجل ${q.kind === 'tender' ? 'ملف المناقصة' : 'عرض السعر'} ${q.quoteNumber} — الإجمالي ${fmt(quotationTotal(q.lines))} ✅`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* معاينة وطباعة العرض بنفس محرك قوالب الفواتير (طلب المالك: شكل مطابق للفاتورة) */
  const printDraft = (template: InvoiceTemplate) => {
    if (!parsedLines.length) return toast.show('أضف بنوداً قبل المعاينة', 'error')
    const model = buildSimpleDocModel({
      docTitle: kind === 'tender' ? 'مذكرة تسعير مناقصة' : 'عرض سعر',
      invoiceNumber: 'مسودة',
      refCode: 'DRAFT',
      dateIso: new Date().toISOString().slice(0, 10),
      partyLabel: clientName.trim() || 'عميل غير محدد',
      paymentLabel: `ساري حتى ${validUntil || '—'}`,
      rows: parsedLines.map((l) => ({ nameAr: `${l.nameAr} — ${l.descriptionAr}`, qty: l.qty, unitPriceMinor: l.unitPriceMinor, totalMinor: Math.round(l.qty * l.unitPriceMinor) })),
      totalMinor: draftTax.grossMinor,
      paidMinor: 0,
      operatorName: setup.ownerName ?? 'المالك',
      settings: useAppStore.getState().receipt,
      extraFooter: notes.trim() || undefined,
    })
    if (!printSwitches.silentPrint) { setPreviewHtml({ html: buildModelHtml(model, cur, useAppStore.getState().receipt, template), wide: template !== 'thermal' }); return }
    printModelWithTemplate(model, cur, useAppStore.getState().receipt, template)
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

  /* ════ محرر المستند (نفس هيئة الفاتورة — طلب المالك ㉘) ════ */
  if (open) {
    const selectedClient = customers.find((c) => c.id === Number(clientId))
    const margin = draftTotal - draftEstCost
    return (
      <div data-quotation-doc-editor>
        <InvoicePOSFrame
          kind="sale"
          modeLabel={kind === 'tender' ? 'مناقصة' : 'عرض سعر'}
          currencyLabel={`${cur.code} · ${cur.symbol}`}
          dateLabel={new Date().toISOString().slice(0, 10)}
          branchLabel={setup.shopName ?? ''}
          userLabel={setup.ownerName ?? 'المالك'}
          activityLabel={setup.activityId ?? 'نشاط عام'}
          documentNumber="QT-DRAFT"
          onBack={() => setOpen(false)}
          onNavigate={() => { /* لا تنقل أثناء التحرير */ }}
          onPartySearch={() => document.getElementById('quotation-client-field')?.focus()}
          onItemSearch={() => document.getElementById('quotation-first-line')?.focus()}
          onSaveDraft={() => toast.show('اضغط «اعتماد وترحيل» لحفظ العرض — العروض لا تُرحَّل محاسبياً')}
          onRestoreDraft={() => toast.show('لا مسودات محفوظة للعروض')}
          onPrint={() => printDraft('a4')}
          onExportPdf={() => { toast.show('اختر «حفظ كـ PDF» في وجهة الطباعة 🖨️'); printDraft('a4') }}
          onPost={save}
          headerFields={
            <>
              <Field label="نوع المستند">
                <QuickSelect className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'quotation' | 'tender')} aria-label="نوع المستند">
                  <option value="quotation">عرض سعر</option>
                  <option value="tender">مناقصة / عطاء</option>
                </QuickSelect>
              </Field>
              <Field label="عنوان الأعمال *" icon={<FileText size={11} />}>
                <input id="quotation-first-line" className={inputCls} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} placeholder="تشطيب فيلا — الدور الأول…" />
              </Field>
              <Field label="العميل / الجهة *">
                <div id="quotation-client-field" className="invoice-doc-infield flex gap-1">
                  <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="اسم الجهة" aria-label="اسم العميل" />
                  <PartyQuickPicker parties={customers} value={clientId ? Number(clientId) : 0} onChange={(id) => { setClientId(id ? String(id) : ''); const c = customers.find((x) => x.id === id); if (c && !clientName.trim()) setClientName(c.nameAr) }} cashLabel="بلا ربط" label="بحث العميل" cashValue={0} />
                </div>
              </Field>
              <Field label="ساري حتى *">
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="احتمالية الفوز ٪" hint="أساس القيمة المتوقعة">
                <input value={winProb} onChange={(e) => setWinProb(e.target.value)} inputMode="numeric" className={inputCls} />
              </Field>
              {kind === 'tender' && (
                <Field label={`التأمين الابتدائي (${cur.symbol})`} hint="للمتابعة — إصداره من خطابات الضمان">
                  <input value={bidBond} onChange={(e) => setBidBond(e.target.value)} inputMode="decimal" className={inputCls} />
                </Field>
              )}
            </>
          }
          partyMeta={
            <div className="invoice-doc-partymeta">
              <span>النوع: <b>{kind === 'tender' ? '🏛️ مناقصة' : '📄 عرض سعر'}</b></span>
              <span>العميل: <b>{clientName.trim() || 'غير محدد'}</b></span>
              {selectedClient && <span>الربط: <b>{selectedClient.nameAr} — للمتابعة فقط بلا أثر محاسبي</b></span>}
              <span>الصلاحية: <b>{validUntil || '—'}</b></span>
              <span>البنود: <b>{parsedLines.length}</b></span>
            </div>
          }
        >
          <section className="invoice-shell invoice-reference-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark" data-quotation-lines>
            {/* بنود الأعمال — نفس جدول بنود الفاتورة هيئةً وقياساً */}
            <div className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
              <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-slate-500/10 to-transparent p-3 dark:border-slate-700">
                <div className="invoice-lines-toolbar-title"><b>بنود الأعمال</b><small>بند لكل سطر — الاسم والوصف والوحدة والكمية وسعر الوحدة</small></div>
                <div className="invoice-lines-kpis">
                  <span className="invoice-lines-count">{parsedLines.length} بند</span>
                  <span className="invoice-lines-weight">الصافي {fmt(draftTax.netMinor)} {cur.symbol}</span>
                </div>
                <Btn variant="soft" onClick={() => setQLines((l) => [...l, { key: crypto.randomUUID(), nameAr: '', descriptionAr: '', qty: '1', unitAr: 'مقطوعية', unitPrice: '', estCost: '', vat: '0', incl: false }])}><Plus size={14} /> بند</Btn>
              </div>
              <div className="overflow-x-auto">
                <table className="invoice-lines-table w-full table-fixed text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60">
                    <tr className="text-[10.5px] font-black text-slate-500">
                      <th className="w-9 px-1 py-2 text-center">#</th>
                      <th className="w-[9rem] px-1 py-2 text-center">اسم البند</th>
                      <th className="px-1 py-2 text-center">الوصف التفصيلي</th>
                      <th className="w-[5rem] px-1 py-2 text-center">الوحدة</th>
                      <th className="w-[5.5rem] px-1 py-2 text-center">الكمية</th>
                      <th className="w-[7rem] px-1 py-2 text-center">سعر الوحدة</th>
                      <th className="w-[8rem] px-1 py-2 text-center">إجمالي البند</th>
                      <th className="w-[4rem] px-1 py-2 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {qLines.map((l, i) => {
                      const lineTotal = Math.round((Number(l.qty) || 0) * safeMinor(l.unitPrice))
                      return (
                        <tr key={l.key} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="p-1 text-center text-[11px] font-mono text-slate-400">{i + 1}</td>
                          <td className="p-1"><input className={inputCls} value={l.nameAr} onChange={(e) => setQLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, nameAr: e.target.value } : x)))} placeholder="حفر وأساسات" /></td>
                          <td className="p-1"><input className={inputCls} value={l.descriptionAr} onChange={(e) => setQLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, descriptionAr: e.target.value } : x)))} placeholder="حفر حتى منسوب التأسيس مع نقل المخلفات…" /></td>
                          <td className="p-1">
                            <QuickSelect value={l.unitAr} onChange={(e) => setQLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, unitAr: e.target.value } : x)))} className={inputCls}>
                              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </QuickSelect>
                          </td>
                          <td className="p-1"><input className={inputCls} dir="ltr" value={l.qty} onChange={(e) => setQLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} type="number" inputMode="decimal" step="any" min={0} /></td>
                          <td className="p-1"><input className={inputCls} dir="ltr" value={l.unitPrice} onChange={(e) => setQLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, unitPrice: e.target.value } : x)))} type="number" inputMode="decimal" step="any" min={0} /></td>
                          <td className="p-1"><div className="invoice-table-total font-mono">{lineTotal > 0 ? fmt(lineTotal) : '—'}</div></td>
                          <td className="p-1">
                            <div className="invoice-doc-rowtools">
                              <button type="button" className="doc-row-delete" aria-label="حذف البند" title="حذف هذا البند" onClick={() => setQLines((arr) => arr.filter((x) => x.key !== l.key))}><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {qLines.length === 0 && (
                      <tr><td colSpan={8} className="p-6 text-center text-[12px] text-slate-400">لا بنود بعد — أضف أول بند أعمال من زر «بند»</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* اللوحات الثلاث: الشروط · التكلفة التقديرية · الإجماليات — نفس تخطيط الفاتورة */}
            <section className="invoice-totals-footer">
              <div className="invoice-doc-panel" data-quotation-notes>
                <div className="invoice-doc-panel-head"><b>الشروط والملاحظات</b><small>تُطبع في نسخة العميل</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-quick">
                    {QUOTE_TERMS.map((term) => (
                      <button key={term} type="button" onClick={() => setNotes(notes.trim() ? `${notes.trim()}\n${term}` : term)}>+ {term}</button>
                    ))}
                  </div>
                  <textarea className={`${inputCls} invoice-doc-termsbox`} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="شروط العرض" placeholder="شروط العرض — تظهر في النسخة المطبوعة" />
                </div>
              </div>
              <div className="invoice-doc-panel" data-quotation-estimate>
                <div className="invoice-doc-panel-head"><b>التكلفة التقديرية</b><small>أساس الموازنة عند الفوز</small></div>
                <div className="invoice-doc-panel-body space-y-2">
                  {qLines.map((l) => safeMinor(l.estCost) > 0 && (
                    <div key={l.key} className="flex items-center justify-between text-[11.5px]">
                      <span className="truncate">{l.nameAr || l.descriptionAr.slice(0, 30) || `بند ${qLines.indexOf(l) + 1}`}</span>
                      <span className="font-mono">{fmt(Math.round((Number(l.qty) || 0) * safeMinor(l.estCost)))}</span>
                    </div>
                  ))}
                  <div className="invoice-doc-sum-row is-strong"><span>إجمالي التكلفة التقديرية</span><i /><b className="font-mono">{fmt(draftEstCost)} {cur.symbol}</b></div>
                </div>
              </div>
              <div className="invoice-doc-panel" data-quotation-totals>
                <div className="invoice-doc-panel-head"><b>إجماليات العرض</b><small>{kind === 'tender' ? 'مذكرة تسعير مناقصة' : 'عرض سعر'}</small></div>
                <div className="invoice-doc-panel-body">
                  <div className="invoice-doc-sum-row"><span>الصافي</span><i /><b className="font-mono">{fmt(draftTax.netMinor)}</b></div>
                  <div className="invoice-doc-sum-row"><span>الضريبة</span><i /><b className="font-mono">{fmt(draftTax.taxMinor)}</b></div>
                  <div className="invoice-doc-sum-row is-strong"><span>الإجمالي شامل الضريبة</span><i /><b className="font-mono">{fmt(draftTax.grossMinor)} {cur.symbol}</b></div>
                  <div className="invoice-doc-sum-row"><span>التكلفة التقديرية</span><i /><b className="font-mono">{fmt(draftEstCost)}</b></div>
                  <div className={`invoice-doc-sum-row${margin < 0 ? ' is-minus' : ''}`}><span>هامش متوقع</span><i /><b className="font-mono">{fmt(margin)}</b></div>
                </div>
              </div>
            </section>
          </section>
          <ThermalPreview open={!!previewHtml} html={previewHtml?.html ?? ''} wide={previewHtml?.wide ?? false}
            title={previewHtml?.wide ? 'معاينة العرض قبل الطباعة' : 'معاينة الإيصال'}
            onClose={() => setPreviewHtml(null)}
            onPrint={() => { const doc = previewHtml; setPreviewHtml(null); if (doc) printHtml(doc.html, { silent: printSwitches.silentPrint }) }}
            onSettings={() => setPreviewHtml(null)} />
        </InvoicePOSFrame>
      </div>
    )
  }

  /* ════ قائمة العروض ════ */
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
