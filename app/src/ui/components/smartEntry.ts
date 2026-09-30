/**
 * الإدخال الذكي بسطر واحد (الموجة ① من خطة UX — لا يمسّ تقسيم الفاتورة):
 * «أرز*3@65-5%» ⇒ بحث «أرز» بكمية ٣ وسعر ٦٥ وخصم ٥٪.
 * يقبل × أو * للكمية، @ للسعر، -N% للخصم، بأي ترتيب.
 */
export type SmartEntry = { term: string; qty?: number; price?: number; discount?: number }
export function parseSmartEntry(raw: string): SmartEntry {
  let text = String(raw ?? '')
  const take = (pattern: RegExp): number | undefined => {
    const match = text.match(pattern)
    if (!match) return undefined
    text = text.replace(match[0], ' ')
    const value = Number(match[1].replace(',', '.'))
    return Number.isFinite(value) ? value : undefined
  }
  const discount = take(/[-−]\s*(\d+(?:[.,]\d+)?)\s*%/)
  const price = take(/@\s*(\d+(?:[.,]\d+)?)/)
  const qty = take(/[*×xX]\s*(\d+(?:[.,]\d+)?)/)
  const term = text.replace(/\s+/g, ' ').trim()
  const entry: SmartEntry = { term }
  if (qty !== undefined && qty > 0) entry.qty = qty
  if (price !== undefined && price >= 0) entry.price = price
  if (discount !== undefined && discount >= 0) entry.discount = Math.min(100, discount)
  return entry
}
