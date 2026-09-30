/**
 * أوامر الشراء — طلب المالك.
 * أمر الشراء التزام تجاري لا قيد محاسبي: يوثّق المطلوب من المورد بكمياته
 * وأسعاره وضريبته، ثم تُعبَّأ منه فاتورة الشراء بزر «تعبئة من» فتُرحَّل هي وحدها.
 */
import { useMemo, useState } from 'react'
import { ClipboardList, Plus, Send, Trash2, XCircle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Btn, Field, Modal, inputCls, useToast } from '../components/ui.tsx'
import { QuickSelect } from '../components/KeyboardPickers.tsx'
import { formatMinor, toMinor } from '../../core/money.ts'
import { getCountry } from '../../core/countries.ts'
import {
  PURCHASE_ORDER_STATUS_AR, poRemainingQty, purchaseOrderTotals,
  type PurchaseOrderLine, type PurchaseOrderStatus,
} from '../../core/purchaseOrders.ts'

type DraftLine = PurchaseOrderLine & { key: string }

const blankLine = (): DraftLine => ({ key: crypto.randomUUID(), itemId: 0, nameAr: '', qty: 1, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 0, vatPercent: 0, notes: '' })

export function PurchaseOrdersPage() {
  const toast = useToast()
  const { purchaseOrders, addPurchaseOrder, setPurchaseOrderStatus, deletePurchaseOrder, suppliers, items, warehouses } = useDataStore()
  const setup = useAppStore((s) => s.setup)
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const card = 'rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'
  const fmt = (minor: number) => formatMinor(minor, cur, false)

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [expectedDate, setExpectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [warehouseId, setWarehouseId] = useState<number | null>(setup.defaultWarehouseId ?? null)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [statusFilter, setStatusFilter] = useState<'all' | PurchaseOrderStatus>('all')

  const totals = useMemo(() => purchaseOrderTotals(lines), [lines])
  const rows = useMemo(
    () => purchaseOrders.filter((order) => statusFilter === 'all' || order.status === statusFilter).slice().reverse(),
    [purchaseOrders, statusFilter],
  )

  const patch = (key: string, value: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...value } : line)))
  const reset = () => { setLines([blankLine()]); setNotes(''); setSupplierId(null); setSupplierName('') }

  const submit = () => {
    try {
      const order = addPurchaseOrder({
        supplierId, supplierName: supplierName || suppliers.find((s) => s.id === supplierId)?.nameAr || '',
        date, expectedDate, warehouseId, notes,
        lines: lines.map(({ key, ...line }) => { void key; return line }),
      })
      toast.show(`سُجّل أمر الشراء ${order.orderNumber} — ${fmt(purchaseOrderTotals(order.lines).totalMinor)} ${cur.symbol}`)
      setOpen(false); reset()
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black flex items-center gap-2"><ClipboardList size={18} /> أوامر الشراء</h2>
          <p className="text-xs text-slate-500">التزام تجاري بلا قيد محاسبي — تُعبَّأ منه فاتورة الشراء بزر «تعبئة من» فيُرحَّل الأثر عند الفاتورة وحدها.</p>
        </div>
        <div className="flex items-center gap-2">
          <QuickSelect className={`${inputCls} w-44`} aria-label="تصفية حالة الأمر" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">كل الحالات</option>
            {Object.entries(PURCHASE_ORDER_STATUS_AR).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </QuickSelect>
          <Btn onClick={() => setOpen(true)} disabled={!items.length}><span className="flex items-center gap-1.5"><Plus size={15} /> أمر شراء جديد</span></Btn>
        </div>
      </div>

      <section className={`${card} overflow-hidden`} data-po-list>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-black text-slate-500 dark:bg-slate-800/60 dark:text-slate-300">
            <tr><th className="p-2">الأمر</th><th className="p-2">المورد</th><th className="p-2">التاريخ</th><th className="p-2">التسليم</th><th className="p-2">البنود</th><th className="p-2">الإجمالي</th><th className="p-2">الحالة</th><th className="p-2">إجراءات</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8}>
                <div className="grid place-items-center gap-1 p-8 text-center text-slate-400">
                  <ClipboardList size={26} />
                  <b className="text-sm">لا أوامر شراء بعد</b>
                  <span className="text-xs">سجّل ما طلبته من الموردين، ثم عبّئ منه فاتورة الشراء بضغطة.</span>
                </div>
              </td></tr>
            )}
            {rows.map((order) => {
              const sums = purchaseOrderTotals(order.lines)
              const remaining = order.lines.reduce((sum, line) => sum + poRemainingQty(line), 0)
              return (
                <tr key={order.id} className="border-t border-slate-200/70 dark:border-slate-700/60" data-po-row={order.orderNumber}>
                  <td className="p-2 text-center font-mono font-bold">{order.orderNumber}</td>
                  <td className="p-2 text-center">{order.supplierName}</td>
                  <td className="p-2 text-center font-mono text-xs">{order.date}</td>
                  <td className="p-2 text-center font-mono text-xs">{order.expectedDate}</td>
                  <td className="p-2 text-center">{order.lines.length} · متبقٍ {remaining}</td>
                  <td className="p-2 text-center font-mono font-bold">{fmt(sums.totalMinor)}</td>
                  <td className="p-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${order.status === 'closed' ? 'bg-emerald-500/10 text-emerald-600' : order.status === 'cancelled' ? 'bg-rose-500/10 text-rose-600' : order.status === 'partial' ? 'bg-amber-500/10 text-amber-600' : 'bg-sky-500/10 text-sky-600'}`}>
                      {PURCHASE_ORDER_STATUS_AR[order.status]}
                    </span>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-center gap-1">
                      {order.status === 'draft' && <button type="button" className="doc-row-delete" style={{ borderColor: 'rgb(56 189 248 / .4)', background: 'rgb(56 189 248 / .12)', color: '#0284c7' }} title="إرسال للمورد" aria-label="إرسال للمورد" onClick={() => { setPurchaseOrderStatus(order.id, 'sent'); toast.show(`أُرسل ${order.orderNumber} للمورد`) }}><Send size={14} /></button>}
                      {order.status !== 'cancelled' && order.status !== 'closed' && <button type="button" className="doc-row-delete" title="إلغاء الأمر" aria-label="إلغاء الأمر" onClick={() => { setPurchaseOrderStatus(order.id, 'cancelled'); toast.show(`أُلغي ${order.orderNumber}`) }}><XCircle size={14} /></button>}
                      <button type="button" className="doc-row-delete" title="حذف الأمر" aria-label="حذف الأمر" onClick={() => { deletePurchaseOrder(order.id); toast.show(`حُذف ${order.orderNumber}`) }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title="أمر شراء جديد" wide>
        <div className="space-y-3" dir="rtl">
          <div className="grid gap-2 md:grid-cols-4">
            <Field label="المورد *">
              <QuickSelect className={inputCls} aria-label="مورد أمر الشراء" value={supplierId ?? ''} onChange={(event) => {
                const id = Number(event.target.value) || null
                setSupplierId(id); setSupplierName(suppliers.find((s) => s.id === id)?.nameAr ?? '')
              }}>
                <option value="">اختر المورد</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.nameAr}</option>)}
              </QuickSelect>
            </Field>
            <Field label="تاريخ الأمر"><input type="date" className={inputCls} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
            <Field label="تاريخ التسليم المتوقع"><input type="date" className={inputCls} value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></Field>
            <Field label="المخزن المستلم">
              <QuickSelect className={inputCls} aria-label="مخزن استلام الأمر" value={warehouseId ?? ''} onChange={(event) => setWarehouseId(Number(event.target.value) || null)}>
                <option value="">بلا تحديد</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}
              </QuickSelect>
            </Field>
          </div>

          <table className="w-full text-sm" data-po-lines>
            <thead className="bg-slate-50 text-[11px] font-black text-slate-500 dark:bg-slate-800/60">
              <tr><th className="p-1">الصنف</th><th className="p-1 w-24">الكمية</th><th className="p-1 w-24">الوحدة</th><th className="p-1 w-28">سعر الوحدة</th><th className="p-1 w-20">ضريبة %</th><th className="p-1 w-28">الإجمالي</th><th className="p-1 w-12" /></tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key}>
                  <td className="p-1">
                    <QuickSelect className={inputCls} aria-label="صنف أمر الشراء" value={line.itemId || ''} onChange={(event) => {
                      const id = Number(event.target.value) || 0
                      const item = items.find((row) => row.id === id)
                      patch(line.key, { itemId: id, nameAr: item?.nameAr ?? '', unitAr: item?.baseUnit ?? 'قطعة', unitPriceMinor: item?.costMinor ?? 0 })
                    }}>
                      <option value="">اختر الصنف</option>
                      {items.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
                    </QuickSelect>
                  </td>
                  <td className="p-1"><input className={inputCls} inputMode="decimal" value={line.qty} onChange={(event) => patch(line.key, { qty: Number(event.target.value) || 0 })} /></td>
                  <td className="p-1"><input className={inputCls} value={line.unitAr} onChange={(event) => patch(line.key, { unitAr: event.target.value })} /></td>
                  <td className="p-1"><input className={inputCls} inputMode="decimal" value={line.unitPriceMinor / 10 ** cur.decimals} onChange={(event) => patch(line.key, { unitPriceMinor: toMinor(event.target.value || '0', cur.decimals) })} /></td>
                  <td className="p-1"><input className={inputCls} inputMode="decimal" value={line.vatPercent} onChange={(event) => patch(line.key, { vatPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /></td>
                  <td className="p-1 text-center font-mono font-bold">{fmt(Math.round(line.qty * line.unitPriceMinor * (1 + (line.vatPercent || 0) / 100)))}</td>
                  <td className="p-1 text-center"><button type="button" className="doc-row-delete" aria-label="حذف السطر" title="حذف السطر" onClick={() => setLines((current) => (current.length > 1 ? current.filter((row) => row.key !== line.key) : current))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Btn variant="ghost" onClick={() => setLines((current) => [...current, blankLine()])}><span className="flex items-center gap-1.5"><Plus size={14} /> إضافة بند</span></Btn>
            <div className="flex items-center gap-3 text-sm">
              <span>الصافي <b className="font-mono">{fmt(totals.netMinor)}</b></span>
              <span>الضريبة <b className="font-mono">{fmt(totals.taxMinor)}</b></span>
              <span className="text-base font-black">الإجمالي <b className="font-mono text-brand-600">{fmt(totals.totalMinor)} {cur.symbol}</b></span>
            </div>
          </div>

          <Field label="ملاحظات"><input className={inputCls} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="شروط التسليم أو الدفع…" /></Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={submit}>حفظ أمر الشراء</Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
