/**
 * الذهب والمجوهرات — سد فجوة أنظمة الصاغة العالمية
 * ==================================================
 * ثلاثة أركان تفصل «الصاغة» عن البيع العادي:
 *
 * 1) سعر الجرام اليومي بالعيار (18/21/24): يُحدَّث مرة واحدة صباحاً،
 *    وبضغطة «إعادة تسعير» تتحدث أسعار كل الأصناف الموصوفة ذهبياً:
 *      السعر = الوزن × سعر جرام العيار + المصنعية
 *
 * 2) المصنعية منفصلة عن قيمة الذهب: لكل صنف وزن وعيار ومصنعية —
 *    فيظهر للعميل (وللمحاسبة) كم يدفع ذهباً وكم يدفع صنعة.
 *
 * 3) الكسر (الذهب القديم): شراء من العميل يدخل مخزون كسر بعياره ووزنه
 *    (دفعات FIFO)، وبيعه للمصنعية/التاجر يخرج FIFO بربح أو خسارة ظاهرة.
 *
 * القيود:
 *   شراء كسر:  1103 مدين (قيمة الكسر) / خزينة دائن
 *   بيع كسر:   خزينة مدين بسعر البيع / 1103 دائن بالتكلفة
 *              والفرق: ربح → 4101 دائن، خسارة → 5101 مدين
 */
import type { JournalLine } from './ledger.ts'
import { assertBalanced } from './ledger.ts'
import type { Minor } from './money.ts'

export type Karat = 'k18' | 'k21' | 'k24'

export const KARAT_LABELS: Record<Karat, string> = { k18: 'عيار 18', k21: 'عيار 21', k24: 'عيار 24' }
export const ALL_KARATS: Karat[] = ['k18', 'k21', 'k24']

/** أسعار الجرام اليومية بالمليمات لكل عيار */
export interface GramPrices {
  k18: Minor
  k21: Minor
  k24: Minor
  /** آخر تحديث ISO — للتحذير لو الأسعار قديمة */
  updatedAt: string | null
}

export const EMPTY_GRAM_PRICES: GramPrices = { k18: 0, k21: 0, k24: 0, updatedAt: null }

/** الوصف الذهبي لصنف: يحوله من «سعر يدوي» إلى «سعر مشتق من السوق» */
export interface JewelryProfile {
  itemId: number
  karat: Karat
  weightGrams: number
  /** مصنعية القطعة كاملة (لا للجرام) بالمليمات */
  workmanshipMinor: Minor
}

export function validateProfile(p: Omit<JewelryProfile, 'itemId'>): string[] {
  const errors: string[] = []
  if (!(p.weightGrams > 0)) errors.push('الوزن بالجرام يجب أن يكون أكبر من صفر')
  if (p.workmanshipMinor < 0) errors.push('المصنعية لا تكون سالبة')
  if (!ALL_KARATS.includes(p.karat)) errors.push('اختر العيار')
  return errors
}

/** سعر القطعة = الوزن × سعر جرام عيارها + المصنعية */
export function jewelryPriceMinor(profile: Pick<JewelryProfile, 'karat' | 'weightGrams' | 'workmanshipMinor'>, prices: GramPrices): Minor {
  return Math.round(profile.weightGrams * prices[profile.karat]) + profile.workmanshipMinor
}

/** تفكيك سعر القطعة لعرضه في الفاتورة: قيمة ذهب + مصنعية */
export function jewelryBreakdown(profile: Pick<JewelryProfile, 'karat' | 'weightGrams' | 'workmanshipMinor'>, prices: GramPrices): { goldMinor: Minor; workmanshipMinor: Minor } {
  return { goldMinor: Math.round(profile.weightGrams * prices[profile.karat]), workmanshipMinor: profile.workmanshipMinor }
}

/** هل مضى على تحديث الأسعار أكثر من يوم؟ (تحذير قبل البيع) */
export function pricesAreStale(prices: GramPrices, nowIso: string): boolean {
  if (!prices.updatedAt) return true
  return nowIso.slice(0, 10) !== prices.updatedAt.slice(0, 10)
}

/* ─── الكسر ─── */

/** دفعة كسر مشتراة — تُستهلك FIFO عند البيع */
export interface ScrapLot {
  id: number
  refCode: string
  date: string
  karat: Karat
  weightGrams: number
  /** المتبقي غير المباع من الدفعة */
  remainingGrams: number
  pricePerGramMinor: Minor
  totalMinor: Minor
  /** اسم البائع (عميل) — اختياري */
  sellerName: string
  journalEntryId: number
}

