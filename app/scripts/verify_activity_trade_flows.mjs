/**
 * مراجعة الشراء والبيع والتأجير في الأنشطة (طلب المالك):
 * ─────────────────────────────────────────────────────
 * القاعدة الموحدة التي تُفحص هنا في كل نشاط:
 *   ① كل مبلغ آجل يُحمَّل على طرف مسجل (مورد/عميل) فيظهر في كشف حسابه.
 *   ② كل عملية تقبل سداداً/تحصيلاً جزئياً: نقدي أو بنكي الآن والباقي آجل.
 *   ③ اختيار الخزينة/البنك متاح في الجزء النقدي.
 *   ④ الوحدات (سيارة/وحدة عقارية) سطر مستقل في المستند لا مبلغ مجمّع.
 * تشغيل: node --experimental-strip-types scripts/verify_activity_trade_flows.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 15 } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { computeCarPurchaseInvoice, allocateByValue } = await import('../src/core/cars.ts')
const { allocatePriceOverUnits } = await import('../src/core/realestate.ts')
const { supplierUnitDocs } = await import('../src/core/statements.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }
const EMPTY = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

/* ═══ ① النواة: توزيع المصاريف وحساب الفاتورة ═══ */
console.log('🧮 نواة فاتورة شراء السيارات')
ok('توزيع بالقيمة بلا ضياع مليم', allocateByValue([600, 400], 101).reduce((a, b) => a + b, 0) === 101)
ok('الباقي لأكبر قيمة', JSON.stringify(allocateByValue([600, 400], 101)) === JSON.stringify([61, 40]))
ok('قيم صفرية = توزيع متساوٍ', allocateByValue([0, 0], 10).reduce((a, b) => a + b, 0) === 10)
const totalsPreview = computeCarPurchaseInvoice({
  lines: [
    { make: 'تويوتا', model: 'كورولا', year: 2021, plateOrVin: 'AAA-1', odometerKm: 10, purpose: 'sale', costMinor: 30_000_00 },
    { make: 'كيا', model: 'سيراتو', year: 2022, plateOrVin: 'BBB-2', odometerKm: 20, purpose: 'sale', costMinor: 20_000_00 },
  ],
  expenses: [{ label: 'نقل', amountMinor: 1_000_00 }],
  taxPercent: 0,
})
ok('إجمالي الفاتورة = سيارات + مصاريف', totalsPreview.totalMinor === 51_000_00)
ok('توزيع المصاريف بالقيمة 60/40', totalsPreview.perVehicleCostMinor[0] === 30_600_00 && totalsPreview.perVehicleCostMinor[1] === 20_400_00)
ok('مجموع التكاليف المرسملة = سيارات + مصاريف', totalsPreview.capitalizedMinor === 51_000_00)
throws('فاتورة بلا سيارات تُرفض', () => computeCarPurchaseInvoice({ lines: [] }), 'سيارات')

