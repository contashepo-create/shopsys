/**
 * عملية Electron الرئيسية — تنفيذ «مرحلة القاعدة المحلية» (وثيقة §101):
 *   • القاعدة: userData/shopsys.db عبر better-sqlite3 (WAL) — كاتب واحد
 *   • الجسور: shopsysDesktop.database (عقد المُصيّر القائم) + shopsysPrint
 *     وshopsysPrinters (§102 تعدد الطابعات) + shopsysUpdater
 *   • التحديث: electron-updater من GitHub Releases — فحص عند الإقلاع وزر يدوي
 *   • النسخ الدوّارة: ساعي 24 فقط = يوم واحد (Backup API الساخنة)
 * لا منطق أعمال هنا إطلاقاً — كل البوابات تعمل في المُصيّر كما هي.
 */
import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from 'electron'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ShopsysDatabase, type OutboxEventDto, type SaveSnapshotInput, type SnapshotDto } from './sqlite/storage.ts'
import { describeDeviceKeyOutcome, resolveDeviceKey, storeRecoveredDeviceKey, type DeviceKeyIo } from './deviceKeyStore.ts'
import { keyRecoveryFileName, unwrapDeviceKey, validateRecoveryPassphrase, wrapDeviceKey } from './keyRecovery.ts'
import { mergeTrialAnchor } from './trialAnchor.ts'
import { initLanHostIpc } from './hostServerMain.ts'
import Database from 'better-sqlite3'
import {
  readDbLocationAt, writeDbLocationAt, restoreLocationPointerAt, customDbStatusAt, resolveDbPathAt,
  hasPreviousUseEvidenceAt, shouldAskForExistingDatabase, probeShopsysDatabase, isAbsoluteDbPath,
  type DbLocationConfig,
} from './dbLocation.ts'
import { isInAppNavigation, isExternalOpenable } from './navigationPolicy.ts'
import {
  ROTATION, PRE_UPDATE_KEEP, filesToPrune, newestFirst, bestExistingCandidate, latestBackup,
  type CustomLocationStatus, type ExistingDataCandidate,
  type RotationKind,
} from './storagePolicy.ts'

type ClaimOutboxInput = { now?: string; limit?: number }
type DeleteSnapshotInput = { storeName: string; expectedRevision: number }
type EnqueueOutboxInput = Parameters<ShopsysDatabase['enqueueOutbox']>[0]
type CompleteOutboxInput = Parameters<ShopsysDatabase['completeOutbox']>[0]

/* eslint-disable no-console */

let mainWindow: BrowserWindow | null = null
let database: ShopsysDatabase | null = null
let deviceEncryptionKey: Buffer = Buffer.alloc(0)
let printWindow: BrowserWindow | null = null

const isDev = !!process.env.ELECTRON_START_URL

