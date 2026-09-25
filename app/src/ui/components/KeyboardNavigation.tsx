import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { guardNavigation } from './ui.tsx'

const selector = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'
const rowFieldSelector = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]'

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && element.getAttribute('aria-hidden') !== 'true'
}

/**
 * يختار زر اختصار واحداً فقط:
 * - تكرار الزر نفسه أعلى/أسفل النموذج مقبول (نفس النص = نفس العملية).
 * - أزرار صفوف متعددة لا تُختار عشوائياً؛ يجب أن يكون التركيز داخل الصف.
 */
function selectShortcutButton(candidates: HTMLButtonElement[]): HTMLButtonElement | null {
  if (!candidates.length) return null
  const active = document.activeElement as HTMLElement | null
  const activeRow = active?.closest('tr,[data-entry-row]')
  if (activeRow) {
    candidates = candidates.filter((candidate) => activeRow.contains(candidate))
    if (!candidates.length) return null
  } else if (candidates.some((candidate) => candidate.closest('tr,[data-entry-row]'))) {
    return null
  }
  const unique = new Map<string, HTMLButtonElement>()
  for (const candidate of candidates) {
    const label = (candidate.textContent ?? '').replace(/F[89]/g, '').replace(/\s+/g, ' ').trim()
    const key = candidate.dataset.shortcutAction ?? label
    if (!unique.has(key)) unique.set(key, candidate)
  }
  return unique.size === 1 ? unique.values().next().value ?? null : null
}

/** تحكم شامل بلا ماوس: Enter للحقل التالي، Shift+Enter للسابق، وF3 لفاتورة جديدة. */
export function KeyboardNavigation() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault()
        const nextPath = pathname.startsWith('/purchases') ? '/purchases/invoices/new' : '/sales/invoices/new'
        guardNavigation(() => navigate(nextPath)) || navigate(nextPath)
        return
      }
      if (event.key === 'F4') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:open-party')); return }
      if (event.key === 'F5') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:open-item')); return }
      if ((event.key === 'F8' || event.key === 'F9') && !pathname.startsWith('/sales/pos')) {
        const words = event.key === 'F8'
          ? ['حفظ مسودة', 'حفظ كمسودة']
          : ['اعتماد', 'ترحيل', 'دفع', 'تحصيل', 'صرف', 'تسليم', 'تسجيل', 'حفظ', 'إنشاء', 'إقفال', 'تنفيذ', 'تأكيد وطباعة', 'حفظ وترحيل', 'حفظ واعتماد']
        // The modal is portaled after the page. Limit shortcut lookup to the topmost
        // open dialog so a background page action cannot win while a form is open.
        const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((dialog) => visible(dialog))
        const shortcutScope: ParentNode = dialogs.at(-1) ?? document
        const candidates = [...shortcutScope.querySelectorAll<HTMLButtonElement>('button')].filter((candidate) => visible(candidate))
        const markedCandidates = candidates.filter((candidate) => candidate.dataset.shortcut === event.key)
        const actionCandidates = markedCandidates.length > 0 ? markedCandidates : candidates.filter((candidate) => {
          const text = candidate.textContent ?? ''
          return event.key === 'F9'
            ? (text.includes('F9') || words.some((word) => text.includes(word))) && !text.includes('مسودة')
            : words.some((word) => text.includes(word))
        })
        const button = selectShortcutButton(actionCandidates)
        if (button) { event.preventDefault(); button.click() }
        return
      }
      if (event.key === 'F6') {
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => visible(candidate) && candidate.textContent?.includes('طباعة'))
        if (button) { event.preventDefault(); button.click() } return
      }
      if (event.key === 'F7') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:open-party')); return }
      if (event.key === 'F10') {
        const discount = [...document.querySelectorAll<HTMLInputElement>('input')].find((candidate) => visible(candidate) && ((candidate.placeholder ?? '').includes('خصم') || (candidate.getAttribute('aria-label') ?? '').includes('خصم')))
        if (discount) { event.preventDefault(); discount.focus(); discount.select() } return
      }
      if (event.key === 'F11') { event.preventDefault(); if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); return }
      if (event.key === 'F12') { event.preventDefault(); setHelpOpen((open) => !open); return }
      const target = event.target as HTMLElement | null
      if (!target || event.defaultPrevented) return
      if (event.key === 'F2') {
        event.preventDefault()
        const scope = target.closest('[role="dialog"], main') ?? document.body
        const search = [...scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[placeholder*="بحث"],input[placeholder*="ابحث"]')].find(visible)
        search?.focus(); search?.select()
        return
      }
      const isGridArrow = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      if (isGridArrow && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.hasAttribute('tabindex')) && !target.closest('[data-arrows-native="true"],[data-enter-native="true"]')) {
        const row = target.closest('tr,[data-entry-row]')
        const parent = row?.parentElement
        if (row && parent) {
          const rows = [...parent.querySelectorAll<HTMLElement>(':scope > tr,:scope > [data-entry-row]')]
          const rowIndex = rows.indexOf(row as HTMLElement)
          const rowControls = [...row.querySelectorAll<HTMLElement>(rowFieldSelector)].filter(visible)
          const column = rowControls.indexOf(target)
          const rowStep = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowLeft' ? 1 : -1
          const destination = event.key === 'ArrowDown' || event.key === 'ArrowUp' ? rows[rowIndex + rowStep] : row
          const nextControls = destination ? [...destination.querySelectorAll<HTMLElement>(rowFieldSelector)].filter(visible) : []
          const next = destination === row ? nextControls[column + rowStep] : nextControls[column]
          // In invoice grids arrows are navigation keys, never number-spinner keys.
          event.preventDefault()
          if (next) { next.focus(); if (next instanceof HTMLInputElement) next.select() }
          return
        }
      }
      if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey) return
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target.closest('[data-enter-native="true"]')) return
      const scope = target.closest('[role="dialog"], form, main') ?? document.body
      const controls = [...scope.querySelectorAll<HTMLElement>(selector)].filter(visible)
      const index = controls.indexOf(target)
      if (index < 0) return
      const next = controls[index + (event.shiftKey ? -1 : 1)]
      if (!next) return
      event.preventDefault()
      next.focus()
      if (next instanceof HTMLInputElement && next.type !== 'checkbox' && next.type !== 'radio') next.select()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, pathname])

  return helpOpen ? <div className="fixed inset-0 z-[100] bg-slate-950/60 flex items-center justify-center p-4" onMouseDown={() => setHelpOpen(false)}><div role="dialog" className="w-full max-w-lg rounded-2xl border bg-white dark:bg-card-dark p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex justify-between"><h2 className="font-black text-lg">اختصارات لوحة المفاتيح</h2><button onClick={() => setHelpOpen(false)}>Esc</button></div><div className="grid grid-cols-2 gap-2 mt-4 text-sm">{[['F2','بحث سريع'],['F3','فاتورة جديدة'],['F4','بحث عميل/مورد'],['F5','بحث صنف'],['F6','طباعة'],['F7','بحث عميل/مورد'],['F8','حفظ مسودة'],['F9','ترحيل/اعتماد/دفع العملية'],['F10','الخصم'],['F11','ملء الشاشة'],['F12','دليل الاختصارات']].map(([key,label])=><div key={key} className="flex items-center gap-2 rounded-lg bg-slate-500/10 p-2"><kbd className="font-mono font-black text-brand-600">{key}</kbd><span>{label}</span></div>)}</div></div></div> : null
}
