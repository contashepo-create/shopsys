/**
 * الفاتورة الإلكترونية — تَحَكَّم TAHAKAM ERP (القرار 30)
 * ──────────────────────────────────────────
 * ميزة مدفوعة يفعّلها المطوّر بمفتاح الترخيص فقط (einvoice_sa / einvoice_eg):
 *
 * السعودية (زاتكا — المرحلة الأولى «الفاتورة المبسطة»):
 *   رمز QR إلزامي على كل فاتورة، محتواه TLV مُرمَّز Base64 بخمسة حقول:
 *   1: اسم البائع  2: الرقم الضريبي  3: طابع زمني ISO  4: الإجمالي بالضريبة  5: قيمة الضريبة
 *
 * مصر (بوابة الضرائب المصرية ETA):
 *   تصدير مستند JSON بالبنية المطلوبة للرفع على البوابة
 *   (المُصدر/المستلم/بنود بأكواد GS1|EGS/إجماليات الضريبة T1).
 *
 * كل الدوال نقية — لا شبكة ولا DOM.
 */
import type { Minor } from './money.ts'

/* ─── إعدادات الممول (تُحفظ في مخزن التطبيق) ─── */

export interface EinvoiceSettings {
  /** تشغيل الإصدار الإلكتروني الفعلي لدى المنشأة؛ إيقافه يعيد دورة التعديل المحلية. */
  enabled: boolean
  /** الرقم الضريبي للممول (السعودية: 15 رقماً 3…3 — مصر: 9 أرقام) */
  taxNumber: string
  /** عنوان المنشأة (مطلوب لمستند مصر) */
  address: string
  /** طباعة الرمز الضريبي (QR) تلقائياً على كل فاتورة/إيصال — زاتكا TLV في السعودية
   *  أو رمز التحقق المحلي في مصر، كلٌّ حسب الميزة المفعّلة بمفتاح الترخيص. مفتاح
   *  واحد هنا داخل قسم الفاتورة الإلكترونية فقط — لا علاقة له بإعدادات الضريبة العامة. */
  printZatcaQr: boolean
}

export const DEFAULT_EINVOICE_SETTINGS: EinvoiceSettings = {
  enabled: false,
  taxNumber: '',
  address: '',
  printZatcaQr: true,
}

/* ─── السعودية: زاتكا TLV ─── */

export interface ZatcaFields {
  sellerName: string
  vatNumber: string // 15 رقماً يبدأ وينتهي بـ3
  timestampIso: string // ISO 8601
  totalWithVatMinor: Minor
  vatMinor: Minor
  decimals: number // خانات العملة (السعودية: 2)
}

