import { ItemQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
import { useMemo, useRef, useState } from 'react'
import { Factory, Plus, Trash2, WalletCards, Boxes, CheckCircle2, AlertTriangle, ArrowRight, FileSpreadsheet } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import type { ProductionExpense } from '../../core/recipes.ts'
import { Btn, DecimalInput, Field, inputCls, useToast } from '../components/ui.tsx'
import { buildWarehouseDocs, computeWarehouseStock } from '../../core/transfers.ts'

type MaterialRow = { id: string; itemId: number; code: string; query: string; qty: string; unitFactor: number; unitName: string; warehouseId?: number | null }
type Tab = 'materials' | 'expenses'

export function RecipesPage() {
  const { items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders, recipes, customAccounts, addCustomAccount, addRecipe, postProduction } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(() => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }, [setup.countryCode])
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items])
  const warehouseStock = useMemo(() => computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders)), [items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders])
  const [creating, setCreating] = useState(false)
  const [productId, setProductId] = useState(0)
  const [ingredientWarehouseId, setIngredientWarehouseId] = useState<number>(() => setup.defaultWarehouseId ?? warehouses.find((warehouse) => warehouse.isMain)?.id ?? warehouses[0]?.id ?? 0)
  const [outputWarehouseId, setOutputWarehouseId] = useState<number>(() => setup.defaultWarehouseId ?? warehouses.find((warehouse) => warehouse.isMain)?.id ?? warehouses[0]?.id ?? 0)
  const warehouseQty = (itemId: number, warehouseId = ingredientWarehouseId) => warehouseId ? (warehouseStock.get(warehouseId)?.get(itemId) ?? 0) : warehouses.reduce((total, warehouse) => total + (warehouseStock.get(warehouse.id)?.get(itemId) ?? 0), 0)
  const materialGrid = ingredientWarehouseId === 0 ? 'grid-cols-[110px_minmax(180px,1fr)_150px_130px_120px_110px_36px]' : 'grid-cols-[110px_minmax(180px,1fr)_130px_120px_110px_36px]'
  const [outputQty, setOutputQty] = useState('')
  const [outputUnitFactor, setOutputUnitFactor] = useState(1)
  const [tab, setTab] = useState<Tab>('materials')
  const [materials, setMaterials] = useState<MaterialRow[]>([{ id: crypto.randomUUID(), itemId: 0, code: '', query: '', qty: '', unitFactor: 1, unitName: '' }])
  const [expenses, setExpenses] = useState<ProductionExpense[]>([])
  const [notes, setNotes] = useState('')
  const [outputExpiryDate, setOutputExpiryDate] = useState('')
  const [outputLotNumber, setOutputLotNumber] = useState('')
  const [productionDate, setProductionDate] = useState(new Date().toISOString().slice(0, 10))
  const [strictBalance, setStrictBalance] = useState(true)
  const [allowNegativeIngredients, setAllowNegativeIngredients] = useState(() => localStorage.getItem('shopsys:manufacturing:allow-negative-stock') === 'true')
  const [varianceReason, setVarianceReason] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickCode, setQuickCode] = useState('')
  const [quickName, setQuickName] = useState('')
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerIndex, setPickerIndex] = useState(0)
  const codeRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const itemRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const product = activeItems.find((item) => item.id === productId)
  const totalInputQty = materials.reduce((sum, row) => sum + (Number(row.qty) || 0) * row.unitFactor, 0)
  const output = (Number(outputQty) || 0) * outputUnitFactor
  const variance = output - totalInputQty
  const materialCost = materials.reduce((sum, row) => {
    const item = items.find((candidate) => candidate.id === row.itemId)
    return sum + Math.round((Number(row.qty) || 0) * row.unitFactor * (item?.costMinor ?? 0))
  }, 0)
  const expenseTotal = expenses.reduce((sum, row) => sum + row.amountMinor, 0)
  const totalCost = materialCost + expenseTotal
  const unitCost = output > 0 ? Math.round(totalCost / output) : 0
  const expenseAccounts = [
    { code: '5102', nameAr: 'أجور مباشرة' }, { code: '5103', nameAr: 'مصاريف تشغيل' }, { code: '5108', nameAr: 'مصروفات عمومية' },
    ...customAccounts.filter((account) => account.rootType === 'expenses').map((account) => ({ code: account.code, nameAr: account.nameAr })),
  ]
  const fmt = (value: number) => formatMinor(value, cur, false)
  const itemToken = (itemId: number) => {
    const item = items.find((candidate) => candidate.id === itemId)
    return item ? `${item.sku || item.barcodes?.[0] || item.id} — ${item.nameAr}` : ''
  }
  const resolveItem = (query: string) => {
    const normalized = query.trim().toLowerCase()
    return activeItems.find((item) => item.id !== productId && [String(item.id), item.sku, ...(item.barcodes ?? []), item.nameAr, itemToken(item.id)].filter(Boolean).some((value) => String(value).toLowerCase() === normalized))
  }
  const patchMaterial = (id: string, patch: Partial<MaterialRow>) => setMaterials((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  const changeIngredientWarehouse = (warehouseId: number) => {
    setIngredientWarehouseId(warehouseId)
    if (warehouseId !== 0) setMaterials((rows) => rows.map((row) => ({ ...row, warehouseId: null })))
  }
  const chooseMaterial = (rowId: string, itemId: number) => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item) return
    patchMaterial(rowId, { itemId, code: item.sku || item.barcodes?.[0] || String(item.id), query: itemToken(itemId), unitFactor: 1, unitName: item.baseUnit })
    setPickerRowId(null); setPickerSearch('')
    requestAnimationFrame(() => qtyRefs.current[rowId]?.focus())
  }
  const openMaterialPicker = (rowId: string, search = '') => { setPickerRowId(rowId); setPickerSearch(search); setPickerIndex(0) }
  const addMaterialAndFocus = () => {
    const id = crypto.randomUUID()
    setMaterials((rows) => [...rows, { id, itemId: 0, code: '', query: '', qty: '', unitFactor: 1, unitName: '' }])
    requestAnimationFrame(() => codeRefs.current[id]?.focus())
  }
  const addExpense = () => setExpenses((rows) => [...rows, { id: crypto.randomUUID(), label: '', accountCode: expenseAccounts[0]?.code ?? '5108', amountMinor: 0, payableAccountCode: '2117' }])
  const addQuickAccount = () => {
    try {
      const account = addCustomAccount({ code: quickCode, nameAr: quickName, parentCode: '5' })
      setQuickCode(''); setQuickName(''); setQuickOpen(false)
      setExpenses((rows) => [...rows, { id: crypto.randomUUID(), label: account.nameAr, accountCode: account.code, amountMinor: 0, payableAccountCode: '2117' }])
      toast.show(`أُضيف «${account.nameAr}» واختير كمصروف تصنيع ✓`)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const loadRecipe = (recipeId: number) => {
    const recipe = recipes.find((row) => row.id === recipeId)
    if (!recipe) return
    const outputItem = items.find((item) => item.id === recipe.productItemId)
    setProductId(recipe.productItemId); setOutputQty(String(recipe.yieldQty)); setOutputUnitFactor(1)
    setMaterials(recipe.ingredients.map((ingredient) => { const item = items.find((candidate) => candidate.id === ingredient.itemId); return { id: crypto.randomUUID(), itemId: ingredient.itemId, code: item?.sku || item?.barcodes?.[0] || String(item?.id ?? ''), query: itemToken(ingredient.itemId), qty: String(ingredient.qty), unitFactor: 1, unitName: item?.baseUnit ?? '', warehouseId: ingredientWarehouseId || null } }))
    setNotes(recipe.notes); setTab('materials'); toast.show(`تم تحميل تركيبة ${outputItem?.nameAr ?? ''} — عدّل الكميات ثم رحّل`)
  }
  const saveAsRecipe = () => {
    try {
      const ingredients = materials.filter((row) => row.itemId && Number(row.qty) > 0).map((row) => ({ itemId: row.itemId, qty: Number(row.qty) * row.unitFactor }))
      addRecipe({ productItemId: productId, mode: 'prepped', yieldQty: output, ingredients, overheadMinor: 0, isActive: true, notes })
      toast.show('حُفظت التركيبة للاستخدام المتكرر ✓')
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const exportOrders = () => {
    const headers=['الأمر','التاريخ','المنتج','مخزن صرف الخامات','مخزن استلام الناتج','رقم التشغيلة','تاريخ الصلاحية','الكمية','تكلفة الخامات','المصروفات','الإجمالي'];const values=productionOrders.map(order=>[order.orderNumber,order.date.slice(0,10),items.find(item=>item.id===order.productItemId)?.nameAr??'',warehouses.find(warehouse=>warehouse.id===(order.ingredientWarehouseId??order.warehouseId))?.nameAr??'',warehouses.find(warehouse=>warehouse.id===(order.outputWarehouseId??order.warehouseId))?.nameAr??'',order.outputLotNumber??order.orderNumber,order.outputExpiryDate??'',order.producedQty,fmt(order.ingredientsCostMinor),fmt(order.overheadMinor),fmt(order.totalCostMinor)]);const esc=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;const csv='\ufeff'+[headers,...values].map(row=>row.map(esc).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='production-orders.csv';anchor.click();URL.revokeObjectURL(url)
  }
  const reset = () => {
    setProductId(0); setOutputQty(''); setOutputUnitFactor(1); setOutputExpiryDate(''); setOutputLotNumber(''); setMaterials([{ id: crypto.randomUUID(), itemId: 0, code: '', query: '', qty: '', unitFactor: 1, unitName: '' }]); setExpenses([]); setNotes(''); setVarianceReason(''); setProductionDate(new Date().toISOString().slice(0, 10)); setTab('materials')
  }
  const submit = () => {
    try {
      if (strictBalance && Math.abs(variance) > 0.0001) throw new Error('إجمالي الخامات يجب أن يساوي كمية الناتج — عطّل المطابقة الصارمة فقط عند وجود هالك أو تغير وزن')
      if (!strictBalance && Math.abs(variance) > 0.0001 && !varianceReason.trim()) throw new Error('اكتب سبب فرق الوزن/الهالك قبل الترحيل')
      const ingredientRows = materials.filter((row) => row.itemId && Number(row.qty) > 0).map((row) => ({ itemId: row.itemId, qty: Number(row.qty) * row.unitFactor, warehouseId: row.warehouseId ?? (ingredientWarehouseId || null) }))
      const order = postProduction({ productItemId: productId, producedQty: output, ingredients: ingredientRows, expenses, allowNegativeIngredients, ingredientWarehouseId: ingredientWarehouseId || null, outputWarehouseId, date: productionDate, outputExpiryDate: outputExpiryDate || null, outputLotNumber: outputLotNumber || null, notes: [notes, varianceReason && `سبب فرق الكمية: ${varianceReason}`].filter(Boolean).join(' — ') })
      toast.show(`تم ترحيل ${order.orderNumber} وإضافة ${order.producedQty} ${product?.baseUnit ?? 'وحدة'} للمخزون ✓`)
      reset(); setCreating(false)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  if (!creating) return <div className="space-y-4" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-black">سجل التصنيع</h1><p className="text-xs text-slate-500">راجع التشغيلات السابقة أو ابدأ عملية تصنيع جديدة</p></div><div className="flex gap-2"><Btn variant="ghost" onClick={exportOrders}><FileSpreadsheet size={15}/> تصدير Excel</Btn><Btn onClick={() => setCreating(true)}><Plus size={16}/> عملية تصنيع جديدة</Btn></div></div>
    {productionOrders.length === 0 ? <div className="rounded-2xl border bg-white dark:bg-card-dark p-16 text-center"><Factory className="mx-auto mb-3 text-slate-300" size={42}/><b>لا توجد عمليات تصنيع بعد</b><p className="text-xs text-slate-500 mt-1">ابدأ أول عملية لتحويل الخامات إلى منتج تام</p></div> : <div className="rounded-2xl border bg-white dark:bg-card-dark overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-500/10"><tr><th className="p-3 text-right">الأمر</th><th>التاريخ</th><th>المنتج</th><th>صرف الخامات</th><th>استلام الناتج</th><th>التشغيلة</th><th>الصلاحية</th><th>الكمية</th><th>التكلفة</th></tr></thead><tbody>{[...productionOrders].reverse().map((order) => <tr key={order.id} className="border-t"><td className="p-3 font-bold">{order.orderNumber}</td><td>{order.date.slice(0,10)}</td><td><span className="ml-2 font-mono text-[10px] text-slate-400" dir="ltr">{items.find((item) => item.id === order.productItemId)?.sku || items.find((item) => item.id === order.productItemId)?.barcodes?.[0] || order.productItemId}</span>{items.find((item) => item.id === order.productItemId)?.nameAr}</td><td>{warehouses.find((warehouse) => warehouse.id === (order.ingredientWarehouseId ?? order.warehouseId))?.nameAr ?? '—'}</td><td>{warehouses.find((warehouse) => warehouse.id === (order.outputWarehouseId ?? order.warehouseId))?.nameAr ?? '—'}</td><td>{order.outputLotNumber ?? order.orderNumber}</td><td>{order.outputExpiryDate ?? '—'}</td><td>{order.producedQty}</td><td>{fmt(order.totalCostMinor)}</td></tr>)}</tbody></table></div>}
  </div>

  return <div className="space-y-3 pb-20" dir="rtl">
    <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark p-4">
      <div className="flex items-center gap-2 mb-3"><button onClick={() => setCreating(false)} className="p-2 rounded-xl hover:bg-slate-500/10" title="العودة لسجل التصنيع"><ArrowRight size={18}/></button><Factory className="text-amber-600"/><div><h1 className="font-black text-lg">عملية تصنيع جديدة</h1><p className="text-[11px] text-slate-500">حدد المنتج والكمية الناتجة، ثم أدخل الخامات الفعلية والمصروفات</p></div></div>
      <div className="grid md:grid-cols-[1fr_170px_170px_150px_130px] gap-3 form-row">
        <Field label="الصنف المطلوب إنتاجه *" hint="يجب أن يكون مسجلاً في الأصناف والمخزون">
          <ItemQuickPicker items={activeItems} onPick={(id) => { setProductId(id); setOutputUnitFactor(1); setOutputExpiryDate('') }} placeholder="ابحث عن المنتج النهائي ثم Enter" />
        </Field>
        <Field label="مخزن صرف الخامات *"><QuickSelect className={inputCls} value={ingredientWarehouseId} onChange={(e)=>changeIngredientWarehouse(Number(e.target.value))}><option value={0}>كل المخازن — اختيار لكل خامة</option>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect></Field><Field label="مخزن استلام الناتج *"><QuickSelect className={inputCls} value={outputWarehouseId} onChange={(e)=>setOutputWarehouseId(Number(e.target.value))}>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect></Field>
        <Field label="الكمية المطلوب تصنيعها *"><input className={inputCls} inputMode="decimal" value={outputQty} onChange={(event) => setOutputQty(event.target.value)} placeholder="مثال: 3" /></Field>
        <Field label="وحدة الناتج"><QuickSelect className={inputCls} value={outputUnitFactor} onChange={(e)=>setOutputUnitFactor(Number(e.target.value))} disabled={!product}><option value={1}>{product?.baseUnit??'الوحدة الأساسية'}</option>{product?.extraUnits.map(unit=><option key={unit.nameAr} value={unit.factor}>{unit.nameAr} × {unit.factor}</option>)}</QuickSelect></Field>
      </div>
      <div className="mt-3 grid md:grid-cols-[180px_180px_1fr_auto] gap-2 form-row"><Field label="تاريخ التصنيع"><input type="date" className={inputCls} value={productionDate} onChange={(e)=>setProductionDate(e.target.value)}/></Field><Field label="رقم تشغيلة الناتج" hint="يُولد من رقم الأمر إذا تُرك فارغاً"><input className={inputCls} value={outputLotNumber} onChange={(e)=>setOutputLotNumber(e.target.value)} placeholder="مثال LOT-2026-001"/></Field><Field label="تحميل تركيبة محفوظة"><QuickSelect className={inputCls} value="" onChange={(e)=>{loadRecipe(Number(e.target.value));e.target.value=''}}><option value="">اختر تركيبة سابقة…</option>{recipes.filter(recipe=>recipe.mode==='prepped'&&recipe.isActive).map(recipe=><option key={recipe.id} value={recipe.id}>{items.find(item=>item.id===recipe.productItemId)?.sku || items.find(item=>item.id===recipe.productItemId)?.barcodes?.[0] || recipe.productItemId} — {items.find(item=>item.id===recipe.productItemId)?.nameAr} — ناتج {recipe.yieldQty}</option>)}</QuickSelect></Field><Btn variant="ghost" onClick={saveAsRecipe} disabled={!productId||output<=0||!materials.some(row=>row.itemId)}>حفظ كتركيبة</Btn></div>
    </header>

    <div className="h-px bg-gradient-to-l from-transparent via-amber-500/60 to-transparent" />

    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark overflow-hidden min-h-[420px]">
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button onClick={() => setTab('materials')} className={`flex-1 py-3 font-black text-sm flex justify-center gap-2 ${tab === 'materials' ? 'bg-amber-500/10 text-amber-700 border-b-2 border-amber-500' : 'text-slate-400'}`}><Boxes size={17}/> الخامات الداخلة <span className="text-[10px]">({materials.filter((row) => row.itemId).length})</span></button>
        <button onClick={() => setTab('expenses')} className={`flex-1 py-3 font-black text-sm flex justify-center gap-2 ${tab === 'expenses' ? 'bg-sky-500/10 text-sky-700 border-b-2 border-sky-500' : 'text-slate-400'}`}><WalletCards size={17}/> مصروفات التصنيع <span className="text-[10px]">({expenses.length})</span></button>
      </div>

      {tab === 'materials' ? <div className="p-4 space-y-3">
        <div className={`grid ${materialGrid} gap-2 px-2 text-[10px] font-bold text-slate-400`}><span>كود الصنف</span><span>اسم الخام / بحث</span>{ingredientWarehouseId===0&&<span>مخزن الصرف</span>}<span>المتاح</span><span>الوحدة</span><span>الكمية</span><span/></div>
                {materials.map((row) => {
          const item = items.find((candidate) => candidate.id === row.itemId)
          return <div key={row.id} data-entry-row className={`entry-grid grid ${materialGrid} items-center rounded-xl border border-slate-100 dark:border-slate-800 p-2`}>
            <input ref={(node) => { codeRefs.current[row.id] = node }} className={inputCls} value={row.code} onChange={(event) => { const value = event.target.value; patchMaterial(row.id, { code: value }); if (value.trim()) openMaterialPicker(row.id, value) }} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); const found = resolveItem(event.currentTarget.value); if (found) patchMaterial(row.id, { itemId: found.id, code: found.sku || found.barcodes?.[0] || String(found.id), query: itemToken(found.id), unitFactor: 1, unitName: found.baseUnit }); requestAnimationFrame(() => itemRefs.current[row.id]?.focus()) }} placeholder="الكود" />
            <input ref={(node) => { itemRefs.current[row.id] = node }} className={inputCls} value={row.query} onChange={(event) => { const value = event.target.value; patchMaterial(row.id, { query: value, itemId: 0 }); if (value.trim()) openMaterialPicker(row.id, value) }} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); const found = resolveItem(event.currentTarget.value); if (found) chooseMaterial(row.id, found.id); else openMaterialPicker(row.id, event.currentTarget.value) }} placeholder="اكتب الاسم ثم Enter للاختيار" />
            {ingredientWarehouseId===0&&<QuickSelect data-arrows-native="true" className={inputCls} value={row.warehouseId??''} onChange={(e)=>patchMaterial(row.id,{warehouseId:Number(e.target.value)||null})}><option value="">اختر المخزن</option>{warehouses.map(warehouse=><option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect>}<div className={`text-xs font-bold ${warehouseQty(item?.id ?? 0, row.warehouseId ?? ingredientWarehouseId) < (Number(row.qty) || 0) * row.unitFactor ? 'text-rose-600' : 'text-emerald-600'}`}>{item ? `${warehouseQty(item.id, row.warehouseId ?? ingredientWarehouseId)} ${item.baseUnit}` : '—'}</div>
            <QuickSelect className={inputCls} value={row.unitFactor} disabled={!item} onChange={(e)=>{const factor=Number(e.target.value);const unit=item?.extraUnits.find(candidate=>candidate.factor===factor);patchMaterial(row.id,{unitFactor:factor,unitName:unit?.nameAr??item?.baseUnit??''})}}><option value={1}>{item?.baseUnit??'الوحدة'}</option>{item?.extraUnits.map(unit=><option key={unit.nameAr} value={unit.factor}>{unit.nameAr}</option>)}</QuickSelect>
            <input ref={(node) => { qtyRefs.current[row.id] = node }} className={inputCls} inputMode="decimal" value={row.qty} onChange={(event) => patchMaterial(row.id, { qty: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addMaterialAndFocus() } }} placeholder="0" />
            <button onClick={() => setMaterials((rows) => rows.filter((candidate) => candidate.id !== row.id))} className="text-rose-500"><Trash2 size={15}/></button>
          </div>
        })}
        <Btn variant="ghost" onClick={addMaterialAndFocus}><Plus size={15}/> إضافة خامة</Btn>
      </div> : <div className="p-4 space-y-3">
        <div className="flex justify-between items-center"><div><b>المصروفات المحملة على المنتج</b><p className="text-[10px] text-slate-500">أكياس تعبئة، عمالة أسبوعية أو تشغيل — تُثبت مستحقة ولا تُدفع من أمر التصنيع</p></div><div className="flex gap-2"><Btn variant="ghost" onClick={() => setQuickOpen(!quickOpen)}>+ نوع مصروف جديد</Btn><Btn onClick={addExpense}><Plus size={14}/> إضافة مصروف</Btn></div></div>
        {quickOpen && <div className="grid grid-cols-[120px_1fr_auto] gap-2 rounded-xl bg-sky-500/5 border border-sky-500/20 p-2"><input className={inputCls} value={quickCode} onChange={(e) => setQuickCode(e.target.value)} placeholder="5xxx"/><input className={inputCls} value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="اسم المصروف"/><Btn onClick={addQuickAccount} disabled={!quickCode || !quickName}>حفظ وإضافة</Btn></div>}
        {expenses.map((expense, index) => <div key={expense.id} data-entry-row className="entry-grid grid md:grid-cols-[1fr_1fr_140px_1fr_36px] items-center rounded-xl border p-2"><input className={inputCls} value={expense.label} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} placeholder="البيان"/><QuickSelect className={inputCls} value={expense.accountCode} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, accountCode: e.target.value } : row))}>{expenseAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.nameAr}</option>)}</QuickSelect><DecimalInput className={inputCls} value={expense.amountMinor ? expense.amountMinor / 10 ** cur.decimals : ''} onValueChange={(value) => setExpenses(expenses.map((row, i) => i === index ? { ...row, amountMinor: Math.max(0, toMinor(value || '0', cur.decimals)) } : row))} placeholder="المبلغ"/><QuickSelect className={inputCls} value={expense.payableAccountCode ?? '2117'} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, payableAccountCode: e.target.value as '2117' | '2104' } : row))}><option value="2117">مصروف تصنيع مستحق</option><option value="2104">أجور عمالة مستحقة</option></QuickSelect><button onClick={() => setExpenses(expenses.filter((_, i) => i !== index))} className="text-rose-500"><Trash2 size={15}/></button></div>)}
        {!expenses.length && <div className="py-16 text-center text-sm text-slate-400">لا توجد مصروفات تصنيع — يمكن الترحيل بالخامات فقط</div>}
      </div>}
    </section>

    <section className="grid md:grid-cols-4 gap-2">
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">إجمالي كمية الخامات</div><b className="text-lg">{totalInputQty} <small>{product?.baseUnit??''}</small></b></div>
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">كمية الناتج</div><b className="text-lg">{output} <small>{product?.baseUnit??''}</small></b></div>
      <div className={`rounded-xl border p-3 ${Math.abs(variance) < 0.0001 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}><div className="text-[10px] text-slate-400">فرق الكمية</div><b className="flex items-center gap-1">{Math.abs(variance) < 0.0001 ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>} {variance}</b><div className="text-[9px] text-slate-400">يُسمح بالفرق للهالك أو تغير الوزن</div></div>
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">التكلفة / تكلفة الوحدة</div><b>{fmt(totalCost)} / {fmt(unitCost)}</b></div>
    </section>
    <div className="rounded-xl border p-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={strictBalance} onChange={(e)=>setStrictBalance(e.target.checked)}/> مطابقة صارمة: الداخل = الخارج</label><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={allowNegativeIngredients} onChange={(e)=>{setAllowNegativeIngredients(e.target.checked);localStorage.setItem('shopsys:manufacturing:allow-negative-stock',String(e.target.checked))}}/> السماح بصرف خامات برصيد سالب</label>{!strictBalance&&Math.abs(variance)>0.0001&&<input className={`${inputCls} flex-1`} value={varianceReason} onChange={(e)=>setVarianceReason(e.target.value)} placeholder="سبب فرق الوزن أو الهالك (إجباري)"/>}</div>
    <Field label="ملاحظات أمر التصنيع"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="رقم التشغيلة، الوردية، سبب فرق الوزن…"/></Field>
    {pickerRowId && <div className="fixed inset-0 z-50 bg-slate-950/55 p-4 flex items-center justify-center" onMouseDown={() => setPickerRowId(null)}><div className="w-full max-w-2xl max-h-[75vh] overflow-hidden rounded-2xl bg-white dark:bg-card-dark shadow-2xl border" onMouseDown={(event) => event.stopPropagation()}><div className="p-4 border-b"><b>اختيار خامة للتصنيع</b><input autoFocus className={`${inputCls} mt-3`} value={pickerSearch} onChange={(event) => { setPickerSearch(event.target.value); setPickerIndex(0) }} onKeyDown={(event) => { const matches = activeItems.filter((candidate) => candidate.id !== productId && [candidate.nameAr, candidate.sku, ...(candidate.barcodes ?? [])].join(' ').toLowerCase().includes(pickerSearch.trim().toLowerCase())); if (event.key === 'ArrowDown') { event.preventDefault(); setPickerIndex((index) => Math.min(matches.length - 1, index + 1)) } else if (event.key === 'ArrowUp') { event.preventDefault(); setPickerIndex((index) => Math.max(0, index - 1)) } else if (event.key === 'Enter') { event.preventDefault(); const selected = matches[pickerIndex] ?? matches[0]; if (selected) chooseMaterial(pickerRowId, selected.id) } else if (event.key === 'Escape') { event.preventDefault(); setPickerRowId(null) } }} placeholder="ابحث بالاسم أو الكود أو الباركود ثم Enter"/></div><div className="max-h-[52vh] overflow-auto p-2">{activeItems.filter((candidate) => candidate.id !== productId && [candidate.nameAr, candidate.sku, ...(candidate.barcodes ?? [])].join(' ').toLowerCase().includes(pickerSearch.trim().toLowerCase())).map((candidate, index) => <button key={candidate.id} onClick={() => chooseMaterial(pickerRowId, candidate.id)} className={`w-full grid grid-cols-[110px_1fr_120px] gap-3 text-right p-3 rounded-xl focus:outline-none ${index === pickerIndex ? 'bg-amber-500/15 ring-2 ring-amber-500/40' : 'hover:bg-amber-500/10'}`}><span className="font-mono text-xs">{candidate.sku || candidate.barcodes?.[0] || candidate.id}</span><b>{candidate.nameAr}</b><span className="text-xs text-slate-500">متاح {warehouseQty(candidate.id)}</span></button>)}</div></div></div>}
    <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 dark:bg-card-dark/95 border-t p-3 flex justify-between items-center"><span className="text-xs text-slate-500">خامات {fmt(materialCost)} + مصروفات {fmt(expenseTotal)} = <b>{fmt(totalCost)}</b></span><Btn onClick={submit} shortcut="F9" disabled={!productId || output <= 0 || (!!product?.trackExpiry && !outputExpiryDate) || !materials.some((row) => row.itemId && Number(row.qty) > 0)}><Factory size={16}/> ترحيل عملية التصنيع</Btn></div>


  </div>
}
