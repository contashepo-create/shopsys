import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { InvoiceEditorMode } from '../../core/advancedInvoice.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { inputCls } from './ui.tsx'
import { ItemQuickPicker, QuickSelect } from './KeyboardPickers.tsx'

type InvoiceLineItem = {
  id: number
  nameAr: string
  sku?: string
  barcodes?: string[]
  stockQty?: number
  priceMinor?: number
  costMinor?: number
  soldByWeight?: boolean
  trackExpiry?: boolean
  isActive?: boolean
}

export type InvoiceTableLine = {
  key: string
  itemId: number
  nameAr?: string
  qty: number
  unitPriceMinor: number
  unitCostMinor?: number
  discountPercent?: number
  vatPercent?: number
  warehouseId: number | null
  warehouseSource?: 'default' | 'manual'
  orderedQty?: number
  rejectedQty?: number
  expiryDate?: string
}

type Warehouse = { id: number; nameAr: string }

type Props = {
  kind: 'sale' | 'purchase'
  mode: InvoiceEditorMode
  lines: InvoiceTableLine[]
  items: InvoiceLineItem[]
  warehouses: Warehouse[]
  warehouseId: number | null
  currencyCode?: string
  currencyDecimals: number
  currencySymbol: string
  canViewCost?: boolean
  taxEnabled?: boolean
  warnings?: Map<string, { message: string; severity: 'warning' | 'error' }>
  costShares?: Map<string, number>
  belowCostKeys?: Set<string>
  belowCostNotice?: (line: InvoiceTableLine) => ReactNode
  onPick: (id: number) => void
  onPatch: (key: string, patch: Partial<InvoiceTableLine>) => void
  onRemove: (key: string) => void
  onEdit?: (id: number) => void
  onMovement?: (id: number) => void
  onPrices?: (id: number) => void
  amountLabel?: (item: InvoiceLineItem) => string
  placeholder: string
}

const numberStyle = (value: number | string) => ({
  width: `${Math.max(6, String(value ?? '').replace(/[^0-9]/g, '').length + 1)}ch`,
  minWidth: '6ch',
})

