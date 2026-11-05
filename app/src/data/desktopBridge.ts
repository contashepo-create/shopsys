/**
 * عقد IPC اختياري للنسخة المكتبية.
 * المتصفح لا يستدعي localhost ولا يعرف Node؛ preload فقط يحقن هذا الجسر
 * عند التشغيل داخل Electron مع contextIsolation مفعلاً.
 */

export interface DesktopSnapshot {
  storeName: string
  revision: number
  payloadJson: string | null
  updatedAt: string | null
}

export type DesktopOutboxStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface DesktopOutboxEvent {
  id: string
  aggregateType: string
  aggregateId: string
  eventType: string
  payloadJson: string
  status: DesktopOutboxStatus
  attempts: number
  nextAttemptAt: string | null
  createdAt: string
  sentAt: string | null
}

export interface DesktopAuditEvent {
  id: number
  at: string
  user: string
  kind: string
  title: string
  refKey?: string
}

export interface DesktopJournalLine {
  accountCode: string
  debit: number
  credit: number
  note?: string
  costCenterId?: number | null
}

export interface DesktopJournalEntry {
  id: number
  entryNumber: number
  date: string
  description: string
  sourceType: string
  sourceId: number | null
  lines: readonly DesktopJournalLine[]
  createdBy: string
  createdAt: string
  reversedByEntryId: number | null
  reversesEntryId: number | null
}

export interface DesktopDatabaseBridge {
  /** مفتاح توافق لقراءة وترحيل لقطات SQLite القديمة enc:v1؛ لا يُستخدم لتشفير اللقطات الجديدة. */
  getEncryptionKey?(): Promise<Uint8Array | null>
  getSnapshot(storeName: string): Promise<DesktopSnapshot>
  saveSnapshot(input: { storeName: string; expectedRevision: number; payloadJson: string; idempotencyKey?: string; auditEvents?: readonly DesktopAuditEvent[]; journalEntries?: readonly DesktopJournalEntry[] }): Promise<{ revision: number; updatedAt: string; replayed?: boolean }>
  deleteSnapshot?(input: { storeName: string; expectedRevision: number }): Promise<{ revision: number; updatedAt: string }>
  enqueueOutbox(input: { id: string; aggregateType: string; aggregateId: string; eventType: string; payloadJson: string }): Promise<{ created: boolean }>
  claimOutbox(input?: { now?: string; limit?: number }): Promise<DesktopOutboxEvent[]>
  completeOutbox(input: { id: string; status: 'sent' | 'failed'; nextAttemptAt?: string | null }): Promise<{ updated: boolean }>
  integrityCheck(): Promise<{ ok: boolean; message: string }>
  schemaVersion(): Promise<number>
  /** نوافذ الأقمار الحرة: تُبثّ حين تحفظ نافذة أخرى لقطة — لتطبيق أحدث حالة */
  onSnapshotChanged?(listener: (e: { storeName: string; revision: number }) => void): () => void
}

/** v1.0.8: معلومات وإدارة مكان القاعدة والنسخ المزدوجة — سطح المكتب فقط */
export interface DesktopDatabaseStorageBridge {
  getStorageInfo(): Promise<{
    dbPath: string
    defaultDbPath: string
    isCustom: boolean
    secondaryBackupDir: string
    secondaryIsDefault: boolean
    lastFileBackupAt: string | null
  }>
  chooseDbLocation(): Promise<{ ok: boolean; canceled?: boolean; newPath?: string; restarting?: boolean; error?: string }>
  chooseSecondaryBackupDir(): Promise<{ ok: boolean; canceled?: boolean; dir?: string }>
  /* v1.0.9: درع البيانات — استرداد تلقائي + استعادة نسخة ملفية */
  recoveryNotice(): Promise<{ at: string; from: string | null } | null>
  listFileBackups(): Promise<{ path: string; where: string; kind: string; size: number; at: string }[]>
  restoreFileBackup(path: string): Promise<{ ok: boolean; restarting?: boolean }>
  /* v1.0.22: تنزيل نسخة SQLite كاملة — يُعاد المسار الذي اختاره المستخدم */
  exportCopy(): Promise<{ ok: true; path: string } | { ok: false; canceled: true }>
}

