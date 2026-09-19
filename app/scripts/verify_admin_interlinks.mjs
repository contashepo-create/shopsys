// الترابط الإداري برمجياً: الأحداث في قسم تُنتج أثراً إدارياً في قسم آخر
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'general', countryCode: 'EG' }, license: { plan: 'pro' } } }))
const { useDataStore } = await import('/home/user/shopsys/app/src/data/repo.ts')
const st = () => useDataStore.getState()
let pass = 0, fails = []
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : fails.push(n)

// ① موظف → مستخدم → عهدة → منع حذف الموظف (ترابط HR↔أمان↔مالية)
st().addEmployee({ nameAr: 'موظف مركب', phone: '', jobTitle: 'محاسب', salaryMinor: 500000, hiredAt: '2026-01-01', notes: '' })
const emp = st().employees.at(-1)
const cf = st().openCustodyFile({ employeeId: emp.id, projectId: null, reason: 'مصاريف نثرية', notes: '' })
st().fundCustodyFile({ fileId: cf.id, amountMinor: 50000, treasury: '1101', description: 'تمويل' })
let blocked = false
try { st().removeEmployee(emp.id) } catch { blocked = true }
ok('حذف موظف له عهدة مفتوحة محظور (ترابط إداري)', blocked)
st().settleCustodyFile({ fileId: cf.id, returnedMinor: 50000, treasury: '1101' })

// ② مرتجع فوق المتبقي محظور تراكمياً (ترابط مبيعات↔مرتجعات)
st().addItem({ nameAr: 'صنف', sku: 'X1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 1000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
st().addSupplier({ nameAr: 'م', phone: '', address: '', notes: '', openingMinor: 0 })
st().postPurchase({ supplierId: st().suppliers.at(-1).id, date: '2026-01-01', lines: [{ itemId: st().items.at(-1).id, qty: 10, unitPriceMinor: 500 }], expenses: [], paidMinor: 5000, notes: '' })
const it = st().items.at(-1)
const sale = st().postSale({ lines: [{ itemId: it.id, nameAr: 'صنف', qty: 5, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'good' }], refund: 'cash', reason: 'فحص' })
blocked = false
try { st().postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 3, condition: 'good' }], refund: 'cash', reason: 'فوق المتبقي' }) } catch { blocked = true }
ok('مرتجع تراكمي فوق المباع محظور (5 بيعت، 3 رجعت، 3 أخرى تُرفض)', blocked)

// ③ مرتجع شراء يحترم المخزون الحالي (ترابط مشتريات↔مخزون↔مبيعات)
blocked = false
try { st().postPurchaseReturn({ purchaseId: st().purchases.at(-1).id, qtyByItem: new Map([[it.id, 9]]), refund: 'cash', reason: 'فحص' }) } catch { blocked = true }
ok('مرتجع شراء أكبر من المخزون الحالي محظور (بقي 8، طلبنا رد 9)', blocked)

// ④ حذف عميل عليه رصيد محظور
st().addCustomer({ nameAr: 'مدين', phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 })
const c = st().customers.at(-1)
st().setOpeningBalance({ kind: 'customer', refId: c.id, amountMinor: 1000, label: c.nameAr })
blocked = false
try { st().removeCustomer(c.id) } catch { blocked = true }
ok('حذف عميل عليه رصيد محظور', blocked)

// ⑤ الإشعارات الإدارية: مخزون منخفض + شيك مستحق تظهر في المركز
const { collectNotifications } = await import('/home/user/shopsys/app/src/core/notifications.ts')
st().receiveCheque({ chequeNumber: 'N-1', partyId: null, partyName: 'فلان', bankName: 'X', amountMinor: 9999, dueDate: '2026-01-02', notes: '' })
const notifs = collectNotifications({
  todayIso: '2026-01-03',
  batches: [],
  itemName: () => '',
  lowStockItems: [{ id: it.id, nameAr: 'صنف', stockQty: 1, minQty: 5 }],
  installmentPlans: [],
  customerName: () => '',
  cheques: st().cheques,
  fmt: (m) => String(m),
})
ok('إشعار مخزون منخفض يظهر', notifs.some((n) => n.title.includes('مخزون') || n.body?.includes('صنف') || n.kind === 'low_stock'))
ok('إشعار شيك مستحق يظهر', notifs.some((n) => n.kind?.includes('cheque') || n.title.includes('شيك')))

// ⑥ وردية: لا إقفال بلا وردية مفتوحة / لا ورديتان
blocked = false
try { st().closeShift(0) } catch { blocked = true }
ok('إقفال وردية بلا وردية مفتوحة محظور', blocked)
st().openShift('كاشير', 0)
blocked = false
try { st().openShift('كاشير آخر', 0) } catch { blocked = true }
ok('فتح ورديتين معاً محظور', blocked)
st().closeShift(st().sales.filter((s) => s.shiftId === st().shifts.at(-1).id && s.payment === 'cash').reduce((a, s) => a + s.totals.totalMinor, 0))

// ⑦ عكس قيد مصدره مستند تشغيلي محظور (يُصحح من مساره)
const saleEntry = st().journal.find((e) => e.sourceType === 'sale')
blocked = false; let msg = ''
try { st().reverseEntry(saleEntry.id, 'محاولة') } catch (e) { blocked = true; msg = e.message }
ok('عكس قيد فاتورة من اليومية محظور — التصحيح من شاشة المرتجعات (' + msg.slice(0, 30) + '…)', blocked)

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n' + fails.join('\n') : ''}`)
if (fails.length) process.exit(1)
