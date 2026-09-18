/**
 * فحص الصاغة: سعر الجرام اليومي بالعيار وإعادة التسعير الجماعية،
 * تفكيك السعر لذهب + مصنعية، وشراء/بيع الكسر FIFO بربح/خسارة ظاهرة —
 * مع توازن الدفتر بعد كل عملية.
 * تشغيل: node --experimental-strip-types scripts/verify_jewelry.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')
const { jewelryBreakdown, pricesAreStale, planScrapConsumption } = await import('../src/core/jewelry.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

console.log('💍 أسعار الجرام اليومية')
ok('الأسعار غير المدخلة «قديمة»', pricesAreStale(S().gramPrices, new Date().toISOString()))
throws('ترتيب أسعار غير منطقي يُرفض', () => S().setGramPrices({ k18: 500000, k21: 400000, k24: 600000 }), 'غير منطقي')
throws('سعر صفري يُرفض', () => S().setGramPrices({ k18: 0, k21: 400000, k24: 600000 }), 'موجباً')
S().setGramPrices({ k18: 300000, k21: 350000, k24: 400000 })
ok('الأسعار حُفظت بتاريخ اليوم', S().gramPrices.k21 === 350000 && !pricesAreStale(S().gramPrices, new Date().toISOString()))

console.log('⚖️ الوصف الذهبي وإعادة التسعير')
S().addItem(item({ nameAr: 'غويشة عيار 21', costMinor: 1000000 }))
S().addItem(item({ nameAr: 'خاتم عيار 18', costMinor: 500000 }))
S().addItem(item({ nameAr: 'سلسلة عيار 24', costMinor: 900000 }))
const [bangle, ring, chain] = S().items.slice(-3).map((i) => i.id)
S().setJewelryProfile({ itemId: bangle, karat: 'k21', weightGrams: 10, workmanshipMinor: 200000 })
// 10 × 350000 + 200000 = 3,700,000
ok('سعر الغويشة اشتُق فوراً = 37000', S().items.find((i) => i.id === bangle).priceMinor === 3_700_000)
const bd = jewelryBreakdown(S().jewelryProfiles[0], S().gramPrices)
ok('التفكيك: ذهب 35000 + مصنعية 2000', bd.goldMinor === 3_500_000 && bd.workmanshipMinor === 200_000)
S().setJewelryProfile({ itemId: ring, karat: 'k18', weightGrams: 4.5, workmanshipMinor: 100000 })
S().setJewelryProfile({ itemId: chain, karat: 'k24', weightGrams: 20, workmanshipMinor: 0 })
throws('وزن صفري يُرفض', () => S().setJewelryProfile({ itemId: ring, karat: 'k18', weightGrams: 0, workmanshipMinor: 0 }), 'أكبر من صفر')
throws('مصنعية سالبة تُرفض', () => S().setJewelryProfile({ itemId: ring, karat: 'k18', weightGrams: 1, workmanshipMinor: -5 }), 'سالبة')

// ارتفاع السوق صباح اليوم التالي
S().setGramPrices({ k18: 320000, k21: 370000, k24: 420000 })
const n = S().repriceJewelry()
ok('أعيد تسعير الأصناف الثلاثة', n === 3)
ok('الغويشة بالسعر الجديد = 39000', S().items.find((i) => i.id === bangle).priceMinor === 3_900_000)
ok('الخاتم = 4.5×3200+1000 = 15400', S().items.find((i) => i.id === ring).priceMinor === 1_540_000)
ok('السلسلة بلا مصنعية = 84000', S().items.find((i) => i.id === chain).priceMinor === 8_400_000)
ok('إعادة التسعير مرة ثانية بلا تغيير = 0', S().repriceJewelry() === 0)

console.log('🔥 شراء الكسر (FIFO)')
const cashBefore = bal('1101')
const lot1 = S().buyScrap({ karat: 'k21', weightGrams: 8, pricePerGramMinor: 330000, sellerName: 'أم أحمد' })
const lot2 = S().buyScrap({ karat: 'k21', weightGrams: 5, pricePerGramMinor: 340000 })
S().buyScrap({ karat: 'k18', weightGrams: 3, pricePerGramMinor: 290000 })
ok('دفعتا 21 ودفعة 18 برموز SCR', S().scrapLots.length === 3 && lot1.refCode.startsWith('SCR-'))
ok('الخزينة دفعت 8×3300 + 5×3400 + 3×2900', bal('1101') - cashBefore === -(2_640_000 + 1_700_000 + 870_000))
ok('1103 حمل قيمة الكسر', bal('1103') === 2_640_000 + 1_700_000 + 870_000)
throws('وزن صفري يُرفض', () => S().buyScrap({ karat: 'k21', weightGrams: 0, pricePerGramMinor: 100 }), 'أكبر من صفر')

console.log('💰 بيع الكسر FIFO بربح/خسارة')
const plan = planScrapConsumption(S().scrapLots, 'k21', 10)
ok('الخطة: 8 من الأولى + 2 من الثانية', plan.length === 2 && plan[0].grams === 8 && plan[1].grams === 2)
const sale = S().sellScrap({ karat: 'k21', weightGrams: 10, pricePerGramMinor: 360000, buyerName: 'مصنع الصاغة' })
// تكلفة: 8×330000 + 2×340000 = 3,320,000 — بيع: 10×360000 = 3,600,000 — ربح 280,000
ok('التكلفة FIFO = 33200', sale.costMinor === 3_320_000)
ok('الربح = 2800', sale.profitMinor === 280_000)
ok('الربح في 4101 دائن', bal('4101') === -280_000)
ok('المتبقي: صفر بالأولى و3 بالثانية', S().scrapLots.find((l) => l.id === lot1.id).remainingGrams === 0 && S().scrapLots.find((l) => l.id === lot2.id).remainingGrams === 3)
const sale2 = S().sellScrap({ karat: 'k21', weightGrams: 3, pricePerGramMinor: 300000 })
// تكلفة 3×340000=1,020,000 بيع 900,000 → خسارة 120,000
ok('الخسارة ظاهرة = 1200', sale2.profitMinor === -120_000 && bal('5101') === 120_000)
throws('بيع أكثر من المتاح يُرفض', () => S().sellScrap({ karat: 'k21', weightGrams: 50, pricePerGramMinor: 300000 }), 'المتاح')
throws('بيع عيار بلا رصيد يُرفض', () => S().sellScrap({ karat: 'k24', weightGrams: 1, pricePerGramMinor: 400000 }), 'المتاح')

console.log('⚖️ الميزان')
ok('1103 = قيمة الكسر المتبقي بالضبط (كسر 18 فقط)', bal('1103') === Math.round(3 * 290000))
ok('الدفتر متوازن بعد كل العمليات', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 الصاغة كاملة: تسعير يومي بالعيار ومصنعية منفصلة وكسر FIFO بربحية ظاهرة')
