/**
 * رحلة مستخدم كاملة: يوم محل بشبكة محلية (§102 — وثيقة §4).
 *
 * خمسة أدوار على خمسة أجهزة، قاعدة واحدة عند مضيف واحد:
 *   • صاحب المحل — على جهاز المضيف نفسه (يكتب محلياً وتربَط كتاباته ببث الرقع)
 *   • كاشير ×3 — أجهزة عملاء: دخول + بيع + إقفال الوردية
 *   • محاسب — جهاز عميل: سند قبض وقراءة الميزان
 *
 * القناة متأخرة 20ms لكل رسالة (محاكاة شبكة محل واقعية) — والفحوص تشمل:
 *   ① لقطة الدخول لكل جهاز  ② بث كتابة المضيف المحلية  ③ ذروة الزحام: خمس
 *   كتابات متزامنة بلا تعارض  ④ انتشار الحالة للخمسة ≤ 3 ثوانٍ  ⑤ بوابة
 *   الاعتماد عبر الشبكة (رفض عربي بلا أثر)  ⑥ انقطاع جهاز: كتابة معطلة
 *   وقراءة متاحة من آخر لقطة ثم عودة بالتوكن  ⑦ تطابق نهائي شامل + ثوابت.
 */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants, balanceOf } from './auditKit.mjs'
import { LanHostCore } from '../src/data/lan/hostCore.ts'
import { LanClientCore } from '../src/data/lan/clientCore.ts'
import { LAN_SESSION_KEYS } from '../src/data/lan/protocol.ts'
import { hashPin } from '../src/core/audit.ts'

const R = reporter('رحلة يوم محل عبر شبكة محلية (§102)')
const url = (rel) => new URL(rel, import.meta.url).href
const LAG = 20 /* تأخير القناة ملّي ثانية */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ═══ 1) الفجر: الصاحب يجهز محله على جهاز المضيف (كتابة محلية) ═══ */
R.section('🌅 الفجر — تجهيز المحل عند المضيف')
const host = await freshCase({ activityId: 'grocery', allowNegativeTreasury: true })
const hostStore = host.store
const pinHash = await hashPin('101010')
hostStore.getState().setOwnerPin(pinHash)
for (const [name, role] of [['كاشير أول', 'cashier'], ['كاشير ثان', 'cashier'], ['كاشير ثالث', 'cashier'], ['محاسب المحل', 'accountant']]) {
  hostStore.getState().addAppUser({ nameAr: name, roleId: role, pinHash })
}
const users = hostStore.getState().appUsers
const c1u = users.find((u) => u.nameAr === 'كاشير أول')
const c2u = users.find((u) => u.nameAr === 'كاشير ثان')
const c3u = users.find((u) => u.nameAr === 'كاشير ثالث')
const accu = users.find((u) => u.nameAr === 'محاسب المحل')

const goods = [
  ['أرز 1كجم', 6000, 4800, 200], ['سكر 1كجم', 3500, 2900, 150], ['زيت 800مل', 8500, 7000, 80],
  ['شاي 250جم', 4500, 3600, 120], ['مكرونة 400جم', 1500, 1100, 300], ['تونة 140جم', 3000, 2400, 100],
]
const itemIds = {}
for (const [name, price, cost, qty] of goods) {
  hostStore.getState().addItem({
    nameAr: name, categoryId: null, unit: 'قطعة', priceMinor: price, costMinor: cost,
    barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false,
    isService: false, minSalePriceMinor: 0, stockQty: qty,
  })
  itemIds[name] = hostStore.getState().items[hostStore.getState().items.length - 1].id
}
hostStore.getState().addCustomer({ nameAr: 'عميل الجملة', phone: '', taxNumber: '', address: '', notes: '', isActive: true, creditLimitMinor: 50000 })
const customer = hostStore.getState().customers.find((cu) => cu.nameAr === 'عميل الجملة')
R.ok(`تجهيز المحل: ${goods.length} أصناف + 4 مستخدمين + عميل جملة — كتابة محلية عند المضيف`)

/* ═══ المضيف: نواة الاستضافة + بث كتاباته المحلية ═══ */
const hostCore = new LanHostCore(hostStore, '2468', 'مضيف محل الرئيسي', {
  onSessionUser: (device, userId) => console.log(`    👤 «${device}» دخل باسم ${userId == null ? 'المالك' : (users.find((u) => u.id === userId)?.nameAr ?? userId)}`),
})
const stopLocalBroadcast = hostCore.startLocalBroadcast()

