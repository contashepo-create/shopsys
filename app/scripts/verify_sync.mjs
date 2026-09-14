/**
 * فحص محرك المزامنة السحابية (Supabase) — القفل التفاؤلي متعدد الأجهزة
 * تشغيل: node --experimental-strip-types scripts/verify_sync.mjs
 */
import {
  syncChecksum, buildSyncEnvelope, decideSync, interpretPushResult,
  validateRemoteRow, retryDelayMs,
} from '../src/core/sync.ts'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }
const throws = (name, fn) => { try { fn(); fail++; console.log(`  ❌ ${name}`) } catch { pass++; console.log(`  ✅ ${name}`) } }

console.log('📦 مغلف الدفع')
{
  const env = buildSyncEnvelope({ storeId: 'st-1', deviceId: 'dev-A', baseRev: 4, data: '{"a":1}' })
  ok('nextRev = baseRev + 1', env.nextRev === 5)
  ok('البصمة تُحسب وتثبت', env.checksum === syncChecksum('{"a":1}') && env.checksum.length === 8)
}
throws('متجر فارغ يُرفض', () => buildSyncEnvelope({ storeId: ' ', deviceId: 'd', baseRev: 0, data: '{}' }))
throws('rev سالب يُرفض', () => buildSyncEnvelope({ storeId: 's', deviceId: 'd', baseRev: -1, data: '{}' }))

console.log('🔀 قرار المزامنة')
ok('محلي = سحابي ⇒ push', decideSync(7, 7).action === 'push')
ok('سحابي أحدث ⇒ pull أولاً', decideSync(5, 9).action === 'pull')
throws('أرقام فاسدة تُرفض', () => decideSync(NaN, 3))

console.log('⚔️ سيناريو جهازين يتسابقان (كاشير وفرع)')
{
  // كلاهما عند rev=10 — يدفعان معاً؛ السحابة (WHERE rev=10) تقبل الأول فقط
  const a = buildSyncEnvelope({ storeId: 's', deviceId: 'A', baseRev: 10, data: '{"sales":1}' })
  const b = buildSyncEnvelope({ storeId: 's', deviceId: 'B', baseRev: 10, data: '{"sales":2}' })
  const aResult = interpretPushResult(1, a) // قُبل
  const bResult = interpretPushResult(0, b) // رُفض — الشرط فشل
  ok('الجهاز الأول يُقبل', aResult.action === 'push')
  ok('الجهاز الثاني تعارض — لا كتابة عمياء ولا ضياع', bResult.action === 'conflict')
  // الجهاز B يسحب rev=11 ثم يعيد الدفع على أساسها
  const bRetry = decideSync(10, 11)
  ok('التعافي: يسحب الأحدث ثم يعيد', bRetry.action === 'pull')
}

console.log('🛡️ تحقق الصف المسحوب قبل تطبيقه (ضد التلف)')
{
  const good = { rev: 3, deviceId: 'A', updatedAt: '2026-09-15', checksum: syncChecksum('{"x":1}'), data: '{"x":1}' }
  ok('صف سليم يمر', validateRemoteRow(good).length === 0)
  ok('بصمة خطأ تُرفض', validateRemoteRow({ ...good, checksum: 'deadbeef' }).length > 0)
  ok('JSON تالف يُرفض', validateRemoteRow({ ...good, data: '{oops', checksum: syncChecksum('{oops') }).length > 0)
  ok('بيانات فارغة تُرفض', validateRemoteRow({ ...good, data: '', checksum: '' }).length > 0)
}

console.log('⏳ إعادة المحاولة بتراجع أُسّي')
ok('المحاولة 1 = 300ms', retryDelayMs(1) === 300)
ok('المحاولة 3 = 1200ms', retryDelayMs(3) === 1200)
ok('بعد الحد الأقصى: توقف وإخطار', retryDelayMs(6) === null)
throws('محاولة صفرية تُرفض', () => retryDelayMs(0))

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 محرك المزامنة جاهز لـ Supabase — قفل تفاؤلي بلا ضياع بيانات')
