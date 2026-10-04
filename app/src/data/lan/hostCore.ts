/**
 * نواة مضيف المحل — مرحلة §102 (وثيقة §4).
 *
 * تدير جلسات الأجهزة وتنفذ نداءات RPC على متجر المضيف **بالتسلسل** (كاتب
 * واحد — لا تعارضات أصلاً)، مع سياق مستخدم الجهاز أثناء التنفيذ (سجل
 * التدقيق وسياسة الوردية والخزائن باسم صاحب النداء)، وتجمع الرقع أثناء
 * العملية فتبث رقعة واحدة حتمية بعد انتهائها (لا وميض ولا رقع عابرة).
 *
 * نقية تماماً: تُوصل بأي قناة (WebSocket في التطبيق، قناة ذاكرة في البوابات)
 * وتُغرس فوق أي متجر يشبه عقد LanStoreLike — لا تعتمد على Electron إطلاقاً.
 */
import { randomUUID } from 'node:crypto'
import {
  LAN_SESSION_FNS,
  LAN_SESSION_KEYS,
  lanPatchBetween,
  lanSnapshotOf,
  type LanHostMsg,
  type LanMsg,
  type LanStoreLike,
} from './protocol.ts'

export interface LanSessionHandle {
  /** إرسال رسالة إلى هذا الجهاز. */
  send: (msg: LanHostMsg) => void
  /** اسم الجهاز (للعرض في شاشة المضيف). */
  deviceName: string
}

interface Session extends LanSessionHandle {
  token: string | null
  userId: number | null
  ready: boolean
  /** هل سجّل هذا الجهاز دخوله؟ لا تنفذ أي عملية قبل ذلك — كل عملية باسم صاحبها. */
  loggedIn: boolean
}

export interface LanHostEvents {
  /** استُخدمت محاولة اقتران خاطئة — للعرض والتسجيل عند المضيف. */
  onBadPairing?: (deviceName: string) => void
  /** تغيّرت هوية مستخدم اتصال (دخول/خروج). */
  onSessionUser?: (deviceName: string, userId: number | null) => void
  /** جهاز قطع اتصاله. */
  onDisconnect?: (deviceName: string) => void
}

export class LanHostCore {
  private sessions = new Map<number, Session>()
  private pairedTokens = new Set<string>()
  private nextSessionId = 1
  private rev = 0
  private chain: Promise<void> = Promise.resolve()
  /** كتم البث المحلي أثناء تنفيذ عملية RPC — رقعة العملية المجمعة تغطي كل
      ما تغيّر (وثيقة §4.4: رقعة واحدة حتمية لكل عملية، لا رقعة لكل set). */
  private localBroadcastMuted = false
  private readonly store: LanStoreLike
  private readonly pairingCode: string
  private readonly hostName: string
  private readonly events: LanHostEvents
  private readonly generateToken: () => string

  constructor(
    store: LanStoreLike,
    pairingCode: string,
    hostName: string,
    events: LanHostEvents = {},
    generateToken: () => string = () => randomUUID(),
  ) {
    this.store = store
    this.pairingCode = pairingCode
    this.hostName = hostName
    this.events = events
    this.generateToken = generateToken
  }

  /** رقم المراجعة الحالي (تشخيص). */
  get currentRev(): number {
    return this.rev
  }

  /** الأجهزة المتصلة الآن (لشاشة المضيف). */
  connectedDevices(): { deviceName: string; userId: number | null; ready: boolean }[] {
    return [...this.sessions.values()].map((s) => ({ deviceName: s.deviceName, userId: s.userId, ready: s.ready }))
  }

  /** تسجيل اتصال جهاز جديد — يُرد بمعرفه لتمرير رسائله اللاحقة وقطعه. */
  attach(handle: LanSessionHandle): number {
    const id = this.nextSessionId++
    this.sessions.set(id, { ...handle, token: null, userId: null, ready: false, loggedIn: false })
    return id
  }

  /** قطع اتصال جهاز. */
  detach(id: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    this.events.onDisconnect?.(session.deviceName)
  }

  /** معالجة رسالة واردة من جهاز. */
  handle(id: number, msg: LanMsg): void {
    const session = this.sessions.get(id)
    if (!session) return
    switch (msg.op) {
      case 'pair':
        this.handlePair(session, msg.code, msg.deviceName)
        return
      case 'hello':
        this.handleHello(session, msg.token, msg.deviceName)
        return
      case 'call':
        this.handleCall(session, id, msg.id, msg.fn, msg.args)
        return
      default:
        session.send({ op: 'error', message: 'رسالة غير متوقعة من جهاز العميل' })
    }
  }

  private handlePair(session: Session, code: string, deviceName: string): void {
    if (code !== this.pairingCode) {
      this.events.onBadPairing?.(deviceName)
      session.send({ op: 'error', message: 'رمز الاقتران غير صحيح — اطلبه من جهاز المضيف' })
      return
    }
    const token = this.generateToken()
    this.pairedTokens.add(token)
    session.token = token
    session.deviceName = deviceName
    session.send({ op: 'paired', token })
  }

  private handleHello(session: Session, token: string, deviceName: string): void {
    if (!this.pairedTokens.has(token)) {
      session.send({ op: 'error', message: 'توكن الجهاز غير معروف — أعد الاقتران برمز المضيف' })
      return
    }
    session.token = token
    session.deviceName = deviceName
    session.ready = true
    session.send({ op: 'welcome', snapshot: lanSnapshotOf(this.store.getState()), rev: this.rev, hostName: this.hostName })
  }

