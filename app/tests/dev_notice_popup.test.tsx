/**
 * بند 10 (تدقيق 2026-10-08) — نوافذ التنبيه المنبثقة من المطوّر وإقرارات القراءة.
 *
 * ما كان: المطوّر يرسل تنبيهاً فيظهر في **الجرس** وتوست عابر فقط. لا نافذة
 * منبثقة، ولا درجة إلزام، ولا إيصال قراءة ⇒ المطوّر لا يعرف هل وصل تنبيهه
 * الحرج، والعميل قد لا يفتح الجرس أبداً.
 *
 * يثبت هذا الاختبار:
 *   ① ثلاث درجات: info (جرس/توست) · important (نافذة + «لاحقاً») · critical
 *      (نافذة بإقرار إلزامي — لا زر تأجيل ولا إغلاق).
 *   ② الافتراضي info ⇒ كل التنبيهات القديمة المحفوظة تعمل كما كانت (توافق رجعي).
 *   ③ نافذة واحدة في كل مرة: الأعلى درجة ثم الأحدث — لا تكديس.
 *   ④ الإقرار يُحفظ محلياً فلا تعود النافذة، ويُرسل إيصال قراءة للعامل
 *      (best-effort — فشله لا يعيد النافذة للعميل).
 *   ⑤ العامل يسجّل الإقرار مرة لكل جهاز، والمطوّر يرى عدد القراءات من اللوحة.
 *   ⑥ info لا يقطع العمل: لا نافذة ولا إشعار نظام تشغيل.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import React from 'react'

const { parseCloudNotices } = await import('../src/core/cloud.ts')
const {
  pendingPopupNotice, isAckMandatory, isPopupNotice, shouldAnnounceToast,
  noticeSeverity, osNotificationFor, sendNoticeAck,
  NOTICE_LEVEL_LABELS_AR,
} = await import('../src/core/devNotice.ts')
const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton, handlePanelText, recordNoticeAck, ackCountForNotice } = await import('../../tools/devbot/src/adminPanel.js')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { DevNoticeHost } = await import('../src/ui/components/DevNoticeModal.tsx')

class MemoryKv {
  private values = new Map<string, string>()
  /* metadata المفاتيح كما في KV الحقيقي: يُعاد من list() بلا نداء get إضافي */
  private metas = new Map<string, Record<string, unknown>>()
  async get(key: string) { return this.values.get(key) ?? null }
  async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
    this.values.set(key, String(value))
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key: string) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 }: { prefix?: string; limit?: number } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })), list_complete: true }
  }
}

const env_ = (kv: MemoryKv) => ({
  SHOPSYS_CONTROL: kv, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret', DEV_PRIVATE_KEY_B64U: 'unused-here',
})

/* createdAt صريح قابل للضبط — «الأحدث أولاً» يحتاج ترتيباً معروفاً لا مشتقاً من المعرف */
const notice = (id: string, level?: string, extra: Record<string, unknown> = {}) => ({
  id, title: `عنوان ${id}`, body: `نص التنبيه ${id}`, createdAt: '2026-10-01T08:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z', ...(level ? { level } : {}), ...extra,
})

const parsed = (list: unknown[]) => parseCloudNotices(list) as { id: string; level: string; requiresAck: boolean; title: string; body: string }[]

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  useAppStore.setState({ cloudNotifications: [], ackedNoticeIds: [], deviceId: 'SHOP-AAA1-1111-1111' })
})
afterEach(() => cleanup())

