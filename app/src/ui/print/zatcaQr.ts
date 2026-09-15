/**
 * توليد صورة رمز QR زاتكا (Data URL) لطباعتها على الفواتير —
 * يُستدعى فقط عندما تكون ميزة einvoice_sa مفعلة بالمفتاح وإعدادات الممول مكتملة.
 */
import QRCode from 'qrcode'
import { buildZatcaQr, isValidSaVatNumber, type ZatcaFields } from '../../core/einvoice.ts'
import { zatcaQrPolicy } from '../../core/invoiceEdit.ts'

/** يعيد Data URL للرمز أو null لو البيانات غير مكتملة (لا يرمي — الطباعة تكمل بلا رمز) */
export async function zatcaQrDataUrl(fields: ZatcaFields): Promise<string | null> {
  try {
    if (!fields.sellerName.trim() || !isValidSaVatNumber(fields.vatNumber)) return null
    const payload = buildZatcaQr(fields)
    return await QRCode.toDataURL(payload, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}

/**
 * رمز الفاتورة إن كانت الميزة مستحقة — يجمع شروط القرار 30 + سياسة المالك في مكان واحد:
 * ① ميزة einvoice_sa مفعلة بمفتاح الترخيص من بوت المطور
 * ② متصل بالإنترنت الآن (المرحلة الثانية من زاتكا تتطلب ربط الفاتورة بالمنظومة —
 *    بلا اتصال تُطبع الفاتورة بلا باركود ضريبي، والمبلغ الضريبي يظهر طبيعياً دائماً)
 * ③ خيار الطباعة مفعل + رقم ضريبي سعودي صالح.
 */
export async function maybeZatcaQr(args: {
  featureActive: boolean
  printEnabled: boolean
  sellerName: string
  vatNumber: string
  dateIso: string
  totalMinor: number
  taxMinor: number
  decimals: number
  /** حالة الاتصال — الافتراضي قراءة المتصفح؛ قابلة للتمرير للفحص */
  online?: boolean
}): Promise<string | undefined> {
  const online = args.online ?? (typeof navigator !== 'undefined' ? navigator.onLine : true)
  const policy = zatcaQrPolicy({ featureActive: args.featureActive, online, printEnabled: args.printEnabled })
  if (!policy.printQr) return undefined
  const url = await zatcaQrDataUrl({
    sellerName: args.sellerName,
    vatNumber: args.vatNumber,
    timestampIso: args.dateIso,
    totalWithVatMinor: args.totalMinor,
    vatMinor: args.taxMinor,
    decimals: args.decimals,
  })
  return url ?? undefined
}
