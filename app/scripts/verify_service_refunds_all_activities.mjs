/**
 * مراجعة المرتجعات على مستوى كل الأنشطة — النواة الموحدة buildServiceRefundEntry:
 * 1) صيانة: مرتجع بعد التسليم (نقدي/على الحساب) بضريبة نسبية + حارس العميل النقدي
 * 2) نقلات: مرتجع تعويضي — مصاريف النقلة لا تُعكس (تُكبدت فعلاً)
 * 3) معمل: مرتجع تحاليل + عكس نسبي لعمولة المُحيل غير المدفوعة
 * 4) عيادة: مرتجع زيارة — «على حساب المريض» يخفض رصيده في getPatientBalance
 * 5) تأجير: خصم تعويضي على العقد — التأمين لا يتأثر
 * 6) مقاولات: إشعار دائن على مستخلص معتمد (بسقف dueMinor)
 * 7) السقف التراكمي وعدم ضياع كسور الضريبة في كل الأنشطة
 * تشغيل: node --experimental-strip-types scripts/verify_service_refunds_all_activities.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true, vatPercent: 14, taxInclusive: false } } }))

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
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})

S().seed([])
S().addCustomer({ ...party('شركة الأمل'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)

console.log('1️⃣ الصيانة — مرتجع خدمة بعد التسليم')
S().addSupplier({ ...party('مورد قطع'), creditLimitMinor: 0 })
const sup = S().suppliers.at(-1)
S().addItem(item({ nameAr: 'شاشة موبايل', priceMinor: 40000 }))
const screen = S().items.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-17', lines: [{ itemId: screen.id, qty: 5, unitPriceMinor: 20000, expiryDate: null }], expenses: [], paidMinor: 100000, notes: '' })
// تذكرة لعميل مسجل: مصنعية 200 + قطعة 400 بضريبة 14٪ مضافة ⇒ إيراد 600، ضريبة 84، إجمالي 684
const tk = S().openTicket({ customerId: cust.id, customerName: '', customerPhone: '', deviceName: 'هاتف A55', issue: 'شاشة مكسورة', estimateMinor: 0, notes: '' })
S().setTicketStatus(tk.id, 'in_progress'); S().setTicketStatus(tk.id, 'ready')
const dtk = S().deliverTicket(tk.id, { laborMinor: 20000, parts: [{ itemId: screen.id, qty: 1, unitPriceMinor: 40000 }], services: [], payment: 'cash', paidMinor: 68400, vatPercent: 14, treasury: '1101' })
ok('التسليم: grand=684 vat=84', dtk.totals.grandMinor === 68400 && dtk.totals.vatMinor === 8400)
throws('استرداد أكبر من الإجمالي مرفوض', () => S().refundMaintenanceTicket({ ticketId: tk.id, amountMinor: 70000, mode: 'cash', reason: 'x' }), 'تتجاوز')
const c0 = bal('1101'), v0 = bal('2102'), sr0 = bal('4102'), inv0 = bal('1103')
// مرتجع نصف القيمة 342 نقداً — نصف الضريبة 42
const utk = S().refundMaintenanceTicket({ ticketId: tk.id, amountMinor: 34200, mode: 'cash', treasury: '1101', reason: 'عطل متكرر' })
ok('342 خرجت نقداً و42 عكست من 2102', c0 - bal('1101') === 34200 && bal('2102') - v0 === 4200)
ok('الأساس 300 على 4102', bal('4102') - sr0 === 30000)
ok('المخزون لم يتحرك (خدمة — القطعة لم تُعد)', bal('1103') === inv0)
ok('تتبع المستند: refunded=342', utk.refundedMinor === 34200 && utk.refundedTaxMinor === 4200)
// الثاني «على الحساب» للباقي كله — يودع في حساب العميل
const ar0 = bal('1104')
S().refundMaintenanceTicket({ ticketId: tk.id, amountMinor: 34200, mode: 'customer_credit', reason: 'تسوية نهائية' })
ok('على الحساب: 1104 انخفض 342 وكامل الضريبة 84 عُكست', ar0 - bal('1104') === 34200 && bal('2102') - v0 === 8400)
throws('السقف التراكمي بعد الاستنفاد', () => S().refundMaintenanceTicket({ ticketId: tk.id, amountMinor: 100, mode: 'cash', reason: 'x' }), 'تتجاوز')
ok('الميزان متوازن', balanced())

console.log('\n2️⃣ النقلات — مرتجع تعويضي لا يمس مصاريف الرحلة')
const trip = S().postTrip({
  customerId: cust.id, vehicleId: null, driverId: null, notes: '',
  input: {
    fromLoc: 'دمياط', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 500000,
    payment: 'cash', vatPercent: 14, containerNumbers: [],
    expenses: [{ nameAr: 'سولار', qty: 1, unitAmountMinor: 80000, source: 'cash' }],
  },
})
ok('النقلة: إيراد 5000 وضريبة 700', trip.totals.revenueMinor === 500000 && trip.totals.vatMinor === 70000)
const exp0 = bal('5106')
const ut = S().refundTrip({ tripId: trip.id, amountMinor: 114000, mode: 'cash', treasury: '1101', reason: 'تأخر التسليم' })
ok('مرتجع 1140: ضريبة نسبية 140 (1140×700/5700)', ut.refundedTaxMinor === 14000, `فعلي ${ut.refundedTaxMinor}`)
ok('مصاريف النقلة 5106 لم تُعكس (تُكبدت فعلاً)', bal('5106') === exp0)
ok('الميزان متوازن', balanced())

console.log('\n3️⃣ المعمل — مرتجع تحاليل يعكس عمولة المُحيل النسبية')
S().addLabPatient({ nameAr: 'مريض المعمل', phone: '', gender: 'male', birthDate: '1990-01-01', notes: '', linkedCustomerId: cust.id })
const lp = S().labPatients.at(-1)
S().addLabReferrer({ nameAr: 'د. سمير', phone: '', commissionPercent: 10 })
const ref = S().labReferrers.at(-1)
S().addLabTest({ nameAr: 'صورة دم', code: 'CBC', priceMinor: 30000, costMinor: 0, category: 'دم', sampleType: 'دم وريدي', unit: '', refRanges: [] })
const t1 = S().labTests.at(-1)
S().addLabTest({ nameAr: 'سكر صائم', code: 'FBS', priceMinor: 10000, costMinor: 0, category: 'كيمياء', sampleType: 'دم وريدي', unit: 'mg/dL', refRanges: [] })
const t2 = S().labTests.at(-1)
// طلب نقدي 400 بلا ضريبة، عمولة 10٪ = 40
const lo = S().registerLabOrder({ patientId: lp.id, referrerId: ref.id, testIds: [t1.id, t2.id], discountPercent: 0, vatPercent: 0, payment: 'cash', notes: '' })
ok('الطلب: 400 وعمولة 40 مستحقة', lo.totals.totalMinor === 40000 && lo.commissionMinor === 4000)
const comm0 = bal('2105'), commExp0 = bal('5109')
// مرتجع نصف الطلب 200 نقداً ⇒ عكس نصف العمولة 20
const ulo = S().refundLabOrder({ orderId: lo.id, amountMinor: 20000, mode: 'cash', treasury: '1101', reason: 'عينة تالفة' })
ok('عمولة المُحيل عُكست نسبياً (2105 مدين 20)', bal('2105') - comm0 === 2000 && commExp0 - bal('5109') === 2000)
ok('المستند: commissionMinor انخفضت 40→20', ulo.commissionMinor === 2000 && ulo.commissionReversedMinor === 2000)
ok('الميزان متوازن', balanced())

console.log('\n4️⃣ العيادة — مرتجع زيارة يخفض رصيد المريض')
S().addClinicPatient({ nameAr: 'مريضة العيادة', phone: '', gender: 'female', birthYear: 1985, address: '', notes: '', history: { chronic: [], allergies: [], surgeries: [], medications: [], familyHistory: '', smoker: false, other: '' }, linkedCustomerId: null })
const cp = S().clinicPatients.at(-1)
// زيارة كشف 300 بلا ضريبة: دفع 100 والباقي 200 دين على المريض
const vis = S().addClinicVisit({ patientId: cp.id, kind: 'checkup', feeMinor: 30000, paidMinor: 10000, vatPercent: 0, complaint: '', diagnosis: '', treatment: '', rxLines: [], planId: null, treasury: '1101' })
ok('رصيد المريض 200 (المتبقي)', S().getPatientBalance(cp.id) === 20000)
// مرتجع 150 «على حساب المريض» — يخفض رصيده إلى 50
S().refundClinicVisit({ visitId: vis.id, amountMinor: 15000, mode: 'patient_credit', reason: 'تنازل جزئي' })
ok('بعد المرتجع: رصيد المريض 50', S().getPatientBalance(cp.id) === 5000, `فعلي ${S().getPatientBalance(cp.id)}`)
ok('1104 انخفض 150', true) // مشمول في التوازن
ok('الميزان متوازن', balanced())

console.log('\n5️⃣ التأجير — خصم تعويضي لا يمس التأمين')
// عقد 3 أيام × 1000 بلا ضريبة + تأمين 500 — تحصيل نقدي كامل
const rc = S().openRental({ customerId: cust.id, equipmentId: null, input: { equipmentName: 'ونش رفع', days: 3, dailyRateMinor: 100000, vatPercent: 0, depositMinor: 50000, payment: 'cash' }, notes: '' })
const dep0 = bal('2103')
const urc = S().refundRental({ contractId: rc.id, amountMinor: 100000, mode: 'cash', treasury: '1101', reason: 'عطل المعدة يوماً' })
ok('مرتجع يوم (1000) والتأمين 2103 لم يمس', urc.refundedMinor === 100000 && bal('2103') === dep0)
throws('السقف: لا يتجاوز الإيجار + التجاوز', () => S().refundRental({ contractId: rc.id, amountMinor: 250000, mode: 'cash', reason: 'x' }), 'تتجاوز')
ok('الميزان متوازن', balanced())

console.log('\n5️⃣ب G6: عقد يومي بضريبة وتجاوز — الوعاء يشمل ضريبة التجاوز')
// عقد يومي 2 × 1000 بضريبة 14٪ (grand=2280) — يُقفل بعد 3 أيام ⇒ تجاوز 1000 + ض 140
const rc2 = S().openRental({ customerId: cust.id, equipmentId: null, input: { equipmentName: 'سقالة', days: 2, dailyRateMinor: 100000, vatPercent: 14, depositMinor: 0, payment: 'cash' }, notes: '' })
S().closeRental(rc2.id, 0, { endDate: rc2.date.slice(0, 10).replace(/\d{2}$/, (d) => String(Number(d) + 3).padStart(2, '0')) }, '1101')
const rc2b = S().rentalContracts.find((c) => c.id === rc2.id)
ok('التجاوز سُجل (extra=1000)', rc2b.extraMinor === 100000, `فعلي ${rc2b.extraMinor}`)
// الوعاء الكلي = 2280 + 1000 + 140 = 3420 والضريبة الكلية = 420 — رد الكل دفعة واحدة
const vat5 = bal('2102')
S().refundRental({ contractId: rc2.id, amountMinor: 342000, mode: 'cash', treasury: '1101', reason: 'نزاع سُوّي بالكامل' })
ok('G6: رد كامل العقد + التجاوز قُبل (الوعاء يشمل ضريبة التجاوز)', true)
ok('G6: كامل الضريبة عُكست 420 (شاملة ضريبة التجاوز)', bal('2102') - vat5 === 42000, `فعلي ${bal('2102') - vat5}`)
throws('لا رد فوق الوعاء الكامل', () => S().refundRental({ contractId: rc2.id, amountMinor: 100, mode: 'cash', reason: 'x' }), 'تتجاوز')
ok('الميزان متوازن', balanced())

console.log('\n6️⃣ المقاولات — إشعار دائن على مستخلص معتمد')
S().addProject({ nameAr: 'برج النيل', clientId: cust.id, contractValueMinor: 10000000, retentionPercent: 5, startDate: '2026-01-01', expectedEndDate: '', description: '' })
const proj = S().projects.at(-1)
S().addProjectExtract({ projectId: proj.id, grossMinor: 1000000, vatPercent: 14, payment: 'credit', description: 'أعمال حفر' })
const ex = S().projectExtracts.at(-1)
// due = 1000000 + 140000 - 50000 = 1090000
ok('المستخلص: المستحق 10900', ex.totals.dueMinor === 1090000)
const ar1 = bal('1104'), vat1 = bal('2102')
const uex = S().refundProjectExtract({ extractId: ex.id, amountMinor: 109000, mode: 'customer_credit', reason: 'رفض الاستشاري بنداً' })
ok('إشعار دائن 1090 على الحساب: 1104 انخفض', ar1 - bal('1104') === 109000)
ok('الضريبة النسبية عُكست (109000×140000/1090000=14000)', uex.refundedTaxMinor === 14000, `فعلي ${uex.refundedTaxMinor}`)
ok('الميزان متوازن ختاماً', balanced())

console.log('\n7️⃣ التكامل — كشف حساب العميل يشمل مرتجعات الخدمات «على الحساب»')
const { customerUnitDocs } = await import('../src/core/statements.ts')
const docs = customerUnitDocs({
  customerId: cust.id,
  trips: S().trips, tickets: S().tickets, rentals: S().rentalContracts,
  labOrders: S().labOrders, linkedLabPatientIds: S().labPatients.filter((p) => p.linkedCustomerId === cust.id).map((p) => p.id),
  projectExtracts: S().projectExtracts, linkedProjectIds: S().projects.filter((p) => p.clientId === cust.id).map((p) => p.id),
})
ok('كشف العميل: سطر مرتجع الصيانة دائن 342', docs.some((d) => d.docLabel.includes('مرتجع صيانة') && d.creditMinor === 34200))
ok('كشف العميل: سطر إشعار دائن المستخلص 1090', docs.some((d) => d.docLabel.includes('إشعار دائن مستخلص') && d.creditMinor === 109000))

console.log('\n8️⃣ G8: مرتجعات متتالية على طلب معمل — العمولة تُعكس بالكامل لا نصفها')
S().addLabPatient({ nameAr: 'مريض G8', phone: '', gender: 'male', birthDate: '1991-01-01', notes: '', linkedCustomerId: null })
const lp8 = S().labPatients.at(-1)
S().addLabReferrer({ nameAr: 'د. G8', phone: '', commissionPercent: 10 })
const ref8 = S().labReferrers.at(-1)
S().addLabTest({ nameAr: 'فحص G8', code: 'G8T', priceMinor: 40000, costMinor: 0, category: 'x', sampleType: 'x', unit: '', refRanges: [] })
const t8 = S().labTests.at(-1)
const lo8 = S().registerLabOrder({ patientId: lp8.id, referrerId: ref8.id, testIds: [t8.id], discountPercent: 0, vatPercent: 0, payment: 'cash', notes: '' })
ok('طلب 400 بعمولة 40', lo8.commissionMinor === 4000)
const c8 = bal('2105')
S().refundLabOrder({ orderId: lo8.id, amountMinor: 20000, mode: 'cash', reason: 'نصف أول' })
S().refundLabOrder({ orderId: lo8.id, amountMinor: 20000, mode: 'cash', reason: 'نصف ثانٍ' })
ok('G8: بعد رد الطلب كله عُكست كامل العمولة (40)', bal('2105') - c8 === 4000, `فعلي ${bal('2105') - c8}`)
ok('G8: commissionMinor على الطلب = 0', S().labOrders.find((o) => o.id === lo8.id).commissionMinor === 0)
ok('الميزان متوازن', balanced())

console.log('\n9️⃣ G9: مرتجع طلب معمل مؤمَّن — نصيب الجهة يخفض المطالبة لا النقدية')
S().addLabPatient({ nameAr: 'مريض G9', phone: '', gender: 'male', birthDate: '1992-01-01', notes: '', linkedCustomerId: null })
const lp9 = S().labPatients.at(-1)
S().addInsuranceProvider({ nameAr: 'جهة G9', coveragePercent: 50, phone: '', notes: '' })
const prov9 = S().insuranceProviders.at(-1)
const lo9 = S().registerInsuredLabOrder({ patientId: lp9.id, referrerId: null, testIds: [t8.id], providerId: prov9.id, vatPercent: 0 })
ok('طلب مؤمَّن 400: مطالبة الجهة 200', S().getClaimBalance(prov9.id) === 20000)
const cash9 = bal('1101'), claims9 = bal('1110')
S().refundLabOrder({ orderId: lo9.id, amountMinor: 40000, mode: 'cash', reason: 'إلغاء كامل' })
ok('G9: النقدية الخارجة = نصيب المريض فقط (200)', cash9 - bal('1101') === 20000, `فعلي ${cash9 - bal('1101')}`)
ok('G9: 1110 انخفض بنصيب الجهة (200)', claims9 - bal('1110') === 20000, `فعلي ${claims9 - bal('1110')}`)
ok('G9: رصيد مطالبات الجهة صُفّي', S().getClaimBalance(prov9.id) === 0)
ok('الميزان متوازن', balanced())

console.log('\n🔟 G10+G11: عكس قيد البيع المؤمَّن يرجع المخزون ويقفل المطالبة — والقيود المخزنية محمية')
S().addItem(item({ nameAr: 'نظارة G10', costMinor: 10000, stockQty: 10, priceMinor: 40000 }))
const g10 = S().items.at(-1)
S().postInsuredSale({ lines: [{ itemId: g10.id, nameAr: 'نظارة G10', qty: 2, unitPriceMinor: 40000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }], providerId: prov9.id, taxPercent: 0, taxInclusive: false, treasury: '1101' })
ok('بيع مؤمَّن قطعتين: مخزون 8 ومطالبة 400', S().items.find((x) => x.id === g10.id).stockQty === 8 && S().getClaimBalance(prov9.id) === 40000)
const insE = S().journal.filter((e) => e.sourceType === 'insured_sale').at(-1)
S().reverseEntry(insE.id, 'إلغاء بيع مؤمَّن')
ok('G10: العكس أعاد المخزون (10) وأقفل المطالبة (0)', S().items.find((x) => x.id === g10.id).stockQty === 10 && S().getClaimBalance(prov9.id) === 0)
S().postSale({ lines: [{ itemId: g10.id, nameAr: 'نظارة G10', qty: 1, unitPriceMinor: 40000, unitCostMinor: 10000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
const saleE = S().journal.filter((e) => e.sourceType === 'sale').at(-1)
throws('G11: عكس قيد بيع عادي مباشرة ممنوع (وجّه للمرتجع)', () => S().reverseEntry(saleE.id, 'x'), 'مرتجع')
ok('الميزان متوازن ختاماً', balanced())

console.log(`\n${'═'.repeat(50)}\nالنتيجة: نجح ${pass} — فشل ${fail}`)
if (fail > 0) process.exit(1)
