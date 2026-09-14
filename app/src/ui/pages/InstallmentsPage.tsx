/**
 * الأقساط (المرحلة 5) — خطط أقساط للعملاء بتنبيهات استحقاق:
 * شريط تنبيهات (متأخر / يستحق خلال 7 أيام)، إنشاء خطة بجدول تلقائي
 * «أكبر البواقي»، سداد يتوزع على الأقدم أولاً بقيد تحصيل متوازن (خزينة ← عملاء).
 */
import { useMemo, useState } from 'react'
import { Plus, CalendarClock, AlarmClock, Eye, Landmark, HandCoins, BookOpenText, CheckCircle2 } from 'lucide-react'
import { useDataStore, type InstallmentPlan } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { buildSchedule, planProgress, installmentStatus, collectAlerts, type InstallmentItem } from '../../core/installments.ts'
import type { TreasuryAccount } from '../../core/accounting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: 'مدفوع', cls: 'text-emerald-600 bg-emerald-500/10' },
  partial: { label: 'جزئي', cls: 'text-sky-600 bg-sky-500/10' },
  due_today: { label: 'يستحق اليوم', cls: 'text-amber-600 bg-amber-500/10' },
  overdue: { label: 'متأخر', cls: 'text-rose-600 bg-rose-500/10' },
  upcoming: { label: 'قادم', cls: 'text-slate-500 bg-slate-500/10' },
}

