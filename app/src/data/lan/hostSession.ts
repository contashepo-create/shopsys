/**
 * hostSession.ts — لاصق مضيف شبكة المحل في المُصيّر (§102).
 *
 * يربط ثلاثة أطراف:
 *   • LanHostCore فوق useDataStore (منطق RPC والرقع — مُختبَر في البوابات)
 *   • خادم ws في العملية الرئيسية عبر window.shopsysLanHost (جسر ipc)
 *   • متجر حالة الحية lanStatusStore لواجهة المضيف (الأجهزة المتصلة)
 *
 * المضيف يعمل كجهاز عادي: كتاباته المحلية تُبث رقعاً (startLocalBroadcast)،
 * وأجهزة المحل تنفذ كتاباتها عبر RPC على قاعدته الواحدة.
 */
import { useDataStore } from '../repo.ts'
import { LanHostCore } from './hostCore.ts'
import type { LanStoreLike } from './protocol.ts'
import { create } from 'zustand'

/** حالة شبكة المحل الحية (بلا persist — تُعاد بنائها كل إقلاع) */
export interface LanStatusState {
  /** host | client | off — دور هذا الجهاز */
  role: 'off' | 'host' | 'client'
  hostRunning: boolean
  hostPort: number | null
  hostAddresses: string[]
  /** أجهزة مقترنة: اسم الجهاز + مستخدمه الحالي (null = لم يدخل / المالك) */
  devices: { deviceName: string; userId: number | null; connected: boolean }[]
  clientStatus: 'idle' | 'pairing' | 'connecting' | 'connected' | 'disconnected'
  clientHostName: string
  clientMessage: string
  setRole: (role: LanStatusState['role']) => void
  setHost: (patch: Partial<Pick<LanStatusState, 'hostRunning' | 'hostPort' | 'hostAddresses'>>) => void
  setDevices: (devices: LanStatusState['devices']) => void
  setClient: (patch: Partial<Pick<LanStatusState, 'clientStatus' | 'clientHostName' | 'clientMessage'>>) => void
}

export const useLanStatusStore = create<LanStatusState>()((set) => ({
  role: 'off',
  hostRunning: false,
  hostPort: null,
  hostAddresses: [],
  devices: [],
  clientStatus: 'idle',
  clientHostName: '',
  clientMessage: '',
  setRole: (role) => set({ role }),
  setHost: (patch) => set(patch),
  setDevices: (devices) => set({ devices }),
  setClient: (patch) => set(patch),
}))

let core: LanHostCore | null = null
let stopLocalBroadcast: (() => void) | null = null
let unsubs: (() => void)[] = []
/** connectionId (خادم main) → sessionId (hostCore) */
const sessionIds = new Map<number, number>()

declare global {
  interface Window {
    shopsysLanHost?: {
      start: (opts: { port: number }) => Promise<{ running: boolean; port: number | null; addresses: string[] }>
      stop: () => Promise<{ running: boolean; port: number | null; addresses: string[] }>
      status: () => Promise<{ running: boolean; port: number | null; addresses: string[] }>
      send: (payload: { connectionId: number; msg: unknown }) => Promise<boolean>
      onWsOpen: (listener: (e: { connectionId: number }) => void) => () => void
      onWsMessage: (listener: (e: { connectionId: number; msg: unknown }) => void) => () => void
      onWsClose: (listener: (e: { connectionId: number }) => void) => () => void
    }
  }
}

function pushDevices(): void {
  if (!core) return
  useLanStatusStore.getState().setDevices(
    core
      .listSessions()
      .filter((s) => s.ready)
      .map((s) => ({ deviceName: s.deviceName, userId: s.userId, connected: true })),
  )
}

/** تشغيل المضيف — يستدعى من الإعدادات أو عند الإقلاع إن كان مفعّلاً. */
export async function startHostSession(opts: { pairingCode: string; port: number; hostName: string }): Promise<boolean> {
  const bridge = window.shopsysLanHost
  if (!bridge) throw new Error('خادم الشبكة غير متاح في هذه النسخة — شغّل تطبيق سطح المكتب')
  stopHostSession()
  const lanStore = useDataStore as unknown as LanStoreLike
  core = new LanHostCore(lanStore, opts.pairingCode, opts.hostName, {
    onSessionUser: () => pushDevices(),
    onDisconnect: () => pushDevices(),
    onBadPairing: (device) => {
      console.warn(`[lan] محاولة اقتران برمز خاطئ من «${device}»`)
    },
  })
  stopLocalBroadcast = core.startLocalBroadcast()
  unsubs.push(
    bridge.onWsOpen(({ connectionId }) => {
      const sessionId = core!.attach({
        deviceName: `جهاز #${connectionId}`,
        send: (msg) => {
          void bridge.send({ connectionId, msg })
        },
      })
      sessionIds.set(connectionId, sessionId)
    }),
    bridge.onWsMessage(({ connectionId, msg }) => {
      const sessionId = sessionIds.get(connectionId)
      if (sessionId != null) core!.handle(sessionId, msg as Parameters<LanHostCore['handle']>[1])
      pushDevices()
    }),
    bridge.onWsClose(({ connectionId }) => {
      const sessionId = sessionIds.get(connectionId)
      if (sessionId != null) core!.detach(sessionId)
      sessionIds.delete(connectionId)
      pushDevices()
    }),
  )
  const status = await bridge.start({ port: opts.port })
  useLanStatusStore.getState().setRole('host')
  useLanStatusStore.getState().setHost({ hostRunning: status.running, hostPort: status.port, hostAddresses: status.addresses })
  return status.running
}

/** إيقاف المضيف — الأجهزة تنقطع وتستمر بقراءة آخر لقطة عندها. */
export async function stopHostSession(): Promise<void> {
  const bridge = window.shopsysLanHost
  if (bridge) await bridge.stop().catch(() => undefined)
  for (const unsub of unsubs) unsub()
  unsubs = []
  sessionIds.clear()
  stopLocalBroadcast?.()
  stopLocalBroadcast = null
  core = null
  useLanStatusStore.getState().setRole('off')
  useLanStatusStore.getState().setHost({ hostRunning: false, hostPort: null, hostAddresses: [] })
  useLanStatusStore.getState().setDevices([])
}