export interface ScrapSale {
  id: number
  refCode: string
  date: string
  karat: Karat
  weightGrams: number
  pricePerGramMinor: Minor
  saleMinor: Minor
  costMinor: Minor
  profitMinor: Minor // موجب ربح، سالب خسارة
  buyerName: string
  journalEntryId: number
}

export function buildScrapPurchaseEntry(totalMinor: Minor, treasury: string, karatLabel: string): JournalLine[] {
  if (totalMinor <= 0) throw new Error('قيمة الكسر يجب أن تكون أكبر من صفر')
  const lines: JournalLine[] = [
    { accountCode: '1103', debit: totalMinor, credit: 0, note: `شراء ذهب كسر ${karatLabel}` },
    { accountCode: treasury, debit: 0, credit: totalMinor, note: 'دفع ثمن الكسر' },
  ]
  assertBalanced(lines)
  return lines
}

export function buildScrapSaleEntry(saleMinor: Minor, costMinor: Minor, treasury: string, karatLabel: string): JournalLine[] {
  if (saleMinor <= 0) throw new Error('قيمة البيع يجب أن تكون أكبر من صفر')
  const lines: JournalLine[] = [
    { accountCode: treasury, debit: saleMinor, credit: 0, note: `بيع ذهب كسر ${karatLabel}` },
    { accountCode: '1103', debit: 0, credit: costMinor, note: 'خروج الكسر من المخزون' },
  ]
  const diff = saleMinor - costMinor
  if (diff > 0) lines.push({ accountCode: '4101', debit: 0, credit: diff, note: 'ربح بيع كسر' })
  else if (diff < 0) lines.push({ accountCode: '5101', debit: -diff, credit: 0, note: 'خسارة بيع كسر' })
  assertBalanced(lines)
  return lines
}

/**
 * تخطيط استهلاك الكسر FIFO من دفعات عيار محدد:
 * يرجع الدفعات المستهلكة وكمياتها وتكلفتها — أو يرمي لو الوزن غير متاح.
 */
export function planScrapConsumption(
  lots: ScrapLot[],
  karat: Karat,
  weightGrams: number,
): { lotId: number; grams: number; costMinor: Minor }[] {
  if (!(weightGrams > 0)) throw new Error('الوزن يجب أن يكون أكبر من صفر')
  const available = lots.filter((l) => l.karat === karat && l.remainingGrams > 0).sort((a, b) => a.date.localeCompare(b.date))
  const totalAvail = available.reduce((s, l) => s + l.remainingGrams, 0)
  if (totalAvail + 1e-9 < weightGrams) {
    throw new Error(`كسر ${KARAT_LABELS[karat]} المتاح ${totalAvail} جم ومطلوب ${weightGrams} جم`)
  }
  const plan: { lotId: number; grams: number; costMinor: Minor }[] = []
  let need = weightGrams
  for (const lot of available) {
    if (need <= 1e-9) break
    const take = Math.min(lot.remainingGrams, need)
    plan.push({ lotId: lot.id, grams: take, costMinor: Math.round(take * lot.pricePerGramMinor) })
    need -= take
  }
  return plan
}

/* ─────────── البيع بمقايضة كسر (جولة مراجعة الذهب) ───────────
 * أشهر عملية بمحل الصاغة: العميل يشتري مشغولاً جديداً ويدفع جزءاً من
 * ثمنه بذهبه القديم (كسر يُوزن ويُقيّم بسعر لحظي) — عمليتان بمستند واحد:
 *   بيع المشغول (فاتورة كاشير كاملة بقيدها) + شراء الكسر (لوط FIFO بقيده)
 * والفرق النقدي فقط هو ما يتحرك بالخزينة فعلياً.
 */

export interface TradeInPreview {
  saleMinor: Minor // ثمن المشغول الجديد
  scrapValueMinor: Minor // قيمة كسر العميل (وزن × سعر لحظي)
  netMinor: Minor // موجب = يدفع العميل الفرق، سالب = نرد له
}

export function computeTradeInNet(saleMinor: Minor, scrapWeightGrams: number, scrapPricePerGramMinor: Minor): TradeInPreview {
  const scrapValueMinor = Math.round(scrapWeightGrams * scrapPricePerGramMinor)
  return { saleMinor, scrapValueMinor, netMinor: saleMinor - scrapValueMinor }
}

export function validateTradeIn(args: { scrapWeightGrams: number; scrapPricePerGramMinor: number }): string[] {
  const errors: string[] = []
  if (!(args.scrapWeightGrams > 0)) errors.push('وزن كسر العميل يجب أن يكون أكبر من صفر — وإلا فهي فاتورة بيع عادية')
  if (!(args.scrapPricePerGramMinor > 0)) errors.push('سعر جرام الكسر يجب أن يكون أكبر من صفر')
  return errors
}
