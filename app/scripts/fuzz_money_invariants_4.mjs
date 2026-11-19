const { computeTotals, buildSaleEntry, buildSaleEntryWithAllocations } = await import('../src/core/pos.ts')
const { mulQty } = await import('../src/core/money.ts')
const { splitExactInclusiveTax } = await import('../src/core/money.ts').catch(() => ({}))
let seed = Number(process.argv[2] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const int = (a,b) => a + Math.floor(rnd()*(b-a+1))
const pick = a => a[Math.floor(rnd()*a.length)]
const fails = []
const fail = (m) => { fails.push(m) }

for (let t=0;t<4000;t++) {
  const lineCount = int(1,4)
  const lines = []
  for (let i=0;i<lineCount;i++) {
    const soldByWeight = rnd() < 0.5
    lines.push({
      itemId: i+1, nameAr: `صنف${i}`, qty: soldByWeight ? Math.round((0.05+rnd()*3)*1000)/1000 : int(1,6),
      unitPriceMinor: int(1, 20000), unitCostMinor: int(0, 15000), discountPercent: pick([0,0,0,2.5,5,10,33.3,100]),
      soldByWeight, vatPercentOverride: pick([undefined,undefined,undefined,0,5,15]),
    })
  }
  const invoiceDiscountPercent = pick([0,0,0,3,7.5,15,100])
  const taxPercent = pick([0,5,15])
  const taxInclusive = pick([true,false])
  let tot
  try { tot = computeTotals(lines, invoiceDiscountPercent, taxPercent, taxInclusive, 2) } catch(e) { fail(`رمي غير متوقع: ${e.message}`); continue }
  const gross = lines.reduce((s,l)=>s+mulQty(l.unitPriceMinor,l.qty),0)
  if (tot.grossMinor !== gross) fail(`الإجمالي قبل الخصم ${tot.grossMinor} ≠ ${gross}`)
  if (tot.discountMinor < 0) fail('خصم سالب')
  if (tot.netMinor !== tot.grossMinor - tot.discountMinor) fail(`net ${tot.netMinor} ≠ gross-disc ${tot.grossMinor-tot.discountMinor}`)
  if (tot.taxInclusive === undefined) void 0
  if (taxInclusive && tot.totalMinor !== tot.netMinor && taxPercent > 0) fail(`شامل: total ${tot.totalMinor} ≠ net ${tot.netMinor}`)
  if (!taxInclusive && tot.totalMinor !== tot.netMinor + tot.taxMinor) fail(`حاصر: total ${tot.totalMinor} ≠ net ${tot.netMinor} + tax ${tot.taxMinor}`)
  if (tot.taxBaseMinor + tot.taxMinor !== tot.totalMinor) fail(`الأساس+الضريبة ${tot.taxBaseMinor}+${tot.taxMinor} ≠ الإجمالي ${tot.totalMinor}`)
  for (const k of ['grossMinor','discountMinor','netMinor','taxBaseMinor','taxMinor','totalMinor','cogsMinor']) {
    if (!Number.isSafeInteger(tot[k]) || tot[k] < 0) fail(`${k} غير صالح ${tot[k]}`)
  }
  const cogsExpected = lines.reduce((s,l)=>s+mulQty(l.unitCostMinor,l.qty),0)
  if (tot.cogsMinor !== cogsExpected) fail(`تكلفة ${tot.cogsMinor} ≠ Σ ${cogsExpected}`)

  // قيد البيع: متوازن + توزيع الدفع = الإجمالي
  const paid = pick([0, tot.totalMinor, Math.floor(tot.totalMinor/2)])
  const entry = buildSaleEntry(tot, pick(['cash','credit','split']), '1101', paid, '1104')
  const d = entry.reduce((s,l)=>s+l.debit,0), c = entry.reduce((s,l)=>s+l.credit,0)
  if (d !== c) fail(`قيد غير متوازن ${d}/${c}`)
  const cashIn = entry.filter(l=>l.accountCode==='1101').reduce((s,l)=>s+l.debit-l.credit,0)
  if (cashIn !== paid) fail(`النقدي في القيد ${cashIn} ≠ المدفوع ${paid}`)
  const recv = entry.filter(l=>l.accountCode==='1104').reduce((s,l)=>s+l.debit-l.credit,0)
  if (recv !== tot.totalMinor - paid) fail(`الذمة ${recv} ≠ ${tot.totalMinor - paid}`)
  const cogsEntry = entry.filter(l=>l.accountCode==='5101').reduce((s,l)=>s+l.debit,0)
  if (cogsEntry !== tot.cogsMinor) fail(`5101 ${cogsEntry} ≠ ${tot.cogsMinor}`)
  const alloc = buildSaleEntryWithAllocations(tot, [{accountCode:'1101', amountMinor: paid}, {accountCode:'1102', amountMinor: tot.totalMinor-paid}].filter(a=>a.amountMinor>0), '1104')
  const d2 = alloc.reduce((s,l)=>s+l.debit,0), c2 = alloc.reduce((s,l)=>s+l.credit,0)
  if (d2 !== c2) fail(`قيد التوزيع غير متوازن ${d2}/${c2}`)
  if (entry.some(l=>!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit<0 || l.credit<0)) fail('سطر قيد غير صالح')
  if (fails.length) { console.log(`\n❌ seed=${process.argv[2]} حالة ${t}`); [...new Set(fails)].slice(0,6).forEach(f=>console.log('  - '+f)); console.log('  lines', JSON.stringify(lines), 'invDisc', invoiceDiscountPercent, 'tax', taxPercent, 'incl', taxInclusive); process.exit(1) }
}
console.log(`✅ seed ${process.argv[2]}: 4000 حالة حساب إجماليات + قيود — كل الهويات سليمة`)
