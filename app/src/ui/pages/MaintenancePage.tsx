/**
 * أوامر الصيانة (المرحلة 6 — القرار 13):
 * تذكرة = جهاز + عطل بحالات (مستلَمة ← تحت الصيانة ← جاهزة ← مسلَّمة).
 * لا قيد عند الاستلام؛ وعند التسليم: قيد واحد متوازن
 * (4103 إيراد صيانة + 2102 ضريبة، وقطع الغيار 5101/1103 بمتوسط التكلفة).
 */
import { useMemo, useState } from 'react'
import { Plus, Wrench, Eye, BookOpenText, PackageCheck, Trash2, TrendingUp } from 'lucide-react'
import { useDataStore, type MaintenanceTicket } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeTicketTotals, maintenanceReport, TICKET_STATUS_LABELS, TICKET_TRANSITIONS, type TicketStatus } from '../../core/maintenance.ts'
import { periodPresets, type Period } from '../../core/reports.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

const STATUS_COLORS: Record<TicketStatus, string> = {
  received: 'bg-sky-500/10 text-sky-600',
  in_progress: 'bg-amber-500/10 text-amber-600',
  ready: 'bg-emerald-500/10 text-emerald-600',
  delivered: 'bg-slate-500/10 text-slate-500',
  cancelled: 'bg-rose-500/10 text-rose-500',
}

interface DraftPart { itemId: string; qty: string; unitPrice: string }

export function MaintenancePage() {
  const { tickets, customers, items, journal, openTicket, setTicketStatus, deliverTicket } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custLabel = (t: MaintenanceTicket) =>
    t.customerId != null ? customers.find((c) => c.id === t.customerId)?.nameAr ?? '—' : t.customerName || 'عميل نقدي'

  const [tab, setTab] = useState<'list' | 'report'>('list')

  /* ─── فتح تذكرة ─── */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [issue, setIssue] = useState('')
  const [estimate, setEstimate] = useState('')
  const [notes, setNotes] = useState('')
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)

  const openNew = () => {
    setCustomerId(''); setCustomerName(''); setCustomerPhone(''); setDeviceName('')
    setIssue(''); setEstimate(''); setNotes(''); setOpen(true)
  }
  const saveTicket = () => {
    try {
      const t = openTicket({
        customerId: customerId ? Number(customerId) : null,
        customerName, customerPhone,
        deviceName, issue,
        estimateMinor: toM(estimate),
        notes,
      })
      toast.show(`فُتحت التذكرة ${t.ticketNumber} ✅`)
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
  const [withVat, setWithVat] = useState(false)
  const startDeliver = (t: MaintenanceTicket) => {
    setDelivering(t)
    setLabor(t.estimateMinor > 0 ? formatMinor(t.estimateMinor, cur, false).replace(/,/g, '') : '')
    setParts([]); setPayment('cash'); setWithVat(false)
  }
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
        payment,
        vatPercent: withVat ? setup.vatPercent : 0,
      })
    } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delivering, labor, parts, payment, withVat, items, setup.vatPercent, cur.decimals])

  const doDeliver = () => {
    if (!delivering) return
    try {
      const t = deliverTicket(delivering.id, {
        laborMinor: toM(labor),
        parts: parts.filter((p) => p.itemId).map((p) => ({ itemId: Number(p.itemId), qty: Number(p.qty) || 0, unitPriceMinor: toM(p.unitPrice) })),
        payment,
        vatPercent: withVat ? setup.vatPercent : 0,
        treasury,
      })
      toast.show(`سُلِّمت ${t.ticketNumber} — المحصَّل ${fmt(t.totals!.grandMinor)} ${cur.symbol} ✅`)
      setDelivering(null)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض ─── */
  const [viewing, setViewing] = useState<MaintenanceTicket | null>(null)
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
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> تذكرة جديدة</span></Btn>
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
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={inputCls} dir="ltr" />
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
          <Field label="وصف العطل *">
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} className={`${inputCls} min-h-[70px]`} placeholder="الشاشة مكسورة، البطارية تفرغ سريعاً…" />
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="التحصيل">
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي</button>
                  <button onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل</button>
                </div>
                {payment === 'cash' && <div className="mt-2"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></div>}
              </Field>
              <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer self-end">
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
                <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="w-4 h-4 accent-orange-600" />
              </label>
            </div>

            {deliverPreview && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
                <div><div className="text-slate-400">الأجرة + القطع</div><b>{fmt(deliverPreview.revenueMinor)}</b></div>
                <div><div className="text-slate-400">الضريبة</div><b>{fmt(deliverPreview.vatMinor)}</b></div>
                <div><div className="text-slate-400">المستحق من العميل</div><b className="text-emerald-600">{fmt(deliverPreview.grandMinor)}</b></div>
                <div><div className="text-slate-400">تكلفة القطع</div><b className="text-rose-500">{fmt(deliverPreview.partsCostMinor)}</b></div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setDelivering(null)}>إلغاء</Btn>
              <Btn onClick={doDeliver}>📦 تسليم وتوليد القيد</Btn>
            </div>
          </div>
        )}
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
    </div>
  )
}
