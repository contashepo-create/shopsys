/**
 * الصاغة — سعر الجرام اليومي + المصنعية + الكسر
 * السعر = الوزن × جرام العيار + المصنعية، ويعاد تسعير المحل كله بضغطة.
 */
import { useMemo, useState } from 'react'
import { Gem, RefreshCcw, Scale, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { KARAT_LABELS, ALL_KARATS, jewelryBreakdown, pricesAreStale, computeTradeInNet, type Karat } from '../../core/jewelry.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function JewelryPage() {
  const {
    items, gramPrices, jewelryProfiles, scrapLots, scrapSales, goldTradeIns, customers,
    setGramPrices, setJewelryProfile, buyScrap, sellScrap, postGoldTradeIn,
  } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const stale = pricesAreStale(gramPrices, new Date().toISOString())

  /* أسعار اليوم */
  const [priceOpen, setPriceOpen] = useState(false)
  const [p18, setP18] = useState('')
  const [p21, setP21] = useState('')
  const [p24, setP24] = useState('')
  const savePrices = () => {
    try {
      setGramPrices({ k18: toMinor(p18, cur.decimals), k21: toMinor(p21, cur.decimals), k24: toMinor(p24, cur.decimals) })
      const n = useDataStore.getState().repriceJewelry()
      toast.show(`حُدثت أسعار اليوم وأعيد تسعير ${n} صنفاً ✅`)
      setPriceOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* وصف ذهبي لصنف */
  const [profileOpen, setProfileOpen] = useState(false)
  const [profItem, setProfItem] = useState('')
  const [profKarat, setProfKarat] = useState<Karat>('k21')
  const [profWeight, setProfWeight] = useState('')
  const [profWork, setProfWork] = useState('')
  const saveProfile = () => {
    try {
      setJewelryProfile({ itemId: Number(profItem), karat: profKarat, weightGrams: Number(profWeight), workmanshipMinor: toMinor(profWork || '0', cur.decimals) })
      toast.show('وُصف الصنف ذهبياً وسُعّر من سعر اليوم ✅')
      setProfileOpen(false); setProfItem(''); setProfWeight(''); setProfWork('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* كسر: شراء/بيع */
  const [scrapMode, setScrapMode] = useState<'buy' | 'sell' | null>(null)
  const [scKarat, setScKarat] = useState<Karat>('k21')
  const [scWeight, setScWeight] = useState('')
  const [scPrice, setScPrice] = useState('')
  const [scName, setScName] = useState('')
  const [scTreasury, setScTreasury] = useState('1101')
  const saveScrap = () => {
    try {
      const args = { karat: scKarat, weightGrams: Number(scWeight), pricePerGramMinor: toMinor(scPrice, cur.decimals), treasury: scTreasury }
      if (scrapMode === 'buy') {
        buyScrap({ ...args, sellerName: scName.trim() })
        toast.show('دخل الكسر المخزون وقُيد 1103/الخزينة ✅')
      } else {
        const s = sellScrap({ ...args, buyerName: scName.trim() })
        toast.show(`بيع الكسر: ${s.profitMinor >= 0 ? 'ربح' : 'خسارة'} ${fmt(Math.abs(s.profitMinor))} ✅`)
      }
      setScrapMode(null); setScWeight(''); setScPrice(''); setScName('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* مقايضة: بيع مشغول جديد + كسر العميل جزء من الثمن (جولة الصاغة) */
  const [tradeOpen, setTradeOpen] = useState(false)
  const [trItem, setTrItem] = useState('')
  const [trCustomer, setTrCustomer] = useState('')
  const [trKarat, setTrKarat] = useState<Karat>('k21')
  const [trWeight, setTrWeight] = useState('')
  const [trGramPrice, setTrGramPrice] = useState('')
  const [trTreasury, setTrTreasury] = useState('1101')
  const tradeItem = items.find((it) => it.id === Number(trItem))
  const tradePreview = (() => {
    if (!tradeItem || !(Number(trWeight) > 0) || !trGramPrice.trim()) return null
    try { return computeTradeInNet(tradeItem.priceMinor, Number(trWeight), toMinor(trGramPrice, cur.decimals)) } catch { return null }
  })()
  const saveTrade = () => {
    if (!tradeItem) return
    try {
      const doc = postGoldTradeIn({
        lines: [{ itemId: tradeItem.id, nameAr: tradeItem.nameAr, qty: 1, unitPriceMinor: tradeItem.priceMinor, unitCostMinor: tradeItem.costMinor, discountPercent: 0, soldByWeight: false }],
        customerId: trCustomer ? Number(trCustomer) : null,
        scrapKarat: trKarat,
        scrapWeightGrams: Number(trWeight),
        scrapPricePerGramMinor: toMinor(trGramPrice, cur.decimals),
        treasury: trTreasury as never,
        taxPercent: setup.vatPercent,
        taxInclusive: setup.taxInclusive,
      })
      toast.show(
        doc.netMinor === 0
          ? `مقايضة متكافئة ${doc.tradeNumber} — لا فرق نقدي ✅`
          : doc.netMinor > 0
            ? `${doc.tradeNumber}: العميل دفع فرقاً ${fmt(doc.netMinor)} ✅`
            : `${doc.tradeNumber}: رُدّ للعميل ${fmt(-doc.netMinor)} ✅`,
      )
      setTradeOpen(false); setTrItem(''); setTrWeight(''); setTrGramPrice(''); setTrCustomer('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const scrapByKarat = useMemo(() => {
    const m = new Map<Karat, { grams: number; valueMinor: number }>()
    for (const k of ALL_KARATS) m.set(k, { grams: 0, valueMinor: 0 })
    for (const l of scrapLots) {
      const e = m.get(l.karat)!
      e.grams += l.remainingGrams
      e.valueMinor += Math.round(l.remainingGrams * l.pricePerGramMinor)
    }
    return m
  }, [scrapLots])

  const profiled = jewelryProfiles
    .map((p) => ({ p, item: items.find((it) => it.id === p.itemId) }))
    .filter((x) => x.item)

  /* تقييم المخزون الذهبي بالعيار بسعر اليوم (نمط SwilERP/BUSY valuation report):
     لكل عيار: مجموع (وزن القطعة × رصيدها) × جرام اليوم + كسر العيار بوزنه × جرام اليوم */
  const valuation = useMemo(() => {
    const per = new Map(ALL_KARATS.map((k) => [k, { grams: 0, pieces: 0, goldMinor: 0 }]))
    for (const { p, item } of profiled) {
      const qty = Math.max(0, item!.stockQty ?? 0)
      if (qty <= 0) continue
      const row = per.get(p.karat)!
      row.grams += p.weightGrams * qty
      row.pieces += qty
      row.goldMinor += Math.round(p.weightGrams * qty * (gramPrices[p.karat] ?? 0))
    }
    // كسر المحل (اللوطات المتبقية) يقيم بسعر اليوم أيضاً
    for (const k of ALL_KARATS) {
      const sc = scrapByKarat.get(k)
      if (sc && sc.grams > 0) per.get(k)!.goldMinor += Math.round(sc.grams * (gramPrices[k] ?? 0))
    }
    const totalMinor = [...per.values()].reduce((a, r) => a + r.goldMinor, 0)
    return { per, totalMinor }
  }, [profiled, gramPrices, scrapByKarat])

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><Gem className="w-6 h-6 text-yellow-500" /> الصاغة — الذهب اليومي والكسر</h1>
          <p className="text-[12px] text-slate-500 mt-1">سعر القطعة = الوزن × جرام العيار + المصنعية — ويعاد تسعير المحل كله بضغطة</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="soft" onClick={() => setTradeOpen(true)}>♻️ بيع بمقايضة كسر</Btn>
          <Btn variant="soft" onClick={() => setProfileOpen(true)}><Scale className="w-4 h-4" /> وصف صنف ذهبياً</Btn>
          <Btn onClick={() => { setP18(gramPrices.k18 ? String(gramPrices.k18 / 10 ** cur.decimals) : ''); setP21(gramPrices.k21 ? String(gramPrices.k21 / 10 ** cur.decimals) : ''); setP24(gramPrices.k24 ? String(gramPrices.k24 / 10 ** cur.decimals) : ''); setPriceOpen(true) }}>
            <RefreshCcw className="w-4 h-4" /> أسعار اليوم
          </Btn>
        </div>
      </div>

      {stale && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-[12px] font-bold text-rose-700 dark:text-rose-300">
          ⚠️ أسعار الجرام {gramPrices.updatedAt ? `من ${gramPrices.updatedAt.slice(0, 10)}` : 'غير مدخلة'} — حدّثها قبل البيع
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {ALL_KARATS.map((k) => (
          <div key={k} className="rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-3 text-center">
            <div className="text-[11px] font-bold text-slate-500">{KARAT_LABELS[k]}</div>
            <div className="text-xl font-black text-yellow-600">{gramPrices[k] ? fmt(gramPrices[k]) : '—'}</div>
            <div className="text-[10px] text-slate-400">للجرام{scrapByKarat.get(k)!.grams > 0 && ` — كسر: ${scrapByKarat.get(k)!.grams} جم`}</div>
          </div>
        ))}
      </div>

      {/* تقييم المخزون الذهبي بسعر اليوم (نمط SwilERP valuation) */}
      {valuation.totalMinor > 0 && (
        <div className="rounded-2xl border border-yellow-500/30 bg-gradient-to-l from-yellow-500/10 to-transparent p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-[11px] font-bold text-slate-500">💰 قيمة الذهب في المحل بسعر اليوم (أصناف × أرصدتها + الكسر)</div>
              <div className="text-2xl font-black text-yellow-600">{fmt(valuation.totalMinor)} {cur.symbol}</div>
            </div>
            <div className="flex gap-4 text-center">
              {ALL_KARATS.map((k) => {
                const r = valuation.per.get(k)!
                if (r.goldMinor <= 0) return null
                return (
                  <div key={k}>
                    <div className="text-[10px] text-slate-400">{KARAT_LABELS[k]}</div>
                    <div className="text-[13px] font-black text-slate-700 dark:text-slate-200">{fmt(r.goldMinor)}</div>
                    <div className="text-[10px] text-slate-400">{r.pieces > 0 ? `${r.pieces} قطعة · ` : ''}{(r.grams + (scrapByKarat.get(k)?.grams ?? 0)).toFixed(1)} جم</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* الأصناف الموصوفة */}
      {profiled.length === 0 ? (
        <EmptyState icon="💍" title="لا أصناف موصوفة ذهبياً" sub="اربط كل قطعة بعيارها ووزنها ومصنعيتها — وسيُشتق سعرها من سعر اليوم" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-300">
              <tr>{['الصنف', 'العيار', 'الوزن', 'قيمة الذهب', 'المصنعية', 'السعر الحالي'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {profiled.map(({ p, item }) => {
                const bd = jewelryBreakdown(p, gramPrices)
                return (
                  <tr key={p.itemId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-yellow-500/5 transition-colors cursor-pointer"
                    onClick={() => { setProfItem(String(p.itemId)); setProfKarat(p.karat); setProfWeight(String(p.weightGrams)); setProfWork(String(p.workmanshipMinor / 10 ** cur.decimals)); setProfileOpen(true) }}>
                    <td className="px-3 py-2.5 font-bold">{item!.nameAr}</td>
                    <td className="px-3 py-2.5">{KARAT_LABELS[p.karat]}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.weightGrams} جم</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt(bd.goldMinor)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmt(bd.workmanshipMinor)}</td>
                    <td className="px-3 py-2.5 font-black text-yellow-600 tabular-nums">{fmt(item!.priceMinor)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* الكسر */}
      <div className="flex items-center justify-between">
        <h2 className="font-black">الذهب الكسر</h2>
        <div className="flex gap-2">
          <Btn variant="soft" onClick={() => { setScrapMode('buy'); setScPrice('') }}><ArrowDownToLine className="w-4 h-4" /> شراء كسر</Btn>
          <Btn variant="soft" onClick={() => { setScrapMode('sell'); setScPrice('') }}><ArrowUpFromLine className="w-4 h-4" /> بيع كسر</Btn>
        </div>
      </div>
      {scrapSales.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {[...scrapSales].reverse().slice(0, 15).map((s) => (
                <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-bold">{KARAT_LABELS[s.karat]}</td>
                  <td className="px-4 py-2 tabular-nums">{s.weightGrams} جم × {fmt(s.pricePerGramMinor)}</td>
                  <td className="px-4 py-2 tabular-nums">{fmt(s.saleMinor)}</td>
                  <td className={`px-4 py-2 font-black tabular-nums ${s.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {s.profitMinor >= 0 ? 'ربح' : 'خسارة'} {fmt(Math.abs(s.profitMinor))}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-400">{s.date.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* نافذة أسعار اليوم */}
      <Modal open={priceOpen} onClose={() => setPriceOpen(false)} title="أسعار الجرام اليوم">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="عيار 18"><input value={p18} onChange={(e) => setP18(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="عيار 21"><input value={p21} onChange={(e) => setP21(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="عيار 24"><input value={p24} onChange={(e) => setP24(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <div className="text-[11px] text-slate-500 bg-yellow-500/5 rounded-xl p-2.5">بعد الحفظ يعاد تسعير كل الأصناف الموصوفة تلقائياً: الوزن × جرام العيار + المصنعية</div>
          <Btn onClick={savePrices} className="w-full" disabled={!p18 || !p21 || !p24}>حفظ وإعادة تسعير المحل</Btn>
        </div>
      </Modal>

      {/* نافذة الوصف الذهبي */}
      <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="الوصف الذهبي للصنف">
        <div className="space-y-3">
          <Field label="الصنف *">
            <select value={profItem} onChange={(e) => setProfItem(e.target.value)} className={inputCls}>
              <option value="">اختر…</option>
              {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="العيار">
              <select value={profKarat} onChange={(e) => setProfKarat(e.target.value as Karat)} className={inputCls}>
                {ALL_KARATS.map((k) => <option key={k} value={k}>{KARAT_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="الوزن (جم) *"><input value={profWeight} onChange={(e) => setProfWeight(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label={`المصنعية (${cur.symbol})`}><input value={profWork} onChange={(e) => setProfWork(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
          </div>
          {profWeight && gramPrices.updatedAt && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
              السعر المشتق: {fmt(Math.round(Number(profWeight) * gramPrices[profKarat]) + toMinor(profWork || '0', cur.decimals))}
            </div>
          )}
          <Btn onClick={saveProfile} className="w-full" disabled={!profItem || !profWeight}>حفظ الوصف والتسعير</Btn>
        </div>
      </Modal>

      {/* نافذة الكسر */}
      <Modal open={!!scrapMode} onClose={() => setScrapMode(null)} title={scrapMode === 'buy' ? 'شراء ذهب كسر من عميل' : 'بيع كسر للتاجر/المصنع'}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="العيار">
              <select value={scKarat} onChange={(e) => setScKarat(e.target.value as Karat)} className={inputCls}>
                {ALL_KARATS.map((k) => <option key={k} value={k}>{KARAT_LABELS[k]}{scrapMode === 'sell' ? ` (${scrapByKarat.get(k)!.grams} جم)` : ''}</option>)}
              </select>
            </Field>
            <Field label="الوزن (جم) *"><input value={scWeight} onChange={(e) => setScWeight(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label={`سعر الجرام (${cur.symbol}) *`}><input value={scPrice} onChange={(e) => setScPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
          </div>
          <Field label={scrapMode === 'buy' ? 'اسم البائع (اختياري)' : 'اسم المشتري (اختياري)'}><input value={scName} onChange={(e) => setScName(e.target.value)} className={inputCls} /></Field>
          <Field label={scrapMode === 'buy' ? 'الدفع من' : 'التحصيل إلى'}><TreasuryPicker value={scTreasury} onChange={setScTreasury} /></Field>
          {scWeight && scPrice && (
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-3 text-[12px] font-bold text-yellow-700 dark:text-yellow-300">
              الإجمالي: {fmt(Math.round(Number(scWeight) * toMinor(scPrice, cur.decimals)))}
              {scrapMode === 'sell' && ' — التكلفة تُستهلك من أقدم دفعات الكسر (FIFO) والفرق ربح/خسارة ظاهرة'}
            </div>
          )}
          <Btn onClick={saveScrap} shortcut="F9" className="w-full" disabled={!scWeight || !scPrice}>{scrapMode === 'buy' ? 'شراء وقيد' : 'بيع وقيد'}</Btn>
        </div>
      </Modal>

      {/* مقايضة: بيع مشغول جديد بجزء من ثمنه كسر العميل (جولة الصاغة) */}
      <Modal open={tradeOpen} onClose={() => setTradeOpen(false)} title="♻️ بيع بمقايضة كسر">
        <div className="space-y-3">
          <p className="text-[11.5px] text-slate-400 leading-relaxed">
            العميل يأخذ مشغولاً جديداً ويدفع جزءاً من ثمنه بذهبه القديم — النظام يولّد
            <b> فاتورة بيع كاملة + لوط كسر FIFO</b> بمستند GTI واحد، والفرق النقدي فقط يتحرك بالخزينة.
          </p>
          <Field label="المشغول الجديد">
            <select value={trItem} onChange={(e) => setTrItem(e.target.value)} className={inputCls}>
              <option value="">— اختر —</option>
              {profiled.map(({ item }) => <option key={item!.id} value={item!.id}>{item!.nameAr} — {fmt(item!.priceMinor)}</option>)}
            </select>
          </Field>
          <Field label="العميل (اختياري — لتوثيق اسم بائع الكسر)">
            <select value={trCustomer} onChange={(e) => setTrCustomer(e.target.value)} className={inputCls}>
              <option value="">عميل نقدي</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="عيار الكسر">
              <select value={trKarat} onChange={(e) => setTrKarat(e.target.value as Karat)} className={inputCls}>
                {ALL_KARATS.map((k) => <option key={k} value={k}>{KARAT_LABELS[k]}</option>)}
              </select>
            </Field>
            <Field label="وزن الكسر (جم)"><input value={trWeight} onChange={(e) => setTrWeight(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label={`سعر جرام الكسر (${cur.symbol})`}><input value={trGramPrice} onChange={(e) => setTrGramPrice(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <Field label="الخزينة (تستلم الفرق أو تدفعه)"><TreasuryPicker value={trTreasury} onChange={setTrTreasury} /></Field>
          {tradePreview && (
            <div className={`rounded-xl p-3 text-[12.5px] font-bold ${tradePreview.netMinor === 0 ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' : tradePreview.netMinor > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-600'}`}>
              المشغول {fmt(tradePreview.saleMinor)} − كسر العميل {fmt(tradePreview.scrapValueMinor)} =
              {tradePreview.netMinor === 0 ? ' مقايضة متكافئة' : tradePreview.netMinor > 0 ? ` العميل يدفع ${fmt(tradePreview.netMinor)}` : ` نرد للعميل ${fmt(-tradePreview.netMinor)}`}
            </div>
          )}
          <Btn onClick={saveTrade} shortcut="F9" className="w-full" disabled={!tradeItem || !(Number(trWeight) > 0) || !trGramPrice.trim()}>ترحيل المقايضة</Btn>
        </div>
      </Modal>

      {/* سجل المقايضات */}
      {goldTradeIns.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-[12px] font-black text-slate-500">سجل المقايضات (GTI)</div>
          <table className="w-full text-[11.5px]">
            <thead><tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-3 py-2">المستند</th><th className="px-3 py-2">المشغول</th><th className="px-3 py-2">كسر العميل</th><th className="px-3 py-2">الصافي</th>
            </tr></thead>
            <tbody>
              {[...goldTradeIns].reverse().slice(0, 20).map((t) => (
                <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800/50">
                  <td className="px-3 py-2"><div className="font-bold">{t.tradeNumber}</div><div className="text-[9.5px] text-slate-400">{t.date.slice(0, 10)}</div></td>
                  <td className="px-3 py-2 font-mono" dir="ltr">{fmt(t.saleMinor)}</td>
                  <td className="px-3 py-2 font-mono text-amber-600" dir="ltr">{fmt(t.scrapValueMinor)}</td>
                  <td className={`px-3 py-2 font-mono font-bold ${t.netMinor === 0 ? 'text-slate-400' : t.netMinor > 0 ? 'text-emerald-600' : 'text-rose-500'}`} dir="ltr">{t.netMinor > 0 ? '+' : ''}{fmt(t.netMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