export function InvoiceLinesTable({
  kind, mode, lines, items, warehouses, warehouseId, currencyCode = 'EGP', currencyDecimals, currencySymbol,
  canViewCost = false, taxEnabled = false, warnings, costShares, belowCostKeys, belowCostNotice,
  onPick, onPatch, onRemove, onEdit, onMovement, onPrices, amountLabel, placeholder,
}: Props) {
  const lineWarehouseMode = warehouseId == null
  const fmt = (minor: number) => formatMinor(minor, { code: currencyCode, symbol: currencySymbol, decimals: currencyDecimals as 0 | 2 | 3, name: '' }, false)
  const patchQty = (line: InvoiceTableLine, value: string, field: 'qty' | 'orderedQty' | 'rejectedQty') => {
    const next = Math.max(0, Number(value.replace(/[^0-9.]/g, '')) || 0)
    if (field === 'qty') onPatch(line.key, { qty: next, ...(kind === 'purchase' && mode === 'simple' ? { orderedQty: next, rejectedQty: 0 } : {}) })
    else onPatch(line.key, { [field]: next })
  }

  return (
    <section className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-slate-500/10 to-transparent p-3 dark:border-slate-700">
        <div>
          <div className="text-[11px] font-bold text-slate-400">بنود الفاتورة</div>
          <h2 className="text-sm font-black">الأصناف والكميات والأسعار</h2>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <span className="shrink-0 rounded-full bg-brand-500/10 px-2.5 py-1 text-[10px] font-black text-brand-700 dark:text-brand-300">{lines.length} بند</span>
          <div className="min-w-0 flex-1 sm:w-80 sm:flex-none">
            <ItemQuickPicker
              items={items.filter((item) => kind === 'purchase' || item.isActive !== false)}
              onPick={onPick}
              onEdit={onEdit}
              onMovement={onMovement}
              onPrices={onPrices}
              amountLabel={amountLabel}
              placeholder={placeholder}
            />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="invoice-lines-table w-full min-w-[900px] table-auto text-sm">
          <thead className="bg-slate-500/10">
            <tr className="text-right text-[11px] font-black text-slate-500 dark:text-slate-300">
              <th className="p-3">كود الصنف</th>
              <th className="p-3">الصنف</th>
              {lineWarehouseMode && <th className="p-3">المخزن</th>}
              {kind === 'purchase' && mode !== 'simple' ? <><th className="p-3">المطلوب</th><th className="p-3">المستلم</th><th className="p-3">المرفوض</th></> : <th className="p-3">الكمية</th>}
              <th className="p-3">{kind === 'sale' ? 'السعر' : 'سعر الشراء'}</th>
              {kind === 'sale' && <th className="p-3">خصم %</th>}
              {kind === 'purchase' && mode !== 'simple' && <th className="p-3">ضريبة مدخلات %</th>}
              {kind === 'sale' && mode === 'profit' && canViewCost && <><th className="p-3">التكلفة</th><th className="p-3">الهامش</th></>}
              {kind === 'purchase' && mode === 'profit' && canViewCost && <th className="p-3">نصيبه من المصروفات</th>}
              <th className="p-3">الإجمالي</th>
              <th className="w-10 p-3" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const item = items.find((row) => row.id === line.itemId)
              const warning = warnings?.get(line.key)
              const belowCost = belowCostKeys?.has(line.key)
              const actualPrice = line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)
              return (
                <tr key={line.key} data-entry-row className={`border-t border-slate-100 dark:border-slate-800 ${belowCost ? 'bg-amber-500/10' : warning?.severity === 'error' ? 'bg-rose-500/5' : warning ? 'bg-amber-500/5' : ''}`}>
                  <td tabIndex={0} className="min-w-[100px] p-3 font-mono text-xs font-bold text-slate-500 outline-none focus:ring-2 focus:ring-brand-500/40" dir="ltr">{item?.sku || item?.barcodes?.[0] || item?.id}</td>
                  <td className="min-w-[180px] p-3 align-top break-words">
                    <b>{line.nameAr || item?.nameAr}</b>
                    {warning && <div className={warning.severity === 'error' ? 'text-xs text-rose-600' : 'text-xs text-amber-600'}>{warning.message}</div>}
                    {belowCost && belowCostNotice?.(line)}
                    {kind === 'purchase' && item?.trackExpiry && (
                      <input type="date" className={`${inputCls} mt-1.5`} value={line.expiryDate ?? ''} onChange={(event) => onPatch(line.key, { expiryDate: event.target.value })} />
                    )}
                  </td>
                  {lineWarehouseMode && <td className="min-w-[150px] p-1 align-top"><QuickSelect data-arrows-native="true" className={inputCls} value={line.warehouseId ?? ''} onChange={(event) => onPatch(line.key, { warehouseId: Number(event.target.value) || null, warehouseSource: 'manual' })}><option value="">اختر المخزن</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect></td>}
                  {kind === 'purchase' && mode !== 'simple' ? <>
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} type="number" min="0" value={line.orderedQty ?? line.qty} onChange={(event) => patchQty(line, event.target.value, 'orderedQty')} /></td>
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} type="number" min="0" value={line.qty} onChange={(event) => patchQty(line, event.target.value, 'qty')} /></td>
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} type="number" min="0" value={line.rejectedQty ?? 0} onChange={(event) => patchQty(line, event.target.value, 'rejectedQty')} /></td>
                  </> : <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} style={numberStyle(line.qty)} inputMode="decimal" type="number" min="0" value={line.qty || ''} onChange={(event) => patchQty(line, event.target.value, 'qty')} /></td>}
                  <td className="w-[8rem] p-1 align-top"><input className={`${inputCls} !w-auto`} style={numberStyle(line.unitPriceMinor / 10 ** currencyDecimals)} inputMode="decimal" type="number" min="0" value={line.unitPriceMinor ? line.unitPriceMinor / 10 ** currencyDecimals : ''} onChange={(event) => onPatch(line.key, { unitPriceMinor: Math.max(0, toMinor(event.target.value.replace(/[^0-9.]/g, '') || '0', currencyDecimals)) })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:focus-item')) } }} /></td>
                  {kind === 'sale' && <td className="w-[6rem] p-1 align-top"><input className={`${inputCls} !w-auto`} type="number" min="0" max="100" value={line.discountPercent ?? 0} onChange={(event) => onPatch(line.key, { discountPercent: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /></td>}
                  {kind === 'purchase' && mode !== 'simple' && <td className="w-[6rem] p-1 align-top"><input className={`${inputCls} !w-auto`} type="number" min="0" max="100" value={taxEnabled ? (line.vatPercent ?? 0) : 0} disabled={!taxEnabled} onChange={(event) => onPatch(line.key, { vatPercent: taxEnabled ? Math.min(100, Math.max(0, Number(event.target.value) || 0)) : 0 })} /></td>}
                  {kind === 'sale' && mode === 'profit' && canViewCost && <><td className="p-3">{fmt(line.unitCostMinor ?? 0)}</td><td className="p-3">{fmt(Math.round(line.qty * ((line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)) - (line.unitCostMinor ?? 0))))}</td></>}
                  {kind === 'purchase' && mode === 'profit' && canViewCost && <td className="p-3">{fmt(costShares?.get(line.key) ?? 0)}</td>}
                  <td className="w-[9rem] p-1"><div className={`${inputCls} bg-slate-50/50 font-bold dark:bg-slate-900/30`}>{fmt(Math.round(line.qty * actualPrice) + (kind === 'purchase' ? (costShares?.get(line.key) ?? 0) : 0))}</div></td>
                  <td className="p-3 text-center"><button type="button" tabIndex={-1} aria-label="حذف السطر" onClick={() => onRemove(line.key)} className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-rose-500/10 hover:text-rose-500"><Trash2 size={16} /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!lines.length && <div className="m-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-900/30"><div className="mb-2 text-3xl">🧾</div><div className="font-black">لم تتم إضافة أصناف بعد</div><div className="mt-1 text-xs text-slate-500">استخدم مربع البحث بالأعلى أو اضغط F5 للبدء وإضافة أول صنف إلى الفاتورة.</div></div>}
    </section>
  )
}
