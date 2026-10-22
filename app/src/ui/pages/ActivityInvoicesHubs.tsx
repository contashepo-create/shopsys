/**
 * §95 (محاذاة pro-acc — طلب المالك: «اريد اصدار فواتير ايضا في اللوجيستيات
 * وايضا في الايجار وايضا في النقل»): مركز فواتير البيع للأنشطة الخدمية —
 * نفس نمط مركز فواتير المقاولات، على نافذة الفاتورة الكاملة نفسها (أصناف
 * خدمية بلا مخزون · ضريبة · عمولات · تحصيل متعدد · طباعة A4/A5/حراري).
 *
 * أنشطة اللوجيستيات والنقل وإيجار المعدات والعقارات بلا وحدة «pos» — فقسم
 * المبيعات العام مخفي عنها — وهنا مركزها الخاص: كل فواتير البيع في مكان واحد.
 */
import { useMemo, useState } from 'react'
import { FilePlus2, Printer, Pencil, Coins, Route, Tractor, Building2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { deriveTaxConfig } from '../../core/returns.ts'
import { printModelWithTemplate } from '../print/printDoc.ts'
import { qrDataUrlFromPayload } from '../print/taxBarcode.ts'
import { Btn, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useTaxBarcodeStamp } from '../hooks/useTaxBarcodeStamp.ts'
import { openSalesInvoiceWindow } from '../windows/windowStore.ts'

type HubConfig = {
  /** وسم الصفحة — يظهر في الجذر والفحوص */
  dataKey: string
  titleAr: string
  subtitleAr: string
  icon: typeof Route
  iconClass: string
  /** وسم إرشادي أسفل الجدول */
  guideAr: string
}

const HUBS: Record<'logistics' | 'rental' | 'realestate', HubConfig> = {
  logistics: {
    dataKey: 'logistics-invoices',
    titleAr: 'فواتير البيع — اللوجيستيات والنقل',
    subtitleAr: 'فواتير خدمات النقل والشحن والتخليص لعملائك — الفاتورة الكاملة ببنود خدمية وضريبة وتحصيل متعدد',
    icon: Route,
    iconClass: 'bg-fuchsia-500/10 text-fuchsia-600',
    guideAr: 'الفاتورة تفتح حرة بأصناف خدمية (أنشئ أصناف الخدمات من المخزون ← الأصناف بوسم «خدمة») — واربطها بعميلك ليُحمَّل المتبقي على حسابه ويظهر بكشف حسابه، وتُحصَّل من سندات القبض أو تحصيلات العملاء.',
  },
  rental: {
    dataKey: 'rental-invoices',
    titleAr: 'فواتير البيع — إيجار المعدات',
    subtitleAr: 'فواتير إيجار المعدات والعمليات خارج مستحقات العقود — للخدمات الطارئة وفواتير الحركة الكاملة',
    icon: Tractor,
    iconClass: 'bg-teal-500/10 text-teal-600',
    guideAr: 'عقود الإيجار الدورية تستحق وتُحصَّل من شاشتها (وتُطبع وثيقة فاتورة إيجار) — وهذا المركز للفواتير الحرة الإضافية: ساعات تشغيل إضافية، نقل معدات، أعمال طارئة… ببنود خدمية وضريبة.',
  },
  realestate: {
    dataKey: 'realestate-invoices',
    titleAr: 'فواتير البيع — العقارات',
    subtitleAr: 'فواتير خدمات إدارة الأملاك والصيانة والوساطة — بخلاف أقساط الإيجار التي تُحصَّل من شاشة العقود',
    icon: Building2,
    iconClass: 'bg-teal-500/10 text-teal-600',
    guideAr: 'أقساط الإيجار تُدرَى من «عقود الإيجار» — وهذا المركز لفواتير الخدمات: صيانة بواسطة المالك، عمولة وساطة، خدمات إدارة… ببنود خدمية وضريبة كاملة.',
  },
}

function ActivityInvoicesHub({ activity }: { activity: keyof typeof HUBS }) {
  const cfg = HUBS[activity]
  const { sales, customers, rentalInvoices, rentalContracts, trips, tripExpenses, vehicles, employees } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const stampTax = useTaxBarcodeStamp()
  const Icon = cfg.icon
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [search, setSearch] = useState('')

  /* كل فواتير البيع — هذا النشاط بلا مشاريع، فالجدول الكامل بلا فلاتر مقيدة */
  const invoices = useMemo(() => {
    const q = search.trim()
    return sales
      .filter((s) => {
        if (!q) return true
        const customerName = customers.find((c) => c.id === s.customerId)?.nameAr ?? s.partyName ?? ''
        return s.invoiceNumber.includes(q) || customerName.includes(q)
      })
      .sort((a, b) => b.id - a.id)
  }, [sales, customers, search])

  const totals = useMemo(() => ({
    count: invoices.length,
    invoiced: invoices.reduce((a, s) => a + s.totals.totalMinor, 0),
    collected: invoices.reduce((a, s) => a + (s.paidMinor ?? 0), 0),
    remaining: invoices.reduce((a, s) => a + Math.max(0, s.totals.totalMinor - (s.paidMinor ?? 0)), 0),
  }), [invoices])

  /* طباعة فاتورة مرحّلة بنفس قوالب الفواتير (نمط مركز المقاولات) */
  const printInvoice = (s: (typeof sales)[number], template: 'a4' | 'a5' | 'thermal' = 'a5') => {
    const customerName = s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? null : s.partyName ?? null
    const tx = s.taxPercent !== undefined
      ? { taxPercent: s.taxPercent, taxInclusive: s.taxInclusive ?? true }
      : deriveTaxConfig(s.totals, s.lines)
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
      taxPercent: tx.taxPercent,
      taxInclusive: tx.taxInclusive,
      settings: receipt,
    })
    /* فاتورة بيع خدمية — تُطبع برمز زاتكا عند تفعيله (نفس فاتورة المبيعات العامة) */
    /* فاتورة قديمة: الرمز المجمّد وقت الإصدار أولاً — لا يُعاد توليده ببيانات اليوم */
    if (s.taxQrPayload) model.qrDataUrl = qrDataUrlFromPayload(s.taxQrPayload)
    else stampTax(model, { dateIso: s.date, invoiceNumber: s.invoiceNumber, totalMinor: s.totals.totalMinor, taxMinor: s.totals.taxMinor })
    printModelWithTemplate(model, cur, receipt, template)
    toast.show(template === 'thermal' ? `أُرسل إيصال ${s.invoiceNumber} للطباعة 🖨️` : `أُرسلت فاتورة ${s.invoiceNumber} للطباعة 📄`)
  }

  return (
    <div className="space-y-4" data-activity-invoices={cfg.dataKey}>
      <div className="flex items-center gap-2">
        <span className={`grid place-items-center w-9 h-9 rounded-xl ${cfg.iconClass}`}><Icon size={18} /></span>
        <div>
          <h1 className="text-xl font-black">{cfg.titleAr}</h1>
          <div className="text-[12px] text-slate-500">{cfg.subtitleAr}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">إجمالي الفواتير</div>
          <div className="font-black text-emerald-600">{fmt(totals.invoiced)}</div>
          <div className="text-[10px] text-slate-400">{totals.count} فاتورة</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">محصل</div>
          <div className="font-black text-sky-600">{fmt(totals.collected)}</div>
          <div className="text-[10px] text-slate-400">نقدي وماكينة وعلى موظف</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">باقٍ على العملاء</div>
          <div className="font-black text-amber-600">{fmt(totals.remaining)}</div>
          <div className="text-[10px] text-slate-400">ذمم دخلت كشوف الحساب</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-[11px] text-slate-500">متوسط الفاتورة</div>
          <div className="font-black text-violet-600">{fmt(totals.count ? Math.round(totals.invoiced / totals.count) : 0)}</div>
          <div className="text-[10px] text-slate-400">إجمالي ÷ عدد</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <input value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-64`} placeholder="بحث برقم الفاتورة أو العميل…" />
        <Btn shortcut="F3" data-activity-new-invoice onClick={() => { openSalesInvoiceWindow(); toast.show('فاتورة حرة كاملة — أضف بنود الخدمة واختر العميل وسيُحمَّل المتبقي على حسابه') }} title="فاتورة بيع كاملة بنافذة الفواتير المتقدمة"><FilePlus2 size={16} /> فاتورة بيع جديدة</Btn>
      </div>

      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Coins size={16} className="text-emerald-600" />
          <b className="text-[13px]">كل فواتير البيع</b>
          <span className="text-[11px] text-slate-500">مراجعة وتعديل وطباعة — المتبقي على العميل بكشف حسابه</span>
        </div>
        {invoices.length === 0 ? (
          <div className="p-6"><EmptyState icon="🧾" title="لا فواتير بعد" sub="افتح «فاتورة بيع جديدة» — بنود خدمية وضريبة وتحصيل متعدد وطباعة A4/A5/حراري" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]" data-activity-invoices-table>
              <thead className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <tr>{['الفاتورة', 'التاريخ', 'العميل', 'الإجمالي', 'المحصل', 'الباقي', ''].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {invoices.map((s) => {
                  const remain = s.totals.totalMinor - (s.paidMinor ?? 0)
                  const customerName = customers.find((c) => c.id === s.customerId)?.nameAr ?? s.partyName ?? 'نقدي'
                  return (
                    <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-emerald-500/5">
                      <td className="px-3 py-2 font-bold">{s.invoiceNumber}</td>
                      <td className="px-3 py-2">{s.date.slice(0, 10)}</td>
                      <td className="px-3 py-2">{customerName}</td>
                      <td className="px-3 py-2 font-bold">{fmt(s.totals.totalMinor)}</td>
                      <td className="px-3 py-2 text-emerald-600">{fmt(s.paidMinor ?? 0)}</td>
                      <td className={`px-3 py-2 font-bold ${remain > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{remain > 0 ? fmt(remain) : '✓'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => printInvoice(s, 'a5')} title="طباعة A5" className="px-1.5 py-1 rounded-md text-[10px] font-black text-sky-600 hover:bg-sky-500/10">A5</button>
                          <button onClick={() => printInvoice(s, 'a4')} title="طباعة A4" className="px-1.5 py-1 rounded-md text-[10px] font-black text-sky-600 hover:bg-sky-500/10">A4</button>
                          <button onClick={() => printInvoice(s, 'thermal')} title="إيصال حراري" className="p-1.5 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-500/10"><Printer size={13} /></button>
                          <button onClick={() => openSalesInvoiceWindow(s.id)} data-activity-invoice-review title="مراجعة وتعديل الفاتورة في نافذتها الكاملة" className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10"><Pencil size={13} /></button>
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

      <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-[12px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
        <b>دليل الصفحة:</b> {cfg.guideAr}
      </div>

      {activity === 'logistics' && trips.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" data-logistics-trips-invoices-hub>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Route size={16} className="text-fuchsia-600" />
              <b className="text-[13px]">فواتير النقلات المسجلة ({trips.length})</b>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <a href="#/logistics/trips" className="font-bold text-fuchsia-600 hover:underline">إدارة وتعديل النقلات ←</a>
              <span className="text-slate-300">|</span>
              <a href="#/logistics/expenses" className="font-bold text-amber-600 hover:underline">قسم مصاريف النقلات ←</a>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300">
                <tr>{['النقلة', 'التاريخ', 'العميل', 'بنود خدمة النقل / المسار', 'الحاويات', 'الإجمالي للعميل', 'المتبقي', 'طباعة فاتورة للعميل'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {[...trips].reverse().map((t) => {
                  const cust = t.customerId ? customers.find((c) => c.id === t.customerId) : undefined
                  const standaloneExpenseRecords = tripExpenses
                    .filter((x) => x.tripId === t.id && !x.reversedByEntryId && x.bearer === 'customer')
                  const customerStandaloneMinor = standaloneExpenseRecords.reduce((s, x) => s + x.amountMinor, 0)
                  const totalForCustomer = t.totals.grandMinor + customerStandaloneMinor
                  const paid = t.paidMinor ?? (t.payment === 'cash' ? t.totals.grandMinor : 0)
                  const remain = Math.max(0, totalForCustomer - paid)
                  const printTripInvoice = (tpl: 'a4' | 'a5' | 'thermal') => {
                    const veh = vehicles.find((v) => v.id === t.vehicleId)
                    const drv = employees.find((e) => e.id === t.driverId)
                    const tripLines = t.lines && t.lines.length > 0
                      ? t.lines
                      : [{
                          itemId: null,
                          serviceNameAr: `خدمة نقل: ${t.fromLoc} ← ${t.toLoc}`,
                          fromLoc: t.fromLoc,
                          toLoc: t.toLoc,
                          qty: t.qty,
                          unitPriceMinor: t.unitPriceMinor,
                          containerNumbers: t.containerNumbers,
                        }]
                    const customerBorneExpenses = t.expenses.filter((e) => e.source === 'customer')
                    const lines = [
                      ...tripLines.map((line, idx) => ({
                        itemId: line.itemId ?? -(idx + 1),
                        nameAr: line.serviceNameAr || `نقل ${line.fromLoc} ← ${line.toLoc}`,
                        qty: line.qty,
                        unitPriceMinor: line.unitPriceMinor,
                        unitCostMinor: 0,
                        discountPercent: 0,
                        soldByWeight: false,
                        notes: [
                          line.fromLoc && line.toLoc ? `المسار: ${line.fromLoc} ← ${line.toLoc}` : '',
                          line.containerNumbers?.length ? `الحاويات: ${line.containerNumbers.join(' ، ')}` : '',
                        ].filter(Boolean).join(' | ') || undefined,
                      })),
                      ...customerBorneExpenses.map((exp, idx) => ({
                        itemId: -(1000 + idx),
                        nameAr: `${exp.nameAr} (مصروف على حساب العميل)`,
                        qty: exp.qty,
                        unitPriceMinor: exp.unitAmountMinor,
                        unitCostMinor: 0,
                        discountPercent: 0,
                        soldByWeight: false,
                      })),
                      ...standaloneExpenseRecords.map((exp, idx) => ({
                        itemId: -(2000 + idx),
                        nameAr: `${exp.nameAr} (على حساب العميل — ${exp.expenseNumber})`,
                        qty: 1,
                        unitPriceMinor: exp.amountMinor,
                        unitCostMinor: 0,
                        discountPercent: 0,
                        soldByWeight: false,
                        vatPercentOverride: 0,
                      })),
                    ]
                    const subtotalMinor = t.totals.baseMinor + customerBorneExpenses.reduce((s, e) => s + e.amountMinor, 0)
                    const extraContext = [
                      veh ? `المركبة: ${veh.plateNumber}` : '',
                      drv ? `السائق: ${drv.nameAr}` : '',
                    ].filter(Boolean).join(' — ')
                    const model = buildReceiptModel({
                      invoiceNumber: t.tripNumber,
                      refCode: t.tripNumber,
                      dateIso: t.date,
                      lines,
                      totals: {
                        grossMinor: subtotalMinor,
                        discountMinor: 0,
                        netMinor: subtotalMinor,
                        taxBaseMinor: subtotalMinor,
                        taxMinor: t.totals.vatMinor,
                        totalMinor: totalForCustomer,
                        cogsMinor: 0,
                      },
                      payment: t.payment,
                      paidMinor: paid,
                      operatorName: setup.ownerName || 'المالك',
                      customerName: cust ? `${cust.nameAr}${extraContext ? ` (${extraContext})` : ''}` : `عميل نقدي${extraContext ? ` (${extraContext})` : ''}`,
                      taxPercent: t.vatPercent,
                      taxInclusive: false,
                      settings: receipt,
                    })
                    stampTax(model, { dateIso: t.date, invoiceNumber: t.tripNumber, totalMinor: totalForCustomer, taxMinor: t.totals.vatMinor })
                    printModelWithTemplate(model, cur, receipt, tpl)
                  }
                  return (
                    <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-bold text-fuchsia-600">{t.tripNumber}</td>
                      <td className="px-3 py-2 font-mono text-[11.5px]">{t.date.slice(0, 10)}</td>
                      <td className="px-3 py-2">{cust?.nameAr ?? 'عميل نقدي'}</td>
                      <td className="px-3 py-2 font-bold">
                        {t.lines && t.lines.length > 0
                          ? t.lines.map((l) => `${l.serviceNameAr} (×${l.qty})`).join(' + ')
                          : `${t.fromLoc} ← ${t.toLoc} (×${t.qty})`}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{t.containerNumbers.length ? t.containerNumbers.join(', ') : '—'}</td>
                      <td className="px-3 py-2 font-bold font-mono text-emerald-600">{fmt(totalForCustomer)}</td>
                      <td className={`px-3 py-2 font-bold font-mono ${remain > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{remain > 0 ? fmt(remain) : 'مسددة'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => printTripInvoice('a4')} className="px-2 py-1 rounded-md text-[10.5px] font-black bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20">فاتورة A4</button>
                          <button onClick={() => printTripInvoice('a5')} className="px-2 py-1 rounded-md text-[10.5px] font-black bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20">A5</button>
                          <button onClick={() => printTripInvoice('thermal')} className="p-1.5 rounded-md text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-500/10" title="حراري"><Printer size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activity === 'rental' && rentalInvoices.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" data-rental-periodic-invoices-hub>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tractor size={16} className="text-teal-600" />
              <b className="text-[13px]">الفواتير الدورية / الشهرية الصادرة على عقود الإيجار ({rentalInvoices.length})</b>
            </div>
            <span className="text-[11px] text-slate-400">مقيدة في ملفات العقود وكشوف حسابات العملاء (1104)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-teal-500/10 text-teal-700 dark:text-teal-300">
                <tr>{['الفاتورة', 'العقد المرجعي', 'الفترة', 'العميل', 'الصافي', 'الضريبة', 'الإجمالي', 'المتبقي على العميل'].map((h) => <th key={h} className="px-3 py-2 text-right font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {[...rentalInvoices].reverse().map((inv) => {
                  const contract = rentalContracts.find((c) => c.id === inv.contractId)
                  const paid = inv.payment === 'cash' ? inv.totalMinor : inv.paidNowMinor
                  const remain = Math.max(0, inv.totalMinor - paid)
                  return (
                    <tr key={inv.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-bold text-teal-600">{inv.invoiceNumber}</td>
                      <td className="px-3 py-2 font-bold">{contract?.contractNumber ?? `#${inv.contractId}`}</td>
                      <td className="px-3 py-2">{inv.periodLabel} <span className="text-[10px] text-slate-400">({inv.date})</span></td>
                      <td className="px-3 py-2">{inv.customerName}</td>
                      <td className="px-3 py-2 font-mono">{fmt(inv.netMinor)}</td>
                      <td className="px-3 py-2 font-mono">{inv.vatMinor > 0 ? `${fmt(inv.vatMinor)} (${inv.vatPercent}٪)` : 'بدون ضريبة'}</td>
                      <td className="px-3 py-2 font-bold text-emerald-600 font-mono">{fmt(inv.totalMinor)}</td>
                      <td className={`px-3 py-2 font-bold font-mono ${remain > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{remain > 0 ? fmt(remain) : 'مسددة'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function LogisticsInvoicesPage() { return <ActivityInvoicesHub activity="logistics" /> }
export function RentalInvoicesPage() { return <ActivityInvoicesHub activity="rental" /> }
export function RealestateInvoicesPage() { return <ActivityInvoicesHub activity="realestate" /> }
