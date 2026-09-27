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

/**
 * مفاتيح جلسة محلية لا تُزامَن أبداً (تدقيق المالك — أمان تعدد الأجهزة):
 * currentUserId = من سجّل دخوله على «هذا الجهاز» — لو تزامن لانتحل جهازٌ
 * هويةَ مستخدمِ جهازٍ آخر (كاشير الفرع يصبح فجأة «المحاسب» في سجل التدقيق!).
 */
const LOCAL_SESSION_KEYS = ['currentUserId'] as const

/** تسلسل حالة المتجر: JSON.stringify يتجاهل الدوال فتبقى البيانات فقط — بلا مفاتيح الجلسة المحلية */
function serializeStore(): string {
  const state = { ...useDataStore.getState() } as Record<string, unknown>
  for (const k of LOCAL_SESSION_KEYS) delete state[k]
  return JSON.stringify(state)
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

/** مفتاح لقطات التعارض + سقفها (الأحدث يطرد الأقدم — لا امتلاء للتخزين) */
const CONFLICT_SNAPSHOTS_KEY = 'shopsys-conflict-snapshots'
const CONFLICT_KEEP = 5

/**
 * لقطة أمان قبل تطبيق حالة سحابية فوق تغييرات محلية غير مدفوعة:
 * تُحفظ محلياً (آخر 5) ويمكن استرجاعها يدوياً — «لا ضياع بيانات أبداً».
 */
function saveConflictSnapshot(data: string): void {
  try {
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    arr.push({ at: new Date().toISOString(), data })
    while (arr.length > CONFLICT_KEEP) arr.shift()
    localStorage.setItem(CONFLICT_SNAPSHOTS_KEY, JSON.stringify(arr))
  } catch { /* تخزين ممتلئ — المزامنة نفسها لا تتعطل */ }
}

/** قائمة لقطات التعارض المحفوظة (للعرض في شاشة المزامنة) */
export function listConflictSnapshots(): { at: string; size: number }[] {
  try {
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    return arr.map((s) => ({ at: s.at, size: s.data.length }))
  } catch { return [] }
}

/** نص لقطة تعارض بعينها (للتنزيل كملف JSON) — null إن لم توجد */
export function getConflictSnapshotData(at: string): string | null {
  try {
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    return arr.find((s) => s.at === at)?.data ?? null
  } catch { return null }
}

/**
 * استرجاع لقطة تعارض: يعيد حالة هذا الجهاز كما كانت لحظة الحفظ —
 * قبل الاسترجاع تُحفظ الحالة الحالية كلقطة جديدة (فلا يضيع شيء في الاتجاهين)،
 * وبعده يُرفع علم dirty كي تُدفع الحالة المسترجعة للسحابة في الدورة التالية.
 */
export function restoreConflictSnapshot(at: string): { ok: boolean; message: string } {
  const data = getConflictSnapshotData(at)
  if (!data) return { ok: false, message: 'اللقطة غير موجودة' }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(data) as Record<string, unknown>
  } catch {
    return { ok: false, message: 'اللقطة تالفة — لا يمكن قراءتها' }
  }
  saveConflictSnapshot(serializeStore()) // شبكة أمان مزدوجة: الحالة الحالية تُحفظ قبل الدهس
  for (const k of LOCAL_SESSION_KEYS) delete parsed[k]
  useDataStore.setState(parsed)
  const app = useAppStore.getState()
  if (app.sync.enabled && !app.sync.dirty) app.updateSync({ dirty: true })
  return { ok: true, message: 'استُرجعت اللقطة ✅ — ستُدفع للسحابة في المزامنة التالية' }
}

/**
 * دورة مزامنة واحدة — آمنة للاستدعاء من مؤقّت أو زر يدوي.
 * أخطاء الشبكة/الإعداد تعود رسالة ولا ترمي (لا تعطل التطبيق أبداً).
 */
export async function runSyncCycle(): Promise<CycleResult> {
  const app = useAppStore.getState()
  const s = app.sync
  if (!s.enabled) return { ok: false, message: 'المزامنة غير مفعلة' }
  const config: SyncConfig = { url: s.url, anonKey: s.anonKey, storeId: s.storeId, secret: s.secret, accessToken: s.accessToken }
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
      // ⛑️ شبكة أمان التعارض (تدقيق المالك — «إدخال من جهازين في نفس اللحظة»):
      // لو عندنا تغييرات محلية لم تُدفع بعد (dirty) وسنطبق حالة أحدث من جهاز آخر،
      // نحفظ لقطة كاملة من حالتنا المحلية أولاً — فلا يضيع إدخال أي جهاز أبداً،
      // ويستطيع المالك استرجاع اللقطة من النسخ الاحتياطية لو لزم.
      if (useAppStore.getState().sync.dirty) {
        saveConflictSnapshot(serializeStore())
      }
      // التطبيق دفعة واحدة — البيانات اجتازت (بصمة + AES-GCM + JSON) في العميل
      const parsed = JSON.parse(outcome.pulledData) as Record<string, unknown>
      // جلسة هذا الجهاز تبقى كما هي: المستخدم النشط محلي لا يأتي من السحابة
      for (const k of LOCAL_SESSION_KEYS) delete parsed[k]
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