/** تحويل Minor إلى نص عشري بعدد خانات ثابت: 150050 ← "1500.50" */
export function minorToDecimalString(minor: Minor, decimals: number): string {
  if (!Number.isInteger(minor) || minor < 0) throw new RangeError('المبلغ يجب أن يكون صحيحاً غير سالب')
  if (decimals === 0) return String(minor)
  const s = String(minor).padStart(decimals + 1, '0')
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`
}

/** أرقام فقط — يتحمل لصق الأرقام بمسافات أو شرطات من لوحة المفاتيح/الفاتورة الورقية */
const digitsOnly = (value: string) => value.replace(/[\s-]/g, '')

/** التحقق من الرقم الضريبي السعودي: 15 رقماً، يبدأ وينتهي بـ3 */
export function isValidSaVatNumber(vat: string): boolean {
  return /^3\d{13}3$/.test(digitsOnly(vat))
}

/** التحقق من رقم التسجيل الضريبي المصري: 9 أرقام */
export function isValidEgTaxNumber(tax: string): boolean {
  return /^\d{9}$/.test(digitsOnly(tax))
}

/**
 * طابع زاتكا: ISO 8601 كامل بتاريخ ووقت ومنطقة زمنية (Z أو ±HH:MM).
 * `Date.parse` وحده يقبل «2026-02-30» ويحوّلها إلى 2 مارس — فيُرمَّز تاريخ
 * غير موجود في رمز ضريبي. هنا نتحقق من اليوم التقويمي نفسه بعد التحويل.
 * الميلي ثانية اختيارية (1–3 أرقام).
 */
const ZATCA_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
export function isValidZatcaTimestamp(value: string): boolean {
  if (!ZATCA_TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) return false
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

export function validateZatcaFields(f: ZatcaFields): string[] {
  const errors: string[] = []
  if (!f.sellerName.trim()) errors.push('اسم البائع مطلوب لرمز QR')
  /* TLV يحمل الطول في بايت واحد (≤255)؛ الفحص هنا يعطي رسالة عربية واضحة
     بدل RangeError تُلتقط صامتاً في مسار الطباعة فيختفي الرمز بلا سبب. */
  else if (new TextEncoder().encode(f.sellerName.trim()).length > 255) errors.push('اسم البائع أطول من 255 بايت — لا يتسع له رمز QR')
  if (!isValidSaVatNumber(f.vatNumber)) errors.push('الرقم الضريبي السعودي يجب أن يكون 15 رقماً يبدأ وينتهي بـ3')
  if (!isValidZatcaTimestamp(f.timestampIso)) errors.push('طابع زمني غير صالح (يلزم ISO 8601 كامل بتاريخ ووقت ومنطقة زمنية)')
  if (!Number.isInteger(f.totalWithVatMinor) || f.totalWithVatMinor < 0) errors.push('الإجمالي غير صالح')
  if (!Number.isInteger(f.vatMinor) || f.vatMinor < 0) errors.push('قيمة الضريبة غير صالحة')
  if (f.vatMinor > f.totalWithVatMinor) errors.push('الضريبة لا تتجاوز الإجمالي')
  return errors
}

/** بايتات TLV لحقل واحد: [رقم الحقل، الطول بالبايت، القيمة UTF-8] */
export function tlvBytes(tag: number, value: string): number[] {
  const utf8 = Array.from(new TextEncoder().encode(value))
  if (utf8.length > 255) throw new RangeError(`قيمة الحقل ${tag} أطول من 255 بايت`)
  return [tag, utf8.length, ...utf8]
}

/** سلسلة QR زاتكا كاملة: TLV للحقول الخمسة ثم Base64 */
export function buildZatcaQr(f: ZatcaFields): string {
  const errors = validateZatcaFields(f)
  if (errors.length) throw new Error(errors.join(' — '))
  const bytes = [
    ...tlvBytes(1, f.sellerName.trim()),
    ...tlvBytes(2, digitsOnly(f.vatNumber)),
    ...tlvBytes(3, f.timestampIso),
    ...tlvBytes(4, minorToDecimalString(f.totalWithVatMinor, f.decimals)),
    ...tlvBytes(5, minorToDecimalString(f.vatMinor, f.decimals)),
  ]
  // btoa غير متاح في Node القديم — نبني Base64 يدوياً من البايتات (يعمل في المتصفح وNode)
  return bytesToBase64(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function bytesToBase64(bytes: number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}

/** فك TLV (للفحص والتحقق): يعيد خريطة {tag: value} */
export function decodeZatcaQr(base64: string): Map<number, string> {
  const bin = base64ToBytes(base64)
  const map = new Map<number, string>()
  let i = 0
  const decoder = new TextDecoder()
  while (i + 1 < bin.length) {
    const tag = bin[i]
    const len = bin[i + 1]
    map.set(tag, decoder.decode(new Uint8Array(bin.slice(i + 2, i + 2 + len))))
    i += 2 + len
  }
  return map
}

export function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/=+$/, '')
  const out: number[] = []
  let buffer = 0, bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) throw new Error('Base64 غير صالح')
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return out
}

/* ─── مصر: مستند بوابة الضرائب (ETA) ─── */

export interface EgInvoiceLineInput {
  nameAr: string
  /** كود الصنف GS1 (باركود دولي) أو EGS (كود داخلي مسجل بالبوابة) */
  itemCode: string
  codeType: 'GS1' | 'EGS'
  qty: number
  unitPriceMinor: Minor
  discountMinor: Minor
  taxMinor: Minor
}

export interface EgInvoiceInput {
  issuerName: string
  issuerTaxNumber: string // 9 أرقام
  issuerAddress: string
  receiverName: string
  receiverTaxNumber: string // فارغ للمستهلك النهائي (B2C تحت الحد)
  invoiceNumber: string
  dateIso: string
  lines: EgInvoiceLineInput[]
  totalDiscountMinor: Minor
  totalTaxMinor: Minor
  totalMinor: Minor
  decimals: number
}

export function validateEgInvoice(inv: EgInvoiceInput): string[] {
  const errors: string[] = []
  if (!inv.issuerName.trim()) errors.push('اسم المُصدر مطلوب')
  if (!isValidEgTaxNumber(inv.issuerTaxNumber)) errors.push('رقم التسجيل الضريبي المصري 9 أرقام')
  if (inv.receiverTaxNumber && !isValidEgTaxNumber(inv.receiverTaxNumber)) errors.push('رقم تسجيل المستلم (إن وُجد) 9 أرقام')
  if (!inv.invoiceNumber.trim()) errors.push('رقم الفاتورة مطلوب')
  if (inv.lines.length === 0) errors.push('الفاتورة بلا بنود')
  for (const l of inv.lines) {
    if (!l.itemCode.trim()) errors.push(`البند «${l.nameAr}» بلا كود صنف (GS1/EGS) — سجّل الباركود أو الكود الداخلي`)
    if (l.qty <= 0) errors.push(`كمية غير صالحة في «${l.nameAr}»`)
  }
  return errors
}

/* ─── مصر: رمز تحقق محلي على الإيصال المطبوع (مستقل عن رفع JSON لبوابة ETA) ───
 * بلاغ المالك: الباركود الضريبي لا يظهر أبداً في مصر لأن القرار 30 كان مُنفَّذاً
 * لزاتكا السعودية فقط. مصر ليس لها رمز QR رسمي موحّد يمكن توليده محلياً بلا رفع
 * فوري عبر الإنترنت لبوابة الضرائب (ذلك الرفع منفصل ويبقى عبر تصدير JSON أعلاه) —
 * لذلك هذا رمز تحقق محلي بسيط يُطبع على كل إيصال: الرقم الضريبي ورقم الفاتورة
 * والتاريخ والإجمالي، ليتحقق منه العميل أو المراجع يدوياً دون اتصال بالإنترنت. */
export interface EgReceiptBarcodeFields {
  sellerName: string
  taxNumber: string // 9 أرقام
  invoiceNumber: string
  dateIso: string
  totalMinor: Minor
  decimals: number
}

export function validateEgReceiptBarcodeFields(f: EgReceiptBarcodeFields): string[] {
  const errors: string[] = []
  if (!f.sellerName.trim()) errors.push('اسم البائع مطلوب لرمز الإيصال')
  if (!isValidEgTaxNumber(f.taxNumber)) errors.push('رقم التسجيل الضريبي المصري يجب أن يكون 9 أرقام')
  if (!f.invoiceNumber.trim()) errors.push('رقم الفاتورة مطلوب لرمز الإيصال')
  if (Number.isNaN(Date.parse(f.dateIso))) errors.push('طابع زمني غير صالح')
  if (!Number.isInteger(f.totalMinor) || f.totalMinor < 0) errors.push('الإجمالي غير صالح')
  return errors
}

/** نص رمز التحقق المحلي المصري: EGTAX1|الرقم الضريبي|رقم الفاتورة|التاريخ|الإجمالي */
export function buildEgReceiptBarcodeText(f: EgReceiptBarcodeFields): string {
  const errors = validateEgReceiptBarcodeFields(f)
  if (errors.length) throw new Error(errors.join(' — '))
  return [
    'EGTAX1',
    digitsOnly(f.taxNumber),
    f.invoiceNumber.trim(),
    f.dateIso.slice(0, 19),
    minorToDecimalString(f.totalMinor, f.decimals),
  ].join('|')
}

/**
 * بناء مستند JSON بصيغة بوابة الضرائب المصرية (نموذج المستند v1.0) —
 * يُصدَّر ملفاً ويُرفع من بوابة الممول أو يُرسل عبر مزود تكامل.
 */
export function buildEgInvoiceDocument(inv: EgInvoiceInput): Record<string, unknown> {
  const errors = validateEgInvoice(inv)
  if (errors.length) throw new Error(errors.join(' — '))
  const dec = (m: Minor) => Number(minorToDecimalString(m, inv.decimals))
  return {
    issuer: {
      type: 'B',
      /* أرقام فقط: التحقق يتسامح مع الشرطات/المسافات، لكن بوابة ETA ترفضهما
         داخل الحقل نفسه — فكان التصدير يخرج برقم منسّق غير مقبول. */
      id: digitsOnly(inv.issuerTaxNumber),
      name: inv.issuerName.trim(),
      address: { country: 'EG', regionCity: '', street: inv.issuerAddress || '—', buildingNumber: '—' },
    },
    receiver: inv.receiverTaxNumber
      ? { type: 'B', id: digitsOnly(inv.receiverTaxNumber), name: inv.receiverName || '—' }
      : { type: 'P', id: '', name: inv.receiverName || 'مستهلك نهائي' },
    documentType: 'I',
    documentTypeVersion: '1.0',
    dateTimeIssued: inv.dateIso,
    internalID: inv.invoiceNumber,
    invoiceLines: inv.lines.map((l) => {
      const salesTotal = dec(Math.round(l.unitPriceMinor * l.qty))
      const netTotal = dec(Math.round(l.unitPriceMinor * l.qty) - l.discountMinor)
      return {
        description: l.nameAr,
        itemType: l.codeType,
        itemCode: l.itemCode,
        unitType: 'EA',
        quantity: l.qty,
        unitValue: { currencySold: 'EGP', amountEGP: dec(l.unitPriceMinor) },
        salesTotal,
        discount: { rate: 0, amount: dec(l.discountMinor) },
        netTotal,
        taxableItems: l.taxMinor > 0 ? [{ taxType: 'T1', subType: 'V009', rate: 14, amount: dec(l.taxMinor) }] : [],
        total: dec(Math.round(l.unitPriceMinor * l.qty) - l.discountMinor + l.taxMinor),
      }
    }),
    totalDiscountAmount: dec(inv.totalDiscountMinor),
    totalSalesAmount: dec(inv.totalMinor - inv.totalTaxMinor + inv.totalDiscountMinor),
    netAmount: dec(inv.totalMinor - inv.totalTaxMinor),
    taxTotals: inv.totalTaxMinor > 0 ? [{ taxType: 'T1', amount: dec(inv.totalTaxMinor) }] : [],
    totalAmount: dec(inv.totalMinor),
  }
}
