/**
 * نوافذ الأقمار الحرة (قرار المالك 2026-10-22 — «كل قسم أضغط عليه يفتح في نافذة
 * مستقلة حرة، لا نوافذ داخلية مربوطة بحدود التطبيق»):
 * كل قسم وكل مستند وكل منتقٍ/محرر يفتح في BrowserWindow حقيقي خارج إطار النافذة
 * الرئيسية، بشريط تحكم نظام التشغيل العلوي، ويُغلق وحده دون أخواته.
 *
 * العقد مع المُصيّر (preload ⇒ shopsysDesktop.windows):
 *   windows:open            إنشاء نافذة «عرض» (مستند/منتقٍ/محرر) بواصف يُسلَّم برمز
 *   windows:open-section    إنشاء/تركيز نافذة قسم (نسخة واحدة لكل مسار)
 *   windows:claim           القمر الوليد يستلم واصفه (خصائص قابلة للتسلسل + أسماء ردود النداء)
 *   windows:prop-invoke     القمر يستدعي رد نداء عند أمه (onPick/onSaved…) — يُوجَّه لمالك الطلب
 *   windows:request-close   تُرسل للقمر قبل إغلاقه؛ يجيب بـ windows:close-response
 *   windows:registry        بثّ سجل النوافذ لكل المُصيّرات (منع التكرار والقوائم)
 *   database:snapshot-changed  بثّ «حُفظت لقطة» لبقية النوافذ فتطبّق أحدث حالة
 *
 * الملكية: كل قمر يعرف أمه (parentId). إغلاق الأم يغلق بناتها أولاً (بمصافحة
 * إغلاق لكل بنت — أي اعتراض يوقف السلسلة)، والنافذة الرئيسية لا تُغلق بينما
 * توجد أقمار مفتوحة (حوار تأكيد في main.ts عبر confirmAndCloseAllSatellites).
 */
import { BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron'
import { randomBytes } from 'node:crypto'
import { isExternalOpenable, isInAppNavigation } from './navigationPolicy.ts'

export interface SatelliteDeps {
  getMainWindow: () => BrowserWindow | null
  isDev: boolean
  /** عنوان خادم التطوير الكامل (ELECTRON_START_URL) أو null في الإنتاج */
  devStartUrl: string | null
  /** مسار ملف index.html للإنتاج */
  indexFilePath: string
  appIndexFileUrl: string
  devOrigin: string | null
  preloadPath: string
  iconPath: string
  log: (tag: string, message: string) => void
  /** بوابة مصادقة العملية الرئيسية، وليست علماً يرسله المصيّر */
  isSenderAuthorized?: (webContentsId: number) => boolean
  authorizeSatellite?: (webContentsId: number) => void
  forgetSatellite?: (webContentsId: number) => void
}

interface SatEntry {
  windowId: string
  win: BrowserWindow
  /** تُلتقط قبل الإغلاق؛ webContents لا يمكن الوصول إليها من حدث closed. */
  webContentsId: number
  type: 'section' | 'view'
  /** صنف العرض للنوع view (sales-invoice…) */
  kind: string | null
  /** المسار المطبّع (بلا استعلام) لنوع section */
  sectionPath: string | null
  title: string
  dedupeKey: string | null
  /** معرّف النافذة الأم: 'main' أو معرّف قمر أو null */
  parentId: string | null
  ownerWcId: number
  requestId: string | null
  dirty: boolean
  claimed: boolean
  /** true only after the renderer has installed its own dirty-state close handler */
  rendererReady: boolean
  forceClose: boolean
  closing: boolean
  descriptor: Record<string, unknown>
}

let deps: SatelliteDeps | null = null
const byId = new Map<string, SatEntry>()
const byWcId = new Map<number, string>()
const tokens = new Map<string, string>() // token → windowId
const requests = new Map<string, { ownerWcId: number; windowId: string }>()
const closeResponders = new Map<string, { wcId: number; resolve: (allow: boolean) => void }>()

const clampSize = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}
const cleanTitle = (value: unknown, fallback: string): string =>
  String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || fallback

/** تطبيع مسار القسم لمفتاح النسخة الواحدة: بلا استعلام، وبشرطة مائلة أولى */
export function normalizeSectionPath(path: unknown): string {
  const raw = String(path ?? '').trim()
  const noQuery = raw.split('?')[0].split('#')[0]
  if (!noQuery || noQuery === '/') return '/'
  return noQuery.startsWith('/') ? noQuery : `/${noQuery}`
}

function allAppWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = []
  const main = deps?.getMainWindow()
  if (main && !main.isDestroyed()) wins.push(main)
  for (const entry of byId.values()) if (!entry.win.isDestroyed()) wins.push(entry.win)
  return wins
}

function registrySnapshot(): unknown[] {
  return [...byId.values()].map((e) => ({
    windowId: e.windowId, type: e.type, kind: e.kind, sectionPath: e.sectionPath,
    title: e.title, dedupeKey: e.dedupeKey, parentId: e.parentId, dirty: e.dirty,
  }))
}

function broadcastRegistry(): void {
  const snapshot = registrySnapshot()
  for (const win of allAppWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send('windows:registry', snapshot)
  }
}

/** تُستدعى من معالج حفظ اللقطة في main.ts بعد نجاح الحفظ في SQLite */
export function broadcastSnapshotChanged(senderWcId: number, storeName: string, revision: number): void {
  for (const win of allAppWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed() && wc.id !== senderWcId) wc.send('database:snapshot-changed', { storeName, revision })
  }
}

export function satellitesOpenCount(): number { return byId.size }
export function satelliteWebContents(): WebContents[] {
  return [...byId.values()].filter((e) => !e.win.isDestroyed()).map((e) => e.win.webContents)
}

function focusEntry(entry: SatEntry): void {
  if (entry.win.isDestroyed()) return
  if (entry.win.isMinimized()) entry.win.restore()
  entry.win.show()
  entry.win.focus()
}

function secureSatellite(win: BrowserWindow, entry: SatEntry): void {
  if (!deps) return
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalOpenable(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isInAppNavigation(url, deps!.appIndexFileUrl, deps!.devOrigin)) return
    event.preventDefault()
    deps!.log('security', `منع تنقل غير مسموح (قمر ${entry.windowId}): ${url.slice(0, 120)}`)
    if (isExternalOpenable(url)) void shell.openExternal(url)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    deps!.log('renderer-gone', `قمر ${entry.windowId} (${entry.title}): ${details.reason} / ${details.exitCode}`)
    if (!win.isDestroyed()) win.destroy()
  })
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame) deps!.log('satellite-load', `فشل تحميل قمر ${entry.windowId}: ${code} ${desc} ${failedUrl.slice(0, 120)}`)
  })
}

