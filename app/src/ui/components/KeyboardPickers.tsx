import { type CSSProperties, Children, isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { inputCls, OverlayPortal } from './ui.tsx'
import { useAnchoredMenu } from './anchoredMenu.ts'
import { matchesSearch } from '../../core/search.ts'
import { useWindowHost } from '../windows/windowHostContext.ts'
import { openItemPickerWindow } from '../windows/windowStore.ts'

type QuickChoice = { value: string; content: ReactNode; label: string; searchText: string }

type QuickSelectProps = {
  value?: string | number | null
  onChange?: (event: { target: { value: string } }) => void
  children?: ReactNode
  className?: string
  disabled?: boolean
  title?: string
  'aria-label'?: string
  [attribute: string]: unknown
}

function flattenChoices(children: ReactNode): QuickChoice[] {
  const choices: QuickChoice[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'option') {
      const props = child.props as { value?: string | number; children?: ReactNode }
      const content = props.children ?? ''
      const label = String(content).replace(/<[^>]+>/g, '')
      choices.push({ value: String(props.value ?? ''), content, label, searchText: `${label} ${String(props.value ?? '')}`.toLowerCase() })
      return
    }
    choices.push(...flattenChoices((child.props as { children?: ReactNode }).children))
  })
  return choices
}

/**
 * قائمة البحث **ملتصقة بالحقل** لا نافذة تعتّم الشاشة (قاعدة المالك: لا منبثقة
 * تُعتّم الخلفية أو تعزلها). تُحسب تحت الحقل وتنقلب فوقه إن ضاق ما تحته.
 */
function anchoredPanelStyle(anchor: HTMLElement | null, preferredWidth = 520): CSSProperties {
  if (!anchor || typeof window === 'undefined') return { position: 'fixed', insetInlineStart: '50%', top: '10vh' }
  const rect = anchor.getBoundingClientRect()
  const viewportWidth = window.innerWidth || 1024
  const viewportHeight = window.innerHeight || 768
  const width = Math.min(Math.max(rect.width, preferredWidth), viewportWidth - 16)
  const below = viewportHeight - rect.bottom - 10
  const above = rect.top - 10
  const openUp = below < 220 && above > below
  const maxHeight = Math.max(180, Math.min(openUp ? above : below, Math.round(viewportHeight * 0.66)))
  const right = Math.min(Math.max(8, viewportWidth - rect.right), Math.max(8, viewportWidth - width - 8))
  return openUp
    ? { position: 'fixed', bottom: viewportHeight - rect.top + 4, right, width, maxHeight }
    : { position: 'fixed', top: rect.bottom + 4, right, width, maxHeight }
}

