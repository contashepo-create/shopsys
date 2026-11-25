import { LETTER_FIELDS, newLetterParagraph, validLetterImage, validLetterObjects, type Letter, type LetterObject, type LetterField, type LetterTextStyle } from './letters.ts'

/** القياسات بالملليمتر من أعلى يسار ورقة A4. الفقرات تحتفظ بمعرّفها عند التعديل. */
export type LetterTemplate = 'classic' | 'modern' | 'minimal' | 'executive' | 'heritage' | 'geometric' | 'navy' | 'ribbon' | 'arch' | 'diagonal' | 'laurel'
export type LetterBackgroundSource = 'none' | 'formal' | 'corporate' | 'heritage' | 'minimal' | 'geometry' | 'navy' | 'ribbon' | 'arch' | 'diagonal' | 'laurel' | 'custom'
export interface LetterBackground { source: LetterBackgroundSource; opacity: number; data?: string }
export interface LetterBox { x: number; y: number; width: number; height?: number; page?: number; repeat?: boolean }
export interface LetterLayout { template: LetterTemplate; boxes: Record<string, LetterBox>; pageCount?: number; background?: LetterBackground; contentVersion?: 1 | 2 | 3 | 4; hiddenHeader?: string[] }
export const LETTER_TEMPLATES: Record<LetterTemplate, string> = { classic: 'رسمي كلاسيكي', modern: 'حديث', minimal: 'بسيط', executive: 'مؤسسي تنفيذي', heritage: 'تراثي فاخر', geometric: 'هندسي رسمي', navy: 'كحلي إداري', ribbon: 'شريط مميز', arch: 'قوس رصين', diagonal: 'أعمال معاصر', laurel: 'إكليل راقٍ' }
export const LETTER_PAGE_WIDTH = 210
export const LETTER_PAGE_HEIGHT = 297
export const letterObjectKey = (id: string) => `object:${id}`
export const letterParagraphKey = (id: string) => `paragraph:${id}`
export const letterBoxLabel = (key: string, letter: Letter): string => {
  if (key.startsWith('object:')) { const objects = letter.objects ?? []; const index = objects.findIndex(o => letterObjectKey(o.id) === key); const item = objects[index]; return item ? `${item.kind === 'image' ? 'صورة' : 'جدول'} ${index + 1}` : 'عنصر مضاف' }
  if (key === 'topRule') return 'خط الترويسة'
  if (key === 'bottomRule') return 'خط التذييل'
  if (key === 'footerBlock') return 'تذييل المنشأة الثابت'
  if (key === 'logo') return 'شعار المنشأة'
  if (key === 'signatureImage') return 'صورة التوقيع'
  if (key === 'stampImage') return 'صورة الختم'
  if (key === 'signature') return 'التوقيع والختم'
  if (key.startsWith('paragraph:')) return `فقرة ${Math.max(1, letter.paragraphs.findIndex(p => letterParagraphKey(p.id) === key) + 1)}`
  return LETTER_FIELDS[key as LetterField] ?? key
}
function legacyLetterBoxes(letter: Letter, template: LetterTemplate): Record<string, LetterBox> {
  const boxes: Record<string, LetterBox> = {
    topRule: { x: 15, y: 40, width: 180 }, bottomRule: { x: 15, y: 270, width: 180 },
    logo: { x: 15, y: 13, width: 25, height: 22 }, identityName: { x: 90, y: 16, width: 105 },
    reference: { x: 120, y: 46, width: 75 }, date: { x: 15, y: 46, width: 70 },
    recipient: { x: 15, y: 61, width: 180 }, subject: { x: 15, y: 79, width: 180 },
    salutation: { x: 15, y: 95, width: 180 }, closing: { x: 15, y: 210, width: 180 },
    signer: { x: 110, y: 226, width: 85 }, position: { x: 110, y: 237, width: 85 }, signature: { x: 110, y: 248, width: 85 },
    identityAddress: { x: 151, y: 275, width: 44 }, identityPhone: { x: 106, y: 275, width: 43 }, identityEmail: { x: 56, y: 275, width: 48 }, identityPoBox: { x: 15, y: 275, width: 39 },
    identityWebsite: { x: 112, y: 285, width: 83 }, identityCommercialRegister: { x: 65, y: 285, width: 45 }, identityTaxNumber: { x: 15, y: 285, width: 48 },
  }
  // البيانات الإضافية موجودة كعناصر مستقلة ويمكن إظهارها وتحريكها بعد تعبئتها.
  const extra: LetterField[] = ['recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail']
  extra.forEach((key, index) => { boxes[key] = { x: index % 2 ? 15 : 110, y: 69 + Math.floor(index / 2) * 8, width: 85 } })
  letter.paragraphs.forEach((p, index) => { boxes[letterParagraphKey(p.id)] = { x: 15, y: Math.min(190, 110 + index * 24), width: 180 } })
  if (template === 'modern') { boxes.logo = { x: 170, y: 12, width: 25, height: 22 }; boxes.identityName = { x: 15, y: 15, width: 140 }; boxes.reference = { x: 15, y: 47, width: 75 }; boxes.date = { x: 120, y: 47, width: 75 } }
  if (template === 'minimal') { boxes.topRule = { x: 15, y: 47, width: 180 }; boxes.logo = { x: 92, y: 10, width: 26, height: 22 }; boxes.identityName = { x: 35, y: 34, width: 140 }; boxes.reference = { x: 120, y: 55, width: 75 }; boxes.date = { x: 15, y: 55, width: 75 }; boxes.recipient = { x: 15, y: 69, width: 180 }; boxes.subject = { x: 15, y: 85, width: 180 }; boxes.salutation = { x: 15, y: 99, width: 180 }; letter.paragraphs.forEach((p, i) => { boxes[letterParagraphKey(p.id)] = { x: 15, y: Math.min(190, 114 + i * 24), width: 180 } }) }
  if (template === 'executive') { boxes.logo = { x: 18, y: 15, width: 27, height: 24 }; boxes.identityName = { x: 70, y: 19, width: 110 }; boxes.topRule = { x: 18, y: 44, width: 164 }; boxes.reference = { x: 108, y: 50, width: 74 }; boxes.date = { x: 18, y: 50, width: 70 }; boxes.recipient = { x: 18, y: 66, width: 164 }; boxes.subject = { x: 18, y: 83, width: 164 }; boxes.salutation = { x: 18, y: 98, width: 164 }; letter.paragraphs.forEach((p, i) => { boxes[letterParagraphKey(p.id)] = { x: 18, y: Math.min(190, 114 + i * 24), width: 164 } }) }
  if (template === 'heritage') { boxes.logo = { x: 92, y: 10, width: 26, height: 22 }; boxes.identityName = { x: 45, y: 34, width: 120 }; boxes.topRule = { x: 27, y: 50, width: 156 }; boxes.reference = { x: 107, y: 56, width: 76 }; boxes.date = { x: 27, y: 56, width: 65 }; boxes.recipient = { x: 27, y: 70, width: 156 }; boxes.subject = { x: 27, y: 86, width: 156 }; boxes.salutation = { x: 27, y: 100, width: 156 }; letter.paragraphs.forEach((p, i) => { boxes[letterParagraphKey(p.id)] = { x: 27, y: Math.min(190, 116 + i * 24), width: 156 } }) }
  if (template === 'geometric') { boxes.logo = { x: 20, y: 16, width: 28, height: 24 }; boxes.identityName = { x: 82, y: 19, width: 108 }; boxes.topRule = { x: 20, y: 45, width: 170 }; boxes.reference = { x: 112, y: 51, width: 78 }; boxes.date = { x: 20, y: 51, width: 72 }; boxes.recipient = { x: 20, y: 66, width: 170 }; boxes.subject = { x: 20, y: 82, width: 170 }; boxes.salutation = { x: 20, y: 97, width: 170 }; letter.paragraphs.forEach((p, i) => { boxes[letterParagraphKey(p.id)] = { x: 20, y: Math.min(190, 113 + i * 24), width: 170 } }) }
  return boxes
}
/** الترويسة تقابل فيها بيانات المستلم هوية المنشأة، والتذييل في صفين. */
function versionOneLetterBoxes(letter: Letter, template: LetterTemplate): Record<string, LetterBox> {
  const configs: Record<LetterTemplate, { margin: number; logoSide: 'left' | 'right'; headerY: number }> = {
    classic: { margin: 15, logoSide: 'right', headerY: 10 }, modern: { margin: 18, logoSide: 'left', headerY: 10 },
    minimal: { margin: 16, logoSide: 'right', headerY: 12 }, executive: { margin: 20, logoSide: 'left', headerY: 11 },
    heritage: { margin: 24, logoSide: 'right', headerY: 12 }, geometric: { margin: 19, logoSide: 'left', headerY: 12 },
    navy: { margin: 17, logoSide: 'right', headerY: 11 }, ribbon: { margin: 21, logoSide: 'left', headerY: 12 },
    arch: { margin: 23, logoSide: 'right', headerY: 13 }, diagonal: { margin: 20, logoSide: 'left', headerY: 10 },
    laurel: { margin: 22, logoSide: 'right', headerY: 12 },
  }
  const { margin: m, logoSide, headerY: y } = configs[template] ?? configs.classic
  const right = 210 - m, center = 105, leftWidth = center - m - 5, rightStart = center + 5, rightWidth = right - rightStart
  const boxes: Record<string, LetterBox> = {
    logo: { x: logoSide === 'right' ? right - 23 : rightStart, y, width: 23, height: 19 },
    identityName: { x: logoSide === 'right' ? rightStart : rightStart + 27, y: y + 1, width: rightWidth - 27 },
    recipient: { x: m, y, width: leftWidth },
    topRule: { x: m, y: 76, width: 210 - 2 * m },
    reference: { x: center + 5, y: 80, width: rightWidth }, date: { x: m, y: 80, width: leftWidth },
    subject: { x: m, y: 90, width: 210 - 2 * m }, salutation: { x: m, y: 101, width: 210 - 2 * m },
    closing: { x: m, y: 208, width: 210 - 2 * m }, signer: { x: 112, y: 220, width: right - 112 },
    position: { x: 112, y: 230, width: right - 112 }, signature: { x: 112, y: 240, width: right - 112 },
    signatureImage: { x: 68, y: 231, width: 35, height: 17 }, stampImage: { x: m, y: 229, width: 30, height: 20 },
    bottomRule: { x: m, y: 269, width: 210 - 2 * m },
    identityAddress: { x: 146, y: 273, width: 49 }, identityPhone: { x: 105, y: 273, width: 38 }, identityEmail: { x: 55, y: 273, width: 47 }, identityPoBox: { x: 15, y: 273, width: 37 },
    identityWebsite: { x: 114, y: 285, width: 81 }, identityCommercialRegister: { x: 65, y: 285, width: 46 }, identityTaxNumber: { x: 15, y: 285, width: 47 },
  }
  const recipient: LetterField[] = ['recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail']
  recipient.forEach((key, index) => { boxes[key] = { x: m, y: y + 7 + index * 4.9, width: leftWidth } })
  const company: LetterField[] = ['headerAddress', 'headerPhone', 'headerEmail', 'headerPoBox', 'headerWebsite', 'headerCommercialRegister', 'headerTaxNumber']
  company.forEach((key, index) => { boxes[key] = { x: rightStart, y: y + 21 + index * 5.3, width: rightWidth } })
  letter.paragraphs.forEach((p, i) => { boxes[letterParagraphKey(p.id)] = { x: m, y: Math.min(190, 113 + i * 24), width: 210 - 2 * m } })
  return boxes
}
/** الإصدار الثاني يبقى متاحاً للخطابات والقوالب المحفوظة بمباعدتها الأصلية. */
function versionTwoLetterBoxes(letter: Letter, template: LetterTemplate): Record<string, LetterBox> {
  const boxes = versionOneLetterBoxes(letter, template)
  const { x: m, width: leftWidth, y } = boxes.recipient
  const right = boxes.topRule.x + boxes.topRule.width, start = m + 67
  boxes.headerRecipientName = { x: m, y, width: leftWidth }
  boxes.reference = { x: m, y: 80, width: 58 }
  boxes.date = { x: m, y: 86, width: 58 }
  boxes.subject = { x: start, y: 80, width: right - start }
  boxes.recipient = { x: start, y: 90, width: right - start }
  boxes.salutation = { x: start, y: 101, width: right - start }
  boxes.bottomRule = { x: 15, y: 269, width: 180, repeat: true }
  boxes.footerBlock = { x: 15, y: 272, width: 180, repeat: true }
  return boxes
}
/** ترويسة متراصة: بيانات الطرفين أعلى الخط، وتذييل ثابت. */
function versionThreeLetterBoxes(letter: Letter, template: LetterTemplate): Record<string, LetterBox> {
  const boxes = versionTwoLetterBoxes(letter, template)
  const { x: m, width: leftWidth, y } = boxes.headerRecipientName
  const right = boxes.topRule.x + boxes.topRule.width, start = m + 67
  const company: LetterField[] = ['headerAddress', 'headerPhone', 'headerEmail', 'headerPoBox', 'headerWebsite', 'headerCommercialRegister', 'headerTaxNumber']
  company.forEach((key, index) => { boxes[key] = { x: boxes.identityName.x, y: y + 9 + index * 4.4, width: boxes.identityName.width } })
  const recipient: LetterField[] = ['recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail']
  recipient.forEach((key, index) => { boxes[key] = { x: m, y: y + 7 + index * 4.4, width: leftWidth } })
  boxes.topRule = { ...boxes.topRule, y: 68 }
  boxes.reference = { x: m, y: 72, width: 58 }
  boxes.date = { x: m, y: 78, width: 58 }
  boxes.subject = { x: start, y: 72, width: right - start }
  boxes.recipient = { x: start, y: 82, width: right - start }
  boxes.salutation = { x: start, y: 93, width: right - start }
  letter.paragraphs.forEach((p, index) => { boxes[letterParagraphKey(p.id)] = { x: m, y: Math.min(190, 105 + index * 24), width: 210 - 2 * m } })
  return boxes
}
/** توسيع الفراغ بين عمودي المنشأة والجهة في القوالب الجديدة. */
export function defaultLetterBoxes(letter: Letter, template: LetterTemplate): Record<string, LetterBox> {
  const boxes = versionThreeLetterBoxes(letter, template)
  // ينتهي عمود الجهة قبل عمود المنشأة بمسافة واضحة؛ يبقى قابلاً للتعديل.
  for (const key of LETTER_RECIPIENT_HEADER_KEYS) boxes[key] = { ...boxes[key], width: boxes[key].width - 15 }
  for (const [index, key] of LETTER_COMPANY_DETAIL_KEYS.entries()) boxes[key] = { ...boxes[key], y: boxes.headerAddress.y + index * 4.2 }
  for (const [index, key] of LETTER_RECIPIENT_DETAIL_KEYS.entries()) boxes[key] = { ...boxes[key], y: boxes.recipientAddress.y + index * 4.2 }
  const ruleY = boxes.headerRecipientName.y + 52, shift = ruleY - boxes.topRule.y
  boxes.topRule = { ...boxes.topRule, y: ruleY }
  for (const key of ['reference', 'date', 'subject', 'recipient', 'salutation']) boxes[key] = { ...boxes[key], y: boxes[key].y + shift }
  letter.paragraphs.forEach(p => { const key = letterParagraphKey(p.id); boxes[key] = { ...boxes[key], y: boxes[key].y + shift } })
  return boxes
}
export const LETTER_COMPANY_DETAIL_KEYS = ['headerAddress', 'headerPhone', 'headerEmail', 'headerPoBox', 'headerWebsite', 'headerCommercialRegister', 'headerTaxNumber'] as const
export const LETTER_RECIPIENT_DETAIL_KEYS = ['recipientAddress', 'recipientPhone', 'recipientEmail', 'recipientTaxNumber', 'recipientCommercialReg', 'recipientNationalId', 'recipientContactPerson', 'recipientContactRole', 'recipientContactPhone', 'recipientContactEmail'] as const
export const LETTER_RECIPIENT_HEADER_KEYS = ['headerRecipientName', ...LETTER_RECIPIENT_DETAIL_KEYS] as const
export const LETTER_HEADER_KEYS = ['logo', 'identityName', ...LETTER_COMPANY_DETAIL_KEYS, ...LETTER_RECIPIENT_HEADER_KEYS, 'topRule'] as const
export function letterHeaderKeys(letter: Letter): readonly string[] {
  const version = letter.layout?.contentVersion
  if (version === 2 || version === 3 || version === 4) return LETTER_HEADER_KEYS
  if (version === 1) return ['logo', 'identityName', ...LETTER_COMPANY_DETAIL_KEYS, 'recipient', ...LETTER_RECIPIENT_DETAIL_KEYS, 'topRule']
  return ['logo', 'identityName', 'topRule']
}
export function isLetterItemVisible(letter: Letter, key: string): boolean {
  return !letter.layout?.hiddenHeader?.includes(key)
}
export function isFixedLetterBox(letter: Letter, key: string): boolean {
  return (letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4) && (key === 'bottomRule' || key === 'footerBlock')
}
/** أسطر مستقلة قابلة للالتفاف؛ لا تُحذف أي بيانات إذا طالت. */
export function letterFooterText(letter: Letter): string {
  const i = letter.identity
  const address = i.address ? `العنوان: ${i.address}` : ''
  const contact = [i.phone && `هاتف: ${i.phone}`, i.email && `البريد: ${i.email}`, i.poBox && `ص.ب: ${i.poBox}`, i.website && `الموقع: ${i.website}`].filter(Boolean).join('   |   ')
  const registration = [i.commercialRegister && `السجل التجاري: ${i.commercialRegister}`, i.taxNumber && `الرقم الضريبي: ${i.taxNumber}`].filter(Boolean).join('   |   ')
  return [address, contact, registration].filter(Boolean).join('\n')
}
export function createLetterLayout(letter: Letter, template: LetterTemplate): LetterLayout {
  const source: LetterBackgroundSource = template === 'modern' || template === 'executive' ? 'corporate' : template === 'minimal' ? 'minimal' : template === 'heritage' ? 'heritage' : template === 'geometric' ? 'geometry' : ['navy', 'ribbon', 'arch', 'diagonal', 'laurel'].includes(template) ? template as LetterBackgroundSource : 'none'
  return { template, boxes: defaultLetterBoxes(letter, template), contentVersion: 4, hiddenHeader: ['identityName'], background: { source, opacity: source === 'none' ? 0 : 55 } }
}
export function validLetterBackground(background: LetterBackground | undefined): boolean {
  if (background === undefined) return true
  if (!background || !['none', 'formal', 'corporate', 'heritage', 'minimal', 'geometry', 'navy', 'ribbon', 'arch', 'diagonal', 'laurel', 'custom'].includes(background.source) || !Number.isInteger(background.opacity) || background.opacity < 0 || background.opacity > 100) return false
  return background.source === 'custom' ? typeof background.data === 'string' && background.data.length <= 1_500_000 && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(background.data) : background.data === undefined
}
export function getLetterBoxes(letter: Letter): Record<string, LetterBox> {
  const layout = letter.layout
  const defaults = layout?.contentVersion === 4 ? defaultLetterBoxes(letter, layout.template) : layout?.contentVersion === 3 ? versionThreeLetterBoxes(letter, layout.template) : layout?.contentVersion === 2 ? versionTwoLetterBoxes(letter, layout.template) : layout?.contentVersion === 1 ? versionOneLetterBoxes(letter, layout.template) : legacyLetterBoxes(letter, layout?.template ?? 'classic')
  const result: Record<string, LetterBox> = { ...defaults, signatureImage: defaults.signatureImage ?? { x: 65, y: 230, width: 35, height: 17 }, stampImage: defaults.stampImage ?? { x: 15, y: 228, width: 30, height: 20 }, ...layout?.boxes }
  if (layout?.contentVersion === 2 || layout?.contentVersion === 3 || layout?.contentVersion === 4) { result.bottomRule = defaults.bottomRule; result.footerBlock = defaults.footerBlock }
  for (const object of letter.objects ?? []) result[letterObjectKey(object.id)] = object.box
  return result
}
export function validLetterLayout(layout: LetterLayout, letter: Letter): boolean {
  if (!layout || !Object.hasOwn(LETTER_TEMPLATES, layout.template) || !layout.boxes || typeof layout.boxes !== 'object' || Array.isArray(layout.boxes)) return false
  if (!validLetterBackground(layout.background) || (layout.contentVersion !== undefined && layout.contentVersion !== 1 && layout.contentVersion !== 2 && layout.contentVersion !== 3 && layout.contentVersion !== 4)) return false
  const hiddenKeys = new Set<string>([...Object.keys(LETTER_FIELDS), 'logo', 'signatureImage', 'stampImage', 'topRule', 'bottomRule', 'footerBlock'])
  if (layout.hiddenHeader !== undefined && (!Array.isArray(layout.hiddenHeader) || layout.hiddenHeader.some(key => typeof key !== 'string' || !hiddenKeys.has(key)) || new Set(layout.hiddenHeader).size !== layout.hiddenHeader.length)) return false
  const pageCount = layout.pageCount ?? 1
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 10) return false
  const keys = new Set([...Object.keys(LETTER_FIELDS), 'logo', 'signatureImage', 'stampImage', 'signature', 'topRule', 'bottomRule', 'footerBlock', ...letter.paragraphs.map(p => letterParagraphKey(p.id))])
  return Object.entries(layout.boxes).every(([key, box]) => keys.has(key) && box && Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && box.x >= 0 && box.y >= 0 && box.width >= 5 && box.x + box.width <= 210 && box.y < 297 && (box.page === undefined || Number.isInteger(box.page) && box.page >= 1 && box.page <= pageCount) && (box.repeat === undefined || typeof box.repeat === 'boolean') && (box.height === undefined || Number.isFinite(box.height) && box.height >= 5 && box.y + box.height <= 297))
}

