/**
 * تحقق البنية الهجينة والتحديث التلقائي (البنود 3 و6):
 * ① اشتقاق وضع التشغيل الأربعة من ميزات الرخصة الموقَّعة فقط (لا تزوير محلي).
 * ② مؤشر الاتصال المرئي — كل الحالات الخمس بمدخلات حقيقية.
 * ③ مقارنة الإصدارات وقرار التحديث (اختياري/إجباري) وتنقية استجابة السحابة.
 * ④ خطة التحديث الآمن: نسخة احتياطية أولاً + تراجع كامل عند الفشل.
 * ⑤ ترحيلات المخطط المتسلسلة بلا فقد بيانات.
 * ⑥ نقطة /version موجودة في عامل Cloudflare والهيدر يعرض المؤشر.
 * تشغيل: node --experimental-strip-types scripts/verify_architecture_updates.mjs
 */
import { readFileSync } from 'node:fs'
import {
  deriveArchitectureMode, MODE_LABELS, connectivityStatus, CONNECTIVITY_LABELS,
} from '../src/core/architecture.ts'
import {
  APP_VERSION, isValidVersion, compareVersions, parseUpdateInfo, decideUpdate,
  buildUpdatePlan, rollbackFrom, runMigrations,
} from '../src/core/updates.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }
const throws = (msg, fn) => { try { fn(); FAIL++; console.log(`  ✗ ${msg} (لم يرمِ)`) } catch { PASS++; console.log(`  ✓ ${msg}`) } }

console.log('— ① أوضاع التشغيل الأربعة —')
ok(deriveArchitectureMode([], false) === 'standalone', 'بلا ميزات = محلي مستقل (أساس كل باقة)')
ok(deriveArchitectureMode(['multi_user_lan'], false) === 'lan', 'ميزة LAN = شبكة محلية')
ok(deriveArchitectureMode(['cloud_sync'], true) === 'cloud_single', 'cloud_sync مفعّلة = سحابي فرع واحد')
ok(deriveArchitectureMode(['cloud_sync'], false) === 'standalone', 'يملك الميزة ولم يفعّل المزامنة = محلي')
ok(deriveArchitectureMode(['multi_branch', 'cloud_sync'], true) === 'cloud_enterprise', 'فروع+سحابة = مؤسسي')
ok(deriveArchitectureMode(['multi_branch'], true) === 'standalone', 'فروع بلا cloud_sync لا تكفي للمؤسسي')
ok(Object.keys(MODE_LABELS).length === 4, 'أربعة أوضاع معنونة بالعربية')

console.log('— ② مؤشر الاتصال (Offline-First) —')
ok(connectivityStatus({ browserOnline: false, syncEnabled: true, dirty: true, lastResult: null }) === 'offline', 'بلا إنترنت = 📴 (الكتابة محلية)')
ok(connectivityStatus({ browserOnline: true, syncEnabled: false, dirty: false, lastResult: null }) === 'online_idle', 'متصل بلا مزامنة = محلي بحت')
ok(connectivityStatus({ browserOnline: true, syncEnabled: true, dirty: false, lastResult: 'تمت' }) === 'online_synced', 'متزامن ☁️')
ok(connectivityStatus({ browserOnline: true, syncEnabled: true, dirty: true, lastResult: 'تمت' }) === 'online_pending', 'تغييرات معلقة 🔄')
ok(connectivityStatus({ browserOnline: true, syncEnabled: true, dirty: false, lastResult: '⚠️ فشل' }) === 'online_error', 'آخر دورة فشلت ⚠️')
ok(Object.keys(CONNECTIVITY_LABELS).length === 5, 'خمس حالات معنونة')