/**
 * بند 10 (تدقيق 2026-10-08): إشعار نظام التشغيل من العملية الرئيسية.
 * اختياري — النسخة القديمة من الغلاف لا تكشفه، والمتصفح لا يملكه، وفي الحالتين
 * يبقى التنبيه داخل التطبيق (الجرس + النافذة المنبثقة) هو القناة المعتمدة.
 */
export interface DesktopNotificationsBridge {
  show(title: string, body: string): Promise<boolean>
}

/* ─── التحديث اليدوي في نسخة سطح المكتب (زر الفحص + شريط التنزيل) ─── */
export type DesktopUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface DesktopUpdaterState {
  status: DesktopUpdaterStatus
  version?: string
  percent?: number
  message?: string
}

export interface DesktopUpdaterBridge {
  /** آخر حالة للمُحدِّث كما تراها العملية الرئيسية */
  state(): Promise<unknown>
  /** فحص فوري للتحديث (أسرع من انتظار الفحص الدوري) */
  check(): Promise<unknown>
  /** تثبيت التحديث المنزَّل الآن — بنفس مسار الإغلاق الصامت المحمي */
  install(): Promise<void>
  /** اشتراك في تغيّر الحالة (شريط التنزيل) — يعيد دالة إلغاء الاشتراك */
  onState(listener: (state: unknown) => void): () => void
}

/** v1.0.22: مفتاح الاسترداد — ملف مغلّف بكلمة مرور يختارها العميل */
/**
 * بند 5 (طلب المالك): قناة الدعم عبر العملية الرئيسية.
 * السبب: نسخة سطح المكتب تعمل من file:// ⇒ المتصفح يرسل Origin: null ⇒ يرفضه
 * العامل (403) ويظهر للمستخدم «لا يوجد اتصال» كاذبة. الطلب من العملية
 * الرئيسية يذهب بلا Origin، والاعتماد (HMAC + TOFU) هو الحماية الحقيقية.
 * كما تُحفظ هنا اعتماد القناة (بعيداً عن القاعدة) ليبقى ثابتاً بعد مسحها.
 */
