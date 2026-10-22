/**
 * §94: مركز فواتير البيع في المقاولات (طلب المالك: «لماذا لم تضع قسم فاتورة بيع
 * في المقاولات؟ وتكون خاصة بالمشاريع ويكون إصدار الفاتورة مرتبطاً بالمشروع
 * وقيمته ومرتبطاً بالعملاء والموظفين والموردين… فاتورة كاملة للبيع مثل الأعلاف
 * في المقاولات لأني قد أصدر فاتورة ليست مرتبطة بمشروع»).
 *
 * صفحة واحدة تجمع دورة الفوترة كاملة:
 *   ① ملخص فوترة كل مشروع: قيمة العقد ← المستخلصات ← الفواتير ← المتبقي،
 *      وزر «فاتورة بيع» يفتح نافذة الفاتورة المتقدمة (نفس محرك الأعلاف تماماً)
 *      معبأة بالمشروع وعميله.
 *   ② فاتورة حرة بدون مشروع — من نفس النافذة الكاملة.
 *   ③ جدول كل الفواتير المرتبطة بمشاريع المقاولات: مراجعة (نافذة التعديل)
 *      وطباعة بنفس قوالب الفواتير.
 */
import { useMemo, useState } from 'react'
import { FilePlus2, Printer, Pencil, HardHat, Coins, Plus, Trash2, Send, Download } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { buildReceiptModel, buildSimpleDocModel, type InvoiceTemplate } from '../../core/receipt.ts'
import { printModelWithTemplate, buildModelHtml } from '../print/printDoc.ts'
import { shareDocPdfViaWhatsapp } from '../print/shareDoc.ts'
import { openPrintPreview } from '../components/printPreviewStore.ts'
import { useTaxBarcodeStamp } from '../hooks/useTaxBarcodeStamp.ts'
import { Btn, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { QuickSelect, PartyQuickPicker } from '../components/KeyboardPickers.tsx'
import { openSalesInvoiceWindow } from '../windows/windowStore.ts'
import { effectiveContractValue } from '../../core/contracting.ts'
import { InvoicePOSFrame } from '../components/InvoicePOSFrame.tsx'
import { gridArrowNavigation } from '../components/gridArrowNavigation.ts'
import { resolveBusinessTax } from '../../core/taxRegistration.ts'

export function ContractingInvoicesPage() {
  const {
    projects, projectExtracts, projectCosts, changeOrders, sales, customers, boqItems,
    staffCommissions, purchases, postSale, ensureServiceItemForFreeLine,
  } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const stampTax = useTaxBarcodeStamp()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [prjFilter, setPrjFilter] = useState(0) // 0 = كل المشاريع
  const [search, setSearch] = useState('')

  /* §94-مراجعة (بلاغ المالك: «لماذا الفواتير لم تظهر بعد تسجيلها؟»): الجدول يعرض
     كل فواتير البيع — الحرة والمرتبطة بمشروع — والمشروع عمود مميز لا شرط دخول */
  const invoices = useMemo(() => {
    const q = search.trim()
    return sales
      .filter((s) => (prjFilter ? s.projectId === prjFilter : true))
      .filter((s) => {
        if (!q) return true
        const customerName = customers.find((c) => c.id === s.customerId)?.nameAr ?? s.partyName ?? ''
        const projectName = projects.find((p) => p.id === s.projectId)?.nameAr ?? ''
        return s.invoiceNumber.includes(q) || customerName.includes(q) || projectName.includes(q)
      })
      .sort((a, b) => b.id - a.id)
  }, [sales, projects, customers, prjFilter, search])

  /* ملخص الفوترة لكل مشروع نشط: العقد الفعلي (بأوامر التغيير) مقابل المستخلصات والفواتير */
  const projectCards = useMemo(() => projects
    .filter((p) => (prjFilter ? p.id === prjFilter : true))
    .map((p) => {
      const ex = projectExtracts.filter((e) => e.projectId === p.id)
      const extracted = ex.reduce((a, e) => a + e.totals.grossMinor, 0)
      const orders = changeOrders.filter((o) => o.projectId === p.id)
      const effective = effectiveContractValue(p.contractValueMinor, orders)
      const inv = sales.filter((s) => s.projectId === p.id)
      const invoiced = inv.reduce((a, s) => a + s.totals.totalMinor, 0)
      const collected = inv.reduce((a, s) => a + (s.paidMinor ?? 0), 0)
      const costs = projectCosts.filter((c) => c.projectId === p.id).reduce((a, c) => a + c.amountMinor, 0)
      const comms = staffCommissions.filter((c) => c.source === 'project' && c.sourceId === p.id).reduce((a, c) => a + c.amountMinor, 0)
      const purch = purchases.filter((x) => x.projectId === p.id)
      const purchTotal = purch.reduce((a, x) => a + x.grandTotalMinor, 0)
      return {
        project: p, extractsCount: ex.length, extracted, effective, invoiced, collected, costs, comms, purchasesCount: purch.length, purchTotal,
        remaining: Math.max(0, effective - extracted),
        boqCount: boqItems.filter((b) => b.projectId === p.id).length,
      }
    })
    .sort((a, b) => b.project.id - a.project.id), [projects, projectExtracts, changeOrders, sales, projectCosts, staffCommissions, purchases, boqItems, prjFilter])

  const totals = useMemo(() => ({
    invoices: invoices.length,
    invoiced: invoices.reduce((a, s) => a + s.totals.totalMinor, 0),
    collected: invoices.reduce((a, s) => a + (s.paidMinor ?? 0), 0),
    linked: invoices.filter((s) => s.projectId != null).length,
    extracts: projectExtracts.length,
    extracted: projectExtracts.reduce((a, e) => a + e.totals.grossMinor, 0),
  }), [invoices, projectExtracts])

  /* ═══ فاتورة مقاولات ببنود حرة (طلب المالك 2026-10-17) ═══
     بنودها تُكتب يدوياً بحرية مثل عرض السعر (اسم/وصف/وحدة/كمية/سعر)، وتُرحَّل
     بمحرك فاتورة البيع نفسه (postSale) بأصناف خدمة مضمونة — فلا مخزون ولا تكلفة،
     والإيراد والقيد والتحصيل والطباعة والواتساب كلها مثل فاتورة البيع حرفياً. */
  const taxPolicy = resolveBusinessTax(setup.taxRegistrationStatus, setup.vatPercent)
  const [edOpen, setEdOpen] = useState(false)
  const [edProjectId, setEdProjectId] = useState(0)
  const [edCustomerId, setEdCustomerId] = useState(0)
  const [edPayment, setEdPayment] = useState<'cash' | 'credit'>('credit')
  const [edWithTax, setEdWithTax] = useState(() => taxPolicy.effectivePercent > 0)
  const [edPartialPct, setEdPartialPct] = useState('100')
  const [edPaid, setEdPaid] = useState('')
  const [edNotes, setEdNotes] = useState('')
  interface FreeLine { key: string; nameAr: string; qty: string; unitAr: string; price: string }
  const [edLines, setEdLines] = useState<FreeLine[]>([])
  const freeUnits = ['مقطوعية', 'م2', 'م3', 'م.ط', 'طن', 'عدد', 'يوم عمل']
  const openFreeEditor = (projectId = 0) => {
    setEdProjectId(projectId)
    const prj = projects.find((x) => x.id === projectId)
    const cid = prj?.clientId ?? 0
    setEdCustomerId(cid)
    setEdPayment(cid > 0 ? 'credit' : 'cash')
    setEdWithTax(taxPolicy.effectivePercent > 0)
    setEdPartialPct('100')
    setEdPaid(''); setEdNotes('')
    setEdLines([{ key: crypto.randomUUID(), nameAr: '', qty: '1', unitAr: 'مقطوعية', price: '' }])
    setEdOpen(true)
  }
  const edEffectiveTaxPct = edWithTax ? (taxPolicy.effectivePercent || setup.vatPercent || 14) : 0
  const edParsed = edLines
    .filter((l) => l.nameAr.trim() && Number(l.qty) > 0)
    .map((l) => ({ nameAr: l.nameAr.trim(), qty: Number(l.qty), unitAr: l.unitAr, unitPriceMinor: (() => { try { return toMinor(l.price || '0', cur.decimals) } catch { return 0 } })() }))
  const edNet = edParsed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
  const edTax = Math.round(edNet * edEffectiveTaxPct / 100)
  const edGross = edNet + edTax
  const fillFromBoq = (pctOverride?: number) => {
    const boq = boqItems.filter((b) => b.projectId === edProjectId)
    if (!boq.length) { toast.show('لا بنود كميات لهذا المشروع — اكتب البنود حرة', 'error'); return }
    const pct = Math.min(100, Math.max(1, pctOverride ?? (Number(edPartialPct) || 100)))
    setEdLines(boq.map((b) => ({
      key: crypto.randomUUID(),
      nameAr: pct < 100 ? `${b.descriptionAr} (${pct}٪ جزئي)` : b.descriptionAr,
      qty: String(Number(((b.qty * pct) / 100).toFixed(3)) || b.qty),
      unitAr: b.unit,
      price: String(b.unitPriceMinor / 10 ** cur.decimals),
    })))
    toast.show(`عُبِّئت ${boq.length} بنداً من جدول كميات المشروع (${pct}٪) ✓`)
  }
  const edPrintModel = () => {
    const dateIso = new Date().toISOString().slice(0, 10)
    const model = buildSimpleDocModel({
      docTitle: 'فاتورة مقاولات',
      invoiceNumber: 'مسودة',
      refCode: 'CI',
      dateIso,
      partyLabel: customers.find((c) => c.id === edCustomerId)?.nameAr ?? projects.find((x) => x.id === edProjectId)?.clientName ?? 'عميل',
      paymentLabel: edPayment === 'cash' ? 'نقدي' : 'آجل',
      rows: edParsed.map((l) => ({ nameAr: l.nameAr, qty: l.qty, unitPriceMinor: l.unitPriceMinor, totalMinor: Math.round(l.qty * l.unitPriceMinor) })),
      totalMinor: edGross,
      paidMinor: edPayment === 'cash' ? edGross : 0,
      operatorName: setup.ownerName ?? 'المالك',
      settings: receipt,
      extraFooter: edNotes.trim() || undefined,
      tax: edTax > 0 ? { label: 'الضريبة', minor: edTax, baseMinor: edNet } : undefined,
    })
    /* فاتورة المقاولات مستند بيع ضريبي — رمز زاتكا كما في فاتورة المبيعات */
    stampTax(model, { dateIso, totalMinor: edGross, taxMinor: edTax })
    return model
  }
  const postFreeInvoice = () => {
    if (!edParsed.length) { toast.show('أضف بنداً واحداً على الأقل بكمية موجبة', 'error'); return }
    if (edProjectId && !edCustomerId) { toast.show('حدّد عميل الفاتورة (عميل المشروع أو غيره)', 'error'); return }
    try {
      const paidMinor = edPayment === 'cash' ? (edPaid.trim() ? (() => { try { return toMinor(edPaid, cur.decimals) } catch { return edGross } })() : edGross) : (edPaid.trim() ? (() => { try { return toMinor(edPaid, cur.decimals) } catch { return 0 } })() : 0)
      const sale = postSale({
        projectId: edProjectId || null,
        customerId: edCustomerId || null,
        payment: edPayment,
        paidMinor,
        invoiceDiscountPercent: 0,
        taxPercent: edEffectiveTaxPct,
        taxInclusive: false,
        notes: edNotes.trim() || undefined,
        lines: edParsed.map((l) => ({
          itemId: ensureServiceItemForFreeLine({ nameAr: l.nameAr, unitAr: l.unitAr, priceMinor: l.unitPriceMinor }),
          nameAr: l.nameAr,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          unitCostMinor: 0,
          discountPercent: 0,
          soldByWeight: false,
          warehouseId: null,
        })),
      })
      setEdOpen(false)
      toast.show(`رُحِّلت فاتورة المقاولات ${sale.invoiceNumber} — الإجمالي ${fmt(sale.totals.totalMinor)} ${cur.symbol} ✅`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* طباعة فاتورة مرحّلة بنفس قوالب الفواتير (نمط شاشة فواتير المبيعات) */
  const printInvoice = (s: (typeof sales)[number], template: 'a4' | 'a5' | 'thermal' = 'a5') => {
    const customerName = s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? null : s.partyName ?? null
    const model = buildReceiptModel({
      invoiceNumber: s.invoiceNumber,
      refCode: s.refCode,
      dateIso: s.date,
      lines: [...s.lines, ...(s.customerCharges ?? []).map((charge, index) => ({ itemId: -(index + 1), nameAr: charge.nameAr, qty: 1, unitPriceMinor: charge.amountMinor, unitCostMinor: 0, discountPercent: 0, soldByWeight: false, vatPercentOverride: charge.taxable ? (s.taxPercent ?? setup.vatPercent) : 0 }))],
      totals: s.totals,
      payment: s.payment,
      paidMinor: s.paidMinor,
      operatorName: setup.ownerName ?? 'المالك',
      customerName,
      taxPercent: s.taxPercent ?? setup.vatPercent,
      taxInclusive: s.taxInclusive ?? setup.taxInclusive,
      settings: receipt,
    })
    const prj = projects.find((p) => p.id === s.projectId)
    model.footerText = `${prj ? `مشروع: ${prj.code} — ${prj.nameAr}` : ''}${prj && receipt.footerText ? ' — ' : ''}${receipt.footerText ?? ''}`
    stampTax(model, { dateIso: s.date, invoiceNumber: s.invoiceNumber, totalMinor: s.totals.totalMinor, taxMinor: s.totals.taxMinor })
    printModelWithTemplate(model, cur, receipt, template)
    toast.show(template === 'thermal' ? `أُرسل إيصال ${s.invoiceNumber} للطباعة 🖨️` : `أُرسلت فاتورة ${s.invoiceNumber} للطباعة 📄`)
  }

  return (
    <div className="space-y-4" data-contracting-invoices>
      {/* رأس الصفحة: إجماليات دورة الفوترة */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">فواتير البيع (كلها)</div>
          <div className="font-black text-emerald-600">{fmt(totals.invoiced)}</div>
          <div className="text-[10px] text-slate-400">{totals.invoices} فاتورة · منها {totals.linked} مربوطة بمشروع</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">محصل من الفواتير</div>
          <div className="font-black text-sky-600">{fmt(totals.collected)}</div>
          <div className="text-[10px] text-slate-400">نقدي وماكينة وعلى موظف</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">مستخلصات (PRX)</div>
          <div className="font-black text-orange-600">{fmt(totals.extracted)}</div>
          <div className="text-[10px] text-slate-400">{totals.extracts} مستخلصاً</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">مشاريع نشطة</div>
          <div className="font-black text-violet-600">{projects.filter((p) => p.status === 'active').length}</div>
          <div className="text-[10px] text-slate-400">من إجمالي {projects.length}</div>
        </div>
      </div>

      {/* أزرار الإصدار: مربوطة بمشروع أو حرة — نافذة الفاتورة الكاملة (مثل الأعلاف) */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <QuickSelect aria-label="مشروع الفاتورة" className="h-10" value={prjFilter} onChange={(e) => setPrjFilter(Number(e.target.value))}>
            <option value={0}>كل الفواتير (حرة ومربوطة)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
          </QuickSelect>
          <input value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-56`} placeholder="بحث برقم الفاتورة أو العميل أو المشروع…" />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* تصحيح بطلب المالك: الفاتورة تفتح حرة دوماً — والربط بالمشروع من حقل «المشروع» داخل الفاتورة نفسها */}
          <Btn shortcut="F3" data-contracting-new-invoice onClick={() => { openSalesInvoiceWindow(); toast.show('الفاتورة تفتح حرة — اربط المشروع من حقل «المشروع» داخلها وسيُعبأ عميله تلقائياً') }} title="فاتورة بيع كاملة حرة — اربطها بمشروع من حقل المشروع داخل الفاتورة"><FilePlus2 size={16} /> فاتورة بيع جديدة</Btn>
          <Btn variant="soft" data-contracting-free-invoice onClick={() => openFreeEditor(prjFilter)} title="فاتورة مقاولات ببنود تُكتب يدوياً بحرية (مثل عرض السعر) وتُرحَّل بمحرك فاتورة البيع"><Plus size={16} /> فاتورة مقاولات ببنود حرة</Btn>
        </div>
      </div>

      {/* ملخص فوترة المشروعات: العقد ← المستخلصات ← الفواتير ← الأطراف */}
      {projectCards.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🏗️" title="لا مشروعات مقاولات بعد" sub="أنشئ مشروعاً من «المشروعات والمستخلصات» ثم أصدر له فواتير ومستخلصات من هنا" />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3" data-contracting-project-cards>
          {projectCards.map(({ project: p, extractsCount, extracted, effective, invoiced, collected, costs, comms, purchasesCount, purchTotal, remaining, boqCount }) => (
            <div key={p.id} className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="grid place-items-center w-9 h-9 rounded-xl bg-orange-500/10 text-orange-600 shrink-0"><HardHat size={17} /></span>
                  <div className="min-w-0">
                    <div className="font-black text-[13px] truncate" title={p.nameAr}>{p.code} — {p.nameAr}</div>
                    <div className="text-[11px] text-slate-500 truncate">{p.clientName || 'بلا جهة مالكة'} · {p.status === 'active' ? 'نشط' : 'مكتمل'} · {boqCount} بند BOQ</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                <div className="rounded-xl bg-slate-500/5 p-2"><div className="text-slate-500">العقد الفعلي</div><b className="block text-[12px]">{fmt(effective)}</b></div>
                <div className="rounded-xl bg-orange-500/10 p-2"><div className="text-slate-500">مستخلصات ({extractsCount})</div><b className="block text-[12px] text-orange-600">{fmt(extracted)}</b></div>
                <div className="rounded-xl bg-emerald-500/10 p-2"><div className="text-slate-500">فواتير بيع</div><b className="block text-[12px] text-emerald-600">{fmt(invoiced)}</b></div>
                <div className="rounded-xl bg-sky-500/10 p-2"><div className="text-slate-500">المتبقي من العقد</div><b className="block text-[12px] text-sky-600">{fmt(remaining)}</b></div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
                <span>محصل من الفواتير: <b className="text-emerald-600">{fmt(collected)}</b></span>
                <span>تكاليف: <b className="text-rose-600">{fmt(costs)}</b></span>
                <span>مشتريات موردين ({purchasesCount}): <b className="text-rose-600">{fmt(purchTotal)}</b></span>
                <span>عمولات موظفين: <b className="text-violet-600">{fmt(comms)}</b></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* جدول فواتير المشاريع: مراجعة وطباعة */}
      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Coins size={16} className="text-emerald-600" />
          <b className="text-[13px]">فواتير البيع — كلها</b>
          <span className="text-[11px] text-slate-500">المرتبطة بمشروع وغير المرتبطة (حرة) — الفاتورة الكاملة مثل فواتير الأعلاف</span>
        </div>
        {invoices.length === 0 ? (
          <div className="p-6"><EmptyState icon="🧾" title="لا فواتير بعد" sub="افتح «فاتورة بيع جديدة» — اربط المشروع من حقل «المشروع» داخل الفاتورة أو اتركها حرة" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]" data-contracting-invoices-table>
              <thead className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <tr>{['الفاتورة', 'التاريخ', 'المشروع', 'العميل', 'الإجمالي', 'المحصل', 'الباقي', ''].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {invoices.map((s) => {
                  const prj = projects.find((p) => p.id === s.projectId)
                  const remain = s.totals.totalMinor - (s.paidMinor ?? 0)
                  const customerName = customers.find((c) => c.id === s.customerId)?.nameAr ?? s.partyName ?? 'نقدي'
                  return (
                    <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-emerald-500/5">
                      <td className="px-3 py-2 font-bold">{s.invoiceNumber}</td>
                      <td className="px-3 py-2">{s.date.slice(0, 10)}</td>
                      <td className="px-3 py-2">{prj ? <span title={prj.nameAr} className="font-bold text-orange-600">{prj.code}</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold">حرة</span>}</td>
                      <td className="px-3 py-2">{customerName}</td>
                      <td className="px-3 py-2 font-bold">{fmt(s.totals.totalMinor)}</td>
                      <td className="px-3 py-2 text-emerald-600">{fmt(s.paidMinor ?? 0)}</td>
                      <td className={`px-3 py-2 font-bold ${remain > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{remain > 0 ? fmt(remain) : '✓'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => printInvoice(s, 'a5')} title="طباعة A5" className="px-1.5 py-1 rounded-md text-[10px] font-black text-sky-600 hover:bg-sky-500/10">A5</button>
                          <button onClick={() => printInvoice(s, 'a4')} title="طباعة A4" className="px-1.5 py-1 rounded-md text-[10px] font-black text-sky-600 hover:bg-sky-500/10">A4</button>
                          <button onClick={() => printInvoice(s, 'thermal')} title="إيصال حراري" className="p-1.5 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-500/10"><Printer size={13} /></button>
                          <button onClick={() => {
                            const customerName = s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? null : s.partyName ?? null
                            const model = buildReceiptModel({ invoiceNumber: s.invoiceNumber, refCode: s.refCode, dateIso: s.date, lines: s.lines, totals: s.totals, payment: s.payment, paidMinor: s.paidMinor, operatorName: setup.ownerName ?? 'المالك', customerName, taxPercent: s.taxPercent ?? setup.vatPercent, taxInclusive: s.taxInclusive ?? setup.taxInclusive, settings: receipt })
                            /* نفس مسار الطباعة: PDF المرسل مستند ضريبي كامل — بلا رمز يفقد حجيته */
                            stampTax(model, { dateIso: s.date, invoiceNumber: s.invoiceNumber, totalMinor: s.totals.totalMinor, taxMinor: s.totals.taxMinor })
                            shareDocPdfViaWhatsapp({ model, cur, settings: receipt, docLabel: 'فاتورة', docNumber: s.invoiceNumber, partyPhone: customers.find((c) => c.id === s.customerId)?.phone ?? '', shopName: setup.shopName, toast })
                          }} title="إرسال PDF واتساب" data-contracting-invoice-whatsapp className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10"><Send size={13} /></button>
                          <button onClick={() => openSalesInvoiceWindow(s.id)} data-contracting-invoice-review title="مراجعة وتعديل الفاتورة في نافذتها الكاملة" className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10"><Pencil size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edOpen && (
        <div data-contracting-free-editor className="layer-modal fixed inset-0 overflow-auto bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl">
            <InvoicePOSFrame
              kind="sale"
              modeLabel="فاتورة مقاولات — بنود حرة"
              currencyLabel={`${cur.code} · ${cur.symbol}`}
              dateLabel={new Date().toISOString().slice(0, 10)}
              branchLabel={setup.shopName ?? ''}
              userLabel={setup.ownerName ?? 'المالك'}
              activityLabel="مقاولات"
              documentNumber="CI-DRAFT"
              onBack={() => setEdOpen(false)}
              onNavigate={() => undefined}
              onPartySearch={() => undefined}
              onItemSearch={() => undefined}
              onSaveDraft={() => toast.show('هذه الفاتورة تُرحَّل مباشرة — بلا مسودات (بنودها حرة تُكتب مرة واحدة)')}
              onRestoreDraft={() => toast.show('لا مسودات لفاتورة البنود الحرة — اكتب البنود أو عبئها من بنود المشروع')}
              onPrint={() => { if (!edParsed.length) return toast.show('أضف بنوداً قبل المعاينة', 'error'); openPrintPreview({ html: buildModelHtml(edPrintModel(), cur, receipt, 'a4'), wide: true, title: 'معاينة فاتورة المقاولات قبل الترحيل', rebuild: () => buildModelHtml(edPrintModel(), cur, receipt, 'a4' as InvoiceTemplate) }) }}
              onExportPdf={() => toast.show('بعد الترحيل: طباعة ← حفظ كـ PDF 🖨️')}
              onWhatsappPdf={() => { if (!edParsed.length) return toast.show('أضف بنوداً قبل الإرسال', 'error'); shareDocPdfViaWhatsapp({ model: edPrintModel(), cur, settings: receipt, docLabel: 'فاتورة', docNumber: 'مسودة', partyPhone: customers.find((c) => c.id === edCustomerId)?.phone ?? '', shopName: setup.shopName, toast }) }}
              onPost={postFreeInvoice}
              headerFields={
                <>
                  <Field label="المشروع (اختياري)">
                    <QuickSelect className={inputCls} value={edProjectId} onChange={(e) => { const id = Number(e.target.value); setEdProjectId(id); const prj = projects.find((x) => x.id === id); if (prj?.clientId && !edCustomerId) { setEdCustomerId(prj.clientId); setEdPayment('credit') } }} aria-label="مشروع فاتورة المقاولات">
                      <option value={0}>بدون مشروع</option>
                      {projects.filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.code} — {x.nameAr}</option>)}
                    </QuickSelect>
                  </Field>
                  <Field label="العميل المسجَّل *">
                    <div className="invoice-doc-infield flex gap-1">
                      <PartyQuickPicker parties={customers} value={edCustomerId} onChange={(id) => { const cid = id ?? 0; setEdCustomerId(cid); if (cid > 0) setEdPayment('credit') }} label="بحث العميل" cashValue={0} cashLabel="عميل نقدي" />
                      <span className="text-[11px] text-slate-400 self-center">{customers.find((c) => c.id === edCustomerId)?.nameAr ?? '—'}</span>
                    </div>
                  </Field>
                  <Field label="التحصيل">
                    <QuickSelect className={inputCls} value={edPayment} onChange={(e) => setEdPayment(e.target.value as 'cash' | 'credit')} aria-label="طريقة التحصيل">
                      <option value="credit">آجل (مدين على العميل)</option>
                      <option value="cash">نقدي</option>
                    </QuickSelect>
                  </Field>
                  <Field label="الضريبة">
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer h-6 px-1">
                      <input type="checkbox" checked={edWithTax} onChange={(e) => setEdWithTax(e.target.checked)} className="w-3.5 h-3.5 shrink-0 accent-emerald-600" />
                      <span>{edWithTax ? `بالضريبة (${edEffectiveTaxPct}٪)` : 'بدون ضريبة (0٪)'}</span>
                    </label>
                  </Field>
                  <Field label={`المحصل (${cur.symbol})`} hint="اتركه فارغاً = 0 للآجل أو كامل الإجمالي للنقدي">
                    <input className={inputCls} value={edPaid} onChange={(e) => setEdPaid(e.target.value)} inputMode="decimal" dir="ltr" />
                  </Field>
                  {edProjectId > 0 && (
                    <div className="flex items-end gap-1">
                      <Btn variant="soft" onClick={() => fillFromBoq()}><Download size={14} /> تعبئة من بنود المشروع ({edPartialPct}٪)</Btn>
                      {[25, 50, 100].map((p) => (
                        <button key={p} type="button" onClick={() => { setEdPartialPct(String(p)); fillFromBoq(p) }} className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${Number(edPartialPct) === p ? 'border-orange-500 bg-orange-500/10 text-orange-600' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>{p}٪</button>
                      ))}
                    </div>
                  )}
                </>
              }
              partyMeta={
                <div className="invoice-doc-partymeta">
                  <span>البنود: <b>{edParsed.length}</b></span>
                  <span>ضريبة المستند: <b>{edEffectiveTaxPct}٪</b></span>
                  {edProjectId > 0 && <span>المشروع: <b>{projects.find((x) => x.id === edProjectId)?.code}</b></span>}
                </div>
              }
            >
              <section className="invoice-shell overflow-visible rounded-b-2xl border-x border-b border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-card-dark">
                <div className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
                  <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-slate-500/10 to-transparent p-3 dark:border-slate-700">
                    <div className="invoice-lines-toolbar-title"><b>بنود الفاتورة (كتابة حرة)</b><small>اسم البند كما تريد — بلا سجل أصناف؛ تُرحَّل كأصناف خدمة بلا مخزون</small></div>
                    <Btn variant="soft" onClick={() => setEdLines((l) => [...l, { key: crypto.randomUUID(), nameAr: '', qty: '1', unitAr: 'مقطوعية', price: '' }])}><Plus size={14} /> بند</Btn>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="invoice-lines-table w-full table-fixed text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-800/60">
                        <tr className="text-[10.5px] font-black text-slate-500">
                          <th className="w-9 px-1 py-2 text-center">#</th>
                          <th className="px-1 py-2 text-center">البند / الوصف</th>
                          <th className="w-[6rem] px-1 py-2 text-center">الوحدة</th>
                          <th className="w-[6rem] px-1 py-2 text-center">الكمية</th>
                          <th className="w-[8rem] px-1 py-2 text-center">سعر الوحدة</th>
                          <th className="w-[9rem] px-1 py-2 text-center">إجمالي البند</th>
                          <th className="w-[4rem] px-1 py-2 text-center"></th>
                        </tr>
                      </thead>
                      <tbody onKeyDown={gridArrowNavigation}>
                        {edLines.map((l, i) => (
                          <tr key={l.key} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="p-1 text-center text-[11px] font-mono text-slate-400">{i + 1}</td>
                            <td className="p-1"><input className={`${inputCls} invoice-cell-input`} value={l.nameAr} onChange={(e) => setEdLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, nameAr: e.target.value } : x)))} placeholder="أعمال حفر وردم وتسوية…" /></td>
                            <td className="p-1">
                              <QuickSelect value={l.unitAr} onChange={(e) => setEdLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, unitAr: e.target.value } : x)))} className={inputCls}>
                                {freeUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                              </QuickSelect>
                            </td>
                            <td className="p-1"><input className={`${inputCls} invoice-cell-input`} dir="ltr" value={l.qty} onChange={(e) => setEdLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); const price = e.currentTarget.closest('tr')?.querySelectorAll<HTMLInputElement>('input')[2]; price?.focus(); price?.select() }} type="number" inputMode="decimal" step="any" min={0} /></td>
                            <td className="p-1"><input className={`${inputCls} invoice-cell-input`} dir="ltr" value={l.price} onChange={(e) => setEdLines((arr) => arr.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))} onKeyDown={(e) => {
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              const tbody = e.currentTarget.closest('tbody')
                              const nextRow = e.currentTarget.closest('tr')?.nextElementSibling as HTMLTableRowElement | null
                              const nextQty = nextRow?.querySelectorAll<HTMLInputElement>('input')[1]
                              if (nextQty) { nextQty.focus(); nextQty.select(); return }
                              setEdLines((arr) => [...arr, { key: crypto.randomUUID(), nameAr: '', qty: '1', unitAr: 'مقطوعية', price: '' }])
                              requestAnimationFrame(() => { const rows = tbody?.querySelectorAll<HTMLTableRowElement>('tr') ?? []; const last = rows[rows.length - 1]; last?.querySelectorAll<HTMLInputElement>('input')[0]?.focus() })
                            }} type="number" inputMode="decimal" step="any" min={0} /></td>
                            <td className="p-1"><div className="invoice-table-total font-mono">{(() => { const t = Math.round((Number(l.qty) || 0) * (() => { try { return toMinor(l.price || '0', cur.decimals) } catch { return 0 } })()); return t > 0 ? fmt(t) : '—' })()}</div></td>
                            <td className="p-1">
                              <div className="invoice-doc-rowtools">
                                <button type="button" className="doc-row-delete" aria-label="حذف البند" onClick={() => setEdLines((arr) => arr.filter((x) => x.key !== l.key))}><Trash2 size={13} /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {edLines.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-[12px] text-slate-400">لا بنود — أضف أول بند حر</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <section className="invoice-totals-footer">
                  <div className="invoice-doc-panel">
                    <div className="invoice-doc-panel-head"><b>ملاحظات الفاتورة</b><small>تُطبع في الحاشية</small></div>
                    <div className="invoice-doc-panel-body"><textarea className={`${inputCls} invoice-doc-termsbox`} value={edNotes} onChange={(e) => setEdNotes(e.target.value)} placeholder="ملاحظات المستند…" /></div>
                  </div>
                  <div className="invoice-doc-panel" data-contracting-free-totals>
                    <div className="invoice-doc-panel-head"><b>إجماليات الفاتورة</b><small>إجمالي ← ضريبة ← إجمالي بالضريبة</small></div>
                    <div className="invoice-doc-panel-body">
                      <div className="invoice-doc-sum-row"><span>الإجمالي</span><i /><b className="font-mono">{fmt(edNet)}</b></div>
                      <div className="invoice-doc-sum-row"><span>الضريبة ({taxPolicy.effectivePercent}٪)</span><i /><b className="font-mono">{fmt(edTax)}</b></div>
                      <div className="invoice-doc-sum-row is-strong"><span>الإجمالي بالضريبة</span><i /><b className="font-mono">{fmt(edGross)} {cur.symbol}</b></div>
                    </div>
                  </div>
                </section>
              </section>
            </InvoicePOSFrame>
          </div>
        </div>
      )}

      {/* إرشاد: أين المستخلصات؟ مراجعتها وتعديلها وطباعتها */}
      <div className="rounded-2xl bg-orange-500/5 border border-orange-500/20 p-3 text-[12px] text-orange-700 dark:text-orange-300 leading-relaxed">
        <b>دليل الصفحة:</b> «فاتورة بيع جديدة» تفتح الفاتورة الكاملة <b>حرة</b> (أصناف · عمولات موظفين · تحصيل متعدد · طباعة A4/A5/حراري) — ثم اربط المشروع من حقل <b>«المشروع»</b> في شريط الفاتورة نفسها: يُعبأ عميل المشروع تلقائياً (إن لم تختر عميلاً) وتظهر قيمة عقده، وتُحتسب الفاتورة في ملخص المشروع هنا وفي تفاصيله بشاشة المشروعات. بلا ربط؟ تبقى فاتورة حرة. <b>المستخلصات (PRX)</b> تُدار من شاشة «المشروعات والمستخلصات»: إصدار ومراجعة كاملة وتعديل بقيد عاكس وطباعة وثيقة رسمية للجهة المالكة.
      </div>
    </div>
  )
}