export interface LetterLayoutItem { key: string; text: string; field?: LetterField; paragraphId?: string; logo?: boolean; image?: 'signatureImage' | 'stampImage'; rule?: boolean; fixed?: boolean; objectId?: string }
export function letterLayoutItems(letter: Letter): LetterLayoutItem[] {
  const d = letter.recipientDetails, i = letter.identity
  const field = (key: LetterField, text: string): LetterLayoutItem => ({ key, field: key, text })
  return [
    { key: 'topRule', text: '', rule: true }, { key: 'bottomRule', text: '', rule: true, fixed: letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4 }, { key: 'logo', text: '', logo: true }, field('identityName', i.name),
    ...(letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4 ? [field('headerRecipientName', letter.recipient)] : []),
    ...(letter.layout?.contentVersion === 1 || letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4 ? [field('headerAddress', i.address ? `العنوان: ${i.address}` : ''), field('headerPhone', i.phone ? `الهاتف: ${i.phone}` : ''), field('headerEmail', i.email ? `البريد: ${i.email}` : ''), field('headerPoBox', i.poBox ? `ص.ب: ${i.poBox}` : ''), field('headerWebsite', i.website ? `الموقع: ${i.website}` : ''), field('headerCommercialRegister', i.commercialRegister ? `السجل التجاري: ${i.commercialRegister}` : ''), field('headerTaxNumber', i.taxNumber ? `الرقم الضريبي: ${i.taxNumber}` : '')] : []),
    field('reference', `الرقم: ${letter.reference || '................'}`), field('date', `التاريخ: ${letter.date}`),
    field('recipient', `إلى السادة / ${letter.recipient || '................................'}`),
    field('recipientAddress', d?.address ? `العنوان: ${d.address}` : ''), field('recipientPhone', d?.phone ? `الهاتف: ${d.phone}` : ''),
    field('recipientEmail', d?.email ? `البريد: ${d.email}` : ''), field('recipientTaxNumber', d?.taxNumber ? `الرقم الضريبي: ${d.taxNumber}` : ''),
    field('recipientCommercialReg', d?.commercialReg ? `السجل التجاري: ${d.commercialReg}` : ''), field('recipientNationalId', d?.nationalId ? `الهوية: ${d.nationalId}` : ''),
    field('recipientContactPerson', d?.contactPerson ? `مسؤول التواصل: ${d.contactPerson}` : ''), field('recipientContactRole', d?.contactRole ? `صفة مسؤول التواصل: ${d.contactRole}` : ''),
    field('recipientContactPhone', d?.contactPhone ? `هاتف مسؤول التواصل: ${d.contactPhone}` : ''), field('recipientContactEmail', d?.contactEmail ? `بريد مسؤول التواصل: ${d.contactEmail}` : ''),
    field('subject', `الموضوع: ${letter.subject || 'موضوع الخطاب'}`), field('salutation', letter.salutation),
    ...letter.paragraphs.map(p => ({ key: letterParagraphKey(p.id), text: p.text, paragraphId: p.id })),
    ...(letter.objects ?? []).map(o => ({ key: letterObjectKey(o.id), objectId: o.id, text: '' })),
    field('closing', letter.closing), field('signer', `الاسم: ${letter.signer || '................................'}`), field('position', `المسمى الوظيفي: ${letter.position || '........................'}`),
    { key: 'signatureImage', text: '', image: 'signatureImage' }, { key: 'stampImage', text: '', image: 'stampImage' },
    field('signature', letter.signatureText ?? 'التوقيع والختم: ........................'),
    ...(letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4 ? [{ key: 'footerBlock', text: letterFooterText(letter), fixed: true }] : [
      field('identityAddress', i.address), field('identityPhone', i.phone), field('identityEmail', i.email), field('identityPoBox', i.poBox ? `ص.ب: ${i.poBox}` : ''),
      field('identityWebsite', i.website), field('identityCommercialRegister', i.commercialRegister ? `سجل تجاري: ${i.commercialRegister}` : ''), field('identityTaxNumber', i.taxNumber ? `الرقم الضريبي: ${i.taxNumber}` : ''),
    ]),
  ]
}

