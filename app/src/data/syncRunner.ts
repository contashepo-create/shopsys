/**
 * مشغّل المزامنة: يربط مخزن البيانات الحقيقي بعميل Supabase
 * ───────────────────────────────────────────────────────────
 * - أي تغيير محلي في قاعدة البيانات يرفع علم dirty (عبر اشتراك واحد خفيف)
 * - runSyncCycle(): دورة واحدة — سحب الأحدث أو دفع التغييرات بقفل تفاؤلي
 * - تطبيق المسحوب يتم دفعة واحدة setState ولا يلمس المحلي إلا بعد نجاح كل التحقق
 * - كل الدورات متسلسلة (قفل داخلي) — لا دورتان متوازيتان من نفس الجهاز
 */
import { useDataStore } from './repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { syncOnce, validateSyncConfig, type SyncConfig } from './syncClient.ts'

let applyingPull = false // يمنع اعتبار «تطبيق المسحوب» تغييراً محلياً جديداً
let cycleRunning = false // قفل: دورة واحدة في اللحظة
let subscribed = false

/** تسلسل حالة المتجر: JSON.stringify يتجاهل الدوال فتبقى البيانات فقط */
function serializeStore(): string {
  return JSON.stringify(useDataStore.getState())
}

/** بدء مراقبة التغييرات المحلية — يُستدعى مرة عند الإقلاع */
export function watchLocalChanges(): void {
  if (subscribed) return
  subscribed = true
  useDataStore.subscribe(() => {
    if (applyingPull) return
    const app = useAppStore.getState()
    if (app.sync.enabled && !app.sync.dirty) app.updateSync({ dirty: true })
  })
}

export interface CycleResult {
  ok: boolean
  message: string
  action?: 'pushed' | 'pulled' | 'noop'
}

/**
 * دورة مزامنة واحدة — آمنة للاستدعاء من مؤقّت أو زر يدوي.
 * أخطاء الشبكة/الإعداد تعود رسالة ولا ترمي (لا تعطل التطبيق أبداً).
 */
export async function runSyncCycle(): Promise<CycleResult> {
  const app = useAppStore.getState()
  const s = app.sync
  if (!s.enabled) return { ok: false, message: 'المزامنة غير مفعلة' }
  const config: SyncConfig = { url: s.url, anonKey: s.anonKey, storeId: s.storeId, secret: s.secret }
  const errors = validateSyncConfig(config)
  if (errors.length) return { ok: false, message: errors[0] }
  if (cycleRunning) return { ok: false, message: 'دورة مزامنة جارية بالفعل' }
  cycleRunning = true
  try {
    const outcome = await syncOnce({
      config,
      deviceId: app.deviceId,
      lastKnownRev: s.lastKnownRev,
      localData: serializeStore(),
      localDirty: s.dirty,
    })
    if (outcome.action === 'pulled' && outcome.pulledData) {
      // التطبيق دفعة واحدة — البيانات اجتازت (بصمة + AES-GCM + JSON) في العميل
      const parsed = JSON.parse(outcome.pulledData) as Record<string, unknown>
      applyingPull = true
      try {
        useDataStore.setState(parsed)
      } finally {
        applyingPull = false
      }
    }
    const now = new Date().toISOString()
    useAppStore.getState().updateSync({
      lastKnownRev: outcome.newRev,
      lastSyncedAt: now,
      lastResult: outcome.message,
      // بعد الدفع الناجح لا تغييرات معلقة؛ بعد السحب تبقى تغييراتنا (إن وجدت) للدورة التالية
      dirty: outcome.action === 'pushed' || outcome.action === 'noop' ? false : useAppStore.getState().sync.dirty,
    })
    return { ok: true, message: outcome.message, action: outcome.action }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'خطأ غير متوقع في المزامنة'
    useAppStore.getState().updateSync({ lastResult: `⚠️ ${message}` })
    return { ok: false, message }
  } finally {
    cycleRunning = false
  }
}
