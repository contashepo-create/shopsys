/**
 * مساعدات اختبار QuickSelect بعد قرار المالك:
 * القوائم ≤ ١٠ بنود تُعرض **قائمة منسدلة أصلية**، والأطول تبقى منتقياً بحثياً.
 * تتعامل هذه الدوال مع الحالتين فلا تتعلق الاختبارات بشكل واحد.
 */
import { fireEvent } from '@testing-library/react'

/** كل خيارات منتقٍ (أصلي أو بحثي) داخل جذر معيّن */
export function quickOptionNodes(root: ParentNode = document): Element[] {
  return [
    ...root.querySelectorAll('[data-quick-native] option'),
    ...root.querySelectorAll('[data-quick-option]'),
  ]
}

/** نصوص الخيارات المتاحة */
export function quickOptionTexts(root: ParentNode = document): string[] {
  return quickOptionNodes(root).map((node) => node.textContent?.trim() ?? '')
}

/** اختيار خيار بقيمته من أي منتقٍ (أصلي أو بحثي) */
export function chooseQuickValue(root: ParentNode, value: string): boolean {
  const native = root.querySelector(`[data-quick-native] option[value="${value}"]`)
  if (native) {
    const select = native.closest('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value } })
    return true
  }
  const option = root.querySelector(`[data-quick-option][data-value="${value}"]`) as HTMLElement | null
  if (!option) return false
  fireEvent.click(option)
  return true
}

/** اختيار خيار بنصّه من منتقٍ محدَّد بتسمية aria */
export function chooseQuickByLabel(ariaLabel: string, text: string): boolean {
  const select = document.querySelector(`[data-quick-native] select[aria-label="${ariaLabel}"]`) as HTMLSelectElement | null
  if (select) {
    const option = [...select.options].find((row) => row.textContent?.includes(text))
    if (!option) return false
    fireEvent.change(select, { target: { value: option.value } })
    return true
  }
  const input = document.querySelector(`input[aria-label="${ariaLabel}"]`) as HTMLInputElement | null
  if (!input) return false
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: text } })
  const option = [...document.querySelectorAll('[data-quick-option]')].find((row) => row.textContent?.includes(text)) as HTMLElement | undefined
  if (!option) return false
  fireEvent.click(option)
  return true
}
