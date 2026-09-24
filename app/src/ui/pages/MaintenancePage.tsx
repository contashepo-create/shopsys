/**
 * أوامر الصيانة (المرحلة 6 — القرار 13):
 * تذكرة = جهاز + عطل بحالات (مستلَمة ← تحت الصيانة ← جاهزة ← مسلَّمة).
 * لا قيد عند الاستلام؛ وعند التسليم: قيد واحد متوازن
 * (4103 إيراد صيانة + 2102 ضريبة، وقطع الغيار 5101/1103 بمتوسط التكلفة).
 */
import { useMemo, useState } from 'react'
import { Plus, Wrench, Eye, BookOpenText, PackageCheck, Trash2, TrendingUp, Printer, Settings2 } from 'lucide-react'
import { useDataStore, type MaintenanceTicket } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry, phonePlaceholder } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeTicketTotals, maintenanceReport, isTicketOverdue, TICKET_STATUS_LABELS, TICKET_TRANSITIONS, type TicketStatus } from '../../core/maintenance.ts'
import { renderTicketReceiptHtml, renderTicketInvoiceHtml } from '../print/printMaintenanceTicket.ts'
import { printHtml } from '../print/printReceipt.ts'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { ServiceRefundBox } from '../components/ServiceRefundBox.tsx'
import { periodPresets, type Period } from '../../core/reports.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

const STATUS_COLORS: Record<TicketStatus, string> = {
  received: 'bg-sky-500/10 text-sky-600',
  in_progress: 'bg-amber-500/10 text-amber-600',
  ready: 'bg-emerald-500/10 text-emerald-600',
  delivered: 'bg-slate-500/10 text-slate-500',
  cancelled: 'bg-rose-500/10 text-rose-500',
}

interface DraftPart { itemId: string; qty: string; unitPrice: string }
interface DraftService { serviceId: string; nameAr: string; qty: string; unitPrice: string; unitCost: string }

