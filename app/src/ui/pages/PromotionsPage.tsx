/**
 * العروض الترويجية والباقات — سد فجوة برامج السوق المصرية/السعودية:
 * «اشترِ المجموعة بسعر واحد» من عدة أصناف، تُخصم كميات مكوناتها من
 * المخزون تلقائياً عند البيع (تتفكك لسطور سلة بأسعار موزعة بالقرش).
 */
import { useMemo, useState } from 'react'
import { Plus, Gift, Power, Trash2, CalendarRange, ShieldCheck } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { todayLocalIso } from '../../core/time.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { promotionRetailMinor, promotionSavingsMinor, promotionActiveOn, type PromotionComponent } from '../../core/promotions.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'

export function PromotionsPage() {
  const { items, promotions, addPromotion, updatePromotion, togglePromotion, removePromotion, approvePromotionBelowCost, revokePromotionBelowCost, appUsers, currentUserId } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const todayIso = todayLocalIso()

  /* محرر عرض */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [startIso, setStartIso] = useState('')
  const [endIso, setEndIso] = useState('')
  const [comps, setComps] = useState<PromotionComponent[]>([])
  const [itemFilter, setItemFilter] = useState('')
  /* F9: نوع العرض — باقة بسعر موحد، أو قاعدة كمية «N + M مجاناً» */
  const [kind, setKind] = useState<'bundle' | 'quantity'>('bundle')
  const [ruleItemId, setRuleItemId] = useState(0)
  const [buyQty, setBuyQty] = useState('2')
  const [freeQty, setFreeQty] = useState('1')

  const openEditor = (id: number | null) => {
    const p = id != null ? promotions.find((x) => x.id === id) : null
    setEditingId(id)
    setName(p?.nameAr ?? '')
    setPrice(p ? String(p.bundlePriceMinor / 10 ** cur.decimals) : '')
    setStartIso(p?.startIso?.slice(0, 10) ?? '')
    setEndIso(p?.endIso?.slice(0, 10) ?? '')
    setComps(p ? p.components.map((c) => ({ ...c })) : [])
    setKind(p?.kind === 'quantity' ? 'quantity' : 'bundle')
    setRuleItemId(p?.quantityRule?.itemId ?? 0)
    setBuyQty(String(p?.quantityRule?.buyQty ?? 2))
    setFreeQty(String(p?.quantityRule?.freeQty ?? 1))
    setItemFilter('')
    setEditorOpen(true)
  }

  const setQty = (itemId: number, qty: number) => {
    setComps((prev) => {
      const rest = prev.filter((c) => c.itemId !== itemId)
      return qty >= 1 ? [...rest, { itemId, qty: Math.floor(qty) }] : rest
    })
  }

  const draftRetail = useMemo(() => promotionRetailMinor({ components: comps, bundlePriceMinor: 0 }, items), [comps, items])
  const draftPriceMinor = (() => { try { return price.trim() ? toMinor(price.trim(), cur.decimals) : 0 } catch { return 0 } })()

  const save = () => {
    try {
      const existing = editingId != null ? promotions.find((p) => p.id === editingId) : null
      const input = {
        nameAr: name,
        kind,
        components: kind === 'quantity' ? [] : comps,
        bundlePriceMinor: kind === 'quantity' ? 0 : (price.trim() ? toMinor(price.trim(), cur.decimals) : 0),
        quantityRule: kind === 'quantity'
          ? { itemId: ruleItemId, buyQty: Number(buyQty) || 0, freeQty: Number(freeQty) || 0 }
          : null,
        startIso,
        endIso,
        isActive: existing?.isActive ?? true,
        belowCostApprovedBy: existing?.belowCostApprovedBy ?? null,
        belowCostApprovedAt: existing?.belowCostApprovedAt ?? null,
      } as never
      if (editingId != null) { updatePromotion(editingId, input); toast.show('عُدل العرض ✅') }
      else { addPromotion(input); toast.show('أُنشئ العرض — سيظهر زر 🎁 في الكاشير أيام سريانه ✅') }
      setEditorOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><Gift className="w-6 h-6 text-pink-500" /> العروض والباقات</h1>
          <p className="text-[12px] text-slate-500 mt-1">باقة من عدة أصناف بسعر واحد — تُخصم كميات مكوناتها من المخزون تلقائياً عند البيع</p>
        </div>
        <Btn onClick={() => openEditor(null)}><Plus className="w-4 h-4" /> عرض جديد</Btn>
      </div>

      {promotions.length === 0 ? (
        <EmptyState icon="🎁" title="لا عروض بعد" sub="أنشئ باقة (مثلاً: 2 شامبو + صابونة بسعر موحد) — وستظهر لكاشيرك بزر واحد يضيفها كاملة للسلة" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {promotions.map((p) => {
            const retail = promotionRetailMinor(p, items)
            const savings = promotionSavingsMinor(p, items)
            const live = promotionActiveOn(p, todayIso)
            return (
              <div key={p.id} className={`rounded-2xl border p-4 space-y-2 ${p.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-dashed opacity-60'}`}>
                <div className="flex items-start justify-between">
                  <button onClick={() => openEditor(p.id)} className="font-black hover:text-pink-600 transition-colors text-right">🎁 {p.nameAr}</button>
                  <div className="flex gap-1">
                    {/* F4: اعتماد البيع بخسارة على مستوى العرض (لا لكل فاتورة) */}
                    <button
                      onClick={() => {
                        try {
                          if (p.belowCostApprovedBy) {
                            revokePromotionBelowCost(p.id)
                            toast.show('أُلغي اعتماد البيع بخسارة — سيعود طلب اعتماد المدير لكل فاتورة')
                          } else {
                            const name = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? setup.ownerName ?? 'المالك'
                            approvePromotionBelowCost(p.id, name)
                            toast.show(`اعتُمد البيع بخسارة للعرض باسم ${name} حتى نهاية سريانه`)
                          }
                        } catch (e) { toast.show((e as Error).message, 'error') }
                      }}
                      data-loss-leader-approve={p.id}
                      title={p.belowCostApprovedBy ? `معتمد للبيع بخسارة: ${p.belowCostApprovedBy} — اضغط للإلغاء` : 'اعتماد البيع بخسارة على مستوى العرض'}
                      className={`p-1.5 rounded-lg transition-all ${p.belowCostApprovedBy ? 'text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-500/10'}`}
                    >
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                    <button onClick={() => togglePromotion(p.id)} title={p.isActive ? 'تعطيل' : 'تفعيل'} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all"><Power className="w-4 h-4" /></button>
                    <button onClick={() => { removePromotion(p.id); toast.show('حُذف العرض') }} title="حذف" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="text-[12px] text-slate-500 space-y-0.5">
                  {p.kind === 'quantity' && p.quantityRule ? (
                    <div>• {p.quantityRule.buyQty} + {p.quantityRule.freeQty} مجاناً × {items.find((x) => x.id === p.quantityRule!.itemId)?.nameAr ?? '؟'}</div>
                  ) : p.components.map((c) => {
                    const it = items.find((x) => x.id === c.itemId)
                    return <div key={c.itemId}>• {c.qty} × {it?.nameAr ?? '؟'}</div>
                  })}
                </div>
                <div className="flex items-baseline gap-2 text-[13px]">
                  <b className="text-pink-600">{fmt(retail - savings)}</b>
                  {savings > 0 && <span className="text-slate-400 line-through text-[11px]">{fmt(retail)}</span>}
                  {savings > 0 && <span className="text-emerald-600 font-bold text-[11px]">وفر {fmt(savings)}</span>}
                </div>
                <div className="flex items-center gap-2 text-[10.5px] font-bold">
                  <span className={`px-2 py-0.5 rounded-full ${live ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-500/10 text-slate-400'}`}>{live ? 'سارٍ اليوم' : p.isActive ? 'خارج فترة السريان' : 'معطل'}</span>
                  {p.belowCostApprovedBy && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600" title={p.belowCostApprovedAt ?? ''}>✓ بيع بخسارة معتمد</span>}
                  {(p.startIso || p.endIso) && (
                    <span className="text-slate-400 flex items-center gap-1"><CalendarRange className="w-3 h-3" />{p.startIso ? p.startIso.slice(0, 10) : '…'} ← {p.endIso ? p.endIso.slice(0, 10) : '…'}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* محرر العرض */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editingId != null ? 'تعديل العرض' : 'عرض/باقة جديدة'} wide>
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="اسم العرض *"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="باقة رمضان…" className={inputCls} autoFocus /></Field>
            <Field label="بداية السريان (اختياري)"><input type="date" value={startIso} onChange={(e) => setStartIso(e.target.value)} className={inputCls} /></Field>
            <Field label="نهاية السريان (اختياري)"><input type="date" value={endIso} onChange={(e) => setEndIso(e.target.value)} className={inputCls} /></Field>
          </div>
          {/* F9: نوع العرض */}
          <Field label="نوع العرض">
            <div className="grid sm:grid-cols-2 gap-2">
              <button
                onClick={() => setKind('bundle')}
                data-promo-kind="bundle"
                className={`text-right p-3 rounded-xl border-2 transition-all ${kind === 'bundle' ? 'border-pink-500/60 bg-pink-500/10' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="font-bold text-[13px] text-slate-700 dark:text-slate-200">🎁 باقة بسعر موحد</div>
                <div className="text-[11px] text-slate-400 mt-0.5">عدة أصناف بكميات محددة بسعر واحد أقل من مجموعها</div>
              </button>
              <button
                onClick={() => setKind('quantity')}
                data-promo-kind="quantity"
                className={`text-right p-3 rounded-xl border-2 transition-all ${kind === 'quantity' ? 'border-pink-500/60 bg-pink-500/10' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="font-bold text-[13px] text-slate-700 dark:text-slate-200">🔢 اشترِ N واحصل على M مجاناً</div>
                <div className="text-[11px] text-slate-400 mt-0.5">قاعدة كمية لصنف واحد (2+1، 3+1…) بسعر الوحدة نفسه</div>
              </button>
            </div>
          </Field>
          {kind === 'quantity' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-3">
              <Field label="الصنف *" hint="يُسعَّر بعدد الوحدات المدفوعة فقط، والوحدات المجانية تُخصم من المخزون بتكلفتها الحقيقية">
                <QuickSelect
                  className={inputCls}
                  value={String(ruleItemId)}
                  onChange={(event) => setRuleItemId(Number(event.target.value))}
                  aria-label="صنف العرض الكمي"
                >
                  <option value="0">اختر الصنف…</option>
                  {items.filter((it) => it.isActive).map((it) => (
                    <option key={it.id} value={it.id}>{it.nameAr} — {fmt(it.priceMinor)}</option>
                  ))}
                </QuickSelect>
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="وحدات مدفوعة (N) *"><input value={buyQty} onChange={(e) => setBuyQty(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
                <Field label="وحدات مجانية (M) *"><input value={freeQty} onChange={(e) => setFreeQty(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
              </div>
              {ruleItemId > 0 && (() => {
                const it = items.find((x) => x.id === ruleItemId)
                if (!it) return null
                const perCycle = it.priceMinor * (Number(buyQty) || 0)
                const units = (Number(buyQty) || 0) + (Number(freeQty) || 0)
                return (
                  <div className="text-[12px] text-slate-500 dark:text-slate-400">
                    الدورة: {units} وحدة بـ <b>{fmt(perCycle)}</b> — سعر الوحدة الفعلي <b>{units > 0 ? (perCycle / units / 10 ** cur.decimals).toFixed(2) : '—'}</b> {cur.symbol}
                    {it.costMinor * units > perCycle && <div className="text-rose-500 font-bold">تحذير: سعر الدورة أقل من تكلفتها — يحتاج اعتماد loss leader على مستوى العرض</div>}
                  </div>
                )
              })()}
            </div>
          )}
          {kind === 'bundle' && <Field label="مكونات الباقة *" hint="لا تدخل العروض أصنافُ السيريال ولا الوزن ولا تركيبات اللون/المقاس">
            <input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="ابحث عن صنف…" className={inputCls} />
          </Field>}
          {kind === 'bundle' && <div className="max-h-[16rem] overflow-y-auto space-y-1.5">
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
          </div>}
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            {kind === 'bundle' ? <Field label={`سعر الباقة (${cur.symbol}) *`}>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
            </Field> : <Field label="سعر الدورة"><span className="text-[12px] text-slate-500">يُحسب من سعر الصنف × الوحدات المدفوعة</span></Field>}
            <div className="text-[12px] text-slate-500 pb-2">
              مجموع التجزئة: <b>{fmt(draftRetail)}</b>
              {draftPriceMinor > 0 && draftRetail > 0 && (
                <div className={draftRetail - draftPriceMinor > 0 ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                  {draftRetail - draftPriceMinor > 0 ? `وفر العميل ${fmt(draftRetail - draftPriceMinor)}` : 'أغلى من التجزئة — راجع السعر'}
                </div>
              )}
            </div>
            <Btn onClick={save} disabled={!name.trim() || (kind === 'quantity' ? !ruleItemId || Number(buyQty) < 1 || Number(freeQty) < 1 : comps.length === 0 || !price.trim())}>{editingId != null ? 'حفظ' : 'إنشاء العرض'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