/* ── سجل تشخيصي ملفي (بلاغ v1.0.0: شاشة بيضاء بلا أثر) — كل حدث مهم يُكتب
      في userData/main.log ليتحقق منه الدعم الفني على جهاز العميل ── */
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
<p>تفاصيل التشخيص محفوظة في ملف السجل:<br><code>${esc(logPath)}</code></p>
<p class="hint">أرسل ملف السجل هذا للدعم الفني وسيتابع فوراً — بياناتك المحلية سليمة ولم تتأثر.</p>
</div></body></html>`
}

function showLoadError(win: BrowserWindow, reason: string): void {
  const logPath = join(app.getPath('userData'), 'main.log')
  logLine('load-error', reason)
  const html = errorPageHtml(reason, logPath)
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => undefined)
  // النافذة مخفية حتى ready-to-show: صفحة الخطأ يجب أن تظهر حتماً
  if (!win.isDestroyed() && !win.isVisible()) win.show()
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

function showSplash(afterUpdateFrom: string | null): void {
  const headline = afterUpdateFrom
    ? `تم تحديث تَحَكَّم من ${afterUpdateFrom} إلى ${app.getVersion()} — جارٍ فتح بياناتك كما هي، لا شيء يُحذف.`
    : 'جارٍ فتح بياناتك…'
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
function readLastRunVersion(): string | null {
  try {
    const value = JSON.parse(readFileSync(lastRunVersionPath(), 'utf8'))
    return typeof value?.version === 'string' ? value.version : null
  } catch {
    return null
  }
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
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return
    showLoadError(win, `فشل تحميل الصفحة (${code}): ${desc} — ${failedUrl}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('renderer-gone', `reason=${details.reason} exitCode=${details.exitCode}`)
    showLoadError(win, `توقف محرك الواجهة (${details.reason} / ${details.exitCode})`)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logLine('renderer-console', `${message} (${sourceId}:${line})`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    logLine('preload-error', `${preloadPath}: ${error}`)
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  if (isDev) void win.loadURL(process.env.ELECTRON_START_URL!)
  else {
    void win.loadFile(join(__dirname, '../dist/index.html')).catch((err: unknown) => {
      showLoadError(win, `loadFile: ${(err as Error).message}`)
    })
  }
  return win
}

/* ── مفتاح تشفير الجهاز (v1.0.7 — تشفير قاعدة البيانات بمفتاح الجهاز) ──
   يولَّد مرة واحدة في userData/device.key (32 بايت عشوائية). لقطات المتاجر
   تُشفَّر بـ AES-GCM في المُصيّر قبل وصولها إلى SQLite عبر IPC، فتُقرأ القاعدة
   على هذا الجهاز فقط — نسخ shopsys.db إلى جهاز آخر يعطي بيانات غير قابلة
   للفك. اللقطات النصية القديمة تُقرأ كما هي وتُرحَّل مشفرة عند أول حفظ. */
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
  /* ث2 (تدقيق 2026-10-08): المفتاح يُخزَّن مشفّراً عبر safeStorage (DPAPI/
     Keychain/libsecret) في device.key.enc، والملف الصريح device.key يُرحَّل
     ثم يُحذف — ولا يُحذف قبل فكّ النسخة المشفّرة والتحقق منها بايت‑ببايت.
     القرار كله في وحدة خالصة (desktop/deviceKeyStore.ts) مختبَرة بلا Electron. */
  const outcome = resolveDeviceKey(buildDeviceKeyIo())
  for (const warning of outcome.warnings) logLine('device-key', `تحذير: ${warning}`)
  logLine('device-key', describeDeviceKeyOutcome(outcome))
  return outcome.key
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
 * v1.0.22 (طلب المالك): لا يُنشأ قاعدة فارغة صامتاً. إذا غابت القاعدة وفيه دليل تشغيل سابق
 * (ولم يجد offerExistingData نسخة صالحة) نطلب من العميل اختيار الملف الموجود، ونحفظ مساره
 * المطلق في المؤشر. التثبيت الجديد بلا دليل لا يرى هذا الحوار.
 */
