/**
 * واتساب — مساعدات موحدة (v1.0.13)
 * يسّير نفس منطق تذكيرات المواعيد (booking.ts) مع إضافة حالات إرسال المستندات:
 * بلا رقم يفتح قائمة اختيار جهة في واتساب بدل الفشل الصامت.
 */

import { todayLocalIso } from './time.ts'
import { getCountry } from './countries.ts'

const CALLING_CODES: Record<string, string> = { EG: '20', SA: '966', AE: '971', KW: '965', QA: '974', BH: '973', OM: '968', JO: '962', IQ: '964', LY: '218', MA: '212', DZ: '213', TN: '216', SD: '249', YE: '967', LB: '961', PS: '970', SY: '963', MR: '222' }

/** للمستندات: لا نُحوّل رقماً محلياً إلى بلد مصر تلقائياً عند غياب بلد واضح. */
export function documentWaPhone(phone: string, countryCode?: string | null): string {
  const normalized = (phone || '').trim().replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) - (char >= '۰' ? 0x06f0 : 0x0660)))
  if (!normalized) return ''
  if (!/^[+\d\s().-]+$/.test(normalized) || normalized.slice(1).includes('+')) throw new Error('رقم واتساب غير صالح — أدخله بالصيغة الدولية')
  const digits = normalized.replace(/\D/g, '')
  if (normalized.startsWith('+') || digits.startsWith('00')) {
    const intl = digits.startsWith('00') && !normalized.startsWith('+') ? digits.slice(2) : digits
    if (!/^[1-9]\d{6,14}$/.test(intl)) throw new Error('رقم واتساب الدولي غير صالح — راجع الرقم')
    return intl
  }
  const code = countryCode ? CALLING_CODES[countryCode] : undefined
  const country = countryCode ? getCountry(countryCode) : undefined
  if (!code || !country) throw new Error('بلد رقم واتساب غير معروف — أدخل الرقم الدولي مبتدئاً بعلامة +')
  const example = country.phoneExample.replace(/\D/g, '')
  // رقم صريح يبدأ بمفتاح الدولة وطوله الدولي أطول من الرقم المحلي.
  if (digits.startsWith(code) && digits.length > example.length && digits.length <= 15) return digits
  if (digits.length !== example.length || (example.startsWith('0') !== digits.startsWith('0'))) throw new Error('رقم واتساب لا يطابق طول الرقم المحلي للبلد — أدخل الرقم الدولي مبتدئاً بعلامة +')
  const national = example.startsWith('0') ? digits.slice(1) : digits
  if (!/^[1-9]/.test(national)) throw new Error('رقم واتساب المحلي غير صالح — راجع الرقم')
  return code + national
}

/** الرقم المحلي يتبع بلد المنشأة؛ إن غاب البلد يلزم رمز دولي صريح. */
export function normalizeWaPhone(phone: string, countryCode?: string | null): string {
  return documentWaPhone(phone, countryCode)
}

/**
 * رابط محادثة واتساب برسالة جاهزة:
 * • برقم → https://wa.me/<دولي>?text=…
 * • بلا رقم → https://wa.me/?text=… (يفتح واتساب لاختيار الجهة بعد الإرسال)
 */
export function waChatLink(phone: string, message: string, countryCode?: string | null): string {
  const intl = normalizeWaPhone(phone, countryCode)
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
  return `${docLabel} ${n} — ${shopName}\nشكراً لثقتكم 🌟`
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