/* ═══ ② معرض السيارات: فاتورة شراء كاملة بسطر لكل سيارة وسداد مختلط ═══ */
console.log('🚗 نشاط معارض السيارات — فاتورة شراء كاملة')
S().addSupplier({ ...EMPTY, nameAr: 'معرض النور للسيارات', phone: '', notes: '' })
const carSupplier = S().suppliers.at(-1)
const { invoice, cars } = S().addCarPurchaseInvoice({
  supplierId: carSupplier.id, supplierInvoiceNo: 'INV-77', treasury: '1102',
  lines: [
    { make: 'تويوتا', model: 'كامري', year: 2022, plateOrVin: 'ر ط ن 1234', odometerKm: 45_000, purpose: 'sale', costMinor: 400_000_00 },
    { make: 'هيونداي', model: 'إلنترا', year: 2023, plateOrVin: 'ب ح د 5678', odometerKm: 12_000, purpose: 'sale', costMinor: 200_000_00 },
  ],
  expenses: [{ label: 'نقل ونقل ملكية', amountMinor: 6_000_00 }],
  taxPercent: 0,
  paidMinor: 300_000_00,
  notes: 'فحص ظاهري تم',
})
ok('الفاتورة برقمها CPI-0001', invoice.invoiceNumber === 'CPI-0001')
ok('سطر مستقل لكل سيارة = سيارتان في المخزون', cars.length === 2 && S().cars.length === 2)
ok('تكلفة كل سيارة بعد توزيع المصاريف', cars[0].purchaseCostMinor === 404_000_00 && cars[1].purchaseCostMinor === 202_000_00)
ok('1103 مدين بإجمالي التكاليف المرسملة', bal('1103') === 606_000_00)
ok('البنك 1102 دائن بالمدفوع فقط', bal('1102') === -300_000_00)
ok('2101 دائن بالمتبقي الآجل', bal('2101') === -306_000_00)
ok('المتبقي محفوظ على الفاتورة', invoice.dueMinor === 306_000_00 && invoice.paidMinor === 300_000_00)
ok('كل سيارة مربوطة بفاتورتها', cars.every((car) => car.purchaseInvoiceId === invoice.id && car.purchaseInvoiceNumber === 'CPI-0001'))
ok('قيد الفاتورة واحد متوازن', balanced())
throws('الآجل بلا مورد يُرفض', () => S().addCarPurchaseInvoice({
  supplierId: null, lines: [{ make: 'فورد', model: 'فوكس', year: 2020, plateOrVin: 'X-1', odometerKm: 0, purpose: 'sale', costMinor: 100_00 }], paidMinor: 0,
}), 'المورد')
throws('لوحة مكررة داخل الفاتورة تُرفض', () => S().addCarPurchaseInvoice({
  supplierId: carSupplier.id,
  lines: [
    { make: 'أ', model: 'ب', year: 2020, plateOrVin: 'DUP-9', odometerKm: 0, purpose: 'sale', costMinor: 100_00 },
    { make: 'ج', model: 'د', year: 2020, plateOrVin: 'DUP-9', odometerKm: 0, purpose: 'sale', costMinor: 100_00 },
  ],
}), 'مسجلة بالفعل')
throws('مدفوع أكبر من الإجمالي يُرفض', () => S().addCarPurchaseInvoice({
  supplierId: carSupplier.id, paidMinor: 999_999_99,
  lines: [{ make: 'مازدا', model: '3', year: 2020, plateOrVin: 'M-3', odometerKm: 0, purpose: 'sale', costMinor: 100_00 }],
}), 'المدفوع')

// ضريبة مدخلات قابلة للخصم مقابل مرسملة
const taxedRecoverable = computeCarPurchaseInvoice({ lines: [{ make: 'أ', model: 'ب', year: 2020, plateOrVin: 'T-1', odometerKm: 0, purpose: 'sale', costMinor: 100_00 }], taxPercent: 15 })
const taxedCapital = computeCarPurchaseInvoice({ lines: [{ make: 'أ', model: 'ب', year: 2020, plateOrVin: 'T-1', odometerKm: 0, purpose: 'sale', costMinor: 100_00 }], taxPercent: 15, taxRecoverable: false })
ok('ضريبة قابلة للخصم لا تُرسمل على السيارة', taxedRecoverable.perVehicleCostMinor[0] === 100_00 && taxedRecoverable.recoverableTaxMinor === 15_00)
ok('ضريبة غير قابلة للخصم تُرسمل على التكلفة', taxedCapital.perVehicleCostMinor[0] === 115_00 && taxedCapital.recoverableTaxMinor === 0)

/* ═══ ③ تجهيز السيارة على حساب ورشة (البلاغ الأول) ═══ */
console.log('🔧 تكلفة التجهيز محمَّلة على ورشة كحساب آجل')
S().addSupplier({ ...EMPTY, nameAr: 'ورشة الإتقان', phone: '', notes: '' })
const workshop = S().suppliers.at(-1)
const prepCash = S().addCarPrep(cars[0].id, 5_000_00, 'cash', 'غسيل وتلميع', '1101')
ok('تجهيز نقدي: لا ذمة على أحد', prepCash.dueMinor === 0 && prepCash.supplierId === null)
const prepCredit = S().addCarPrep(cars[0].id, 20_000_00, 'credit', 'سمكرة ودهان', '1101', 0, '', workshop.id)
ok('تجهيز آجل مربوط بالورشة', prepCredit.supplierId === workshop.id && prepCredit.dueMinor === 20_000_00)
const prepMixed = S().addCarPrep(cars[1].id, 10_000_00, 'mixed', 'قطع غيار', '1102', 4_000_00, '', workshop.id)
ok('تجهيز مختلط: مدفوع 4000 وباقٍ 6000 على الورشة', prepMixed.paidMinor === 4_000_00 && prepMixed.dueMinor === 6_000_00)
ok('التجهيز يُرسمل على تكلفة السيارة', S().cars.find((c) => c.id === cars[0].id).prepCostMinor === 25_000_00)
const workshopDocs = supplierUnitDocs({ supplierId: workshop.id, cars: S().cars, carPurchaseInvoices: S().carPurchaseInvoices, carPrepCosts: S().carPrepCosts })
ok('كشف الورشة يُظهر مستندي التجهيز فقط', workshopDocs.length === 2)
ok('رصيد الورشة = 26000 دائن لها', workshopDocs.reduce((sum, row) => sum + row.creditMinor, 0) === 26_000_00)
const workshopBalance = S().getSupplierBalance(workshop.id)
ok('كشف حساب الورشة من المتجر يطابق (موجب = مستحق لها)', workshopBalance === 26_000_00, workshopBalance)
const supplierRows = S().getSupplierStatementRows(carSupplier.id)
ok('كشف مورد السيارات يُظهر الفاتورة لا السيارات مرتين', supplierRows.filter((row) => row.docLabel.includes('CPI-0001')).length === 1)
ok('رصيد مورد السيارات = متبقي الفاتورة', S().getSupplierBalance(carSupplier.id) === 306_000_00, S().getSupplierBalance(carSupplier.id))
ok('الدفتر متوازن بعد التجهيزات', balanced())

