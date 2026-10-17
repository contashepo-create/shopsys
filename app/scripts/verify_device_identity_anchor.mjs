// بند 2 (طلب المالك): ثبات معرّف الجهاز بعد مسح القاعدة + بقاء العميل «قديماً» في لوحة المطوّر
// الفكرة: هوية الجهاز تُحفظ في ملف داخل userData خارج قاعدة البيانات (userData/device-identity.json)
//        ⇒ مسح القاعدة (أو فقد مرساة Chromium) لا يغيّر المعرّف ⇒ يبقى العميل في لوحة
//        المطوّر عميلاً قديماً (isNew=false) ولا يُفقد الترخيص المرتبط بالجهاز.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const selfPath = fileURLToPath(import.meta.url)
let pass = 0
const fails = []
const ok = (name, cond) => (cond ? (pass++, console.log('  ✓ ' + name)) : fails.push(name))

// ── ① قواعد الدمج (دالة خالصة في desktop/deviceIdentity.ts) ─────────────────
const { mergeDeviceIdentity, generateDeviceIdFromBytes, normalizeDeviceId } =
  await import(join(appRoot, 'desktop/deviceIdentity.ts'))

const SAVED = 'SHOP-AAAA-BBBB-CCCC'
const OTHER = 'SHOP-ZZZZ-YYYY-XXXX'

const mergedSaved = mergeDeviceIdentity({ deviceId: SAVED, firstTrialAt: '2026-01-02' }, { deviceId: OTHER, firstTrialAt: '2026-01-01' })
ok('المعرّف المحفوظ لا يتغيّر أبداً (حتى بمرشّح مختلف)', mergedSaved.identity.deviceId === SAVED)
ok('بداية التجربة: الأقدم بين المحفوظ والوارد', mergedSaved.identity.firstTrialAt === '2026-01-01')

const mergedFresh = mergeDeviceIdentity(null, { deviceId: OTHER, firstTrialAt: '2026-01-05' })
ok('لا محفوظ ⇒ يُعتمد المرشّح الوارد (ترقية التطبيق لا تكسر الترخيص)', mergedFresh.identity.deviceId === OTHER)

const mergedInvalid = mergeDeviceIdentity(null, { deviceId: 'ليس معرّفاً' })
ok('مرشّح غير صالح يُرفض (لا معرّف جديد عشوائي)', mergedInvalid.identity.deviceId === null)

const mergedNoChange = mergeDeviceIdentity({ deviceId: SAVED, firstTrialAt: '2026-01-02' }, { deviceId: SAVED, firstTrialAt: '2026-01-02' })
ok('بلا تغيير ⇒ لا كتابة على القرص (changed=false)', mergedNoChange.changed === false)
ok('تغيير في المرشّح لا يكسر الهوية المحفوظة', mergeDeviceIdentity({ deviceId: SAVED }, { deviceId: OTHER }).changed === false)

ok('معرّف غير صالح يُنظَّف إلى null', normalizeDeviceId('shop-aaaa-bbbb-cccc') === SAVED && normalizeDeviceId('nope') === null)

// ── ② صيغة المعرّف مطابقة لمولّد الترخيص (core/license.ts) ────────────────
const { generateDeviceId } = await import(join(appRoot, 'src/core/license.ts'))
const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
ok('مولّد العملية الرئيسية = مولّد الواجهة (core/license.ts)', generateDeviceIdFromBytes(bytes) === generateDeviceId(bytes))
const { buildRegistrationReport } = await import(join(appRoot, 'src/core/registration.ts'))
ok('المعرّف المولَّد صالح للبلاغ (DEVICE_RE في core/registration.ts)', buildRegistrationReport({ deviceId: generateDeviceIdFromBytes(bytes) }) !== null)

