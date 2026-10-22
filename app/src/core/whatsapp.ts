
import { todayLocalIso } from './time.ts'/**
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
  const stamp = todayLocalIso()
  return `Tahakom-${prefix}-${doc}-${stamp}`
}

/** رسالة مصاحبة للإرسال — أرقام لاتينية (en-US) حفاظاً على مقروئيتها في كل الأجهزة */
export function docShareMessage(docLabel: string, docNumber: string, shopName: string): string {
  const n = (docNumber || 'مسودة').replace(/[^\u0600-\u06FFA-Za-z0-9/-]/g, '')
  return `${docLabel} ${n} — ${shopName}\nالملف مرفق (PDF). شكراً لثقتكم 🌟`
}

/** الطرف المستحق لمستند مع رقمه المسجّل في بطاقته (لزر الإرسال لكل سطر) */
export interface WaParty {
  name: string
  /** الرقم كما هو مسجّل في البطاقة (قد يكون فارغاً) */
  phone: string
}

interface WaSaleLike {
  customerId: number | null
  partyKind?: 'supplier' | 'employee' | null
  partyId?: number | null
  partyName?: string | null
}

interface WaPhonedRecord {
  id: number
  nameAr: string
  phone?: string
}

/**
 * طرف فاتورة البيع: عميل مسجّل (customerId) ⇒ بطاقة العميل،
 * أو مورد/موظف (partyKind + partyId) ⇒ بطاقته، وإلا (نقدي بلا طرف) ⇒ null.
 * الاسم يُؤخذ من البطاقة إن وُجدت، وإلا من الاسم المحفوظ على الفاتورة.
 */
export function saleWaParty(
  sale: WaSaleLike,
  parties: { customers: WaPhonedRecord[]; suppliers: WaPhonedRecord[]; employees: WaPhonedRecord[] },
): WaParty | null {
  if (sale.customerId != null && sale.customerId > 0) {
    const customer = parties.customers.find((row) => row.id === sale.customerId)
    return customer ? { name: customer.nameAr, phone: customer.phone ?? '' } : null
  }
  if (sale.partyId == null || sale.partyId <= 0) return null
  const pool = sale.partyKind === 'supplier' ? parties.suppliers : sale.partyKind === 'employee' ? parties.employees : []
  const record = pool.find((row) => row.id === sale.partyId)
  if (record) return { name: record.nameAr, phone: record.phone ?? '' }
  return sale.partyName ? { name: sale.partyName, phone: '' } : null
}

/** طرف فاتورة الشراء: المورد المسجّل على الفاتورة (0 = مورد نقدي ⇒ لا طرف) */
export function purchaseWaParty(supplierId: number, suppliers: WaPhonedRecord[]): WaParty | null {
  if (!supplierId || supplierId <= 0) return null
  const supplier = suppliers.find((row) => row.id === supplierId)
  return supplier ? { name: supplier.nameAr, phone: supplier.phone ?? '' } : null
}
