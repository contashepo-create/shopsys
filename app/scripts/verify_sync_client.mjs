/**
 * فحص عميل المزامنة (data/syncClient.ts) بمحاكاة سحابة Supabase كاملة في الذاكرة:
 * إنشاء الصف، دفع، سحب، سباق جهازين حقيقي، سر خطأ، بيانات تالفة.
 * تشغيل: node --experimental-strip-types scripts/verify_sync_client.mjs
 */
import { syncChecksum } from '../src/core/sync.ts'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) } }

/* ─── سحابة PostgREST وهمية: جدول stores بسلوك الدفع الشرطي الحقيقي ─── */
const cloud = new Map() // store_id -> row
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url)
  const method = init.method ?? 'GET'
  const params = u.searchParams
  const storeId = (params.get('store_id') ?? '').replace('eq.', '')
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

  if (method === 'GET') {
    const row = cloud.get(storeId)
    return json(row ? [row] : [])
  }
  if (method === 'POST') {
    const body = JSON.parse(init.body)
    if (!cloud.has(body.store_id)) cloud.set(body.store_id, body)
    return json([], 201)
  }
  if (method === 'PATCH') {
    const revCond = Number((params.get('rev') ?? '').replace('eq.', ''))
    const row = cloud.get(storeId)
    if (!row || row.rev !== revCond) return json([]) // شرط فشل ⇒ صفر صفوف
    const body = JSON.parse(init.body)
    Object.assign(row, body)
    return json([row])
  }
  return json({ error: 'unsupported' }, 500)
}
// WebCrypto موجود في Node 22 — لا محاكاة مطلوبة

const { syncOnce, validateSyncConfig, encryptForSync } = await import('../src/data/syncClient.ts')

const config = { url: 'https://demo.supabase.co', anonKey: 'x'.repeat(40), storeId: 'matgar-1', secret: 'sirr-mushtarak' }

console.log('🧰 تحقق الإعدادات')
ok('إعداد سليم يمر', validateSyncConfig(config).length === 0)
ok('رابط فاسد يُرفض', validateSyncConfig({ ...config, url: 'http://evil' }).length > 0)
ok('سر قصير يُرفض', validateSyncConfig({ ...config, secret: '123' }).length > 0)

console.log('📤 أول دفع: إنشاء الصف ثم رفع الحالة مشفرة')
{
  const r = await syncOnce({ config, deviceId: 'dev-A', lastKnownRev: 0, localData: '{"sales":[1]}', localDirty: true })
  ok('دُفعت وأصبحت المراجعة 1', r.action === 'pushed' && r.newRev === 1)
  const row = cloud.get('matgar-1')
  ok('السحابة ترى شفرة لا نصاً', row.data.startsWith('SSENC1.') && !row.data.includes('sales'))
  ok('البصمة محسوبة على الشفرة', row.checksum === syncChecksum(row.data))
}

console.log('📥 جهاز ثانٍ جديد: يسحب حالة الجهاز الأول')
{
  const r = await syncOnce({ config, deviceId: 'dev-B', lastKnownRev: 0, localData: '{}', localDirty: false })
  ok('سحب المراجعة 1 وفك التشفير', r.action === 'pulled' && r.newRev === 1 && r.pulledData === '{"sales":[1]}')
}

console.log('😴 لا تغييرات: لا دفع ولا سحب')
{
  const r = await syncOnce({ config, deviceId: 'dev-B', lastKnownRev: 1, localData: '{"sales":[1]}', localDirty: false })
  ok('noop — الأجهزة متطابقة', r.action === 'noop' && r.newRev === 1)
}

console.log('⚔️ سباق حقيقي: A يدفع بين قراءة B ودفعه')
{
  // B يقرأ الآن rev=1... لكن A يدفع rev=2 قبل أن يصل دفع B
  const origFetch = globalThis.fetch
  let bReadDone = false
  globalThis.fetch = async (url, init = {}) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && !bReadDone) {
      bReadDone = true
      const res = await origFetch(url, init) // B قرأ rev=1
      // A يدفع في هذه الأثناء
      const row = cloud.get('matgar-1')
      row.rev = 2
      row.device_id = 'dev-A'
      row.data = await encryptForSync('{"sales":[1,2]}', config.secret)
      row.checksum = syncChecksum(row.data)
      return res
    }
    return origFetch(url, init)
  }
  const r = await syncOnce({ config, deviceId: 'dev-B', lastKnownRev: 1, localData: '{"sales":[1,99]}', localDirty: true })
  globalThis.fetch = origFetch
  ok('دفع B رُفض وسحب الأحدث بدل الكتابة العمياء', r.action === 'pulled' && r.newRev === 2 && r.pulledData === '{"sales":[1,2]}')
  ok('حالة A لم تُفقد في السحابة', cloud.get('matgar-1').device_id === 'dev-A')
}

console.log('🛡️ سر خطأ وبيانات تالفة')
{
  let threw = ''
  try { await syncOnce({ config: { ...config, secret: 'sirr-ghalat!' }, deviceId: 'dev-C', lastKnownRev: 0, localData: '{}', localDirty: false }) }
  catch (e) { threw = e.message }
  ok('سر مختلف: رسالة عربية واضحة ولا تطبيق', threw.includes('السر') || threw.includes('سر'))

  const row = cloud.get('matgar-1')
  const saved = row.data
  row.data = row.data.slice(0, -8) + 'AAAAAAAA' // إتلاف الشفرة (البصمة لن تطابق)
  let threw2 = ''
  try { await syncOnce({ config, deviceId: 'dev-D', lastKnownRev: 0, localData: '{}', localDirty: false }) }
  catch (e) { threw2 = e.message }
  ok('شفرة تالفة تُرفض ولا تمس المحلي', threw2.length > 0)
  row.data = saved
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 عميل المزامنة: تشفير كامل + قفل تفاؤلي مثبتان على سحابة محاكاة')
