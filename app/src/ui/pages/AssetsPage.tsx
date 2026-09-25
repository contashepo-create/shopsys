import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
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
import { assetsReport, depreciationSchedule, nextDepreciationMonth, ASSET_FUNDING_LABELS, type AssetFunding } from '../../core/assets.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function AssetsPage() {
  const { assets, journal, suppliers, addAsset, postMonthlyDepreciation, payAssetInstallment, getAssetDue } = useDataStore()
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
  // مصدر التمويل + المورد + الأقساط (طلب المالك: أصل بلا دفع = رأس مال/جاري شريك، والآجل على مورد حقيقي)
  const [funding, setFunding] = useState<AssetFunding>('cash')
  const [supplierId, setSupplierId] = useState('')
  const [instCount, setInstCount] = useState('')
  const [instInterval, setInstInterval] = useState('1')
  const [instFirstDate, setInstFirstDate] = useState('')
  const toM = (s: string) => (s.trim() ? toMinor(s, cur.decimals) : 0)

  const openNew = () => { setNameAr(''); setCost(''); setSalvage(''); setLifeYears('5'); setPaid(''); setNotes(''); setFunding('cash'); setSupplierId(''); setInstCount(''); setInstInterval('1'); setInstFirstDate(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)); setOpen(true) }

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
        paidMinor: funding === 'cash' ? (paid.trim() ? toM(paid) : toM(cost)) : 0,
        notes,
        treasury,
        funding,
        supplierId: supplierId ? Number(supplierId) : null,
        installmentCount: instCount.trim() ? Number(instCount) : undefined,
        installmentIntervalMonths: Number(instInterval) || 1,
        firstInstallmentDate: instFirstDate || undefined,
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

  // الجزء الآجل المتوقع (لإظهار حقول المورد والأقساط)
  const remainingPreview = useMemo(() => {
    try {
      const c = toM(cost)
      if (funding === 'supplier_credit') return c
      if (funding === 'cash') return Math.max(0, c - (paid.trim() ? toM(paid) : c))
      return 0
    } catch { return 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost, paid, funding, cur.decimals])

  /* ─── ملف الأصل (التفاصيل + الأقساط + السداد) ─── */
  const [fileAssetId, setFileAssetId] = useState<number | null>(null)
  const fileAsset = fileAssetId != null ? assets.find((a) => a.id === fileAssetId) : null
  const fileDue = fileAsset ? getAssetDue(fileAsset.id) : null
  const [payAmount, setPayAmount] = useState('')
  const [payTreasury, setPayTreasury] = useState('1101')
  const doPay = () => {
    if (!fileAsset) return
    try {
      payAssetInstallment({ assetId: fileAsset.id, amountMinor: toM(payAmount), treasury: payTreasury as '1101' })
      toast.show('سُدّدت الدفعة وتولّد قيد الصرف ✅')
      setPayAmount('')
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
                    <td className="px-4 py-3 text-left whitespace-nowrap">
                      {(() => { const d = getAssetDue(asset.id); return d.remainingMinor > 0 ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold ml-1">متبقٍ {fmt(d.remainingMinor)}</span> : null })()}
                      <button onClick={() => setFileAssetId(asset.id)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-sky-600 hover:bg-sky-500/10 transition-all" title="ملف الأصل">📂 الملف</button>
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
            <Field label="مصدر التمويل *" hint="أصل بلا دفع من الخزينة؟ اختر رأس المال أو جاري الشريك">
              <QuickSelect value={funding} onChange={(e) => setFunding(e.target.value as AssetFunding)} className={inputCls}>
                {(Object.keys(ASSET_FUNDING_LABELS) as AssetFunding[]).map((f) => (
                  <option key={f} value={f}>{ASSET_FUNDING_LABELS[f]}</option>
                ))}
              </QuickSelect>
            </Field>
          </div>
          {funding === 'cash' && (
            <Field label={`المدفوع نقداً (${cur.symbol})`} hint="فارغ = كله نقداً؛ الباقي آجل على المورد المحدد">
              <input value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls} dir="ltr" placeholder={cost || '0'} />
              <div className="mt-2"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></div>
            </Field>
          )}
          {remainingPreview > 0 && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-3">
              <div className="text-[12px] font-black text-amber-700 dark:text-amber-400">دين آجل {fmt(remainingPreview)} {cur.symbol} — يُربط بمورد حقيقي وتتم متابعته وسداده</div>
              <Field label="المورد *" hint="غير موجود؟ سجّله أولاً من المشتريات ← الموردون">
                <PartyQuickPicker parties={suppliers} value={supplierId ? Number(supplierId) : 0} onChange={(id) => setSupplierId(String(id))} cashLabel="اكتب اسم المورد" label="بحث المورد" showCash={false} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="عدد الأقساط" hint="فارغ أو 1 = دفعة واحدة">
                  <input value={instCount} onChange={(e) => setInstCount(e.target.value)} className={inputCls} dir="ltr" placeholder="—" />
                </Field>
                <Field label="كل كم شهر؟">
                  <input value={instInterval} onChange={(e) => setInstInterval(e.target.value)} className={inputCls} dir="ltr" />
                </Field>
                <Field label="أول استحقاق">
                  <input type="date" value={instFirstDate} onChange={(e) => setInstFirstDate(e.target.value)} className={inputCls} dir="ltr" />
                </Field>
              </div>
            </div>
          )}
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
            <Btn onClick={save} shortcut="F9" disabled={!nameAr.trim() || !cost.trim()}>💾 تسجيل وتوليد القيد</Btn>
          </div>
        </div>
      </Modal>

      {/* ملف الأصل الكامل: تمويل + مورد + جدول أقساط + سداد (طلب المالك) */}
      <Modal open={!!fileAsset} onClose={() => setFileAssetId(null)} title={fileAsset ? `📂 ملف الأصل ${fileAsset.assetNumber} — ${fileAsset.nameAr}` : ''} wide>
        {fileAsset && fileDue && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11.5px]">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-slate-400 text-[10px] font-bold">التكلفة</div>
                <b>{fmt(fileAsset.costMinor)}</b>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-slate-400 text-[10px] font-bold">مصدر التمويل</div>
                <b className="text-[10.5px]">{ASSET_FUNDING_LABELS[fileAsset.funding ?? 'cash'].split(' (')[0].split(' —')[0]}</b>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-slate-400 text-[10px] font-bold">المسدد من الدين</div>
                <b className="text-emerald-600">{fmt(fileDue.paidMinor)}</b>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                <div className="text-slate-400 text-[10px] font-bold">المتبقي</div>
                <b className={fileDue.remainingMinor > 0 ? 'text-amber-600' : 'text-emerald-600'}>{fmt(fileDue.remainingMinor)}</b>
              </div>
            </div>

            {fileAsset.supplierId != null && (
              <div className="text-[12px] text-slate-500">
                المورد: <b className="text-slate-700 dark:text-slate-200">{suppliers.find((sp) => sp.id === fileAsset.supplierId)?.nameAr ?? `#${fileAsset.supplierId}`}</b>
                {' '}— الدين يظهر ضمن حساب الموردين (2101) ويُسدد من هنا بقيد صرف موثق
              </div>
            )}

            {(fileAsset.installments?.length ?? 0) > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-black text-slate-500 bg-slate-50 dark:bg-slate-900/40">جدول الأقساط</div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-slate-400 text-[10px] border-b border-slate-100 dark:border-slate-800">
                      <th className="px-3 py-2 text-right font-bold">#</th>
                      <th className="px-3 py-2 text-right font-bold">الاستحقاق</th>
                      <th className="px-3 py-2 text-right font-bold">القسط</th>
                      <th className="px-3 py-2 text-right font-bold">المسدد</th>
                      <th className="px-3 py-2 text-right font-bold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fileAsset.installments ?? []).map((it) => {
                      const done = it.paidMinor >= it.amountMinor
                      const overdue = !done && it.dueDate < new Date().toISOString().slice(0, 10)
                      return (
                        <tr key={it.seq} className="border-b border-slate-50 dark:border-slate-800/50">
                          <td className="px-3 py-1.5 font-bold">{it.seq}</td>
                          <td className="px-3 py-1.5" dir="ltr">{it.dueDate}</td>
                          <td className="px-3 py-1.5 font-bold">{fmt(it.amountMinor)}</td>
                          <td className="px-3 py-1.5 text-emerald-600">{fmt(it.paidMinor)}</td>
                          <td className="px-3 py-1.5">
                            {done ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">مسدد ✓</span>
                              : overdue ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold">متأخر!</span>
                              : <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-400/10 text-slate-400 font-bold">قادم</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {(fileAsset.payments?.length ?? 0) > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 text-[11px] font-black text-slate-500 bg-slate-50 dark:bg-slate-900/40">سجل السدادات</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {(fileAsset.payments ?? []).map((p) => (
                      <tr key={p.id} className="border-b border-slate-50 dark:border-slate-800/50">
                        <td className="px-3 py-1.5" dir="ltr">{p.date.slice(0, 10)}</td>
                        <td className="px-3 py-1.5 font-bold text-emerald-600">{fmt(p.amountMinor)}</td>
                        <td className="px-3 py-1.5 text-[10px] text-slate-400">قيد #{p.journalEntryId}{p.installmentSeq ? ` — بدءاً من قسط ${p.installmentSeq}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {fileDue.remainingMinor > 0 && (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2">
                <div className="text-[12px] font-black text-emerald-700 dark:text-emerald-400">
                  سداد دفعة {fileDue.nextInstallment ? `— القسط القادم ${fmt(fileDue.nextInstallment.amountMinor - fileDue.nextInstallment.paidMinor)} بتاريخ ${fileDue.nextInstallment.dueDate}` : ''}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-2 items-end">
                  <Field label={`المبلغ (${cur.symbol})`}>
                    <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
                  </Field>
                  <Field label="الصرف من">
                    <TreasuryPicker value={payTreasury} onChange={setPayTreasury} compact />
                  </Field>
                  <Btn onClick={doPay} shortcut="F9" disabled={!payAmount.trim()}>💸 سداد وتوليد القيد</Btn>
                </div>
              </div>
            )}
          </div>
        )}
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
