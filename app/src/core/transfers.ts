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
 * مستند مؤثر على مخزن بعينه (الأمر 8 — اختيار المخزن أعلى الفاتورة):
 * فاتورة شراء وارد مخزنها X ⇒ qtyDelta موجب في X؛ بيع من X ⇒ سالب.
 * warehouseId=null = سجل قديم/فاتورة مختلطة تُقرأ من السطور؛ والرئيسي لا يحتاج إزاحة لأنه المتبقي.
 */
export interface WarehouseDoc {
  warehouseId: number | null
  lines: { itemId: number; qtyDelta: number }[]
}

/**
 * حساب أرصدة المخازن من الرصيد الكلي + سجل التحويلات + مستندات المخازن.
 * items: الرصيد الكلي لكل صنف (stockQty). transfers: بالترتيب الزمني.
 * docs (اختياري): فواتير بيع/شراء اختير لها مخزن غير الرئيسي — تُزاح كمياتها
 * من الرئيسي إليه، فيبقى الرئيسي = الإجمالي − أرصدة بقية المخازن (متسق دائماً).
 */
export function computeWarehouseStock(
  items: { id: number; stockQty: number }[],
  warehouses: { id: number; isMain: boolean }[],
  transfers: TransferInput[],
  docs: WarehouseDoc[] = [],
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
  for (const d of docs) {
    if (d.warehouseId == null || d.warehouseId === main.id) continue // غير محدد/رئيسي = لا إزاحة
    const w = stock.get(d.warehouseId)
    if (!w) continue
    for (const l of d.lines) {
      w.set(l.itemId, (w.get(l.itemId) ?? 0) + l.qtyDelta)
      mainMap.set(l.itemId, (mainMap.get(l.itemId) ?? 0) - l.qtyDelta)
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

/**
 * تحويل فواتير البيع/الشراء إلى مستندات مخازن (الأمر 8):
 * شراء وارد لمخزن X ⇒ كميات موجبة في X؛ بيع من X ⇒ سالبة.
 * الفواتير بلا مخزن محدد تُهمل هنا (تُحمَّل ضمنياً على الرئيسي).
 *
 * إصلاح R2: المرتجعات تعيد/تسحب رصيد مخزن فاتورتها الأصلية —
 * مرتجع بيع من فاتورة على مخزن X ⇒ موجب في X (البضاعة عادت لنفس المخزن)،
 * ومرتجع شراء عن فاتورة وردت لمخزن X ⇒ سالب في X (خرجت من حيث دخلت).
 */
export function buildWarehouseDocs(
  purchases: { id?: number; projectId?: number | null; warehouseId?: number | null; lines: { itemId: number; qty: number; warehouseId?: number | null }[] }[],
  sales: { id?: number; warehouseId?: number | null; lines: { itemId: number; qty: number; warehouseId?: number | null }[] }[],
  saleReturns: { saleId: number; lines: { itemId: number; qty: number; condition?: string; saleLineIndex?: number; warehouseId?: number | null }[] }[] = [],
  purchaseReturns: { purchaseId: number; lines: { itemId: number; qty: number }[] }[] = [],
): WarehouseDoc[] {
  const docs: WarehouseDoc[] = []
  const pushLineDoc = (warehouseId: number | null | undefined, itemId: number, qtyDelta: number) => {
    if (warehouseId == null || qtyDelta === 0) return
    docs.push({ warehouseId, lines: [{ itemId, qtyDelta }] })
  }

  // الفاتورة قد تكون على مخزن واحد، أو «تحديد بالسطر» وفيها warehouseId على كل سطر.
  for (const p of purchases) {
    if (p.projectId != null) continue // فاتورة مشروع: بضاعتها تكلفة موقع مباشرة وليست رصيد مخزن
    for (const l of p.lines) pushLineDoc(l.warehouseId ?? p.warehouseId ?? null, l.itemId, l.qty)
  }
  for (const s of sales) {
    for (const l of s.lines) pushLineDoc(l.warehouseId ?? s.warehouseId ?? null, l.itemId, -l.qty)
  }

  const saleById = new Map(sales.filter((s) => s.id != null).map((s) => [s.id!, s]))
  // يبقى الاستهلاك متراكماً بين جميع مرتجعات الفاتورة، لا يبدأ من أول سطر مع كل مستند.
  const remainingSaleLineQty = new Map<string, number>()
  for (const sale of sales) sale.lines.forEach((line, index) => remainingSaleLineQty.set(`${sale.id ?? 0}:${index}`, line.qty))
  for (const r of saleReturns) {
    const sale = saleById.get(r.saleId)
    if (!sale) continue
    for (const retLine of r.lines.filter((l) => l.condition !== 'damaged')) {
      let left = retLine.qty
      const referencedIndex = 'saleLineIndex' in retLine && typeof retLine.saleLineIndex === 'number' ? retLine.saleLineIndex : null
      const indexes = referencedIndex == null ? sale.lines.map((_, index) => index) : [referencedIndex]
      for (const i of indexes) {
        if (left <= 1e-9) break
        const sl = sale.lines[i]
        if (!sl || sl.itemId !== retLine.itemId) continue
        const key = `${sale.id ?? 0}:${i}`
        const can = remainingSaleLineQty.get(key) ?? 0
        if (can <= 0) continue
        const take = Math.min(left, can)
        remainingSaleLineQty.set(key, Math.round((can - take) * 1000) / 1000)
        left = Math.round((left - take) * 1000) / 1000
        pushLineDoc(retLine.warehouseId ?? sl.warehouseId ?? sale.warehouseId ?? null, retLine.itemId, take)
      }
    }
  }

  const purchaseById = new Map(purchases.filter((p) => p.id != null && p.projectId == null).map((p) => [p.id!, p]))
  // مرتجعات الشراء الحالية مجمعة بالصنف؛ نوزعها على سطور الأصل بترتيبها حتى لا يخرج رصيد من مخزن لم يستلم.
  const remainingPurchaseLineQty = new Map<string, number>()
  for (const p of purchases) p.lines.forEach((l, i) => remainingPurchaseLineQty.set(`${p.id ?? 0}:${i}`, l.qty))
  for (const r of purchaseReturns) {
    const purchase = purchaseById.get(r.purchaseId)
    if (!purchase) continue
    for (const retLine of r.lines) {
      let left = retLine.qty
      for (let i = 0; i < purchase.lines.length && left > 1e-9; i++) {
        const pl = purchase.lines[i]
        if (pl.itemId !== retLine.itemId) continue
        const key = `${purchase.id ?? 0}:${i}`
        const can = remainingPurchaseLineQty.get(key) ?? 0
        if (can <= 0) continue
        const take = Math.min(left, can)
        remainingPurchaseLineQty.set(key, Math.round((can - take) * 1000) / 1000)
        left = Math.round((left - take) * 1000) / 1000
        pushLineDoc(pl.warehouseId ?? purchase.warehouseId ?? null, retLine.itemId, -take)
      }
    }
  }
  return docs
}
