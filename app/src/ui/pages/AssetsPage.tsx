/**
 * الأصول الثابتة والإهلاك (من مواصفة Easy Store):
 * اقتناء أصل بقيد (1201 / خزينة + موردون)، إهلاك شهري بالقسط الثابت
 * بقيد مجمع واحد (5107 / 1202)، وتقرير بقيمة دفترية لا تهبط تحت الخردة.
 */
import { useMemo, useState } from 'react'
import { Plus, TrendingDown, BookOpenText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { assetsReport, depreciationSchedule, nextDepreciationMonth } from '../../core/assets.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function AssetsPage() {
  const { assets, journal, addAsset, postMonthlyDepreciation } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)

  const report = useMemo(() => assetsReport(assets), [assets])
  const nowMonth = new Date().toISOString().slice(0, 7)
  const dueCount = assets.filter(
    (a) => a.monthsDepreciated < a.lifeMonths && nextDepreciationMonth(a.purchaseMonth, a.monthsDepreciated) <= nowMonth,
  ).length

  /* ─── إضافة أصل ─── */
  const [open, setOpen] = useState(false)
  const [nameAr, setNameAr] = useState('')
  const [cost, setCost] = useState('')
  const [salvage, setSalvage] = useState('')
  const [lifeYears, setLifeYears] = useState('5')
  const [paid, setPaid] = useState('')
  const [treasury, setTreasury] = useState('1101')
  const [notes, setNotes] = useState('')
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)

  const openNew = () => { setNameAr(''); setCost(''); setSalvage(''); setLifeYears('5'); setPaid(''); setNotes(''); setOpen(true) }

  const preview = useMemo(() => {
    try {
      const c = toM(cost)
      const s = toM(salvage)
      const months = Math.round(Number(lifeYears) * 12)
      if (c <= 0 || months < 1 || s >= c) return null
      const schedule = depreciationSchedule(c, s, months)
      return { monthly: schedule[0] ?? 0, months }
    } catch { return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost, salvage, lifeYears, cur.decimals])

  const save = () => {
    try {
      const a = addAsset({
        nameAr,
        costMinor: toM(cost),
        salvageMinor: toM(salvage),
        lifeMonths: Math.round(Number(lifeYears) * 12),
        paidMinor: paid.trim() ? toM(paid) : toM(cost),
        notes,
        treasury,
      })
      toast.show(`سُجّل الأصل ${a.assetNumber} وتولّد قيد الاقتناء ✅`)
      setOpen(false)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  const runDepreciation = () => {
    try {
      const r = postMonthlyDepreciation()
      toast.show(`رُحّل إهلاك ${r.assetCount} أصل بإجمالي ${fmt(r.totalMinor)} ${cur.symbol} ✅`)
    } catch (err) { toast.show((err as Error).message, 'error') }
  }

  /* ─── عرض قيد الاقتناء ─── */
  const [viewingEntryId, setViewingEntryId] = useState<number | null>(null)
  const viewEntry = viewingEntryId != null ? journal.find((e) => e.id === viewingEntryId) : null

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-2">
        <div className="grid grid-cols-3 gap-2 text-center text-[11.5px]">
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">تكلفة الأصول</div>
            <b>{fmt(report.totalCostMinor)}</b>
          </div>
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">مجمع الإهلاك</div>
            <b className="text-rose-500">{fmt(report.totalAccumulatedMinor)}</b>
          </div>
          <div className="rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-2">
            <div className="text-slate-400 text-[10px] font-bold">القيمة الدفترية</div>
            <b className="text-emerald-600">{fmt(report.totalBookMinor)}</b>
          </div>
        </div>
        <div className="flex gap-2">
          <Btn variant="soft" onClick={runDepreciation} disabled={dueCount === 0}>
            <span className="flex items-center gap-1.5"><TrendingDown size={15} /> ترحيل إهلاك الشهر{dueCount > 0 ? ` (${dueCount})` : ''}</span>
          </Btn>
          <Btn onClick={openNew}><span className="flex items-center gap-1.5"><Plus size={15} /> أصل جديد</span></Btn>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🏛️" title="لا أصول ثابتة بعد" sub="سجّل معداتك وأثاثك — الاقتناء بقيد، والإهلاك الشهري بقسط ثابت لا يضيع مليماً" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ animationDelay: '60ms' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-slate-400 text-[11px] border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 text-right font-bold">الأصل</th>
                <th className="px-4 py-3 text-right font-bold">التكلفة</th>
                <th className="px-4 py-3 text-right font-bold">مجمع الإهلاك</th>
                <th className="px-4 py-3 text-right font-bold">القيمة الدفترية</th>
                <th className="px-4 py-3 text-right font-bold">العمر</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => {
                const asset = assets.find((a) => a.id === r.assetId)!
                const pct = Math.round((r.monthsDepreciated / r.lifeMonths) * 100)
                return (
                  <tr key={r.assetId} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-700 dark:text-slate-200">{r.nameAr}</div>
                      <div className="text-[10px] text-slate-400">{asset.assetNumber} — <span dir="ltr">{asset.purchaseDate.slice(0, 10)}</span></div>
                    </td>
                    <td className="px-4 py-3 font-bold">{fmt(r.costMinor)}</td>
                    <td className="px-4 py-3 text-rose-500">{fmt(r.accumulatedMinor)}</td>
                    <td className="px-4 py-3 font-black text-emerald-600">{fmt(r.bookValueMinor)}</td>
                    <td className="px-4 py-3 min-w-[130px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className={`h-full rounded-full ${r.fullyDepreciated ? 'bg-slate-400' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">{r.monthsDepreciated}/{r.lifeMonths} شهر</span>
                      </div>
                      {r.fullyDepreciated && <div className="text-[10px] text-slate-400 mt-0.5">مُهلَك بالكامل — بقي بقيمة الخردة</div>}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <button onClick={() => setViewingEntryId(asset.purchaseEntryId)} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110" title="قيد الاقتناء"><BookOpenText size={15} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* أصل جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title="أصل ثابت جديد">
        <div className="space-y-3">
          <Field label="اسم الأصل *">
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} className={inputCls} placeholder="ثلاجة عرض، سيارة توزيع، أثاث…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`التكلفة (${cur.symbol}) *`}>
              <input value={cost} onChange={(e) => setCost(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label={`قيمة الخردة (${cur.symbol})`} hint="ما يتبقى بعد انتهاء العمر — لا يُهلك">
              <input value={salvage} onChange={(e) => setSalvage(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
            <Field label="العمر الإنتاجي (سنوات)">
              <input value={lifeYears} onChange={(e) => setLifeYears(e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label={`المدفوع نقداً (${cur.symbol})`} hint="فارغ = كله نقداً؛ الباقي آجل على مورد">
              <input value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls} dir="ltr" placeholder={cost || '0'} />
              <div className="mt-2"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></div>
            </Field>
          </div>
          {preview && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-[12px] flex items-center justify-between">
              <span className="text-slate-500">القسط الشهري ({preview.months} شهراً)</span>
              <b className="text-rose-500">{fmt(preview.monthly)} {cur.symbol} / شهر</b>
            </div>
          )}
          <Field label="ملاحظات">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!nameAr.trim() || !cost.trim()}>💾 تسجيل وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض قيد */}
      <Modal open={!!viewEntry} onClose={() => setViewingEntryId(null)} title={viewEntry ? `قيد #${viewEntry.entryNumber}` : ''}>
        {viewEntry && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-slate-500">{viewEntry.description}</p>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
              <table className="w-full text-[12px]">
                <tbody>
                  {viewEntry.lines.map((l, i) => (
                    <tr key={i} className="border-t border-rose-500/5">
                      <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                        {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {l.note ?? l.accountCode}
                      </td>
                      <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                      <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
