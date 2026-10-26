/**
 * تحديث نسخة سطح المكتب (electron-updater من GitHub Releases):
 *   • زر «فحص التحديثات» — فحص فوري بدل انتظار الفحص الدوري.
 *   • شريط التنزيل — نسبة تقدم التنزيل الخلفي.
 * يظهر **فقط** داخل Electron حيث يحقن preload جسر shopsysUpdater؛
 * في المتصفح تُعرض بطاقة «التحديثات» في صفحة «حول» (فحص GitHub المنشور).
 * الفحص الدوري التلقائي والتنزيل في الخلفية والتثبيت الصامت عند الإغلاق
 * — كلها كما هي في العملية الرئيسية؛ هذا المكوّن يعرضها ويسرّع الفحص فقط.
 */
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Rocket } from 'lucide-react'
import { Btn } from './ui.tsx'
import { desktopUpdaterBridge, type DesktopUpdaterState, type DesktopUpdaterStatus } from '../../data/desktopBridge.ts'

/** حالة المُحدِّث — نقابة نصية صريحة (تفحصها بوابة المقارنات الحرفية) */
export type UpdaterStatus = DesktopUpdaterStatus

const LABELS: Record<DesktopUpdaterStatus, string> = {
  idle: 'جاهز',
  checking: 'جارٍ الفحص…',
  available: 'يتوفر إصدار جديد — بدأ التنزيل الخلفي',
  'not-available': 'أنت على أحدث إصدار ✅',
  downloading: 'جارٍ تنزيل التحديث…',
  downloaded: 'التحديث جاهز للتثبيت',
  error: 'تعذّر التحديث',
}

export function DesktopUpdater() {
  const [bridge] = useState(() => desktopUpdaterBridge())
  const [state, setState] = useState<DesktopUpdaterState | null>(null)
  // IPC result for a point-in-time snapshot can arrive after a newer progress event.
  // Keep the event revision so a late snapshot cannot rewind the visible progress.
  const stateEventRevision = useRef(0)
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    const revisionAtSubscribe = stateEventRevision.current
    const off = bridge.onState((next) => {
      stateEventRevision.current += 1
      setState(next as DesktopUpdaterState)
    })
    void bridge.state().then((initial) => {
      if (stateEventRevision.current === revisionAtSubscribe) setState(initial as DesktopUpdaterState)
    }).catch(() => undefined)
    void (globalThis as { shopsysAppInfo?: () => Promise<{ version: string }> }).shopsysAppInfo?.()
      .then((info) => setVersion(info.version))
      .catch(() => undefined)
    return off
  }, [bridge])

  if (!bridge) return null

  const status: DesktopUpdaterStatus = state?.status ?? 'idle'
  const percent = Math.max(0, Math.min(100, Math.round(state?.percent ?? 0)))
  const checking = busy || status === 'checking'
  const downloading = status === 'downloading'
  const downloaded = status === 'downloaded'

  const runCheck = async () => {
    setActionError(null)
    setBusy(true)
    const revisionBeforeRequest = stateEventRevision.current
    try {
      const result = await bridge.check()
      if (
        stateEventRevision.current === revisionBeforeRequest
        && typeof result === 'object'
        && result !== null
        && 'status' in result
      ) setState(result as DesktopUpdaterState)
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const runInstall = async () => {
    setActionError(null)
    setBusy(true)
    try {
      // نفس مسار الإغلاق الصامت المحمي: حفظ الواجهة ثم حماية القاعدة ونسخها ثم التثبيت.
      await bridge.install()
    } catch (error) {
      setActionError((error as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-500/5 border border-slate-500/10 space-y-2" data-testid="desktop-updater">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300">
          🖥️ نسخة سطح المكتب {version && <span className="font-mono" dir="ltr">v{version}</span>} — {LABELS[status]}
        </div>
        {!downloaded ? (
          <Btn variant="soft" onClick={() => { void runCheck() }} disabled={checking}>
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} /> فحص التحديثات
          </Btn>
        ) : (
          <Btn onClick={() => { void runInstall() }} disabled={busy}>
            <Rocket className="w-4 h-4" /> {busy ? 'جارٍ الحفظ والتحديث…' : `إعادة التشغيل وتثبيت v${state?.version ?? ''}`}
          </Btn>
        )}
      </div>
      {(downloading || downloaded) && (
        <div className="space-y-1" data-testid="desktop-updater-progress">
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${downloaded ? 100 : percent}%` }} />
          </div>
          <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400" dir="ltr">
            {downloaded ? '100% — جاهز للتثبيت' : `${percent}%`}
          </div>
        </div>
      )}
      {status === 'error' && <div className="text-[11px] text-rose-600 font-bold">{state?.message ?? ''}</div>}
      {actionError && <div role="alert" className="text-[11px] text-rose-600 font-bold">{actionError}</div>}
      {downloaded && (
        <div className="text-[11px] text-emerald-600 font-bold">
          تُؤخذ نسخة احتياطية قبل التثبيت، ويُثبَّت التحديث عند إغلاق التطبيق إن لم تعِد التشغيل الآن. يتم التثبيت بصمت في مجلد البرنامج نفسه، ثم إعادة التشغيل على قاعدة البيانات نفسها — بلا أسئلة تثبيت أو معالج إعداد.
        </div>
      )}
      <div className="text-[10.5px] text-slate-400">
        الفحص التلقائي في الخلفية كل ساعة يبقى يعمل كما هو — الزر لفحص فوري بلا انتظار.
      </div>
    </div>
  )
}
