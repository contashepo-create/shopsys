/**
 * صفحة معرض السيارات (القرار 27):
 * كل سيارة بتكلفة شراء + تجهيزات مرسملة = تكلفة كاملة، فربحية البيع
 * دقيقة لكل سيارة. التحويل للتأجير ينشئ معدة في وحدة الإيجار (عقود
 * يومية/شهرية بعدّاد الكيلومترات) — تكامل بلا تكرار منطق.
 */
import { useMemo, useState } from 'react'
import { Plus, Car as CarIcon, Eye, BookOpenText, Wrench, HandCoins, KeySquare } from 'lucide-react'
import { useDataStore, type Car } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { showroomSummary } from '../../core/cars.ts'
import { Btn, Field, inputCls, Modal, useToast, EmptyState } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

const STATUS_LABEL: Record<Car['status'], { nameAr: string; cls: string }> = {
  in_stock: { nameAr: 'بالمعرض', cls: 'bg-sky-500/10 text-sky-600' },
  sold: { nameAr: 'مباعة', cls: 'bg-emerald-500/10 text-emerald-600' },
  renting: { nameAr: 'بالتأجير', cls: 'bg-amber-500/10 text-amber-600' },
}

export function CarsPage() {
  const { cars, journal, addCar, addCarPrep, sellCar, moveCarToRental } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const summary = useMemo(() => showroomSummary(cars.map((c) => ({ status: c.status, fullCostMinor: c.purchaseCostMinor + c.prepCostMinor, profitMinor: c.saleProfitMinor }))), [cars])

  /* شراء سيارة */
  const [open, setOpen] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [plate, setPlate] = useState('')
  const [cost, setCost] = useState('')
  const [odometer, setOdometer] = useState('0')
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [treasury, setTreasury] = useState('1101')

  const save = () => {
    try {
      const c = addCar({
        make: make.trim(), model: model.trim(), year: Number(year) || 0, plateOrVin: plate.trim(),
        purpose: 'sale', purchaseCostMinor: toMinor(cost, cur.decimals), odometerKm: Number(odometer) || 0,
        payment, notes: '', treasury,
      })
      toast.show(`أُضيفت ${c.make} ${c.model} للمخزون بقيد شراء ✅`)
      setOpen(false); setMake(''); setModel(''); setPlate(''); setCost(''); setOdometer('0')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تجهيز */
  const [prepFor, setPrepFor] = useState<Car | null>(null)
  const [prepAmount, setPrepAmount] = useState('')
  const [prepDesc, setPrepDesc] = useState('')
  const [prepPayment, setPrepPayment] = useState<'cash' | 'credit'>('cash')
  const [prepTreasury, setPrepTreasury] = useState('1101')

  const savePrep = () => {
    if (!prepFor) return
    try {
      addCarPrep(prepFor.id, toMinor(prepAmount, cur.decimals), prepPayment, prepDesc.trim(), prepTreasury)
      toast.show('رُسملت التكلفة على السيارة — ستدخل في حساب ربحية بيعها ✅')
      setPrepFor(null); setPrepAmount(''); setPrepDesc('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* بيع */
  const [sellFor, setSellFor] = useState<Car | null>(null)
  const [price, setPrice] = useState('')
  const [buyer, setBuyer] = useState('')
  const [sellVat, setSellVat] = useState(false)
  const [sellPayment, setSellPayment] = useState<'cash' | 'credit'>('cash')
  const [sellTreasury, setSellTreasury] = useState('1101')

  const doSell = () => {
    if (!sellFor) return
    try {
      const c = sellCar({
        carId: sellFor.id, priceMinor: toMinor(price, cur.decimals),
        vatPercent: sellVat ? setup.vatPercent : 0, payment: sellPayment, buyerName: buyer.trim(), treasury: sellTreasury,
      })
      const p = c.saleProfitMinor ?? 0
      toast.show(p >= 0 ? `بيعت بربح ${fmt(p)} ${cur.symbol} 🎉` : `بيعت بخسارة ${fmt(-p)} ${cur.symbol}`, p >= 0 ? 'success' : 'error')
      setSellFor(null); setPrice(''); setBuyer('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تحويل للتأجير */
  const [rentFor, setRentFor] = useState<Car | null>(null)
  const [dailyRate, setDailyRate] = useState('')
  const [monthlyRate, setMonthlyRate] = useState('')

  const doRent = () => {
    if (!rentFor) return
    try {
      moveCarToRental(rentFor.id, dailyRate ? toMinor(dailyRate, cur.decimals) : 0, monthlyRate ? toMinor(monthlyRate, cur.decimals) : 0)
      toast.show('حُولت السيارة لوحدة الإيجار — افتح عقودها من قسم «إيجار المعدات» 🔑')
      setRentFor(null); setDailyRate(''); setMonthlyRate('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* عرض */
  const [viewing, setViewing] = useState<Car | null>(null)
  const viewingLive = viewing ? cars.find((c) => c.id === viewing.id) ?? null : null
  const viewEntryIds = viewingLive ? new Set([viewingLive.purchaseEntryId, ...viewingLive.prepEntryIds, ...(viewingLive.saleEntryId != null ? [viewingLive.saleEntryId] : [])]) : new Set<number>()
  const viewEntries = journal.filter((e) => viewEntryIds.has(e.id))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black flex items-center gap-2"><CarIcon className="w-6 h-6 text-indigo-500" /> معرض السيارات</h1>
        <Btn onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> شراء سيارة</Btn>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        <div className="rounded-xl bg-sky-500/10 p-3"><div className="text-[11px] text-slate-500">بالمعرض</div><div className="font-black text-sky-600">{summary.inStock}</div></div>
        <div className="rounded-xl bg-amber-500/10 p-3"><div className="text-[11px] text-slate-500">بالتأجير</div><div className="font-black text-amber-600">{summary.renting}</div></div>
        <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">قيمة المخزون</div><div className="font-black">{fmt(summary.stockValueMinor)}</div></div>
        <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-[11px] text-slate-500">أرباح البيع ({summary.sold})</div><div className="font-black text-emerald-600">{fmt(summary.totalProfitMinor)}</div></div>
      </div>

      {cars.length === 0 ? (
        <EmptyState icon="🚗" title="لا سيارات بعد" sub="سجّل شراء أول سيارة — التجهيزات تُرسمل عليها فتكون ربحية البيع دقيقة لكل سيارة" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
              <tr>{['السيارة', 'اللوحة/الشاسيه', 'العدّاد', 'التكلفة الكاملة', 'البيع', 'الربح', 'الحالة', ''].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {cars.map((c) => {
                const full = c.purchaseCostMinor + c.prepCostMinor
                const st = STATUS_LABEL[c.status]
                return (
                  <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-indigo-500/5 transition-colors">
                    <td className="px-3 py-2.5 font-bold">{c.make} {c.model} <span className="text-slate-400 text-[11px]">{c.year}</span></td>
                    <td className="px-3 py-2.5 font-mono text-[12px]" dir="ltr">{c.plateOrVin}</td>
                    <td className="px-3 py-2.5">{c.odometerKm.toLocaleString('ar-EG')} كم</td>
                    <td className="px-3 py-2.5 font-bold">{fmt(full)} {c.prepCostMinor > 0 && <span className="text-[10px] text-slate-400">(+{fmt(c.prepCostMinor)} تجهيز)</span>}</td>
                    <td className="px-3 py-2.5">{c.salePriceMinor != null ? fmt(c.salePriceMinor) : '—'}</td>
                    <td className={`px-3 py-2.5 font-black ${c.saleProfitMinor == null ? 'text-slate-400' : c.saleProfitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{c.saleProfitMinor != null ? fmt(c.saleProfitMinor) : '—'}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${st.cls}`}>{st.nameAr}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {c.status === 'in_stock' && (
                          <>
                            <button onClick={() => { setPrepFor(c); setPrepAmount(''); setPrepDesc('') }} title="تجهيز يُرسمل" className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-500/10 transition-all hover:scale-110"><Wrench className="w-4 h-4" /></button>
                            <button onClick={() => { setSellFor(c); setPrice(''); setBuyer('') }} title="بيع" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><HandCoins className="w-4 h-4" /></button>
                            <button onClick={() => { setRentFor(c); setDailyRate(''); setMonthlyRate('') }} title="تحويل للتأجير" className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><KeySquare className="w-4 h-4" /></button>
                          </>
                        )}
                        <button onClick={() => setViewing(c)} title="التفاصيل والقيود" className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-500/10 transition-all hover:scale-110"><Eye className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* شراء */}
      <Modal open={open} onClose={() => setOpen(false)} title="شراء سيارة">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="الماركة *"><input value={make} onChange={(e) => setMake(e.target.value)} className={inputCls} placeholder="تويوتا" /></Field>
            <Field label="الموديل *"><input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} placeholder="كورولا" /></Field>
            <Field label="سنة الصنع"><input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="اللوحة / الشاسيه *"><input value={plate} onChange={(e) => setPlate(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label={`تكلفة الشراء (${cur.symbol}) *`}><input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="عدّاد الكيلومترات"><input value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
          </div>
          <Field label="السداد">
            <div className="flex gap-2">
              {(['cash', 'credit'] as const).map((p) => (
                <button key={p} onClick={() => setPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${payment === p ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                  {p === 'cash' ? 'نقدي' : 'آجل (مورد)'}
                </button>
              ))}
            </div>
            {payment === 'cash' && <div className="mt-2"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></div>}
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} disabled={!make.trim() || !model.trim() || !plate.trim() || !cost}>شراء وقيد</Btn>
          </div>
        </div>
      </Modal>

      {/* تجهيز */}
      <Modal open={!!prepFor} onClose={() => setPrepFor(null)} title={prepFor ? `تجهيز — ${prepFor.make} ${prepFor.model}` : ''}>
        {prepFor && (
          <div className="space-y-3">
            <Field label={`تكلفة التجهيز (${cur.symbol}) *`} hint="تُرسمل على السيارة وتدخل في ربحية بيعها"><input value={prepAmount} onChange={(e) => setPrepAmount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="الوصف"><input value={prepDesc} onChange={(e) => setPrepDesc(e.target.value)} className={inputCls} placeholder="سمكرة ودهان، قطع غيار…" /></Field>
            <Field label="السداد">
              <div className="flex gap-2">
                {(['cash', 'credit'] as const).map((p) => (
                  <button key={p} onClick={() => setPrepPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${prepPayment === p ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {p === 'cash' ? 'نقدي' : 'آجل'}
                  </button>
                ))}
              </div>
              {prepPayment === 'cash' && <div className="mt-2"><TreasuryPicker value={prepTreasury} onChange={setPrepTreasury} compact /></div>}
            </Field>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setPrepFor(null)}>إلغاء</Btn>
              <Btn onClick={savePrep} disabled={!prepAmount}>رسملة التكلفة</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* بيع */}
      <Modal open={!!sellFor} onClose={() => setSellFor(null)} title={sellFor ? `بيع — ${sellFor.make} ${sellFor.model} ${sellFor.year}` : ''}>
        {sellFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/30 p-3 text-[12px] font-bold text-indigo-700 dark:text-indigo-300">
              التكلفة الكاملة (شراء + تجهيز): {fmt(sellFor.purchaseCostMinor + sellFor.prepCostMinor)} {cur.symbol}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`سعر البيع (${cur.symbol}) *`}><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="المشتري"><input value={buyer} onChange={(e) => setBuyer(e.target.value)} className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="التحصيل">
                <div className="flex gap-2">
                  {(['cash', 'credit'] as const).map((p) => (
                    <button key={p} onClick={() => setSellPayment(p)} className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${sellPayment === p ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                      {p === 'cash' ? 'نقدي' : 'آجل'}
                    </button>
                  ))}
                </div>
                {sellPayment === 'cash' && <div className="mt-2"><TreasuryPicker value={sellTreasury} onChange={setSellTreasury} compact /></div>}
              </Field>
              <Field label="الضريبة">
                <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-600 cursor-pointer">
                  <input type="checkbox" checked={sellVat} onChange={(e) => setSellVat(e.target.checked)} className="accent-indigo-600" />
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">ض.ق.م {setup.vatPercent}٪</span>
                </label>
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setSellFor(null)}>إلغاء</Btn>
              <Btn onClick={doSell} disabled={!price}>بيع وقيد الربحية</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* تحويل للتأجير */}
      <Modal open={!!rentFor} onClose={() => setRentFor(null)} title={rentFor ? `تأجير — ${rentFor.make} ${rentFor.model}` : ''}>
        {rentFor && (
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[12px] font-bold text-amber-700 dark:text-amber-400">
              ستظهر السيارة كمعدة في قسم «إيجار المعدات» بعقود يومية/شهرية وعدّاد كيلومترات
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`إيجار يومي (${cur.symbol})`}><input value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label={`إيجار شهري (${cur.symbol})`}><input value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setRentFor(null)}>إلغاء</Btn>
              <Btn onClick={doRent} disabled={!dailyRate && !monthlyRate}>تحويل للتأجير</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* التفاصيل */}
      <Modal open={!!viewingLive} onClose={() => setViewing(null)} title={viewingLive ? `${viewingLive.make} ${viewingLive.model} ${viewingLive.year}` : ''} wide>
        {viewingLive && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">شراء</div><div className="font-black">{fmt(viewingLive.purchaseCostMinor)}</div></div>
              <div className="rounded-xl bg-orange-500/10 p-3"><div className="text-[11px] text-slate-500">تجهيزات</div><div className="font-black text-orange-600">{fmt(viewingLive.prepCostMinor)}</div></div>
              <div className="rounded-xl bg-slate-500/5 p-3"><div className="text-[11px] text-slate-500">بيع</div><div className="font-black">{viewingLive.salePriceMinor != null ? fmt(viewingLive.salePriceMinor) : '—'}</div></div>
              <div className="rounded-xl bg-emerald-500/10 p-3"><div className="text-[11px] text-slate-500">الربح</div><div className={`font-black ${(viewingLive.saleProfitMinor ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{viewingLive.saleProfitMinor != null ? fmt(viewingLive.saleProfitMinor) : '—'}</div></div>
            </div>
            {viewingLive.buyerName && <div className="text-[12px] text-slate-500">المشتري: <b>{viewingLive.buyerName}</b> — {viewingLive.soldAt?.slice(0, 10)}</div>}
            {viewEntries.map((e) => (
              <div key={e.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-rose-500/10 px-3 py-2 flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-[12px]">
                  <BookOpenText className="w-4 h-4" /> قيد #{e.entryNumber} — {e.description}
                </div>
                <table className="w-full text-[12px]"><tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5">{l.accountCode} — {ACCOUNT_NAMES[l.accountCode] ?? ''}</td>
                      <td className="px-3 py-1.5 text-emerald-600 font-bold">{l.debit ? fmt(l.debit) : ''}</td>
                      <td className="px-3 py-1.5 text-rose-600 font-bold">{l.credit ? fmt(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
