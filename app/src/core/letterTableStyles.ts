/** ألوان محددة محفوظة بأسماء ثابتة لتوافق المعاينة والطباعة وWord. */
export const LETTER_TABLE_STYLES = {
  grid: { label: 'شبكة كلاسيكية', border: '334155', header: 'FFFFFF', headerText: '202B3A', stripe: 'FFFFFF', boldHeader: false },
  teal: { label: 'رسمي تركوازي', border: '8AB7B9', header: '176B75', headerText: 'FFFFFF', stripe: 'EDF7F6', boldHeader: true },
  navy: { label: 'رسمي كحلي', border: 'A4B4C7', header: '243F60', headerText: 'FFFFFF', stripe: 'EFF4F9', boldHeader: true },
  soft: { label: 'صفوف هادئة', border: 'CED9DD', header: 'E2ECEE', headerText: '203E48', stripe: 'F5F9F9', boldHeader: true },
  minimal: { label: 'بسيط بلا شبكة', border: 'FFFFFF', header: 'FFFFFF', headerText: '202B3A', stripe: 'FFFFFF', boldHeader: true },
} as const
export type LetterTableStyle = keyof typeof LETTER_TABLE_STYLES
export function letterTableStyle(style?: LetterTableStyle) { return LETTER_TABLE_STYLES[style ?? 'grid'] ?? LETTER_TABLE_STYLES.grid }

/** خيارات اختيارية، القيم الافتراضية تحافظ على مظهر الجداول القديمة. */
export interface LetterTableFormat { align?: 'right' | 'center' | 'left'; fontSize?: number; header?: boolean; striped?: boolean; stripeOffset?: 0 | 1 }
export function validLetterTableFormat(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return Object.keys(v).every(key => ['align', 'fontSize', 'header', 'striped', 'stripeOffset'].includes(key)) &&
    (v.align === undefined || v.align === 'right' || v.align === 'center' || v.align === 'left') &&
    (v.fontSize === undefined || typeof v.fontSize === 'number' && Number.isInteger(v.fontSize) && v.fontSize >= 9 && v.fontSize <= 24) &&
    (v.header === undefined || typeof v.header === 'boolean') && (v.striped === undefined || typeof v.striped === 'boolean') && (v.stripeOffset === undefined || v.stripeOffset === 0 || v.stripeOffset === 1)
}
export function letterTableCellAppearance(style: LetterTableStyle | undefined, format: LetterTableFormat | undefined, row: number) {
  const palette = letterTableStyle(style), header = row === 0 && format?.header !== false
  return { border: palette.border, background: header ? palette.header : format?.striped !== false && (row + (format?.stripeOffset ?? 0)) % 2 === 0 ? palette.stripe : 'FFFFFF', color: header ? palette.headerText : '202B3A', bold: header && palette.boldHeader }
}

/** إحداثيات الخلية صفرية؛ الخلايا المغطاة بالدمج تبقى فارغة صراحة. */
export interface LetterCellFormat { align?: 'right' | 'center' | 'left'; fontSize?: number; bold?: boolean; color?: string; background?: string }
export interface LetterCellMerge { row: number; column: number; rows: number; columns: number }
export const letterCellKey = (row: number, column: number) => `${row}:${column}`
export function letterMergeAt(merges: LetterCellMerge[] | undefined, row: number, column: number): LetterCellMerge | undefined {
  return merges?.find(m => row >= m.row && row < m.row + m.rows && column >= m.column && column < m.column + m.columns)
}
export function validLetterTableDetails(cells: string[][], styles: unknown, merges: unknown): boolean {
  if (styles !== undefined) {
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return false
    for (const [key, value] of Object.entries(styles)) {
      const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(key)
      if (!match || +match[1] >= cells.length || +match[2] >= cells[0].length || !value || typeof value !== 'object' || Array.isArray(value)) return false
      const v = value as Record<string, unknown>
      if (!Object.keys(v).every(k => ['align', 'fontSize', 'bold', 'color', 'background'].includes(k)) ||
        (v.align !== undefined && !['right', 'center', 'left'].includes(v.align as string)) ||
        (v.fontSize !== undefined && (typeof v.fontSize !== 'number' || !Number.isInteger(v.fontSize) || v.fontSize < 9 || v.fontSize > 24)) ||
        (v.bold !== undefined && typeof v.bold !== 'boolean') ||
        [v.color, v.background].some(x => x !== undefined && (typeof x !== 'string' || !/^#[0-9a-f]{6}$/i.test(x)))) return false
    }
  }
  if (merges === undefined) return true
  if (!Array.isArray(merges) || merges.length > 30) return false
  const occupied = new Set<string>()
  for (const m of merges) {
    if (!m || typeof m !== 'object' || !['row', 'column', 'rows', 'columns'].every(k => Number.isInteger(m[k])) || m.row < 0 || m.column < 0 || m.rows < 1 || m.columns < 1 || m.rows * m.columns < 2 || m.row + m.rows > cells.length || m.column + m.columns > cells[0].length) return false
    for (let r = m.row; r < m.row + m.rows; r++) for (let c = m.column; c < m.column + m.columns; c++) {
      const key = letterCellKey(r, c)
      if (occupied.has(key) || ((r !== m.row || c !== m.column) && cells[r][c] !== '')) return false
      occupied.add(key)
    }
  }
  return true
}
/** يحرك تنسيق الخلايا عند إدراج/حذف صف أو عمود دون تغيير التنسيقات الأخرى. */
export function shiftLetterCellFormats(styles: Record<string, LetterCellFormat> | undefined, axis: 'row' | 'column', index: number, remove: boolean): Record<string, LetterCellFormat> | undefined {
  if (!styles) return undefined
  const next: Record<string, LetterCellFormat> = {}
  for (const [key, value] of Object.entries(styles)) {
    let [row, column] = key.split(':').map(Number)
    const pos = axis === 'row' ? row : column
    if (remove && pos === index) continue
    const shifted = pos >= index ? pos + (remove ? -1 : 1) : pos
    if (axis === 'row') row = shifted; else column = shifted
    next[letterCellKey(row, column)] = value
  }
  return next
}
