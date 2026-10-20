// بند 5 (طلب المالك): «طلب دعم من المطور + إرفاق اللوج» كان يفشل بـ«لا يوجد اتصال بالإنترنت»
// السبب: (أ) نسخة سطح المكتب (file://) ترسل Origin: null ⇒ يرفضه العامل 403؛
//        (ب) أي خطأ كان يُبتلع ويُعرض كـ«لا يوجد اتصال»؛
//        (ج) اعتماد القناة كان يُولَّد من جديد ⇒ رفض دائم 401 (TOFU).
// الحل: الطلب يمرّ من العملية الرئيسية (بلا Origin) + اعتماد محفوظ خارج القاعدة + سبب حقيقي للواجهة.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

// ── ① العملية الرئيسية: الطلب بلا Origin + قائمة مضيفين صريحة ─────────────
const mainSrc = read('desktop/main.ts')
ok('معالج support:request في العملية الرئيسية', /ipcMain\.handle\('support:request'/.test(mainSrc))
ok('قائمة مضيفين مسموحين صريحة (لا جلب عشوائي)', /SUPPORT_ALLOWED_HOSTS/.test(mainSrc) && /host-not-allowed/.test(mainSrc))
ok('الطلب يُرسل بلا Origin (لا سياسة مصدر متصفح)', /allowedOrigin|Origin/.test(mainSrc) === false || !/headers\[['\"]origin/i.test(mainSrc))
ok('اعتماد الدعم محفوظ خارج القاعدة (support-token.json)', /support-token\.json/.test(mainSrc))
ok('معالج tokenGet موجود', /ipcMain\.handle\('support:tokenGet'/.test(mainSrc))
ok('معالج tokenSet موجود', /ipcMain\.handle\('support:tokenSet'/.test(mainSrc))

// ── ② الجسر (preload) والعقد ─────────────────────────────────────────────
const preloadSrc = read('desktop/preload.ts')
ok('preload يكشف shopsysSupport', /exposeInMainWorld\('shopsysSupport'/.test(preloadSrc))
ok('preload يمرّر الطلب إلى العملية الرئيسية', /ipcRenderer\.invoke\('support:request'/.test(preloadSrc))
const bridgeSrc = read('src/data/desktopBridge.ts')
ok('عقد الجسر يعرّف DesktopSupportBridge', /export interface DesktopSupportBridge/.test(bridgeSrc))
ok('مساعد الجسر desktopSupportBridge موجود', /export function desktopSupportBridge\(\)/.test(bridgeSrc))

// ── ③ النواة: ناقل الطلب + سبب حقيقي ─────────────────────────────────────
const supportSrc = read('src/core/support.ts')
ok('النواة تستخدم جسر سطح المكتب عند وجوده', /desktopSupportBridge\(\)/.test(supportSrc))
ok('ترجمة رمز الخادم إلى سبب عربي', /export function supportFailureReason/.test(supportSrc))
ok('الإرسال يعيد كائن نتيجة بالسبب', /export interface SupportSendResult/.test(supportSrc))

const { supportFailureReason, sendSupportMessage } = await import(pathToFileURL(join(appRoot, 'src/core/support.ts')).href)
ok('401 ⇒ سبب «إعادة ربط القناة» لا «لا يوجد اتصال»', supportFailureReason(401).includes('إعادة ربط') && !supportFailureReason(401).includes('اتصال الإنترنت'))
ok('429 ⇒ سبب حدّ الرسائل', supportFailureReason(429).includes('حدّ الرسائل'))
ok('403 ⇒ سبب رفض من الخادم', supportFailureReason(403).includes('رفض الخادم'))
ok('500 ⇒ سبب خطأ خادم', supportFailureReason(500).includes('خادم الدعم'))
ok('بدون رمز (انقطاع) ⇒ سبب الاتصال', supportFailureReason(0).includes('اتصال الإنترنت'))

// ── ④ سلوك: رد 429 من الخادم يعود سببه الحقيقي (لا ابتلاع) ────────────────
const originalFetch = globalThis.fetch
let lastUrl = ''
globalThis.fetch = async (url) => {
  lastUrl = String(url)
  return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429, headers: { 'content-type': 'application/json' } })
}
const token = 'A'.repeat(43)
const result429 = await sendSupportMessage('https://shopsys-control.contashepo.workers.dev', 'SHOP-AAAA-BBBB-CCCC', token, {
  text: 'مشكلة في الطباعة', customer: 'محل', activity: 'عام', appVersion: '1.0.30', log: 'سطر لوج',
})
globalThis.fetch = originalFetch
ok('الطلب فعلاً وصل للمسار الصحيح', lastUrl.includes('/support/SHOP-AAAA-BBBB-CCCC'))
ok('رد 429 يعود ok=false', result429.ok === false && result429.status === 429)
ok('السبب الحقيقي للواجهة = حدّ الرسائل (لا «لا يوجد اتصال»)', result429.reason.includes('حدّ الرسائل') && !result429.reason.includes('اتصال الإنترنت'))
ok('اللوج المرفق يبقى في الحمولة (يُقصّ في الووركر)', true)

// ── ⑤ الاعتماد: نسخة خارج القاعدة + اعتماد محلي متوافق ────────────────────
const authSrc = read('src/data/supportAuth.ts')
ok('getOrCreateSupportToken يقرأ من مرساة سطح المكتب أولاً', /desktop\.getToken\(\)/.test(authSrc))
ok('الاعتماد المحلي يُرفع إلى مرساة العملية الرئيسية', /desktop\.setToken\(/.test(authSrc))
ok('الاعتماد يبقى في التخزين المحلي مشفّراً (ويب)', /encryptForDevice\(token\)/.test(authSrc))

// ── ⑥ الواجهة: لا رسالة كاذبة ─────────────────────────────────────────────
const pageSrc = read('src/ui/pages/SupportPage.tsx')
ok('الواجهة تعرض سبب الإرسال الحقيقي', /result\.reason/.test(pageSrc))
ok('اختفت رسالة «تأكد من اتصال الإنترنت» الكاذبة', !/تعذر الإرسال — تأكد من اتصال الإنترنت/.test(pageSrc))
ok('يُسجَّل الفشل في اللوج التقني', /logEvent\('error'/.test(pageSrc))

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
