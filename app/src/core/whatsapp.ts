/**
 * واتساب — مساعدات موحدة (v1.0.13)
 * يسّير نفس منطق تذكيرات المواعيد (booking.ts) مع إضافة حالات إرسال المستندات:
 * بلا رقم يفتح قائمة اختيار جهة في واتساب بدل الفشل الصامت.
 */

/** يطبّع الرقم لمسار wa.me: يقبل 01x المصري ويرفقه 2، ويمرر الدولي كما هو */
export function normalizeWaPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('0')) return `2${digits}`
  return digits
}

/**
 * رابط محادثة واتساب برسالة جاهزة:
 * • برقم → https://wa.me/<دولي>?text=…
 * • بلا رقم → https://wa.me/?text=… (يفتح واتساب لاختيار الجهة بعد الإرسال)
 */
export function waChatLink(phone: string, message: string): string {
  const intl = normalizeWaPhone(phone)
  const text = encodeURIComponent(message)
  return intl ? `https://wa.me/${intl}?text=${text}` : `https://wa.me/?text=${text}`
}

/** اسم ملف لاتيني آمن للـ PDF عبر أنظمة الملفات والمشاركة: INV-0001 → Tahakom-INV-0001 */
export function safePdfFileName(prefix: string, docNumber: string): string {
  const doc = (docNumber || 'draft').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().slice(0, 10)
  return `Tahakom-${prefix}-${doc}-${stamp}`
}

/** رسالة مصاحبة للإرسال — أرقام لاتينية (en-US) حفاظاً على مقروئيتها في كل الأجهزة */
export function docShareMessage(docLabel: string, docNumber: string, shopName: string): string {
  const n = (docNumber || 'مسودة').replace(/[^\u0600-\u06FFA-Za-z0-9/-]/g, '')
  return `${docLabel} ${n} — ${shopName}\nالملف مرفق (PDF). شكراً لثقتكم 🌟`
}