/** بديل موحد للقائمة الأصلية: حقل كتابة وبحث واختيار Enter بلا قائمة HTML أصلية. */
export function QuickSelect({ value, onChange, children, className, disabled = false, title, 'aria-label': ariaLabel }: QuickSelectProps) {
  const choices = useMemo(() => flattenChoices(children), [children])
  const selectedValue = String(value ?? '')
  const selected = choices.find((choice) => choice.value === selectedValue) ?? choices[0]
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const normalized = query.trim()
    return normalized ? choices.filter((choice) => matchesSearch([choice.searchText, choice.value], normalized)) : choices
  }, [choices, query])
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const choose = (choice: QuickChoice | undefined) => {
    if (!choice) return
    onChange?.({ target: { value: choice.value } })
    setQuery('')
    setOpen(false)
    setIndex(0)
  }
  const fieldRef = useRef<HTMLDivElement>(null)
  const menuStyle = useAnchoredMenu(fieldRef, open)
  /* القائمة المنسدلة تبقى منسدلة: النقر يعرض كل الخيارات والمحدد مظلَّل،
     ولا يُجبَر المستخدم على الكتابة من جديد بعد أن اختار (قرار المالك). */
  const openList = () => {
    setQuery('')
    const at = choices.findIndex((choice) => choice.value === selectedValue)
    setIndex(at >= 0 ? at : 0)
    setOpen(true)
  }
  return <div ref={rootRef} className="relative" title={title} data-quick-select="true">
    <div className="relative" ref={fieldRef}>
      <input ref={inputRef} disabled={disabled} aria-label={ariaLabel} role="combobox" aria-expanded={open} aria-autocomplete="list" className={`${className ?? inputCls} pl-8`}
        value={open ? query : (selected?.label ?? '')}
        placeholder={open ? (selected?.label ?? 'اختر من القائمة') : 'اختر من القائمة'}
        onFocus={openList} onMouseDown={() => { if (!open) openList() }}
        onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) }
        else if (event.key === 'Enter') {
          if (open) { event.preventDefault(); choose(matches[index] ?? matches[0]) }
          // بعد اعتماد الاختيار، اترك Enter العام ينقل التركيز للحقل التالي.
        }
        else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
      <ChevronDown size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
    {open && <div style={menuStyle} className="layer-picker overflow-auto rounded-xl border border-brand-300/50 bg-white dark:border-brand-700/50 dark:bg-card-dark shadow-2xl p-1">{matches.length ? matches.map((choice, row) => <button type="button" key={`${choice.value}:${row}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)} className={`w-full p-2 text-right rounded-lg ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`} data-quick-option="true" data-value={choice.value}>{choice.content}</button>) : <div className="p-3 text-center text-xs text-slate-400">لا توجد خيارات مطابقة</div>}</div>}
  </div>
}

export type QuickItem = { id: number; nameAr: string; sku?: string; barcodes?: string[]; stockQty?: number; priceMinor?: number; costMinor?: number; baseUnit?: string; categoryId?: number | null; isService?: boolean }
/** بطاقة الصنف الغنية داخل نافذة الاختيار (دفعة المالك ⑩ي البند ⑦) */
export type QuickItemMeta = { stock?: string; price?: string; cost?: string; unit?: string; category?: string; low?: boolean }

type PickerProps = {
  items: QuickItem[]
  onPick: (id: number) => void
  placeholder?: string
  amountLabel?: (item: QuickItem) => string
  inputElementRef?: RefObject<HTMLInputElement | null>
  listenForShortcut?: boolean
  onEdit?: (id: number) => void
  onMovement?: (id: number) => void
  onPrices?: (id: number) => void
  /** بيانات العرض الغنية لكل صنف (الرصيد/السعر/التكلفة/الوحدة/الفئة) */
  itemMeta?: (item: QuickItem) => QuickItemMeta
  /** فئات الأصناف لفلترة النافذة */
  categories?: { id: number; nameAr: string }[]
  /** إنشاء صنف جديد من داخل نافذة الاختيار */
  onCreate?: (name: string) => void
}

/** منتقي صنف موحد: يفتح نافذة البحث عند أول حرف، ثم ينقل الكتابة إلى حقل النافذة. */
/**
 * لوحة اختيار الصنف الغنية — تُستعمل في موضعين بنفس الشكل والسلوك:
 * ① داخل نافذة مستقلة (`item-picker`) حين تُفتح من فاتورة تعيش في نافذة،
 *    فتبقى مفتوحة خلف نوافذ «تعديل الصنف»/«حركة الصنف»/«أسعار الصنف»
 *    وتعود للواجهة عند إغلاقها (بلاغ المالك: إغلاق الابنة كان يغلق المنتقي).
 * ② كقائمة مرساة فوق الحقل في الشاشات التي لا تعيش داخل نافذة (الكاشير مثلاً).
 */
export function ItemSearchPanel({
  items, onPick, onEdit, onMovement, onPrices, itemMeta, categories, onCreate, amountLabel,
  initialQuery = '', onEscape, autoFocus = true,
}: {
  items: QuickItem[]
  onPick: (id: number) => void
  onEdit?: (id: number) => void
  onMovement?: (id: number) => void
  onPrices?: (id: number) => void
  itemMeta?: (item: QuickItem) => QuickItemMeta
  categories?: { id: number; nameAr: string }[]
  onCreate?: (name: string) => void
  amountLabel?: (item: QuickItem) => string
  initialQuery?: string
  onEscape?: () => void
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const [catFilter, setCatFilter] = useState(0)
  const [availableOnly, setAvailableOnly] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => {
    const q = query.trim()
    let list = items
    if (catFilter) list = list.filter((item) => (item.categoryId ?? 0) === catFilter)
    if (availableOnly) list = list.filter((item) => item.isService || (item.stockQty ?? 0) > 0)
    if (!q) return list
    return list.filter((item) => matchesSearch([item.nameAr, item.sku, ...(item.barcodes ?? []), item.id], q))
  }, [items, query, catFilter, availableOnly])
  useEffect(() => {
    if (!autoFocus) return
    const input = searchInputRef.current
    if (!input) return
    input.focus()
    const position = input.value.length
    input.setSelectionRange(position, position)
  }, [autoFocus])
  const current = matches[index] ?? matches[0]
  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((v) => Math.min(Math.max(0, matches.length - 1), v + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((v) => Math.max(0, v - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); if (current) onPick(current.id) }
    else if (event.key === 'Escape') { event.preventDefault(); onEscape?.() }
  }
  return <div className="flex min-h-0 flex-1 flex-col" data-item-picker-panel>
    <div className="invoice-search-inputbar border-b border-slate-200 p-2 dark:border-slate-700"><div className="relative">
      <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input ref={searchInputRef} className={`${inputCls} pr-9`} value={query} aria-label="بحث الصنف" title="بحث عن صنف بالاسم أو الكود أو الباركود"
        role="combobox" aria-expanded="true" aria-controls="invoice-item-results" aria-autocomplete="list"
        aria-activedescendant={matches[index] ? `invoice-item-option-${matches[index].id}` : undefined}
        placeholder="ابحث بالاسم أو الكود أو الباركود" onChange={(event) => { setQuery(event.target.value); setIndex(0) }} onKeyDown={keys} />
    </div></div>
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-2 py-1.5 text-[11px] dark:border-slate-700" data-item-picker-filters>
      {!!categories?.length && <select className={`${inputCls} h-7 w-40 py-0 text-[11px]`} value={catFilter} onChange={(event) => { setCatFilter(Number(event.target.value)); setIndex(0) }} aria-label="تصفية بالفئة" data-item-picker-category>
        <option value={0}>كل الفئات</option>
        {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.nameAr}</option>)}
      </select>}
      <label className="flex cursor-pointer items-center gap-1 text-slate-600 dark:text-slate-300"><input type="checkbox" checked={availableOnly} onChange={(event) => { setAvailableOnly(event.target.checked); setIndex(0) }} data-item-picker-available /> المتاح فقط</label>
      <span className="ms-auto text-slate-400">{matches.length} صنف</span>
      {onCreate && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onCreate(query.trim())} className="rounded-lg border border-emerald-300 px-2 py-0.5 font-bold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300" data-item-picker-create>+ صنف جديد</button>}
    </div>
    {current && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-brand-500/5 px-3 py-2 dark:border-slate-700">
      <div className="min-w-0">
        <span className="ml-2 font-mono text-[10px] text-slate-500" dir="ltr">{current.sku || current.barcodes?.[0] || current.id}</span>
        <b className="block truncate">{current.nameAr}</b>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onEdit?.(current.id)} disabled={!onEdit} data-item-picker-edit className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-sky-700 enabled:hover:bg-sky-50 disabled:opacity-35 dark:border-slate-700 dark:text-sky-300">✎ تعديل الصنف</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onMovement?.(current.id)} disabled={!onMovement} data-item-picker-movement className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-violet-700 enabled:hover:bg-violet-50 disabled:opacity-35 dark:border-slate-700 dark:text-violet-300">↗ حركة الصنف</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onPrices?.(current.id)} disabled={!onPrices} data-item-picker-prices className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-emerald-700 enabled:hover:bg-emerald-50 disabled:opacity-35 dark:border-slate-700 dark:text-emerald-300">٪ أسعار الصنف</button>
      </div>
    </div>}
    <div className="grid grid-cols-[92px_1fr_88px_64px_72px_86px_86px] gap-2 border-b border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800/50" data-item-picker-head>
      <span>الكود</span><span>اسم الصنف</span><span>الفئة</span><span>الوحدة</span><span className="text-center">المتاح</span><span className="text-center">سعر البيع</span><span className="text-center">التكلفة</span>
    </div>
    <div id="invoice-item-results" role="listbox" aria-label="نتائج بحث الأصناف" className="invoice-search-results min-h-0 flex-1 overflow-auto p-1">{matches.length ? matches.map((item, row) => {
      const meta = itemMeta?.(item) ?? {}
      return <button type="button" key={item.id} id={`invoice-item-option-${item.id}`} role="option" aria-selected={row === index} data-quick-option
        onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(row)} onDoubleClick={() => onPick(item.id)}
        className={`grid w-full grid-cols-[92px_1fr_88px_64px_72px_86px_86px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-right ${row === index ? 'bg-brand-500/15' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
        <span className="truncate font-mono text-[11px] text-slate-500" dir="ltr">{item.sku || item.barcodes?.[0] || item.id}</span>
        <b className="truncate">{item.nameAr}</b>
        <span className="truncate text-[10px] text-slate-500">{meta.category ?? ''}</span>
        <span className="truncate text-[10px] text-slate-500">{meta.unit ?? ''}</span>
        <span className={`text-center text-[11px] font-bold ${meta.low ? 'text-rose-600' : 'text-emerald-600'}`}>{meta.stock ?? ''}</span>
        <span className="text-center text-[11px] font-bold">{meta.price ?? amountLabel?.(item) ?? ''}</span>
        <span className="text-center text-[11px] text-slate-500">{meta.cost ?? ''}</span>
      </button>
    }) : <div className="p-4 text-center text-sm text-slate-400">لا توجد أصناف مطابقة</div>}</div>
    <div className="invoice-search-footer border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800">اختر بالسهم ثم Enter، أو اضغط مرتين على الصنف · نوافذ التعديل والحركة والأسعار تفتح فوق هذه النافذة ولا تغلقها</div>
  </div>
}

export function ItemQuickPicker({ items, onPick, placeholder = 'اكتب كود أو اسم الصنف ثم Enter', amountLabel, inputElementRef, listenForShortcut = true, onEdit, onMovement, onPrices, itemMeta, categories, onCreate }: PickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const panelWidth = 720
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const host = useWindowHost()
  const setExternalRef = (node: HTMLInputElement | null) => {
    if (inputElementRef) inputElementRef.current = node ?? inputRef.current
  }
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!pickerRef.current?.contains(target) && !target.closest('.invoice-search-overlay')) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const pick = (id: number) => { onPick(id); setQuery(''); setOpen(false) }
  /**
   * داخل نافذة ⇒ المنتقي نفسه نافذة مستقلة تُكدَّس فوق الفاتورة (قرار المالك)،
   * فتبقى حية خلف نوافذ التعديل/الحركة/الأسعار ولا تختفي بإغلاقها.
   */
  const openSearch = (initialQuery = '') => {
    if (host) {
      setQuery('')
      openItemPickerWindow({
        parentId: host.windowId,
        initialQuery,
        items,
        itemMeta,
        categories,
        amountLabel,
        onCreate,
        onPick: (id) => { onPick(id); requestAnimationFrame(() => inputRef.current?.focus()) },
      })
      return
    }
    setQuery(initialQuery)
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const place = () => setPanelStyle(anchoredPanelStyle(inputRef.current, panelWidth))
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, panelWidth])
  useEffect(() => {
    if (!listenForShortcut) return
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select() }
    const openFromShortcut = () => openSearch()
    window.addEventListener('shopsys:focus-item', focus)
    window.addEventListener('shopsys:open-item', openFromShortcut)
    return () => { window.removeEventListener('shopsys:focus-item', focus); window.removeEventListener('shopsys:open-item', openFromShortcut) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenForShortcut, host, items])
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    /* الأسهم للتنقل بين خلايا الجدول فقط (قرار المالك) — لا تفتح قائمة الأصناف.
       القائمة تُفتح بالكتابة أو Enter أو النقر المزدوج. */
    if (event.key === 'Enter') { event.preventDefault(); openSearch(query.trim()) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
  }
  return <div ref={pickerRef} className="relative invoice-picker-root" data-enter-native="true">
    <input ref={(node) => { inputRef.current = node; setExternalRef(node) }} className={`${inputCls} invoice-line-entry-input`} value={open ? '' : query} placeholder="" aria-label="اسم الصنف — اكتب أو اضغط مرتين للبحث"
      title={placeholder}
      onDoubleClick={() => openSearch(query.trim())}
      onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim()) openSearch(value) }}
      onKeyDown={handleKeyDown} />
    {open && <OverlayPortal><div className="layer-picker fixed inset-0 invoice-search-overlay invoice-item-overlay" dir="rtl" onMouseDown={(event) => event.stopPropagation()}>
      <div role="dialog" aria-label="نتائج بحث الأصناف" style={panelStyle} className="invoice-search-dialog flex flex-col overflow-hidden rounded-2xl border border-brand-300/50 bg-white dark:border-brand-700/50 dark:bg-card-dark">
        <ItemSearchPanel items={items} onPick={pick} onEdit={onEdit} onMovement={onMovement} onPrices={onPrices}
          itemMeta={itemMeta} categories={categories} onCreate={onCreate} amountLabel={amountLabel}
          initialQuery={query} onEscape={() => { setOpen(false); inputRef.current?.focus() }} />
      </div>
    </div></OverlayPortal>}
  </div>
}

