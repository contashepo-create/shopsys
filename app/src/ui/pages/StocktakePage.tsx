/**
 * الجرد بالباركود (المرحلة 3):
 * ابدأ جلسة ← امسح باركود كل قطعة (كل مسحة +1) أو اكتب المعدود يدوياً ←
 * النظام يقارن بالدفتري ويعرض الفوارق مُقيَّمة بالتكلفة ← رحّل فيتولد
 * قيد تسوية واحد متوازن ويُضبط المخزون على المعدود.
 */
import { useMemo, useRef, useState } from 'react'
import { ClipboardList, ScanBarcode, BookOpenText, CheckCircle2, AlertTriangle, Eye, PlayCircle } from 'lucide-react'
import { useDataStore, type Stocktake } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, normalizeDigits } from '../../core/money.ts'
import type { CountInput } from '../../core/stocktake.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function StocktakePage() {
  const { items, stocktakes, journal, postStocktake } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [session, setSession] = useState(false)
  const [counted, setCounted] = useState<Record<number, string>>({}) // itemId -> معدود
  const [scan, setScan] = useState('')
  const [notes, setNotes] = useState('')
  const [viewing, setViewing] = useState<Stocktake | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const entry = viewing?.journalEntryId ? journal.find((e) => e.id === viewing.journalEntryId) : null
  const active = useMemo(() => items.filter((it) => it.isActive), [items])

  const startSession = () => {
    setCounted({})
    setScan('')
    setNotes('')
    setSession(true)
    setTimeout(() => scanRef.current?.focus(), 50)
  }

  /** مسح باركود أثناء الجرد: كل مسحة تزيد المعدود 1 */
  const onScan = () => {
    const q = normalizeDigits(scan.trim())
    if (!q) return
    const it = active.find((x) => x.barcodes.includes(q) || x.sku === q || x.nameAr === q)
    if (!it) {
      toast.show(`لا صنف بالباركود «${q}»`, 'error')
      setScan('')
      return
    }
    setCounted((c) => ({ ...c, [it.id]: String((Number(c[it.id]) || 0) + 1) }))
    toast.show(`${it.nameAr} — المعدود ${(Number(counted[it.id]) || 0) + 1}`)
    setScan('')
  }

  /** الفوارق الحية أثناء الجلسة (الأصناف المعدودة فقط) */
  const liveCounts: CountInput[] = useMemo(
    () =>
      Object.entries(counted)
        .filter(([, v]) => v !== '')
        .map(([id, v]) => {
          const it = items.find((x) => x.id === Number(id))!
          return {
            itemId: it.id, nameAr: it.nameAr,
            expectedQty: it.stockQty ?? 0,
            countedQty: Number(normalizeDigits(v)) || 0,
            unitCostMinor: it.costMinor,
          }
        }),
    [counted, items],
  )
  const liveDiffs = liveCounts.filter((c) => c.countedQty !== c.expectedQty)

  // تسوية الجرد عملية حساسة (inv.adjust) — تغير قيمة 1103 بقيد؛ خلف موافقة المشرف
  const approval = useSupervisorApproval('inv.adjust')
  const submit = () => {
    if (!liveCounts.length) { toast.show('لم تعدّ أي صنف بعد', 'error'); return }
    approval.request(() => {
    try {
      const st = postStocktake(liveCounts, notes.trim())
      toast.show(
        st.journalEntryId
          ? `رُحّل الجرد ${st.stocktakeNumber} — ضُبط المخزون وتولد قيد التسوية ✓`
          : `رُحّل الجرد ${st.stocktakeNumber} — مطابق تماماً، لا حاجة لقيد 🎯`,
      )
      setSession(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
    })
  }

  return (
    <div className="space-y-4">
      {!session ? (
        <div className="anim-up rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark p-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2"><ClipboardList size={18} className="text-amber-500" /> جلسة جرد جديدة</div>
            <div className="text-[12px] text-slate-400 mt-1">امسح باركود كل قطعة (كل مسحة +1) أو اكتب المعدود يدوياً — الفوارق تُقيَّم بالتكلفة ويتولد قيد التسوية تلقائياً</div>
          </div>
          <Btn onClick={startSession} disabled={active.length === 0}><PlayCircle size={15} /> بدء الجرد</Btn>
        </div>
      ) : (
        <div className="anim-up rounded-3xl border-2 border-amber-500/30 bg-amber-500/[0.03] p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
              <ClipboardList size={18} className="text-amber-500" /> جلسة جرد جارية — {liveCounts.length} صنف معدود
              {liveDiffs.length > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">{liveDiffs.length} فارق</span>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={() => setSession(false)}>إلغاء الجلسة</Btn>
              <Btn onClick={submit} disabled={!liveCounts.length}>✅ ترحيل الجرد</Btn>
            </div>
          </div>

          <div className="relative">
            <ScanBarcode size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-500" />
            <input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onScan()}
              placeholder="امسح الباركود — كل مسحة تزيد المعدود 1… (أو اكتب المعدود في الجدول)"
              className={`${inputCls} pr-10 py-3 border-amber-300 dark:border-amber-700`}
            />
          </div>

          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[26rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 z-10">
                <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2.5 font-bold">الصنف</th>
                  <th className="px-4 py-2.5 font-bold">الدفتري</th>
                  <th className="px-4 py-2.5 font-bold w-28">المعدود</th>
                  <th className="px-4 py-2.5 font-bold">الفارق</th>
                  <th className="px-4 py-2.5 font-bold">قيمة الفارق</th>
                </tr>
              </thead>
              <tbody>
                {active.map((it) => {
                  const v = counted[it.id] ?? ''
                  const c = v === '' ? null : Number(normalizeDigits(v)) || 0
                  const diff = c === null ? null : Math.round((c - (it.stockQty ?? 0)) * 1000) / 1000
                  return (
                    <tr key={it.id} className={`border-b border-slate-50 dark:border-slate-800/50 ${diff ? (diff < 0 ? 'bg-rose-500/[0.04]' : 'bg-emerald-500/[0.04]') : ''}`}>
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{it.nameAr}<span className="text-[10px] text-slate-400 mr-2">{it.sku}</span></td>
                      <td className="px-4 py-2 text-slate-500">{it.stockQty ?? 0} {it.baseUnit}</td>
                      <td className="px-4 py-2">
                        <input
                          value={v}
                          onChange={(e) => setCounted((cc) => ({ ...cc, [it.id]: e.target.value }))}
                          placeholder="—"
                          className={`${inputCls} text-center py-1`}
                        />
                      </td>
                      <td className={`px-4 py-2 font-black ${diff === null || diff === 0 ? 'text-slate-300' : diff < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {diff === null ? '' : diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                      </td>
                      <td className={`px-4 py-2 font-bold text-[12px] ${diff === null || diff === 0 ? 'text-slate-300' : diff < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                        {diff ? fmt(Math.round(diff * it.costMinor)) : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات الجرد (اختياري): جرد نهاية الشهر…" className={inputCls} />
        </div>
      )}

      {/* سجل الجرد */}
      {stocktakes.length === 0 ? (
        !session && (
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
            <EmptyState icon="📋" title="لا جلسات جرد سابقة" sub="كل جلسة مرحّلة تُحفظ هنا بفوارقها وقيد تسويتها" />
          </div>
        )
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الجرد</th>
                <th className="px-4 py-3 font-bold">الأصناف</th>
                <th className="px-4 py-3 font-bold">الفوارق</th>
                <th className="px-4 py-3 font-bold">العجز</th>
                <th className="px-4 py-3 font-bold">الزيادة</th>
                <th className="px-4 py-3 font-bold">القيد</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {[...stocktakes].reverse().map((st, i) => (
                <tr key={st.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-amber-500/[0.03] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{st.stocktakeNumber}</div>
                    <div className="text-[11px] text-slate-400">{st.date.slice(0, 16).replace('T', ' ')}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{st.countedItems} ({st.result.matchedCount} مطابق)</td>
                  <td className="px-4 py-3">
                    {st.result.variances.length === 0 ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1 w-fit"><CheckCircle2 size={11} /> مطابق تماماً</span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold flex items-center gap-1 w-fit"><AlertTriangle size={11} /> {st.result.variances.length} فارق</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-rose-500">{st.result.shortageValueMinor ? `-${fmt(st.result.shortageValueMinor)}` : '—'}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{st.result.surplusValueMinor ? `+${fmt(st.result.surplusValueMinor)}` : '—'}</td>
                  <td className="px-4 py-3">
                    {st.journalEntryId ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                        <BookOpenText size={11} /> قيد #{st.journalEntryId}
                      </span>
                    ) : <span className="text-[11px] text-slate-300">بلا قيد</span>}
                  </td>
                  <td className="px-4 py-3 text-left">
                    <button onClick={() => setViewing(st)} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200 hover:scale-110">
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* عرض جرد مرحّل */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `الجرد ${viewing.stocktakeNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            {viewing.result.variances.length === 0 ? (
              <div className="text-center p-6 text-emerald-600 font-bold">🎯 جرد مطابق تماماً — {viewing.countedItems} صنفاً بلا أي فارق</div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">الدفتري</th><th className="px-3 py-2">المعدود</th><th className="px-3 py-2">الفارق</th><th className="px-3 py-2">القيمة</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.result.variances.map((v, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 font-bold">{v.nameAr}</td>
                      <td className="px-3 py-2">{v.expectedQty}</td>
                      <td className="px-3 py-2">{v.countedQty}</td>
                      <td className={`px-3 py-2 font-black ${v.diffQty < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{v.diffQty > 0 ? `+${v.diffQty}` : v.diffQty}</td>
                      <td className={`px-3 py-2 font-bold ${v.valueMinor < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{fmt(v.valueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {viewing.notes && <div className="text-[12px] text-slate-500">ملاحظات: {viewing.notes}</div>}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> قيد التسوية #{entry.entryNumber}
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
            )}
          </div>
        )}
      </Modal>
      {approval.dialog}
    </div>
  )
}
