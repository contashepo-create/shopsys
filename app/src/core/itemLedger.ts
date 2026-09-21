/**
 * كارت الصنف — دفتر حركة الصنف (طلب المالك، الأمر 13):
 * يعيد بناء كل حركات صنف واحد من مستنداته الفعلية (شراء/بيع/مرتجعات/
 * جرد/إنتاج/صرف مواد) بترتيب زمني مع رصيد جارٍ — دالة خالصة تُغذى
 * بشرائح الحالة ولا تعتمد على سجل منفصل قد ينسى حركة.
 */

export interface ItemLedgerRow {
  date: string // YYYY-MM-DD
  docLabel: string // «فاتورة شراء P-0001»
  docType: string // purchase | sale | sale_return | purchase_return | stocktake | production | processing | material_issue
  inQty: number // وارد
  outQty: number // منصرف
  balance: number // الرصيد الجاري بعد الحركة
  /** قيمة الحركة بالتكلفة أو بسعر البيع حسب النوع (للاطلاع) */
  valueMinor: number
  note: string
  warehouseId?: number | null
  userName?: string | null
}

export interface ItemLedgerInput {
  itemId: number
  openingQty: number // رصيد الصنف الافتتاحي (وقت إنشائه)
  purchases: { invoiceNumber: string; date: string; warehouseId?: number | null; userName?: string | null; lines: { itemId: number; qty: number; unitPriceMinor: number; expenseShareMinor?: number; warehouseId?: number | null }[] }[]
  purchaseReturns: { returnNumber: string; date: string; warehouseId?: number | null; userName?: string | null; lines: { itemId: number; qty: number; unitCostMinor: number; warehouseId?: number | null }[] }[]
  sales: { invoiceNumber: string; date: string; warehouseId?: number | null; userName?: string | null; lines: { itemId: number; qty: number; unitPriceMinor: number; discountPercent: number; warehouseId?: number | null }[] }[]
  saleReturns: { returnNumber: string; date: string; warehouseId?: number | null; userName?: string | null; lines: { itemId: number; qty: number; unitPriceMinor: number; condition?: string; warehouseId?: number | null }[] }[]
  stocktakes: { stocktakeNumber: string; date: string; warehouseId?: number | null; userName?: string | null; rows: { itemId: number; systemQty: number; countedQty: number }[] }[]
  productionOrders: { orderNumber: string; date: string; productItemId: number; qty: number; ingredients: { itemId: number; qty: number }[] }[]
  materialRequisitions: { reqNumber: string; date: string; warehouseId?: number | null; userName?: string | null; lines: { itemId: number; qty: number }[] }[]
  /** أوامر التجهيز والتفكيك (جزارة/تمور): خام خارج ونواتج داخلة — اختياري لتوافق المستدعين الأقدم */
  processingOrders?: { orderNumber: string; date: string; sourceItemId: number; sourceQty: number; outputs: { itemId: number; qty: number }[] }[]
  transfers?: { transferNumber?: string; date: string; fromWarehouseId: number; toWarehouseId: number; userName?: string | null; lines: { itemId: number; qty: number }[] }[]
}


export interface ItemLedgerResult {
  openingQty: number
  rows: ItemLedgerRow[]
  totalIn: number
  totalOut: number
  closingQty: number
}