/* ═══ ④ بيع سيارة بتحصيل جزئي على عميل مسجل ═══ */
console.log('💰 بيع سيارة: تحصيل جزئي والباقي على العميل')
S().addCustomer({ ...EMPTY, nameAr: 'عميل المعرض', phone: '', notes: '' })
const carBuyer = S().customers.at(-1)
throws('بيع آجل بلا عميل مسجل يُرفض', () => S().sellCar({ carId: cars[1].id, priceMinor: 250_000_00, vatPercent: 0, payment: 'credit', buyerName: 'عابر' }), 'سجل العملاء')
const soldCar = S().sellCar({ carId: cars[1].id, priceMinor: 250_000_00, vatPercent: 0, payment: 'mixed', paidMinor: 100_000_00, buyerName: '', buyerCustomerId: carBuyer.id, treasury: '1101' })
ok('البيع المختلط يسجل المحصل والمتبقي', soldCar.salePaidMinor === 100_000_00 && soldCar.saleTotalMinor === 250_000_00)
ok('ربح السيارة = السعر − (شراء + تجهيز)', soldCar.saleProfitMinor === 250_000_00 - (202_000_00 + 10_000_00))
ok('ذمة المشتري = المتبقي فقط', S().getCustomerBalance(carBuyer.id) === 150_000_00)

/* ═══ ⑤ العقارات: سطر مستقل لكل وحدة في الشراء والبيع والإيجار ═══ */
console.log('🏢 نشاط العقارات — سطر مستقل لكل وحدة')
const property = S().addProperty({
  nameAr: 'مجمع الياسمين', kind: 'residential', ownership: 'owned', ownerName: '', commissionPercent: 0,
  address: 'المنصورة', costMinor: 1_000_000_00, notes: '', acquisitionPayment: 'cash', treasury: '1101',
  initialUnits: [
    { code: 'شقة 1', annualRentMinor: 60_000_00, costMinor: 500_000_00, salePriceMinor: 700_000_00 },
    { code: 'شقة 2', annualRentMinor: 40_000_00, costMinor: 300_000_00, salePriceMinor: 450_000_00 },
    { code: 'شقة 3', annualRentMinor: 30_000_00, costMinor: 200_000_00, salePriceMinor: 300_000_00 },
  ],
})
const units = S().propertyUnits.filter((u) => u.propertyId === property.id)
ok('كل وحدة سجل مستقل بتكلفتها', units.length === 3 && units[0].costMinor === 500_000_00 && units[2].costMinor === 200_000_00)
ok('تكلفة العقار = مجموع تكاليف وحداته', S().properties.find((p) => p.id === property.id).costMinor === 1_000_000_00)

