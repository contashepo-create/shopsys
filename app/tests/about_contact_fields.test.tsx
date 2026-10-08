/**
 * بند 9 (تدقيق 2026-10-08) — بيانات التواصل في صفحة «حول» + حقول تُملأ من اللوحة.
 *
 * ما كان: `AboutContent` ثلاثة حقول (هاتف/تليجرام/موقع) **ولا تستطيع اللوحة ملء
 * أيٍّ منها** — `/حول` وزر «تعديل حول» يكتبان نصاً خاماً في `body`، والعامل يعيد
 * `{...fallback, body: raw}` فتبقى الحقول فارغة للأبد. والنتيجة الأخطر: عميل انتهى
 * اشتراكه ولا إنترنت عنده لا يجد **أي** وسيلة تواصل على شاشة القفل.
 *
 * يثبت هذا الاختبار:
 *   ① الحقول الجديدة تُقرأ وتُعرض، واللوحة تملؤها حقلاً حقلاً (لا نص خام).
 *   ② `/حول` يدمج في المستند ولا يمسح حقول التواصل التي ضبطها المطوّر.
 *   ③ التعقيم: الروابط http/https/mailto/tel فقط — المحتوى يُعرض في href عند
 *      كل العملاء فأي javascript:/data: يصير تنفيذ كود عندهم.
 *   ④ التوافق الرجعي: قيمة `about` القديمة النص خام تُقرأ كـbody ولا يُفقد شيء.
 *   ⑤ حقول حرة يضيفها المطوّر وتظهر للعميل (طلب المالك: «حقول يمكن إضافتها»).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import React from 'react'

const { parseAbout, FALLBACK_ABOUT, hasAboutContact, whatsappLink, sanitizeAboutUrl,
  sanitizeAboutPhone, sanitizeAboutWhatsapp, sanitizeAboutTelegram, sanitizeAboutEmail,
  sanitizeAboutText } = await import('../src/core/cloud.ts')
const devbotWorker = (await import('../../tools/devbot/src/worker.js')).default
const { handlePanelButton, handlePanelText } = await import('../../tools/devbot/src/adminPanel.js')
const {
  ABOUT_FIELDS, readAbout, setAboutField, addAboutExtraField, removeAboutExtraField,
  addAboutSocialLink, removeAboutSocialLink, previewAboutAr, DEFAULT_ABOUT,
} = await import('../../tools/devbot/src/aboutContent.js')
const { AboutPage } = await import('../src/ui/pages/AboutPage.tsx')
const { useAppStore } = await import('../src/stores/app.store.ts')

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
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

const env_ = (kv: MemoryKv) => ({
  SHOPSYS_CONTROL: kv,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_ADMIN_ID: '777',
  WEBHOOK_SECRET: 'hook-secret',
  DEV_PRIVATE_KEY_B64U: 'unused-here',
})

const aboutViaWorker = async (kv: MemoryKv) => {
  const res = await devbotWorker.fetch(new Request('https://x.dev/about'), env_(kv)) as Response
  return await res.json() as Record<string, unknown>
}

const CONTACTS = {
  supportPhone: '+20 100 123 4567',
  supportWhatsapp: '201001234567',
  supportTelegram: 'tahakam_support',
  supportEmail: 'support@tahakam.app',
  website: 'https://tahakam.app',
  address: 'المنزلة — الدقهلية — مصر',
  workHours: 'السبت–الخميس 9ص–6م',
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  useAppStore.setState({ cloudAbout: null, cloudAboutAt: 0 })
})

describe('③ التعقيم — لا تنفيذ كود عند العميل عبر روابط «حول»', () => {
  it('يرفض javascript: وdata: ويقبل https وmailto وtel', () => {
    expect(sanitizeAboutUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeAboutUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(sanitizeAboutUrl('JaVaScRiPt:alert(1)')).toBe('')
    expect(sanitizeAboutUrl('https://tahakam.app/x?a=1')).toBe('https://tahakam.app/x?a=1')
    expect(sanitizeAboutUrl('mailto:s@tahakam.app')).toBe('mailto:s@tahakam.app')
    expect(sanitizeAboutUrl('tel:+201001234567')).toBe('tel:+201001234567')
  })

  it('يزرع الاقتباسات والمحارف التي تكسر سمة href', () => {
    expect(sanitizeAboutUrl('https://a.app/" onclick="alert(1)')).toBe('')
    expect(sanitizeAboutUrl('https://a.app/<b>')).toBe('')
    expect(sanitizeAboutText('a<b>script</b>c')).toBe('abscript/bc') // الوسوم تُنزع، والشرطة تبقى (تواريخ/عناوين)
    expect(sanitizeAboutText('x\u0000y\u200Bz')).toBe('xyz')
  })

  it('الهاتف/واتساب/تليجرام/البريد بأنماط صارمة', () => {
    expect(sanitizeAboutPhone('abc')).toBe('')
    expect(sanitizeAboutPhone('+20 100 123 4567')).toBe('+20 100 123 4567')
    expect(sanitizeAboutWhatsapp('+20 100-123-4567')).toBe('201001234567')
    expect(sanitizeAboutWhatsapp('123')).toBe('') // أقصر من 8 خانات
    expect(sanitizeAboutTelegram('@tahakam_support')).toBe('tahakam_support')
    expect(sanitizeAboutTelegram('t.me/bad name')).toBe('')
    expect(sanitizeAboutEmail('not-an-email')).toBe('')
    expect(sanitizeAboutEmail('support@tahakam.app')).toBe('support@tahakam.app')
  })

  it('parseAbout يُسقِط الحقول التالفة ويُبقي الافتراضي', () => {
    const parsed = parseAbout({
      title: '<b>عنوان</b>',
      body: '',
      supportEmail: 'javascript:alert(1)',
      website: 'javascript:alert(1)',
      supportTelegram: '@ok_user',
      socialLinks: [{ label: 'فيسبوك', url: 'javascript:alert(1)' }, { label: 'يوتيوب', url: 'https://yt.com/x' }],
      extraFields: [{ label: 'الرقم الضريبي', value: '123' }, { label: '', value: 'بلا اسم' }],
    })
    expect(parsed.title).toBe('bعنوان/b') // الوسوم تُنزع، والنص يبقى مقروءاً
    expect(parsed.body).toBe(FALLBACK_ABOUT.body) // فارغ ⇒ الافتراضي
    expect(parsed.supportEmail).toBe('')
    expect(parsed.website).toBe('')
    expect(parsed.supportTelegram).toBe('ok_user')
    expect(parsed.socialLinks).toEqual([{ label: 'يوتيوب', url: 'https://yt.com/x' }])
    expect(parsed.extraFields).toEqual([{ label: 'الرقم الضريبي', value: '123' }])
  })

  it('حدود الطول: 8 قنوات و20 حقلاً حراً', () => {
    const parsed = parseAbout({
      socialLinks: Array.from({ length: 30 }, (_s, i) => ({ label: `ق${i}`, url: `https://a.app/${i}` })),
      extraFields: Array.from({ length: 30 }, (_s, i) => ({ label: `ح${i}`, value: `ق${i}` })),
    })
    expect(parsed.socialLinks.length).toBe(8)
    expect(parsed.extraFields.length).toBe(20)
  })

  it('whatsappLink وhasAboutContact', () => {
    expect(whatsappLink('201001234567')).toBe('https://wa.me/201001234567')
    expect(whatsappLink('')).toBe('')
    expect(hasAboutContact(FALLBACK_ABOUT)).toBe(false)
    expect(hasAboutContact({ ...FALLBACK_ABOUT, supportEmail: 'a@b.co' })).toBe(true)
  })
})

describe('①② اللوحة تملأ الحقول و/حول لا يمسحها', () => {
  let kv: MemoryKv
  beforeEach(async () => { kv = new MemoryKv() })

  it('الحالة الابتدائية: الافتراضي بلا تواصل + تحذير للمطوّر', async () => {
    expect(await aboutViaWorker(kv)).toMatchObject({ supportEmail: '', supportWhatsapp: '' })
    const menu = await handlePanelButton('panel:about', '777', { kv } as never) as { text: string }
    expect(menu.text).toContain('ناقص')
    expect(menu.text).toContain('لن يجد طريقة تواصل')
  })

  it('setAboutField يحفظ كل حقل على حدة ويُعقَّم خادمياً', async () => {
    for (const [key, value] of Object.entries(CONTACTS)) {
      const res = await setAboutField({ kv } as never, key, value)
      expect(res.ok).toBe(true)
    }
    const doc = await aboutViaWorker(kv)
    expect(doc.supportEmail).toBe('support@tahakam.app')
    expect(doc.supportWhatsapp).toBe('201001234567')
    expect(doc.supportTelegram).toBe('tahakam_support')
    expect(doc.address).toBe('المنزلة — الدقهلية — مصر')
    expect(typeof doc.updatedAt).toBe('string')
    // لا تحذير بعد اكتمال قنوات التواصل
    const menu = await handlePanelButton('panel:about', '777', { kv } as never) as { text: string }
    expect(menu.text).not.toContain('ناقص')
  })

  it('يرفض القيم التالفة بسبب عربي واضح ولا يحفظها', async () => {
    const bad = await setAboutField({ kv } as never, 'website', 'javascript:alert(1)')
    expect(bad.ok).toBe(false)
    expect((bad as { reasonAr: string }).reasonAr).toContain('https://')
    expect(await readAbout({ kv } as never)).toMatchObject({ website: '' })

    const badWa = await setAboutField({ kv } as never, 'supportWhatsapp', 'واتساب')
    expect(badWa.ok).toBe(false)
  })

  it('② /حول يدمج في body ولا يمحو بيانات التواصل', async () => {
    await setAboutField({ kv } as never, 'supportEmail', CONTACTS.supportEmail)
    await setAboutField({ kv } as never, 'supportPhone', CONTACTS.supportPhone)
    // الأمر القديم كان يكتب نصاً خاماً فيمسح المستند كله
    // (الرد على تليجرام ينجح هنا — نريد عزل سلوك الحفظ لا سلوك الشبكة)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const hook = new Request('https://shopsys-control/telegram/hook-secret', {
      method: 'POST',
      // الويبهوك محمي بسرّ تليجرام في الترويسة — بلاها 403 قبل أي معالجة
      headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' },
      body: JSON.stringify({
        update_id: 1,
        message: { message_id: 1, text: '/حول نظام محاسبي عربي يعمل بلا إنترنت', from: { id: 777 }, chat: { id: 777 } },
      }),
    })
    await devbotWorker.fetch(hook, env_(kv))
    const doc = await aboutViaWorker(kv)
    expect(doc.body).toBe('نظام محاسبي عربي يعمل بلا إنترنت')
    expect(doc.supportEmail).toBe('support@tahakam.app')
    expect(doc.supportPhone).toBe('+20 100 123 4567')
  })

  it('مسار اللوحة: زر الحقل ← كتابة القيمة ← حفظ', async () => {
    const menu = await handlePanelButton('panel:about', '777', { kv } as never) as { opts: { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } } }
    const emailBtn = menu.opts.reply_markup.inline_keyboard.flat().find((b) => b.callback_data === 'panel:aboutfield:supportEmail')
    expect(emailBtn).toBeTruthy()
    const prompt = await handlePanelButton(emailBtn!.callback_data, '777', { kv } as never) as { text: string }
    expect(prompt.text).toContain('البريد الإلكتروني')

    const saved = await handlePanelText('support@tahakam.app', '777', { kv } as never) as { text: string }
    expect(saved.text).toContain('حُدّث الحقل')
    expect((await aboutViaWorker(kv)).supportEmail).toBe('support@tahakam.app')
  })

  it('④ التوافق الرجعي: قيمة قديمة نص خام ⇒ body', async () => {
    await kv.put('about', 'نص قديم محفوظ قبل التحديث')
    const doc = await aboutViaWorker(kv)
    expect(doc.body).toBe('نص قديم محفوظ قبل التحديث')
    expect(doc.title).toBe(DEFAULT_ABOUT.title)
    // ولا يضيع عند تحرير حقل آخر بعده
    await setAboutField({ kv } as never, 'supportEmail', 'a@b.co')
    expect((await aboutViaWorker(kv)).body).toBe('نص قديم محفوظ قبل التحديث')
  })

  it('JSON تالف ⇒ الافتراضي بلا انهيار', async () => {
    await kv.put('about', '{"title": مكسور')
    expect((await aboutViaWorker(kv)).title).toBe(DEFAULT_ABOUT.title)
  })
})

describe('⑤ حقول حرة وقنوات إضافية من اللوحة', () => {
  let kv: MemoryKv
  beforeEach(async () => { kv = new MemoryKv() })

  it('إضافة حقل حر برابط، وعرضه للعميل', async () => {
    const res = await addAboutExtraField({ kv } as never, { label: 'الرقم الضريبي', value: '100-200-300', url: '' })
    expect(res.ok).toBe(true)
    await addAboutExtraField({ kv } as never, { label: 'فرع المنصورة', value: 'توريل الجديدة', url: 'https://maps.app/x' })
    const doc = await aboutViaWorker(kv)
    const extras = doc.extraFields as { label: string; value: string; url?: string }[]
    expect(extras).toHaveLength(2)
    expect(extras[0]).toEqual({ label: 'الرقم الضريبي', value: '100-200-300' })
    expect(extras[1].url).toBe('https://maps.app/x')
  })

  it('يرفض الحقل الناقص والرابط غير الآمن والحد الأقصى', async () => {
    expect((await addAboutExtraField({ kv } as never, { label: '', value: 'x', url: '' })).ok).toBe(false)
    const unsafe = await addAboutExtraField({ kv } as never, { label: 'رابط', value: 'اضغط', url: 'javascript:alert(1)' })
    expect(unsafe.ok).toBe(false)
    expect((unsafe as { reasonAr: string }).reasonAr).toContain('https://')
    expect((await readAbout({ kv } as never)).extraFields).toHaveLength(0)

    for (let i = 0; i < 25; i += 1) await addAboutExtraField({ kv } as never, { label: `ح${i}`, value: `ق${i}`, url: '' })
    expect((await readAbout({ kv } as never)).extraFields).toHaveLength(20)
    const over = await addAboutExtraField({ kv } as never, { label: 'زيادة', value: 'ق', url: '' })
    expect(over.ok).toBe(false)
  })

  it('الحذف بالرقم، ورقم خاطئ ⇒ رفض', async () => {
    await addAboutExtraField({ kv } as never, { label: 'أ', value: '١', url: '' })
    await addAboutExtraField({ kv } as never, { label: 'ب', value: '٢', url: '' })
    const del = await removeAboutExtraField({ kv } as never, 0)
    expect(del.ok).toBe(true)
    expect((await readAbout({ kv } as never)).extraFields.map((f) => f.label)).toEqual(['ب'])
    expect((await removeAboutExtraField({ kv } as never, 9)).ok).toBe(false)
    expect((await removeAboutExtraField({ kv } as never, 'abc')).ok).toBe(false)
  })

  it('قنوات التواصل الإضافية (فيسبوك/يوتيوب) إضافة وحذفاً', async () => {
    await addAboutSocialLink({ kv } as never, { label: 'فيسبوك', url: 'https://facebook.com/tahakam' })
    await addAboutSocialLink({ kv } as never, { label: 'يوتيوب', url: 'https://youtube.com/@tahakam' })
    expect((await aboutViaWorker(kv)).socialLinks).toHaveLength(2)
    expect((await addAboutSocialLink({ kv } as never, { label: 'سيئ', url: 'javascript:alert(1)' })).ok).toBe(false)
    const del = await removeAboutSocialLink({ kv } as never, 1)
    expect(del.ok).toBe(true)
    expect((await readAbout({ kv } as never)).socialLinks.map((l) => l.label)).toEqual(['فيسبوك'])
  })

  it('المعاينة تعرض ما سيراه العميل وتحذّر عند نقص التواصل', async () => {
    const empty = previewAboutAr(await readAbout({ kv } as never))
    expect(empty).toContain('لا بيانات تواصل')
    for (const field of ABOUT_FIELDS) await setAboutField({ kv } as never, field.key, CONTACTS[field.key as keyof typeof CONTACTS] ?? 'قيمة')
    const full = previewAboutAr(await readAbout({ kv } as never))
    expect(full).not.toContain('لا بيانات تواصل')
    expect(full).toContain('support@tahakam.app')
    expect(full).toContain('واتساب')
  })
})

describe('الصفحة تعرض الحقول الجديدة للعميل', () => {
  it('كل القنوات والحقول الحرة ظاهرة، والعنوان والساعات كذلك', async () => {
    useAppStore.setState({
      cloudAbout: parseAbout({
        ...CONTACTS,
        title: 'TAHAKAM ERP',
        body: 'نظام عربي',
        socialLinks: [{ label: 'فيسبوك', url: 'https://facebook.com/x' }],
        extraFields: [{ label: 'الرقم الضريبي', value: '100-200-300' }],
      }),
    })
    render(<AboutPage />)
    expect(screen.getByText('+20 100 123 4567')).toBeTruthy()
    expect(screen.getByText('@tahakam_support')).toBeTruthy()
    expect(screen.getByText('support@tahakam.app')).toBeTruthy()
    expect(screen.getByText('فيسبوك')).toBeTruthy()
    expect(screen.getByText('الرقم الضريبي')).toBeTruthy()
    expect(screen.getByText('100-200-300')).toBeTruthy()
    expect(screen.getByText('المنزلة — الدقهلية — مصر')).toBeTruthy()
    expect(screen.getByText('السبت–الخميس 9ص–6م')).toBeTruthy()
    // الروابط معقّمة وآمنة
    const links = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')
    expect(links.some((h) => h.startsWith('javascript:'))).toBe(false)
    expect(links).toContain('https://wa.me/201001234567')
    expect(links).toContain('https://t.me/tahakam_support')
    expect(links).toContain('mailto:support@tahakam.app')
    expect(links).toContain('tel:+201001234567')
    cleanup()
  })

  it('بلا بيانات تواصل ⇒ تلميح يوجّه للدعم بدل فراغ صامت', async () => {
    useAppStore.setState({ cloudAbout: parseAbout({}) })
    render(<AboutPage />)
    expect(screen.getByText(/لم يضبط المطوّر بيانات تواصل/)).toBeTruthy()
    expect(screen.queryByText('https://wa.me/')).toBeNull()
    cleanup()
  })
})
