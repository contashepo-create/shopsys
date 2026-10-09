#!/usr/bin/env node
/**
 * verify_dev_notice_levels — بوابة بند 10 (تدقيق 2026-10-08):
 * «هل يدعم التطبيق نوافذ تنبيه منبثقة يرسلها المطوّر، وإشعارات يرسلها المطوّر؟»
 *
 * ما كان: التنبيه يظهر في الجرس وتوست عابر فقط — لا نافذة منبثقة، ولا درجة
 * إلزام، ولا إيصال قراءة ⇒ المطوّر لا يعرف هل وصل تنبيهه الحرج.
 *
 * ما تُثبته البوابة:
 *   • ثلاث درجات (info/important/critical) والافتراضي info ⇒ توافق رجعي كامل.
 *   • نافذة واحدة: الأعلى درجة ثم الأحدث؛ والمُقرّ والمؤجّل يُستبعدان.
 *   • critical بلا زر تأجيل، وimportant به؛ وinfo بلا نافذة إطلاقاً.
 *   • الإقرار يُحفظ محلياً (حدّه 200) ويُرسل إيصال قراءة للعامل best-effort.
 *   • العامل يسجّل الإقرار مرة لكل جهاز، واللوحة تعرض عدد القراءات.
 *   • إشعار نظام التشغيل عبر Electron للمهم/العاجل فقط.
 *
 * node --experimental-strip-types scripts/verify_dev_notice_levels.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { parseCloudNotices } from '../src/core/cloud.ts'
import {
  pendingPopupNotice, isAckMandatory, isPopupNotice, shouldAnnounceToast,
  noticeSeverity, osNotificationFor, sendNoticeAck,
  NOTICE_LEVEL_LABELS_AR, NOTICE_LEVEL_ICONS,
} from '../src/core/devNotice.ts'
import { recordNoticeAck, ackCountForNotice, noticeExists, normalizeNoticeLevel, NOTICE_LEVELS } from '../../tools/devbot/src/adminPanel.js'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const noticeSrc = src('../src/core/devNotice.ts')
const cloudSrc = src('../src/core/cloud.ts')
const modalSrc = src('../src/ui/components/DevNoticeModal.tsx')
const appSrc = src('../src/App.tsx')
const headerSrc = src('../src/ui/layout/Header.tsx')
const storeSrc = src('../src/stores/app.store.ts')
const workerSrcOf = (name) => src(`../../tools/devbot/src/${name}.js`)
const ACK_DEVICE = 'SHOP-AAA1-1111-1111'
const tgHtml = await import('../../tools/devbot/src/tgHtml.js')
const workerSrc = src('../../tools/devbot/src/worker.js')
const panelSrc = src('../../tools/devbot/src/adminPanel.js')
const bridgeSrc = src('../src/data/desktopBridge.ts')
const preloadSrc = src('../desktop/preload.ts')
const mainSrc = src('../desktop/main.ts')

class MemoryKv {
  constructor() { this.values = new Map(); this.metas = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value, opts) {
    this.values.set(key, String(value))
    /* metadata المفاتيح كما في KV الحقيقي — يُعاد من list() بلا get إضافي */
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return { keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })), list_complete: true }
  }
}

const notice = (id, level, extra = {}) => ({
  id, title: `عنوان ${id}`, body: `نص ${id}`, createdAt: '2026-10-01T08:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z', ...(level ? { level } : {}), ...extra,
})
const parsed = (list) => parseCloudNotices(list)

console.log('بوابة بند 10 — نوافذ تنبيه المطوّر وإشعاراته:')

ok('ثلاث درجات، والافتراضي info (توافق رجعي مع التنبيهات المحفوظة)', () => {
  assert.deepEqual(NOTICE_LEVELS, ['info', 'important', 'critical'])
  assert.equal(normalizeNoticeLevel('weird'), 'info')
  assert.equal(normalizeNoticeLevel('critical'), 'critical')
  const [legacy] = parsed([notice('n1')])
  assert.equal(legacy.level, 'info')
  assert.equal(legacy.requiresAck, false)
  assert.equal(isPopupNotice(legacy), false)
  assert.equal(shouldAnnounceToast(legacy), true)
})

