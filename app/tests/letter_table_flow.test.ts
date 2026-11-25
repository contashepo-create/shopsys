import { describe, expect, it } from 'vitest'
import { expandLetterTableFlows, letterFlowFingerprint } from '../src/core/letterTableFlow.ts'
import { newLetterParagraph, validLetterObjects, type Letter, type LetterObject } from '../src/core/letters.ts'
import { createLetterLayout } from '../src/core/letterLayout.ts'

const base: Letter = { id: 'letter', subject: 'موضوع', recipient: 'جهة', reference: '1', date: '2024-06-01', salutation: '', closing: '', signer: '', position: '', identity: { name: 'شركة', logo: '', address: '', phone: '', email: '', website: '', commercialRegister: '' }, accent: '#123456', font: 'Arial', paragraphs: [newLetterParagraph('')], createdAt: '', updatedAt: '' }
const table: LetterObject = { id: 't', kind: 'table', autoFlow: true, box: { x: 20, y: 150, width: 120, page: 1 }, cells: [['عنوان', ''], ['أ', ''], ['دمج', ''], ['', '']], merges: [{ row: 0, column: 0, rows: 1, columns: 2 }, { row: 2, column: 0, rows: 2, columns: 1 }], cellFormats: { '2:0': { color: '#123456' } } }
const source: Letter = { ...base, layout: createLetterLayout(base, 'classic'), objects: [table, { id: 'flow_0_1', kind: 'table', box: { x: 20, y: 120, width: 50 }, cells: [['مستقل']] }] }

describe('التدفق المشتق للجدول', () => {
 it('يبقي الأصل دون تعديل، ويربط أجزاء العرض بصفوف المصدر ويتجنب تعارض المعرفات', () => {
   if (table.kind !== 'table') throw new Error('table')
   const result = expandLetterTableFlows(source, { t: { fingerprint: letterFlowFingerprint(source, table), plan: { groups: [{ pageOffset: 0, rows: [0, 1] }, { pageOffset: 1, rows: [0, 2, 3] }] } } })
   expect(result.problems).toEqual([]); expect(result.letter.layout?.pageCount).toBe(2)
   expect(source.objects).toHaveLength(2); expect(source.layout?.pageCount ?? 1).toBe(1)
   const parts = result.letter.objects!
   expect(parts).toHaveLength(3); expect(parts[1].id).toBe('flow_0_1_')
   expect(result.aliases[parts[1].id]).toEqual({ sourceId: 't', rows: [0, 2, 3] })
   expect(parts[1]).toMatchObject({ cells: [['عنوان', ''], ['دمج', ''], ['', '']], merges: [{ row: 0, column: 0, rows: 1, columns: 2 }, { row: 1, column: 0, rows: 2, columns: 1 }], cellFormats: { '1:0': { color: '#123456' } }, format: { stripeOffset: 1 } })
 })
 it('يرفض التصدير عند غياب القياس أو تقادمه أو تجاوز الصفحات دون تغيير الأصل', () => {
   if (table.kind !== 'table') throw new Error('table')
   expect(expandLetterTableFlows(source, {}).problems).not.toEqual([])
   expect(expandLetterTableFlows(source, { t: { fingerprint: 'old', plan: { groups: [{ pageOffset: 0, rows: [0, 1, 2, 3] }] } } }).problems).not.toEqual([])
   expect(expandLetterTableFlows(source, { t: { fingerprint: letterFlowFingerprint(source, table), plan: { groups: [{ pageOffset: 10, rows: [0, 1, 2, 3] }] } } }).problems).not.toEqual([])
   expect(source.objects?.[0]).toEqual(table)
 })
 it('يتحقق من خيار التدفق ويقبل الجداول القديمة ويرفض الجمع مع تكرار كامل الجدول', () => {
   expect(validLetterObjects([table], 1)).toBe(true)
   expect(validLetterObjects([{ ...table, box: { ...table.box, repeat: true } }], 1)).toBe(false)
   expect(validLetterObjects([{ ...table, autoFlow: 'yes' } as never], 1)).toBe(false)
   expect(validLetterObjects([{ ...table, autoFlow: undefined }], 1)).toBe(true)
   expect(validLetterObjects([{ ...table, merges: [], cells: Array.from({ length: 50 }, () => ['', '']) }], 1)).toBe(true)
   expect(validLetterObjects([{ ...table, merges: [], cells: Array.from({ length: 51 }, () => ['', '']) }], 1)).toBe(false)
 })
})
