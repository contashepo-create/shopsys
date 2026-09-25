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
  return <div ref={rootRef} className="relative" title={title} data-enter-native="true" data-quick-select="true">
    <div className="relative">
      <input ref={inputRef} disabled={disabled} aria-label={ariaLabel} className={`${className ?? inputCls} pl-8`} value={open ? query : (selected?.label ?? '')} placeholder={selected ? undefined : 'اكتب للبحث ثم Enter'} onFocus={() => { setQuery(''); setOpen(true) }} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((current) => Math.min(Math.max(0, matches.length - 1), current + 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) }
        else if (event.key === 'Enter') { event.preventDefault(); choose(matches[index] ?? matches[0]) }
        else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
      }} />
      <ChevronDown size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
    {open && <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1">{matches.length ? matches.map((choice, row) => <button type="button" key={`${choice.value}:${row}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)} className={`w-full p-2 text-right rounded-lg ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`} data-quick-option="true" data-value={choice.value}>{choice.content}</button>) : <div className="p-3 text-center text-xs text-slate-400">لا توجد خيارات مطابقة</div>}</div>}
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
}

/** منتقي صنف موحد: كتابة فورية، أسهم، Enter، Escape؛ مصمم للعمل بلا ماوس. */
export function ItemQuickPicker({ items, onPick, placeholder = 'اكتب كود أو اسم الصنف ثم Enter', amountLabel, inputElementRef, listenForShortcut = true }: PickerProps) {
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
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); setOpen(true) }
    window.addEventListener('shopsys:focus-item', focus)
    return () => window.removeEventListener('shopsys:focus-item', focus)
  }, [listenForShortcut])
  const pick = (item: QuickItem | undefined) => {
    if (!item) return
    onPick(item.id); setQuery(''); setOpen(false); setIndex(0)
  }
  return <div ref={pickerRef} className="relative" data-enter-native="true">
    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-500"/>
    <input ref={(node) => { inputRef.current = node; if (inputElementRef) inputElementRef.current = node }} className={`${inputCls} pr-9`} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(matches.length - 1, value + 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)) }
      else if (event.key === 'Enter') { event.preventDefault(); pick(matches[index] ?? matches[0]) }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    }}/>
    {open && <div className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1">{matches.length ? matches.map((item, row) => <button type="button" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)} className={`w-full grid grid-cols-[110px_1fr_auto] gap-2 p-2.5 rounded-lg text-right ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : 'hover:bg-slate-500/10'}`}><span className="font-mono text-xs text-slate-500">{item.sku || item.barcodes?.[0] || item.id}</span><b>{item.nameAr}</b><span className="text-xs text-slate-500">{amountLabel?.(item) ?? ''}</span></button>) : <div className="p-4 text-center text-sm text-slate-400">لا توجد أصناف مطابقة</div>}</div>}
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
  useEffect(() => { const focus=()=>{inputRef.current?.focus();inputRef.current?.select();setOpen(true)};window.addEventListener('shopsys:focus-party',focus);if(autoFocus) requestAnimationFrame(focus);return()=>window.removeEventListener('shopsys:focus-party',focus) },[autoFocus])
  const renderParty = (party: Party, row: number) => {
    const info = partyInfo?.(party) ?? {}
    const stopped = party.active === false ? 'موقوف' : undefined
    return <button type="button" key={party.id} data-quick-option="true" data-value={String(party.id)} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(party.id); setOpen(false); onConfirm?.() }} className={`w-full p-2 text-right rounded-lg ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/30' : 'hover:bg-slate-500/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="flex items-center gap-2"><b className="truncate">{party.nameAr}</b>{info.code && <span className="font-mono text-[10px] text-slate-400" dir="ltr">{info.code}</span>}</div>{party.phone && <span className="text-[10px] text-slate-500" dir="ltr">{party.phone}</span>}</div>
        <div className="shrink-0 text-left text-[10px] font-bold">{info.balance && <div className="text-slate-500">{info.balance}</div>}{stopped && <div className="text-rose-600">{stopped}</div>}</div>
      </div>
    </button>
  }
  return <div ref={pickerRef} className="relative" data-enter-native="true"><input ref={inputRef} className={inputCls} value={open ? query : (selected?.nameAr ?? cashLabel)} aria-label={label} onFocus={() => { setQuery(''); setOpen(true) }} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((current) => Math.min(matches.length - 1, current + 1)) } else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((current) => Math.max(0, current - 1)) } else if (event.key === 'Enter') { event.preventDefault(); if (showCash && value === emptyValue && !query.trim() && index === 0) { onChange(emptyValue); setOpen(false); onConfirm?.(); return } const party = matches[index] ?? matches[0]; if (party) onChange(party.id); else onChange(value); setOpen(false); onConfirm?.() } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) } }} />{open && <div className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1">{showCash && <button type="button" data-quick-option="true" data-value={String(emptyValue)} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(emptyValue); setOpen(false); onConfirm?.() }} className="w-full p-2 text-right rounded-lg hover:bg-slate-500/10 font-bold">{cashLabel}</button>}{matches.map(renderParty)}</div>}</div>

}
