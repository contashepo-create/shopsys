/**
 * مركز التقارير — ShopSys (المرحلة 5)
 * ─────────────────────────────────────
 * منطق خالص: كل تقرير دالة تأخذ البيانات وفترة وتعيد صفوفاً جاهزة للعرض.
 * لا إعادة حساب للضرائب أو التكاليف — كل الأرقام من المستندات المرحّلة
 * وقيودها (مصدر الحقيقة الواحد — القرار 9).
 */
import type { Minor } from './money.ts'
import type { CartLine, CartTotals, PaymentMethod } from './pos.ts'

/* ─── أنواع مدخلات عامة (بنى فرعية من مستندات repo — لا استيراد دائري) ─── */

export interface SaleDoc {
  id: number
  invoiceNumber: string
  date: string
  customerId: number | null
  payment: PaymentMethod
  /** المحصل فعلاً وقت البيع (الدفع المجزأ) — undefined للفواتير القديمة = حسب payment */
  paidMinor?: Minor
  lines: CartLine[]
  totals: CartTotals
}

/** المحصل وقت البيع (الدفع المجزأ) — التوافق الخلفي: cash=كامل، credit=صفر */
export function salePaidMinor(s: Pick<SaleDoc, 'payment' | 'paidMinor'> & { totals: { totalMinor: Minor } }): Minor {
  return s.paidMinor ?? (s.payment === 'cash' ? s.totals.totalMinor : 0)
}

export interface SaleReturnDoc {
  id: number
  date: string
  saleId: number
  lines: CartLine[]
  totals: CartTotals
}

export interface PurchaseDoc {
  id: number
  date: string
  supplierId: number
  grandTotalMinor: Minor
  /** مستحق المورد فقط (بضاعة + مصاريفه) — المصاريف المدفوعة مني لا تدخل دينه */
  supplierDueMinor?: Minor
  paidMinor: Minor
}

export interface Period {
  from: string // YYYY-MM-DD شامل
  to: string // YYYY-MM-DD شامل
}

/** هل التاريخ (ISO أو YYYY-MM-DD) داخل الفترة؟ */
export function inPeriod(dateIso: string, p: Period): boolean {
  const d = dateIso.slice(0, 10)
  return d >= p.from && d <= p.to
}

/* ─── 1) ملخص المبيعات ─── */

export interface SalesSummary {
  invoiceCount: number
  grossMinor: Minor
  discountMinor: Minor
  taxMinor: Minor
  totalMinor: Minor // صافي المبيعات المحصلة/المستحقة
  cogsMinor: Minor
  profitMinor: Minor // الإجمالي − الضريبة − التكلفة (ربح إجمالي)
  cashMinor: Minor
  creditMinor: Minor
  returnsMinor: Minor // قيمة المرتجعات في الفترة
  returnsCogsMinor: Minor
  netProfitMinor: Minor // الربح بعد أثر المرتجعات
}

export function salesSummary(sales: SaleDoc[], returns: SaleReturnDoc[], p: Period): SalesSummary {
  let invoiceCount = 0, gross = 0, discount = 0, tax = 0, total = 0, cogs = 0, cash = 0, credit = 0
  for (const s of sales) {
    if (!inPeriod(s.date, p)) continue
    invoiceCount++
    gross += s.totals.grossMinor
    discount += s.totals.discountMinor
    tax += s.totals.taxMinor
    total += s.totals.totalMinor
    cogs += s.totals.cogsMinor
    // الدفع المجزأ: المحصل وقت البيع «نقدي» والباقي فقط «آجل» — لا الفاتورة كلها
    const paid = salePaidMinor(s)
    cash += paid
    credit += s.totals.totalMinor - paid
  }
  let returnsMinor = 0, returnsCogs = 0, returnsTax = 0
  for (const r of returns) {
    if (!inPeriod(r.date, p)) continue
    returnsMinor += r.totals.totalMinor
    returnsCogs += r.totals.cogsMinor
    returnsTax += r.totals.taxMinor
  }
  const profit = total - tax - cogs
  const netProfit = profit - (returnsMinor - returnsTax - returnsCogs)
  return {
    invoiceCount, grossMinor: gross, discountMinor: discount, taxMinor: tax,
    totalMinor: total, cogsMinor: cogs, profitMinor: profit,
    cashMinor: cash, creditMinor: credit,
    returnsMinor, returnsCogsMinor: returnsCogs, netProfitMinor: netProfit,
  }
}

/* ─── 2) أفضل الأصناف مبيعاً ─── */

export interface TopItemRow {
  itemId: number
  nameAr: string
  qty: number
  revenueMinor: Minor // بعد خصم السطر
  cogsMinor: Minor
  profitMinor: Minor
}

