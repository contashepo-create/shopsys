/**
 * البنية الهجينة (أمر المالك — 4 أوضاع تشغيل):
 * ① محلي مستقل (أساس كل باقة مدفوعة — لا نسخة مجانية)
 * ② تعدد مستخدمين على الشبكة المحلية LAN (ميزة مدفوعة multi_user_lan)
 * ③ مزامنة سحابية لفرع واحد عبر Supabase (ميزة مدفوعة cloud_sync)
 * ④ سحابة مؤسسية متعددة الفروع (ميزة مدفوعة multi_branch + cloud_sync)
 *
 * التصميم Offline-First: الكتابة محلية دائماً، والمزامنة خلفية —
 * هذه النواة الخالصة تشتق وضع التشغيل من الرخصة، وحالة الاتصال
 * من مدخلات المتصفح/آخر دورة مزامنة، بلا أي واجهات.
 */
import type { LicenseFeature } from './license.ts'

export type ArchitectureMode = 'standalone' | 'lan' | 'cloud_single' | 'cloud_enterprise'

export const MODE_LABELS: Record<ArchitectureMode, { nameAr: string; icon: string; desc: string }> = {
  standalone: { nameAr: 'محلي مستقل', icon: '💻', desc: 'كل شيء على هذا الجهاز — يعمل بلا إنترنت نهائياً' },
  lan: { nameAr: 'شبكة محلية (LAN)', icon: '🖧', desc: 'عدة مستخدمين على نفس قاعدة البيانات داخل المحل' },
  cloud_single: { nameAr: 'سحابي — فرع واحد', icon: '☁️', desc: 'نسخة سحابية مشفرة تتزامن تلقائياً بين أجهزتك' },
  cloud_enterprise: { nameAr: 'سحابي مؤسسي — فروع متعددة', icon: '🏢', desc: 'كل فرع معزول والمالك يرى الكل بتقارير مجمعة' },
}

/**
 * اشتقاق وضع التشغيل من ميزات الرخصة الموقَّعة + هل فعّل المستخدم المزامنة:
 * الميزة المدفوعة شرط لازم — تفعيل المستخدم شرط إضافي (قد يملك الميزة ولا يستخدمها).
 */
export function deriveArchitectureMode(features: readonly LicenseFeature[], syncEnabled: boolean): ArchitectureMode {
  if (features.includes('multi_branch') && features.includes('cloud_sync') && syncEnabled) return 'cloud_enterprise'
  if (features.includes('cloud_sync') && syncEnabled) return 'cloud_single'
  if (features.includes('multi_user_lan')) return 'lan'
  return 'standalone'
}

/* ─── حالة الاتصال (Offline-First — مؤشر مرئي بطلب المالك) ─── */

export type ConnectivityStatus =
  | 'offline' // لا إنترنت — الكتابة محلية وستُزامَن لاحقاً
  | 'online_idle' // متصل ولا مزامنة مفعلة (محلي بحت)
  | 'online_synced' // متصل وآخر دورة مزامنة نجحت
  | 'online_pending' // متصل وتغييرات محلية بانتظار الدفع
  | 'online_error' // متصل وآخر دورة فشلت

export interface ConnectivityInput {
  browserOnline: boolean // navigator.onLine
  syncEnabled: boolean
  dirty: boolean // تغييرات محلية لم تُدفع
  lastResult: string | null // نص آخر نتيجة مزامنة (⚠️ في أوله = فشل)
}

export function connectivityStatus(i: ConnectivityInput): ConnectivityStatus {
  if (!i.browserOnline) return 'offline'
  if (!i.syncEnabled) return 'online_idle'
  if (i.lastResult && i.lastResult.startsWith('⚠️')) return 'online_error'
  if (i.dirty) return 'online_pending'
  return 'online_synced'
}

export const CONNECTIVITY_LABELS: Record<ConnectivityStatus, { nameAr: string; icon: string; tone: 'ok' | 'warn' | 'danger' | 'muted' }> = {
  offline: { nameAr: 'بلا إنترنت — يعمل محلياً وسيُزامن تلقائياً', icon: '📴', tone: 'warn' },
  online_idle: { nameAr: 'متصل — وضع محلي', icon: '🟢', tone: 'muted' },
  online_synced: { nameAr: 'متزامن مع السحابة', icon: '☁️', tone: 'ok' },
  online_pending: { nameAr: 'تغييرات بانتظار المزامنة', icon: '🔄', tone: 'warn' },
  online_error: { nameAr: 'خطأ في آخر مزامنة — سيُعاد تلقائياً', icon: '⚠️', tone: 'danger' },
}
