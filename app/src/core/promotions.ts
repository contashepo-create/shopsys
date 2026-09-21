/**
 * العروض الترويجية والباقات (سد فجوة برامج السوق المصرية/السعودية):
 * «اشترِ المجموعة بسعر واحد» — عرض من عدة أصناف بكميات محددة يُباع بسعر
 * موحد أقل من مجموع أسعار مكوناته، وتُخصم كميات المكونات من المخزون تلقائياً.
 *
 * الهندسة (نمط الوصفات نفسه — لا أثر على postSale):
 * العرض لا يدخل الدفاتر ككيان — عند اختياره في الكاشير يتحول لسطور بيع
 * عادية لمكوناته بأسعار موزعة نسبياً على قيمها الأصلية بحيث مجموعها
 * = سعر العرض بالقرش تماماً (توزيع الباقي الأكبر + شطر السطر عند كسر
 * القسمة) — فالمخزون والتكلفة والضريبة والقيد تمر كلها بالمسار المعتاد.
 *
 * قيود المكونات: لا سيريال ولا وزن ولا متغيرات (لون/مقاس) — العروض للسلع
 * القياسية؛ وسعر العرض لا يكسر أرضية سعر أي مكوّن (أرضية السعر قرار أعلى).
 */
import type { Minor } from './money.ts'
import type { CartLine } from './pos.ts'
import type { Item } from './items.ts'

export interface PromotionComponent {
  itemId: number
  /** كمية المكوّن داخل الباقة الواحدة — عدد صحيح ≥ 1 */
  qty: number
}

export interface Promotion {
  id: number
  nameAr: string // «عرض رمضان»، «باقة الإفطار»
  components: PromotionComponent[]
  /** سعر الباقة الواحدة (شامل كل مكوناتها) */
  bundlePriceMinor: Minor
  /** فترة السريان — '' = مفتوح من هذا الطرف */
  startIso: string
  endIso: string
  isActive: boolean
}

export interface PromotionInput extends Omit<Promotion, 'id'> {}

type ItemForPromo = Pick<Item, 'id' | 'nameAr' | 'priceMinor' | 'costMinor' | 'isActive' | 'isService' | 'trackSerial' | 'soldByWeight' | 'vatOverride' | 'minSalePriceMinor'>

export function validatePromotion(
  input: PromotionInput,
  existing: readonly Pick<Promotion, 'id' | 'nameAr'>[],
  items: readonly ItemForPromo[],
  hasVariants: (itemId: number) => boolean,
  editingId?: number,
): string[] {
  const errors: string[] = []
  const name = input.nameAr.trim()
  if (!name) errors.push('اسم العرض مطلوب')
  if (existing.some((p) => p.nameAr === name && p.id !== editingId)) errors.push('يوجد عرض بهذا الاسم')
  if (!Number.isInteger(input.bundlePriceMinor) || input.bundlePriceMinor <= 0) errors.push('سعر الباقة يجب أن يكون أكبر من صفر')
  if (input.components.length === 0) errors.push('أضف مكوّناً واحداً على الأقل')
  const seen = new Set<number>()
  let totalUnits = 0
  for (const c of input.components) {
    const it = items.find((x) => x.id === c.itemId)
    if (!it) { errors.push('مكوّن غير موجود — احذفه وأعد اختياره'); continue }
    if (seen.has(c.itemId)) errors.push(`«${it.nameAr}» مكرر — اجمع كميته في سطر واحد`)
    seen.add(c.itemId)
    if (!Number.isInteger(c.qty) || c.qty < 1) errors.push(`«${it.nameAr}»: الكمية عدد صحيح ≥ 1`)
    if (!it.isActive) errors.push(`«${it.nameAr}» معطل — فعّله أو استبدله`)
    if (it.trackSerial) errors.push(`«${it.nameAr}» يتتبع السيريال — لا يدخل العروض (كل قطعة معيّنة بذاتها)`)
    if (it.soldByWeight) errors.push(`«${it.nameAr}» يُباع بالوزن — العروض للسلع القياسية`)
    if (hasVariants(c.itemId)) errors.push(`«${it.nameAr}» موزع على تركيبات لون/مقاس — لا يدخل العروض`)
    totalUnits += Math.max(1, Math.floor(c.qty))
  }
  if (input.components.length === 1 && totalUnits < 2) {
    errors.push('عرض من صنف واحد بقطعة واحدة = سعر خاص — استخدم قوائم الأسعار لذلك')
  }
  if (input.startIso && input.endIso && input.endIso < input.startIso) errors.push('نهاية العرض قبل بدايته')
  // أرضية السعر قرار إداري أعلى من العرض: لا يُنشأ عرض يكسر حد أي مكوّن
  if (errors.length === 0) {
    const lines = promotionCartLines(input, 1, items)
    for (const l of lines) {
      const it = items.find((x) => x.id === l.itemId)
      const floor = it?.minSalePriceMinor ?? 0
      if (it && floor > 0 && l.unitPriceMinor < floor - 0.5) {
        errors.push(`سعر الباقة يهبط بـ«${it.nameAr}» تحت حده الأدنى للبيع — ارفع سعر الباقة أو عدّل حد الصنف`)
        break
      }
    }
  }
  return errors
}

