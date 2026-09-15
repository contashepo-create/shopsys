/**
 * الشيكات (أوراق القبض والدفع) —
 * وارد من عميل: استلام ← إيداع ← تحصيل / ارتداد
 * صادر لمورد: تحرير ← صرف / إلغاء
 * كل تحول حالة مالي يولّد قيده المتوازن فوراً، مع تنبيهات استحقاق.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText, AlarmClock, Banknote } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import {
  CHEQUE_STATUS_LABELS, dueCheques, chequePortfolio, isFinalStatus,
  type Cheque, type ChequeStatus,
} from '../../core/cheques.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

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
  const { cheques, journal, customers, suppliers, treasuries, receiveCheque, issueCheque, setChequeStatus } = useDataStore()
  const banks = treasuries.filter((t) => t.kind === 'bank')
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming')
  const [chequeNumber, setChequeNumber] = useState('')
  const [partyId, setPartyId] = useState('')
  const [bankName, setBankName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [viewing, setViewing] = useState<Cheque | null>(null)

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
    setChequeNumber(''); setPartyId(''); setBankName(''); setAmount(''); setNotes('')
    setDueDate(new Date().toISOString().slice(0, 10))
    setOpen(true)
  }

  const save = () => {
    try {
      const args = {
        chequeNumber: chequeNumber.trim(), partyId: Number(partyId), bankName: bankName.trim(),
        amountMinor: toMinor(amount || '0', cur.decimals), dueDate, notes: notes.trim(),
      }
      const c = direction === 'incoming' ? receiveCheque(args) : issueCheque(args)
      toast.show(`سُجل الشيك ${c.chequeNumber} — تولد قيده تلقائياً ✓`)
      setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  // البنك المستلم/الصارف — يظهر عند التحصيل والصرف فقط (يدعم البنوك المتعددة)
  const [bankAccount, setBankAccount] = useState('1102')
  const transition = (c: Cheque, to: ChequeStatus) => {
    try {
      const updated = setChequeStatus(c.id, to, to === 'collected' || to === 'cleared' ? bankAccount : undefined)
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
          <Btn onClick={() => openNew('incoming')}><ArrowDownCircle size={15} /> شيك وارد (من عميل)</Btn>
          <Btn variant="ghost" onClick={() => openNew('outgoing')} className="!text-rose-600 border-2 border-rose-500/30 hover:!bg-rose-500/5">
            <ArrowUpCircle size={15} /> شيك صادر (لمورد)
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
      <Modal open={open} onClose={() => setOpen(false)} title={direction === 'incoming' ? '⬇️ شيك وارد — ورقة قبض من عميل' : '⬆️ شيك صادر — ورقة دفع لمورد'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="رقم الشيك">
              <input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} placeholder="000123" className={inputCls} dir="ltr" autoFocus />
            </Field>
            <Field label="البنك المسحوب عليه">
              <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="بنك مصر…" className={inputCls} />
            </Field>
          </div>
          <Field label={direction === 'incoming' ? 'العميل (يُخفَّض دينه فوراً)' : 'المورد (يُخفَّض ديننا له فوراً)'}>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputCls}>
              <option value="">اختر…</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`المبلغ (${cur.symbol})`}>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
          </div>
          <Field label="ملاحظات (اختياري)">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="سداد فاتورة يناير…" className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!chequeNumber.trim() || !partyId || !amount.trim() || !dueDate}>💾 تسجيل الشيك</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض شيك + أفعاله + قيوده */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `الشيك ${viewing.chequeNumber}` : ''}>
        {viewing && (
          <div className="space-y-4">
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
              <div className={`font-black text-2xl ${viewing.direction === 'incoming' ? 'text-emerald-600' : 'text-rose-500'}`}>
                {fmt(viewing.amountMinor)} {cur.symbol}
              </div>
              <div className="text-[12px] text-slate-400 mt-1">
                {viewing.partyName} · {viewing.bankName || 'بنك غير محدد'} · استحقاق {viewing.dueDate}
              </div>
              <span className={`inline-block mt-2 text-[11px] px-2.5 py-1 rounded-full font-bold ${STATUS_STYLE[viewing.status]}`}>
                {CHEQUE_STATUS_LABELS[viewing.status]}
              </span>
            </div>

            {!isFinalStatus(viewing.status) && (
              <div className="space-y-2">
                <div className="text-[12px] font-bold text-slate-500 flex items-center gap-1.5"><Banknote size={13} /> ماذا حدث للشيك؟</div>
                {NEXT_ACTIONS[viewing.status].some((a) => a.to === 'collected' || a.to === 'cleared') && banks.length > 1 && (
                  <Field label="أي بنك؟" hint="التحصيل يدخل فيه والصرف يخرج منه">
                    <select value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className={inputCls}>
                      {banks.map((b) => <option key={b.code} value={b.code}>{b.nameAr}</option>)}
                    </select>
                  </Field>
                )}
                {NEXT_ACTIONS[viewing.status].map((a) => (
                  <button
                    key={a.to}
                    onClick={() => transition(viewing, a.to)}
                    className={`w-full text-right p-3 rounded-xl border-2 font-bold text-[13px] transition-all ${a.danger ? 'border-rose-500/30 text-rose-600 hover:bg-rose-500/5' : 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/5'}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {viewingEntries.map((entry) => (
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
