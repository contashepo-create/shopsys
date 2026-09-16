/**
 * باركود الميزان العالمي (Scale Barcode — نمط Barcode Nomenclature في Odoo):
 * ──────────────────────────────────────────────────────────────────────────
 * (طلب المالك): النظام عالمي ولا نعلم أي ميزان سيستخدمه العميل — لذلك بدل
 * صيغة واحدة ثابتة، ندير «قائمة قواعد تفكيك» قابلة للتحرير بالكامل:
 * كل قاعدة تصف صيغة ميزان: البادئة، طول كود الصنف، طول القيمة،
 * نوع القيمة (وزن بالجرام أو سعر إجمالي — الموازين تنقسم بينهما عالمياً)،
 * عدد الكسور، وسياسة خانة التحقق. الكاشير يجرب القواعد الممكّنة بالترتيب.
 *
 * مثال القاعدة الافتراضية (EAN-13 وزن — الأشهر في مصر والخليج):
 *   [22][00042][00750][✓] → الصنف 42 بوزن 0.750 كجم
 * ومثال قاعدة سعر (CAS وكثير من الموازين الأوروبية):
 *   [20][00042][01250][✓] → الصنف 42 بسعر إجمالي 12.50
 *
 * نواة خالصة بلا واجهات — الأموال أعداد صحيحة (Minor) تُشتق في الكاشير.
 */

/* ─── القاعدة العالمية ─── */

export type ScaleValueType = 'weight' | 'price'

export interface ScaleRule {
  id: number
  nameAr: string
  enabled: boolean
  prefix: string // 1-3 خانات رقمية (20-29 محجوزة عالمياً للاستخدام الداخلي)
  itemCodeLen: number // 3-7
  valueLen: number // 3-7
  valueType: ScaleValueType
  /**
   * عدد الكسور داخل القيمة المطبوعة:
   * وزن: 3 = جرامات (00750 → 0.750 كجم)، 2 = عشرات جرامات (0075 → 0.75 كجم)
   * سعر: 2 = قروش/هللات (01250 → 12.50)، 0 = وحدات صحيحة
   */
  valueDecimals: number
  /**
   * خانة التحقق (سبيرة EAN-13):
   * auto = يقبل بوجودها أو غيابها (يتحقق منها فقط إذا كان الطول 13)
   * require = يجب أن تكون موجودة وصحيحة
   * none = الباركود بلا خانة تحقق (موازين تطبع Code128/ITF)
   */
  checkDigit: 'auto' | 'require' | 'none'
}

/** ناتج التفكيك — قيمة واحدة فقط تُملأ حسب نوع القاعدة */
export interface ScaleParseResult {
  rule: ScaleRule
  itemCode: string // بلا أصفار بادئة
  weightKg: number | null
  /** السعر كما طُبع (عدد صحيح خام) — الكاشير يحوله لعملة النظام عبر valueDecimals */
  priceRaw: number | null
}

