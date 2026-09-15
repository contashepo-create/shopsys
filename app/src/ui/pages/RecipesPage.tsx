/**
 * الوصفات والإنتاج (مطاعم/كافيهات/مخابز) — سد فجوة Foodics
 * وصفة «عند الطلب»: الطبق يخصم خاماته لحظة البيع وتكلفته آلية.
 * وصفة «إنتاج مسبق»: أمر إنتاج يحول الخامات لمنتج مخزون (صوص/عجينة).
 */
import { useMemo, useState } from 'react'
import { Plus, ChefHat, Trash2, Pencil, Factory, Power } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { RECIPE_MODE_LABELS, recipeUnitCostMinor, type RecipeMode, type RecipeIngredient, type Recipe } from '../../core/recipes.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

export function RecipesPage() {
  const { items, recipes, productionOrders, addRecipe, updateRecipe, toggleRecipe, removeRecipe, postProduction } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const costOf = (id: number) => items.find((it) => it.id === id)?.costMinor ?? 0
  const nameOf = (id: number) => items.find((it) => it.id === id)?.nameAr ?? '؟'

  /* نافذة وصفة (إنشاء/تعديل) */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [productId, setProductId] = useState('')
  const [mode, setMode] = useState<RecipeMode>('made_to_order')
  const [yieldQty, setYieldQty] = useState('1')
  const [overhead, setOverhead] = useState('')
  const [notes, setNotes] = useState('')
  const [ings, setIngs] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '' }])

  const openNew = () => {
    setEditingId(null); setProductId(''); setMode('made_to_order'); setYieldQty('1'); setOverhead(''); setNotes('')
    setIngs([{ itemId: '', qty: '' }]); setEditorOpen(true)
  }
  const openEdit = (r: Recipe) => {
    setEditingId(r.id); setProductId(String(r.productItemId)); setMode(r.mode); setYieldQty(String(r.yieldQty))
    setOverhead(r.overheadMinor ? String(r.overheadMinor / 10 ** cur.decimals) : ''); setNotes(r.notes)
    setIngs(r.ingredients.map((i) => ({ itemId: String(i.itemId), qty: String(i.qty) })))
    setEditorOpen(true)
  }
  const saveRecipe = () => {
    try {
      const ingredients: RecipeIngredient[] = ings
        .filter((i) => i.itemId && i.qty)
        .map((i) => ({ itemId: Number(i.itemId), qty: Number(i.qty) }))
      const input = {
        productItemId: Number(productId), mode, yieldQty: mode === 'prepped' ? Number(yieldQty) : 1,
        ingredients, overheadMinor: mode === 'prepped' && overhead ? Math.round(Number(overhead) * 10 ** cur.decimals) : 0,
        isActive: true, notes: notes.trim(),
      }
      if (editingId != null) { updateRecipe(editingId, input); toast.show('عُدلت الوصفة ✅') }
      else { addRecipe(input); toast.show('أُنشئت الوصفة — التكلفة ستُشتق آلياً من الخامات ✅') }
      setEditorOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* نافذة أمر إنتاج */
  const [prodFor, setProdFor] = useState<Recipe | null>(null)
  const [batches, setBatches] = useState('1')
  const [prodTreasury, setProdTreasury] = useState('1101')
  const runProduction = () => {
    if (!prodFor) return
    try {
      const o = postProduction({ recipeId: prodFor.id, batches: Number(batches), treasury: prodTreasury })
      toast.show(`رُحّل ${o.orderNumber}: أُنتج ${o.producedQty} بتكلفة ${fmt(o.totalCostMinor)} ✅`)
      setProdFor(null); setBatches('1')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const stats = useMemo(() => ({
    dishes: recipes.filter((r) => r.mode === 'made_to_order' && r.isActive).length,
    prepped: recipes.filter((r) => r.mode === 'prepped' && r.isActive).length,
    orders: productionOrders.length,
  }), [recipes, productionOrders])

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><ChefHat className="w-6 h-6 text-amber-500" /> الوصفات والإنتاج</h1>
          <p className="text-[12px] text-slate-500 mt-1">الطبق يخصم خاماته آلياً عند البيع — تكلفة حقيقية وربحية صادقة لكل صنف</p>
        </div>
        <Btn onClick={openNew}><Plus className="w-4 h-4" /> وصفة جديدة</Btn>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'أطباق عند الطلب', value: stats.dishes, color: 'text-amber-600' },
          { label: 'منتجات إنتاج مسبق', value: stats.prepped, color: 'text-sky-600' },
          { label: 'أوامر إنتاج مرحلة', value: stats.orders, color: 'text-emerald-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-center">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[11px] font-bold text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {recipes.length === 0 ? (
        <EmptyState icon="👨‍🍳" title="لا وصفات بعد" sub="أنشئ وصفة لطبق: اختر خاماته وكمياتها — وسيُحسب كل شيء آلياً" />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {recipes.map((r) => {
            const unitCost = recipeUnitCostMinor(r, costOf)
            const product = items.find((it) => it.id === r.productItemId)
            const price = product?.priceMinor ?? 0
            const margin = price > 0 ? Math.round(((price - unitCost) / price) * 100) : 0
            return (
              <div key={r.id} className={`rounded-2xl border p-4 space-y-2 transition-all ${r.isActive ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-300 dark:border-slate-600 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black">{product?.nameAr ?? '؟'}</div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg ${r.mode === 'made_to_order' ? 'bg-amber-500/10 text-amber-600' : 'bg-sky-500/10 text-sky-600'}`}>
                      {RECIPE_MODE_LABELS[r.mode].nameAr}{r.mode === 'prepped' && ` — التشغيلة تنتج ${r.yieldQty}`}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {r.mode === 'prepped' && r.isActive && (
                      <button onClick={() => setProdFor(r)} title="أمر إنتاج" className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all hover:scale-110"><Factory className="w-4 h-4" /></button>
                    )}
                    <button onClick={() => openEdit(r)} title="تعديل" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all hover:scale-110"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => toggleRecipe(r.id)} title={r.isActive ? 'تعطيل' : 'تفعيل'} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all hover:scale-110"><Power className="w-4 h-4" /></button>
                    <button onClick={() => { try { removeRecipe(r.id); toast.show('حُذفت') } catch (e) { toast.show((e as Error).message, 'error') } }} title="حذف" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all hover:scale-110"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="text-[12px] text-slate-500 space-y-0.5">
                  {r.ingredients.map((ing) => (
                    <div key={ing.itemId} className="flex justify-between">
                      <span>• {nameOf(ing.itemId)} × {ing.qty}</span>
                      <span className="tabular-nums">{fmt(Math.round(ing.qty * costOf(ing.itemId)))}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[12px] font-bold">
                  <span>تكلفة الوحدة: <b className="text-rose-600">{fmt(unitCost)}</b></span>
                  {r.mode === 'made_to_order' && price > 0 && (
                    <span>السعر {fmt(price)} — هامش <b className={margin >= 30 ? 'text-emerald-600' : margin >= 0 ? 'text-amber-600' : 'text-rose-600'}>{margin}٪</b></span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {productionOrders.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-2.5 bg-sky-500/10 text-sky-700 dark:text-sky-300 font-black text-sm">أوامر الإنتاج</div>
          <table className="w-full text-sm">
            <tbody>
              {[...productionOrders].reverse().slice(0, 20).map((o) => (
                <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-black">{o.orderNumber}</td>
                  <td className="px-4 py-2">{nameOf(o.productItemId)}</td>
                  <td className="px-4 py-2">أُنتج {o.producedQty}</td>
                  <td className="px-4 py-2 tabular-nums">خامات {fmt(o.ingredientsCostMinor)}{o.overheadMinor > 0 && ` + تشغيل ${fmt(o.overheadMinor)}`}</td>
                  <td className="px-4 py-2 font-bold tabular-nums">{fmt(o.totalCostMinor)}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-400">{o.date.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* نافذة الوصفة */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editingId != null ? 'تعديل وصفة' : 'وصفة جديدة'} wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الصنف الناتج (الطبق/المنتج) *">
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
                <option value="">اختر…</option>
                {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.nameAr}</option>)}
              </select>
            </Field>
            <Field label="نوع الوصفة">
              <div className="flex gap-2">
                {(['made_to_order', 'prepped'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 rounded-xl text-[12px] font-bold border transition-all ${mode === m ? 'bg-amber-600 text-white border-amber-600' : 'border-slate-300 dark:border-slate-600 text-slate-500'}`}>
                    {RECIPE_MODE_LABELS[m].nameAr}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="text-[11px] text-slate-500 bg-amber-500/5 rounded-xl p-2.5">{RECIPE_MODE_LABELS[mode].desc}</div>
          {mode === 'prepped' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="كمية الناتج من التشغيلة *" hint="مثال: التشغيلة تنتج 20 عبوة صوص"><input value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label={`مصاريف تشغيل التشغيلة (${cur.symbol})`} hint="غاز/عمالة مباشرة — اختياري"><input value={overhead} onChange={(e) => setOverhead(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
            </div>
          )}
          <Field label={mode === 'made_to_order' ? 'المكونات لكل طبق واحد *' : 'مكونات التشغيلة الكاملة *'}>
            <div className="space-y-2">
              {ings.map((ing, i) => (
                <div key={i} className="flex gap-2">
                  <select value={ing.itemId} onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={`${inputCls} flex-1`}>
                    <option value="">الخامة…</option>
                    {items.filter((it) => it.isActive && String(it.id) !== productId).map((it) => <option key={it.id} value={it.id}>{it.nameAr} ({it.baseUnit})</option>)}
                  </select>
                  <input value={ing.qty} onChange={(e) => setIngs(ings.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" placeholder="الكمية" className={`${inputCls} w-28`} />
                  <button onClick={() => setIngs(ings.filter((_, j) => j !== i))} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <Btn variant="soft" onClick={() => setIngs([...ings, { itemId: '', qty: '' }])}><Plus className="w-4 h-4" /> مكوّن آخر</Btn>
            </div>
          </Field>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setEditorOpen(false)}>إلغاء</Btn>
            <Btn onClick={saveRecipe} disabled={!productId || !ings.some((i) => i.itemId && i.qty)}>{editingId != null ? 'حفظ التعديل' : 'إنشاء الوصفة'}</Btn>
          </div>
        </div>
      </Modal>

      {/* نافذة أمر الإنتاج */}
      <Modal open={!!prodFor} onClose={() => setProdFor(null)} title={prodFor ? `أمر إنتاج — ${nameOf(prodFor.productItemId)}` : ''}>
        {prodFor && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500 bg-sky-500/5 rounded-xl p-3">
              التشغيلة الواحدة تنتج <b>{prodFor.yieldQty}</b> وتستهلك خاماتها من المخزون. القيد: تحويل داخل المخزون (1103/1103){prodFor.overheadMinor > 0 && ' + مصاريف تشغيل من الخزينة'}.
            </div>
            <Field label="عدد التشغيلات"><input value={batches} onChange={(e) => setBatches(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
            {prodFor.overheadMinor > 0 && <Field label="مصدر مصاريف التشغيل"><TreasuryPicker value={prodTreasury} onChange={setProdTreasury} /></Field>}
            {Number(batches) > 0 && (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
                سينتج {prodFor.yieldQty * Number(batches)} وحدة بتكلفة إجمالية {fmt((recipeUnitCostMinor(prodFor, costOf)) * prodFor.yieldQty * Number(batches))} تقريباً
              </div>
            )}
            <Btn onClick={runProduction} className="w-full" disabled={!(Number(batches) > 0)}>ترحيل أمر الإنتاج</Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
