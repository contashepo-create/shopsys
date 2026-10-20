/**
 * مركز التقارير — ShopSys (المرحلة 5)
 * ─────────────────────────────────────
 * منطق خالص: كل تقرير دالة تأخذ البيانات وفترة وتعيد صفوفاً جاهزة للعرض.
 * لا إعادة حساب للضرائب أو التكاليف — كل الأرقام من المستندات المرحّلة
 * وقيودها (مصدر الحقيقة الواحد — القرار 9).
 */
import type { Minor } from './money.ts'
import type { CartLine, CartTotals, PaymentMethod } from './pos.ts'
import type { Item } from './items.ts'

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

/**
 * يجمع مبيعات الأصناف (يطرح كميات المرتجعات وقيمها) ويرتب حسب الإيراد.
 * إيراد الصنف = نصيبه من صافي الفاتورة (بعد خصم الفاتورة الإجمالي وبلا ضريبة) —
 * يوزَّع صافي كل مستند على سطوره نسبياً، فتتسق أرباح الأصناف مع ملخص المبيعات
 * وقائمة الدخل بالقرش (إصلاح المراجعة: كان يضخَّم بالضريبة ويتجاهل خصم الفاتورة).
 */
/**
 * التجميع المشترك: إيراد/تكلفة/ربح كل الأصناف (بلا حد أقصى) — يُبنى عليه
 * كل من topItems (أعلى N) وabcAnalysis (يحتاج كل الأصناف لحساب النسبة التراكمية).
 */
export function allItemRevenueRows(sales: SaleDoc[], returns: SaleReturnDoc[], p: Period): TopItemRow[] {
  const map = new Map<number, TopItemRow>()
  const acc = (doc: { lines: CartLine[]; totals: CartTotals }, sign: 1 | -1) => {
    const lineNets = doc.lines.map((l) => Math.round(Math.round(l.unitPriceMinor * l.qty) * (1 - l.discountPercent / 100)))
    const sumNets = lineNets.reduce((a, v) => a + v, 0)
    // صافي المستند بلا ضريبة وبعد خصم الفاتورة — التوزيع النسبي على السطور
    const docNet = doc.totals.totalMinor - doc.totals.taxMinor
    const factor = sumNets > 0 ? docNet / sumNets : 0
    for (let i = 0; i < doc.lines.length; i++) {
      const l = doc.lines[i]
      const lineRevenue = Math.round(lineNets[i] * factor)
      const lineCogs = Math.round(l.unitCostMinor * l.qty)
      const row = map.get(l.itemId) ?? { itemId: l.itemId, nameAr: l.nameAr, qty: 0, revenueMinor: 0, cogsMinor: 0, profitMinor: 0 }
      row.qty = Math.round((row.qty + sign * l.qty) * 1000) / 1000
      row.revenueMinor += sign * lineRevenue
      row.cogsMinor += sign * lineCogs
      row.profitMinor = row.revenueMinor - row.cogsMinor
      map.set(l.itemId, row)
    }
  }
  for (const s of sales) if (inPeriod(s.date, p)) acc(s, 1)
  for (const r of returns) if (inPeriod(r.date, p)) acc(r, -1)
  return [...map.values()].sort((a, b) => b.revenueMinor - a.revenueMinor)
}

export function topItems(sales: SaleDoc[], returns: SaleReturnDoc[], p: Period, limit = 10): TopItemRow[] {
  return allItemRevenueRows(sales, returns, p).slice(0, limit)
}

/* ─── تحليل ABC (سد فجوة: لا تصنيف أصناف حسب مساهمتها بالإيراد) ───
   تصنيف Pareto كلاسيكي: A = أول أصناف تشكّل حتى 80٪ من الإيراد التراكمي،
   B = حتى 95٪، C = الباقي — يوجّه المالك لأي الأصناف تستحق عناية أعلى
   (تتبع مخزون أدق، تفاوض أفضل مع المورد) وأيها أقل أهمية. */

export type AbcClass = 'A' | 'B' | 'C'

export interface AbcRow extends TopItemRow {
  class: AbcClass
  /** نسبة إيراد هذا الصنف وحده من إجمالي الإيراد */
  sharePercent: number
  /** النسبة التراكمية حتى هذا الصنف (مرتب تنازلياً بالإيراد) */
  cumulativeSharePercent: number
}

