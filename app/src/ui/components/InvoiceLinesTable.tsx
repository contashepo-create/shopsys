import { useState, type ReactNode, useEffect, useRef } from 'react'
import { Barcode, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import type { InvoiceEditorMode } from '../../core/advancedInvoice.ts'
import { useAppStore } from '../../stores/app.store.ts'
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
  baseUnit?: string
  isService?: boolean
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

/**
 * أعمدة جدول البنود — **مقاس ومحاذاة واحدة للرأس والخلية**.
 * بلاغ المالك: «تقسيم الحقول بجانب بعضها به عدم تناسق». السبب أن كل خلية كانت
 * تكتب عرضها ومحاذاتها يدوياً (th بلا عرض وtd بـ w-[7rem]…)، فتختلف حدود العمود
 * عن حدود رأسه. الآن كل عمود معرَّف مرة واحدة هنا ويُقرأ منه الاثنان.
 */
const COL = {
  index: 'w-9 text-center',
  code: 'w-24 text-center',
  name: 'min-w-[13rem] text-start',
  warehouse: 'w-36 text-center',
  qty: 'w-[5.5rem] text-center',
  price: 'w-[7rem] text-center',
  percent: 'w-[4.75rem] text-center',
  unit: 'w-[4.5rem] text-center',
  tax: 'w-[5.5rem] text-center',
  money: 'w-[7.5rem] text-center',
  total: 'w-[8.5rem] text-center',
  tools: 'w-[4.5rem] text-center',
} as const


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
  /** نسخ السطر المحدد بكل قيمه — زر «تكرار السطر» في شريط أدوات البنود */
  onDuplicate?: (key: string) => void
  /** نسبة ضريبة المستند لعرض رقاقة الضريبة على كل سطر (المرجع: 14% VAT) */
  documentTaxPercent?: number
  onEdit?: (id: number) => void
  onMovement?: (id: number) => void
  onPrices?: (id: number) => void
  amountLabel?: (item: InvoiceLineItem) => string
  placeholder: string
  showPicker?: boolean
  /** مربع البحث/الباركود نفسه — يُعرض **داخل خلية اسم أول سطر فارغ** (لا شريط بحث منفصل) */
  entry?: ReactNode
  /** تصفية التصنيف المصاحبة للبحث — تظهر فوق الجدول بجوار العدادات */
  entryFilter?: ReactNode
}

/** خلايا السطر القابلة للتحرير بالترتيب — تُستعمل في التنقل بالأسهم */
function rowCells(row: HTMLTableRowElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('input:not([type="date"]):not([disabled]), td[tabindex="0"]')]
    .filter((element) => element.dataset.arrowsNative !== 'true')
}
/**
 * التنقل داخل جدول البنود بالأسهم فقط — لا تغيّر الأسهم أي قيمة:
 * ↑/↓ نفس العمود بين السطور · ←/→ بين حقول السطر (وتنتقل للسطر المجاور عند الطرف).
 */
function gridArrowNavigation(event: React.KeyboardEvent<HTMLTableSectionElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
  const target = event.target as HTMLElement
  if (target.dataset.arrowsNative === 'true' || target.tagName === 'SELECT') return
  const row = target.closest('tr')
  const body = target.closest('tbody')
  if (!row || !body) return
  const rows = [...body.querySelectorAll<HTMLTableRowElement>('tr')]
  const rowIndex = rows.indexOf(row as HTMLTableRowElement)
  const cells = rowCells(row as HTMLTableRowElement)
  const cellIndex = cells.indexOf(target)
  if (cellIndex < 0) return
  event.preventDefault()
  const focus = (element?: HTMLElement) => {
    if (!element) return
    element.focus()
    if (element instanceof HTMLInputElement) element.select()
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const nextRow = rows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!nextRow) return
    const nextCells = rowCells(nextRow)
    focus(nextCells[Math.min(cellIndex, nextCells.length - 1)])
    return
  }
  const step = event.key === 'ArrowLeft' ? 1 : -1
  const next = cells[cellIndex + step]
  if (next) { focus(next); return }
  const neighbour = rows[rowIndex + step]
  if (!neighbour) return
  const neighbourCells = rowCells(neighbour)
  focus(step > 0 ? neighbourCells[0] : neighbourCells[neighbourCells.length - 1])
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

