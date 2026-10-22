/**
 * توليد صورة الرمز الضريبي (Data URL) لطباعته على الفواتير/الإيصالات —
 * مفتاح واحد داخل قسم الفاتورة الإلكترونية فقط (einvoice.printZatcaQr) يتحكم
 * في الطباعة، بصرف النظر عن أي البلدين مفعَّل بمفتاح الترخيص:
 *   - السعودية (einvoice_sa): رمز زاتكا TLV الرسمي.
 *   - مصر (einvoice_eg): رمز تحقق محلي (EGTAX1) — الرفع الفعلي لبوابة ETA
 *     منفصل تماماً عبر تصدير JSON في شاشة الفاتورة الإلكترونية.
 * بلا ميزة مفعّلة على الإطلاق: لا رمز يُطبع أبداً، والضريبة تُحسب وتُطبع طبيعياً.
 */
import QRCode from 'qrcode'
import { buildZatcaQr, isValidSaVatNumber, buildEgReceiptBarcodeText, isValidEgTaxNumber, type ZatcaFields, type EgReceiptBarcodeFields } from '../../core/einvoice.ts'
import { zatcaQrPolicy, egTaxBarcodePolicy } from '../../core/invoiceEdit.ts'

/** يعيد Data URL لرمز زاتكا أو null لو البيانات غير مكتملة (لا يرمي — الطباعة تكمل بلا رمز) */
export async function zatcaQrDataUrl(fields: ZatcaFields): Promise<string | null> {
  try {
    if (!fields.sellerName.trim() || !isValidSaVatNumber(fields.vatNumber)) return null
    const payload = buildZatcaQr(fields)
    return await QRCode.toDataURL(payload, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}

/** يعيد Data URL لرمز التحقق المحلي المصري أو null لو البيانات غير مكتملة */
export async function egBarcodeDataUrl(fields: EgReceiptBarcodeFields): Promise<string | null> {
  try {
    if (!fields.sellerName.trim() || !isValidEgTaxNumber(fields.taxNumber)) return null
    const payload = buildEgReceiptBarcodeText(fields)
    return await QRCode.toDataURL(payload, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}

export interface TaxBarcodeArgs {
  saFeatureActive: boolean
  egFeatureActive: boolean
  printEnabled: boolean
  sellerName: string
  taxNumber: string
  invoiceNumber: string
  dateIso: string
  totalMinor: number
  taxMinor: number
  decimals: number
  /** حالة الاتصال — الافتراضي قراءة المتصفح؛ قابلة للتمرير للفحص (زاتكا السعودية فقط) */
  online?: boolean
}

/**
 * الرمز الضريبي للفاتورة إن كانت إحدى الميزتين مستحقة — مفتاح طباعة واحد
 * (einvoice.printZatcaQr) يُحترم لكلا البلدين، وكل بلد بسياسته الخاصة:
 * ① السعودية: ميزة einvoice_sa + اتصال إنترنت (مرحلة ثانية زاتكا) + رقم ضريبي سعودي صالح.
 * ② مصر: ميزة einvoice_eg + رقم تسجيل ضريبي مصري صالح — بلا اشتراط اتصال (رمز محلي).
 * السعودية لها أولوية إن كانت الميزتان مفعلتين معاً (حالة نظرية لا تقع عملياً).
 */
export async function maybeTaxBarcode(args: TaxBarcodeArgs): Promise<string | undefined> {
  if (args.saFeatureActive) {
    const online = args.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true)
    const policy = zatcaQrPolicy({ featureActive: args.saFeatureActive, online, printEnabled: args.printEnabled })
    if (!policy.printQr) return undefined
    const url = await zatcaQrDataUrl({
      sellerName: args.sellerName,
      vatNumber: args.taxNumber,
      timestampIso: args.dateIso,
      totalWithVatMinor: args.totalMinor,
      vatMinor: args.taxMinor,
      decimals: args.decimals,
    })
    return url ?? undefined
  }
  if (args.egFeatureActive) {
    const policy = egTaxBarcodePolicy({ featureActive: args.egFeatureActive, printEnabled: args.printEnabled })
    if (!policy.printQr) return undefined
    const url = await egBarcodeDataUrl({
      sellerName: args.sellerName,
      taxNumber: args.taxNumber,
      invoiceNumber: args.invoiceNumber,
      dateIso: args.dateIso,
      totalMinor: args.totalMinor,
      decimals: args.decimals,
    })
    return url ?? undefined
  }
  return undefined
}

/**
 * يُلحق الرمز الضريبي بنموذج مستند الطباعة (نموذج الإيصال/الفاتورة) قبل توليد HTML.
 * مصدر واحد لكل شاشات الطباعة — من ينسى استدعاءه يطبع بلا رمز رغم تفعيل الميزة
 * (كان هذا سبب بلاغ المالك: محرر «فاتورة مبيعات جديدة» يطبع بلا باركود).
 * لا يرمي أبداً: أي نقص في البيانات أو فشل توليد الصورة يعني طباعة بلا رمز فقط.
 */
export async function withTaxBarcode<T extends { qrDataUrl?: string }>(model: T, args: TaxBarcodeArgs): Promise<T> {
  const url = await maybeTaxBarcode(args)
  if (url) model.qrDataUrl = url
  return model
}
