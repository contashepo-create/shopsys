/**
 * مشغّل المزامنة: يربط مخزن البيانات الحقيقي بعميل Supabase
 * ───────────────────────────────────────────────────────────
 * - أي تغيير محلي في قاعدة البيانات يرفع علم dirty (عبر اشتراك واحد خفيف)
 * - runSyncCycle(): دورة واحدة — سحب الأحدث أو دفع التغييرات بقفل تفاؤلي
 * - تطبيق المسحوب يتم دفعة واحدة setState ولا يلمس المحلي إلا بعد نجاح كل التحقق
 * - كل الدورات متسلسلة (قفل داخلي) — لا دورتان متوازيتان من نفس الجهاز
 */
import { useRawDataStore } from './repo.ts'
import { useAppStore } from '../stores/app.store.ts'
import { syncOnce, validateSyncConfig, type SyncConfig } from './syncClient.ts'
import type { JournalEntry } from '../core/ledger.ts'
import { assertJournalSnapshotSafe } from '../core/ledgerSnapshotGuard.ts'
import { assertJournalHistoryPreserved } from '../core/ledgerHistoryGuard.ts'
import { assertProjectDeletionSnapshotSafe } from '../core/projectDeletionSnapshotGuard.ts'
import { assertContactHistoriesPreserved } from '../core/customerProfile.ts'
import { assertLetterCountersPreserved } from '../core/letterCounterHistoryGuard.ts'
import { assertMaterialIssueHistoryPreserved } from '../core/materialIssueHistoryGuard.ts'
import { assertProjectDocumentHistoryPreserved } from '../core/projectDocumentHistoryGuard.ts'
import { assertProjectFinancialHistoryPreserved } from '../core/projectFinancialHistoryGuard.ts'
import { assertPayrollProjectHistoryPreserved } from '../core/payrollProjectHistoryGuard.ts'
import { todayLocalIso } from '../core/time.ts'
import { encryptForDevice, decryptForDevice } from './secureStorage.ts'

let applyingPull = false // يمنع اعتبار «تطبيق المسحوب» تغييراً محلياً جديداً
let cycleRunning = false // قفل: دورة واحدة في اللحظة
let subscribed = false

/**
 * مفاتيح جلسة محلية لا تُزامَن أبداً (تدقيق المالك — أمان تعدد الأجهزة):
 * هوية الدخول وحالة تسجيل الخروج محليتان؛ لا تسمح حالة سحابية بفتح جلسة مغلقة.
 */
const LOCAL_SESSION_KEYS = ['currentUserId', 'loggedOut'] as const

/** تسلسل حالة المتجر: JSON.stringify يتجاهل الدوال فتبقى البيانات فقط — بلا مفاتيح الجلسة المحلية */
function serializeStore(): string {
  const state = { ...useRawDataStore.getState() } as Record<string, unknown>
  for (const k of LOCAL_SESSION_KEYS) delete state[k]
  return JSON.stringify(state)
}

/**
 * AUDIT-016 — حارس الوارد من السحابة.
 *
 * حالة السحابة تُطبَّق بـ`useRawDataStore.setState` مباشرةً، وهذا **يتجاوز** غلاف `set` المركزي
 * في `repo.ts` الذي يحرس كل قيد محلي (توازن، نظافة سطر، حساب موجود، سنة مفتوحة، لا تعديل صامت).
 * فجهاز مخترَق أو صف تالف كان يستطيع زرع قيد غير متزن في دفتر بقية الأجهزة بلا أي فحص.
 * هنا نمرّ الدفتر الوارد على نفس الحارس قبل تطبيقه: إن سقط، تُرفض الدفعة كاملة
 * ويبقى الدفتر المحلي كما هو (لا تطبيق جزئي أبداً).
 */
