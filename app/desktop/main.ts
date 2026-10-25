/**
 * عملية Electron الرئيسية — تنفيذ «مرحلة القاعدة المحلية» (وثيقة §101):
 *   • القاعدة: userData/shopsys.db عبر better-sqlite3 (WAL) — كاتب واحد
 *   • الجسور: shopsysDesktop.database (عقد المُصيّر القائم) + shopsysPrint
 *     وshopsysPrinters (§102 تعدد الطابعات) — التحديث يعمل تلقائياً بلا جسر UI
 *   • التحديث: electron-updater يفحص وينزّل بصمت عند الإقلاع؛ يثبّت ويعيد التشغيل بصمت عند الإغلاق
 *   • مفتاح الجهاز محفوظ للتوافق مع لقطات enc:v1 القديمة فقط؛ اللقطات الجديدة نص SQLite
 *   • النسخ الدوّارة: ساعي 24 فقط = يوم واحد (Backup API الساخنة)
 * لا منطق أعمال هنا إطلاقاً — كل البوابات تعمل في المُصيّر كما هي.
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell, type WebContents } from 'electron'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ShopsysDatabase, type OutboxEventDto, type SaveSnapshotInput, type SnapshotDto } from './sqlite/storage.ts'
import { describeDeviceKeyOutcome, resolveDeviceKey, storeRecoveredDeviceKey, type DeviceKeyIo } from './deviceKeyStore.ts'
import { KEY_RECOVERY_MAX_FILE_BYTES, keyRecoveryFileName, unwrapDeviceKey, validateRecoveryPassphrase, wrapDeviceKey } from './keyRecovery.ts'
import { mergeTrialAnchor } from './trialAnchor.ts'
import { persistedAuthState, authorizeDesktopIdentity, hasConfiguredDesktopAuth } from './sessionAuthorization.ts'
import { generateDeviceIdFromBytes, mergeDeviceIdentity } from './deviceIdentity.ts'
import { initLanHostIpc } from './hostServerMain.ts'
import { initSatelliteWindows, broadcastSnapshotChanged, satellitesOpenCount, satelliteWebContents, confirmAndCloseAllSatellites } from './satelliteWindows.ts'
import { createLicenseAuthority } from './licenseAuthority.ts'
import Database from 'better-sqlite3'
import {
  readDbLocationAt, writeDbLocationAt, restoreLocationPointerAt, customDbStatusAt, resolveDbPathAt,
  hasPreviousUseEvidenceAt, shouldAskForExistingDatabase, probeShopsysDatabase, isAbsoluteDbPath,
  type DbLocationConfig,
} from './dbLocation.ts'
import { isInAppNavigation, isExternalOpenable, isWhatsAppChatLink } from './navigationPolicy.ts'
import { shieldDatabaseAt, type ShieldOutcome } from './dbShield.ts'
import { gracefulShutdown } from './shutdown.ts'
import { isUnsafeDatabaseLocation, protectDatabaseAt, recoverMissingDatabaseAt, recoveryBackupDirs, rememberDatabaseIdentity, assertSafeUpdateLocation, changedDrivePaths } from './databaseSafety.ts'
import { freshStartCutoffAt, freshStartEligibleFilesAt, isCurrentFreshStartDataAt, readFreshStartMarkerAt, startFreshDatabaseAt, startFreshWithoutDatabaseAt } from './freshStart.ts'
import { probeSnapshotKey } from './snapshotKeyProbe.ts'
import { DESKTOP_APP_NAME, preserveCurrentUserData, selectRuntimeUserData } from './runtimeData.ts'
import { installSilentUpdate, withDeadline, requestSilentInstall, assertDownloadedInstaller, observeUpdateCheck, decideManualCheck, UPDATE_CHECK_INTERVAL_MS, updateCheckRetryDelay } from './updateLifecycle.ts'
import { CHROMIUM_ERR_ABORTED, MAIN_FRAME_ABORT_RETRY_LIMIT, classifyMainFrameLoadFailure, type MainFrameLoadState } from './mainLoad.ts'
import {
  ROTATION, PRE_UPDATE_KEEP, filesToPrune, newestFirst, bestExistingCandidate,
  type CustomLocationStatus, type ExistingDataCandidate,
  type RotationKind,
} from './storagePolicy.ts'

type ClaimOutboxInput = { now?: string; limit?: number }
type DeleteSnapshotInput = { storeName: string; expectedRevision: number }
type EnqueueOutboxInput = Parameters<ShopsysDatabase['enqueueOutbox']>[0]
type CompleteOutboxInput = Parameters<ShopsysDatabase['completeOutbox']>[0]

class DatabaseKeyMismatchError extends Error {
  readonly dbPath: string
  readonly stores: string[]

  constructor(dbPath: string, stores: string[], keyAvailable: boolean) {
    super(`تعذّر فتح لقطات SQLite القديمة enc:v1 (${stores.join('، ')}). ${keyAvailable ? 'المفتاح الحالي لا يطابق اللقطة أو بياناتها تالفة.' : 'مفتاحها الأصلي غير متاح.'} لم تُكتب فوق القاعدة؛ استعد المفتاح الأصلي أو ملف .tkey ثم أعد المحاولة.`)
    this.name = 'DatabaseKeyMismatchError'
    this.dbPath = dbPath
    this.stores = stores
  }
}

/* عند فشل فحص مفتاح اللقطة: نعرض واجهة الاسترداد، ولا نفتح SQLite بمسار الكتابة. */
let databaseInitializationFailure: string | null = null
let databaseInitializationFailureDbPath: string | null = null
let recoveryRestartScheduled = false

/* eslint-disable no-console */

let mainWindow: BrowserWindow | null = null
let database: ShopsysDatabase | null = null
let activeDatabasePath: string | null = null
let updateLaunchInProgress = false
let deviceEncryptionKey: Buffer = Buffer.alloc(0)
let desktopDeviceId: string | null = null
let licenseAuthorityInitialLogged = false
let licenseAuthority: ReturnType<typeof createLicenseAuthority> | null = null
let printWindow: BrowserWindow | null = null
const authorizedWebContents = new Set<number>()
const authAttempts = new Map<number, { count: number; windowStartedAt: number; lockedUntil: number }>()
let invoiceCommitQueue: Promise<void> = Promise.resolve()
const invoiceCommitLocks = new Map<string, { senderId: number; unlock: () => void; onDestroyed: () => void; sender: WebContents }>()

function releaseInvoiceCommitLock(token: string): void {
  const lock = invoiceCommitLocks.get(token)
  if (!lock) return
  invoiceCommitLocks.delete(token)
  lock.sender.removeListener('destroyed', lock.onDestroyed)
  lock.unlock()
}

function readDesktopAuthState() {
  const payload = database?.getSnapshot('shopsys-data').payloadJson ?? null
  return { payload, state: persistedAuthState(payload) }
}

function isAuthorizedWebContents(id: number): boolean {
  const { payload, state } = readDesktopAuthState()
  const configured = hasConfiguredDesktopAuth(state)
  // لا توجد مصادقة معدّة = مسار الإعداد الأول؛ وجود لقطة غير قابلة للتحليل لا يُعامل كإعداد فارغ.
  const requiresAuth = configured || (!!payload && !state)
  return !requiresAuth || authorizedWebContents.has(id)
}

const isDev = !!process.env.ELECTRON_START_URL
// قبل قفل العملية وأي قراءة: هوية ثابتة مستقلة عن اسم package وإصدار البرنامج.
const currentUserData = app.getPath('userData')
app.setName(DESKTOP_APP_NAME)
const stableUserData = selectRuntimeUserData(app.getPath('appData'), currentUserData)
mkdirSync(stableUserData, { recursive: true })
app.setPath('userData', stableUserData)
app.setPath('sessionData', stableUserData)
const installationDir = (): string => dirname(app.getPath('exe'))

/* ── سجل تشغيلي ملفي: تُكتب الأحداث المهمة محلياً في userData/main.log للفحص الداخلي؛
      لا يُرسل الملف ولا قاعدة البيانات تلقائياً أو يُطلب من المستخدم رفعهما. ── */
function logLine(tag: string, message: string): void {
  const stamp = new Date().toISOString()
  const line = `[${stamp}] [${tag}] ${message}\n`
  /* eslint-disable no-console */
  console.log(`[shopsys] ${line.trim()}`)
  try {
    appendFileSync(join(app.getPath('userData'), 'main.log'), line, 'utf8')
  } catch {
    /* مجلد المستخدم غير جاهز بعد — السطر طُبع على المخرجات فقط */
  }
}

type MainWindowLoadState = MainFrameLoadState & {
  retryScheduled: boolean
  retryTimer: NodeJS.Timeout | null
}
const mainWindowLoadStates = new WeakMap<BrowserWindow, MainWindowLoadState>()

