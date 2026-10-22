/**
 * توليد صورة الرمز الضريبي (Data URL) لطباعته على الفواتير/الإيصالات.
 * الطباعة تشترط مجتمعاً: ميزة الترخيص (einvoice_sa/einvoice_eg) + تشغيل
 * الإصدار الرسمي + رقم ضريبي واسم منشأة صالحين + مفتاح einvoice.printZatcaQr.
 * لا تشترط اتصالاً بالإنترنت: رمز المرحلة الأولى (Generation) يُولَّد محلياً،
 * واشتراط الاتصال يخص الربط/الإرسال (المرحلة الثانية) وحدهما. البلد المفعّل يحدد:
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
    /* margin = 4 وحدات: منطقة الهدوء التي يفرضها معيار QR (ISO/IEC 18004) —
       بأقل من ذلك ترفض كاميرات كثيرة المسح وخصوصاً على ورق حراري لامع */
    return await QRCode.toDataURL(payload, { margin: 4, width: 220, errorCorrectionLevel: 'M' })
  } catch {
    return null
  }
}

/** يعيد Data URL لرمز التحقق المحلي المصري أو null لو البيانات غير مكتملة */
export async function egBarcodeDataUrl(fields: EgReceiptBarcodeFields): Promise<string | null> {
  try {
    if (!fields.sellerName.trim() || !isValidEgTaxNumber(fields.taxNumber)) return null
    const payload = buildEgReceiptBarcodeText(fields)
    return await QRCode.toDataURL(payload, { margin: 4, width: 220, errorCorrectionLevel: 'M' })
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
}

/**
 * طابع زاتكا الزمني (الحقل 3) يجب أن يكون ISO 8601 كاملاً. بعض المستندات
 * (عقود الإيجار مثلًا) تحمل تاريخاً بلا وقت `YYYY-MM-DD`، فنكمله بمنتصف ليل UTC
 * بدل تمرير قيمة ناقصة إلى المنظومة.
 */
function normalizeZatcaTimestamp(iso: string): string {
  const value = iso.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
}

/**
 * أي بلد سيُطبع رمزه؟ (null = لا رمز) — مصدر الحقيقة الوحيد لسياسة الطباعة،
 * تستخدمه النسخة المتزامنة وغير المتزامنة معاً فلا تتباعد شروطهما أبداً.
 */
function resolveTaxBarcodeKind(args: TaxBarcodeArgs): 'sa' | 'eg' | null {
  if (args.saFeatureActive) {
    return zatcaQrPolicy({ featureActive: true, printEnabled: args.printEnabled }).printQr ? 'sa' : null
  }
  if (args.egFeatureActive) {
    return egTaxBarcodePolicy({ featureActive: true, printEnabled: args.printEnabled }).printQr ? 'eg' : null
  }
  return null
}

/**
 * الرمز الضريبي للفاتورة إن كانت إحدى الميزتين مستحقة — مفتاح طباعة واحد
 * (einvoice.printZatcaQr) يُحترم لكلا البلدين، وكل بلد بسياسته الخاصة:
 * ① السعودية: ميزة einvoice_sa + تشغيل الإصدار الإلكتروني + رقم ضريبي سعودي صالح — بلا اشتراط اتصال (رمز Generation محلي).
 * ② مصر: ميزة einvoice_eg + رقم تسجيل ضريبي مصري صالح — بلا اشتراط اتصال (رمز محلي).
 * السعودية لها أولوية إن كانت الميزتان مفعلتين معاً (حالة نظرية لا تقع عملياً).
 */
export async function maybeTaxBarcode(args: TaxBarcodeArgs): Promise<string | undefined> {
  const kind = resolveTaxBarcodeKind(args)
  if (kind === 'sa') {
    const url = await zatcaQrDataUrl({
      sellerName: args.sellerName,
      vatNumber: args.taxNumber,
      timestampIso: normalizeZatcaTimestamp(args.dateIso),
      totalWithVatMinor: args.totalMinor,
      vatMinor: args.taxMinor,
      decimals: args.decimals,
    })
    return url ?? undefined
  }
  if (kind === 'eg') {
    const url = await egBarcodeDataUrl({
      sellerName: args.sellerName,
      taxNumber: args.taxNumber,
      invoiceNumber: args.invoiceNumber,
      dateIso: normalizeZatcaTimestamp(args.dateIso),
      totalMinor: args.totalMinor,
      decimals: args.decimals,
    })
    return url ?? undefined
  }
  return undefined
}

/* ─── نسخة متزامنة (SVG) — للمسارات التي تطبع فوراً داخل دالة متزامنة ───
 * شاشات كثيرة تطبع من زر مباشرةً بلا async (مرتجع/مقاولات/إيجار/نقل/مطعم…)؛
 * انتظار صورة PNG كان يعني تحويل كل دالة طباعة إلى async — وهي فرصة سهلة
 * لنسيان الرمز. هنا نولّد نفس محتوى TLV ونرسمه SVG فوراً، فتستدعيه أي شاشة
 * بسطر واحد قبل الطباعة. النسختان تتشاركان resolveTaxBarcodeKind نفسها. */

/** مصفوفة QR إلى Data URL بصيغة SVG (متزامن — بلا canvas ولا شبكة) */
function qrSvgDataUrl(payload: string): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  let path = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  /* منطقة هدوء 4 وحدات حول المصفوفة (متطلب قراءة QR) — بلاها يلتصق الرمز
     بالنص/حدود الإطار فيفشل مسحه بكاميرا الهاتف. */
  const quiet = 4
  const box = size + quiet * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="#ffffff"/><g transform="translate(${quiet} ${quiet})"><path d="${path}" fill="#000000"/></g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** رمز زاتكا SVG متزامن — null لو البيانات غير مكتملة (لا يرمي) */
export function zatcaQrSvgDataUrl(fields: ZatcaFields): string | null {
  try {
    if (!fields.sellerName.trim() || !isValidSaVatNumber(fields.vatNumber)) return null
    return qrSvgDataUrl(buildZatcaQr(fields))
  } catch {
    return null
  }
}

/** رمز التحقق المصري SVG متزامن — null لو البيانات غير مكتملة (لا يرمي) */
export function egBarcodeSvgDataUrl(fields: EgReceiptBarcodeFields): string | null {
  try {
    if (!fields.sellerName.trim() || !isValidEgTaxNumber(fields.taxNumber)) return null
    return qrSvgDataUrl(buildEgReceiptBarcodeText(fields))
  } catch {
    return null
  }
}

/** نظير maybeTaxBarcode المتزامن — نفس الشروط ونفس السياسة تماماً */
export function maybeTaxBarcodeSync(args: TaxBarcodeArgs): string | undefined {
  const kind = resolveTaxBarcodeKind(args)
  if (kind === 'sa') {
    return zatcaQrSvgDataUrl({
      sellerName: args.sellerName,
      vatNumber: args.taxNumber,
      timestampIso: normalizeZatcaTimestamp(args.dateIso),
      totalWithVatMinor: args.totalMinor,
      vatMinor: args.taxMinor,
      decimals: args.decimals,
    }) ?? undefined
  }
  if (kind === 'eg') {
    return egBarcodeSvgDataUrl({
      sellerName: args.sellerName,
      taxNumber: args.taxNumber,
      invoiceNumber: args.invoiceNumber,
      dateIso: normalizeZatcaTimestamp(args.dateIso),
      totalMinor: args.totalMinor,
      decimals: args.decimals,
    }) ?? undefined
  }
  return undefined
}

/** يُلحق الرمز بنموذج مستند الطباعة متزامناً — تُرجع true لو أُلحق الرمز فعلاً */
export function withTaxBarcodeSync<T extends { qrDataUrl?: string }>(model: T, args: TaxBarcodeArgs): boolean {
  const url = maybeTaxBarcodeSync(args)
  if (!url) {
    /* لا نترك رمزاً قديماً على نموذج أُعيد استخدامه — الطباعة بلا رمز أصدق
       من طباعة رمز لا تجيزه السياسة الحالية */
    delete model.qrDataUrl
    return false
  }
  model.qrDataUrl = url
  return true
}
