import { useEffect } from 'react'
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault()
        navigate(pathname.startsWith('/purchases') ? '/purchases/invoices/new' : '/sales/invoices/new')
        return
      }
      const target = event.target as HTMLElement | null
      if (!target || event.defaultPrevented) return
      if (event.key === 'F2') {
        event.preventDefault()
        const scope = target.closest('[role="dialog"], main') ?? document.body
        const search = [...scope.querySelectorAll<HTMLInputElement>('input[type="search"],input[placeholder*="بحث"],input[placeholder*="ابحث"]')].find(visible)
        search?.focus(); search?.select()
        return
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && target instanceof HTMLInputElement && !target.closest('[data-arrows-native="true"]')) {
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

  return null
}
