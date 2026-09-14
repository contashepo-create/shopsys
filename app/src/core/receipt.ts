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

export interface ReceiptSettings {
  paperWidth: PaperWidth
  defaultTemplate: InvoiceTemplate
  shopName: string
  headerLines: string[] // عنوان، هاتف، رقم ضريبي…
  footerText: string // «شكراً لزيارتكم…»
  showTaxSummary: boolean
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  paperWidth: '80',
  defaultTemplate: 'thermal',
  shopName: '',
  headerLines: [],
  footerText: 'شكراً لزيارتكم 🌹',
  showTaxSummary: true,
}

export interface ReceiptRow {
  nameAr: string
  qtyLabel: string // «2» أو «0.750 كجم»
  unitPriceMinor: Minor
  totalMinor: Minor // بعد خصم السطر
  discountPercent: number
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
    }
  })
  const totalQty = Math.round(lines.reduce((a, l) => a + l.qty, 0) * 1000) / 1000
  const taxLabel =
    settings.showTaxSummary && args.taxPercent > 0 && totals.taxMinor > 0
      ? `ض.ق.م ${args.taxPercent}٪ ${args.taxInclusive ? '(مشمولة في الإجمالي)' : '(مضافة)'}`
      : null
  return {
    shopName: settings.shopName || 'ShopSys',
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
