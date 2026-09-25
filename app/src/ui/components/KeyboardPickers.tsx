import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { inputCls } from './ui.tsx'

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
    const normalized = query.trim().toLowerCase()
    return normalized ? choices.filter((choice) => choice.searchText.includes(normalized) || choice.value.toLowerCase().includes(normalized)) : choices
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
  return <div ref={rootRef} className={`relative ${open ? 'z-[90]' : ''}`} title={title} data-enter-native="true" data-quick-select="true">
    <div className="relative">
      <input ref={inputRef} disabled={disabled} aria-label={ariaLabel} className={`${className ?? inputCls} pl-8`} value={open ? query : (selected?.label ?? '')} placeholder={selected ? undefined : 'اكتب للبحث ثم Enter'} onFocus={() => { setQuery(''); setOpen(true) }} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); choose(matches[index] ?? matches[0]) }
        else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
      <ChevronDown size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
    {open && <div className="absolute z-[100] mt-1 w-full max-h-64 overflow-auto rounded-xl border border-brand-300/50 bg-white dark:border-brand-700/50 dark:bg-card-dark shadow-2xl p-1">{matches.length ? matches.map((choice, row) => <button type="button" key={`${choice.value}:${row}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)} className={`w-full p-2 text-right rounded-lg ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`} data-quick-option="true" data-value={choice.value}>{choice.content}</button>) : <div className="p-3 text-center text-xs text-slate-400">لا توجد خيارات مطابقة</div>}</div>}
  </div>
}

export type QuickItem = { id: number; nameAr: string; sku?: string; barcodes?: string[]; stockQty?: number; priceMinor?: number; costMinor?: number }

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
}

/** منتقي صنف موحد: كتابة فورية، أسهم، Enter، Escape؛ مصمم للعمل بلا ماوس. */
export function ItemQuickPicker({ items, onPick, placeholder = 'اكتب كود أو اسم الصنف ثم Enter', amountLabel, inputElementRef, listenForShortcut = true, onEdit, onMovement, onPrices }: PickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => [item.nameAr, item.sku, ...(item.barcodes ?? []), item.id].some((value) => String(value ?? '').toLowerCase().includes(q)))
  }, [items, query])
  useEffect(() => {
    if (!listenForShortcut) return
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select() }
    const openSearch = () => { focus(); setOpen(true) }
    window.addEventListener('shopsys:focus-item', focus)
    window.addEventListener('shopsys:open-item', openSearch)
    return () => { window.removeEventListener('shopsys:focus-item', focus); window.removeEventListener('shopsys:open-item', openSearch) }
  }, [listenForShortcut])
  const pick = (item: QuickItem | undefined) => {
    if (!item) return
    onPick(item.id); setQuery(''); setOpen(false); setIndex(0)
  }
  return <div ref={pickerRef} className="relative" data-enter-native="true">
    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-500"/>
    <input ref={(node) => { inputRef.current = node; if (inputElementRef) inputElementRef.current = node }} className={`${inputCls} pr-9`} value={query} placeholder={placeholder} onFocus={() => { setQuery('') }} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setIndex((value) => Math.min(Math.max(0, matches.length - 1), value + 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((value) => Math.max(0, value - 1)) }
      else if (event.key === 'Enter') { event.preventDefault(); if (!open) { setOpen(true); return } pick(matches[index] ?? matches[0]) }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    }}/>
    {open && <div role="dialog" aria-label="نتائج بحث الأصناف" className="absolute z-[80] mt-1 w-full min-w-[34rem] max-w-[min(90vw,52rem)] overflow-hidden rounded-2xl border border-brand-300/50 bg-white dark:bg-card-dark shadow-2xl">
      {matches[index] && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-brand-500/5 px-3 py-2 dark:border-slate-700"><div className="min-w-0"><span className="ml-2 font-mono text-[10px] text-slate-500" dir="ltr">{matches[index].sku || matches[index].barcodes?.[0] || matches[index].id}</span><b className="block truncate">{matches[index].nameAr}</b></div><div className="flex items-center gap-1"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onEdit?.(matches[index].id)} disabled={!onEdit} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-sky-700 enabled:hover:bg-sky-50 disabled:opacity-35 dark:border-slate-700 dark:text-sky-300">✎ تعديل</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onMovement?.(matches[index].id)} disabled={!onMovement} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-violet-700 enabled:hover:bg-violet-50 disabled:opacity-35 dark:border-slate-700 dark:text-violet-300">↗ حركة الصنف</button><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onPrices?.(matches[index].id)} disabled={!onPrices} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-emerald-700 enabled:hover:bg-emerald-50 disabled:opacity-35 dark:border-slate-700 dark:text-emerald-300">٪ الأسعار</button></div></div>}
      <div className="max-h-72 overflow-auto p-1">{matches.length ? matches.map((item, row) => <button type="button" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(row)} onDoubleClick={() => pick(item)} className={`w-full grid grid-cols-[110px_1fr_auto] gap-2 p-2.5 rounded-lg text-right ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : 'hover:bg-slate-500/10'}`}><span className="font-mono text-xs text-slate-500">{item.sku || item.barcodes?.[0] || item.id}</span><b>{item.nameAr}</b><span className="text-xs text-slate-500">{amountLabel?.(item) ?? ''}</span></button>) : <div className="p-4 text-center text-sm text-slate-400">لا توجد أصناف مطابقة</div>}</div>
      <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800">اختر بالسهم ثم Enter، أو اضغط مرتين على الصنف لإضافته للفاتورة.</div>
    </div>}
  </div>
}

type Party = { id: number; nameAr: string; phone?: string; active?: boolean }
export type PartyPickerInfo = { code?: string; balance?: string }
export function PartyQuickPicker({ parties, value, onChange, cashLabel, label, onConfirm, autoFocus = false, cashValue, showCash = true, partyInfo }: { parties: Party[]; value: number; onChange: (id: number) => void; cashLabel: string; label: string; onConfirm?: () => void; autoFocus?: boolean; cashValue?: number; showCash?: boolean; partyInfo?: (party: Party) => PartyPickerInfo }) {
  const emptyValue = cashValue ?? (value === -1 ? -1 : 0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const selected = parties.find((party) => party.id === value)
  const matches = useMemo(() => { const q=query.trim().toLowerCase(); return parties.filter((party) => { const info = partyInfo?.(party); return !q || `${party.nameAr} ${party.phone ?? ''} ${info?.code ?? ''}`.toLowerCase().includes(q) }) }, [parties, query, partyInfo])
  useEffect(() => { const focus=()=>{inputRef.current?.focus();inputRef.current?.select();setQuery('')};const openSearch=()=>{focus();setOpen(true)};window.addEventListener('shopsys:focus-party',focus);window.addEventListener('shopsys:open-party',openSearch);if(autoFocus) requestAnimationFrame(focus);return()=>{window.removeEventListener('shopsys:focus-party',focus);window.removeEventListener('shopsys:open-party',openSearch)} },[autoFocus])
  const renderParty = (party: Party, row: number) => {
    const info = partyInfo?.(party) ?? {}
    const stopped = party.active === false ? 'موقوف' : undefined
    return <button type="button" key={party.id} data-quick-option="true" data-value={String(party.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(row)} onDoubleClick={() => { onChange(party.id); setOpen(false); onConfirm?.() }} className={`w-full p-2 text-right rounded-lg ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-slate-400" dir="ltr">{info.code}</span><b className="truncate">{party.nameAr}</b></div>{party.phone && <span className="text-[10px] text-slate-500" dir="ltr">{party.phone}</span>}</div>
        <div className="shrink-0 text-left text-[10px] font-bold">{info.balance && <div className="text-slate-500">{info.balance}</div>}{stopped && <div className="text-rose-600">{stopped}</div>}</div>
      </div>
    </button>
  }
  return <div ref={pickerRef} className={`relative ${open ? 'z-[70]' : ''}`} data-enter-native="true">
    <input ref={inputRef} className={`${inputCls} ${open ? 'relative z-[80]' : ''}`} value={open ? query : (selected?.nameAr ?? cashLabel)} aria-label={label} onFocus={() => { setQuery('') }} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1)) } else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((current) => Math.max(0, current - 1)) } else if (event.key === 'Enter') { event.preventDefault(); if (!open && showCash && value === emptyValue && !query.trim()) { onChange(emptyValue); onConfirm?.(); return } if (!open) { setOpen(true); return } const party = matches[index] ?? matches[0]; if (party) onChange(party.id); else onChange(value); setOpen(false); onConfirm?.() } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }} />
    {open && <div className="fixed inset-0 z-[60] bg-slate-950/35 p-4 sm:p-8" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-label={`${label} — نتائج البحث`} className="mx-auto mt-[8vh] flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-brand-300/50 bg-white shadow-2xl dark:border-brand-700/50 dark:bg-card-dark" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700"><div><b className="text-base">بحث {label.replace('بحث ', '')}</b><p className="text-xs text-slate-500">اكتب الاسم أو الكود، ثم اختر بالضغط أو Enter</p></div><button type="button" aria-label="إغلاق البحث" className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-500/10" onClick={() => setOpen(false)}>✕</button></div>
        <div className="overflow-auto p-2">{showCash && <button type="button" data-quick-option="true" data-value={String(emptyValue)} onMouseDown={(event) => event.preventDefault()} onClick={() => setIndex(-1)} onDoubleClick={() => { onChange(emptyValue); setOpen(false); onConfirm?.() }} className={`w-full rounded-xl border border-dashed border-brand-300 p-3 text-right font-bold text-brand-700 hover:bg-brand-500/10 dark:border-brand-700 dark:text-brand-300 ${index === -1 ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : ''}`}>{cashLabel}</button>}{matches.length ? matches.map(renderParty) : <div className="p-8 text-center text-sm text-slate-400">لا توجد نتائج مطابقة</div>}</div>
      </div>
    </div>}
  </div>

}
