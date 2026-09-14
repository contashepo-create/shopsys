/**
 * عقود إيجار المعدات (المرحلة 6 — القرار 13):
 * فتح عقد (أيام × سعر يومي + تأمين مسترد + ضريبة فوق السعر) بقيد فتح
 * متوازن (4104/2102/2103)، وإقفال بردّ التأمين مع خصم أضرار اختياري
 * يُعترف به إيراداً. تقرير بالفترات + التأمينات المحتجزة.
 */
import { useMemo, useState } from 'react'
import { Plus, FileSpreadsheet, Eye, BookOpenText, LockKeyhole, TrendingUp } from 'lucide-react'
import { useDataStore, type RentalContract } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeRentalTotals, rentalReport } from '../../core/rental.ts'
import { periodPresets, type Period } from '../../core/reports.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function RentalContractsPage() {
  const { rentalContracts, equipment, customers, journal, openRental, closeRental } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const custName = (id: number | null) => (id == null ? 'عميل نقدي' : customers.find((c) => c.id === id)?.nameAr ?? '—')

  const [tab, setTab] = useState<'list' | 'report'>('list')

  /* ─── فتح عقد ─── */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [equipmentName, setEquipmentName] = useState('')
  const [days, setDays] = useState('1')
  const [dailyRate, setDailyRate] = useState('')
  const [deposit, setDeposit] = useState('')
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [withVat, setWithVat] = useState(false)
  const [notes, setNotes] = useState('')

  const openNew = () => {
    setCustomerId(''); setEquipmentId(''); setEquipmentName(''); setDays('1')
    setDailyRate(''); setDeposit(''); setPayment('cash'); setWithVat(false); setNotes(''); setOpen(true)
  }
  const pickEquipment = (v: string) => {
    setEquipmentId(v)
    const eq = equipment.find((x) => x.id === Number(v))
    if (eq) {
      setEquipmentName(eq.nameAr)
      if (eq.dailyRateMinor > 0) setDailyRate(formatMinor(eq.dailyRateMinor, cur, false).replace(/,/g, ''))
    }
  }
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)
  const draftInput = useMemo(() => ({
    equipmentName,
    days: Number(days) || 0,
    dailyRateMinor: toM(dailyRate),
    depositMinor: toM(deposit),
    payment,
    vatPercent: withVat ? setup.vatPercent : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [equipmentName, days, dailyRate, deposit, payment, withVat, setup.vatPercent, cur.decimals])
  const draftTotals = useMemo(() => {
    try { return computeRentalTotals(draftInput) } catch { return null }
  }, [draftInput])

  const save = () => {
    try {
      const c = openRental({
        customerId: customerId ? Number(customerId) : null,
        equipmentId: equipmentId ? Number(equipmentId) : null,
        input: draftInput,
        notes: notes.trim(),
      })
      toast.show(`فُتح العقد ${c.contractNumber} — يُقبض الآن ${fmt(c.totals.collectCashMinor)} ${cur.symbol} ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── إقفال عقد ─── */
  const [closing, setClosing] = useState<RentalContract | null>(null)
  const [deduct, setDeduct] = useState('')
  const doClose = () => {
    if (!closing) return
    try {
      const c = closeRental(closing.id, toM(deduct))
      const refund = c.totals.depositMinor - c.deductMinor
      toast.show(`أُقفل العقد ${c.contractNumber}${c.totals.depositMinor > 0 ? ` — يُرَدّ للعميل ${fmt(refund)} ${cur.symbol}` : ''} ✅`)
      setClosing(null); setDeduct('')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض عقد ─── */
  const [viewing, setViewing] = useState<RentalContract | null>(null)
  const viewEntries = viewing
    ? journal.filter((e) => e.id === viewing.openEntryId || e.id === viewing.closeEntryId)
    : []

  /* ─── تقرير ─── */
  const presets = useMemo(() => periodPresets(new Date().toISOString()), [])
  const [presetId, setPresetId] = useState('month')
  const period: Period = presets.find((p) => p.id === presetId)?.period ?? presets[2].period
  const report = useMemo(() => rentalReport(rentalContracts, period), [rentalContracts, period])

  const listed = useMemo(() => [...rentalContracts].reverse(), [rentalContracts])
  const tabCls = (t: 'list' | 'report') =>
    `px-4 py-2 rounded-xl text-[13px] font-bold transition-all ${tab === t ? 'bg-teal-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('list')} className={tabCls('list')}><FileSpreadsheet size={14} className="inline -mt-0.5 me-1" /> العقود ({rentalContracts.length})</button>
          <button onClick={() => setTab('report')} className={tabCls('report')}><TrendingUp size={14} className="inline -mt-0.5 me-1" /> تقرير الإيجارات</button>
        </div>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> عقد جديد</span></Btn>
      </div>

      {tab === 'list' && (
        listed.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🚜" title="لا عقود بعد" sub="كل عقد يُفتح بقيد متوازن: إيراد إيجار / ضريبة / تأمين كالتزام يُردّ عند الإقفال" />
          </div>
        ) : (
          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 text-right font-bold">العقد</th>
                  <th className="px-4 py-3 text-right font-bold">المعدة</th>
                  <th className="px-4 py-3 text-right font-bold">العميل</th>
                  <th className="px-4 py-3 text-right font-bold">المدة</th>
                  <th className="px-4 py-3 text-right font-bold">الإيجار</th>
                  <th className="px-4 py-3 text-right font-bold">التأمين</th>
                  <th className="px-4 py-3 text-right font-bold">الحالة</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {listed.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-teal-600">{c.contractNumber}</div>
                      <div className="text-[10px] text-slate-400" dir="ltr">{c.date.slice(0, 10)}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{c.equipmentName}</td>
                    <td className="px-4 py-3 text-slate-500">{custName(c.customerId)}</td>
                    <td className="px-4 py-3 text-slate-500">{c.days} يوم</td>
                    <td className="px-4 py-3 font-bold">{fmt(c.totals.rentMinor)}</td>
                    <td className="px-4 py-3 text-slate-500">{c.totals.depositMinor > 0 ? fmt(c.totals.depositMinor) : '—'}</td>
                    <td className="px-4 py-3">
                      {c.status === 'active'
                        ? <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 text-[11px] font-bold">نشط</span>
                        : <span className="px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-500 text-[11px] font-bold">مُقفل</span>}
                    </td>
                    <td className="px-4 py-3 text-left whitespace-nowrap">
                      <button onClick={() => setViewing(c)} className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><Eye size={15} /></button>
                      {c.status === 'active' && (
                        <button onClick={() => { setClosing(c); setDeduct('') }} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200 hover:scale-110" title="إقفال وردّ التأمين"><LockKeyhole size={15} /></button>
                      )}
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
              <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${presetId === p.id ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{p.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">إيراد الإيجار</div>
              <div className="font-black text-lg">{fmt(report.totalRentMinor)}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">عقود نشطة</div>
              <div className="font-black text-lg text-emerald-600">{report.activeCount}</div>
            </div>
            <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
              <div className="text-[10px] text-slate-400 font-bold">تأمينات محتجزة (التزام)</div>
              <div className="font-black text-lg text-amber-600">{fmt(report.heldDepositsMinor)}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            {report.rows.length === 0 ? (
              <div className="text-center text-slate-400 text-[13px] py-10">لا عقود في هذه الفترة</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-3 text-right font-bold">العقد</th>
                    <th className="px-4 py-3 text-right font-bold">المعدة</th>
                    <th className="px-4 py-3 text-right font-bold">العميل</th>
                    <th className="px-4 py-3 text-right font-bold">المدة</th>
                    <th className="px-4 py-3 text-right font-bold">الإيجار</th>
                    <th className="px-4 py-3 text-right font-bold">التأمين</th>
                    <th className="px-4 py-3 text-right font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.contractId} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-2 font-bold text-teal-600">{r.contractNumber}</td>
                      <td className="px-4 py-2">{r.equipmentName}</td>
                      <td className="px-4 py-2 text-slate-500">{custName(r.customerId)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.days} يوم</td>
                      <td className="px-4 py-2 font-bold">{fmt(r.rentMinor)}</td>
                      <td className="px-4 py-2 text-slate-500">{r.depositMinor > 0 ? fmt(r.depositMinor) : '—'}</td>
                      <td className="px-4 py-2">{r.status === 'active' ? 'نشط' : 'مُقفل'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* فتح عقد */}
      <Modal open={open} onClose={() => setOpen(false)} title="عقد إيجار جديد" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="العميل">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">عميل نقدي</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label="المعدة من السجل" hint="اختيارها يملأ الاسم والسعر اليومي تلقائياً">
              <select value={equipmentId} onChange={(e) => pickEquipment(e.target.value)} className={inputCls}>
                <option value="">— اكتب الاسم يدوياً —</option>
                {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.nameAr}{eq.code ? ` (${eq.code})` : ''}</option>)}
              </select>
            </Field>
            <Field label="اسم المعدة *">
              <input value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)} className={inputCls} placeholder="حفار كاتربيلر 320" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="الأيام">
                <input value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label={`السعر اليومي (${cur.symbol})`}>
                <input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
              </Field>
            </div>
            <Field label={`التأمين المسترد (${cur.symbol})`} hint="يُقبض نقداً ويُردّ عند الإقفال — لا يدخل الإيراد">
              <input value={deposit} onChange={(e) => setDeposit(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label="سداد الإيجار">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setPayment('cash')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>نقدي</button>
                <button onClick={() => setPayment('credit')} className={`p-2 rounded-lg border-2 text-[12px] font-bold transition-all ${payment === 'credit' ? 'border-amber-500/60 bg-amber-500/10 text-amber-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>آجل (على العميل)</button>
              </div>
            </Field>
          </div>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
            <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪ (تضاف فوق قيمة الإيجار)</span>
            <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} className="w-4 h-4 accent-teal-600" />
          </label>

          {draftTotals && (
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div><div className="text-slate-400">قيمة الإيجار</div><b>{fmt(draftTotals.rentMinor)}</b></div>
              <div><div className="text-slate-400">الضريبة</div><b>{fmt(draftTotals.vatMinor)}</b></div>
              <div><div className="text-slate-400">التأمين</div><b className="text-amber-600">{fmt(draftTotals.depositMinor)}</b></div>
              <div><div className="text-slate-400">يُقبض نقداً الآن</div><b className="text-emerald-600">{fmt(draftTotals.collectCashMinor)}</b></div>
            </div>
          )}

          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!equipmentName.trim() || !dailyRate.trim()}>💾 فتح العقد وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* إقفال عقد */}
      <Modal open={!!closing} onClose={() => setClosing(null)} title={closing ? `إقفال العقد ${closing.contractNumber}` : ''}>
        {closing && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12.5px] flex items-center justify-between">
              <span className="text-slate-500">التأمين المحصَّل</span>
              <b className="text-amber-600">{fmt(closing.totals.depositMinor)} {cur.symbol}</b>
            </div>
            {closing.totals.depositMinor > 0 ? (
              <>
                <Field label={`الخصم من التأمين (${cur.symbol})`} hint="أضرار أو غرامة — يُعترف به إيراد إيجار، والباقي يُردّ نقداً">
                  <input value={deduct} onChange={(e) => setDeduct(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
                </Field>
                <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 text-[12.5px] flex items-center justify-between">
                  <span className="text-slate-500">يُردّ للعميل نقداً</span>
                  <b className="text-emerald-600">{fmt(Math.max(0, closing.totals.depositMinor - (deduct.trim() ? toMinor(deduct, cur.decimals) : 0)))} {cur.symbol}</b>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-slate-400">لا تأمين على هذا العقد — سيُقفل بلا قيد إضافي.</p>
            )}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setClosing(null)}>إلغاء</Btn>
              <Btn onClick={doClose}>🔒 إقفال العقد</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* عرض عقد */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `العقد ${viewing.contractNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المعدة</div><b>{viewing.equipmentName}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">العميل</div><b>{custName(viewing.customerId)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">المدة × اليومي</div><b>{viewing.days} × {fmt(viewing.dailyRateMinor)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">الحالة</div><b>{viewing.status === 'active' ? 'نشط' : `مُقفل${viewing.deductMinor > 0 ? ` (خصم ${fmt(viewing.deductMinor)})` : ''}`}</b></div>
            </div>

            {viewEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> قيد #{entry.entryNumber} — {entry.description}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
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
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
