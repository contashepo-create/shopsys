import { LETTER_COMPANY_DETAIL_KEYS, LETTER_RECIPIENT_DETAIL_KEYS, LETTER_RECIPIENT_HEADER_KEYS, isLetterItemVisible, letterLayoutItems, type LetterBox } from './letterLayout.ts'
import type { Letter } from './letters.ts'

type BoxMap = Record<string, LetterBox>
export function letterColumnGap(boxes: BoxMap): number {
  const companyLeft = Math.min(boxes.identityName.x, ...LETTER_COMPANY_DETAIL_KEYS.map(key => boxes[key].x))
  const recipientRight = Math.max(...LETTER_RECIPIENT_HEADER_KEYS.map(key => boxes[key].x + boxes[key].width))
  return Math.round((companyLeft - recipientRight) * 10) / 10
}
export function letterRowSpacing(boxes: BoxMap, keys: readonly string[]): number {
  const y = keys.map(key => boxes[key].y).sort((a, b) => a - b)
  const differences = y.slice(1).map((value, i) => value - y[i]).filter(value => value > 0.05)
  return Math.round((differences.length ? Math.min(...differences) : 4.2) * 10) / 10
}
/** لا يغير صفحات الحقول ولا يضبط بقية عناصر الخطاب؛ يرص الظاهرة قبل الفارغة. */
export function arrangeHeaderRows(letter: Letter, boxes: BoxMap, keys: readonly string[], spacing: number): BoxMap {
  if (!Number.isFinite(spacing) || spacing < 3 || spacing > 20) throw new Error('اختر تباعداً بين 3 و20 مم')
  const filled = new Set(letterLayoutItems(letter).filter(item => item.text && isLetterItemVisible(letter, item.key)).map(item => item.key))
  const ordered = [...keys.filter(key => filled.has(key)), ...keys.filter(key => !filled.has(key))]
  const first = Math.min(...keys.map(key => boxes[key].y))
  if (first + (keys.length - 1) * spacing >= 297) throw new Error('لا تتسع الصفحة لهذا التباعد')
  const result = { ...boxes }
  ordered.forEach((key, index) => { result[key] = { ...boxes[key], y: Math.round((first + index * spacing) * 10) / 10 } })
  return result
}
/** تغيّر حدود عمود الجهة اليسرى فقط؛ لا يحرّك منشأة المرسل أو الشعار. */
export function setLetterColumnGap(boxes: BoxMap, gap: number): BoxMap {
  if (!Number.isFinite(gap) || gap < 0 || gap > 100) throw new Error('اختر مسافة بين 0 و100 مم')
  const delta = letterColumnGap(boxes) - gap
  const next = { ...boxes }
  for (const key of LETTER_RECIPIENT_HEADER_KEYS) {
    const box = boxes[key], width = Math.round((box.width + delta) * 10) / 10
    if (width < 5 || box.x + width > 210) throw new Error('المسافة المطلوبة لا تتسع داخل الصفحة؛ حرّك أو وسّع عمود الجهة أولاً')
    next[key] = { ...box, width }
  }
  return next
}
export { LETTER_COMPANY_DETAIL_KEYS, LETTER_RECIPIENT_DETAIL_KEYS, LETTER_RECIPIENT_HEADER_KEYS }