ok('الدرجة تحدّد الخطورة وطريقة العرض', () => {
  const [imp] = parsed([notice('n2', 'important')])
  const [crit] = parsed([notice('n3', 'critical')])
  assert.equal(imp.requiresAck, true)
  assert.equal(isPopupNotice(imp), true)
  assert.equal(isAckMandatory(imp), false)
  assert.equal(noticeSeverity(imp), 'warn')
  assert.equal(shouldAnnounceToast(imp), false) // النافذة تكفي — لا ضجيج مزدوج
  assert.equal(isAckMandatory(crit), true)
  assert.equal(noticeSeverity(crit), 'danger')
  assert.equal(NOTICE_LEVEL_LABELS_AR.critical, 'تنبيه عاجل')
  assert.equal(NOTICE_LEVEL_ICONS.critical, '🚨')
})

ok('درجة مجهولة ⇒ info، والعنوان والجسم يُعقَّمان ويُقصّان', () => {
  const [n] = parsed([notice('n4', 'weird', { title: '<b>عنوان</b>', body: 'a<b>c' })])
  assert.equal(n.level, 'info')
  assert.ok(!n.title.includes('<'))
  assert.ok(!n.body.includes('<'))
  assert.ok(n.id.length <= 64)
  assert.match(cloudSrc, /export type NoticeLevel = 'info' \| 'important' \| 'critical'/)
})

ok('نافذة واحدة: الأعلى درجة ثم الأحدث، والمُقرّ/المؤجّل مستبعدان', () => {
  const all = parsed([notice('imp', 'important'), notice('crit', 'critical')])
  assert.equal(pendingPopupNotice(all).id, 'crit')
  const imps = parsed([
    notice('old', 'important', { createdAt: '2026-10-01T08:00:00Z' }),
    notice('new', 'important', { createdAt: '2026-10-05T08:00:00Z' }),
  ])
  assert.equal(pendingPopupNotice(imps).id, 'new')
  assert.equal(pendingPopupNotice(all, { ackedIds: ['crit'] }).id, 'imp')
  assert.equal(pendingPopupNotice(all, { ackedIds: ['crit'], snoozedIds: ['imp'] }), null)
  assert.equal(pendingPopupNotice(parsed([notice('x')])), null) // info ⇒ لا نافذة
  assert.equal(pendingPopupNotice([]), null)
})

/* التركيب لا المنطق وحده: `DevNoticeHost` يجب أن يُركَّب في **كل** مسار يُعرض
   للعميل، وأهمها شاشة القفل — الاستطلاع يجلب التنبيهات والعميل مقفول أيضاً
   (`setup.completed` فقط شرطه)، فبلا التركيب هناك تصل التنبيهات ولا يعرضها شيء،
   والعميل المقفول أحوج ما يكون لتعليمات التجديد من المطوّر. */
ok('النافذة مركّبة في المسار العام **وشاشة القفل** معاً', () => {
  /* التعليقات تُنزع أولاً: الاعتماد على تعليق كمرساة يسقط عند أول إعادة صياغة */
  const app = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const from = app.indexOf('if (setup.completed && lockReason)')
  const to = app.indexOf('if (readOnlyTab)')
  assert.ok(from > -1 && to > from, 'تغيّر ترتيب فروع App.tsx — حدّث هذا الفحص')
  const lockBranch = app.slice(from, to)
  assert.ok(lockBranch.includes('<LockScreen'), 'فرع القفل لم يعد يركّب LockScreen')
  assert.ok(lockBranch.includes('<DevNoticeHost />'), 'شاشة القفل لا تركّب نافذة تنبيه المطوّر')
  assert.equal(app.split('<DevNoticeHost />').length - 1, 2, 'يُتوقع تركيبان: المسار العام + شاشة القفل')
})

