/** تقسيم فقرة بتقدير حي لارتفاعها، دون فقد حرف أو فصل العناقيد المركبة. */
export interface LetterTextPart { text: string; page: number; y: number }
export function distributeLetterText(
  text: string,
  startPage: number,
  startY: number,
  measure: (text: string) => number,
  pixelsPerMillimetre: number,
): LetterTextPart[] {
  if (!text || !Number.isInteger(startPage) || startPage < 1 || startPage > 10 || !Number.isFinite(startY) || startY < 0 || startY >= 297 || !Number.isFinite(pixelsPerMillimetre) || pixelsPerMillimetre <= 0) throw new Error('تعذر قياس الفقرة — تأكد من ظهور المعاينة')
  if (typeof Intl.Segmenter !== 'function') throw new Error('المتصفح لا يدعم تقسيم الحروف المركبة بأمان')
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const units = Array.from(segmenter.segment(text), part => part.segment)
  const measureChecked = (value: string) => {
    const height = measure(value)
    if (!Number.isFinite(height) || height <= 0) throw new Error('تعذر قياس الفقرة — تأكد من ظهور المعاينة')
    return height
  }
  const output: LetterTextPart[] = []
  let start = 0, page = startPage, y = startY
  while (start < units.length) {
    if (page > 10) throw new Error('النص يحتاج أكثر من 10 صفحات؛ لم يتغير الخطاب')
    const available = (260 - y) * pixelsPerMillimetre
    if (available <= 0 || measureChecked(units[start]) > available) {
      if (y === 55) throw new Error('لا يمكن احتواء سطر واحد في الصفحة؛ راجع حجم الخط')
      page++; y = 55; continue
    }
    let low = start + 1, high = units.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (measureChecked(units.slice(start, mid).join('')) <= available) low = mid
      else high = mid - 1
    }
    let end = low
    // لا نقطع كلمة إن وُجد فاصل قريب، لكن لا نضيع مسافات أو أسطر النص الأصلي.
    if (end < units.length) {
      let boundary = end
      while (boundary > start && !/\s/u.test(units[boundary - 1])) boundary--
      if (boundary > start) end = boundary
    }
    output.push({ text: units.slice(start, end).join(''), page, y })
    start = end; page++; y = 55
  }
  return output
}
