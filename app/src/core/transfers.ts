/**
 * التحويلات المخزنية (استكمال المرحلة 3):
 * نقل كميات بين المخازن — حركة داخلية لا تغيّر ملكية ولا قيمة،
 * فلا قيد محاسبي لها (المخزون 1103 كما هو)؛ لكنها مستند مرقّم TRF-####
 * يُتحقق منه ضد الرصيد المتاح في المخزن المصدر.
 *
 * نموذج الأرصدة: كل مشتريات/مبيعات/جرد تتحرك على المخزن الرئيسي،
 * ورصيد أي مخزن آخر = وارد التحويلات − صادرها،
 * ورصيد الرئيسي = رصيد الصنف الكلي − صافي المحوَّل للخارج.
 * بذلك تبقى النواة خالصة ولا تمسّ تدفقات الشراء والبيع القائمة.
 */

export interface TransferLine {
  itemId: number
  qty: number
}

export interface TransferInput {
  fromWarehouseId: number
  toWarehouseId: number
  lines: TransferLine[]
}

/** رصيد صنف في مخزن: stock بالمعنى أعلاه */
export type WarehouseStock = Map<number, Map<number, number>> // warehouseId -> itemId -> qty

/**
 * حساب أرصدة المخازن من الرصيد الكلي + سجل التحويلات.
 * items: الرصيد الكلي لكل صنف (stockQty). transfers: بالترتيب الزمني.
 */
export function computeWarehouseStock(
  items: { id: number; stockQty: number }[],
  warehouses: { id: number; isMain: boolean }[],
  transfers: TransferInput[],
): WarehouseStock {
  const main = warehouses.find((w) => w.isMain)
  const stock: WarehouseStock = new Map()
  for (const w of warehouses) stock.set(w.id, new Map())
  if (!main) return stock
  const mainMap = stock.get(main.id)!
  for (const it of items) mainMap.set(it.id, it.stockQty ?? 0)
  for (const t of transfers) {
    const from = stock.get(t.fromWarehouseId)
    const to = stock.get(t.toWarehouseId)
    if (!from || !to) continue // مخزن محذوف تاريخياً — نتجاهل حركته بأمان
    for (const l of t.lines) {
      from.set(l.itemId, (from.get(l.itemId) ?? 0) - l.qty)
      to.set(l.itemId, (to.get(l.itemId) ?? 0) + l.qty)
    }
  }
  return stock
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * تحقق شامل قبل الترحيل — يعيد قائمة أخطاء عربية (فارغة = سليم).
 * availableInSource: رصيد الصنف المتاح في المخزن المصدر الآن.
 */
export function validateTransfer(
  input: TransferInput,
  availableInSource: (itemId: number) => number,
): string[] {
  const errors: string[] = []
  if (input.fromWarehouseId === input.toWarehouseId) errors.push('اختر مخزنين مختلفين')
  if (input.lines.length === 0) errors.push('أضف صنفاً واحداً على الأقل')
  const seen = new Set<number>()
  input.lines.forEach((l, i) => {
    if (seen.has(l.itemId)) errors.push(`سطر ${i + 1}: الصنف مكرر — اجمع الكمية في سطر واحد`)
    seen.add(l.itemId)
    if (!(l.qty > 0)) errors.push(`سطر ${i + 1}: الكمية يجب أن تكون موجبة`)
    else {
      const avail = availableInSource(l.itemId)
      if (round3(l.qty) > round3(avail)) errors.push(`سطر ${i + 1}: الكمية تتجاوز المتاح في المخزن المصدر (${round3(avail)})`)
    }
  })
  return errors
}

/** إجمالي القطع المنقولة في المستند */
export function transferTotalQty(lines: TransferLine[]): number {
  return round3(lines.reduce((a, l) => a + l.qty, 0))
}
