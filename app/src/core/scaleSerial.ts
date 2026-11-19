/**
 * قراءة ميزان متصل مباشرة (USB / تسلسلي) — طبقة تفكيك نقية بلا أجهزة.
 * ────────────────────────────────────────────────────────────────────────────
 * الموازين لا تتفق على صيغة واحدة، لكن الغالبية ترسل سطراً نصياً عند الاستقرار:
 *   "ST,GS,+  0.750kg"   (CAS / Mettler / معظم موازين الخليج)
 *   "US,GS,    750 g"
 *   "0.750 kg"           (موازين POS البسيطة)
 *   "WT:0.750"           (بعض الصينيات)
 *   "S S 0.750 kg"       (A&D)
 * نفكّك السطر إلى كيلوجرامات، ونرفض ما ليس قراءة وزن (رسائل الخطأ/الخلايا/الأسعار).
 * القراءة تُقبل فقط عندما تكون مستقرة (ST/GS أو بلا بادئة US/NT) لأن الوزن أثناء
 * الاهتزاز يفسد الفاتورة.
 *
 * ملاحظة مهمة: «ربط الميزان» في البقالة الأشيع هو الملصق المطبوع (باركود 22…)،
 * وهذه الطبقة تخص الميزان المتصل بجهاز الكاشير مباشرة (طابعة/ميزان شبكي).
 */

export interface ScaleReading {
  kg: number
  /** الوزن بوحدة الجرام كما أُرسل — للعرض والتشخيص */
  grams: number
  stable: boolean
  raw: string
}

const WEIGHT_RE = /([+-]?\s*\d+(?:[.,]\d+)?)\s*(kg|كجم|كج|g|جرام|غرام|جم)?/i

/** أقصى وزن يقبله ميزان بقالة (كجم) — يحمي من قراءة تالفة مثل 999999 */
const MAX_KG = 500

export function parseScaleFrame(line: string): ScaleReading | null {
  // الأجهزة تُحيط القراءة بأحرف تحكم (STX/ETX) — تُحذف بلا regex
  const raw = [...String(line ?? '')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  // رسائل ليست وزناً: خطأ، تفريغ، خلايا، سعر
  if (/ERR|ERROR|OVER|UNDER|CAL|BAT|OFF|PRICE|TOTAL|@/.test(upper)) return null
  const match = WEIGHT_RE.exec(raw)
  if (!match) return null
  const value = Number(match[1].replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const unit = (match[2] ?? '').toLowerCase()
  const kg = /^(g|جم|جرام|غرام)$/.test(unit) ? value / 1000 : value
  if (!Number.isFinite(kg) || kg < 0 || kg > MAX_KG) return null
  /* «0» أو «0.000» = الميزان فارغ؛ ولا نملأ سطراً بوزن صفري.
     الفحص على الوزن **بعد** التقريب لأقرب جرام: قراءة 0.0004 كجم كانت تمر
     وتُخزَّن kg = 0 فتنتج سطر بيع بكمية صفر. */
  const roundedKg = Math.round(kg * 1000) / 1000
  if (roundedKg === 0) return null
  const stable = !/^US|^NT|UNSTABLE|MOTION/.test(upper)
  return { kg: roundedKg, grams: Math.round(kg * 1000), stable, raw }
}

/**
 * تفكيك تدفّق بايتات إلى أسطر كاملة: الميزان قد يبتر السطر بين حزمتين،
 * فنبقي الذيل غير المكتمل حتى وصول بقية البيانات.
 */
export function splitScaleBuffer(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const merged = buffer + chunk
  const parts = merged.split(/\r\n|\n|\r/)
  const rest = parts.pop() ?? ''
  // حماية من جهاز يرسل بلا فواصل: لا نكدّس أكثر من 256 حرفاً
  return { lines: parts.filter((line) => line.trim().length > 0), rest: rest.slice(-256) }
}

/** هل المتصفح/ Electron يدعم Web Serial؟ (الموازين USB-HID لا تحتاجها تعمل كلوحة مفاتيح) */
export function webSerialAvailable(nav: unknown = typeof navigator === 'undefined' ? null : navigator): boolean {
  return Boolean(nav && typeof (nav as { serial?: unknown }).serial === 'object')
}