export interface DesktopSupportBridge {
  /** تنفيذ طلب دعم (GET/POST) — العملية الرئيسية تطبّق قائمة المضيفين المسموحين */
  request(args: { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; body: string; error?: string; errorCode?: string }>
  /** اعتماد قناة الدعم المحفوظ خارج القاعدة (userData) — أو null */
  getToken(): Promise<string | null>
  /** حفظ اعتماد قناة الدعم خارج القاعدة */
  setToken(token: string): Promise<boolean>
}

export interface DesktopKeyRecoveryBridge {
  status(): Promise<{ exportedAt: string | null }>
  export(args: { passphrase: string; deviceId: string }): Promise<{ ok: boolean; canceled?: boolean; reason?: string; path?: string }>
  import(args: { passphrase: string }): Promise<{ ok: boolean; canceled?: boolean; reason?: string; deviceId?: string; relaunching?: boolean }>
  /** يعيد تشغيل العملية الرئيسية بعد توصيل القرص/استعادة ملفات profile عندما تعذر فتح SQLite عند الإقلاع */
  retryStartup(): Promise<boolean>
  /** أرشفة قاعدة غير قابلة للفك والبدء بقاعدة فارغة بعد تأكيد المستخدم — للاختبار فقط */
  startFresh(): Promise<{ ok: boolean; canceled?: boolean; reason?: string; archivePath?: string; relaunching?: boolean }>
}

/* ─── نوافذ الأقمار الحرة (قرار المالك 2026-10-22) ───
   كل قسم/مستند/منتقٍ نافذة نظام مستقلة. العقد هنا هو صورة المُصيّر من
   desktop/satelliteWindows.ts (العملية الرئيسية) — أي تعديل يكون في الاثنين. */

/** ما يستلمه القمر الوليد عند المطالبة (claim) ليبني واجهته */
export interface SatelliteDescriptor {
  windowId: string
  type: 'section' | 'view'
  /** صنف العرض (sales-invoice…) لنوع view */
  kind?: string | null
  /** مسار القسم لنوع section */
  path?: string
  title: string
  subtitle?: string
  /** خصائص قابلة للتسلسل فقط — الدوال تُستبدل بأقزام IPC بأسمائها في callbackNames */
  props?: Record<string, unknown>
  callbackNames?: string[]
  requestId?: string | null
}

export interface SatelliteRegistryEntry {
  windowId: string
  type: 'section' | 'view'
  kind: string | null
  sectionPath: string | null
  title: string
  dedupeKey: string | null
  parentId: string | null
  dirty: boolean
}

export interface DesktopInvoiceCommitBridge {
  /** قفل عابر للنوافذ لتسلسل ترحيل الفواتير على آخر لقطة محفوظة */
  acquire(): Promise<string | null>
  release(token: string): void
}

export interface DesktopSessionAuthBridge {
  /** عملية الدخول المركزية: التحقق من PIN المقابل للقطة قبل اعتماد WebContents */
  authorize(input: { userId: number | null; pin: string }): Promise<{ ok: boolean; error?: string }>
  /** إلغاء صلاحيات جلسات التطبيق عند تسجيل الخروج */
  revoke(): void
  onRevoked(listener: () => void): () => void
}

export interface DesktopWindowsBridge {
  /** فتح نافذة عرض (مستند/منتقٍ/محرر) — الواصف كاملاً من windowStore */
  open(input: Record<string, unknown>): Promise<{ ok: boolean; deduped?: boolean; existingId?: string }>
  /** فتح/تركيز نافذة قسم — نسخة واحدة لكل مسار */
  openSection(input: { path: string; title: string }): Promise<{ ok: boolean; windowId?: string; deduped?: boolean; main?: boolean }>
  /** القمر الوليد يستلم واصفه برمزه لمرة واحدة */
  claim(token: string): Promise<SatelliteDescriptor | null>
  list(): Promise<SatelliteRegistryEntry[]>
  /** استدعاء رد نداء عند النافذة الأم مالكة الطلب (onPick/onSaved…) */
  invokeProp(input: { requestId: string; prop: string; args: unknown[] }): void
  closeSelf(): void
  requestClose(windowId: string): void
  focus(windowId: string): void
  minimize(windowId?: string): void
  toggleMaximize(windowId?: string): void
  setTitle(title: string): void
  setDirty(dirty: boolean): void
  /** Announces that the satellite close/draft listener is installed and can safely answer. */
  setRendererReady(ready: boolean): void
  respondClose(token: string, allow: boolean): void
  onPropInvoke(listener: (e: { requestId: string; prop: string; args: unknown[] }) => void): () => void
  onRequestClose(listener: (e: { token: string }) => void): () => void
  onNavigate(listener: (e: { path: string }) => void): () => void
  onRegistry(listener: (entries: SatelliteRegistryEntry[]) => void): () => void
}

export interface ShopsysDesktopBridge {
  runtime: 'electron'
  persistence?: {
    onFlush(listener: () => Promise<void>): void
    onResume(listener: () => void): void
  }
  database: DesktopDatabaseBridge
  auth?: DesktopSessionAuthBridge
  invoiceCommit?: DesktopInvoiceCommitBridge
  windows?: DesktopWindowsBridge
  databaseStorage?: DesktopDatabaseStorageBridge
  notifications?: DesktopNotificationsBridge
  keyRecovery?: DesktopKeyRecoveryBridge
  license?: {
    /** Main-process signature audit from the canonical shopsys-app SQLite snapshot. */
    getStatus(): Promise<{ status: 'no_key' | 'verified' | 'tampered' | 'unverifiable'; payload: unknown | null; reason?: string; at: string }>
    onInvalidated(listener: () => void): () => void
  }
}

declare global {
  interface Window {
    shopsysDesktop?: ShopsysDesktopBridge
    /** v1.0.8: مرساة التجربة — تعيد أقدم بداية تجربة معروفة لهذا الجهاز */
    shopsysTrialAnchor?: (args: { firstTrialAt?: string; lastSeenAt?: string }) => Promise<{ firstTrialAt: string | null; lastSeenAt: string | null }>
    /** نسخة ملفية فورية للقاعدة في المكانين — يكشفها preload في سطح المكتب */
    shopsysBackupNow?: () => Promise<string[]>
    /** جسر التحديث اليدوي — يكشفه preload في سطح المكتب فقط */
    shopsysUpdater?: DesktopUpdaterBridge
    /**
     * بند 2 (طلب المالك): هوية الجهاز — العملية الرئيسية هي المرجع (ملف في
     * userData خارج القاعدة) ⇒ معرّف الجهاز لا يتغيّر بمسح القاعدة.
     * تُقرأ **تزامنياً** عند الإقلاع لأن فحص الترخيص يحتاج المعرّف فوراً.
     */
    shopsysDeviceIdentity?: (candidate?: { deviceId?: string; firstTrialAt?: string }) => { deviceId: string; firstTrialAt: string | null }
    /** بند 5: قناة الدعم عبر العملية الرئيسية (بلا Origin) + اعتماد ثابت خارج القاعدة */
    shopsysSupport?: DesktopSupportBridge
  }
}

/** نسخة ملفية فورية (SQLite backup) في المكانين — أو null في المتصفح */
export function desktopBackupNow(): (() => Promise<string[]>) | null {
  return typeof window !== 'undefined' && typeof window.shopsysBackupNow === 'function' ? window.shopsysBackupNow.bind(window) : null
}

export function desktopBridge(): ShopsysDesktopBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop ?? null : null
}