export function abcAnalysis(sales: SaleDoc[], returns: SaleReturnDoc[], p: Period): AbcRow[] {
  const rows = allItemRevenueRows(sales, returns, p).filter((r) => r.revenueMinor > 0)
  const total = rows.reduce((a, r) => a + r.revenueMinor, 0)
  if (total <= 0) return []
  let cum = 0
  return rows.map((r) => {
    const cumBeforePercent = (cum / total) * 100
    cum += r.revenueMinor
    const cls: AbcClass = cumBeforePercent < 80 ? 'A' : cumBeforePercent < 95 ? 'B' : 'C'
    return {
      ...r,
      class: cls,
      sharePercent: Math.round((r.revenueMinor / total) * 10000) / 100,
      cumulativeSharePercent: Math.round((cum / total) * 10000) / 100,
    }
  })
}

/* ─── تقرير الربح حسب درجة القطعة (سد فجوة فورية #3 — النشاط #7: قطع غيار) ───
   حقل `Item.grade` (أصلي/بديل تجاري/مستعمل) مُدخَل ومعروض فعلاً لكن لم يكن
   مُستثمَراً في أي تقرير يفصل الهامش بينها — الهدف المعلَن صراحة في دليل
   التشغيل الداخلي من إضافة الحقل أصلاً: "حتى لا تختلط الأسعار والهوامش". */

export interface GradeProfitRow {
  grade: NonNullable<Item['grade']> | 'unspecified'
  qty: number
  revenueMinor: Minor
  cogsMinor: Minor
  profitMinor: Minor
  /** هامش الربح = الربح / الإيراد × 100 — صفر إن لم يوجد إيراد لهذه الدرجة */
  marginPercent: number
}

