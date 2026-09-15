/**
 * الرقم المرجعي للفواتير — كود تتبع فريد يُطبع على الفاتورة ويبحث به العميل والمحل.
 *
 * الشكل: PREFIX-YYMMDD-XXXXXC
 *   PREFIX : نوع المستند (SAL بيع / PUR شراء / SRT مرتجع بيع / PRT مرتجع شراء)
 *   YYMMDD : تاريخ الإصدار — يجعل الكود قابلاً للفرز زمنياً بالعين
 *   XXXXX  : 5 خانات عشوائية من أبجدية آمنة (بلا 0/O/1/I/L المتشابهة)
 *   C      : حرف تحقق (checksum) يكشف الخطأ لو كُتب الكود يدوياً بحرف ناقص أو مقلوب
 *
 * لماذا عشوائي وليس تسلسلياً؟ الرقم التسلسلي (S-0001) موجود أصلاً للعرض الداخلي،
 * أما المرجعي فيُعطى للعميل: لا يكشف حجم مبيعاتك ولا يمكن تخمين فاتورة غيره.
 */

/** أبجدية Crockford-like: 31 رمزاً بلا أحرف ملتبسة */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const BASE = ALPHABET.length

export type RefPrefix = 'SAL' | 'PUR' | 'SRT' | 'PRT' | 'PRD'

/** حرف التحقق: مجموع مرجّح بمواضع الأحرف (يلتقط الحذف والقلب المجاور) mod 31 */
function checksumChar(body: string): string {
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const idx = ALPHABET.indexOf(body[i])
    if (idx < 0) continue // الشرطات والأرقام خارج الأبجدية لا تدخل الوزن
    sum = (sum + (i + 1) * idx) % BASE
  }
  return ALPHABET[sum]
}

/** توليد كود مرجعي جديد — rand قابل للحقن للاختبارات الحتمية */
export function makeRefCode(prefix: RefPrefix, dateIso: string, rand: () => number = Math.random): string {
  const d = dateIso.slice(0, 10).replaceAll('-', '').slice(2) // YYMMDD
  let body = ''
  for (let i = 0; i < 5; i++) body += ALPHABET[Math.floor(rand() * BASE) % BASE]
  const stem = `${prefix}-${d}-${body}`
  return stem + checksumChar(`${prefix}${d}${body}`)
}

/** فحص صحة كود مرجعي مكتوب يدوياً — يرجع سبب الرفض بالعربية أو null لو سليم */
export function validateRefCode(code: string): string | null {
  const m = /^(SAL|PUR|SRT|PRT)-(\d{6})-([2-9A-HJKMNP-Z]{5})([2-9A-HJKMNP-Z])$/.exec(code.trim().toUpperCase())
  if (!m) return 'صيغة الكود غير صحيحة — الشكل: SAL-YYMMDD-XXXXXC'
  const [, prefix, date, body, check] = m
  if (checksumChar(`${prefix}${date}${body}`) !== check) return 'حرف التحقق لا يطابق — راجع الكود المكتوب'
  return null
}

/** توليد كود فريد ضد قائمة الأكواد المستخدمة (التصادم شبه مستحيل لكن نضمنه) */
export function makeUniqueRefCode(prefix: RefPrefix, dateIso: string, used: ReadonlySet<string>, rand: () => number = Math.random): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = makeRefCode(prefix, dateIso, rand)
    if (!used.has(code)) return code
  }
  // احتياط نظري بحت: وسّع الجسم بحرف زمني
  return makeRefCode(prefix, dateIso, rand) + ALPHABET[Date.now() % BASE]
}

/** تطبيع كود أدخله المستخدم للبحث: مسافات/حالة أحرف/شرطات ناقصة */
export function normalizeRefQuery(q: string): string {
  return q.trim().toUpperCase().replace(/\s+/g, '')
}