/** قالب قابل لإعادة الاستخدام دون نسخ نصوص الخطاب أو بيانات المستلم. */
export interface SavedLetterTemplate {
  id: string
  branchId?: number
  name: string
  template: LetterTemplate
  boxes: Record<string, LetterBox>
  paragraphs: LetterBox[]
  pageCount: number
  background?: LetterBackground
  contentVersion?: 1 | 2 | 3 | 4
  hiddenHeader?: string[]
  identity?: Letter['identity']
  formatting?: { font: Letter['font']; accent: string; fieldStyles: Partial<Record<LetterField, LetterTextStyle>>; paragraphs: LetterTextStyle[] }
  content?: { paragraphs: string[]; salutation: string; closing: string; signer: string; position: string; signatureText?: string; signatureImage: string; stampImage: string; objects?: LetterObject[] }
}
export function captureLetterTemplate(letter: Letter, name: string, id: string, includeFormatting = true, includeContent = false, includeIdentity = false): SavedLetterTemplate {
  if (!letter.layout) throw new Error('اختر قالباً قبل حفظ التصميم')
  const all = getLetterBoxes(letter)
  const boxes = Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith('paragraph:') && !key.startsWith('object:')))
  return { id, name: name.trim(), template: letter.layout.template, boxes, paragraphs: letter.paragraphs.map(p => all[letterParagraphKey(p.id)]), pageCount: letter.layout.pageCount ?? 1, background: letter.layout.background, contentVersion: letter.layout.contentVersion, hiddenHeader: letter.layout.hiddenHeader ? [...letter.layout.hiddenHeader] : undefined, ...(includeIdentity ? { identity: structuredClone(letter.identity) } : {}), ...(includeContent ? { content: { paragraphs: letter.paragraphs.map(p => p.text), salutation: letter.salutation, closing: letter.closing, signer: letter.signer, position: letter.position, signatureText: letter.signatureText, signatureImage: letter.signatureImage ?? '', stampImage: letter.stampImage ?? '', objects: structuredClone(letter.objects ?? []) } } : {}), ...(includeFormatting ? { formatting: { font: letter.font, accent: letter.accent, fieldStyles: structuredClone(letter.fieldStyles ?? {}), paragraphs: letter.paragraphs.map(({ align, size, color, bold, italic, underline, font }) => ({ align, size, color, bold, italic, underline, font })) } } : {}) }
}
export function applySavedLetterTemplate(letter: Letter, template: SavedLetterTemplate): LetterLayout {
  const defaults = template.contentVersion === 4 ? defaultLetterBoxes(letter, template.template) : template.contentVersion === 3 ? versionThreeLetterBoxes(letter, template.template) : template.contentVersion === 2 ? versionTwoLetterBoxes(letter, template.template) : template.contentVersion === 1 ? versionOneLetterBoxes(letter, template.template) : legacyLetterBoxes(letter, template.template)
  const boxes: Record<string, LetterBox> = { ...defaults, ...template.boxes }
  letter.paragraphs.forEach((paragraph, index) => { if (template.paragraphs[index]) boxes[letterParagraphKey(paragraph.id)] = { ...template.paragraphs[index] } })
  return { template: template.template, boxes, pageCount: template.pageCount, background: template.background ? { ...template.background } : undefined, contentVersion: template.contentVersion, hiddenHeader: template.hiddenHeader ? [...template.hiddenHeader] : undefined }
}
/** يطبق التنسيق وحده، دون نقل بيانات الجهة أو نص الفقرة أو صور التوقيع. */
export function applyLetterTemplateFormatting(letter: Letter, template: SavedLetterTemplate): Letter {
  const format = template.formatting
  if (!format) return letter
  return { ...letter, font: format.font, accent: format.accent, fieldStyles: structuredClone(format.fieldStyles), paragraphs: letter.paragraphs.map((paragraph, index) => ({ ...paragraph, ...(format.paragraphs[index] ?? {}) })) }
}
/** النصوص والصور تحفظ فقط إذا اختار المستخدم تضمينها صراحةً. */
export function applyLetterTemplateContent(letter: Letter, template: SavedLetterTemplate): Letter {
  const content = template.content
  if (!content) return letter
  return { ...letter, salutation: content.salutation, closing: content.closing, signer: content.signer, position: content.position, signatureText: content.signatureText, signatureImage: content.signatureImage, stampImage: content.stampImage, ...(content.objects !== undefined ? { objects: structuredClone(content.objects) } : {}), paragraphs: letter.paragraphs.map((p, index) => ({ ...p, text: content.paragraphs[index] ?? p.text })) }
}
/** تطبيق واحد للمحفوظ يضمن إنشاء خانات كل الفقرات قبل ربط مواقعها. */
export function applyCompleteLetterTemplate(letter: Letter, template: SavedLetterTemplate): Letter {
  const sourceObjects = template.content?.objects ?? letter.objects
  const objects = sourceObjects?.map(o => ({ ...structuredClone(o), box: { ...o.box, page: Math.min(o.box.page ?? 1, template.pageCount) } }))
  const value = { ...letter, ...(objects ? { objects } : {}), paragraphs: [...letter.paragraphs] }
  while (value.paragraphs.length < template.paragraphs.length) value.paragraphs.push(newLetterParagraph())
  const layout = applySavedLetterTemplate(value, template)
  const formatted = applyLetterTemplateContent(applyLetterTemplateFormatting({ ...value, layout }, template), template)
  return template.identity ? { ...formatted, identity: structuredClone(template.identity) } : formatted
}
function validTemplateStyle(style: LetterTextStyle, font: Letter['font']): boolean {
  return !!style && /^#[0-9a-f]{6}$/i.test(style.color) && Number.isInteger(style.size) && style.size >= 9 && style.size <= 36 && ['right', 'center', 'left', 'justify'].includes(style.align) && ['Arial', 'Tahoma', 'Georgia'].includes(style.font ?? font) && [style.bold, style.italic, style.underline].every(value => typeof value === 'boolean') && Object.keys(style).every(key => ['align', 'size', 'color', 'bold', 'italic', 'underline', 'font'].includes(key))
}
export function validSavedLetterTemplate(template: SavedLetterTemplate): boolean {
  if (!template || typeof template.id !== 'string' || !template.id.trim() || template.id.length > 100 || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80 || !Array.isArray(template.paragraphs) || template.paragraphs.length > 100 || !template.boxes || typeof template.boxes !== 'object' || Array.isArray(template.boxes) || Object.keys(template.boxes).some(key => key.startsWith('paragraph:'))) return false
  const identity = template.identity
  if (identity !== undefined) {
    if (!identity || typeof identity !== 'object' || Array.isArray(identity) || Object.keys(identity).some(key => !['name', 'logo', 'address', 'phone', 'email', 'website', 'commercialRegister', 'taxNumber', 'poBox'].includes(key))) return false
    if ([identity.name, identity.address, identity.phone, identity.email, identity.website, identity.commercialRegister].some(value => typeof value !== 'string' || value.length > 2000)) return false
    if ([identity.taxNumber, identity.poBox].some(value => value !== undefined && (typeof value !== 'string' || value.length > 2000))) return false
    if (typeof identity.logo !== 'string' || (identity.logo !== '' && (identity.logo.length >= 2_000_000 || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(identity.logo)))) return false
  }
  const content = template.content
  if (content !== undefined && (!content || !Array.isArray(content.paragraphs) || content.paragraphs.length !== template.paragraphs.length || content.paragraphs.some(text => typeof text !== 'string' || text.length > 15000) || [content.salutation, content.closing, content.signer, content.position].some(text => typeof text !== 'string' || text.length > 2000) || (content.signatureText !== undefined && (typeof content.signatureText !== 'string' || content.signatureText.length > 2000)) || [content.signatureImage, content.stampImage].some(image => typeof image !== 'string' || (image !== '' && !validLetterImage(image))))) return false
  if (content?.objects !== undefined && !validLetterObjects(content.objects, template.pageCount)) return false
  const format = template.formatting
  if (format !== undefined && (!format || !['Arial', 'Tahoma', 'Georgia'].includes(format.font) || !/^#[0-9a-f]{6}$/i.test(format.accent) || !format.fieldStyles || typeof format.fieldStyles !== 'object' || Array.isArray(format.fieldStyles) || Object.entries(format.fieldStyles).some(([key, style]) => !Object.hasOwn(LETTER_FIELDS, key) || !validTemplateStyle(style as LetterTextStyle, format.font)) || !Array.isArray(format.paragraphs) || format.paragraphs.length > 100 || format.paragraphs.some(style => !validTemplateStyle(style, format.font)))) return false
  const paragraphs = template.paragraphs.map((_, index) => ({ id: String(index) }))
  const letter = { paragraphs } as Letter
  const boxes = { ...template.boxes, ...Object.fromEntries(template.paragraphs.map((box, index) => [letterParagraphKey(String(index)), box])) }
  return validLetterLayout({ template: template.template, boxes, pageCount: template.pageCount, background: template.background, contentVersion: template.contentVersion, hiddenHeader: template.hiddenHeader }, letter)
}