/** هل العرض سارٍ في هذا اليوم؟ (معطل = لا؛ '' من أي طرف = مفتوح) */
export function promotionActiveOn(p: Pick<Promotion, 'isActive' | 'startIso' | 'endIso'>, todayIso: string): boolean {
  if (!p.isActive) return false
  const day = todayIso.slice(0, 10)
  if (p.startIso && day < p.startIso.slice(0, 10)) return false
  if (p.endIso && day > p.endIso.slice(0, 10)) return false
  return true
}

/** مجموع أسعار مكونات الباقة بأسعار التجزئة (لعرض الوفر للبائع) */
export function promotionRetailMinor(p: Pick<Promotion, 'components'>, items: readonly Pick<Item, 'id' | 'priceMinor'>[]): Minor {
  return p.components.reduce((s, c) => s + (items.find((it) => it.id === c.itemId)?.priceMinor ?? 0) * c.qty, 0)
}

/** وفر الباقة الواحدة = تجزئة − سعر الباقة (قد يكون صفراً أو سالباً لو سُعّرت خطأً) */
export function promotionSavingsMinor(p: Pick<Promotion, 'components' | 'bundlePriceMinor'>, items: readonly Pick<Item, 'id' | 'priceMinor'>[]): Minor {
  return promotionRetailMinor(p, items) - p.bundlePriceMinor
}

/**
 * تحويل «count» باقة إلى سطور سلة عادية:
 * 1) حصة كل مكوّن من سعر الباقة تُوزَّع نسبياً على قيمته بالتجزئة
 *    (الباقي الأكبر يضمن Σ الحصص = السعر الكلي بالقرش تماماً)؛
 * 2) حصة لا تُقسم على كميتها بلا باقٍ ⇒ يُشطر المكوّن لسطرين
 *    (n−r وحدة بسعر ⌊حصة/كمية⌋ + r وحدة بسعر أعلى بقرش) — كل الأسعار
 *    أعداد صحيحة والإجمالي مضبوط، فلا «فرق تقريب» يظهر في الفاتورة أبداً.
 */
export function promotionCartLines(
  p: Pick<Promotion, 'nameAr' | 'components' | 'bundlePriceMinor'>,
  count: number,
  items: readonly Pick<Item, 'id' | 'nameAr' | 'priceMinor' | 'costMinor' | 'vatOverride'>[],
): CartLine[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('عدد الباقات عدد صحيح ≥ 1')
  const comps = p.components.map((c) => {
    const it = items.find((x) => x.id === c.itemId)
    if (!it) throw new Error('مكوّن العرض غير موجود — راجع تعريف العرض')
    return { item: it, qty: c.qty * count, retail: it.priceMinor * c.qty * count }
  })
  const total = p.bundlePriceMinor * count
  const retailSum = comps.reduce((s, c) => s + c.retail, 0)
  const totalQty = comps.reduce((s, c) => s + c.qty, 0)
  // حصص بطريقة الباقي الأكبر — الوزن: القيمة بالتجزئة، وعند انعدامها الكميات
  const raw = comps.map((c) => (retailSum > 0 ? (total * c.retail) / retailSum : (total * c.qty) / totalQty))
  const base = raw.map((r) => Math.floor(r))
  let leftover = total - base.reduce((s, b) => s + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (leftover <= 0) break
    base[i] += 1
    leftover -= 1
  }
  const lines: CartLine[] = []
  comps.forEach((c, i) => {
    const share = base[i]
    const unit = Math.floor(share / c.qty)
    const rem = share - unit * c.qty
    const mk = (qty: number, priceMinor: number): CartLine => ({
      itemId: c.item.id,
      nameAr: `${c.item.nameAr} (${p.nameAr})`,
      qty,
      unitPriceMinor: priceMinor,
      unitCostMinor: c.item.costMinor,
      discountPercent: 0,
      soldByWeight: false,
      vatPercentOverride: c.item.vatOverride ?? undefined,
    })
    if (rem === 0) lines.push(mk(c.qty, unit))
    else {
      if (c.qty - rem > 0) lines.push(mk(c.qty - rem, unit))
      lines.push(mk(rem, unit + 1))
    }
  })
  return lines
}