describe('①② الدرجات والتوافق الرجعي', () => {
  it('بلا حقل level ⇒ info مع requiresAck=false (التنبيهات القديمة كما كانت)', () => {
    const [n] = parsed([notice('n1')])
    expect(n.level).toBe('info')
    expect(n.requiresAck).toBe(false)
    expect(isPopupNotice(n as never)).toBe(false)
    expect(shouldAnnounceToast(n as never)).toBe(true)
    expect(noticeSeverity(n as never)).toBe('info')
  })

  it('important ⇒ نافذة قابلة للتأجيل + إيصال قراءة', () => {
    const [n] = parsed([notice('n2', 'important')])
    expect(n.level).toBe('important')
    expect(n.requiresAck).toBe(true)
    expect(isPopupNotice(n as never)).toBe(true)
    expect(isAckMandatory(n as never)).toBe(false)
    expect(noticeSeverity(n as never)).toBe('warn')
    expect(shouldAnnounceToast(n as never)).toBe(false) // النافذة تكفي — لا توست معها
  })

  it('critical ⇒ إقرار إلزامي', () => {
    const [n] = parsed([notice('n3', 'critical')])
    expect(isAckMandatory(n as never)).toBe(true)
    expect(noticeSeverity(n as never)).toBe('danger')
  })

  it('درجة مجهولة ⇒ info، والعنوان والجسم يُعقَّمان', () => {
    const [n] = parsed([notice('n4', 'weird', { title: '<b>عنوان</b>', body: 'a<b>c' })])
    expect(n.level).toBe('info')
    expect(n.title).not.toContain('<')
    expect(n.body).not.toContain('<')
  })

  it('⑥ إشعار نظام التشغيل للمهم/العاجل فقط', () => {
    expect(osNotificationFor(parsed([notice('n1')])[0] as never)).toBeNull()
    const os = osNotificationFor(parsed([notice('n3', 'critical')])[0] as never)!
    expect(os.title).toContain('عاجل')
    expect(os.body).toContain('نص التنبيه')
  })

  it('تسميات عربية لكل درجة', () => {
    expect(NOTICE_LEVEL_LABELS_AR.critical).toBe('تنبيه عاجل')
    expect(NOTICE_LEVEL_LABELS_AR.important).toBe('تنبيه مهم')
    expect(NOTICE_LEVEL_LABELS_AR.info).toBe('إعلان')
  })
})

describe('③ نافذة واحدة: الأعلى درجة ثم الأحدث', () => {
  it('critical يسبق important مهما كان الترتيب', () => {
    const all = parsed([notice('imp', 'important'), notice('crit', 'critical')])
    expect(pendingPopupNotice(all as never)!.id).toBe('crit')
  })

  it('بلا critical ⇒ الأحدث من important', () => {
    const all = parsed([
      notice('old', 'important', { createdAt: '2026-10-01T08:00:00Z' }),
      notice('new1', 'important', { createdAt: '2026-10-05T08:00:00Z' }),
    ])
    expect(pendingPopupNotice(all as never)!.id).toBe('new1')
  })

  it('المُقرّ والمؤجَّل يُستبعدان، وinfo لا نافذة له', () => {
    const all = parsed([notice('a', 'critical'), notice('b', 'important')])
    expect(pendingPopupNotice(all as never, { ackedIds: ['a'] })!.id).toBe('b')
    expect(pendingPopupNotice(all as never, { ackedIds: ['a'], snoozedIds: ['b'] })).toBeNull()
    expect(pendingPopupNotice(parsed([notice('x')]) as never)).toBeNull()
    expect(pendingPopupNotice([])).toBeNull()
  })
})

describe('④ المتجر والإيصال', () => {
  it('ackNotice يحفظ مرة واحدة ويقتصر على 200 معرّف', () => {
    const store = useAppStore.getState()
    store.ackNotice('a')
    store.ackNotice('a') // مكرر ⇒ لا تغيير
    expect(useAppStore.getState().ackedNoticeIds).toEqual(['a'])
    for (let i = 0; i < 250; i += 1) useAppStore.getState().ackNotice(`n${i}`)
    expect(useAppStore.getState().ackedNoticeIds).toHaveLength(200)
    expect(useAppStore.getState().ackedNoticeIds).not.toContain('a')
    useAppStore.getState().ackNotice('') // فارغ ⇒ يُتجاهل
    expect(useAppStore.getState().ackedNoticeIds).toHaveLength(200)
  })

  it('sendNoticeAck: sent / failed ولا يرمي استثناء أبداً', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(sendNoticeAck('https://x.dev/', 'id1', 'SHOP-AAA1-1111-1111')).resolves.toBe('sent')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })))
    await expect(sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111')).resolves.toBe('failed')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await expect(sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111')).resolves.toBe('failed')

    await expect(sendNoticeAck('https://x.dev', '', 'SHOP-AAA1-1111-1111')).resolves.toBe('failed')
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('sync') }))
    await expect(sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111')).resolves.toBe('failed')
  })
})