/** صفحة خطأ عربية مضمّنة بدل الشاشة البيضاء — تعرض سبب الفشل ومسار السجل */
function errorPageHtml(reason: string, logPath: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تَحَكَّم — تعذّر التحميل</title>
<style>body{font-family:Tahoma,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:560px;padding:32px;background:#1e293b;border:1px solid #334155;border-radius:16px}
h1{font-size:20px;color:#f87171;margin:0 0 12px}p{font-size:14px;line-height:1.9;margin:8px 0}
code{background:#0f172a;padding:2px 8px;border-radius:6px;font-size:12px;color:#7dd3fc;direction:ltr;display:inline-block;max-width:100%;word-break:break-all}
.hint{color:#94a3b8;font-size:12px}</style></head><body><div class="card">
<h1>⚠ تعذّر تحميل واجهة التطبيق</h1>
<p>السبب المسجَّل: <b>${esc(reason)}</b></p>
<p>حُفظت تفاصيل الخطأ محلياً في:<br><code>${esc(logPath)}</code></p>
<p class="hint">لم تُحذف بياناتك. لا تشارك ملف القاعدة أو السجل؛ أغلق التطبيق وأعد تشغيله بعد التأكد من بقاء ملفات البيانات كما هي.</p>
</div></body></html>`
}

function showLoadError(win: BrowserWindow, reason: string): void {
  if (win.isDestroyed()) return
  const state = mainWindowLoadStates.get(win)
  if (state?.errorPageShowing) return
  if (state) {
    state.errorPageShowing = true
    state.retryScheduled = false
    if (state.retryTimer) clearTimeout(state.retryTimer)
    state.retryTimer = null
  }
  const logPath = join(app.getPath('userData'), 'main.log')
  logLine('load-error', reason)
  const html = errorPageHtml(reason, logPath)
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error: unknown) => {
    logLine('load-error-page', `تعذّر عرض صفحة الخطأ المضمّنة: ${(error as Error).message}`)
  })
  // النافذة مخفية حتى ready-to-show: صفحة الخطأ يجب أن تظهر حتماً
  if (!win.isVisible()) win.show()
}

function handleMainFrameLoadFailure(win: BrowserWindow, state: MainWindowLoadState, code: number, description: string, failedUrl: string): void {
  if (win.isDestroyed() || state.errorPageShowing) return
  // did-fail-load والرفض من loadFile قد يصفان الإلغاء نفسه؛ لا نكرر المحاولة أو السجل.
  if (code === CHROMIUM_ERR_ABORTED && state.retryScheduled) return
  const action = classifyMainFrameLoadFailure(code, state)
  if (action === 'ignore') {
    if (code === CHROMIUM_ERR_ABORTED && !state.appLoaded) logLine('load-cancelled', `أُلغي تحميل إطار رئيسي قبل ظهوره: ${failedUrl}`)
    return
  }
  if (action === 'retry') {
    state.retriesUsed += 1
    state.retryScheduled = true
    logLine('load-retry', `إعادة تحميل واجهة التطبيق بعد إلغاء عابر (${state.retriesUsed}/${MAIN_FRAME_ABORT_RETRY_LIMIT}): ${failedUrl}`)
    state.retryTimer = setTimeout(() => {
      state.retryScheduled = false
      state.retryTimer = null
      loadMainDocument(win, state)
    }, 400)
    state.retryTimer.unref()
    return
  }
  const suffix = code === CHROMIUM_ERR_ABORTED ? ' — انتهت محاولات إعادة التحميل' : ''
  showLoadError(win, `فشل تحميل الصفحة (${code}): ${description}${suffix} — ${failedUrl}`)
}

function loadMainDocument(win: BrowserWindow, state: MainWindowLoadState): void {
  if (win.isDestroyed() || state.errorPageShowing) return
  const pending = isDev ? win.loadURL(process.env.ELECTRON_START_URL!) : win.loadFile(join(__dirname, '../dist/index.html'))
  void pending.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/ERR_ABORTED/.test(message)) {
      handleMainFrameLoadFailure(win, state, CHROMIUM_ERR_ABORTED, message, win.webContents.getURL() || APP_INDEX_FILE_URL)
    } else {
      showLoadError(win, `loadFile: ${message}`)
    }
  })
}

/* ── النافذة ── */
/* ── v1.0.22: شاشة البدء بشريط تقدّم ─────────────────────────────────────
   تُعرض فوراً عند الإقلاع (ومنه أول تشغيل بعد التحديث) حتى تُفتح البيانات
   المحفوظة تلقائياً — بلا نافذة بيضاء وبلا معالج إعداد. تُغلق عند ظهور الواجهة
   أو بعد مهلة قصوى حتى لا تبقى معلّقة مهما حدث. */
let splashWindow: BrowserWindow | null = null
let splashLoaded = false
let splashState: { percent: number; text: string } = { percent: 0, text: '' }
let splashCloseTimer: NodeJS.Timeout | null = null

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

function splashHtml(headline: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#0f172a;font-family:'Segoe UI',Tahoma,sans-serif;-webkit-user-select:none;user-select:none}
.card{width:380px;padding:26px 28px;border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.12)}
h1{margin:0 0 4px;font-size:18px;font-weight:800}
p{margin:0 0 18px;font-size:12.5px;line-height:1.7;color:#475569}
.bar{height:10px;border-radius:999px;background:#e2e8f0;overflow:hidden}
.fill{height:100%;width:0;background:linear-gradient(90deg,#0ea5e9,#6366f1);transition:width .35s ease}
.step{margin-top:10px;min-height:16px;font-size:11.5px;color:#64748b}
</style></head><body><div class="card"><h1>تَحَكَّم</h1><p>${escapeHtmlText(headline)}</p>
<div class="bar"><div class="fill" id="f"></div></div><div class="step" id="s"></div></div>
<script>window.setProgress=function(p,t){document.getElementById('f').style.width=Math.max(0,Math.min(100,p))+'%';document.getElementById('s').textContent=t};</script>
</body></html>`
}

function showSplash(): void {
  // شاشة بدء موحدة بلا إعلان/حوار تحديث؛ التحديث الصامت لا يطلب أي تفاعل.
  const headline = 'جارٍ فتح بياناتك…'
  splashWindow = new BrowserWindow({
    width: 440, height: 250, frame: false, resizable: false, minimizable: false, maximizable: false,
    center: true, skipTaskbar: true, backgroundColor: '#f1f5f9', title: 'تَحَكَّم',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splashLoaded = false
  splashWindow.webContents.once('did-finish-load', () => {
    splashLoaded = true
    pushSplashState()
  })
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(headline))}`)
  /* مهلة أمان: لا تبقى الشاشة معلّقة إن لم تظهر الواجهة */
  splashCloseTimer = setTimeout(() => {
    closeSplash()
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
  }, 20_000)
}

function pushSplashState(): void {
  if (!splashWindow || splashWindow.isDestroyed() || !splashLoaded) return
  const payload = JSON.stringify(splashState)
  void splashWindow.webContents.executeJavaScript(`window.setProgress(${payload}.percent, ${payload}.text)`).catch(() => undefined)
}

function setSplashProgress(percent: number, text: string): void {
  splashState = { percent, text }
  pushSplashState()
}

function closeSplash(): void {
  if (splashCloseTimer) { clearTimeout(splashCloseTimer); splashCloseTimer = null }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
  splashWindow = null
}

/* آخر إصدار فُتح به البرنامج — لإظهار رسالة «تم التحديث» مرة واحدة بعد التثبيت */
function lastRunVersionPath(): string {
  return join(app.getPath('userData'), 'last-run.json')
}
function writeLastRunVersion(): void {
  try {
    writeFileSync(lastRunVersionPath(), JSON.stringify({ version: app.getVersion(), at: new Date().toISOString() }), 'utf8')
  } catch (error) {
    logLine('last-run', `تعذّر تسجيل الإصدار: ${(error as Error).message}`)
  }
}

/* v1.0.22: عنوان صفحة التطبيق المحلية (الإنتاج) وأصل خادم التطوير — لسياسة التنقل */
const APP_INDEX_FILE_URL = pathToFileURL(join(__dirname, '../dist/index.html')).href
const devOrigin: string | null = isDev ? new URL(process.env.ELECTRON_START_URL!).origin : null

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'تَحَكَّم',
    /* مخفية حتى تكتمل أول رسمة: لا نافذة بيضاء فارغة تظهر فوق شاشة البدء بشريط التقدّم */
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../dist/app-icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      /* v1.0.22: الصفحة الرئيسية تعمل في sandbox كنوافذ الطباعة والشاشة الافتتاحية.
         الجسر (preload) يستورد من 'electron' فقط — متوافق مع sandbox. */
      sandbox: true,
      spellcheck: false,
    },
  })
  const loadState: MainWindowLoadState = { appLoaded: false, errorPageShowing: false, retriesUsed: 0, retryScheduled: false, retryTimer: null }
  mainWindowLoadStates.set(win, loadState)
  win.webContents.setWindowOpenHandler(({ url }) => {
    /* ح9 (مراجعة ③): مخططات محددة فقط تُمرَّر إلى نظام التشغيل — لا file: ولا مخططات
       تطبيقات أخرى قد تفتح برامج محلية. الرفض دائماً داخل النافذة نفسها. */
    if (isExternalOpenable(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  /* v1.0.22: التنقل داخل النافذة مقصور على صفحة التطبيق نفسها. أي رابط آخر (صفحة خارجية
     أو ملف محلي آخر) يُمنع، وإن كان http(s)/mailto/tel يُفتح في المتصفح الافتراضي.
     الحدث لا يُطلق لـ loadURL/loadFile البرمجية، فصفحة الخطأ وتحميل التطبيق لا يتأثران. */
  win.webContents.on('will-navigate', (event, url) => {
    if (isInAppNavigation(url, APP_INDEX_FILE_URL, devOrigin)) return
    event.preventDefault()
    logLine('security', `منع تنقل غير مسموح: ${url.slice(0, 120)}`)
    if (isExternalOpenable(url)) void shell.openExternal(url)
  })
  /* قنوات التشخيص الميداني: فشل التحميل يعرض صفحة خطأ عربية بدل شاشة بيضاء،
     وأخطاء المُصيّر تُسجَّل في main.log — أين المشكلة يصبح معروفاً فوراً */
  win.webContents.on('did-finish-load', () => {
    if (loadState.errorPageShowing) return
    loadState.appLoaded = true
    loadState.retryScheduled = false
    if (loadState.retryTimer) clearTimeout(loadState.retryTimer)
    loadState.retryTimer = null
  })
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return
    handleMainFrameLoadFailure(win, loadState, code, desc, failedUrl)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    if (shuttingDown) {
      /* quitAndInstall ينهي المُصيّر عمداً بعد الحفظ والنسخة الاحتياطية؛ لا تحاول
         تحميل صفحة خطأ أو إظهار نافذة أثناء بدء إغلاق Electron للتحديث. */
      logLine('renderer-gone', `أُغلق المُصيّر مع إغلاق التطبيق: ${details.reason} / ${details.exitCode}`)
      return
    }
    logLine('renderer-gone', `reason=${details.reason} exitCode=${details.exitCode}`)
    showLoadError(win, `توقف محرك الواجهة (${details.reason} / ${details.exitCode})`)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logLine('renderer-console', `${message} (${sourceId}:${line})`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logLine('preload-error', `${preloadPath}: ${error}`)
  })
  win.on('close', (event) => {
    /* قاعدة المالك: النافذة الرئيسية لا تُغلق بينما توجد نوافذ تابعة مفتوحة —
       تُغلق الأقمار أولاً (بمصافحة حفظ كل واحدة) أو يبقى البرنامج مفتوحاً */
    if (!shuttingDown && satellitesOpenCount() > 0) {
      event.preventDefault()
      void confirmAndCloseAllSatellites().then((allClosed) => {
        if (allClosed && !win.isDestroyed()) win.close()
      }).catch((error: unknown) => logLine('satellite-close', `حارس إغلاق الرئيسية: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    if (database && !shuttingDown) {
      // أبقِ المُصيّر حياً حتى تُحفظ طوابير الكتابة ويُؤخذ آخر backup.
      event.preventDefault()
      app.quit()
    }
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  loadMainDocument(win, loadState)
  return win
}

/* مفتاح التوافق القديم: لا تعتمد عليه اللقطات الجديدة. يُقرأ فقط لفك
   لقطات enc:v1 التي كُتبت في إصدارات سابقة، ثم تُرحّل إلى نص SQLite عادي. */
/** مدخل قرص مفتاح الجهاز — مشترك بين الإقلاع واستيراد مفتاح الاسترداد */
function buildDeviceKeyIo(): DeviceKeyIo {
  const dir = app.getPath('userData')
  return {
    readFile: (name) => {
      try { return readFileSync(join(dir, name)) } catch { return null }
    },
    writeFile: (name, data) => {
      /* 0o600 للملاذ الصريح: لو اضطررنا لملف مقروء فلا يكون لكل مستخدمي الجهاز */
      writeFileSync(join(dir, name), data, { mode: 0o600 })
    },
    deleteFile: (name) => { if (existsSync(join(dir, name))) unlinkSync(join(dir, name)) },
    generate: () => randomBytes(32),
    safeStorage,
    log: logLine,
  }
}

/* v1.0.22 — حالة تصدير مفتاح الاسترداد (تذكير المالك حتى يصدّره) */
function keyRecoveryStatePath(): string {
  return join(app.getPath('userData'), 'key-recovery.json')
}
function readKeyRecoveryExportedAt(): string | null {
  try {
    const value = JSON.parse(readFileSync(keyRecoveryStatePath(), 'utf8'))
    return typeof value?.exportedAt === 'string' ? value.exportedAt : null
  } catch {
    return null
  }
}

function ensureDeviceEncryptionKey(): Buffer {
  /* يُستخدم فقط لفك لقطات enc:v1 القديمة. المفتاح نفسه يُحفظ كما كان
     عبر safeStorage، مع عدم حذف أو استبدال أي نسخة قديمة غير قابلة للقراءة. */
  const outcome = resolveDeviceKey(buildDeviceKeyIo())
  for (const warning of outcome.warnings) logLine('device-key', `تحذير: ${warning}`)
  logLine('device-key', describeDeviceKeyOutcome(outcome))
  return outcome.key
}

/** تعذّر مفتاح قديم لا يمنع تشغيل قواعد النص العادي الجديدة. إذا عثرنا على
 * لقطة مشفرة، يفشل فحصها قبل الكتابة وتظهر شاشة استرداد بدلاً من فقدها. */
function loadLegacySnapshotKey(): Buffer {
  try { return ensureDeviceEncryptionKey() } catch (error) {
    logLine('device-key', `مفتاح اللقطات القديمة غير متاح؛ يستمر الإقلاع للبيانات النصية: ${(error as Error).message}`)
    return Buffer.alloc(0)
  }
}

/* ═══ v1.0.8 (طلب المالك): قاعدة بيانات قابلة للنقل + نسخ احتياطية مزدوجة ═══
   ملف التوجيه userData/db-location.json يحمل:
     customDbPath       — مكان القاعدة الذي اختاره المستخدم (null = الافتراضي)
     secondaryBackupDir — مكان النسخة الاحتياطية الثانية (null = المستندات الافتراضي)
     lastFileBackupAt   — آخر نسخة ملفية تلقائية (إقلاع يومياً في المكانين)
   القرص C يحمل ويندوز — نقل القاعدة لقرص آخر يحميها من الفرمتة، والنسخ
   المزدوجة (بجوار القاعدة + مكان ثانٍ) تضاعف الأمان. */

const userDataDir = (): string => app.getPath('userData')
function readDbLocation(): DbLocationConfig { return readDbLocationAt(userDataDir()) }
function writeDbLocation(cfg: DbLocationConfig): void {
  writeDbLocationAt(userDataDir(), cfg, (message) => logLine('db-location', message))
}
/* ملف التوجيه مفقود ⇒ استعادته من المرآة في المكان الافتراضي */
/**
 * v1.0.22: حوار اختيار ملف قاعدة يمر دائماً بالفحص قبل الاعتماد (سلامة + جدول snapshots).
 * يعيد المسار المعتمد، أو null عند الإلغاء أو الرفض (ويُعرض سبب الرفض للمستخدم).
 */
function pickValidatedDatabaseFile(): string | null {
  const picked = dialog.showOpenDialogSync({
    title: 'اختر ملف قاعدة البيانات الموجود مسبقاً (shopsys.db)',
    properties: ['openFile'],
    filters: [{ name: 'قاعدة بيانات تَحَكَّم', extensions: ['db', 'sqlite'] }],
  })
  const file = picked?.[0]
  if (!file) return null
  if (isUnsafeDatabaseLocation(file, installationDir(), userDataDir())) {
    dialog.showErrorBox('مكان غير آمن لقاعدة البيانات', 'المكان داخل مجلد التثبيت أو مجلد databases الذي يحذفه Chromium. اختر ملفاً في مجلد مستقل لحماية بياناتك.')
    return null
  }
  const verdict = isAbsoluteDbPath(file) ? probeShopsysDatabase(file) : 'unreadable'
  if (verdict === 'ok') return file
  const why = verdict === 'not-shopsys' ? 'ليس ملف قاعدة بيانات تَحَكَّم'
    : verdict === 'corrupt' ? 'الملف تالف' : 'تعذّر فتح الملف'
  logLine('db-recovery', `رُفض الملف المختار (${why}): ${file}`)
  dialog.showErrorBox('تَحَكَّم — ملف غير صالح', `${why}:\n${file}\n\nاختر ملف shopsys.db الصحيح.`)
  return null
}

/**
 * v1.0.22 (طلب المالك): لا يُنشأ قاعدة فارغة صامتاً. إذا غابت القاعدة وفيه دليل تشغيل سابق
 * (ولم يجد offerExistingData نسخة صالحة) نطلب من العميل اختيار الملف الموجود، ونحفظ مساره
 * المطلق في المؤشر. التثبيت الجديد بلا دليل لا يرى هذا الحوار.
 */
async function askForExistingDatabaseIfNeeded(): Promise<void> {
  // البدء النظيف قرار صريح محفوظ؛ غياب القاعدة بعده يعني إنشاء الجديدة المقصودة.
  if (freshStartCutoffAt(userDataDir()) !== null) return
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { dbPath } = resolveDbPath()
    const need = shouldAskForExistingDatabase({
      resolvedDbExists: existsSync(dbPath),
      previousUse: hasPreviousUseEvidenceAt(userDataDir()),
    })
    if (!need) return
    logLine('db-recovery', `القاعدة غير موجودة في ${dbPath} مع دليل تشغيل سابق — نطلب اختيار الملف`)
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'تَحَكَّم — لم نجد قاعدة بياناتك',
      message: 'لم نجد قاعدة بياناتك الحالية، ولن نُنشئ قاعدة فارغة تلقائياً.\n\nاختر ملف قاعدة البيانات الموجود مسبقاً (shopsys.db).',
      detail: `المكان المتوقع: ${dbPath}\n\n«بدء قاعدة جديدة» يبدأ ببيانات فارغة، ولن تظهر بياناتك السابقة إلا إذا اخترت ملفها لاحقاً.`,
      buttons: ['اختيار ملف shopsys.db الموجود', 'بدء قاعدة جديدة', 'إغلاق البرنامج'],
      defaultId: 0,
      cancelId: 2,
    })
    if (choice === 2) {
      logLine('db-recovery', 'أغلق المستخدم الحوار دون اختيار قاعدة')
      app.exit(0)
      throw new Error('أُغلق البرنامج: لم تُختر قاعدة بيانات')
    }
    if (choice === 1) {
      const result = await startFreshWithoutDatabaseAt({
        userData: userDataDir(), installDir: installationDir(), excludedPaths: knownOldDatabasePaths(dbPath),
      })
      logLine('db-recovery', `بدأ المستخدم قاعدة جديدة باختياره؛ بدأ=${result.startedAt}`)
      return
    }
    const file = pickValidatedDatabaseFile()
    if (!file) continue
    writeDbLocation({ ...readDbLocation(), customDbPath: file, customDbOpenedAt: null })
    logLine('db-recovery', `اعتُمدت القاعدة التي اختارها المستخدم: ${file}`)
  }
  throw new Error('تعذّر تحديد قاعدة البيانات بعد عدة محاولات')
}

function restoreLocationPointerIfMissing(): void {
  const restored = restoreLocationPointerAt(userDataDir())
  if (restored) logLine('db-location', `استُعيد مؤشر المكان من المرآة: ${restored}`)
}
/* v1.0.19/v1.0.22: حالة المكان المخصص (انظر storagePolicy.ts) — لا إنشاء ملف فارغ */
function customDbStatus(): { status: CustomLocationStatus; path: string | null } {
  return customDbStatusAt(userDataDir())
}
function resolveDbPath(): { dbPath: string; isCustom: boolean } {
  return resolveDbPathAt(userDataDir())
}

/** المكان الثاني الافتراضي للنسخ: مجلد مستندات المستخدم (يبقى مع ملفاته عند إعادة تثبيت الويندوز إن نُقلت المستندات) */
function resolveSecondaryBackupDir(): { dir: string; isDefault: boolean } {
  const cfg = readDbLocation()
  if (cfg.secondaryBackupDir && existsSync(cfg.secondaryBackupDir) && !isUnsafeDatabaseLocation(cfg.secondaryBackupDir, installationDir(), userDataDir())) return { dir: cfg.secondaryBackupDir, isDefault: false }
  return { dir: join(app.getPath('documents'), 'Tahakom-Backups'), isDefault: true }
}

/** نسخة ملفية SQLite في المكانين: بجوار القاعدة + المكان الثاني — تُستدعى يدوياً وعند الإقلاع (يومياً) */
async function backupDatabaseFile(tag: 'manual' | 'auto', database: ShopsysDatabase | null, dbPath: string): Promise<string[]> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const written: string[] = []
  const targets = [
    join(dirname(dbPath), 'backups', tag),
    join(resolveSecondaryBackupDir().dir, tag),
  ]
  for (const dir of targets) {
    try {
      mkdirSync(dir, { recursive: true })
      const dest = join(dir, `${tag}-${stamp}.db`)
      if (database) await database.raw.backup(dest)
      else copyFileSync(dbPath, dest)
      // تنظيف: أحدث 20 نسخة لكل مكان (لا امتلاء قرص بلا نهاية)
      const files = freshStartEligibleFilesAt(userDataDir(), readdirSync(dir)
        .filter((file) => file.endsWith('.db')).map((file) => ({ file, path: join(dir, file) })))
        .map(({ file }) => file).sort()
      for (const old of files.slice(0, Math.max(0, files.length - 20))) unlinkSync(join(dir, old))
      written.push(dest)
    } catch (error) {
      logLine('backup', `تعذّرت النسخة إلى ${dir}: ${(error as Error).message}`)
    }
  }
  if (tag === 'auto') {
    const cfg = readDbLocation()
    writeDbLocation({ ...cfg, lastFileBackupAt: new Date().toISOString() })
  }
  return written
}

