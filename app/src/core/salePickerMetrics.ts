/** متوسط أسعار البنود المسجلة موزون بالكمية الأساسية، قبل الخصومات والمرتجعات. */
export function recordedAverageSalePrice(itemId: number, sales: readonly { projectBilling?: string | null; lines: readonly { itemId: number; qty: number; unitPriceMinor: number; unitFactor?: number }[] }[]): number | null {
  let total = 0, qty = 0
  for (const sale of sales) {
    if (sale.projectBilling === 'documentation') continue
    for (const line of sale.lines) {
      if (line.itemId !== itemId || !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) continue
      const factor = line.unitFactor ?? 1
      if (!Number.isFinite(factor) || factor <= 0) continue
      total += line.qty * line.unitPriceMinor
      qty += line.qty * factor
    }
  }
  const result = Math.round(total / qty)
  return qty > 0 && Number.isSafeInteger(result) ? result : null
}

/** آخر شراء بحسب تاريخ المستند لا ترتيب تخزينه، بسعر الشراء قبل المصروفات. */
export function latestPurchasePrice(itemId: number, purchases: readonly { id: number; date: string; lines: readonly { itemId: number; unitPriceMinor: number }[] }[]): number | null {
  let latest: { date: string; id: number; price: number } | null = null
  for (const purchase of purchases) {
    const date = typeof purchase.date === 'string' ? purchase.date.slice(0, 10) : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const [year, month, day] = date.split('-').map(Number)
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) continue
    for (const line of purchase.lines) {
      if (line.itemId !== itemId || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) continue
      if (!latest || date > latest.date || (date === latest.date && purchase.id >= latest.id)) latest = { date, id: purchase.id, price: line.unitPriceMinor }
    }
  }
  return latest?.price ?? null
}
