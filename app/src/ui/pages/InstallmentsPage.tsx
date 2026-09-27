import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الأقساط (المرحلة 5) — خطط أقساط للعملاء بتنبيهات استحقاق:
 * شريط تنبيهات (متأخر / يستحق خلال 7 أيام)، إنشاء خطة بجدول تلقائي
 * «أكبر البواقي»، سداد يتوزع على الأقدم أولاً بقيد تحصيل متوازن (خزينة ← عملاء).
 */
import { useMemo, useState } from 'react'
import { Plus, CalendarClock, AlarmClock, Eye, HandCoins, CheckCircle2 } from 'lucide-react'
import { useDataStore, type InstallmentPlan } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { buildSchedule, planProgress, installmentStatus, collectAlerts, type InstallmentItem } from '../../core/installments.ts'
import type { TreasuryAccount } from '../../core/accounting.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { DocSection, DocOutcome } from '../components/DocSection.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { CreditLimitError } from '../../core/pos.ts'
import { eligiblePaymentTerminals } from '../../core/paymentTerminalEligibility.ts'
import { rowOpenProps } from '../components/rowOpen.ts'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: 'مدفوع', cls: 'text-emerald-600 bg-emerald-500/10' },
  partial: { label: 'جزئي', cls: 'text-sky-600 bg-sky-500/10' },
  due_today: { label: 'يستحق اليوم', cls: 'text-amber-600 bg-amber-500/10' },
  overdue: { label: 'متأخر', cls: 'text-rose-600 bg-rose-500/10' },
  upcoming: { label: 'قادم', cls: 'text-slate-500 bg-slate-500/10' },
}

