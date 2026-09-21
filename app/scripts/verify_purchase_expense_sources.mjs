/**
 * فحص أوامر التعديل — مصادر دفع مصاريف الشراء (طلب المالك):
 * 1) مصروف على حساب المورد (الافتراضي) → يزيد دينه — التوافق الخلفي كامل
 * 2) مصروف دفعتُه من خزينة/بنك → يخرج من الخزينة ولا يمس دين المورد أبداً
 * 3) مصروف دفعه موظف من عهدته → يُخصم من ملف عهدته ولا يمس دين المورد
 * 4) أكثر من مصروف بمصادر مختلطة في نفس الفاتورة + كلها تدخل تكلفة الصنف
 * 5) مصروف لاحق بعد الترحيل (Landed Cost Voucher): نصيب المخزون 1103
 *    ونصيب المبيع 5101 + رفع متوسط التكلفة + الدائن حسب من دفع
 * 6) تكامل سندات الصرف: نفس الإجراء يُستدعى من شاشة السندات
 * 7) كشف حساب المورد ورصيده من مستحقه فقط
 * تشغيل: node --experimental-strip-types scripts/verify_purchase_expense_sources.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')
const { supplierStatement, statementBalance } = await import('../src/core/statements.ts')
const { supplierBalances } = await import('../src/core/reports.ts')
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
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })

console.log('🚛 التأسيس: مورد + موظف بعهدة ممولة + صنف')
S().addSupplier(party('شركة الدلتا للتوريدات'))
const supplier = S().suppliers.at(-1)
S().addEmployee({ ...party('سائق المشتريات'), jobTitle: 'سائق', hireDate: '2025-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true })
const emp = S().employees.at(-1)
const file = S().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'مشتريات', notes: '' })
S().fundCustodyFile({ fileId: file.id, amountMinor: 500000, treasury: '1101', description: 'تمويل' })
S().addItem(item({ nameAr: 'أرز شعير', baseUnit: 'شيكارة' }))
const rice = S().items.at(-1)

console.log('\n1️⃣ التوافق الخلفي: مصروف بلا paidBy = على حساب المورد')
const sup2101Before = bal('2101')
S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 10000 }],
  expenses: [{ nameAr: 'نولون', amountMinor: 50000, method: 'qty' }],
  paidMinor: 0, notes: '',
})
const inv1 = S().purchases.at(-1)
ok('دين المورد = بضاعة + مصروف (1,050,000)', bal('2101') - sup2101Before === -1050000, bal('2101'))
ok('supplierDueMinor = الإجمالي كله', inv1.supplierDueMinor === 1050000)
ok('التكلفة شملت المصروف (10500/شيكارة)', S().items.find((i) => i.id === rice.id).costMinor === 10500)

console.log('\n2️⃣ مصروف مدفوع من خزينة: لا يمس دين المورد')
const cashBefore = bal('1101')
const supBefore2 = bal('2101')
S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 100, unitPriceMinor: 10000 }],
  expenses: [{ nameAr: 'نولون سيارة مستأجرة', amountMinor: 60000, method: 'qty', paidBy: 'treasury', payAccount: '1101' }],
  paidMinor: 0, notes: '',
})
const inv2 = S().purchases.at(-1)
ok('دين المورد زاد بالبضاعة فقط (1,000,000)', bal('2101') - supBefore2 === -1000000, bal('2101') - supBefore2)
ok('النولون خرج من الخزينة (−60,000)', bal('1101') - cashBefore === -60000)
ok('supplierDueMinor = 1,000,000 والإجمالي 1,060,000', inv2.supplierDueMinor === 1000000 && inv2.grandTotalMinor === 1060000)
ok('المصروف دخل التكلفة رغم أنه ليس على المورد', inv2.lines[0].landedUnitCostMinor === 10600)
ok('القيود متوازنة', balanced())

console.log('\n3️⃣ مصروف مدفوع من عهدة موظف')
const custodyBefore = bal('1108')
const supBefore3 = bal('2101')
S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 10, unitPriceMinor: 10000 }],
  expenses: [{ nameAr: 'تحميل وتنزيل', amountMinor: 20000, method: 'qty', paidBy: 'custody', custodyFileId: file.id }],
  paidMinor: 0, notes: '',
})
ok('العهدة نقصت 20,000 (1108 دائن)', bal('1108') - custodyBefore === -20000)
ok('دين المورد بالبضاعة فقط (100,000)', bal('2101') - supBefore3 === -100000)
ok('حركة العهدة سُجلت في ملف الموظف', S().custodyTxs.some((t) => t.fileId === file.id && t.type === 'expense' && t.amountMinor === 20000 && t.description.includes('تحميل')))
throws('يرفض مصروف عهدة أكبر من متبقيها', () => S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 1, unitPriceMinor: 1000 }],
  expenses: [{ nameAr: 'نولون', amountMinor: 99999999, method: 'qty', paidBy: 'custody', custodyFileId: file.id }],
  paidMinor: 0, notes: '',
}), 'أكبر من متبقيها')
throws('يرفض مصروف عهدة بلا ملف', () => S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 1, unitPriceMinor: 1000 }],
  expenses: [{ nameAr: 'نولون', amountMinor: 1000, method: 'qty', paidBy: 'custody' }],
  paidMinor: 0, notes: '',
}), 'حدد ملف العهدة')

console.log('\n4️⃣ مصادر مختلطة في فاتورة واحدة + سقف الدفع بمستحق المورد')
const supBefore4 = bal('2101')
S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 50, unitPriceMinor: 10000 }],
  expenses: [
    { nameAr: 'جمارك', amountMinor: 30000, method: 'value' }, // على المورد
    { nameAr: 'نولون', amountMinor: 40000, method: 'qty', paidBy: 'treasury', payAccount: '1101' },
    { nameAr: 'تنزيل', amountMinor: 10000, method: 'qty', paidBy: 'custody', custodyFileId: file.id },
  ],
  paidMinor: 530000, notes: '', // = مستحق المورد كاملاً (بضاعة 500k + جماركه 30k)
})
const inv4 = S().purchases.at(-1)
ok('مستحق المورد = 530,000 (بضاعة + جماركه فقط)', inv4.supplierDueMinor === 530000)
ok('الإجمالي = 580,000 (كل المصاريف تدخل التكلفة)', inv4.grandTotalMinor === 580000)
ok('دفع 530,000 صفّى المورد تماماً', bal('2101') - supBefore4 === 0, bal('2101') - supBefore4)
throws('يرفض دفعاً يتجاوز مستحق المورد', () => S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: rice.id, qty: 10, unitPriceMinor: 10000 }],
  expenses: [{ nameAr: 'نولون', amountMinor: 20000, method: 'qty', paidBy: 'treasury', payAccount: '1101' }],
  paidMinor: 110000, notes: '', // البضاعة 100k فقط مستحقة للمورد
}), 'أكبر من مستحق المورد')

console.log('\n5️⃣ مصروف لاحق بعد الترحيل (Landed Cost Voucher)')
// فاتورة نظيفة: 100 شيكارة بـ10,000 — ثم بيع 40 — ثم فاتورة نولون لاحقة 50,000
S().addItem(item({ nameAr: 'سكر', baseUnit: 'شيكارة' }))
const sugar = S().items.at(-1)
S().postPurchase({
  supplierId: supplier.id, date: '2026-09-15',
  lines: [{ itemId: sugar.id, qty: 100, unitPriceMinor: 10000 }],
  expenses: [], paidMinor: 1000000, treasury: '1101', notes: '',
})
const invLate = S().purchases.at(-1)
S().postSale({
  lines: [{ itemId: sugar.id, nameAr: 'سكر', qty: 40, unitPriceMinor: 15000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }],
  customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
})
const inv1103Before = bal('1103'), cogsBefore = bal('5101'), cashB5 = bal('1101')
const updated = S().addLatePurchaseExpense({
  purchaseId: invLate.id, nameAr: 'نولون متأخر', amountMinor: 50000, method: 'qty',
  paidBy: 'treasury', payAccount: '1101', date: '2026-09-16',
})
// 60 من 100 ما زالت بالمخزون → 30,000 للمخزون و20,000 لتكلفة المبيعات
ok('نصيب المخزون المتبقي → 1103 (+30,000)', bal('1103') - inv1103Before === 30000, bal('1103') - inv1103Before)
ok('نصيب المبيع → 5101 (+20,000)', bal('5101') - cogsBefore === 20000)
ok('الدائن خزينة لا مورد (−50,000)', bal('1101') - cashB5 === -50000)
ok('متوسط تكلفة السكر ارتفع 10,000 → 10,500', S().items.find((i) => i.id === sugar.id).costMinor === 10500)
ok('الفاتورة تحدثت: مصروف late والإجمالي 1,050,000', updated.expenses.some((e) => e.late) && updated.grandTotalMinor === 1050000)
ok('مستحق المورد لم يتغير (مدفوع بالكامل سابقاً)', updated.supplierDueMinor === 1000000)
ok('تكلفة الوحدة النهائية بالسطر = 10,500', updated.lines[0].landedUnitCostMinor === 10500)
ok('القيود متوازنة بعد كل شيء', balanced())

console.log('\n6️⃣ مصروف لاحق على حساب المورد (وصلت فاتورته متأخرة)')
const supB6 = bal('2101')
S().addLatePurchaseExpense({
  purchaseId: invLate.id, nameAr: 'فاتورة شحن وصلت متأخرة', amountMinor: 10000, method: 'value',
  paidBy: 'supplier', date: '2026-09-17',
})
ok('زاد دين المورد 10,000', bal('2101') - supB6 === -10000)
ok('supplierDueMinor زاد أيضاً', S().purchases.find((p) => p.id === invLate.id).supplierDueMinor === 1010000)
throws('يرفض فاتورة غير موجودة', () => S().addLatePurchaseExpense({ purchaseId: 9999, nameAr: 'س', amountMinor: 100, method: 'qty', paidBy: 'supplier', date: '2026-09-17' }), 'غير موجودة')
throws('يرفض مبلغاً صفرياً', () => S().addLatePurchaseExpense({ purchaseId: invLate.id, nameAr: 'س', amountMinor: 0, method: 'qty', paidBy: 'supplier', date: '2026-09-17' }), 'موجباً')

console.log('\n7️⃣ رصيد المورد وكشف حسابه من مستحقه فقط')
const rows = supplierBalances(S().purchases, [])
const supRow = rows.find((r) => r.supplierId === supplier.id)
const expectedDue = S().purchases.filter((p) => p.supplierId === supplier.id).reduce((a, p) => a + (p.supplierDueMinor ?? p.grandTotalMinor), 0)
const expectedPaid = S().purchases.filter((p) => p.supplierId === supplier.id).reduce((a, p) => a + p.paidMinor, 0)
ok('تقرير أرصدة الموردين يجمع مستحقه لا الإجمالي', supRow.purchasedMinor === expectedDue && supRow.balanceMinor === expectedDue - expectedPaid)
const st = supplierStatement({
  supplierId: supplier.id,
  purchases: S().purchases, purchaseReturns: S().purchaseReturns,
  allPurchases: S().purchases, vouchers: S().vouchers, cheques: S().cheques,
})
ok('كشف الحساب يطابق التقرير', statementBalance(st, 'supplier') === supRow.balanceMinor, `${statementBalance(st, 'supplier')} ≠ ${supRow.balanceMinor}`)
// دفتر الأستاذ 2101 يطابق الكشف أيضاً (لا مرتجعات/سندات هنا سوى ما سجلناه)
ok('دفتر الأستاذ 2101 = رصيد الكشف', -bal('2101') === supRow.balanceMinor, -bal('2101'))

console.log(`\n${fail === 0 ? '🎉' : '💥'} النتيجة: PASS=${pass} FAIL=${fail} — ${pass + fail} اختبار`)
if (fail > 0) process.exit(1)
