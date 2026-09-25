import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * ورديات الكاشير (استكمال المرحلة 2) —
 * فتح برصيد درج افتتاحي، وإقفال بعدّ النقدية الفعلية:
 * المتوقع = الافتتاحي + المحصل نقداً في الدرج (كامل النقدي + الجزء المدفوع من المجزأ)
 * − المرتجعات النقدية. المحصل على بنوك/محافظ يُعرض منفصلاً ولا يدخل عدّ الدرج.
 * والفارق يظهر عجزاً أو زيادة، ويُسوَّى كمصروف/إيراد أو سلفة على الموظف (طلب المالك).
 */
import { useMemo, useState } from 'react'
import { CalendarClock, LockOpen, Lock, Banknote, Landmark, TrendingUp, RotateCcw, AlertTriangle, CheckCircle2, Scale } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { summarizeShift, currentOpenShift, type Shift } from '../../core/shifts.ts'
import { returnCashRefundMinor } from '../../core/returns.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Banknote; tone: string }) {
  return (
    <div className={`rounded-2xl p-4 border ${tone}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold opacity-70"><Icon size={13} /> {label}</div>
      <div className="font-black text-lg mt-1">{value}</div>
    </div>
  )
}

export function ShiftsPage() {
  const { shifts, sales, saleReturns, treasuries, employees, openShift, closeShift, settleShiftVariance, appUsers, currentUserId } = useDataStore()
  // تسوية فرق الدرج تحرك نقدية وتحمل موظفين سلفاً — خلف اعتماد المشرف
  const settleApproval = useSupervisorApproval('trs.payment.approve')
  const closeApproval = useSupervisorApproval('trs.payment.approve')
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [openModal, setOpenModal] = useState(false)
  const [openingCash, setOpeningCash] = useState('')
  const [closeModal, setCloseModal] = useState(false)
  const [countedCash, setCountedCash] = useState('')
  // تسوية فرق الوردية (طلب المالك)
  const [settleShift, setSettleShift] = useState<Shift | null>(null)
  const [settleMode, setSettleMode] = useState<'expense' | 'advance'>('expense')
  const [settleEmployeeId, setSettleEmployeeId] = useState(0)

  const open = currentOpenShift(shifts)

  // الدفع المجزأ + وجهة التحصيل (طلب المالك): المحصل على بنك لا يدخل عدّ الدرج
  const kindOf = (code?: string) => treasuries.find((t) => t.code === (code ?? '1101'))?.kind ?? 'cash'
  const saleDocs = useMemo(
    () => sales.map((s) => ({ shiftId: s.shiftId, payment: s.payment, totalMinor: s.totals.totalMinor, paidMinor: s.paidMinor, treasuryKind: kindOf(s.treasury) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, treasuries],
  )
  const returnDocs = useMemo(
    // المرتجع يُرد من نفس خزينة فاتورته الأصلية — بنكيّ الأصل لا يمس الدرج
    // الرد الهجين (R1): النقدية الخارجة فعلاً فقط — لا كامل قيمة المرتجع
    () => saleReturns.map((r) => ({ shiftId: r.shiftId, payment: 'cash' as const, totalMinor: returnCashRefundMinor(r), treasuryKind: kindOf(r.treasury ?? sales.find((s) => s.id === r.saleId)?.treasury) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saleReturns, sales, treasuries],
  )

  const openSummary = open ? summarizeShift(open, saleDocs, returnDocs) : null

  const doOpen = () => {
    try {
      const activeName = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? (setup.ownerName || 'المالك')
      const s = openShift(activeName, toMinor(openingCash || '0', cur.decimals))
      toast.show(`فُتحت الوردية #${s.id} — كل فاتورة من الآن تُحسب عليها ✓`)
      setOpenModal(false)
      setOpeningCash('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const finishCloseShift = (approvedBy?: string) => {
    try {
      if (!openSummary) return
      const counted = toMinor(countedCash || '0', cur.decimals)
      const projectedVariance = counted - openSummary.expectedCashMinor
      const approvalNote = projectedVariance === 0 ? null : (projectedVariance < 0 ? `اعتماد عجز ${fmt(-projectedVariance)}` : `اعتماد زيادة ${fmt(projectedVariance)}`)
      const closerName = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? (setup.ownerName || 'المالك')
      const s = closeShift(counted, projectedVariance === 0 ? null : (approvedBy ?? closerName), approvalNote)
      const sum = summarizeShift(s, saleDocs, returnDocs)
      const v = sum.varianceMinor ?? 0
      toast.show(v === 0 ? `أُقفلت الوردية — الدرج مضبوط تماماً ✓` : v < 0 ? `أُقفلت الوردية باعتماد مشرف — عجز ${fmt(-v)}` : `أُقفلت الوردية باعتماد مشرف — زيادة ${fmt(v)}`, v < 0 ? 'error' : 'success')
      setCloseModal(false)
      setCountedCash('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const doClose = () => {
    if (!openSummary) return
    let counted = 0
    try { counted = toMinor(countedCash || '0', cur.decimals) }
    catch (e) { toast.show((e as Error).message, 'error'); return }
    const projectedVariance = counted - openSummary.expectedCashMinor
    if (projectedVariance === 0) finishCloseShift()
    else closeApproval.request((approvedBy) => finishCloseShift(approvedBy))
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
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <StatCard label="رصيد افتتاحي" value={fmt(open.openingCashMinor)} icon={Banknote} tone="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200" />
            <StatCard label={`محصل نقداً (${openSummary.invoiceCount} فاتورة)`} value={fmt(openSummary.cashSalesMinor)} icon={TrendingUp} tone="border-emerald-500/30 text-emerald-700 dark:text-emerald-300" />
            <StatCard label="محصل على بنوك" value={fmt(openSummary.bankSalesMinor)} icon={Landmark} tone="border-cyan-500/30 text-cyan-700 dark:text-cyan-300" />
            <StatCard label="آجل (غير محصل)" value={fmt(openSummary.creditSalesMinor)} icon={CalendarClock} tone="border-violet-500/30 text-violet-700 dark:text-violet-300" />
            <StatCard label="مرتجعات نقدية" value={openSummary.cashRefundsMinor ? `-${fmt(openSummary.cashRefundsMinor)}` : fmt(0)} icon={RotateCcw} tone="border-rose-500/30 text-rose-600 dark:text-rose-400" />
            <StatCard label="المتوقع في الدرج" value={fmt(openSummary.expectedCashMinor)} icon={Banknote} tone="border-sky-500/40 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-[11px] text-slate-400">
            💡 الدفع المجزأ يقسم الفاتورة: المحصل وقتها «نقدي/بنكي» والباقي فقط «آجل». المحصل على البنوك لا يدخل عدّ الدرج.
          </p>
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
                <th className="px-4 py-3 font-bold">محصل درج</th>
                <th className="px-4 py-3 font-bold">بنوك</th>
                <th className="px-4 py-3 font-bold">آجل</th>
                <th className="px-4 py-3 font-bold">المتوقع</th>
                <th className="px-4 py-3 font-bold">المعدود</th>
                <th className="px-4 py-3 font-bold">الفارق</th>
                <th className="px-4 py-3 font-bold"></th>
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
                      <div className="text-[11px] text-slate-400">{sum.invoiceCount} فاتورة · {sum.returnCount} مرتجع{ s.closeApprovedBy ? ` · اعتماد: ${s.closeApprovedBy}` : ''}</div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      {s.openedAt.slice(5, 16).replace('T', ' ')} ← {s.closedAt?.slice(5, 16).replace('T', ' ')}
                    </td>
                    <td className="px-4 py-3 font-bold text-emerald-600">{fmt(sum.cashSalesMinor)}</td>
                    <td className="px-4 py-3 font-bold text-sky-600">{fmt(sum.bankSalesMinor)}</td>
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
                    <td className="px-4 py-3 text-left">
                      {v !== 0 && !s.varianceSettledMode && (
                        <button
                          title="تسوية الفرق: مصروف/إيراد أو سلفة على الموظف"
                          onClick={() => { setSettleShift(s); setSettleMode('expense'); setSettleEmployeeId(0) }}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-600 font-bold hover:bg-brand-500/20 transition-colors flex items-center gap-1"
                        >
                          <Scale size={11} /> تسوية
                        </button>
                      )}
                      {s.varianceSettledMode && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-bold" title={`قيد التسوية #${s.varianceEntryId}`}>
                          {s.varianceSettledMode === 'expense' ? (v < 0 ? '✓ سُوّي مصروفاً' : '✓ سُوّي إيراداً') : '✓ سلفة على الموظف'}
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
            <Btn onClick={doOpen} shortcut="F9">🔓 فتح الوردية</Btn>
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
          <Field label={`النقدية المعدودة فعلياً (${cur.symbol})`} hint="إذا ظهر عجز أو زيادة فلن تُقفل الوردية إلا باعتماد مشرف/مالك، ثم تُسوّى كإجراء مستقل.">
            <input value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0" className={inputCls} autoFocus dir="ltr" />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setCloseModal(false)}>إلغاء</Btn>
            <Btn onClick={doClose} shortcut="F9">🔒 إقفال الوردية</Btn>
          </div>
        </div>
      </Modal>

      {/* تسوية فرق الوردية (طلب المالك): مصروف/إيراد أو سلفة على الموظف تُخصم من رواتبه */}
      <Modal open={!!settleShift} onClose={() => setSettleShift(null)} title={settleShift ? `⚖️ تسوية فرق وردية #${settleShift.id}` : ''}>
        {settleShift && (() => {
          const sum = summarizeShift(settleShift, saleDocs, returnDocs)
          const v = sum.varianceMinor ?? 0
          return (
            <div className="space-y-4">
              <div className={`text-center p-4 rounded-2xl border ${v < 0 ? 'bg-rose-500/5 border-rose-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
                <div className="text-[12px] text-slate-400">{v < 0 ? 'عجز في الدرج' : 'زيادة في الدرج'}</div>
                <div className={`font-black text-2xl mt-1 ${v < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{fmt(Math.abs(v))} {cur.symbol}</div>
                <div className="text-[11px] text-slate-400 mt-1">متوقع {fmt(sum.expectedCashMinor)} — معدود {fmt(settleShift.countedCashMinor ?? 0)}</div>
              </div>

              <Field label="طريقة التسوية">
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => setSettleMode('expense')}
                    className={`text-right p-3 rounded-xl border-2 transition-all ${settleMode === 'expense' ? 'border-brand-500/60 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <div className="font-bold text-[13px] text-slate-700 dark:text-slate-200">{v < 0 ? '🧾 تسجيل العجز كمصروف على المحل' : '🧾 تسجيل الزيادة كإيراد آخر'}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {v < 0 ? 'قيد: مصروفات عمومية / الخزينة — يتحمله المحل ولا يُطالب به أحد' : 'قيد: الخزينة / إيرادات أخرى — فائض عدّ يدخل أرباح المحل'}
                    </div>
                  </button>
                  {v < 0 && (
                    <button
                      onClick={() => setSettleMode('advance')}
                      className={`text-right p-3 rounded-xl border-2 transition-all ${settleMode === 'advance' ? 'border-brand-500/60 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}
                    >
                      <div className="font-bold text-[13px] text-slate-700 dark:text-slate-200">👤 تحميل العجز سلفة على الموظف</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        قيد: سلف موظفين / الخزينة — تظهر في مسير الرواتب وتُخصم على شهور كأي سلفة
                      </div>
                    </button>
                  )}
                </div>
              </Field>

              {settleMode === 'advance' && v < 0 && (
                <Field label="الموظف الذي يتحمل العجز *">
                  <QuickSelect value={settleEmployeeId} onChange={(e) => setSettleEmployeeId(Number(e.target.value))} className={inputCls}>
                    <option value={0}>— اختر الموظف —</option>
                    {employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.nameAr}{e.jobTitle ? ` — ${e.jobTitle}` : ''}</option>)}
                  </QuickSelect>
                </Field>
              )}

              <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={() => setSettleShift(null)}>إلغاء</Btn>
                <Btn
                  disabled={settleMode === 'advance' && !settleEmployeeId}
                  onClick={() => settleApproval.request(() => {
                    try {
                      settleShiftVariance({ shiftId: settleShift.id, mode: settleMode, employeeId: settleEmployeeId || null })
                      toast.show(settleMode === 'advance' ? 'حُمّل العجز سلفة على الموظف — ستظهر في مسير الرواتب ✓' : 'سُوّي فرق الوردية وتولد قيده تلقائياً ✓')
                      setSettleShift(null)
                    } catch (err) { toast.show((err as Error).message, 'error') }
                  })}
                shortcut="F9">
                  ⚖️ تنفيذ التسوية
                </Btn>
              </div>
            </div>
          )
        })()}
      </Modal>
      {settleApproval.dialog}
      {closeApproval.dialog}
    </div>
  )
}