export function InstallmentsPage() {
  const { installmentPlans, customers, journal, createInstallmentPlan, payInstallment } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const today = new Date().toISOString().slice(0, 10)

  const custName = (id: number) => customers.find((c) => c.id === id)?.nameAr ?? `عميل #${id}`

  /* تنبيهات الاستحقاق */
  const alerts = useMemo(() => collectAlerts(installmentPlans, today), [installmentPlans, today])
  const overdueAlerts = alerts.filter((a) => a.kind === 'overdue')
  const soonAlerts = alerts.filter((a) => a.kind === 'due_soon')

  /* إنشاء خطة */
  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [total, setTotal] = useState('')
  const [down, setDown] = useState('')
  const [count, setCount] = useState('6')
  const [interval, setInterval_] = useState('1')
  const [firstDue, setFirstDue] = useState('')
  const [treasury, setTreasury] = useState<TreasuryAccount>('1101')
  const [notes, setNotes] = useState('')

  const openNew = () => {
    if (customers.length === 0) return toast.show('أضف عميلاً أولاً من شاشة العملاء', 'error')
    setCustomerId(''); setTotal(''); setDown(''); setCount('6'); setInterval_('1')
    const d = new Date(); d.setMonth(d.getMonth() + 1)
    setFirstDue(d.toISOString().slice(0, 10))
    setTreasury('1101'); setNotes(''); setOpen(true)
  }

  /* معاينة الجدول قبل الحفظ */
  const preview: InstallmentItem[] | null = useMemo(() => {
    try {
      if (!total.trim() || !firstDue) return null
      return buildSchedule({
        totalMinor: toMinor(total, cur.decimals),
        downPaymentMinor: down.trim() ? toMinor(down, cur.decimals) : 0,
        count: Number(count) || 0,
        intervalMonths: Number(interval) || 0,
        firstDueDate: firstDue,
      })
    } catch { return null }
  }, [total, down, count, interval, firstDue, cur.decimals])

  const save = () => {
    try {
      const plan = createInstallmentPlan({
        customerId: Number(customerId),
        saleId: null,
        totalMinor: toMinor(total, cur.decimals),
        downPaymentMinor: down.trim() ? toMinor(down, cur.decimals) : 0,
        count: Number(count),
        intervalMonths: Number(interval),
        firstDueDate: firstDue,
        treasury,
        notes: notes.trim(),
      })
      toast.show(`أُنشئت الخطة ${plan.planNumber} — ${plan.items.length} قسطاً ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* عرض خطة وسدادها */
  const [viewing, setViewing] = useState<InstallmentPlan | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payTreasury, setPayTreasury] = useState<TreasuryAccount>('1101')
  // اقرأ النسخة الحية من المخزن (بعد السداد يتغير المرجع)
  const livePlan = viewing ? installmentPlans.find((p) => p.id === viewing.id) ?? null : null
  const liveProgress = livePlan ? planProgress(livePlan.items, today) : null
  const planEntries = livePlan
    ? journal.filter((e) => e.sourceId === livePlan.id && e.sourceType === 'receipt_voucher' && e.description.includes(livePlan.planNumber))
    : []

  const pay = () => {
    if (!livePlan) return
    try {
      const amount = toMinor(payAmount, cur.decimals)
      payInstallment(livePlan.id, amount, payTreasury)
      toast.show(`حُصِّل ${fmt(amount)} ${cur.symbol} وتولّد قيد التحصيل ✅`)
      setPayAmount('')
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  const listed = useMemo(() => [...installmentPlans].reverse(), [installmentPlans])

  return (
    <div className="space-y-4">
      {/* شريط التنبيهات */}
      {(overdueAlerts.length > 0 || soonAlerts.length > 0) && (
        <div className="anim-up grid grid-cols-1 sm:grid-cols-2 gap-3">
          {overdueAlerts.length > 0 && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-4">
              <div className="flex items-center gap-2 font-extrabold text-rose-600 text-[13px] mb-2">
                <AlarmClock size={16} /> أقساط متأخرة ({overdueAlerts.length})
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {overdueAlerts.slice(0, 6).map((a, i) => {
                  const p = installmentPlans.find((x) => x.id === a.planId)
                  return (
                    <div key={i} className="flex justify-between text-[12px]">
                      <span className="text-slate-600 dark:text-slate-300">{p ? custName(p.customerId) : ''} — قسط {a.seq} (متأخر {-a.daysDiff} يوم)</span>
                      <b className="text-rose-600">{fmt(a.amountDueMinor)}</b>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {soonAlerts.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <div className="flex items-center gap-2 font-extrabold text-amber-600 text-[13px] mb-2">
                <CalendarClock size={16} /> تستحق خلال 7 أيام ({soonAlerts.length})
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {soonAlerts.slice(0, 6).map((a, i) => {
                  const p = installmentPlans.find((x) => x.id === a.planId)
                  return (
                    <div key={i} className="flex justify-between text-[12px]">
                      <span className="text-slate-600 dark:text-slate-300">{p ? custName(p.customerId) : ''} — قسط {a.seq} ({a.daysDiff === 0 ? 'اليوم' : `بعد ${a.daysDiff} يوم`})</span>
                      <b className="text-amber-600">{fmt(a.amountDueMinor)}</b>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="anim-up flex justify-end">
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> خطة أقساط جديدة</span></Btn>
      </div>

      {listed.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📅" title="لا خطط أقساط بعد" sub="أنشئ خطة لعميل آجل — الجدول يتولّد تلقائياً وكل سداد يقيَّد: خزينة ← عملاء" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 text-right font-bold">الخطة</th>
                <th className="px-4 py-3 text-right font-bold">العميل</th>
                <th className="px-4 py-3 text-right font-bold">الأقساط</th>
                <th className="px-4 py-3 text-right font-bold">المتبقي</th>
                <th className="px-4 py-3 text-right font-bold">القسط القادم</th>
                <th className="px-4 py-3 text-right font-bold">الحالة</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {listed.map((p) => {
                const pr = planProgress(p.items, today)
                return (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-bold text-brand-600">{p.planNumber}</td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{custName(p.customerId)}</td>
                    <td className="px-4 py-3 text-slate-500">{pr.paidCount} / {pr.totalCount}</td>
                    <td className="px-4 py-3 font-black">{fmt(pr.remainingMinor)} {cur.symbol}</td>
                    <td className="px-4 py-3 text-slate-500" dir="ltr">{pr.nextDue?.dueDate ?? '—'}</td>
                    <td className="px-4 py-3">
                      {pr.finished
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} /> مكتملة</span>
                        : pr.overdueMinor > 0
                          ? <span className="text-[11px] font-bold text-rose-600 bg-rose-500/10 px-2 py-0.5 rounded-full">متأخر {fmt(pr.overdueMinor)}</span>
                          : <span className="text-[11px] font-bold text-sky-600 bg-sky-500/10 px-2 py-0.5 rounded-full">منتظمة</span>}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => { setViewing(p); setPayAmount(''); }} className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110"><Eye size={15} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* إنشاء خطة */}
      <Modal open={open} onClose={() => setOpen(false)} title="خطة أقساط جديدة" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="العميل *">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
                <option value="">اختر…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </Field>
            <Field label={`إجمالي المديونية (${cur.symbol}) *`} hint="أصل الذمة قائم من الفاتورة الآجلة — الخطة جدولة تحصيل">
              <input value={total} onChange={(e) => setTotal(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`المقدم (${cur.symbol})`} hint="يُحصَّل فوراً بقيد: خزينة ← عملاء">
              <input value={down} onChange={(e) => setDown(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label="عدد الأقساط *">
              <input value={count} onChange={(e) => setCount(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="الفاصل بين الأقساط (أشهر)">
              <input value={interval} onChange={(e) => setInterval_(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="تاريخ أول قسط *">
              <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
          </div>

          {Number(down.trim() ? toMinor(down, cur.decimals) : 0) > 0 && (
            <Field label="تحصيل المقدم في">
              <div className="grid grid-cols-2 gap-1.5">
                {(['1101', '1102'] as TreasuryAccount[]).map((t) => (
                  <button key={t} onClick={() => setTreasury(t)} className={`p-2 rounded-lg border-2 text-[11px] font-bold transition-all ${treasury === t ? 'border-brand-500/60 bg-brand-500/10 text-brand-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                    <Landmark size={12} className="inline -mt-0.5 me-1" />{ACCOUNT_NAMES[t]}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {preview && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2 text-[11px] font-bold text-slate-400 border-b border-slate-100 dark:border-slate-800">
                معاينة الجدول — {preview.length} قسطاً، مجموعها {fmt(preview.reduce((a, i) => a + i.amountMinor, 0))} {cur.symbol}
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <tbody>
                    {preview.map((it) => (
                      <tr key={it.seq} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-4 py-1.5 text-slate-500">قسط {it.seq}</td>
                        <td className="px-4 py-1.5 text-slate-500" dir="ltr">{it.dueDate}</td>
                        <td className="px-4 py-1.5 font-bold text-left">{fmt(it.amountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!customerId || !preview}>💾 إنشاء الخطة</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض خطة وسدادها */}
      <Modal open={!!livePlan} onClose={() => setViewing(null)} title={livePlan ? `الخطة ${livePlan.planNumber} — ${custName(livePlan.customerId)}` : ''} wide>
        {livePlan && liveProgress && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[10px] text-slate-400 font-bold">المحصَّل</div>
                <div className="font-black text-emerald-600">{fmt(liveProgress.paidMinor + livePlan.downPaymentMinor)}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[10px] text-slate-400 font-bold">المتبقي</div>
                <div className="font-black">{fmt(liveProgress.remainingMinor)}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-3">
                <div className="text-[10px] text-slate-400 font-bold">المتأخر</div>
                <div className={`font-black ${liveProgress.overdueMinor > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fmt(liveProgress.overdueMinor)}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="max-h-52 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <tbody>
                    {livePlan.items.map((it) => {
                      const st = installmentStatus(it, today)
                      const badge = STATUS_BADGE[st]
                      return (
                        <tr key={it.seq} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-4 py-2 text-slate-500">قسط {it.seq}</td>
                          <td className="px-4 py-2 text-slate-500" dir="ltr">{it.dueDate}</td>
                          <td className="px-4 py-2 font-bold">{fmt(it.amountMinor)}</td>
                          <td className="px-4 py-2 text-slate-400">{it.paidMinor > 0 ? `سُدد ${fmt(it.paidMinor)}` : ''}</td>
                          <td className="px-4 py-2 text-left">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {!liveProgress.finished && (
              <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/[0.04] p-4 space-y-3">
                <div className="flex items-center gap-2 font-extrabold text-emerald-600 text-[13px]"><HandCoins size={16} /> تحصيل دفعة</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputCls} dir="ltr" placeholder={`المبلغ (${cur.symbol})`} />
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['1101', '1102'] as TreasuryAccount[]).map((t) => (
                      <button key={t} onClick={() => setPayTreasury(t)} className={`p-2 rounded-lg border-2 text-[11px] font-bold transition-all ${payTreasury === t ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                        <Landmark size={12} className="inline -mt-0.5 me-1" />{ACCOUNT_NAMES[t]}
                      </button>
                    ))}
                  </div>
                  <Btn onClick={pay} disabled={!payAmount.trim()}>💾 تحصيل وتوليد القيد</Btn>
                </div>
                {liveProgress.nextDue && (
                  <button onClick={() => setPayAmount(String((liveProgress.nextDue!.amountMinor - liveProgress.nextDue!.paidMinor) / 10 ** cur.decimals))} className="text-[11px] text-emerald-600 font-bold hover:underline">
                    ← تعبئة قيمة القسط القادم ({fmt(liveProgress.nextDue.amountMinor - liveProgress.nextDue.paidMinor)})
                  </button>
                )}
              </div>
            )}

            {planEntries.length > 0 && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> قيود التحصيل ({planEntries.length})
                </div>
                <div className="max-h-36 overflow-y-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {planEntries.map((e) => (
                        <tr key={e.id} className="border-t border-rose-500/5">
                          <td className="px-4 py-1.5 text-slate-500">#{e.entryNumber}</td>
                          <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{e.description}</td>
                          <td className="px-4 py-1.5 font-bold text-left">{fmt(e.lines[0]?.debit ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
