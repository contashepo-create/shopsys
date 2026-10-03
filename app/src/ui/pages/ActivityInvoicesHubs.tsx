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
import { printModelWithTemplate } from '../print/printDoc.ts'
import { Btn, inputCls, useToast, EmptyState } from '../components/ui.tsx'
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
  const { sales, customers } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
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
    </div>
  )
}

export function LogisticsInvoicesPage() { return <ActivityInvoicesHub activity="logistics" /> }
export function RentalInvoicesPage() { return <ActivityInvoicesHub activity="rental" /> }
export function RealestateInvoicesPage() { return <ActivityInvoicesHub activity="realestate" /> }