  /**
   * تنفيذ نداء — **متسلسل دائماً**: كل نداء ينتظر سابقه، فلا يتقاطع تنفيذان
   * على المتجر أبداً (كاتب واحد متسلسل — أساس «لا تعارضات» في الوثيقة).
   */
  private handleCall(session: Session, sessionId: number, callId: number, fn: string, args: unknown[]): void {
    if (!session.ready) {
      session.send({ op: 'result', id: callId, ok: false, error: 'لم تُسلّم جلسة الجهاز بعد — اتصل بالمضيف أولاً' })
      return
    }
    if (!session.loggedIn && fn !== 'login') {
      session.send({ op: 'result', id: callId, ok: false, error: 'سجّل الدخول من هذا الجهاز أولاً — كل عملية تُنفّذ وتُسجَّل باسم صاحبها' })
      return
    }
    this.chain = this.chain.then(async () => {
      const state = this.store.getState()
      const target = (state as Record<string, unknown>)[fn]
      if (typeof target !== 'function') {
        session.send({ op: 'result', id: callId, ok: false, error: `دالة غير معروفة: ${fn}` })
        return
      }
      /* تجميع المفاتيح المتغيرة أثناء العملية — رقعة واحدة بعد الانتهاء */
      const changed = new Set<string>()
      let before = this.store.getState()
      const stopCollecting = this.store.subscribe((_next, prev) => {
        for (const key of Object.keys(_next)) if (_next[key] !== prev[key]) changed.add(key)
      })
      /* سياق مستخدم الجهاز: الحراس المرتبطة بالمستخدم تعمل باسمه —
         نعتمد loggedIn لا القيمة: null ملتبسة بين «لم يسجل» و«المالك» */
      const hostUser = before.currentUserId as number | null
      const wantUser = session.loggedIn ? session.userId : hostUser
      if (wantUser !== hostUser) this.store.setState({ currentUserId: wantUser })
      let ok = true
      let value: unknown
      let error = ''
      const wasMuted = this.localBroadcastMuted
      this.localBroadcastMuted = true
      try {
        const result = (target as (...a: unknown[]) => unknown | Promise<unknown>)(...args)
        value = result instanceof Promise ? await result : result
      } catch (e) {
        ok = false
        error = e instanceof Error ? e.message : String(e)
      } finally {
        try {
          /* استعادة هوية المضيف دائماً — حتى لو غيّرت العملية المستخدمَ نفسه
             (login ناجح يضبط currentUserId لصاحب الجهاز الطالب) */
          const nowUser = this.store.getState().currentUserId as number | null
          if (nowUser !== hostUser) this.store.setState({ currentUserId: hostUser })
        } finally {
          this.localBroadcastMuted = wasMuted
          stopCollecting()
        }
      }
      if (ok) {
        const sessionFn = LAN_SESSION_FNS[fn]
        if (sessionFn) {
          const nextUser = sessionFn(args)
          if (nextUser !== undefined && session.userId !== nextUser) {
            session.userId = nextUser
            this.events.onSessionUser?.(session.deviceName, nextUser)
          }
        }
        /* دخول/خروج الجهاز يغيّر صلاحية الجلسة نفسها */
        if (fn === 'login') session.loggedIn = true
        if (fn === 'logout') {
          session.loggedIn = false
          session.userId = null
        }
      }
      session.send(ok ? { op: 'result', id: callId, ok: true, value: normalized(value) } : { op: 'result', id: callId, ok: false, error })
      /* رقعة واحدة حتمية بعد اكتمال العملية — للجميع بلا استثناء */
      const after = this.store.getState()
      const patch = lanPatchBetween(before, after, changed)
      before = after
      if (Object.keys(patch).length) {
        this.rev += 1
        this.broadcast({ op: 'patch', rev: this.rev, patch })
      }
      void sessionId
    })
  }

  /** بث رسالة لكل الجلسات المسلّمة. */
  broadcast(msg: LanHostMsg): void {
    for (const session of this.sessions.values()) {
      if (session.ready) session.send(msg)
    }
  }

  /**
   * بث تعديل محلي نفذه المضيف من واجهته (استخدامه كجهاز عادي): تُدار عبر
   * نفس آلية الرقع — الاشتراك الدائم يلتقط كل كتابة مضيف خارج نطاق RPC
   * فيبثها برقعة موحدة.
   */
  startLocalBroadcast(): () => void {
    return this.store.subscribe((next, prev) => {
      if (this.localBroadcastMuted) return
      const changed: string[] = []
      for (const key of Object.keys(next)) if (next[key] !== prev[key]) changed.push(key)
      const patch = lanPatchBetween(prev, next, changed)
      if (!Object.keys(patch).length) return
      this.rev += 1
      this.broadcast({ op: 'patch', rev: this.rev, patch })
    })
  }

  /** مفاتيح الجلسة المستبعدة من البث (تكشفها البوابات لضمان الثبات). */
  static readonly SESSION_KEYS: readonly string[] = LAN_SESSION_KEYS

  /** أجهزة الجلسات الحالية — لواجهة المضيف (اسم الجهاز ومستخدمه). */
  listSessions(): { deviceName: string; userId: number | null; ready: boolean; loggedIn: boolean }[] {
    return [...this.sessions.values()].map((s) => ({ deviceName: s.deviceName, userId: s.userId, ready: s.ready, loggedIn: s.loggedIn }))
  }
}

/** القيم المرجعة قد تحمل دوال (مستقبلات) — تُنظف قبل الإرسال. */
function normalized(value: unknown): unknown {
  if (typeof value === 'function') return undefined
  return value
}