function assertIncomingLedgerSafe(parsed: Record<string, unknown>, previousJournal?: readonly JournalEntry[]): void {
  assertJournalHistoryPreserved(useRawDataStore.getState().journal, parsed.journal)
  if (!Array.isArray(parsed.journal)) {
    if (parsed.journal != null) throw new Error('دفتر اليومية في اللقطة ليس قائمة صالحة')
    return // لقطة قديمة بلا دفتر محلي أو وارد
  }
  // يبقى الدفتر المحلي مرجعاً لمنع الاختفاء/التعديل، بينما تُفحص مراجع كل القيود
  // الواردة أيضاً باستخدام مجموعات المستندات داخل اللقطة نفسها.
  // السحابة لا تستبدل مخزن الإعدادات؛ أي حقل سنوات قديم داخل البيانات لا
  // يمثل السنوات الفعلية التي ستبقى بعد السحب أو استعادة لقطة التعارض.
  const years = useAppStore.getState().fiscalYears
  const checked: Record<string, unknown> = { ...parsed, fiscalYears: years }
  assertJournalSnapshotSafe(
    checked,
    years,
    todayLocalIso(),
    previousJournal ?? (useRawDataStore.getState().journal as JournalEntry[]),
  )
  parsed.journal = checked.journal
}

/** بدء مراقبة التغييرات المحلية — يُستدعى مرة عند الإقلاع */
export function watchLocalChanges(): void {
  if (subscribed) return
  subscribed = true
  useRawDataStore.subscribe(() => {
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
async function saveConflictSnapshot(data: string): Promise<boolean> {
  try {
    // لا تحتفظ بقائمة قديمة أثناء انتظار التشفير: قد تحفظ عملية أخرى لقطةً خلالها.
    const encrypted = await encryptForDevice(data)
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) throw new Error('سجل لقطات التعارض غير صالح')
    const used = new Set(arr.map(row => row?.at))
    let timestamp = Date.now()
    while (used.has(new Date(timestamp).toISOString())) timestamp += 1
    arr.push({ at: new Date(timestamp).toISOString(), data: encrypted })
    while (arr.length > CONFLICT_KEEP) arr.shift()
    localStorage.setItem(CONFLICT_SNAPSHOTS_KEY, JSON.stringify(arr))
    return true
  } catch { return false }
}

/** لقطات التعارض تحتوي نسخة كاملة من المتجر؛ لا يطّلع عليها أو يسترجعها إلا المالك. */
export function canManageConflictSnapshots(): boolean {
  const state = useRawDataStore.getState()
  if (state.loggedOut) return false
  if (state.currentUserId == null) return true // جلسة المالك الافتراضية
  const users = state.appUsers.filter((user) => user.id === state.currentUserId)
  return users.length === 1 && users[0].roleId === 'owner' && users[0].active === true
}

/** لا تستمر قراءة نسخة حساسة أو استعادتها بعد تبديل/إغلاق الجلسة أثناء انتظار غير متزامن. */
function conflictSnapshotAccess() {
  const identity = useRawDataStore.getState().currentUserId
  let valid = canManageConflictSnapshots()
  const unsubscribe = useRawDataStore.subscribe((state) => {
    if (state.currentUserId !== identity || !canManageConflictSnapshots()) valid = false
  })
  return { valid: () => valid && canManageConflictSnapshots() && useRawDataStore.getState().currentUserId === identity, release: unsubscribe }
}

/** اللقطة بيانات فقط؛ لا يمكن استبدال دوال المتجر أو تغيير نموذج الكائن بها. */
function parseStoreSnapshot(data: string): Record<string, unknown> {
  const value: unknown = JSON.parse(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('لقطة المتجر ليست كائناً صالحاً')
  const parsed = value as Record<string, unknown>, state = useRawDataStore.getState() as unknown as Record<string, unknown>
  for (const key of Object.keys(parsed)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor' || typeof state[key] === 'function') throw new Error('لقطة المتجر تحتوي حقلاً محظوراً — لم تُطبق')
  }
  for (const k of LOCAL_SESSION_KEYS) delete parsed[k]
  return parsed
}

/** قائمة لقطات التعارض المحفوظة (للعرض في شاشة المزامنة) */
export async function listConflictSnapshots(): Promise<{ at: string; size: number }[]> {
  const access = conflictSnapshotAccess()
  try {
    if (!access.valid()) return []
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    const rows = await Promise.all(arr.map(async (s) => ({ at: s.at, size: (await decryptForDevice(s.data))?.length ?? 0 })))
    return access.valid() ? rows : []
  } catch { return [] } finally { access.release() }
}

/** نص لقطة تعارض بعينها (للتنزيل كملف JSON) — null إن لم توجد أو تغيرت الجلسة */
export async function getConflictSnapshotData(at: string): Promise<string | null> {
  const access = conflictSnapshotAccess()
  try {
    if (!access.valid()) return null
    const raw = localStorage.getItem(CONFLICT_SNAPSHOTS_KEY)
    const arr: { at: string; data: string }[] = raw ? JSON.parse(raw) : []
    const item = arr.find((s) => s.at === at)
    const data = item ? await decryptForDevice(item.data) : null
    return access.valid() ? data : null
  } catch { return null } finally { access.release() }
}

/**
 * استرجاع لقطة تعارض: يعيد حالة هذا الجهاز كما كانت لحظة الحفظ —
 * قبل الاسترجاع تُحفظ الحالة الحالية كلقطة جديدة (فلا يضيع شيء في الاتجاهين)،
 * وبعده يُرفع علم dirty كي تُدفع الحالة المسترجعة للسحابة في الدورة التالية.
 */
export async function restoreConflictSnapshot(at: string): Promise<{ ok: boolean; message: string }> {
  const access = conflictSnapshotAccess()
  try {
    if (!access.valid()) return { ok: false, message: 'تنزيل لقطات التعارض واستعادتها متاح للمالك فقط' }
    const data = await getConflictSnapshotData(at)
    if (!access.valid()) return { ok: false, message: 'تغيرت جلسة المالك — لم تُستعد اللقطة' }
    if (!data) return { ok: false, message: 'اللقطة غير موجودة' }
    let parsed: Record<string, unknown>
    try { parsed = parseStoreSnapshot(data) } catch {
      return { ok: false, message: 'اللقطة تالفة أو تحتوي حقلاً محظوراً — لا يمكن استعادتها' }
    }
    const beforeSnapshot = serializeStore()
    if (!(await saveConflictSnapshot(beforeSnapshot))) {
      return { ok: false, message: 'تعذر حفظ الحالة الحالية قبل الاسترجاع — لم تُستبدل بيانات المتجر' }
    }
    // التشفير والحفظ غير متزامنين: لا نطبق اللقطة إذا تغير المتجر أو الجلسة أثناءهما.
    // هذا لا يحمي كاتباً في جهاز أو مخزن آخر ولا يغني عن قفل مشترك.
    if (!access.valid()) return { ok: false, message: 'تغيرت جلسة المالك — لم تُستعد اللقطة' }
    if (serializeStore() !== beforeSnapshot) {
      return { ok: false, message: 'تغيرت البيانات أثناء حفظ لقطة الأمان — لم تُستبدل بيانات المتجر؛ راجعها قبل إعادة المحاولة' }
    }
    try {
      assertIncomingLedgerSafe(parsed)
      const current = useRawDataStore.getState() as unknown as Record<string, unknown>
      assertProjectDeletionSnapshotSafe(current, parsed)
      // setState يدمج جزئياً؛ قد يكون المستند الذي سيبقى غائباً من اللقطة.
      const effective = { ...current, ...parsed }
      assertProjectDeletionSnapshotSafe(current, effective)
      assertContactHistoriesPreserved(current, parsed)
      assertMaterialIssueHistoryPreserved(current, parsed)
      assertProjectDocumentHistoryPreserved(current, effective)
      assertProjectFinancialHistoryPreserved(current, effective)
      assertPayrollProjectHistoryPreserved(current, effective)
      assertLetterCountersPreserved(current, effective)
    } catch (e) {
      return { ok: false, message: `اللقطة مرفوضة — دفترها غير سليم: ${e instanceof Error ? e.message : ''}` }
    }
    useRawDataStore.setState(parsed)
    const app = useAppStore.getState()
    if (app.sync.enabled && !app.sync.dirty) app.updateSync({ dirty: true })
    return { ok: true, message: 'استُرجعت اللقطة ✅ — ستُدفع للسحابة في المزامنة التالية' }
  } finally { access.release() }
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
    const sentData = serializeStore()
    const outcome = await syncOnce({
      config,
      deviceId: app.deviceId,
      lastKnownRev: s.lastKnownRev,
      localData: sentData,
      localDirty: s.dirty,
    })
    if (outcome.action === 'pulled' && outcome.pulledData) {
      // ⛑️ شبكة أمان التعارض (تدقيق المالك — «إدخال من جهازين في نفس اللحظة»):
      // لو عندنا تغييرات محلية لم تُدفع بعد (dirty) وسنطبق حالة أحدث من جهاز آخر،
      // نحفظ لقطة كاملة من حالتنا المحلية أولاً — فلا يضيع إدخال أي جهاز أبداً،
      // ويستطيع المالك استرجاع اللقطة من النسخ الاحتياطية لو لزم.
      if ((s.dirty || useAppStore.getState().sync.dirty || serializeStore() !== sentData) && !(await saveConflictSnapshot(serializeStore()))) {
        const message = 'تعذر حفظ لقطة العمل المحلي — لم تُطبَّق حالة السحابة حتى لا تضيع بيانات هذا الجهاز'
        useAppStore.getState().updateSync({ lastResult: `⛔ ${message}` })
        return { ok: false, message }
      }
      // لقطة التعارض نسخة أمان فقط وليست دمجاً. لا نستبدل تعديلات غير مدفوعة
      // ثم ندّعي أنها ستُدفع؛ نوقف الدورة للمراجعة مع إبقاء الحالة المحلية.
      if ((s.dirty || useAppStore.getState().sync.dirty || serializeStore() !== sentData) && outcome.pulledData !== serializeStore()) {
        const message = 'توجد تغييرات محلية لم تُدمج مع السحابة — لم تُطبَّق الحالة الواردة. راجع لقطة التعارض قبل المتابعة.'
        useAppStore.getState().updateSync({ dirty: true, lastResult: `⛔ ${message}` })
        return { ok: false, message }
      }
      // التطبيق دفعة واحدة — البيانات اجتازت (بصمة + AES-GCM + JSON) في العميل
      const parsed = parseStoreSnapshot(outcome.pulledData)
      // AUDIT-016: لا يدخل دفتر السحابة قبل أن يجتاز حارس الدفتر نفسه
      try {
        assertIncomingLedgerSafe(parsed)
        assertProjectDeletionSnapshotSafe(useRawDataStore.getState() as unknown as Record<string, unknown>, parsed)
        assertProjectDeletionSnapshotSafe(useRawDataStore.getState() as unknown as Record<string, unknown>, { ...useRawDataStore.getState(), ...parsed })
        assertContactHistoriesPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, parsed)
        assertMaterialIssueHistoryPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, parsed)
        assertProjectDocumentHistoryPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, { ...useRawDataStore.getState(), ...parsed })
        assertProjectFinancialHistoryPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, { ...useRawDataStore.getState(), ...parsed })
        assertPayrollProjectHistoryPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, { ...useRawDataStore.getState(), ...parsed })
        assertLetterCountersPreserved(useRawDataStore.getState() as unknown as Record<string, unknown>, { ...useRawDataStore.getState(), ...parsed })
      } catch (e) {
        const why = e instanceof Error ? e.message : 'دفتر وارد غير سليم'
        await saveConflictSnapshot(serializeStore())
        useAppStore.getState().updateSync({ lastResult: `⛔ رُفضت حالة السحابة — ${why}` })
        return { ok: false, message: `رُفضت حالة السحابة حفاظاً على سلامة الدفتر — ${why}` }
      }
      applyingPull = true
      try {
        useRawDataStore.setState(parsed)
      } finally {
        applyingPull = false
      }
    }
    const now = new Date().toISOString()
    useAppStore.getState().updateSync({
      lastKnownRev: outcome.newRev,
      lastSyncedAt: now,
      lastResult: outcome.message,
      // ما أُرسل هو لقطة لحظة البدء؛ أي تغيير تزامن مع الشبكة لم يُدفع.
      dirty: outcome.action === 'pushed' || outcome.action === 'noop' ? serializeStore() !== sentData : useAppStore.getState().sync.dirty,
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