function loadSatellite(entry: SatEntry, hashPath: string): void {
  if (!deps) return
  const token = randomBytes(12).toString('hex')
  tokens.set(token, entry.windowId)
  if (deps.isDev && deps.devStartUrl) {
    const url = new URL(deps.devStartUrl)
    url.searchParams.set('sat', token)
    url.hash = hashPath
    void entry.win.loadURL(url.toString()).catch((error: unknown) => {
      deps!.log('satellite-load', `loadURL قمر ${entry.windowId}: ${error instanceof Error ? error.message : String(error)}`)
    })
  } else {
    void entry.win.loadFile(deps.indexFilePath, { search: `sat=${token}`, hash: hashPath }).catch((error: unknown) => {
      deps!.log('satellite-load', `loadFile قمر ${entry.windowId}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

function createSatelliteWindow(init: {
  windowId: string
  type: 'section' | 'view'
  kind: string | null
  sectionPath: string | null
  fullPath: string
  title: string
  dedupeKey: string | null
  parentId: string | null
  ownerWcId: number
  requestId: string | null
  width: number
  height: number
  maximized: boolean
  descriptor: Record<string, unknown>
}): SatEntry {
  const parentWin = init.parentId && init.parentId !== 'main' ? byId.get(init.parentId)?.win : undefined
  const win = new BrowserWindow({
    width: init.width,
    height: init.height,
    minWidth: 640,
    minHeight: 420,
    title: init.title,
    show: false,
    autoHideMenuBar: true,
    icon: deps!.iconPath,
    ...(parentWin && !parentWin.isDestroyed() ? { parent: parentWin } : {}),
    webPreferences: {
      preload: deps!.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  const entry: SatEntry = {
    windowId: init.windowId, win, webContentsId: win.webContents.id, type: init.type, kind: init.kind, sectionPath: init.sectionPath,
    title: init.title, dedupeKey: init.dedupeKey, parentId: init.parentId, ownerWcId: init.ownerWcId,
    requestId: init.requestId, dirty: false, claimed: false, rendererReady: false, forceClose: false, closing: false,
    descriptor: init.descriptor,
  }
  byId.set(entry.windowId, entry)
  byWcId.set(entry.webContentsId, entry.windowId)
  deps?.authorizeSatellite?.(win.webContents.id)
  if (init.requestId) requests.set(init.requestId, { ownerWcId: init.ownerWcId, windowId: entry.windowId })
  secureSatellite(win, entry)
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (init.maximized) win.maximize()
    win.show()
  })
  win.on('close', (event) => {
    if (entry.forceClose) return
    event.preventDefault()
    void attemptClose(entry)
  })
  win.on('closed', () => {
    byId.delete(entry.windowId)
    /* Electron أعدم BrowserWindow/WebContents قبل إطلاق `closed`؛ لا تستدعِ
       entry.win.webContents هنا، وإلا يُرمى Object has been destroyed داخل main. */
    byWcId.delete(entry.webContentsId)
    deps?.forgetSatellite?.(entry.webContentsId)
    if (entry.requestId) requests.delete(entry.requestId)
    for (const [token, id] of tokens) if (id === entry.windowId) tokens.delete(token)
    /* يتيمات القمر المنهار: تُغلق قسراً — أمّها اختفت ولا معنى لبقائها */
    for (const child of [...byId.values()].filter((c) => c.parentId === entry.windowId)) {
      child.forceClose = true
      if (!child.win.isDestroyed()) child.win.close()
    }
    broadcastRegistry()
  })
  loadSatellite(entry, init.fullPath)
  broadcastRegistry()
  return entry
}

function handshakeClose(entry: SatEntry): Promise<boolean> {
  if (!entry.claimed || entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return Promise.resolve(true)
  /* لا يوجد محرر/مستمع جاهز بعد: لم تُعرض واجهة عمل يمكن أن تحتوي مسودة.
     إن كانت حالة dirty قد وصلت مبكراً، لا نتجاوز المصافحة حفاظاً على البيانات. */
  if (!entry.rendererReady && !entry.dirty) {
    deps?.log('satellite-close', `إغلاق مباشر لقمر ${entry.windowId} قبل جاهزية واجهة العمل`)
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    const token = randomBytes(10).toString('hex')
    const timer = setTimeout(() => {
      closeResponders.delete(token)
      deps?.log('satellite-close', `انتهت مهلة مصافحة إغلاق ${entry.windowId} — أُلغي الإغلاق حفاظاً على البيانات`)
      resolve(false)
    }, 10_000)
    closeResponders.set(token, { wcId: entry.win.webContents.id, resolve: (allow) => { clearTimeout(timer); resolve(allow) } })
    /* حوار التأكيد يُرسم داخل وثيقة القمر نفسه — لو كانت نافذة أخرى أمامه
       يختفي السؤال حتى تنتهي المهلة صامتاً. نرفع النافذة أولاً ليظهر السؤال
       أمام المستخدم فوراً (طلب المالك: «حتى ينتبه لها»). */
    focusEntry(entry)
    entry.win.webContents.send('windows:request-close', { token })
  })
}

/** إغلاق قمر بمصافحة أبنائه أولاً — أي اعتراض يوقف السلسلة ويركّز المعترضة */
async function attemptClose(entry: SatEntry): Promise<boolean> {
  if (entry.win.isDestroyed()) return true
  if (entry.closing) return false
  entry.closing = true
  try {
    const children = [...byId.values()].filter((c) => c.parentId === entry.windowId && !c.win.isDestroyed())
    for (const child of children) {
      if (!(await attemptClose(child))) { focusEntry(child); return false }
    }
    const allow = await handshakeClose(entry)
    if (!allow) { focusEntry(entry); return false }
    entry.forceClose = true
    if (!entry.win.isDestroyed()) entry.win.close()
    return true
  } finally {
    entry.closing = false
  }
}

/**
 * حارس إغلاق النافذة الرئيسية (قاعدة المالك: لا تُغلق الرئيسية وبناتها مفتوحة):
 * يسأل المستخدم، وعند التأكيد يغلق الأقمار الجذرية بسلسلتها. يعيد true فقط
 * إذا أُغلقت كل الأقمار فعلاً — عندها تستطيع الرئيسية متابعة إغلاقها.
 */
export async function confirmAndCloseAllSatellites(): Promise<boolean> {
  if (!deps || byId.size === 0) return true
  const titles = [...byId.values()].map((e) => `• ${e.title}${e.dirty ? ' (تعديلات غير محفوظة ●)' : ''}`).join('\n')
  const parent = deps.getMainWindow()
  const result = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, {
      type: 'question',
      title: 'تَحَكَّم — إغلاق البرنامج',
      message: `توجد ${byId.size} نافذة مفتوحة خارج النافذة الرئيسية:`,
      detail: `${titles}\n\nالنافذة الرئيسية لا تُغلق ونوافذها مفتوحة. «إغلاق الكل والخروج» سيطلب حفظ/تأكيد كل نافذة فيها عمل غير محفوظ أولاً.`,
      buttons: ['إغلاق الكل والخروج', 'إلغاء'],
      defaultId: 1, cancelId: 1, noLink: true,
    })
    : { response: 0 }
  if (result.response !== 0) {
    const first = [...byId.values()][0]
    if (first) focusEntry(first)
    return false
  }
  const roots = [...byId.values()].filter((e) => !e.parentId || e.parentId === 'main' || !byId.has(e.parentId))
  for (const root of roots) {
    if (!(await attemptClose(root))) return false
  }
  return byId.size === 0
}

function senderEntry(sender: WebContents): SatEntry | null {
  const id = byWcId.get(sender.id)
  return id ? byId.get(id) ?? null : null
}

/** Only the main window, a satellite itself, or its direct parent may control it. */
function mayControlSatellite(sender: WebContents, target: SatEntry, allowParent = true): boolean {
  const main = deps?.getMainWindow()
  if (main && !main.isDestroyed() && main.webContents.id === sender.id) return true
  const requester = senderEntry(sender)
  if (!requester) return false
  return requester.windowId === target.windowId || (allowParent && target.parentId === requester.windowId)
}

export function initSatelliteWindows(d: SatelliteDeps): void {
  deps = d

  ipcMain.handle('windows:open', (event, input: Record<string, unknown>) => {
    if (d.isSenderAuthorized && !d.isSenderAuthorized(event.sender.id)) return { ok: false, error: 'auth-required' }
    const windowId = String(input.windowId ?? '')
    if (!windowId) return { ok: false }
    const dedupeKey = typeof input.dedupeKey === 'string' && input.dedupeKey ? input.dedupeKey : null
    if (dedupeKey) {
      const existing = [...byId.values()].find((e) => e.dedupeKey === dedupeKey && !e.win.isDestroyed())
      if (existing) { focusEntry(existing); return { ok: true, deduped: true, existingId: existing.windowId } }
    }
    if (byId.has(windowId)) { focusEntry(byId.get(windowId)!); return { ok: true, deduped: true, existingId: windowId } }
    // لا نثق في parentId القادم من المصيّر؛ القمر لا ينشئ إلا أبناءه، والرئيسية أبناء مباشرين لها.
    const parentId = senderEntry(event.sender)?.windowId ?? 'main'
    const requestId = typeof input.requestId === 'string' && input.requestId ? input.requestId : null
    const title = cleanTitle(input.title, 'تَحَكَّم')
    createSatelliteWindow({
      windowId,
      type: 'view',
      kind: typeof input.kind === 'string' ? input.kind : null,
      sectionPath: null,
      fullPath: '/satellite-view',
      title,
      dedupeKey,
      parentId,
      ownerWcId: event.sender.id,
      requestId,
      width: clampSize(input.width, 1180, 420, 2560),
      height: clampSize(input.height, 760, 320, 1600),
      maximized: input.mode === 'maximized',
      descriptor: {
        windowId, type: 'view', kind: typeof input.kind === 'string' ? input.kind : null,
        title, subtitle: cleanTitle(input.subtitle, ''),
        props: (input.props && typeof input.props === 'object') ? input.props : {},
        callbackNames: Array.isArray(input.callbackNames) ? input.callbackNames.filter((n): n is string => typeof n === 'string') : [],
        requestId,
      },
    })
    return { ok: true }
  })

  ipcMain.handle('windows:open-section', (event, input: { path?: unknown; title?: unknown }) => {
    if (d.isSenderAuthorized && !d.isSenderAuthorized(event.sender.id)) return { ok: false, error: 'auth-required' }
    const normalized = normalizeSectionPath(input.path)
    if (normalized === '/') {
      const main = d.getMainWindow()
      if (main && !main.isDestroyed()) { if (main.isMinimized()) main.restore(); main.focus() }
      return { ok: true, main: true }
    }
    const fullPath = String(input.path ?? normalized)
    const existing = [...byId.values()].find((e) => e.type === 'section' && e.sectionPath === normalized && !e.win.isDestroyed())
    if (existing) {
      /* روابط عميقة (?focus=…) تُمرَّر للقمر القائم لينتقل إليها داخلياً */
      if (!existing.win.webContents.isDestroyed()) existing.win.webContents.send('windows:navigate', { path: fullPath })
      focusEntry(existing)
      return { ok: true, deduped: true, existingId: existing.windowId }
    }
    const title = cleanTitle(input.title, 'تَحَكَّم')
    const windowId = `sec-${randomBytes(6).toString('hex')}`
    createSatelliteWindow({
      windowId, type: 'section', kind: null, sectionPath: normalized,
      fullPath: fullPath.startsWith('/') ? fullPath : normalized,
      title, dedupeKey: `section:${normalized}`, parentId: 'main',
      ownerWcId: event.sender.id, requestId: null,
      width: 1280, height: 840, maximized: false,
      descriptor: { windowId, type: 'section', path: normalized, title },
    })
    return { ok: true, windowId }
  })

  ipcMain.handle('windows:claim', (event, token: unknown) => {
    if (d.isSenderAuthorized && !d.isSenderAuthorized(event.sender.id)) return null
    const windowId = typeof token === 'string' ? tokens.get(token) : undefined
    if (!windowId) return null
    const entry = byId.get(windowId)
    if (!entry || entry.win.webContents.id !== event.sender.id) return null
    tokens.delete(token as string)
    entry.claimed = true
    return entry.descriptor
  })

  ipcMain.handle('windows:list', () => registrySnapshot())

  ipcMain.on('windows:prop-invoke', (event, input: { requestId?: unknown; prop?: unknown; args?: unknown }) => {
    const requestId = typeof input.requestId === 'string' ? input.requestId : ''
    const req = requests.get(requestId)
    if (!req || typeof input.prop !== 'string') return
    /* لا يقبل الاستدعاء إلا من القمر صاحب الطلب نفسه */
    const caller = senderEntry(event.sender)
    if (!caller || caller.windowId !== req.windowId) return
    const owner = allAppWindows().find((w) => w.webContents.id === req.ownerWcId)
    if (owner && !owner.webContents.isDestroyed()) {
      owner.webContents.send('windows:prop-invoke', { requestId, prop: input.prop, args: Array.isArray(input.args) ? input.args : [] })
    }
  })

  ipcMain.on('windows:close-self', (event) => {
    const entry = senderEntry(event.sender)
    if (!entry) return
    void (async () => {
      const children = [...byId.values()].filter((c) => c.parentId === entry.windowId && !c.win.isDestroyed())
      for (const child of children) if (!(await attemptClose(child))) return
      entry.forceClose = true
      if (!entry.win.isDestroyed()) entry.win.close()
    })()
  })

  ipcMain.on('windows:request-close', (event, windowId: unknown) => {
    const entry = typeof windowId === 'string' ? byId.get(windowId) : undefined
    if (entry && mayControlSatellite(event.sender, entry)) void attemptClose(entry)
  })

  ipcMain.on('windows:focus', (event, windowId: unknown) => {
    const entry = typeof windowId === 'string' ? byId.get(windowId) : undefined
    if (entry && mayControlSatellite(event.sender, entry)) focusEntry(entry)
  })

  ipcMain.on('windows:minimize', (event, windowId: unknown) => {
    const entry = (typeof windowId === 'string' && byId.get(windowId)) || senderEntry(event.sender)
    if (entry && mayControlSatellite(event.sender, entry) && !entry.win.isDestroyed()) entry.win.minimize()
  })

  ipcMain.on('windows:toggle-maximize', (event, windowId: unknown) => {
    const entry = (typeof windowId === 'string' && byId.get(windowId)) || senderEntry(event.sender)
    if (!entry || !mayControlSatellite(event.sender, entry) || entry.win.isDestroyed()) return
    if (entry.win.isMaximized()) entry.win.unmaximize()
    else entry.win.maximize()
  })

  ipcMain.on('windows:set-title', (event, input: { title?: unknown; subtitle?: unknown }) => {
    const entry = senderEntry(event.sender)
    if (!entry) return
    entry.title = cleanTitle(input.title, entry.title)
    if (!entry.win.isDestroyed()) entry.win.setTitle(entry.title)
    broadcastRegistry()
  })

  ipcMain.on('windows:renderer-ready', (event, ready: unknown) => {
    const entry = senderEntry(event.sender)
    if (entry) entry.rendererReady = ready === true
  })

  ipcMain.on('windows:set-dirty', (event, dirty: unknown) => {
    const entry = senderEntry(event.sender)
    if (!entry) return
    const next = dirty === true
    if (entry.dirty !== next) { entry.dirty = next; broadcastRegistry() }
  })

  ipcMain.on('windows:close-response', (event, input: { token?: unknown; allow?: unknown }) => {
    const token = typeof input.token === 'string' ? input.token : ''
    const pending = closeResponders.get(token)
    /* الرد مقبول فقط من النافذة التي طُلب إغلاقها نفسها */
    if (pending && event.sender.id === pending.wcId) { closeResponders.delete(token); pending.resolve(input.allow === true) }
  })
}
