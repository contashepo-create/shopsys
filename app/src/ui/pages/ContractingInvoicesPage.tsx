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
import { FilePlus2, Printer, Pencil, HardHat, Coins } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { printModelWithTemplate } from '../print/printDoc.ts'
import { Btn, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'
import { openSalesInvoiceWindow } from '../windows/windowStore.ts'
import { effectiveContractValue } from '../../core/contracting.ts'

export function ContractingInvoicesPage() {
  const {
    projects, projectExtracts, projectCosts, changeOrders, sales, customers, boqItems,
    staffCommissions, purchases,
  } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
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

      {/* إرشاد: أين المستخلصات؟ مراجعتها وتعديلها وطباعتها */}
      <div className="rounded-2xl bg-orange-500/5 border border-orange-500/20 p-3 text-[12px] text-orange-700 dark:text-orange-300 leading-relaxed">
        <b>دليل الصفحة:</b> «فاتورة بيع جديدة» تفتح الفاتورة الكاملة <b>حرة</b> (أصناف · عمولات موظفين · تحصيل متعدد · طباعة A4/A5/حراري) — ثم اربط المشروع من حقل <b>«المشروع»</b> في شريط الفاتورة نفسها: يُعبأ عميل المشروع تلقائياً (إن لم تختر عميلاً) وتظهر قيمة عقده، وتُحتسب الفاتورة في ملخص المشروع هنا وفي تفاصيله بشاشة المشروعات. بلا ربط؟ تبقى فاتورة حرة. <b>المستخلصات (PRX)</b> تُدار من شاشة «المشروعات والمستخلصات»: إصدار ومراجعة كاملة وتعديل بقيد عاكس وطباعة وثيقة رسمية للجهة المالكة.
      </div>
    </div>
  )
}
