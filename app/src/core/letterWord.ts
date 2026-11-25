import { AlignmentType, BorderStyle, Document, Footer, FrameAnchorType, FrameWrap, Header, HorizontalPositionRelativeFrom, ImageRun, Packer, Paragraph, SectionType, Table, TableAnchorType, TableCell, TableLayoutType, TableRow, TextRun, WidthType, TextWrappingType, VerticalPositionRelativeFrom } from 'docx'
import { letterTableCellAppearance, letterCellKey, letterMergeAt } from './letterTableStyles.ts'
import { rasterizeLetterBackground } from './letterBackgrounds.ts'
import { getLetterBoxes, isLetterItemVisible, letterLayoutItems } from './letterLayout.ts'
import { letterFieldStyle, validLetterImage, type Letter, type LetterAlignment, type LetterField, type LetterTextStyle } from './letters.ts'

const alignment: Record<LetterAlignment, typeof AlignmentType.RIGHT | typeof AlignmentType.LEFT | typeof AlignmentType.CENTER | typeof AlignmentType.JUSTIFIED> = {
  right: AlignmentType.RIGHT, left: AlignmentType.LEFT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED,
}

/** Word قابل للتحرير، ويحمل لقطة البيانات والتنسيق المستقل لكل حقل وفقرة. */
export async function createLetterWord(letter: Letter): Promise<Blob> {
  // مصدر التدفق وحده لا يحتوي مواضع أجزائه؛ لا تصدر نسخة قد تقص البيانات.
  if (letter.objects?.some(object => object.kind === 'table' && object.autoFlow)) throw new Error('يلزم قياس توزيع الجدول التلقائي من المعاينة قبل تصدير Word')
  const runs = (text: string, style: LetterTextStyle) => text.split('\n').map((line, i) => new TextRun({
    text: line, font: { ascii: style.font ?? letter.font, hAnsi: style.font ?? letter.font, cs: style.font ?? letter.font },
    size: style.size * 2, sizeComplexScript: style.size * 2, color: style.color.slice(1), bold: style.bold, boldComplexScript: style.bold,
    italics: style.italic, italicsComplexScript: style.italic, ...(style.underline ? { underline: {} } : {}), rightToLeft: true, ...(i ? { break: 1 } : {}),
  }))
  const paragraph = (text: string, style: LetterTextStyle) => new Paragraph({
    bidirectional: true, alignment: alignment[style.align], spacing: { after: 120, line: 360 }, children: runs(text, style),
  })
  const field = (key: LetterField, text: string) => paragraph(text, letterFieldStyle(letter, key))
  const details = letter.recipientDetails
  const logo = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(letter.identity.logo)
  const readMark = async (data: string | undefined) => {
    if (!data) return null
    if (!validLetterImage(data)) throw new Error('صورة التوقيع أو الختم غير صالحة')
    const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(data)!
    const img = new Image(); img.src = data; await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('تعذر قراءة أبعاد صورة التوقيع أو الختم')
    return { type: match[1] === 'png' ? 'png' as const : 'jpg' as const, bytes: Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)), width: img.naturalWidth, height: img.naturalHeight }
  }
  // يحافظ الشعار في تخطيط Word على نسبه كما يفعل object-fit:contain في المعاينة.
  const readLogo = async () => {
    if (!letter.layout || !isLetterItemVisible(letter, 'logo') || !logo) return null
    const img = new Image(); img.src = letter.identity.logo; await img.decode()
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('تعذر قراءة أبعاد الشعار')
    return { type: logo[1] === 'png' ? 'png' as const : 'jpg' as const, bytes: Uint8Array.from(atob(logo[2]), c => c.charCodeAt(0)), width: img.naturalWidth, height: img.naturalHeight }
  }
  const [signatureImage, stampImage, fittedLogo] = await Promise.all([readMark(letter.signatureImage), readMark(letter.stampImage), readLogo()])
  const marks = { signatureImage, stampImage }
  const objectImages = new Map(await Promise.all((letter.objects ?? []).filter(o => o.kind === 'image').map(async o => [o.id, await readMark(o.data)] as const)))
  const markRun = (mark: NonNullable<typeof signatureImage>, maxWidth: number, maxHeight: number) => {
    const scale = Math.min(maxWidth / mark.width, maxHeight / mark.height)
    return new ImageRun({ type: mark.type, data: mark.bytes, transformation: { width: Math.max(1, Math.round(mark.width * scale)), height: Math.max(1, Math.round(mark.height * scale)) } })
  }
  if (letter.layout) {
    const background = letter.layout.background
    const backgroundPng = background && background.source !== 'none' && background.opacity > 0 ? await rasterizeLetterBackground(background) : null
    const boxes = getLetterBoxes(letter)
    const twips = (mm: number) => Math.round(mm * 1440 / 25.4)
    const items = letterLayoutItems(letter)
    const sections = Array.from({ length: letter.layout.pageCount ?? 1 }, (_, index) => {
      const children = items.filter(item => isLetterItemVisible(letter, item.key) && ((boxes[item.key].page ?? 1) === index + 1 || boxes[item.key].repeat) && (item.rule || !!item.objectId || (item.logo ? !!logo : item.image ? !!marks[item.image] : !!item.text))).map(item => {
      const box = boxes[item.key]
      const object = item.objectId ? letter.objects?.find(o => o.id === item.objectId) : undefined
      if (object?.kind === 'table') {
        const tableStyle: LetterTextStyle = { align: object.format?.align ?? 'right', size: object.format?.fontSize ?? 12, color: '#202b3a', bold: false, italic: false, underline: false, font: letter.font }
        return new Table({
          width: { size: twips(box.width), type: WidthType.DXA },
          columnWidths: object.cells[0].map(() => Math.floor(twips(box.width) / object.cells[0].length)),
          layout: TableLayoutType.FIXED, visuallyRightToLeft: true,
          float: { horizontalAnchor: TableAnchorType.PAGE, verticalAnchor: TableAnchorType.PAGE, absoluteHorizontalPosition: twips(box.x), absoluteVerticalPosition: twips(box.y) },
          rows: object.cells.map((row, index) => new TableRow({ children: row.flatMap((cell, column) => {
            const merge = letterMergeAt(object.merges, index, column)
            if (merge && (merge.row !== index || merge.column !== column)) return []
            const custom = object.cellFormats?.[letterCellKey(index, column)]
            const appearance = letterTableCellAppearance(object.style, object.format, index)
            const border = { style: BorderStyle.SINGLE, size: appearance.border === 'FFFFFF' ? 0 : 6, color: appearance.border }
            return [new TableCell({ columnSpan: merge?.columns, rowSpan: merge?.rows, shading: { fill: custom?.background?.slice(1) ?? appearance.background }, borders: { top: border, bottom: border, left: border, right: border }, children: [new Paragraph({ bidirectional: true, alignment: alignment[custom?.align ?? tableStyle.align], spacing: { before: 0, after: 0 }, children: runs(cell, { ...tableStyle, align: custom?.align ?? tableStyle.align, size: custom?.fontSize ?? tableStyle.size, color: custom?.color ?? `#${appearance.color}`, bold: custom?.bold ?? appearance.bold }) })] })]
          }) })),
        })
      }
      const style: LetterTextStyle | undefined = item.key === 'footerBlock' ? { align: 'center', size: 9, color: '#435664', bold: false, italic: false, underline: false, font: letter.font } : item.paragraphId ? letter.paragraphs.find(p => p.id === item.paragraphId) : item.field ? letterFieldStyle(letter, item.field) : undefined
      const image = object?.kind === 'image' ? objectImages.get(object.id) : item.logo ? fittedLogo : item.image ? marks[item.image] : null
      const contents = image ? [markRun(image, box.width * 96 / 25.4, (box.height ?? 22) * 96 / 25.4)] : style ? runs(item.text, style) : []
      const imageHeight = image ? Math.min(box.height ?? 22, box.width * image.height / image.width) : 0
      const frameY = image ? box.y + ((box.height ?? 22) - imageHeight) / 2 : box.y
      return new Paragraph({
        bidirectional: true, alignment: style ? alignment[style.align] : AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: item.key === 'footerBlock' ? 300 : ((letter.layout?.contentVersion === 1 || letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4) && item.field && ((item.field.startsWith('header') && item.field !== 'headerRecipientName') || (item.field.startsWith('recipient') && item.field !== 'recipient') || (item.field.startsWith('identity') && item.field !== 'identityName'))) ? 288 : 384 },
        ...(item.rule ? { border: { bottom: { style: BorderStyle.SINGLE, size: letter.layout?.template === 'modern' && item.key === 'topRule' ? 18 : 6, color: letter.accent.slice(1) } } } : {}),
        frame: { type: 'absolute', position: { x: twips(box.x), y: twips(frameY) }, width: twips(box.width), anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE }, wrap: FrameWrap.NONE },
        children: contents,
      })
      })
      const headers = backgroundPng ? { default: new Header({ children: [new Paragraph({ children: [new ImageRun({ type: 'png', data: backgroundPng, transformation: { width: 794, height: 1123 }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, wrap: { type: TextWrappingType.NONE } } })] })] }) } : undefined
      return { properties: { type: SectionType.NEXT_PAGE, page: { size: { width: 11906, height: 16838 }, margin: { top: 0, right: 0, bottom: 0, left: 0 } } }, ...(headers ? { headers } : {}), children: [...children, new Paragraph({ spacing: { before: 0, after: 0, line: 20 }, children: [] })] }
    })
    return Packer.toBlob(new Document({ sections }))
  }
  const headerChildren = [
    ...(logo ? [new Paragraph({ alignment: AlignmentType.LEFT, children: [new ImageRun({ type: logo[1] === 'png' ? 'png' : 'jpg', data: Uint8Array.from(atob(logo[2]), c => c.charCodeAt(0)), transformation: { width: 72, height: 72 } })] })] : []),
    field('identityName', letter.identity.name),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: letter.accent.slice(1), space: 4 } } }),
  ]
  const identityFields: [LetterField, string][] = [
    ['identityAddress', letter.identity.address], ['identityPhone', letter.identity.phone], ['identityEmail', letter.identity.email],
    ['identityPoBox', letter.identity.poBox ? `ص.ب: ${letter.identity.poBox}` : ''], ['identityWebsite', letter.identity.website], ['identityCommercialRegister', letter.identity.commercialRegister ? `سجل تجاري: ${letter.identity.commercialRegister}` : ''],
    ['identityTaxNumber', letter.identity.taxNumber ? `الرقم الضريبي: ${letter.identity.taxNumber}` : ''],
  ]
  const detailFields: [LetterField, string][] = [
    ['recipientAddress', details?.address ? `العنوان: ${details.address}` : ''], ['recipientPhone', details?.phone ? `الهاتف: ${details.phone}` : ''],
    ['recipientEmail', details?.email ? `البريد: ${details.email}` : ''], ['recipientTaxNumber', details?.taxNumber ? `الرقم الضريبي: ${details.taxNumber}` : ''],
    ['recipientCommercialReg', details?.commercialReg ? `السجل التجاري: ${details.commercialReg}` : ''], ['recipientNationalId', details?.nationalId ? `الهوية: ${details.nationalId}` : ''],
    ['recipientContactPerson', details?.contactPerson ? `مسؤول التواصل: ${details.contactPerson}` : ''], ['recipientContactRole', details?.contactRole ? `صفة مسؤول التواصل: ${details.contactRole}` : ''],
    ['recipientContactPhone', details?.contactPhone ? `هاتف مسؤول التواصل: ${details.contactPhone}` : ''], ['recipientContactEmail', details?.contactEmail ? `بريد مسؤول التواصل: ${details.contactEmail}` : ''],
  ]
  const body = [
    field('reference', `الرقم: ${letter.reference || '................'}`), field('date', `التاريخ: ${letter.date}`),
    field('recipient', `إلى السادة / ${letter.recipient}`), ...detailFields.filter(([, text]) => text).map(([key, text]) => field(key, text)),
    field('subject', `الموضوع: ${letter.subject}`), field('salutation', letter.salutation),
    ...letter.paragraphs.map(p => paragraph(p.text, p)), field('closing', letter.closing),
    field('signer', `الاسم: ${letter.signer || '................................'}`), field('position', `المسمى الوظيفي: ${letter.position || '........................'}`),
    field('signature', letter.signatureText ?? 'التوقيع والختم: ........................'),
    ...[signatureImage, stampImage].filter((mark): mark is NonNullable<typeof signatureImage> => !!mark).map(mark => new Paragraph({ children: [markRun(mark, 150, 75)] })),
  ]
  return Packer.toBlob(new Document({ sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1700, right: 1134, bottom: 1300, left: 1134 } } },
    headers: { default: new Header({ children: headerChildren }) },
    footers: { default: new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 8, color: letter.accent.slice(1), space: 4 } } }), new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, children: identityFields.filter(([, text]) => text).flatMap(([key, text], index) => [...(index ? runs('   |   ', letterFieldStyle(letter, key)) : []), ...runs(text, letterFieldStyle(letter, key))]) })] }) },
    children: body,
  }] }))
}
