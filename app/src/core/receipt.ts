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
  /** موضع الشعار في رأس فاتورة A4 (طلب المالك): بجانب الاسم / فوق الاسم في المنتصف / منتصف الرأس */
  logoPosition: 'side' | 'above' | 'center'
  /** حجم الشعار بالمليمتر (ارتفاع أقصى) 10–60 */
  logoSizeMm: number
  /** شفافية الشعار 10–100٪ */
  logoOpacity: number
  /** علامة مائية اختيارية على فاتورة A4 — بتحكم كامل (طلب المالك) */
  watermarkEnabled: boolean
  watermarkText: string
  /** زاوية الميل بالدرجات: -90 إلى 90 (سالب = مائل يميناً) */
  watermarkRotation: number
  /** حجم الخط بالنقاط 24–140 */
  watermarkSizePt: number
  /** الشفافية 3–30٪ — فوق ذلك تطغى على المحتوى */
  watermarkOpacity: number
  /** لون العلامة المائية */
  watermarkColor: string
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
  logoPosition: 'side',
  logoSizeMm: 22,
  logoOpacity: 100,
  watermarkEnabled: false,
  watermarkText: '',
  watermarkRotation: -30,
  watermarkSizePt: 72,
  watermarkOpacity: 8,
  watermarkColor: '#64748b',
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
  /** عنوان المستند المطبوع — الافتراضي «فاتورة مبيعات»؛ للمرتجع: «مرتجع مبيعات» */
  docTitle?: string
  invoiceNumber: string
  /** الرقم المرجعي للتتبع — يُطبع تحت رقم الفاتورة ويبحث به العميل لاحقاً */
  refCode: string
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
  /** المحصل وقت البيع (الدفع المجزأ) — يُطبع «المدفوع/المتبقي» عندما لا يساوي الإجمالي */
  paidMinor: Minor
  remainingMinor: Minor
  footerText: string
  /** رمز QR زاتكا (Data URL) — يُطبع أسفل الفاتورة عند تفعيل الميزة (القرار 30) */
  qrDataUrl?: string
}

/** بناء نموذج الإيصال من الفاتورة — كل الأرقام من totals المحفوظة (لا إعادة حساب) */
export function buildReceiptModel(args: {
  invoiceNumber: string
  refCode?: string
  dateIso: string
  lines: CartLine[]
  totals: CartTotals
  payment: PaymentMethod
  /** المحصل وقت البيع (الدفع المجزأ) — undefined = حسب payment */
  paidMinor?: Minor
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
  // الدفع المجزأ (بلاغ المالك): المدفوع والمتبقي يُطبعان — لا قيمة الفاتورة وحدها
  const paid = args.paidMinor ?? (args.payment === 'cash' ? totals.totalMinor : 0)
  const remaining = totals.totalMinor - paid
  const taxLabel =
    settings.showTaxSummary && args.taxPercent > 0 && totals.taxMinor > 0
      ? `ض.ق.م ${args.taxPercent}٪ ${args.taxInclusive ? '(مشمولة في الإجمالي)' : '(مضافة)'}`
      : null
  return {
    shopName: settings.shopName || 'تَحَكَّم',
    headerLines: settings.headerLines.filter((l) => l.trim()),
    invoiceNumber: args.invoiceNumber,
    refCode: args.refCode ?? '',
    dateLabel: args.dateIso.slice(0, 16).replace('T', ' '),
    customerName: args.customerName ?? 'عميل نقدي',
    paymentLabel: remaining <= 0 ? 'نقدي' : paid > 0 ? 'مجزأ — جزء محصل والباقي آجل' : 'آجل',
    rows,
    itemCount: rows.length,
    totalQty,
    grossMinor: totals.grossMinor,
    taxBaseMinor: totals.taxBaseMinor,
    discountMinor: totals.discountMinor,
    taxLabel,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    paidMinor: paid,
    remainingMinor: remaining,
    footerText: settings.footerText,
  }
}
