/**
 * الصرف الداخلي — استهلاك المخزون للتشغيل (طلب المالك):
 * الأنشطة التي تشتري مخزوناً ولا تبيعه (عيادة تستهلك مستلزمات، مغسلة منظفات،
 * ورشة زيوت، مكتب أدوات) تصرفه هنا بمستند موثق بغرض ← قيد
 * «مصروف (5114 افتراضياً) / مخزون 1103» بمتوسط التكلفة المرجح —
 * فيظهر المصروف في قائمة الدخل وقت الاستهلاك (المعالجة العالمية القياسية).
 */
import { useMemo, useState } from 'react'
import { PlusCircle, Eye, BookOpenText, Trash2 } from 'lucide-react'
import { useDataStore, type ConsumptionDoc } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { CONSUMPTION_PURPOSES, INTERNAL_USE_ACCOUNT } from '../../core/consumption.ts'
import { STANDARD_COA } from '../../core/ledger.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

interface DraftLine { itemId: string; qty: string }

export function ConsumptionPage() {
  const { items, consumptions, journal, postConsumption, customAccounts } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const active = useMemo(() => items.filter((it) => it.isActive), [items])

  // حسابات المصروفات المتاحة للصرف عليها: القياسية القابلة للترحيل + المخصصة (5xxx)
  const expenseAccounts = useMemo(() => [
    ...STANDARD_COA.filter((a) => a.rootType === 'expenses' && a.isPostable).map((a) => ({ code: a.code, nameAr: a.nameAr })),
    ...customAccounts.filter((a) => a.rootType === 'expenses').map((a) => ({ code: a.code, nameAr: a.nameAr })),
  ], [customAccounts])

  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState<string>(CONSUMPTION_PURPOSES[0])
  const [account, setAccount] = useState(INTERNAL_USE_ACCOUNT)
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

  const openNew = () => {
    setPurpose(CONSUMPTION_PURPOSES[0])
    setAccount(INTERNAL_USE_ACCOUNT)
    setNotes('')
    setLines([{ itemId: '', qty: '1' }])
    setOpen(true)
  }

  // الصرف الداخلي عملية حساسة (inv.adjust) — بضاعة تتحول مصروفاً؛ خلف موافقة المشرف
  const approval = useSupervisorApproval('inv.adjust')
  const save = () => {
    approval.request(() => {
    try {
      const doc = postConsumption({
        purpose,
        expenseAccount: account,
        lines: lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty) })),
        notes: notes.trim(),
      })
      toast.show(`رُحّل الصرف ${doc.consumptionNumber} بقيمة ${fmt(doc.totalCostMinor)} ${cur.symbol} — تولد قيد ${doc.expenseAccount}/1103 ✓`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
    })
  }

  const [viewing, setViewing] = useState<ConsumptionDoc | null>(null)
  const viewEntry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null
  const totalAll = consumptions.reduce((a, c) => a + c.totalCostMinor, 0)
  const accName = (code: string) => expenseAccounts.find((a) => a.code === code)?.nameAr ?? ACCOUNT_NAMES[code] ?? code

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
          البضاعة المشتراة تدخل المخزون أصلاً (1103) ولا تصير مصروفاً إلا عند استهلاكها —
          مستند الصرف الداخلي يوثق الاستهلاك بغرض واضح ويولّد قيد «مصروف / مخزون» بمتوسط التكلفة،
          فتظهر تكلفة التشغيل في قائمة الدخل في شهرها الصحيح (المعالجة المحاسبية العالمية).
        </p>
        <Btn onClick={openNew}><span className="flex items-center gap-1.5"><PlusCircle size={15} /> مستند صرف داخلي</span></Btn>
      </div>

      <div className="anim-up grid grid-cols-2 gap-3 max-w-md">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold">عدد المستندات</div>
          <div className="text-xl font-black text-slate-800 dark:text-white">{consumptions.length}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold">إجمالي المستهلك بالتكلفة</div>
          <div className="text-xl font-black text-amber-500">{fmt(totalAll)} {cur.symbol}</div>
        </div>
      </div>

      {consumptions.length === 0 ? (
        <EmptyState icon="📦" title="لا مستندات صرف داخلي" sub="عند سحب مستلزمات أو خامات للتشغيل سجّلها هنا لتظهر تكلفتها في قائمة الدخل" />
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">المستند</th>
                <th className="px-4 py-2.5">التاريخ</th>
                <th className="px-4 py-2.5">الغرض</th>
                <th className="px-4 py-2.5">حساب المصروف</th>
                <th className="px-4 py-2.5">الأصناف</th>
                <th className="px-4 py-2.5">القيمة بالتكلفة</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {[...consumptions].reverse().map((c) => (
                <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5 font-black text-slate-800 dark:text-white">{c.consumptionNumber}</td>
                  <td className="px-4 py-2.5 text-slate-400 font-mono text-[11px]" dir="ltr">{c.date.slice(0, 10)}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10.5px] font-bold">{c.purpose}</span></td>
                  <td className="px-4 py-2.5 text-slate-500 text-[11.5px]">{accName(c.expenseAccount)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{c.lines.length}</td>
                  <td className="px-4 py-2.5 font-bold text-amber-500">{fmt(c.totalCostMinor)}</td>
                  <td className="px-4 py-2.5 text-left">
                    <button onClick={() => setViewing(c)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* مستند جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="📦 مستند صرف داخلي (استهلاك تشغيل)" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="الغرض *" hint="التوثيق إلزامي — يظهر في القيد والسجل">
              <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls}>
                {CONSUMPTION_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="حساب المصروف" hint="افتراضياً 5114 مستهلكات تشغيل — اختر حساباً أدق إن أردت">
              <select value={account} onChange={(e) => setAccount(e.target.value)} className={inputCls}>
                {expenseAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.nameAr}</option>)}
              </select>
            </Field>
            <Field label="ملاحظات">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="القسم المستفيد / أمر التشغيل…" />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold text-slate-500">الأصناف المصروفة (بمتوسط التكلفة المرجح)</span>
              <button onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])} className="text-[11px] font-bold text-amber-600 hover:underline">+ إضافة صنف</button>
            </div>
            {lines.map((l, i) => {
              const it = items.find((x) => x.id === Number(l.itemId))
              return (
                <div key={i} className="grid grid-cols-[1fr_70px_110px_28px] gap-1.5 items-center">
                  <select value={l.itemId} onChange={(e) => patch(i, { itemId: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px]`}>
                    <option value="">— اختر الصنف —</option>
                    {active.map((x) => <option key={x.id} value={x.id}>{x.nameAr} (متاح {x.stockQty ?? 0})</option>)}
                  </select>
                  <input value={l.qty} onChange={(e) => patch(i, { qty: e.target.value })} className={`${inputCls} !py-1.5 !text-[12px] text-center`} dir="ltr" />
                  <div className="text-[11px] text-slate-400 text-center">{it ? `${fmt(Math.round((Number(l.qty) || 0) * it.costMinor))} ${cur.symbol}` : '—'}</div>
                  <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="p-1.5 rounded text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/15 p-3.5 flex items-center justify-between text-[12.5px]">
            <span className="font-bold text-slate-600 dark:text-slate-300">إجمالي المصروف الذي سيظهر في قائمة الدخل</span>
            <b className="text-amber-500 text-base">{fmt(totalPreview)} {cur.symbol}</b>
          </div>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save}>📦 ترحيل الصرف وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `المستند ${viewing.consumptionNumber}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">التاريخ</div><b dir="ltr">{viewing.date.slice(0, 10)}</b></div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3"><div className="text-slate-400">الغرض</div><b>{viewing.purpose}</b></div>
              <div className="rounded-xl bg-amber-500/5 p-3"><div className="text-slate-400">القيمة</div><b className="text-amber-500">{fmt(viewing.totalCostMinor)}</b></div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-[12px]">
                <tbody>
                  {viewing.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-4 py-1.5 font-bold">{l.nameAr}</td>
                      <td className="px-4 py-1.5 text-slate-400">{l.qty} × {fmt(l.unitCostMinor)}</td>
                      <td className="px-4 py-1.5 font-bold text-left text-amber-500">{fmt(Math.round(l.qty * l.unitCostMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewEntry && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-amber-600 dark:text-amber-400 border-b border-amber-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المتولد #{viewEntry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {viewEntry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-amber-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">{l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {accName(l.accountCode)}</td>
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