console.log('— ③ مقارنة الإصدارات وقرار التحديث —')
ok(isValidVersion(APP_VERSION), `إصدار التطبيق صالح (${APP_VERSION})`)
ok(compareVersions('1.2.3', '1.2.3') === 0, 'تساوٍ')
ok(compareVersions('2.0.0', '1.9.9') === 1, 'major يغلب')
ok(compareVersions('1.10.0', '1.9.0') === 1, '10 > 9 عددياً لا نصياً')
throws('إصدار مشوه يُرفض', () => compareVersions('1.2', '1.2.3'))
const info = parseUpdateInfo({ latestVersion: '1.1.0', downloadUrl: 'https://x/y.exe', releaseNotesAr: 'تحسينات', sha256: 'abc', mandatory: false, publishedAt: '2026-09-16' })
ok(info !== null && info.latestVersion === '1.1.0', 'تنقية استجابة سليمة')
ok(parseUpdateInfo({ latestVersion: 'abc' }) === null, 'إصدار فاسد من السحابة = null (لا انهيار)')
ok(parseUpdateInfo('نص') === null, 'استجابة غير كائن = null')
ok(decideUpdate('1.0.0', info).kind === 'update_available', 'أحدث مني = تحديث متاح')
ok(decideUpdate('1.1.0', info).kind === 'up_to_date', 'مساوٍ = أنت على الأحدث')
ok(decideUpdate('1.2.0', info).kind === 'up_to_date', 'أقدم مني (rollback سحابي) = لا تنزيل')
const mand = parseUpdateInfo({ ...info, latestVersion: '1.1.0', mandatory: true })
ok(decideUpdate('1.0.0', mand).kind === 'mandatory_update', 'إجباري يُميز عن الاختياري')

console.log('— ④ خطة التحديث الآمن والتراجع —')
const plan = buildUpdatePlan()
ok(plan[0].id === 'backup_db' && plan[0].critical, 'أول خطوة دائماً: نسخة احتياطية معزولة (خارج مسار التثبيت)')
ok(plan.findIndex((s) => s.id === 'verify_hash') < plan.findIndex((s) => s.id === 'install'), 'فحص البصمة قبل التثبيت')
ok(plan.findIndex((s) => s.id === 'migrate_schema') > plan.findIndex((s) => s.id === 'install'), 'الترحيل بعد التثبيت')
const rb1 = rollbackFrom('migrate_schema', plan)
ok(rb1.includes('استعادة قاعدة البيانات من النسخة الاحتياطية المعزولة'), 'فشل الترحيل = استعادة النسخة الاحتياطية')
ok(rb1.includes('إعادة تثبيت الإصدار السابق'), 'فشل الترحيل = العودة للإصدار السابق أيضاً')
const rb2 = rollbackFrom('download', plan)
ok(!rb2.includes('إعادة تثبيت الإصدار السابق'), 'فشل التنزيل (قبل التثبيت) لا يحتاج إعادة تثبيت')
throws('خطوة مجهولة تُرفض', () => rollbackFrom('bogus', plan))

console.log('— ⑤ ترحيلات المخطط بلا فقد —')
const migrations = [
  { fromVersion: 1, toVersion: 2, migrate: (d) => ({ ...d, newField: 'x' }) },
  { fromVersion: 2, toVersion: 3, migrate: (d) => ({ ...d, items: (d.items ?? []).map((i) => ({ ...i, tag: '' })) }) },
]
const r = runMigrations({ items: [{ id: 1 }], old: true }, 1, migrations)
ok(r.version === 3 && r.applied.length === 2, 'سلسلة 1→2→3 كاملة')
ok(r.data.old === true && r.data.newField === 'x' && r.data.items[0].tag === '', 'لا حذف حقول — إضافة/تحويل فقط')
const r2 = runMigrations({ a: 1 }, 3, migrations)
ok(r2.version === 3 && r2.applied.length === 0, 'حالة محدثة أصلاً = لا ترحيل')
throws('ترحيل غير متسلسل يُرفض', () => runMigrations({}, 1, [{ fromVersion: 1, toVersion: 5, migrate: (d) => d }]))

console.log('— ⑥ الربط: عامل Cloudflare + الهيدر + صفحة حول —')
const worker = readFileSync(new URL('../../cloud/worker.js', import.meta.url), 'utf8')
ok(worker.includes("path === '/version'"), 'نقطة /version موجودة في العامل')
ok(worker.includes('latestVersion'), 'الاستجابة الافتراضية بالشكل المتفق')
const header = readFileSync(new URL('../src/ui/layout/Header.tsx', import.meta.url), 'utf8')
ok(header.includes('connectivityStatus'), 'الهيدر يشتق حالة الاتصال من النواة')
ok(header.includes("addEventListener('online'"), 'يستمع لأحداث الشبكة الحقيقية')
const aboutPage = readFileSync(new URL('../src/ui/pages/AboutPage.tsx', import.meta.url), 'utf8')
ok(aboutPage.includes('فحص التحديثات') && aboutPage.includes('APP_VERSION'), 'زر فحص التحديثات في «حول» بالإصدار الحالي')
ok(aboutPage.includes('buildUpdatePlan'), 'خطة التحديث الآمن معروضة للمستخدم')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