/** أقل عدد سطور ظاهرة في جدول البنود — تبقى الشاشة ثابتة ولا «تقفز» مع أول صنف */
const MIN_VISIBLE_ROWS = 5
/** عدد السطور الذي يملأ منطقة البنود في المستند الكامل — كالنموذج المعتمد */
const TARGET_VISIBLE_ROWS = 11

export function InvoiceLinesTable({
  kind, mode, lines, items, warehouses, warehouseId, currencyCode = 'EGP', currencyDecimals, currencySymbol,
  canViewCost = false, taxEnabled = false, warnings, costShares, belowCostKeys, belowCostNotice,
  onPick, onPatch, onRemove, onDuplicate, documentTaxPercent = 0, onEdit, onMovement, onPrices, amountLabel, placeholder, showPicker = true,
  entry, entryFilter,
}: Props) {
  const lineWarehouseMode = warehouseId == null
  /* أعمدة العرض الاختيارية — من زر «تخصيص الحقول»؛ إخفاؤها لا يغيّر أي حساب */
  const columns = useAppStore((state) => state.invoiceColumns)
  const fmt = (minor: number) => formatMinor(minor, { code: currencyCode, symbol: currencySymbol, decimals: currencyDecimals as 0 | 2 | 3, name: '' }, false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /* النموذج المعتمد يُبقي أحد عشر سطراً مرئية لأن مقاساته كلها نسبية بالشاشة.
     هنا نقيس منطقة البنود فعلياً ونرسم عدد السطور الذي يملؤها تماماً: أحد عشر
     على شاشة المرجع، وأكثر على الشاشات الأطول، وأقل على القصيرة — فلا يختفي
     سطر خلف شريط تمرير ولا يبقى فراغ ميت أسفل الجدول. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fitRows, setFitRows] = useState(TARGET_VISIBLE_ROWS)
  useEffect(() => {
    const box = scrollRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
      const sample = box.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0
      if (sample < 8) return
      const fits = Math.floor((box.clientHeight - head) / sample)
      setFitRows(Math.max(MIN_VISIBLE_ROWS, Math.min(24, fits)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  /* سلسلة الإدخال بلا فأرة (طلب المالك): بمجرد اختيار الصنف من خلية الاسم ينتقل
     التركيز تلقائياً إلى **كمية** السطر الجديد، ومنها Enter ⇐ السعر ⇐ السطر التالي.
     قبل ذلك كان التركيز يسقط على body فتضيع الأرقام التي يكتبها البائع. */
  const lineCountRef = useRef(lines.length)
  useEffect(() => {
    const grew = lines.length > lineCountRef.current
    lineCountRef.current = lines.length
    if (!grew) return
    const frame = requestAnimationFrame(() => {
      const rows = scrollRef.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-entry-row]')
      const row = rows?.[rows.length - 1]
      const cell = row?.querySelector<HTMLInputElement>('td.num-cell input:not([readonly])')
      if (!cell) return
      cell.focus()
      cell.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [lines.length])

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
  /* عدد أعمدة الجدول الحقيقي: سطور الفراغ كانت تكتب colSpan=20 فتخلق أعمدة وهمية
     تسحق عمود «الصنف / الوصف» وتترك فراغاً هائلاً — الآن الفراغ بعرض الجدول تماماً. */
  const columnCount = 1
    + (columns.code ? 1 : 0)
    + 1
    + (lineWarehouseMode ? 1 : 0)
    + (kind === 'purchase' && mode !== 'simple' ? 3 : 1)
    + (columns.unit ? 1 : 0)
    + 1
    + (kind === 'sale' ? 1 : 0)
    + (kind === 'purchase' && mode !== 'simple' ? 1 : 0)
    + (kind === 'sale' && mode === 'profit' && canViewCost ? 2 : 0)
    + (kind === 'purchase' && mode === 'profit' && canViewCost ? 1 : 0)
    + (columns.tax ? 1 : 0)
    + 2
  const linesValueMinor = lines.reduce((sum, line) => sum + Math.round(line.qty * line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)), 0)

  return (
    <section className="invoice-lines-panel min-w-0 overflow-visible border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-card-dark">
      <div className="invoice-lines-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-l from-slate-500/10 to-transparent p-3 dark:border-slate-700">
        <div className="invoice-lines-toolbar-title">
          <div className="text-[11px] font-bold text-slate-400">بنود الفاتورة</div>
          <h2 className="text-sm font-black">الأصناف والكميات والأسعار</h2>
          <button type="button" className="invoice-lines-delete" aria-label="مسح باركود" title="امسح الباركود لإضافة الصنف في سطر جديد" onClick={() => window.dispatchEvent(new Event('shopsys:focus-item'))}><Barcode size={14} /> مسح باركود</button>
        </div>
        {entryFilter && <div className="invoice-lines-filter">{entryFilter}</div>}
        <span className="invoice-lines-hint">اكتب داخل خلية الصنف ← يفتح البحث · Enter: صنف ← كمية ← سعر ← السطر التالي · الأسهم للتنقل بين الحقول</span>
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
      <div className="overflow-x-auto" ref={scrollRef}>
        <table className="invoice-lines-table w-full min-w-[58rem] table-fixed text-sm" data-columns={columnCount}>
          <thead className="bg-slate-50 dark:bg-slate-800/60">
            <tr className="text-[11px] font-black text-slate-500 dark:text-slate-300">
              <th className={`p-2 ${COL.index}`} scope="col">م</th>
              {columns.code && <th className={`p-2 ${COL.code}`} scope="col">كود الصنف</th>}
              <th className={`p-2 ${COL.name}`} scope="col">الصنف / الوصف</th>
              {lineWarehouseMode && <th className={`p-2 ${COL.warehouse}`} scope="col">المخزن</th>}
              {kind === 'purchase' && mode !== 'simple'
                ? <><th className={`p-2 ${COL.qty}`} scope="col">المطلوب</th><th className={`p-2 ${COL.qty}`} scope="col">المستلم</th><th className={`p-2 ${COL.qty}`} scope="col">المرفوض</th></>
                : <th className={`p-2 ${COL.qty}`} scope="col">الكمية</th>}
              {columns.unit && <th className={`p-2 ${COL.unit}`} scope="col">الوحدة</th>}
              <th className={`p-2 ${COL.price}`} scope="col">{kind === 'sale' ? 'السعر' : 'سعر الشراء'}</th>
              {kind === 'sale' && <th className={`p-2 ${COL.percent}`} scope="col">خصم %</th>}
              {kind === 'purchase' && mode !== 'simple' && <th className={`p-2 ${COL.percent}`} scope="col">ضريبة %</th>}
              {kind === 'sale' && mode === 'profit' && canViewCost && <><th className={`p-2 ${COL.money}`} scope="col">التكلفة</th><th className={`p-2 ${COL.money}`} scope="col">الهامش</th></>}
              {kind === 'purchase' && mode === 'profit' && canViewCost && <th className={`p-2 ${COL.money}`} scope="col">نصيبه من المصروفات</th>}
              {columns.tax && <th className={`p-2 ${COL.tax}`} scope="col">الضريبة</th>}
              <th className={`p-2 ${COL.total}`} scope="col">الإجمالي</th>
              <th className={`p-2 ${COL.tools}`} scope="col">إجراءات</th>
            </tr>
          </thead>
          <tbody onKeyDown={gridArrowNavigation}>
            {lines.map((line, lineIndex) => {
              const item = items.find((row) => row.id === line.itemId)
              const warning = warnings?.get(line.key)
              const belowCost = belowCostKeys?.has(line.key)
              const actualPrice = line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)
              return (
                <tr key={line.key} data-entry-row aria-selected={selectedKey === line.key} onClick={() => setSelectedKey(line.key)} className={`border-t border-slate-100 dark:border-slate-800 ${selectedKey === line.key ? 'invoice-line-selected' : belowCost ? 'bg-amber-500/10' : warning?.severity === 'error' ? 'bg-rose-500/5' : warning ? 'bg-amber-500/5' : ''}`}>
                  <td className={`p-2 font-mono text-[11px] font-black text-slate-400 ${COL.index}`}>{lineIndex + 1}</td>
                  {columns.code && <td tabIndex={0} className={`p-2 font-mono text-[11px] font-bold text-slate-500 outline-none focus:ring-2 focus:ring-brand-500/40 ${COL.code}`} dir="ltr">{item?.sku || item?.barcodes?.[0] || item?.id}</td>}
                  <td className={`p-2 align-middle break-words ${COL.name}`}>
                    <b>{line.nameAr || item?.nameAr}</b>
                    {columns.details && <div className="invoice-doc-linesub">{item?.isService ? 'خدمة بلا مخزون' : `متاح ${item?.stockQty ?? 0} ${item?.baseUnit ?? ''}`}{item?.sku ? ` · ${item.sku}` : ''}</div>}
                    {warning && <div className={warning.severity === 'error' ? 'text-xs text-rose-600' : 'text-xs text-amber-600'}>{warning.message}</div>}
                    {belowCost && belowCostNotice?.(line)}
                    {kind === 'purchase' && item?.trackExpiry && (
                      <input type="date" className={`${inputCls} mt-1.5`} value={line.expiryDate ?? ''} onChange={(event) => onPatch(line.key, { expiryDate: event.target.value })} />
                    )}
                  </td>
                  {lineWarehouseMode && <td className={`p-1 align-middle ${COL.warehouse}`}><QuickSelect data-arrows-native="true" className={inputCls} value={line.warehouseId ?? ''} onChange={(event) => onPatch(line.key, { warehouseId: Number(event.target.value) || null, warehouseSource: 'manual' })}><option value="">اختر المخزن</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect></td>}
                  {kind === 'purchase' && mode !== 'simple' ? <>
                    <td className={`num-cell p-1 align-middle ${COL.qty}`}><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`ordered:${line.key}`, line.orderedQty ?? line.qty)} onChange={(event) => updateDraft(`ordered:${line.key}`, event.target.value, (value) => patchDecimal(line, 'orderedQty', value))} onBlur={() => clearDraft(`ordered:${line.key}`)} /></td>
                    <td className={`num-cell p-1 align-middle ${COL.qty}`}><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`qty:${line.key}`, line.qty)} onChange={(event) => updateDraft(`qty:${line.key}`, event.target.value, (value) => patchDecimal(line, 'qty', value))} onBlur={() => clearDraft(`qty:${line.key}`)} /></td>
                    <td className={`num-cell p-1 align-middle ${COL.qty}`}><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" value={draftValue(`rejected:${line.key}`, line.rejectedQty ?? 0)} onChange={(event) => updateDraft(`rejected:${line.key}`, event.target.value, (value) => patchDecimal(line, 'rejectedQty', value))} onBlur={() => clearDraft(`rejected:${line.key}`)} /></td>
                  </> : <td className={`num-cell p-1 align-middle ${COL.qty}`}><input className={`${inputCls} !w-auto`} style={numberStyle(line.qty)} inputMode="decimal" type="text" min="0" value={draftValue(`qty:${line.key}`, line.qty || '')} onChange={(event) => updateDraft(`qty:${line.key}`, event.target.value, (value) => patchDecimal(line, 'qty', value))} onBlur={() => clearDraft(`qty:${line.key}`)} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); const priceCell = event.currentTarget.closest('tr')?.querySelector<HTMLInputElement>('.price-cell input'); priceCell?.focus(); priceCell?.select() }} /></td>}
                  {columns.unit && <td className={`unit-cell p-1 align-middle ${COL.unit}`}>{item?.baseUnit || (item?.isService ? 'خدمة' : '—')}</td>}
                  <td className={`num-cell price-cell p-1 align-middle ${COL.price}`}><input className={`${inputCls} !w-auto`} style={numberStyle(line.unitPriceMinor / 10 ** currencyDecimals)} inputMode="decimal" type="text" min="0" value={draftValue(`price:${line.key}`, line.unitPriceMinor ? line.unitPriceMinor / 10 ** currencyDecimals : '')} onChange={(event) => updateDraft(`price:${line.key}`, event.target.value, (value) => patchPrice(line, value))} onBlur={() => clearDraft(`price:${line.key}`)} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); const nextRow = event.currentTarget.closest('tr')?.nextElementSibling as HTMLTableRowElement | null; const nextQty = nextRow?.querySelector<HTMLInputElement>('.num-cell input'); if (nextQty) { nextQty.focus(); nextQty.select(); return } window.dispatchEvent(new Event('shopsys:open-item')) }} /></td>
                  {kind === 'sale' && <td className={`num-cell p-1 align-middle ${COL.percent}`}><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" max="100" value={draftValue(`discount:${line.key}`, line.discountPercent ?? 0)} onChange={(event) => updateDraft(`discount:${line.key}`, event.target.value, (value) => patchPercent(line, 'discountPercent', value))} onBlur={() => clearDraft(`discount:${line.key}`)} /></td>}
                  {kind === 'purchase' && mode !== 'simple' && <td className={`num-cell p-1 align-middle ${COL.percent}`}><input className={`${inputCls} !w-auto`} inputMode="decimal" type="text" min="0" max="100" disabled={!taxEnabled} value={draftValue(`vat:${line.key}`, taxEnabled ? (line.vatPercent ?? 0) : 0)} onChange={(event) => updateDraft(`vat:${line.key}`, event.target.value, (value) => patchPercent(line, 'vatPercent', value))} onBlur={() => clearDraft(`vat:${line.key}`)} /></td>}
                  {kind === 'sale' && mode === 'profit' && canViewCost && <><td className={`money-cell p-2 ${COL.money}`}>{fmt(line.unitCostMinor ?? 0)}</td><td className={`money-cell p-2 ${COL.money}`}>{fmt(Math.round(line.qty * ((line.unitPriceMinor * (1 - (line.discountPercent ?? 0) / 100)) - (line.unitCostMinor ?? 0))))}</td></>}
                  {kind === 'purchase' && mode === 'profit' && canViewCost && <td className={`money-cell p-2 ${COL.money}`}>{fmt(costShares?.get(line.key) ?? 0)}</td>}
                  {columns.tax && <td className={`p-1 text-center ${COL.tax}`}><span className="invoice-doc-taxchip">{(line.vatPercent ?? documentTaxPercent) > 0 ? `${line.vatPercent ?? documentTaxPercent}% ض.ق.م` : 'معفى'}</span></td>}
                  <td className={`p-1 ${COL.total}`}><div className="invoice-table-total">{fmt(Math.round(line.qty * actualPrice) + (kind === 'purchase' ? (costShares?.get(line.key) ?? 0) : 0))}</div></td>
                  <td className={`p-1 ${COL.tools}`}>
                    <div className="invoice-doc-rowtools">
                      <button type="button" title="إضافة صنف في سطر جديد" aria-label="إضافة صنف في سطر جديد" onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new Event('shopsys:open-item')) }}><Plus size={11} /></button>
                      {onEdit && <button type="button" title="بطاقة الصنف" aria-label={`تعديل بطاقة ${line.nameAr || item?.nameAr || ''}`} onClick={(event) => { event.stopPropagation(); onEdit(line.itemId) }}><Pencil size={11} /></button>}
                      {onDuplicate && <button type="button" title="تكرار السطر" aria-label={`تكرار سطر ${line.nameAr || item?.nameAr || ''}`} onClick={(event) => { event.stopPropagation(); onDuplicate(line.key) }}><Copy size={11} /></button>}
                      <button type="button" className="is-danger" title="حذف السطر" aria-label={`حذف سطر ${line.nameAr || item?.nameAr || ''}`} onClick={(event) => { event.stopPropagation(); onRemove(line.key) }}><Trash2 size={11} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {/* السطور الفارغة في النموذج المعتمد ليست فراغاً: لكل سطر نفس خلايا السطر
                الحقيقي بمربعات إدخال مرئية (كمية · سعر · خصم) تماماً كورقة الإكسل،
                والكتابة في أي منها تفتح بحث الصنف لأن الكمية بلا صنف لا معنى لها. */}
            {Array.from({ length: Math.max(MIN_VISIBLE_ROWS, fitRows - lines.length) }, (_, ghostIndex) => {
              const openPicker = () => window.dispatchEvent(new Event('shopsys:open-item'))
              const ghostBox = (label: string) => (
                <input
                  className="invoice-line-ghost-in"
                  type="text"
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  value=""
                  onFocus={openPicker}
                  onMouseDown={(event) => { event.preventDefault(); openPicker() }}
                  data-ghost-field={label}
                />
              )
              return (
              <tr key={`ghost-${ghostIndex}`} className="invoice-line-ghost border-t border-slate-100 dark:border-slate-800">
                <td className={`p-2 font-mono text-[11px] font-black text-slate-300 ${COL.index}`}>{lines.length + ghostIndex + 1}</td>
                {columns.code && <td className={`p-2 ${COL.code}`} />}
                {/* البحث من خلية الاسم نفسها: أول سطر فارغ يحمل مربع البحث/الباركود */}
                <td className={`invoice-line-entry-cell p-1 align-middle ${COL.name}`}>
                  {ghostIndex === 0 && entry
                    ? entry
                    : <button
                        type="button"
                        className="invoice-line-ghost-btn"
                        aria-label="سطر فارغ — اضغط لإضافة صنف"
                        onClick={openPicker}
                      ><span className="sr-only">اكتب اسم الصنف أو امسح الباركود</span></button>}
                </td>
                {lineWarehouseMode && <td className={`p-1 ${COL.warehouse}`} />}
                {kind === 'purchase' && mode !== 'simple'
                  ? <><td className={`num-cell p-1 align-middle ${COL.qty}`}>{ghostBox('ordered')}</td><td className={`num-cell p-1 align-middle ${COL.qty}`}>{ghostBox('qty')}</td><td className={`num-cell p-1 align-middle ${COL.qty}`}>{ghostBox('rejected')}</td></>
                  : <td className={`num-cell p-1 align-middle ${COL.qty}`}>{ghostBox('qty')}</td>}
                {columns.unit && <td className={`unit-cell p-1 ${COL.unit}`} />}
                <td className={`num-cell price-cell p-1 align-middle ${COL.price}`}>{ghostBox('price')}</td>
                {kind === 'sale' && <td className={`num-cell p-1 align-middle ${COL.percent}`}>{ghostBox('discount')}</td>}
                {kind === 'purchase' && mode !== 'simple' && <td className={`num-cell p-1 align-middle ${COL.percent}`}>{ghostBox('vat')}</td>}
                {kind === 'sale' && mode === 'profit' && canViewCost && <><td className={`p-1 ${COL.money}`} /><td className={`p-1 ${COL.money}`} /></>}
                {kind === 'purchase' && mode === 'profit' && canViewCost && <td className={`p-1 ${COL.money}`} />}
                {columns.tax && <td className={`p-1 ${COL.tax}`} />}
                <td className={`p-1 ${COL.total}`} />
                <td className={`p-1 ${COL.tools}`} />
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
</section>
  )
}