/* ── v1.0.9: درع البيانات — فحص سلامة عند الإقلاع واسترداد تلقائي من أحدث نسخة سليمة ──
   سيناريوهات التلف: انقطاع كهرباء أثناء الكتابة، امتلاء القرص، أنتيفيروس عزل الملف،
   نسخ القاعدة وهي مفتوحة بلا WAL. quick_check يكتشف التلف، والاسترداد يعيد أحدث
   نسخة سليمة من المكانين (يدوية/تلقائية) بلا تدخل — والملف التالف يُحفظ للفحص. */
const RECOVERY_MARKER = 'db-recovery.json'

/* v1.0.19: الفحص ثلاثي الحالة. الخطأ في الفتح (قفل/صلاحيات/ملف مشغول بعملية
   أخرى أثناء التحديث) لا يعني تلف القاعدة — كان يُعامَل كتلف فيُعزل الملف
   الحقيقي ويُستبدل بنسخة أقدم أو بقاعدة فارغة. العزل يحدث فقط عند تلف مؤكد. */
type DbProbe = 'ok' | 'corrupt' | 'unreadable'

function probeDatabase(dbPath: string): DbProbe {
  let probe: Database.Database
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true })
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unreadable'
  }
  try {
    return probe.pragma('quick_check', { simple: true }) === 'ok' ? 'ok' : 'corrupt'
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return /SQLITE_(CORRUPT|NOTADB)/.test(code) ? 'corrupt' : 'unreadable'
  } finally {
    try { probe.close() } catch { /* لا شيء */ }
  }
}

function quickCheck(dbPath: string): boolean {
  return probeDatabase(dbPath) === 'ok'
}

/** كل ملفات النسخ: المكانان (يدوي/تلقائي) + الأجيال الساعية/اليومية/قبل التحديث في المكان الافتراضي — الأحدث أولاً */
function candidateBackups(dbPath: string): string[] {
  const ud = app.getPath('userData')
  const dirs = recoveryBackupDirs({ userData: ud, installDir: installationDir(), documentsBackupDir: join(app.getPath('documents'), 'Tahakom-Backups') }, dbPath)
  const out: { path: string; mtimeMs: number }[] = []
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
        const full = join(dir, f)
        if (!isCurrentFreshStartDataAt(ud, full)) continue
        out.push({ path: full, mtimeMs: statSync(full).mtimeMs })
      }
    } catch { /* مجلد غير موجود */ }
  }
  return newestFirst(out).map((x) => x.path)
}

/** يُنفَّذ قبل الفتح: القاعدة تالفة ⇐ عزلها + استرداد أحدث نسخة سليمة (أو قاعدة جديدة إن لا نسخة) */
/**
 * v1.0.22: الدرع قبل الفتح — المنطق في desktop/dbShield.ts (مُختبر على ملفات حقيقية).
 * هنا فقط: قائمة النسخ الاحتياطية، والسجل، وإشعار الاسترداد عند النجاح.
 */
function shieldDamagedDatabase(dbPath: string): ShieldOutcome {
  const result = shieldDatabaseAt(dbPath, () => candidateBackups(dbPath), {
    log: (message) => logLine('db-shield', message),
  })
  if (result.outcome === 'restored') {
    try {
      writeFileSync(join(app.getPath('userData'), RECOVERY_MARKER), JSON.stringify({
        at: new Date().toISOString(), from: result.restoredFrom, quarantine: result.quarantine,
      }), 'utf8')
    } catch { /* الإشعار اختياري */ }
  }
  return result.outcome
}

/* ── القاعدة ── */

/** الاسترداد التلقائي يسبق هذا الحوار؛ هنا فقط اختيار الأصل عند عدم وجود نسخة موثوقة. */
async function resolveMissingLocation(): Promise<void> {
  for (let guard = 0; guard < 1000; guard += 1) {
    const { status, path } = customDbStatus()
    if (status === 'none' || status === 'ok' || !path) return
    logLine('db-location', `المكان المخصص (${status}): ${path}`)
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'تَحَكَّم — تعذّر العثور على قاعدة البيانات',
      message: `لم نجد القاعدة أو نسخة سليمة مؤكدة الهوية:\n${path}\n\nلم تُنشأ قاعدة فارغة ولم يُستبدل أي ملف.`,
      detail: 'وصّل القرص وأعد المحاولة، أو اختر ملف القاعدة الموجود بالفعل. لا حاجة لاختيار مجلد جديد.',
      buttons: ['إعادة المحاولة', 'اختيار ملف القاعدة الموجود', 'إغلاق البرنامج'],
      defaultId: 0, cancelId: 2,
    })
    if (choice === 0) {
      await recoverDatabaseSilently()
      continue
    }
    if (choice === 2) {
      app.exit(0)
      throw new Error('أُغلق البرنامج دون إنشاء قاعدة بديلة')
    }
    const file = pickValidatedDatabaseFile()
    if (file) writeDbLocation({ ...readDbLocation(), customDbPath: file, customDbOpenedAt: null })
  }
}

async function recoverDatabaseSilently(): Promise<void> {
  const source = await recoverMissingDatabaseAt({
    userData: userDataDir(), installDir: installationDir(),
    documentsBackupDir: join(app.getPath('documents'), 'Tahakom-Backups'),
    minimumMtimeMs: freshStartCutoffAt(userDataDir()),
    isCandidateAllowed: (file) => isCurrentFreshStartDataAt(userDataDir(), file),
    deviceKey: deviceEncryptionKey,
  })
  if (source) logLine('db-recovery', `استُعيدت القاعدة المفقودة تلقائياً من ${source} إلى ${resolveDbPath().dbPath}`)
}

/** كل مرشّحات البيانات السابقة: نسخ الاحتياطي في المكان الافتراضي/المستندات + قاعدة حيّة على الأقراص (Tahakom\shopsys.db) */
function discoverExistingData(): ExistingDataCandidate[] {
  const ud = app.getPath('userData')
  const out: ExistingDataCandidate[] = []
  const installedDb = join(installationDir(), 'shopsys.db')
  if (existsSync(installedDb) && isCurrentFreshStartDataAt(ud, installedDb)) out.push({ path: installedDb, mtimeMs: statSync(installedDb).mtimeMs, kind: 'live', whereAr: installedDb })
  const backupDirs = [
    ...(['hourly', 'pre-update'] as const).map((k) => join(ud, 'backups', k)),
    join(app.getPath('documents'), 'Tahakom-Backups', 'manual'),
    join(app.getPath('documents'), 'Tahakom-Backups', 'auto'),
  ]
  for (const dir of backupDirs) {
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
        const full = join(dir, f)
        if (!isCurrentFreshStartDataAt(ud, full)) continue
        out.push({ path: full, mtimeMs: statSync(full).mtimeMs, kind: 'backup', whereAr: full })
      }
    } catch { /* لا مجلد */ }
  }
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const live = `${letter}:\\Tahakom\\shopsys.db`
      try {
        if (existsSync(live) && isCurrentFreshStartDataAt(ud, live)) out.push({ path: live, mtimeMs: statSync(live).mtimeMs, kind: 'live', whereAr: live })
      } catch { /* درايف غير موصول */ }
    }
  }
  return out
}

/** كل ملفات البيانات المعروفة لحظة إقرار البدء النظيف؛ لا نعتمد على mtime وحده. */
function knownOldDatabasePaths(activePath: string): string[] {
  const ud = userDataDir()
  const previouslyExcluded = readFreshStartMarkerAt(ud)?.excludedPaths ?? []
  const live = [join(ud, 'shopsys.db'), join(installationDir(), 'shopsys.db')]
  for (const folder of ['Tahakom-Data', 'databases']) {
    try {
      for (const name of readdirSync(join(ud, folder))) if (name.endsWith('.db')) live.push(join(ud, folder, name))
    } catch { /* مجلد حماية غير موجود */ }
  }
  return [...new Set([
    activePath, ...live, ...previouslyExcluded, ...changedDrivePaths(activePath), ...candidateBackups(activePath),
    ...discoverExistingData().map((candidate) => candidate.path),
  ])]
}

