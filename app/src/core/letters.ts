import { validLetterLayout, type LetterBox, type LetterLayout } from './letterLayout.ts'
import { isValidFiscalDate } from './fiscal.ts'
import { LETTER_TABLE_STYLES, validLetterTableFormat, validLetterTableDetails, type LetterCellFormat, type LetterCellMerge, type LetterTableFormat, type LetterTableStyle } from './letterTableStyles.ts'

export type LetterAlignment = 'right' | 'center' | 'left' | 'justify'
export type LetterFont = 'Arial' | 'Tahoma' | 'Georgia'
export interface LetterTextStyle { align: LetterAlignment; size: number; color: string; bold: boolean; italic: boolean; underline: boolean; font?: LetterFont }
export interface LetterParagraph extends LetterTextStyle { id: string; text: string }
export const LETTER_FIELDS = {
  headerRecipientName: 'اسم الجهة في الترويسة', recipient: 'اسم المستلم', recipientAddress: 'عنوان المستلم', recipientPhone: 'هاتف المستلم', recipientEmail: 'بريد المستلم', recipientTaxNumber: 'الرقم الضريبي للمستلم', recipientCommercialReg: 'سجل المستلم التجاري', recipientContactPerson: 'مسؤول التواصل لدى المستلم', recipientNationalId: 'هوية المستلم', recipientContactRole: 'صفة مسؤول التواصل', recipientContactPhone: 'هاتف مسؤول التواصل', recipientContactEmail: 'بريد مسؤول التواصل',
  subject: 'الموضوع', reference: 'رقم الخطاب', date: 'التاريخ', salutation: 'التحية', closing: 'الختام', signature: 'التوقيع والختم', signer: 'اسم الموقّع', position: 'المسمى الوظيفي',
  headerAddress: 'عنوان المنشأة في الترويسة', headerPhone: 'هاتف المنشأة في الترويسة', headerEmail: 'بريد المنشأة في الترويسة', headerPoBox: 'صندوق بريد المنشأة في الترويسة', headerWebsite: 'موقع المنشأة في الترويسة', headerCommercialRegister: 'سجل المنشأة في الترويسة', headerTaxNumber: 'الرقم الضريبي للمنشأة في الترويسة',
  identityPoBox: 'صندوق بريد المنشأة', identityName: 'اسم المنشأة', identityAddress: 'عنوان المنشأة', identityPhone: 'هاتف المنشأة', identityEmail: 'بريد المنشأة', identityWebsite: 'موقع المنشأة', identityCommercialRegister: 'سجل المنشأة التجاري', identityTaxNumber: 'الرقم الضريبي للمنشأة',
} as const
export type LetterField = keyof typeof LETTER_FIELDS
export interface LetterRecipientDetails { address: string; phone: string; email: string; taxNumber: string; commercialReg: string; contactPerson: string; nationalId?: string; contactRole?: string; contactPhone?: string; contactEmail?: string }
export const emptyLetterRecipientDetails = (): LetterRecipientDetails => ({ address: '', phone: '', email: '', taxNumber: '', commercialReg: '', contactPerson: '' })
export function letterFieldStyle(letter: Letter, field: LetterField): LetterTextStyle {
  const modern = letter.layout?.contentVersion === 1 || letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4
  const compact = modern && ((field.startsWith('header') && field !== 'headerRecipientName') || (field.startsWith('recipient') && field !== 'recipient') || (field.startsWith('identity') && field !== 'identityName'))
  const base: LetterTextStyle = { align: field.startsWith('identity') && field !== 'identityName' ? 'center' : 'right', size: compact ? 9 : field === 'headerRecipientName' ? 11 : field === 'identityName' ? (modern ? 14 : 20) : field === 'subject' ? ((letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4) ? 13 : 16) : field === 'recipient' && modern ? 11 : ((letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4) && (field === 'reference' || field === 'date')) ? 10 : 12, color: field === 'identityName' || field === 'subject' ? letter.accent : '#202b3a', bold: field === 'identityName' || field === 'headerRecipientName' || field === 'subject' || field === 'recipient', italic: false, underline: false, font: letter.font }
  return { ...base, ...letter.fieldStyles?.[field] }
}
export interface LetterIdentity { name: string; logo: string; address: string; phone: string; email: string; website: string; commercialRegister: string; taxNumber?: string; poBox?: string }
export const LETTER_STATUSES = { draft: 'مسودة', ready: 'جاهز ولم يُرسل', sent: 'مرسل', replied: 'تم الرد', closed: 'مغلق' } as const
export type LetterStatus = keyof typeof LETTER_STATUSES
/** عناصر مستقلة عن حقول الخطاب؛ إحداثياتها بالملليمتر داخل الصفحة. */
export type LetterObject = { id: string; box: LetterBox } & ({ kind: 'image'; data: string } | { kind: 'table'; cells: string[][]; style?: LetterTableStyle; format?: LetterTableFormat; cellFormats?: Record<string, LetterCellFormat>; merges?: LetterCellMerge[]; autoFlow?: boolean })
export function validLetterObjects(objects: LetterObject[] | undefined, pageCount: number): boolean {
  if (objects === undefined) return true
  if (!Array.isArray(objects) || objects.length > 20 || new Set(objects.map(o => o?.id)).size !== objects.length) return false
  let imageBytes = 0
  return objects.every(o => {
    if (!o || typeof o.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(o.id) || !o.box || typeof o.box !== 'object') return false
    const b = o.box
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || b.x < 0 || b.y < 0 || b.width < 5 || b.x + b.width > 210 || b.y >= 297 || (b.page !== undefined && (!Number.isInteger(b.page) || b.page < 1 || b.page > pageCount)) || (b.repeat !== undefined && typeof b.repeat !== 'boolean')) return false
    if (o.kind === 'image') {
      imageBytes += typeof o.data === 'string' ? o.data.length : 0
      return validLetterImage(o.data) && imageBytes <= 4_500_000 && Number.isFinite(b.height) && b.height! >= 5 && b.y + b.height! <= 297
    }
    if (o.kind === 'table') return (o.autoFlow === undefined || typeof o.autoFlow === 'boolean') && (!o.autoFlow || !b.repeat) && (o.style === undefined || Object.hasOwn(LETTER_TABLE_STYLES, o.style)) && validLetterTableFormat(o.format) && b.height === undefined && Array.isArray(o.cells) && o.cells.length >= 1 && o.cells.length <= 50 && Array.isArray(o.cells[0]) && o.cells[0].length >= 1 && o.cells[0].length <= 6 && o.cells.every(row => Array.isArray(row) && row.length === o.cells[0].length && row.every(cell => typeof cell === 'string' && cell.length <= 500)) && validLetterTableDetails(o.cells, o.cellFormats, o.merges)
    return false
  })
}
export interface Letter {
  id: string
  branchId?: number
  subject: string
  status?: LetterStatus
  recipient: string
  customerId?: number | null
  recipientDetails?: LetterRecipientDetails
  fieldStyles?: Partial<Record<LetterField, LetterTextStyle>>
  layout?: LetterLayout
  objects?: LetterObject[]
  reference: string
  date: string
  salutation: string
  closing: string
  signer: string
  position: string
  signatureText?: string
  signatureImage?: string
  stampImage?: string
  identity: LetterIdentity
  accent: string
  font: 'Arial' | 'Tahoma' | 'Georgia'
  paragraphs: LetterParagraph[]
  createdAt: string
  updatedAt: string
}
export function newLetterParagraph(text = ''): LetterParagraph {
  return { id: crypto.randomUUID(), text, align: 'right', size: 14, color: '#202b3a', bold: false, italic: false, underline: false }
}
export function validateLetter(letter: Letter): string[] {
  const errors: string[] = []
  if (letter.status !== undefined && !Object.hasOwn(LETTER_STATUSES, letter.status)) errors.push('حالة الخطاب غير صالحة')
  if (!letter.subject.trim()) errors.push('موضوع الخطاب مطلوب')
  if (!letter.recipient.trim()) errors.push('الجهة الموجه إليها مطلوبة')
  if (!isValidFiscalDate(letter.date)) errors.push('تاريخ الخطاب غير صالح')
  if (!letter.paragraphs.length || !letter.paragraphs.some(p => p.text.trim())) errors.push('اكتب نص الخطاب')
  if (letter.paragraphs.length > 100 || letter.paragraphs.some(p => p.text.length > 15000)) errors.push('نص الخطاب طويل جداً')
  if (!/^#[0-9a-f]{6}$/i.test(letter.accent) || letter.paragraphs.some(p => !/^#[0-9a-f]{6}$/i.test(p.color) || !Number.isInteger(p.size) || p.size < 9 || p.size > 36 || !['right', 'center', 'left', 'justify'].includes(p.align))) errors.push('تنسيق الخطاب غير صالح')
  if (!['Arial', 'Tahoma', 'Georgia'].includes(letter.font) || letter.paragraphs.some(p => p.font != null && !['Arial', 'Tahoma', 'Georgia'].includes(p.font))) errors.push('نوع الخط غير صالح')
  if (letter.customerId != null && (!Number.isSafeInteger(letter.customerId) || letter.customerId <= 0)) errors.push('العميل المختار غير صالح')
  if (letter.recipientDetails && Object.values(letter.recipientDetails).some(v => typeof v !== 'string' || v.length > 2000)) errors.push('بيانات المستلم غير صالحة')
  if (letter.fieldStyles && Object.entries(letter.fieldStyles).some(([key, style]) => !Object.hasOwn(LETTER_FIELDS, key) || !style || !/^#[0-9a-f]{6}$/i.test(style.color) || !Number.isInteger(style.size) || style.size < 9 || style.size > 36 || !['right', 'center', 'left', 'justify'].includes(style.align) || !['Arial', 'Tahoma', 'Georgia'].includes(style.font ?? letter.font) || [style.bold, style.italic, style.underline].some(v => typeof v !== 'boolean'))) errors.push('تنسيق الحقل غير صالح')
  if ([letter.signatureImage, letter.stampImage].some(image => image != null && image !== '' && !validLetterImage(image))) errors.push('صورة التوقيع أو الختم غير صالحة')
  if (!validLetterObjects(letter.objects, letter.layout?.pageCount ?? 1) || (!letter.layout && (letter.objects?.length ?? 0) > 0)) errors.push('الصور أو الجداول غير صالحة')
  if (letter.layout && !validLetterLayout(letter.layout, letter)) errors.push('تخطيط الخطاب غير صالح')
  return errors
}
/** صور محلية PNG/JPEG فقط؛ لا تقبل الروابط أو SVG. */
export function validLetterImage(image: string): boolean {
  return typeof image === 'string' && image.length <= 1_500_000 && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
}

export function letterFilename(subject: string): string {
  return ([...subject.trim()].map(char => char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '-' : char).join('').slice(0, 80) || 'خطاب')
}

/** تسلسل سنوي خاص بالخطابات، والرقم المقترح غير محجوز حتى الحفظ. */
export const LETTER_NUMBER_PREFIX = 'LT'
export function parseAutomaticLetterReference(reference: string): { year: string; sequence: number } | null {
  const match = /^LT-(\d{4})-(\d{1,9})$/i.exec(reference.trim())
  if (!match) return null
  const sequence = Number(match[2])
  return Number.isSafeInteger(sequence) && sequence > 0 ? { year: match[1], sequence } : null
}
export function nextLetterReference(date: string, references: readonly string[], lastIssued = 0): string {
  if (!isValidFiscalDate(date)) throw new Error('اختر تاريخاً صالحاً لاقتراح رقم الخطاب')
  if (!Number.isSafeInteger(lastIssued) || lastIssued < 0 || lastIssued >= 999999999) throw new Error('عداد أرقام الخطابات غير صالح أو تجاوز الحد — يلزم مراجعته')
  const year = date.slice(0, 4)
  const maximum = references.reduce((highest, reference) => {
    const parsed = parseAutomaticLetterReference(reference)
    return parsed?.year === year ? Math.max(highest, parsed.sequence) : highest
  }, lastIssued)
  if (maximum >= 999999999) throw new Error('تجاوز تسلسل أرقام الخطابات الحد المسموح')
  return `${LETTER_NUMBER_PREFIX}-${year}-${String(maximum + 1).padStart(4, '0')}`
}
