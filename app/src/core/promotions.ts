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

/**
 * F9 — قاعدة كمّية لصنف واحد: «اشترِ N واحصل على M مجاناً» (2+1، 3+1…).
 * تعبيرها النقدي: سعر N وحدات يُغطّي N+M وحدة — لا سطر بسعر صفر، فلا تنكسر
 * حماية «سعر صفر» ولا أرضية السعر، والتكلفة والمخزون يمران بالمسار المعتاد.
 */
export interface QuantityRule {
  itemId: number
  /** عدد الوحدات المدفوعة في كل دورة */
  buyQty: number
  /** عدد الوحدات المجانية في كل دورة */
  freeQty: number
}

export interface Promotion {
  id: number
  nameAr: string // «عرض رمضان»، «باقة الإفطار»
  /** bundle (افتراضي) = باقة عدة أصناف بسعر موحد · quantity = «N + M مجاناً» */
  kind?: 'bundle' | 'quantity'
  components: PromotionComponent[]
  /** سعر الباقة الواحدة (شامل كل مكوناتها) */
  bundlePriceMinor: Minor
  /** قاعدة الكمية — تُستخدم حين kind = 'quantity' */
  quantityRule?: QuantityRule | null
  /** F4: اعتماد مسبق للبيع تحت التكلفة (loss leader) على مستوى العرض لا الفاتورة */
  belowCostApprovedBy?: string | null
  belowCostApprovedAt?: string | null
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
  /**
   * F4: الإنشاء/التعديل يسمح بحفظ عرض خاسر **بانتظار اعتماد المالك** (لا يُباع قبل
   * الاعتماد). بدونه كانت الحلقة مستحيلة: لا اعتماد بلا عرض، ولا عرض بلا اعتماد.
   */
  options: { allowPendingApproval?: boolean } = {},
): string[] {
  const errors: string[] = []
  const name = input.nameAr.trim()
  if (!name) errors.push('اسم العرض مطلوب')
  if (existing.some((p) => p.nameAr === name && p.id !== editingId)) errors.push('يوجد عرض بهذا الاسم')
  if (input.startIso && input.endIso && input.endIso < input.startIso) errors.push('نهاية العرض قبل بدايته')

  /* ① قاعدة كمّية «N + M مجاناً» (F9) */
  if (input.kind === 'quantity') {
    const rule = input.quantityRule
    if (!rule) { errors.push('قاعدة الكمية مطلوبة — اختر الصنف وعدد الوحدات المدفوعة والمجانية'); return errors }
    const it = items.find((x) => x.id === rule.itemId)
    if (!it) { errors.push('صنف القاعدة غير موجود — أعد اختياره'); return errors }
    if (!Number.isInteger(rule.buyQty) || rule.buyQty < 1) errors.push(`«${it.nameAr}»: عدد الوحدات المدفوعة عدد صحيح ≥ 1`)
    if (!Number.isInteger(rule.freeQty) || rule.freeQty < 1) errors.push(`«${it.nameAr}»: عدد الوحدات المجانية عدد صحيح ≥ 1`)
    if (rule.buyQty + rule.freeQty > 100) errors.push('دورة العرض أكبر من 100 وحدة — راجع الأرقام')
    if (!it.isActive) errors.push(`«${it.nameAr}» معطل — فعّله أو استبدله`)
    if (it.trackSerial) errors.push(`«${it.nameAr}» يتتبع السيريال — لا يدخل العروض`)
    if (it.soldByWeight) errors.push(`«${it.nameAr}» يُباع بالوزن — العروض للسلع القياسية`)
    if (hasVariants(rule.itemId)) errors.push(`«${it.nameAr}» موزع على تركيبات لون/مقاس — لا يدخل العروض`)
    if (errors.length === 0) {
      const bundle = promotionAsBundle({ ...input, kind: 'quantity' }, items)
      const unitPrice = it.priceMinor
      if (unitPrice <= 0) errors.push(`«${it.nameAr}» بلا سعر بيع — لا تُبنى قاعدة كمية على سعر صفر`)
      const floor = it.minSalePriceMinor ?? 0
      if (floor > 0 && bundle.bundlePriceMinor / (rule.buyQty + rule.freeQty) < floor - 0.5) {
        errors.push(`قاعدة «${rule.buyQty}+${rule.freeQty}» تهبط بسعر الوحدة تحت حد «${it.nameAr}» الأدنى — عدّل الحد أو القاعدة`)
      }
      /* التكلفة تُقارن بتكلفة كل وحدات الدورة، لا بسعر الوحدة: «2+1» على سعر 10.00
         وتكلفة 9.00 تبيع الوحدة فعلياً بـ 6.67 — أي تحت التكلفة بفارق كبير. */
      const belowCost = bundle.bundlePriceMinor < it.costMinor * (rule.buyQty + rule.freeQty)
      if (belowCost && !input.belowCostApprovedBy && !options.allowPendingApproval) {
        errors.push(`قاعدة كمّية على «${it.nameAr}» بسعر لا يغطي تكلفة وحداتها — تحتاج اعتماداً على مستوى العرض (F4)`)
      }
      /* العرض الخاسر يجب أن يكون محدَّد النهاية كي لا يبقى اعتماد مفتوحاً للأبد */
      if (belowCost && !input.belowCostApprovedBy && options.allowPendingApproval && !input.endIso) {
        errors.push('عرض يبيع تحت التكلفة يحتاج نهاية سريان محددة — اعتماد بلا حد زمني مرفوض')
      }
    }
    return errors
  }

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


/** هل العرض قاعدة كمّية سارية التعريف؟ (كل التحقق في validatePromotion) */
export function isQuantityPromotion(p: Pick<Promotion, 'kind' | 'quantityRule'>): boolean {
  return p.kind === 'quantity' && p.quantityRule != null
}

/**
 * صورة العرض كباقة مكافئة: قاعدة «N + M مجاناً» = مكوّن واحد بكمية N+M وبسعر
 * N × سعر الوحدة. هذا يحوّل كل التوزيع والتقريب والتكلفة إلى مسار الباقات نفسه،
 * فلا يوجد مساران للحساب (ومساران يعنيان رقماً يختلف بين الكاشير والدفتر).
 */
export function promotionAsBundle(
  p: Pick<Promotion, 'kind' | 'components' | 'bundlePriceMinor' | 'quantityRule'>,
  items: readonly Pick<Item, 'id' | 'priceMinor'>[],
): { components: PromotionComponent[]; bundlePriceMinor: Minor; perCycleRetailMinor: Minor } {
  const rule = p.quantityRule
  if (!isQuantityPromotion(p) || !rule) {
    return { components: p.components, bundlePriceMinor: p.bundlePriceMinor, perCycleRetailMinor: 0 }
  }
  const unit = items.find((it) => it.id === rule.itemId)?.priceMinor ?? 0
  const totalUnits = rule.buyQty + rule.freeQty
  return {
    components: [{ itemId: rule.itemId, qty: totalUnits }],
    bundlePriceMinor: unit * rule.buyQty,
    perCycleRetailMinor: unit * totalUnits,
  }
}

/**
 * هل سعر العرض لا يغطي تكلفة وحداته؟ (سؤال واحد يجيب عنه مكان واحد)
 * يُستخدم في التحقق، وفي منع بيع عرض خاسر قبل اعتماده، وفي شارات الشاشات.
 */
export function promotionBelowCost(
  p: Pick<Promotion, 'kind' | 'components' | 'bundlePriceMinor' | 'quantityRule'>,
  items: readonly Pick<Item, 'id' | 'priceMinor' | 'costMinor'>[],
): boolean {
  const shape = promotionAsBundle(p, items)
  let cost = 0
  for (const c of shape.components) {
    const it = items.find((x) => x.id === c.itemId)
    if (!it) return false
    cost += it.costMinor * c.qty
  }
  return cost > shape.bundlePriceMinor
}

/**
 * F4 — اعتماد «البائع بخسارة» (loss leader) على مستوى العرض لا الفاتورة:
 * عرض سارٍ ومعتمد مسبقاً باسم من اعتمده يُغطّي أصنافه فيُمرَّر بيعها تحت الحد/التكلفة
 * بلا طلب اعتماد مدير عند كل فاتورة. أي صنف خارج عروض معتمدة يبقى محكوماً بالاعتماد
 * الفوري كما كان — لا توسيع للحماية، بل نقل قرار تجاري معروف إلى مكانه الصحيح.
 */
export function lossLeaderApprovedItems(
  promotions: readonly Pick<Promotion, 'kind' | 'components' | 'bundlePriceMinor' | 'quantityRule' | 'isActive' | 'startIso' | 'endIso' | 'belowCostApprovedBy'>[],
  todayIso: string,
): Set<number> {
  const covered = new Set<number>()
  for (const p of promotions) {
    if (!p.belowCostApprovedBy) continue
    if (!promotionActiveOn(p, todayIso)) continue
    for (const c of promotionAsBundle(p, []).components) covered.add(c.itemId)
  }
  return covered
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
export function promotionRetailMinor(
  p: Pick<Promotion, 'components' | 'kind' | 'quantityRule' | 'bundlePriceMinor'>,
  items: readonly Pick<Item, 'id' | 'priceMinor'>[],
): Minor {
  const bundle = promotionAsBundle(p, items)
  return bundle.components.reduce((s, c) => s + (items.find((it) => it.id === c.itemId)?.priceMinor ?? 0) * c.qty, 0)
}

/** وفر الباقة الواحدة = تجزئة − سعر الباقة (قد يكون صفراً أو سالباً لو سُعّرت خطأً) */
export function promotionSavingsMinor(
  p: Pick<Promotion, 'components' | 'kind' | 'quantityRule' | 'bundlePriceMinor'>,
  items: readonly Pick<Item, 'id' | 'priceMinor'>[],
): Minor {
  return promotionRetailMinor(p, items) - promotionAsBundle(p, items).bundlePriceMinor
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
  p: Pick<Promotion, 'nameAr' | 'components' | 'bundlePriceMinor' | 'kind' | 'quantityRule'>,
  count: number,
  items: readonly Pick<Item, 'id' | 'nameAr' | 'priceMinor' | 'costMinor' | 'vatOverride'>[],
): CartLine[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('عدد الباقات عدد صحيح ≥ 1')
  /* القاعدة الكمية تُحوَّل إلى باقة مكافئة أولاً — مسار حساب واحد للعرضين */
  const shape = promotionAsBundle(p, items)
  const comps = shape.components.map((c) => {
    const it = items.find((x) => x.id === c.itemId)
    if (!it) throw new Error('مكوّن العرض غير موجود — راجع تعريف العرض')
    return { item: it, qty: c.qty * count, retail: it.priceMinor * c.qty * count }
  })
  const total = shape.bundlePriceMinor * count
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
