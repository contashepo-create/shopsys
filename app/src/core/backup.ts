/**
 * النسخ الاحتياطي — ShopSys (المرحلة 5)
 * ───────────────────────────────────────
 * منطق خالص: تجميع نسخة كاملة (بيانات + إعدادات) في ملف JSON واحد
 * ببصمة تحقق (checksum) ضد التلف، والتحقق الصارم قبل الاستعادة.
 * اليوم: تنزيل/رفع ملف من المتصفح — غداً: نفس الصيغة عبر بوت التليجرام
 * (نمط mobileshop: نسخة يومية تلقائية للبوت).
 */

export const BACKUP_FORMAT = 'shopsys-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  createdAt: string // ISO
  appDataVersion: number // إصدار persist لمخزن البيانات
  shopName: string
  checksum: string // بصمة data (djb2-hex) — تُحسب على النص المتسلسل
  data: {
    app: unknown // shopsys-app (إعدادات، ترخيص، سنوات مالية)
    store: unknown // shopsys-data (أصناف، فواتير، قيود…)
  }
}

/** بصمة djb2 سريعة وحتمية — تكفي لكشف التلف/البتر (ليست تشفيراً) */
export function checksum(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** بناء ملف نسخة احتياطية جاهز للتنزيل */
export function buildBackup(args: {
  appState: unknown
  storeState: unknown
  appDataVersion: number
  shopName: string
  now?: string
}): BackupFile {
  const data = { app: args.appState, store: args.storeState }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: args.now ?? new Date().toISOString(),
    appDataVersion: args.appDataVersion,
    shopName: args.shopName,
    checksum: checksum(JSON.stringify(data)),
    data,
  }
}

/** اسم ملف واضح: shopsys-backup-بقالة-النور-2026-09-14-2210.json */
export function backupFileName(shopName: string, nowIso: string): string {
  const safe = shopName.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || 'shopsys'
  const d = nowIso.slice(0, 16).replace('T', '-').replace(':', '')
  return `shopsys-backup-${safe}-${d}.json`
}

/**
 * تحقق صارم قبل الاستعادة — يرمي خطأً عربياً واضحاً:
 * الصيغة، الإصدار، اكتمال البيانات، وسلامة البصمة
 */
export function parseBackup(text: string): BackupFile {
  let obj: BackupFile
  try {
    obj = JSON.parse(text) as BackupFile
  } catch {
    throw new Error('الملف ليس JSON صالحاً — تأكد أنه ملف نسخة احتياطية من «حسبان»')
  }
  if (obj?.format !== BACKUP_FORMAT) throw new Error('الملف ليس نسخة احتياطية من «حسبان»')
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new Error(`النسخة من إصدار أحدث (v${obj.version}) — حدّث التطبيق أولاً`)
  }
  if (!obj.data || typeof obj.data !== 'object' || !('store' in obj.data) || !('app' in obj.data)) {
    throw new Error('النسخة ناقصة — لا تحتوي البيانات المطلوبة')
  }
  const expected = checksum(JSON.stringify(obj.data))
  if (obj.checksum !== expected) {
    throw new Error('بصمة التحقق لا تطابق — الملف تالف أو عُدّل يدوياً')
  }
  return obj
}

/** ملخص محتوى نسخة للعرض قبل تأكيد الاستعادة */
export interface BackupSummary {
  shopName: string
  createdAt: string
  items: number
  sales: number
  purchases: number
  journalEntries: number
  customers: number
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const raw = b.data.store as { state?: Record<string, unknown[]> } | Record<string, unknown[]>
  // صيغة zustand persist: { state: {...}, version } أو الحالة مباشرة
  const s = ((raw as { state?: Record<string, unknown[]> }).state ?? raw) as Record<string, unknown[]>
  const count = (k: string) => (Array.isArray(s[k]) ? s[k].length : 0)
  return {
    shopName: b.shopName,
    createdAt: b.createdAt,
    items: count('items'),
    sales: count('sales'),
    purchases: count('purchases'),
    journalEntries: count('journal'),
    customers: count('customers'),
  }
}
