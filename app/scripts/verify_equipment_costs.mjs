/**
 * فحص تكاليف تشغيل المعدات وربحية الساعة (سد فجوة Point of Rental):
 * مصروف وقود/صيانة بقيد 5105، عقد ساعي بقراءات، وردانيات،
 * ثم ربحية المعدة = إيراد − تكاليف وربح الساعة من الساعات الموثقة.
 * تشغيل: node --experimental-strip-types scripts/verify_equipment_costs.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
// هذه السيناريوهات تدفع من خزائن لم تُموَّل — نفعّل السماح بالرصيد السالب صراحة (الافتراضي: ممنوع)
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))


const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const bal = (code) => { let v = 0; for (const e of S().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }
const balanced = () => { let d = 0, c = 0; for (const e of S().journal) for (const l of e.lines) { d += l.debit; c += l.credit }; return d === c }

console.log('🚜 التأسيس: معدة بأسعار وصيانة كل 250 ساعة')
S().addEquipment({ nameAr: 'حفار كوماتسو', code: 'EX-01', dailyRateMinor: 500000, hourlyRateMinor: 80000, monthlyRateMinor: 9000000, meterReading: 1200, serviceEveryHours: 250, lastServiceReading: 1200, notes: '' })
const eq = S().equipment.at(-1)

console.log('⛽ مصاريف التشغيل بقيودها')
S().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 150000, description: 'سولار 200 لتر' })
S().addEquipmentCost({ equipmentId: eq.id, kind: 'maintenance', amountMinor: 80000, treasury: '1101' })
S().addEquipmentCost({ equipmentId: eq.id, kind: 'operator', amountMinor: 100000 })
ok('ثلاثة مصاريف مسجلة', S().equipmentCosts.length === 3)
ok('5105 حمل 3300', bal('5105') === 330000)
ok('الخزينة دفعت 3300', bal('1101') === -330000)
throws('مبلغ صفري يُرفض', () => S().addEquipmentCost({ equipmentId: eq.id, kind: 'fuel', amountMinor: 0 }), 'أكبر من صفر')
throws('معدة غير موجودة تُرفض', () => S().addEquipmentCost({ equipmentId: 999, kind: 'fuel', amountMinor: 100 }), 'غير موجودة')

console.log('📄 عقد ساعي بقراءات عداد + وردية')
S().openRental({
  customerId: null, equipmentId: eq.id,
  input: { equipmentName: eq.nameAr, days: 10, dailyRateMinor: 80000, depositMinor: 0, payment: 'cash', vatPercent: 0 },
  notes: '', rateType: 'hourly', startReading: 1200, treasury: '1101',
})
const rc = S().rentalContracts.at(-1)
S().closeRental(rc.id, 0, { endReading: 1210 }, '1101')
ok('العقد أُقفل بقراءة 1210', S().rentalContracts.at(-1).status === 'closed')
ok('عداد المعدة تقدم إلى 1210', S().equipment.find((e) => e.id === eq.id).meterReading === 1210)
S().addOperatorShift({ equipmentId: eq.id, operatorName: 'أسطى محمود', date: '2026-09-15', startReading: 1210, endReading: 1215, notes: '' })

console.log('📊 ربحية المعدة وربح الساعة')
const pr = S().getEquipmentProfit(eq.id)
// إيراد العقد 10×80000 = 800000؛ تكاليف 330000؛ ربح 470000؛ ساعات 10+5=15
ok('الإيراد 8000', pr.revenueMinor === 800000)
ok('التكاليف 3300', pr.costsMinor === 330000)
ok('الربح 4700', pr.profitMinor === 470000)
ok('الساعات الموثقة 15', pr.hours === 15)
ok('ربح الساعة ≈ 313.33', pr.profitPerHourMinor === Math.round(470000 / 15))
throws('ربحية معدة غير موجودة تُرفض', () => S().getEquipmentProfit(999), 'غير موجودة')

console.log('🔧 الصيانة الوقائية تتقدم مع العداد')
const { serviceStatus } = await import('../src/core/rentalMeter.ts')
const eqNow = S().equipment.find((e) => e.id === eq.id)
const svc = serviceStatus(eqNow.lastServiceReading, eqNow.serviceEveryHours, eqNow.meterReading)
ok('الخدمة القادمة عند 1450 والمتبقي 235 (العداد 1215 بعد الوردية)', svc.dueAtReading === 1450 && svc.remainingHours === 235)
S().recordEquipmentService(eq.id)
ok('تسجيل الخدمة صفّر الفترة عند 1215', S().equipment.find((e) => e.id === eq.id).lastServiceReading === 1215)

console.log('👨‍✈️ السائقون في الموظفين + العقد المرجعي + الفواتير الدورية (بالضريبة وبدون ضريبة) + تحميل المصاريف + المستخلص الجزئي')
const { jobTitlesFor, isDriverEmployee } = await import('../src/core/jobTitles.ts')
const titles = jobTitlesFor('contracting', ['equipment_rental'])
ok('مسميات السائق والمشغل متاحة في المقاولات + تأجير المعدات', titles.includes('سائق معدة') && titles.includes('مشغّل معدة'))
S().addEmployee({ nameAr: 'كابتن حسن سائق الحفار', phone: '01011112222', role: 'technician', jobTitle: 'سائق معدة', baseSalaryMinor: 600000 })
const driverEmp = S().employees.at(-1)
ok('تصنيف الموظف كسائق معدة يعمل', isDriverEmployee(driverEmp))

S().addCustomer({ nameAr: 'شركة النيل للمقاولات (مستأجر)', phone: '01233334444', notes: '' })
const tenant = S().customers.at(-1)
S().addEquipment({
  nameAr: 'لودر كاتربيلر 966', code: 'LD-966',
  dailyRateMinor: 400000, hourlyRateMinor: 60000, monthlyRateMinor: 8000000,
  meterReading: 500, serviceEveryHours: 250, lastServiceReading: 500,
  driverEmployeeId: driverEmp.id, notes: '',
})
const eqRef = S().equipment.at(-1)

// 1) فتح عقد مرجعي مع تأمين 5000 ج.م (500,000 قرش) ومصفوفة تحمل مصاريف
const refContract = S().openRental({
  customerId: tenant.id,
  equipmentId: eqRef.id,
  input: { equipmentName: eqRef.nameAr, days: 3, dailyRateMinor: 8000000, depositMinor: 500000, payment: 'credit', vatPercent: 14 },
  notes: 'عقد مرجعي لمدة 3 أشهر',
  rateType: 'monthly',
  billingMode: 'reference',
  withTax: true,
  driverEmployeeId: driverEmp.id,
  responsibility: { fuel: 'customer', operator: 'owner', transport: 'customer', maintenance: 'owner', damage: 'customer' },
})
ok('العقد المرجعي لا يثبت مديونية إيجار مسبقة عند الفتح (رصيد العميل = 0)', S().getCustomerBalance(tenant.id) === 0)
ok('التأمين فقط قُيّد على 2103', bal('2103') === -500000)

// 2) إصدار فاتورة دورية للشهر الأول بدون ضريبة (8,000,000 قرش آجل)
const inv1 = S().issueRentalInvoice({
  contractId: refContract.id,
  periodLabel: 'الشهر الأول',
  qty: 1,
  unitRateMinor: 8000000,
  withTax: false,
  payment: 'credit',
})
ok('الفاتورة الدورية الأولى بدون ضريبة (الإجمالي = الصافي 8,000,000)', inv1.totalMinor === 8000000 && inv1.vatMinor === 0)
ok('رصيد العميل المستأجر زاد بقيمة الفاتورة الأولى (8,000,000)', S().getCustomerBalance(tenant.id) === 8000000)

// 3) إصدار فاتورة دورية للشهر الثاني بالضريبة 14% (صافي 8,000,000 + ضريبة 1,120,000 = 9,120,000)
const inv2 = S().issueRentalInvoice({
  contractId: refContract.id,
  periodLabel: 'الشهر الثاني',
  qty: 1,
  unitRateMinor: 8000000,
  withTax: true,
  vatPercent: 14,
  payment: 'credit',
})
ok('الفاتورة الدورية الثانية بالضريبة 14% (الإجمالي 9,120,000)', inv2.totalMinor === 9120000 && inv2.vatMinor === 1120000)
ok('رصيد العميل المستأجر أصبح 17,120,000', S().getCustomerBalance(tenant.id) === 17120000)

// 4) مصاريف على العقد: أجر سائق على المالك (driver) + سولار محمّل على المستأجر (customer)
S().addEquipmentCost({
  equipmentId: eqRef.id, kind: 'operator', amountMinor: 600000,
  contractId: refContract.id, costLayer: 'driver', borneBy: 'owner', driverEmployeeId: driverEmp.id,
  description: 'أجر السائق للشهر الأول',
})
S().addEquipmentCost({
  equipmentId: eqRef.id, kind: 'fuel', amountMinor: 250000,
  contractId: refContract.id, costLayer: 'direct', borneBy: 'customer',
  description: 'سولار ممول من الشركة على حساب المستأجر',
})
ok('المصروف المحمّل على المستأجر زاد مديونية العميل في 1104 وكشف الحساب إلى 17,370,000', S().getCustomerBalance(tenant.id) === 17370000)
const eqRefProfit = S().getEquipmentProfit(eqRef.id)
ok('ربحية المعدة تحسب إيراد الفواتير الدورية الصافي (16,000,000) وتخصم تكلفة المالك فقط (600,000)', eqRefProfit.revenueMinor === 16000000 && eqRefProfit.costsMinor === 600000 && eqRefProfit.driverCostsMinor === 600000 && eqRefProfit.customerBorneCostsMinor === 250000)

// 5) المستخلص الجزئي للمشروع لا يتعطل بتحريك شريط تقدم الموقع (updateBoqProgress)
const prj = S().addProject({ nameAr: 'مشروع طرق', clientName: tenant.nameAr, clientId: tenant.id, contractValueMinor: 10000000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })
const boq1 = S().addBoqItem({ projectId: prj.id, code: 'B-01', descriptionAr: 'تمهيد وتسوية', unit: 'م2', qty: 100, unitPriceMinor: 100000 })
S().updateBoqProgress(boq1.id, 100) // تحريك شريط الموقع إلى 100% قبل إصدار أي مستخلص
const partialEx = S().addProjectExtract({
  projectId: prj.id,
  extractLines: [{ boqItemId: boq1.id, newProgressPercent: 25 }],
  vatPercent: 0, payment: 'credit', description: 'مستخلص جاري أول 25%', isFinal: false,
})
ok('المستخلص الجزئي 25% صدر بنجاح رغم أن شريط تقدم الموقع كان 100%', partialEx.totals.grossMinor === 2500000 && !partialEx.isFinal)

console.log('⚖️ الميزان')
ok('الدفتر متوازن', balanced())

console.log(`\nPASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log('🎉 تكاليف المعدات وربحية الساعة تعمل مع الصيانة الوقائية')