describe('النافذة في الواجهة', () => {
  const setNotices = (list: unknown[]) => useAppStore.setState({ cloudNotifications: parsed(list) as never })

  it('critical ⇒ نافذة بلا «لاحقاً»، والإقرار يغلقها ويحفظه', () => {
    setNotices([notice('c1', 'critical', { body: 'سيتوقف الدعم عن هذا الإصدار' })])
    render(<DevNoticeHost />)
    expect(screen.getByText(/سيتوقف الدعم عن هذا الإصدار/)).toBeTruthy()
    expect(screen.getByText(/يلزم الإقرار بالقراءة/)).toBeTruthy()
    expect(screen.queryByTestId('dev-notice-snooze')).toBeNull()

    fireEvent.click(screen.getByTestId('dev-notice-ack'))
    expect(useAppStore.getState().ackedNoticeIds).toContain('c1')
    expect(screen.queryByText(/سيتوقف الدعم عن هذا الإصدار/)).toBeNull()
  })

  it('important ⇒ «لاحقاً» يؤجلها لهذه الجلسة دون إقرار', () => {
    setNotices([notice('i1', 'important')])
    render(<DevNoticeHost />)
    expect(screen.getByTestId('dev-notice-snooze')).toBeTruthy()
    fireEvent.click(screen.getByTestId('dev-notice-snooze'))
    expect(screen.queryByTestId('dev-notice-ack')).toBeNull() // اختفت
    expect(useAppStore.getState().ackedNoticeIds).not.toContain('i1') // لم تُقرّ
  })

  it('info ⇒ لا نافذة إطلاقاً (بلا مقاطعة)', () => {
    setNotices([notice('n1')])
    const { container } = render(<DevNoticeHost />)
    expect(container.textContent).toBe('')
  })

  it('نافذة واحدة فقط عند وجود تنبيهين', () => {
    setNotices([notice('i2', 'important'), notice('c2', 'critical')])
    render(<DevNoticeHost />)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.getByText(/نص التنبيه c2/)).toBeTruthy()
  })

  it('الإقرار المُحفوظ مسبقاً ⇒ لا نافذة بعد الإقلاع', () => {
    setNotices([notice('c3', 'critical')])
    useAppStore.setState({ ackedNoticeIds: ['c3'] })
    const { container } = render(<DevNoticeHost />)
    expect(container.textContent).toBe('')
  })
})

