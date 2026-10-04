/**
 * بوابة نقل الشبكة المحلية — مرحلة §102 (وثيقة §4.4: «ترتيب الرقع وحتمية البث»).
 *
 * تُثبت عبر قناة في الذاكرة (بلا Electron ولا مقابس — اختبار المنطق الصرف):
 *   1) الاقتران: رمز خاطئ يُرفض بعربية، رمز صحيح يصدر توكن جهاز ويسلّم لقطة.
 *   2) اللقطة الأولى: حالة العميل البيانية (حتى لو كانت له قاعدة قديمة) تصير
 *      مطابقة للمضيف مفتاحاً بمفتاح — وجلسة الجهاز تبقى ملكه.
 *   3) لا كتابة قبل الدخول — كل عملية تنفذ باسم صاحبها.
 *   4) كتابة RPC: بيع الكاشير يصل رقعةً للجميع، وسجل التدقيق عند المضيف يحمل
 *      اسم الكاشير (سياق مستخدم الجهاز أثناء التنفيذ).
 *   5) حارس المضيف عبر الشبكة: الرفض يصل برسالته العربية نفسها بلا أي أثر.
 *   6) التسلسل: نداءان متوازيان يُنفذان واحدًا بعد الآخر — لا فجوات في rev
 *      ولا تعارض، والميزان متوازن عند المضيف.
 *   7) دوال القراءة تبقى محلية عند العميل وتعطي نفس نتائج المضيف.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { reporter, freshCase, assertInvariants, balanceOf } from './auditKit.mjs'
import { LanHostCore } from '../src/data/lan/hostCore.ts'
import { LanClientCore } from '../src/data/lan/clientCore.ts'
import { LAN_SESSION_KEYS } from '../src/data/lan/protocol.ts'
import { hashPin } from '../src/core/audit.ts'

const R = reporter('نقل الشبكة المحلية — مضيف المحل (§102)')
const url = (rel) => new URL(rel, import.meta.url).href

/* ── 1) المضيف: حالة محل نظيفة بمستخدمين حقيقيين ── */
const host = await freshCase({ activityId: 'grocery', allowNegativeTreasury: true })
const hostStore = host.store
const pinHash = await hashPin('123456')
hostStore.getState().setOwnerPin(pinHash) /* حارس repo: لا مستخدمين قبل رقم المالك */
hostStore.getState().addAppUser({ nameAr: 'كاشير المحل', roleId: 'cashier', pinHash })
hostStore.getState().addAppUser({ nameAr: 'محاسب المحل', roleId: 'accountant', pinHash })
const cashier = hostStore.getState().appUsers.find((u) => u.nameAr === 'كاشير المحل')
const accountant = hostStore.getState().appUsers.find((u) => u.nameAr === 'محاسب المحل')
const item = hostStore.getState().addItem({
  nameAr: 'أرز 1كجم', categoryId: null, unit: 'كيس', priceMinor: 6000, costMinor: 4800,
  barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false,
  isService: false, minSalePriceMinor: 0, stockQty: 100,
})
const hostItem = hostStore.getState().items.find((i) => i.nameAr === 'أرز 1كجم')
void item
void hostItem

/* ── نواة المضيف فوق متجره ── */
const hostCore = new LanHostCore(hostStore, '1122', 'مضيف المحل الرئيسي', {
  onBadPairing: (device) => console.log(`  ⚠ محاولة اقتران خاطئة من «${device}»`),
})

/* ── 2) عميلان بنسختي repo مستقلتين (كما في أجهزة مختلفة) ── */
async function newClient(tag) {
  globalThis.localStorage.removeItem('shopsys-data')
  const mod = await import(url(`../src/data/repo.ts?lanClient=${tag}`))
  const store = mod.useDataStore
  /* قاعدة قديمة دخيلة قبل الاتصال — يجب أن تُمسح باللقطة */
  store.setState({ customers: [{ id: 999, nameAr: 'زبون قاعدة قديمة', phone: '', taxNumber: '', address: '', notes: '', isActive: false, creditLimitMinor: 0 }] }, false)
  return store
}
const clientStore1 = await newClient('cashier1')
const clientStore2 = await newClient('accountant1')

