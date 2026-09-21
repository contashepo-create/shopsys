/**
 * تتبع السيريال/IMEI والضمان — قلب نشاط الموبايلات (مرجع: mobileshop)
 * ────────────────────────────────────────────────────────────────────
 * في موبايل شوب البيع يكون بالقطعة المعيّنة: الكاشير يختار رقم IMEI
 * من المتاح، ولا يدخل الجهاز نفسه السلة مرتين، ويُحسب ضمانه من يوم البيع.
 * هنا نفس المنطق كنواة خالصة:
 * - وحدة سيريال SerialUnit تدخل المخزون من فاتورة الشراء وتخرج بالبيع
 * - نظام «استشاري» مثل دفعات الصلاحية: صنف يتتبع السيريال وله سيريالات
 *   متاحة ⇒ البيع يعيّن سيريالاً؛ ولا سيريالات مسجلة ⇒ يُباع عادياً
 *   (كي لا يتعطل محل أدخل مخزونه الافتتاحي بلا سيريالات)
 * - المرتجع يعيد السيريال متاحاً، والضمان يُستعلم عنه بأي سيريال
 */

export type SerialStatus = 'in_stock' | 'sold' | 'returned_supplier'

export interface SerialUnit {
  id: number
  itemId: number
  serial: string // IMEI أو رقم تسلسلي — فريد عبر كل الأصناف
  status: SerialStatus
  purchaseId: number | null // فاتورة الشراء (null = رصيد افتتاحي/إدخال يدوي)
  saleId: number | null
  soldAt: string | null // ISO وقت البيع
  warrantyMonths: number // مدة الضمان بالأشهر (تُثبت وقت البيع)
  receivedAt: string // ISO وقت الدخول
}

/** تنظيف سيريال مُدخل: إزالة الفراغات وتطبيع الأرقام العربية */
export function normalizeSerial(raw: string): string {
  const ar = '٠١٢٣٤٥٦٧٨٩'
  return raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
    .replace(/\s+/g, '')
    .toUpperCase()
}

/** تحقق شكلي: 4-30 حرفاً/رقماً/شرطة (IMEI عادة 15 رقماً لكن لا نقيد غيره) */
export function isValidSerial(serial: string): boolean {
  return /^[A-Z0-9-]{4,30}$/.test(serial)
}

/**
 * فرز قائمة سيريالات مُدخلة دفعة واحدة (سطر لكل سيريال أو مفصولة بفواصل):
 * يعيد المقبول والمرفوض وأسبابه — دون أي كتابة.
 */
export function parseSerialsInput(
  raw: string,
  existingSerials: ReadonlySet<string>,
): { accepted: string[]; errors: string[] } {
  const accepted: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  const tokens = raw.split(/[\n,،;؛]+/).map(normalizeSerial).filter(Boolean)
  for (const t of tokens) {
    if (!isValidSerial(t)) { errors.push(`«${t}» ليس سيريالاً صحيحاً (4-30 حرفاً/رقماً)`); continue }
    if (seen.has(t)) { errors.push(`«${t}» مكرر في نفس الإدخال`); continue }
    if (existingSerials.has(t)) { errors.push(`«${t}» مسجل من قبل`); continue }
    seen.add(t)
    accepted.push(t)
  }
  return { accepted, errors }
}

/** السيريالات المتاحة لصنف — الأقدم دخولاً أولاً (FIFO مثل موبايل شوب) */
export function availableSerials(pool: readonly SerialUnit[], itemId: number): SerialUnit[] {
  return pool
    .filter((s) => s.itemId === itemId && s.status === 'in_stock')
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id))
}

/** بحث بسيريال كامل (بعد التطبيع) — للمسح المباشر في الكاشير */
export function findBySerial(pool: readonly SerialUnit[], raw: string): SerialUnit | undefined {
  const s = normalizeSerial(raw)
  if (!s) return undefined
  return pool.find((u) => u.serial === s)
}

/**
 * تعيين سيريالات لبيع: يتحقق أن كل سيريال موجود ومتاح ويخص صنفه،
 * ولا يتكرر داخل نفس الفاتورة. يعيد النسخة المحدثة أو يرمي خطأ عربياً.
 */
