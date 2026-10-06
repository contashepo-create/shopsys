/**
 * شريط حالة شبكة المحل (§102) — يظهر فقط على أجهزة العملاء:
 * متصل: شريط أخضر رفيع باسم المضيف · منقطع: شريط أحمر واضح بأن القراءة
 * متاحة من آخر لقطة والكتابة معطلة (وثيقة §4.3). على المضيف لا يظهر.
 */
import { useLanStatusStore } from '../../data/lan/hostSession.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { Wifi, WifiOff } from 'lucide-react'

export function LanStatusBar() {
  const lan = useLanStatusStore()
  const lanClient = useAppStore((s) => s.lanClient)
  if (lan.role !== 'client') return null
  const connected = lan.clientStatus === 'connected'
  const hostLabel = lan.clientHostName || lanClient.hostUrl
  return (
    <div
      dir="rtl"
      className={`flex items-center justify-center gap-2 px-4 py-1 text-[11px] font-bold sticky top-0 z-40 ${
        connected ? 'bg-emerald-600/95 text-white' : 'bg-rose-600/95 text-white'
      }`}
    >
      {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
      {connected ? (
        <>متصل بمضيف المحل{hostLabel ? ` «${hostLabel}»` : ''} — كل عملية تنفذ باسمك على قاعدة المحل</>
      ) : (
        <>انقطع الاتصال بالمضيف — القراءة متاحة من آخر لقطة، والكتابة معطلة حتى يعود الاتصال (تُعاد المحاولة تلقائياً)</>
      )}
    </div>
  )
}
