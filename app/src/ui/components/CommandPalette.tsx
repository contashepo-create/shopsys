/**
 * لوحة الأوامر (Ctrl+K) وخريطة الاختصارات (Ctrl+/) — الموجة ① من خطة UX.
 * لا تمسّ تقسيم الفاتورة: طبقة عائمة مستقلة تفتح فوق أي شاشة، تبحث في
 * **الشاشات المتاحة للمستخدم** و**العملاء والموردين والأصناف** و**أوامر سريعة**،
 * وتنفّذ بالسهمين وEnter. بلا تعتيم للخلفية (قاعدة المالك) — لوحة محايدة أعلى الشاشة.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft, Keyboard, ArrowUpDown } from 'lucide-react'
import { OverlayPortal, guardNavigation, useToast } from './ui.tsx'
import { useNavSections } from '../hooks/useNavSections.ts'
import { SHORTCUT_MAP } from '../shortcutMap.ts'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { openPurchaseInvoiceWindow, openSalesInvoiceWindow, useWindowStore } from '../windows/windowStore.ts'

type Command = {
  id: string
  label: string
  hint?: string
  group: string
  keys?: string
  run: () => void
}

const norm = (value: string) => value.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase()

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const sections = useNavSections()
  const customers = useDataStore((s) => s.customers)
  const suppliers = useDataStore((s) => s.suppliers)
  const items = useDataStore((s) => s.items)
  const show = useToast((s) => s.show)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') { event.preventDefault(); setOpen((v) => !v); setQuery(''); setIndex(0) }
      else if (key === '/' || event.key === '؟') { event.preventDefault(); setShortcuts((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20) }, [open])

  /* Escape يغلق الطبقة العائمة أولاً ولا يصل إلى النافذة خلفها */
  useEffect(() => {
    if (!open && !shortcuts) return
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (shortcuts) setShortcuts(false)
      else setOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [open, shortcuts])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    list.push(
      { id: 'cmd:new-sale', group: 'أوامر', label: 'فاتورة مبيعات جديدة', keys: 'F2 في المبيعات', run: () => openSalesInvoiceWindow() },
      { id: 'cmd:new-purchase', group: 'أوامر', label: 'فاتورة مشتريات جديدة', run: () => openPurchaseInvoiceWindow() },
      { id: 'cmd:theme', group: 'أوامر', label: theme === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن', run: () => toggleTheme() },
      { id: 'cmd:shortcuts', group: 'أوامر', label: 'عرض خريطة الاختصارات', keys: 'Ctrl + /', run: () => setShortcuts(true) },
      { id: 'cmd:minimize-all', group: 'النوافذ', label: 'تصغير كل النوافذ المفتوحة', run: () => {
        const state = useWindowStore.getState()
        state.windows.forEach((win) => state.minimizeWindow(win.id))
      } },
    )
    for (const sec of sections) for (const child of sec.children) {
      list.push({ id: `nav:${sec.id}.${child.id}`, group: sec.nameAr, label: child.nameAr, hint: sec.nameAr, keys: 'انتقال',
        run: () => { if (!guardNavigation(() => navigate(child.path))) navigate(child.path) } })
    }
    for (const customer of customers.slice(0, 200)) {
      list.push({ id: `customer:${customer.id}`, group: 'العملاء', label: customer.nameAr, hint: customer.phone ?? '', keys: 'فتح العميل',
        run: () => navigate(`/parties/customers?focus=${customer.id}`) })
    }
    for (const supplier of suppliers.slice(0, 200)) {
      list.push({ id: `supplier:${supplier.id}`, group: 'الموردون', label: supplier.nameAr, hint: supplier.phone ?? '', keys: 'فتح المورد',
        run: () => navigate(`/parties/suppliers?focus=${supplier.id}`) })
    }
    for (const item of items.slice(0, 200)) {
      list.push({ id: `item:${item.id}`, group: 'الأصناف', label: item.nameAr, hint: item.sku ?? '', keys: 'فتح الصنف',
        run: () => navigate(`/items?focus=${item.id}`) })
    }
    return list
  }, [customers, items, navigate, sections, suppliers, theme, toggleTheme])

  const results = useMemo(() => {
    const q = norm(query)
    if (!q) return commands.slice(0, 40)
    const words = q.split(' ')
    return commands
      .map((cmd) => {
        const hay = norm(`${cmd.label} ${cmd.hint ?? ''} ${cmd.group}`)
        if (!words.every((w) => hay.includes(w))) return null
        return { cmd, score: hay.startsWith(q) ? 0 : hay.indexOf(q) }
      })
      .filter((row): row is { cmd: Command; score: number } => row !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((row) => row.cmd)
  }, [commands, query])

  useEffect(() => {
    listRef.current?.querySelector('[data-cmd-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [index, results])

  const runAt = (at: number) => {
    const cmd = results[at]
    if (!cmd) return
    setOpen(false)
    cmd.run()
    show(cmd.label)
  }

  return (
    <>
      {open && (
        <OverlayPortal>
          <div className="command-palette layer-picker" dir="rtl" data-command-palette role="dialog" aria-label="لوحة الأوامر">
            <div className="command-palette-head">
              <Search size={15} className="text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setIndex(0) }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((v) => Math.min(results.length - 1, v + 1)) }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((v) => Math.max(0, v - 1)) }
                  else if (event.key === 'Enter') { event.preventDefault(); runAt(index) }
                  else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
                }}
                placeholder="اكتب اسم شاشة أو عميل أو صنف أو أمراً…"
                aria-label="بحث لوحة الأوامر"
                data-command-input
              />
              <kbd className="command-kbd">Esc</kbd>
            </div>
            <div className="command-palette-list" ref={listRef} role="listbox">
              {results.length === 0 && <div className="command-empty">لا نتائج مطابقة — جرّب كلمة أخرى</div>}
              {results.map((cmd, at) => (
                <button
                  type="button"
                  key={cmd.id}
                  role="option"
                  aria-selected={at === index}
                  data-cmd-active={at === index}
                  className={`command-opt ${at === index ? 'is-on' : ''}`}
                  onMouseEnter={() => setIndex(at)}
                  onMouseDown={(event) => { event.preventDefault(); runAt(at) }}
                >
                  <span className="command-opt-label">{cmd.label}</span>
                  <span className="command-opt-group">{cmd.group}</span>
                  {cmd.keys && <span className="command-opt-keys">{cmd.keys}</span>}
                </button>
              ))}
            </div>
            <div className="command-palette-foot">
              <span><ArrowUpDown size={11} /> للتنقل</span>
              <span><CornerDownLeft size={11} /> للتنفيذ</span>
              <span><Keyboard size={11} /> Ctrl + / للاختصارات</span>
              <span className="command-count">{results.length} نتيجة</span>
            </div>
          </div>
        </OverlayPortal>
      )}

      {shortcuts && (
        <OverlayPortal>
          <div className="shortcut-map layer-picker" dir="rtl" data-shortcut-map role="dialog" aria-label="خريطة الاختصارات">
            <div className="shortcut-map-head">
              <b><Keyboard size={13} /> خريطة الاختصارات</b>
              <button type="button" onClick={() => setShortcuts(false)} aria-label="إغلاق">✕</button>
            </div>
            <div className="shortcut-map-body">
              {SHORTCUT_MAP.map((group) => (
                <div key={group.group} className="shortcut-group">
                  <h4>{group.group}</h4>
                  {group.rows.map(([keys, what]) => (
                    <div key={keys} className="shortcut-row"><kbd>{keys}</kbd><span>{what}</span></div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </OverlayPortal>
      )}
    </>
  )
}
