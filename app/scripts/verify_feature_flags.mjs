/**
 * تحقق مفاتيح الميزات عن بُعد (البند 5):
 * النموذج الأمني: المنح بمفتاح موقَّع فقط — السحابة تطفئ مؤقتاً ولا تضيف أبداً.
 * + أوامر البوت في عامل Cloudflare (عطل/فعل/أعلام/نشر_تحديث) + نقطة /flags.
 * تشغيل: node --experimental-strip-types scripts/verify_feature_flags.mjs
 */
import { readFileSync } from 'node:fs'
import { parseDeviceFlags, effectiveFeatures, isCloudDisabled, EMPTY_FLAGS } from '../src/core/featureFlags.ts'

let PASS = 0, FAIL = 0
const ok = (cond, msg) => { if (cond) { PASS++; console.log(`  ✓ ${msg}`) } else { FAIL++; console.log(`  ✗ ${msg}`) } }

console.log('— التنقية —')
const f1 = parseDeviceFlags({ disabledFeatures: ['cloud_sync', 'hack_me', 'multi_branch'], noteAr: 'متأخر سداد', updatedAt: '2026-09-16' })
ok(f1.disabledFeatures.length === 2 && !f1.disabledFeatures.includes('hack_me'), 'ميزة مجهولة من السحابة تُتجاهل')
ok(f1.noteAr === 'متأخر سداد', 'الملاحظة العربية تمر')
ok(parseDeviceFlags(null).disabledFeatures.length === 0, 'استجابة فاسدة = أعلام فارغة (لا انهيار)')
ok(parseDeviceFlags('نص').disabledFeatures.length === 0, 'نص خام = أعلام فارغة')
const longNote = parseDeviceFlags({ disabledFeatures: [], noteAr: 'ا'.repeat(500) })
ok(longNote.noteAr.length === 300, 'الملاحظة تُقص عند 300 حرف')

console.log('— النموذج الأمني: السحابة تطفئ ولا تضيف —')
const licensed = ['cloud_sync', 'multi_user_lan']
ok(effectiveFeatures(licensed, f1).join(',') === 'multi_user_lan', 'الممنوح − المطفأ: cloud_sync اختفت')
ok(effectiveFeatures(licensed, null).join(',') === licensed.join(','), 'لا أعلام = كل الممنوح يعمل')
ok(effectiveFeatures(licensed, EMPTY_FLAGS).join(',') === licensed.join(','), 'أعلام فارغة = كل الممنوح يعمل')
// الأهم: السحابة لا تستطيع منح ميزة غير موجودة في المفتاح الموقَّع
const cheat = parseDeviceFlags({ disabledFeatures: [], noteAr: '', updatedAt: '' })
ok(!effectiveFeatures(['cloud_sync'], cheat).includes('multi_branch'), 'السحابة لا تضيف ميزة غير ممنوحة أبداً (لا ثغرة)')
ok(isCloudDisabled('cloud_sync', licensed, f1), 'ممنوحة + مطفأة = «عُطلت مؤقتاً» (رسالة مختلفة عن «غير مشتراة»)')
ok(!isCloudDisabled('einvoice_eg', licensed, f1), 'غير ممنوحة أصلاً ≠ مطفأة سحابياً')

console.log('— عامل Cloudflare: النقطة والأوامر —')
const worker = readFileSync(new URL('../../cloud/worker.js', import.meta.url), 'utf8')
ok(worker.includes('/flags/'), 'نقطة GET /flags/:deviceId موجودة')
ok(worker.includes("cmd === 'عطل'") && worker.includes("cmd === 'فعل'"), 'أمرا البوت: عطل/فعل')
ok(worker.includes("cmd === 'أعلام'"), 'أمر عرض الأعلام')
ok(worker.includes("cmd === 'نشر_تحديث'"), 'أمر نشر التحديث يحدّث /version')
ok(worker.includes('fromDevChat'), 'الأوامر من محادثة المطوّر فقط (حماية)')
ok(worker.includes("flags:"), 'الأعلام تُخزن بمفتاح flags:<device> في KV')

console.log('— الربط في التطبيق —')
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
ok(app.includes('fetchDeviceFlags'), 'App يجلب الأعلام مع دورة Cloudflare')
ok(app.includes('effectiveFeatures'), 'المزامنة الدورية تحترم مفتاح الإطفاء')
const store = readFileSync(new URL('../src/stores/app.store.ts', import.meta.url), 'utf8')
ok(store.includes('deviceFlags'), 'الأعلام محفوظة في المخزن (تعمل أوفلاين بآخر نسخة)')

console.log(`\nPASS=${PASS} FAIL=${FAIL}`)
if (FAIL > 0) process.exit(1)
