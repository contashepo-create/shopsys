import type { Letter, LetterObject } from './letters.ts'
import { letterCellKey, type LetterCellFormat } from './letterTableStyles.ts'
import type { LetterTablePagePlan } from './letterTablePagination.ts'

type Table = Extract<LetterObject, { kind: 'table' }>
export interface LetterFlowMeasurement { fingerprint: string; plan: LetterTablePagePlan }
export interface LetterFlowPart { sourceId: string; rows: number[] }
export function letterFlowFingerprint(letter: Letter, table: Table): string {
  return JSON.stringify([letter.id, letter.font, table.box, table.cells, table.style, table.format, table.cellFormats, table.merges])
}
/** عرض مشتق فقط: النص والأصل والتاريخ يبقون في جدول واحد داخل المسودة. */
export function expandLetterTableFlows(letter: Letter, measurements: Record<string, LetterFlowMeasurement>) {
  const aliases: Record<string, LetterFlowPart> = {}, problems: string[] = [], occupied = new Set((letter.objects ?? []).map(o => o.id))
  let pageCount = letter.layout?.pageCount ?? 1
  const objects = (letter.objects ?? []).flatMap((object, objectIndex): LetterObject[] => {
    if (object.kind !== 'table' || !object.autoFlow) return [object]
    const measurement = measurements[object.id]
    if (!measurement) { problems.push('لم يكتمل قياس الجدول التلقائي'); return [object] }
    if (measurement.fingerprint !== letterFlowFingerprint(letter, object)) problems.push('جارٍ إعادة قياس الجدول التلقائي')
    const plan = measurement.plan
    if ('error' in plan) {
      problems.push(plan.error === 'header-merge' ? 'العنوان مدمج مع الصف التالي؛ أوقف تمييز العنوان أو فك دمجه للتوزيع' : plan.error === 'too-tall' ? 'صف أو مجموعة صفوف مدمجة لا تتسع في صفحة' : 'تعذر قياس الجدول التلقائي')
      return [object]
    }
    if (plan.groups.some(g => g.rows.some(row => row >= object.cells.length))) { problems.push('جارٍ إعادة قياس صفوف الجدول'); return [object] }
    const lastPage = (object.box.page ?? 1) + plan.groups[plan.groups.length - 1].pageOffset
    if (lastPage > 10) { problems.push('الجدول التلقائي يتجاوز الحد الأقصى للصفحات'); return [object] }
    pageCount = Math.max(pageCount, lastPage)
    return plan.groups.map(({ rows, pageOffset }, part): Table => {
      let id = part === 0 ? object.id : `flow_${objectIndex}_${part}`
      while (part !== 0 && occupied.has(id)) id += '_'
      occupied.add(id)
      aliases[id] = { sourceId: object.id, rows }
      const formats: Record<string, LetterCellFormat> = {}
      rows.forEach((source, target) => object.cells[source].forEach((_, col) => { const format = object.cellFormats?.[letterCellKey(source, col)]; if (format) formats[letterCellKey(target, col)] = format }))
      const merges = (object.merges ?? []).flatMap(merge => { const row = rows.indexOf(merge.row); return row < 0 ? [] : [{ ...merge, row }] })
      const repeatedHeader = object.format?.header !== false && object.cells.length > 1
      const firstBody = repeatedHeader && rows.length > 1 ? 1 : 0
      const stripeOffset = ((object.format?.stripeOffset ?? 0) + rows[firstBody] - firstBody) % 2 as 0 | 1
      return { ...object, id, autoFlow: false, format: { ...object.format, stripeOffset }, cells: rows.map(i => [...object.cells[i]]), cellFormats: formats, merges, box: { ...object.box, page: (object.box.page ?? 1) + pageOffset, y: pageOffset === 0 ? object.box.y : 15, repeat: false } }
    })
  })
  return { letter: letter.layout ? { ...letter, objects, layout: { ...letter.layout, pageCount } } : letter, aliases, problems }
}
