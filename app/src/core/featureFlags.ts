/**
 * مفاتيح الميزات عن بُعد (أمر المالك — البند 5):
 * المطوّر يتحكم من بوت التليجرام في الميزات المدفوعة (LAN/مزامنة/فروع/فاتورة إلكترونية)
 * لكل جهاز عبر Cloudflare KV — بنموذج أمني صارم:
 *   • المنح يكون حصراً بمفتاح Ed25519 موقَّع (لا تفعيل من السحابة بلا توقيع — لا ثغرة).
 *   • السحابة تملك «مفتاح الإطفاء» (kill-switch) فقط: تعطيل ميزة ممنوحة مؤقتاً
 *     (متأخر في السداد مثلاً) دون حرق المفتاح كله — وإعادة تفعيلها بإزالة العلم.
 * الوحدة معزولة ونظيفة تمهيداً للوحة تحكم المطوّر المكتبية لاحقاً.
 */
import type { LicenseFeature } from './license.ts'

/** أعلام جهاز واحد كما تعود من GET /flags/:deviceId */
export interface DeviceFlags {
  /** ميزات ممنوحة بالمفتاح لكنها مُطفأة سحابياً الآن */
  disabledFeatures: LicenseFeature[]
  /** رسالة عربية اختيارية تُعرض للمستخدم عند محاولة استخدام ميزة مطفأة */
  noteAr: string
  updatedAt: string
}

export const EMPTY_FLAGS: DeviceFlags = { disabledFeatures: [], noteAr: '', updatedAt: '' }

const KNOWN_FEATURES: readonly string[] = ['einvoice_eg', 'einvoice_sa', 'multi_branch', 'telegram_bot', 'cloud_sync', 'multi_user_lan']

/** تنقية استجابة السحابة — ميزة مجهولة تُتجاهل، وأي شكل فاسد = أعلام فارغة (لا انهيار) */
export function parseDeviceFlags(raw: unknown): DeviceFlags {
  if (typeof raw !== 'object' || raw === null) return EMPTY_FLAGS
  const o = raw as Record<string, unknown>
  const list = Array.isArray(o.disabledFeatures) ? o.disabledFeatures : []
  return {
    disabledFeatures: list.filter((f): f is LicenseFeature => typeof f === 'string' && KNOWN_FEATURES.includes(f)),
    noteAr: typeof o.noteAr === 'string' ? o.noteAr.slice(0, 300) : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  }
}

/**
 * الميزات الفعالة = الممنوحة بالمفتاح الموقَّع − المُطفأة سحابياً.
 * (السحابة لا تضيف أبداً — الإضافة تحتاج مفتاحاً موقَّعاً جديداً من البوت.)
 */
export function effectiveFeatures(
  licensed: readonly LicenseFeature[],
  flags: DeviceFlags | null,
): LicenseFeature[] {
  const disabled = new Set(flags?.disabledFeatures ?? [])
  return licensed.filter((f) => !disabled.has(f))
}

/** هل الميزة مطفأة سحابياً رغم أنها ممنوحة؟ (لعرض رسالة «عُطلت مؤقتاً» بدل «غير مشتراة») */
export function isCloudDisabled(feature: LicenseFeature, licensed: readonly LicenseFeature[], flags: DeviceFlags | null): boolean {
  return licensed.includes(feature) && (flags?.disabledFeatures ?? []).includes(feature)
}

/** جلب أعلام الجهاز من عامل Cloudflare — فشل الشبكة يعيد null (تبقى آخر نسخة محفوظة) */
export async function fetchDeviceFlags(baseUrl: string, deviceId: string): Promise<DeviceFlags | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/flags/${encodeURIComponent(deviceId)}`, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!res.ok) return null
    return parseDeviceFlags(await res.json())
  } catch {
    return null
  }
}