/** أول تشغيل بلا مؤشر ولا قاعدة افتراضية: إن وُجدت بيانات سابقة نعرضها ونسأل قبل أي معالج */
async function offerExistingData(): Promise<void> {
  const ud = userDataDir()
  const cfg = readDbLocation()
  // اختار المالك قاعدة نظيفة صراحةً؛ لا نعيد عرض/نسخ ملفات ما قبل الاختيار.
  if (freshStartCutoffAt(ud) !== null) return
  if (cfg.customDbPath) return
  if (existsSync(join(ud, 'shopsys.db'))) return
  // نتحقق من السلامة للمرشّح الأفضل فقط (الفحص مكلف على ملفات كبيرة)
  const ranked = newestFirst(discoverExistingData())
  const valid: ExistingDataCandidate[] = []
  for (const c of ranked.slice(0, 8)) {
    if (probeDatabase(c.path) === 'ok') valid.push(c)
  }
  const best = bestExistingCandidate(valid)
  if (!best) return
  logLine('db-discovery', `وُجدت بيانات سابقة: ${best.path} (${best.kind})`)
  const when = new Date(best.mtimeMs).toLocaleString('ar-EG')
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: 'تَحَكَّم — وُجدت بيانات سابقة',
    message: `وجدنا بيانات سابقة على هذا الجهاز:\n${best.path}\nآخر تعديل: ${when}\n\nهل تريد استخدامها؟`,
    detail: '«فتح البيانات» يعيدها كما كانت دون معالج إعداد. «اختيار ملف آخر» لملف قاعدة تختاره. «بدء قاعدة جديدة» يبدأ برنامجاً فارغاً — لا تختره إن كانت لديك بيانات.',
    buttons: ['فتح البيانات', 'اختيار ملف آخر', 'بدء قاعدة جديدة'],
    defaultId: 0,
    cancelId: 2,
  })
  if (choice === 0) {
    adoptExistingData(best)
    return
  }
  if (choice === 1) {
    const picked = dialog.showOpenDialogSync({ properties: ['openFile'], filters: [{ name: 'قاعدة بيانات', extensions: ['db'] }], title: 'اختر ملف قاعدة البيانات' })
    const file = picked?.[0]
    if (!file) return
    const isBackup = /[\\/]backups[\\/]|Tahakom-Backups/.test(file)
    adoptExistingData({ path: file, mtimeMs: 0, kind: isBackup ? 'backup' : 'live', whereAr: file })
    return
  }
  if (choice === 2) {
    const result = await startFreshWithoutDatabaseAt({
      userData: ud, installDir: installationDir(), archiveSource: best.path,
      excludedPaths: knownOldDatabasePaths(resolveDbPath().dbPath),
    })
    logLine('db-recovery', `اختير بدء نظيف بدلاً من البيانات المكتشفة؛ الأرشيف=${result.archivePath ?? 'لا يوجد'} بدأ=${result.startedAt}`)
  }
}

/** live ⇒ يُفتح في مكانه ويصبح مكاننا المخصص. backup ⇒ يُنسخ إلى المكان الافتراضي */
function adoptExistingData(c: ExistingDataCandidate): void {
  if (c.kind === 'live') {
    writeDbLocation({ ...readDbLocation(), customDbPath: c.path, customDbOpenedAt: null })
    logLine('db-discovery', `اعتُمدت القاعدة الحيّة في مكانها: ${c.path}`)
    return
  }
  const dest = join(app.getPath('userData'), 'shopsys.db')
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(c.path, dest)
  logLine('db-discovery', `استُعيدت نسخة ${c.path} إلى المكان الافتراضي`)
}

async function openDatabase(): Promise<ShopsysDatabase> {
  restoreLocationPointerIfMissing()
  await recoverDatabaseSilently()
  await resolveMissingLocation()
  await offerExistingData()
  await askForExistingDatabaseIfNeeded()
  /* فحص تشفيري قبل الحماية أو فتح SQLite بمسار الكتابة أو تشغيل migrations.
     سلامة SQLite وحدها لا تكفي: قد يكون الملف سليماً لكن مفتاح الجهاز تغيّر بعد
     تحديث/نقل profile. في هذه الحالة نترك الملف كما هو ونُظهر شاشة الاسترداد. */
  const selectedDatabasePath = resolveDbPath().dbPath
  if (existsSync(selectedDatabasePath)) {
    // قاعدة البيانات النصية لا تعتمد على المفتاح. وجود لقطة enc:v1 قديمة
    // بلا مفتاح مطابق يوقف الفتح قبل أي كتابة أو نقل، حفاظاً على الأصل.
    const keyProbe = probeSnapshotKey(selectedDatabasePath, deviceEncryptionKey)
    if (keyProbe.status === 'mismatch') throw new DatabaseKeyMismatchError(selectedDatabasePath, keyProbe.stores, deviceEncryptionKey.length === 32)
  }
  // حماية القاعدة الفعلية الموجودة فقط؛ لا ترحيل جماعي لعملاء. الأصل يبقى نسخة أمان.
  const beforeProtection = resolveDbPath().dbPath
  const protectedPath = await protectDatabaseAt(userDataDir(), installationDir())
  if (beforeProtection !== protectedPath) logLine('db-protection', `حُميت القاعدة خارج التثبيت: ${beforeProtection} → ${protectedPath}`)
  // v1.0.22: عند فشل الفتح يعرض حوار الخطأ خيار «اختيار ملف القاعدة يدوياً»، ثم يُعاد الفتح من الملف المعتمد
  for (let attempt = 1; ; attempt += 1) {
    await protectDatabaseAt(userDataDir(), installationDir())
    const { dbPath, isCustom } = resolveDbPath()
    // v1.0.9: الدرع قبل الفتح — تلف القاعدة لا يوقف التطبيق بل يسترد نسخة. v1.0.22: بلا نسخة سليمة ⇒ يوقف الإقلاع بحوار
    let shield: ShieldOutcome = 'ok'
    try { shield = shieldDamagedDatabase(dbPath) } catch (e) { logLine('db-shield', `تخطي الفحص: ${(e as Error).message}`) }
    try {
      if (shield === 'corrupt-no-backup') throw new Error('قاعدة البيانات تالفة ولم يُعثر على نسخة سليمة في أي مكان')
      const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dirname(dbPath), 'backups') })
      logLine('db', `قاعدة SQLite جاهزة: ${dbPath}${isCustom ? ' (مكان مخصص)' : ' (افتراضي)'} (مخطط ${db.schemaVersion()})`)
      activeDatabasePath = dbPath
      rememberDatabaseIdentity(userDataDir(), db.origin.device)
      if (isCustom) {
        const cfg = readDbLocation()
        if (!cfg.customDbOpenedAt) writeDbLocation({ ...cfg, customDbOpenedAt: new Date().toISOString() })
      }
      // v1.0.8: نسخة ملفية تلقائية يومياً في المكانين عند الإقلاع
      const cfg = readDbLocation()
      const lastAuto = cfg.lastFileBackupAt ? Date.parse(cfg.lastFileBackupAt) : 0
      if (Date.now() - lastAuto > 24 * 60 * 60 * 1000) {
        void backupDatabaseFile('auto', db, dbPath).then((files) => {
          if (files.length) logLine('backup', `نسخة تلقائية في ${files.length} مكان: ${files.join(' | ')}`)
        })
      }
      return db
    } catch (error) {
      const message = (error as Error).message
      logLine('db-fatal', `فشل فتح القاعدة (${dbPath}): ${message}`)
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'تَحَكَّم — فشل تشغيل القاعدة',
        message: `تعذّر فتح قاعدة البيانات:\n${dbPath}`,
        detail: `${message}\n\nإن كانت بياناتك في ملف آخر فاختره يدوياً. الملف يجب أن يكون قاعدة تَحَكَّم سليمة.\nاختيار ملف آخر لا يحذف القاعدة الحالية (${dbPath}). لا تشارك ملف القاعدة؛ يحتوي بياناتك المحلية.`,
        buttons: ['اختيار ملف القاعدة يدوياً...', 'إظهار ملف القاعدة في المجلد', 'إغلاق البرنامج'],
        defaultId: 0,
        cancelId: 2,
      })
      if (choice === 0 && attempt < 20) {
        const picked = pickValidatedDatabaseFile()
        if (picked) {
          writeDbLocation({ ...readDbLocation(), customDbPath: picked, customDbOpenedAt: null })
          logLine('db-recovery', `اعتُمد ملف يدوي بعد فشل الفتح، وتُعاد المحاولة: ${picked}`)
        }
        // إلغاء الاستعراض يعيد حوار الخطأ نفسه بدل إغلاق صامت
        continue
      }
      if (choice === 1 && attempt < 20) {
        if (existsSync(dbPath)) shell.showItemInFolder(dbPath)
        continue
      }
      app.exit(1)
      throw error
    }
  }
}

/* ── الطباعة (§102): نسخة إلى طابعة مسماة أو الافتراضية، صامتة أو بحوار ── */
/** تحميل مستند مؤقت في نافذة الطباعة: ينتهي بالنجاح، أو بخطأ عند فشل التحميل، أو بالمهلة (مراجعة 2026-10-11) */
function loadPrintHtml(win: BrowserWindow, file: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      win.webContents.removeListener('did-finish-load', onFinish)
      win.webContents.removeListener('did-fail-load', onFail)
    }
    const onFinish = () => { cleanup(); resolve() }
    const onFail = (_e: unknown, code: number, desc: string) => { cleanup(); reject(new Error(`تعذّر تحميل المستند للطباعة (${code}): ${desc}`)) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('انتهت مهلة تحميل المستند للطباعة')) }, 20_000)
    win.webContents.on('did-finish-load', onFinish)
    win.webContents.on('did-fail-load', onFail)
    win.loadFile(file).catch((error: Error) => { cleanup(); reject(error) })
  })
}

/** حذف الملف المؤقت بعد الاستعمال — يحمل بيانات المستند (فواتير/أسماء عملاء) */
function removeTempFile(file: string): void {
  try { unlinkSync(file) } catch { /* غير موجود أو مقفل — لا أثر وظيفي */ }
}

let printQueue: Promise<unknown> = Promise.resolve()
function enqueuePrint<T>(task: () => Promise<T>): Promise<T> {
  const result = printQueue.then(task, task)
  printQueue = result.then(() => undefined, () => undefined)
  return result
}
function hardenedPrintHtml(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline' data:; font-src data: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${csp}`) : `${csp}${html}`
}
async function printHtmlNow(html: string, silent: boolean, printerName?: string): Promise<void> {
  const tmp = join(app.getPath('userData'), `print-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(tmp, hardenedPrintHtml(html), 'utf8')
  try {
    const win = printWindow && !printWindow.isDestroyed()
      ? printWindow
      : (printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }))
    await loadPrintHtml(win, tmp)
    await win.webContents.print({ silent, deviceName: printerName || undefined, printBackground: true, margins: { marginType: 'default' } }, () => undefined)
  } finally {
    removeTempFile(tmp)
  }
}

function printHtml(html: string, silent: boolean, printerName?: string): Promise<void> {
  return enqueuePrint(() => printHtmlNow(html, silent, printerName))
}

async function listPrinters(): Promise<string[]> {
  const win = mainWindow ?? printWindow ?? createMainWindow()
  /* Electron 34+: getPrinters صارت وعداً (getPrintersAsync سابقاً ثم getPrinters) */
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((printer) => printer.name)
}

/* ── v1.0.13: إرسال مستند PDF عبر واتساب ─────────────────────────────
   wa.me لا يدعم إرفاق ملفات برابط مباشر — النمط الصادق الواقعي:
   1) توليد PDF حقيقي بنفس محرك الطباعة (printToPDF على قالب المستند).
   2) حفظه بمجلد معروف: التنزيلات/Tahakom-PDF/
   3) فتح المجلد بالمستكشف والملف محدد — ليسحبه المستخدم للمحادثة
      (Electron 44 لا يوفر حافظة ملفات — لا ادعاء قدرة غير موجودة).
   4) فتح محادثة wa.me (برقم الطرف أو قائمة اختيار جهة عند غياب الرقم). */
async function exportPdfShareNow(html: string, fileName: string, waLink?: string): Promise<{ ok: boolean; path?: string; copied: boolean; error?: string }> {
  try {
    const dir = join(app.getPath('downloads'), 'Tahakom-PDF')
    mkdirSync(dir, { recursive: true })
    /* أسماء لاتينية آمنة عبر أنظمة الملفات والمشاركة */
    const safeName = (fileName || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `doc-${Date.now()}`
    const outPath = join(dir, `${safeName}.pdf`)
    const tmp = join(app.getPath('userData'), `pdf-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
    writeFileSync(tmp, hardenedPrintHtml(html), 'utf8')
    const win = printWindow && !printWindow.isDestroyed()
      ? printWindow
      : (printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }))
    try {
      await loadPrintHtml(win, tmp)
    } catch (loadError) {
      removeTempFile(tmp)
      throw loadError
    }
    removeTempFile(tmp)
    /* المقاس والاتجاه من @page داخل قالب المستند نفسه (A4/A5/حراري)؛
       الهوامش بالبوصة — 0.4" ≈ 1سم مثل افتراضي حوار الطباعة */
    const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
    writeFileSync(outPath, pdf)
    /* Electron 44: لا واجهة حافظة للملفات (writeBuffer أزيل) — الصدق التقني:
       النمط المعتمد فتح المجلد بالملف محدداً ليسحبه المستخدم للمحادثة */
    const copied = false
    shell.showItemInFolder(outPath)
    /* الرابط من المُصيّر: لا يُفتح إلا إن كان wa.me عبر https (مراجعة 2026-10-11) */
    if (waLink && isWhatsAppChatLink(waLink)) void shell.openExternal(waLink)
    return { ok: true, path: outPath, copied }
  } catch (error) {
    return { ok: false, copied: false, error: (error as Error).message }
  }
}

function exportPdfShare(html: string, fileName: string, waLink?: string): Promise<{ ok: boolean; path?: string; copied: boolean; error?: string }> {
  return enqueuePrint(() => exportPdfShareNow(html, fileName, waLink))
}

/* ── التحديث التلقائي بصمت: فحص/تنزيل في الخلفية + تثبيت وإعادة تشغيل عند الإغلاق ── */
type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

let updaterState: UpdaterState = { status: 'idle' }
let downloadedUpdateVersion: string | null = null
let downloadedInstallerPath: string | null = null
/** نسبة آخر تقدم تنزيل معروفة — تُعرض في شريط التنزيل */
let updateDownloadPercent = 0