export function MaintenancePage() {
  const { tickets, customers, items, journal, paymentTerminals, paymentTerminalTransactions, openTicket, setTicketStatus, deliverTicket, refundMaintenanceTicket, maintenanceServices, addMaintenanceService, updateMaintenanceService } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custLabel = (t: MaintenanceTicket) =>
    t.customerId != null ? customers.find((c) => c.id === t.customerId)?.nameAr ?? '—' : t.customerName || 'عميل نقدي'

  /* الأمر 23: طباعة احترافية — إيصال استلام + فاتورة تسليم (بلا تكلفة/ربح للعميل) */
  const ticketPrintBase = (t: MaintenanceTicket) => ({
    shopName: receipt.shopName || setup.shopName || 'تَحَكَّم',
    headerLines: receipt.headerLines.filter((l) => l.trim()),
    ticketNumber: t.ticketNumber,
    date: t.deliveredAt ?? t.date,
    customerName: custLabel(t),
    customerPhone: t.customerPhone,
    deviceName: t.deviceName,
    issue: t.issue,
    estimateMinor: t.estimateMinor,
    promisedAt: t.promisedAt,
    notes: t.notes,
  })
  const printTicketReceipt = (t: MaintenanceTicket) => printHtml(renderTicketReceiptHtml(ticketPrintBase(t), cur))
  const printTicketInvoice = (t: MaintenanceTicket) => {
    if (!t.totals) { printTicketReceipt(t); return }
    printHtml(renderTicketInvoiceHtml({
      ...ticketPrintBase(t),
      laborMinor: t.totals.laborMinor,
      parts: t.parts.map((p) => ({ nameAr: p.nameAr, qty: p.qty, unitPriceMinor: p.unitPriceMinor })),
      services: (t.services ?? []).map((sv) => ({ nameAr: sv.nameAr, qty: sv.qty, unitPriceMinor: sv.unitPriceMinor })),
      totals: t.totals,
    }, cur))
  }

  const [tab, setTab] = useState<'list' | 'report'>('list')

  /* ─── فتح تذكرة ─── */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [issue, setIssue] = useState('')
  const [estimate, setEstimate] = useState('')
  const [deviceSerial, setDeviceSerial] = useState('') // سيريال/IMEI (نمط RepairDesk)
  const [deviceCondition, setDeviceCondition] = useState('') // حالة الجهاز الظاهرية عند الاستلام
  const [prepaid, setPrepaid] = useState('') // عربون مقبوض عند الاستلام (نمط RepairShopr)
  const [prepaidTreasury, setPrepaidTreasury] = useState('1101')
  const [promisedAt, setPromisedAt] = useState('') // موعد التسليم الموعود (جولة المغسلة)
  const [notes, setNotes] = useState('')
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)

  const openNew = () => {
    setCustomerId(''); setCustomerName(''); setCustomerPhone(''); setDeviceName('')
    setDeviceSerial(''); setDeviceCondition(''); setPrepaid(''); setPrepaidTreasury('1101')
    setIssue(''); setEstimate(''); setPromisedAt(''); setNotes(''); setOpen(true)
  }
  const saveTicket = () => {
    try {
      const t = openTicket({
        customerId: customerId ? Number(customerId) : null,
        customerName, customerPhone,
        deviceName, issue,
        deviceSerial: deviceSerial.trim() || undefined,
        deviceCondition: deviceCondition.trim() || undefined,
        estimateMinor: toM(estimate),
        prepaidMinor: toM(prepaid) || undefined,
        treasury: prepaidTreasury as '1101',
        promisedAt: promisedAt ? new Date(promisedAt).toISOString() : undefined,
        notes,
      })
      toast.show(`فُتحت التذكرة ${t.ticketNumber} ✅${(t.prepaidMinor ?? 0) > 0 ? ' وتولد قيد العربون' : ''}`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── نقل حالة ─── */
  const moveStatus = (t: MaintenanceTicket, status: TicketStatus) => {
    try { setTicketStatus(t.id, status); toast.show(`التذكرة ${t.ticketNumber} الآن «${TICKET_STATUS_LABELS[status]}»`) }
    catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── تسليم ─── */
  const [delivering, setDelivering] = useState<MaintenanceTicket | null>(null)
  const [labor, setLabor] = useState('')
  const [parts, setParts] = useState<DraftPart[]>([])
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [withVat, setWithVat] = useState(false)
  /* الأمر 23: خدمات من الكتالوج (تكلفة + سعر) + تحصيل مجزأ نقدي/آجل */
  const [svcLines, setSvcLines] = useState<DraftService[]>([])
  const [paidNow, setPaidNow] = useState('') // فارغ = الكل نقداً (حسب طريقة الدفع)
  const startDeliver = (t: MaintenanceTicket) => {
    setDelivering(t)
    setLabor(t.estimateMinor > 0 ? formatMinor(t.estimateMinor, cur, false).replace(/,/g, '') : '')
    setParts([]); setSvcLines([]); setPayment('cash'); setWithVat(false); setPaidNow(''); setTerminalPayment({ terminalId: '', providerReference: '', cardLast4: '' })
  }
  const addSvc = () => setSvcLines((p) => [...p, { serviceId: '', nameAr: '', qty: '1', unitPrice: '', unitCost: '' }])
  const patchSvc = (i: number, patch: Partial<DraftService>) => setSvcLines((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const dropSvc = (i: number) => setSvcLines((p) => p.filter((_, j) => j !== i))
  const pickSvc = (i: number, serviceId: string) => {
    const sv = maintenanceServices.find((x) => x.id === Number(serviceId))
    patchSvc(i, {
      serviceId,
      nameAr: sv?.nameAr ?? '',
      unitPrice: sv && sv.priceMinor > 0 ? formatMinor(sv.priceMinor, cur, false).replace(/,/g, '') : '',
      unitCost: sv && sv.costMinor > 0 ? formatMinor(sv.costMinor, cur, false).replace(/,/g, '') : '0',
    })
  }
  const draftServices = () => svcLines
    .filter((sv) => sv.nameAr.trim())
    .map((sv) => ({ serviceId: sv.serviceId ? Number(sv.serviceId) : null, nameAr: sv.nameAr.trim(), qty: Number(sv.qty) || 1, unitPriceMinor: toM(sv.unitPrice), unitCostMinor: toM(sv.unitCost) }))
  const addPart = () => setParts((p) => [...p, { itemId: '', qty: '1', unitPrice: '' }])
  const patchPart = (i: number, patch: Partial<DraftPart>) => setParts((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const dropPart = (i: number) => setParts((p) => p.filter((_, j) => j !== i))
  const pickPartItem = (i: number, itemId: string) => {
    const item = items.find((x) => x.id === Number(itemId))
    patchPart(i, { itemId, unitPrice: item && item.priceMinor > 0 ? formatMinor(item.priceMinor, cur, false).replace(/,/g, '') : '' })
  }

  const deliverPreview = useMemo(() => {
    if (!delivering) return null
    try {
      return computeTicketTotals({
        laborMinor: toM(labor),
        parts: parts.filter((p) => p.itemId).map((p) => {
          const item = items.find((x) => x.id === Number(p.itemId))
          return { itemId: Number(p.itemId), nameAr: item?.nameAr ?? '', qty: Number(p.qty) || 0, unitPriceMinor: toM(p.unitPrice), unitCostMinor: item?.costMinor ?? 0 }
        }),
        services: draftServices(),
        payment,
        paidMinor: paidNow !== '' ? toM(paidNow) : undefined,
        vatPercent: withVat ? setup.vatPercent : 0,
      })
    } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivering, labor, parts, svcLines, paidNow, payment, withVat, items, setup.vatPercent, cur.decimals])

  // تسليم آجل فوق حد ائتمان العميل — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const doDeliver = (creditLimitOverrideBy?: string) => {
    if (!delivering) return
    try {
      const terminal = paymentTerminals.find((row) => row.id === terminalPayment.terminalId)
      const t = deliverTicket(delivering.id, {
        laborMinor: toM(labor),
        parts: parts.filter((p) => p.itemId).map((p) => ({ itemId: Number(p.itemId), qty: Number(p.qty) || 0, unitPriceMinor: toM(p.unitPrice) })),
        services: draftServices(),
        payment,
        paidMinor: paidNow !== '' ? toM(paidNow) : undefined,
        vatPercent: withVat ? setup.vatPercent : 0,
        treasury: terminal?.settlementAccountCode ?? treasury,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      toast.show(`سُلِّمت ${t.ticketNumber} — المحصَّل ${fmt(t.totals!.paidMinor)} والباقي آجل ${fmt(t.totals!.creditMinor)} ${cur.symbol} ✅`)
      setDelivering(null)
      printTicketInvoice(t)
    } catch (err) {
      if (err instanceof CreditLimitError) { creditApproval.request((by) => doDeliver(by ?? 'المشرف')); return }
      toast.show((err as Error).message, 'error')
    }
  }

  /* ─── كتالوج الخدمات (الأمر 23) ─── */
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [svcName, setSvcName] = useState('')
  const [svcCost, setSvcCost] = useState('')
  const [svcPrice, setSvcPrice] = useState('')
  const saveService = () => {
    try {
      addMaintenanceService({ nameAr: svcName, costMinor: toM(svcCost || '0'), priceMinor: toM(svcPrice || '0') })
      setSvcName(''); setSvcCost(''); setSvcPrice('')
      toast.show('أُضيفت الخدمة للكتالوج ✓')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض ─── */
  const [viewing, setViewing] = useState<MaintenanceTicket | null>(null)
  const viewingTerminalCharge = viewing ? paymentTerminalTransactions.find((row) => row.kind === 'charge' && row.documentType === 'maintenance' && row.documentId === String(viewing.id)) : undefined
  const viewEntry = viewing?.journalEntryId != null ? journal.find((e) => e.id === viewing.journalEntryId) : null

  /* ─── تقرير ─── */
  const presets = useMemo(() => periodPresets(new Date().toISOString()), [])
  const [presetId, setPresetId] = useState('month')
  const period: Period = presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  const report = useMemo(() => maintenanceReport(tickets, period), [tickets, period])

  const listed = useMemo(() => [...tickets].reverse(), [tickets])
  const tabCls = (t: 'list' | 'report') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-orange-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><Wrench size={14} className="inline -mt-0.5 me-1" /> التذاكر ({tickets.length})</button>
          <button onClick={() => setTab('report')} className={tabCls('report')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> تقرير الصيانة</button>
        </div>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => setCatalogOpen(true)}><span className="flex items-center gap-1.5"><Settings2 size={15} /> كتالوج الخدمات</span></Btn>
          <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> تذكرة جديدة</span></Btn>
        </div>
      </div>

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🔧" title="لا تذاكر بعد" sub="استلم الجهاز بتذكرة، وعند التسليم يتولّد قيد الإيراد وقطع الغيار تلقائياً" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">التذكرة</th>
                  <th className="px-4 py-3 text-right font-bold">الجهاز / العطل</th>
                  <th className="px-4 py-3 text-right font-bold">العميل</th>
                  <th className="px-4 py-3 text-right font-bold">الحالة</th>
                  <th className="px-4 py-3 text-right font-bold">المحصَّل</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {listed.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-orange-600">{t.ticketNumber}</div>
                      <div className="text-[10px] text-slate-400" dir="ltr">{t.date.slice(0, 10)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-700 dark:text-slate-200">{t.deviceName}</div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{t.issue}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{custLabel(t)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${STATUS_COLORS[t.status]}`}>{TICKET_STATUS_LABELS[t.status]}</span>
                      {isTicketOverdue(t, new Date().toISOString()) && <span className="ms-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-600 text-[10px] font-bold animate-pulse">⏰ متأخرة</span>}
                      {t.promisedAt && !isTicketOverdue(t, new Date().toISOString()) && t.status !== 'delivered' && t.status !== 'cancelled' && (
                        <div className="text-[9.5px] text-slate-400 mt-0.5" dir="ltr">موعدها {t.promisedAt.slice(0, 16).replace('T', ' ')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold">{t.totals ? fmt(t.totals.grandMinor) : t.estimateMinor > 0 ? <span className="text-slate-400 font-normal">تقدير {fmt(t.estimateMinor)}</span> : '—'}</td>
                    <td className="px-4 py-3 text-left whitespace-nowrap">
                      {TICKET_TRANSITIONS[t.status].filter((s) => s !== 'delivered' && s !== 'cancelled').map((s) => (
                        <button key={s} onClick={() => moveStatus(t, s)} className="me-1 px-2 py-1 rounded-lg text-[10.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-orange-500/10 hover:text-orange-600 transition-all">{TICKET_STATUS_LABELS[s]} ←</button>
                      ))}
                      {TICKET_TRANSITIONS[t.status].includes('delivered') && (
                        <button onClick={() => startDeliver(t)} className="me-1 px-2 py-1 rounded-lg text-[10.5px] font-bold bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 transition-all"><PackageCheck size={11} className="inline -mt-0.5" /> تسليم</button>
                      )}
                      {TICKET_TRANSITIONS[t.status].includes('cancelled') && (
                        <button onClick={() => moveStatus(t, 'cancelled')} className="me-1 px-2 py-1 rounded-lg text-[10.5px] font-bold text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all">إلغاء</button>
                      )}
                      <button onClick={() => (t.status === 'delivered' ? printTicketInvoice(t) : printTicketReceipt(t))} title={t.status === 'delivered' ? 'طباعة فاتورة الصيانة (بلا تكلفة/ربح)' : 'طباعة إيصال استلام الجهاز'} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-500/10 transition-all"><Printer size={14} /></button>
                      <button onClick={() => setViewing(t)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Eye size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'report' && (
        <div className="anim-up space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-orange-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">إيراد الصيانة</div>
              <div className="font-black text-lg">{fmt(report.totalRevenueMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">الربح (بعد القطع)</div>
              <div className={`font-black text-lg ${report.totalProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(report.totalProfitMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">تذاكر مفتوحة</div>
              <div className="font-black text-lg text-amber-600">{report.openCount}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            {report.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[13px] py-10">لا تذاكر في هذه الفترة</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">التذكرة</th>
                    <th className="px-4 py-3 text-right font-bold">الجهاز</th>
                    <th className="px-4 py-3 text-right font-bold">الحالة</th>
                    <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                    <th className="px-4 py-3 text-right font-bold">تكلفة القطع</th>
                    <th className="px-4 py-3 text-right font-bold">الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.ticketId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-orange-600">{r.ticketNumber}</td>
                      <td className="px-4 py-2">{r.deviceName}</td>
                      <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-md text-[10.5px] font-bold ${STATUS_COLORS[r.status]}`}>{TICKET_STATUS_LABELS[r.status]}</span></td>
                      <td className="px-4 py-2 font-bold">{r.revenueMinor > 0 ? fmt(r.revenueMinor) : '—'}</td>
                      <td className="px-4 py-2 text-rose-500">{r.partsCostMinor > 0 ? fmt(r.partsCostMinor) : '—'}</td>
                      <td className={`px-4 py-2 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.revenueMinor > 0 ? fmt(r.profitMinor) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* فتح تذكرة */}
      <Modal open={open} onClose={() => setOpen(false)} title="تذكرة صيانة جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="عميل مسجل">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">— غير مسجل —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label="أو اسم العميل" hint="عند عدم التسجيل">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={inputCls} disabled={!!customerId} />
            </Field>
            <Field label="الهاتف">
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={inputCls} dir="ltr" placeholder={phonePlaceholder(useAppStore.getState().setup.countryCode)} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="الجهاز *">
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={inputCls} placeholder="آيفون 13 برو" />
            </Field>
            <Field label={`تقدير مبدئي (${cur.symbol})`} hint="يُتفق عليه عند الاستلام — لا قيد الآن">
              <input value={estimate} onChange={(e) => setEstimate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="السيريال / IMEI" hint="يوثق أي جهاز بالضبط استُلم — يحميك من الالتباس">
              <input value={deviceSerial} onChange={(e) => setDeviceSerial(e.target.value)} className={inputCls} dir="ltr" placeholder="اختياري" />
            </Field>
            <Field label="حالة الجهاز عند الاستلام" hint="خدوش، شاشة مكسورة… — يحميك من الادعاءات">
              <input value={deviceCondition} onChange={(e) => setDeviceCondition(e.target.value)} className={inputCls} placeholder="اختياري" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={`عربون مقبوض الآن (${cur.symbol})`} hint="يتولد قيد فوراً (خزينة/دفعات مقدمة) ويُخصم عند التسليم">
              <input value={prepaid} onChange={(e) => setPrepaid(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label="خزينة قبض العربون">
              <TreasuryPicker value={prepaidTreasury} onChange={setPrepaidTreasury} />
            </Field>
          </div>
          <Field label="وصف العطل *">
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} className={`${inputCls} min-h-[70px]`} placeholder="الشاشة مكسورة، البطارية تفرغ سريعاً…" />
          </Field>
          <Field label="موعد التسليم الموعود (اختياري)" hint="التذاكر المتجاوزة موعدها تظهر «⏰ متأخرة» — أهم ميزة للمغاسل">
            <input type="datetime-local" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} className={inputCls} dir="ltr" />
          </Field>
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveTicket} disabled={!deviceName.trim() || !issue.trim()}>💾 فتح التذكرة</Btn>
          </div>
        </div>
      </Modal>

      {/* تسليم */}
      <Modal open={!!delivering} onClose={() => setDelivering(null)} title={delivering ? `تسليم ${delivering.ticketNumber} — ${delivering.deviceName}` : ''} wide>
        {delivering && (
          <div className="space-y-4">
            <Field label={`أجرة الصيانة (${cur.symbol})`}>
              <input value={labor} onChange={(e) => setLabor(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500">قطع الغيار المستهلكة (من المخزون — بمتوسط التكلفة)</span>
                <button onClick={addPart} className="text-[11px] font-bold text-orange-600 hover:underline">+ إضافة قطعة</button>
              </div>
              {parts.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_60px_90px_28px] gap-1.5 items-center">
                  <select value={p.itemId} onChange={(e) => pickPartItem(i, e.target.value)} className={`${inputCls} !py-1.5 !text-[12px]`}>
                    <option value="">— اختر الصنف —</option>
                    {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.nameAr} (متاح {it.stockQty ?? 0})</option>)}
                  </select>
                  <input value={p.qty} onChange={(e) => patchPart(i, { qty: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" />
                  <input value={p.unitPrice} onChange={(e) => patchPart(i, { unitPrice: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" placeholder="السعر" />
                  <button onClick={() => dropPart(i)} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>

            {/* الأمر 23: خدمات من الكتالوج — تكلفة داخلية + سعر بيع، الربح محسوب ولا يُطبع للعميل */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500">خدمات مقدَّمة (من كتالوج الخدمات — التكلفة سرية لا تُطبع للعميل)</span>
                <button onClick={addSvc} className="text-[11px] font-bold text-orange-600 hover:underline">+ إضافة خدمة</button>
              </div>
              {svcLines.map((sv, i) => (
                <div key={i} className="grid grid-cols-[1fr_60px_90px_90px_28px] gap-1.5 items-center">
                  {maintenanceServices.filter((x) => x.isActive).length > 0 && !sv.nameAr && !sv.serviceId ? (
                    <select value={sv.serviceId} onChange={(e) => pickSvc(i, e.target.value)} className={`${inputCls} !py-1.5 !text-[12px]`}>
                      <option value="">— اختر الخدمة —</option>
                      {maintenanceServices.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
                    </select>
                  ) : (
                    <input value={sv.nameAr} onChange={(e) => patchSvc(i, { nameAr: e.target.value, serviceId: '' })} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="اسم الخدمة (حر)" autoComplete="off" />
                  )}
                  <input value={sv.qty} onChange={(e) => patchSvc(i, { qty: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" />
                  <input value={sv.unitPrice} onChange={(e) => patchSvc(i, { unitPrice: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" placeholder="السعر" />
                  <input value={sv.unitCost} onChange={(e) => patchSvc(i, { unitCost: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" placeholder="التكلفة 🔒" title="التكلفة الداخلية — لا تظهر في مطبوعات العميل" />
                  <button onClick={() => dropSvc(i)} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="التحصيل">
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي</button>
                  <button onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل</button>
                </div>
                {payment === 'cash' && <div className="mt-2 space-y-2"><PaymentMethodPicker value={{treasury,terminalPayment}} onChange={value=>{setTreasury(value.treasury);setTerminalPayment(value.terminalPayment)}} operation="receipt"/></div>}
                {payment === 'cash' && (
                  <input
                    value={paidNow}
                    onChange={(e) => setPaidNow(e.target.value)}
                    className={`${inputCls} mt-2 !py-1.5 !text-[12px]`}
                    dir="ltr"
                    placeholder={deliverPreview ? `المدفوع الآن (فارغ = ${fmt(deliverPreview.grandMinor)} كاملاً)` : 'المدفوع الآن'}
                    title="التحصيل المجزأ (الأمر 23): ادفع جزءاً نقداً والباقي دين على العميل — يتطلب عميلاً مسجلاً"
                  />
                )}
              </Field>
              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer self-end">
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
                <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="w-4 h-4 accent-orange-600" />
              </label>
            </div>

            {deliverPreview && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
                <div><div className="text-slate-400">الإيراد (أجرة+قطع+خدمات)</div><b>{fmt(deliverPreview.revenueMinor)}</b></div>
                <div><div className="text-slate-400">الضريبة</div><b>{fmt(deliverPreview.vatMinor)}</b></div>
                <div><div className="text-slate-400">المستحق من العميل</div><b className="text-emerald-600">{fmt(deliverPreview.grandMinor)}</b></div>
                <div><div className="text-slate-400">التكلفة (قطع+خدمات)</div><b className="text-rose-500">{fmt(deliverPreview.partsCostMinor + deliverPreview.servicesCostMinor)}</b></div>
                {(delivering.prepaidMinor ?? 0) > 0 && (
                  <div><div className="text-slate-400">عربون مدفوع مسبقاً</div><b className="text-sky-600">{fmt(delivering.prepaidMinor ?? 0)}</b></div>
                )}
                <div><div className="text-slate-400">محصَّل نقداً الآن</div><b className="text-emerald-600">{fmt(Math.max(0, deliverPreview.paidMinor - (delivering.prepaidMinor ?? 0)))}</b></div>
                <div><div className="text-slate-400">الباقي آجل</div><b className={deliverPreview.creditMinor > 0 ? 'text-amber-600' : ''}>{fmt(deliverPreview.creditMinor)}</b></div>
                <div className="col-span-2"><div className="text-slate-400">🔒 الربح المتوقع (سري — لا يُطبع للعميل)</div><b className="text-violet-600">{fmt(deliverPreview.profitMinor)}</b></div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setDelivering(null)}>إلغاء</Btn>
              <Btn onClick={doDeliver}>📦 تسليم وتوليد القيد</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* كتالوج خدمات الصيانة (الأمر 23): تكلفة داخلية + سعر بيع — الربح محسوب تلقائياً */}
      <Modal open={catalogOpen} onClose={() => setCatalogOpen(false)} title="🛠️ كتالوج خدمات الصيانة" wide>
        <div className="space-y-4">
          <p className="text-[11.5px] text-slate-400">
            كل خدمة لها تكلفة داخلية (أجر فني/مواد) وسعر بيع — الربح يُحسب تلقائياً، والتكلفة لا تظهر أبداً في مطبوعات العميل.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_auto] gap-2 items-end">
            <Field label="اسم الخدمة"><input value={svcName} onChange={(e) => setSvcName(e.target.value)} className={inputCls} placeholder="مثال: تغيير شاشة، سوفتوير، فحص شامل…" /></Field>
            <Field label={`التكلفة 🔒 (${cur.symbol})`}><input value={svcCost} onChange={(e) => setSvcCost(e.target.value)} className={inputCls} dir="ltr" placeholder="0" /></Field>
            <Field label={`سعر البيع (${cur.symbol})`}><input value={svcPrice} onChange={(e) => setSvcPrice(e.target.value)} className={inputCls} dir="ltr" placeholder="0" /></Field>
            <Btn onClick={saveService}>إضافة</Btn>
          </div>
          {maintenanceServices.length === 0 ? (
            <EmptyState icon="🛠️" title="لا خدمات بعد" sub="أضف خدماتك المتكررة لتختارها بنقرة عند التسليم" />
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2">الخدمة</th><th className="px-4 py-2">التكلفة 🔒</th><th className="px-4 py-2">سعر البيع</th><th className="px-4 py-2">الربح</th><th className="px-4 py-2">الحالة</th>
                </tr></thead>
                <tbody>
                  {maintenanceServices.map((sv) => (
                    <tr key={sv.id} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold">{sv.nameAr}</td>
                      <td className="px-4 py-2 text-rose-500">{fmt(sv.costMinor)}</td>
                      <td className="px-4 py-2 text-emerald-600 font-bold">{fmt(sv.priceMinor)}</td>
                      <td className="px-4 py-2 text-violet-600 font-bold">{fmt(sv.priceMinor - sv.costMinor)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => updateMaintenanceService(sv.id, { isActive: !sv.isActive })} className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${sv.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-400/10 text-slate-400'}`}>
                          {sv.isActive ? 'مفعّلة' : 'موقوفة'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* عرض */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `التذكرة ${viewing.ticketNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">الجهاز</div><b>{viewing.deviceName}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">العميل</div><b>{custLabel(viewing)}</b>{viewing.customerPhone && <div className="text-[10px] text-slate-400" dir="ltr">{viewing.customerPhone}</div>}</div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">الحالة</div><b>{TICKET_STATUS_LABELS[viewing.status]}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المحصَّل</div><b>{viewing.totals ? fmt(viewing.totals.grandMinor) : '—'}</b></div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px]">
              <div className="text-[10px] text-slate-400 font-bold mb-1">العطل</div>
              {viewing.issue}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {viewing.statusHistory.map((h, i) => (
                <span key={i} className={`px-2 py-1 rounded-lg text-[10.5px] font-bold ${STATUS_COLORS[h.status]}`}>
                  {TICKET_STATUS_LABELS[h.status]} <span className="opacity-60" dir="ltr">{h.at.slice(0, 16).replace('T', ' ')}</span>
                </span>
              ))}
            </div>

            {(viewing.services ?? []).length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">الخدمات المقدَّمة</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {(viewing.services ?? []).map((sv, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 font-bold">{sv.nameAr}</td>
                        <td className="px-4 py-1.5 text-slate-400">{sv.qty} × {fmt(sv.unitPriceMinor)}</td>
                        <td className="px-4 py-1.5 text-slate-500 text-[11px]">تكلفة 🔒 {fmt(sv.unitCostMinor * sv.qty)}</td>
                        <td className="px-4 py-1.5 font-bold text-left">{fmt(sv.unitPriceMinor * sv.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewing.totals && (
              <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
                <div className="rounded-xl bg-emerald-500/5 p-2.5"><div className="text-slate-400 text-[10px]">محصَّل نقداً</div><b className="text-emerald-600">{fmt(viewing.totals.paidMinor)}</b></div>
                <div className="rounded-xl bg-amber-500/5 p-2.5"><div className="text-slate-400 text-[10px]">آجل على العميل</div><b className="text-amber-600">{fmt(viewing.totals.creditMinor)}</b></div>
                <div className="rounded-xl bg-violet-500/5 p-2.5"><div className="text-slate-400 text-[10px]">🔒 الربح (سري)</div><b className="text-violet-600">{fmt(viewing.totals.profitMinor)}</b></div>
              </div>
            )}

            {viewing.parts.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">قطع الغيار</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewing.parts.map((p, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 font-bold">{p.nameAr}</td>
                        <td className="px-4 py-1.5 text-slate-400">{p.qty} × {fmt(p.unitPriceMinor)}</td>
                        <td className="px-4 py-1.5 text-slate-500 text-[11px]">تكلفة {fmt(p.unitCostMinor * p.qty)}</td>
                        <td className="px-4 py-1.5 font-bold text-left">{fmt(p.unitPriceMinor * p.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewing.status === 'delivered' && viewing.totals && (
              <ServiceRefundBox
                grandMinor={viewing.totals.grandMinor}
                refundedMinor={viewing.refundedMinor ?? 0}
                currencySymbol={cur.symbol}
                fmt={fmt}
                allowCredit={viewing.customerId != null}
                hint="عميل غير راضٍ؟ اختر ما يُرد: أجر الفني، خدمات، أو قطع غيار — القطعة السليمة المختارة تعود للمخزون بتكلفتها تلقائياً."
                terminalOriginal={viewingTerminalCharge ? { transactionId: viewingTerminalCharge.id, terminalName: paymentTerminals.find((row) => row.id === viewingTerminalCharge.terminalId)?.nameAr ?? viewingTerminalCharge.terminalId } : undefined}
                refundableItems={[
                  ...(viewing.totals.laborMinor > 0 ? [{ key: 'labor', label: 'أجر الفني (المصنعية)', valueMinor: viewing.totals.laborMinor }] : []),
                  ...(viewing.services ?? []).map((s, si) => ({ key: `svc:${si}`, label: s.nameAr, valueMinor: Math.round(s.qty * s.unitPriceMinor), qty: s.qty })),
                  ...viewing.parts.map((p, pi) => {
                    const returned = (viewing.returnedParts ?? []).filter((x) => x.itemId === p.itemId).reduce((a, x) => a + x.qty, 0)
                    const avail = p.qty - returned
                    return avail > 0 ? [{ key: `part:${pi}`, label: `قطعة: ${p.nameAr}`, valueMinor: Math.round(avail * p.unitPriceMinor), qty: avail, restockCostMinor: Math.round(avail * p.unitCostMinor) }] : []
                  }).flat(),
                ]}
                onSubmit={(a) => {
                  try {
                    // القطع المختارة تعود للمخزون بكامل كميتها المتبقية
                    const returnParts = (a.selectedKeys ?? [])
                      .filter((k) => k.startsWith('part:'))
                      .map((k) => {
                        const p = viewing.parts[Number(k.slice(5))]
                        const returned = (viewing.returnedParts ?? []).filter((x) => x.itemId === p.itemId).reduce((s, x) => s + x.qty, 0)
                        return { itemId: p.itemId, qty: p.qty - returned }
                      })
                      .filter((rp) => rp.qty > 0)
                    const u = refundMaintenanceTicket({ ticketId: viewing.id, amountMinor: a.amountMinor, mode: a.mode, treasury: viewingTerminalCharge ? (paymentTerminals.find((row) => row.id === viewingTerminalCharge.terminalId)?.settlementAccountCode ?? a.treasury) : a.treasury, reason: a.reason, approvedBy: a.approvedBy, returnParts, terminalRefund: a.terminalRefund })
                    setViewing(u)
                    toast.show(`سُجل مرتجع خدمة ${u.ticketNumber} وتولد القيد العاكس ✅${returnParts.length ? ' — عادت القطع للمخزون 📦' : ''}`)
                  } catch (err) { toast.show((err as Error).message, 'error') }
                }}
              />
            )}

            {viewEntry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{viewEntry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewEntry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                          {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                        </td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}
