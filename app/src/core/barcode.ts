/**
 * باركود الميزان (Scale Barcode) — ShopSys
 * ─────────────────────────────────────────
 * (طلب المالك): البائع على الأجبان يزن القطعة، الميزان يطبع باركوداً
 * يحمل كود الصنف + الوزن، والكاشير يمسحه فتُضاف القطعة بوزنها وسعرها فوراً.
 *
 * الصيغة القياسية (EAN-13 مثل موازين الدلتا والسوبر ماركت):
 *   [بادئة 2 خانة، افتراضي 22] [كود الصنف 5 خانات] [الوزن بالجرام 5 خانات] [خانة تحقق اختيارية]
 *   مثال: 22 00042 00750 → الصنف 42 بوزن 0.750 كجم
 */

export interface ScaleBarcodeConfig {
  prefix: string // '22' افتراضياً — قابل للضبط من الإعدادات
  itemCodeLen: number // 5
  weightLen: number // 5 (بالجرام)
}

export const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = { prefix: '22', itemCodeLen: 5, weightLen: 5 }

export interface ScaleParse {
  itemCode: string // الكود بلا أصفار بادئة
  weightKg: number // الوزن بالكيلوجرام
}

/** يحاول تفسير الباركود كباركود ميزان — يعيد null إن لم يطابق الصيغة */
export function parseScaleBarcode(raw: string, cfg: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG): ScaleParse | null {
  const code = raw.trim()
  if (!/^\d+$/.test(code)) return null
  if (!code.startsWith(cfg.prefix)) return null
  const bodyLen = cfg.prefix.length + cfg.itemCodeLen + cfg.weightLen
  // نقبل بخانة تحقق (EAN-13) أو بدونها
  if (code.length !== bodyLen && code.length !== bodyLen + 1) return null
  const itemCodeRaw = code.slice(cfg.prefix.length, cfg.prefix.length + cfg.itemCodeLen)
  const weightRaw = code.slice(cfg.prefix.length + cfg.itemCodeLen, bodyLen)
  const grams = parseInt(weightRaw, 10)
  if (!Number.isFinite(grams) || grams <= 0) return null
  const itemCode = String(parseInt(itemCodeRaw, 10)) // إزالة الأصفار البادئة
  return { itemCode, weightKg: grams / 1000 }
}

/** توليد باركود ميزان لصنف ووزن (لطباعة الملصقات لاحقاً) */
export function buildScaleBarcode(itemCode: number, weightKg: number, cfg: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG): string {
  const grams = Math.round(weightKg * 1000)
  if (grams <= 0 || grams >= 10 ** cfg.weightLen) throw new RangeError('وزن خارج نطاق الباركود')
  if (itemCode <= 0 || itemCode >= 10 ** cfg.itemCodeLen) throw new RangeError('كود صنف خارج النطاق')
  return cfg.prefix + String(itemCode).padStart(cfg.itemCodeLen, '0') + String(grams).padStart(cfg.weightLen, '0')
}

/** مطابقة كود الميزان مع صنف: يقارن بالباركودات وبالرقم داخل SKU */
export function matchScaleItem<T extends { id: number; sku: string; barcodes: string[]; soldByWeight: boolean }>(
  itemCode: string,
  items: T[],
): T | undefined {
  // أولوية 1: باركود مسجل يساوي الكود (بأصفار أو بدونها)
  const byBarcode = items.find((it) =>
    it.barcodes.some((b) => b === itemCode || String(parseInt(b, 10)) === itemCode),
  )
  if (byBarcode) return byBarcode
  // أولوية 2: الرقم داخل SKU (ITM-1042 → 1042)
  return items.find((it) => {
    const n = it.sku.replace(/\D/g, '')
    return n && String(parseInt(n, 10)) === itemCode && it.soldByWeight
  })
}
