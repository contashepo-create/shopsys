import type { LetterCellMerge } from './letterTableStyles.ts'

export interface LetterTablePageGroup { pageOffset: number; rows: number[] }
export type LetterTablePagePlan = { groups: LetterTablePageGroup[] } | { error: 'measurement' | 'header-merge' | 'too-tall' }

/** يقسم عند حدود الصفوف فقط؛ الصفوف المتصلة بدمج عمودي تبقى معاً. */
export function planLetterTablePages(heights: number[], merges: LetterCellMerge[], firstCapacity: number, nextCapacity: number, repeatHeader: boolean): LetterTablePagePlan {
  if (!heights.length || heights.some(h => !Number.isFinite(h) || h < 0) || !heights.some(h => h > 0) || !Number.isFinite(firstCapacity) || !Number.isFinite(nextCapacity) || nextCapacity <= 0) return { error: 'measurement' }
  if (repeatHeader && merges.some(m => m.row === 0 && m.rows > 1)) return { error: 'header-merge' }
  const header = repeatHeader && heights.length > 1 ? [0] : []
  const blocks: number[][] = []
  for (let start = header.length; start < heights.length;) {
    let end = start + 1
    // تنشأ مجموعة متصلة إذا تشابكت نطاقات الدمج في أعمدة مختلفة.
    for (let row = start; row < end; row++) for (const merge of merges) if (merge.row === row) end = Math.max(end, merge.row + merge.rows)
    blocks.push(Array.from({ length: end - start }, (_, i) => start + i)); start = end
  }
  const sum = (rows: number[]) => rows.reduce((total, row) => total + heights[row], 0)
  const headerHeight = sum(header)
  let pageOffset = 0, capacity = firstCapacity, group = [...header], used = headerHeight
  const groups: LetterTablePageGroup[] = []
  for (const block of blocks) {
    const height = sum(block)
    if (used + height > capacity) {
      if (group.length > header.length) groups.push({ pageOffset, rows: group })
      pageOffset++; capacity = nextCapacity; group = [...header]; used = headerHeight
      if (used + height > capacity) return { error: 'too-tall' }
    }
    group.push(...block); used += height
  }
  if (group.length) {
    if (used > capacity) {
      pageOffset++; if (used > nextCapacity) return { error: 'too-tall' }
    }
    groups.push({ pageOffset, rows: group })
  }
  return { groups }
}
