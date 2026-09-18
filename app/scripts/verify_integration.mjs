/**
 * اختبار تكامل شامل على مخزن البيانات الحقيقي (data/repo.ts) داخل Node:
 * دورة كاملة: خزائن ← موظفون ← عهدة (فتح/تعزيز/فاتورة شراء من العهدة/مصروف/تسوية بعجز)
 * ← سلفة ← مسير رواتب بخصم سلفة وصرف مستحق ← ميزان مراجعة متزن + معادلة محاسبية.
 * تشغيل: node --experimental-strip-types scripts/verify_integration.mjs
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ` — ${e.message}`}`) }
}
const S = () => useDataStore.getState()

/* ميزان متزن؟ */
const trialBalanced = () => {
  let d = 0, c = 0
  for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }
  return d === c
}

console.log('🏗️ التأسيس: مورد + موظفان + صنف')
S().addSupplier({ nameAr: 'مورد الاختبار' })
S().addEmployee({ nameAr: 'أحمد المشرف', baseSalaryMinor: 500000, allowancesMinor: 50000 })
S().addEmployee({ nameAr: 'سعيد الفني', baseSalaryMinor: 300000, allowancesMinor: 0 })
S().addCategory({ nameAr: 'عام', parentId: null })
const catId = S().categories.at(-1).id
S().addItem({ nameAr: 'أسمنت', categoryId: catId, unit: 'شيكارة', salePriceMinor: 9000, barcodes: [] })
const sup = S().suppliers.at(-1), emp1 = S().employees.at(-2), emp2 = S().employees.at(-1), item = S().items.at(-1)
ok('التأسيس تم', !!sup && !!emp1 && !!emp2 && !!item)

console.log('📁 ملف العهدة: فتح ← تعزيز ← منع الحركة على المغلق')
const file = S().openCustodyFile({ employeeId: emp1.id, projectId: null, reason: 'مشتريات موقع', notes: '' })
ok('فُتح الملف بلا قيود دفترية', S().journal.length === 0 && file.status === 'open')
S().fundCustodyFile({ fileId: file.id, amountMinor: 200000, treasury: '1101', description: 'أول عهدة' })
S().fundCustodyFile({ fileId: file.id, amountMinor: 100000, treasury: '1101', description: 'تعزيز' })
ok('التمويل قيد متوازن ورصيد 3000', trialBalanced() && S().getCustodySummary(file.id).remainingMinor === 300000)
throws('تعزيز بمبلغ سالب يُرفض', () => S().fundCustodyFile({ fileId: file.id, amountMinor: -5, treasury: '1101', description: 'x' }))

console.log('🧾 فاتورة شراء تُدفع من العهدة وتربط بمخزون حقيقي')
const inv = S().postPurchase({
  supplierId: sup.id, date: '2026-09-15',
  lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 8000, expiryDate: null }],
  expenses: [], paidMinor: 80000, custodyFileId: file.id, projectId: null, notes: '',
})
ok('الفاتورة رُحّلت والمخزون تحدث', S().items.find((i) => i.id === item.id).stockQty === 10)
ok('خُصمت من العهدة (المتبقي 2200)', S().getCustodySummary(file.id).remainingMinor === 220000)
ok('حركة «فاتورة» في ملف العهدة', S().custodyTxs.some((t) => t.fileId === file.id && t.type === 'invoice' && t.purchaseId === inv.id))
throws('فاتورة أكبر من المتبقي تُرفض', () => S().postPurchase({
  supplierId: sup.id, date: '2026-09-15',
  lines: [{ itemId: item.id, qty: 100, unitPriceMinor: 8000, expiryDate: null }],
  expenses: [], paidMinor: 800000, custodyFileId: file.id, projectId: null, notes: '',
}))

console.log('💸 مصروف من العهدة بزيادة مسموحة ← مستحق للموظف')
S().postCustodyExpense({ fileId: file.id, amountMinor: 250000, description: 'مصاريف موقع', allowExcess: true })
ok('المتبقي صفر والزيادة 300 مستحقة', S().getCustodySummary(file.id).remainingMinor === 0 && S().getEmployeeExcessDue(emp1.id) === 30000)
throws('مصروف آخر بلا رصيد وبلا سماح يُرفض', () => S().postCustodyExpense({ fileId: file.id, amountMinor: 1000, description: 'x', allowExcess: false }))