/** يجمع مبيعات الأصناف (يطرح كميات المرتجعات وقيمها) ويرتب حسب الإيراد */
export function topItems(sales: SaleDoc[], returns: SaleReturnDoc[], p: Period, limit = 10): TopItemRow[] {
  const map = new Map<number, TopItemRow>()
  const acc = (l: CartLine, sign: 1 | -1) => {
    const lineNet = Math.round(Math.round(l.unitPriceMinor * l.qty) * (1 - l.discountPercent / 100))
    const lineCogs = Math.round(l.unitCostMinor * l.qty)
    const row = map.get(l.itemId) ?? { itemId: l.itemId, nameAr: l.nameAr, qty: 0, revenueMinor: 0, cogsMinor: 0, profitMinor: 0 }
    row.qty = Math.round((row.qty + sign * l.qty) * 1000) / 1000
    row.revenueMinor += sign * lineNet
    row.cogsMinor += sign * lineCogs
    row.profitMinor = row.revenueMinor - row.cogsMinor
    map.set(l.itemId, row)
  }
  for (const s of sales) if (inPeriod(s.date, p)) for (const l of s.lines) acc(l, 1)
  for (const r of returns) if (inPeriod(r.date, p)) for (const l of r.lines) acc(l, -1)
  return [...map.values()].sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, limit)
}

/* ─── 3) المبيعات اليومية (لرسم بياني بسيط) ─── */

export interface DailyRow {
  date: string // YYYY-MM-DD
  totalMinor: Minor
  profitMinor: Minor
  invoiceCount: number
}