async function askForExistingDatabaseIfNeeded(): Promise<void> {
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
      logLine('db-recovery', 'بدأ المستخدم قاعدة جديدة باختياره')
      return
    }
    const picked = dialog.showOpenDialogSync({
      title: 'اختر ملف قاعدة البيانات الموجود مسبقاً (shopsys.db)',
      properties: ['openFile'],
      filters: [{ name: 'قاعدة بيانات', extensions: ['db'] }],
    })
    const file = picked?.[0]
    if (!file) continue
    const verdict = isAbsoluteDbPath(file) ? probeShopsysDatabase(file) : 'unreadable'
    if (verdict !== 'ok') {
      const why = verdict === 'not-shopsys' ? 'ليس ملف قاعدة بيانات تَحَكَّم'
        : verdict === 'corrupt' ? 'الملف تالف' : 'تعذّر فتح الملف'
      logLine('db-recovery', `رُفض الملف المختار (${why}): ${file}`)
      dialog.showErrorBox('تَحَكَّم — ملف غير صالح', `${why}:\n${file}\n\nاختر ملف shopsys.db الصحيح.`)
      continue
    }
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
  if (cfg.secondaryBackupDir && existsSync(cfg.secondaryBackupDir)) return { dir: cfg.secondaryBackupDir, isDefault: false }
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
      const files = readdirSync(dir).filter((f) => f.endsWith('.db')).sort()
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
  const dirs = [
    join(dirname(dbPath), 'backups', 'manual'),
    join(dirname(dbPath), 'backups', 'auto'),
    join(resolveSecondaryBackupDir().dir, 'manual'),
    join(resolveSecondaryBackupDir().dir, 'auto'),
    join(ud, 'backups', 'hourly'),
    join(ud, 'backups', 'pre-update'),
  ]
  const out: { path: string; mtimeMs: number }[] = []
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
        const full = join(dir, f)
        out.push({ path: full, mtimeMs: statSync(full).mtimeMs })
      }
    } catch { /* مجلد غير موجود */ }
  }
  return newestFirst(out).map((x) => x.path)
}

/** يُنفَّذ قبل الفتح: القاعدة تالفة ⇐ عزلها + استرداد أحدث نسخة سليمة (أو قاعدة جديدة إن لا نسخة) */
function shieldDamagedDatabase(dbPath: string): void {
  if (!existsSync(dbPath)) return
  const probe = probeDatabase(dbPath)
  if (probe === 'ok') return
  if (probe === 'unreadable') {
    // ليست تلفاً مؤكداً (قفل/صلاحيات) — لا عزل ولا استبدال؛ الفتح العادي يتولى الأمر
    logLine('db-shield', 'تعذّر فحص القاعدة دون دليل تلف (قفل أو صلاحيات) — تُفتح كما هي بلا عزل')
    return
  }
  logLine('db-shield', 'فحص الإقلاع: القاعدة تالفة — بدء الاسترداد التلقائي')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const quarantine = `${dbPath}.corrupt-${stamp}`
  try { renameSync(dbPath, quarantine) } catch { return /* تعذّر العزل — نحاول الفتح كما هو */ }
  // ملفات WAL/SHM التابعة للتالف تُعزل معه (بقاءها قد يفسد النسخة المستردة)
  for (const ext of ['-wal', '-shm']) {
    const side = dbPath + ext
    if (existsSync(side)) { try { renameSync(side, `${quarantine}${ext}`) } catch { try { unlinkSync(side) } catch { /* استمر */ } } }
  }
  let restoredFrom: string | null = null
  for (const candidate of candidateBackups(dbPath)) {
    try {
      if (!quickCheck(candidate)) continue
      copyFileSync(candidate, dbPath)
      restoredFrom = candidate
      break
    } catch { /* النسخة التالية */ }
  }
  try {
    writeFileSync(join(app.getPath('userData'), RECOVERY_MARKER), JSON.stringify({
      at: new Date().toISOString(), from: restoredFrom, quarantine,
    }), 'utf8')
  } catch { /* الإشعار اختياري */ }
  logLine('db-shield', restoredFrom ? `استُردت القاعدة تلقائياً من: ${restoredFrom} (التالف محفوظ: ${quarantine})` : 'لا نسخة سليمة — ستُنشأ قاعدة جديدة فارغة')
}

/* ── القاعدة ── */

/** أحدث نسخة متاحة من أي مكان (للاستعادة إلى مكان جديد) — الافتراضي أولاً ثم الحيّ */
function latestBackupAnywhere(): string | null {
  const ud = app.getPath('userData')
  const dirs = ['hourly', 'pre-update'].map((k) => join(ud, 'backups', k))
  const files: { path: string; mtimeMs: number }[] = []
  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
        const full = join(dir, f)
        files.push({ path: full, mtimeMs: statSync(full).mtimeMs })
      }
    } catch { /* لا مجلد */ }
  }
  const latest = latestBackup(files)
  if (latest) return latest.path
  const fallback = join(ud, 'shopsys.db')
  return existsSync(fallback) ? fallback : null
}

