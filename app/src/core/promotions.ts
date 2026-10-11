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
import { mulQty, percentOf } from './money.ts'
import type { CartLine } from './pos.ts'
import type { Item } from './items.ts'

/**
 * أنواع العروض (تدقيق أكتوبر 2026 — سد فجوة Odoo/Lightspeed/Foodics):
 *  - bundle (الافتراضي، وغياب kind): باقة بسعر واحد يختارها الكاشير بزر 🎁 (كما كانت).
 *  - bogo: «اشترِ buyQty واحصل على getQty بخصم getDiscountPercent» (100 = مجاناً) على صنف واحد — تلقائي.
 *  - tier: شرائح كمية «من N قطعة خصم P٪» على صنف واحد — تلقائي.
 * العروض التلقائية لا تدخل الدفاتر ككيان: تُشتق من السلة لحظة الحساب وتتحول لسطور بيع
 * عادية (سطر مدفوع + سطر مخفَّض)، فالمخزون والتكلفة والضريبة والقيد تمر بالمسار المعتاد.
 * الجدولة (أيام الأسبوع + نافذة ساعات) تسري على كل الأنواع.
 */
export type PromotionKind = 'bundle' | 'bogo' | 'tier'

export interface PromotionTier {
  /** الحد الأدنى للكمية في السطر (يقبل كسراً للأصناف الموزونة) */
  minQty: number
  /** نسبة الخصم لهذه الشريحة (0 < p < 100) */
  percent: number
}

export const WEEKDAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const

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
  /** النوع — غيابه = باقة (توافق خلفي مع العروض المحفوظة) */
  kind?: PromotionKind
  /** bogo/tier: الصنف المستهدف (للباقة يُستعمل components) */
  itemId?: number
  /** bogo: اشترِ buyQty (عدد صحيح ≥ 1) */
  buyQty?: number
  /** bogo: واحصل على getQty (عدد صحيح ≥ 1) */
  getQty?: number
  /** bogo: خصم الوحدات الممنوحة — 100 = مجاناً */
  getDiscountPercent?: number
  /** tier: الشرائح (تصاعدية بالكمية، ولا تنخفض نسبتها) */
  tiers?: PromotionTier[]
  /** الجدولة: أيام السريان 0=الأحد…6=السبت (فارغ/غياب = كل الأيام) */
  weekdays?: number[]
  /** نافذة الساعات HH:MM — تُحدَّد معاً أو تُترك معاً؛ من > إلى = نافذة تعبر منتصف الليل */
  fromTime?: string
  toTime?: string
}

export interface PromotionInput extends Omit<Promotion, 'id'> {}

export const promotionKind = (p: Pick<Promotion, 'kind'>): PromotionKind => p.kind ?? 'bundle'

