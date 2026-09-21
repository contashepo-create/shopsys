/** شاشة المخازن — إدارة + عرض محتويات كل مخزن */
import { useMemo, useState } from 'react'
import { Warehouse, Plus, Trash2, Star, Eye, Search } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { computeWarehouseStock, buildWarehouseDocs } from '../../core/transfers.ts'
import { Btn, inputCls, useToast, Modal, EmptyState } from '../components/ui.tsx'

export function WarehousesPage() {
  const { warehouses, addWarehouse, removeWarehouse, items, categories, transfers, purchases, sales, saleReturns, purchaseReturns } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const [name, setName] = useState('')
  const [viewWarehouseId, setViewWarehouseId] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState(0)

  const country = setup.countryCode ? getCountry(setup.countryCode) : undefined
  const cur = country?.currency ?? { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const stock = useMemo(
    () => computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns)),
    [items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns],
  )
  const selectedWarehouse = warehouses.find((w) => w.id === viewWarehouseId) ?? null
  const rows = useMemo(() => {
    if (!selectedWarehouse) return []
    const map = stock.get(selectedWarehouse.id) ?? new Map<number, number>()
    const term = q.trim()
    return items
      .map((it) => ({ item: it, qty: map.get(it.id) ?? 0 }))
      .filter((r) => r.qty > 0)
      .filter((r) => !catId || r.item.categoryId === catId)
      .filter((r) => !term || r.item.nameAr.includes(term) || r.item.sku.includes(term) || r.item.barcodes.some((b) => b.includes(term)))
      .sort((a, b) => a.item.nameAr.localeCompare(b.item.nameAr, 'ar'))
  }, [selectedWarehouse, stock, items, q, catId])
  const totalValue = rows.reduce((sum, r) => sum + Math.round(r.qty * r.item.costMinor), 0)

  const createWarehouse = () => {
    if (!name.trim()) return
    addWarehouse(name.trim())
    toast.show(`تم إنشاء مخزن «${name.trim()}»`)
    setName('')
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="anim-up flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) createWarehouse() }}
          placeholder="اسم المخزن الجديد… ثم Enter"
          className={inputCls}
        />
        <Btn onClick={createWarehouse} disabled={!name.trim()}>
          <span className="flex items-center gap-1.5"><Plus size={15} /> إضافة</span>
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {warehouses.map((w, i) => {
          const map = stock.get(w.id) ?? new Map<number, number>()
          const itemCount = [...map.values()].filter((v) => v > 0).length
          return (
            <div
              key={w.id}
              style={{ animationDelay: `${i * 60}ms` }}
              onDoubleClick={() => { setViewWarehouseId(w.id); setQ(''); setCatId(0) }}
              title="اضغط مرتين لعرض محتويات المخزن"
              className="anim-up group flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 hover:border-amber-400/50 hover:shadow-lg transition-all duration-200 cursor-default"
            >
              <span className="w-11 h-11 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center transition-transform duration-200 group-hover:scale-110">
                <Warehouse size={20} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                  {w.nameAr}
                  {w.isMain && <Star size={13} className="text-amber-400 fill-amber-400" />}
                </div>
                <div className="text-[11px] text-slate-400">{w.isMain ? 'المخزن الرئيسي — لا يُحذف' : 'مخزن فرعي'} · {itemCount} صنف برصيد</div>
              </div>
              <button
                onClick={() => { setViewWarehouseId(w.id); setQ(''); setCatId(0) }}
                title="عرض الأصناف داخل المخزن"
                className="p-2 rounded-lg text-slate-300 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
              >
                <Eye size={16} />
              </button>
              {!w.isMain && (
                <button
                  onClick={() => {
                    try { removeWarehouse(w.id); toast.show('تم حذف المخزن') }
                    catch (err) { toast.show((err as Error).message, 'error') }
                  }}
                  className="p-2 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-slate-400">💡 اضغط مرتين على أي مخزن لفتح قائمة الأصناف داخله. الأرصدة مشتقة من فواتير الشراء/البيع والتحويلات والمرتجعات.</p>

      <Modal open={!!selectedWarehouse} onClose={() => setViewWarehouseId(null)} title={selectedWarehouse ? `🏬 محتويات مخزن — ${selectedWarehouse.nameAr}` : ''} wide>
        {selectedWarehouse && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
              <div className="relative">
                <Search size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="فلترة بالاسم أو SKU أو الباركود…" className={`${inputCls} pr-10`} autoFocus />
              </div>
              <select value={catId} onChange={(e) => setCatId(Number(e.target.value))} className={inputCls}>
                <option value={0}>كل الأقسام</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50"><div className="text-[10px] text-slate-400">عدد الأصناف</div><div className="font-black text-lg">{rows.length}</div></div>
              <div className="p-3 rounded-xl bg-emerald-500/5"><div className="text-[10px] text-slate-400">قيمة التكلفة</div><div className="font-black text-lg text-emerald-600">{fmt(totalValue)}</div></div>
              <div className="p-3 rounded-xl bg-sky-500/5"><div className="text-[10px] text-slate-400">نوع المخزن</div><div className="font-black text-lg text-sky-600">{selectedWarehouse.isMain ? 'رئيسي' : 'فرعي'}</div></div>
              <div className="p-3 rounded-xl bg-violet-500/5"><div className="text-[10px] text-slate-400">فلترة</div><div className="font-black text-lg text-violet-600">{q || catId ? 'مفعلة' : 'كل الأصناف'}</div></div>
            </div>
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800"><EmptyState icon="📦" title="لا أصناف مطابقة" sub="هذا المخزن لا يحتوي أصنافاً بهذه الفلاتر حالياً" /></div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto max-h-[55vh] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-card-dark">
                      <th className="px-4 py-2">الصنف</th><th className="px-4 py-2">القسم</th><th className="px-4 py-2">الرصيد</th><th className="px-4 py-2">التكلفة</th><th className="px-4 py-2">قيمة المخزون</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ item, qty }) => (
                      <tr key={item.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-amber-500/[0.03]">
                        <td className="px-4 py-2 font-bold text-slate-800 dark:text-white">
                          {item.nameAr}
                          <div className="text-[10px] text-slate-400 font-normal">{item.sku}{item.barcodes[0] ? ` · ${item.barcodes[0]}` : ''}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-500">{categories.find((c) => c.id === item.categoryId)?.nameAr ?? '—'}</td>
                        <td className="px-4 py-2 font-black text-amber-600">{Number.isInteger(qty) ? qty : qty.toFixed(3)} {item.baseUnit}</td>
                        <td className="px-4 py-2 text-slate-500">{fmt(item.costMinor)}</td>
                        <td className="px-4 py-2 font-bold text-emerald-600">{fmt(Math.round(qty * item.costMinor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