/* ── قناة في الذاكرة (تسليم فوري شفاف — اختبار المنطق الصرف لا الشبكة) ── */
function connect(tag, store) {
  let core = null
  const sessionId = hostCore.attach({
    deviceName: tag,
    send: (msg) => core?.onMessage(msg),
  })
  core = new LanClientCore({
    store,
    send: (msg) => hostCore.handle(sessionId, msg),
  })
  return { core }
}

const c1 = connect('جهاز الكاشير 1', clientStore1)
const c2 = connect('جهاز المحاسب', clientStore2)

/* ── 3) الاقتران: خاطئ ثم صحيح ── */
R.section('🔌 الاقتران وتسليم الجلسة')
{
  c1.core.pair('9999', 'جهاز الكاشير 1')
  assert.equal(c1.core.status === 'connected', false, 'الاقتران الخاطئ لا يسلم جلسة')
  c1.core.pair('1122', 'جهاز الكاشير 1')
  assert.equal(c1.core.status, 'connected', 'الاقتران الصحيح يسلّم الجلسة واللقطة')
  R.ok('رمز خاطئ يرفض، رمز صحيح يصدر توكن ويسلّم اللقطة')
}
c2.core.pair('1122', 'جهاز المحاسب')

/* ── 4) اللقطة الأولى ── */
const dataKeys = (state) => Object.entries(state).filter(([k, v]) => typeof v !== 'function' && !LAN_SESSION_KEYS.includes(k)).map(([k]) => k)
{
  const hs = hostStore.getState()
  const c1s = clientStore1.getState()
  for (const key of dataKeys(hs)) {
    assert.deepEqual(c1s[key], hs[key], `مفتاح اللقطة «${key}» غير متطابق بعد التسليم`)
  }
  /* القاعدة القديمة الدخيلة مُسحت */
  assert.ok(!clientStore1.getState().customers.some((cu) => cu.nameAr === 'زبون قاعدة قديمة'), 'بيانات القاعدة القديمة مسحت باللقطة')
  R.ok(`اللقطة الأولى مطابقة مفتاحاً بمفتاح (${dataKeys(hs).length} مفتاحاً) — والقاعدة القديمة للجهاز مُسحت`)
}

