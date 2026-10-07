/**
 * تحقق البنية الهجينة والتحديث التلقائي (البنود 3 و6):
 * ① اشتقاق وضع التشغيل الأربعة من ميزات الرخصة الموقَّعة فقط (لا تزوير محلي).
 * ② مؤشر الاتصال المرئي — كل الحالات الخمس بمدخلات حقيقية.
 * ③ مقارنة الإصدارات وقرار التحديث (اختياري/إجباري) وتنقية استجابة GitHub.
 * ④ خطة التحديث الآمن: نسخة احتياطية أولاً + تراجع كامل عند الفشل.
 * ⑤ ترحيلات المخطط المتسلسلة بلا فقد بيانات.
 * ⑥ فحص آخر إصدار من GitHub والهيدر يعرض المؤشر.
 * تشغيل: node --experimental-strip-types scripts/verify_architecture_updates.mjs
 */
import { readFileSync } from 'node:fs'
import {
  deriveArchitectureMode, MODE_LABELS, connectivityStatus, CONNECTIVITY_LABELS,
} from '../src/core/architecture.ts'
import {
  APP_VERSION, LATEST_RELEASE_API, isValidVersion, compareVersions, parseUpdateInfo,
  parseGitHubRelease, decideUpdate, buildUpdatePlan, rollbackFrom, runMigrations,
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
ok(parseUpdateInfo({ latestVersion: 'abc' }) === null, 'إصدار فاسد = null (لا انهيار)')
ok(parseUpdateInfo('نص') === null, 'استجابة غير كائن = null')
const githubInfo = parseGitHubRelease({
  tag_name: 'v1.2.3', html_url: 'https://github.com/contashepo-create/tahakam-releases/releases/tag/v1.2.3',
  body: 'تحسينات', published_at: '2026-10-07T10:00:00Z',
  assets: [{ name: 'tahakom-setup-1.2.3.exe', browser_download_url: 'https://downloads.example/setup.exe' }],
})
ok(githubInfo?.latestVersion === '1.2.3' && githubInfo.downloadUrl.endsWith('setup.exe'), 'بيانات أحدث إصدار GitHub تُحوّل لصيغة التطبيق')
ok(parseGitHubRelease({ tag_name: 'draft' }) === null, 'وسم إصدار غير صالح من GitHub يُرفض')
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

console.log('— ⑥ الربط: GitHub للتحديثات + Cloudflare للترخيص و«حول» —')
ok(LATEST_RELEASE_API.includes('api.github.com/repos/contashepo-create/tahakam-releases/releases/latest'), 'فحص نسخة المتصفح يتصل بإصدارات GitHub المنشورة')
const header = readFileSync(new URL('../src/ui/layout/Header.tsx', import.meta.url), 'utf8')
ok(header.includes('connectivityStatus'), 'الهيدر يشتق حالة الاتصال من النواة')
ok(header.includes("addEventListener('online'"), 'يستمع لأحداث الشبكة الحقيقية')
const aboutPage = readFileSync(new URL('../src/ui/pages/AboutPage.tsx', import.meta.url), 'utf8')
ok(aboutPage.includes('فحص التحديثات') && aboutPage.includes('APP_VERSION'), 'زر فحص التحديثات في «حول» بالإصدار الحالي')
ok(aboutPage.includes('buildUpdatePlan'), 'خطة التحديث الآمن معروضة للمستخدم')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
