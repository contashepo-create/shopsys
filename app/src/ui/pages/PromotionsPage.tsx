/**
 * العروض الترويجية — سد فجوة برامج السوق المصرية/السعودية والعالمية:
 *  🎁 باقة: «اشترِ المجموعة بسعر واحد» (يختارها الكاشير بزر 🎁)، تُخصم مكوناتها من المخزون تلقائياً.
 *  🛍️ اشترِ واحصل: «اشترِ 2 واحصل على 1 مجاناً/بخصم» على صنف — يُطبَّق تلقائياً على السلة.
 *  📈 شرائح كمية: «من 3 قطع 10٪، من 6 قطع 15٪» على صنف — تلقائي.
 *  ⏰ جدولة: أيام الأسبوع ونافذة ساعات (Happy Hour) لأي نوع.
 */
import { useMemo, useState } from 'react'
import { Plus, Gift, Power, Trash2, CalendarRange, Clock } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor, normalizeDigits } from '../../core/money.ts'
import {
  promotionRetailMinor, promotionSavingsMinor, promotionActiveAt, promotionKind, describeRule, describeSchedule,
  WEEKDAY_LABELS, type PromotionComponent, type PromotionKind, type PromotionInput,
} from '../../core/promotions.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'

const KIND_META: Record<PromotionKind, { icon: string; label: string; hint: string }> = {
  bundle: { icon: '🎁', label: 'باقة بسعر واحد', hint: 'عدة أصناف بسعر موحد — يضيفها الكاشير بزر 🎁' },
  bogo: { icon: '🛍️', label: 'اشترِ واحصل', hint: 'اشترِ 2 واحصل على 1 مجاناً — تلقائي على السلة' },
  tier: { icon: '📈', label: 'شرائح كمية', hint: 'كلما زادت الكمية زاد الخصم — تلقائي على السلة' },
}

interface TierDraft { minQty: string; percent: string }

const num = (v: string): number => {
  const n = Number(normalizeDigits(v.trim()).replace(/[٫,]/g, '.'))
  return Number.isFinite(n) ? n : NaN
}

