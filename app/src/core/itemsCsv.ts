/**
 * استيراد وتصدير الأصناف CSV (المؤجل من المرحلة 1):
 * ملف CSV بترويسة عربية ثابتة يفتح في Excel مباشرة (BOM + UTF-8).
 * التصدير: كل الأصناف بأقسامها وأسعارها وأرصدتها.
 * الاستيراد: تحقق سطراً سطراً برسائل عربية بأرقام الصفوف —
 * الصفوف السليمة تُقبل والمعيبة تُرفض بتقرير (لا الكل أو لا شيء).
 * نواة خالصة بلا واجهات.
 */
import type { Minor, CurrencyConfig } from './money.ts'
import { toMinor, formatMinor } from './money.ts'

/** ترويسة الملف — ثابتة بالترتيب (التصدير والاستيراد متطابقان) */
export const CSV_HEADERS = ['الاسم', 'الباركود', 'القسم', 'الوحدة', 'سعر البيع', 'التكلفة الافتتاحية', 'الرصيد الافتتاحي', 'حد الطلب'] as const

/* ─── أدوات CSV آمنة (اقتباس RFC 4180) ─── */

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v
}

/** تقسيم نص CSV إلى صفوف/خلايا مع دعم الاقتباس والأسطر داخل الخلايا */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '') // إزالة BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  // إسقاط الصفوف الفارغة تماماً
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/* ─── التصدير ─── */

export interface ExportItemRow {
  nameAr: string
  barcode: string
  categoryName: string
  baseUnit: string
  priceMinor: Minor
  costMinor: Minor
  stockQty: number
  minQty: number
}

/** نص CSV كامل مع BOM ليفتح Excel العربية سليمة */
export function buildItemsCsv(rows: ExportItemRow[], cur: CurrencyConfig): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      csvEscape(r.nameAr),
      csvEscape(r.barcode),
      csvEscape(r.categoryName),
      csvEscape(r.baseUnit),
      formatMinor(r.priceMinor, cur, false).replaceAll(',', ''),
      formatMinor(r.costMinor, cur, false).replaceAll(',', ''),
      String(r.stockQty),
      String(r.minQty),
    ].join(','))
  }
  return `\uFEFF${lines.join('\r\n')}`
}

/* ─── الاستيراد ─── */

export interface ImportedItem {
  nameAr: string
  barcode: string
  categoryName: string // فارغ = القسم الافتراضي
  baseUnit: string
  priceMinor: Minor
  costMinor: Minor
  stockQty: number
  minQty: number
}

export interface ImportReport {
  items: ImportedItem[]
  errors: string[] // «صف 3: الاسم مطلوب»
  skippedDuplicates: number // أسماء/باركودات موجودة مسبقاً
}

/** أرقام عربية ← إنجليزية (نفس درس خطأ الكاشير — لا يتكرر) */
const normalizeDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

/**
 * قراءة ملف استيراد: يتحقق من الترويسة ثم كل صف على حدة.
 * existingNames/existingBarcodes: للتخطي الآمن للمكرر (لا استيراد مزدوج).
 */
export function parseItemsCsv(
  text: string,
  cur: CurrencyConfig,
  existing: { names: Set<string>; barcodes: Set<string> },
): ImportReport {
  const rows = parseCsv(text)
  const report: ImportReport = { items: [], errors: [], skippedDuplicates: 0 }
  if (rows.length === 0) { report.errors.push('الملف فارغ'); return report }

  const header = rows[0].map((h) => h.trim())
  if (header[0] !== CSV_HEADERS[0] || header.length < 5) {
    report.errors.push(`الترويسة غير مطابقة — الصيغة المطلوبة: ${CSV_HEADERS.join('، ')} (صدّر ملفاً من التطبيق واستخدمه قالباً)`)
    return report
  }

  const seenNames = new Set<string>()
  const seenBarcodes = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1
    const c = rows[i].map((x) => x.trim())
    const nameAr = c[0] ?? ''
    const barcode = normalizeDigits(c[1] ?? '')
    const categoryName = c[2] ?? ''
    const baseUnit = c[3] || 'قطعة'
    const priceRaw = normalizeDigits(c[4] ?? '')
    const costRaw = normalizeDigits(c[5] ?? '')
    const stockRaw = normalizeDigits(c[6] ?? '')
    const minRaw = normalizeDigits(c[7] ?? '')

    if (!nameAr) { report.errors.push(`صف ${rowNum}: الاسم مطلوب`); continue }
    if (existing.names.has(nameAr) || seenNames.has(nameAr)) { report.skippedDuplicates++; continue }
    if (barcode && (existing.barcodes.has(barcode) || seenBarcodes.has(barcode))) { report.skippedDuplicates++; continue }

    let priceMinor: Minor
    let costMinor: Minor
    try { priceMinor = priceRaw ? toMinor(priceRaw, cur.decimals) : 0 } catch { report.errors.push(`صف ${rowNum}: سعر البيع «${c[4]}» غير صالح`); continue }
    try { costMinor = costRaw ? toMinor(costRaw, cur.decimals) : 0 } catch { report.errors.push(`صف ${rowNum}: التكلفة «${c[5]}» غير صالحة`); continue }
    if (priceMinor < 0 || costMinor < 0) { report.errors.push(`صف ${rowNum}: الأسعار لا تكون سالبة`); continue }

    const stockQty = stockRaw ? Number(stockRaw) : 0
    const minQty = minRaw ? Number(minRaw) : 0
    if (!Number.isFinite(stockQty) || stockQty < 0) { report.errors.push(`صف ${rowNum}: الرصيد «${c[6]}» غير صالح`); continue }
    if (!Number.isFinite(minQty) || minQty < 0) { report.errors.push(`صف ${rowNum}: حد الطلب «${c[7]}» غير صالح`); continue }

    seenNames.add(nameAr)
    if (barcode) seenBarcodes.add(barcode)
    report.items.push({ nameAr, barcode, categoryName, baseUnit, priceMinor, costMinor, stockQty, minQty })
  }
  return report
}
