/**
 * التنقل داخل جداول البنود بالأسهم (نمط فاتورة البيع) — مشترك بين كل الجداول
 * الحرة: بنود عرض السعر وفاتورة المقاولات الحرة وجدول الفاتورة نفسه.
 * ملف مستقل لأن InvoiceLinesTable مكوّن واجهة (قاعدة fast-refresh: لا تصدير
 * دوال من ملف مكوّنات).
 */
import type React from 'react'

/** خلايا السطر القابلة للتحرير بالترتيب — تُستعمل في التنقل بالأسهم */
export function rowCells(row: HTMLTableRowElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('input:not([type="date"]):not([disabled]), td[tabindex="0"]')]
    .filter((element) => element.dataset.arrowsNative !== 'true')
}
/**
 * التنقل داخل جدول البنود بالأسهم فقط — لا تغيّر الأسهم أي قيمة:
 * ↑/↓ نفس العمود بين السطور · ←/→ بين حقول السطر (وتنتقل للسطر المجاور عند الطرف).
 */
export function gridArrowNavigation(event: React.KeyboardEvent<HTMLTableSectionElement>) {
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

