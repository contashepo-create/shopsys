/**
 * برنامج نقاط الولاء (سد فجوة عالمية — نمط Lightspeed Loyalty وSquare):
 * «Pay + Earn»: العميل المسجل يكسب نقاطاً من كل فاتورة (نقاط لكل وحدة عملة،
 * تقريب لأسفل كما تفعل Lightspeed — لا أنصاف نقاط)، ثم يستبدلها برصيد دائن
 * في حسابه (1104) يخصم من مشترياته القادمة.
 *
 * المحاسبة (طريقة المصروف عند الاستبدال — الأنسب للمنشآت الصغيرة):
 *   الكسب: عدّاد نقاط فقط — لا قيد (لا التزام مؤجل معقد).
 *   الاستبدال: مدين 5115 مصروف برنامج الولاء ← دائن 1104 حساب العميل.
 *   النتيجة: رصيد دائن للعميل يقابل مشترياته القادمة تلقائياً.
 */
import type { Minor } from './money.ts'
import { assertBalanced, type JournalLine } from './ledger.ts'

export interface LoyaltySettings {
  enabled: boolean
  /** نقاط مكتسبة لكل وحدة عملة كاملة من إجمالي الفاتورة (الافتراضي 1 نقطة/جنيه) */
  pointsPerUnit: number
  /** قيمة النقطة الواحدة عند الاستبدال بالوحدة الصغرى (مثلاً 5 = النقطة بـ5 قروش) */
  redeemValueMinor: number
  /** أدنى رصيد نقاط يسمح بالاستبدال (منع استبدال الفتات) */
  minRedeemPoints: number
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  pointsPerUnit: 1,
  redeemValueMinor: 5,
  minRedeemPoints: 100,
}

/**
 * النقاط المكتسبة من فاتورة: (الإجمالي بالوحدة الصغرى ÷ معامل الوحدة) × نقاط الوحدة
 * تقريب لأسفل دائماً (نمط Lightspeed: «always rounds down — no half points»).
 */
export function earnedPoints(totalMinor: Minor, decimals: number, s: LoyaltySettings): number {
  if (!s.enabled || s.pointsPerUnit <= 0 || totalMinor <= 0) return 0
  const unit = 10 ** decimals
  return Math.floor((totalMinor / unit) * s.pointsPerUnit)
}

/** قيمة نقاط عند الاستبدال بالوحدة الصغرى */
export function redeemValue(points: number, s: LoyaltySettings): Minor {
  return Math.max(0, Math.round(points * s.redeemValueMinor))
}

/** تحقق طلب الاستبدال — يرجع الأخطاء بالعربية */
export function validateRedeem(args: {
  requestedPoints: number
  customerPoints: number
  settings: LoyaltySettings
}): string[] {
  const errors: string[] = []
  const { requestedPoints, customerPoints, settings } = args
  if (!settings.enabled) errors.push('برنامج الولاء غير مفعّل — فعّله من الإعدادات العامة')
  if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) errors.push('عدد النقاط يجب أن يكون عدداً صحيحاً موجباً')
  else {
    if (requestedPoints > customerPoints) errors.push(`رصيد العميل ${customerPoints} نقطة فقط`)
    if (requestedPoints < settings.minRedeemPoints) errors.push(`أدنى استبدال ${settings.minRedeemPoints} نقطة`)
  }
  if (settings.redeemValueMinor <= 0) errors.push('قيمة النقطة غير مضبوطة في الإعدادات')
  return errors
}

/**
 * قيد استبدال النقاط: مصروف ولاء ← رصيد دائن في حساب العميل (1104)
 * فيخصم تلقائياً من فواتيره الآجلة القادمة أو يُرد له نقداً بسند صرف عادي.
 */
export function buildLoyaltyRedeemEntry(valueMinor: Minor, customerLabel: string): JournalLine[] {
  if (valueMinor <= 0) throw new Error('قيمة الاستبدال يجب أن تكون موجبة')
  const lines: JournalLine[] = [
    { accountCode: '5115', debit: valueMinor, credit: 0, note: `استبدال نقاط ولاء — ${customerLabel}` },
    { accountCode: '1104', debit: 0, credit: valueMinor, note: `رصيد ولاء لحساب ${customerLabel}` },
  ]
  assertBalanced(lines)
  return lines
}
