/**
 * توليد صورة رمز QR زاتكا (Data URL) لطباعتها على الفواتير —
 * يُستدعى فقط عندما تكون ميزة einvoice_sa مفعلة بالمفتاح وإعدادات الممول مكتملة.
 */
import QRCode from 'qrcode'
import { buildZatcaQr, isValidSaVatNumber, type ZatcaFields } from '../../core/einvoice.ts'

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
 * رمز الفاتورة إن كانت الميزة مستحقة — يجمع شروط القرار 30 في مكان واحد:
 * ميزة einvoice_sa مفعلة بالمفتاح + خيار الطباعة مفعل + رقم ضريبي سعودي صالح.
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
}): Promise<string | undefined> {
  if (!args.featureActive || !args.printEnabled) return undefined
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
