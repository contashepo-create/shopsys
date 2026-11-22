import { expect, it } from 'vitest'
import { distributeLetterText } from '../src/core/letterPagination.ts'

it('يوزع النص مع حفظ كل الحروف والفواصل دون قطع العنقود المركب', () => {
 const text = 'مرحبا بالعالم\n\nأهلاً بِكُم 👩‍👩‍👧‍👦 في عالم الرسائل والتجربة الطويلة. '
 const parts = distributeLetterText(text.repeat(12), 1, 240, s => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length * 2, 1)
 expect(parts.map(p => p.text).join('')).toBe(text.repeat(12))
 expect(parts.length).toBeGreaterThan(1)
 expect(parts.map(p => p.page)).toEqual(parts.map((_, i) => i + 1))
 for (const p of parts) { expect(p.text).not.toMatch(/^\p{M}/u); expect(p.text).not.toMatch(/\u200d$/u) }
})
it('ينقل الفقرة بالكامل للصفحة التالية إن لم يتسع أول سطر', () => {
 const parts = distributeLetterText('رسالة مهمة', 1, 259, s => s.length * 2, 1)
 expect(parts).toEqual([{ text: 'رسالة مهمة', page: 2, y: 55 }])
})
it('يرفض التوزيع فوق الحد أو القياس غير المتاح بدلاً من فقد النص', () => {
 expect(() => distributeLetterText('نص طويل جداً', 10, 259, () => 5, 1)).toThrow(/10 صفحات/)
 expect(() => distributeLetterText('نص', 1, 110, () => 0, 1)).toThrow(/قياس/)
 expect(() => distributeLetterText('نص', 1, 55, () => 300, 1)).toThrow(/سطر واحد/)
})
