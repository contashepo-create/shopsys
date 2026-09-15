/**
 * مولّد باركود Code 128 (النمط B/C) — نواة خالصة بلا مكتبات (مراجعة نشاط السوبرماركت):
 * يعيد أنماط الأعمدة (عرض كل شريط) لطباعة ملصقات الأرفف والأصناف.
 * Code128C للأرقام الزوجية الطول (أكثف)، وB لغيرها.
 */

/** جدول أنماط Code128 — كل قيمة 6 أرقام: عروض أشرطة/فراغات متعاقبة */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const

const START_B = 104, START_C = 105, STOP = 106

/** ترميز نص إلى قائمة قيم Code128 (B أو C آلياً) — يرمي للنص الفارغ/محارف خارج ASCII المطبوع */
export function encode128(text: string): number[] {
  if (!text) throw new Error('نص الباركود فارغ')
  const digitsOnly = /^\d+$/.test(text) && text.length % 2 === 0
  const vals: number[] = []
  if (digitsOnly) {
    vals.push(START_C)
    for (let i = 0; i < text.length; i += 2) vals.push(Number(text.slice(i, i + 2)))
  } else {
    vals.push(START_B)
    for (const ch of text) {
      const code = ch.charCodeAt(0)
      if (code < 32 || code > 126) throw new Error(`محرف غير مدعوم في الباركود: «${ch}»`)
      vals.push(code - 32)
    }
  }
  // checksum
  let sum = vals[0]
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i
  vals.push(sum % 103)
  vals.push(STOP)
  return vals
}

/** SVG جاهز للطباعة — height بالبكسل، moduleWidth عرض الوحدة */
export function barcodeSvg(text: string, height = 40, moduleWidth = 2): string {
  const vals = encode128(text)
  let x = 0
  const rects: string[] = []
  for (const v of vals) {
    const pat = PATTERNS[v]
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]) * moduleWidth
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`)
      x += w
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x}" height="${height}" viewBox="0 0 ${x} ${height}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
