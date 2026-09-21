/**
 * قسم طباعة الباركود والسيريال (طلب المالك — بالطريقة الاحترافية لمحلات البيع):
 * قالب الملصق يُضبط مرة واحدة (المقاس، ما يظهر على الملصق، سطر مخصص)
 * ويُطبق تلقائياً على كل طباعة لاحقة — ملصقات أصناف وملصقات سيريال.
 * نواة خالصة بلا واجهات.
 */

/** مقاسات الملصقات الشائعة في محلات البيع (A4 مقسمة شبكة، أو رول حراري) */
export interface LabelSize {
  id: string
  nameAr: string
  kind: 'a4' | 'roll' // A4 شبكة على ورق عادي/لاصق — رول لطابعات الملصقات الحرارية
  cols: number // أعمدة الشبكة (rol = 1)
  widthMm: number // عرض الملصق الواحد
  heightMm: number
  fontScale: number // معامل حجم الخط حسب صغر الملصق
}

export const LABEL_SIZES: LabelSize[] = [
  { id: 'a4-24', nameAr: 'A4 — ‏24 ملصق (3×8) 64×34مم', kind: 'a4', cols: 3, widthMm: 64, heightMm: 34, fontScale: 1 },
  { id: 'a4-40', nameAr: 'A4 — ‏40 ملصق (4×10) 48×26مم', kind: 'a4', cols: 4, widthMm: 48, heightMm: 26, fontScale: 0.85 },
  { id: 'a4-65', nameAr: 'A4 — ‏65 ملصق (5×13) 38×21مم', kind: 'a4', cols: 5, widthMm: 38, heightMm: 21, fontScale: 0.72 },
  { id: 'roll-50x25', nameAr: 'رول حراري 50×25مم (الأشهر)', kind: 'roll', cols: 1, widthMm: 50, heightMm: 25, fontScale: 0.9 },
  { id: 'roll-40x30', nameAr: 'رول حراري 40×30مم', kind: 'roll', cols: 1, widthMm: 40, heightMm: 30, fontScale: 0.85 },
  { id: 'roll-100x50', nameAr: 'رول حراري 100×50مم (سيريال/شحن)', kind: 'roll', cols: 1, widthMm: 100, heightMm: 50, fontScale: 1.15 },
]

export function labelSize(id: string): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[0]
}

/** قالب الملصق — يُضبط مرة ويسري على كل الطباعات */
export interface LabelSettings {
  sizeId: string
  showShopName: boolean
  showPrice: boolean
  showCode: boolean // الرقم المقروء تحت الأعمدة
  showSku: boolean
  /** سطر مخصص يظهر أسفل كل ملصق (هاتف المحل، «يُستبدل خلال 14 يوماً»...) */
  customLine: string
  /* خيارات ملصق السيريال */
  serialShowItemName: boolean
  serialShowWarranty: boolean
  serialShowDate: boolean // تاريخ الدخول
}

export const DEFAULT_LABEL_SETTINGS: LabelSettings = {
  sizeId: 'a4-40',
  showShopName: true,
  showPrice: true,
  showCode: true,
  showSku: false,
  customLine: '',
  serialShowItemName: true,
  serialShowWarranty: true,
  serialShowDate: false,
}

/** بيانات ملصق صنف جاهزة للرسم */
export interface ItemLabelData {
  nameAr: string
  barcode: string
  sku: string
  priceMinor: number
  count: number
}

/** بيانات ملصق سيريال جاهزة للرسم — السيريال كُتب مرة عند الشراء ويُطبع تلقائياً */
export interface SerialLabelData {
  serial: string
  itemNameAr: string
  warrantyMonths: number
  receivedAt: string // ISO
}

/** تحقق قبل الطباعة — قائمة أخطاء عربية (فارغة = سليم) */
export function validateLabelPrint(labels: number): string[] {
  const errors: string[] = []
  if (labels <= 0) errors.push('حدد ملصقاً واحداً على الأقل للطباعة')
  if (labels > 2000) errors.push('حد الطباعة 2000 ملصق في المرة — قسّمها على دفعات')
  return errors
}