/** الحالة المفقودة: المكان المخصص غير متاح أو ملفه اختفى ⇒ نسأل، ولا نفتح فارغاً */
async function resolveMissingLocation(): Promise<void> {
  for (let guard = 0; guard < 1000; guard += 1) {
    const { status, path } = customDbStatus()
    if (status === 'none' || status === 'ok' || !path) return
    logLine('db-location', `المكان المخصص (${status}): ${path}`)
    const folderMissing = status === 'folder-missing'
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'تَحَكَّم — مكان قاعدة البيانات غير متاح',
      message: folderMissing
        ? `مكان قاعدة البيانات المحفوظ غير متاح الآن:\n${dirname(path)}\n\nغالباً القرص أو الفلاشة غير موصولة، أو تغيّر حرف الدرايف. بياناتك لم تُحذف.`
        : `ملف قاعدة البيانات في المكان المحفوظ غير موجود الآن:\n${path}\n\nلم يُنشأ ملف فارغ مكانه. بياناتك لم تُحذف من النسخ الاحتياطية.`,
      detail: folderMissing
        ? 'وصّل القرص ثم اختر «إعادة المحاولة». أو اختر «اختيار مكان آخر» لاستعادة آخر نسخة احتياطية إلى مكان جديد (قد تفقد التغييرات بعد آخر نسخة ساعية).'
        : 'إن نُقل الملف أو حُذف بالخطأ فأعده إلى مكانه ثم اختر «إعادة المحاولة». أو اختر «اختيار مكان آخر» لاستعادة آخر نسخة احتياطية إلى مكان جديد.',
      buttons: ['إعادة المحاولة', 'اختيار مكان آخر', 'إغلاق البرنامج'],
      defaultId: 0,
      cancelId: 2,
    })
    if (choice === 0) continue
    if (choice === 2) {
      app.exit(0)
      throw new Error('مكان قاعدة البيانات المخصص غير متاح — أُغلق البرنامج بطلب المستخدم')
    }
    const picked = dialog.showOpenDialogSync({ properties: ['openDirectory', 'createDirectory'], title: 'اختر مجلد قاعدة البيانات الجديد' })
    const dir = picked?.[0]
    if (!dir) continue
    const source = latestBackupAnywhere()
    if (!source) {
      dialog.showErrorBox('تَحَكَّم — لا توجد نسخة احتياطية', 'لم نجد أي نسخة احتياطية لاستعادتها. أعد توصيل المكان القديم ثم حاول مرة أخرى.')
      continue
    }
    const dest = join(dir, 'shopsys.db')
    if (existsSync(dest)) {
      dialog.showErrorBox('تَحَكَّم — يوجد ملف بهذا الاسم', `يوجد ملف shopsys.db في المجلد المختار، ولن نستبدله تلقائياً. اختر مجلداً آخر.`)
      continue
    }
    mkdirSync(dir, { recursive: true })
    copyFileSync(source, dest)
    writeDbLocation({ ...readDbLocation(), customDbPath: dest, customDbOpenedAt: null })
    logLine('db-location', `استُعيدت آخر نسخة (${source}) إلى المكان الجديد ${dest}`)
  }
}

