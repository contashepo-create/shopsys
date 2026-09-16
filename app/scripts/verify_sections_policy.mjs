/**
 * تحقق سياسة الأقسام وقفل البلد (أوامر المالك):
 * ① الأقسام الظاهرة = افتراضيات النشاط فقط + ما يفعّله المطوّر بمفتاح موقَّع (extraModules).
 * ② المستخدم لا يملك مفاتيح تبديل أقسام ولا زر تغيير بلد في الإعدادات.
 * ③ المفتاح الموقَّع يشمل extraModules في الصيغة القانونية (لا تزوير محلي).
 * تشغيل: node --experimental-strip-types scripts/verify_sections_policy.mjs
 */
import { readFileSync } from 'node:fs'
import { effectiveModules, ACTIVITY_TEMPLATES } from '../src/core/activities.ts'
import { canonicalPayload } from '../src/core/license.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— effectiveModules —')
const logistics = ACTIVITY_TEMPLATES.find((a) => a.id === 'logistics')
ok(!!logistics, 'قالب النقليات موجود')
const base = effectiveModules('logistics', undefined)
ok(JSON.stringify(base) === JSON.stringify(logistics.modules), 'بلا مفتاح: افتراضيات النشاط فقط')
const withExtra = effectiveModules('logistics', ['maintenance', 'pos'])
ok(withExtra.includes('maintenance') && withExtra.includes('pos'), 'المطوّر فعّل صيانة + كاشير فظهرا')
ok(logistics.modules.every((m) => withExtra.includes(m)), 'الافتراضيات باقية كما هي')
const withBogus = effectiveModules('logistics', ['hacking_module', 'maintenance'])
ok(!withBogus.includes('hacking_module') && withBogus.includes('maintenance'), 'وحدة مجهولة في المفتاح تُتجاهل بأمان')
const dup = effectiveModules('grocery', ['pos'])
ok(dup.filter((m) => m === 'pos').length === 1, 'لا تكرار لو المفتاح ذكر وحدة افتراضية')
const unknownAct = effectiveModules('no_such_activity', undefined)
ok(unknownAct.includes('pos') && unknownAct.includes('inventory'), 'نشاط مجهول → حد أدنى آمن (كاشير+مخزون+مشتريات)')

console.log('— التوقيع يشمل extraModules —')
const p1 = { v: 1, deviceId: 'D1', customer: 'X', plan: 'pro', features: [], issuedAt: '2026-01-01', expiresAt: null }
const p2 = { ...p1, extraModules: ['maintenance'] }
ok(canonicalPayload(p1) !== canonicalPayload(p2), 'إضافة extraModules تغيّر الصيغة الموقَّعة (لا تزوير)')
const p3 = { ...p1, extraModules: ['b', 'a'] }
const p4 = { ...p1, extraModules: ['a', 'b'] }
ok(canonicalPayload(p3) === canonicalPayload(p4), 'ترتيب الوحدات لا يغيّر التوقيع (فرز حتمي)')
ok(!canonicalPayload(p1).includes('extraModules'), 'المفاتيح القديمة بلا extraModules تبقى صحيحة')

console.log('— واجهة الإعدادات: لا تبديل أقسام ولا تغيير بلد —')
const settings = readFileSync(new URL('../src/ui/pages/GeneralSettingsPage.tsx', import.meta.url), 'utf8')
ok(!settings.includes('toggleModule'), 'أُزيلت مفاتيح تبديل الوحدات من الإعدادات')
ok(!settings.includes('resetSetup'), 'أُزيل زر تغيير البلد/النشاط (البلد مقفول)')
ok(settings.includes('مقفولان'), 'رسالة القفل ظاهرة للمستخدم')
ok(settings.includes('الدعم الفني'), 'الإرشاد: التفعيل الإضافي عبر الدعم الفني (المطوّر)')

console.log('— أداة الإصدار تدعم extra-modules —')
const tool = readFileSync(new URL('./license_tool.mjs', import.meta.url), 'utf8')
ok(tool.includes('extra-modules'), 'license_tool يقبل --extra-modules')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