/* ── 5) لا كتابة قبل الدخول ── */
{
  await assert.rejects(
    () => c1.core.call('postSale', [{ lines: [], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' }]),
    /سجّل الدخول/,
    'قبل login ترفض كل عملية',
  )
  R.ok('قبل تسجيل الدخول ترفض كل عملية — «كل عملية باسم صاحبها»')
}

/* ── 6) الدخول عبر الشبكة: صحيح وخاطئ ── */
{
  await assert.rejects(() => c1.core.call('login', [cashier.id, '000000']), /رقم سري خاطئ/, 'رقم خاطئ يرفض بعربية')
  await c1.core.call('login', [cashier.id, '123456'])
  await c2.core.call('login', [accountant.id, '123456'])
  R.ok('الدخول يتحقق عند المضيف — رقم خاطئ يرفض وصحيح يسلم الجلسة')
}

/* ── 7) كتابة عبر RPC + بث الرقع + سياق المستخدم ── */
R.section('🧾 كتابة عبر الشبكة وبث الرقع')
const saleArgs = (qty) => [{
  lines: [{ itemId: hostItem.id, nameAr: hostItem.nameAr, qty, unitPriceMinor: 6000, unitCostMinor: 4800, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
}]
{
  const revBefore = hostCore.currentRev
  const invoice = await c1.core.call('postSale', saleArgs(2))

  assert.ok(invoice, 'نتيجة البيع عادت للكاشير')
  assert.equal(hostCore.currentRev, revBefore + 1, 'رقعة واحدة حتمية لكل عملية')
  /* التطابق بين الثلاثة */
  const hs = hostStore.getState()
  for (const key of ['sales', 'journal', 'items', 'auditLog']) {
    assert.deepEqual(clientStore1.getState()[key], hs[key], `مفتاح «${key}» غير متطابق بين المضيف والكاشير`)
    assert.deepEqual(clientStore2.getState()[key], hs[key], `مفتاح «${key}» غير متطابق بين المضيف والمحاسب`)
  }
  /* سجل التدقيق باسم الكاشير — سياق مستخدم الجهاز عند المضيف */
  const lastSaleEvents = hs.auditLog.slice(-6)
  const cashierNamed = lastSaleEvents.some((e) => e.user === 'كاشير المحل')
  assert.ok(cashierNamed, `سجل التدقيق عند المضيف يحمل اسم الكاشير (وجد: ${lastSaleEvents.map((e) => e.user).join('، ')})`)
  R.ok('بيع الكاشير: نتيجة فورية + رقعة واحدة للجميع + التدقيق عند المضيف باسم الكاشير')
}

/* ── 8) حارس المضيف عبر الشبكة: الرفض بلا أثر ── */
{
  const hostBefore = JSON.stringify(hostStore.getState().journal)
  const revBefore = hostCore.currentRev
  /* آجل لعميل بلا حد ائتمان — حارس الذمة يرفض عند المضيف */
  await assert.rejects(
    () => c1.core.call('postSale', [{ ...saleArgs(1)[0], payment: 'credit', paidMinor: 0 }]),
    /حد الائتمان|آجل/,
    'الرفض عبر الشبكة برسالة عربية',
  )

  assert.equal(hostCore.currentRev, revBefore, 'الرفض لا يبث أي رقعة')
  assert.equal(JSON.stringify(hostStore.getState().journal), hostBefore, 'الرفض لا يترك أثراً عند المضيف')
  R.ok('بوابة الاعتماد عبر الشبكة: الرسالة العربية نفسها تصل للكاشير بلا أي أثر جزئي')
}

/* ── 9) التسلسل: نداءان متوازيان — كاتب واحد بلا تعارض ── */
{
  const revBefore = hostCore.currentRev
  const [a, b] = await Promise.all([
    c1.core.call('postSale', saleArgs(1)),
    c2.core.call('postSale', saleArgs(3)),
  ])

  assert.ok(a && b, 'كلا البيعين نجح')
  assert.equal(hostCore.currentRev, revBefore + 2, 'رقعتان متسلسلتان — rev بلا فجوات')
  const sales = hostStore.getState().sales.length
  assert.ok(sales >= 3, `عدد الفواتير تراكم صحيحاً (${sales})`)
  assertInvariants('بعد بيعين متوازيين عبر الشبكة', host)
  const bal = balanceOf(hostStore.getState().journal, '1101')
  assert.ok(bal > 0, `الخزينة استقبلت المبيعات (${bal})`)
  R.ok('نداءان متوازيان يُنفذان متسلسلين — rev متصاعد بلا فجوات والميزان متوازن')
}

/* ── 10) دوال القراءة محلية عند العميل ── */
{
  const c1State = clientStore1.getState()
  const hState = hostStore.getState()
  assert.equal(typeof c1State.getFxHoldings, 'function', 'دوال القراءة موجودة')
  const localRead = c1State.getFxHoldings()
  const hostRead = hState.getFxHoldings()
  assert.deepEqual(localRead, hostRead, 'قراءة العميل المحلية تطابق قراءة المضيف')
  R.ok('دوال القراءة تبقى محلية عند العميل — نفس نتائج المضيف من الحالة المتزامنة')
}

/* ── 11) التطابق النهائي الشامل ── */
{
  const hs = hostStore.getState()
  for (const key of dataKeys(hs)) {
    assert.deepEqual(clientStore1.getState()[key], hs[key], `التطابق النهائي «${key}» مع جهاز الكاشير`)
    assert.deepEqual(clientStore2.getState()[key], hs[key], `التطابق النهائي «${key}» مع جهاز المحاسب`)
  }
  assert.equal(clientStore1.getState().currentUserId, cashier.id, 'جلسة الكاشير الجهازية محفوظة له وحده')
  assert.equal(hostStore.getState().currentUserId, null, 'المضيف بقي على هويته (المالك) بعد عمليات العملاء')
  R.ok(`التطابق النهائي الكامل (${dataKeys(hs).length} مفتاحاً × جهازين) — وجلسة كل جهاز له`)
}

R.done()
console.log(`
✅ بوابة نقل الشبكة: مضيف واحد + جهازان — الاقتران واللقطة والرقع والتسلسل وسياق المستخدم كلها خضراء`)
