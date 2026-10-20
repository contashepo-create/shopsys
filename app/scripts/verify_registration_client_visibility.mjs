// بند 2 (طلب المالك 2026-10-17) — الجزء الثاني: العميل يظهر في لوحة المطوّر كعميل جديد/قديم
// السبب: لوحة المطوّر (مستودع shopsys-controler) تقرأ سجلات `dev:` لا `reg:` ⇒ العميل الذي
// سجَّل جهازه لم يكن يظهر في قائمة العملاء إطلاقاً. الحل: أول تسجيل ينشئ سجل `dev:`
// بلا رخصة (خطة فارغة ⇒ «بدون اشتراك» في اللوحة)، وإعادة التسجيل (بعد مسح القاعدة)
// تُحدّث **نفس** السجل ⇒ عميل واحد قديم. إصدار المفتاح لاحقاً يدمج فوقه (لا سجل ثانٍ).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

class MemoryKv {
  constructor() { this.values = new Map(); this.metas = new Map() }
  async get(key) { return this.values.get(key) ?? null }
  async put(key, value, opts) {
    this.values.set(key, String(value))
    if (opts && opts.metadata !== undefined) this.metas.set(key, opts.metadata)
    else this.metas.delete(key)
  }
  async delete(key) { this.values.delete(key); this.metas.delete(key) }
  async list({ prefix = '', limit = 1000 } = {}) {
    return {
      keys: [...this.values.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
        .map((name) => (this.metas.has(name) ? { name, metadata: this.metas.get(name) } : { name })),
      list_complete: true,
    }
  }
}

const { saveRegistration, sanitizeRegistration, hasLicense } = await import(pathToFileURL(join(repoRoot, 'tools/devbot/src/registrations.js')).href)
const { subscriptionDigest, formatDigestAr } = await import(pathToFileURL(join(repoRoot, 'tools/devbot/src/subscriptions.js')).href)

const kv = new MemoryKv()
const cfg = { kv }
const report = sanitizeRegistration({
  deviceId: 'SHOP-7K2M-9PXQ-4RTZ', shopName: 'محل النور', ownerName: 'أحمد', phone: '01000000000',
  email: 'owner@example.com', city: 'المنصورة', street: 'شارع Judiciary', activityNameAr: 'محلات عامة',
})

// ① أول تسجيل ⇒ سجل dev: ينشأ ⇒ العميل يظهر في قائمة عملاء اللوحة
const first = await saveRegistration(cfg, report)
ok('حُفظ بلاغ التسجيل (reg:)', first.saved === true)
ok('أول بلاغ ⇒ isNew=true (تنبيه عميل جديد للمطوّر)', first.isNew === true)
const devRaw = await kv.get('dev:SHOP-7K2M-9PXQ-4RTZ')
ok('سجل الجهاز (dev:) انشأ ⇒ العميل يظهر في اللوحة', devRaw !== null)
const dev = JSON.parse(devRaw ?? '{}')
ok('السجل الجديد بلا مفتاح (خطة فارغة = مسجَّل بلا رخصة)', dev.plan === '' && dev.expiresAt === null && !dev.fingerprint)
ok('اسم العميل في السجل', dev.customer === 'محل النور')
ok('metadata الفهرسة مكتوب (للتذكير اليومي)', (await kv.list({ prefix: 'dev:' })).keys[0]?.metadata?.plan === '')
ok('السجل الجديد ليس رخصة (يبقى في «مسجّلون بلا رخصة» ويُتاح له الإصدار)', hasLicense(dev) === false)

// ② إعادة التسجيل (بعد مسح القاعدة) ⇒ نفس السجل، لا عميل جديد
const second = await saveRegistration(cfg, report)
ok('إعادة التسجيل ⇒ isNew=false (ليس عميلاً جديداً)', second.isNew === false)
const devList = await kv.list({ prefix: 'dev:' })
ok('سجل واحد فقط للجهاز (لا تكرار)', devList.keys.length === 1)
ok('سجل الجهاز لم يتغيّر plan', JSON.parse(await kv.get('dev:SHOP-7K2M-9PXQ-4RTZ')).plan === '')

// ③ جهاز مرخّص: إعادة التسجيل لا تمسّ حالة الترخيص
const licensed = 'SHOP-AAAA-BBBB-CCCC'
await kv.put(`dev:${licensed}`, JSON.stringify({
  plan: 'pro', expiresAt: '2027-01-01', customer: 'عميل مرخّص', fingerprint: 'abcd1234', message: 'ملاحظة المطوّر',
}))
await saveRegistration(cfg, sanitizeRegistration({ deviceId: licensed, shopName: 'اسم مختلف', ownerName: 'x' }))
const licensedRecord = JSON.parse(await kv.get(`dev:${licensed}`))
ok('خطة الترخيص لم تُمسّ', licensedRecord.plan === 'pro' && licensedRecord.expiresAt === '2027-01-01')
ok('بصمة المفتاح لم تُمسّ', licensedRecord.fingerprint === 'abcd1234')
ok('رسالة المطوّر لم تُمسّ', licensedRecord.message === 'ملاحظة المطوّر')
ok('اسم العميل المرخّص لم يُستبدل', licensedRecord.customer === 'عميل مرخّص')
ok('السجل المرخّص يُعدّ رخصة (لا يظهر في «بلا رخصة»)', hasLicense(licensedRecord) === true)

// ④ التذكير اليومي: التجريبي بلا مفتاح ليس «مدى الحياة» ولا يستحق تذكيراً
const digest = await subscriptionDigest(cfg, { now: Date.parse('2026-10-17T00:00:00Z') })
ok('العميل المسجَّل بلا مفتاح يُعدّ منفصلاً (trial)', digest.trial === 1)
ok('ليس ضمن «مدى الحياة»', digest.lifetime === 0)
ok('لا تذكير انتهاء للتجريبي', digest.soon.length === 0 && digest.expired.length === 0)
ok('نص الإحصاء يذكر التجريبي', formatDigestAr(digest).includes('تجريبي'))

// ⑤ لوحة تليجرام: العميل بلا رخصة لا يُعرض «سارية» ولا خطة فارغة مضلِّلة
const adminSrc = readFileSync(new URL('../../tools/devbot/src/adminPanel.js', import.meta.url), 'utf8')
ok('بطاقة العميل بلا رخصة تعرض «بلا رخصة (سجَّل جهازه)»', adminSrc.includes('بلا رخصة (سجَّل جهازه)'))
ok('بطاقة العميل بلا رخصة لا تعرض خطة فارغة', adminSrc.includes('بلا رخصة — لم يُصدَر له مفتاح بعد'))
ok('زر أجهزة المجموعة يعرض «بلا رخصة» للخطة الفارغة', adminSrc.includes("device.plan || 'بلا رخصة'"))

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