/** القاعدة الافتراضية — تطابق السلوك التاريخي للنظام (بادئة 22، وزن بالجرام) */
export const DEFAULT_SCALE_RULES: ScaleRule[] = [
  { id: 1, nameAr: 'وزن — بادئة 22 (الأشهر عربياً)', enabled: true, prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' },
]

/** قوالب جاهزة لأشهر صيغ الموازين عالمياً — يضيف منها المستخدم بنقرة */
export const SCALE_RULE_PRESETS: Omit<ScaleRule, 'id' | 'enabled'>[] = [
  { nameAr: 'وزن — بادئة 22 (DIGI/الدلتا — مصر والخليج)', prefix: '22', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' },
  { nameAr: 'سعر — بادئة 20 (CAS وموازين أوروبية)', prefix: '20', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' },
  { nameAr: 'سعر — بادئة 21', prefix: '21', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' },
  { nameAr: 'وزن — بادئة 23', prefix: '23', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' },
  { nameAr: 'وزن — بادئة 02 (النمط الأمريكي UPC)', prefix: '02', itemCodeLen: 5, valueLen: 5, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' },
  { nameAr: 'سعر — بادئة 02 (أمريكي بالسعر)', prefix: '02', itemCodeLen: 5, valueLen: 5, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' },
  { nameAr: 'وزن — بادئة 25 (كود قصير 4 خانات)', prefix: '25', itemCodeLen: 4, valueLen: 6, valueType: 'weight', valueDecimals: 3, checkDigit: 'auto' },
  { nameAr: 'سعر — بادئة 26 (كود قصير 4 خانات)', prefix: '26', itemCodeLen: 4, valueLen: 6, valueType: 'price', valueDecimals: 2, checkDigit: 'auto' },
]

/** خانة تحقق EAN-13 لأول 12 خانة */
export function ean13CheckDigit(digits12: string): number {
  if (!/^\d{12}$/.test(digits12)) throw new RangeError('EAN-13 يحتاج 12 خانة بالضبط')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

/** تحقق سلامة قاعدة قبل حفظها — قائمة أخطاء عربية (فارغة = سليمة) */
export function validateScaleRule(rule: Pick<ScaleRule, 'prefix' | 'itemCodeLen' | 'valueLen' | 'valueDecimals' | 'nameAr'>): string[] {
  const errors: string[] = []
  if (!rule.nameAr.trim()) errors.push('اسم القاعدة مطلوب — سمّها باسم الميزان لتعرفها لاحقاً')
  if (!/^\d{1,3}$/.test(rule.prefix)) errors.push('البادئة: 1 إلى 3 خانات رقمية (20-29 هي المحجوزة عالمياً للاستخدام الداخلي)')
  if (!Number.isInteger(rule.itemCodeLen) || rule.itemCodeLen < 3 || rule.itemCodeLen > 7) errors.push('طول كود الصنف: 3 إلى 7 خانات')
  if (!Number.isInteger(rule.valueLen) || rule.valueLen < 3 || rule.valueLen > 7) errors.push('طول القيمة: 3 إلى 7 خانات')
  if (!Number.isInteger(rule.valueDecimals) || rule.valueDecimals < 0 || rule.valueDecimals > 4) errors.push('عدد الكسور: 0 إلى 4')
  const total = rule.prefix.length + rule.itemCodeLen + rule.valueLen
  if (total > 13) errors.push(`الطول الكلي ${total} يتجاوز 13 — لا يصلح EAN-13`)
  return errors
}

/** محاولة تفكيك بقاعدة واحدة — null إن لم تطابق */
export function parseWithRule(raw: string, rule: ScaleRule): ScaleParseResult | null {
  const code = raw.trim()
  if (!/^\d+$/.test(code)) return null
  if (!code.startsWith(rule.prefix)) return null
  const bodyLen = rule.prefix.length + rule.itemCodeLen + rule.valueLen

  let body: string
  if (code.length === bodyLen) {
    if (rule.checkDigit === 'require') return null // خانة التحقق إلزامية وغائبة
    body = code
  } else if (code.length === bodyLen + 1 && rule.checkDigit !== 'none') {
    // خانة تحقق موجودة — نتحقق منها فقط عندما تكون الصيغة EAN-13 حقيقية (13 خانة)
    if (code.length === 13 && ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null
    body = code.slice(0, bodyLen)
  } else {
    return null
  }

  const itemCodeRaw = body.slice(rule.prefix.length, rule.prefix.length + rule.itemCodeLen)
  const valueRaw = body.slice(rule.prefix.length + rule.itemCodeLen, bodyLen)
  const value = parseInt(valueRaw, 10)
  if (!Number.isFinite(value) || value <= 0) return null
  const itemCode = String(parseInt(itemCodeRaw, 10))
  if (itemCode === '0') return null

  if (rule.valueType === 'weight') {
    return { rule, itemCode, weightKg: value / 10 ** rule.valueDecimals, priceRaw: null }
  }
  return { rule, itemCode, weightKg: null, priceRaw: value }
}

/** التفكيك العالمي: يجرب القواعد الممكّنة بترتيبها — أول مطابقة تفوز */
export function parseScaleBarcodeUniversal(raw: string, rules: readonly ScaleRule[]): ScaleParseResult | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    const hit = parseWithRule(raw, rule)
    if (hit) return hit
  }
  return null
}

/**
 * تحويل سعر مطبوع (خام) إلى Minor بعملة النظام:
 * priceRaw بكسور القاعدة → Minor بكسور العملة (تقريب نصفي)
 */
export function scalePriceToMinor(priceRaw: number, ruleDecimals: number, currencyDecimals: number): number {
  const shift = currencyDecimals - ruleDecimals
  if (shift >= 0) return priceRaw * 10 ** shift
  return Math.round(priceRaw / 10 ** -shift)
}

/** توليد باركود بقاعدة (لطباعة ملصقات من النظام أو للاختبار) — مع خانة تحقق EAN-13 عند 12 خانة */
export function buildWithRule(itemCode: number, value: number, rule: ScaleRule): string {
  if (!Number.isInteger(value) || value <= 0 || value >= 10 ** rule.valueLen) throw new RangeError('قيمة خارج نطاق الباركود')
  if (!Number.isInteger(itemCode) || itemCode <= 0 || itemCode >= 10 ** rule.itemCodeLen) throw new RangeError('كود صنف خارج النطاق')
  const body = rule.prefix + String(itemCode).padStart(rule.itemCodeLen, '0') + String(value).padStart(rule.valueLen, '0')
  if (body.length === 12 && rule.checkDigit !== 'none') return body + String(ean13CheckDigit(body))
  return body
}

/* ─── قائمة PLU لبرمجة أي ميزان (تصدير CSV عام + طباعة) ─── */

/**
 * كود PLU لصنف موزون: أول باركود رقمي يسع طول كود القاعدة، وإلا الأرقام داخل SKU.
 * null = لا كود صالح (يظهر تحذيراً في الشاشة).
 */
export function scalePluCode(item: { sku: string; barcodes: string[] }, itemCodeLen: number): string | null {
  for (const b of item.barcodes) {
    if (/^\d+$/.test(b)) {
      const n = String(parseInt(b, 10))
      if (n !== '0' && n.length <= itemCodeLen) return n
    }
  }
  const n = item.sku.replace(/\D/g, '')
  if (n) {
    const clean = String(parseInt(n, 10))
    if (clean !== '0' && clean.length <= itemCodeLen) return clean
  }
  return null
}

export interface PluRow {
  plu: string | null
  nameAr: string
  pricePerKg: string // بالعملة الرئيسية «12.50» — صيغة عامة تفهمها برامج الموازين
  warning: string | null
}

/** بناء جدول PLU للأصناف الموزونة + تحذيرات التعارض (كود مفقود/مكرر/أطول من القاعدة) */
export function buildPluRows(
  items: readonly { nameAr: string; sku: string; barcodes: string[]; priceMinor: number; soldByWeight: boolean; isActive: boolean }[],
  itemCodeLen: number,
  currencyDecimals: number,
): PluRow[] {
  const weighted = items.filter((it) => it.soldByWeight && it.isActive)
  const seen = new Map<string, string>() // plu → أول صنف حمله
  return weighted.map((it) => {
    const plu = scalePluCode(it, itemCodeLen)
    let warning: string | null = null
    if (!plu) warning = `لا كود رقمي يسع ${itemCodeLen} خانات — أضف باركوداً قصيراً للصنف`
    else if (seen.has(plu)) warning = `الكود ${plu} مكرر مع «${seen.get(plu)}» — الميزان سيخلط بينهما`
    else seen.set(plu, it.nameAr)
    const major = (it.priceMinor / 10 ** currencyDecimals).toFixed(currencyDecimals)
    return { plu, nameAr: it.nameAr, pricePerKg: major, warning }
  })
}

/** CSV عام لبرمجة الموازين (PLU,Name,PricePerKg) — تستورده برامج DIGI/CAS/RONGTA وغيرها */
export function pluCsv(rows: readonly PluRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = ['PLU,Name,PricePerKg']
  for (const r of rows) {
    if (!r.plu) continue // الأصناف بلا كود لا تدخل الملف — تحذيرها يظهر في الشاشة
    lines.push(`${r.plu},${esc(r.nameAr)},${r.pricePerKg}`)
  }
  return '\uFEFF' + lines.join('\n') // BOM ليفتح العربية سليمة في Excel
}

/* ─── التوافق الخلفي (الصيغة التاريخية بادئة 22) ─── */

export interface ScaleBarcodeConfig {
  prefix: string
  itemCodeLen: number
  weightLen: number
}

export const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = { prefix: '22', itemCodeLen: 5, weightLen: 5 }

export interface ScaleParse {
  itemCode: string
  weightKg: number
}

/** (توافق خلفي) تفكيك بالصيغة التاريخية — يقبل خانة تحقق أو لا دون التحقق منها */
export function parseScaleBarcode(raw: string, cfg: ScaleBarcodeConfig = DEFAULT_SCALE_CONFIG): ScaleParse | null {
  const legacyRule: ScaleRule = {
    id: 0, nameAr: 'legacy', enabled: true,
    prefix: cfg.prefix, itemCodeLen: cfg.itemCodeLen, valueLen: cfg.weightLen,
    valueType: 'weight', valueDecimals: 3, checkDigit: 'none',
  }
  // السلوك التاريخي: يقبل الطول الزائد بخانة دون فحص السبيرة
  const code = raw.trim()
  const bodyLen = cfg.prefix.length + cfg.itemCodeLen + cfg.weightLen
  const body = /^\d+$/.test(code) && code.length === bodyLen + 1 ? code.slice(0, bodyLen) : code
  const hit = parseWithRule(body, legacyRule)
  return hit && hit.weightKg != null ? { itemCode: hit.itemCode, weightKg: hit.weightKg } : null
}

/** (توافق خلفي) توليد بالصيغة التاريخية بلا خانة تحقق */
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