/** يجمّع ربح/إيراد المبيعات (بعد خصم المرتجعات) لكل درجة قطعة خلال فترة */
export function gradeProfitReport(
  sales: SaleDoc[],
  returns: SaleReturnDoc[],
  items: readonly Pick<Item, 'id' | 'grade'>[],
  p: Period,
): GradeProfitRow[] {
  const gradeByItem = new Map(items.map((it) => [it.id, it.grade ?? 'unspecified']))
  const byGrade = new Map<string, GradeProfitRow>()
  for (const r of allItemRevenueRows(sales, returns, p)) {
    const grade = gradeByItem.get(r.itemId) ?? 'unspecified'
    const bucket = byGrade.get(grade) ?? { grade: grade as GradeProfitRow['grade'], qty: 0, revenueMinor: 0, cogsMinor: 0, profitMinor: 0, marginPercent: 0 }
    bucket.qty = Math.round((bucket.qty + r.qty) * 1000) / 1000
    bucket.revenueMinor += r.revenueMinor
    bucket.cogsMinor += r.cogsMinor
    bucket.profitMinor += r.profitMinor
    byGrade.set(grade, bucket)
  }
  return [...byGrade.values()]
    .map((b) => ({ ...b, marginPercent: b.revenueMinor > 0 ? Math.round((b.profitMinor / b.revenueMinor) * 1000) / 10 : 0 }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
}

/* ─── 2.5) الأصناف الراكدة (سد فجوة DEXEF/برامج السوق السعودي: «تقرير الراكد») ─── */

export interface StagnantItemRow {
  itemId: number
  nameAr: string
  stockQty: number
  stockValueMinor: Minor // بقيمة التكلفة — رأس مال محبوس
  /** آخر تاريخ بيع — null = لم يُبع قط */
  lastSoldDate: string | null
  /** أيام منذ آخر بيع (أو منذ بداية الفترة إن لم يُبع) */
  idleDays: number
}

/**
 * الأصناف الراكدة: صنف عليه مخزون ولم يُبع خلال آخر idleDaysThreshold يوماً —
 * مرتبة بقيمة المخزون المحبوس تنازلياً (الأغلى ركوداً أولاً).
 * أصناف الخدمة والمعطلة مستثناة (لا مخزون لها أصلاً).
 */
export function stagnantItems(
  items: readonly { id: number; nameAr: string; stockQty: number; costMinor: Minor; isActive: boolean; isService?: boolean }[],
  sales: readonly SaleDoc[],
  todayIso: string,
  idleDaysThreshold = 30,
): StagnantItemRow[] {
  const lastSold = new Map<number, string>()
  for (const s of sales) {
    for (const l of s.lines) {
      const prev = lastSold.get(l.itemId)
      if (!prev || s.date > prev) lastSold.set(l.itemId, s.date)
    }
  }
  const today = new Date(todayIso.slice(0, 10) + 'T00:00:00Z').getTime()
  const rows: StagnantItemRow[] = []
  for (const it of items) {
    if (!it.isActive || it.isService || (it.stockQty ?? 0) <= 0) continue
    const last = lastSold.get(it.id) ?? null
    const refTime = last ? new Date(last.slice(0, 10) + 'T00:00:00Z').getTime() : 0
    const idleDays = last ? Math.floor((today - refTime) / 86_400_000) : Number.MAX_SAFE_INTEGER
    if (idleDays < idleDaysThreshold) continue
    rows.push({
      itemId: it.id, nameAr: it.nameAr, stockQty: it.stockQty,
      stockValueMinor: Math.round(it.costMinor * it.stockQty),
      lastSoldDate: last ? last.slice(0, 10) : null,
      idleDays: last ? idleDays : -1, // -1 = لم يُبع قط (تعرضها الواجهة «لم يُبع»)
    })
  }
  return rows.sort((a, b) => b.stockValueMinor - a.stockValueMinor)
}

/* ─── 2.5-ب) ركود الأصناف على مستوى التركيبة لون×مقاس (فجوة فورية ③ —
   نشاط الملابس): صنف "متحرك" ككل قد يُخفي تركيبة (لون/مقاس) راكدة تماماً
   لأشهر بينما تركيبات أخرى من نفس الصنف تُباع بانتظام — `stagnantItems`
   أعلاه لا ينزل لهذا المستوى، فهذا التقرير مكمِّل له لا بديل عنه. ─── */

export interface StagnantVariantRow {
  itemId: number
  nameAr: string
  color: string
  size: string
  qty: number
  stockValueMinor: Minor
  lastSoldDate: string | null
  idleDays: number
}

/**
 * تركيبات لون/مقاس راكدة: لها رصيد في المصفوفة الفرعية (`variantStocks`) ولم
 * تُبع خلال آخر idleDaysThreshold يوماً — بصرف النظر عن حالة الصنف ككل.
 */
export function stagnantVariants(
  items: readonly { id: number; nameAr: string; costMinor: Minor; isActive: boolean; isService?: boolean }[],
  variantStocks: readonly { itemId: number; color: string; size: string; qty: number }[],
  sales: readonly SaleDoc[],
  todayIso: string,
  idleDaysThreshold = 30,
): StagnantVariantRow[] {
  const lastSoldByVariant = new Map<string, string>()
  for (const s of sales) {
    for (const l of s.lines) {
      if (!l.variantColor && !l.variantSize) continue
      const key = `${l.itemId}⁞${(l.variantColor ?? '').trim()}⁞${(l.variantSize ?? '').trim()}`
      const prev = lastSoldByVariant.get(key)
      if (!prev || s.date > prev) lastSoldByVariant.set(key, s.date)
    }
  }
  const today = new Date(todayIso.slice(0, 10) + 'T00:00:00Z').getTime()
  const itemById = new Map(items.map((it) => [it.id, it]))
  const rows: StagnantVariantRow[] = []
  for (const v of variantStocks) {
    if (v.qty <= 0) continue
    const item = itemById.get(v.itemId)
    if (!item || !item.isActive || item.isService) continue
    const key = `${v.itemId}⁞${v.color.trim()}⁞${v.size.trim()}`
    const last = lastSoldByVariant.get(key) ?? null
    const refTime = last ? new Date(last.slice(0, 10) + 'T00:00:00Z').getTime() : 0
    const idleDays = last ? Math.floor((today - refTime) / 86_400_000) : Number.MAX_SAFE_INTEGER
    if (idleDays < idleDaysThreshold) continue
    rows.push({
      itemId: v.itemId, nameAr: item.nameAr, color: v.color, size: v.size, qty: v.qty,
      stockValueMinor: Math.round(item.costMinor * v.qty),
      lastSoldDate: last ? last.slice(0, 10) : null,
      idleDays: last ? idleDays : -1,
    })
  }
  return rows.sort((a, b) => b.stockValueMinor - a.stockValueMinor)
}

/* ─── 2.5-ج) تحليل منحنى المقاسات Size Curve Analysis (تطوير مستقبلي ② —
   نشاط الملابس): نسبة مبيعات كل مقاس من إجمالي مبيعات الصنف خلال الفترة،
   تُرشد قرار الشراء القادم (اطلب تشكيلة مقاسات تعكس ما يُباع فعلياً لا توزيعاً
   عشوائياً متساوياً). مبني فوق سطور البيع التي تحمل `variantSize` فعلاً. ─── */

export interface SizeCurveRow {
  itemId: number
  nameAr: string
  size: string
  soldQty: number
  /** نسبة هذا المقاس من إجمالي ما بيع من الصنف (كل المقاسات) خلال الفترة */
  sharePercent: number
}

export function sizeCurveAnalysis(
  items: readonly { id: number; nameAr: string; isActive: boolean }[],
  sales: readonly SaleDoc[],
  fromDate?: string,
  toDate?: string,
): SizeCurveRow[] {
  const soldBySize = new Map<string, number>() // itemId⁞size → كمية
  const totalByItem = new Map<number, number>()
  for (const s of sales) {
    if (fromDate && s.date < fromDate) continue
    if (toDate && s.date > toDate) continue
    for (const l of s.lines) {
      const size = (l.variantSize ?? '').trim()
      if (!size) continue
      const key = `${l.itemId}⁞${size}`
      soldBySize.set(key, (soldBySize.get(key) ?? 0) + l.qty)
      totalByItem.set(l.itemId, (totalByItem.get(l.itemId) ?? 0) + l.qty)
    }
  }
  const itemById = new Map(items.map((it) => [it.id, it]))
  const rows: SizeCurveRow[] = []
  for (const [key, qty] of soldBySize) {
    const sep = key.lastIndexOf('⁞')
    const itemId = Number(key.slice(0, sep))
    const size = key.slice(sep + 1)
    const item = itemById.get(itemId)
    if (!item || !item.isActive) continue
    const total = totalByItem.get(itemId) ?? 0
    rows.push({
      itemId, nameAr: item.nameAr, size,
      soldQty: Math.round(qty * 1000) / 1000,
      sharePercent: total > 0 ? Math.round((qty / total) * 10000) / 100 : 0,
    })
  }
  return rows.sort((a, b) => a.itemId - b.itemId || b.sharePercent - a.sharePercent)
}

/* ─── 2.6) تحليل أسباب الإرجاع (سد فجوة توثيق — دليل الأغذية الداخلي كان
   يَعِد المستخدم بهذا التقرير دون أن يكون موجوداً فعلياً في الواجهة) ───
   يجمع مرتجعات المبيعات حسب سبب الإرجاع الموحَّد (RETURN_REASONS)، فيُظهر
   أكثر الأسباب تكراراً وقيمتها — مثال الاستخدام المذكور في الدليل:
   «تكرار منتهي الصلاحية يعني خللاً في تدوير الأرفف». */

export interface ReturnReasonDoc {
  id: number
  date: string
  reasonCode?: string
  totals: { totalMinor: Minor }
  lines: readonly { condition?: 'resellable' | 'damaged' }[]
}

export interface ReturnReasonRow {
  reasonCode: string
  nameAr: string
  count: number // عدد مستندات المرتجع بهذا السبب
  totalValueMinor: Minor
  damagedLines: number
  resellableLines: number
}

/**
 * ملخص أسباب الإرجاع ضمن فترة — مرتب بالأكثر تكراراً أولاً.
 * reasonName: دالة اسم السبب بالعربية (RETURN_REASONS.returnReasonName) —
 * تُمرَّر كوسيط لا تُستورد مباشرة فتبقى هذه الوحدة خالصة بلا اعتماد إضافي.
 */
export function returnReasonsSummary(
  returns: readonly ReturnReasonDoc[],
  p: Period,
  reasonName: (code: string) => string,
): ReturnReasonRow[] {
  const map = new Map<string, ReturnReasonRow>()
  for (const r of returns) {
    if (!inPeriod(r.date, p)) continue
    const code = r.reasonCode ?? 'unspecified'
    const row = map.get(code) ?? {
      reasonCode: code,
      nameAr: r.reasonCode ? reasonName(code) : 'غير محدد (سجل قديم)',
      count: 0, totalValueMinor: 0, damagedLines: 0, resellableLines: 0,
    }
    row.count += 1
    row.totalValueMinor += r.totals.totalMinor
    for (const l of r.lines) {
      if (l.condition === 'damaged') row.damagedLines += 1
      else if (l.condition === 'resellable') row.resellableLines += 1
    }
    map.set(code, row)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/* ─── توقع طلب إحصائي (سد فجوة «مستقبلية»: تنبؤ ذكاء اصطناعي) ───
   هذا ليس نموذج تعلّم آلة حقيقياً — متوسط متحرك باتجاه خطي بسيط يعمل
   محلياً بالكامل بلا أي اتصال سحابي. أداة استرشادية تكمّل أمر الشراء
   اليدوي ولا تحل محل قرار المالك. */

export interface DemandForecastRow {
  itemId: number
  nameAr: string
  /** متوسط الكمية المباعة أسبوعياً خلال فترة الرصد */
  avgWeeklyQty: number
  /** نسبة تغيّر النصف الأحدث من الفترة عن النصف الأقدم — موجب = طلب صاعد */
  trendPercent: number
  /** توقع الأسبوع القادم (امتداد خطي للاتجاه، لا يقل عن صفر) */
  forecastNextWeekQty: number
}

export function demandForecast(
  sales: readonly SaleDoc[],
  todayIso: string,
  lookbackWeeks = 8,
): DemandForecastRow[] {
  const today = new Date(todayIso.slice(0, 10) + 'T00:00:00Z').getTime()
  const weekMs = 7 * 86_400_000
  const startTime = today - lookbackWeeks * weekMs
  const perItem = new Map<number, { nameAr: string; buckets: number[] }>()
  for (const s of sales) {
    const t = new Date(s.date.slice(0, 10) + 'T00:00:00Z').getTime()
    if (t < startTime || t > today) continue
    const weekIdx = Math.min(lookbackWeeks - 1, Math.max(0, Math.floor((t - startTime) / weekMs)))
    for (const l of s.lines) {
      const row = perItem.get(l.itemId) ?? { nameAr: l.nameAr, buckets: new Array(lookbackWeeks).fill(0) }
      row.buckets[weekIdx] += l.qty
      perItem.set(l.itemId, row)
    }
  }
  const rows: DemandForecastRow[] = []
  const half = Math.floor(lookbackWeeks / 2)
  for (const [itemId, { nameAr, buckets }] of perItem) {
    const total = buckets.reduce((a, b) => a + b, 0)
    if (total <= 0) continue
    const avgWeeklyQty = Math.round((total / lookbackWeeks) * 100) / 100
    const olderAvg = buckets.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half)
    const recentAvg = buckets.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, lookbackWeeks - half)
    const trendPercent = olderAvg > 0 ? Math.round(((recentAvg - olderAvg) / olderAvg) * 1000) / 10 : (recentAvg > 0 ? 100 : 0)
    const forecastNextWeekQty = Math.max(0, Math.round((recentAvg + (recentAvg - olderAvg)) * 100) / 100)
    rows.push({ itemId, nameAr, avgWeeklyQty, trendPercent, forecastNextWeekQty })
  }
  return rows.sort((a, b) => b.forecastNextWeekQty - a.forecastNextWeekQty)
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
  returns: (SaleReturnDoc & { refund: PaymentMethod | 'store_credit' | 'custom'; creditRefundMinor?: Minor })[],
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
    // الجزء المخفِّض للذمة فقط (الرد الهجين R1 وإيداع الرصيد G2) — سجلات قديمة: كامل مرتجع «على الحساب»
    const cid = saleCustomer.get(r.saleId)
    if (cid == null) continue
    const creditPart = r.creditRefundMinor ?? (r.refund === 'credit' || r.refund === 'store_credit' ? r.totals.totalMinor : 0)
    if (creditPart > 0) row(cid).returnedMinor += creditPart
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

/* ─── 7.5) إيراد الفترة من دفتر اليومية — مصدر واحد لكل الأنشطة ─── */

export interface RevenueRow {
  accountCode: string
  nameAr: string
  /** صافي الإيراد (دائن − مدين) — موجب دائماً في العرض */
  amountMinor: Minor
  /** وحدة العمل التي تملك هذا الحساب (فارغ = إيراد عام) */
  module: string | null
  /** اسم القسم كما يراه صاحب النشاط */
  moduleNameAr: string | null
}

export interface JournalLike {
  date: string
  sourceType?: string
  lines: readonly { accountCode: string; debit: Minor; credit: Minor }[]
}

/**
 * إيراد الفترة من اليومية — يشمل **كل** الأنشطة والوحدات المطعَّمة.
 *
 * لماذا هذه الدالة (تدقيق 2026-10-11): بطاقات مركز التقارير كانت تُبنى من
 * `salesSummary` التي تقرأ مستندات البيع فقط، وهي لا تُنشأ إلا من الكاشير.
 * فالنشاط الذي يبيع بمحركه التخصصي (معمل، عيادة، لوجستيات، مقاولات، عقارات،
 * مغسلة، إيجار معدات، سيارات) كان يرى «صفر مبيعات» وله إيراد حقيقي في اليومية.
 *
 * القاعدة: نطاق الإيراد = الحسابات التي **جذرها** `revenue` في الشجرة القياسية
 * أو المخصصة (4xxx) — لا الحسابات المقابلة (خزينة/عملاء) ولا الضريبة (2102).
 * قيود إقفال السنة مستثناة (عكسها لا يمثل أداءً).
 *
 * التوزيع على الأقسام: الحساب قد يخص أكثر من وحدة في الخريطة (4103 صيانة/مغسلة/
 * محافظ/كاشير…)، فنعتمد **وحدات النشاط المفعّلة فعلاً** كمرشّح حاسم: التقاطع بين
 * وحدات الحساب والوحدات المفعّلة هو القسم الحقيقي؛ فإن بقي أكثر من مرشّح (وحدة
 * نواة ووحدة تخصصية معاً) قُدِّم التخصصي لأنه الأقرب لسياق النشاط.
 *
 * @param journal دفتر اليومية
 * @param p الفترة
 * @param opts extraNames: أسماء الحسابات المخصصة · customRevenueCodes: أكواد مخصصة جذرها إيراد ·
 *             moduleOf: خريطة حساب←وحدة (من ACCOUNT_MODULE_MAP) · moduleNames: أسماء الوحدات للعرض ·
 *             activeModules: وحدات النشاط المفعّلة (لحل تعدد المالكين) · excludeEntryIds: قيود تُستثنى
 */
export function activityRevenueRows(
  journal: readonly JournalLike[],
  p: Period,
  opts: {
    extraNames?: Readonly<Record<string, string>>
    customRevenueCodes?: ReadonlySet<string>
    moduleOf?: Readonly<Record<string, readonly string[]>>
    moduleNames?: Readonly<Record<string, string>>
    activeModules?: readonly string[]
    /** ترتيب الأفضلية عند تعدد المرشحين (التخصصي قبل وحدة النواة) — الأخير أولاً */
    coreModules?: readonly string[]
    excludeEntryIds?: ReadonlySet<number>
  } = {},
): { rows: RevenueRow[]; totalMinor: Minor } {
  const isRevenue = (code: string): boolean => {
    if (opts.customRevenueCodes?.has(code)) return true
    const root = code[0]
    return root === '4'
  }
  const tot = new Map<string, Minor>()
  for (const e of journal) {
    if (!inPeriod(e.date, p)) continue
    for (const l of e.lines) {
      if (!isRevenue(l.accountCode)) continue
      tot.set(l.accountCode, (tot.get(l.accountCode) ?? 0) + (l.credit - l.debit))
    }
  }
  const rows: RevenueRow[] = [...tot.entries()]
    .filter(([, v]) => v !== 0)
    .map(([code, v]) => {
      const owners = opts.moduleOf?.[code] ?? null
      let mod: string | null = null
      if (owners?.length) {
        const active = opts.activeModules
        const candidates = active?.length ? owners.filter((m) => active.includes(m)) : owners
        if (candidates.length === 1) mod = candidates[0]
        else if (candidates.length > 1) {
          // التخصصي قبل وحدة النواة: 4103 داخل (كاشير + مغسلة) = «المغسلة» لا «الكاشير»
          const core = opts.coreModules ?? []
          mod = [...candidates].sort((a, b) => Number(core.includes(a)) - Number(core.includes(b)))[0]
        }
      }
      return {
        accountCode: code,
        nameAr: opts.extraNames?.[code] ?? code,
        amountMinor: v,
        module: mod,
        moduleNameAr: mod ? (opts.moduleNames?.[mod] ?? mod) : null,
      }
    })
    .sort((a, b) => b.amountMinor - a.amountMinor)
  return { rows, totalMinor: rows.reduce((a, r) => a + r.amountMinor, 0) }
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
