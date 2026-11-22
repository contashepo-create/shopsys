import formal from '../assets/letter-backgrounds/formal.png?inline'
import corporate from '../assets/letter-backgrounds/corporate.png?inline'
import heritage from '../assets/letter-backgrounds/heritage.png?inline'
import minimal from '../assets/letter-backgrounds/minimal.png?inline'
import geometry from '../assets/letter-backgrounds/geometry.png?inline'
import navy from '../assets/letter-backgrounds/navy.png?inline'
import ribbon from '../assets/letter-backgrounds/ribbon.png?inline'
import arch from '../assets/letter-backgrounds/arch.png?inline'
import diagonal from '../assets/letter-backgrounds/diagonal.png?inline'
import laurel from '../assets/letter-backgrounds/laurel.png?inline'
import { validLetterBackground, type LetterBackground, type LetterBackgroundSource } from './letterLayout.ts'

export const LETTER_BACKGROUNDS: Record<Exclude<LetterBackgroundSource, 'custom'>, string> = {
  none: 'بلا خلفية', formal: 'إطار رسمي', corporate: 'شرائط مؤسسية', heritage: 'زخرفة تراثية', minimal: 'هادئة بسيطة', geometry: 'زخرفة هندسية', navy: 'كحلي إداري', ribbon: 'شريط مميز', arch: 'قوس رصين', diagonal: 'أعمال معاصر', laurel: 'إكليل راقٍ',
}
const images: Record<Exclude<LetterBackgroundSource, 'none' | 'custom'>, string> = { formal, corporate, heritage, minimal, geometry, navy, ribbon, arch, diagonal, laurel }
export function letterBackgroundUrl(background?: LetterBackground): string {
  if (!background || !validLetterBackground(background) || background.source === 'none') return ''
  return background.source === 'custom' ? background.data! : images[background.source]
}
/** يحوّل الخلفية مع درجة ظهورها إلى PNG شفاف لاستخدامها خلف نص Word. */
export async function rasterizeLetterBackground(background: LetterBackground): Promise<Uint8Array> {
  const url = letterBackgroundUrl(background)
  if (!url) throw new Error('الخلفية غير صالحة')
  const img = new Image()
  img.src = url
  await img.decode()
  const canvas = document.createElement('canvas'); canvas.width = 794; canvas.height = 1123
  const context = canvas.getContext('2d')
  if (!context) throw new Error('تعذر تجهيز خلفية Word')
  context.globalAlpha = background.opacity / 100
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  const data = canvas.toDataURL('image/png').split(',')[1]
  return Uint8Array.from(atob(data), c => c.charCodeAt(0))
}

/** الصور محلية فقط؛ لا تُحمّل SVG أو روابط ولا تُقبل الصور الضخمة. */
export async function readLetterBackgroundFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size === 0 || file.size > 1_000_000) throw new Error('اختر صورة PNG أو JPEG بحجم لا يتجاوز 1 ميغابايت')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('تعذرت قراءة الصورة'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذرت قراءة الصورة'))
    reader.readAsDataURL(file)
  })
  if (!(file.type === 'image/png' ? data.startsWith('data:image/png;base64,iVBORw0KGgo') : data.startsWith('data:image/jpeg;base64,/9j/'))) throw new Error('ملف الصورة غير صالح')
  const image = new Image(); image.src = data
  try { await image.decode() } catch { throw new Error('تعذر فتح الصورة؛ اختر ملف صورة صالحاً') }
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('أبعاد الصورة تتجاوز 4096 بكسل أو غير صالحة')
  return data
}
