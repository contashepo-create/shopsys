import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الشيكات (أوراق القبض والدفع) — كل السيناريوهات العملية (طلب المالك):
 * وارد: من عميل مسجل أو بلا طرف (إيراد/حساب آخر) ← إيداع ← تحصيل في بنك أو خزينة / ارتداد
 * صادر: لمورد مسجل أو لمستفيد آخر (مصروف شركة/راتب موظف/حساب مخصص) ← صرف / إلغاء
 * كل تحول حالة مالي يولّد قيده المتوازن فوراً، مع تنبيهات استحقاق.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText, AlarmClock, FileSignature } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  CHEQUE_STATUS_LABELS, dueCheques, chequePortfolio, isFinalStatus,
  type Cheque, type ChequeStatus,
} from '../../core/cheques.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { DocSection, DocOutcome } from '../components/DocSection.tsx'
import { useActivityBaseCoa } from '../activityCoa.ts'
import { accountName } from './accountNames.ts'

const STATUS_STYLE: Record<ChequeStatus, string> = {
  held: 'bg-amber-500/10 text-amber-600',
  deposited: 'bg-sky-500/10 text-sky-600',
  collected: 'bg-emerald-500/10 text-emerald-600',
  bounced: 'bg-rose-500/10 text-rose-600',
  issued: 'bg-amber-500/10 text-amber-600',
  cleared: 'bg-emerald-500/10 text-emerald-600',
  cancelled: 'bg-slate-500/10 text-slate-500',
}

/** الأفعال المتاحة لكل حالة — بلغة التاجر */
const NEXT_ACTIONS: Record<ChequeStatus, { to: ChequeStatus; label: string; danger?: boolean }[]> = {
  held: [
    { to: 'deposited', label: '🏦 أودعته بالبنك (تحت التحصيل)' },
    { to: 'collected', label: '✅ حُصِّل ودخل البنك' },
    { to: 'bounced', label: '↩️ ارتد — يعود الدين على العميل', danger: true },
  ],
  deposited: [
    { to: 'collected', label: '✅ حُصِّل ودخل البنك' },
    { to: 'bounced', label: '↩️ ارتد — يعود الدين على العميل', danger: true },
  ],
  issued: [
    { to: 'cleared', label: '✅ صُرف من حسابنا البنكي' },
    { to: 'cancelled', label: '🚫 أُلغي قبل الصرف — يعود الدين للمورد', danger: true },
  ],
  collected: [], bounced: [], cleared: [], cancelled: [],
}

