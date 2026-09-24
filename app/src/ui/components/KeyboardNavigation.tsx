import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const selector = 'input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'

function visible(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && element.getAttribute('aria-hidden') !== 'true'
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
        navigate(pathname.startsWith('/purchases') ? '/purchases/invoices/new' : '/sales/invoices/new')
        return
      }
      if (event.key === 'F4') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:focus-party')); return }
      if (event.key === 'F5') { event.preventDefault(); window.dispatchEvent(new Event('shopsys:focus-item')); return }
      if ((event.key === 'F8' || event.key === 'F9') && !pathname.startsWith('/sales/pos')) {
        const words = event.key === 'F8'
          ? ['حفظ مسودة', 'حفظ كمسودة']
          : ['اعتماد', 'ترحيل', 'دفع', 'تحصيل', 'صرف', 'تسليم', 'تسجيل وتوليد', 'تأكيد وطباعة', 'حفظ وترحيل', 'حفظ واعتماد']
        const candidates = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((candidate) => visible(candidate))
        const button = event.key === 'F9'
          ? candidates.find((candidate) => (candidate.textContent ?? '').includes('F9') && !(candidate.textContent ?? '').includes('مسودة'))
            ?? candidates.find((candidate) => words.some((word) => (candidate.textContent ?? '').includes(word)) && !(candidate.textContent ?? '').includes('مسودة'))
          : candidates.find((candidate) => words.some((word) => (candidate.textContent ?? '').includes(word)))
        if (button) { event.preventDefault(); button.click() }
        return
      }
      if (event.key === 'F6' || event.key === 'F7') {
        const word = event.key === 'F6' ? 'طباعة' : 'Excel'
        const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => visible(candidate) && candidate.textContent?.includes(word))
        if (button) { event.preventDefault(); button.click() } return
      }
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
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (target instanceof HTMLInputElement || target.hasAttribute('tabindex')) && !target.closest('[data-arrows-native="true"]')) {
        const row = target.closest('tr,[data-entry-row]')
        const parent = row?.parentElement
        if (row && parent) {
          const rows = [...parent.querySelectorAll<HTMLElement>(':scope > tr,:scope > [data-entry-row]')]
          const rowIndex = rows.indexOf(row as HTMLElement)
          const rowControls = [...row.querySelectorAll<HTMLElement>(selector)].filter(visible)
          const column = rowControls.indexOf(target)
          const destination = rows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)]
          const next = destination ? [...destination.querySelectorAll<HTMLElement>(selector)].filter(visible)[column] : null
          if (next) { event.preventDefault(); next.focus(); if (next instanceof HTMLInputElement) next.select(); return }
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

  return helpOpen ? <div className="fixed inset-0 z-[100] bg-slate-950/60 flex items-center justify-center p-4" onMouseDown={() => setHelpOpen(false)}><div role="dialog" className="w-full max-w-lg rounded-2xl border bg-white dark:bg-card-dark p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex justify-between"><h2 className="font-black text-lg">اختصارات لوحة المفاتيح</h2><button onClick={() => setHelpOpen(false)}>Esc</button></div><div className="grid grid-cols-2 gap-2 mt-4 text-sm">{[['F2','بحث سريع'],['F3','فاتورة جديدة'],['F4','بحث عميل/مورد'],['F5','بحث صنف'],['F6','طباعة'],['F7','تصدير Excel'],['F8','حفظ مسودة'],['F9','ترحيل/اعتماد/دفع العملية'],['F10','الخصم'],['F11','ملء الشاشة'],['F12','دليل الاختصارات']].map(([key,label])=><div key={key} className="flex items-center gap-2 rounded-lg bg-slate-500/10 p-2"><kbd className="font-mono font-black text-brand-600">{key}</kbd><span>{label}</span></div>)}</div></div></div> : null
}