// إيجار عقد واحد على وحدتين — سطر لكل وحدة
const lease = S().addLease({
  propertyId: property.id,
  units: [{ unitId: units[0].id, rentMinor: 60_000_00 }, { unitId: units[1].id, rentMinor: 40_000_00 }],
  tenantName: 'شركة النيل', tenantId: null, startDate: '2026-01-01', months: 12, frequency: 'monthly',
  totalRentMinor: 0, depositMinor: 10_000_00, treasury: '1101',
})
ok('العقد يحمل سطراً لكل وحدة', (lease.unitLines ?? []).length === 2)
ok('إجمالي العقد = مجموع أجور السطور', lease.totalRentMinor === 100_000_00)
ok('كل وحدات العقد صارت مؤجرة', S().propertyUnits.filter((u) => [units[0].id, units[1].id].includes(u.id)).every((u) => u.status === 'leased'))
throws('تأجير وحدة مؤجرة ضمن عقد آخر يُرفض', () => S().addLease({
  propertyId: property.id, units: [{ unitId: units[0].id, rentMinor: 1_000_00 }],
  tenantName: 'آخر', startDate: '2026-01-01', months: 12, frequency: 'monthly', totalRentMinor: 0, depositMinor: 0,
}), 'مؤجرة')
S().endLease({ leaseId: lease.id, treasury: '1101' })
ok('إنهاء العقد يُخلي كل وحداته', S().propertyUnits.filter((u) => [units[0].id, units[1].id].includes(u.id)).every((u) => u.status === 'vacant'))

// بيع وحدتين في مستند واحد بسطر لكل وحدة وتحصيل جزئي
S().addCustomer({ ...EMPTY, nameAr: 'مشترٍ عقاري', phone: '', notes: '' })
const propBuyer = S().customers.at(-1)
const before1113 = bal('1113')
const saleDoc = S().sellPropertyUnits({
  propertyId: property.id,
  lines: [{ unitId: units[0].id, priceMinor: 700_000_00 }, { unitId: units[1].id, priceMinor: 450_000_00 }],
  payment: 'mixed', paidMinor: 400_000_00, buyerCustomerId: propBuyer.id, treasury: '1101',
})
ok('مستند البيع برقمه RS-0001', saleDoc.saleNumber === 'RS-0001')
ok('سطر مستقل لكل وحدة بربحه', saleDoc.lines.length === 2 && saleDoc.lines[0].profitMinor === 200_000_00 && saleDoc.lines[1].profitMinor === 150_000_00)
ok('إخراج تكلفة الوحدتين فقط من 1113', before1113 - bal('1113') === 800_000_00)
ok('الوحدة الثالثة ما زالت شاغرة للتعامل', S().propertyUnits.find((u) => u.id === units[2].id).status === 'vacant')
ok('العقار لم يُقفل لأن وحدة باقية', S().properties.find((p) => p.id === property.id).status === 'active')
ok('ذمة المشتري = المتبقي من المستند', S().getCustomerBalance(propBuyer.id) === 750_000_00)
const buyerRows = S().getCustomerStatementRows(propBuyer.id)
ok('كشف المشتري يُظهر مستند بيع الوحدات', buyerRows.some((row) => row.docLabel.includes('RS-0001')))
throws('بيع وحدة مباعة يُرفض', () => S().sellPropertyUnits({ propertyId: property.id, lines: [{ unitId: units[0].id, priceMinor: 1_00 }], payment: 'cash' }), 'مباعة')
throws('بيع آجل بلا مشترٍ مسجل يُرفض', () => S().sellPropertyUnits({ propertyId: property.id, lines: [{ unitId: units[2].id, priceMinor: 300_000_00 }], payment: 'credit' }), 'سجل العملاء')
ok('توزيع سعر إجمالي على الوحدات بلا ضياع', allocatePriceOverUnits([{ costMinor: 2 }, { costMinor: 1 }], 100).reduce((a, b) => a + b, 0) === 100)
ok('الدفتر متوازن بعد عمليات العقارات', balanced())

/* ═══ ⑥ المقاولات: تكلفة مشروع بسداد جزئي على مقاول باطن مسجل ═══ */
console.log('🏗️ نشاط المقاولات — تكلفة على مورد/مقاول باطن بسداد جزئي')
const project = S().addProject({ nameAr: 'فيلا الشاطئ', clientName: 'العميل', clientId: null, managerId: null, contractValueMinor: 5_000_000_00, retentionPercent: 5, startDate: '2026-01-01', endDate: '2026-12-01', notes: '' })
S().addSupplier({ ...EMPTY, nameAr: 'مقاول باطن — الأساسات', phone: '', notes: '' })
const subcontractor = S().suppliers.at(-1)
const costMixed = S().addProjectCost({
  projectId: project.id, kind: 'subcontract', amountMinor: 100_000_00, payment: 'mixed', paidMinor: 40_000_00,
  supplierId: subcontractor.id, description: 'صب القواعد', treasury: '1101',
})
ok('تكلفة المشروع تقبل سداداً جزئياً', costMixed.paidMinor === 40_000_00 && costMixed.dueMinor === 60_000_00)
ok('الآجل محمَّل على مقاول الباطن المسجل', costMixed.supplierId === subcontractor.id)
ok('كشف مقاول الباطن يُظهر المتبقي', S().getSupplierBalance(subcontractor.id) === 60_000_00, S().getSupplierBalance(subcontractor.id))
ok('الدفتر متوازن بعد تكلفة المشروع', balanced())