export function markSold(
  pool: readonly SerialUnit[],
  assignments: readonly { itemId: number; serial: string }[],
  saleId: number,
  soldAtIso: string,
): SerialUnit[] {
  const used = new Set<string>()
  const bySerial = new Map(pool.map((u) => [u.serial, u]))
  for (const a of assignments) {
    const s = normalizeSerial(a.serial)
    if (used.has(s)) throw new Error(`السيريال ${s} مكرر في نفس الفاتورة`)
    used.add(s)
    const unit = bySerial.get(s)
    if (!unit) throw new Error(`السيريال ${s} غير مسجل`)
    if (unit.itemId !== a.itemId) throw new Error(`السيريال ${s} يخص صنفاً آخر`)
    if (unit.status !== 'in_stock') throw new Error(`السيريال ${s} مباع بالفعل`)
  }
  return pool.map((u) =>
    used.has(u.serial) ? { ...u, status: 'sold' as const, saleId, soldAt: soldAtIso } : u,
  )
}

/** إعادة سيريالات مرتجعة للمخزون (بمرتجع مبيعات مربوط بالفاتورة الأصلية) */
export function markReturned(pool: readonly SerialUnit[], saleId: number, serials: readonly string[]): SerialUnit[] {
  const wanted = new Set(serials.map(normalizeSerial))
  return pool.map((u) =>
    wanted.has(u.serial) && u.saleId === saleId && u.status === 'sold'
      ? { ...u, status: 'in_stock' as const, saleId: null, soldAt: null }
      : u,
  )
}

/**
 * G5: إخراج سيريالات مع مرتجع الشراء — الوحدات تعود للمورد فلا تبقى «متاحة».
 * تُختار FIFO من المتاح المسجل على فاتورة الشراء نفسها (الأقدم دخولاً أولاً)،
 * وتُعلَّم returned_supplier (سجل تاريخي — لا تُباع ولا تعود إلا بشراء جديد).
 * لو المتاح المسجل على الفاتورة أقل من الكمية يُعلَّم المتاح فقط (نظام استشاري
 * مثل دفعات الصلاحية — لا نحبس المرتجع بسبب سجلات ناقصة).
 */
export function markReturnedToSupplier(
  pool: readonly SerialUnit[],
  purchaseId: number,
  itemId: number,
  qty: number,
): SerialUnit[] {
  const candidates = pool
    .filter((u) => u.purchaseId === purchaseId && u.itemId === itemId && u.status === 'in_stock')
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id))
    .slice(0, Math.max(0, Math.floor(qty)))
  if (!candidates.length) return [...pool]
  const ids = new Set(candidates.map((u) => u.id))
  return pool.map((u) => (ids.has(u.id) ? { ...u, status: 'returned_supplier' as const } : u))
}

/** حالة الضمان لسيريال مباع */
export interface WarrantyInfo {
  serial: string
  itemId: number
  soldAt: string // ISO
  warrantyMonths: number
  warrantyUntil: string // YYYY-MM-DD
  active: boolean
  daysLeft: number // 0 عند الانتهاء
}

/** تاريخ نهاية الضمان: نفس اليوم بعد N شهراً (تشبع نهاية الشهر: 31/1 + شهر = 28/2) */
export function warrantyEndDate(soldAtIso: string, months: number): string {
  const d = new Date(soldAtIso.slice(0, 10) + 'T00:00:00Z')
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}

/** استعلام ضمان بسيريال — undefined لو غير مسجل أو لم يُبع بعد */
export function warrantyLookup(pool: readonly SerialUnit[], raw: string, todayIso: string): WarrantyInfo | undefined {
  const unit = findBySerial(pool, raw)
  if (!unit || unit.status !== 'sold' || !unit.soldAt) return undefined
  const until = warrantyEndDate(unit.soldAt, unit.warrantyMonths)
  const today = todayIso.slice(0, 10)
  const daysLeft = Math.max(0, Math.round((Date.parse(until) - Date.parse(today)) / 86_400_000))
  return {
    serial: unit.serial,
    itemId: unit.itemId,
    soldAt: unit.soldAt,
    warrantyMonths: unit.warrantyMonths,
    warrantyUntil: until,
    active: today <= until,
    daysLeft,
  }
}
