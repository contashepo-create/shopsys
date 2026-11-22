/**
 * ماسح سطور مرتجع البيع — قرار نقي بلا واجهة.
 *
 * المرتجع يُبنى على سطور الفاتورة نفسها، فمسح باركود لا «يضيف صنفاً» بل **يحدد
 * السطر** ويضع كمية الإرجاع المقترحة:
 *  - ملصق ميزان (بادئة الوزن): الكمية = الوزن المطبوع مقصوصاً على المتبقي.
 *  - باركود صنف/SKU (بما فيه باركودات الوحدات): الكمية = 1 مقصوصة على المتبقي.
 * لا يُرجَع أي سطر غير موجود في الفاتورة، ولا سطر استُنفد رصيده — وهذا مقصود
 * لأن إرجاع صنف لم يُبع من هذه الفاتورة يفسد القيد العاكس.
 */
import { normalizeBarcode } from '../../core/items.ts'
import { matchScaleItem, parseScaleBarcodeUniversal, type ScaleRule } from '../../core/barcode.ts'

export interface ReturnScanLine {
  itemId: number
  qty?: number
}

export interface ReturnScanItem {
  id: number
  nameAr: string
  sku?: string | null
  barcodes?: string[] | null
  soldByWeight?: boolean
  units?: Array<{ barcode?: string | null }>
}

export type ReturnLineScanError = 'empty' | 'not_in_invoice' | 'no_remaining'

export interface ReturnLineScanHit {
  index: number
  qty: number
  label: string
  kind: 'scale' | 'barcode' | 'sku'
}

export type ReturnLineScanOutcome = { hit: ReturnLineScanHit } | { error: ReturnLineScanError }

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** كل باركودات الصنف المسجَّلة: الأساسية + الوحدات (لعلبة/دستة/كرتونة). */
const barcodesOf = (item: ReturnScanItem): string[] =>
  [...(item.barcodes ?? []), ...(item.units ?? []).map((unit) => unit.barcode ?? '')]
    .map((code) => normalizeBarcode(code))
    .filter(Boolean)

export function resolveReturnLineScan(args: {
  code: string
  lines: readonly ReturnScanLine[]
  items: readonly ReturnScanItem[]
  remaining: readonly number[]
  rules: readonly ScaleRule[]
}): ReturnLineScanOutcome {
  const code = normalizeBarcode(args.code)
  if (!code) return { error: 'empty' }

  const remainingOf = (index: number) => args.remaining[index] ?? 0

  /**
   * سطر الصنف في هذه الفاتورة: أول سطر لا يزال له رصيد قابل للإرجاع؛
   * إن وُجد الصنف لكن كل سطوره مستنفدة ⇒ no_remaining (لا كمية صفرية).
   */
  const lineOf = (itemId: number): { index: number } | { error: ReturnLineScanError } => {
    const indexes = args.lines.reduce<number[]>((acc, line, index) => (line.itemId === itemId ? [...acc, index] : acc), [])
    if (indexes.length === 0) return { error: 'not_in_invoice' }
    const open = indexes.find((index) => remainingOf(index) > 0)
    return { index: open ?? indexes[0] }
  }

  /* ① ملصق ميزان: الوزن المطبوع هو كمية الإرجاع (مقصوصاً على المتبقي). */
  if (args.rules.length > 0) {
    const parsed = parseScaleBarcodeUniversal(code, args.rules)
    if (parsed && parsed.weightKg != null) {
      const candidates = args.items.map((item) => ({
        ...item,
        sku: item.sku ?? '',
        barcodes: item.barcodes ?? [],
        soldByWeight: Boolean(item.soldByWeight),
      }))
      const item = matchScaleItem(parsed.itemCode, candidates, { requireWeighted: true })
      if (item) {
        const found = lineOf(item.id)
        if ('error' in found) return found
        const { index } = found
        const qty = round3(Math.min(parsed.weightKg, remainingOf(index)))
        if (qty <= 0) return { error: 'no_remaining' }
        return {
          hit: {
            index,
            qty,
            kind: 'scale',
            label: `⚖️ ${item.nameAr} — ${qty.toFixed(3)} كجم (من الملصق)`,
          },
        }
      }
    }
  }

  /* ② باركود الصنف أو باركود وحدة — مطابقة تامة فقط (لا بحث جزئي). */
  const byBarcode = args.items.find((item) => barcodesOf(item).includes(code))
  if (byBarcode) {
    const found = lineOf(byBarcode.id)
    if ('error' in found) return found
    const { index } = found
    const qty = round3(Math.min(1, remainingOf(index)))
    if (qty <= 0) return { error: 'no_remaining' }
    return { hit: { index, qty, kind: 'barcode', label: `${byBarcode.nameAr} — قطعة واحدة` } }
  }

  /* ③ SKU نفسه ممسوحاً (أصناف بلا باركود). */
  const bySku = args.items.find((item) => item.sku && normalizeBarcode(item.sku) === code)
  if (bySku) {
    const found = lineOf(bySku.id)
    if ('error' in found) return found
    const { index } = found
    const qty = round3(Math.min(1, remainingOf(index)))
    if (qty <= 0) return { error: 'no_remaining' }
    return qtyOneHit(bySku, index, qty)
  }

  return { error: 'not_in_invoice' }
}

/** نتيجة السطر بكمية قطعة واحدة (باركود/SKU). */
function qtyOneHit(item: ReturnScanItem, index: number, qty: number): ReturnLineScanOutcome {
  return { hit: { index, qty, kind: 'sku', label: `${item.nameAr} — قطعة واحدة (SKU)` } }
}

export const RETURN_SCAN_ERROR_TEXT: Record<ReturnLineScanError, string> = {
  empty: 'امسح باركوداً أولاً',
  not_in_invoice: 'هذا الصنف ليس في الفاتورة المختارة — لا يمكن إرجاعه منها',
  no_remaining: 'سطر هذا الصنف استُنفد رصيده القابل للإرجاع',
}
