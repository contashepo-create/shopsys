/**
 * سجل السيريالات / IMEI (جولة مراجعة الموبايلات — نمط mobileshop):
 * كل قطعة مسلسلة بدورة حياتها الكاملة: دخلت بأي فاتورة شراء، بيعت بأي فاتورة،
 * لمن، وحالة ضمانها الآن — استعلام فوري بأي IMEI (للفني ولخدمة العملاء).
 */
import { useMemo, useState } from 'react'
import { ScanBarcode, Smartphone, ShieldCheck, ShieldX, PackageCheck, RotateCcw } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { normalizeSerial, warrantyEndDate } from '../../core/serials.ts'
import { inputCls, EmptyState } from '../components/ui.tsx'
import { useAppStore } from '../../stores/app.store.ts'
import { renderWarrantyCardHtml } from '../print/printWarranty.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Printer } from 'lucide-react'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  in_stock: { label: 'بالمخزون', cls: 'bg-emerald-500/10 text-emerald-600' },
  sold: { label: 'مباعة', cls: 'bg-sky-500/10 text-sky-600' },
  returned_supplier: { label: 'مرتجعة للمورد', cls: 'bg-rose-500/10 text-rose-600' },
}

export function SerialsPage() {
  const { serials, items, sales, customers } = useDataStore()
  const { setup } = useAppStore()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'sold' | 'returned_supplier'>('all')
  const today = new Date().toISOString().slice(0, 10)

  const itemName = (id: number) => items.find((it) => it.id === id)?.nameAr ?? '—'
  const saleInfo = (saleId: number | null) => {
    if (saleId == null) return null
    const s = sales.find((x) => x.id === saleId)
    if (!s) return null
    const cust = s.customerId != null ? customers.find((c) => c.id === s.customerId)?.nameAr : null
    return { invoiceNumber: s.invoiceNumber, customer: cust ?? 'عميل نقدي' }
  }

  const rows = useMemo(() => {
    const q = normalizeSerial(query)
    return serials
      .filter((u) => (statusFilter === 'all' || u.status === statusFilter))
      .filter((u) => !q || u.serial.includes(q) || itemName(u.itemId).includes(query.trim()))
      .map((u) => {
        const warrantyUntil = u.status === 'sold' && u.soldAt ? warrantyEndDate(u.soldAt, u.warrantyMonths) : null
        return {
          ...u,
          warrantyUntil,
          warrantyActive: warrantyUntil != null && today <= warrantyUntil,
          sale: saleInfo(u.saleId),
        }
      })
      .sort((a, b) => b.id - a.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serials, query, statusFilter, sales, customers, items, today])

  const counts = useMemo(() => ({
    inStock: serials.filter((u) => u.status === 'in_stock').length,
    sold: serials.filter((u) => u.status === 'sold').length,
    activeWarranty: serials.filter((u) => u.status === 'sold' && u.soldAt && today <= warrantyEndDate(u.soldAt, u.warrantyMonths)).length,
  }), [serials, today])

  /** طباعة شهادة ضمان لقطعة مباعة (جولة الأجهزة الكهربائية) */
  const printWarranty = (u: (typeof rows)[number]) => {
    if (!u.warrantyUntil || !u.soldAt) return
    printHtml(renderWarrantyCardHtml({
      shopName: setup.shopName || 'تَحَكَّم',
      shopPhone: '',
      itemName: itemName(u.itemId),
      serial: u.serial,
      soldAt: u.soldAt,
      invoiceNumber: u.sale?.invoiceNumber ?? '—',
      customerName: u.sale?.customer ?? 'عميل نقدي',
      warrantyMonths: u.warrantyMonths,
      warrantyUntil: u.warrantyUntil,
    }))
  }

  return (
    <div className="space-y-4">
      <div className="anim-up grid grid-cols-3 gap-3 max-w-xl">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold flex items-center justify-center gap-1"><PackageCheck size={12} /> بالمخزون</div>
          <div className="text-xl font-black text-emerald-600">{counts.inStock}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold flex items-center justify-center gap-1"><Smartphone size={12} /> مباعة</div>
          <div className="text-xl font-black text-sky-600">{counts.sold}</div>
        </div>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 text-center">
          <div className="text-[10.5px] text-slate-400 font-bold flex items-center justify-center gap-1"><ShieldCheck size={12} /> ضمان سارٍ</div>
          <div className="text-xl font-black text-violet-600">{counts.activeWarranty}</div>
        </div>
      </div>

      <div className="anim-up flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-64">
          <ScanBarcode size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="امسح أو اكتب IMEI/سيريال أو اسم الصنف…"
            className={`${inputCls} pr-10`}
            dir="ltr"
            style={{ textAlign: 'right' }}
          />
        </div>
        {(['all', 'in_stock', 'sold', 'returned_supplier'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-2 rounded-xl text-[11.5px] font-bold border-2 transition-all ${
              statusFilter === st ? 'border-brand-500/60 bg-brand-500/10 text-brand-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'
            }`}
          >
            {st === 'all' ? 'الكل' : STATUS_META[st].label}
          </button>
        ))}
      </div>

      {serials.length === 0 ? (
        <EmptyState icon="📱" title="لا سيريالات مسجلة" sub="أدخل السيريالات/IMEI في سطور فاتورة الشراء لتتبعها هنا بدورة حياتها كاملة" />
      ) : rows.length === 0 ? (
        <EmptyState icon="🔍" title="لا نتائج" sub="جرّب سيريالاً آخر أو غيّر فلتر الحالة" />
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">السيريال / IMEI</th>
                <th className="px-4 py-2.5">الصنف</th>
                <th className="px-4 py-2.5">الحالة</th>
                <th className="px-4 py-2.5">الدخول</th>
                <th className="px-4 py-2.5">البيع</th>
                <th className="px-4 py-2.5">الضمان</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((u) => (
                <tr key={u.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2 font-mono font-bold text-slate-800 dark:text-white" dir="ltr">{u.serial}</td>
                  <td className="px-4 py-2 font-bold text-slate-600 dark:text-slate-300">{itemName(u.itemId)}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${STATUS_META[u.status]?.cls ?? ''}`}>
                      {STATUS_META[u.status]?.label ?? u.status}
                    </span>
                    {u.status === 'in_stock' && u.saleId != null && (
                      <span className="mr-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-500/10 text-amber-600" title="بيعت ثم أُرجعت — عادت للمخزون">
                        <RotateCcw size={9} className="inline -mt-0.5" /> مرتجعة
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-400 font-mono text-[10.5px]" dir="ltr">
                    {u.receivedAt.slice(0, 10)}
                    {u.purchaseId != null && <div className="text-[9.5px]">شراء #{u.purchaseId}</div>}
                  </td>
                  <td className="px-4 py-2 text-slate-500 text-[11px]">
                    {u.sale ? (
                      <>
                        <div className="font-bold">{u.sale.invoiceNumber}</div>
                        <div className="text-[10px] text-slate-400">{u.sale.customer}{u.soldAt ? ` — ${u.soldAt.slice(0, 10)}` : ''}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {u.warrantyUntil ? (
                      <span className="inline-flex items-center gap-1.5">
                        {u.warrantyActive ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><ShieldCheck size={12} /> حتى {u.warrantyUntil}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-500"><ShieldX size={12} /> انتهى {u.warrantyUntil}</span>
                        )}
                        <button onClick={() => printWarranty(u)} title="طباعة شهادة ضمان" className="text-slate-300 hover:text-brand-500 transition-colors"><Printer size={13} /></button>
                      </span>
                    ) : u.status === 'in_stock' && u.warrantyMonths > 0 ? (
                      <span className="text-[10.5px] text-slate-400">{u.warrantyMonths} شهراً عند البيع</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && <div className="px-4 py-2 text-[10.5px] text-slate-400 text-center">يعرض أول 300 نتيجة — ضيّق البحث</div>}
        </div>
      )}
    </div>
  )
}