export function PromotionsPage() {
  const { items, promotions, addPromotion, updatePromotion, togglePromotion, removePromotion } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const now = new Date()

  /* محرر عرض */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [kind, setKind] = useState<PromotionKind>('bundle')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [startIso, setStartIso] = useState('')
  const [endIso, setEndIso] = useState('')
  const [comps, setComps] = useState<PromotionComponent[]>([])
  const [itemFilter, setItemFilter] = useState('')
  // اشترِ واحصل / شرائح
  const [targetId, setTargetId] = useState<number | null>(null)
  const [buyQty, setBuyQty] = useState('2')
  const [getQty, setGetQty] = useState('1')
  const [getDiscount, setGetDiscount] = useState('100')
  const [tiers, setTiers] = useState<TierDraft[]>([{ minQty: '3', percent: '10' }])
  // الجدولة
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')

  const openEditor = (id: number | null) => {
    const p = id != null ? promotions.find((x) => x.id === id) : null
    setEditingId(id)
    setKind(p ? promotionKind(p) : 'bundle')
    setName(p?.nameAr ?? '')
    setPrice(p && promotionKind(p) === 'bundle' ? String(p.bundlePriceMinor / 10 ** cur.decimals) : '')
    setStartIso(p?.startIso?.slice(0, 10) ?? '')
    setEndIso(p?.endIso?.slice(0, 10) ?? '')
    setComps(p ? p.components.map((c) => ({ ...c })) : [])
    setTargetId(p?.itemId ?? null)
    setBuyQty(String(p?.buyQty ?? 2))
    setGetQty(String(p?.getQty ?? 1))
    setGetDiscount(String(p?.getDiscountPercent ?? 100))
    setTiers(p?.tiers?.length ? p.tiers.map((t) => ({ minQty: String(t.minQty), percent: String(t.percent) })) : [{ minQty: '3', percent: '10' }])
    setWeekdays(p?.weekdays ? [...p.weekdays] : [])
    setFromTime(p?.fromTime ?? '')
    setToTime(p?.toTime ?? '')
    setItemFilter('')
    setEditorOpen(true)
  }

  const setQty = (itemId: number, qty: number) => {
    setComps((prev) => {
      const rest = prev.filter((c) => c.itemId !== itemId)
      return qty >= 1 ? [...rest, { itemId, qty: Math.floor(qty) }] : rest
    })
  }

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b)))

  const draftRetail = useMemo(() => promotionRetailMinor({ components: comps }, items), [comps, items])
  const draftPriceMinor = (() => { try { return price.trim() ? toMinor(price.trim(), cur.decimals) : 0 } catch { return 0 } })()
  const target = items.find((it) => it.id === targetId) ?? null

  const save = () => {
    try {
      const isActive = editingId != null ? (promotions.find((p) => p.id === editingId)?.isActive ?? true) : true
      const common = {
        nameAr: name, startIso, endIso, isActive,
        weekdays: weekdays.length === 7 ? [] : weekdays,
        fromTime: fromTime || undefined,
        toTime: toTime || undefined,
      }
      let input: PromotionInput
      if (kind === 'bundle') {
        input = { ...common, kind, components: comps, bundlePriceMinor: price.trim() ? toMinor(price.trim(), cur.decimals) : 0 }
      } else if (kind === 'bogo') {
        input = {
          ...common, kind, components: [], bundlePriceMinor: 0,
          itemId: targetId ?? undefined, buyQty: num(buyQty), getQty: num(getQty), getDiscountPercent: num(getDiscount),
        }
      } else {
        input = {
          ...common, kind, components: [], bundlePriceMinor: 0, itemId: targetId ?? undefined,
          tiers: tiers.map((t) => ({ minQty: num(t.minQty), percent: num(t.percent) })),
        }
      }
      if (editingId != null) { updatePromotion(editingId, input); toast.show('عُدل العرض ✅') }
      else {
        addPromotion(input)
        toast.show(kind === 'bundle' ? 'أُنشئ العرض — سيظهر زر 🎁 في الكاشير أيام سريانه ✅' : 'أُنشئ العرض — يُطبَّق تلقائياً على السلة أيام سريانه ✅')
      }
      setEditorOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const canSave = !!name.trim() && (
    kind === 'bundle' ? comps.length > 0 && !!price.trim()
      : kind === 'bogo' ? targetId != null
        : targetId != null && tiers.length > 0
  )

  // أصناف صالحة لاختيار الهدف (اشترِ واحصل لا يشمل الموزون)
  const targetChoices = items
    .filter((it) => it.isActive && !it.trackSerial && (kind !== 'bogo' || !it.soldByWeight) && (!itemFilter || it.nameAr.includes(itemFilter)))
    .slice(0, 30)

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><Gift className="w-6 h-6 text-pink-500" /> العروض والباقات</h1>
          <p className="text-[12px] text-slate-500 mt-1">باقات بسعر موحد، «اشترِ واحصل»، وشرائح خصم الكمية — بجدولة اختيارية بأيام الأسبوع وساعات اليوم</p>
        </div>
        <Btn onClick={() => openEditor(null)}><Plus className="w-4 h-4" /> عرض جديد</Btn>
      </div>

      {promotions.length === 0 ? (
        <EmptyState icon="🎁" title="لا عروض بعد" sub="أنشئ باقة (2 شامبو + صابونة بسعر موحد) أو «اشترِ 2 واحصل على 1 مجاناً» أو خصماً متدرجاً بالكمية — يطبّقها كاشيرك تلقائياً" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {promotions.map((p) => {
            const k = promotionKind(p)
            const retail = promotionRetailMinor(p, items)
            const savings = promotionSavingsMinor(p, items)
            const live = promotionActiveAt(p, now)
            const sched = describeSchedule(p)
            const tItem = items.find((x) => x.id === p.itemId)
            return (
              <div key={p.id} className={`rounded-2xl border p-4 space-y-2 ${p.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-dashed opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <button onClick={() => openEditor(p.id)} className="font-black hover:text-pink-600 transition-colors text-right">{KIND_META[k].icon} {p.nameAr}</button>
                  <div className="flex gap-1">
                    <button onClick={() => togglePromotion(p.id)} title={p.isActive ? 'تعطيل' : 'تفعيل'} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all"><Power className="w-4 h-4" /></button>
                    <button onClick={() => { removePromotion(p.id); toast.show('حُذف العرض') }} title="حذف" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                {k === 'bundle' ? (
                  <>
                    <div className="text-[12px] text-slate-500 space-y-0.5">
                      {p.components.map((c) => {
                        const it = items.find((x) => x.id === c.itemId)
                        return <div key={c.itemId}>• {c.qty} × {it?.nameAr ?? '؟'}</div>
                      })}
                    </div>
                    <div className="flex items-baseline gap-2 text-[13px]">
                      <b className="text-pink-600">{fmt(p.bundlePriceMinor)}</b>
                      {retail > p.bundlePriceMinor && <span className="text-slate-400 line-through text-[11px]">{fmt(retail)}</span>}
                      {savings > 0 && <span className="text-emerald-600 font-bold text-[11px]">وفر {fmt(savings)}</span>}
                    </div>
                  </>
                ) : (
                  <div className="text-[12px] space-y-0.5">
                    <div className="text-slate-500">الصنف: <b>{tItem?.nameAr ?? '؟ (حُذف)'}</b></div>
                    <div className="font-black text-pink-600">{describeRule(p)}</div>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap text-[10.5px] font-bold">
                  <span className={`px-2 py-0.5 rounded-full ${live ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>{live ? 'سارٍ الآن' : p.isActive ? 'خارج وقت السريان' : 'معطل'}</span>
                  {(p.startIso || p.endIso) && (
                    <span className="text-slate-400 flex items-center gap-1"><CalendarRange className="w-3 h-3" />{p.startIso ? p.startIso.slice(0, 10) : '…'} ← {p.endIso ? p.endIso.slice(0, 10) : '…'}</span>
                  )}
                  {sched && <span className="text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />{sched}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* محرر العرض */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editingId != null ? 'تعديل العرض' : 'عرض جديد'} wide>
        <div className="space-y-3">
          {/* النوع (لا يتغير بعد الإنشاء — يتغير ما يحمله العرض كله) */}
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(KIND_META) as PromotionKind[]).map((k) => (
              <button
                key={k}
                type="button"
                disabled={editingId != null && kind !== k}
                onClick={() => setKind(k)}
                title={KIND_META[k].hint}
                className={`rounded-xl border-2 px-3 py-2 text-[12px] font-black transition-all disabled:opacity-30 ${kind === k ? 'border-pink-400 bg-pink-500/10 text-pink-600' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
              >
                {KIND_META[k].icon} {KIND_META[k].label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-400">{KIND_META[kind].hint}</div>

          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="اسم العرض *"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="عرض رمضان…" className={inputCls} autoFocus /></Field>
            <Field label="بداية السريان (اختياري)"><input type="date" value={startIso} onChange={(e) => setStartIso(e.target.value)} className={inputCls} /></Field>
            <Field label="نهاية السريان (اختياري)"><input type="date" value={endIso} onChange={(e) => setEndIso(e.target.value)} className={inputCls} /></Field>
          </div>

          {/* الجدولة */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-[12px] font-black flex items-center gap-1.5"><Clock className="w-4 h-4 text-amber-500" /> جدولة (اختياري) — اتركها فارغة ليسري العرض كل يوم وطوال اليوم</div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold border transition-all ${weekdays.includes(d) ? 'border-amber-400 bg-amber-500/10 text-amber-700' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <Field label="من الساعة" hint="مثال 17:00"><input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={inputCls} /></Field>
              <Field label="إلى الساعة" hint="أقل من «من» = يعبر منتصف الليل"><input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={inputCls} /></Field>
            </div>
          </div>

          {kind === 'bundle' ? (
            <>
              <Field label="مكونات الباقة *" hint="لا تدخل العروض أصنافُ السيريال ولا الوزن ولا تركيبات اللون/المقاس">
                <input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="ابحث عن صنف…" className={inputCls} />
              </Field>
              <div className="max-h-[16rem] overflow-y-auto space-y-1.5">
                {items
                  .filter((it) => it.isActive && !it.trackSerial && !it.soldByWeight && (!itemFilter || it.nameAr.includes(itemFilter)))
                  .sort((a, b) => Number(comps.some((c) => c.itemId === b.id)) - Number(comps.some((c) => c.itemId === a.id)))
                  .slice(0, 40)
                  .map((it) => {
                    const c = comps.find((x) => x.itemId === it.id)
                    return (
                      <div key={it.id} className="flex items-center gap-2 text-[12px] bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2">
                        <span className="flex-1 font-bold">{it.nameAr}</span>
                        <span className="text-slate-400">تجزئة {fmt(it.priceMinor)}</span>
                        <input
                          value={c ? String(c.qty) : ''}
                          onChange={(e) => setQty(it.id, Number(e.target.value) || 0)}
                          inputMode="numeric"
                          placeholder="0"
                          title="كمية الصنف داخل الباقة الواحدة"
                          className={`${inputCls} w-20 text-center ${c ? 'border-pink-400' : ''}`}
                        />
                      </div>
                    )
                  })}
              </div>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <Field label={`سعر الباقة (${cur.symbol}) *`}>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
                </Field>
                <div className="text-[12px] text-slate-500 pb-2">
                  مجموع التجزئة: <b>{fmt(draftRetail)}</b>
                  {draftPriceMinor > 0 && draftRetail > 0 && (
                    <div className={draftRetail - draftPriceMinor > 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                      {draftRetail - draftPriceMinor > 0 ? `وفر العميل ${fmt(draftRetail - draftPriceMinor)}` : 'أغلى من التجزئة — راجع السعر'}
                    </div>
                  )}
                </div>
                <Btn onClick={save} disabled={!canSave}>{editingId != null ? 'حفظ' : 'إنشاء العرض'}</Btn>
              </div>
            </>
          ) : (
            <>
              <Field label="الصنف المستهدف *" hint={kind === 'bogo' ? 'لا يشمل السيريال ولا الموزون' : 'لا يشمل السيريال'}>
                <input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder={target ? `المختار: ${target.nameAr}` : 'ابحث عن صنف…'} className={inputCls} />
              </Field>
              <div className="max-h-[11rem] overflow-y-auto space-y-1.5">
                {targetChoices.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setTargetId(it.id)}
                    className={`w-full flex items-center gap-2 text-[12px] rounded-xl px-3 py-2 text-right border-2 transition-all ${targetId === it.id ? 'border-pink-400 bg-pink-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/50'}`}
                  >
                    <span className="flex-1 font-bold">{it.nameAr}</span>
                    <span className="text-slate-400">{fmt(it.priceMinor)}</span>
                  </button>
                ))}
              </div>

              {kind === 'bogo' ? (
                <div className="grid sm:grid-cols-4 gap-3 items-end">
                  <Field label="اشترِ (كمية)"><input value={buyQty} onChange={(e) => setBuyQty(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
                  <Field label="واحصل على (كمية)"><input value={getQty} onChange={(e) => setGetQty(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
                  <Field label="خصم الممنوح ٪" hint="100 = مجاناً"><input value={getDiscount} onChange={(e) => setGetDiscount(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
                  <Btn onClick={save} disabled={!canSave}>{editingId != null ? 'حفظ' : 'إنشاء العرض'}</Btn>
                </div>
              ) : (
                <div className="space-y-2">
                  {tiers.map((t, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                      <Field label={i === 0 ? 'من كمية' : '\u00a0'}><input value={t.minQty} onChange={(e) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, minQty: e.target.value } : x)))} inputMode="decimal" className={inputCls} /></Field>
                      <Field label={i === 0 ? 'خصم ٪' : '\u00a0'}><input value={t.percent} onChange={(e) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} inputMode="decimal" className={inputCls} /></Field>
                      <button type="button" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))} disabled={tiers.length === 1} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 disabled:opacity-20"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => setTiers((ts) => (ts.length < 6 ? [...ts, { minQty: '', percent: '' }] : ts))} className="text-[12px] font-bold text-pink-600 hover:underline">+ شريحة</button>
                    <Btn onClick={save} disabled={!canSave}>{editingId != null ? 'حفظ' : 'إنشاء العرض'}</Btn>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
