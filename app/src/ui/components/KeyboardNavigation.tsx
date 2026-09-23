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
      if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (!target || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target.closest('[data-enter-native="true"]')) return
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