type Party = { id: number; nameAr: string; phone?: string; active?: boolean }
export type PartyPickerInfo = { code?: string; balance?: string }
export function PartyQuickPicker({ parties, value, onChange, cashLabel, label, onConfirm, autoFocus = false, cashValue, showCash = true, partyInfo }: { parties: Party[]; value: number; onChange: (id: number) => void; cashLabel: string; label: string; onConfirm?: () => void; autoFocus?: boolean; cashValue?: number; showCash?: boolean; partyInfo?: (party: Party) => PartyPickerInfo }) {
  const emptyValue = cashValue ?? (value === -1 ? -1 : 0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})
  const panelWidth = 520
  const inputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (!pickerRef.current?.contains(target) && !target.closest('.invoice-search-overlay')) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const selected = parties.find((party) => party.id === value)
  const matches = useMemo(() => {
    const q = query.trim()
    return parties.filter((party) => {
      const info = partyInfo?.(party)
      return matchesSearch([party.nameAr, party.phone, info?.code], q)
    })
  }, [parties, query, partyInfo])
  const focusSearch = (initialQuery: string) => {
    requestAnimationFrame(() => {
      const input = searchInputRef.current
      if (!input) return
      input.focus()
      const position = initialQuery.length
      input.setSelectionRange(position, position)
    })
  }
  const openSearch = (initialQuery = '') => {
    setQuery(initialQuery)
    setIndex(0)
    setOpen(true)
    focusSearch(initialQuery)
  }
  useEffect(() => {
    if (!open) return
    const input = searchInputRef.current
    if (input) {
      input.focus()
      const position = input.value.length
      input.setSelectionRange(position, position)
    }
    const place = () => setPanelStyle(anchoredPanelStyle(inputRef.current, panelWidth))
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, panelWidth])
  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); setQuery('') }
    const openFromShortcut = () => {
      const current = pickerRef.current
      if (!current) return
      const activePicker = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-party-picker]')
      if (activePicker && activePicker !== current) return
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((dialog) => {
        const style = window.getComputedStyle(dialog)
        return style.display !== 'none' && style.visibility !== 'hidden' && dialog.getAttribute('aria-hidden') !== 'true'
      })
      const topDialog = dialogs.at(-1)
      if (topDialog) {
        const dialogPicker = topDialog.querySelector<HTMLElement>('[data-party-picker]')
        if (!dialogPicker || dialogPicker !== current) return
      } else {
        const firstPicker = document.querySelector<HTMLElement>('[data-party-picker]')
        if (firstPicker && firstPicker !== current) return
      }
      openSearch()
    }
    window.addEventListener('shopsys:focus-party', focus)
    window.addEventListener('shopsys:open-party', openFromShortcut)
    if (autoFocus) requestAnimationFrame(focus)
    return () => { window.removeEventListener('shopsys:focus-party', focus); window.removeEventListener('shopsys:open-party', openFromShortcut) }
  }, [autoFocus])
  const commit = (party = matches[index] ?? matches[0]) => {
    if (party) onChange(party.id)
    else onChange(value)
    setOpen(false)
    onConfirm?.()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((current) => Math.max(0, current - 1)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (!open && !query.trim()) {
        if (showCash && value === emptyValue) { onChange(emptyValue); onConfirm?.(); return }
        if (!showCash && !selected) { openSearch(); return }
        onChange(value); onConfirm?.(); return
      }
      if (!open) { openSearch(); return }
      commit()
    } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
  }
  const renderParty = (party: Party, row: number) => {
    const info = partyInfo?.(party) ?? {}
    const stopped = party.active === false ? 'موقوف' : undefined
    return <button type="button" key={party.id} data-quick-option="true" data-value={String(party.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(row)} onDoubleClick={() => commit(party)} className={`invoice-search-result-row w-full rounded-lg p-2 text-right ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-400" dir="ltr">{info.code}</span><b className="truncate">{party.nameAr}</b></div>{party.phone && <span className="text-[10px] text-slate-500" dir="ltr">{party.phone}</span>}</div>
        <div className="shrink-0 text-left text-[10px] font-bold">{info.balance && <div className="text-slate-500">{info.balance}</div>}{stopped && <div className="text-rose-600">{stopped}</div>}</div>
      </div>
    </button>
  }
  return <div ref={pickerRef} className="relative invoice-picker-root" data-enter-native="true" data-party-picker="true">
    <input ref={inputRef} className={inputCls} value={open ? '' : (selected?.nameAr ?? cashLabel)} aria-label={open ? undefined : label} aria-hidden={open || undefined} tabIndex={open ? -1 : undefined} onFocus={() => { if (!open) { setQuery(''); inputRef.current?.select() } }} onChange={(event) => { if (open) { setQuery(event.target.value); setIndex(0) } else openSearch(event.target.value) }} onKeyDown={handleKeyDown} />
    {open && <OverlayPortal><div className="layer-picker fixed inset-0 invoice-search-overlay invoice-party-overlay" dir="rtl" onMouseDown={(event) => event.stopPropagation()}>
      <div role="dialog" aria-label={`${label} — نتائج البحث`} style={panelStyle} className="invoice-search-dialog flex flex-col overflow-hidden rounded-2xl border border-brand-300/50 bg-white dark:border-brand-700/50 dark:bg-card-dark" onMouseDown={(event) => event.stopPropagation()}>
        <div className="invoice-search-header flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700"><div><b className="text-base">بحث {label.replace('بحث ', '')}</b><p className="text-xs text-slate-500">اكتب الاسم أو الهاتف أو الكود، ثم اختر بالأسهم أو الضغط مرتين</p></div><button type="button" aria-label="إغلاق البحث" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-500/10" onClick={() => setOpen(false)}>✕</button></div>
        <div className="invoice-search-inputbar border-b border-slate-200 p-3 dark:border-slate-700"><input ref={searchInputRef} className={inputCls} value={query} placeholder={`ابحث في ${label.replace('بحث ', '')}`} aria-label={label} autoComplete="off" onChange={(event) => { setQuery(event.target.value); setIndex(0) }} onKeyDown={handleKeyDown} /></div>
        <div role="listbox" aria-label={`${label} — نتائج البحث`} className="invoice-search-results overflow-auto p-2">{showCash && <button type="button" data-quick-option="true" data-value={String(emptyValue)} onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(-1)} onDoubleClick={() => { onChange(emptyValue); setOpen(false); onConfirm?.() }} className={`invoice-search-result-row invoice-search-cash w-full rounded-xl border border-dashed border-brand-300 p-3 text-right font-bold text-brand-700 hover:bg-brand-500/10 dark:border-brand-700 dark:text-brand-300 ${index === -1 ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : ''}`}>{cashLabel}</button>}{matches.length ? matches.map(renderParty) : <div className="p-8 text-center text-sm text-slate-400">لا توجد نتائج مطابقة</div>}</div>
      </div>
    </div></OverlayPortal>}
  </div>
}