function recordUpdaterState(state: UpdaterState): void {
  updaterState = state
  if (state.status === 'error') logLine('updater', `خطأ تحديث: ${state.message}`)
  if (state.status === 'available') logLine('updater', `يتوفر تحديث ${state.version}؛ بدأ التنزيل في الخلفية`)
  if (state.status === 'not-available') logLine('updater', `لا يوجد تحديث أحدث من ${state.version}`)
  if (state.status === 'downloading') updateDownloadPercent = state.percent
  if (state.status === 'downloaded') {
    downloadedUpdateVersion = state.version
    updateDownloadPercent = 100
    logLine('updater', `اكتمل تنزيل ${state.version}؛ سيُثبّت بصمت عند الإغلاق`)
    preUpdateBackup = backupBeforeUpdate(state.version).catch((error) => {
      logLine('backup', `تعذّرت نسخة ما قبل التحديث: ${(error as Error).message}`)
      return null
    })
  }
  /* واجهة التحديث اليدوية: زر «فحص التحديثات» + شريط التنزيل —
     الحالة تصل للواجهة فوراً؛ الفحص الدوري والتثبيت الصامت يبقيان كما هما. */
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:state', state)
}

function reportUpdaterError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  if (updaterState.status === 'error' && updaterState.message === message) return
  recordUpdaterState({ status: 'error', message })
}

function ensureUpdaterFeed(autoUpdater: typeof import('electron-updater').autoUpdater): void {
  const configPath = join(process.resourcesPath, 'app-update.yml')
  if (existsSync(configPath)) return
  // بعض المثبتات القديمة/المتضررة فقدت metadata. استخدم الرف العام المعروف
  // كحل احتياطي بدلاً من ترك ENOENT غير معالج أو تعطيل التطبيق كله.
  logLine('updater', `ملف ${configPath} غير موجود؛ استخدام إعداد التحديث العام المضمّن`)
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'contashepo-create',
    repo: 'tahakam-releases',
    releaseType: 'release',
  })
}

let updateCheckTimer: NodeJS.Timeout | null = null
let updateCheckTimerIsRetry = false
let updateCheckInFlight = false
let updateCheckFailedDuringFlight = false
let updateDownloadInProgress = false
let updateCheckRetryAttempt = 0

function clearUpdateCheckTimer(): void {
  if (updateCheckTimer) clearTimeout(updateCheckTimer)
  updateCheckTimer = null
  updateCheckTimerIsRetry = false
}

function scheduleUpdateCheck(autoUpdater: typeof import('electron-updater').autoUpdater, delayMs: number, isRetry = false): void {
  clearUpdateCheckTimer()
  if (!app.isPackaged || shuttingDown || updateLaunchInProgress || updateDownloadInProgress || downloadedUpdateVersion) return
  updateCheckTimerIsRetry = isRetry
  updateCheckTimer = setTimeout(() => {
    updateCheckTimer = null
    updateCheckTimerIsRetry = false
    checkUpdatesQuietly(autoUpdater)
  }, delayMs)
  updateCheckTimer.unref()
}

function scheduleUpdateRetry(autoUpdater: typeof import('electron-updater').autoUpdater): void {
  if (downloadedUpdateVersion || shuttingDown || updateLaunchInProgress || (updateCheckTimer && updateCheckTimerIsRetry)) return
  const delayMs = updateCheckRetryDelay(updateCheckRetryAttempt)
  updateCheckRetryAttempt += 1
  logLine('updater', `ستُعاد محاولة فحص التحديث تلقائياً بعد ${Math.round(delayMs / 1000)} ثانية`)
  scheduleUpdateCheck(autoUpdater, delayMs, true)
}

function checkUpdatesQuietly(autoUpdater: typeof import('electron-updater').autoUpdater): void {
  if (!app.isPackaged || updateDownloadInProgress || downloadedUpdateVersion || shuttingDown || updateLaunchInProgress) return
  if (updateCheckInFlight) {
    scheduleUpdateRetry(autoUpdater)
    return
  }
  clearUpdateCheckTimer()
  updateCheckInFlight = true
  updateCheckFailedDuringFlight = false
  observeUpdateCheck(
    () => autoUpdater.checkForUpdates(),
    (error) => {
      updateCheckInFlight = false
      updateCheckFailedDuringFlight = false
      updateDownloadInProgress = false
      reportUpdaterError(error)
      scheduleUpdateRetry(autoUpdater)
    },
    () => {
      updateCheckInFlight = false
      if (updateCheckFailedDuringFlight) {
        updateCheckFailedDuringFlight = false
        scheduleUpdateRetry(autoUpdater)
        return
      }
      updateCheckRetryAttempt = 0
      if (!updateDownloadInProgress && !downloadedUpdateVersion) scheduleUpdateCheck(autoUpdater, UPDATE_CHECK_INTERVAL_MS)
    },
  )
}

/** فحص يدوي من زر «فحص التحديثات»: يبدأ الفحص فوراً بلا انتظار الفحص الدوري.
    لا يغيّر مسار التنزيل الخلفي ولا التثبيت الصامت عند الإغلاق — نفس المحرك (electron-updater). */
function checkUpdatesManually(autoUpdater: typeof import('electron-updater').autoUpdater): UpdaterState {
  if (!app.isPackaged) return updaterState
  const decision = decideManualCheck({
    packaged: app.isPackaged,
    inFlight: updateCheckInFlight,
    downloading: updateDownloadInProgress,
    downloaded: downloadedUpdateVersion !== null,
  })
  if (decision.kind === 'downloaded') {
    recordUpdaterState({ status: 'downloaded', version: downloadedUpdateVersion! })
    return updaterState
  }
  if (decision.kind === 'downloading') {
    recordUpdaterState({ status: 'downloading', percent: updateDownloadPercent })
    return updaterState
  }
  if (decision.kind === 'in_flight') return updaterState
  if (decision.kind === 'unavailable') return updaterState
  // فحص جديد: نوقف المؤقّت الدوري المجدول كي لا يتكرر فحصان، ونعيد جدولته بعد انتهائه.
  clearUpdateCheckTimer()
  updateCheckInFlight = true
  updateCheckFailedDuringFlight = false
  recordUpdaterState({ status: 'checking' })
  observeUpdateCheck(
    () => autoUpdater.checkForUpdates(),
    (error) => {
      updateCheckInFlight = false
      updateCheckFailedDuringFlight = false
      updateDownloadInProgress = false
      reportUpdaterError(error)
      scheduleUpdateRetry(autoUpdater)
    },
    () => {
      updateCheckInFlight = false
      if (updateCheckFailedDuringFlight) {
        updateCheckFailedDuringFlight = false
        scheduleUpdateRetry(autoUpdater)
        return
      }
      updateCheckRetryAttempt = 0
      if (!updateDownloadInProgress && !downloadedUpdateVersion) scheduleUpdateCheck(autoUpdater, UPDATE_CHECK_INTERVAL_MS)
    },
  )
  return updaterState
}

function wireUpdater(): void {
  if (!app.isPackaged) {
    recordUpdaterState({ status: 'not-available', version: app.getVersion() })
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    // نُدير الإغلاق والحفظ يدوياً ثم نطلق المثبّت الصامت؛ لا نكرر معالج quit.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.autoRunAppAfterInstall = true
    if (process.platform === 'win32') (autoUpdater as import('electron-updater').NsisUpdater).installDirectory = installationDir()
    ensureUpdaterFeed(autoUpdater)
    autoUpdater.on('checking-for-update', () => recordUpdaterState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => {
      updateDownloadInProgress = true
      clearUpdateCheckTimer()
      recordUpdaterState({ status: 'available', version: info.version })
    })
    autoUpdater.on('update-not-available', (info) => {
      updateDownloadInProgress = false
      recordUpdaterState({ status: 'not-available', version: info.version })
    })
    autoUpdater.on('download-progress', (progress) => {
      updateDownloadInProgress = true
      recordUpdaterState({ status: 'downloading', percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      updateDownloadInProgress = false
      clearUpdateCheckTimer()
      updateCheckRetryAttempt = 0
      downloadedInstallerPath = info.downloadedFile
      recordUpdaterState({ status: 'downloaded', version: info.version })
    })
    autoUpdater.on('error', (error) => {
      reportUpdaterError(error)
      if (updateCheckInFlight) updateCheckFailedDuringFlight = true
      if (!downloadedUpdateVersion) {
        updateDownloadInProgress = false
        scheduleUpdateRetry(autoUpdater)
      }
    })
    checkUpdatesQuietly(autoUpdater)
  } catch (error) {
    reportUpdaterError(error)
  }
}

/* ── النسخ الدوّارة (طلب المالك): ساعي 24 فقط = يوم واحد ──
   v1.0.22: تُكتب دائماً في المكان الافتراضي (%APPDATA%) حتى لو كانت القاعدة الحيّة
   في مكان مخصص، وتُمرَّر القاعدة صراحة (كان before-quit يُصفّر database ثم يستدعي
   الدالة فتخرج فوراً بلا نسخة — الآن تُمرَّر القاعدة المغلقة للنسخ). */
let backupTimer: NodeJS.Timeout | null = null

function pruneGeneration(kind: RotationKind): void {
  const dir = join(app.getPath('userData'), 'backups', kind)
  if (!existsSync(dir)) return
  const files = readdirSync(dir).filter((file) => file.endsWith('.db')).map((file) => ({
    path: join(dir, file), mtimeMs: statSync(join(dir, file)).mtimeMs,
  }))
  const currentFiles = freshStartEligibleFilesAt(userDataDir(), files)
  for (const file of filesToPrune(currentFiles, ROTATION[kind].keep)) {
    try {
      unlinkSync(file.path)
    } catch {
      /* ملف مشغول — يُترك للجولة القادمة */
    }
  }
}

async function rotateBackups(target: ShopsysDatabase | null = database): Promise<void> {
  if (!target) return
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const kind of Object.keys(ROTATION) as RotationKind[]) {
    const dest = join(app.getPath('userData'), 'backups', kind, `${kind}-${stamp}.db`)
    const lastKey = `backup_last_${kind}`
    try {
      /* داخل try: فشل المجلد (قرص ممتلئ/صلاحيات) لا يُسقط الإقلاع (بلاغ: فجوات الإقلاع) */
      mkdirSync(join(app.getPath('userData'), 'backups', kind), { recursive: true })
      const last = target.getMeta(lastKey)
      const lastMs = last ? Date.parse(last) : 0
      if (Date.now() - lastMs < ROTATION[kind].ms) continue
      await target.raw.backup(dest)
      target.setMeta(lastKey, new Date().toISOString())
      pruneGeneration(kind)
    } catch (error) {
      logLine('backup', `تعذّرت النسخة ${kind}: ${(error as Error).message}`)
    }
  }
}

/** v1.0.22: نسخة قبل التحديث — مستقلة عن الجداول الزمنية، تُؤخذ فور اكتمال تنزيل التحديث */
let preUpdateBackup: Promise<string | null> | null = null

async function backupBeforeUpdate(version: string): Promise<string | null> {
  if (!database) return null
  const dir = join(app.getPath('userData'), 'backups', 'pre-update')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dir, `pre-update-${version}-${stamp}.db`)
  await database.raw.backup(dest)
  const files = readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => ({
    path: join(dir, f), mtimeMs: statSync(join(dir, f)).mtimeMs,
  }))
  const currentFiles = freshStartEligibleFilesAt(userDataDir(), files)
  for (const old of filesToPrune(currentFiles, PRE_UPDATE_KEEP)) {
    try { unlinkSync(old.path) } catch { /* مشغول — الجولة القادمة */ }
  }
  logLine('backup', `نسخة قبل التحديث إلى ${version}: ${dest}`)
  return dest
}

/* ── IPC ── */
/* ── بند 5 (طلب المالك): قناة الدعم عبر العملية الرئيسية ─────────────────────
   نسخة سطح المكتب تعمل من file:// ⇒ المتصفح يرسل Origin: null ⇒ يرفضه العامل
   (403) فيظهر للمستخدم «تعذّر الإرسال — تأكد من اتصال الإنترنت» بلا سبب.
   الطلب من العملية الرئيسية يذهب **بلا Origin** (سياسة المصدر حماية متصفح،
   والحماية الحقيقية هنا هي اعتماد HMAC + TOFU). والمضيفون مسموحون بقائمة
   صريحة (لا جلب عشوائي من العملية الرئيسية). */
const SUPPORT_ALLOWED_HOSTS = new Set([
  'shopsys-control.contashepo.workers.dev',
  'shopsys-control.mobileshop2026.workers.dev',
])
const SUPPORT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

function supportTokenPath(): string {
  return join(app.getPath('userData'), 'support-token.json')
}

/* ── بند 2 (طلب المالك): هوية الجهاز خارج القاعدة ───────────────────────────
   كان معرّف الجهاز يعيش في مرساة localStorage وداخل القاعدة نفسها؛ فمسح
   القاعدة (أو فقد مرساة Chromium) كان يُنشئ معرّفاً جديداً ⇒ يخرج العميل من
   لوحة المطوّر «عميلاً جديداً» ويُفقد الترخيص المرتبط بالجهاز.
   الآن: userData/device-identity.json هو المرجع (خارج القاعدة)، ولا يتغيّر
   معرّف ثابت أبداً (الدمج في desktop/deviceIdentity.ts — دالة خالصة). */
