import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الإتلاف — الهالك والتوالف (مراجعة نشاط الأغذية/السوبرماركت):
 * البضاعة المنتهية/التالفة تُعدم بمستند موثق بسبب ← قيد 5111 هالك / 1103 مخزون
 * ويُخصم الرصيد وتُستهلك دفعات الصلاحية الأقدم أولاً.
 */
import { useMemo, useState } from 'react'
import { Trash2, PlusCircle, Eye, BookOpenText, AlertTriangle } from 'lucide-react'
import { useDataStore, type WastageDoc } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { WASTAGE_REASONS } from '../../core/wastage.ts'
import { expiryAlerts } from '../../core/batches.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

interface DraftLine { itemId: string; qty: string }

export function WastagePage() {
  const { items, batches, wastages, journal, postWastage } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const active = useMemo(() => items.filter((it) => it.isActive), [items])
  const today = new Date().toISOString().slice(0, 10)

  // أصناف منتهية الصلاحية حالياً — مرشحة فورية للإعدام
  const expiredNow = useMemo(
    () => expiryAlerts(batches, (id) => items.find((it) => it.id === id)?.nameAr ?? '—', today, 0).filter((a) => a.status === 'expired'),
    [batches, items, today],
  )

  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>(WASTAGE_REASONS[0])
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: '', qty: '1' }])
  const patch = (i: number, p: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)))

  const totalPreview = useMemo(() => {
    let t = 0
    for (const l of lines) {
      const it = items.find((x) => x.id === Number(l.itemId))
      if (it) t += Math.round((Number(l.qty) || 0) * it.costMinor)
    }
    return t
  }, [lines, items])

  const openNew = (prefill?: { itemId: number; qty: number }[]) => {
    setReason(prefill ? 'انتهاء صلاحية' : WASTAGE_REASONS[0])
    setNotes('')
    setLines(prefill?.length ? prefill.map((p) => ({ itemId: String(p.itemId), qty: String(p.qty) })) : [{ itemId: '', qty: '1' }])
    setOpen(true)
  }

  // الإتلاف عملية حساسة (inv.adjust) — بضاعة تخرج بلا مقابل؛ خلف موافقة المشرف
  const approval = useSupervisorApproval('inv.adjust')
  const save = () => {
    approval.request(() => {
    try {
      const doc = postWastage({
        reason,
        lines: lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })),
        notes: notes.trim(),
      })
      toast.show(`رُحّل الإتلاف ${doc.wastageNumber} بقيمة ${fmt(doc.totalCostMinor)} ${cur.symbol} — تولد قيد 5111/1103 ✓`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
    })
  }

  const [viewing, setViewing] = useState<WastageDoc | null>(null)
  const viewEntry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  const totalAll = wastages.reduce((a, w) => a + w.totalCostMinor, 0)

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between">
        <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
          مستند الإعدام يوثق الهالك بسبب واضح ويولّد قيد «هالك وتوالف 5111 / مخزون 1103» بمتوسط التكلفة — فتظهر خسائر التلف صراحة في قائمة الدخل بدل ضياعها في فروق الجرد.
        </p>
        <Btn onClick={() => openNew()}><span className="flex items-center gap-1.5"><PlusCircle size={15} /> مستند إتلاف</span></Btn>
      </div>

      {expiredNow.length > 0 && (
        <div className="anim-up rounded-2xl border-2 border-rose-500/30 bg-rose-500/5 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[12.5px] font-bold text-rose-600 dark:text-rose-400">
            <AlertTriangle size={16} /> {expiredNow.length} دفعة منتهية الصلاحية بالمخزون الآن — مرشحة للإعدام الفوري
          </div>
          <Btn variant="ghost" className="border border-rose-500/30 !text-rose-600" onClick={() => {
            const agg = new Map<number, number>()
            for (const a of expiredNow) agg.set(a.itemId, (agg.get(a.itemId) ?? 0) + a.qty)
            openNew([...agg].map(([itemId, qty]) => ({ itemId, qty })))
          }}>
            إعدامها كلها بمستند واحد
          </Btn>
        </div>
      )}

      <div className="anim-up grid grid-cols-2 gap-3 max-w-md">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold">عدد المستندات</div>
          <div className="text-xl font-black text-slate-800 dark:text-white">{wastages.length}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold">إجمالي الهالك بالتكلفة</div>
          <div className="text-xl font-black text-rose-500">{fmt(totalAll)} {cur.symbol}</div>
        </div>
      </div>

      {wastages.length === 0 ? (
        <EmptyState icon="🗑️" title="لا مستندات إتلاف" sub="عند إعدام بضاعة منتهية أو تالفة سجّلها هنا لتظهر خسارتها في قائمة الدخل" />
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">المستند</th>
                <th className="px-4 py-2.5">التاريخ</th>
                <th className="px-4 py-2.5">السبب</th>
                <th className="px-4 py-2.5">الأصناف</th>
                <th className="px-4 py-2.5">القيمة بالتكلفة</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {[...wastages].reverse().map((w) => (
                <tr key={w.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-black text-slate-800 dark:text-white">{w.wastageNumber}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]" dir="ltr">{w.date.slice(0, 10)}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[10.5px] font-bold">{w.reason}</span></td>
                  <td className="px-4 py-2.5 text-slate-500">{w.lines.length}</td>
                  <td className="px-4 py-2.5 font-bold text-rose-500">{fmt(w.totalCostMinor)}</td>
                  <td className="px-4 py-2.5 text-left">
                    <button onClick={() => setViewing(w)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* مستند جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="🗑️ مستند إتلاف مخزون" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="سبب الإتلاف *" hint="التوثيق إلزامي — يظهر في القيد والسجل">
              <QuickSelect value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                {WASTAGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </QuickSelect>
            </Field>
            <Field label="ملاحظات">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="رقم محضر / لجنة الإعدام…" />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-slate-500">الأصناف المُعدمة (بمتوسط التكلفة المرجح)</span>
              <button onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])} className="text-[11px] font-bold text-rose-600 hover:underline">+ إضافة صنف</button>
            </div>
            {lines.map((l, i) => {
              const it = items.find((x) => x.id === Number(l.itemId))
              return (
                <div key={i} className="grid grid-cols-[1fr_70px_110px_28px] gap-1.5 items-center">
                  <QuickSelect value={l.itemId} onChange={(e) => patch(i, { itemId: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`}>
                    <option value="">— اختر الصنف —</option>
                    {active.map((x) => <option key={x.id} value={x.id}>{x.nameAr} (متاح {x.stockQty ?? 0})</option>)}
                  </QuickSelect>
                  <input value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" />
                  <div className="text-[11px] text-slate-400 text-center">{it ? `${fmt(Math.round((Number(l.qty) || 0) * it.costMinor))} ${cur.symbol}` : '—'}</div>
                  <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl bg-rose-500/5 border border-rose-500/15 p-3.5 flex items-center justify-between text-[12.5px]">
            <span className="font-bold text-slate-600 dark:text-slate-300">إجمالي الخسارة التي ستظهر في قائمة الدخل</span>
            <b className="text-rose-500 text-base">{fmt(totalPreview)} {cur.symbol}</b>
          </div>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} shortcut="F9">🗑️ ترحيل الإتلاف وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `المستند ${viewing.wastageNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">التاريخ</div><b dir="ltr">{viewing.date.slice(0, 10)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">السبب</div><b>{viewing.reason}</b></div>
              <div className="rounded-xl bg-rose-500/5 p-3"><div className="text-slate-400">القيمة</div><b className="text-rose-500">{fmt(viewing.totalCostMinor)}</b></div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12px]">
                <tbody>
                  {viewing.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-1.5 font-bold">{l.nameAr}</td>
                      <td className="px-4 py-1.5 text-slate-400">{l.qty} × {fmt(l.unitCostMinor)}</td>
                      <td className="px-4 py-1.5 font-bold text-left text-rose-500">{fmt(Math.round(l.qty * l.unitCostMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewEntry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{viewEntry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewEntry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}</td>
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
