import { afterEach, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createLetterLayout } from '../src/core/letterLayout.ts'
import { newLetterParagraph, type Letter } from '../src/core/letters.ts'
import { createLetterWord } from '../src/core/letterWord.ts'
import { readLetterBackgroundFile } from '../src/core/letterBackgrounds.ts'

const raster = vi.hoisted(() => vi.fn(async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])))
vi.mock('../src/core/letterBackgrounds.ts', async importOriginal => {
 const actual = await importOriginal<typeof import('../src/core/letterBackgrounds.ts')>()
 return { ...actual, rasterizeLetterBackground: raster }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); raster.mockClear() })
const letter: Letter = { id: 'id', subject: 'الموضوع', recipient: 'جهة', date: '2026-11-01', reference: 'ر', salutation: 'تحية', closing: 'ختام', signer: 'محمد', position: 'مدير', identity: { name: 'منشأة', logo: '', address: '', phone: '', email: '', website: '', commercialRegister: '' }, font: 'Arial', accent: '#123456', paragraphs: [newLetterParagraph('النص الأصلي')], createdAt: '', updatedAt: '' }

it('يضيف صورة خلف النص لكل صفحة Word ويبقي النص قابلاً للتحرير', async () => {
 const layout = createLetterLayout(letter, 'heritage'); layout.pageCount = 2; layout.background = { source: 'formal', opacity: 38 }
 const blob = await createLetterWord({ ...letter, layout })
 const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const zip = unzipSync(new Uint8Array(bytes))
 expect(raster).toHaveBeenCalledWith({ source: 'formal', opacity: 38 })
 expect(strFromU8(zip['word/document.xml'])).toContain('النص الأصلي')
 for (const file of ['word/header1.xml', 'word/header2.xml']) {
  const header = strFromU8(zip[file]); expect(header).toContain('behindDoc="1"'); expect(header).toContain('relativeFrom="page"')
 }
 expect(Object.keys(zip).some(name => name.startsWith('word/media/') && name.endsWith('.png'))).toBe(true)
})

it('يرفض ملفات خلفية غير مدعومة أو ضخمة أو تالفة', async () => {
 await expect(readLetterBackgroundFile(new File(['x'], 'file.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/PNG/)
 await expect(readLetterBackgroundFile(new File([new Uint8Array(1_000_001)], 'large.png', { type: 'image/png' }))).rejects.toThrow(/ميغابايت/)
 await expect(readLetterBackgroundFile(new File(['not an image'], 'bad.png', { type: 'image/png' }))).rejects.toThrow(/غير صالح/)
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 5000; naturalHeight = 1; async decode() {} })
 await expect(readLetterBackgroundFile(new File([Uint8Array.from([137,80,78,71,13,10,26,10,1])], 'wide.png', { type: 'image/png' }))).rejects.toThrow(/أبعاد/)
})

it('يضع صورتي التوقيع والختم في Word بإطارين مستقلين مع النص القابل للتحرير', async () => {
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 100; naturalHeight = 50; async decode() {} })
 const image = 'data:image/png;base64,iVBORw0KGgoB'
 const layout = createLetterLayout(letter, 'classic'); layout.boxes.signatureImage = { x: 60, y: 220, width: 40, height: 20 }
 const blob = await createLetterWord({ ...letter, layout, signatureImage: image, stampImage: image })
 const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const zip = unzipSync(new Uint8Array(bytes)), xml = strFromU8(zip['word/document.xml'])
 expect(xml).toContain('النص الأصلي'); expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(2)
 expect(xml).toContain('w:x="3402"'); expect(Object.keys(zip).some(name => name.startsWith('word/media/'))).toBe(true)
 await expect(createLetterWord({ ...letter, layout, stampImage: 'https://invalid.example' })).rejects.toThrow(/غير صالحة/)
})

it('يصدر الترويسة الجديدة والتذييل الثابت كنص في كل صفحة Word', async () => {
 const layout = createLetterLayout(letter, 'classic'); layout.pageCount = 2
 const value = { ...letter, identity: { ...letter.identity, address: 'الرياض', phone: '0555', taxNumber: '300123', commercialRegister: '101123' }, layout }
 const blob = await createLetterWord(value)
 const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
 expect((xml.match(/الرقم الضريبي: 300123/g) ?? []).length).toBe(3)
 expect((xml.match(/السجل التجاري: 101123/g) ?? []).length).toBe(3)
 expect(xml).toContain('إلى السادة / جهة'); expect(xml).toContain('الموضوع: الموضوع')
 expect(xml).toContain(`w:x="${Math.round(15 * 1440 / 25.4)}" w:y="${Math.round(272 * 1440 / 25.4)}"`)
})

it('يطبق إخفاء عناصر الترويسة في Word دون حذف بيانات التذييل أو الخطاب', async () => {
 const layout = createLetterLayout(letter, 'classic')
 layout.hiddenHeader = ['identityName', 'headerRecipientName', 'recipientPhone', 'topRule']
 const value = { ...letter, recipientDetails: { address: '', phone: '099999', email: '', taxNumber: '', commercialReg: '', contactPerson: '' }, identity: { ...letter.identity, address: 'الرياض' }, layout }
 const blob = await createLetterWord(value)
 const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
 expect(xml).not.toContain('منشأة'); expect(xml).not.toContain('099999'); expect(xml).toContain('إلى السادة / جهة'); expect(xml).toContain('الرياض')
})

it('يحفظ نسب الشعار ويضع الصور وسط صناديقها في Word دون تحميل شعار مخفي', async () => {
 const decode = vi.fn(async () => {})
 vi.stubGlobal('Image', class { src = ''; naturalWidth = 200; naturalHeight = 100; decode = decode })
 const image = 'data:image/png;base64,iVBORw0KGgoB'
 const layout = createLetterLayout(letter, 'classic')
 layout.boxes.logo = { x: 20, y: 10, width: 40, height: 40 }
 layout.boxes.signatureImage = { x: 60, y: 220, width: 40, height: 40 }
 const value = { ...letter, identity: { ...letter.identity, logo: image }, signatureImage: image, layout }
 const blob = await createLetterWord(value)
 const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob) })
 const xml = strFromU8(unzipSync(new Uint8Array(bytes))['word/document.xml'])
 // صورة 2:1 في صندوق مربع: العرض 40 مم والارتفاع 20 مم، والإطار يبدأ بعد 10 مم.
 expect(xml).toContain(`w:x="${Math.round(20 * 1440 / 25.4)}" w:y="${Math.round(20 * 1440 / 25.4)}"`)
 expect(xml).toContain(`w:x="${Math.round(60 * 1440 / 25.4)}" w:y="${Math.round(230 * 1440 / 25.4)}"`)
 const sizes = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(m => Number(m[1]) / Number(m[2]))
 expect(sizes).toHaveLength(2); sizes.forEach(ratio => expect(ratio).toBeCloseTo(2, 1))
 decode.mockClear()
 await createLetterWord({ ...value, signatureImage: '', layout: { ...layout, hiddenHeader: ['logo'] } })
 expect(decode).not.toHaveBeenCalled()
})