ok('إشعار نظام التشغيل للمهم/العاجل فقط — والعنوان يبدأ بالدرجة', () => {
  assert.equal(osNotificationFor(parsed([notice('n1')])[0]), null)
  const os = osNotificationFor(parsed([notice('n3', 'critical')])[0])
  assert.match(os.title, /تنبيه عاجل/)
  assert.match(os.body, /عنوان n3/)
  assert.ok(os.body.length <= 240)
})

await okAsync('sendNoticeAck: sent/failed ولا استثناء أبداً', async () => {
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('{}', { status: 200 })
    assert.equal(await sendNoticeAck('https://x.dev/', 'id1', 'SHOP-AAA1-1111-1111'), 'sent')
    globalThis.fetch = async () => new Response('x', { status: 500 })
    assert.equal(await sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111'), 'failed')
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.equal(await sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111'), 'failed')
    assert.equal(await sendNoticeAck('https://x.dev', '', 'SHOP-AAA1-1111-1111'), 'failed')
    assert.equal(await sendNoticeAck('https://x.dev', 'id1', ''), 'failed')
    globalThis.fetch = () => { throw new Error('sync') }
    assert.equal(await sendNoticeAck('https://x.dev', 'id1', 'SHOP-AAA1-1111-1111'), 'failed')
  } finally { globalThis.fetch = realFetch }
})

await okAsync('العامل: الإقرار مرة لكل جهاز، والمعرّف التالف مرفوض', async () => {
  const kv = new MemoryKv()
  /* الإقرار مشروط بوجود التنبيه (انظر الفحص أدناه) — فنزرعه أولاً */
  await kv.put('notices:global', JSON.stringify([{ id: 'n-1', body: 'تنبيه', level: 'critical' }]))
  const cfg = { kv }
  assert.equal((await recordNoticeAck(cfg, '', 'SHOP-AAA1-1111-1111')).ok, false)
  assert.equal((await recordNoticeAck(cfg, 'n-1', 'abc')).ok, false)
  assert.equal((await recordNoticeAck(cfg, 'n-1', 'javascript:alert(1)')).ok, false)
  const first = await recordNoticeAck(cfg, 'n-1', 'SHOP-AAA1-1111-1111')
  assert.equal(first.ok, true)
  assert.equal(first.count, 1)
  const dup = await recordNoticeAck(cfg, 'n-1', 'SHOP-AAA1-1111-1111')
  assert.equal(dup.isNew, false) // لا تضخيم للعدد
  assert.equal(dup.count, 1)
  await recordNoticeAck(cfg, 'n-1', 'SHOP-BBB2-2222-2222')
  assert.equal(await ackCountForNotice(cfg, 'n-1'), 2)
  assert.equal(await ackCountForNotice(cfg, 'غير-موجود'), 0)
})

ok('العامل: مسار الإقرار محصور بـPOST ومعرّف جهاز صالح', () => {
  assert.ok(workerSrc.includes('^\\/notifications\\/([^/]+)\\/ack$'), 'مسار الإقرار غير موجود في العامل')
  assert.match(workerSrc, /recordNoticeAck\(cfg, decodeURIComponent/)
  assert.match(workerSrc, /405/)
  assert.match(panelSrc, /export const ACK_PREFIX = 'notice-acks:'/)
  assert.match(panelSrc, /slice\(-1000\)/) // سقف القائمة
})

ok('النافذة: overlay مستقل (لا Modal العام غير الحاجب) وبلا إغلاق لـcritical', () => {
  assert.match(modalSrc, /role="alertdialog"/)
  assert.match(modalSrc, /aria-modal="true"/)
  /* سلّم الطبقات الموحّد (حارس overlay_layers): بوابة إلى body + طبقة معروفة،
     لا z-index محلياً — وإلا حُبست النافذة داخل أي حاوية متحركة. */
  assert.match(modalSrc, /fixed inset-0/)
  assert.match(modalSrc, /layer-approval/)
  assert.match(modalSrc, /<OverlayPortal>/)
  assert.match(modalSrc, /pointer-events-none fixed inset-0/)
  /* نفحص الكود لا التعليقات — الكلمة مذكورة في تعليق يشرح القاعدة نفسها */
  const modalCode = modalSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/z-\[\d+\]|z-index/.test(modalCode), 'لا z-index محلي — الطبقات من index.css')
  assert.match(modalSrc, /isAckMandatory\(/)
  assert.match(modalSrc, /\{!mandatory && \(/) // زر «لاحقاً» لغير الإلزامي فقط
  assert.match(modalSrc, /dev-notice-ack/)
  assert.match(modalSrc, /dev-notice-snooze/)
  assert.ok(!/from '\.\.\/components\/ui\.tsx'/.test(modalSrc), 'لا تستخدم Modal العام القابل للتصغير وEscape')
  /* الإقرار هو المخرج الوحيد: لا معالج لوحة مفاتيح ولا نقر على الخلفية يغلق
     (التعليقات تذكر الكلمة شرحاً — لذا نفحص الكود لا النص) */
  assert.ok(!/addEventListener\(['"]keydown|onKeyDown/.test(modalSrc), 'لا إغلاق بـEscape')
  assert.ok(!/onClick=\{[^}]*\}\s*\n?\s*className="fixed inset-0/.test(modalSrc), 'الخلفية لا تُغلق النافذة')
  assert.match(noticeSrc, /pendingPopupNotice/)
})

ok('النافذة مستوردة ومركّبة في المسار العام في App.tsx', () => {
  assert.match(appSrc, /<DevNoticeHost \/>/)
  assert.match(appSrc, /import \{ DevNoticeHost \} from '\.\/ui\/components\/DevNoticeModal\.tsx'/)
})

ok('المتجر يحفظ الإقرار بحدّ 200 ومع حارس فرق', () => {
  assert.match(storeSrc, /ackedNoticeIds: string\[\]/)
  assert.match(storeSrc, /ackNotice: \(id\) =>/)
  assert.match(storeSrc, /slice\(-200\)/)
  assert.match(storeSrc, /s\.ackedNoticeIds\.includes\(id\)/)
})

ok('الجرس: الدرجة تنعكس خطورةً، والتوست لإعلانات info فقط', () => {
  assert.match(headerSrc, /noticeSeverity\(notice\)/)
  assert.match(headerSrc, /NOTICE_LEVEL_ICONS\[notice\.level\]/)
  assert.match(headerSrc, /shouldAnnounceToast/)
})

ok('إشعار نظام التشغيل عبر Electron فقط (IPC) وبلا كشف API', () => {
  assert.match(bridgeSrc, /export async function showDesktopNotification/)
  assert.match(bridgeSrc, /desktopBridge\(\)\?\.notifications/)
  assert.match(bridgeSrc, /catch \{[\s\S]*?return false/)
  assert.match(preloadSrc, /notify:show/)
  assert.match(mainSrc, /ipcMain\.handle\('notify:show'/)
  assert.match(mainSrc, /Notification\.isSupported\(\)/)
  assert.match(mainSrc, /slice\(0, 120\)/) // حدود الخادم/العملية الرئيسية أيضاً
  assert.match(modalSrc, /showDesktopNotification\(/)
})

ok('اللوحة: اختيار الدرجة قبل النص + قائمة التنبيهات وعدد القراءات', () => {
  assert.match(panelSrc, /panel:noticelevel:/)
  assert.match(panelSrc, /noticeLevelReply/)
  assert.match(panelSrc, /panel:noticelist/)
  assert.match(panelSrc, /قرأه \$\{acks\} جهاز/)
  assert.match(panelSrc, /level,\s*\n?\s*requiresAck: level !== 'info'/)
  // كل مداخل التنبيه تمرّ عبر قائمة الدرجات
  assert.match(panelSrc, /if \(action === 'notice' && parts\[1\] === 'all'\) return noticeLevelReply/)
  assert.match(workerSrc, /case '\/تنبيهات'/)
})

/* نقطة الإقرار عامة بلا سرّ ⇒ يجب أن تكون كتابة محدودة الأثر: لا تُقبل إلا
   لتنبيه موجود فعلاً، وإلا صارت مولّد مفاتيح `notice-acks:<عشوائي>` بلا حد
   وأداة لتضخيم إحصاء القراءات الذي يبني عليه المطوّر قراره. */
await okAsync('الإقرار لا يُقبل إلا لتنبيه موجود — ولا يُنشئ مفتاحاً لغيره', async () => {
  const kv = new MemoryKv()
  const ghost = await recordNoticeAck({ kv }, 'not-exists', ACK_DEVICE)
  assert.deepEqual({ ok: ghost.ok, reason: ghost.reason }, { ok: false, reason: 'unknown notice' })
  assert.equal(await kv.get('notice-acks:not-exists'), null)
  assert.equal(await ackCountForNotice({ kv }, 'not-exists'), 0)
  assert.equal(await noticeExists({ kv }, 'not-exists', ACK_DEVICE), false)

  await kv.put('notices:global', JSON.stringify([{ id: 'g-1', body: 'عام', level: 'critical' }]))
  assert.equal(await noticeExists({ kv }, 'g-1', ACK_DEVICE), true)
  assert.equal((await recordNoticeAck({ kv }, 'g-1', ACK_DEVICE)).ok, true)
  assert.equal(await ackCountForNotice({ kv }, 'g-1'), 1)

  /* تنبيه خاص بجهاز لا يُقبل إقراره من جهاز آخر */
  await kv.put('notices:SHOP-CCC3-3333-3333', JSON.stringify([{ id: 'p-1', body: 'خاص', level: 'info' }]))
  assert.equal((await recordNoticeAck({ kv }, 'p-1', ACK_DEVICE)).ok, false)
  assert.equal((await recordNoticeAck({ kv }, 'p-1', 'SHOP-CCC3-3333-3333')).ok, true)

  /* ولا يُسرَّب عدد القراءات لنداء عام */
  assert.match(workerSrcOf('worker'), /return json\(\{ ok: result\.ok \}, CORS, result\.ok \? 200 : 400\)/)
})

/* المركز يرسل بـparse_mode=HTML: قيمة غير مُهرَّبة (خصوصاً `&`) تُفشل الرسالة
   كلها فيبتلعها catch ⇒ لا يصل المطوّر بلاغ العميل ولا يقرأ محادثة الدعم. */
ok('كل نص يكتبه العميل يُهرَّب قبل دخوله رسالة HTML', () => {
  const { tgEscape } = tgHtml
  assert.equal(tgEscape('A&B'), 'A&amp;B')
  assert.equal(tgEscape('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;')
  assert.equal(tgEscape(null), '')
  const regSrc = src('../../tools/devbot/src/registrations.js')
  const supSrc = src('../../tools/devbot/src/subscriptions.js')
  assert.match(regSrc, /tgEscape\(record\.shopName\)/)
  assert.match(regSrc, /tgEscape\(record\.ownerName\)/)
  assert.match(supSrc, /tgEscape\(row\.customer\)/)
  /* العامل يغلّف بـString() واللوحة بـcleanText() — المهم أن التهريب هو الأبعد */
  const cases = [
    ['عامل المركز', '../../tools/devbot/src/worker.js', /tgEscape\(String\(c\.lastText/],
    ['عامل المركز (المحادثة)', '../../tools/devbot/src/worker.js', /tgEscape\(String\(m\.text/],
    ['اللوحة (الصندوق)', '../../tools/devbot/src/adminPanel.js', /tgEscape\(cleanText\(c\.lastText/],
    ['اللوحة (المحادثة)', '../../tools/devbot/src/adminPanel.js', /tgEscape\(cleanText\(m\.text/],
  ]
  for (const [name, file, pattern] of cases) {
    const text = src(file)
    assert.match(text, /import \{ tgEscape \} from '\.\/tgHtml\.js'/, `${name} لا يستورد التهريب`)
    assert.match(text, pattern, `${name}: نص العميل في الدعم بلا تهريب`)
  }
})


console.log(`\nالنتيجة: ${passed} فحوص ناجحة${process.exitCode ? ' — مع فشل أعلاه' : ' ✅'}`)
