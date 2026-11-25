import { describe, expect, it } from 'vitest'
import { planLetterTablePages } from '../src/core/letterTablePagination.ts'

describe('تقسيم جدول بين الصفحات', () => {
 it('يحتفظ بالصفوف المتصلة بدمج متداخل في صفحة واحدة مع تكرار الترويسة', () => {
   const plan = planLetterTablePages([10, 30, 40, 30, 30, 30], [
     { row: 1, column: 0, rows: 2, columns: 1 },
     { row: 2, column: 1, rows: 2, columns: 1 },
   ], 110, 150, true)
   expect(plan).toEqual({ groups: [{ pageOffset: 0, rows: [0, 1, 2, 3] }, { pageOffset: 1, rows: [0, 4, 5] }] })
 })
 it('ينقل الجدول بأكمله إلى الصفحة التالية إذا لم تتسع صفوفه الأولى', () => {
   expect(planLetterTablePages([20, 50, 50], [], 40, 150, true)).toEqual({ groups: [{ pageOffset: 1, rows: [0, 1, 2] }] })
 })
 it('لا يقسم المجموعة المدمجة ولو لم تتسع ويرفض تكرار عنوان مدمج مع بيانات', () => {
   expect(planLetterTablePages([20, 80, 80], [{ row: 1, column: 0, rows: 2, columns: 1 }], 100, 150, true)).toEqual({ error: 'too-tall' })
   expect(planLetterTablePages([20, 20], [{ row: 0, column: 0, rows: 2, columns: 1 }], 10, 100, true)).toEqual({ error: 'header-merge' })
   expect(planLetterTablePages([20, 20], [{ row: 0, column: 0, rows: 2, columns: 1 }], 10, 100, false)).toEqual({ groups: [{ pageOffset: 1, rows: [0, 1] }] })
 })
 it('يرفض القياسات غير السليمة ولا يسقط الصف الوحيد أو المجموعة الأخيرة', () => {
   expect(planLetterTablePages([0, 0], [], 100, 100, false)).toEqual({ error: 'measurement' })
   expect(planLetterTablePages([20, 0], [{ row: 0, column: 0, rows: 2, columns: 1 }], 30, 100, false)).toEqual({ groups: [{ pageOffset: 0, rows: [0, 1] }] })
   expect(planLetterTablePages([20], [], 10, 100, true)).toEqual({ groups: [{ pageOffset: 1, rows: [0] }] })
   expect(planLetterTablePages([20, 50, 50], [], 70, 70, false)).toEqual({ groups: [{ pageOffset: 0, rows: [0, 1] }, { pageOffset: 1, rows: [2] }] })
 })
})