/* ═══ 2) الأجهزة الأربعة تتصل وتتسلم اللقطات ═══ */
R.section('🔌 اقتران الأجهزة الأربع وتسليم اللقطات')
const dataKeys = (state) => Object.entries(state).filter(([k, v]) => typeof v !== 'function' && !LAN_SESSION_KEYS.includes(k)).map(([k]) => k)

const clientLinks = []
for (const [tag, q] of [['كاشير أول', 'day1'], ['كاشير ثان', 'day2'], ['كاشير ثالث', 'day3'], ['المحاسب', 'day4']]) {
  globalThis.localStorage.removeItem('shopsys-data')
  const mod = await import(url(`../src/data/repo.ts?${q}`))
  let online = true
  const entry = { tag, store: mod.useDataStore, online, core: null, sid: 0 }
  entry.sid = hostCore.attach({
    deviceName: tag,
    send: (m) => { if (entry.online) setTimeout(() => entry.core?.onMessage(m), LAG) },
  })
  entry.core = new LanClientCore({
    store: mod.useDataStore,
    send: (m) => { if (entry.online) setTimeout(() => hostCore.handle(entry.sid, m), LAG) },
  })
  clientLinks.push(entry)
}
const [c1, c2, c3, acc] = clientLinks

/* ═══ 3) الاقتران ولقطة كل جهاز ═══ */
for (const link of clientLinks) link.core.pair('2468', link.tag)
await sleep(200)
for (const link of clientLinks) assert.equal(link.core.status, 'connected', `جهاز «${link.tag}» متصل`)
{
  const hs = hostStore.getState()
  for (const link of clientLinks) {
    for (const key of dataKeys(hs)) {
      assert.deepEqual(link.store.getState()[key], hs[key], `لقطة «${link.tag}» — مفتاح «${key}»`)
    }
  }
  R.ok(`الأجهزة الأربعة اقترنت وتسلّمت اللقطة كاملة (${dataKeys(hs).length} مفتاحاً لكل جهاز)`)
}

/* ═══ 4) دخول الأدوار + وردية الصباح ═══ */
R.section('🌅 الصباح — دخول الأدوار وفتح وردية')
for (const [link, user] of [[c1, c1u], [c2, c2u], [c3, c3u], [acc, accu]]) {
  await link.core.call('login', [user.id, '101010'])
}
assert.equal(c1.store.getState().currentUserId, c1u.id, 'جهاز الكاشير الأول يعرف هوية صاحبه')
console.log('    [rev بعد logins]', hostCore.currentRev)
R.ok('الأدوار الأربعة سجلت دخولها من أجهزتها — الجلسة محفوظة عند كل جهاز')

const morningShift = await c1.core.call('openShift', ['كاشير أول', 5000])
assert.equal(morningShift.status, 'open', 'وردية الصباح فُتحت')
await sleep(150)
console.log('    [rev بعد openShift]', hostCore.currentRev)
R.ok(`وردية الصباح فُتحت من جهاز الكاشير الأول (#${morningShift.id}) ووصلت للجميع`)