/** كل مرشّحات البيانات السابقة: نسخ الاحتياطي في المكان الافتراضي/المستندات + قاعدة حيّة على الأقراص (Tahakom\shopsys.db) */
function discoverExistingData(): ExistingDataCandidate[] {
  const ud = app.getPath('userData')
  const out: ExistingDataCandidate[] = []
  const backupDirs = [
    ...(['hourly', 'pre-update'] as const).map((k) => join(ud, 'backups', k)),
    join(app.getPath('documents'), 'Tahakom-Backups', 'manual'),
    join(app.getPath('documents'), 'Tahakom-Backups', 'auto'),
  ]
  for (const dir of backupDirs) {
    try {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.db'))) {
        const full = join(dir, f)
        out.push({ path: full, mtimeMs: statSync(full).mtimeMs, kind: 'backup', whereAr: full })
      }
    } catch { /* لا مجلد */ }
  }
  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const live = `${letter}:\\Tahakom\\shopsys.db`
      try {
        if (existsSync(live)) out.push({ path: live, mtimeMs: statSync(live).mtimeMs, kind: 'live', whereAr: live })
      } catch { /* درايف غير موصول */ }
    }
  }
  return out
}

/** أول تشغيل بلا مؤشر ولا قاعدة افتراضية: إن وُجدت بيانات سابقة نعرضها ونسأل قبل أي معالج */
async function offerExistingData(): Promise<void> {
  const cfg = readDbLocation()
  if (cfg.customDbPath) return
  if (existsSync(join(app.getPath('userData'), 'shopsys.db'))) return
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
  await resolveMissingLocation()
  await offerExistingData()
  await askForExistingDatabaseIfNeeded()
  const { dbPath, isCustom } = resolveDbPath()
  // v1.0.9: الدرع قبل الفتح — تلف القاعدة لا يوقف التطبيق بل يسترد نسخة
  try { shieldDamagedDatabase(dbPath) } catch (e) { logLine('db-shield', `تخطي الفحص: ${(e as Error).message}`) }
  try {
    const db = await ShopsysDatabase.open(dbPath, { backupsDir: join(dirname(dbPath), 'backups') })
    logLine('db', `قاعدة SQLite جاهزة: ${dbPath}${isCustom ? ' (مكان مخصص)' : ' (افتراضي)'} (مخطط ${db.schemaVersion()})`)
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dialog } = require('electron') as typeof import('electron')
    dialog.showErrorBox('تَحَكَّم — فشل تشغيل القاعدة', `تعذّر فتح قاعدة البيانات:\n${message}\n\nسجل التشخيص:\n${join(app.getPath('userData'), 'main.log')}`)
    app.exit(1)
    throw error
  }
}