function resolveDeviceIdentity(candidate: unknown): { deviceId: string; firstTrialAt: string | null } {
  const path = join(app.getPath('userData'), 'device-identity.json')
  let saved: unknown = null
  try { saved = JSON.parse(readFileSync(path, 'utf8')) } catch { /* أول مرة أو ملف تالف — يُعاد بناؤه */ }
  const merged = mergeDeviceIdentity(saved, candidate)
  let deviceId = merged.identity.deviceId
  if (!deviceId) {
    /* لا مرشّح ولا محفوظ: أول تشغيل ⇒ نولّد معرّفاً (نفس خوارزمية core/license.ts) */
    deviceId = generateDeviceIdFromBytes(randomBytes(12))
    merged.identity.deviceId = deviceId
    merged.changed = true
  }
  if (merged.changed) {
    try {
      writeFileSync(path, JSON.stringify(merged.identity), 'utf8')
    } catch (error) {
      logLine('identity', `تعذّر حفظ هوية الجهاز: ${(error as Error).message}`)
    }
  }
  desktopDeviceId = deviceId
  return { deviceId, firstTrialAt: merged.identity.firstTrialAt }
}

function broadcastLicenseInvalidated(): void {
  const targets = [mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null, ...satelliteWebContents()]
  for (const wc of targets) if (wc && !wc.isDestroyed()) wc.send('license:invalidated')
}

function initializeLicenseAuthority(): void {
  /* لا ننشئ هوية الجهاز هنا: قد تكون مرساة قديمة في localStorage لدى الـ Renderer
     لم تُدمج بعد. الجهاز يُحسم أولاً عبر device:identity ثم يقرأه هذا المرجع. */
  licenseAuthorityInitialLogged = false
  licenseAuthority = createLicenseAuthority({
    readSnapshot: () => {
      if (!database) throw new Error(databaseInitializationFailure ?? 'قاعدة البيانات غير مهيأة بعد')
      const snapshot = database.getSnapshot('shopsys-app')
      return { revision: snapshot.revision, payloadJson: snapshot.payloadJson }
    },
    readDeviceId: () => {
      if (!desktopDeviceId) throw new Error('هوية الجهاز لم تكتمل تهيئتها بعد')
      return desktopDeviceId
    },
  })
}