/** HH:MM → دقائق من منتصف الليل (null لو الصيغة غير صالحة) */
export function parseHm(s: string | undefined): number | null {
  if (!s) return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** تاريخ اليوم المحلي YYYY-MM-DD (لا UTC — فجر القاهرة/الرياض يقع بيوم UTC سابق) */
export function localDayIso(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

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
  if (input.startIso && input.endIso && input.endIso < input.startIso) errors.push('نهاية العرض قبل بدايته')
  errors.push(...validateSchedule(input))

  const kind = promotionKind(input)
  if (kind === 'bundle') {
    errors.push(...validateBundle(input, items, hasVariants))
  } else {
    errors.push(...validateSingleItemPromo(input, kind, items, hasVariants))
  }
  return errors
}

function validateSchedule(input: Pick<Promotion, 'weekdays' | 'fromTime' | 'toTime'>): string[] {
  const errors: string[] = []
  const wd = input.weekdays ?? []
  if (wd.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('أيام السريان: قيم من 0 (الأحد) إلى 6 (السبت)')
  if (new Set(wd).size !== wd.length) errors.push('يوم مكرر في أيام السريان')
  const hasFrom = !!input.fromTime, hasTo = !!input.toTime
  if (hasFrom !== hasTo) errors.push('حدد ساعتي البداية والنهاية معاً أو اتركهما فارغتين')
  if (hasFrom && hasTo) {
    const a = parseHm(input.fromTime), b = parseHm(input.toTime)
    if (a === null || b === null) errors.push('صيغة الساعة HH:MM (مثل 17:00)')
    else if (a === b) errors.push('ساعة البداية تساوي النهاية — النافذة فارغة')
  }
  return errors
}

function validateBundle(input: PromotionInput, items: readonly ItemForPromo[], hasVariants: (itemId: number) => boolean): string[] {
  const errors: string[] = []
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

function validateSingleItemPromo(
  input: PromotionInput,
  kind: 'bogo' | 'tier',
  items: readonly ItemForPromo[],
  hasVariants: (itemId: number) => boolean,
): string[] {
  const errors: string[] = []
  const it = items.find((x) => x.id === input.itemId)
  if (!it) return ['اختر الصنف المستهدف بالعرض']
  if (!it.isActive) errors.push(`«${it.nameAr}» معطل — فعّله أو استبدله`)
  if (it.trackSerial) errors.push(`«${it.nameAr}» يتتبع السيريال — لا يدخل العروض (كل قطعة معيّنة بذاتها)`)
  if (hasVariants(it.id)) errors.push(`«${it.nameAr}» موزع على تركيبات لون/مقاس — لا يدخل العروض`)
  if (kind === 'bogo' && it.soldByWeight) errors.push(`«${it.nameAr}» يُباع بالوزن — «اشترِ واحصل» للسلع القياسية (استخدم شرائح الكمية)`)

  let worstPercent = 0
  if (kind === 'bogo') {
    if (!Number.isInteger(input.buyQty) || (input.buyQty ?? 0) < 1) errors.push('كمية الشراء عدد صحيح ≥ 1')
    if (!Number.isInteger(input.getQty) || (input.getQty ?? 0) < 1) errors.push('الكمية الممنوحة عدد صحيح ≥ 1')
    const d = input.getDiscountPercent
    if (d === undefined || !Number.isFinite(d) || d <= 0 || d > 100) errors.push('خصم الوحدات الممنوحة بين 0 و100 (100 = مجاناً)')
    else worstPercent = d
  } else {
    const tiers = input.tiers ?? []
    if (tiers.length === 0) errors.push('أضف شريحة كمية واحدة على الأقل')
    if (tiers.length > 6) errors.push('الحد الأقصى 6 شرائح')
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]
      if (!Number.isFinite(t.minQty) || t.minQty <= 0) errors.push(`الشريحة ${i + 1}: الكمية أكبر من صفر`)
      if (!Number.isFinite(t.percent) || t.percent <= 0 || t.percent >= 100) errors.push(`الشريحة ${i + 1}: النسبة بين 0 و100 (حصراً)`)
      if (i > 0) {
        if (t.minQty <= tiers[i - 1].minQty) errors.push('كميات الشرائح تصاعدية بلا تكرار')
        if (t.percent < tiers[i - 1].percent) errors.push('نسبة الشريحة الأكبر لا تقل عن السابقة (الكمية الأكبر لا تُسعَّر أغلى)')
      }
      worstPercent = Math.max(worstPercent, Number.isFinite(t.percent) ? t.percent : 0)
    }
  }
  // أرضية السعر أعلى من العرض: أعمق خصم في العرض لا يكسر حد الصنف
  const floor = it.minSalePriceMinor ?? 0
  if (floor > 0 && worstPercent > 0 && it.priceMinor * (1 - worstPercent / 100) < floor - 0.5) {
    errors.push(`أعمق خصم في العرض يهبط بـ«${it.nameAr}» تحت حده الأدنى للبيع — خفّض النسبة أو عدّل حد الصنف`)
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

/**
 * هل العرض سارٍ في هذه اللحظة؟ فترة التواريخ + أيام الأسبوع + نافذة الساعات — بالتوقيت المحلي.
 * نافذة تعبر منتصف الليل (من 22:00 إلى 02:00): جزؤها بعد منتصف الليل يتبع يوم بدايتها
 * (الجمعة 22:00–02:00 تشمل السبت 01:00 كجزء من «الجمعة»).
 */
export function promotionActiveAt(
  p: Pick<Promotion, 'isActive' | 'startIso' | 'endIso' | 'weekdays' | 'fromTime' | 'toTime'>,
  now: Date,
): boolean {
  if (!promotionActiveOn(p, localDayIso(now))) return false
  const from = parseHm(p.fromTime), to = parseHm(p.toTime)
  const cur = now.getHours() * 60 + now.getMinutes()
  let scheduleDay = now.getDay()
  if (from !== null && to !== null) {
    if (from < to) {
      if (cur < from || cur >= to) return false
    } else {
      // نافذة عبر منتصف الليل
      if (cur >= from) { /* الجزء المسائي: يوم البداية هو اليوم نفسه */ }
      else if (cur < to) scheduleDay = (scheduleDay + 6) % 7
      else return false
    }
  }
  const wd = p.weekdays ?? []
  return wd.length === 0 || wd.includes(scheduleDay)
}

/** وصف عربي للجدولة (فارغ لو بلا جدولة) */
export function describeSchedule(p: Pick<Promotion, 'weekdays' | 'fromTime' | 'toTime'>): string {
  const parts: string[] = []
  const wd = [...(p.weekdays ?? [])].sort((a, b) => a - b)
  if (wd.length > 0 && wd.length < 7) parts.push(wd.map((d) => WEEKDAY_LABELS[d]).join('، '))
  if (p.fromTime && p.toTime) parts.push(`${p.fromTime} – ${p.toTime}`)
  return parts.join(' · ')
}

/** وصف عربي لقاعدة العرض التلقائي */
export function describeRule(p: Pick<Promotion, 'kind' | 'buyQty' | 'getQty' | 'getDiscountPercent' | 'tiers'>): string {
  const kind = promotionKind(p)
  if (kind === 'bogo') {
    const free = (p.getDiscountPercent ?? 0) >= 100
    return `اشترِ ${p.buyQty ?? '؟'} واحصل على ${p.getQty ?? '؟'} ${free ? 'مجاناً' : `بخصم ${p.getDiscountPercent ?? '؟'}٪`}`
  }
  if (kind === 'tier') return (p.tiers ?? []).map((t) => `من ${t.minQty} → ${t.percent}٪`).join(' · ')
  return ''
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

/* ═══ التطبيق التلقائي (bogo / tier) ═══ */

export interface AppliedPromotion {
  /** فهرس السطر في السلة الأصلية (قبل التطبيق) */
  lineIndex: number
  promotionId: number
  nameAr: string
  /** الوفر بالوحدة الصغرى */
  savingsMinor: Minor
}

/**
 * يطبّق العروض التلقائية الساريان الآن على سطور السلة — دالة خالصة لا تعدّل السلة الأصلية:
 * السلة تبقى «خام» في الواجهة، وتُحسب منها السلة الفعلية (للإجماليات والترحيل والطباعة).
 *
 * قواعد الأهلية للسطر: لا خصم يدوي (الخصم اليدوي يعلو ولا يتراكم)، لا سيريال، لا متغيرات
 * لون/مقاس، ولا وحدة أكبر (unitFactor)؛ و«اشترِ واحصل» لا يطبّق على الموزون.
 * أرضية السعر أعلى من العرض: عرض يهبط بالصنف تحت حده الأدنى يُتجاهل لهذا السطر.
 * لو تعددت العروض لصنف واحد يُطبَّق الأعلى وفراً (والأقدم id عند التساوي) — عرض واحد لكل سطر.
 */
export function applyAutoPromotions(
  lines: readonly CartLine[],
  promotions: readonly Promotion[],
  items: readonly Pick<Item, 'id' | 'minSalePriceMinor'>[],
  now: Date,
): { lines: CartLine[]; applied: AppliedPromotion[] } {
  const auto = promotions.filter((p) => promotionKind(p) !== 'bundle' && promotionActiveAt(p, now))
  if (auto.length === 0) return { lines: lines.map((l) => ({ ...l })), applied: [] }

  const out: CartLine[] = []
  const applied: AppliedPromotion[] = []
  lines.forEach((l, i) => {
    const eligible =
      l.discountPercent === 0 && !(l.serials && l.serials.length) && !l.variantColor && !l.variantSize &&
      (l.unitFactor ?? 1) === 1 && l.qty > 0
    if (!eligible) { out.push({ ...l }); return }
    const floor = items.find((x) => x.id === l.itemId)?.minSalePriceMinor ?? 0
    const belowFloor = (percent: number) => floor > 0 && l.unitPriceMinor * (1 - percent / 100) < floor - 0.5

    let best: { promo: Promotion; savings: Minor; lines: CartLine[] } | null = null
    for (const p of auto) {
      if (p.itemId !== l.itemId) continue
      let cand: { savings: Minor; lines: CartLine[] } | null = null
      if (promotionKind(p) === 'bogo' && !l.soldByWeight) {
        const buy = p.buyQty ?? 0, get = p.getQty ?? 0, d = p.getDiscountPercent ?? 0
        if (buy >= 1 && get >= 1 && d > 0 && !belowFloor(d)) {
          const free = Math.floor(l.qty / (buy + get)) * get
          if (free > 0) {
            const label = ` (${p.nameAr})`
            cand = {
              savings: percentOf(mulQty(l.unitPriceMinor, free), d),
              lines: [
                { ...l, qty: l.qty - free },
                { ...l, qty: free, discountPercent: d, nameAr: l.nameAr + label },
              ],
            }
          }
        }
      } else if (promotionKind(p) === 'tier') {
        const tier = [...(p.tiers ?? [])].sort((a, b) => b.minQty - a.minQty).find((t) => l.qty >= t.minQty)
        if (tier && tier.percent > 0 && !belowFloor(tier.percent)) {
          cand = {
            savings: percentOf(mulQty(l.unitPriceMinor, l.qty), tier.percent),
            lines: [{ ...l, discountPercent: tier.percent, nameAr: `${l.nameAr} (${p.nameAr})` }],
          }
        }
      }
      if (cand && (best === null || cand.savings > best.savings || (cand.savings === best.savings && p.id < best.promo.id))) {
        best = { promo: p, ...cand }
      }
    }
    if (best && best.savings > 0) {
      out.push(...best.lines)
      applied.push({ lineIndex: i, promotionId: best.promo.id, nameAr: best.promo.nameAr, savingsMinor: best.savings })
    } else {
      out.push({ ...l })
    }
  })
  return { lines: out, applied }
}