/** بناء الدفتر: تجميع الحركات ثم ترتيب زمني ثم رصيد جارٍ من الافتتاحي */
export function buildItemLedger(input: ItemLedgerInput, fromDate?: string, toDate?: string): ItemLedgerResult {
  type Raw = Omit<ItemLedgerRow, 'balance'>
  const raw: Raw[] = []
  const id = input.itemId

  for (const p of input.purchases) {
    for (const l of p.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      raw.push({
        date: p.date, docLabel: `فاتورة شراء ${p.invoiceNumber}`, docType: 'purchase',
        inQty: l.qty, outQty: 0,
        valueMinor: Math.round(l.qty * l.unitPriceMinor) + (l.expenseShareMinor ?? 0),
        note: 'وارد شراء بتكلفته المحملة', warehouseId: l.warehouseId ?? p.warehouseId ?? null, userName: p.userName ?? null,
      })
    }
  }
  for (const r of input.purchaseReturns) {
    for (const l of r.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      raw.push({
        date: r.date, docLabel: `مرتجع شراء ${r.returnNumber}`, docType: 'purchase_return',
        inQty: 0, outQty: l.qty, valueMinor: Math.round(l.qty * l.unitCostMinor),
        note: 'رد بضاعة للمورد', warehouseId: l.warehouseId ?? r.warehouseId ?? null, userName: r.userName ?? null,
      })
    }
  }
  for (const s of input.sales) {
    for (const l of s.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      const gross = Math.round(l.qty * l.unitPriceMinor)
      raw.push({
        date: s.date, docLabel: `فاتورة بيع ${s.invoiceNumber}`, docType: 'sale',
        inQty: 0, outQty: l.qty,
        valueMinor: gross - Math.round((gross * (l.discountPercent ?? 0)) / 100),
        note: 'منصرف بيع (القيمة بسعر البيع)', warehouseId: l.warehouseId ?? s.warehouseId ?? null, userName: s.userName ?? null,
      })
    }
  }
  for (const r of input.saleReturns) {
    for (const l of r.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      // المرتجع التالف لا يدخل المخزون (تكلفته للهالك 5111) — يظهر في الكارت
      // كسطر توثيقي بلا وارد كي لا ينحرف الرصيد الجاري عن الواقع
      const damaged = l.condition === 'damaged'
      raw.push({
        date: r.date, docLabel: `مرتجع بيع ${r.returnNumber}`, docType: 'sale_return',
        inQty: damaged ? 0 : l.qty, outQty: 0, valueMinor: Math.round(l.qty * l.unitPriceMinor),
        note: damaged ? `مرتجع تالف (${l.qty}) — لا يدخل المخزون، تكلفته هالك` : 'عودة بضاعة من عميل', warehouseId: l.warehouseId ?? r.warehouseId ?? null, userName: r.userName ?? null,
      })
    }
  }
  for (const st of input.stocktakes) {
    for (const row of st.rows) {
      if (row.itemId !== id) continue
      const diff = row.countedQty - row.systemQty
      if (diff === 0) continue
      raw.push({
        date: st.date, docLabel: `جرد ${st.stocktakeNumber}`, docType: 'stocktake',
        inQty: diff > 0 ? diff : 0, outQty: diff < 0 ? -diff : 0, valueMinor: 0,
        note: diff > 0 ? 'زيادة جرد (تسوية)' : 'عجز جرد (تسوية)', warehouseId: st.warehouseId ?? null, userName: st.userName ?? null,
      })
    }
  }
  for (const po of input.productionOrders) {
    if (po.productItemId === id && po.qty > 0) {
      raw.push({
        date: po.date, docLabel: `أمر إنتاج ${po.orderNumber}`, docType: 'production',
        inQty: po.qty, outQty: 0, valueMinor: 0, note: 'منتج تام من الإنتاج',
      })
    }
    for (const ing of po.ingredients) {
      if (ing.itemId !== id || ing.qty <= 0) continue
      raw.push({
        date: po.date, docLabel: `أمر إنتاج ${po.orderNumber}`, docType: 'production',
        inQty: 0, outQty: ing.qty, valueMinor: 0, note: 'خامة مستهلكة في الإنتاج',
      })
    }
  }
  for (const pr of input.processingOrders ?? []) {
    if (pr.sourceItemId === id && pr.sourceQty > 0) {
      raw.push({
        date: pr.date, docLabel: `أمر تجهيز ${pr.orderNumber}`, docType: 'processing',
        inQty: 0, outQty: pr.sourceQty, valueMinor: 0, note: 'خام مستهلك في التقطيع/الفرز',
      })
    }
    for (const out of pr.outputs) {
      if (out.itemId !== id || out.qty <= 0) continue
      raw.push({
        date: pr.date, docLabel: `أمر تجهيز ${pr.orderNumber}`, docType: 'processing',
        inQty: out.qty, outQty: 0, valueMinor: 0, note: 'ناتج تقطيع/فرز داخل المخزون',
      })
    }
  }
  for (const mr of input.materialRequisitions) {
    for (const l of mr.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      raw.push({
        date: mr.date, docLabel: `إذن صرف ${mr.reqNumber}`, docType: 'material_issue',
        inQty: 0, outQty: l.qty, valueMinor: 0, note: 'صرف لمشروع/تشغيل', warehouseId: mr.warehouseId ?? null, userName: mr.userName ?? null,
      })
    }
  }
  for (const tr of input.transfers ?? []) {
    for (const l of tr.lines) {
      if (l.itemId !== id || l.qty <= 0) continue
      const label = tr.transferNumber ?? 'تحويل مخزني'
      raw.push({
        date: tr.date, docLabel: `تحويل ${label}`, docType: 'transfer',
        inQty: 0, outQty: l.qty, valueMinor: 0, note: 'خروج من مخزن', warehouseId: tr.fromWarehouseId, userName: tr.userName ?? null,
      })
      raw.push({
        date: tr.date, docLabel: `تحويل ${label}`, docType: 'transfer',
        inQty: l.qty, outQty: 0, valueMinor: 0, note: 'دخول إلى مخزن', warehouseId: tr.toWarehouseId, userName: tr.userName ?? null,
      })
    }
  }

  // ترتيب زمني ثابت (التاريخ ثم ترتيب الإدراج للحركات في نفس اليوم)
  const sorted = raw.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || a.i - b.i).map((x) => x.r)

  // الرصيد الجاري يبدأ من الافتتاحي ويجري على كل الحركات — ثم نقص بالفترة
  let bal = input.openingQty
  const withBalance: ItemLedgerRow[] = sorted.map((r) => {
    bal = Math.round((bal + r.inQty - r.outQty) * 1000) / 1000
    return { ...r, balance: bal }
  })

  const inRange = withBalance.filter((r) => (!fromDate || r.date >= fromDate) && (!toDate || r.date <= toDate))
  const totalIn = inRange.reduce((a, r) => a + r.inQty, 0)
  const totalOut = inRange.reduce((a, r) => a + r.outQty, 0)
  // رصيد بداية الفترة = رصيد آخر حركة قبلها (أو الافتتاحي)
  const before = withBalance.filter((r) => fromDate && r.date < fromDate)
  const openingForRange = before.length ? before[before.length - 1].balance : input.openingQty

  return {
    openingQty: fromDate ? openingForRange : input.openingQty,
    rows: inRange,
    totalIn: Math.round(totalIn * 1000) / 1000,
    totalOut: Math.round(totalOut * 1000) / 1000,
    closingQty: inRange.length ? inRange[inRange.length - 1].balance : openingForRange,
  }
}