export function isElectronRuntime(): boolean {
  return desktopBridge()?.runtime === 'electron'
}

/** جسر إدارة مكان القاعدة — أو null في المتصفح */
export function desktopDatabaseStorage(): DesktopDatabaseStorageBridge | null {
  return desktopBridge()?.databaseStorage ?? null
}

export function requireDesktopDatabase(): DesktopDatabaseBridge {
  const bridge = desktopBridge()
  if (!bridge) throw new Error('قاعدة SQLite متاحة فقط داخل نسخة سطح المكتب')
  return bridge.database
}

/**
 * إشعار نظام التشغيل (Electron) — يعيد true لو عُرض فعلاً.
 * لا يرمي استثناء أبداً: الإشعار تحسين، وفشله (بلا إذن/بلا غلاف/متصفح) لا يهم.
 */
export async function showDesktopNotification(title: string, body: string): Promise<boolean> {
  try {
    const bridge = desktopBridge()?.notifications
    if (!bridge) return false
    return await bridge.show(String(title).slice(0, 120), String(body).slice(0, 300))
  } catch {
    return false
  }
}

/** v1.0.22: جسر مفتاح الاسترداد — null خارج سطح المكتب */
export function desktopKeyRecoveryBridge(): DesktopKeyRecoveryBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop?.keyRecovery ?? null : null
}

/** جسر التحديث اليدوي (زر الفحص + شريط التنزيل) — null خارج سطح المكتب */
export function desktopUpdaterBridge(): DesktopUpdaterBridge | null {
  return typeof window !== 'undefined' ? window.shopsysUpdater ?? null : null
}

/**
 * بند 2 (طلب المالك): جسر هوية الجهاز — null خارج سطح المكتب.
 * يُرجع المعرّف الذي تحتفظ به العملية الرئيسية (خارج القاعدة) فيتبقى ثابتاً
 * بعد مسح القاعدة ⇒ يبقى العميل في لوحة المطوّر عميلاً قديماً لا جديداً.
 */
export function desktopDeviceIdentity(): ((candidate?: { deviceId?: string; firstTrialAt?: string }) => { deviceId: string; firstTrialAt: string | null }) | null {
  return typeof window !== 'undefined' && typeof window.shopsysDeviceIdentity === 'function' ? window.shopsysDeviceIdentity : null
}

/** بند 5: جسر قناة الدعم — null خارج سطح المكتب */
export function desktopSupportBridge(): DesktopSupportBridge | null {
  return typeof window !== 'undefined' ? window.shopsysSupport ?? null : null
}

/** جسر النوافذ الحرة — null خارج سطح المكتب (المتصفح يحتفظ بالنوافذ الداخلية) */
export function desktopWindowsBridge(): DesktopWindowsBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop?.windows ?? null : null
}

/** هل تعمل النوافذ الحرة الحقيقية هنا؟ (نسخة سطح المكتب فقط — قرار المالك) */
export function isDesktopFreeWindows(): boolean {
  return desktopWindowsBridge() !== null
}