function wireIpc(): void {
  const db = () => {
    if (!database) throw new Error(databaseInitializationFailure ?? 'قاعدة البيانات غير مهيأة بعد')
    return database
  }
  ipcMain.handle('device:getEncryptionKey', (): Uint8Array | null => deviceEncryptionKey.length === 32 ? new Uint8Array(deviceEncryptionKey) : null)
  ipcMain.handle('license:get-status', async (event) => {
    const senderId = event.sender.id
    const knownWindow = mainWindow?.webContents.id === senderId || satelliteWebContents().some((wc) => wc.id === senderId)
    if (!knownWindow || !isInAppNavigation(event.sender.getURL(), APP_INDEX_FILE_URL, devOrigin)) {
      return { status: 'unverifiable', payload: null, reason: 'مصدر طلب حالة الترخيص غير موثوق', at: new Date().toISOString() }
    }
    if (!licenseAuthority) {
      return { status: 'unverifiable', payload: null, reason: databaseInitializationFailure ?? 'خدمة التحقق المركزية غير جاهزة', at: new Date().toISOString() }
    }
    const result = await licenseAuthority.audit()
    if (!licenseAuthorityInitialLogged) {
      licenseAuthorityInitialLogged = true
      logLine('license-authority', `حالة فحص الترخيص المركزي بعد تهيئة هوية الجهاز: ${result.status.status}`)
    }
    return result.status
  })

  /* بند 10 (تدقيق 2026-10-08): إشعار نظام التشغيل لتنبيهات المطوّر المهمة/العاجلة.
     يُعرض عبر Electron Notification (مركز الإشعارات في ويندوز/ماك) — ويعيد false
     بصمت لو النظام لا يدعمه أو رفضه، فلا يعتمد المُصيّر على نجاحه أبداً.
     الحدود هنا أيضاً (لا نثق بالمُصيّر): طول العنوان والجسم مقصوص. */
  ipcMain.handle('notify:show', (_event, input: { title?: unknown; body?: unknown }): boolean => {
    try {
      const title = String(input?.title ?? '').replace(/[\u0000-\u001F]/g, '').slice(0, 120)
      const body = String(input?.body ?? '').replace(/[\u0000-\u001F]/g, '').slice(0, 300)
      if (!title && !body) return false
      if (!Notification.isSupported()) return false
      const notice = new Notification({ title: title || 'تَحَكَّم', body, silent: false })
      notice.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
      notice.show()
      logLine('notify', `عُرض إشعار نظام: ${title}`)
      return true
    } catch (err) {
      logLine('notify', `فشل إشعار النظام: ${(err as Error).message}`)
      return false
    }
  })
  ipcMain.handle('invoice-commit:acquire', async (event): Promise<string | null> => {
    if (!isAuthorizedWebContents(event.sender.id) || event.sender.isDestroyed()) return null
    const previous = invoiceCommitQueue
    let unlock!: () => void
    invoiceCommitQueue = new Promise<void>((resolve) => { unlock = resolve })
    await previous
    if (event.sender.isDestroyed() || !isAuthorizedWebContents(event.sender.id)) { unlock(); return null }
    const token = randomBytes(24).toString('hex')
    const onDestroyed = () => releaseInvoiceCommitLock(token)
    invoiceCommitLocks.set(token, { senderId: event.sender.id, unlock, onDestroyed, sender: event.sender })
    event.sender.once('destroyed', onDestroyed)
    return token
  })
  ipcMain.on('invoice-commit:release', (event, token: unknown) => {
    if (typeof token !== 'string') return
    if (invoiceCommitLocks.get(token)?.senderId === event.sender.id) releaseInvoiceCommitLock(token)
  })

  ipcMain.handle('session:authorize', (event, input: { userId?: unknown; pin?: unknown }) => {
    const now = Date.now()
    const attempt = authAttempts.get(event.sender.id)
    if (attempt && attempt.lockedUntil > now) return { ok: false, error: 'محاولات كثيرة؛ انتظر قليلاً ثم أعد المحاولة.' }
    const { payload, state } = readDesktopAuthState()
    if (!payload || !hasConfiguredDesktopAuth(state)) {
      // يمنع تجاوز حالة مخزن تالف/مشفّر مجهول: لا نمنح جلسة إلا عند لقطة فارغة فعلاً.
      if (payload && !state) return { ok: false, error: 'تعذّرت قراءة إعداد المصادقة من قاعدة البيانات.' }
      authorizedWebContents.add(event.sender.id)
      authAttempts.delete(event.sender.id)
      return { ok: true }
    }
    const allowed = authorizeDesktopIdentity(state, input?.userId, input?.pin)
    if (allowed) {
      authorizedWebContents.add(event.sender.id)
      authAttempts.delete(event.sender.id)
      return { ok: true }
    }
    const active = attempt && now - attempt.windowStartedAt < 10 * 60_000
      ? attempt : { count: 0, windowStartedAt: now, lockedUntil: 0 }
    active.count += 1
    if (active.count >= 5) active.lockedUntil = now + 15 * 60_000
    authAttempts.set(event.sender.id, active)
    return { ok: false, error: active.lockedUntil > now ? 'محاولات كثيرة؛ تم إيقاف الدخول مؤقتاً.' : 'بيانات الدخول غير صحيحة.' }
  })
  ipcMain.on('session:revoke', (event) => {
    if (!isAuthorizedWebContents(event.sender.id)) return
    authorizedWebContents.clear()
    authAttempts.clear()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('session:revoked')
    }
  })

  ipcMain.handle('database:getSnapshot', (_event, storeName: string): SnapshotDto => db().getSnapshot(storeName))
  ipcMain.handle('database:saveSnapshot', (event, input: SaveSnapshotInput) => {
    const result = db().saveSnapshot(input)
    /* مزامنة النوافذ الحرة: بقية النوافذ تطبّق أحدث لقطة فور حفظها */
    if (!result.replayed) broadcastSnapshotChanged(event.sender.id, input.storeName, result.revision)
    if (input.storeName === 'shopsys-app' && licenseAuthority) {
      /* كل لقطة إعدادات تُعيد ترطيب Zustand في النوافذ الأخرى؛ ذلك يعلّم audit
         بـ checking حتى لو لم يتغير المفتاح. نرسل الإبطال دائماً، بينما يضمن مخبأ
         Main أن التوقيع لا يُعاد إلا عند تغيّر المفتاح/الجهاز/قائمة الإبطال. */
      void licenseAuthority.audit().then(() => broadcastLicenseInvalidated()).catch((error: unknown) => {
        logLine('license-authority', `فشل تحديث حالة الترخيص بعد حفظ الإعدادات: ${error instanceof Error ? error.message : String(error)}`)
        broadcastLicenseInvalidated()
      })
    }
    return result
  })
  ipcMain.handle('database:deleteSnapshot', (event, input: DeleteSnapshotInput) => {
    const result = db().deleteSnapshot(input)
    broadcastSnapshotChanged(event.sender.id, input.storeName, result.revision)
    return result
  })
  ipcMain.handle('database:enqueueOutbox', (_event, input: EnqueueOutboxInput) => db().enqueueOutbox(input))
  ipcMain.handle('database:claimOutbox', (_event, input?: ClaimOutboxInput): OutboxEventDto[] => db().claimOutbox(input))
  ipcMain.handle('database:completeOutbox', (_event, input: CompleteOutboxInput) => db().completeOutbox(input))
  ipcMain.handle('database:integrityCheck', () => db().integrityCheck())
  ipcMain.handle('database:schemaVersion', () => db().schemaVersion())

  ipcMain.handle('print:print', async (_event, html: string, silent: boolean, printerName?: string) => {
    await printHtml(html, silent, printerName)
  })
  ipcMain.handle('print:printers', () => listPrinters())

  /* v1.0.13 — إرسال مستند PDF عبر واتساب: توليد + حفظ + حافظة + فتح المحادثة */
  ipcMain.handle('pdf:export-share', (_event, html: string, fileName: string, waLink?: string) =>
    exportPdfShare(html, fileName, waLink))

  /* §102 — مضيف شبكة المحل: خادم ws في هذه العملية، منطق المضيف في المُصيّر */
  initLanHostIpc(() => mainWindow)

  /* نوافذ الأقمار الحرة (قرار المالك 2026-10-22): كل قسم ومستند ومنتقٍ نافذة
     نظام مستقلة خارج إطار الرئيسية — المدير كاملاً في satelliteWindows.ts */
  initSatelliteWindows({
    getMainWindow: () => mainWindow,
    isDev,
    devStartUrl: isDev ? process.env.ELECTRON_START_URL! : null,
    indexFilePath: join(__dirname, '../dist/index.html'),
    appIndexFileUrl: APP_INDEX_FILE_URL,
    devOrigin,
    preloadPath: join(__dirname, 'preload.cjs'),
    iconPath: join(__dirname, '../dist/app-icon.png'),
    log: logLine,
    isSenderAuthorized: isAuthorizedWebContents,
    authorizeSatellite: (id) => { authorizedWebContents.add(id) },
    forgetSatellite: (id) => { authorizedWebContents.delete(id); authAttempts.delete(id) },
  })

  /* واجهة التحديث اليدوية (نسخة سطح المكتب): زر «فحص التحديثات» + شريط التنزيل.
     الفحص الدوري الخلفي والتثبيت الصامت عند الإغلاق يبقيان كما هما بلا تغيير. */
  ipcMain.handle('updater:state', () => updaterState)
  ipcMain.handle('updater:check', () => {
    if (!app.isPackaged) return updaterState
    try {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      return checkUpdatesManually(autoUpdater)
    } catch (error) {
      reportUpdaterError(error)
      return updaterState
    }
  })
  ipcMain.handle('updater:install', async () => {
    if (!app.isPackaged) return
    if (!downloadedUpdateVersion) throw new Error('لم يكتمل تنزيل التحديث بعد')
    // نفس مسار الإغلاق الصامت بالضبط: حفظ الواجهة ثم حماية القاعدة ونسخها ثم التثبيت.
    await shutdownApplication(true)
  })

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    electron: process.versions.electron,
    packaged: app.isPackaged,
  }))
  ipcMain.handle('app:backupNow', async () => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة')
    // v1.0.8: النسخة اليدوية في المكانين معاً (بجوار القاعدة + المكان الثاني)
    const written = await backupDatabaseFile('manual', database, resolveDbPath().dbPath)
    if (!written.length) throw new Error('تعذّرت النسخة الاحتياطية — راجع صلاحيات المجلدات')
    return written
  })

  /* v1.0.22: تنزيل نسخة كاملة من القاعدة (SQLite .db) بحوار حفظ — بصيغة قابلة للفتح بأي أداة SQLite */
  ipcMain.handle('database:exportCopy', async () => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة')
    const stamp = new Date().toISOString().slice(0, 10)
    const options = {
      title: 'حفظ نسخة كاملة من قاعدة البيانات',
      defaultPath: join(app.getPath('documents'), `tahakom-${stamp}.db`),
      filters: [{ name: 'قاعدة SQLite', extensions: ['db'] }],
    }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const }
    await database.raw.backup(result.filePath)
    logLine('export', `نسخة كاملة للتنزيل: ${result.filePath}`)
    return { ok: true as const, path: result.filePath }
  })

  /* v1.0.22 — مفتاح الاسترداد: ملف المفتاح مغلّف بكلمة مرور العميل (انظر desktop/keyRecovery.ts).
     التصدير لا يكشف المفتاح الخام أبداً؛ الاستيراد يحتفظ بالنسخة الحالية ثم يعيد التشغيل. */
  ipcMain.handle('keyRecovery:status', () => ({ exportedAt: readKeyRecoveryExportedAt() }))

  /* إعادة محاولة حقيقية: عند فشل فحص المفتاح لم تُفتح قاعدة الكتابة، لذا يلزم
     إعادة العملية الرئيسية بعد توصيل القرص/استعادة profile؛ إعادة تحميل React وحدها لا تكفي. */
  ipcMain.handle('keyRecovery:retry-startup', () => {
    if (!databaseInitializationFailure || database || recoveryRestartScheduled) return false
    recoveryRestartScheduled = true
    logLine('db-recovery', 'طلب المستخدم إعادة محاولة الإقلاع من شاشة استرداد البيانات')
    setTimeout(() => { app.relaunch(); app.exit(0) }, 250)
    return true
  })

  /* بدء نظيف اختياري لمختبر بلا بيانات عمل: أرشفة القاعدة القديمة أولاً،
     ثم التحويل إلى قاعدة فارغة. لا يمسح المفتاح أو هوية الجهاز/التجربة. */
  ipcMain.handle('keyRecovery:start-fresh', async (event) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false as const, reason: 'طلب غير موثوق' }
    if (!databaseInitializationFailure || !databaseInitializationFailureDbPath || database || recoveryRestartScheduled) {
      return { ok: false as const, reason: 'لا توجد حالة استرداد تسمح ببدء قاعدة جديدة' }
    }
    recoveryRestartScheduled = true
    try {
      const confirmation = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'بدء قاعدة جديدة — للجهاز التجريبي',
        message: 'هل تريد بدء قاعدة أعمال فارغة؟',
        detail: 'سيُحفظ ملف القاعدة الحالي كما هو داخل أرشيف تَحَكَّم، ولن تُحذف النسخ السابقة. إذا احتوى الملف لقطات enc:v1 فالأرشيف وحده لا يفكّها دون المفتاح الأصلي. بعد ذلك سيبدأ معالج الإعداد من جديد، ولن تُستعاد النسخ القديمة تلقائياً. هذا يمسح بيانات العمل الظاهرة في التطبيق؛ لا تستخدمه على جهاز عميل به بيانات حقيقية. لا يعيد هذا الخيار ضبط هوية الجهاز أو مدة التجربة/الترخيص.',
        buttons: ['إلغاء', 'بدء جديد مع حفظ الأرشيف'],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirmation.response !== 1) {
        recoveryRestartScheduled = false
        return { ok: false as const, canceled: true as const }
      }
      const result = await startFreshDatabaseAt({
        userData: userDataDir(),
        databasePath: databaseInitializationFailureDbPath,
        installDir: installationDir(),
        excludedPaths: knownOldDatabasePaths(databaseInitializationFailureDbPath),
      })
      logLine('db-recovery', `اختار المستخدم بدءاً نظيفاً؛ أُرشف ملف القاعدة في ${result.archivePath}، بدأ=${result.startedAt}`)
      setTimeout(() => { app.relaunch(); app.exit(0) }, 300)
      return { ok: true as const, archivePath: result.archivePath, relaunching: true as const }
    } catch (error) {
      recoveryRestartScheduled = false
      const reason = (error as Error).message
      logLine('db-recovery', `تعذّر بدء قاعدة جديدة بأمان: ${reason}`)
      return { ok: false as const, reason }
    }
  })

  ipcMain.handle('keyRecovery:export', async (_event, args: { passphrase?: unknown; deviceId?: unknown }) => {
    const passphrase = typeof args?.passphrase === 'string' ? args.passphrase : ''
    const deviceId = typeof args?.deviceId === 'string' ? args.deviceId : 'unknown'
    const problem = validateRecoveryPassphrase(passphrase)
    if (problem) return { ok: false as const, reason: problem }
    if (deviceEncryptionKey.length !== 32) return { ok: false as const, reason: 'مفتاح الجهاز غير مهيأ' }
    const options = {
      title: 'حفظ مفتاح الاسترداد — اختر مكاناً آمناً',
      defaultPath: join(app.getPath('documents'), keyRecoveryFileName()),
      filters: [{ name: 'مفتاح استرداد تَحَكَّم', extensions: ['tkey'] }],
    }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const }
    writeFileSync(result.filePath, wrapDeviceKey(deviceEncryptionKey, passphrase, deviceId), { mode: 0o600 })
    writeFileSync(keyRecoveryStatePath(), JSON.stringify({ exportedAt: new Date().toISOString(), deviceId }), 'utf8')
    logLine('key-recovery', `صُدّر مفتاح الاسترداد إلى ${result.filePath}`)
    return { ok: true as const, path: result.filePath }
  })

  ipcMain.handle('keyRecovery:import', async (_event, args: { passphrase?: unknown }) => {
    const passphrase = typeof args?.passphrase === 'string' ? args.passphrase : ''
    if (!passphrase.trim()) return { ok: false as const, reason: 'أدخل كلمة مرور ملف الاسترداد' }
    const options = {
      title: 'اختيار ملف مفتاح الاسترداد',
      properties: ['openFile' as const],
      filters: [{ name: 'مفتاح استرداد تَحَكَّم', extensions: ['tkey', 'json'] }],
    }
    const picked = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false as const, canceled: true as const }
    let recovered: ReturnType<typeof unwrapDeviceKey>
    try {
      /* حد الحجم قبل القراءة: ملف الاسترداد الصحيح صغير جداً */
      if (statSync(picked.filePaths[0]).size > KEY_RECOVERY_MAX_FILE_BYTES) throw new Error('ملف الاسترداد أكبر من المسموح — ليس ملف مفتاح تَحَكَّم')
      recovered = unwrapDeviceKey(readFileSync(picked.filePaths[0], 'utf8'), passphrase)
    } catch (error) {
      return { ok: false as const, reason: (error as Error).message }
    }
    const stored = storeRecoveredDeviceKey(buildDeviceKeyIo(), recovered.key)
    if (!stored.ok) return { ok: false as const, reason: stored.reason }
    logLine('key-recovery', `استيراد مفتاح الاسترداد من ${picked.filePaths[0]}${stored.keptCopy ? ` — النسخة السابقة ${stored.keptCopy}` : ''}`)
    /* إعادة تشغيل كاملة ليُفتح الجهاز بالمفتاح الجديد من الإقلاع (لا حالة متبقية في الذاكرة) */
    setTimeout(() => { app.relaunch(); app.exit(0) }, 300)
    return { ok: true as const, deviceId: recovered.deviceId, relaunching: true as const }
  })

  /* v1.0.8 (طلب المالك): مرساة التجربة خارج القاعدة — مسح بيانات التطبيق من
     الواجهة أو حذف القاعدة لا يعيد الفترة التجريبية. تُحفظ أول بداية تجربة
     في ملف مستقل ويعاد الأقدم بينها وبين ما يرسله التطبيق. */
  /* ح5 (مراجعة ③): الدمج في دالة خالصة (desktop/trialAnchor.ts) — لا تُقبل قيمة تالفة،
     وآخر ظهور يُحفظ هنا أيضاً فلا يكفي تعديل التخزين المحلي لإعادة الساعة. */
  ipcMain.handle('trial:anchor', (_event, args: { firstTrialAt?: unknown; lastSeenAt?: unknown }) => {
    const anchorPath = join(app.getPath('userData'), 'trial-anchor.json')
    let saved: unknown = null
    try { saved = JSON.parse(readFileSync(anchorPath, 'utf8')) } catch { /* أول مرة أو ملف تالف — يُعاد بناؤه من القيم الصالحة */ }
    const merged = mergeTrialAnchor(saved, args)
    if (merged.changed) writeFileSync(anchorPath, JSON.stringify(merged.anchor), 'utf8')
    return merged.anchor
  })

  /* بند 2 (طلب المالك): هوية الجهاز — مزامنة (sendSync) لأن الإقلاع يحتاجها
     قبل أي فحص ترخيص؛ العملية الرئيسية هي المرجع (ملف خارج القاعدة). */
  ipcMain.on('device:identity', (event, candidate: unknown) => {
    event.returnValue = resolveDeviceIdentity(candidate)
  })

  /* بند 5 (طلب المالك): طلب دعم — من العملية_main (بلا Origin) + قائمة مضيفين */
  ipcMain.handle('support:request', async (_event, args: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }) => {
    const rawUrl = typeof args?.url === 'string' ? args.url : ''
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { return { ok: false, status: 0, body: '', error: 'invalid-url' } }
    if (parsed.protocol !== 'https:' || !SUPPORT_ALLOWED_HOSTS.has(parsed.hostname)) {
      return { ok: false, status: 0, body: '', error: 'host-not-allowed' }
    }
    const method = args?.method === 'POST' ? 'POST' : 'GET'
    const headers: Record<string, string> = {}
    if (args?.headers && typeof args.headers === 'object') {
      for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
        if (typeof value === 'string') headers[key] = value
      }
    }
    const body = typeof args?.body === 'string' ? args.body : undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await fetch(parsed.toString(), { method, headers, body, signal: controller.signal })
      const text = await res.text()
      return { ok: res.ok, status: res.status, body: text.slice(0, 400_000) }
    } catch (error) {
      return { ok: false, status: 0, body: '', error: (error as Error).message }
    } finally {
      clearTimeout(timer)
    }
  })

  /* بند 5: اعتماد قناة الدعم خارج القاعدة (يبقى ثابتاً بعد مسحها ⇒ لا رفض 401) */
  ipcMain.handle('support:tokenGet', () => {
    try {
      const parsed = JSON.parse(readFileSync(supportTokenPath(), 'utf8')) as { token?: unknown }
      const token = typeof parsed?.token === 'string' ? parsed.token : ''
      return SUPPORT_TOKEN_RE.test(token) ? token : null
    } catch { return null }
  })

  ipcMain.handle('support:tokenSet', (_event, token: unknown) => {
    const value = typeof token === 'string' ? token : ''
    if (!SUPPORT_TOKEN_RE.test(value)) return false
    try {
      writeFileSync(supportTokenPath(), JSON.stringify({ token: value }), { encoding: 'utf8', mode: 0o600 })
      return true
    } catch (error) {
      logLine('support', `تعذّر حفظ اعتماد الدعم: ${(error as Error).message}`)
      return false
    }
  })

  /* ── v1.0.8: إدارة مكان القاعدة والنسخ (طلب المالك) ── */
  ipcMain.handle('database:getStorageInfo', () => {
    const { dbPath, isCustom } = resolveDbPath()
    const secondary = resolveSecondaryBackupDir()
    return {
      dbPath,
      defaultDbPath: join(app.getPath('userData'), 'shopsys.db'),
      isCustom,
      secondaryBackupDir: secondary.dir,
      secondaryIsDefault: secondary.isDefault,
      lastFileBackupAt: readDbLocation().lastFileBackupAt,
    }
  })

  /* v1.0.9: إشعار استرداد القاعدة — يُقرأ مرة واحدة من الواجهة عند الإقلاع */
  ipcMain.handle('database:recoveryNotice', () => {
    const markerPath = join(app.getPath('userData'), RECOVERY_MARKER)
    try {
      const data = JSON.parse(readFileSync(markerPath, 'utf8')) as { at: string; from: string | null }
      unlinkSync(markerPath)
      return data
    } catch { return null }
  })

  /* v1.0.9: استعادة نسخة قاعدة ملفية من داخل التطبيق (المكانان، يدوية وتلقائية) */
  ipcMain.handle('database:listFileBackups', () => {
    const { dbPath } = resolveDbPath()
    const dirs = [
      { dir: join(dirname(dbPath), 'backups', 'manual'), where: 'بجوار القاعدة' },
      { dir: join(dirname(dbPath), 'backups', 'auto'), where: 'بجوار القاعدة' },
      { dir: join(resolveSecondaryBackupDir().dir, 'manual'), where: 'المكان الثاني' },
      { dir: join(resolveSecondaryBackupDir().dir, 'auto'), where: 'المكان الثاني' },
    ]
    const out: { path: string; where: string; kind: string; size: number; at: string }[] = []
    for (const { dir, where } of dirs) {
      try {
        for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
          const full = join(dir, f)
          if (!isCurrentFreshStartDataAt(userDataDir(), full)) continue
          const st = statSync(full)
          out.push({ path: full, where, kind: f.startsWith('manual') ? 'يدوية' : 'تلقائية', size: st.size, at: new Date(st.mtimeMs).toISOString() })
        }
      } catch { /* لا مجلد */ }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  })

  ipcMain.handle('database:restoreFileBackup', async (_event, args: { path?: string }) => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة')
    const target = typeof args?.path === 'string' ? args.path : ''
    // أمن المسار: الاستعادة من ملفات النسخ المعروفة فقط — لا مسارات خارجية
    if (!candidateBackups(resolveDbPath().dbPath).includes(target)) throw new Error('مسار نسخة غير معروف')
    if (!quickCheck(target)) throw new Error('النسخة المحددة غير سليمة (فشل فحص السلامة) — اختر نسخة أخرى')
    const { dbPath } = resolveDbPath()
    try {
      database.close()
      database = null
      // نسخة أمان من الحالية قبل الاستبدال — الاحتمال المرجوح لا يُفقد بيانات
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(dbPath, `${dbPath}.before-restore-${stamp}`)
      for (const ext of ['-wal', '-shm']) { try { unlinkSync(dbPath + ext) } catch { /* غير موجود */ } }
      copyFileSync(target, dbPath)
      logLine('db-restore', `استعادة نسخة ملفية: ${target} — إعادة تشغيل`)
      setTimeout(() => { app.relaunch(); app.exit(0) }, 600)
      return { ok: true as const, restarting: true as const }
    } catch (error) {
      const message = (error as Error).message
      logLine('db-restore-fatal', `فشل الاستعادة: ${message}`)
      /* مراجعة 2026-10-11: الإغلاق سبق الاستعادة، فإن فشلت بعده تبقى القاعدة مغلقة
         حتى إعادة التشغيل. نعيد فتحها الآن ليعمل البرنامج كما كان قبل المحاولة. */
      if (!database) {
        try { database = await openDatabase() } catch (reopenError) {
          logLine('db-restore-fatal', `تعذّر إعادة فتح القاعدة بعد فشل الاستعادة: ${(reopenError as Error).message}`)
        }
      }
      throw new Error(`فشل الاستعادة: ${message}`)
    }
  })

  ipcMain.handle('database:chooseSecondaryBackupDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'اختر مجلد النسخة الاحتياطية الثانية' })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true as const }
    if (isUnsafeDatabaseLocation(result.filePaths[0], installationDir(), userDataDir())) throw new Error('اختر مكاناً للنسخة الاحتياطية خارج مجلد تثبيت البرنامج')
    const cfg = readDbLocation()
    writeDbLocation({ ...cfg, secondaryBackupDir: result.filePaths[0] })
    mkdirSync(result.filePaths[0], { recursive: true })
    logLine('backup', `المكان الثاني للنسخ: ${result.filePaths[0]}`)
    return { ok: true as const, dir: result.filePaths[0] }
  })

  /** نقل القاعدة لمجلد يختاره المستخدم: إغلاق ← نسخ ← تحديث التوجيه ← إعادة تشغيل.
      الأصل يبقى في مكانه نسخةَ أمان حتى ينجح الإقلاع من المكان الجديد. */
  ipcMain.handle('database:chooseDbLocation', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'اختر مجلد حفظ قاعدة البيانات (خارج قرص C إن أمكن)' })
    if (result.canceled || !result.filePaths[0]) return { ok: false as const, canceled: true as const }
    const dir = result.filePaths[0]
    if (isUnsafeDatabaseLocation(join(dir, 'shopsys.db'), installationDir(), userDataDir())) {
      const error = 'لا يمكن حفظ قاعدة البيانات داخل مجلد التثبيت أو مجلد databases التابع لChromium؛ قد تُحذف محتوياته. اختر مجلداً مستقلاً للبيانات.'
      dialog.showErrorBox('مكان قاعدة البيانات غير آمن', error)
      return { ok: false as const, error }
    }
    const { dbPath } = resolveDbPath()
    const dest = join(dir, 'shopsys.db')
    if (dest === dbPath) return { ok: false as const, canceled: true as const }
    if (existsSync(dest)) {
      const confirm = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: 'يوجد ملف قاعدة بهذا الاسم',
        message: `يوجد ملف shopsys.db في المجلد المختار. سيُستبدل بنسخة قاعدتك الحالية — واصل؟`,
        buttons: ['إلغاء', 'استبدال ونقل'],
        defaultId: 0, cancelId: 0,
      })
      if (confirm.response !== 1) return { ok: false as const, canceled: true as const }
    }
    try {
      if (database) { database.close(); database = null }
      mkdirSync(dir, { recursive: true })
      copyFileSync(dbPath, dest)
      for (const ext of ['-wal', '-shm']) {
        const src = dbPath + ext
        if (existsSync(src)) copyFileSync(src, dest + ext)
      }
      writeDbLocation({ ...readDbLocation(), customDbPath: dest, customDbOpenedAt: null })
      logLine('db-move', `نُقلت القاعدة إلى ${dest} — الأصل باقٍ في ${dbPath} كنسخة أمان`)
      // ردّ الجواب أولاً ثم أعد التشغيل كي يستلمه المُصيّر
      setTimeout(() => { app.relaunch(); app.exit(0) }, 600)
      return { ok: true as const, newPath: dest, restarting: true as const }
    } catch (error) {
      const message = (error as Error).message
      logLine('db-move-fatal', `فشل نقل القاعدة: ${message}`)
      return { ok: false as const, error: message }
    }
  })
}