/* ═══ ⑦ المعامل: تحصيل جزئي من المريض ═══ */
console.log('🧪 نشاط المعامل — تحصيل جزئي والباقي ذمة على المريض')
const labPatient = S().addLabPatient({ nameAr: 'مريض تجريبي', phone: '', gender: 'male', birthDate: '1990-01-01', nationalId: '', linkedCustomerId: null, notes: '' })
S().addLabTest({ code: 'CBC', nameAr: 'صورة دم', category: 'دم', sampleType: 'دم وريدي', unit: '', priceMinor: 1_000_00, costMinor: 0, refRanges: [] })
const labTest = S().labTests.at(-1)
const labOrder = S().registerLabOrder({ patientId: labPatient.id, referrerId: null, testIds: [labTest.id], payment: 'mixed', paidMinor: 400_00, discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' })
ok('طلب المعمل يقبل تحصيلاً جزئياً', labOrder.paidMinor === 400_00 && labOrder.dueMinor === 600_00)
ok('الباقي ذمة على المريض في 1104', bal('1104') >= 600_00)
ok('الدفتر متوازن بعد طلب المعمل', balanced())
throws('التحصيل أكبر من الإجمالي مرفوض', () => S().registerLabOrder({ patientId: labPatient.id, referrerId: null, testIds: [labTest.id], payment: 'mixed', paidMinor: 9_000_00, discountPercent: 0, vatPercent: 0, notes: '', treasury: '1101' }), 'المحصَّل')

/* ═══ ⑧ الحارس الساكن: كل نشاط يدعم الطرف والسداد الجزئي ═══ */
console.log('🛡️ حارس ساكن: الشراء والبيع والتأجير في كل نشاط')
const { readFileSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')
const { join, dirname } = await import('node:path')
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const repoSrc = readFileSync(join(SRC, 'data/repo.ts'), 'utf8')
for (const [label, needle] of [
  ['شراء السيارات: فاتورة كاملة', 'addCarPurchaseInvoice:'],
  ['تجهيز السيارة: جهة مسجلة', 'supplierId?: number | null) => CarPrepCost'],
  ['بيع الوحدات العقارية: سطر لكل وحدة', 'sellPropertyUnits:'],
  ['عقد الإيجار: عدة وحدات', 'units?: { unitId: number; rentMinor: number }[]'],
  ['بيع العقار: سداد مختلط ومشترٍ', "payment: 'cash' | 'credit' | 'mixed'; paidMinor?: number; buyerCustomerId?: number | null"],
  ['المقاولات: تكلفة بسداد جزئي ومورد', "payment: 'cash' | 'credit' | 'mixed'; paidMinor?: number; supplierId?: number | null"],
  ['المعامل: تحصيل جزئي', "payment: 'cash' | 'credit' | 'mixed'"],
]) ok(label, repoSrc.includes(needle))
const carsPage = readFileSync(join(SRC, 'ui/pages/CarsPage.tsx'), 'utf8')
ok('واجهة السيارات: زر فاتورة الشراء', carsPage.includes('CarPurchaseInvoiceModal'))
ok('واجهة التجهيز: اختيار ورشة مسجلة', carsPage.includes('الورشة / المصنع / جهة التجهيز'))
ok('واجهة التجهيز: إضافة جهة جديدة فوراً', carsPage.includes('SupplierInlineCreate'))
const realestatePage = readFileSync(join(SRC, 'ui/pages/RealEstatePages.tsx'), 'utf8')
ok('واجهة العقارات: مستند بيع وحدات', realestatePage.includes('data-unit-sale-line'))
ok('واجهة العقود: سطر وحدة لكل وحدة', realestatePage.includes('data-lease-unit-line'))

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) { console.error('❌ فشل فحص تدفقات الأنشطة'); process.exit(1) }
console.log('🎉 الشراء والبيع والتأجير: طرف مسجل لكل آجل، سداد جزئي، وسطر مستقل لكل وحدة')
