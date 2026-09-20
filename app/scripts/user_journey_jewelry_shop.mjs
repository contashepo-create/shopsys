/**
 * 💍 رحلة محل صاغة كاملة (الفحص الفردي لنشاط الذهب والمجوهرات):
 * أسعار الجرام اليومية → مشغولات موصوفة (عيار/وزن/مصنعية) → إعادة تسعير آلية
 * عند تغير السوق → شراء كسر من عميل (لوط FIFO) → بيع كسر يستهلك اللوطات FIFO
 * بربح محسوب → مقايضة GTI (مشغول جديد مقابل كسر + فرق نقدي) بذرّية كاملة
 * → فشل نصف المقايضة يسترجع كل شيء → ميزان متزن.
 *
 * تشغيل: node --experimental-strip-types scripts/user_journey_jewelry_shop.mjs
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
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, done: true, countryCode: 'EG', activityId: 'jewelry', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import(join(root, 'src/data/repo.ts'))
const { jewelryPriceMinor } = await import(join(root, 'src/core/jewelry.ts'))
const { trialBalance } = await import(join(root, 'src/core/financialReports.ts'))
const st = () => useDataStore.getState()
let pass = 0
const ok = (n) => { pass++; console.log('  ✓', n) }
const acctBal = (code) => st().journal.flatMap((e) => e.lines).filter((l) => l.accountCode === code).reduce((s, l) => s + l.debit - l.credit, 0)

console.log('\n═══ 1) أسعار الجرام + مشغول موصوف يتسعر آلياً ═══')
{
  // إعادة التسعير قبل تحديث الأسعار مرفوضة
  assert.throws(() => st().repriceJewelry(), /حدّث أسعار/)
  st().setGramPrices({ k18: 320000, k21: 373000, k24: 426000 })
  st().addItem({ nameAr: 'غويشة عيار 21', categoryId: null, unit: 'قطعة', priceMinor: 0, barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const item = st().items[0]
  st().setJewelryProfile({ itemId: item.id, karat: 'k21', weightGrams: 15.5, workmanshipMinor: 250000 })
  // setJewelryProfile يسعّر فوراً (الأسعار محدثة) — وإعادة التسعير بلا تغيير سوق ترجع 0
  const expected = Math.round(15.5 * 373000) + 250000
  assert.equal(st().items[0].priceMinor, expected, 'السعر = وزن×جرام العيار + مصنعية فور الوصف')
  assert.equal(st().repriceJewelry(), 0, 'لا تغيير سوق ⇒ لا إعادة تسعير')
  ok(`الغويشة تسعّرت فور وصفها بـ${expected / 100}ج (15.5جم × 3730 + 2500 مصنعية)`)
}

console.log('\n═══ 2) السوق ارتفع — إعادة تسعير كل المعروض بضغطة ═══')
{
  st().setGramPrices({ k18: 330000, k21: 385000, k24: 440000 })
  assert.equal(st().repriceJewelry(), 1, 'قطعة واحدة أعيد تسعيرها بعد تغير السوق')
  const expected = Math.round(15.5 * 385000) + 250000
  assert.equal(st().items[0].priceMinor, expected, 'السعر تحدّث مع السوق')
  ok(`بعد ارتفاع الجرام لـ3850: سعر الغويشة ${expected / 100}ج تلقائياً`)
}

console.log('\n═══ 3) شراء كسر من عميلين (لوطان FIFO) ثم بيع يستهلكهما بالترتيب ═══')
{
  const lot1 = st().buyScrap({ karat: 'k21', weightGrams: 20, pricePerGramMinor: 360000, sellerName: 'أم محمد', treasury: '1101' })
  const lot2 = st().buyScrap({ karat: 'k21', weightGrams: 10, pricePerGramMinor: 370000, sellerName: 'أبو خالد', treasury: '1101' })
  assert.equal(st().journal.filter(e => e.sourceType === 'scrap_purchase').flatMap(e => e.lines).filter(l => l.accountCode === '1103').reduce((s, l) => s + l.debit, 0), 20 * 360000 + 10 * 370000, 'الكسر دخل مخزون 1103 بقيمة الشراء')
  // بيع 25 جم بـ 3900: FIFO يستهلك لوط1 كاملاً (20جم×3600) + 5جم من لوط2 (×3700)
  const sale = st().sellScrap({ karat: 'k21', weightGrams: 25, pricePerGramMinor: 390000, buyerName: 'تاجر سبائك', treasury: '1101' })
  const expectedCost = 20 * 360000 + 5 * 370000
  assert.equal(sale.costMinor, expectedCost, 'تكلفة FIFO بالترتيب')
  assert.equal(sale.profitMinor, 25 * 390000 - expectedCost, 'الربح محسوب')
  assert.equal(st().scrapLots.find((l) => l.id === lot1.id).remainingGrams, 0, 'اللوط الأول التُهم')
  assert.equal(st().scrapLots.find((l) => l.id === lot2.id).remainingGrams, 5, 'الثاني بقي 5جم')
  // بيع أكثر من المتاح مرفوض
  assert.throws(() => st().sellScrap({ karat: 'k21', weightGrams: 6, pricePerGramMinor: 390000, treasury: '1101' }))
  // بيع عيار لا رصيد له مرفوض
  assert.throws(() => st().sellScrap({ karat: 'k18', weightGrams: 1, pricePerGramMinor: 330000, treasury: '1101' }))
  ok(`بيع 25جم كسر: تكلفة FIFO ${expectedCost / 100}ج وربح ${sale.profitMinor / 100}ج — والبيع الزائد/العيار الفارغ مرفوضان`)
}

console.log('\n═══ 4) مقايضة GTI: غويشة جديدة مقابل كسر العميل + فرق نقدي ═══')
{
  // مخزون الغويشة عبر الشراء
  st().addSupplier({ nameAr: 'مصنع الذهب', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  const item = st().items[0]
  st().postPurchase({ supplierId: st().suppliers[0].id, date: '2026-09-19', treasury: '1102', notes: '', expenses: [], paidMinor: 0, lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 5800000 }] })
  const cashBefore = acctBal('1101')
  const lotsBefore = st().scrapLots.length
  const doc = st().postGoldTradeIn({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: st().items[0].priceMinor, unitCostMinor: 5800000, discountPercent: 0, soldByWeight: false }],
    taxPercent: 0, taxInclusive: true,
    scrapKarat: 'k21', scrapWeightGrams: 12, scrapPricePerGramMinor: 365000,
    treasury: '1101',
  })
  const salePrice = st().items[0].priceMinor
  assert.equal(doc.saleMinor, salePrice)
  assert.equal(doc.scrapValueMinor, 12 * 365000)
  assert.equal(doc.netMinor, salePrice - 12 * 365000, 'الصافي = بيع − كسر')
  assert.equal(acctBal('1101') - cashBefore, doc.netMinor, 'الخزينة تحركت بالفرق فقط')
  assert.equal(st().scrapLots.length, lotsBefore + 1, 'لوط كسر جديد من المقايضة')
  assert.equal(st().items[0].stockQty, 2, 'خرجت غويشة من المخزون')
  ok(`GTI: بيع ${doc.saleMinor / 100} − كسر ${doc.scrapValueMinor / 100} = فرق نقدي ${doc.netMinor / 100} فقط بالخزينة`)
}

console.log('\n═══ 5) ذرّية المقايضة: فشل شطر الكسر يسترجع البيع كله ═══')
{
  const salesBefore = st().sales.length
  const journalBefore = st().journal.length
  const stockBefore = st().items[0].stockQty
  const item = st().items[0]
  // وزن كسر سالب يفشل التحقق بعد البيع الداخلي — الكل يرتد
  assert.throws(() => st().postGoldTradeIn({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: item.priceMinor, unitCostMinor: 5800000, discountPercent: 0, soldByWeight: false }],
    taxPercent: 0, taxInclusive: true,
    scrapKarat: 'k21', scrapWeightGrams: -5, scrapPricePerGramMinor: 365000,
    treasury: '1101',
  }))
  assert.equal(st().sales.length, salesBefore, 'لا بيع يتيم')
  assert.equal(st().journal.length, journalBefore, 'لا قيود شبح')
  assert.equal(st().items[0].stockQty, stockBefore, 'المخزون كما كان')
  ok('مقايضة فاشلة = صفر أثر: لا بيع ولا قيد ولا حركة مخزون')
}

console.log('\n═══ 6) الميزان الختامي ═══')
{
  const tb = trialBalance(st().journal, { from: '2020-01-01', to: '2030-12-31' })
  assert.equal(tb.totalDebitMinor, tb.totalCreditMinor, 'الميزان متزن')
  for (const e of st().journal) {
    assert.equal(e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0), `قيد ${e.id} مختل`)
  }
  ok(`${st().journal.length} قيداً كلها متزنة، الميزان ${tb.totalDebitMinor}`)
}

console.log(`\n✅ رحلة محل الصاغة: ${pass} محطات — كلها خضراء\n`)