describe('⑤ العامل: إقرار القراءة وعدد القراءات', () => {
  let kv: MemoryKv
  /* الإقرار لا يُقبل إلا لتنبيه **موجود فعلاً** — وإلا صارت النقطة العامة كتابةً
     مفتوحة تُنشئ notice-acks:<عشوائي> بلا حد وتُضخّم إحصاء المطوّر. */
  beforeEach(async () => {
    kv = new MemoryKv()
    await kv.put('notices:global', JSON.stringify([{ id: 'n-1', body: 'تنبيه', level: 'critical', createdAt: '2026-10-08T00:00:00Z' }]))
  })

  const postAck = async (noticeId: string, deviceId: unknown, method = 'POST') => {
    const request = new Request(`https://shopsys-control/notifications/${noticeId}/ack`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ deviceId }) } : {}),
    })
    return await devbotWorker.fetch(request, env_(kv)) as Response
  }

  it('يسجّل الإقرار مرة لكل جهاز — والعدد يُقرأ من اللوحة لا من الرد العام', async () => {
    const first = await postAck('n-1', 'SHOP-AAA1-1111-1111')
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true }) // لا count: نقطة عامة

    const dup = await postAck('n-1', 'SHOP-AAA1-1111-1111')
    expect(await dup.json()).toEqual({ ok: true })
    expect(await ackCountForNotice({ kv }, 'n-1')).toBe(1) // لا تضخيم للعدد

    const other = await postAck('n-1', 'SHOP-BBB2-2222-2222')
    expect(await other.json()).toEqual({ ok: true })
    expect(await ackCountForNotice({ kv }, 'n-1')).toBe(2)
  })

  it('تنبيه غير موجود ⇒ 400 ولا مفتاح notice-acks يُنشأ (كتابة عامة محدودة الأثر)', async () => {
    const res = await postAck('not-exists-999', 'SHOP-AAA1-1111-1111')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
    expect(await kv.get('notice-acks:not-exists-999')).toBeNull()
    expect(await ackCountForNotice({ kv }, 'not-exists-999')).toBe(0)
    /* ولا يُقبل إقرار جهاز لتنبيه خاص بجهاز آخر */
    await kv.put('notices:SHOP-CCC3-3333-3333', JSON.stringify([{ id: 'p-1', body: 'خاص', level: 'info' }]))
    expect((await postAck('p-1', 'SHOP-AAA1-1111-1111')).status).toBe(400)
    expect((await postAck('p-1', 'SHOP-CCC3-3333-3333')).status).toBe(200)
  })

  it('يرفض معرّف جهاز تالف وطلب غير POST', async () => {
    expect((await postAck('n-1', 'javascript:alert(1)')).status).toBe(400)
    expect((await postAck('n-1', '')).status).toBe(400)
    expect((await postAck('n-1', 'SHOP-AAA1-1111-1111', 'GET')).status).toBe(405)
    expect(await ackCountForNotice({ kv }, 'n-1')).toBe(0)
  })

  it('recordNoticeAck يرفض المعرفات التالفة والتنبيه غير الموجود', async () => {
    expect((await recordNoticeAck({ kv }, '', 'SHOP-AAA1-1111-1111')).ok).toBe(false)
    expect((await recordNoticeAck({ kv }, 'n-1', 'abc')).ok).toBe(false)
    expect(await recordNoticeAck({ kv }, 'n-ghost', 'SHOP-AAA1-1111-1111')).toMatchObject({ ok: false, reason: 'unknown notice' })
    expect((await recordNoticeAck({ kv }, 'n-1', 'SHOP-AAA1-1111-1111')).ok).toBe(true)
  })

  it('اللوحة: قائمة الدرجات ثم الحفظ بالدرجة المختارة + عدد القراءات', async () => {
    const levels = await handlePanelButton('panel:notice:all', '777', { kv } as never) as { opts: { reply_markup: { inline_keyboard: { callback_data: string; text: string }[][] } } }
    const buttons = levels.opts.reply_markup.inline_keyboard.flat()
    expect(buttons.map((b) => b.callback_data)).toContain('panel:noticelevel:critical:global')
    expect(buttons.map((b) => b.callback_data)).toContain('panel:noticelevel:info:global')

    await handlePanelButton('panel:noticelevel:critical:global', '777', { kv } as never)
    const saved = await handlePanelText('تحديث مهم: حدّثوا التطبيق', '777', { kv } as never) as { text: string }
    expect(saved.text).toContain('إقرار إلزامي')

    const stored = JSON.parse((await kv.get('notices:global'))!) as { level: string; requiresAck: boolean; body: string }[]
    expect(stored[0]).toMatchObject({ level: 'critical', requiresAck: true, body: 'تحديث مهم: حدّثوا التطبيق' })

    await recordNoticeAck({ kv }, stored[0] ? JSON.parse((await kv.get('notices:global'))!)[0].id : '', 'SHOP-AAA1-1111-1111')
    const list = await handlePanelButton('panel:noticelist', '777', { kv } as never) as { text: string }
    expect(list.text).toContain('عاجل')
    expect(list.text).toContain('قرأه 1 جهاز')
  })

  it('كل مداخل التنبيه (الجميع/العميل/الجهاز) تمرّ عبر قائمة الدرجات', async () => {
    await kv.put('dev:SHOP-AAA1-1111-1111', JSON.stringify({ customer: 'بقالة النور', plan: 'basic', expiresAt: null, fingerprint: 'abcdef01', email: '' }))
    const flat = (reply: unknown) => ((reply as { opts: { reply_markup: { inline_keyboard: { callback_data: string; text: string }[][] } } })
      .opts.reply_markup.inline_keyboard.flat())

    // أ) قائمة العملاء ← اسم العميل ← «تنبيه لكل أجهزة العميل»
    const groups = flat(await handlePanelButton('panel:clients', '777', { kv } as never))
    const groupBtn = groups.find((b) => b.callback_data.startsWith('group:'))!
    const groupRows = flat(await handlePanelButton(groupBtn.callback_data, '777', { kv } as never))
    const noticeGroupBtn = groupRows.find((b) => b.callback_data.startsWith('notice-group:'))!
    const levelsA = flat(await handlePanelButton(noticeGroupBtn.callback_data, '777', { kv } as never))
    const hash = noticeGroupBtn.callback_data.split(':')[1]
    expect(levelsA.map((b) => b.callback_data)).toContain(`panel:noticelevel:critical:customer:${hash}`)

    // ب) جهاز بعينه ← «إرسال تنبيه لهذا العميل»
    const deviceRows = flat(await handlePanelButton('client:SHOP-AAA1-1111-1111', '777', { kv } as never))
    const deviceNoticeBtn = deviceRows.find((b) => b.callback_data === 'notice:SHOP-AAA1-1111-1111')!
    const levelsB = flat(await handlePanelButton(deviceNoticeBtn.callback_data, '777', { kv } as never))
    expect(levelsB.map((b) => b.callback_data)).toContain(`panel:noticelevel:important:customer:${hash}`)

    // ج) المدخل القديم notice:all
    const levelsC = flat(await handlePanelButton('notice:all', '777', { kv } as never))
    expect(levelsC.map((b) => b.callback_data)).toContain('panel:noticelevel:info:global')
  })
})