/* ── الطباعة (§102): نسخة إلى طابعة مسماة أو الافتراضية، صامتة أو بحوار ── */
async function printHtml(html: string, silent: boolean, printerName?: string): Promise<void> {
  const tmp = join(app.getPath('userData'), 'print-tmp.html')
  writeFileSync(tmp, html, 'utf8')
  if (!printWindow || printWindow.isDestroyed()) {
    printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
  }
  await new Promise<void>((resolve) => {
    printWindow!.webContents.once('did-finish-load', () => resolve())
    void printWindow!.loadFile(tmp)
  })
  await printWindow.webContents.print({ silent, deviceName: printerName || undefined, printBackground: true, margins: { marginType: 'default' } }, () => undefined)
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
async function exportPdfShare(html: string, fileName: string, waLink?: string): Promise<{ ok: boolean; path?: string; copied: boolean; error?: string }> {
  try {
    const dir = join(app.getPath('downloads'), 'Tahakom-PDF')
    mkdirSync(dir, { recursive: true })
    /* أسماء لاتينية آمنة عبر أنظمة الملفات والمشاركة */
    const safeName = (fileName || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `doc-${Date.now()}`
    const outPath = join(dir, `${safeName}.pdf`)
    const tmp = join(app.getPath('userData'), 'pdf-tmp.html')
    writeFileSync(tmp, html, 'utf8')
    if (!printWindow || printWindow.isDestroyed()) {
      printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
    }
    await new Promise<void>((resolve) => {
      printWindow!.webContents.once('did-finish-load', () => resolve())
      void printWindow!.loadFile(tmp)
    })
    /* المقاس والاتجاه من @page داخل قالب المستند نفسه (A4/A5/حراري)؛
       الهوامش بالبوصة — 0.4" ≈ 1سم مثل افتراضي حوار الطباعة */
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
    writeFileSync(outPath, pdf)
    /* Electron 44: لا واجهة حافظة للملفات (writeBuffer أزيل) — الصدق التقني:
       النمط المعتمد فتح المجلد بالملف محدداً ليسحبه المستخدم للمحادثة */
    const copied = false
    shell.showItemInFolder(outPath)
    if (waLink) void shell.openExternal(waLink)
    return { ok: true, path: outPath, copied }
  } catch (error) {
    return { ok: false, copied: false, error: (error as Error).message }
  }
}

/* ── التحديث التلقائي: فحص إقلاعي + يدوي + تثبيت عند الإغلاق ── */
type UpdaterState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

let updaterState: UpdaterState = { status: 'idle' }

function pushUpdaterState(state: UpdaterState): void {
  updaterState = state
  if (state.status === 'error') logLine('updater', `خطأ تحديث: ${state.message}`)
  if (state.status === 'downloaded') {
    logLine('updater', `جاهز للتثبيت عند الإغلاق: ${state.version}`)
    // v1.0.22: نسخة قبل التثبيت تُؤخذ فوراً — أي مسار للتثبيت (إغلاق/زر) يجدها جاهزة
    preUpdateBackup = backupBeforeUpdate(state.version).catch((error) => {
      logLine('backup', `تعذّرت نسخة ما قبل التحديث: ${(error as Error).message}`)
      return null
    })
  }
  mainWindow?.webContents.send('updater:state', state)
}

function wireUpdater(): void {
  if (!app.isPackaged) {
    pushUpdaterState({ status: 'not-available', version: app.getVersion() })
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => pushUpdaterState({ status: 'checking' }))
    autoUpdater.on('update-available', (info) => pushUpdaterState({ status: 'available', version: info.version }))
    autoUpdater.on('update-not-available', (info) => pushUpdaterState({ status: 'not-available', version: info.version }))
    autoUpdater.on('download-progress', (progress) => pushUpdaterState({ status: 'downloading', percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => pushUpdaterState({ status: 'downloaded', version: info.version }))
    autoUpdater.on('error', (error) => pushUpdaterState({ status: 'error', message: error.message }))
    void autoUpdater.checkForUpdatesAndNotify()
  } catch (error) {
    pushUpdaterState({ status: 'error', message: (error as Error).message })
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
  for (const file of filesToPrune(files, ROTATION[kind].keep)) {
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
    const dir = join(app.getPath('userData'), 'backups', kind)
    mkdirSync(dir, { recursive: true })
    const lastKey = `backup_last_${kind}`
    const last = target.getMeta(lastKey)
    const lastMs = last ? Date.parse(last) : 0
    if (Date.now() - lastMs < ROTATION[kind].ms) continue
    const dest = join(dir, `${kind}-${stamp}.db`)
    try {
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
  for (const old of filesToPrune(files, PRE_UPDATE_KEEP)) {
    try { unlinkSync(old.path) } catch { /* مشغول — الجولة القادمة */ }
  }
  logLine('backup', `نسخة قبل التحديث إلى ${version}: ${dest}`)
  return dest
}

/* ── IPC ── */
function wireIpc(): void {
  const db = () => {
    if (!database) throw new Error('قاعدة البيانات غير مهيأة بعد')
    return database
  }
  ipcMain.handle('device:getEncryptionKey', (): Uint8Array => new Uint8Array(deviceEncryptionKey))

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
  ipcMain.handle('database:getSnapshot', (_event, storeName: string): SnapshotDto => db().getSnapshot(storeName))
  ipcMain.handle('database:saveSnapshot', (_event, input: SaveSnapshotInput) => db().saveSnapshot(input))
  ipcMain.handle('database:deleteSnapshot', (_event, input: DeleteSnapshotInput) => db().deleteSnapshot(input))
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

  ipcMain.handle('updater:state', () => updaterState)
  ipcMain.handle('updater:check', () => {
    if (!app.isPackaged) return updaterState
    try {
      const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
      void autoUpdater.checkForUpdates()
    } catch (error) {
      pushUpdaterState({ status: 'error', message: (error as Error).message })
    }
    return updaterState
  })
  ipcMain.handle('updater:install', async () => {
    if (!app.isPackaged) return
    // v1.0.22: ننتظر النسخة قبل التحديث، ثم نثبّت ونعيد التشغيل تلقائياً — يفتح البرنامج
    // ببياناتك كما كانت (لا معالج إعداد). وإن فشلت النسخة نُبلغ ولا نثبّت بلا نسخة.
    const backed = preUpdateBackup ? await preUpdateBackup : null
    if (preUpdateBackup && !backed) throw new Error('تعذّرت النسخة الاحتياطية قبل التحديث — لم يُثبَّت التحديث. راجع صلاحيات المجلد وأعد المحاولة.')
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.quitAndInstall(false, true)
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

  ipcMain.handle('keyRecovery:export', async (_event, args: { passphrase?: unknown; deviceId?: unknown }) => {
    const passphrase = typeof args?.passphrase === 'string' ? args.passphrase : ''
    const deviceId = typeof args?.deviceId === 'string' ? args.deviceId : 'unknown'
    const problem = validateRecoveryPassphrase(passphrase)
    if (problem) return { ok: false as const, reason: problem }
    if (deviceEncryptionKey.length !== 32) return { ok: false as const, reason: 'مفتاح الجهاز غير مهيأ' }
    const options = {
      title: 'حفظ مفتاح الاسترداد — احفظه على USB أو مكان آمن خارج هذا الجهاز',
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
      throw new Error(`فشل الاستعادة: ${message}`)
    }
  })

  ipcMain.handle('database:chooseSecondaryBackupDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: 'اختر مجلد النسخة الاحتياطية الثانية' })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true as const }
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

/* ── دورة الحياة ── */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    logLine('boot', `تَحَكَّم ${app.getVersion()} — electron ${process.versions.electron} — node ${process.versions.node} — userData=${app.getPath('userData')}`)
    const previousVersion = readLastRunVersion()
    showSplash(previousVersion && previousVersion !== app.getVersion() ? previousVersion : null)
    setSplashProgress(15, 'تهيئة مفتاح الجهاز…')
    try {
      deviceEncryptionKey = ensureDeviceEncryptionKey()
    } catch (error) {
      closeSplash()
      logLine('device-key-fatal', (error as Error).message)
      dialog.showErrorBox('تَحَكَّم — تعذّر تهيئة مفتاح الجهاز', `${(error as Error).message}\n\nلم تُفقد أي بيانات. أغلق البرنامج وأعد تشغيله، وإن تكرر الخطأ فتواصل مع الدعم.`)
      app.exit(1)
      return
    }
    setSplashProgress(40, 'فتح قاعدة البيانات…')
    database = await openDatabase()
    setSplashProgress(75, 'تجهيز الواجهة…')
    wireIpc()
    mainWindow = createMainWindow()
    mainWindow.once('ready-to-show', () => {
      setSplashProgress(100, 'جاهز')
      writeLastRunVersion()
      closeSplash()
    })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    wireUpdater()
    await rotateBackups()
    backupTimer = setInterval(() => {
      void rotateBackups()
    }, 60 * 60 * 1000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (backupTimer) clearInterval(backupTimer)
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
    if (database) {
      event.preventDefault()
      const closing = database
      database = null
      void rotateBackups(closing)
        .catch(() => undefined)
        .then(() => {
          closing.close()
          app.quit()
        })
    }
  })
}
