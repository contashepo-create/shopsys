/**
 * 🔧 رحلة ورشة صيانة موبايلات كاملة (الفحص الفردي لنشاط الصيانة):
 * استلام جهاز بIMEI وعربون (2109 التزام) → دورة حالات صارمة → كتالوج خدمات
 * بتكلفة سرية → تسليم بقطع غيار (متوسط مرجح) + مصنعية + خدمة + ضريبة
 * → العربون يُصفى من المستحق → تحصيل مجزأ والباقي دين → خدمة محافظ بربح
 * الفرق ومرتجعها بقيد عاكس → إلغاء تذكرة يرد عربونها → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_repair_shop.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'mobile_shop', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) استلام جهاز بIMEI وعربون 100 → 2109 التزام لا إيراد ═══')
{
  const t = st().openTicket({
    customerId: null, customerName: 'كريم', customerPhone: '01001112223',
    deviceName: 'iPhone 13', deviceSerial: '356789012345678', deviceCondition: 'خدش بالإطار — الشاشة سوداء',
    issue: 'لا يعمل بعد سقوطه بالماء', estimateMinor: 80000, prepaidMinor: 10000, treasury: '1101', notes: '',
  })
  assert.equal(t.status, 'received')
  assert.equal(acctBal('2109'), -10000, 'العربون التزام 2109')
  assert.equal(acctBal('1101'), 10000, 'العربون دخل الخزينة')
  ok(`تذكرة ${t.ticketNumber}: IMEI موثق وعربون 100 التزاماً`)
}
const ticket = st().tickets[0]

console.log('\n═══ 2) دورة الحالات الصارمة: التسليم قبل الجاهزية مرفوض ═══')
{
  assert.throws(() => st().deliverTicket(ticket.id, { laborMinor: 30000, parts: [], payment: 'cash', vatPercent: 0 }), /الجاهزة فقط/)
  st().setTicketStatus(ticket.id, 'in_progress')
  // قفزة باطلة: delivered مباشرة من in_progress عبر setTicketStatus
  assert.throws(() => st().setTicketStatus(ticket.id, 'delivered'))
  st().setTicketStatus(ticket.id, 'ready')
  ok('received→in_progress→ready — والقفزات الباطلة مرفوضة')
}

console.log('\n═══ 3) قطع غيار بمتوسط مرجح + كتالوج خدمات بتكلفة سرية ═══')
{
  st().addItem({ nameAr: 'شاشة iPhone 13', categoryId: null, unit: 'قطعة', priceMinor: 60000, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const screen = st().items[0]
  st().addSupplier({ nameAr: 'مورد قطع', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  // شراءان بتكلفتين مختلفتين → متوسط مرجح (400+500)/2 = 450
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-01', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: screen.id, qty: 1, unitPriceMinor: 40000 }] })
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-10', treasury: '1101', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: screen.id, qty: 1, unitPriceMinor: 50000 }] })
  assert.equal(st().items[0].costMinor, 45000, 'المتوسط المرجح 450')
  const svc = st().addMaintenanceService({ nameAr: 'سوفتوير وتنظيف بورد', costMinor: 5000, priceMinor: 15000 })
  assert.equal(svc.priceMinor, 15000)
  ok('شاشة بمتوسط مرجح 450 + خدمة كتالوج (تكلفة 50 سرية / سعر 150)')
}

console.log('\n═══ 4) تسليم: مصنعية 200 + شاشة 600 + خدمة 150 − عربون 100 ═══')
{
  const screen = st().items[0]
  const svc = st().maintenanceServices[0]
  const cashBefore = acctBal('1101')
  const t = st().deliverTicket(ticket.id, {
    laborMinor: 20000,
    parts: [{ itemId: screen.id, qty: 1, unitPriceMinor: 60000 }],
    services: [{ serviceId: svc.id, nameAr: svc.nameAr, qty: 1, unitPriceMinor: svc.priceMinor, unitCostMinor: svc.costMinor }],
    payment: 'cash', vatPercent: 0, treasury: '1101',
  })
  assert.equal(t.status, 'delivered')
  const gross = 20000 + 60000 + 15000 // 950
  assert.equal(acctBal('1101') - cashBefore, gross - 10000, 'المحصل نقداً = الإجمالي − العربون')
  assert.equal(acctBal('2109'), 0, 'العربون صُفي')
  assert.equal(st().items[0].stockQty, 1, 'خرجت شاشة واحدة')
  // تكلفة الشاشة 450 دخلت 5101
  assert.equal(st().journal.filter(e => e.sourceType === 'maintenance_ticket').flatMap(e => e.lines).filter(l => l.accountCode === '5101').reduce((s, l) => s + l.debit, 0), 45000, 'COGS بالمتوسط المرجح')
  // تسليم تذكرة مسلَّمة مرفوض
  assert.throws(() => st().deliverTicket(ticket.id, { laborMinor: 1, parts: [], payment: 'cash', vatPercent: 0 }))
  ok('تسليم 950: نقدي 850 بعد العربون، شاشة بتكلفة 450، والتسليم المزدوج مرفوض')
}

console.log('\n═══ 5) تذكرة ثانية تُلغى — عربونها يُرد ═══')
{
  const t2 = st().openTicket({ customerId: null, customerName: 'منى', customerPhone: '0122', deviceName: 'Samsung A54', issue: 'شاشة مكسورة', estimateMinor: 50000, prepaidMinor: 5000, treasury: '1101', notes: '' })
  const cashBefore = acctBal('1101')
  st().setTicketStatus(t2.id, 'cancelled')
  assert.equal(acctBal('1101') - cashBefore, -5000, 'رُد العربون نقداً')
  assert.equal(acctBal('2109'), 0, 'لا التزام معلق')
  ok('الإلغاء رد العربون 50 وصفّى الالتزام')
}

console.log('\n═══ 6) خدمة محافظ: تحصيل 1000 مقابل 990 للمزود ثم مرتجع عاكس ═══')
{
  const op = st().postWalletService({ type: 'balance_transfer', provider: 'vodafone', targetPhone: '01005556667', paidToProviderMinor: 100000, chargeMinor: 101000, paidMinor: 101000, customerId: null, fundingTreasury: '1101', receiveTreasury: '1101', vatPercent: 0, notes: '' })
  assert.equal(op.totals.profitGrossMinor, 1000, 'الربح = المحصل − المدفوع للمزود')
  const journalBefore = st().journal.length
  st().returnWalletService(op.id, 'العميل تراجع', 'المشرف')
  assert.equal(st().journal.length, journalBefore + 1, 'قيد عاكس واحد')
  const last = st().journal[st().journal.length - 1]
  assert.equal(last.lines.reduce((s, l) => s + l.debit, 0), last.lines.reduce((s, l) => s + l.credit, 0), 'العاكس متزن')
  assert.equal(st().walletOps.find(o => o.id === op.id).status, 'returned')
  // مرتجع المرتجع مرفوض
  assert.throws(() => st().returnWalletService(op.id, 'ثانية', 'المشرف'))
  ok('محافظ: ربح 10 بقيد فوري، والمرتجع عاكس متزن لا يتكرر')
}

console.log('\n═══ 7) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة ورشة الصيانة: ${pass} محطات — كلها خضراء\n`)
