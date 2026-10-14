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
