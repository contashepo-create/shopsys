/**
 * اليومية العامة — للوضع المحاسبي الكامل (القرار 10)
 * كل قيد مربوط بمستنده، وميزان تحقق حي أسفل الشاشة
 */
import { useMemo, useState } from 'react'
import { BookOpenText, Link2, Scale, PenLine, Undo2, Plus, Trash2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { STANDARD_COA } from '../../core/ledger.ts'
import { validateManualEntry } from '../../core/accounting.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

const POSTABLE = STANDARD_COA.filter((a) => a.isPostable)

interface DraftLine { accountCode: string; debit: string; credit: string }

/** تسميات مصادر القيود بالعربية — كل قيد مربوط بمستنده (القرار 9) */
const SOURCE_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع مبيعات',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  receipt_voucher: 'سند قبض',
  payment_voucher: 'سند صرف',
  adjustment: 'تسوية',
  payroll: 'رواتب',
  rental_contract: 'عقد إيجار',
  logistics_trip: 'نقلة',
  opening: 'قيد افتتاحي',
  manual: 'قيد يدوي',
  reversal: 'قيد عاكس',
}

export function JournalPage() {
  const { journal, postManualEntry, reverseEntry } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [manualOpen, setManualOpen] = useState(false)
  const [mDesc, setMDesc] = useState('')
  const [mDate, setMDate] = useState('')
  const [mLines, setMLines] = useState<DraftLine[]>([
    { accountCode: '', debit: '', credit: '' },
    { accountCode: '', debit: '', credit: '' },
  ])
  const [reversing, setReversing] = useState<number | null>(null)
  const [revReason, setRevReason] = useState('')

  const { totalDebit, totalCredit } = useMemo(() => {
    let d = 0, c = 0
    for (const e of journal) for (const l of e.lines) { d += l.debit; c += l.credit }
    return { totalDebit: d, totalCredit: c }
  }, [journal])

  /** سطور المسودة بالقيم الصغرى + أخطاؤها الحية (زر الحفظ معطل حتى تختفي) */
  const parsedLines = useMemo(
    () =>
      mLines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit.trim() ? toMinor(l.debit, cur.decimals) : 0,
        credit: l.credit.trim() ? toMinor(l.credit, cur.decimals) : 0,
      })),
    [mLines, cur.decimals],
  )
  const manualErrors = useMemo(() => validateManualEntry(parsedLines, STANDARD_COA), [parsedLines])

  const openManual = () => {
    setMDesc('')
    setMDate(new Date().toISOString().slice(0, 10))
    setMLines([{ accountCode: '', debit: '', credit: '' }, { accountCode: '', debit: '', credit: '' }])
    setManualOpen(true)
  }

  const saveManual = () => {
    try {
      const e = postManualEntry({ date: mDate, description: mDesc.trim(), lines: parsedLines })
      toast.show(`حُفظ القيد اليدوي #${e.entryNumber} ✓`)
      setManualOpen(false)
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  const doReverse = () => {
    if (reversing === null) return
    try {
      const r = reverseEntry(reversing, revReason.trim())
      toast.show(`عُكس القيد — القيد العاكس #${r.entryNumber} ✓`)
      setReversing(null)
      setRevReason('')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    }
  }

  if (journal.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end anim-up">
          <Btn onClick={openManual}><PenLine size={15} /> قيد يدوي</Btn>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📒" title="لا قيود بعد" sub="كل فاتورة بيع أو عملية مالية ستولد قيدها هنا تلقائياً — جرب البيع من الكاشير" />
        </div>
        <ManualEntryModal
          open={manualOpen} onClose={() => setManualOpen(false)}
          mDesc={mDesc} setMDesc={setMDesc} mDate={mDate} setMDate={setMDate}
          mLines={mLines} setMLines={setMLines} errors={manualErrors} onSave={saveManual} fmt={fmt}
          parsed={parsedLines}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end anim-up">
        <Btn onClick={openManual}><PenLine size={15} /> قيد يدوي</Btn>
      </div>
      {/* شريط التوازن الحي */}
      <div className={`anim-pop flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm ${
        totalDebit === totalCredit
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400'
          : 'bg-rose-500/15 border-rose-500/40 text-rose-700 animate-pulse'
      }`}>
        <Scale size={18} />
        {totalDebit === totalCredit
          ? <>✅ الدفتر متوازن: مجموع المدين {fmt(totalDebit)} = مجموع الدائن {fmt(totalCredit)}</>
          : <>💥 اختلال! مدين {fmt(totalDebit)} ≠ دائن {fmt(totalCredit)} — هذا مستحيل بنيوياً، أبلغ الدعم فوراً</>}
      </div>

      <div className="space-y-3">
        {[...journal].reverse().map((e, i) => (
          <div key={e.id} style={{ animationDelay: `${i * 40}ms` }} className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-rose-300/50 transition-colors duration-200">
            <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20">
              <span className="text-[11px] font-black px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600">#{e.entryNumber}</span>
              <span className="text-[12px] text-slate-400">{e.date}</span>
              <span className="font-bold text-[13px] text-slate-700 dark:text-slate-200 flex-1">{e.description}</span>
              {e.sourceId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold flex items-center gap-1">
                  <Link2 size={10} /> {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                </span>
              )}
              {e.reversedByEntryId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-400/10 text-slate-400 font-bold">معكوس بالقيد #{e.reversedByEntryId}</span>
              )}
              {!e.reversedByEntryId && !e.reversesEntryId && (
                <button
                  onClick={() => { setReversing(e.id); setRevReason('') }}
                  title="عكس القيد (التصحيح الموثق)"
                  className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                >
                  <Undo2 size={13} />
                </button>
              )}
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-300 dark:text-slate-600">
                  <th className="px-4 pt-2 pb-1 font-bold">الحساب</th>
                  <th className="px-4 pt-2 pb-1 font-bold w-32">مدين</th>
                  <th className="px-4 pt-2 pb-1 font-bold w-32">دائن</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, j) => (
                  <tr key={j}>
                    <td className={`px-4 py-1 ${l.credit > 0 ? 'pr-10 text-slate-500' : 'font-bold text-slate-700 dark:text-slate-200'}`}>
                      {l.credit > 0 && 'إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                      {l.note && <span className="text-[10px] text-slate-300 dark:text-slate-600 mr-2">({l.note})</span>}
                    </td>
                    <td className="px-4 py-1 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                    <td className="px-4 py-1 text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-1.5 text-[10px] text-slate-300 dark:text-slate-600 border-t border-slate-50 dark:border-slate-800/60 flex items-center gap-1">
              <BookOpenText size={10} /> {e.createdBy} · {e.createdAt.slice(0, 16).replace('T', ' ')} · دفتر Append-Only — التصحيح بقيد عكسي فقط
            </div>
          </div>
        ))}
      </div>

      {/* تأكيد عكس قيد */}
      <Modal open={reversing !== null} onClose={() => setReversing(null)} title={`عكس القيد #${reversing ?? ''}`}>
        <div className="space-y-4">
          <div className="text-[13px] text-slate-500 leading-relaxed">
            الدفتر Append-Only: لا حذف ولا تعديل. سيتولد <b className="text-rose-600">قيد عاكس</b> يقلب أطراف
            القيد الأصلي فيصفّر أثره — ويبقى الاثنان موثقين للأبد.
          </div>
          <input value={revReason} onChange={(e) => setRevReason(e.target.value)} placeholder="سبب العكس (اختياري): خطأ إدخال…" className={inputCls} />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setReversing(null)}>إلغاء</Btn>
            <Btn onClick={doReverse}><Undo2 size={14} /> تأكيد العكس</Btn>
          </div>
        </div>
      </Modal>

      <ManualEntryModal
        open={manualOpen} onClose={() => setManualOpen(false)}
        mDesc={mDesc} setMDesc={setMDesc} mDate={mDate} setMDate={setMDate}
        mLines={mLines} setMLines={setMLines} errors={manualErrors} onSave={saveManual} fmt={fmt}
        parsed={parsedLines}
      />
    </div>
  )
}

