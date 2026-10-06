/**
 * نواة عميل الشبكة — مرحلة §102 (وثيقة §4).
 *
 * تحوّل متجر الجهاز إلى مرآة للمضيف:
 *   • اللقطة الأولى عند التسليم تستبدل كل الحالة البيانية (بما فيها بيانات
 *     القاعدة المحلية القديمة إن وجدت) وتبقي دوال المتجر ومفاتيح جلسة الجهاز.
 *   • كل دالة كتابة تستبدل بنداء RPC للمضيف (async) — الحارس وبوابة الاعتماد
 *     ينفذان هناك، والرفض يصل برسالته العربية نفسها كما لو كان محلياً.
 *   • دوال القراءة الصرفة تبقى محلية تعمل على الحالة المتزامنة (متطابقة
 *     بمرجع الرقع) فلا تفقد الواجهة نداءاتها المتزامنة.
 *   • الرقع الواردة تطبق مع مرافقة auditLog الحالي عندما تخلو الرقعة منه —
 *     حتى لا يولّد متجر العميل أحداث تدقيق زائفة عن كتابات لم يرتكبها.
 *
 * نقية بلا Electron — تُختبر في البوابات عبر قناة في الذاكرة.
 */
import { LAN_SESSION_KEYS, LAN_SESSION_LOCAL, type LanClientMsg, type LanHostMsg, type LanStoreLike } from './protocol.ts'

export type LanClientStatus = 'idle' | 'pairing' | 'connecting' | 'connected' | 'disconnected'

export interface LanClientOptions {
  store: LanStoreLike
  send: (msg: LanClientMsg) => void
  onStatus?: (status: LanClientStatus, detail?: { hostName?: string; message?: string }) => void
  /** يُستدعى مرة عند أول تسليم ناجح — لتثبيت الوضع البعيد في الواجهة. */
  onReady?: (hostName: string) => void
}

export class LanClientCore {
  status: LanClientStatus = 'idle'
  hostName = ''
  private deviceName: string | null = null
  /** توكن الجهاز بعد أول اقتران — يحفظه اللاصق ويعيد الدخول به دون رمز. */
  token: string | null = null
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private nextCallId = 1
  private readFns = new Set<string>()
  private writeFns = new Set<string>()
  private originalFns = new Map<string, unknown>()
  private readonly options: LanClientOptions

  constructor(options: LanClientOptions) {
    this.options = options
  }

  private setStatus(status: LanClientStatus, detail?: { hostName?: string; message?: string }): void {
    this.status = status
    this.options.onStatus?.(status, detail)
  }

  /* ── دورة الاتصال ── */

  /** بدء الاقتران برمز المضيف (أول مرة للجهاز). */
  pair(code: string, deviceName: string): void {
    this.deviceName = deviceName
    this.setStatus('pairing')
    this.options.send({ op: 'pair', code, deviceName })
  }

  /** الدخول بجلسة جهاز مقترن مسبقاً (توكن محفوظ). */
  hello(token: string, deviceName: string): void {
    this.setStatus('connecting')
    this.options.send({ op: 'hello', token, deviceName })
  }

  /** انقطعت القناة — الكتابة ترفض حتى العودة. */
  connectionLost(): void {
    for (const pending of this.pending.values()) pending.reject(new Error('انقطع الاتصال بالمضيف أثناء تنفيذ العملية'))
    this.pending.clear()
    this.setStatus('disconnected')
  }

  /* ── الرسائل الواردة ── */

  onMessage(msg: LanHostMsg): void {
    switch (msg.op) {
      case 'paired':
        /* التوكن يصدره المضيف — على الجهاز حفظه وإعادة الدخول به دون رمز */
        this.token = msg.token
        this.hello(msg.token, this.deviceName ?? 'paired-device')
        return
      case 'welcome':
        this.hostName = msg.hostName
        this.applySnapshot(msg.snapshot)
        this.remoteize()
        this.setStatus('connected', { hostName: msg.hostName })
        this.options.onReady?.(msg.hostName)
        return
      case 'patch':
        this.applyPatch(msg.patch)
        return
      case 'result': {
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        /* microtask: يضمن أن الرفض لا يحدث داخل منشئ النداء نفسه (القنوات
           المتزامنة في المحاكاة) فيُربط المعالج قبل التسليم */
        queueMicrotask(() => {
          if (msg.ok) pending.resolve(msg.value)
          else pending.reject(new Error(msg.error))
        })
        return
      }
      case 'error':
        this.setStatus(this.status === 'connected' ? 'connected' : 'disconnected', { message: msg.message })
        return
    }
  }

