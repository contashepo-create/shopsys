/**
 * النقلات (المرحلة 6 — القرار 13، نمط logistics-web):
 * النقلة وحدة العمل: من/إلى × عدد × سعر، مصاريف بمصادر تمويل
 * (نقدي/على العميل/آجل)، أرقام حاويات، ربح لكل نقلة،
 * وقيد واحد متوازن (4105/5106/2102) + تقرير ربحية بفترات.
 */
import { useMemo, useState } from 'react'
import { Plus, Route, Eye, BookOpenText, Trash2, TrendingUp, Container } from 'lucide-react'
import { useDataStore, type Trip } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeTripTotals, tripProfitReport, EXPENSE_SOURCE_LABELS, type TripExpenseSource } from '../../core/logistics.ts'
import { periodPresets, type Period } from '../../core/reports.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

interface DraftExpense {
  nameAr: string
  qty: string
  unitAmount: string
  source: TripExpenseSource
}

export function TripsPage() {
  const { trips, vehicles, employees, customers, journal, postTrip } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custName = (id: number | null) => (id == null ? 'عميل نقدي' : customers.find((c) => c.id === id)?.nameAr ?? '—')
  const vehName = (id: number | null) => (id == null ? '—' : vehicles.find((v) => v.id === id)?.plateNumber ?? '—')
  const drvName = (id: number | null) => (id == null ? '—' : employees.find((e) => e.id === id)?.nameAr ?? '—')

  const [tab, setTab] = useState<'list' | 'profit'>('list')

  /* ─── تسجيل نقلة ─── */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [fromLoc, setFromLoc] = useState('')
  const [toLoc, setToLoc] = useState('')
  const [qty, setQty] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [withVat, setWithVat] = useState(false)
  const [containers, setContainers] = useState('')
  const [expenses, setExpenses] = useState<DraftExpense[]>([])
  const [notes, setNotes] = useState('')

  const openNew = () => {
    setCustomerId(''); setVehicleId(''); setDriverId(''); setFromLoc(''); setToLoc('')
    setQty('1'); setUnitPrice(''); setPayment('cash'); setWithVat(false)
    setContainers(''); setExpenses([]); setNotes(''); setOpen(true)
  }
  const pickVehicle = (v: string) => {
    setVehicleId(v)
    const veh = vehicles.find((x) => x.id === Number(v))
    if (veh?.defaultDriverId) setDriverId(String(veh.defaultDriverId))
  }
  const addExpense = () => setExpenses((e) => [...e, { nameAr: '', qty: '1', unitAmount: '', source: 'cash' }])
  const patchExpense = (i: number, patch: Partial<DraftExpense>) =>
    setExpenses((e) => e.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const dropExpense = (i: number) => setExpenses((e) => e.filter((_, j) => j !== i))

  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)
  const draftInput = useMemo(() => ({
    fromLoc, toLoc,
    qty: Number(qty) || 0,
    unitPriceMinor: toM(unitPrice),
    expenses: expenses.map((e) => ({ nameAr: e.nameAr, qty: Number(e.qty) || 0, unitAmountMinor: toM(e.unitAmount), source: e.source })),
    payment,
    vatPercent: withVat ? setup.vatPercent : 0,
    containerNumbers: containers.split(/[,\n،]/).map((c) => c.trim()).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [fromLoc, toLoc, qty, unitPrice, expenses, payment, withVat, containers, setup.vatPercent, cur.decimals])
  const draftTotals = useMemo(() => {
    try { return computeTripTotals(draftInput) } catch { return null }
  }, [draftInput])

  const save = () => {
    try {
      const trip = postTrip({
        customerId: customerId ? Number(customerId) : null,
        vehicleId: vehicleId ? Number(vehicleId) : null,
        driverId: driverId ? Number(driverId) : null,
        input: draftInput,
        notes: notes.trim(),
        treasury,
      })
      toast.show(`رُحّلت النقلة ${trip.tripNumber} — ربحها ${fmt(trip.totals.profitMinor)} ${cur.symbol} ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض نقلة ─── */
  const [viewing, setViewing] = useState<Trip | null>(null)
  const viewEntry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  /* ─── تقرير الربحية ─── */
  const presets = useMemo(() => periodPresets(new Date().toISOString()), [])
  const [presetId, setPresetId] = useState('month')
  const period: Period = presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  const profit = useMemo(() => tripProfitReport(trips, period), [trips, period])

  const listed = useMemo(() => [...trips].reverse(), [trips])
  const tabCls = (t: 'list' | 'profit') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-fuchsia-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><Route size={14} className="inline -mt-0.5 me-1" /> النقلات ({trips.length})</button>
          <button onClick={() => setTab('profit')} className={tabCls('profit')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> ربحية النقلات</button>
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> نقلة جديدة</span></Btn>
      </div>

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🛣️" title="لا نقلات بعد" sub="كل نقلة تُرحَّل بقيد واحد متوازن: إيراد نقلات / مصاريف نقلات / ضريبة" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">النقلة</th>
                  <th className="px-4 py-3 text-right font-bold">المسار</th>
                  <th className="px-4 py-3 text-right font-bold">العميل</th>
                  <th className="px-4 py-3 text-right font-bold">المركبة</th>
                  <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                  <th className="px-4 py-3 text-right font-bold">الربح</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {listed.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-fuchsia-600">{t.tripNumber}</div>
                      <div className="text-[10px] text-slate-400" dir="ltr">{t.date.slice(0, 10)}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{t.fromLoc} ← {t.toLoc}{t.qty > 1 ? ` (×${t.qty})` : ''}</td>
                    <td className="px-4 py-3 text-slate-500">{custName(t.customerId)}</td>
                    <td className="px-4 py-3 text-slate-500" dir="ltr">{vehName(t.vehicleId)}</td>
                    <td className="px-4 py-3 font-bold">{fmt(t.totals.revenueMinor)}</td>
                    <td className={`px-4 py-3 font-black ${t.totals.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(t.totals.profitMinor)}</td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewing(t)} className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><Eye size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'profit' && (
        <div className="anim-up space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((p) => (
              <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-fuchsia-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">إيراد النقلات</div>
              <div className="font-black text-lg">{fmt(profit.totalRevenueMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">مصاريف النقلات</div>
              <div className="font-black text-lg text-rose-500">{fmt(profit.totalCostMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">صافي الربح</div>
              <div className={`font-black text-lg ${profit.totalProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(profit.totalProfitMinor)}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            {profit.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[13px] py-10">لا نقلات في هذه الفترة</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">النقلة</th>
                    <th className="px-4 py-3 text-right font-bold">المسار</th>
                    <th className="px-4 py-3 text-right font-bold">العميل</th>
                    <th className="px-4 py-3 text-right font-bold">الإيراد</th>
                    <th className="px-4 py-3 text-right font-bold">التكلفة</th>
                    <th className="px-4 py-3 text-right font-bold">الربح</th>
                    <th className="px-4 py-3 text-right font-bold">الهامش</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.rows.map((r) => (
                    <tr key={r.tripId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-fuchsia-600">{r.tripNumber}</td>
                      <td className="px-4 py-2">{r.route}{r.qty > 1 ? ` (×${r.qty})` : ''}</td>
                      <td className="px-4 py-2 text-slate-500">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 font-bold">{fmt(r.revenueMinor)}</td>
                      <td className="px-4 py-2 text-rose-500">{fmt(r.costMinor)}</td>
                      <td className={`px-4 py-2 font-black ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.marginPercent}٪</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* تسجيل نقلة */}
      <Modal open={open} onClose={() => setOpen(false)} title="نقلة جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="العميل">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">عميل نقدي</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label="المركبة">
              <select value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} className={inputCls}>
                <option value="">بلا مركبة</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} — {v.vehicleType}</option>)}
              </select>
            </Field>
            <Field label="السائق">
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
                <option value="">بلا سائق</option>
                {employees.filter((e) => e.active).map((d) => <option key={d.id} value={d.id}>{d.nameAr}</option>)}
              </select>
            </Field>
            <Field label="من *">
              <input value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} className={inputCls} placeholder="ميناء الدمام" />
            </Field>
            <Field label="إلى *">
              <input value={toLoc} onChange={(e) => setToLoc(e.target.value)} className={inputCls} placeholder="الرياض" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="عدد النقلات">
                <input value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label={`سعر النقلة (${cur.symbol})`}>
                <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
            </div>
          </div>

          <Field label="أرقام الحاويات (اختياري — افصل بفاصلة)" hint={`بحد أقصى ${qty || 1} رقم = عدد النقلات`}>
            <input value={containers} onChange={(e) => setContainers(e.target.value)} className={inputCls} dir="ltr" placeholder="TCLU1234567, MSKU7654321" />
          </Field>

          {/* المصاريف */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-slate-500">مصاريف النقلة (سولار، كروت، تفويج…)</span>
              <button onClick={addExpense} className="text-[11px] font-bold text-fuchsia-600 hover:underline">+ إضافة مصروف</button>
            </div>
            {expenses.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_60px_80px_1fr_28px] gap-1.5 items-center">
                <input value={e.nameAr} onChange={(ev) => patchExpense(i, { nameAr: ev.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`} placeholder="البيان" />
                <input value={e.qty} onChange={(ev) => patchExpense(i, { qty: ev.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" />
                <input value={e.unitAmount} onChange={(ev) => patchExpense(i, { unitAmount: ev.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" placeholder="القيمة" />
                <select value={e.source} onChange={(ev) => patchExpense(i, { source: ev.target.value as TripExpenseSource })} className={`${inputCls} !py-1.5 !text-[11px]`}>
                  {(Object.keys(EXPENSE_SOURCE_LABELS) as TripExpenseSource[]).map((s) => <option key={s} value={s}>{EXPENSE_SOURCE_LABELS[s]}</option>)}
                </select>
                <button onClick={() => dropExpense(i)} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="التحصيل">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي</button>
                <button onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل (على العميل)</button>
              </div>
            </Field>
            {payment === 'cash' && (
              <Field label="إلى أي خزينة/بنك؟"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></Field>
            )}
            <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer self-end">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪ (تضاف فوق السعر)</span>
              <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="w-4 h-4 accent-fuchsia-600" />
            </label>
          </div>

          {draftTotals && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div><div className="text-slate-400">الإيراد{draftTotals.billableMinor > 0 ? ' (شامل ما على العميل)' : ''}</div><b>{fmt(draftTotals.revenueMinor)}</b></div>
              <div><div className="text-slate-400">يُحصَّل من العميل</div><b>{fmt(draftTotals.grandMinor)}</b></div>
              <div><div className="text-slate-400">التكلفة</div><b className="text-rose-500">{fmt(draftTotals.costMinor)}</b></div>
              <div><div className="text-slate-400">ربح النقلة</div><b className={draftTotals.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(draftTotals.profitMinor)}</b></div>
            </div>
          )}

          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!fromLoc.trim() || !toLoc.trim() || !unitPrice.trim()}>💾 ترحيل النقلة وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض نقلة */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `النقلة ${viewing.tripNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المسار</div><b>{viewing.fromLoc} ← {viewing.toLoc}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">العميل</div><b>{custName(viewing.customerId)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المركبة / السائق</div><b dir="ltr">{vehName(viewing.vehicleId)}</b><div className="text-[10px] text-slate-400">{drvName(viewing.driverId)}</div></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">ربح النقلة</div><b className={viewing.totals.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmt(viewing.totals.profitMinor)}</b></div>
            </div>

            {viewing.containerNumbers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Container size={13} className="text-slate-400" />
                {viewing.containerNumbers.map((c, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-600 dark:text-slate-300" dir="ltr">{c}</span>
                ))}
              </div>
            )}

            {viewing.expenses.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">مصاريف النقلة</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewing.expenses.map((e, i) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 font-bold">{e.nameAr}</td>
                        <td className="px-4 py-1.5 text-slate-400">{e.qty} × {fmt(e.unitAmountMinor)}</td>
                        <td className="px-4 py-1.5 text-slate-500 text-[11px]">{EXPENSE_SOURCE_LABELS[e.source]}</td>
                        <td className="px-4 py-1.5 font-bold text-left">{fmt(e.amountMinor)}</td>
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