export function dailySales(sales: SaleDoc[], p: Period): DailyRow[] {
  const map = new Map<string, DailyRow>()
  for (const s of sales) {
    if (!inPeriod(s.date, p)) continue
    const d = s.date.slice(0, 10)
    const row = map.get(d) ?? { date: d, totalMinor: 0, profitMinor: 0, invoiceCount: 0 }
    row.totalMinor += s.totals.totalMinor
    row.profitMinor += s.totals.totalMinor - s.totals.taxMinor - s.totals.cogsMinor
    row.invoiceCount++
    map.set(d, row)
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

/* ─── 4) أرصدة العملاء (الذمم) من دفتر اليومية ─── */

export interface LedgerEntryLite {
  sourceType: string
  sourceId: number | null
  date: string
  description: string
  lines: { accountCode: string; debit: Minor; credit: Minor }[]
}

/**
 * كشف مديونية عميل تقريبي من مستنداته: فواتيره الآجلة − مرتجعاته الدائنة.
 * (الحساب 1104 مجمّع لكل العملاء؛ التفصيل من المستندات نفسها)
 */
export interface CustomerBalanceRow {
  customerId: number
  invoicedMinor: Minor // فواتير آجلة
  returnedMinor: Minor // مرتجعات خصمت من ذمته
  collectedMinor: Minor // تحصيلات (أقساط/سندات مربوطة بالعميل)
  balanceMinor: Minor
}

export function customerBalances(
  sales: SaleDoc[],
  returns: (SaleReturnDoc & { refund: PaymentMethod })[],
  collections: { customerId: number; amountMinor: Minor }[],
): CustomerBalanceRow[] {
  const map = new Map<number, CustomerBalanceRow>()
  const row = (id: number) => {
    const r = map.get(id) ?? { customerId: id, invoicedMinor: 0, returnedMinor: 0, collectedMinor: 0, balanceMinor: 0 }
    map.set(id, r)
    return r
  }
  const saleCustomer = new Map<number, number | null>()
  for (const s of sales) {
    saleCustomer.set(s.id, s.customerId)
    // الدفع المجزأ: الجزء الآجل فقط يدخل ذمة العميل — المحصل وقت البيع ليس ديناً
    const creditPart = s.totals.totalMinor - salePaidMinor(s)
    if (creditPart > 0 && s.customerId != null) row(s.customerId).invoicedMinor += creditPart
  }
  for (const r of returns) {
    // مرتجع بتخفيض الذمة (وليس رداً نقدياً) عن فاتورة لعميل معروف
    const cid = saleCustomer.get(r.saleId)
    if (r.refund === 'credit' && cid != null) row(cid).returnedMinor += r.totals.totalMinor
  }
  for (const c of collections) row(c.customerId).collectedMinor += c.amountMinor
  for (const r of map.values()) r.balanceMinor = r.invoicedMinor - r.returnedMinor - r.collectedMinor
  return [...map.values()].filter((r) => r.invoicedMinor || r.collectedMinor || r.returnedMinor)
    .sort((a, b) => b.balanceMinor - a.balanceMinor)
}

/* ─── 5) أرصدة الموردين ─── */

export interface SupplierBalanceRow {
  supplierId: number
  purchasedMinor: Minor // إجمالي الفواتير
  paidMinor: Minor // المدفوع عليها + سندات صرف لاحقة
  balanceMinor: Minor // المستحق للمورد
}

export function supplierBalances(
  purchases: PurchaseDoc[],
  extraPayments: { supplierId: number; amountMinor: Minor }[],
): SupplierBalanceRow[] {
  const map = new Map<number, SupplierBalanceRow>()
  const row = (id: number) => {
    const r = map.get(id) ?? { supplierId: id, purchasedMinor: 0, paidMinor: 0, balanceMinor: 0 }
    map.set(id, r)
    return r
  }
  for (const pu of purchases) {
    const r = row(pu.supplierId)
    // رصيد المورد من مستحقه فقط — لا يشمل مصاريف دفعها المشتري بنفسه (طلب المالك)
    r.purchasedMinor += pu.supplierDueMinor ?? pu.grandTotalMinor
    r.paidMinor += pu.paidMinor
  }
  for (const x of extraPayments) row(x.supplierId).paidMinor += x.amountMinor
  for (const r of map.values()) r.balanceMinor = r.purchasedMinor - r.paidMinor
  return [...map.values()].sort((a, b) => b.balanceMinor - a.balanceMinor)
}

/* ─── 6) تنبيهات المخزون ─── */

export interface StockAlertRow {
  itemId: number
  nameAr: string
  stockQty: number
  minQty: number
  kind: 'out' | 'low' // نافد أو تحت حد الطلب
}

export function stockAlerts(items: { id: number; nameAr: string; stockQty: number; minQty: number }[]): StockAlertRow[] {
  const rows: StockAlertRow[] = []
  for (const it of items) {
    if (it.stockQty <= 0) rows.push({ itemId: it.id, nameAr: it.nameAr, stockQty: it.stockQty, minQty: it.minQty, kind: 'out' })
    else if (it.minQty > 0 && it.stockQty <= it.minQty) rows.push({ itemId: it.id, nameAr: it.nameAr, stockQty: it.stockQty, minQty: it.minQty, kind: 'low' })
  }
  return rows.sort((a, b) => a.stockQty - b.stockQty)
}

/* ─── 7) قيمة المخزون الحالية ─── */

export interface InventoryValueRow {
  itemId: number
  nameAr: string
  stockQty: number
  costMinor: Minor // تكلفة الوحدة (متوسط مرجح)
  valueMinor: Minor
}

export function inventoryValue(items: { id: number; nameAr: string; stockQty: number; costMinor: Minor }[]): {
  rows: InventoryValueRow[]
  totalMinor: Minor
} {
  const rows = items
    .filter((it) => it.stockQty > 0)
    .map((it) => ({
      itemId: it.id, nameAr: it.nameAr, stockQty: it.stockQty, costMinor: it.costMinor,
      valueMinor: Math.round(it.costMinor * it.stockQty),
    }))
    .sort((a, b) => b.valueMinor - a.valueMinor)
  return { rows, totalMinor: rows.reduce((a, r) => a + r.valueMinor, 0) }
}

/* ─── فترات جاهزة ─── */

export function periodPresets(todayIso: string): { id: string; label: string; period: Period }[] {
  const today = todayIso.slice(0, 10)
  const [y, m] = today.split('-').map(Number)
  const startOfMonth = `${today.slice(0, 7)}-01`
  const startOfYear = `${y}-01-01`
  const d = new Date(Date.parse(`${today}T00:00:00Z`))
  d.setUTCDate(d.getUTCDate() - 6)
  const weekAgo = d.toISOString().slice(0, 10)
  const prevM = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  const prevStart = `${prevM.y}-${String(prevM.m).padStart(2, '0')}-01`
  const prevEnd = `${prevM.y}-${String(prevM.m).padStart(2, '0')}-${String(new Date(Date.UTC(prevM.y, prevM.m, 0)).getUTCDate()).padStart(2, '0')}`
  return [
    { id: 'today', label: 'اليوم', period: { from: today, to: today } },
    { id: 'week', label: 'آخر 7 أيام', period: { from: weekAgo, to: today } },
    { id: 'month', label: 'هذا الشهر', period: { from: startOfMonth, to: today } },
    { id: 'prev_month', label: 'الشهر الماضي', period: { from: prevStart, to: prevEnd } },
    { id: 'year', label: 'هذه السنة', period: { from: startOfYear, to: today } },
  ]
}