console.log('⚖️ عهدة ثانية: تسوية بعجز يتحول لسلفة')
const f2 = S().openCustodyFile({ employeeId: emp2.id, projectId: null, reason: 'نثريات', notes: '' })
S().fundCustodyFile({ fileId: f2.id, amountMinor: 100000, treasury: '1101', description: '' })
S().postCustodyExpense({ fileId: f2.id, amountMinor: 40000, description: 'نثريات', allowExcess: false })
S().settleCustodyFile({ fileId: f2.id, returnedMinor: 35000, treasury: '1101' })
const f2After = S().custodyFiles.find((f) => f.id === f2.id)
ok('الملف أُغلق بعجز 250', f2After.status === 'settled' && f2After.shortageMinor === 25000)
const shortageAdv = S().employeeAdvances.find((a) => a.source === 'custody_shortage' && a.employeeId === emp2.id)
ok('العجز صار سلفة على الموظف', !!shortageAdv && shortageAdv.amountMinor === 25000)
throws('أي حركة على الملف المغلق تُرفض', () => S().fundCustodyFile({ fileId: f2.id, amountMinor: 1000, treasury: '1101', description: 'x' }), 'مغلق')
throws('تسوية ثانية تُرفض', () => S().settleCustodyFile({ fileId: f2.id, returnedMinor: 0, treasury: '1101' }), 'مغلق')

console.log('🏦 سلفة نقدية + مسير رواتب بخصم جزئي وصرف مستحق')
S().grantEmployeeAdvance({ employeeId: emp1.id, amountMinor: 100000, treasury: '1101', notes: 'سلفة زواج' })
ok('رصيد سلف أحمد 1000', S().getEmployeeAdvanceBalance(emp1.id).remainingMinor === 100000)
const run = S().postPayroll({
  month: '2026-09', payMode: 'cash', treasury: '1101',
  lines: [
    { employeeId: emp1.id, baseMinor: 500000, allowancesMinor: 50000, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 40000, excessPaidMinor: 30000 },
    { employeeId: emp2.id, baseMinor: 300000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 10000, excessPaidMinor: 0 },
  ],
  notes: '',
})
ok('المسير رُحّل', !!run.journalEntryId)
ok('استرداد جزئي: بقي على أحمد 600', S().getEmployeeAdvanceBalance(emp1.id).remainingMinor === 60000)
ok('بقي على سعيد 150 من عجز العهدة', S().getEmployeeAdvanceBalance(emp2.id).remainingMinor === 15000)
ok('مستحق أحمد صُرف كاملاً', S().getEmployeeExcessDue(emp1.id) === 0)
throws('خصم أكبر من رصيد السلفة يُرفض', () => S().postPayroll({
  month: '2026-10', payMode: 'cash', treasury: '1101',
  lines: [{ employeeId: emp1.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 999999, excessPaidMinor: 0 }],
  notes: '',
}))
throws('صرف مستحق أكبر من المتبقي يُرفض', () => S().postPayroll({
  month: '2026-10', payMode: 'cash', treasury: '1101',
  lines: [{ employeeId: emp1.id, baseMinor: 500000, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0, excessPaidMinor: 1 }],
  notes: '',
}))

console.log('🛒 بيع كاشير + ميزان نهائي')
const itemNow = S().items.find((i) => i.id === item.id)
const sale = S().postSale({
  customerId: null,
  lines: [{ itemId: item.id, nameAr: itemNow.nameAr, qty: 3, unitPriceMinor: 9000, unitCostMinor: itemNow.avgCostMinor ?? 8000, discountPercent: 0, soldByWeight: false }],
  payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101',
})
ok('البيع رُحّل بفاتورة مرقمة', !!sale.invoiceNumber)
ok('البيع خصم المخزون (10−3=7)', S().items.find((i) => i.id === item.id).stockQty === 7)
ok('كل القيود متوازنة (مدين=دائن) عبر النظام كله', trialBalanced())

// المعادلة المحاسبية: الأصول = الخصوم + حقوق الملكية + (إيرادات − مصروفات)
const bal = {}
for (const e of S().journal) for (const l of e.lines) bal[l.accountCode] = (bal[l.accountCode] ?? 0) + l.debit - l.credit
const root = (p) => Object.entries(bal).filter(([c]) => c.startsWith(p)).reduce((a, [, v]) => a + v, 0)
const assets = root('1'), liab = -root('2'), eq = -root('3'), rev = -root('4'), exp = root('5')
ok('المعادلة المحاسبية تصمد', assets === liab + eq + (rev - exp))

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 نجح اختبار التكامل الشامل على المخزن الحقيقي')
