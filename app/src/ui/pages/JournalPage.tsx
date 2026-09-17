/**
 * اليومية العامة — للوضع المحاسبي الكامل (القرار 10)
 * كل قيد مربوط بمستنده، وميزان تحقق حي أسفل الشاشة
 */
import { useMemo, useState } from 'react'
import { BookOpenText, Link2, Scale, PenLine, Undo2, Plus, Trash2, Printer, Filter, X } from 'lucide-react'
import { printHtml } from '../print/printReceipt.ts'
import { renderReportShell } from '../../core/reportPrint.ts'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { STANDARD_COA } from '../../core/ledger.ts'
import { fullCoa } from '../../core/treasury.ts'
import { customAsAccounts } from '../../core/customAccounts.ts'
import { validateManualEntry } from '../../core/accounting.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

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
  year_closing: 'إقفال سنة مالية',
  reversal: 'قيد عاكس',
  asset_purchase: 'اقتناء أصل',
  asset_payment: 'سداد أصل',
  depreciation: 'إهلاك شهري',
  external_commission: 'عمولة لدى الغير',
}

export function JournalPage() {
  const { journal, treasuries, customAccounts, postManualEntry, reverseEntry } = useDataStore()
  // الشجرة الكاملة تشمل الخزائن المخصصة — القيد اليدوي يستطيع استخدامها
  // الشجرة الكاملة = القياسية + خزائن المالك + حساباته المخصصة (الشجرة ليست مفروضة)
  const COA = useMemo(() => [...fullCoa(STANDARD_COA, treasuries), ...customAsAccounts(customAccounts)], [treasuries, customAccounts])
  const POSTABLE = useMemo(() => COA.filter((a) => a.isPostable), [COA])
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

  /* ─── الفلاتر (طلب المالك: تاريخ/نوع عملية/سنة/مستخدم/حساب) ─── */
  const [showFilters, setShowFilters] = useState(false)
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [fSource, setFSource] = useState('')
  const [fUser, setFUser] = useState('')
  const [fAccount, setFAccount] = useState('')
  const [fText, setFText] = useState('')
  const users = useMemo(() => [...new Set(journal.map((e) => e.createdBy))], [journal])
  const sourceTypes = useMemo(() => [...new Set(journal.map((e) => e.sourceType))], [journal])
  const filtersActive = !!(fFrom || fTo || fSource || fUser || fAccount || fText.trim())
  const clearFilters = () => { setFFrom(''); setFTo(''); setFSource(''); setFUser(''); setFAccount(''); setFText('') }

  const filtered = useMemo(() => journal.filter((e) => {
    if (fFrom && e.date < fFrom) return false
    if (fTo && e.date > fTo) return false
    if (fSource && e.sourceType !== fSource) return false
    if (fUser && e.createdBy !== fUser) return false
    if (fAccount && !e.lines.some((l) => l.accountCode === fAccount)) return false
    if (fText.trim() && !e.description.includes(fText.trim()) && String(e.entryNumber) !== fText.trim()) return false
    return true
  }), [journal, fFrom, fTo, fSource, fUser, fAccount, fText])

  const accName = (code: string) => treasuries.find((t) => t.code === code)?.nameAr
    ?? customAccounts.find((a) => a.code === code)?.nameAr ?? ACCOUNT_NAMES[code] ?? code

  /** طباعة اليومية المفلترة — مطبوعة رسمية بعنوان احترافي (طلب المالك) */
  const printJournal = () => {
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    let d = 0, c = 0
    const rows = filtered.map((e) => {
      const lines = e.lines.map((l, i) => {
        d += l.debit; c += l.credit
        return `<tr>
          ${i === 0 ? `<td rowspan="${e.lines.length}" class="num">#${e.entryNumber}</td><td rowspan="${e.lines.length}" class="num">${e.date}</td>` : ''}
          <td class="${l.credit > 0 ? 'to' : 'from'}">${l.credit > 0 ? 'إلى ' : ''}${esc(accName(l.accountCode))}</td>
          <td class="num">${l.debit > 0 ? fmt(l.debit) : ''}</td>
          <td class="num">${l.credit > 0 ? fmt(l.credit) : ''}</td>
          ${i === 0 ? `<td rowspan="${e.lines.length}" class="desc">${esc(e.description)}<div class="src">${esc(SOURCE_LABELS[e.sourceType] ?? e.sourceType)} — ${esc(e.createdBy)}</div></td>` : ''}
        </tr>`
      }).join('')
      return lines
    }).join('')
    const filterLine = [
      fFrom || fTo ? `الفترة: ${fFrom || 'البداية'} → ${fTo || 'اليوم'}` : 'كل الفترات',
      fSource ? `النوع: ${SOURCE_LABELS[fSource] ?? fSource}` : '',
      fUser ? `المستخدم: ${fUser}` : '',
      fAccount ? `الحساب: ${accName(fAccount)}` : '',
    ].filter(Boolean).join(' · ')
    // الغلاف الموحّد بإعدادات طباعة التقارير — مطبوعة رسمية تصلح للمراجعة الخارجية
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({
      title: 'دفتر اليومية العامة',
      subtitle: `${filterLine} · ${filtered.length} قيد`,
      companyName: setup.shopName || '',
      logoDataUrl: receipt.logoDataUrl,
      settings: reportPrint,
      bodyHtml: `<style>.to{padding-right:26px;color:#475569}.from{font-weight:700}.desc{font-size:.85em;color:#475569;max-width:150px}.src{font-size:.75em;color:#94a3b8;margin-top:2px}td,th{border:1px solid #e2e8f0;vertical-align:top}</style>
      <table>
        <thead><tr><th>القيد</th><th>التاريخ</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">الإجمالي</td><td class="num">${fmt(d)}</td><td class="num">${fmt(c)}</td><td>${d === c ? '✓ متوازن' : '✗ غير متوازن'}</td></tr></tfoot>
      </table>`,
    }))
  }

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
  const manualErrors = useMemo(() => validateManualEntry(parsedLines, COA), [parsedLines, COA])

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

  // عكس القيد عملية حساسة — موافقة مشرف برقم سري لغير المخول (acc.journal.reverse)
  const reverseApproval = useSupervisorApproval('acc.journal.reverse')
  const doReverse = () => {
    if (reversing === null) return
    reverseApproval.request((approvedBy) => {
      try {
        const r = reverseEntry(reversing, revReason.trim() + (approvedBy ? ` — اعتمده «${approvedBy}»` : ''))
        toast.show(`عُكس القيد — القيد العاكس #${r.entryNumber} ✓`)
        setReversing(null)
        setRevReason('')
      } catch (err) {
        toast.show((err as Error).message, 'error')
      }
    })
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
          parsed={parsedLines} postable={POSTABLE}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 anim-up">
        <Btn variant="soft" onClick={() => setShowFilters((v) => !v)}>
          <Filter size={15} /> فلاتر{filtersActive ? ' ●' : ''}
        </Btn>
        <Btn variant="soft" onClick={printJournal}><Printer size={15} /> طباعة اليومية{filtersActive ? ' (المفلترة)' : ''}</Btn>
        <Btn onClick={openManual}><PenLine size={15} /> قيد يدوي</Btn>
      </div>

      {/* الفلاتر: تاريخ/نوع/مستخدم/حساب/بحث (طلب المالك) */}
      {showFilters && (
        <div className="anim-pop rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <label className="text-[11px] font-bold text-slate-400">من تاريخ
            <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className={`${inputCls} mt-1`} dir="ltr" />
          </label>
          <label className="text-[11px] font-bold text-slate-400">إلى تاريخ
            <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className={`${inputCls} mt-1`} dir="ltr" />
          </label>
          <label className="text-[11px] font-bold text-slate-400">نوع العملية
            <select value={fSource} onChange={(e) => setFSource(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">الكل</option>
              {sourceTypes.map((t) => <option key={t} value={t}>{SOURCE_LABELS[t] ?? t}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-400">المستخدم
            <select value={fUser} onChange={(e) => setFUser(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">الكل</option>
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-400">الحساب
            <select value={fAccount} onChange={(e) => setFAccount(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">الكل</option>
              {POSTABLE.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <input value={fText} onChange={(e) => setFText(e.target.value)} className={inputCls} placeholder="بحث بالبيان أو رقم القيد…" />
            {filtersActive && (
              <button onClick={clearFilters} className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-all" title="مسح الفلاتر"><X size={15} /></button>
            )}
          </div>
          <div className="col-span-full text-[11px] text-slate-400">{filtered.length} من {journal.length} قيد</div>
        </div>
      )}

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
        {[...filtered].reverse().map((e, i) => (
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
                      {l.credit > 0 && 'إلى '} {accName(l.accountCode)}
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
        parsed={parsedLines} postable={POSTABLE}
      />
      {reverseApproval.dialog}
    </div>
  )
}

/** مودال القيد اليدوي — زر الحفظ معطل حتى يتوازن القيد (القرار 9) */
function ManualEntryModal({
  open, onClose, mDesc, setMDesc, mDate, setMDate, mLines, setMLines, errors, onSave, fmt, parsed, postable,
}: {
  postable: { code: string; nameAr: string }[]
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
          <div className="grid grid-cols-[4.5rem_1fr_7rem_7rem_2rem] gap-2 px-3 py-2 text-[10px] font-bold text-slate-400 bg-slate-50 dark:bg-slate-900/40">
            <span className="text-center">الكود</span><span>الحساب</span><span className="text-center">مدين</span><span className="text-center">دائن</span><span></span>
          </div>
          {mLines.map((l, i) => (
            <div key={i} className="grid grid-cols-[4.5rem_1fr_7rem_7rem_2rem] gap-2 items-center px-3 py-2 border-t border-slate-100 dark:border-slate-800">
              {/* إدخال سريع بكود الحساب (طلب المالك) — اكتب 1101 وسيُختار فوراً */}
              <input
                value={l.accountCode}
                onChange={(e) => setLine(i, { accountCode: e.target.value.trim() })}
                placeholder="كود"
                className={`${inputCls} py-1.5 text-center text-[12px] font-mono ${l.accountCode && !postable.some((a) => a.code === l.accountCode) ? '!border-rose-400' : ''}`}
                dir="ltr"
              />
              <select value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} className={`${inputCls} py-1.5 text-[13px]`}>
                <option value="">اختر الحساب…</option>
                {postable.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
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
