/**
 * أوامر التجهيز والتفكيك (جزارة اللحوم 🥩 + فرز وتعبئة التمور 🌴) — نواة خالصة
 * ============================================================================
 * عكس وصفات المطاعم: هناك «خامات متعددة → منتج واحد»، وهنا «خام واحد → نواتج متعددة»:
 *   - الجزارة: ذبيحة كاملة → (فخذ، ريش، مفروم، كبدة…) + فاقد تقطيع (عظم/شحم مستبعد)
 *   - التمور: محصول خام → (سكري فاخر، وسط، تصنيع، عبوات هدايا…) + فاقد فرز (نوى/تالف)
 *
 * التكلفة (المعيار العالمي في برامج الجزارة والتعبئة — joint cost allocation):
 * تكلفة الخام الكاملة توزَّع على النواتج القابلة للبيع فقط **بنسبة قيمها البيعية**
 * (سعر البيع × الكمية الناتجة) — فالفخذ يتحمل أكثر من العظم المفروم،
 * والسكري الفاخر يتحمل أكثر من تمر التصنيع. الفاقد لا يحمل تكلفة —
 * تكلفته تذوب في النواتج فترتفع تكلفتها للكيلو تلقائياً (وهذا هو الصحيح اقتصادياً).
 *
 * القيد: 1103 مدين (قيمة النواتج الداخلة = تكلفة الخام + مصاريف التجهيز) /
 *        1103 دائن (قيمة الخام الخارج) + خزينة دائن (مصاريف تجهيز إن وجدت)
 * — تحويل داخل المخزون فيبقى الدفتر مطابقاً لرصيد المخزون بالقرش.
 *
 * التوثيق السعودي (اشتراطات SFDA لبطاقة اللحوم + سوق التمور):
 * أمر التجهيز يوثق: بلد المنشأ، رقم المسلخ/المنشأة، شهادة الحلال، تاريخ الذبح
 * (للجزارة) أو موسم المحصول وسنة الجني (للتمور) — تظهر في السجل والمطبوعة.
 */
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import type { Minor } from './money.ts'

/* ─── الأنواع ─── */

export type ProcessingKind = 'butcher' | 'dates'

/** ناتج واحد من أمر التجهيز */
export interface ProcessingOutput {
  itemId: number
  /** الكمية الناتجة (كجم عادةً) */
  qty: number
}

export interface ProcessingOutputCosted extends ProcessingOutput {
  /** نصيب الناتج من التكلفة الكلية (خام + مصاريف) — Minor */
  allocatedCostMinor: Minor
  /** تكلفة الوحدة الجديدة للناتج (allocated ÷ qty مقربة) */
  unitCostMinor: Minor
}

/** توثيق سعودي/غذائي لأمر التجهيز (SFDA) — كله اختياري كبقية بيانات النظام */
export interface ProcessingCompliance {
  /** بلد المنشأ — «السعودية»، «الصومال»… */
  originCountry: string
  /** رقم المسلخ أو منشأة التعبئة المسجل لدى SFDA */
  facilityNo: string
  /** رقم/جهة شهادة الحلال (للحوم المستوردة خاصة) */
  halalCert: string
  /** تاريخ الذبح (جزارة) أو تاريخ الجني (تمور) YYYY-MM-DD */
  productionDate: string
  /** موسم المحصول للتمور — «موسم 1447هـ / صيف 2026» */
  season: string
}

export const EMPTY_COMPLIANCE: ProcessingCompliance = {
  originCountry: '', facilityNo: '', halalCert: '', productionDate: '', season: '',
}

export interface ProcessingOrder {
  id: number
  orderNumber: string // CUT-0001 | PKG-0001
  refCode: string
  date: string // ISO
  kind: ProcessingKind
  /** الخام المستهلك (ذبيحة/محصول) */
  sourceItemId: number
  sourceQty: number
  /** مخزن صرف الخام ومخزن استلام النواتج — يظلان قابلين للتدقيق لكل نشاط */
  sourceWarehouseId?: number | null
  outputWarehouseId?: number | null
  /** تكلفة الخام المستهلكة = costMinor × qty لحظة التنفيذ */
  sourceCostMinor: Minor
  /** مصاريف تجهيز نقدية (عمالة تقطيع/تعبئة/كراتين) تدخل تكلفة النواتج */
  overheadMinor: Minor
  treasury: string | null // خزينة المصاريف إن وجدت
  outputs: ProcessingOutputCosted[]
  /** الفاقد الموثق كمياً (عظم مستبعد/نوى/تالف) — لا يحمل تكلفة */
  wasteQty: number
  compliance: ProcessingCompliance
  journalEntryId: number
  notes: string
}

export interface ProcessingInput {
  kind: ProcessingKind
  sourceItemId: number
  sourceQty: number
  sourceWarehouseId?: number | null
  outputWarehouseId?: number | null
  allowNegativeSource?: boolean
  outputs: ProcessingOutput[]
  overheadMinor: Minor
  treasury?: string
  wasteQty?: number
  compliance?: Partial<ProcessingCompliance>
  notes?: string
}

/* ─── التحقق ─── */

