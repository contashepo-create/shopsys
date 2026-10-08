/**
 * تنبيهات المطوّر المنبثقة — بند 10 من تدقيق 2026-10-08.
 * ─────────────────────────────────────────────────────────
 * ما كان: المطوّر يرسل تنبيهاً (`notices:global` / `notices:<deviceId>`) فيظهر
 * في **جرس التنبيهات** وكتوست عابر. لا نافذة منبثقة، ولا درجة إلزام، ولا إيصال
 * قراءة — فالمطوّر لا يعرف هل وصل تنبيهه المهم أصلاً، والعميل قد لا يفتح الجرس
 * أبداً فيفوّت إعلاناً حرجاً (تغيير أسعار، صيانة، انتهاء دعم إصدار).
 *
 * ما صار: ثلاث درجات (انظر NoticeLevel في core/cloud.ts):
 *   info      ⇒ الجرس + توست (بلا مقاطعة — كما كان)
 *   important ⇒ نافذة منبثقة + «لاحقاً» (تأجيل للجلسة) + إيصال قراءة
 *   critical  ⇒ نافذة منبثقة **إلزامية الإقرار** — لا تُغلق إلا بـ«تمّت القراءة»
 *
 * القواعد:
 *   • نافذة واحدة في كل مرة (الأعلى درجة ثم الأحدث) — لا تكديس نوافذ.
 *   • الإقرار يُحفظ محلياً فلا تعود النافذة، ويُرسل إيصال قراءة للعامل
 *     (fire-and-forget، ولا يعطّل شيئاً لو فشل).
 *   • التنبيهات المنتهية تُسقط في parseCloudNotices أصلاً.
 */
import type { CloudNotice, NoticeLevel } from './cloud.ts'

export const NOTICE_LEVEL_LABELS_AR: Record<NoticeLevel, string> = {
  info: 'إعلان',
  important: 'تنبيه مهم',
  critical: 'تنبيه عاجل',
}

export const NOTICE_LEVEL_ICONS: Record<NoticeLevel, string> = {
  info: '📣',
  important: '⚠️',
  critical: '🚨',
}

const LEVEL_RANK: Record<NoticeLevel, number> = { critical: 0, important: 1, info: 2 }

/** هل يستحق هذا التنبيه نافذة منبثقة؟ (info لا — جرس وتوست فقط) */
export function isPopupNotice(notice: CloudNotice): boolean {
  return notice.level === 'critical' || notice.level === 'important'
}

/** هل إقراره إلزامي (لا زر «لاحقاً» ولا إغلاق بالخلفية)؟ */
export function isAckMandatory(notice: CloudNotice): boolean {
  return notice.level === 'critical'
}

/**
 * النافذة التي تُعرض الآن: الأعلى درجة، ثم الأحدث إنشاءً.
 * تُستبعد المُقرَّة (ackedIds) والمؤجَّلة لهذه الجلسة (snoozedIds).
 * يعيد null ⇒ لا نافذة (الحالة الغالبة — لا مقاطعة بلا سبب).
 */
export function pendingPopupNotice(
  notices: readonly CloudNotice[],
  state: { ackedIds?: readonly string[]; snoozedIds?: readonly string[] } = {},
): CloudNotice | null {
  const acked = new Set(state.ackedIds ?? [])
  const snoozed = new Set(state.snoozedIds ?? [])
  const candidates = notices.filter((n) => isPopupNotice(n) && !acked.has(n.id) && !snoozed.has(n.id))
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => {
    const byLevel = LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    if (byLevel !== 0) return byLevel
    return String(b.createdAt).localeCompare(String(a.createdAt)) // الأحدث أولاً
  })[0]
}

/** عدّاد ما لم يُقرأ بعد — يظهر في الجرس كي يعرف العميل أن عليه إقراراً */
export function countPendingAcks(
  notices: readonly CloudNotice[],
  ackedIds: readonly string[],
): number {
  const acked = new Set(ackedIds)
  return notices.filter((n) => n.requiresAck && !acked.has(n.id)).length
}

/**
 * التوست: لـinfo فقط — الدرجتان الأعلى لهما نافذة منبثقة، فالتوست معهما
 * تكرار وضجيج (قرار «غير مزعج» نفسه الذي حكم بند 5).
 */
export function shouldAnnounceToast(notice: CloudNotice): boolean {
  return notice.level === 'info'
}

/** خطورة عرض التنبيه في الجرس (مطابقة لدرجته) */
export function noticeSeverity(notice: CloudNotice): 'info' | 'warn' | 'danger' {
  if (notice.level === 'critical') return 'danger'
  if (notice.level === 'important') return 'warn'
  return 'info'
}

/** نص إشعار نظام التشغيل (Electron) — بلا HTML ولا أطوال زائدة */
export function osNotificationFor(notice: CloudNotice): { title: string; body: string } | null {
  if (notice.level === 'info') return null // info لا يقطع عمل المستخدم خارج التطبيق
  /* العنوان يبدأ بالدرجة لا بعنوان الرسالة: في مركز إشعارات النظام يرى المستخدم
     «🚨 تنبيه عاجل» فيعرف الخطورة قبل أن يقرأ النص. */
  return {
    title: `${NOTICE_LEVEL_ICONS[notice.level]} ${NOTICE_LEVEL_LABELS_AR[notice.level]}`,
    body: `${notice.title ? `${notice.title} — ` : ''}${notice.body}`.slice(0, 240),
  }
}

/**
 * إيصال القراءة — POST صغير للعامل. لا يرمي استثناء أبداً: الإقرار المحلي
 * هو المعتمد، والإيصال تحسين إحصائي للمطوّر (فقدانه لا يعيد النافذة للعميل).
 */
export async function sendNoticeAck(
  baseUrl: string,
  noticeId: string,
  deviceId: string,
): Promise<'sent' | 'failed'> {
  if (!noticeId || !deviceId) return 'failed'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/notifications/${encodeURIComponent(noticeId)}/ack`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
        signal: controller.signal,
      },
    )
    clearTimeout(timer)
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