export function ChequesPage() {
  const { cheques, journal, customers, suppliers, treasuries, customAccounts, receiveCheque, issueCheque, setChequeStatus } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming')
  const [chequeNumber, setChequeNumber] = useState('')
  const [partyId, setPartyId] = useState('') // '' = شيك بلا طرف مسجل
  const [partyName, setPartyName] = useState('')
  const [counterAccount, setCounterAccount] = useState('')
  const [bankName, setBankName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [viewing, setViewing] = useState<Cheque | null>(null)

  // خيارات الحساب المقابل لشيك بلا طرف (طلب المالك — كل السيناريوهات):
  // وارد بلا عميل ⇒ حسابات الإيراد؛ صادر بلا مورد ⇒ مصروفات + رواتب مستحقة + المخصصة
  const activityBase = useActivityBaseCoa()
  const counterOptions = useMemo(() => {
    // مفلترة حسب النشاط (أمر المالك): لا «إيرادات تحاليل طبية» في شيكات محل موبايلات
    const std = activityBase.filter((a) => a.isPostable && (
      direction === 'incoming' ? a.rootType === 'revenue' : (a.rootType === 'expenses' || a.code === '2104')
    ))
    const custom = customAccounts.filter((a) =>
      direction === 'incoming' ? a.rootType === 'revenue' : a.rootType === 'expenses')
    return [
      ...std.map((a) => ({ code: a.code, nameAr: a.nameAr })),
      ...custom.map((a) => ({ code: a.code, nameAr: `${a.nameAr} (مخصص)` })),
    ]
  }, [activityBase, direction, customAccounts])

  const today = new Date().toISOString()
  const alerts = useMemo(() => dueCheques(cheques, today), [cheques, today])
  const portfolio = useMemo(() => chequePortfolio(cheques), [cheques])
  const listed = useMemo(() => [...cheques].reverse(), [cheques])
  const parties = direction === 'incoming' ? customers : suppliers
  const viewingEntries = viewing
    ? journal.filter((e) => [viewing.receiveEntryId, viewing.settleEntryId, viewing.reverseEntryId].includes(e.id))
    : []

  const openNew = (d: 'incoming' | 'outgoing') => {
    setDirection(d)
    setChequeNumber(''); setPartyId(''); setPartyName(''); setBankName(''); setAmount(''); setNotes('')
    setCounterAccount(d === 'incoming' ? '4110' : '5108')
    setDueDate(new Date().toISOString().slice(0, 10))
    setOpen(true)
  }

  const save = () => {
    try {
      const args = {
        chequeNumber: chequeNumber.trim(),
        partyId: partyId ? Number(partyId) : null,
        partyName: partyName.trim(),
        counterAccount: partyId ? undefined : counterAccount,
        bankName: bankName.trim(),
        amountMinor: toMinor(amount || '0', cur.decimals), dueDate, notes: notes.trim(),
      }
      const c = direction === 'incoming' ? receiveCheque(args) : issueCheque(args)
      toast.show(`سُجل الشيك ${c.chequeNumber} — تولد قيده تلقائياً ✓`)
      setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  // حساب الإيداع/الصرف — بنك أو خزينة نقدية (طلب المالك: المحصَّل يدخل حساباً فعلياً دائماً)
  const [settleAccount, setSettleAccount] = useState(() => treasuries.find((t) => t.kind === 'bank')?.code ?? treasuries[0]?.code ?? '1101')
  const transition = (c: Cheque, to: ChequeStatus) => {
    try {
      const updated = setChequeStatus(c.id, to, to === 'collected' || to === 'cleared' ? settleAccount : undefined)
      toast.show(`الشيك ${updated.chequeNumber} أصبح: ${CHEQUE_STATUS_LABELS[updated.status]}`)
      setViewing(updated)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up flex-wrap gap-2">
        <div className="text-sm text-slate-500">ورقة القبض أصل وورقة الدفع التزام — وكل تحول يولّد قيده المتوازن فوراً</div>
        <div className="flex gap-2">
          <Btn onClick={() => openNew('incoming')}><ArrowDownCircle size={15} /> شيك وارد</Btn>
          <Btn variant="ghost" onClick={() => openNew('outgoing')} className="!text-rose-600 border-2 border-rose-500/30 hover:!bg-rose-500/5">
            <ArrowUpCircle size={15} /> شيك صادر
          </Btn>
        </div>
      </div>

      {/* ملخص المحفظة */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 anim-up">
        <div className={`${card} p-4`}>
          <div className="text-[11px] text-slate-400 font-bold">أوراق قبض مفتوحة ({portfolio.incomingOpenCount})</div>
          <div className="font-black text-xl text-emerald-600 mt-1">{fmt(portfolio.incomingOpenMinor)} {cur.symbol}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="text-[11px] text-slate-400 font-bold">أوراق دفع مفتوحة ({portfolio.outgoingOpenCount})</div>
          <div className="font-black text-xl text-rose-500 mt-1">{fmt(portfolio.outgoingOpenMinor)} {cur.symbol}</div>
        </div>
        <div className={`${card} p-4 col-span-2 lg:col-span-1`}>
          <div className="text-[11px] text-slate-400 font-bold">شيكات مرتدة</div>
          <div className="font-black text-xl text-slate-700 dark:text-white mt-1">{portfolio.bouncedCount}</div>
        </div>
      </div>

      {/* تنبيهات الاستحقاق */}
      {alerts.length > 0 && (
        <div className="anim-up rounded-2xl border-2 border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-2">
          <div className="font-bold text-amber-600 text-[13px] flex items-center gap-1.5"><AlarmClock size={15} /> شيكات تستحق خلال أسبوع أو متأخرة</div>
          {alerts.map((a) => (
            <div key={a.cheque.id} className="flex items-center justify-between text-[12.5px]">
              <span className="text-slate-600 dark:text-slate-300">
                {a.cheque.direction === 'incoming' ? '⬇️' : '⬆️'} {a.cheque.chequeNumber} — {a.cheque.partyName} — {fmt(a.cheque.amountMinor)} {cur.symbol}
              </span>
              <span className={`font-bold ${a.daysLeft < 0 ? 'text-rose-500' : 'text-amber-600'}`}>
                {a.daysLeft < 0 ? `متأخر ${-a.daysLeft} يوم` : a.daysLeft === 0 ? 'يستحق اليوم' : `بعد ${a.daysLeft} يوم`}
              </span>
            </div>
          ))}
        </div>
      )}

      {listed.length === 0 ? (
        <div className={card}>
          <EmptyState icon="🏦" title="لا شيكات بعد" sub="سجّل الشيكات الواردة من عملائك والصادرة لمورديك — وتابع الإيداع والتحصيل والارتداد من هنا" />
        </div>
      ) : (
        <div className={`anim-up ${card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الشيك</th>
                <th className="px-4 py-3 font-bold">الاتجاه</th>
                <th className="px-4 py-3 font-bold">الطرف</th>
                <th className="px-4 py-3 font-bold">الاستحقاق</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((c, i) => (
                <tr
                  key={c.id}
                  style={{ animationDelay: `${i * 25}ms` }}
                  onClick={() => setViewing(c)}
                  className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.02] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{c.chequeNumber}</div>
                    <div className="text-[11px] text-slate-400">{c.bankName || 'بنك غير محدد'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${c.direction === 'incoming' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                      {c.direction === 'incoming' ? '⬇️ وارد' : '⬆️ صادر'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-[12px]">{c.partyName}</td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]" dir="ltr">{c.dueDate}</td>
                  <td className={`px-4 py-3 font-black ${c.direction === 'incoming' ? 'text-emerald-600' : 'text-rose-500'}`}>{fmt(c.amountMinor)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${STATUS_STYLE[c.status]}`}>{CHEQUE_STATUS_LABELS[c.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* شيك جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="" wide bare>
        {(() => {
          const amountMinor = (() => { try { return amount.trim() ? toMinor(amount, cur.decimals) : 0 } catch { return 0 } })()
          const incoming = direction === 'incoming'
          const partyLabel = partyId ? (parties.find((x) => x.id === Number(partyId))?.nameAr ?? '') : partyName.trim()
          return (
            <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
              <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><FileSignature size={19} /></span>
                  <div>
                    <h3 className="text-base font-black leading-tight">{incoming ? 'شيك وارد — ورقة قبض' : 'شيك صادر — ورقة دفع'}</h3>
                    <span className="text-[10.5px] doc-head-sub">{incoming ? 'NOTE RECEIVABLE' : 'NOTE PAYABLE'}</span>
                  </div>
                </div>
                <span className="rounded-lg bg-white/10 px-2.5 py-1.5 font-mono text-[11px] font-bold">{chequeNumber.trim() || '— — —'}</span>
              </div>
              <div className="doc-meta px-5 py-2 text-[10px]">
                {incoming ? 'ورقة في حافظتنا تُخفّض دين العميل فور استلامها — لا نقد حتى التحصيل' : 'التزام بورقة يُخفّض دين المورد فور تحريرها — لا نقد يخرج حتى الصرف'}
              </div>
              <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
                <DocSection step="١" title="بيانات الورقة" hint="الرقم كما هو مطبوع على الشيك">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="رقم الشيك"><input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} placeholder="000123" className={inputCls} dir="ltr" autoFocus /></Field>
                    <Field label="البنك المسحوب عليه"><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="بنك مصر…" className={inputCls} /></Field>
                  </div>
                </DocSection>

                <DocSection step="٢" title={incoming ? 'من دفع الشيك؟' : 'لمن حُرِّر الشيك؟'} hint={incoming ? 'اختيار العميل يخفّض مديونيته فوراً' : 'اختيار المورد يخفّض ديننا له فوراً'}>
                  <Field label={incoming ? 'العميل (يُخفَّض دينه فوراً)' : 'المورد (يُخفَّض ديننا له فوراً)'}>
                    <PartyQuickPicker parties={parties} value={partyId ? Number(partyId) : 0} onChange={(id) => setPartyId(id ? String(id) : '')} cashLabel={`بلا طرف مسجل (${incoming ? 'إيراد مباشر' : 'مصروف مباشر'})`} label={incoming ? 'بحث العميل' : 'بحث المورد'} showCash />
                  </Field>
                  {!partyId && (
                    <div className="mt-2.5 grid grid-cols-1 gap-3 rounded-xl doc-tint p-3 sm:grid-cols-2">
                      <Field label={incoming ? 'اسم دافع الشيك' : 'اسم المستفيد'}>
                        <input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder={incoming ? 'شركة كذا…' : 'الموظف/الجهة…'} className={inputCls} />
                      </Field>
                      <Field label={incoming ? 'يقيَّد كإيراد في' : 'يقيَّد على حساب'} hint="الطرف المقابل في القيد">
                        <QuickSelect value={counterAccount} onChange={(e) => setCounterAccount(e.target.value)} className={inputCls}>
                          {counterOptions.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
                        </QuickSelect>
                      </Field>
                    </div>
                  )}
                </DocSection>

                <DocSection step="٣" title="المبلغ والاستحقاق" hint="تاريخ الاستحقاق يحكم تنبيهات المتابعة">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={`المبلغ (${cur.symbol})`}><input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" inputMode="decimal" /></Field>
                    <Field label="تاريخ الاستحقاق"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} dir="ltr" /></Field>
                  </div>
                  <div className="mt-2.5"><Field label="ملاحظات (اختياري)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="سداد فاتورة يناير…" className={inputCls} /></Field></div>
                </DocSection>

                <DocOutcome>
                  <b className="block pb-1">القيد الذي سيُرحَّل الآن</b>
                  {incoming ? (
                    <>
                      <div className="flex items-center justify-between gap-3"><span>أوراق قبض (1106) — مديناً</span><b className="font-mono">{fmt(amountMinor)}</b></div>
                      <div className="flex items-center justify-between gap-3"><span>{partyId ? `ذمم العملاء (1104) — ${partyLabel || 'العميل'} دائناً` : `${counterAccount} — دائناً`}</span><b className="font-mono">{fmt(amountMinor)}</b></div>
                      <div className="mt-1 border-t doc-line pt-1 text-[10.5px] doc-faint">لا نقد يدخل الآن — النقد يُقيَّد عند التحصيل من شاشة الشيك نفسه.</div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3"><span>{partyId ? `الموردون (2101) — ${partyLabel || 'المورد'} مديناً` : `${counterAccount} — مديناً`}</span><b className="font-mono">{fmt(amountMinor)}</b></div>
                      <div className="flex items-center justify-between gap-3"><span>أوراق دفع (2106) — دائناً</span><b className="font-mono">{fmt(amountMinor)}</b></div>
                      <div className="mt-1 border-t doc-line pt-1 text-[10.5px] doc-faint">لا نقد يخرج الآن — النقد يُقيَّد عند صرف الشيك من البنك.</div>
                    </>
                  )}
                </DocOutcome>
              </div>
              <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="text-[11px] doc-faint">{dueDate ? `يستحق في ${dueDate}` : 'حدد تاريخ الاستحقاق'}</span>
                <div className="flex gap-2">
                  <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
                  <Btn onClick={save} shortcut="F9" disabled={!chequeNumber.trim() || (!partyId && !partyName.trim()) || amountMinor <= 0 || !dueDate}>تسجيل الشيك</Btn>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* عرض شيك + أفعاله + قيوده — بلغة المستند */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="" wide bare>
        {viewing && (
          <div dir="rtl" className="overflow-hidden rounded-3xl doc-sheet">
            <div className="doc-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><FileSignature size={19} /></span>
                <div>
                  <h3 className="text-base font-black leading-tight">{viewing.direction === 'incoming' ? 'شيك وارد' : 'شيك صادر'} — {viewing.chequeNumber}</h3>
                  <span className="text-[10.5px] doc-head-sub">{viewing.direction === 'incoming' ? 'NOTE RECEIVABLE' : 'NOTE PAYABLE'}</span>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[viewing.status]}`}>{CHEQUE_STATUS_LABELS[viewing.status]}</span>
            </div>
            <div className="doc-meta px-5 py-2 text-[10px]">
              {viewing.partyName} · {viewing.bankName || 'بنك غير محدد'} · استحقاق {viewing.dueDate}
            </div>
            <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
              <div className="rounded-xl doc-card doc-ring p-4 text-center">
                <div className="text-[10.5px] doc-faint">قيمة الورقة</div>
                <div className={`font-mono text-2xl font-black ${viewing.direction === 'incoming' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                  {fmt(viewing.amountMinor)} {cur.symbol}
                </div>
              </div>

              {!isFinalStatus(viewing.status) && (
                <DocSection step="١" title="ماذا حدث للشيك؟" hint="كل فعل يرحّل قيده فوراً بتاريخ اليوم">
                  {NEXT_ACTIONS[viewing.status].some((a) => a.to === 'collected' || a.to === 'cleared') && (
                    <div className="mb-2.5">
                      <Field
                        label={viewing.direction === 'incoming' ? 'أين يدخل المبلغ المُحصَّل؟' : 'من أي حساب يُصرف؟'}
                        hint="بنك أو خزينة نقدية — القيد يُثبت المبلغ في الحساب المختار فوراً"
                      >
                        <TreasuryPicker value={settleAccount} onChange={setSettleAccount} compact />
                      </Field>
                    </div>
                  )}
                  <div className="space-y-2">
                    {NEXT_ACTIONS[viewing.status].map((a) => (
                      <button
                        key={a.to}
                        onClick={() => transition(viewing, a.to)}
                        className={`w-full rounded-xl border-2 p-3 text-right text-[13px] font-bold transition-all ${a.danger ? 'border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400' : 'doc-line doc-ink hover:doc-tint'}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2.5 rounded-lg doc-tint px-3 py-2 text-[10.5px] doc-faint">
                    {viewing.direction === 'incoming'
                      ? 'التحصيل: مدين الحساب المختار / دائن أوراق قبض 1106 · الارتداد: قيد عاكس يعيد الدين على العميل.'
                      : 'الصرف: مدين أوراق دفع 2106 / دائن الحساب المختار · الإلغاء: قيد عاكس يعيد الدين للمورد.'}
                  </div>
                </DocSection>
              )}

              {viewingEntries.length > 0 && (
                <DocSection step={isFinalStatus(viewing.status) ? '١' : '٢'} title="القيود المرحَّلة على هذه الورقة" hint="سجل كامل غير قابل للتعديل">
                  <div className="space-y-2.5">
                    {viewingEntries.map((entry) => (
                      <div key={entry.id} className="overflow-hidden rounded-xl doc-ring">
                        <div className="flex items-center gap-1.5 doc-band px-4 py-2 text-[12px] font-bold doc-ink">
                          <BookOpenText size={13} /> قيد #{entry.entryNumber} — {entry.description}
                        </div>
                        <table className="w-full text-[12px]">
                          <tbody className="divide-y doc-line">
                            {entry.lines.map((l, i) => (
                              <tr key={i}>
                                <td className="px-4 py-1.5 doc-muted">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {accountName(l.accountCode)}</td>
                                <td className="w-28 px-4 py-1.5 font-mono font-bold doc-ink">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                                <td className="w-28 px-4 py-1.5 font-mono font-bold doc-faint">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </DocSection>
              )}
            </div>
            <div className="doc-footer flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span className="text-[11px] doc-faint">{isFinalStatus(viewing.status) ? 'حالة نهائية — لا أفعال متبقية على هذه الورقة' : 'اختر الفعل المطابق لما حدث فعلاً'}</span>
              <Btn variant="ghost" onClick={() => setViewing(null)}>إغلاق</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
