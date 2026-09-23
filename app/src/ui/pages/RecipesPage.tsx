import { useMemo, useState } from 'react'
import { Factory, Plus, Trash2, WalletCards, Boxes, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import type { ProductionExpense } from '../../core/recipes.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

type MaterialRow = { id: string; itemId: number; query: string; qty: string }
type Tab = 'materials' | 'expenses'

export function RecipesPage() {
  const { items, productionOrders, customAccounts, addCustomAccount, postProduction } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(() => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }, [setup.countryCode])
  const activeItems = useMemo(() => items.filter((item) => item.isActive), [items])
  const [productId, setProductId] = useState(0)
  const [outputQty, setOutputQty] = useState('')
  const [tab, setTab] = useState<Tab>('materials')
  const [materials, setMaterials] = useState<MaterialRow[]>([{ id: crypto.randomUUID(), itemId: 0, query: '', qty: '' }])
  const [expenses, setExpenses] = useState<ProductionExpense[]>([])
  const [treasury] = useState('1101')
  const [notes, setNotes] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickCode, setQuickCode] = useState('')
  const [quickName, setQuickName] = useState('')

  const product = activeItems.find((item) => item.id === productId)
  const totalInputQty = materials.reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
  const output = Number(outputQty) || 0
  const variance = output - totalInputQty
  const materialCost = materials.reduce((sum, row) => {
    const item = items.find((candidate) => candidate.id === row.itemId)
    return sum + Math.round((Number(row.qty) || 0) * (item?.costMinor ?? 0))
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
  const addMaterial = () => setMaterials((rows) => [...rows, { id: crypto.randomUUID(), itemId: 0, query: '', qty: '' }])
  const addExpense = () => setExpenses((rows) => [...rows, { id: crypto.randomUUID(), label: '', accountCode: expenseAccounts[0]?.code ?? '5108', amountMinor: 0, treasury }])
  const addQuickAccount = () => {
    try {
      const account = addCustomAccount({ code: quickCode, nameAr: quickName, parentCode: '5' })
      setQuickCode(''); setQuickName(''); setQuickOpen(false)
      setExpenses((rows) => [...rows, { id: crypto.randomUUID(), label: account.nameAr, accountCode: account.code, amountMinor: 0, treasury }])
      toast.show(`أُضيف «${account.nameAr}» واختير كمصروف تصنيع ✓`)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const reset = () => {
    setProductId(0); setOutputQty(''); setMaterials([{ id: crypto.randomUUID(), itemId: 0, query: '', qty: '' }]); setExpenses([]); setNotes(''); setTab('materials')
  }
  const submit = () => {
    try {
      const ingredientRows = materials.filter((row) => row.itemId && Number(row.qty) > 0).map((row) => ({ itemId: row.itemId, qty: Number(row.qty) }))
      const order = postProduction({ productItemId: productId, producedQty: output, ingredients: ingredientRows, expenses, treasury, notes })
      toast.show(`تم ترحيل ${order.orderNumber} وإضافة ${order.producedQty} ${product?.baseUnit ?? 'وحدة'} للمخزون ✓`)
      reset()
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  return <div className="space-y-3 pb-20" dir="rtl">
    <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark p-4">
      <div className="flex items-center gap-2 mb-3"><Factory className="text-amber-600"/><div><h1 className="font-black text-lg">عملية تصنيع جديدة</h1><p className="text-[11px] text-slate-500">حدد المنتج والكمية الناتجة، ثم أدخل الخامات الفعلية والمصروفات</p></div></div>
      <div className="grid md:grid-cols-[1fr_180px_130px] gap-3 items-end">
        <Field label="الصنف المطلوب إنتاجه *" hint="يجب أن يكون مسجلاً في الأصناف والمخزون">
          <select className={inputCls} value={productId} onChange={(event) => setProductId(Number(event.target.value))}>
            <option value={0}>اختر المنتج النهائي…</option>{activeItems.map((item) => <option key={item.id} value={item.id}>{item.sku ? `${item.sku} — ` : ''}{item.nameAr}</option>)}
          </select>
        </Field>
        <Field label="الكمية المطلوب تصنيعها *"><input className={inputCls} inputMode="decimal" value={outputQty} onChange={(event) => setOutputQty(event.target.value)} placeholder="مثال: 3" /></Field>
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5"><div className="text-[10px] text-slate-500">وحدة الناتج</div><b>{product?.baseUnit ?? '—'}</b></div>
      </div>
    </header>

    <div className="h-px bg-gradient-to-l from-transparent via-amber-500/60 to-transparent" />

    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-card-dark overflow-hidden min-h-[420px]">
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        <button onClick={() => setTab('materials')} className={`flex-1 py-3 font-black text-sm flex justify-center gap-2 ${tab === 'materials' ? 'bg-amber-500/10 text-amber-700 border-b-2 border-amber-500' : 'text-slate-400'}`}><Boxes size={17}/> الخامات الداخلة <span className="text-[10px]">({materials.filter((row) => row.itemId).length})</span></button>
        <button onClick={() => setTab('expenses')} className={`flex-1 py-3 font-black text-sm flex justify-center gap-2 ${tab === 'expenses' ? 'bg-sky-500/10 text-sky-700 border-b-2 border-sky-500' : 'text-slate-400'}`}><WalletCards size={17}/> مصروفات التصنيع <span className="text-[10px]">({expenses.length})</span></button>
      </div>

      {tab === 'materials' ? <div className="p-4 space-y-3">
        <div className="grid grid-cols-[125px_1fr_150px_110px_36px] gap-2 px-2 text-[10px] font-bold text-slate-400"><span>كود الصنف</span><span>اسم الخام / بحث</span><span>المتاح</span><span>الكمية</span><span/></div>
        <datalist id="manufacturing-items">{activeItems.filter((item) => item.id !== productId).map((item) => <option key={item.id} value={itemToken(item.id)} />)}</datalist>
        {materials.map((row) => {
          const item = items.find((candidate) => candidate.id === row.itemId)
          return <div key={row.id} className="grid grid-cols-[125px_1fr_150px_110px_36px] gap-2 items-center rounded-xl border border-slate-100 dark:border-slate-800 p-2">
            <div className="font-mono text-xs text-slate-500">{item?.sku || item?.barcodes?.[0] || item?.id || '—'}</div>
            <input list="manufacturing-items" className={inputCls} value={row.query} onChange={(event) => patchMaterial(row.id, { query: event.target.value })} onBlur={(event) => { const found = resolveItem(event.target.value); if (found) patchMaterial(row.id, { itemId: found.id, query: itemToken(found.id) }) }} placeholder="اكتب الاسم أو الكود أو امسح الباركود" />
            <div className={`text-xs font-bold ${(item?.stockQty ?? 0) < (Number(row.qty) || 0) ? 'text-rose-600' : 'text-emerald-600'}`}>{item ? `${item.stockQty ?? 0} ${item.baseUnit}` : '—'}</div>
            <input className={inputCls} inputMode="decimal" value={row.qty} onChange={(event) => patchMaterial(row.id, { qty: event.target.value })} placeholder="0" />
            <button onClick={() => setMaterials((rows) => rows.filter((candidate) => candidate.id !== row.id))} className="text-rose-500"><Trash2 size={15}/></button>
          </div>
        })}
        <Btn variant="ghost" onClick={addMaterial}><Plus size={15}/> إضافة خامة</Btn>
      </div> : <div className="p-4 space-y-3">
        <div className="flex justify-between items-center"><div><b>المصروفات المحملة على المنتج</b><p className="text-[10px] text-slate-500">عمالة، كهرباء، تشغيل، تعبئة أو أي مصروف مخصص</p></div><div className="flex gap-2"><Btn variant="ghost" onClick={() => setQuickOpen(!quickOpen)}>+ نوع مصروف جديد</Btn><Btn onClick={addExpense}><Plus size={14}/> إضافة مصروف</Btn></div></div>
        {quickOpen && <div className="grid grid-cols-[120px_1fr_auto] gap-2 rounded-xl bg-sky-500/5 border border-sky-500/20 p-2"><input className={inputCls} value={quickCode} onChange={(e) => setQuickCode(e.target.value)} placeholder="5xxx"/><input className={inputCls} value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="اسم المصروف"/><Btn onClick={addQuickAccount} disabled={!quickCode || !quickName}>حفظ وإضافة</Btn></div>}
        {expenses.map((expense, index) => <div key={expense.id} className="grid md:grid-cols-[1fr_1fr_140px_1fr_36px] gap-2 items-center rounded-xl border p-2"><input className={inputCls} value={expense.label} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, label: e.target.value } : row))} placeholder="البيان"/><select className={inputCls} value={expense.accountCode} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, accountCode: e.target.value } : row))}>{expenseAccounts.map((account) => <option key={account.code} value={account.code}>{account.code} — {account.nameAr}</option>)}</select><input className={inputCls} inputMode="decimal" value={expense.amountMinor ? expense.amountMinor / 10 ** cur.decimals : ''} onChange={(e) => setExpenses(expenses.map((row, i) => i === index ? { ...row, amountMinor: Math.max(0, toMinor(e.target.value || '0', cur.decimals)) } : row))} placeholder="المبلغ"/><TreasuryPicker compact operation="payment" value={expense.treasury} onChange={(code) => setExpenses(expenses.map((row, i) => i === index ? { ...row, treasury: code } : row))}/><button onClick={() => setExpenses(expenses.filter((_, i) => i !== index))} className="text-rose-500"><Trash2 size={15}/></button></div>)}
        {!expenses.length && <div className="py-16 text-center text-sm text-slate-400">لا توجد مصروفات تصنيع — يمكن الترحيل بالخامات فقط</div>}
      </div>}
    </section>

    <section className="grid md:grid-cols-4 gap-2">
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">إجمالي كمية الخامات</div><b className="text-lg">{totalInputQty}</b></div>
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">كمية الناتج</div><b className="text-lg">{output}</b></div>
      <div className={`rounded-xl border p-3 ${Math.abs(variance) < 0.0001 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}><div className="text-[10px] text-slate-400">فرق الكمية</div><b className="flex items-center gap-1">{Math.abs(variance) < 0.0001 ? <CheckCircle2 size={15}/> : <AlertTriangle size={15}/>} {variance}</b><div className="text-[9px] text-slate-400">يُسمح بالفرق للهالك أو تغير الوزن</div></div>
      <div className="rounded-xl border p-3"><div className="text-[10px] text-slate-400">التكلفة / تكلفة الوحدة</div><b>{fmt(totalCost)} / {fmt(unitCost)}</b></div>
    </section>
    <Field label="ملاحظات أمر التصنيع"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="رقم التشغيلة، الوردية، سبب فرق الوزن…"/></Field>
    <div className="fixed bottom-0 left-0 right-0 z-20 bg-white/95 dark:bg-card-dark/95 border-t p-3 flex justify-between items-center"><span className="text-xs text-slate-500">خامات {fmt(materialCost)} + مصروفات {fmt(expenseTotal)} = <b>{fmt(totalCost)}</b></span><Btn onClick={submit} disabled={!productId || output <= 0 || !materials.some((row) => row.itemId && Number(row.qty) > 0)}><Factory size={16}/> ترحيل عملية التصنيع</Btn></div>

    {productionOrders.length > 0 && <details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold text-sm">آخر أوامر التصنيع ({productionOrders.length})</summary><div className="mt-2 space-y-1">{[...productionOrders].reverse().slice(0, 10).map((order) => <div key={order.id} className="grid grid-cols-4 text-xs border-t py-2"><b>{order.orderNumber}</b><span>{items.find((item) => item.id === order.productItemId)?.nameAr}</span><span>{order.producedQty}</span><span>{fmt(order.totalCostMinor)}</span></div>)}</div></details>}
  </div>
}
