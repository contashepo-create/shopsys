/**
 * remoteSession.ts — لاصق عميل شبكة المحل في المُصيّر (§102).
 *
 * يفتح WebSocket من المُصيّر مباشرة إلى مضيف المحل (شبكة محلية فقط)،
 * ويحوّل متجر هذا الجهاز إلى وضع العميل:
 *   • دوال الكتابة → RPC عند المضيف (remoteize — تنفيذ الكاشير والمحاسب
 *     باسم صاحب الجهاز، والحرس والرسائل العربية من عند المضيف حرفياً)
 *   • دوال القراءة → محلية متزامنة فوق آخر لقطة/رقعة
 *   • الرقع الواردة → setState مع مرافقة auditLog لمنع تدقيق مزدوج
 *   • persist المحلي يستمر — كاش دائم يُقرأ عند الانقطاع والإقلاع
 *
 * الانقطاع: شريط واجهة + كتابة مرفوضة برسالة واضحة + قراءة كاملة، ثم
 * إعادة اتصال تلقائية بالتوكن المحفوظ (بلا رمز اقتران).
 */
import { useDataStore } from '../repo.ts'
import { LanClientCore, type LanClientStatus } from './clientCore.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { useLanStatusStore } from './hostSession.ts'
import type { LanStoreLike } from './protocol.ts'

/** متجر البيانات كما تراه نواة الشبكة — صب واحد عند الحدود */
const lanStore = useDataStore as unknown as LanStoreLike

let socket: WebSocket | null = null
let core: LanClientCore | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true
/** رمز اقتران أول معلق — يُرسل فور فتح القناة ثم يُحرق */
let pendingPairing: { code: string; deviceName: string } | null = null

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect(url: string): void {
  if (stopped) return
  clearReconnect()
  reconnectTimer = setTimeout(() => {
    void connectSocket(url)
  }, 2000)
}

async function connectSocket(url: string): Promise<void> {
  if (stopped) return
  const lan = useLanStatusStore.getState()
  lan.setClient({ clientStatus: 'connecting', clientMessage: '' })
  try {
    socket = new WebSocket(url)
  } catch {
    useLanStatusStore.getState().setClient({ clientStatus: 'disconnected', clientMessage: 'عنوان المضيف غير صالح' })
    scheduleReconnect(url)
    return
  }
  socket.onopen = () => {
    if (!core) return
    if (pendingPairing) {
      core.pair(pendingPairing.code, pendingPairing.deviceName)
      pendingPairing = null
      return
    }
    const settings = useAppStore.getState().lanClient
    if (settings.token) core.hello(settings.token, settings.deviceName || 'جهاز محل')
  }
  socket.onmessage = (event) => {
    try {
      core?.onMessage(JSON.parse(String(event.data)) as Parameters<LanClientCore['onMessage']>[0])
    } catch {
      /* رسالة غير JSON — تُهمل */
    }
  }
  socket.onclose = () => {
    socket = null
    if (core && !stopped) {
      core.connectionLost()
      useLanStatusStore.getState().setClient({ clientStatus: 'disconnected', clientMessage: 'انقطع الاتصال بالمضيف — القراءة متاحة من آخر لقطة، والكتابة معطلة حتى يعود الاتصال' })
      scheduleReconnect(url)
    }
  }
  socket.onerror = () => {
    /* onclose يتبع الخطأ عادة — نكتفي به */
  }
}

/**
 * بدء وضع العميل: اقتران أول برمز المضيف أو عودة بالتوكن المحفوظ.
 * @param opts.hostUrl  ws://192.168.1.10:8787
 * @param opts.deviceName اسم هذا الجهاز عند المضيف
 * @param opts.pairingCode رمز المضيف — مطلوب أول مرة فقط (توكن محفوظ يتجاوزه)
 */
export async function connectRemoteSession(opts: { hostUrl: string; deviceName: string; pairingCode?: string }): Promise<void> {
  stopped = false
  clearReconnect()
  if (socket) {
    try { socket.close() } catch { /* مقفلة */ }
    socket = null
  }
  const lan = useLanStatusStore.getState()
  lan.setRole('client')
  lan.setClient({ clientStatus: 'pairing', clientMessage: '' })
  core = new LanClientCore({
    store: lanStore,
    send: (msg) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
    },
    onStatus: (status: LanClientStatus, detail) => {
      useLanStatusStore.getState().setClient({
        clientStatus: status,
        clientHostName: detail?.hostName ?? '',
        clientMessage: detail?.message ?? '',
      })
      /* حفظ توكن الجهاز بعد أول اقتران ناجح — للعودة بلا رمز (persist) */
      if (status === 'connected' && core?.token) {
        useAppStore.getState().updateLanClient({ token: core.token })
      }
    },
  })
  const app = useAppStore.getState()
  const useToken = !opts.pairingCode && app.lanClient.token
  pendingPairing = useToken ? null : { code: opts.pairingCode ?? '', deviceName: opts.deviceName }
  /* العنوان والتوكن يُحفظان للإقلاعات القادمة */
  app.updateLanClient({ hostUrl: opts.hostUrl, deviceName: opts.deviceName, token: useToken ? app.lanClient.token : null, enabled: true })
  await connectSocket(opts.hostUrl)
}

/** إيقاف وضع العميل وإرجاع المتجر المحلي كاملاً (استقلال الجهاز). */
export function disconnectRemoteSession(): void {
  stopped = true
  clearReconnect()
  if (socket) {
    try { socket.close() } catch { /* مقفلة */ }
    socket = null
  }
  core?.restore()
  core = null
  const lan = useLanStatusStore.getState()
  lan.setRole('off')
  lan.setClient({ clientStatus: 'idle', clientMessage: '', clientHostName: '' })
  useAppStore.getState().updateLanClient({ enabled: false })
}

/** إعادة الاتصال التلقائي عند الإقلاع إن كان الجهاز عميلاً مفعّلاً. */
export function bootRemoteSession(): void {
  const settings = useAppStore.getState().lanClient
  if (!settings.enabled || !settings.hostUrl) return
  void connectRemoteSession({ hostUrl: settings.hostUrl, deviceName: settings.deviceName })
}
