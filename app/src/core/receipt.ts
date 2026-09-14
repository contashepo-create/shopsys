/**
 * نموذج إيصال الكاشير للطباعة الحرارية — ShopSys (المرحلة 5)
 * ─────────────────────────────────────────────────────────────
 * منطق خالص: يحوّل فاتورة البيع إلى نموذج إيصال جاهز للقالب
 * (80مم أو 58مم) — الواجهة ترسمه والطابعة تطبعه، بلا حسابات في القالب.
 */
import type { Minor } from './money.ts'
import type { CartLine, CartTotals, PaymentMethod } from './pos.ts'

export type PaperWidth = '80' | '58'

/** قالب الطباعة الافتراضي بعد البيع: إيصال حراري أو فاتورة A4 */
export type InvoiceTemplate = 'thermal' | 'a4'

/** أنماط فاتورة A4 الاحترافية — منقولة ومكيّفة من قوالب logistics-web */
export type A4Style = 'modern' | 'classic' | 'compact' | 'elegant'

export const A4_STYLES: { id: A4Style; nameAr: string; desc: string; accent: string }[] = [
  { id: 'modern', nameAr: 'عصري', desc: 'شريط متدرج وبطاقات معلومات أنيقة', accent: '#2563eb' },
  { id: 'classic', nameAr: 'كلاسيكي', desc: 'قالب محاسبي رسمي بإطارات واضحة', accent: '#1e293b' },
  { id: 'compact', nameAr: 'مدمج', desc: 'اقتصادي يضغط كل شيء في ورقة واحدة', accent: '#0d9488' },
  { id: 'elegant', nameAr: 'فاخر', desc: 'زوايا ناعمة وهوية بصرية قوية', accent: '#7c3aed' },
]

export interface ReceiptSettings {
  paperWidth: PaperWidth
  defaultTemplate: InvoiceTemplate
  a4Style: A4Style
  /** اللون الرئيسي للقالب (سداسي مثل #6366f1) */
  accentColor: string
  shopName: string
  headerLines: string[] // عنوان، هاتف، رقم ضريبي…
  footerText: string // «شكراً لزيارتكم…»
  /** شعار المحل (Data URL بعد الرفع من الإعدادات) — '' يعني بدون شعار */
  logoDataUrl: string
  /** علامة مائية اختيارية على فاتورة A4 */
  watermarkEnabled: boolean
  watermarkText: string
  // ─── تحكم كامل في إظهار/إخفاء عناصر الفاتورة ───
  showLogo: boolean
  showHeaderLines: boolean
  showDate: boolean
  showCustomer: boolean
  showPayment: boolean
  showItemCounts: boolean
  showDiscount: boolean
  showTaxSummary: boolean
  /** المبلغ كتابةً (تفقيط) — فاتورة A4 */
  showWords: boolean
  /** خانتا التوقيع — فاتورة A4 */
  showSignatures: boolean
  showFooter: boolean
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  paperWidth: '80',
  defaultTemplate: 'thermal',
  a4Style: 'modern',
  accentColor: '#6366f1',
  shopName: '',
  headerLines: [],
  footerText: 'شكراً لزيارتكم 🌹',
  logoDataUrl: '',
  watermarkEnabled: false,
  watermarkText: '',
  showLogo: true,
  showHeaderLines: true,
  showDate: true,
  showCustomer: true,
  showPayment: true,
  showItemCounts: true,
  showDiscount: true,
  showTaxSummary: true,
  showWords: true,
  showSignatures: true,
  showFooter: true,
}

export interface ReceiptRow {
  nameAr: string
  qtyLabel: string // «2» أو «0.750 كجم»
  unitPriceMinor: Minor
  totalMinor: Minor // بعد خصم السطر
  discountPercent: number
  /** سيريالات/IMEI القطع المعيّنة — تُطبع تحت اسم الصنف (نمط موبايل شوب) */
  serials: string[]
}

export interface ReceiptModel {
  shopName: string
  headerLines: string[]
  invoiceNumber: string
  dateLabel: string // 2026-09-14 22:10
  customerName: string // «عميل نقدي» أو الاسم
  paymentLabel: string // كاش / آجل
  rows: ReceiptRow[]
  itemCount: number // عدد الأسطر
  totalQty: number // إجمالي القطع (الوزني يُحسب بقيمته)
  grossMinor: Minor
  taxBaseMinor: Minor // الأساس الضريبي (يظهر في فاتورة A4)
  discountMinor: Minor // إجمالي الخصومات (يظهر فقط إن وجد)
  taxLabel: string | null // «ض.ق.م 14٪ (مشمولة)» أو null
  taxMinor: Minor
  totalMinor: Minor // المستحق النهائي
  footerText: string
}

/** بناء نموذج الإيصال من الفاتورة — كل الأرقام من totals المحفوظة (لا إعادة حساب) */
export function buildReceiptModel(args: {
  invoiceNumber: string
  dateIso: string
  lines: CartLine[]
  totals: CartTotals
  payment: PaymentMethod
  customerName: string | null
  taxPercent: number
  taxInclusive: boolean
  settings: ReceiptSettings
}): ReceiptModel {
  const { lines, totals, settings } = args
  const rows: ReceiptRow[] = lines.map((l) => {
    const gross = Math.round(l.unitPriceMinor * l.qty)
    const net = Math.round(gross * (1 - l.discountPercent / 100))
    return {
      nameAr: l.nameAr,
      qtyLabel: l.soldByWeight ? `${l.qty} كجم` : String(l.qty),
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: net,
      discountPercent: l.discountPercent,
      serials: l.serials ?? [],
    }
  })
  const totalQty = Math.round(lines.reduce((a, l) => a + l.qty, 0) * 1000) / 1000
  const taxLabel =
    settings.showTaxSummary && args.taxPercent > 0 && totals.taxMinor > 0
      ? `ض.ق.م ${args.taxPercent}٪ ${args.taxInclusive ? '(مشمولة في الإجمالي)' : '(مضافة)'}`
      : null
  return {
    shopName: settings.shopName || 'كونتاشو',
    headerLines: settings.headerLines.filter((l) => l.trim()),
    invoiceNumber: args.invoiceNumber,
    dateLabel: args.dateIso.slice(0, 16).replace('T', ' '),
    customerName: args.customerName ?? 'عميل نقدي',
    paymentLabel: args.payment === 'cash' ? 'نقدي' : 'آجل',
    rows,
    itemCount: rows.length,
    totalQty,
    grossMinor: totals.grossMinor,
    taxBaseMinor: totals.taxBaseMinor,
    discountMinor: totals.discountMinor,
    taxLabel,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    footerText: settings.footerText,
  }
}