/** مودال القيد اليدوي — زر الحفظ معطل حتى يتوازن القيد (القرار 9) */
function ManualEntryModal({
  open, onClose, mDesc, setMDesc, mDate, setMDate, mLines, setMLines, errors, onSave, fmt, parsed,
}: {
  open: boolean
  onClose: () => void
  mDesc: string
  setMDesc: (v: string) => void
  mDate: string
  setMDate: (v: string) => void
  mLines: DraftLine[]
  setMLines: React.Dispatch<React.SetStateAction<DraftLine[]>>
  errors: string[]
  onSave: () => void
  fmt: (m: number) => string
  parsed: { accountCode: string; debit: number; credit: number }[]
}) {
  const totalD = parsed.reduce((a, l) => a + l.debit, 0)
  const totalC = parsed.reduce((a, l) => a + l.credit, 0)
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setMLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <Modal open={open} onClose={onClose} title="قيد يدوي جديد" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_11rem] gap-3">
          <input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="بيان القيد: تسوية، افتتاحي…" className={inputCls} autoFocus />
          <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className={inputCls} />
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 px-3 py-2 text-[10px] font-bold text-slate-400 bg-slate-50 dark:bg-slate-900/40">
            <span>الحساب</span><span className="text-center">مدين</span><span className="text-center">دائن</span><span></span>
          </div>
          {mLines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_7rem_2rem] gap-2 items-center px-3 py-2 border-t border-slate-100 dark:border-slate-800">
              <select value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} className={`${inputCls} py-1.5 text-[13px]`}>
                <option value="">اختر الحساب…</option>
                {POSTABLE.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
              </select>
              <input value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value.trim() ? '' : l.credit })} placeholder="0" className={`${inputCls} py-1.5 text-center`} dir="ltr" />
              <input value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value.trim() ? '' : l.debit })} placeholder="0" className={`${inputCls} py-1.5 text-center`} dir="ltr" />
              <button
                onClick={() => setMLines((ls) => ls.filter((_, j) => j !== i))}
                disabled={mLines.length <= 2}
                className="text-slate-300 hover:text-rose-500 disabled:opacity-30 transition-colors justify-self-center"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setMLines((ls) => [...ls, { accountCode: '', debit: '', credit: '' }])}
            className="w-full py-2 text-[12px] font-bold text-brand-600 hover:bg-brand-500/5 transition-colors border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-1"
          >
            <Plus size={13} /> سطر جديد
          </button>
        </div>

        {/* ميزان حي للمسودة */}
        <div className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-[12px] font-bold ${totalD === totalC && totalD > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800/60 text-slate-500'}`}>
          <span><Scale size={13} className="inline ml-1" /> مدين {fmt(totalD)} / دائن {fmt(totalC)}</span>
          <span>{totalD === totalC && totalD > 0 ? '✓ متوازن' : `الفارق ${fmt(Math.abs(totalD - totalC))}`}</span>
        </div>

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="text-[12px] px-3 py-2 rounded-xl font-bold bg-rose-500/10 text-rose-600">{e}</div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn onClick={onSave} disabled={errors.length > 0}>💾 حفظ القيد</Btn>
        </div>
      </div>
    </Modal>
  )
}
