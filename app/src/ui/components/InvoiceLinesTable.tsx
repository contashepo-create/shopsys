import { useState, type ReactNode } from 'react'
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
  showPicker?: boolean
}

const numberStyle = (value: number | string) => ({
  width: `${Math.max(6, String(value ?? '').replace(/[^0-9]/g, '').length + 1)}ch`,
  minWidth: '6ch',
})

function decimalDraft(value: string): string {
  const translated = value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٫,]/g, '.')
    .replace(/[^\d.-]/g, '')
  const sign = translated.startsWith('-') ? '-' : ''
  const unsigned = translated.replace(/-/g, '')
  const dot = unsigned.indexOf('.')
  if (dot < 0) return sign + unsigned
  return sign + unsigned.slice(0, dot + 1) + unsigned.slice(dot + 1).replace(/\./g, '')
}

export function InvoiceLinesTable({
  kind, mode, lines, items, warehouses, warehouseId, currencyCode = 'EGP', currencyDecimals, currencySymbol,
  canViewCost = false, taxEnabled = false, warnings, costShares, belowCostKeys, belowCostNotice,
  onPick, onPatch, onRemove, onEdit, onMovement, onPrices, amountLabel, placeholder, showPicker = true,
}: Props) {
  const lineWarehouseMode = warehouseId == null
  const fmt = (minor: number) => formatMinor(minor, { code: currencyCode, symbol: currencySymbol, decimals: currencyDecimals as 0 | 2 | 3, name: '' }, false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftValue = (key: string, value: string | number) => drafts[key] ?? String(value ?? '')
  const updateDraft = (key: string, raw: string, commit: (value: string) => void) => {
    const value = decimalDraft(raw)
    setDrafts((previous) => ({ ...previous, [key]: value }))
    commit(value)
  }
  const clearDraft = (key: string) => setDrafts((previous) => {
    if (!(key in previous)) return previous
    const next = { ...previous }
    delete next[key]
    return next
  })
  const patchDecimal = (line: InvoiceTableLine, field: 'qty' | 'orderedQty' | 'rejectedQty', value: string) => {
    const next = value === '' || value === '-' || value === '.' || value === '-.' ? 0 : Math.max(0, Number(value) || 0)
    if (field === 'qty') onPatch(line.key, { qty: next, ...(kind === 'purchase' && mode === 'simple' ? { orderedQty: next, rejectedQty: 0 } : {}) })
    else onPatch(line.key, { [field]: next })
  }
  const patchPrice = (line: InvoiceTableLine, value: string) => {
    const next = value === '' || value === '-' || value === '.' || value === '-.' ? 0 : Math.max(0, toMinor(value, currencyDecimals))
    onPatch(line.key, { unitPriceMinor: next })
  }
  const patchPercent = (line: InvoiceTableLine, field: 'discountPercent' | 'vatPercent', value: string) => {
    const next = value === '' || value === '-' || value === '.' || value === '-.' ? 0 : Math.min(100, Math.max(0, Number(value) || 0))
    onPatch(line.key, { [field]: next })
  }
  const linesValueMinor = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)), 0)

  return (
    <section className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
      <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-slate-500/10 to-transparent p-3 dark:border-slate-700">
        <div className="invoice-lines-toolbar-title">
          <div className="text-[11px] font-bold text-slate-400">بنود الفاتورة</div>
          <h2 className="text-sm font-black">الأصناف والكميات والأسعار</h2>
        </div>
        <div className="invoice-lines-kpis">
          <span className="invoice-lines-count">{lines.length} بند</span>
          <span className="invoice-lines-value" dir="ltr">{fmt(linesValueMinor)} {currencySymbol}</span>
          <span className="invoice-lines-value-label">قيمة البنود الحالية</span>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {showPicker && <span className="invoice-lines-search-label">إضافة صنف</span>}
          {showPicker && <div className="min-w-0 flex-1 sm:w-80 sm:flex-none">
            <ItemQuickPicker
              items={items.filter((item) => kind === 'purchase' || item.isActive !== false)}
              onPick={onPick}
              onEdit={onEdit}
              onMovement={onMovement}
              onPrices={onPrices}
              amountLabel={amountLabel}
              placeholder={placeholder}
            />
          </div>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="invoice-lines-table w-full min-w-[900px] table-auto text-sm">
          <thead className="bg-slate-500/10">
            <tr className="text-right text-[11px] font-black text-slate-500 dark:text-slate-300">
              <th className="w-10 p-3 text-center">م</th>
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
              <th className="w-16 p-3 text-center">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, lineIndex) => {
              const item = items.find((row) => row.id === line.itemId)
              const warning = warnings?.get(line.key)
              const belowCost = belowCostKeys?.has(line.key)
              const actualPrice = line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)
              return (
                <tr key={line.key} data-entry-row className={`border-t border-slate-100 dark:border-slate-800 ${belowCost ? 'bg-amber-500/10' : warning?.severity === 'error' ? 'bg-rose-500/5' : warning ? 'bg-amber-500/5' : ''}`}>
                  <td className="w-10 p-3 text-center font-mono text-xs font-black text-slate-400">{lineIndex + 1}</td>
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
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`ordered:${line.key}`, line.orderedQty ?? line.qty)} onChange={(event) => updateDraft(`ordered:${line.key}`, event.target.value, (value) => patchDecimal(line, 'orderedQty', value))} onBlur={() => clearDraft(`ordered:${line.key}`)} /></td>
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`qty:${line.key}`, line.qty)} onChange={(event) => updateDraft(`qty:${line.key}`, event.target.value, (value) => patchDecimal(line, 'qty', value))} onBlur={() => clearDraft(`qty:${line.key}`)} /></td>
                    <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`rejected:${line.key}`, line.rejectedQty ?? 0)} onChange={(event) => updateDraft(`rejected:${line.key}`, event.target.value, (value) => patchDecimal(line, 'rejectedQty', value))} onBlur={() => clearDraft(`rejected:${line.key}`)} /></td>
                  </> : <td className="w-[7rem] p-1 align-top"><input className={`${inputCls} !w-auto`} style={numberStyle(line.qty)} inputMode="decimal" type="text" min="0" value={draftValue(`qty:${line.key}`, line.qty || '')} onChange={(event) => updateDraft(`qty:${line.key}`, event.target.value, (value) => patchDecimal(line, 'qty', value))} onBlur={() => clearDraft(`qty:${line.key}`)} /></td>}
                  <td className="w-[8rem] p-1 align-top"><input className={`${inputCls} !w-auto`} style={numberStyle(line.unitPriceMinor / 10 ** currencyDecimals)} inputMode="decimal" type="text" min="0" value={draftValue(`price:${line.key}`, line.unitPriceMinor ? line.unitPriceMinor / 10 ** currencyDecimals : '')} onChange={(event) => updateDraft(`price:${line.key}`, event.target.value, (value) => patchPrice(line, value))} onBlur={() => clearDraft(`price:${line.key}`)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:focus-item')) } }} /></td>
                  {kind === 'sale' && <td className="w-[6rem] p-1 align-top"><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" max="100" value={draftValue(`discount:${line.key}`, line.discountPercent ?? 0)} onChange={(event) => updateDraft(`discount:${line.key}`, event.target.value, (value) => patchPercent(line, 'discountPercent', value))} onBlur={() => clearDraft(`discount:${line.key}`)} /></td>}
                  {kind === 'purchase' && mode !== 'simple' && <td className="w-[6rem] p-1 align-top"><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" max="100" disabled={!taxEnabled} value={draftValue(`vat:${line.key}`, taxEnabled ? (line.vatPercent ?? 0) : 0)} onChange={(event) => updateDraft(`vat:${line.key}`, event.target.value, (value) => patchPercent(line, 'vatPercent', value))} onBlur={() => clearDraft(`vat:${line.key}`)} /></td>}
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
