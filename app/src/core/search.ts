/**
 * بحث نصي عربي متسامح — نواة خالصة (بلا React) تستخدمها كل خانات البحث.
 * ───────────────────────────────────────────────────────────────────────
 * بلاغ المالك: «الكاشير لا يعرض أي صنف عند كتابة أي حرف». السبب أن المطابقة
 * كانت حرفية `includes` فتفشل مع اختلاف شكل الحرف الواحد: «أحمد» ضد «احمد»،
 * «سكرية» ضد «سكريه»، «مياه» ضد «ميآه»، أو أرقام عربية «٦٢٢١٠٠» ضد «622100».
 *
 * القواعد المعتمدة (نفس ما تفعله برامج الكاشير العربية الاحترافية):
 *  - تحويل الأرقام العربية/الفارسية إلى لاتينية.
 *  - حذف التشكيل والتطويل وعلامات الترقيم الفاصلة.
 *  - توحيد الهمزات (أ إ آ ٱ → ا)، والتاء المربوطة (ة → ه)، والألف المقصورة (ى → ي)،
 *    والكاف/الياء الفارسية (ک ی → ك ي).
 *  - كل كلمة في السؤال يجب أن توجد في النص (بحث بكلمات لا بجملة واحدة)،
 *    فـ«لبن كامل» تطابق «لبن كامل الدسم 1ل» وكذلك «كامل لبن».
 */

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
/** تشكيل + تطويل + علامات التنسيق غير المرئية */
const DIACRITICS = /[\u0610-\u061A\u064B-\u0652\u0653-\u065F\u0670\u0640\u200c-\u200f]/g

/** يوحّد النص للمقارنة: أرقام لاتينية، بلا تشكيل، حروف عربية موحّدة، حروف صغيرة. */
export function normalizeSearchText(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(DIACRITICS, '')
    .replace(/[أإآٱٲٳ]/g, 'ا')
    .replace(/[ىئي]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ة]/g, 'ه')
    .replace(/[ک]/g, 'ك')
    .replace(/[ی]/g, 'ي')
    .replace(/[\u0660-\u0669]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** كلمات السؤال بعد التوحيد — فارغة تعني «اعرض كل شيء». */
export function searchTokens(query: unknown): string[] {
  const normalized = normalizeSearchText(query)
  return normalized ? normalized.split(' ').filter(Boolean) : []
}

/**
 * هل يطابق السجل السؤال؟ `fields` أي مزيج من النصوص والأرقام (اسم/كود/باركود/هاتف).
 * السؤال الفارغ يطابق دائماً حتى تظهر القائمة كاملة قبل الكتابة.
 */
export function matchesSearch(fields: readonly unknown[], query: unknown): boolean {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return true
  const haystack = fields.map(normalizeSearchText).filter(Boolean).join(' ')
  if (!haystack) return false
  return tokens.every((token) => haystack.includes(token))
}

/** ترتيب النتائج: ما يبدأ بالسؤال أولاً ثم ما يحتويه — سلوك الكاشير المتوقع. */
export function searchRank(fields: readonly unknown[], query: unknown): number {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return 2
  const values = fields.map(normalizeSearchText).filter(Boolean)
  const first = tokens[0]
  if (values.some((value) => value === first)) return 0
  if (values.some((value) => value.startsWith(first))) return 1
  return 2
}