// ── ③ الواجهة: تعتمد هوية العملية الرئيسية وت/herآئها في المرساة المحلية ─────
const mode = process.argv.includes('--web') ? 'web' : 'desktop'
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = globalThis
const DESKTOP_ID = 'SHOP-7K2M-9PXQ-4RTZ'
if (mode === 'desktop') {
  /* محاكاة جسر سطح المكتب: العملية الرئيسية هي المرجع */
  globalThis.window.shopsysDeviceIdentity = (candidate) => ({
    deviceId: DESKTOP_ID,
    firstTrialAt: candidate?.firstTrialAt ?? '2026-01-01T00:00:00.000Z',
  })
} else {
  /* في المتصفح: قد تصل مرساة مزروعة من الاختبار (قياس الثبات بعد «مسح القاعدة») */
  const seeded = process.env.SHOPSYS_TEST_ANCHOR
  if (seeded) mem.set('shopsys-i', seeded)
}

const { useAppStore } = await import(join(appRoot, 'src/stores/app.store.ts'))
const deviceId = useAppStore.getState().deviceId
const anchorRaw = mem.get('shopsys-i')
const anchor = anchorRaw ? JSON.parse(Buffer.from(anchorRaw, 'base64').toString('utf8')) : null
if (mode === 'web') console.log(`deviceId=${deviceId}`)

if (mode === 'desktop') {
  ok('معرّف الجهاز يأتي من مرساة العملية الرئيسية (خارج القاعدة)', deviceId === DESKTOP_ID)
  ok('المرساة المحلية تعكس مرساة العملية الرئيسية', anchor?.d === DESKTOP_ID)
  ok('معرّف الجهاز داخل المتجر يطابق المعتمد', useAppStore.getState().deviceId === deviceId)

  /* ── المتصفح (بلا جسر): يُقاس الثبات في عملية منفصلة ─────────────────── */
  const runWeb = (anchorB64) => spawnSync(process.execPath, ['--experimental-strip-types', selfPath, '--web'], {
    encoding: 'utf8',
    cwd: appRoot,
    env: { ...process.env, SHOPSYS_TEST_ANCHOR: anchorB64 ?? '' },
  })
  const first = runWeb('')
  const firstId = /deviceId=(SHOP-[A-Z0-9-]+)/.exec(first.stdout ?? '')?.[1] ?? ''
  ok('في المتصفح: معرّف جهاز يُولَّد ويُحفظ في المرساة', /^SHOP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(firstId))
  const anchorB64 = Buffer.from(JSON.stringify({ d: firstId, t: '2026-01-01T00:00:00.000Z' })).toString('base64')
  const second = runWeb(anchorB64)
  const secondId = /deviceId=(SHOP-[A-Z0-9-]+)/.exec(second.stdout ?? '')?.[1] ?? ''
  ok('إعادة الإقلاع بنفس المرساة ⇒ نفس معرّف الجهاز (ثبات بعد المسح)', secondId === firstId)
} else {
  const seeded = process.env.SHOPSYS_TEST_ANCHOR
  if (seeded) {
    const seededId = JSON.parse(Buffer.from(seeded, 'base64').toString('utf8')).d
    ok('المرساة المزروعة (بعد مسح القاعدة) تُحترم ⇒ المعرّف لا يتغيّر', deviceId === seededId)
  }
}

// ── ④ الربط في العملية الرئيسية (ملف ثابت) ────────────────────────────────
const mainSrc = readFileSync(join(appRoot, 'desktop/main.ts'), 'utf8')
const preloadSrc = readFileSync(join(appRoot, 'desktop/preload.ts'), 'utf8')
ok('العملية الرئيسية تسجّل معالج device:identity', /ipcMain\.on\('device:identity'/.test(mainSrc))
ok('ملف الهوية في userData (خارج القاعدة): device-identity.json', /device-identity\.json/.test(mainSrc))
ok('العملية الرئيسية تولّد المعرّف عند أول تشغيل فقط', /generateDeviceIdFromBytes\(randomBytes\(12\)\)/.test(mainSrc))
ok('المعالج متزامن (sendSync) لأن الترخيص يحتاج المعرّف فور الإقلاع', /sendSync\('device:identity'/.test(preloadSrc))
ok('preload يكشف shopsysDeviceIdentity', /exposeInMainWorld\('shopsysDeviceIdentity'/.test(preloadSrc))

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
