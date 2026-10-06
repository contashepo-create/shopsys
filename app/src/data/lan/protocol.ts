/**
 * بروتوكول الشبكة المحلية — مرحلة §102 «مضيف المحل» (وثيقة معمارية §4).
 *
 * النموذج: كاتب واحد (المضيف) — كل تعديل من أي جهاز يصبح نداء RPC ينفذه
 * المضيف وحده بحراسته المركزية (حارس الدفتر + بوابة الاعتماد + سياسات
 * المستخدم: الوردية والخزائن وسجل التدقيق باسم صاحب الجهاز)، ثم تصل رقعة
 * الحالة (المجموعات المتغيرة فقط) لكل المشتركين خلال ثوانٍ.
 *
 * هذه الوحدة نقية بلا أي اعتماد على Electron أو الشبكة — نفس الأنواع تُستخدم
 * في نواتي المضيف/العميل وفي بوابات التحقق (المحاكاة عبر قناة في الذاكرة).
 */

/** عداد مراجعات يتصاعد مع كل رقعة تبث — لرصد الفجوات والتشخيص. */
export type LanRev = number

/** رسالة من العميل إلى المضيف. */
export type LanClientMsg =
  | { op: 'pair'; code: string; deviceName: string }
  | { op: 'hello'; token: string; deviceName: string }
  | { op: 'call'; id: number; fn: string; args: unknown[] }

/** رسالة من المضيف إلى العميل. */
export type LanHostMsg =
  | { op: 'paired'; token: string }
  | { op: 'welcome'; snapshot: Record<string, unknown>; rev: LanRev; hostName: string }
  | { op: 'result'; id: number; ok: true; value: unknown }
  | { op: 'result'; id: number; ok: false; error: string }
  | { op: 'patch'; rev: LanRev; patch: Record<string, unknown> }
  | { op: 'error'; message: string }

export type LanMsg = LanClientMsg | LanHostMsg

/**
 * مفاتيح جلسة الجهاز — لا تُبث ولا تدخل اللقطة: كل جهاز يملك مستخدمه
 * وحالة شاشة دخوله وقفل محاولاته الخاصة. الحارس المقابل لها ينفذ عند
 * المضيف (login يتحقق من الرقم السري هناك) لكن قيمها تبقى محلية.
 */
export const LAN_SESSION_KEYS = ['currentUserId', 'loggedOut', 'loginGuard'] as const

/**
 * تأثير دوال الجلسة على متجر الجهاز نفسه: المضيف ينفذ الدالة عنده (ولن يبث
 * مفاتيح الجلسة أبداً)، فتطبق القيم نفسها محلياً عند العميل بعد نجاح النداء —
 * لتظل شاشات الجهاز تعرف هوية صاحبه دون انتظار أي بث.
 */
export const LAN_SESSION_LOCAL: Record<string, (args: unknown[]) => Record<string, unknown>> = {
  login: (args) => ({ currentUserId: args[0] == null ? null : Number(args[0]), loggedOut: false }),
  logout: () => ({ loggedOut: true, currentUserId: null }),
}

/** دوال الجلسة: بعد نجاحها تتغير هوية مستخدم الاتصال عند المضيف. */
export const LAN_SESSION_FNS: Record<string, (args: unknown[]) => (number | null) | undefined> = {
  login: (args) => (args[0] == null ? null : Number(args[0])),
  logout: () => null,
}

/** عقد المتجر الذي تحتاجه نواتا المضيف والعميل (مستقل عن repo.ts). */
export interface LanStoreLike {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>, replace?: boolean) => void
  subscribe: (listener: (state: Record<string, unknown>, prev: Record<string, unknown>) => void) => () => void
}

/** لقطة الحالة البيانية: كل شيء عدا الدوال ومفاتيح جلسة الجهاز. */
export function lanSnapshotOf(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'function') continue
    if ((LAN_SESSION_KEYS as readonly string[]).includes(key)) continue
    out[key] = value
  }
  return out
}

/** رقعة = قيم المفاتيح المتغيرة فقط (مقارنة مرجعية — رخيصة وحتمية). */
export function lanPatchBetween(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  changedKeys: Iterable<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of changedKeys) {
    if ((LAN_SESSION_KEYS as readonly string[]).includes(key)) continue
    if (next[key] !== prev[key] || !(key in next)) patch[key] = next[key]
  }
  return patch
}
