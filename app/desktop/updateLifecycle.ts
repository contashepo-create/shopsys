import { statSync } from 'node:fs'

/** التثبيت يبدأ صراحةً قبل app.exit؛ لا اعتماد على حدث quit الذي لا يرسله exit. */
export interface SilentUpdateDeps {
  flush: () => Promise<void>
  protect: () => Promise<void>
  backup: () => Promise<void>
  close: () => void
  install: () => void | Promise<void>
  exit: () => void
}

export async function installSilentUpdate(deps: SilentUpdateDeps): Promise<void> {
  // أي فشل قبل close يُبقي القاعدة مفتوحة ولا يبدأ المثبّت.
  await deps.flush()
  await deps.protect()
  await deps.backup()
  deps.close()
  await deps.install()
  deps.exit()
}

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const UPDATE_CHECK_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000] as const

/* ─── الفحص اليدوي (زر «فحص التحديثات») ───
   الغرض: المستخدم يبحث عن التحديث فوراً بلا انتظار الفحص الدوري.
   القرار نقي هنا ليُختبر بلا Electron، ولا يغيّر مسار التنزيل الصامت ولا التثبيت عند الإغلاق. */
export type ManualUpdateCheckDecision =
  | { kind: 'check' }
  | { kind: 'in_flight' }
  | { kind: 'downloading' }
  | { kind: 'downloaded' }
  | { kind: 'unavailable' }

export interface ManualUpdateCheckInput {
  /** نسخة مثبَّتة (electron-updater يعمل فقط في الحزمة المنشورة) */
  packaged: boolean
  /** فحص جارٍ الآن (لا يفحصان معاً) */
  inFlight: boolean
  /** تنزيل جارٍ في الخلفية */
  downloading: boolean
  /** التحديث منزَّل بالكامل وبانتظار التثبيت الصامت */
  downloaded: boolean
}

/** لا يبدأ فحصاً جديداً فوق فحص جارٍ أو تنزيل جارٍ أو تحديث جاهز — يمنع التداخل والفساد. */
export function decideManualCheck(input: ManualUpdateCheckInput): ManualUpdateCheckDecision {
  if (!input.packaged) return { kind: 'unavailable' }
  if (input.downloaded) return { kind: 'downloaded' }
  if (input.downloading) return { kind: 'downloading' }
  if (input.inFlight) return { kind: 'in_flight' }
  return { kind: 'check' }
}

/** تأخير إعادة المحاولة بتصاعد محدود؛ بعد أربع محاولات يعاود الفحص كل 30 دقيقة. */
export function updateCheckRetryDelay(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  return UPDATE_CHECK_RETRY_DELAYS_MS[Math.min(safeAttempt, UPDATE_CHECK_RETRY_DELAYS_MS.length - 1)]
}

/** يمسك رفض checkForUpdates (ومنها ENOENT لـ app-update.yml) كي لا يتحول إلى unhandledRejection. */
export function observeUpdateCheck(
  check: () => Promise<unknown>,
  onError: (error: unknown) => void,
  onSuccess?: () => void,
): void {
  const report = (error: unknown): void => {
    try { onError(error) } catch { /* حتى فشل تسجيل الخطأ لا ينشئ rejection جديداً غير معالج */ }
  }
  const succeed = (): void => {
    try { onSuccess?.() } catch (error) { report(error) }
  }
  try {
    void Promise.resolve(check()).then(succeed, report)
  } catch (error) {
    report(error)
  }
}

export async function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}


export interface SilentInstaller {
  on(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  quitAndInstall(silent: boolean, restart: boolean): void
}

/** quitAndInstall يرجع void حتى عند فشل install؛ نرصد error قبل السماح بالخروج. */
export async function requestSilentInstall(updater: SilentInstaller): Promise<void> {
  let failure: Error | null = null
  const onError = (error: Error): void => { failure = error }
  updater.on('error', onError)
  try {
    updater.quitAndInstall(true, true)
    // أخطاء spawn الأولية تصل في nextTick؛ لا app.exit قبل وصولها.
    await new Promise<void>(resolve => setImmediate(resolve))
    if (failure) throw failure
  } finally { updater.off('error', onError) }
}


export function assertDownloadedInstaller(file: string | null): void {
  if (!file) throw new Error('مسار المثبت المنزّل غير متاح — لم يبدأ التحديث')
  try {
    const stat = statSync(file)
    if (!stat.isFile() || !stat.size) throw new Error('ليس ملف مثبت صالحاً')
  } catch { throw new Error('المثبت المنزّل مفقود أو فارغ — أعد تنزيل التحديث، لم يبدأ التثبيت') }
}
