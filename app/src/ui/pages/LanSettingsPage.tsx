/**
 * إعدادات شبكة المحل (§102) — دور هذا الجهاز:
 *   • مستقل (افتراضي): قاعدة محلية كما هي
 *   • مضيف المحل: خادم ws يخدم أجهزة المحل من قاعدة هذا الجهاز
 *   • جهاز عميل: يتصل بمضيف المحل — الكتابة تنفذ عنده باسم صاحب الجهاز
 *
 * للمالك فقط (نفس حساسية النسخ الاحتياطي) — انظر permissions.ts prefix /settings/lan.
 */
import { useState } from 'react'
import { Network, Server, MonitorSmartphone, Unplug, RefreshCw, Copy, Users } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { useLanStatusStore, startHostSession, stopHostSession } from '../../data/lan/hostSession.ts'
import { connectRemoteSession, disconnectRemoteSession } from '../../data/lan/remoteSession.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'
import { isElectronRuntime } from '../../data/desktopBridge.ts'

function randomPairingCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export function LanSettingsPage() {
  const toast = useToast()
  const { lanHost, updateLanHost, lanClient, setup } = useAppStore()
  const lan = useLanStatusStore()
  const [hostCode, setHostCode] = useState(lanHost.pairingCode || randomPairingCode())
  const [hostPort, setHostPort] = useState(String(lanHost.port))
  const [hostName, setHostName] = useState(lanHost.hostName || setup.shopName || 'مضيف محل تَحَكَّم')
  const [clientUrl, setClientUrl] = useState(lanClient.hostUrl)
  const [clientName, setClientName] = useState(lanClient.deviceName || 'جهاز محل')
  const [clientCode, setClientCode] = useState('')
  const [busy, setBusy] = useState(false)

  const startHost = async () => {
    if (!/^\d{4}$/.test(hostCode)) return toast.show('رمز الاقتران أربع خانات رقمية', 'error')
    const port = Number(hostPort)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return toast.show('المنفذ بين 1024 و65535', 'error')
    setBusy(true)
    try {
      updateLanHost({ pairingCode: hostCode, port, hostName: hostName.trim(), enabled: true })
      await startHostSession({ pairingCode: hostCode, port, hostName: hostName.trim() })
      toast.show('بدأ مضيف المحل — الأجهزة تستطيع الاقتران الآن ✅')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const stopHost = async () => {
    setBusy(true)
    try {
      await stopHostSession()
      updateLanHost({ enabled: false })
      toast.show('أُوقف مضيف المحل')
    } finally {
      setBusy(false)
    }
  }

  const connectClient = async () => {
    const url = clientUrl.trim()
    if (!/^ws:\/\/.+:\d+$/.test(url)) return toast.show('اكتب عنوان المضيف بصيغة ws://192.168.1.10:8787', 'error')
    if (!clientName.trim()) return toast.show('اكتب اسم هذا الجهاز (يظهر عند المضيف)', 'error')
    if (!lanClient.token && !/^\d{4}$/.test(clientCode)) return toast.show('رمز الاقتران أربع خانات — تجده على شاشة المضيف', 'error')
    setBusy(true)
    try {
      await connectRemoteSession({
        hostUrl: url,
        deviceName: clientName.trim(),
        pairingCode: lanClient.token ? undefined : clientCode,
      })
      toast.show('جارٍ الاتصال بالمضيف…')
    } catch (err) {
      toast.show((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const disconnectClient = () => {
    disconnectRemoteSession()
    toast.show('عاد هذا الجهاز للعمل المستقل بقاعدته المحلية')
  }

  const sectionCls = 'anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'
  const roleBadge = (active: boolean, label: string) => (
    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-400'}`}>{active ? `فعّال: ${label}` : 'غير مفعّل'}</span>
  )

  return (
    <div className="max-w-3xl space-y-5">
      <section className={sectionCls}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-1 flex items-center gap-2">
          <Network className="w-5 h-5 text-sky-500" /> شبكة المحل (عدة أجهزة على قاعدة واحدة)
        </h3>
        <p className="text-[11px] text-slate-400 mb-1">
          كاشير×3 ومحاسب وصاحب المحل يشترون من نفس القاعدة لحظياً: جهاز واحد «مضيف» يحمل القاعدة، وبقية الأجهزة «عملاء»
          تنفذ كل كتابة عند المضيف باسم صاحبها وتستلم الرقع فوراً. القراءة دائماً محلية سريعة، والانقطاع يعطّل الكتابة فقط.
        </p>
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          الشبكة المحلية فقط — لا يخرج أي بيان إلى الإنترنت. سقوط جهاز المضيف يوقف المحل كله (موثق في وثيقة المعمارية).
        </p>
      </section>

      {/* ── المضيف ── */}
      <section className={sectionCls} style={{ animationDelay: '40ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-500" /> هذا الجهاز مضيف المحل
          {roleBadge(lan.role === 'host', 'مضيف')}
        </h3>
        {lan.role === 'host' ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900 p-3 text-[12px]">
              <div className="font-bold text-emerald-700 dark:text-emerald-300 mb-1">المضيف يعمل ✅ — أعطِ الأجهزة هذا العنوان:</div>
              {lan.hostAddresses.length ? (
                <div className="flex flex-col gap-1">
                  {lan.hostAddresses.map((addr) => (
                    <button
                      key={addr}
                      className="flex items-center gap-2 text-right font-mono text-[13px] text-emerald-800 dark:text-emerald-200 hover:underline"
                      onClick={() => { navigator.clipboard?.writeText(addr); toast.show('نُسخ العنوان 📋') }}
                    >
                      <Copy className="w-3.5 h-3.5" /> {addr}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500">لم يُعثر على عنوان شبكة داخلي — تحقق من اتصال الجهاز بشبكة المحل</span>
              )}
              <div className="mt-2 text-slate-600 dark:text-slate-300">
                رمز الاقتران: <b className="font-mono text-base tracking-widest">{lanHost.pairingCode}</b> — منفذ {lan.hostPort}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> الأجهزة المتصلة</div>
              {lan.devices.length ? (
                <ul className="text-[12px] space-y-1">
                  {lan.devices.map((d) => (
                    <li key={d.deviceName} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <MonitorSmartphone className="w-3.5 h-3.5 text-sky-500" />
                      {d.deviceName}
                      <span className="text-slate-400">— {d.userId == null ? 'المالك' : `مستخدم #${d.userId}`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[12px] text-slate-400">لا أجهزة مقترنة بعد — افتح التطبيق على جهاز آخر وادخل العنوان والرمز</span>
              )}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={stopHost} disabled={busy}><Unplug className="w-4 h-4" /> إيقاف المضيف</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[11px] font-bold text-slate-500">رمز الاقتران (4 خانات)</span>
                <input value={hostCode} onChange={(e) => setHostCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} inputMode="numeric" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-slate-500">المنفذ</span>
                <input value={hostPort} onChange={(e) => setHostPort(e.target.value.replace(/\D/g, '').slice(0, 5))} className={inputCls} inputMode="numeric" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-slate-500">اسم المضيف</span>
                <input value={hostName} onChange={(e) => setHostName(e.target.value)} className={inputCls} />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Btn onClick={startHost} disabled={busy}><Server className="w-4 h-4" /> بدء المضيف</Btn>
              <span className="text-[11px] text-slate-400">يبقى الخادم يعمل حتى إيقافه، ويعود تلقائياً عند فتح التطبيق</span>
            </div>
          </div>
        )}
      </section>

      {/* ── العميل ── */}
      <section className={sectionCls} style={{ animationDelay: '80ms' }}>
        <h3 className="font-extrabold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
          <MonitorSmartphone className="w-5 h-5 text-sky-500" /> هذا الجهاز عميل (جهاز محل)
          {roleBadge(lan.role === 'client', `عميل — ${lan.clientStatus === 'connected' ? 'متصل' : lan.clientStatus === 'disconnected' ? 'منقطع' : 'يتصل…'}`)}
        </h3>
        {lan.role === 'client' ? (
          <div className="space-y-3">
            <div className={`rounded-xl border p-3 text-[12px] ${lan.clientStatus === 'connected' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'}`}>
              {lan.clientStatus === 'connected' && <>متصل بالمضيف «{lan.clientHostName || lanClient.hostUrl}» ✅ — كل كتابة تنفذ عند المضيف باسم صاحب هذا الجهاز</>}
              {lan.clientStatus === 'disconnected' && <>{lan.clientMessage || 'انقطع الاتصال بالمضيف'} — ستُعاد المحاولة تلقائياً</>}
              {(lan.clientStatus === 'pairing' || lan.clientStatus === 'connecting') && <>جارٍ الاتصال بالمضيف…</>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={disconnectClient}><Unplug className="w-4 h-4" /> فصل والعودة لقاعدة هذا الجهاز</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block sm:col-span-2">
                <span className="text-[11px] font-bold text-slate-500">عنوان المضيف — ws://192.168.1.10:8787</span>
                <input value={clientUrl} onChange={(e) => setClientUrl(e.target.value.trim())} className={inputCls} placeholder="ws://192.168.1.10:8787" dir="ltr" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-slate-500">اسم هذا الجهاز</span>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} placeholder="كاشير 1" />
              </label>
            </div>
            {!lanClient.token && (
              <label className="block max-w-40">
                <span className="text-[11px] font-bold text-slate-500">رمز الاقتران (أول مرة فقط)</span>
                <input value={clientCode} onChange={(e) => setClientCode(e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} inputMode="numeric" placeholder="1234" />
              </label>
            )}
            <div className="flex items-center gap-2">
              <Btn onClick={connectClient} disabled={busy}><RefreshCw className="w-4 h-4" /> اتصال بالمضيف</Btn>
              {lanClient.token && <span className="text-[11px] text-slate-400">الجهاز مقترن سلفاً — يعود بلا رمز</span>}
            </div>
          </div>
        )}
      </section>

      {!isElectronRuntime && (
        <section className={sectionCls}>
          <p className="text-[12px] text-amber-600">
            شبكة المحل تعمل في تطبيق سطح المكتب فقط (خادم الأجهزة يحتاج Electron). هذه النسخة متصفح — قاعدة محلية واحدة.
          </p>
        </section>
      )}
    </div>
  )
}