export function InstallmentsPage() {
  const { installmentPlans, customers, journal, paymentTerminals, appUsers, currentUserId, createInstallmentPlan, payInstallment } = useDataStore()
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
  const [interest, setInterest] = useState('') // هامش التقسيط (الأمر 22) — يُثبت إيراداً 4111
  const [count, setCount] = useState('6')
  const [interval, setInterval_] = useState('1')
  const [firstDue, setFirstDue] = useState('')
  const [treasury, setTreasury] = useState<TreasuryAccount>('1101')
  const [notes, setNotes] = useState('')

  const openNew = () => {
    if (customers.length === 0) return toast.show('أضف عميلاً أولاً من شاشة العملاء', 'error')
    setCustomerId(''); setTotal(''); setDown(''); setInterest(''); setCount('6'); setInterval_('1')
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

  // هامش تقسيط يرفع ذمم عميل تجاوز حده — تجاوز باعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const save = (creditLimitOverrideBy?: string) => {
    try {
      const plan = createInstallmentPlan({
        customerId: Number(customerId),
        saleId: null,
        totalMinor: toMinor(total, cur.decimals),
        downPaymentMinor: down.trim() ? toMinor(down, cur.decimals) : 0,
        interestMinor: interest.trim() ? toMinor(interest, cur.decimals) : 0,
        count: Number(count),
        intervalMonths: Number(interval),
        firstDueDate: firstDue,
        treasury,
        notes: notes.trim(),
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      toast.show(`أُنشئت الخطة ${plan.planNumber} — ${plan.items.length} قسطاً ✅`)
      setOpen(false)
    } catch (err) {
      if (err instanceof CreditLimitError) { creditApproval.request((by) => save(by ?? 'المشرف')); return }
      toast.show((err as Error).message, 'error')
    }
  }

  /* عرض خطة وسدادها */
  const [viewing, setViewing] = useState<InstallmentPlan | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payTreasury, setPayTreasury] = useState<TreasuryAccount>('1101')
  const [terminalId, setTerminalId] = useState('')
  const [terminalReference, setTerminalReference] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const availableTerminals = eligiblePaymentTerminals(paymentTerminals, appUsers.find((user) => user.id === currentUserId), 'charge')
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
      const terminal = availableTerminals.find((row) => row.id === terminalId)
      payInstallment(livePlan.id, amount, (terminal?.settlementAccountCode ?? payTreasury) as TreasuryAccount, terminal ? { terminalId: terminal.id, providerReference: terminalReference.trim(), cardLast4: cardLast4 || undefined } : undefined)
      toast.show(`حُصِّل ${fmt(amount)} ${cur.symbol} وتولّد قيد التحصيل ✅`)
      setPayAmount(''); setTerminalReference(''); setCardLast4('')
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
                  <tr key={p.id} {...rowOpenProps(() => { setViewing(p); setPayAmount('') }, `انقر مرتين لفتح خطة التقسيط ${p.planNumber}`)} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
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
              <PartyQuickPicker parties={customers} value={customerId ? Number(customerId) : 0} onChange={(id) => setCustomerId(id ? String(id) : '')} cashLabel="عميل نقدي" label="بحث العميل" cashValue={0} />
            </Field>
            <Field label={`إجمالي المديونية (${cur.symbol}) *`} hint="أصل الذمة قائم من الفاتورة الآجلة — الخطة جدولة تحصيل">
              <input value={total} onChange={(e) => setTotal(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`المقدم (${cur.symbol})`} hint="يُحصَّل فوراً بقيد: خزينة ← عملاء">
              <input value={down} onChange={(e) => setDown(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`هامش التقسيط (${cur.symbol})`} hint="جزء من الإجمالي يُثبت إيراداً 4111 «أرباح تقسيط» بقيد: عملاء ← أرباح تقسيط">
              <input value={interest} onChange={(e) => setInterest(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
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
              <TreasuryPicker value={treasury} onChange={setTreasury} compact />
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
      <Modal open={!!livePlan} onClose={() => setViewing(null)} title="" extraWide bare>
        {livePlan && liveProgress && (() => {
          const payMinor = (() => { try { return payAmount.trim() ? toMinor(payAmount, cur.decimals) : 0 } catch { return 0 } })()
          const terminal = availableTerminals.find((row) => row.id === terminalId)
          const targetAccount = terminal?.settlementAccountCode ?? payTreasury
          const over = payMinor > liveProgress.remainingMinor
          return (
            <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
              <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><HandCoins size={19} /></span>
                  <div>
                    <h3 className="text-base font-black leading-tight">خطة أقساط — {custName(livePlan.customerId)}</h3>
                    <span className="text-[10.5px] doc-head-sub">INSTALLMENT PLAN</span>
                  </div>
                </div>
                <span className="rounded-lg bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold">{livePlan.planNumber}</span>
              </div>
              <div className="doc-meta px-5 py-2 text-[10px]">
                {livePlan.items.length} قسطاً · مقدم {fmt(livePlan.downPaymentMinor)} · {liveProgress.finished ? 'الخطة مكتملة السداد' : `القسط القادم ${liveProgress.nextDue ? liveProgress.nextDue.dueDate : '—'}`}
              </div>
              <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    ['المحصَّل', fmt(liveProgress.paidMinor + livePlan.downPaymentMinor), 'text-emerald-600 dark:text-emerald-400'],
                    ['المتبقي', fmt(liveProgress.remainingMinor), 'doc-ink'],
                    ['المتأخر', fmt(liveProgress.overdueMinor), liveProgress.overdueMinor > 0 ? 'text-rose-600 dark:text-rose-400' : 'doc-faint'],
                  ].map(([label, value, cls]) => (
                    <div key={label} className="rounded-xl doc-card doc-ring p-3 text-center">
                      <div className="text-[10px] font-bold doc-faint">{label}</div>
                      <div className={`font-mono text-[15px] font-black ${cls}`}>{value}</div>
                    </div>
                  ))}
                </div>

                <DocSection step="١" title="جدول الأقساط" hint="حالة كل قسط بتاريخ استحقاقه">
                  <div className="max-h-52 overflow-y-auto rounded-xl doc-ring">
                    <table className="w-full text-[12px]">
                      <tbody className="divide-y doc-line">
                        {livePlan.items.map((it) => {
                          const st = installmentStatus(it, today)
                          const badge = STATUS_BADGE[st]
                          return (
                            <tr key={it.seq}>
                              <td className="px-4 py-2 doc-muted">قسط {it.seq}</td>
                              <td className="px-4 py-2 doc-muted" dir="ltr">{it.dueDate}</td>
                              <td className="px-4 py-2 font-mono font-bold doc-ink">{fmt(it.amountMinor)}</td>
                              <td className="px-4 py-2 doc-faint">{it.paidMinor > 0 ? `سُدد ${fmt(it.paidMinor)}` : ''}</td>
                              <td className="px-4 py-2 text-left"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </DocSection>

                {!liveProgress.finished && (
                  <DocSection step="٢" title="تحصيل دفعة" hint="نقداً أو بنكياً أو على ماكينة دفع — القيد يُرحَّل فوراً">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <Field label={`المبلغ (${cur.symbol})`}>
                        <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputCls} dir="ltr" inputMode="decimal" placeholder="0" />
                      </Field>
                      <Field label="وسيلة التحصيل">
                        <QuickSelect value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className={inputCls}>
                          <option value="">نقدي/بنك</option>
                          {availableTerminals.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
                        </QuickSelect>
                      </Field>
                      {!terminalId
                        ? <Field label="الخزينة المستلمة"><TreasuryPicker value={payTreasury} onChange={setPayTreasury} compact /></Field>
                        : <Field label="مرجع العملية"><input value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} className={inputCls} placeholder="مرجع الماكينة" /></Field>}
                    </div>
                    {liveProgress.nextDue && (
                      <button
                        onClick={() => setPayAmount(String((liveProgress.nextDue!.amountMinor - liveProgress.nextDue!.paidMinor) / 10 ** cur.decimals))}
                        className="mt-2 rounded-lg doc-tint px-3 py-1.5 text-[11px] font-bold doc-accent-deep"
                      >
                        تعبئة قيمة القسط القادم ({fmt(liveProgress.nextDue.amountMinor - liveProgress.nextDue.paidMinor)})
                      </button>
                    )}
                    {over && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] font-bold text-rose-700 dark:text-rose-300">المبلغ يتجاوز المتبقي على الخطة بـ{fmt(payMinor - liveProgress.remainingMinor)} — صحّح القيمة.</p>}
                  </DocSection>
                )}

                {!liveProgress.finished && (
                  <DocOutcome>
                    <b className="block pb-1">القيد الذي سيُرحَّل</b>
                    <div className="flex items-center justify-between gap-3"><span>{terminal ? `${terminal.nameAr} — حساب التسوية (${targetAccount}) مديناً` : `الخزينة (${targetAccount}) — مديناً`}</span><b className="font-mono">{fmt(payMinor)}</b></div>
                    <div className="flex items-center justify-between gap-3"><span>ذمم العملاء (1104) — {custName(livePlan.customerId)} دائناً</span><b className="font-mono">{fmt(payMinor)}</b></div>
                    <div className="mt-1 border-t doc-line pt-1 text-[10.5px] doc-faint">هامش التمويل أُثبت إيراداً (4111) عند إنشاء الخطة — التحصيل هنا تخفيض مديونية لا إيراد جديد.</div>
                  </DocOutcome>
                )}

                {planEntries.length > 0 && (
                  <DocSection step={liveProgress.finished ? '٢' : '٣'} title={`قيود التحصيل (${planEntries.length})`} hint="سجل غير قابل للتعديل">
                    <div className="max-h-36 overflow-y-auto rounded-xl doc-ring">
                      <table className="w-full text-[12px]">
                        <tbody className="divide-y doc-line">
                          {planEntries.map((e) => (
                            <tr key={e.id}>
                              <td className="px-4 py-1.5 doc-faint">#{e.entryNumber}</td>
                              <td className="px-4 py-1.5 doc-muted">{e.description}</td>
                              <td className="px-4 py-1.5 text-left font-mono font-bold doc-ink">{fmt(e.lines[0]?.debit ?? 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DocSection>
                )}
              </div>
              <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="text-[11px] doc-faint">{liveProgress.finished ? 'الخطة مسددة بالكامل' : `المتبقي بعد هذه الدفعة: ${fmt(Math.max(0, liveProgress.remainingMinor - payMinor))}`}</span>
                <div className="flex gap-2">
                  <Btn variant="ghost" onClick={() => setViewing(null)}>إغلاق</Btn>
                  {!liveProgress.finished && <Btn onClick={pay} shortcut="F9" disabled={payMinor <= 0 || over}>تحصيل وتوليد القيد</Btn>}
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>
      {creditApproval.dialog}
    </div>
  )
}