/* إقرار الحفظ مربوط بالتوكن وبالمُرسل نفسه: لكل نافذة توكن عشوائي خاص بها،
   ولا يُقبل إقراره إلا من WebContents التي استلمته — نافذة أخرى (أو توكن
   مُخمَّن/مسرَّب) لا تستطيع إنهاء حفظ غيرها قبل أوانه */
const flushRequests = new Map<string, { wcId: number; resolve: () => void; reject: (error: Error) => void }>()
ipcMain.handle('persistence:flushed', (event, token: unknown, error: unknown) => {
  const req = typeof token === 'string' ? flushRequests.get(token) : undefined
  if (!req || event.sender.id !== req.wcId) return
  flushRequests.delete(token as string)
  if (typeof error === 'string' && error) req.reject(new Error(error))
  else req.resolve()
})

/** تفريغ طوابير الحفظ في كل نوافذ التطبيق (الرئيسية + الأقمار الحرة) قبل الإغلاق/التحديث */
async function flushRenderer(): Promise<void> {
  const targets: WebContents[] = []
  if (mainWindow && !mainWindow.isDestroyed()) targets.push(mainWindow.webContents)
  targets.push(...satelliteWebContents())
  if (targets.length === 0) throw new Error('تعذّر التأكد من حفظ بيانات الواجهة — لم يبدأ التحديث')
  await withDeadline(Promise.all(targets.map((wc) => new Promise<void>((resolve, reject) => {
    const token = randomBytes(16).toString('hex')
    flushRequests.set(token, { wcId: wc.id, resolve, reject })
    wc.send('persistence:flush', token)
  }))), 15_000, 'تعذّر إتمام حفظ البيانات قبل الإغلاق — أعد المحاولة')
}

let shutdownWork: Promise<void> | null = null
function shutdownApplication(update: boolean): Promise<void> {
  if (shutdownWork) return shutdownWork
  shuttingDown = true
  mainWindow?.setEnabled(false)
  shutdownWork = (async () => {
    const closing = database
    if (!closing) return
    if (update) {
      await installSilentUpdate({
        flush: flushRenderer,
        protect: async () => {
          if (!activeDatabasePath) throw new Error('تعذّر معرفة مسار قاعدة التشغيل')
          // حماية المسار تمت قبل فتح SQLite؛ لا نحرّك المؤشر تحت اتصال حي. نتحقق هنا
          // بعد flush من أن الاتصال الحي ما زال يشير إلى الملف المحمي خارج مجلد التثبيت.
          assertSafeUpdateLocation(userDataDir(), installationDir(), activeDatabasePath)
          try { assertDownloadedInstaller(downloadedInstallerPath) } catch (error) {
            downloadedUpdateVersion = null
            downloadedInstallerPath = null
            recordUpdaterState({ status: 'error', message: (error as Error).message })
            throw error
          }
        },
        backup: async () => {
          if (preUpdateBackup) await withDeadline(preUpdateBackup, 30_000, 'لم تنتهِ نسخة ما قبل التحديث — لم يُثبَّت التحديث')
          // نسخة حديثة بعد تفريغ طوابير الواجهة، لا نسخة وقت التنزيل فقط.
          const backed = await withDeadline(backupBeforeUpdate(downloadedUpdateVersion!), 30_000, 'تجاوزت النسخة قبل التحديث مهلة الانتظار — لم يُثبَّت التحديث')
          if (!backed) throw new Error('تعذّرت النسخة الاحتياطية قبل التحديث — لم يُثبَّت التحديث')
        },
        close: () => { closing.close(); database = null; if (backupTimer) clearInterval(backupTimer) },
        install: async () => {
          const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
          updateLaunchInProgress = true
          try { await requestSilentInstall(autoUpdater) } finally { updateLaunchInProgress = false }
        },
        exit: () => app.exit(0),
      })
    } else {
      await flushRenderer()
      await gracefulShutdown({
        backup: () => rotateBackups(closing),
        closeDb: () => { closing.close(); database = null; if (backupTimer) clearInterval(backupTimer) },
        exit: (code) => app.exit(code), log: logLine, timeoutMs: 8_000,
      })
    }
  })().catch(async (error: unknown) => {
    if (!database && activeDatabasePath) {
      // فشل إطلاق المثبت بعد close: افتح الاتصال مجدداً قبل استئناف طوابير الواجهة.
      database = await openDatabase()
      backupTimer = setInterval(() => { void rotateBackups() }, 60 * 60 * 1000)
      downloadedUpdateVersion = null
      downloadedInstallerPath = null
      preUpdateBackup = null
      recordUpdaterState({ status: 'error', message: `لم يبدأ التحديث: ${(error as Error).message}. أعد تشغيل البرنامج قبل إعادة المحاولة.` })
    }
    // لا تثبيت عند فشل الحفظ/الحماية/النسخة؛ يستأنف المُصيّر العمل.
    shuttingDown = false
    shutdownWork = null
    mainWindow?.setEnabled(true)
    mainWindow?.webContents.send('persistence:resume')
    for (const wc of satelliteWebContents()) wc.send('persistence:resume')
    throw error
  })
  return shutdownWork
}

/* ── دورة الحياة ── */
/** يُضبط عند بدء الإغلاق — يمنع إعادة فتح النافذة أثناء الخروج */
let shuttingDown = false
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  /* بلاغ المالك: المحاولة الثانية لفتح البرنامج كانت لا تفعل شيئاً إذا أُغلقت النافذة.
     الآن: تُعاد النافذة إن كانت مغلقة والقاعدة مفتوحة، وإلا يُركَّز الموجود. */
  app.on('second-instance', () => {
    if (shuttingDown) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else if (database) {
      mainWindow = createMainWindow()
    } else if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.focus()
    }
  })

  /* معالج أخطاء عام: خطأ غير ملتقط لا يُسقط البرنامج بصمت ولا يترك عملية معلّقة.
     الخطأ القاتل يسجَّل ويُعرض، وتُغلق القاعدة، ثم تنتهي العملية بوضوح. */
  process.on('uncaughtException', (error) => {
    logLine('fatal', `خطأ غير ملتقط: ${error.stack ?? error.message}`)
    try {
      dialog.showErrorBox('تَحَكَّم — خطأ غير متوقع', `${error.message}\n\nسُجّل الخطأ في سجل البرنامج، ولم تُحذف أي بيانات.\nأعد تشغيل البرنامج.`)
    } catch { /* لا شيء — السجل كتب بالفعل */ }
    try { database?.close() } catch { /* القاعدة قد تكون في حالة غير صالحة */ }
    database = null
    app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logLine('unhandled', `وعد مرفوض بلا معالج: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`)
  })

  void app.whenReady().then(async () => {
    try {
      await preserveCurrentUserData(currentUserData, stableUserData)
      if (currentUserData !== stableUserData) logLine('userData', `الهوية الثابتة: ${stableUserData} — مجلد التشغيل السابق: ${currentUserData}`)
      logLine('boot', `تَحَكَّم ${app.getVersion()} — electron ${process.versions.electron} — node ${process.versions.node} — userData=${app.getPath('userData')}`)
      showSplash()
      setSplashProgress(15, 'فحص توافق البيانات القديمة…')
      deviceEncryptionKey = loadLegacySnapshotKey()
      setSplashProgress(40, 'فتح قاعدة البيانات…')
      try {
        database = await openDatabase()
      } catch (error) {
        if (!(error instanceof DatabaseKeyMismatchError)) throw error
        databaseInitializationFailure = error.message
        databaseInitializationFailureDbPath = error.dbPath
        logLine('db-key-mismatch', `${error.message} المسار=${error.dbPath} المتاجر=${error.stores.join(',')}`)
        setSplashProgress(75, 'تعذّر التحقق من مفتاح البيانات — افتح شاشة الاسترداد')
      }
      setSplashProgress(75, 'تجهيز الواجهة…')
      if (database) initializeLicenseAuthority()
      wireIpc()
      mainWindow = createMainWindow()
      mainWindow.once('ready-to-show', () => {
        setSplashProgress(100, 'جاهز')
        if (database) writeLastRunVersion()
        closeSplash()
      })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      if (database) {
        wireUpdater()
        await rotateBackups()
        backupTimer = setInterval(() => {
          void rotateBackups()
        }, 60 * 60 * 1000)
      } else {
        recordUpdaterState({ status: 'error', message: 'أُوقف التحديث مؤقتاً حتى استرداد مفتاح البيانات' })
      }
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
      })
    } catch (error) {
      /* إقلاع فاشل: لا عملية معلّقة ولا شاشة بداية عالقة، والبيانات لم تُمسّ */
      closeSplash()
      logLine('boot-fatal', `فشل الإقلاع: ${(error as Error).stack ?? (error as Error).message}`)
      try {
        dialog.showErrorBox('تَحَكَّم — تعذّر بدء البرنامج', `${(error as Error).message}\n\nلم تُحذف أي بيانات. اترك ملفات القاعدة والنسخ كما هي، ثم أعد تشغيل البرنامج.`)
      } catch { /* السجل كتب بالفعل */ }
      try { database?.close() } catch { /* لا شيء */ }
      database = null
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (updateLaunchInProgress) { event.preventDefault(); return }
    if (!database) return
    event.preventDefault()
    if (shuttingDown) return
    void shutdownApplication(!!downloadedUpdateVersion).catch((error) => {
      logLine('shutdown', (error as Error).message)
      dialog.showErrorBox(downloadedUpdateVersion ? 'تَحَكَّم — لم يُثبَّت التحديث' : 'تَحَكَّم — تعذّر حفظ البيانات قبل الإغلاق', (error as Error).message)
    })
  })
}
