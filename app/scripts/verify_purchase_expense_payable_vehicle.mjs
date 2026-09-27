/**
 * فحص مصروف الشراء المستحق ومركز تكلفة مركبة الأسطول:
 * - إثبات نولون 1000 على مركبة بلا حركة خزينة، مع قيد استحقاق مستقل.
 * - ظهور التحميل في دفتر المركبة، ثم تحديثه إلى «مسدد» عند سند السداد اللاحق.
 * - المصروف اللاحق على فاتورة مرحّلة ينشئ PurchaseExpensePayable فعلياً.
 * - سند صرف صيانة مرتبط بالسيارة يسجل تكلفة تشغيل مستقلة.
 * تشغيل: node --experimental-strip-types scripts/verify_purchase_expense_payable_vehicle.mjs
 */
const mem = new Map()
globalThis.localStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
}
globalThis.window = {
  localStorage: globalThis.localStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, countryCode: 'EG', activityId: 'logistics' } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
let pass = 0
let fail = 0
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const balanced = () => S().journal.every((entry) => entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0) === 0)
const linesFor = (entry) => entry.lines.map((line) => `${line.accountCode}:${line.debit}/${line.credit}`).join(' | ')
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (nameAr) => ({ nameAr, sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })

console.log('🚚 تأسيس مورد وصنف ومركبة')
S().addSupplier(party('شركة الشحن'))
S().addItem(item('صنف اختبار'))
S().addVehicle({ plateNumber: 'أ ب ج 1', vehicleType: 'دينا', defaultDriverId: null, notes: '' })
const supplier = S().suppliers.at(-1)
const stockItem = S().items.at(-1)
const vehicle = S().vehicles.at(-1)

console.log('\n1️⃣ فاتورة شراء: مصروف 1000 مستحق بلا دفع فوري')
const purchase = S().postPurchase({
  supplierId: supplier.id,
  date: '2026-09-24',
  lines: [{ itemId: stockItem.id, qty: 1, unitPriceMinor: 100000 }],
  expenses: [{ nameAr: 'نولون', amountMinor: 10000, method: 'qty', paidBy: 'payable', beneficiaryName: 'شركة النقل', payableAccountCode: '2117', vehicleId: vehicle.id }],
  paidMinor: 0,
  notes: '',
})
const payable = S().purchaseExpensePayables.find((row) => row.purchaseId === purchase.id)
const movement = S().vehicleCostEntries.find((row) => row.purchaseId === purchase.id)
ok('أنشأ سجل الاستحقاق للجهة', !!payable && payable.beneficiaryName === 'شركة النقل' && payable.amountMinor === 10000)
ok('القيد أثبت 2117 دائناً ولم يحرك الخزينة', S().journal.at(-1).lines.some((line) => line.accountCode === '2117' && line.credit === 10000) && !S().journal.at(-1).lines.some((line) => line.accountCode === '1101' || line.accountCode === '1102'))
ok('ربط المصروف بمركز تكلفة المركبة كتحميل داخلي مستحق', !!movement && movement.vehicleId === vehicle.id && movement.kind === 'internal_revenue' && movement.status === 'accrued')
ok('لم تُنشأ حركة نقدية تلقائية', S().journal.at(-1).lines.every((line) => line.accountCode !== '1101' && line.accountCode !== '1102'))

console.log('\n2️⃣ السداد اللاحق من البنك مستقل عن إثبات التكلفة')
const journalBeforeSettlement = S().journal.length
S().settlePurchaseExpensePayable({ payableId: payable.id, amountMinor: 10000, treasury: '1102', date: '2026-09-24' })
const settlement = S().journal.at(-1)
const settledMovement = S().vehicleCostEntries.find((row) => row.id === movement.id)
ok('أنشأ سند سداد مستقل 2117/1102', S().journal.length === journalBeforeSettlement + 1 && settlement.lines.some((line) => line.accountCode === '2117' && line.debit === 10000) && settlement.lines.some((line) => line.accountCode === '1102' && line.credit === 10000), linesFor(settlement))
ok('تحول استحقاق المركبة إلى مسدد بلا تكرار تكلفة', settledMovement?.status === 'paid' && settledMovement.settlementEntryIds.includes(settlement.id))
ok('الاستحقاق نفسه أصبح مسدداً', S().purchaseExpensePayables.find((row) => row.id === payable.id)?.status === 'paid')

console.log('\n3️⃣ مصروف لاحق على فاتورة مرحّلة: مستحق + مركبة')
const paidPurchase = S().postPurchase({ supplierId: supplier.id, date: '2026-09-24', lines: [{ itemId: stockItem.id, qty: 1, unitPriceMinor: 50000 }], expenses: [], paidMinor: 50000, treasury: '1101', notes: '' })
const journalBeforeLate = S().journal.length
const lateInvoice = S().addLatePurchaseExpense({ purchaseId: paidPurchase.id, nameAr: 'نولون لاحق', amountMinor: 5000, method: 'qty', paidBy: 'payable', beneficiaryName: 'شركة نقل أخرى', payableAccountCode: '2117', vehicleId: vehicle.id, date: '2026-09-24' })
const latePayable = S().purchaseExpensePayables.find((row) => row.purchaseId === paidPurchase.id)
const lateMovement = S().vehicleCostEntries.find((row) => row.purchaseId === paidPurchase.id)
const lateEntry = S().journal.at(-1)
ok('المصروف اللاحق سجّل استحقاقاً جديداً', !!latePayable && latePayable.amountMinor === 5000 && latePayable.beneficiaryName === 'شركة نقل أخرى')
ok('المصروف اللاحق لم يدفع من الخزينة', S().journal.length === journalBeforeLate + 1 && lateEntry.lines.some((line) => line.accountCode === '2117' && line.credit === 5000) && !lateEntry.lines.some((line) => line.accountCode === '1101' && line.credit > 0))
ok('المصروف اللاحق ظاهر في مركز السيارة', !!lateMovement && lateMovement.vehicleId === vehicle.id && lateMovement.kind === 'internal_revenue' && lateInvoice.expenses.at(-1).vehicleId === vehicle.id)

console.log('\n4️⃣ سند صيانة مدفوع مرتبط بالسيارة')
const repair = S().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 2500, description: 'صيانة السيارة 1', vehicleId: vehicle.id })
const repairMovement = S().vehicleCostEntries.find((row) => row.journalEntryId === repair.journalEntryId)
ok('السند يسجل تكلفة صيانة مستقلة في مركز السيارة', !!repairMovement && repairMovement.kind === 'cost' && repairMovement.amountMinor === 2500 && repairMovement.status === 'paid' && repair.vehicleId === vehicle.id)
ok('كل القيود متوازنة', balanced())

console.log(`\n${fail === 0 ? '🎉' : '💥'} النتيجة: PASS=${pass} FAIL=${fail}`)
if (fail) process.exit(1)