export function validateProcessing(
  input: Pick<ProcessingInput, 'sourceQty' | 'outputs' | 'overheadMinor' | 'wasteQty'>,
): string[] {
  const errors: string[] = []
  if (!(input.sourceQty > 0)) errors.push('كمية الخام يجب أن تكون أكبر من صفر')
  if (input.outputs.length === 0) errors.push('أضف ناتجاً واحداً على الأقل (أجزاء التقطيع أو درجات الفرز)')
  if (input.outputs.some((o) => !(o.qty > 0))) errors.push('كل ناتج يجب أن تكون كميته أكبر من صفر')
  const ids = input.outputs.map((o) => o.itemId)
  if (new Set(ids).size !== ids.length) errors.push('لا يتكرر نفس الصنف الناتج في الأمر الواحد')
  if (!Number.isInteger(input.overheadMinor) || input.overheadMinor < 0) errors.push('مصاريف التجهيز يجب أن تكون صفراً أو أكثر')
  if ((input.wasteQty ?? 0) < 0) errors.push('الفاقد لا يكون سالباً')
  return errors
}

/* ─── توزيع التكلفة بالقيمة البيعية النسبية ─── */

/**
 * يوزع (تكلفة الخام + المصاريف) على النواتج بنسبة قيمها البيعية
 * (سعر بيع الوحدة × الكمية). لو كل الأسعار أصفار → توزيع بالكميات.
 * التقريب بأسلوب «الباقي للأكبر»: يوزع بالتقريب لأسفل ثم تُضاف بقايا
 * القروش واحداً واحداً لأكبر النواتج قيمةً — فالمجموع يطابق الكلية بالقرش دائماً.
 */
export function allocateProcessingCost(
  outputs: readonly ProcessingOutput[],
  totalCostMinor: Minor,
  priceOf: (itemId: number) => Minor,
): ProcessingOutputCosted[] {
  const weights = outputs.map((o) => {
    const w = Math.round(priceOf(o.itemId) * o.qty)
    return w > 0 ? w : 0
  })
  let sumW = weights.reduce((a, v) => a + v, 0)
  // كل الأسعار صفر ⇒ التوزيع بالكمية
  const effWeights = sumW > 0 ? weights : outputs.map((o) => Math.round(o.qty * 1000))
  sumW = effWeights.reduce((a, v) => a + v, 0)
  if (sumW <= 0) throw new Error('تعذر توزيع التكلفة — كل الأوزان صفرية')
  const floors = effWeights.map((w) => Math.floor((totalCostMinor * w) / sumW))
  let remainder = totalCostMinor - floors.reduce((a, v) => a + v, 0)
  // بقايا القروش للأكبر وزناً أولاً
  const order = effWeights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w)
  const alloc = [...floors]
  for (const { i } of order) {
    if (remainder <= 0) break
    alloc[i] += 1
    remainder -= 1
  }
  return outputs.map((o, i) => ({
    ...o,
    allocatedCostMinor: alloc[i],
    unitCostMinor: o.qty > 0 ? Math.round(alloc[i] / o.qty) : 0,
  }))
}

/* ─── قيد أمر التجهيز ─── */

/**
 * 1103 مدين بقيمة النواتج (خام + مصاريف) / 1103 دائن بالخام + خزينة دائن بالمصاريف.
 * لو المصاريف صفر: القيد سطران متساويان (تحويل مخزون صرف).
 */
export function buildProcessingEntry(
  sourceCostMinor: Minor,
  overheadMinor: Minor,
  treasury: string,
): JournalLine[] {
  const totalIn = sourceCostMinor + overheadMinor
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: totalIn, credit: 0, note: 'نواتج التجهيز تدخل المخزون' },
    { accountCode: '1103', debit: 0, credit: sourceCostMinor, note: 'الخام المستهلك يخرج من المخزون' },
  ]
  if (overheadMinor > 0) lines.push({ accountCode: treasury, debit: 0, credit: overheadMinor, note: 'مصاريف تجهيز (عمالة/تعبئة)' })
  assertBalanced(lines)
  return lines
}

/* ─── مؤشرات التشغيل ─── */

/**
 * نسبة التصافي (Yield %): مجموع كميات النواتج ÷ كمية الخام.
 * الجزارة العالمية تراقبها ذبيحةً بذبيحة (لحم غنم ~50-55%، عجل ~55-60%)،
 * ومحطات التمور تراقب نسب الدرجات لكل موسم.
 */
export function processingYieldPercent(order: Pick<ProcessingOrder, 'sourceQty' | 'outputs'>): number {
  if (!(order.sourceQty > 0)) return 0
  const outQty = order.outputs.reduce((a, o) => a + o.qty, 0)
  return Math.round((outQty / order.sourceQty) * 1000) / 10
}

export const PROCESSING_KIND_LABELS: Record<ProcessingKind, {
  nameAr: string; icon: string; orderPrefix: 'CUT' | 'PKG'; sourceLabel: string; outputLabel: string; wasteLabel: string; dateLabel: string
}> = {
  butcher: {
    nameAr: 'أمر تقطيع ذبيحة', icon: '🔪', orderPrefix: 'CUT',
    sourceLabel: 'الذبيحة / الخام', outputLabel: 'الأجزاء الناتجة', wasteLabel: 'فاقد التقطيع (عظم/شحم مستبعد)',
    dateLabel: 'تاريخ الذبح',
  },
  dates: {
    nameAr: 'أمر فرز وتعبئة', icon: '🌴', orderPrefix: 'PKG',
    sourceLabel: 'المحصول الخام', outputLabel: 'الدرجات والعبوات الناتجة', wasteLabel: 'فاقد الفرز (نوى/تالف)',
    dateLabel: 'تاريخ الجني',
  },
}
