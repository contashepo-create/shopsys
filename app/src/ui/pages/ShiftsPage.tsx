/**
 * ورديات الكاشير (استكمال المرحلة 2) —
 * فتح برصيد درج افتتاحي، وإقفال بعدّ النقدية الفعلية:
 * المتوقع = الافتتاحي + مبيعات كاش − مرتجعات كاش، والفارق يظهر عجزاً أو زيادة.
 */
import { useMemo, useState } from 'react'
import { CalendarClock, LockOpen, Lock, Banknote, TrendingUp, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { summarizeShift, currentOpenShift, type Shift } from '../../core/shifts.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Banknote; tone: string }) {
  return (
    <div className={`rounded-2xl p-4 border ${tone}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold opacity-70"><Icon size={13} /> {label}</div>
      <div className="font-black text-lg mt-1">{value}</div>
    </div>
  )
}

export function ShiftsPage() {
  const { shifts, sales, saleReturns, openShift, closeShift } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [openModal, setOpenModal] = useState(false)
  const [openingCash, setOpeningCash] = useState('')
  const [closeModal, setCloseModal] = useState(false)
  const [countedCash, setCountedCash] = useState('')

  const open = currentOpenShift(shifts)

  const saleDocs = useMemo(() => sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor })), [sales])
  const returnDocs = useMemo(() => saleReturns.map((r) => ({ shiftId: r.shiftId, payment: r.refund, totalMinor: r.totals.totalMinor })), [saleReturns])

  const openSummary = open ? summarizeShift(open, saleDocs, returnDocs) : null

  const doOpen = () => {
    try {
      const s = openShift(setup.ownerName || 'المالك', toMinor(openingCash || '0', cur.decimals))
      toast.show(`فُتحت الوردية #${s.id} — كل فاتورة من الآن تُحسب عليها ✓`)
      setOpenModal(false)
      setOpeningCash('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const doClose = () => {
    try {
      const s = closeShift(toMinor(countedCash || '0', cur.decimals))
      const sum = summarizeShift(s, saleDocs, returnDocs)
      const v = sum.varianceMinor ?? 0
      toast.show(v === 0 ? `أُقفلت الوردية — الدرج مضبوط تماماً ✓` : v < 0 ? `أُقفلت الوردية — عجز ${fmt(-v)}!` : `أُقفلت الوردية — زيادة ${fmt(v)}`, v < 0 ? 'error' : 'success')
      setCloseModal(false)
      setCountedCash('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-5">
      {/* الوردية الحالية */}
      {open && openSummary ? (
        <div className="anim-up rounded-3xl border-2 border-emerald-500/30 bg-emerald-500/[0.03] p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl bg-gradient-to-l from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
                <LockOpen size={20} />
              </span>
              <div>
                <div className="font-extrabold text-slate-800 dark:text-white">وردية مفتوحة #{open.id}</div>
                <div className="text-[11px] text-slate-400">فتحها {open.openedBy} · {open.openedAt.slice(0, 16).replace('T', ' ')}</div>
              </div>
            </div>
            <Btn onClick={() => { setCountedCash(''); setCloseModal(true) }}>
              <Lock size={15} /> إقفال الوردية وعدّ الدرج
            </Btn>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard label="رصيد افتتاحي" value={fmt(open.openingCashMinor)} icon={Banknote} tone="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200" />
            <StatCard label={`مبيعات كاش (${openSummary.invoiceCount} فاتورة)`} value={fmt(openSummary.cashSalesMinor)} icon={TrendingUp} tone="border-emerald-500/30 text-emerald-700 dark:text-emerald-300" />
            <StatCard label="مبيعات آجلة" value={fmt(openSummary.creditSalesMinor)} icon={CalendarClock} tone="border-violet-500/30 text-violet-700 dark:text-violet-300" />
            <StatCard label="مرتجعات نقدية" value={openSummary.cashRefundsMinor ? `-${fmt(openSummary.cashRefundsMinor)}` : fmt(0)} icon={RotateCcw} tone="border-rose-500/30 text-rose-600 dark:text-rose-400" />
            <StatCard label="المتوقع في الدرج" value={fmt(openSummary.expectedCashMinor)} icon={Banknote} tone="border-sky-500/40 text-sky-700 dark:text-sky-300" />
          </div>
        </div>
      ) : (
        <div className="anim-up rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark p-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-extrabold text-slate-800 dark:text-white">لا وردية مفتوحة الآن</div>
            <div className="text-[12px] text-slate-400 mt-1">افتح وردية برصيد الدرج الافتتاحي — وستُحسب عليها كل فاتورة ومرتجع حتى الإقفال</div>
          </div>
          <Btn onClick={() => { setOpeningCash(''); setOpenModal(true) }}>
            <LockOpen size={15} /> فتح وردية جديدة
          </Btn>
        </div>
      )}

      {/* سجل الورديات المقفلة */}
      {shifts.filter((s) => s.status === 'closed').length === 0 ? (
        !open && (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="🕐" title="لا ورديات سابقة" sub="سجل الورديات المقفلة سيظهر هنا مع العجز/الزيادة لكل وردية" />
          </div>
        )
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الوردية</th>
                <th className="px-4 py-3 font-bold">الفترة</th>
                <th className="px-4 py-3 font-bold">مبيعات كاش</th>
                <th className="px-4 py-3 font-bold">آجل</th>
                <th className="px-4 py-3 font-bold">المتوقع</th>
                <th className="px-4 py-3 font-bold">المعدود</th>
                <th className="px-4 py-3 font-bold">الفارق</th>
              </tr>
            </thead>
            <tbody>
              {[...shifts].filter((s) => s.status === 'closed').reverse().map((s: Shift, i) => {
                const sum = summarizeShift(s, saleDocs, returnDocs)
                const v = sum.varianceMinor ?? 0
                return (
                  <tr key={s.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-emerald-500/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800 dark:text-white">#{s.id} · {s.openedBy}</div>
                      <div className="text-[11px] text-slate-400">{sum.invoiceCount} فاتورة · {sum.returnCount} مرتجع</div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      {s.openedAt.slice(5, 16).replace('T', ' ')} ← {s.closedAt?.slice(5, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 font-bold text-emerald-600">{fmt(sum.cashSalesMinor)}</td>
                    <td className="px-4 py-3 text-violet-600">{fmt(sum.creditSalesMinor)}</td>
                    <td className="px-4 py-3">{fmt(sum.expectedCashMinor)}</td>
                    <td className="px-4 py-3">{s.countedCashMinor !== null ? fmt(s.countedCashMinor) : '—'}</td>
                    <td className="px-4 py-3">
                      {v === 0 ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1 w-fit"><CheckCircle2 size={11} /> مضبوط</span>
                      ) : (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 w-fit ${v < 0 ? 'bg-rose-500/10 text-rose-600' : 'bg-amber-500/10 text-amber-600'}`}>
                          <AlertTriangle size={11} /> {v < 0 ? `عجز ${fmt(-v)}` : `زيادة ${fmt(v)}`}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* فتح وردية */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="فتح وردية جديدة">
        <div className="space-y-4">
          <Field label={`رصيد الدرج الافتتاحي (${cur.symbol})`} hint="عدّ النقدية الموجودة في الدرج الآن قبل البدء">
            <input value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0" className={inputCls} autoFocus dir="ltr" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpenModal(false)}>إلغاء</Btn>
            <Btn onClick={doOpen}>🔓 فتح الوردية</Btn>
          </div>
        </div>
      </Modal>

      {/* إقفال وردية */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="إقفال الوردية — عدّ الدرج">
        <div className="space-y-4">
          {openSummary && (
            <div className="text-center p-4 rounded-2xl bg-sky-500/5 border border-sky-500/20">
              <div className="text-[12px] text-slate-400">المتوقع في الدرج</div>
              <div className="font-black text-2xl text-sky-600 dark:text-sky-400 mt-1">{fmt(openSummary.expectedCashMinor)} {cur.symbol}</div>
              <div className="text-[11px] text-slate-400 mt-1">افتتاحي {fmt(open?.openingCashMinor ?? 0)} + كاش {fmt(openSummary.cashSalesMinor)} − مرتجعات {fmt(openSummary.cashRefundsMinor)}</div>
            </div>
          )}
          <Field label={`النقدية المعدودة فعلياً (${cur.symbol})`} hint="عدّ ما في الدرج الآن — الفارق سيُسجل عجزاً أو زيادة">
            <input value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0" className={inputCls} autoFocus dir="ltr" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setCloseModal(false)}>إلغاء</Btn>
            <Btn onClick={doClose}>🔒 إقفال الوردية</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
