import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { inputCls } from './ui.tsx'

export type QuickItem = { id: number; nameAr: string; sku?: string; barcodes?: string[]; stockQty?: number; priceMinor?: number; costMinor?: number }

type PickerProps = {
  items: QuickItem[]
  onPick: (id: number) => void
  placeholder?: string
  amountLabel?: (item: QuickItem) => string
}

/** منتقي صنف موحد: كتابة فورية، أسهم، Enter، Escape؛ مصمم للعمل بلا ماوس. */
export function ItemQuickPicker({ items, onPick, placeholder = 'اكتب كود أو اسم الصنف ثم Enter', amountLabel }: PickerProps) {
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
    if (!q) return items.slice(0, 30)
    return items.filter((item) => [item.nameAr, item.sku, ...(item.barcodes ?? []), item.id].some((value) => String(value ?? '').toLowerCase().includes(q))).slice(0, 30)
  }, [items, query])
  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); setOpen(true) }
    window.addEventListener('shopsys:focus-item', focus)
    return () => window.removeEventListener('shopsys:focus-item', focus)
  }, [])
  const pick = (item: QuickItem | undefined) => {
    if (!item) return
    onPick(item.id); setQuery(''); setOpen(false); setIndex(0)
  }
  return <div ref={pickerRef} className="relative" data-enter-native="true">
    <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-500"/>
    <input ref={inputRef} className={`${inputCls} pr-9`} value={query} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setIndex(0); setOpen(true) }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(matches.length - 1, value + 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)) }
      else if (event.key === 'Enter') { event.preventDefault(); pick(matches[index] ?? matches[0]) }
      else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    }}/>
    {open && <div className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1">{matches.length ? matches.map((item, row) => <button type="button" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)} className={`w-full grid grid-cols-[110px_1fr_auto] gap-2 p-2.5 rounded-lg text-right ${row === index ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : 'hover:bg-slate-500/10'}`}><span className="font-mono text-xs text-slate-500">{item.sku || item.barcodes?.[0] || item.id}</span><b>{item.nameAr}</b><span className="text-xs text-slate-500">{amountLabel?.(item) ?? ''}</span></button>) : <div className="p-4 text-center text-sm text-slate-400">لا توجد أصناف مطابقة</div>}</div>}
  </div>
}

type Party = { id: number; nameAr: string; phone?: string }
export function PartyQuickPicker({ parties, value, onChange, cashLabel, label, onConfirm, autoFocus = false }: { parties: Party[]; value: number; onChange: (id: number) => void; cashLabel: string; label: string; onConfirm?: () => void; autoFocus?: boolean }) {
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
  const matches = useMemo(() => { const q=query.trim().toLowerCase(); return parties.filter(p=>!q||`${p.nameAr} ${p.phone??''}`.toLowerCase().includes(q)).slice(0,30) },[parties,query])
  useEffect(() => { const focus=()=>{inputRef.current?.focus();inputRef.current?.select();setOpen(true)};window.addEventListener('shopsys:focus-party',focus);if(autoFocus) requestAnimationFrame(focus);return()=>window.removeEventListener('shopsys:focus-party',focus) },[autoFocus])
  return <div ref={pickerRef} className="relative" data-enter-native="true"><input ref={inputRef} className={inputCls} value={open?query:(selected?.nameAr??cashLabel)} aria-label={label} onFocus={()=>{setQuery('');setOpen(true)}} onChange={e=>{setQuery(e.target.value);setIndex(0);setOpen(true)}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setIndex(i=>Math.min(matches.length-1,i+1))}else if(e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,i-1))}else if(e.key==='Enter'){e.preventDefault();if(value===-1&&!query.trim()){onChange(-1);setOpen(false);onConfirm?.();return}const p=matches[index]??matches[0];if(p)onChange(p.id);else onChange(value);setOpen(false);onConfirm?.()}else if(e.key==='Escape'){e.preventDefault();setOpen(false)}}}/>{open&&<div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-xl border bg-white dark:bg-card-dark shadow-2xl p-1"><button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(value===-1?-1:0);setOpen(false);onConfirm?.()}} className="w-full p-2 text-right rounded-lg hover:bg-slate-500/10 font-bold">{cashLabel}</button>{matches.map((p,i)=><button type="button" key={p.id} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(p.id);setOpen(false);onConfirm?.()}} className={`w-full flex justify-between p-2 rounded-lg ${i===index?'bg-brand-500/15':'hover:bg-slate-500/10'}`}><b>{p.nameAr}</b><span className="text-xs text-slate-500">{p.phone}</span></button>)}</div>}</div>
}
