import { expect, it } from 'vitest'
import { createLetterLayout, getLetterBoxes, captureLetterTemplate, applySavedLetterTemplate, type LetterTemplate } from '../src/core/letterLayout.ts'
import { arrangeHeaderRows, letterColumnGap, letterRowSpacing, setLetterColumnGap, LETTER_COMPANY_DETAIL_KEYS, LETTER_RECIPIENT_DETAIL_KEYS } from '../src/core/letterHeaderSpacing.ts'
import { newLetterParagraph, type Letter } from '../src/core/letters.ts'
const letter: Letter = { id: 'h', subject: 'موضوع', recipient: 'الجهة', reference: 'ر', date: '2026-11-15', salutation: 'تحية', closing: 'ختام', signer: '', position: '', identity: { name: 'المنشأة', logo: '', address: 'الرياض', phone: '', email: 'mail@example.sa', website: '', commercialRegister: '' }, recipientDetails: { address: 'مكة', phone: '', email: 'client@example.sa', taxNumber: '', commercialReg: '', contactPerson: '' }, font: 'Arial', accent: '#123456', paragraphs: [newLetterParagraph('النص')], createdAt: '', updatedAt: '' }
it('يبعد العمودين ويغير المسافات دون تعديل بقية العناصر ويرفض القياسات الخارجة', () => {
 const layout = createLetterLayout(letter, 'classic'), boxes = getLetterBoxes({ ...letter, layout })
 expect(letterColumnGap(boxes)).toBe(25)
 const wide = setLetterColumnGap(boxes, 35)
 expect(letterColumnGap(wide)).toBe(35); expect(wide.headerRecipientName.width).toBe(boxes.headerRecipientName.width - 10)
 expect(wide.identityName).toEqual(boxes.identityName); expect(wide.topRule).toEqual(boxes.topRule)
 expect(() => setLetterColumnGap(boxes, 100)).toThrow(/لا تتسع/)
 const arranged = arrangeHeaderRows({ ...letter, layout }, boxes, LETTER_COMPANY_DETAIL_KEYS, 5)
 expect(arranged.headerEmail.y - arranged.headerAddress.y).toBe(5)
 expect(arranged.headerPhone.y).toBeGreaterThan(arranged.headerEmail.y)
 expect(arranged.subject).toEqual(boxes.subject); expect(letterRowSpacing(arranged, LETTER_COMPANY_DETAIL_KEYS)).toBe(5)
 expect(() => arrangeHeaderRows({ ...letter, layout }, boxes, LETTER_RECIPIENT_DETAIL_KEYS, 2)).toThrow(/3 و20/)
 const template = captureLetterTemplate({ ...letter, layout: { ...layout, boxes: arranged } }, 'تصميم', 's')
 expect(applySavedLetterTemplate(letter, template).boxes.headerEmail).toEqual(arranged.headerEmail)
})
it('يحافظ الإصدار السابق على مباعدته الافتراضية عند قراءة صندوق غير محفوظ', () => {
 const previous = getLetterBoxes({ ...letter, layout: { template: 'classic' as LetterTemplate, boxes: {}, contentVersion: 3 } })
 const current = getLetterBoxes({ ...letter, layout: createLetterLayout(letter, 'classic') })
 expect(letterColumnGap(previous)).toBe(10); expect(letterColumnGap(current)).toBe(25)
 expect(previous.topRule.y).toBe(68); expect(current.topRule.y).toBe(62)
})
