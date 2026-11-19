const { promotionCartLines } = await import('../src/core/promotions.ts')
const { computeTotals } = await import('../src/core/pos.ts')
const { mulQty } = await import('../src/core/money.ts')
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed*1103515245+12345)%2147483648; return seed/2147483648 }
const int = (a,b)=>a+Math.floor(rnd()*(b-a+1))
let fails = []
for (let t=0;t<3000;t++) {
  const compCount = int(1,4)
  const items = []
  const components = []
  for (let i=0;i<compCount;i++) {
    const price = int(1, 20000)
    items.push({ id:i+1, nameAr:`م${i}`, priceMinor: price, costMinor: int(0, price), vatOverride: null })
    components.push({ itemId: i+1, qty: int(1,3) })
  }
  const retailSum = components.reduce((s,c)=> s + items.find(i=>i.id===c.itemId).priceMinor * c.qty, 0)
  const bundlePriceMinor = int(1, retailSum) // سعر الباقة ≤ التجزئة
  const count = int(1,3)
  const promo = { nameAr:'عرض', components, bundlePriceMinor }
  const lines = promotionCartLines(promo, count, items)
  const t1 = computeTotals(lines, 0, 15, true, 2)
  // ثوابت: صافي الباقة = سعر الباقة × العدد، والكميات صحيحة، ولا سعر سالب، والتوزيع دقيق
  const expected = bundlePriceMinor * count
  if (t1.netMinor !== expected) fails.push(`صافي الباقة ${t1.netMinor} ≠ ${expected}`)
  const qtyExpected = components.reduce((s,c)=>s+c.qty,0) * count
  const qtyActual = lines.reduce((s,l)=>s+l.qty,0)
  if (qtyActual !== qtyExpected) fails.push(`كمية ${qtyActual} ≠ ${qtyExpected}`)
  if (lines.some(l=>l.unitPriceMinor < 0 || !Number.isSafeInteger(l.unitPriceMinor))) fails.push('سعر غير صالح')
  // مجموع الحصص = سعر الباقة (لا يتسرب قرش ولا يُخترع)
  const lineSum = lines.reduce((s,l)=> s + mulQty(l.unitPriceMinor, l.qty), 0)
  if (lineSum !== expected) fails.push(`حصص السطور ${lineSum} ≠ ${expected}`)
  // كل سطر يجب ألا يتجاوز سعره التجزئي (الباقة أرخص أو مساوية)
  for (const l of lines) {
    const retail = items.find(i=>i.id===l.itemId).priceMinor
    if (l.unitPriceMinor > retail + 1) fails.push(`سطر ${l.itemId} صار أغلى من التجزئة (${l.unitPriceMinor} > ${retail})`)
  }
  if (fails.length) { console.log(`\n❌ حالة ${t}`); [...new Set(fails)].slice(0,6).forEach(f=>console.log('  - '+f)); console.log(JSON.stringify({components, bundlePriceMinor, count, lines: lines.map(l=>({id:l.itemId,q:l.qty,p:l.unitPriceMinor}))})); process.exit(1) }
}
console.log('✅ العروض: 3000 باقة — الصافي والتوزيع والكميات سليمة')