  /* ── تطبيق الحالة الواردة ── */

  /** اللقطة الأولى: حالة بيانية نظيفة + دوال المتجر + جلسة الجهاز. */
  private applySnapshot(snapshot: Record<string, unknown>): void {
    const current = this.options.store.getState()
    const fresh: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === 'function') fresh[key] = value
      else if ((LAN_SESSION_KEYS as readonly string[]).includes(key)) fresh[key] = value
    }
    Object.assign(fresh, snapshot)
    this.options.store.setState(fresh, true)
  }

  /**
   * رقعة من المضيف — setState يمر بحارس متجر العميل: القيود سليمة أصلاً
   * (المضيف حرسها)، ومرافقة auditLog الحالي تمنع توليد أحداث زائفة عن
   * كتابات لم يقم بها هذا الجهاز.
   */
  private applyPatch(patch: Record<string, unknown>): void {
    const merged: Record<string, unknown> = { ...patch }
    if (!('auditLog' in merged)) merged.auditLog = this.options.store.getState().auditLog
    this.options.store.setState(merged, false)
  }

  /* ── التحول إلى وضع العميل ── */

  /**
   * استبدال دوال الكتابة بنداءات RPC. التمييز نصي: كل دالة تنادي set في
   * جسدها هي كتابة (نمط repo.ts القائم — الكل يستدعي set مباشرة)؛ ما عداها
   * قراءة صرفة تبقى محلية تعمل على الحالة المتزامنة كما هي.
   */
  remoteize(): { read: string[]; write: string[] } {
    const state = this.options.store.getState()
    for (const [name, value] of Object.entries(state)) {
      if (typeof value !== 'function') continue
      if (this.originalFns.has(name)) continue
      const body = String(value)
      if (/\bset\s*\(|\bsetState\s*\(/.test(body)) this.writeFns.add(name)
      else this.readFns.add(name)
    }
    const remote = (name: string) => (...args: unknown[]) => this.call(name, args)
    const overrides: Record<string, unknown> = {}
    for (const name of this.writeFns) {
      this.originalFns.set(name, this.options.store.getState()[name])
      overrides[name] = remote(name)
    }
    if (Object.keys(overrides).length) this.options.store.setState(overrides, false)
    return { read: [...this.readFns], write: [...this.writeFns] }
  }

  /** نداء RPC — يرفض فوراً عند الانقطاع (الكتابة معطلة، القراءة من آخر لقطة). */
  call(fn: string, args: unknown[]): Promise<unknown> {
    if (this.status !== 'connected') {
      return Promise.reject(new Error('انقطع الاتصال بالمضيف — القراءة متاحة من آخر لقطة، والكتابة معطلة حتى يعود الاتصال'))
    }
    const id = this.nextCallId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          /* دوال الجلسة (دخول/خروج): المضيف نفذها عنده ولن يبث مفاتيح الجلسة —
             نطبقها محلياً حتى تعرف شاشات هذا الجهاز هوية صاحبه فوراً */
          const local = LAN_SESSION_LOCAL[fn]
          if (local) this.options.store.setState(local(args), false)
          resolve(value)
        },
        reject,
      })
      this.options.send({ op: 'call', id, fn, args })
    })
  }

  /** تصنيف الدوال (تكشفه البوابات لضمان الثبات والاكتمال). */
  classification(): { read: string[]; write: string[] } {
    return { read: [...this.readFns], write: [...this.writeFns] }
  }

  /** التراجع عن remoteize (يستخدمه اختبار البوابات لاستعادة المتجر). */
  restore(): void {
    if (!this.originalFns.size) return
    const overrides: Record<string, unknown> = {}
    for (const [name, fn] of this.originalFns) overrides[name] = fn
    this.options.store.setState(overrides, false)
    this.originalFns.clear()
  }
}

/** الاسم الموازي في الوثيقة (§4.2) — RemoteTransport هو نواة العميل هذه. */
export { LanClientCore as RemoteTransport }
