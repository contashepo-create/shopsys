export type LetterCanvasIssue =
  | { kind: 'outside'; key: string }
  | { kind: 'overlap'; key: string; other: string }

/** فحص العناصر والخط الفاصل للترويسة؛ بقية الخطوط الزخرفية مستثناة. */
export function inspectLetterCanvas(page: HTMLElement): LetterCanvasIssue[] {
  const pageRect = page.getBoundingClientRect()
  const items = [...page.querySelectorAll<HTMLElement>('[data-letter-box]:not(.letters-canvas-line)')]
    .map(node => ({ key: node.dataset.letterBox ?? '', rect: node.getBoundingClientRect() }))
    .filter(item => item.key && item.rect.width > 0 && item.rect.height > 0)
  const issues: LetterCanvasIssue[] = []
  for (let index = 0; index < items.length; index++) {
    const { key, rect } = items[index]
    if (rect.bottom > pageRect.bottom + 1 || rect.right > pageRect.right + 1 || rect.left < pageRect.left - 1 || rect.top < pageRect.top - 1) issues.push({ kind: 'outside', key })
    for (const other of items.slice(index + 1)) {
      const b = other.rect
      if (rect.left < b.right - 1 && rect.right > b.left + 1 && rect.top < b.bottom - 1 && rect.bottom > b.top + 1) issues.push({ kind: 'overlap', key, other: other.key })
    }
  }
  const line = page.querySelector<HTMLElement>('[data-letter-box="topRule"]')?.getBoundingClientRect()
  if (line && line.width > 0 && line.height > 0) for (const item of items) {
    const key = item.key
    const rect = item.rect
    if (rect.left < line.right - 1 && rect.right > line.left + 1 && rect.top < line.bottom - 1 && rect.bottom > line.top + 1) issues.push({ kind: 'overlap', key, other: 'topRule' })
  }
  return issues
}

/** نهاية الترويسة المرئية على صفحة الخط الفاصل، بوحدة مم من أعلى الصفحة. */
export function measureLetterHeaderBottom(page: HTMLElement): number | null {
  const pageRect = page.getBoundingClientRect()
  if (!pageRect.height) return null
  const elements = [...page.querySelectorAll<HTMLElement>('[data-letter-box]')].filter(node => {
    const key = node.dataset.letterBox ?? ''
    return key === 'logo' || key === 'identityName' || key.startsWith('header') || key.startsWith('recipient') && key !== 'recipient'
  })
  const bottoms = elements.map(node => node.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => (rect.bottom - pageRect.top) * 297 / pageRect.height)
  return bottoms.length ? Math.max(...bottoms) : null
}