/* ═══ 5) ذروة الزحام: خمس كتابات متزامنة (3 كاشير + محاسب + الصاحب محلياً) ═══ */
R.section('🔥 الذروة — خمس كتابات متزامنة عبر الشبكة')
const saleOf = (item, qty) => [{
  lines: [{ itemId: itemIds[item], nameAr: item, qty, unitPriceMinor: hostStore.getState().items.find((i) => i.id === itemIds[item]).priceMinor, unitCostMinor: hostStore.getState().items.find((i) => i.id === itemIds[item]).costMinor, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
}]
const revBeforeRush = hostCore.currentRev
const rushStart = Date.now()
const [sale1, sale2, sale3, voucher] = await Promise.all([
  c1.core.call('postSale', saleOf('أرز 1كجم', 3)),
  c2.core.call('postSale', saleOf('سكر 1كجم', 5)),
  c3.core.call('postSale', saleOf('زيت 800مل', 2)),
  acc.core.call('postVoucher', [{ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 12000, description: 'تحصيل دفعة من عميل الجملة', partyKind: 'customer', partyId: customer.id }]),
])
/* الصاحب يكتب محلياً في نفس اللحظة — إضافة صنف طارئ */
hostStore.getState().addItem({
  nameAr: 'مياه 1.5لتر', categoryId: null, unit: 'كرتونة', priceMinor: 5000, costMinor: 4000,
  barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false,
  isService: false, minSalePriceMinor: 0, stockQty: 50,
})
assert.ok(sale1 && sale2 && sale3, 'مبيعات الذروة الثلاث نجحت')
assert.ok(voucher, 'سند قبض المحاسب نجح')
console.log('    [rev بعد الذروة قبل مزامنة]', hostCore.currentRev)
R.ok('أربع نداءات متوازية عبر الشبكة + كتابة محلية للصاحب — كلها بلا تعارض')

/* انتشار الحالة للجميع ≤ 3 ثوانٍ */
async function untilSynced(timeoutMs = 3000) {
  const t0 = Date.now()
  for (;;) {
    const hs = hostStore.getState()
    const synced = clientLinks.every((link) => dataKeys(hs).every((k) => JSON.stringify(link.store.getState()[k]) === JSON.stringify(hs[k])))
    if (synced) return Date.now() - t0
    if (Date.now() - t0 > timeoutMs) throw new Error(`لم تتزامن الأجهزة خلال ${timeoutMs}ms`)
    await sleep(5)
  }
}
const spreadMs = await untilSynced()
assert.ok(spreadMs <= 3000, `زمن الانتشار ${spreadMs}ms ضمن سقف 3 ثوانٍ`)
R.ok(`انتشار الحالة للأجهزة الأربعة خلال ${spreadMs}ms (سقف §102: 3000ms)`)

{
  const revs = hostCore.currentRev
  assert.equal(revs, revBeforeRush + 5, `خمس رقع للعمليات الخمس (rev ${revBeforeRush}→${revs})`)
  const hs = hostStore.getState()
  assert.equal(hs.sales.length, 3, 'ثلاث فواتير')
  assert.equal(hs.vouchers.length, 1, 'سند واحد')
  assert.ok(hs.items.some((i) => i.nameAr === 'مياه 1.5لتر'), 'صنف الصاحب الطارئ أُضيف')
  /* كتابة الصاحب المحلية وصلت الجميع برقعة */
  for (const link of clientLinks) {
    assert.ok(link.store.getState().items.some((i) => i.nameAr === 'مياه 1.5لتر'), `صنف الصاحب وصل «${link.tag}»`)
  }
  R.ok('خمس رقع بلا فجوات — وكتابة الصاحب المحلية بُثت للجميع كرقعة')
  /* التدقيق بأسماء أصحابها */
  const names = new Set(hostStore.getState().auditLog.slice(-30).map((e) => e.user))
  for (const expected of ['كاشير أول', 'كاشير ثان', 'كاشير ثالث', 'محاسب المحل']) {
    assert.ok(names.has(expected), `سجل التدقيق يذكر «${expected}»`)
  }
  R.ok('سجل التدقيق عند المضيف يحمل أسماء المنفذين الأربعة — كل عملية باسم صاحبها')
}

/* ═══ 6) بوابة الاعتماد عبر الشبكة: رفض عربي بلا أثر ═══ */
{
  const before = JSON.stringify(hostStore.getState().journal)
  const revB = hostCore.currentRev
  /* بيع آجل لعميل الجملة فوق حد ائتمانه (50000) — حارس الذمة عند المضيف يرفض */
  const creditOver = saleOf('تونة 140جم', 25)[0]
  creditOver.payment = 'credit'
  creditOver.customerId = customer.id
  creditOver.paidMinor = 0
  await assert.rejects(
    () => c2.core.call('postSale', [creditOver]),
    /حد الائتمان|آجل/,
    'حارس الذمة يرفض عبر الشبكة',
  )
  await sleep(120)
  assert.equal(hostCore.currentRev, revB, 'لا رقعة بعد الرفض')
  assert.equal(JSON.stringify(hostStore.getState().journal), before, 'لا أثر في القيود')
  const ms = await untilSynced()
  assert.ok(ms <= 3000)
  R.ok('بيع آجل فوق حد الائتمان: الرسالة العربية نفسها وصلت الكاشير الثانى — بلا أي أثر جزئي')
}

/* ═══ 7) انقطاع جهاز: كتابة معطلة، قراءة متاحة، ثم عودة ═══ */
R.section('⚡ انقطاع جهاز الكاشير الثالث — ثم عودته')
c3.online = false
c3.core.connectionLost()
{
  await assert.rejects(
    () => c3.core.call('postSale', saleOf('مكرونة 400جم', 1)),
    /انقطع الاتصال بالمضيف/,
    'الكتابة ترفض عند الانقطاع',
  )
  /* القراءة المحلية من آخر لقطة تعمل */
  const localSales = c3.store.getState().sales.length
  assert.ok(localSales >= 3, `القراءة متاحة من آخر لقطة (${localSales} فاتورة)`)
  R.ok('أثناء الانقطاع: الكتابة مرفوضة برسالة الانقطاع — والقراءة تعمل من آخر لقطة')
}
/* بقية المحل يكمل بلا توقف */
const saleDuringOutage = await c1.core.call('postSale', saleOf('شاي 250جم', 2))
assert.ok(saleDuringOutage, 'المحل يكمل أثناء انقطاع جهاز')
await sleep(150)
{
  /* عودة الجهاز: إقتران بالتوكن المحفوظ (بلا رمز) ثم لقطة جديدة */
  c3.online = true
  assert.ok(c3.core.token, 'توكن الجهاز محفوظ')
  c3.core.hello(c3.core.token, 'كاشير ثالث')
  await sleep(150)
  assert.equal(c3.core.status, 'connected', 'الجهاز عاد بالتوكن')
  const ms = await untilSynced()
  assert.ok(ms <= 3000, `المزامنة بعد العودة ${ms}ms`)
  assert.deepEqual(c3.store.getState().sales, hostStore.getState().sales, 'لقطته تطابق الواقع بعد العودة')
  R.ok(`العودة بالتوكن (بلا رمز اقتران): لقطة كاملة ثم مزامنة خلال ${ms}ms`)
  /* الكتابة تعمل بعد العودة */
  const afterOutage = await c3.core.call('postSale', saleOf('مكرونة 400جم', 4))
  assert.ok(afterOutage, 'كتابة بعد العودة')
  await sleep(150)
  R.ok('الكتابة عادت للعمل بعد استعادة الاتصال')
}

/* ═══ 8) المساء: إقفال الوردية وقراءة ملخص اليوم ═══ */
R.section('🌆 المساء — إقفال الوردية وملخص اليوم')
const closing = await c3.core.call('closeShift', [120000, 'المالك', 'إقفال نهاية اليوم'])
assert.equal(closing.status, 'closed', 'الوردية أُقفلت')
await sleep(150)
{
  const hs = hostStore.getState()
  /* ملخص الصاحب: مبيعات اليوم من جهاز المضيف مباشرة */
  const todaySales = hs.sales.length
  const treasury = balanceOf(hs.journal, '1101')
  /* المحاسب يقرأ من جهازه (قراءة محلية متزامنة) */
  const accSales = acc.store.getState().sales.length
  const accTreasuryCash = balanceOf(acc.store.getState().journal, '1101')
  assert.equal(accSales, todaySales, 'المحاسب يرى نفس عدد الفواتير')
  assert.deepEqual(accTreasuryCash, treasury, 'المحاسب يرى نفس رصيد الخزينة')
  R.ok(`ملخص اليوم: ${todaySales} فواتير — رصيد الخزينة 1101: ${treasury} — متطابق عند المضيف والمحاسب`)
  /* ميزان اليوم متوازن: مجموع المدين = الدائن */
  let debit = 0
  let credit = 0
  for (const entry of hs.journal) {
    for (const line of entry.lines) {
      debit += line.debit
      credit += line.credit
    }
  }
  assert.equal(debit, credit, `الميزان متوازن (${debit} = ${credit})`)
  R.ok(`قيود اليوم متوازنة: مدين ${debit} = دائن ${credit} على ${hs.journal.length} قيداً`)
}

/* ═══ 9) الخلاصة: تطابق شامل + ثوابت + نظافة ═══ */
R.section('✨ الخلاصة — تطابق الأجهزة والثوابت')
{
  const hs = hostStore.getState()
  for (const link of clientLinks) {
    for (const key of dataKeys(hs)) {
      assert.deepEqual(link.store.getState()[key], hs[key], `التطابق النهائي «${link.tag}» — «${key}»`)
    }
  }
  R.ok(`الأجهزة الأربعة × ${dataKeys(hs).length} مفتاحاً — تطابق تام مع قاعدة المضيف`)
  assertInvariants('نهاية يوم محل موزع', host)
  R.ok('ثوابت المحاسبة العشرة خضراء عند المضيف بعد يوم كامل موزع')
  assert.equal(hostStore.getState().currentUserId, null, 'المضيف بقي على هوية المالك طول اليوم')
  assert.equal(c1.store.getState().currentUserId, c1u.id, 'كل جهاز حافظ على جلسة صاحبه')
}
stopLocalBroadcast()

R.done()
console.log(`
✅ يوم محل كامل عبر الشبكة المحلية: صاحب + 3 كاشير + محاسب — خمس كتابات متزامنة،
   بوابة اعتماد عبر الشبكة، انقطاع وعودة، إقفال وردية، وتطابق تام — كلها خضراء`)
