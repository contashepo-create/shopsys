/**
 * محرك المزامنة السحابية (Supabase أو أي مخزن مماثل) — نواة خالصة (القرار 24/28)
 * ──────────────────────────────────────────────────────────────────────────────
 * النموذج: صف واحد لكل متجر في جدول سحابي `stores`:
 *   { store_id, rev (رقم مراجعة تصاعدي), device_id, updated_at, data (JSON مشفر) }
 *
 * البروتوكول — قفل تفاؤلي يمنع تصادم الأجهزة (خطة الفروع المدفوعة):
 *   1) الجهاز يقرأ الصف: (rev سحابي، بيانات)
 *   2) لو rev السحابي > آخر rev عرفه الجهاز ⇒ عنده بيانات أحدث: يطبقها أولاً (pull)
 *   3) عند الدفع (push): «حدّث الصف حيث rev = ما قرأتُه» — لو فشل الشرط فقد سبقه
 *      جهاز آخر ⇒ يسحب الأحدث ويعيد المحاولة (لا كتابة عمياء أبداً، فلا ضياع بيانات)
 *   4) كل دفع يرفع rev بمقدار 1 ويسجل بصمة SHA-مبسطة للتحقق من سلامة النقل
 *
 * ملاحظة معمارية: قاعدة البيانات كلها حالة واحدة قابلة للتسلسل (zustand persist)
 * والمحرك المحاسبي حتمي خالص — لذا مزامنة «الحالة الكاملة بمراجعات» آمنة وبسيطة،
 * والدمج الحقلي الدقيق (CRDT) غير مطلوب لأن الشرط في (3) يمنع أي كتابة متوازية.
 */

/* ─── بصمة سلامة (نفس خوارزمية النسخ الاحتياطي — FNV-1a 32-بت) ─── */
export function syncChecksum(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** مغلف الدفع للسحابة */
export interface SyncEnvelope {
  storeId: string // معرف المتجر (ثابت لكل ترخيص)
  deviceId: string // الجهاز الدافع
  baseRev: number // rev الذي بُني عليه هذا الدفع (شرط القفل التفاؤلي)
  nextRev: number // rev الجديد بعد القبول = baseRev + 1
  sentAt: string // ISO
  checksum: string // بصمة data
  data: string // الحالة كاملة (نص JSON — يُشفَّر قبل النقل بمفتاح الجهاز/المتجر)
}

export function buildSyncEnvelope(args: {
  storeId: string
  deviceId: string
  baseRev: number
  data: string
  now?: string
}): SyncEnvelope {
  if (!args.storeId.trim()) throw new Error('sync: معرف المتجر مطلوب')
  if (!args.deviceId.trim()) throw new Error('sync: معرف الجهاز مطلوب')
  if (!Number.isInteger(args.baseRev) || args.baseRev < 0) throw new Error('sync: رقم مراجعة غير صالح')
  return {
    storeId: args.storeId,
    deviceId: args.deviceId,
    baseRev: args.baseRev,
    nextRev: args.baseRev + 1,
    sentAt: args.now ?? new Date().toISOString(),
    checksum: syncChecksum(args.data),
    data: args.data,
  }
}

/** حالة الصف السحابي كما قرأه الجهاز */
export interface RemoteRow {
  rev: number
  deviceId: string
  updatedAt: string
  checksum: string
  data: string
}

/** قرار المزامنة عند المقارنة بين المحلي والسحابي */
export type SyncDecision =
  | { action: 'push' } // المحلي أحدث أو مساوٍ — ادفع تغييراتك
  | { action: 'pull'; reason: string } // السحابي أحدث — اسحب أولاً
  | { action: 'conflict'; reason: string } // دفعك رُفض: غيرك سبقك — اسحب وأعد

/**
 * القرار قبل الدفع: lastKnownRev = آخر rev طبقه هذا الجهاز محلياً.
 * remoteRev = ما قرأه الآن من السحابة.
 */
export function decideSync(lastKnownRev: number, remoteRev: number): SyncDecision {
  if (!Number.isInteger(lastKnownRev) || !Number.isInteger(remoteRev) || lastKnownRev < 0 || remoteRev < 0) {
    throw new Error('sync: أرقام مراجعات غير صالحة')
  }
  if (remoteRev > lastKnownRev) {
    return { action: 'pull', reason: `السحابة عند مراجعة ${remoteRev} وجهازك عند ${lastKnownRev} — اسحب أولاً` }
  }
  return { action: 'push' }
}

/** نتيجة محاولة الدفع الشرطي (UPDATE ... WHERE rev = baseRev) */
export function interpretPushResult(rowsAffected: number, envelope: SyncEnvelope): SyncDecision {
  if (rowsAffected === 1) return { action: 'push' } // قُبل
  return {
    action: 'conflict',
    reason: `جهاز آخر دفع قبل جهازك (المراجعة ${envelope.baseRev} لم تعد الأحدث) — يُسحب الأحدث ثم تُعاد محاولتك تلقائياً`,
  }
}

/** تحقق سلامة صف مسحوب قبل تطبيقه محلياً (ضد تلف النقل/التخزين) */
export function validateRemoteRow(row: RemoteRow): string[] {
  const errors: string[] = []
  if (!Number.isInteger(row.rev) || row.rev < 0) errors.push('رقم مراجعة غير صالح')
  if (typeof row.data !== 'string' || row.data.length === 0) errors.push('بيانات فارغة')
  else if (syncChecksum(row.data) !== row.checksum) errors.push('بصمة التحقق لا تطابق — البيانات تالفة، لن تُطبق')
  else {
    try { JSON.parse(row.data) } catch { errors.push('البيانات ليست JSON صالحاً — لن تُطبق') }
  }
  return errors
}

/**
 * سياسة إعادة المحاولة عند التعارض: تراجع أُسّي بسيط (300ms، 600، 1200…)
 * بعد maxAttempts يُخطَر المستخدم بدل الدوران الأبدي.
 */
export function retryDelayMs(attempt: number, maxAttempts = 5): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('sync: رقم محاولة غير صالح')
  if (attempt > maxAttempts) return null
  return 300 * 2 ** (attempt - 1)
}

/**
 * SQL جاهز لإنشاء الجدول في Supabase (يوثق العقد — يُنفذ مرة عند التفعيل):
 *   create table stores (
 *     store_id text primary key,
 *     rev bigint not null default 0,
 *     device_id text not null default '',
 *     updated_at timestamptz not null default now(),
 *     checksum text not null default '',
 *     data text not null default ''
 *   );
 * والدفع الشرطي:
 *   update stores set rev=$nextRev, device_id=$dev, updated_at=now(), checksum=$sum, data=$data
 *   where store_id=$id and rev=$baseRev;   -- صف واحد = قبول، صفر = تعارض
 */
export const SUPABASE_STORES_TABLE = 'stores'
