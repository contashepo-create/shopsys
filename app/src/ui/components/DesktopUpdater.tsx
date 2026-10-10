/**
 * §101 التنفيذية: تحديث نسخة سطح المكتب (electron-updater من GitHub Releases).
 * يظهر **فقط** داخل Electron حيث يحقن preload جسر shopsysUpdater —
 * في المتصفح يُخفى بالكامل (المتصفح يفحص إصدارات GitHub المنشورة من صفحة «حول»).
 * فحص عند الإقلاع (العملية الرئيسية) + زر يدوي + تنزيل خلفي وتثبيت عند الإغلاق.
 */
import { useEffect, useState } from 'react'
import { RefreshCw, Rocket } from 'lucide-react'
import { Btn } from './ui.tsx'

interface UpdaterBridge {
  state(): Promise<unknown>
  check(): Promise<unknown>
  install(): Promise<void>
  onState(listener: (state: unknown) => void): () => void
}

/** حالة المُحدِّث — نقابة نصية صريحة (تفحصها بوابة المقارنات الحرفية) */
export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface UpdaterState {
  status: UpdaterStatus
  version?: string
  percent?: number
  message?: string
}

const LABELS: Record<UpdaterStatus, string> = {
  idle: 'جاهز',
  checking: 'جارٍ الفحص…',
  available: 'يتوفر إصدار جديد — بدأ التنزيل الخلفي',
  'not-available': 'أنت على أحدث إصدار ✅',
  downloading: 'جارٍ تنزيل التحديث…',
  downloaded: 'التحديث جاهز للتثبيت',
  error: 'تعذّر التحديث',
}

export function DesktopUpdater() {
  const [bridge] = useState<UpdaterBridge | null>(() => (globalThis as { shopsysUpdater?: UpdaterBridge }).shopsysUpdater ?? null)
  const [state, setState] = useState<UpdaterState | null>(null)
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  /* v1.0.22: التثبيت يبدأ بنسخة احتياطية قبل التحديث — إن تعذّرت لا يُثبَّت ونُبلغ هنا */
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    const off = bridge.onState((next) => setState(next as UpdaterState))
    void bridge.state().then((initial) => setState(initial as UpdaterState))
    void (globalThis as { shopsysAppInfo?: () => Promise<{ version: string }> }).shopsysAppInfo?.().then((info) => setVersion(info.version))
    return off
  }, [bridge])

  if (!bridge) return null

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-500/5 border border-slate-500/10 space-y-2" data-testid="desktop-updater">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] font-bold text-slate-600 dark:text-slate-300">
          🖥️ نسخة سطح المكتب {version && <span className="font-mono" dir="ltr">v{version}</span>} — {state ? LABELS[state.status] : '…'}
        </div>
        {state?.status !== 'downloaded' ? (
          <Btn variant="soft" onClick={async () => { setBusy(true); await bridge.check(); setBusy(false) }} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy || state?.status === 'checking' ? 'animate-spin' : ''}`} /> فحص التحديثات
          </Btn>
        ) : (
          <Btn
            disabled={busy}
            onClick={async () => {
              setInstallError(null)
              setBusy(true)
              try {
                await bridge.install()
              } catch (error) {
                setInstallError((error as Error).message)
                setBusy(false)
              }
            }}
          >
            <Rocket className="w-4 h-4" /> {busy ? 'جارٍ أخذ نسخة احتياطية ثم التثبيت…' : `إعادة التشغيل وتثبيت v${state.version ?? ''}`}
          </Btn>
        )}
      </div>
      {state?.status === 'downloading' && (
        <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${state.percent ?? 0}%` }} />
        </div>
      )}
      {state?.status === 'error' && <div className="text-[11px] text-rose-600 font-bold">{state.message ?? ''}</div>}
      {installError && <div role="alert" className="text-[11px] text-rose-600 font-bold">{installError}</div>}
      {state?.status === 'downloaded' && <div className="text-[11px] text-emerald-600 font-bold">يُثبَّت تلقائياً عند إغلاق التطبيق إن لم تعِد التشغيل الآن — بياناتك خارج مسار التثبيت.</div>}
    </div>
  )
}
